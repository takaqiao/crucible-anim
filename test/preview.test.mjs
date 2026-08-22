/**
 * Task 15：预览宏的纯函数部分（`previewActionPlan` / `previewEffectPlan` /
 * `parsePreviewArgs`）+ 重放菜单接线（`installReplayMenu`）。
 *
 * 预览宏本体（`installPreview`/`runPreview`）依赖 `canvas`/`game.user.targets`/
 * Sequencer 的完整运行时，headless 测不了；但它内部构造 FXPlan 的两个函数是纯的
 * （给定 rule/token/env/deps，不碰任何全局），可以像 armory 规则表一样直接单测。
 *
 * 这里同时钉住简报参考实现里两个没写出来的坑（对应交接约束 (5)：
 * 「previewEffectPlan 需要显式降级」）：
 *   1. 只把 armory[slot] 收窄成单条规则并不够——规则自己的 `when()` 仍然可能因为
 *      合成快照缺字段而判负，那样"这一槽没产出"会被其它三槽的常规产出悄悄掩盖，
 *      通知上写着这条规则的 id，画面播的却是别的东西。
 *   2. persist 规则的 cue.tieTo 来自 `effectSnapshot.effectUuid`；不给一个真实存在、
 *      可解析的值，`resolveEffect()` 的 `keepTied()` 会把 cue 整条丢弃——12 个分组
 *      会全部拿到 `plan === null`。
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

import {tokenPlaceable} from "../tools/token-mocks.mjs";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import {resolve, resolveEffect} from "../scripts/resolver/resolve.mjs";
import {snapshotAction} from "../scripts/trigger/snapshot.mjs";
import {NO_PERSIST, GROUP_FX} from "../scripts/armory/persist.mjs";
import {previewActionPlan, previewEffectPlan, parsePreviewArgs, installReplayMenu}
  from "../scripts/player/preview.mjs";
import {planOf} from "../scripts/trigger/dispatch.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const ENV = {gridSize: 100, distancePixels: 100};
const deps = () => ({assets: createAssets(offlineBackend(index)), armory: ARMORY});

const origin = () => tokenPlaceable({id: "origin", center: {x: 500, y: 500}});
const target = () => tokenPlaceable({id: "target", center: {x: 600, y: 500}});

const ruleIn = (slot, id) => ARMORY[slot].find(r => r.id === id);

function probeAction() {
  return {
    id: "__probe__", name: "probe", tags: new Set(["strike", "melee", "slashing"]),
    target: {type: "single", number: 1, distance: 1, scope: 2},
    range: {minimum: 0, maximum: 1}, cost: {action: 1, focus: 0, heroism: 0, health: 0},
    region: null, actor: null, token: origin(),
    targets: new Map([[{id: "x"}, {token: target()}]]),
    usage: {damageType: "slashing", isAttack: true, isRanged: false,
            strikes: [{category: "balanced1", system: {damageType: "slashing"}}]},
    eventsByTarget: new Map([[{id: "x"},
      {all: [], roll: [{roll: {data: {result: 7}, isCriticalSuccess: true}}]}]])
  };
}

/* -------------------------------------------- */
/*  previewActionPlan                            */
/* -------------------------------------------- */

test("previewActionPlan：strike.ranged.draw 强制命中后必须带自己的 cue（弓弦音轨）", () => {
  const rule = ruleIn("cast", "strike.ranged.draw");
  assert.ok(rule);
  const plan = previewActionPlan(rule, "cast", origin(), target(), ENV, deps());
  assert.ok(plan, "build() 只用了 ctx.sound()，不依赖 when() 判的那个 category，强制命中后必须有产出");
  assert.ok(plan.cues.some(c => c.rule === "strike.ranged.draw" && c.slot === "cast"));
});

