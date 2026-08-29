/**
 * S7 persistOff：状态**摘下**那一刻的一次性提示音（批次 E · 规格 §4.2 闸 d）。
 *
 * 被修的缺口是结构性的：改造前 `trigger/effects.mjs` 的 `endPersist()` 整个函数体只有
 * 一句 `Sequencer.EffectManager.endEffects({origin}, false)`——不调 `snapshotEffect`、
 * 不调 `resolveEffect`、不构造 plan。「状态没了」这件事在本模组里**没有发声的位置**。
 *
 * 本文件骨架照抄 test/effects-death.test.mjs（那是同构的另一个一次性槽），两段：
 *   §1 规则层——三档摘下音的产出形状，以及 `dead` 仍然静默这条硬约束；
 *   §2 触发层——**只有** deleteActiveEffect 会放这一声；resync / createToken /
 *      updateActiveEffect 的停用分支一律不放。
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
import {NO_PERSIST} from "../scripts/armory/persist.mjs";
import persistOff, {OFF_SOUND, BOON_GROUPS, PERSIST_OFF_MAX_MS}
  from "../scripts/armory/persist-off.mjs";
import {SFX} from "../scripts/armory/sound-table.mjs";
import {resolveEffect} from "../scripts/resolver/resolve.mjs";
import {installEffectTriggers, resyncPersist, resetPersistInFlight, resetGroupSoundClaims}
  from "../scripts/trigger/effects.mjs";
import {PERSIST_LEAD_MS} from "../scripts/const.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const effects = JSON.parse(readFileSync(join(ROOT, "test/fixtures/effects.json"), "utf8"));
const ENV = {gridSize: 100};
const deps = () => ({assets: createAssets(offlineBackend(index)), armory: ARMORY});
const mk = () => createAssets(offlineBackend(index));

const sleep = ms => new Promise(r => setTimeout(r, ms));
const bounded = (p, ms = 3000) => Promise.race([p, sleep(ms)]);
/**
 * 摘下音**不让路**（armory/persist-off.mjs 的文件头：它对应的画面是同一帧被 endPersist
 * 收掉的那圈光环，等 500ms 再响就与画面无关了）。所以这里等的是几十毫秒，而不是
 * effects-death.test.mjs 那样的一整个 PERSIST_LEAD_MS。
 * 「不让路」这件事本身由下面一条专门的用例守着。
 */
const settle = () => bounded(sleep(60));

const offPlan = statusId => resolveEffect(effects.find(e => e.statusId === statusId),
                                          {assets: mk(), armory: ARMORY}, "persistOff");

/* -------------------------------------------- */
/*  §1 规则层                                     */
/* -------------------------------------------- */

test("persistOff 槽：负面状态摘下解析出一条一次性提示音", () => {
  const plan = offPlan("poisoned");
  assert.ok(plan, "状态摘下却一声不响——这条链断了就等于回到「光环无声消失」");
  assert.equal(plan.cues.length, 1);
  const [cue] = plan.cues;
  assert.equal(cue.kind, "sound");
  assert.equal(cue.slot, "persistOff");
  assert.equal(cue.rule, "statusOff.clear");
  assert.equal(cue.soundRole, "statusOff");
  // 与 death 槽同一条硬约束：一次性通道，不进 persist 的生命周期——没有 persist、
  // 没有 tieTo，因此不需要 endEffect，也永远不会被 Sequencer 落盘。
  assert.equal(cue.persist, false, "摘下音不得是持久特效（它没有「结束」语义）");
  assert.equal(cue.tieTo, null);
  assert.deepEqual(plan.warnings, []);
});

test("persistOff 槽：46 个状态里除 dead 之外条条有声，且全部 persist:false / tieTo:null", () => {
  const silent = [], stuck = [];
  for (const e of effects) {
    const plan = offPlan(e.statusId);
    if (NO_PERSIST.includes(e.statusId)) {
      assert.equal(plan, null, `${e.statusId} 刻意静默，却产出了摘下音`);
      continue;
    }
    if (!plan?.cues?.length) { silent.push(e.statusId); continue; }
    for (const c of plan.cues) {
      if (c.kind !== "sound" || c.persist !== false || c.tieTo !== null) {
        stuck.push(`${e.statusId}/${c.rule}: kind=${c.kind} persist=${c.persist} tieTo=${c.tieTo}`);
      }
    }
  }
  assert.deepEqual(silent, [], `${silent.length} 个状态摘下时没有声音`);
  assert.deepEqual(stuck, [], `${stuck.length} 条摘下 cue 的形状不对`);
});

