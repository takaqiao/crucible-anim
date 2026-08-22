/**
 * persist 通道的行为契约（Task 14 Critical-2）。
 *
 * 缺陷不是逻辑错误，是对 Sequencer 语义的误解：`EffectSection.run()` 对持久 section 等的
 * 是 `canvasEffectData.promise`（sequencer.js:25008-25013），而那枚 promise 只有
 * `CanvasEffect.endEffect()` 才兑现（15479-15485），`PersistentCanvasEffect` 又把
 * `_setEndTimeout()` 换成了「只暂停媒体、不 resolve」（17801-17808）——于是
 * `await seq.play()` 对任何带 persist cue 的计划**永不返回**，共享串行队列被顶死到
 * 15 秒超时为止。Task 13 的桩 `async play() { return this; }` 无条件立刻兑现，
 * 把这条语义整个抹平，277 条测试一条都抓不到。
 *
 * 本文件驱动的是**真实的** playPlan / runPersistAnimation / semaphore，桩只补上
 * 「持久序列的 play() 悬着」这一条真语义（tools/fake-sequencer.mjs 的 sectionBlocks）。
 * 那条桩语义本身由 test/sequencer-contract.test.mjs 钉在 Sequencer 源码上。
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

import {installFakeSequencer} from "../tools/fake-sequencer.mjs";
import {tokenPlaceable, tokenDoc} from "../tools/token-mocks.mjs";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import {resolve, resolveEffect} from "../scripts/resolver/resolve.mjs";
import {playPlan} from "../scripts/player/play.mjs";
import {createSemaphore} from "../scripts/player/semaphore.mjs";
import {buildPlanFor} from "../scripts/trigger/wrap.mjs";
import {queueDepth, runAnimation, runPersistAnimation} from "../scripts/trigger/dispatch.mjs";
import {installEffectTriggers, planForEffect, resetPersistInFlight}
  from "../scripts/trigger/effects.mjs";
import {PERSIST_LEAD_MS} from "../scripts/const.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const actions = JSON.parse(readFileSync(join(ROOT, "test/fixtures/actions.json"), "utf8"));
const effects = JSON.parse(readFileSync(join(ROOT, "test/fixtures/effects.json"), "utf8"));
const ENV = {gridSize: 100, distancePixels: 100};
const deps = () => ({assets: createAssets(offlineBackend(index)), armory: ARMORY});

const sleep = ms => new Promise(r => setTimeout(r, ms));
/**
 * 被测 promise 在缺陷仍在时**永不兑现**，裸 await 会挂死整个文件、后面的用例连跑都跑不到。
 * 包一层上限，让缺陷表现为一条干净的断言失败。
 */
const bounded = (p, ms = 2000) => Promise.race([p, sleep(ms)]);
/** 不 await 地观察一个 promise 有没有 settle。 */
const settledYet = p => { let done = false; p.then(() => { done = true; }, () => { done = true; }); return () => done; };

const resolveRef = at => {
  if (!at) return null;
  if (at.ref === "point") return Number.isFinite(at.x) ? {x: at.x, y: at.y} : null;
  if (at.tokenId) {
    return {document: {uuid: at.uuid ?? `Scene.s.Token.${at.tokenId}`}, id: at.tokenId,
            center: {x: at.x, y: at.y}, w: 100, h: 100};
  }
  return Number.isFinite(at.x) ? {x: at.x, y: at.y} : null;
};

const persistPlan = (statusId = "burning") =>
  planForEffect({uuid: `Scene.s.Token.t1.ActiveEffect.${statusId}`,
                 statuses: new Set([statusId]), id: statusId},
                tokenPlaceable({id: "t1", center: {x: 500, y: 500}}), ENV, deps());

function actionPlan() {
  const targetActor = {id: "a1"};
  const plan = buildPlanFor({
    id: "reactiveStrike", name: "反击", tags: new Set(["strike", "melee", "slashing"]),
    target: {type: "single", number: 1, distance: 1, scope: 2},
    range: {minimum: 0, maximum: 1}, cost: {action: 1, focus: 0, heroism: 0, health: 0},
    region: null, actor: {type: "hero"},
    token: tokenDoc({id: "t0", center: {x: 500, y: 500}}),
    targets: new Map([[targetActor, {token: tokenDoc({id: "t1", center: {x: 600, y: 500}})}]]),
    usage: {damageType: "slashing", isAttack: true, isRanged: false,
            strikes: [{category: "balanced1", system: {damageType: "slashing"}}]},
    eventsByTarget: new Map([[targetActor,
      {all: [], roll: [{roll: {data: {result: 7, strike: 0}, isCriticalSuccess: false}}]}]])
  }, ENV, deps(), {nativeConfig: null});
  assert.ok(plan, "动作计划的前置条件坏了");
  return plan;
}

