import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import {planForEffect} from "../scripts/trigger/effects.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const ENV = {gridSize: 100};
const deps = () => ({assets: createAssets(offlineBackend(index)), armory: ARMORY});

const token = () => ({
  id: "t1", uuid: "Scene.s.Token.t1",
  document: {elevation: 0, width: 1, height: 1, uuid: "Scene.s.Token.t1"},
  center: {x: 500, y: 500}
});
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