test("previewActionPlan：generic.cast 对「有目标的攻击动作」按设计就该是空——" +
     "这是正确的诚实降级，不是 bug", () => {
  // build() 里第一行就是 `if (s.usage.isAttack && s.targets.length) return null`：
  // 非法术攻击已经有 impact/travel 承担视觉，cast 槽的通用施法特效会跟攻击动作抢戏。
  // previewActionPlan 的合成动作恰好是「有目标的攻击」，所以这条规则强制命中之后
  // 仍然诚实返回 null——钉住这一点，免得将来有人把 previewActionPlan 的容错逻辑
  // 改成"build() 返回 null 也硬凑一条 cue"这种更"讨喜"但错误的行为。
  const rule = ruleIn("cast", "generic.cast");
  assert.ok(rule);
  const plan = previewActionPlan(rule, "cast", origin(), target(), ENV, deps());
  assert.equal(plan, null);
});

test("previewActionPlan：强制 when 恒真让按 tag 精确匹配的规则也能被命中", () => {
  // tag.healing 的 when 要求 tags 里有 "healing"，previewActionPlan 的合成动作只有
  // ["strike","melee","slashing"]——不强制 when 的话这条规则在预览里永远选不中。
  const rule = ruleIn("cast", "tag.healing");
  assert.ok(rule);
  const plan = previewActionPlan(rule, "cast", origin(), target(), ENV, deps());
  assert.ok(plan, "强制 when 之后 tag.healing 必须能被预览到（它的 build() 不依赖 tags 本身）");
  assert.ok(plan.cues.some(c => c.rule === "tag.healing"));
});

test("previewActionPlan：build() 需要合成快照给不出的字段时，诚实返回 null 而不是别的槽冒名顶替", () => {
  // spell.gesture.ray 的 build() 需要 s.region.length/rotation 之类的模板几何——
  // previewActionPlan 的合成动作 region:null，即便强制 when 命中，build() 也会因为
  // 读取 null.length 抛错，被 resolve.mjs 的 runBuild 接住降级成 0 条 cue。
  const rule = ruleIn("travel", "spell.gesture.ray");
  assert.ok(rule);
  const plan = previewActionPlan(rule, "travel", origin(), target(), ENV, deps());
  assert.equal(plan, null,
    "没有真实模板数据时必须诚实地返回 null，不能让其它槽的常规产出冒充这条规则的预览结果");
});

test("回归：不强制 when、只收窄 armory 数组——按 tag 精确匹配的规则在预览下静默失踪，" +
     "整体计划却仍然非空，这正是需要「显式降级」的理由", () => {
  const rule = ruleIn("cast", "tag.healing");
  const snapshot = snapshotAction(probeAction(), ENV);
  // 朴素写法：只把 cast 槽收窄成这一条规则，不动它的 when()。
  const naive = resolve(snapshot, {assets: deps().assets, armory: {...ARMORY, cast: [rule]}});
  assert.ok(naive, "其它三槽（travel/impact/aftermath）仍会各自选出常规规则，计划本身非空");
  assert.ok(!naive.cues.some(c => c.rule === "tag.healing"),
    "cast 槽里唯一候选 tag.healing 的 when() 判负，这条规则的 cue 一条都没有——" +
    "但调用方只看到 plan 非空，很容易误判成「预览成功」");
});

/* -------------------------------------------- */
/*  previewEffectPlan                            */
/* -------------------------------------------- */

test("previewEffectPlan：12 个状态分组 + 通用兜底，强制命中后全部产出绑定到目标 token 的持久 cue", () => {
  const t = target();
  for (const group of Object.keys(GROUP_FX)) {
    const rule = ruleIn("persist", `status.${group}`);
    assert.ok(rule, `分组 "${group}" 对应的规则不存在`);
    const plan = previewEffectPlan(rule, t, ENV, deps());
    assert.ok(plan, `分组 "${group}" 强制命中后不该是 null（交接约束 (5) 钉的正是这个症状）`);
    assert.equal(plan.cues.length, 1);
    const cue = plan.cues[0];
    assert.equal(cue.rule, rule.id);
    assert.equal(cue.persist, true);
    assert.equal(cue.tieTo, t.document.uuid, "tieTo 必须钉在目标 token 自己的 uuid 上");
  }
  const generic = ruleIn("persist", "generic.persist");
  const plan = previewEffectPlan(generic, t, ENV, deps());
  assert.ok(plan);
  assert.equal(plan.cues[0].rule, "generic.persist");
});