const play = plan => playPlan(plan, {volume: 1, shake: false, resolveRef});

/* -------------------------------------------- */
/*  playPlan 的返回契约（正反两向）              */
/* -------------------------------------------- */

test("persist 计划：playPlan() 在序列交给 Sequencer 之后就返回，不等特效结束", async () => {
  const fake = installFakeSequencer();
  try {
    const done = settledYet(play(persistPlan()));
    await sleep(20);
    // 自检：桩若没模拟出「持久序列的 play() 悬着」，这条用例什么也没测。
    assert.equal(fake.unsettled.length, 1, "桩没有模拟出「持久序列的 play() 悬着」");
    assert.ok(done(), "playPlan() 对 persist 计划 await 到了序列结束——那个时刻永远不会来");
  } finally { fake.restore(); }
});

test("普通计划：playPlan() 仍然等到序列真正播完才返回", async () => {
  // holdPlay 让**每条** play() 都悬着——否则一个「永远不 await」的实现照样全绿。
  const fake = installFakeSequencer({holdPlay: true});
  try {
    const done = settledYet(play(actionPlan()));
    await sleep(20);
    assert.equal(done(), false, "动作计划必须等到序列播完");
    fake.finishAll();
    await sleep(5);
    assert.ok(done(), "序列播完之后 playPlan() 必须返回");
  } finally { fake.restore(); }
});

/* -------------------------------------------- */
/*  语料不变式：提前返回那条过近似判据的依据      */
/* -------------------------------------------- */

test("语料不变式：动作计划 0 条 persist cue，状态计划 100% persist cue", () => {
  const mk = () => ({assets: createAssets(offlineBackend(index)), armory: ARMORY});
  let actionPersist = 0, actionPlans = 0;
  for (const s of actions) {
    const p = resolve(s, mk());
    if (!p) continue;
    actionPlans++;
    actionPersist += p.cues.filter(c => c.persist === true).length;
  }
  let effectPlans = 0, allPersist = true;
  for (const e of effects) {
    const p = resolveEffect(e, mk());
    if (!p) continue;
    effectPlans++;
    if (!p.cues.every(c => c.persist === true)) allPersist = false;
  }
  assert.ok(actionPlans > 400, `动作计划只有 ${actionPlans} 条，语料可疑`);
  assert.equal(actionPersist, 0,
    "动作计划里出现了 persist cue：playPlan 的提前返回会让那条动作动画不再被等待");
  assert.ok(effectPlans > 40, `状态计划只有 ${effectPlans} 条，语料可疑`);
  assert.ok(allPersist, "状态计划里出现了非 persist cue");
});

/* -------------------------------------------- */
/*  队列：persist 不顶死、不占深度、给动作让路    */
/* -------------------------------------------- */

test("persist 不再顶死共享队列：紧随其后的动作动画几毫秒内就开播", async () => {
  const fake = installFakeSequencer();
  try {
    assert.equal(queueDepth(), 0, "上一条用例没排空队列，本条的读数不可信");
    runPersistAnimation("persist", () => play(persistPlan()));   // 不 await
    const t0 = Date.now();
    let started = null;
    await bounded(runAnimation("action", async () => { started = Date.now() - t0; }));
    assert.notEqual(started, null, "动作动画根本没被放行（队列被 persist 顶死）");
    assert.ok(started < 300, `动作动画等了 ${started}ms 才开播；修复前是 15000ms 的信号量超时`);
  } finally { fake.restore(); }
});

test("让路期间 persist 不占队列深度，多个状态的光环同时播出", async () => {
  const fake = installFakeSequencer();
  try {
    assert.equal(queueDepth(), 0);
    let depthDuringAction = null;
    runPersistAnimation("p1", () => play(persistPlan("burning")));
    runPersistAnimation("p2", () => play(persistPlan("chilled")));
    await bounded(runAnimation("action", async () => {
      await sleep(10);
      depthDuringAction = queueDepth();
    }));
    assert.equal(depthDuringAction, 1,
      "让路中的 persist 占用了队列深度——它必须只观察队列，不排进去");
    await bounded(sleep(60));
    assert.equal(fake.sequences.length, 2,
      "两圈光环必须同时播出；串行化会让第二圈等第一圈结束，也就是永远不出现");
    assert.equal(queueDepth(), 0);
  } finally { fake.restore(); }
});

