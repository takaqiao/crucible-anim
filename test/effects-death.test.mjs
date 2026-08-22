/**
 * Task 15b：击杀爆发的独立一次性通道。
 *
 * 被修的缺陷：`aftermath.kill` 的判据是建卡时刻快照里的 `target.effects.includes("dead")`，
 * 而 `dead` 是 Crucible 在**资源结算之后**单独 `toggleStatusEffect("dead", …)` 打上的
 * （documents/actor.mjs:2926），且 `configureVFXEffect()` 跑在 `_prepareMessage()`
 * （models/action.mjs:3286）——比 `confirm()` 的 `#applyEvents()`（:2671）早得多。那条
 * 规则在实战中一次都不会命中，击杀时刻完全没有专属画面。
 *
 * 修法是事件驱动：`dead` 本身就是一枚真实的 ActiveEffect，落地时触发 `createActiveEffect`，
 * 由 armory/death.mjs 的 `death.kill` 出一次性爆发，「什么算死」交给 Crucible 自己判。
 *
 * 本文件两段：
 *   §1 规则层——death 槽的产出形状，以及 `dead` 仍然不产持久光环这条硬约束；
 *   §2 触发层——**只有** createActiveEffect 会放这枚爆发；resyncPersist / createToken
 *      一律不放（否则每次切场景、每具尸体都重放一遍）。
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
import {resolveEffect} from "../scripts/resolver/resolve.mjs";
import {installEffectTriggers, resyncPersist, resetPersistInFlight}
  from "../scripts/trigger/effects.mjs";
import {PERSIST_LEAD_MS} from "../scripts/const.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const effects = JSON.parse(readFileSync(join(ROOT, "test/fixtures/effects.json"), "utf8"));
const ENV = {gridSize: 100};
const deps = () => ({assets: createAssets(offlineBackend(index)), armory: ARMORY});

const sleep = ms => new Promise(r => setTimeout(r, ms));
const bounded = (p, ms = 3000) => Promise.race([p, sleep(ms)]);
/** 与 effects-resync.test.mjs 同理：两条通道都先等满一个让路期才播出。 */
const afterGrace = () => bounded(sleep(PERSIST_LEAD_MS + 150));

/** 血泊素材——两段都用它认出「这一份是击杀爆发」。 */
const BLOOD = "Blood_1_Splatter_1";

/* -------------------------------------------- */
/*  §1 规则层                                     */
/* -------------------------------------------- */

const deadSnapshot = () => effects.find(e => e.statusId === "dead");

test("death 槽：dead 状态解析出一条一次性血泊 cue", () => {
  const plan = resolveEffect(deadSnapshot(), {assets: createAssets(offlineBackend(index)),
                                              armory: ARMORY}, "death");
  assert.ok(plan, "dead 落地却没有击杀爆发——这条链断了就等于回到修复前");
  assert.equal(plan.cues.length, 1);
  const [cue] = plan.cues;
  assert.equal(cue.rule, "death.kill");
  assert.equal(cue.slot, "death");
  assert.match(cue.file, new RegExp(BLOOD));
  // 硬约束 3：一次性通道，不进 persist 的生命周期——没有 persist、没有 tieTo，
  // 因此不需要 endEffect，也永远不会被 Sequencer 落盘。
  assert.equal(cue.persist, false, "击杀爆发不得是持久特效（它没有「结束」语义）");
  assert.equal(cue.tieTo, null);
  assert.equal(cue.belowTokens, true, "血泊是地面层，应压在 token 之下");
  assert.deepEqual(plan.warnings, []);
});

test("death 槽：除 dead 之外的 45 个状态一条都不出击杀爆发", () => {
  const wrong = [];
  for (const e of effects) {
    if (e.statusId === "dead") continue;
    const plan = resolveEffect(e, {assets: createAssets(offlineBackend(index)), armory: ARMORY},
                               "death");
    if (plan) wrong.push(e.statusId);
  }
  assert.deepEqual(wrong, [], `${wrong.length} 个状态误触发了击杀爆发`);
});

test("dead 仍然留在 NO_PERSIST：不产持久光环，只走一次性通道", () => {
  // 硬约束 3 的另一半。Foundry 自带 dead overlay，再画一圈光环是重复；而且持久光环
  // 会被 resync 补播，正是这条通道要避免的。
  assert.ok(NO_PERSIST.includes("dead"));
  const persistPlan = resolveEffect(deadSnapshot(), {assets: createAssets(offlineBackend(index)),
                                                     armory: ARMORY});
  assert.equal(persistPlan, null, "dead 又产出了持久光环——它会被每次 resync 补播");
});

