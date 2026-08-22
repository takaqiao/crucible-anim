/**
 * Task 15：persist 生命周期缺的三个钩子 + `resyncPersist`/`isPlayingPersist`。
 *
 * Task 14 只落地了 createActiveEffect / deleteActiveEffect 两端。缺的三条正是
 * `worldPersist:false` 这个选择的收益侧（见 effects.mjs 头部注释）：在**角色卡效果页**
 * 上停用/启用状态（updateActiveEffect 的 disabled 翻转——**不是** token HUD，HUD 走的
 * 是 create/delete，见 effects.mjs 里那条订正注释）、客户端重载/切场景回来/中途进场
 * （sequencerEffectManagerReady → resyncPersist）、带状态的 token 被拖进场景
 * （createToken）。
 *
 * 修复轮 1 追加：A 组（钩子提前到 init + 两种到达顺序）、B 组（resync 绕过动画开关）、
 * D 组（空测试）、E1（让路期的幂等）、E3（让路期内被停用）。
 *
 * 复用 persist-lane.test.mjs 的 stubFoundry 思路，但额外装一个会记录调用、且支持
 * `getEffects` 的 Sequencer 桩——`isPlayingPersist` 的幂等性正是靠这个方法判断。
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

import {installFakeSequencer} from "../tools/fake-sequencer.mjs";
import {tokenPlaceable} from "../tools/token-mocks.mjs";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import {installEffectTriggers, installPersistResync, flushPersistResync, resyncPersist,
        awaitPersistVisible, resetPersistInFlight} from "../scripts/trigger/effects.mjs";
import {queueDepth} from "../scripts/trigger/dispatch.mjs";
import {PERSIST_LEAD_MS} from "../scripts/const.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const ENV = {gridSize: 100};
const deps = () => ({assets: createAssets(offlineBackend(index)), armory: ARMORY});

const sleep = ms => new Promise(r => setTimeout(r, ms));
const bounded = (p, ms = 3000) => Promise.race([p, sleep(ms)]);
/**
 * playPersist 走 runPersistAnimation，没有排队中的动作动画时会先老实等满一个
 * PERSIST_LEAD_MS 的宽限期才播出（见 dispatch.mjs 的两段让路）。这里没有任何一条
 * 用例喂了并发的动作动画，所以每次都要等这么久，而不是随手 sleep 几十毫秒。
 */
const afterGrace = () => bounded(sleep(PERSIST_LEAD_MS + 150));

/**
 * 最小 Foundry 桩，在 persist-lane.test.mjs 的 stubFoundry 基础上补两样：
 *   · `Sequencer.EffectManager.getEffects` 真的按 {origin, object} 过滤已播出的记录
 *     （`isPlayingPersist` 靠它判断"这份光环本地是不是已经在放"）；
 *   · `game.settings.get` 需要能回答 crucible 的 enableVFX 与本模组的 enabled/volume
 *     三个键（`animationsEnabled()`/`getSetting()` 都会读）。
 */