test("顺序倒置：状态先触发，画面上仍然是先挥剑后光环", async () => {
  const fake = installFakeSequencer();
  const order = [];
  try {
    assert.equal(queueDepth(), 0);
    // Crucible 先创建 ActiveEffect、后翻 confirmed，所以状态的触发**早于**动作。
    const persist = runPersistAnimation("persist", async () => {
      order.push("光环"); await play(persistPlan());
    });
    await sleep(5);
    await bounded(runAnimation("action", async () => { order.push("挥剑"); await sleep(20); }));
    await bounded(persist);
    assert.deepEqual(order, ["挥剑", "光环"],
      "光环抢在挥剑前面——两段让路（whenBusy → whenIdle）没有生效");
  } finally { fake.restore(); }
});

test("没有动作动画时，persist 只等一个宽限期就自己播出", async () => {
  const fake = installFakeSequencer();
  try {
    assert.equal(queueDepth(), 0);
    const t0 = Date.now();
    await bounded(runPersistAnimation("persist", () => play(persistPlan())), 3000);
    const waited = Date.now() - t0;
    assert.ok(waited >= PERSIST_LEAD_MS * 0.8,
      `只等了 ${waited}ms，宽限期形同虚设（GM 手搓状态时无所谓，但同一条路径也服务于正常出手）`);
    assert.ok(waited < PERSIST_LEAD_MS * 3,
      `等了 ${waited}ms；宽限期是上限不是下限，等不到动作动画就该直接播`);
    assert.equal(fake.sequences.length, 1, "宽限期过后必须真的播出");
  } finally { fake.restore(); }
});

/* -------------------------------------------- */
/*  两个新原语本身                                */
/* -------------------------------------------- */

test("whenIdle 等队列排空，但自己不占队列", async () => {
  const s = createSemaphore({timeoutMs: 1000});
  let released = false;
  s.run(async () => { await sleep(40); });
  const idle = s.whenIdle().then(v => { released = true; return v; });
  assert.equal(s.pending, 1, "whenIdle 递增了 pending——它必须只观察，不排队");
  assert.equal(released, false);
  assert.equal(await bounded(idle), true);
  assert.equal(s.pending, 0);
});

test("whenIdle 只等此刻排在队里的，不等后来者", async () => {
  const s = createSemaphore({timeoutMs: 1000});
  s.run(async () => { await sleep(20); });
  const idle = s.whenIdle();
  s.run(async () => { await sleep(400); });          // 后来者，不该被等
  const t0 = Date.now();
  assert.equal(await bounded(idle), true);
  const waited = Date.now() - t0;
  assert.ok(waited < 150, `等了 ${waited}ms——被后来的任务拖住了，一条持续被喂任务的队列会让它永远排不上`);
});

test("whenIdle 超时兑现 false 而不是无限等", async () => {
  const s = createSemaphore({timeoutMs: 1000});
  s.run(async () => { await sleep(300); });
  assert.equal(await bounded(s.whenIdle({timeoutMs: 30})), false);
});

test("whenBusy：已有任务时立刻兑现 true，空队列等满宽限期兑现 false", async () => {
  const s = createSemaphore({timeoutMs: 1000});
  s.run(async () => { await sleep(30); });
  const t0 = Date.now();
  assert.equal(await bounded(s.whenBusy({timeoutMs: 200})), true,
    "pending > 0 的快路径缺失：状态在动作动画已经入队之后才到时会白等满一个宽限期");
  assert.ok(Date.now() - t0 < 20);
  await bounded(s.whenIdle());

  const t1 = Date.now();
  assert.equal(await bounded(s.whenBusy({timeoutMs: 60})), false);
  assert.ok(Date.now() - t1 >= 50);
});

test("whenBusy 在任务入队的那一刻兑现，且不留活定时器吊住事件循环", async () => {
  const s = createSemaphore({timeoutMs: 1000});
  const busy = s.whenBusy({timeoutMs: 5000});        // 远大于用例本身，不清就会吊住进程
  await sleep(10);
  s.run(async () => {});
  assert.equal(await bounded(busy), true);
});

/* -------------------------------------------- */
/*  接线：createActiveEffect → persist 专用通道   */
/* -------------------------------------------- */