test("persistOff 槽：三档分得开，增益走「消散」、其余走「解除」、burning 走「扑灭」", () => {
  // 判据取**播出去的 file**（不只是规则 id）：规则分了三条而素材撞车，玩家一样分不出。
  const ruleOf = id => offPlan(id).cues[0].rule;
  const fileOf = id => offPlan(id).cues[0].file;
  assert.equal(ruleOf("burning"), "statusOff.extinguish");
  assert.equal(ruleOf("hastened"), "statusOff.dispel", "加速是增益，摘下该读作「没了，可惜」");
  assert.equal(ruleOf("poisoned"), "statusOff.clear", "中毒是负面，摘下该读作「解掉了，好」");
  assert.notEqual(fileOf("burning"), fileOf("poisoned"));
  assert.notEqual(fileOf("hastened"), fileOf("poisoned"));
  assert.notEqual(fileOf("burning"), fileOf("hastened"));
  // BOON_GROUPS 是这条正负分野的唯一落点，钉住它免得将来悄悄挪一个组过去。
  assert.deepEqual([...BOON_GROUPS].sort(), ["buff", "haste", "hidden"]);
});

test("persistOff 槽：整池随机，不是「一条路径永远播同一个文件」", () => {
  // ggg-sfx 全库是并列编号子枝，`assets.resolve` 对分支只取第一个叶子——写
  // `ctx.sound(分支路径)` 一样有声、一样过既有守卫，只是永远播同一个文件。
  // 整池由 sound-table 的 POOL 展开、`ctx.soundFrom` 摇（armory/persist-off.mjs 的
  // pickSound）。这条断言证明那条路真的走通了。
  const thin = [];
  const base = effects.find(e => e.statusId === "poisoned");
  for (const [key, cfg] of Object.entries(OFF_SOUND)) {
    const rule = persistOff.find(r => r.id === `statusOff.${key}`);
    const seen = new Set();
    for (let seed = 0; seed < 200; seed++) {
      const plan = resolveEffect({...base, seed},
        {assets: mk(), armory: {persistOff: [{...rule, when: () => true}]}}, "persistOff");
      if (plan) seen.add(plan.cues[0].file);
    }
    if (seen.size < 2) thin.push(`${key}（${cfg.path}）只摇得出 ${seen.size} 个文件`);
  }
  assert.deepEqual(thin, [], thin.join("\n"));
});

test("persistOff 槽：每条摘下音都短于 PERSIST_OFF_MAX_MS", () => {
  // 判据与状态层那条 <1500 同源、阈值不同：摘下发生在一段效果结束时，后面通常没有
  // 紧跟的动作，可以放宽到 2200；逐条包络实测写在 OFF_SOUND 表下。
  // ⚠ 判据回 SFX 表重算，不读兵库里那个 capMs：读了就是「表等于表」。
  const bad = [];
  for (const e of effects) {
    for (const c of offPlan(e.statusId)?.cues ?? []) {
      const eff = SFX[c.file]?.[2];
      assert.ok(typeof eff === "number", `${c.file} 不在 SFX 表里（npm run sounds 没跑？）`);
      const heard = Math.min(c.duration ?? Infinity, eff);
      if (heard > PERSIST_OFF_MAX_MS) bad.push(`${e.statusId}/${c.rule}: ${heard}ms`);
    }
  }
  assert.deepEqual([...new Set(bad)], [], `${bad.length} 条摘下音太长`);
});

test("persist-off.mjs 里不许出现 persist: true", () => {
  // 结构守卫，与 test/effects-death.test.mjs 的「动作四槽不得再出现按死没死判断的规则」
  // 同一手法：剥掉注释再查，免得把说明文字里的引用也算进来。
  const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map(l => (l.indexOf("//") === -1 ? l : l.slice(0, l.indexOf("//")))).join("\n");
  const src = strip(readFileSync(join(ROOT, "scripts/armory/persist-off.mjs"), "utf8"));
  assert.ok(!/persist\s*:\s*true/.test(src),
    "本槽的 cue 没有「结束」语义：一条 persist:true 且无 tieTo 的 cue 会永久残留");
});