function stubFoundry({tokens, effectAlive = () => true, effectActive = () => true,
                     enabled = true, crucibleVFX = true} = {}) {
  // 在途登记是模块级状态，且现在要一直挂到「特效可被观察到 / 有界超时」为止（E1 修复
  // 轮 2）。本文件每条用例都用 t1 + 同名状态，键完全相同——不清零的话，上一条用例留下
  // 的登记会让下一条用例的播放被静默挡掉（断 0 的假绿、断 1 的假红）。
  resetPersistInFlight();
  const prev = {
    Hooks: globalThis.Hooks, Actor: globalThis.Actor, game: globalThis.game,
    canvas: globalThis.canvas, fromUuidSync: globalThis.fromUuidSync,
    Sequencer: globalThis.Sequencer
  };
  const handlers = {};
  const playing = [];               // {origin, object} 一旦"播出"就记进这里
  globalThis.Hooks = {on: (n, fn) => { (handlers[n] ??= []).push(fn); }};
  globalThis.Actor = class FakeActor {};
  // animationsEnabled() 读两个键：crucible 的 enableVFX 与本模组的 enabled。
  // 两者都要能单独关掉——B 组修的就是「关掉之后 resync 仍然补满全场光环」。
  globalThis.game = {
    settings: {get: (ns, key) => {
      if (ns === "crucible") return crucibleVFX;
      if (key === "enabled") return enabled;
      return key !== "debug";
    }}
  };
  globalThis.canvas = {dimensions: {size: 100}, ready: true, tokens: {placeables: tokens ?? []}};
  // ActiveEffect 侧必须带上 `active`：让路期结束后的存活复检看的是「还在**且仍然生效**」
  // （effects.mjs 的 E3 修复），返回一个没有 active 的裸对象会让所有 persist 播放
  // 无条件夭折，测出来的绿全是假的。
  globalThis.fromUuidSync = uuid => (uuid.includes("ActiveEffect")
    ? (effectAlive(uuid) ? {uuid, active: effectActive(uuid)} : null)
    : {uuid, object: (tokens ?? [])[0]});
  globalThis.Sequencer = {
    EffectManager: {
      endEffects: async () => {},
      getEffects: ({origin, object}) => playing.filter(p => p.origin === origin && p.object === object)
    }
  };
  const actor = Object.assign(new globalThis.Actor(), {getActiveTokens: () => tokens ?? []});
  return {
    handlers, actor, playing,
    /** 让 isPlayingPersist 认为这一份光环已经在放。 */
    markPlaying: (origin, object) => playing.push({origin, object}),
    fire: (name, ...args) => { for (const fn of handlers[name] ?? []) fn(...args); },
    restore: () => { for (const [k, v] of Object.entries(prev)) globalThis[k] = v; }
  };
}

function activeEffect(token, statusId = "burning") {
  return {uuid: `Scene.s.Token.${token.id}.ActiveEffect.${statusId}`,
          statuses: new Set([statusId]), id: statusId, active: true};
}

/* -------------------------------------------- */
/*  updateActiveEffect: disabled 翻转             */
/* -------------------------------------------- */

test("updateActiveEffect：disabled 翻真时结束光环，翻假（重新生效）时补齐", async () => {
  const fake = installFakeSequencer();
  const token = tokenPlaceable({id: "t1", center: {x: 500, y: 500}});
  const world = stubFoundry({tokens: [token]});
  try {
    installEffectTriggers(deps());
    const effect = {...activeEffect(token), parent: world.actor, active: false};

    // disabled: true（active 翻假）→ 必须走 endPersist（Sequencer.endEffects）
    let ended = false;
    world.playing.length = 0;
    const origEnd = world.actor; // noop, 保留变量避免 lint 误报
    globalThis.Sequencer.EffectManager.endEffects = async (filter) => {
      if (filter.origin === effect.uuid) ended = true;
    };
    world.fire("updateActiveEffect", effect, {disabled: true});
    await sleep(5);
    assert.ok(ended, "GM 在 HUD 上禁用状态后必须结束对应的持续特效");

    // disabled: false（active 翻真）→ 必须重新播放（走 runPersistAnimation）
    effect.active = true;
    world.fire("updateActiveEffect", effect, {disabled: false});
    await afterGrace();
    assert.equal(fake.sequences.length, 1, "重新生效后必须补播一份持续特效");
    assert.equal(queueDepth(), 0);
  } finally { world.restore(); fake.restore(); }
});

/**
 * 【D 组修复】原版只 `await sleep(5)`，而 persist 播放要先过 PERSIST_LEAD_MS(500ms)
 * 的让路期才会碰 Sequencer——5ms 之后无论实现对错都是 0 条序列，这条用例恒绿。
 * 变异验证：删掉 effects.mjs 里 `if (!("disabled" in changed)) return;` 之后原版照样绿，
 * 现在必须红。
 *
 * 同时补一条对照：同一个桩、同一个 effect，只把 changed 换成 `{disabled: false}`
 * 就必须真的播出一份——否则「什么都没播」可能只是因为这条路径整个被别的原因堵死了
 * （桩坏了、规则不匹配、让路期没等够），断言 0 就成了自欺。
 */