/** 最小 Foundry 桩：只装 installEffectTriggers 那条路径真正会碰的全局。 */
function stubFoundry({tokens, effectAlive = () => true}) {
  // 见 trigger/effects.mjs 的 resetPersistInFlight：在途登记要挂到「特效可被观察到 /
  // 有界超时」为止，而本文件两条用例用的是同一个 (uuid, tokenId)——不清零，第二条会被
  // 第一条留下的登记挡住，于是「状态已被移除时不播」变成一条什么都没验证的假绿。
  resetPersistInFlight();
  const prev = {
    Hooks: globalThis.Hooks, Actor: globalThis.Actor, game: globalThis.game,
    canvas: globalThis.canvas, fromUuidSync: globalThis.fromUuidSync,
    Sequencer: globalThis.Sequencer
  };
  const handlers = {};
  globalThis.Hooks = {on: (n, fn) => { (handlers[n] ??= []).push(fn); }};
  globalThis.Actor = class FakeActor {};
  globalThis.game = {settings: {get: (ns, key) => (key === "debug" ? false : true)}};
  globalThis.canvas = {dimensions: {size: 100}, ready: true};
  // 两种 uuid 都会经过这里：ActiveEffect 的（存活闸）与 TokenDocument 的
  // （resolveRefIn 靠 `fromUuidSync(uuid)?.object` 拿 placeable，拿不到就退化成裸坐标，
  // 而带 attachTo 的 persist cue 在裸坐标上会被 play.mjs 整条丢掉——那会让本用例
  // 因为一个与被测行为无关的原因「通过」）。
  // ActiveEffect 侧带上 `active`：让路期结束后的存活复检是「还在**且仍然生效**」
  // （effects.mjs 的 E3 修复）。
  globalThis.fromUuidSync = uuid => (uuid.includes("ActiveEffect")
    ? (effectAlive(uuid) ? {uuid, active: true} : null)
    : {uuid, object: tokens[0]});
  globalThis.Sequencer = {EffectManager: {endEffects: async () => {}}};
  const actor = Object.assign(new globalThis.Actor(), {getActiveTokens: () => tokens});
  return {
    handlers, actor,
    fire: (name, ...args) => { for (const fn of handlers[name] ?? []) fn(...args); },
    restore: () => { for (const [k, v] of Object.entries(prev)) globalThis[k] = v; }
  };
}

test("接线：createActiveEffect 走 persist 通道——先让路，动作动画播完才出光环", async () => {
  const fake = installFakeSequencer();
  const world = stubFoundry({tokens: [tokenPlaceable({id: "t1", center: {x: 500, y: 500}})]});
  try {
    assert.equal(queueDepth(), 0);
    installEffectTriggers(deps());
    const effect = {uuid: "Scene.s.Token.t1.ActiveEffect.burning",
                    statuses: new Set(["burning"]), id: "burning", parent: world.actor};
    world.fire("createActiveEffect", effect);        // t=0，早于动作动画
    await sleep(15);
    assert.equal(fake.sequences.length, 0, "光环抢在动作动画之前播出了");

    let actionDone = false;
    await bounded(runAnimation("action", async () => { await sleep(25); actionDone = true; }));
    assert.ok(actionDone);
    await bounded(sleep(60));
    assert.equal(fake.sequences.length, 1, "动作动画播完之后光环必须出现");
    assert.equal(fake.unsettled.length, 1, "持久序列应当仍悬着（状态还在）");
    assert.equal(queueDepth(), 0, "persist 通道不许在队列里留下任何东西");
  } finally { world.restore(); fake.restore(); }
});

test("存活闸：让路期间状态被移除时放弃播放，不留一枚清不掉的光", async () => {
  const fake = installFakeSequencer();
  // fromUuidSync 恒 null = 让路结束时那条 ActiveEffect 已经没了。
  // 此时若照播：Sequencer 的 tie 钩子注册不上（sequencer.js:16932-16943 的
  // `if (tiedDocument)`），而 deleteActiveEffect 的 origin 兜底早已跑过——永久残留。
  const world = stubFoundry({tokens: [tokenPlaceable({id: "t1", center: {x: 500, y: 500}})],
                             effectAlive: () => false});
  try {
    installEffectTriggers(deps());
    world.fire("createActiveEffect", {uuid: "Scene.s.Token.t1.ActiveEffect.burning",
                                      statuses: new Set(["burning"]), id: "burning",
                                      parent: world.actor});
    await bounded(sleep(PERSIST_LEAD_MS + 150), 3000);
    assert.equal(fake.sequences.length, 0,
      "状态已被移除仍然播出了持久特效——两条清理链路此刻都失效，那枚光永远清不掉");
  } finally { world.restore(); fake.restore(); }
});