/* -------------------------------------------- */
/*  §2 触发层                                     */
/* -------------------------------------------- */

/** 最小 Foundry 桩。与 test/effects-death.test.mjs 的同名函数同构。 */
function stubFoundry({tokens, enabled = true} = {}) {
  resetPersistInFlight();
  resetGroupSoundClaims();
  const prev = {
    Hooks: globalThis.Hooks, Actor: globalThis.Actor, game: globalThis.game,
    canvas: globalThis.canvas, fromUuidSync: globalThis.fromUuidSync,
    Sequencer: globalThis.Sequencer
  };
  const handlers = {};
  globalThis.Hooks = {on: (n, fn) => { (handlers[n] ??= []).push(fn); }};
  globalThis.Actor = class FakeActor {};
  globalThis.game = {settings: {get: (ns, key) => {
    if (ns === "crucible") return true;
    if (key === "enabled") return enabled;
    return key !== "debug";
  }}};
  globalThis.canvas = {dimensions: {size: 100}, ready: true, tokens: {placeables: tokens ?? []}};
  globalThis.fromUuidSync = uuid => (uuid.includes("ActiveEffect")
    ? {uuid, active: true}
    : {uuid, object: (tokens ?? [])[0]});
  globalThis.Sequencer = {EffectManager: {endEffects: async () => {}, getEffects: () => []}};
  const actor = Object.assign(new globalThis.Actor(), {getActiveTokens: () => tokens ?? []});
  return {
    handlers, actor,
    fire: (name, ...args) => { for (const fn of handlers[name] ?? []) fn(...args); },
    restore: () => { for (const [k, v] of Object.entries(prev)) globalThis[k] = v; }
  };
}

const activeEffect = (token, statusId) => ({
  uuid: `Scene.s.Token.${token.id}.ActiveEffect.${statusId}`,
  statuses: new Set([statusId]), id: statusId, active: true
});

/** 一个身上挂着 poisoned 的 token；`resyncPersist` / `createToken` 两条路要遍历它。 */
function poisonedToken() {
  const t = tokenPlaceable({id: "t1", center: {x: 500, y: 500}});
  Object.assign(t, {actor: {effects: [activeEffect(t, "poisoned")]}});
  return t;
}

const soundCount = fake => fake.records.filter(r => r.kind === "sound").length;
const artCount = fake => fake.records.filter(r => r.kind === "effect").length;

test("deleteActiveEffect：状态被移除时放一声摘下音", async () => {
  const fake = installFakeSequencer();
  const t = poisonedToken();
  const world = stubFoundry({tokens: [t]});
  try {
    installEffectTriggers(deps());
    world.fire("deleteActiveEffect",
               Object.assign(activeEffect(t, "poisoned"), {parent: world.actor}));
    await settle();
    assert.equal(soundCount(fake), 1, "状态摘下却一声不响");
    assert.equal(artCount(fake), 0, "摘下槽只出声音，不该有画面 cue");
  } finally { world.restore(); fake.restore(); }
});

test("deleteActiveEffect：摘下音**不让路**，几十毫秒内就响", async () => {
  // 这是它与 death 槽唯一的实质差别。死亡爆发要等 PERSIST_LEAD_MS，因为它比造成它的
  // 那一击更早到达；摘下音对应的画面（光环消失）是 endPersist 在同一帧做掉的，
  // 让路 500ms 再响就与画面无关了。
  const fake = installFakeSequencer();
  const t = poisonedToken();
  const world = stubFoundry({tokens: [t]});
  try {
    installEffectTriggers(deps());
    world.fire("deleteActiveEffect",
               Object.assign(activeEffect(t, "poisoned"), {parent: world.actor}));
    await bounded(sleep(40));
    assert.equal(soundCount(fake), 1,
      `40ms 内还没响 —— 摘下音被接到了让路通道上（那要等 ${PERSIST_LEAD_MS}ms）`);
  } finally { world.restore(); fake.restore(); }
});