test("updateActiveEffect：非 disabled 字段更新不触发任何播放/清理（等满让路期）", async () => {
  const fake = installFakeSequencer();
  const token = tokenPlaceable({id: "t1", center: {x: 500, y: 500}});
  const world = stubFoundry({tokens: [token]});
  try {
    installEffectTriggers(deps());
    const effect = {...activeEffect(token), parent: world.actor};
    let endCalled = false;
    globalThis.Sequencer.EffectManager.endEffects = async () => { endCalled = true; };
    world.fire("updateActiveEffect", effect, {name: "改了名字"});
    await afterGrace();
    assert.equal(fake.sequences.length, 0, "只改了名字，不该有任何持续特效播出");
    assert.equal(endCalled, false);

    // 对照组：同一条路径在 disabled 翻转时必须真的播出，证明上面的 0 不是死路。
    world.fire("updateActiveEffect", effect, {disabled: false});
    await afterGrace();
    assert.equal(fake.sequences.length, 1,
      "对照组失败：这条路径本身就播不出来，上面那个 0 什么都没证明");
  } finally { world.restore(); fake.restore(); }
});

/* -------------------------------------------- */
/*  createToken: 带状态的 token 被拖进场景         */
/* -------------------------------------------- */

test("createToken：token 带着已生效的状态被放进当前场景时补播光环", async () => {
  const fake = installFakeSequencer();
  const token = tokenPlaceable({id: "t2", center: {x: 300, y: 300}});
  const actor = {effects: [activeEffect(token)]};
  Object.assign(token, {actor});
  const world = stubFoundry({tokens: [token]});
  try {
    installEffectTriggers(deps());
    world.fire("createToken", {parent: {isView: true}, object: token});
    await afterGrace();
    assert.equal(fake.sequences.length, 1, "入场的 token 带着生效中的状态必须补齐光环");
  } finally { world.restore(); fake.restore(); }
});

test("createToken：不在当前视图的场景（isView:false）不触发", async () => {
  const fake = installFakeSequencer();
  const token = tokenPlaceable({id: "t3", center: {x: 300, y: 300}});
  const actor = {effects: [activeEffect(token)]};
  Object.assign(token, {actor});
  const world = stubFoundry({tokens: [token]});
  try {
    installEffectTriggers(deps());
    world.fire("createToken", {parent: {isView: false}, object: token});
    await sleep(20);
    assert.equal(fake.sequences.length, 0);
  } finally { world.restore(); fake.restore(); }
});

test("createToken：object 尚未渲染完成（null）时静默跳过，不抛错", async () => {
  const fake = installFakeSequencer();
  const world = stubFoundry({tokens: []});
  try {
    installEffectTriggers(deps());
    assert.doesNotThrow(() => world.fire("createToken", {parent: {isView: true}, object: null}));
  } finally { world.restore(); fake.restore(); }
});

/* -------------------------------------------- */
/*  sequencerEffectManagerReady → resyncPersist  */
/* -------------------------------------------- */

/** 场上两个 token 各带一个状态。 */
function twoLoadedTokens() {
  const t1 = tokenPlaceable({id: "t1", center: {x: 100, y: 100}});
  const t2 = tokenPlaceable({id: "t2", center: {x: 200, y: 200}});
  Object.assign(t1, {actor: {effects: [activeEffect(t1, "burning")]}});
  Object.assign(t2, {actor: {effects: [activeEffect(t2, "chilled")]}});
  return [t1, t2];
}

/**
 * 【A2 · 顺序一】deps 先装配好，钩子后到——常规顺序。
 *
 * 注意注册用的是 `installPersistResync`（init 段）而不是 `installEffectTriggers`：
 * `sequencerEffectManagerReady` 每次画布加载只发一次，而 Sequencer 在 canvas.ready 之后
 * 很快就发（sequencer.js:30875-30879 → 11953），核心的 ready 却排在
 * `await documentIndex.index()` 与 `await canvas.initializing` 之后（game.mjs:763-779）。
 * 挂在 ready 里 = 这一次画布加载的钩子已经播完，症状是「重载/切场景回来光环全没了」。
 */
test("sequencerEffectManagerReady：deps 先就绪时，钩子照常触发 resyncPersist 补齐全场", async () => {
  const fake = installFakeSequencer();
  const world = stubFoundry({tokens: twoLoadedTokens()});
  try {
    const d = deps();
    installPersistResync(() => d);                 // deps 已经在手
    installEffectTriggers(d);
    world.fire("sequencerEffectManagerReady");
    await afterGrace();
    assert.equal(fake.sequences.length, 2, "场上两个各带一个状态的 token 必须各补一份光环");
  } finally { world.restore(); fake.restore(); }
});

