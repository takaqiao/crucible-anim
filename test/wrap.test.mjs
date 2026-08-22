import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import {buildPlanFor} from "../scripts/trigger/wrap.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const ENV = {gridSize: 100, distancePixels: 100};
const deps = () => ({assets: createAssets(offlineBackend(index)), armory: ARMORY});

function mockAction(overrides = {}) {
  const targetActor = {id: "a1"};
  const targetToken = {id: "t1", uuid: "Scene.s.Token.t1",
                       document: {elevation: 0, width: 1, height: 1, uuid: "Scene.s.Token.t1"},
                       center: {x: 600, y: 500}};
  return {
    id: "reactiveStrike", name: "反击",
    tags: new Set(["strike", "melee", "slashing"]),
    target: {type: "single", number: 1, distance: 1, scope: 2},
    range: {minimum: 0, maximum: 1}, cost: {action: 1, focus: 0, heroism: 0, health: 0},
    region: null, actor: {type: "hero"},
    token: {id: "t0", document: {elevation: 0, width: 1, height: 1}, center: {x: 500, y: 500}},
    targets: new Map([[targetActor, {token: targetToken}]]),
    usage: {damageType: "slashing", isAttack: true, isRanged: false,
            strikes: [{category: "balanced1", system: {damageType: "slashing"}}]},
    eventsByTarget: new Map([[targetActor,
      {all: [], roll: [{roll: {data: {result: 7, strike: 0}, isCriticalSuccess: false}}]}]]),
    ...overrides
  };
}

test("原生已产出配置时不接管，返回 null 计划", () => {
  const plan = buildPlanFor(mockAction(), ENV, deps(), {nativeConfig: {components: {}}});
  assert.equal(plan, null, "原生有动画时本模组必须让位");
});

test("原生返回 null 时接管并产出计划", () => {
  const plan = buildPlanFor(mockAction(), ENV, deps(), {nativeConfig: null});
  assert.ok(plan, "应接管");
  assert.equal(plan.v, 1);
  assert.ok(plan.cues.length > 0);
});

test("计划可 JSON 往返，能安全塞进聊天卡 flag", () => {
  const plan = buildPlanFor(mockAction(), ENV, deps(), {nativeConfig: null});
  assert.deepEqual(JSON.parse(JSON.stringify(plan)), plan);
});

// Task 13 移交时抓到的简报缺陷：`mockAction({get tags(){throw…}})` 里的 overrides
// 对象一旦被 mockAction 内部 `{...defaults, ...overrides}` 展开就会立刻读取 getter
// 并抛错——这发生在 mockAction() 这次*调用*本身里，不是在 buildPlanFor 读 action.tags
// 的时候。光把 mockAction(...) 挪进 assert.doesNotThrow 的回调**救不了**这个用例：
// 展开求值照样发生在 mockAction() 内部，异常照样在拿到 broken 之前就抛出，
// assert.doesNotThrow 只会如实报"你说不该抛但它抛了"（实测过，此前的错误信息正是
// "Got unwanted exception. Actual message: boom"）。真正要测的是"snapshotAction 读
// action.tags 时抛错，buildPlanFor 接住它"，getter 必须晚到 snapshotAction 内部才被
// 触发——所以用 Object.defineProperty 在一个已经构造完成的正常 mockAction() 上*事后*
// 换掉 tags 属性：defineProperty 本身不会读取新 getter，只有后面真正访问
// `action.tags` 时才会触发，这样异常才发生在 buildPlanFor 的 try 块里而不是测试代码里。
test("快照阶段抛错时返回 null 而不外抛", () => {
  const broken = mockAction();
  Object.defineProperty(broken, "tags", {get() { throw new Error("boom"); }, configurable: true});
  assert.doesNotThrow(() => {
    assert.equal(buildPlanFor(broken, ENV, deps(), {nativeConfig: null}), null);
  });
});

test("同一动作两次产出完全相同的计划", () => {
  const a = buildPlanFor(mockAction(), ENV, deps(), {nativeConfig: null});
  const b = buildPlanFor(mockAction(), ENV, deps(), {nativeConfig: null});
  assert.deepEqual(a, b);
});

test("没有任何兵库规则匹配时返回 null 且不抛错（没有 Foundry 全局也一样）", () => {
  const emptyArmory = {cast: [], travel: [], impact: [], aftermath: [], persist: []};
  assert.doesNotThrow(() => {
    const plan = buildPlanFor(mockAction(), ENV, {assets: deps().assets, armory: emptyArmory},
      {nativeConfig: null});
    assert.equal(plan, null);
  });
});

test("plan.warnings 非空时会经 warn() 冒出来，规则本身的产出不受影响", () => {
  // 伪造一条 when() 必抛异常的最高优先级 cast 规则，混进真实兵库的其余槽——resolve()
  // 的 firstMatch 会记一条 warning 并降到下一条（真实兵库没有更高优先级的 cast 规则，
  // 所以 cast 槽本身直接落空，但 travel/impact/aftermath 仍会正常出内容，plan 不为
  // null），buildPlanFor 应该把这条 warning 转发给 warn()。
  const real = ARMORY;
  const brokenArmory = {
    ...real,
    cast: [{id: "__test_boom__", pri: 999999, when: () => { throw new Error("boom"); }, build: () => null}]
  };
  const realWarn = console.warn;
  const warns = [];
  console.warn = (...args) => warns.push(args.join(" "));
  try {
    const plan = buildPlanFor(mockAction(), ENV, {assets: deps().assets, armory: brokenArmory},
      {nativeConfig: null});
    assert.ok(plan, "travel/impact/aftermath 仍应正常产出内容");
    assert.ok(plan.warnings.length > 0, "resolve() 应该记下这条 warning");
    assert.ok(warns.some(line => line.includes("__test_boom__") && line.includes("boom")),
      "buildPlanFor 应该把 plan.warnings 转发给 warn()");
  } finally { console.warn = realWarn; }
});
