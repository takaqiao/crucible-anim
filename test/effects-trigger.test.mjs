import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import {tokenPlaceable} from "../tools/token-mocks.mjs";
import {planForEffect} from "../scripts/trigger/effects.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const ENV = {gridSize: 100};
const deps = () => ({assets: createAssets(offlineBackend(index)), armory: ARMORY});

// installEffectTriggers 遍历的是 `actor.getActiveTokens()`（foundry
// client/documents/actor.mjs:286-296：document 参数为假时 push 的是 `t.object`），
// 交给 planForEffect 的因此是 **Token placeable**——与动作路径的 TokenDocument
// 不是同一种对象。mock 必须是真 placeable 的形状（`.document` 上有 x/y/id/uuid、
// 自身没有 uuid），否则 tokenGeom 又会被一个不存在的混合形状带偏（Critical-1）。
const token = () => tokenPlaceable({id: "t1", center: {x: 500, y: 500}});
const effect = (statusId) => ({
  uuid: `Scene.s.Token.t1.ActiveEffect.${statusId}`,
  statuses: new Set([statusId]), id: statusId
});

test("燃烧状态产出持久化计划且绑定到效果", () => {
  const plan = planForEffect(effect("burning"), token(), ENV, deps());
  assert.ok(plan);
  assert.ok(plan.cues.every(c => c.persist === true));
  assert.equal(plan.cues[0].tieTo, "Scene.s.Token.t1.ActiveEffect.burning");
});

test("无 statuses 的效果不产出计划", () => {
  const plan = planForEffect({uuid: "x", statuses: new Set(), id: null}, token(), ENV, deps());
  assert.equal(plan, null);
});

// snapshotEffect(effect, null, env) 直接返回 null（离场/跨场景角色挂状态是正常情形，
// 不是错误，见 trigger/snapshot.mjs 的文档）。planForEffect 原始草案写的是
// `if (!snapshot.statusId) return null`，snapshot 为 null 时这行本身会抛 TypeError，
// 被外层 catch 接住后错误地打成"构造失败"——同一次降级，日志从静默变成误报。
// 这条用例钉住修好之后的行为：既不抛，也不应该把这条完全正常的路径当成异常打日志
// （下面只断言返回值，日志内容的正确性由 wrap.test.mjs 同款用例的思路交叉核对）。
test("没有 token 时不产出计划也不抛错", () => {
  assert.doesNotThrow(() => {
    assert.equal(planForEffect(effect("burning"), null, ENV, deps()), null);
  });
});

// 变异实验（Task 14 评审）：把 `snapshot?.statusId` 改回裸访问 `snapshot.statusId` 时，
// 上面那条用例仍然全绿——bug 状态下 planForEffect 的 try/catch 同样返回 null，唯一的差别
// 是多打了一条 error("为状态效果构造动画计划失败")。返回值断言杀不掉这个变异体，必须断言
// 「这条完全正常的降级路径不留 error」。
test("没有 token 时既不产出计划，也不打 error 日志（正常降级不是错误）", () => {
  const realError = console.error;
  const errors = [];
  console.error = (...args) => errors.push(args.join(" "));
  try {
    assert.equal(planForEffect(effect("burning"), null, ENV, deps()), null);
  } finally { console.error = realError; }
  assert.deepEqual(errors, [],
    "离场/跨场景角色挂状态是正常情形，statusId 裸访问会把它误报成「构造失败」");
});

// 变异实验（Task 14 评审）：删掉 planForEffect 里的 warnings 转发后 22 条测试全绿——
// persist 侧的 warning 转发完全无覆盖（动作侧有 wrap.test.mjs 的同名用例）。这里同时
// 覆盖 resolve.mjs 的 drainWarnings：persist 规则每条只产 1 个 cue，被 keepTied 丢掉后
// 计划为空，warning 只能靠 onWarn 这条路出来。
test("effectUuid 缺失时 keepTied 的诊断会经 warn() 冒出来，而不是随空计划一起蒸发", () => {
  const realWarn = console.warn;
  const warns = [];
  console.warn = (...args) => warns.push(args.join(" "));
  let plan;
  try {
    plan = planForEffect({uuid: null, statuses: new Set(["burning"]), id: "burning"},
                         token(), ENV, deps());
  } finally { console.warn = realWarn; }
  assert.equal(plan, null, "没有 tieTo 的 persist cue 必须被丢掉");
  assert.ok(warns.some(l => l.includes("persist:burning") && l.includes("tieTo")),
    `keepTied 的诊断没有到达 warn()，实际输出：${JSON.stringify(warns)}`);
});

test("statuses 读取抛错时返回 null 而不外抛", () => {
  assert.doesNotThrow(() => {
    const broken = {get statuses() { throw new Error("boom"); }};
    assert.equal(planForEffect(broken, token(), ENV, deps()), null);
  });
});

test("同一状态两次产出完全相同的计划", () => {
  const a = planForEffect(effect("burning"), token(), ENV, deps());
  const b = planForEffect(effect("burning"), token(), ENV, deps());
  assert.deepEqual(a, b);
});

/**
 * Critical-1 的状态侧对照：placeable 归一化到它的 TokenDocument 之后，
 * 快照里的 uuid/坐标必须来自文档而不是 placeable 自身（placeable 上根本没有 uuid）。
 *
 * 这条在旧实现下也通过（placeable 路径本来就是对的），在「只认 TokenDocument」的
 * 错误修法下变红——修复既不能只顾文档，也不能只顾 placeable。
 */
test("Critical-1：placeable 的几何与 uuid 经 document 取出，不是 (0,0)", () => {
  const plan = planForEffect(effect("burning"), tokenPlaceable({id: "t1", center: {x: 820, y: 640}}),
    ENV, deps());
  assert.ok(plan);
  const anchored = plan.cues.filter(c => Number.isFinite(c.at?.x));
  assert.ok(anchored.length > 0, "至少有一条 cue 带冻结坐标");
  for (const c of anchored) {
    assert.deepEqual([c.at.x, c.at.y], [820, 640], `${c.rule} 的锚点必须是 token 真实中心`);
    assert.equal(c.at.uuid, "Scene.s.Token.t1");
  }
});