/**
 * 【A2 · 顺序二】钩子先到、deps 后装配好——这正是线上真实发生的顺序。
 * 钩子那一刻必须记账而不是丢弃（本次画布加载不会再发第二次），
 * 装配完成后由 main.mjs 调 `flushPersistResync()` 补跑。
 */
test("sequencerEffectManagerReady：钩子早于 deps 到达时记账，flushPersistResync 补跑一次", async () => {
  const fake = installFakeSequencer();
  const world = stubFoundry({tokens: twoLoadedTokens()});
  try {
    let live = null;
    installPersistResync(() => live);              // deps 还没有
    world.fire("sequencerEffectManagerReady");     // 钩子先到
    await afterGrace();
    assert.equal(fake.sequences.length, 0, "deps 还没装配好，此刻不该播任何东西");

    live = deps();                                 // main.mjs 的 state.deps = deps
    installEffectTriggers(live);
    assert.equal(flushPersistResync(), true, "必须认账：钩子先到过，得补跑一次");
    await afterGrace();
    assert.equal(fake.sequences.length, 2, "补跑之后场上两个 token 必须各补一份光环");

    assert.equal(flushPersistResync(), false, "补跑是一次性的，不该重复触发");
  } finally { world.restore(); fake.restore(); }
});

/**
 * 【A · 自我禁用短路】自检失败/挂载抛错时 main.mjs 的 `liveDeps()` 恒为 null。
 * 提前注册的钩子仍在册，必须自己什么都不做，并且**不会**被后来的 flush 蒙混过关。
 */
test("sequencerEffectManagerReady：模组被自检禁用（liveDeps 恒 null）时钩子自己短路", async () => {
  const fake = installFakeSequencer();
  const world = stubFoundry({tokens: twoLoadedTokens()});
  try {
    installPersistResync(() => null);              // state.active 恒 false 的效果
    world.fire("sequencerEffectManagerReady");
    await afterGrace();
    assert.equal(fake.sequences.length, 0);
    assert.equal(flushPersistResync(), false, "拿不到 deps 时 flush 也必须是空操作");
    await afterGrace();
    assert.equal(fake.sequences.length, 0);
  } finally { world.restore(); fake.restore(); }
});

/**
 * 【A · 回归】钩子的注册点必须是 `installPersistResync`（init），不能退回
 * `installEffectTriggers`（ready）。只装 ready 那一半时，钩子一个都不该在册。
 */
test("回归：installEffectTriggers 不再注册 sequencerEffectManagerReady（它属于 init 段）", () => {
  const world = stubFoundry({tokens: []});
  try {
    installEffectTriggers(deps());
    assert.equal(world.handlers.sequencerEffectManagerReady, undefined,
      "这个钩子必须由 installPersistResync 在 init 注册，否则每次画布加载都会错过它");
    assert.ok(world.handlers.createActiveEffect?.length, "对照：ready 段的钩子照常在册");
  } finally { world.restore(); }
});

test("resyncPersist：canvas 未就绪时直接跳过，不抛错", async () => {
  const world = stubFoundry({tokens: []});
  globalThis.canvas.ready = false;
  try {
    await assert.doesNotReject(resyncPersist(deps(), ENV));
  } finally { world.restore(); }
});

test("resyncPersist：本地已经在放的（isPlayingPersist 命中）直接跳过", async () => {
  const fake = installFakeSequencer();
  const token = tokenPlaceable({id: "t1", center: {x: 500, y: 500}});
  const effect = activeEffect(token, "burning");
  Object.assign(token, {actor: {effects: [effect]}});
  const world = stubFoundry({tokens: [token]});
  try {
    installEffectTriggers(deps());
    world.markPlaying(effect.uuid, token);        // 伪造"本地已经在播"
    await resyncPersist(deps(), {gridSize: 100});
    await afterGrace();
    assert.equal(fake.sequences.length, 0, "已经在播的状态不该被重新播放一次");
  } finally { world.restore(); fake.restore(); }
});