test("previewEffectPlan：status.silent 的语义是「就该没有画面」，预览诚实返回 null", () => {
  const rule = ruleIn("persist", "status.silent");
  assert.ok(rule);
  assert.ok(NO_PERSIST.length > 0, "语料前提：至少存在一个刻意静默的状态");
  const plan = previewEffectPlan(rule, target(), ENV, deps());
  assert.equal(plan, null, "build() 恒返回 null，即便强制 when 命中也不该凭空生出画面");
});

test("回归：effectUuid 不给真实值（如简报参考实现的字面 null）——" +
     "keepTied 会把 persist cue 整条丢弃，12 个分组全部拿到 null", () => {
  const t = target();
  const rule = {...ruleIn("persist", "status.burning"), when: () => true};
  const naiveSnapshot = {
    statusId: "__preview__.status.burning",
    effectUuid: null,                              // 简报参考实现原样这么写
    target: {tokenId: t.id, uuid: t.document.uuid, x: t.center.x, y: t.center.y,
             elevation: 0, width: 1, height: 1, w: 100, h: 100, radiusPx: 50},
    seed: 1
  };
  const naive = resolveEffect(naiveSnapshot, {assets: deps().assets, armory: {persist: [rule]}});
  assert.equal(naive, null,
    "effectUuid:null → cue.tieTo 为空 → keepTied 丢弃这条 cue → cues.length===0 → plan===null");
});

/* -------------------------------------------- */
/*  parsePreviewArgs                             */
/* -------------------------------------------- */

test("parsePreviewArgs：解析 slot/filter/gap，冒号与等号都认", () => {
  assert.deepEqual(parsePreviewArgs("slot:impact filter:melee gap:800"),
    {slot: "impact", filter: "melee", gap: 800});
  assert.deepEqual(parsePreviewArgs("slot=persist"), {slot: "persist"});
});

test("parsePreviewArgs：空输入/纯空白返回空对象", () => {
  assert.deepEqual(parsePreviewArgs(""), {});
  assert.deepEqual(parsePreviewArgs("   "), {});
  assert.deepEqual(parsePreviewArgs(undefined), {});
  assert.deepEqual(parsePreviewArgs(null), {});
});

test("parsePreviewArgs：无法识别的 key 与非数字的 gap 被忽略，不抛错", () => {
  assert.deepEqual(parsePreviewArgs("bogus:xyz gap:notanumber slot:cast"), {slot: "cast"});
});

test("parsePreviewArgs：多余空白与制表符不影响解析", () => {
  assert.deepEqual(parsePreviewArgs("  slot:cast   gap:500  "), {slot: "cast", gap: 500});
});

/* -------------------------------------------- */
/*  installReplayMenu                            */
/* -------------------------------------------- */

function stubHooksAndMessages(messages) {
  const handlers = {};
  const prev = {Hooks: globalThis.Hooks, game: globalThis.game};
  globalThis.Hooks = {on: (n, fn) => { (handlers[n] ??= []).push(fn); }};
  globalThis.game = {
    messages: {get: id => messages.find(m => m.id === id) ?? null},
    i18n: {localize: k => k}
  };
  return {
    handlers,
    fire: (name, ...args) => { for (const fn of handlers[name] ?? []) fn(...args); },
    restore: () => { for (const [k, v] of Object.entries(prev)) globalThis[k] = v; }
  };
}