test("动作四槽里不得再出现按「目标死没死」判断的规则", () => {
  // 这是「不要留下一条永不命中却看起来正常的规则」的结构守卫：S4 拿到的快照冻结于
  // 建卡时刻，那一刻死亡信息根本不存在（见本文件头）。剥掉注释再查，免得把迁出说明
  // 里对 "dead" 的引用也算进来。
  const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").map(l => (l.indexOf("//") === -1 ? l : l.slice(0, l.indexOf("//")))).join("\n");
  for (const f of ["cast", "travel", "impact", "aftermath"]) {
    const src = strip(readFileSync(join(ROOT, `scripts/armory/${f}.mjs`), "utf8"));
    assert.ok(!src.includes("dead"),
      `${f}.mjs 的代码里出现了 "dead"：动作槽读不到死亡信息，这样的规则永远不会命中`);
  }
});

/* -------------------------------------------- */
/*  §2 触发层                                     */
/* -------------------------------------------- */

/**
 * 最小 Foundry 桩。与 effects-resync.test.mjs 的同名函数同构（那边的注释解释了每一项
 * 为什么必须有），这里额外让 `getActiveTokens()` 可配，以便同一个 actor 身上同时挂
 * dead 与 burning 两条效果。
 */
function stubFoundry({tokens, effectActive = () => true, enabled = true} = {}) {
  resetPersistInFlight();
  const prev = {
    Hooks: globalThis.Hooks, Actor: globalThis.Actor, game: globalThis.game,
    canvas: globalThis.canvas, fromUuidSync: globalThis.fromUuidSync,
    Sequencer: globalThis.Sequencer
  };
  const handlers = {};
  const playing = [];
  globalThis.Hooks = {on: (n, fn) => { (handlers[n] ??= []).push(fn); }};
  globalThis.Actor = class FakeActor {};
  globalThis.game = {settings: {get: (ns, key) => {
    if (ns === "crucible") return true;
    if (key === "enabled") return enabled;
    return key !== "debug";
  }}};
  globalThis.canvas = {dimensions: {size: 100}, ready: true, tokens: {placeables: tokens ?? []}};
  globalThis.fromUuidSync = uuid => (uuid.includes("ActiveEffect")
    ? {uuid, active: effectActive(uuid)}
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
    fire: (name, ...args) => { for (const fn of handlers[name] ?? []) fn(...args); },
    restore: () => { for (const [k, v] of Object.entries(prev)) globalThis[k] = v; }
  };
}

const activeEffect = (token, statusId) => ({
  uuid: `Scene.s.Token.${token.id}.ActiveEffect.${statusId}`,
  statuses: new Set([statusId]), id: statusId, active: true
});

/** 播出去的这批序列里，有几条是血泊。判据是真的送进 Sequencer 的那个 file 参数。 */
const bloodCount = fake => fake.records
  .filter(r => (r.argOf("file")?.[0] ?? "").includes(BLOOD)).length;

/** 一个已经死了（且还在燃烧）的 token：dead 做被测对象，burning 做对照组。 */
function deadToken() {
  const t = tokenPlaceable({id: "t1", center: {x: 500, y: 500}});
  Object.assign(t, {actor: {effects: [activeEffect(t, "dead"), activeEffect(t, "burning")]}});
  return t;
}

test("createActiveEffect：dead 落地时放一次击杀爆发", async () => {
  const fake = installFakeSequencer();
  const t = deadToken();
  const world = stubFoundry({tokens: [t]});
  try {
    installEffectTriggers(deps());
    world.fire("createActiveEffect", Object.assign(activeEffect(t, "dead"), {parent: world.actor}));
    await afterGrace();
    assert.equal(bloodCount(fake), 1, "dead 落地却没有击杀爆发");
    // dead 在 NO_PERSIST 里，所以这一枚**只**该有血泊，不该另有一圈持久光环。
    assert.equal(fake.records.length, 1);
    assert.equal(fake.records[0].argOf("persist"), undefined,
      "击杀爆发被当成持久特效播出去了");
  } finally { world.restore(); fake.restore(); }
});