/* -------------------------------------------- */
/*  B 组：resyncPersist 必须受动画开关约束        */
/* -------------------------------------------- */

/**
 * 【B 组】关掉「启用动画」（或 Crucible 的 enableVFX）之后，切场景 / F5 仍会给全场每个
 * 带状态的 token 补满光环，而且此后只能靠移除状态才消得掉——因为 resync 那条路上
 * 一个 `animationsEnabled()` 都没有。闸现在落在唯一入口 `playPersist` 上。
 *
 * 三条一起测：本模组开关、Crucible 的 enableVFX、以及「开着的时候确实会播」的对照组。
 * 少了对照组，两条 0 断言可以被「把 resync 整个删掉」这种变异蒙混过去。
 */
for (const [label, opts] of [
  ["本模组的「启用动画」关闭", {enabled: false}],
  ["Crucible 的 enableVFX 关闭", {crucibleVFX: false}]
]) {
  test(`resyncPersist：${label}时一份光环都不补`, async () => {
    const fake = installFakeSequencer();
    const world = stubFoundry({tokens: twoLoadedTokens(), ...opts});
    try {
      await resyncPersist(deps(), ENV);
      await afterGrace();
      assert.equal(fake.sequences.length, 0,
        "动画开关关闭时 resync 仍然补满了全场光环——而且此后只能靠移除状态才消得掉");
    } finally { world.restore(); fake.restore(); }
  });
}

test("resyncPersist：对照组——开关都开着时同一批 token 确实会补上光环", async () => {
  const fake = installFakeSequencer();
  const world = stubFoundry({tokens: twoLoadedTokens()});
  try {
    await resyncPersist(deps(), ENV);
    await afterGrace();
    assert.equal(fake.sequences.length, 2,
      "对照组失败：这条路径本身就播不出来，上面两条 0 断言什么都没证明");
  } finally { world.restore(); fake.restore(); }
});

test("createToken / updateActiveEffect：动画开关关闭时同样不播（闸在唯一入口上）", async () => {
  const fake = installFakeSequencer();
  const [t1] = twoLoadedTokens();
  const world = stubFoundry({tokens: [t1], enabled: false});
  try {
    installEffectTriggers(deps());
    world.fire("createToken", {parent: {isView: true}, object: t1});
    world.fire("createActiveEffect", Object.assign(activeEffect(t1), {parent: world.actor}));
    world.fire("updateActiveEffect",
      Object.assign(activeEffect(t1), {parent: world.actor}), {disabled: false});
    await afterGrace();
    assert.equal(fake.sequences.length, 0);
  } finally { world.restore(); fake.restore(); }
});

/* -------------------------------------------- */
/*  E1：让路期/preload 期的幂等                   */
/* -------------------------------------------- */

/**
 * 【E1】`isPlayingPersist` 只查 Sequencer 的 VisibleEffects，而从 playPersist 被调用到
 * 特效真的登记进去之间隔着整个 PERSIST_LEAD_MS 让路期（500ms）加 preload。这段窗口里
 * 它恒为假——T=0 状态落地、T=100ms 一次 resync（切场景 / 拖 token 进场）就会给同一个
 * (effect, token) 再排一份，两圈光环叠在一起。文档承诺的「resync 幂等、随便多调」
 * 在这段窗口内并不成立。修法是在途登记表 `inFlight`。
 */
test("E1：让路期内重复调用 resyncPersist 不会叠出第二份光环", async () => {
  const fake = installFakeSequencer();
  const t = tokenPlaceable({id: "t1", center: {x: 500, y: 500}});
  Object.assign(t, {actor: {effects: [activeEffect(t, "burning")]}});
  const world = stubFoundry({tokens: [t]});
  try {
    await resyncPersist(deps(), ENV);              // T=0，进入 500ms 让路期
    await bounded(sleep(100));
    await resyncPersist(deps(), ENV);              // T=100ms，让路期内又来一次
    await resyncPersist(deps(), ENV);              // 再来一次，压一压
    await afterGrace();
    assert.equal(fake.sequences.length, 1,
      "让路期内的重复 resync 叠出了多份光环——「随便多调」的承诺在这段窗口内不成立");
  } finally { world.restore(); fake.restore(); }
});