test("installReplayMenu：condition 与 dispatch.mjs 共享的 planOf 同源——" +
     "带本模组 plan 的卡返回 true，没有的返回 false", () => {
  const withPlan = {id: "m1", flags: {crucible: {metadata: {cav: {v: 1, cues: []}}}}};
  const withoutPlan = {id: "m2", flags: {crucible: {}}};
  const world = stubHooksAndMessages([withPlan, withoutPlan]);
  try {
    installReplayMenu();
    let pushed = null;
    world.fire("getChatMessageContextOptions", {}, {push: opt => { pushed = opt; }});
    assert.ok(pushed, "必须真的注册了一条菜单项");
    assert.equal(pushed.condition({dataset: {messageId: "m1"}}), true);
    assert.equal(pushed.condition({dataset: {messageId: "m2"}}), false);
    assert.equal(pushed.condition({dataset: {messageId: "does-not-exist"}}), false);
    // condition 的判据必须真的是导出的 planOf，而不是各写一份容易漂移的等价逻辑。
    assert.equal(!!planOf(withPlan), true);
    assert.equal(!!planOf(withoutPlan), false);
  } finally { world.restore(); }
});

test("installReplayMenu：callback 不得写 message._vfxPlayback——那个字段只服务于 confirm()", async () => {
  const msg = {id: "m3", flags: {crucible: {metadata: {cav: {v: 1, cues: []}}}}};
  const world = stubHooksAndMessages([msg]);
  try {
    installReplayMenu();
    let pushed = null;
    world.fire("getChatMessageContextOptions", {}, {push: opt => { pushed = opt; }});
    assert.equal(msg._vfxPlayback, undefined, "调用前不该有这个字段");
    // playFromMessage 会尝试碰 canvas/game.settings 等真实运行时全局，这里不追求它
    // 真的播出动画，只钉住 callback 本身绝不主动写 _vfxPlayback 这一条契约。
    await pushed.callback({dataset: {messageId: "m3"}}).catch(() => {});
    assert.equal(msg._vfxPlayback, undefined,
      "重放不是 confirm() 的一部分，写 _vfxPlayback 会污染下一次「撤销→重新确认」的判断");
  } finally { world.restore(); }
});

/* -------------------------------------------- */
/*  installPreview：/canim-preview 聊天命令 + api  */
/* -------------------------------------------- */

function stubInstallPreviewWorld() {
  const handlers = {};
  const prev = {Hooks: globalThis.Hooks, game: globalThis.game};
  const mod = {};
  globalThis.Hooks = {on: (n, fn) => { (handlers[n] ??= []).push(fn); }};
  globalThis.game = {modules: {get: id => (id === "crucible-anim" ? mod : null)}};
  return {
    handlers, mod,
    fire: (name, ...args) => {
      let ret;
      for (const fn of handlers[name] ?? []) ret = fn(...args);
      return ret;
    },
    restore: () => { for (const [k, v] of Object.entries(prev)) globalThis[k] = v; }
  };
}

test("installPreview：把 preview() 挂到 game.modules.get(MODULE_ID).api 上", async () => {
  const {installPreview} = await import("../scripts/player/preview.mjs");
  const world = stubInstallPreviewWorld();
  try {
    installPreview(deps());
    assert.equal(typeof world.mod.api.preview, "function");
  } finally { world.restore(); }
});

test("installPreview：/canim-preview 拦截消息（返回 false）并转发解析后的参数", async () => {
  const {installPreview} = await import("../scripts/player/preview.mjs");
  const world = stubInstallPreviewWorld();
  try {
    let called = null;
    installPreview(deps());
    world.mod.api.preview = opts => { called = opts; return Promise.resolve(); };
    const ret = world.fire("chatMessage", {}, "/canim-preview slot:persist gap:500");
    assert.equal(ret, false, "命令必须拦截默认的聊天发送流程");
    assert.deepEqual(called, {slot: "persist", gap: 500});
  } finally { world.restore(); }
});

test("installPreview：不是本命令的普通聊天消息放行（返回 true），不触发预览", async () => {
  const {installPreview} = await import("../scripts/player/preview.mjs");
  const world = stubInstallPreviewWorld();
  try {
    let called = false;
    installPreview(deps());
    world.mod.api.preview = () => { called = true; return Promise.resolve(); };
    const ret = world.fire("chatMessage", {}, "大家好");
    assert.equal(ret, true);
    assert.equal(called, false);
  } finally { world.restore(); }
});