/**
 * 【硬约束】一次性提示音绝不能被「补齐稳态」的入口触发。
 * 对照组是同一个 token 身上的 poisoned 光环——它**必须**被补上，否则这条 0 断言
 * 可以被「把 resync 整个删掉」蒙混过去。
 */
test("resyncPersist：切场景/重载不会把全场状态摘一遍（光环照常补齐）", async () => {
  const fake = installFakeSequencer();
  const t = poisonedToken();
  const world = stubFoundry({tokens: [t]});
  try {
    await resyncPersist(deps(), ENV);
    await bounded(sleep(PERSIST_LEAD_MS + 150), 3000);
    assert.equal(soundCount(fake), 0, "每切一次场景就把全场状态摘一遍");
    assert.equal(artCount(fake), 1, "对照组：poisoned 的光环必须补上");
  } finally { world.restore(); fake.restore(); }
});

test("createToken：把带状态的 token 拖进场景不会放摘下音", async () => {
  const fake = installFakeSequencer();
  const t = poisonedToken();
  const world = stubFoundry({tokens: [t]});
  try {
    installEffectTriggers(deps());
    world.fire("createToken", {parent: {isView: true}, object: t});
    await bounded(sleep(PERSIST_LEAD_MS + 150), 3000);
    assert.equal(soundCount(fake), 0, "每拖一次 token 进场就摘一遍");
    assert.equal(artCount(fake), 1, "对照组：光环必须补上");
  } finally { world.restore(); fake.restore(); }
});

test("updateActiveEffect 停用分支不放摘下音：那是「暂停」不是「摘下」", async () => {
  const fake = installFakeSequencer();
  const t = poisonedToken();
  const world = stubFoundry({tokens: [t]});
  try {
    installEffectTriggers(deps());
    const effect = {...activeEffect(t, "poisoned"), parent: world.actor, active: false};
    world.fire("updateActiveEffect", effect, {disabled: true});
    await settle();
    assert.equal(soundCount(fake), 0,
      "在角色卡上把一条效果停用，效果本身还挂在角色身上、随时能翻回来——那不是摘下");
  } finally { world.restore(); fake.restore(); }
});

test("dead 被移除（复活 / GM 撤销那一击）时静默", async () => {
  // 规格 §4.2 闸 c 的另一端：STATUS_GROUP 把 dead 归在 stun 组，本槽若只照抄那张表，
  // 每一次复活都会播一声「负面状态解除」。
  const fake = installFakeSequencer();
  const t = poisonedToken();
  const world = stubFoundry({tokens: [t]});
  try {
    installEffectTriggers(deps());
    world.fire("deleteActiveEffect",
               Object.assign(activeEffect(t, "dead"), {parent: world.actor}));
    await settle();
    assert.equal(soundCount(fake), 0, "复活播了一声「解除」");
  } finally { world.restore(); fake.restore(); }
});

test("动画开关关闭时不放摘下音", async () => {
  const fake = installFakeSequencer();
  const t = poisonedToken();
  const world = stubFoundry({tokens: [t], enabled: false});
  try {
    installEffectTriggers(deps());
    world.fire("deleteActiveEffect",
               Object.assign(activeEffect(t, "poisoned"), {parent: world.actor}));
    await settle();
    assert.equal(fake.sequences.length, 0);
  } finally { world.restore(); fake.restore(); }
});

test("AoE 一次解除 5 个人的中毒，只响一声", async () => {
  const fake = installFakeSequencer();
  const tokens = [1, 2, 3, 4, 5].map(i =>
    tokenPlaceable({id: `off${i}`, center: {x: 300 + i * 100, y: 500}}));
  const world = stubFoundry({tokens});
  try {
    installEffectTriggers(deps());
    for (const t of tokens) {
      const actor = Object.assign(new globalThis.Actor(), {getActiveTokens: () => [t]});
      world.fire("deleteActiveEffect", {
        uuid: `Scene.s.Token.${t.id}.ActiveEffect.poisoned`,
        statuses: new Set(["poisoned"]), id: "poisoned", parent: actor
      });
    }
    await settle();
    assert.equal(soundCount(fake), 1, "同一条 ogg 叠了 5 层");
  } finally { world.restore(); fake.restore(); }
});