test("E1：在途登记必须销账——第一份放弃播放之后，同一份仍然补得回来", async () => {
  const fake = installFakeSequencer();
  const t = tokenPlaceable({id: "t1", center: {x: 500, y: 500}});
  Object.assign(t, {actor: {effects: [activeEffect(t, "burning")]}});
  let alive = false;                               // 第一轮：让路期结束时效果"已被移除"
  const world = stubFoundry({tokens: [t], effectAlive: () => alive});
  try {
    await resyncPersist(deps(), ENV);
    await afterGrace();
    assert.equal(fake.sequences.length, 0, "前提：第一轮因为状态已被移除而放弃播放");

    alive = true;                                  // 状态又回来了
    await resyncPersist(deps(), ENV);
    await afterGrace();
    assert.equal(fake.sequences.length, 1,
      "在途登记没有销账——这一份光环在本次会话里再也补不回来了");
  } finally { world.restore(); fake.restore(); }
});

/**
 * 【E1 修复轮 2】上面那条用例的三次调用**全部**落在 500ms 让路期内，行使不到真正出
 * 问题的那一段：`playPlan()` 对 persist 计划在 `seq.play()` 之后就返回（不 await，
 * play.mjs 的 Critical），而真 Sequencer 的 `Sequence.play()` 还要先 await 初始化、
 * 再 await `Preloader.preload`（冷缓存下拉一段 jb2a webm 是秒级），之后才
 * `section._execute()` → `_playEffect` → `VisibleEffects.add`（sequencer.js:11826）。
 * 让路期结束到那一刻之间，`isPlayingPersist` 仍然恒假。
 *
 * 这个桩把那段延迟显式化：`play()` 之后 N 毫秒才把这一份登记进 `getEffects`。
 *
 * @param {ReturnType<typeof installFakeSequencer>} fake
 * @param {ReturnType<typeof stubFoundry>} world
 * @param {number} ms       play() 之后多久才登记（模拟 preload 耗时）
 * @param {{origin: string, object: object}} entry
 */
function registerAfter(fake, world, ms, entry) {
  const Base = globalThis.Sequence;
  globalThis.Sequence = class extends Base {
    play(opts) {
      const p = super.play(opts);
      setTimeout(() => world.markPlaying(entry.origin, entry.object), ms);
      return p;
    }
  };
  // fake.restore() 会把全局换回真身，这里不需要单独收尾。
}

test("E1：让路期结束、特效尚未登记进 Sequencer 的那段窗口里，第二个入口不会叠出第二份", async () => {
  const fake = installFakeSequencer();
  const t = tokenPlaceable({id: "t1", center: {x: 500, y: 500}});
  Object.assign(t, {actor: {effects: [activeEffect(t, "burning")]}});
  const world = stubFoundry({tokens: [t]});
  // preload 400ms：play() 在 T≈500（让路期满）发出，特效要到 T≈900 才看得见。
  registerAfter(fake, world, 400, {origin: activeEffect(t).uuid, object: t});
  try {
    await resyncPersist(deps(), ENV);                       // T=0
    await afterGrace();                                     // T≈650：已 play()，尚未登记
    assert.equal(fake.sequences.length, 1, "前提：第一份已经交给 Sequencer");
    assert.equal(world.playing.length, 0,
      "前提：这一刻特效还没进 VisibleEffects——正是要测的那段空窗");

    await resyncPersist(deps(), ENV);                       // 空窗里的第二个入口
    await bounded(sleep(PERSIST_LEAD_MS + 500));
    assert.equal(fake.sequences.length, 1,
      "「让路期之后、登记之前」这段空窗里叠出了第二圈光环");
    assert.equal(world.playing.length, 1, "前提：这时候特效确实已经登记进去了");
  } finally { world.restore(); fake.restore(); }
});

