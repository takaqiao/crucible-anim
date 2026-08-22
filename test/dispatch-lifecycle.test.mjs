/**
 * 聊天卡播放闸门的生命周期契约（Task 14 的 `??` 缺陷）。
 *
 * 原来的 `message._vfxPlayback = message._vfxPlayback ?? playFromMessage(message)` 有两个
 * 分支，它防住的那个永远不发生（原生只在 flags.vfxConfig 为真时写这个字段，而那与我们
 * 产出 plan 互斥），误伤的那个天天发生（_vfxPlayback 从不清空，撤销后重新确认时它撞上
 * 上一轮早已 settle 的 promise 直接短路，一次都不播）。
 *
 * 这里测的是抽出来的 onMessageConfirmed / sceneForMessage / playFromMessage 三个纯函数，
 * 不需要 Hooks / ChatMessage / Sequencer / canvas 的完整桩。
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {onMessageConfirmed, sceneForMessage, playFromMessage} from "../scripts/trigger/dispatch.mjs";

function stubFoundry() {
  const old = globalThis.foundry;
  globalThis.foundry = {utils: {
    getProperty: (obj, path) => path.split(".").reduce((o, k) => (o == null ? o : o[k]), obj)
  }};
  return () => { globalThis.foundry = old; };
}

const CONFIRMED = {flags: {crucible: {confirmed: true}}};
const REVERSED  = {flags: {crucible: {confirmed: false}}};
const withPlan = (id = "m1") => ({
  id, flags: {crucible: {action: {id: "a"}, metadata: {cav: {v: 1, cues: []}}}}
});

test("撤销后重新确认必须重播；旧的已 settle promise 不得短路第二轮", async () => {
  const restore = stubFoundry();
  try {
    const calls = [];
    const play = m => { calls.push(m.id); return Promise.resolve(); };
    const msg = withPlan();

    onMessageConfirmed(msg, CONFIRMED, play);
    const first = msg._vfxPlayback;
    await first;                                   // 复现真实时序：第一轮早已 settle
    onMessageConfirmed(msg, REVERSED, play);       // 撤销：confirmed 翻 false，不播
    onMessageConfirmed(msg, CONFIRMED, play);      // 重新确认：必须再播

    assert.deepEqual(calls, ["m1", "m1"], "第二次确认必须重新调用播放");
    assert.notEqual(msg._vfxPlayback, first,
      "必须换成本轮的新 promise，CrucibleAction#confirm 的 Promise.race 才会真的等这一次");
  } finally { restore(); }
});

test("没有本模组计划时既不播放、也不覆盖原生写下的 _vfxPlayback", () => {
  const restore = stubFoundry();
  try {
    const calls = [];
    const native = Promise.resolve("native");
    const msg = {id: "m2", _vfxPlayback: native,
      flags: {crucible: {action: {id: "a"}, vfxConfig: {sequence: []}}}};
    onMessageConfirmed(msg, CONFIRMED, () => { calls.push("x"); });
    assert.equal(calls.length, 0, "原生已接管，本模组不得插手");
    assert.equal(msg._vfxPlayback, native, "原生那份 promise 必须原样保留");
  } finally { restore(); }
});

test("闸门：非 crucible 动作卡 / confirmed 未翻真 / 无关字段更新，一律不播", () => {
  const restore = stubFoundry();
  try {
    const calls = [];
    const play = () => { calls.push("x"); };
    onMessageConfirmed({id: "a", flags: {}}, CONFIRMED, play);
    onMessageConfirmed(withPlan("b"), REVERSED, play);
    onMessageConfirmed(withPlan("c"), {content: "改了正文"}, play);
    assert.equal(calls.length, 0);
  } finally { restore(); }
});

test("钩子内部抛错不外泄", () => {
  const restore = stubFoundry();
  const realWarn = console.warn; const warns = [];
  console.warn = (...a) => warns.push(a.map(x => (x instanceof Error ? x.message : String(x))).join(" "));
  try {
    assert.doesNotThrow(() =>
      onMessageConfirmed(withPlan("d"), CONFIRMED, () => { throw new Error("boom"); }));
    assert.ok(warns.some(l => l.includes("boom")));
  } finally { console.warn = realWarn; restore(); }
});

function stubWorld({resolve, canvasScene}) {
  const oldF = globalThis.fromUuidSync, oldC = globalThis.canvas;
  const seen = [];
  globalThis.fromUuidSync = (uuid, opts) => { seen.push({uuid, opts}); return resolve(uuid, opts); };
  globalThis.canvas = canvasScene === undefined ? undefined : {scene: canvasScene};
  return {seen, restore: () => { globalThis.fromUuidSync = oldF; globalThis.canvas = oldC; }};
}

test("场景解析：没有 token flag 时退回 canvas.scene", () => {
  const here = {id: "here", isView: true};
  const {restore} = stubWorld({resolve: () => null, canvasScene: here});
  try { assert.equal(sceneForMessage({id: "m", flags: {crucible: {}}}), here); } finally { restore(); }
});

test("场景解析：token 能解析时用它的 parent 场景，并以 strict:false 调用 fromUuidSync", () => {
  const there = {id: "there", isView: true};
  const {seen, restore} = stubWorld({resolve: () => ({parent: there}),
                                     canvasScene: {id: "here", isView: true}});
  try {
    assert.equal(sceneForMessage({id: "m", flags: {crucible: {token: "Scene.s.Token.t"}}}), there);
    assert.equal(seen[0].opts?.strict, false,
      "必须显式关掉 strict，否则 compendium 内嵌 uuid 会同步抛错（client/utils/helpers.mjs:188-198）");
  } finally { restore(); }
});

test("场景解析：出手 token 已被删除时退回 canvas.scene，而不是放弃播放", () => {
  const here = {id: "here", isView: true};
  const {restore} = stubWorld({resolve: () => null, canvasScene: here});
  try {
    assert.equal(sceneForMessage({id: "m", flags: {crucible: {token: "Scene.gone.Token.t"}}}), here,
      "两条分支必须同宽严：解析不出场景 ≠ 不该播");
  } finally { restore(); }
});

test("场景解析：解析出来但不是当前视图，仍然不得退回 canvas.scene", () => {
  const other = {id: "other", isView: false};
  const here = {id: "here", isView: true};
  const {restore} = stubWorld({resolve: () => ({parent: other}), canvasScene: here});
  try {
    assert.equal(sceneForMessage({id: "m", flags: {crucible: {token: "Scene.other.Token.t"}}}), other,
      "真正的跨场景必须保持不播，兜底只针对解析失败");
  } finally { restore(); }
});

test("playFromMessage：准备阶段抛错时不外泄成 rejected promise", async () => {
  const oldG = globalThis.game;
  globalThis.game = {settings: {get: () => true}};
  const {restore} = stubWorld({resolve: () => { throw new Error("compendium embedded"); },
                               canvasScene: undefined});
  const realWarn = console.warn; const warns = [];
  console.warn = (...a) => warns.push(a.map(x => (x instanceof Error ? x.message : String(x))).join(" "));
  try {
    const msg = withPlan("m9");
    msg.flags.crucible.token = "Compendium.pack.Actor.a.Token.t";
    await assert.doesNotReject(playFromMessage(msg));
    assert.ok(warns.some(l => l.includes("m9")));
  } finally { console.warn = realWarn; restore(); globalThis.game = oldG; }
});

test("playFromMessage：不在当前视图的场景不播，且不抛错", async () => {
  const oldG = globalThis.game;
  globalThis.game = {settings: {get: () => true}};
  const {restore} = stubWorld({resolve: () => null, canvasScene: {id: "here", isView: false}});
  try { await assert.doesNotReject(playFromMessage(withPlan("m10"))); }
  finally { restore(); globalThis.game = oldG; }
});
