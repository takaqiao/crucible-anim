/**
 * scripts/trigger/dispatch.mjs 里能脱离完整 Foundry 单测的部分：resolveRefIn 的三条
 * 优先级契约、animationsEnabled 的双开关、runAnimation 对 semaphore.run() 结局的处理。
 *
 * installDispatch() 本身（注册 updateChatMessage 钩子）不在这里测——它整个函数体只是
 * "把上面这些纯函数接到 Hooks 上"，没有自己的分支逻辑，硬造一个 ChatMessage/Hooks 桩
 * 只会重复断言同一件事。
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {animationsEnabled, resolveRefIn, runAnimation} from "../scripts/trigger/dispatch.mjs";

/* ---- resolveRefIn ---------------------------------------------------- */

/**
 * 造一个"场景"：只实现 resolveRefIn 会用到的两个面——scene.tokens.get(id)?.object，
 * 与全局 fromUuidSync(uuid)?.object。刻意让同一个 tokenId 在两条路径上给出*不同*的
 * placeable，这样断言才能分清 resolveRefIn 到底走了哪一条，而不是走了任意一条都会
 * "看起来正确"。
 */
function makeFixture() {
  const byUuid = {object: {id: "t1", via: "uuid", document: {}}};
  const byId = {object: {id: "t1", via: "tokenId", document: {}}};
  const scene = {tokens: {get: id => (id === "t1" ? byId : undefined)}};
  const oldFromUuidSync = globalThis.fromUuidSync;
  globalThis.fromUuidSync = uuid => (uuid === "Scene.s.Token.t1" ? byUuid : undefined);
  return {
    scene, byUuid: byUuid.object, byId: byId.object,
    restore: () => { globalThis.fromUuidSync = oldFromUuidSync; }
  };
}

test("resolveRefIn: ref:point 永远原样返回冻结坐标，即使同时带着能解析出 token 的 tokenId/uuid", () => {
  const {scene, restore} = makeFixture();
  try {
    const resolveRef = resolveRefIn(scene);
    const at = {ref: "point", tokenId: "t1", uuid: "Scene.s.Token.t1", x: 123, y: 456};
    assert.deepEqual(resolveRef(at), {x: 123, y: 456},
      "point 必须最先短路，不能被 tokenId/uuid 升格成 placeable");
  } finally { restore(); }
});

test("resolveRefIn: ref:point 坐标非有限数时返回 null，不回落成任何 token", () => {
  const {scene, restore} = makeFixture();
  try {
    const resolveRef = resolveRefIn(scene);
    assert.equal(resolveRef({ref: "point", tokenId: "t1", x: NaN, y: 456}), null);
  } finally { restore(); }
});

test("resolveRefIn: 带 uuid 的身份锚点优先经 fromUuidSync 解析成 placeable", () => {
  const {scene, byUuid, restore} = makeFixture();
  try {
    const resolveRef = resolveRefIn(scene);
    const at = {ref: "target", tokenId: "t1", uuid: "Scene.s.Token.t1", x: 1, y: 1};
    assert.equal(resolveRef(at), byUuid, "uuid 能解析时必须拿到 uuid 那一条 placeable");
  } finally { restore(); }
});

test("resolveRefIn: uuid 解析不到时退回本场景按 tokenId 查找", () => {
  const {scene, byId, restore} = makeFixture();
  try {
    const resolveRef = resolveRefIn(scene);
    const at = {ref: "origin", tokenId: "t1", uuid: "Scene.s.Token.does-not-exist", x: 1, y: 1};
    assert.equal(resolveRef(at), byId);
  } finally { restore(); }
});

test("resolveRefIn: 身份都解析不到时退化成裸坐标点", () => {
  const {scene, restore} = makeFixture();
  try {
    const resolveRef = resolveRefIn(scene);
    const at = {ref: "target", tokenId: "gone", uuid: "Scene.s.Token.gone", x: 42, y: 7};
    assert.deepEqual(resolveRef(at), {x: 42, y: 7});
  } finally { restore(); }
});

test("resolveRefIn: 什么都解析不出时返回 null；at 本身为空时同样返回 null", () => {
  const {scene, restore} = makeFixture();
  try {
    const resolveRef = resolveRefIn(scene);
    assert.equal(resolveRef({ref: "target", x: NaN, y: NaN}), null);
    assert.equal(resolveRef(null), null);
    assert.equal(resolveRef(undefined), null);
  } finally { restore(); }
});

/* ---- animationsEnabled ------------------------------------------------ */

function stubGame(settings) {
  const old = globalThis.game;
  globalThis.game = {settings: {get: (mod, key) => settings[`${mod}.${key}`]}};
  return () => { globalThis.game = old; };
}

test("animationsEnabled: 只有 Crucible 与本模组的开关同时为真才播", () => {
  let restore = stubGame({"crucible.enableVFX": true, "crucible-anim.enabled": true});
  try { assert.equal(animationsEnabled(), true); } finally { restore(); }

  restore = stubGame({"crucible.enableVFX": false, "crucible-anim.enabled": true});
  try { assert.equal(animationsEnabled(), false, "Crucible 自己的总开关关闭时必须服从"); } finally { restore(); }

  restore = stubGame({"crucible.enableVFX": true, "crucible-anim.enabled": false});
  try { assert.equal(animationsEnabled(), false, "本模组的开关关闭时必须服从"); } finally { restore(); }
});

test("animationsEnabled: 设置项尚未注册（读取抛错）时保守按关闭处理", () => {
  const old = globalThis.game;
  globalThis.game = {settings: {get: () => { throw new Error("not registered"); }}};
  try { assert.equal(animationsEnabled(), false); } finally { globalThis.game = old; }
});

/* ---- runAnimation：吸收 semaphore.run() 的两种"没有正常播完" ---------- */

test("runAnimation: 任务成功时静默完成，不产生任何 warn", async () => {
  const realWarn = console.warn;
  const warns = [];
  console.warn = (...args) => warns.push(args);
  try {
    await runAnimation("test-ok", async () => "done");
    assert.equal(warns.length, 0);
  } finally { console.warn = realWarn; }
});

test("runAnimation: 任务抛错时吞掉异常并留痕，不让调用方看见 rejection", async () => {
  const realWarn = console.warn;
  const warns = [];
  console.warn = (...args) => warns.push(args.join(" "));
  try {
    await assert.doesNotReject(runAnimation("test-fail", async () => { throw new Error("boom"); }));
    assert.ok(warns.some(l => l.includes("test-fail") && l.includes("boom")));
  } finally { console.warn = realWarn; }
});

// TIMED_OUT 分支本身（semaphore.run() 在 timeoutMs 内没播完时 resolve 成 TIMED_OUT
// 哨兵值而不是 reject）由 test/semaphore.test.mjs 的
// "timeoutMs 真的按入参生效，且超时兑现成可辨认的哨兵值" 一条钉死；dispatch.mjs 用的
// 是模块级共享单例（有意不传 timeoutMs，见 dispatch.mjs 顶部注释），真去触发一次要
// 等满 15 秒，这里不重复烧这份预算——上面两条已经覆盖 runAnimation 对"成功"与"拒绝"
// 这两种结局的处理，TIMED_OUT 分支的正确性见代码走读：`result === TIMED_OUT` 的判据
// 直接引用 semaphore.mjs 导出的同一个 Symbol，不可能出现拼写或引用不一致。