test("E1：特效一登记进 Sequencer 就销账，不是死等超时", async () => {
  const fake = installFakeSequencer();
  const t = tokenPlaceable({id: "t1", center: {x: 500, y: 500}});
  Object.assign(t, {actor: {effects: [activeEffect(t, "burning")]}});
  const world = stubFoundry({tokens: [t]});
  registerAfter(fake, world, 100, {origin: activeEffect(t).uuid, object: t});
  try {
    await resyncPersist(deps(), ENV);
    await bounded(sleep(PERSIST_LEAD_MS + 400));            // 登记 + 轮询发现它
    assert.equal(world.playing.length, 1, "前提：这一份已经登记进 Sequencer");

    // 光环没了（tie 清理 / 别人调了 endEffects），但状态本身仍在——下一次 resync 必须
    // 能补回来。如果销账改成「一律等满 PERSIST_VISIBLE_TIMEOUT_MS」，这里就补不回来。
    world.playing.length = 0;
    await resyncPersist(deps(), ENV);
    await afterGrace();
    assert.equal(fake.sequences.length, 2,
      "特效已经可以被观察到之后，在途登记仍然占着——这份光环要白等一个超时才补得回来");
  } finally { world.restore(); fake.restore(); }
});

test("E1：特效始终没登记时，在途登记在有界超时后放行（不许永久泄漏）", async () => {
  // 直接单测 awaitPersistVisible 的「有界」这一半：整合用例只能行使「观察到就提前
  // 放行」，超时那一支要靠注入一个小 timeoutMs 才测得动（默认 15s）。
  const world = stubFoundry({tokens: []});                  // getEffects 恒空
  // 轮询用的是 unref 定时器（见 effects.mjs 的 idleSleep）：它不该成为「进程还有事要
  // 做」的理由，所以这里自己拿一枚 ref 定时器把事件循环撑住，否则 node --test 会在
  // await 还没兑现时就判定无事可做而退出（用例会被 cancel 掉）。
  const keepAlive = setInterval(() => {}, 25);
  try {
    const t0 = Date.now();
    const observed = await awaitPersistVisible("Scene.s.Token.t1.ActiveEffect.burning", null,
                                               {timeoutMs: 250, pollMs: 50});
    const dt = Date.now() - t0;
    assert.equal(observed, false, "从未登记过却报告「已观察到」");
    assert.ok(dt >= 240, `只等了 ${dt}ms 就放行，比给定的超时还短`);
    assert.ok(dt < 1500, `等了 ${dt}ms，超时没有生效（在途登记会一直挂着）`);
  } finally { clearInterval(keepAlive); world.restore(); }
});

/* -------------------------------------------- */
/*  E3：让路期内被停用                            */
/* -------------------------------------------- */

/**
 * 【E3】让路结束后的存活复检从前只看「文档还在不在」。在角色卡效果页上把状态停用
 * （走 update 的 disabled 翻转）时文档仍在：`deleteActiveEffect` 与 tiedDocuments 的
 * delete 钩子都不会触发，`updateActiveEffect` 的 endPersist 又早在我们播出之前就跑过、
 * 扫不到还没存在的特效——照播就留下一枚只能靠**删除**这条效果才清得掉的光环。
 */
test("E3：让路期内被停用（文档还在但 active 翻假）时放弃播放", async () => {
  const fake = installFakeSequencer();
  const t = tokenPlaceable({id: "t1", center: {x: 500, y: 500}});
  Object.assign(t, {actor: {effects: [activeEffect(t, "burning")]}});
  let stillActive = true;
  const world = stubFoundry({tokens: [t], effectActive: () => stillActive});
  try {
    await resyncPersist(deps(), ENV);
    await bounded(sleep(50));
    stillActive = false;                           // 让路期内被停用
    await afterGrace();
    assert.equal(fake.sequences.length, 0,
      "文档还在但已停用仍然播出了——那枚光环只能靠删除这条效果才清得掉");
  } finally { world.restore(); fake.restore(); }
});

test("E3：对照组——让路期内一直生效时照常播出", async () => {
  const fake = installFakeSequencer();
  const t = tokenPlaceable({id: "t1", center: {x: 500, y: 500}});
  Object.assign(t, {actor: {effects: [activeEffect(t, "burning")]}});
  const world = stubFoundry({tokens: [t]});
  try {
    await resyncPersist(deps(), ENV);
    await afterGrace();
    assert.equal(fake.sequences.length, 1);
  } finally { world.restore(); fake.restore(); }
});