test("createActiveEffect：非 dead 状态不放击杀爆发（只有它自己的光环）", async () => {
  const fake = installFakeSequencer();
  const t = deadToken();
  const world = stubFoundry({tokens: [t]});
  try {
    installEffectTriggers(deps());
    world.fire("createActiveEffect",
               Object.assign(activeEffect(t, "burning"), {parent: world.actor}));
    await afterGrace();
    assert.equal(bloodCount(fake), 0, "上个火就淌一地血");
    assert.equal(fake.sequences.length, 1, "对照组：burning 自己的持久光环仍然要播");
  } finally { world.restore(); fake.restore(); }
});

/**
 * 【硬约束 1】一次性爆发绝不能被「补齐稳态」的两条入口触发。
 *
 * 场上每具尸体都挂着 dead：切一次场景（sequencerEffectManagerReady → resyncPersist）
 * 或把尸体拖进场景（createToken）如果也放爆发，全场会同时喷血一遍，而且每切一次场景
 * 重来一遍。对照组是同一个 token 身上的 burning——它**必须**被补上，否则这条 0 断言
 * 可以被「把 resync 整个删掉」蒙混过去。
 */
test("resyncPersist：场上带着 dead 的尸体不会重放击杀爆发（burning 照常补齐）", async () => {
  const fake = installFakeSequencer();
  const t = deadToken();
  const world = stubFoundry({tokens: [t]});
  try {
    await resyncPersist(deps(), ENV);
    await afterGrace();
    assert.equal(bloodCount(fake), 0,
      "切场景/重载把每具尸体的击杀爆发重放了一遍");
    assert.equal(fake.sequences.length, 1, "对照组：burning 的持久光环必须补上");
  } finally { world.restore(); fake.restore(); }
});

test("createToken：把带着 dead 的尸体拖进场景不会放击杀爆发（burning 照常补齐）", async () => {
  const fake = installFakeSequencer();
  const t = deadToken();
  const world = stubFoundry({tokens: [t]});
  try {
    installEffectTriggers(deps());
    world.fire("createToken", {parent: {isView: true}, object: t});
    await afterGrace();
    assert.equal(bloodCount(fake), 0, "每拖一次尸体就喷一次血");
    assert.equal(fake.sequences.length, 1, "对照组：burning 的持久光环必须补上");
  } finally { world.restore(); fake.restore(); }
});

/** 【硬约束 2】闸门与 B 组一致，收敛在播放函数这一处。 */
test("动画开关关闭时不放击杀爆发", async () => {
  const fake = installFakeSequencer();
  const t = deadToken();
  const world = stubFoundry({tokens: [t], enabled: false});
  try {
    installEffectTriggers(deps());
    world.fire("createActiveEffect", Object.assign(activeEffect(t, "dead"), {parent: world.actor}));
    await afterGrace();
    assert.equal(fake.sequences.length, 0);
  } finally { world.restore(); fake.restore(); }
});

test("让路期内这条 dead 被撤销（GM 撤销那一击）时放弃播放", async () => {
  const fake = installFakeSequencer();
  const t = deadToken();
  let stillDead = true;
  const world = stubFoundry({tokens: [t], effectActive: uuid => !uuid.endsWith("dead") || stillDead});
  try {
    installEffectTriggers(deps());
    world.fire("createActiveEffect", Object.assign(activeEffect(t, "dead"), {parent: world.actor}));
    await bounded(sleep(50));
    stillDead = false;                               // confirm({reverse:true}) 把 dead 拿掉了
    await afterGrace();
    assert.equal(bloodCount(fake), 0, "撤销之后还是淌了一地血");
  } finally { world.restore(); fake.restore(); }
});

test("击杀爆发不做去重：同一具 token 再死一次要再炸一次", async () => {
  // 与 persist 通道相反：那边靠 inFlight + isPlayingPersist 保证「一份状态一圈光环」，
  // 而一次性爆发没有「已经在放」这个状态，复活后再被打死就该再来一次。
  const fake = installFakeSequencer();
  const t = deadToken();
  const world = stubFoundry({tokens: [t]});
  try {
    installEffectTriggers(deps());
    const dead = Object.assign(activeEffect(t, "dead"), {parent: world.actor});
    world.fire("createActiveEffect", dead);
    await afterGrace();
    world.fire("createActiveEffect", dead);
    await afterGrace();
    assert.equal(bloodCount(fake), 2, "第二次死亡没有画面");
  } finally { world.restore(); fake.restore(); }
});
