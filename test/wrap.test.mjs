import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import {tokenDoc} from "../tools/token-mocks.mjs";
import {buildPlanFor} from "../scripts/trigger/wrap.mjs";
import {clipOf} from "../scripts/armory/clip-table.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const ENV = {gridSize: 100, distancePixels: 100};
const deps = () => ({assets: createAssets(offlineBackend(index)), armory: ARMORY});

/**
 * 包装体拿到的是**活的 CrucibleAction**，它的 `token` 与 `targets.get(actor).token`
 * 都是 **TokenDocument**，不是 Token placeable：`CrucibleAction.#getTargetFromToken`
 * （crucible/module/models/action.mjs:1541-1545）在写进 targets 之前显式
 * `if (token instanceof Token) token = token.document`，action.mjs:1719 的注释也把
 * 这件事写死了——「`token` is a placeable from game.user.targets while this.token is
 * a TokenDocument」。
 *
 * 这个 mock 此前造的是 `{id, document:{width,height}, center:{x,y}}`——一个混合了
 * 两种形状、现实中不存在的对象。tokenGeom 照着它写，于是线上 x/y 恒 0、贴身判定
 * 恒真，而 277 条测试一条都抓不到。token 形状一律从 tools/token-mocks.mjs 取。
 *
 * `targetCenter` 提出来单独给，是因为覆盖 `targets` 的同时必须用同一个 actor 键
 * 覆盖 `eventsByTarget`，直接从 overrides 传两个 Map 很容易写歪。
 */
function mockAction({targetCenter = {x: 600, y: 500}, ...overrides} = {}) {
  const targetActor = {id: "a1"};
  const targetToken = tokenDoc({id: "t1", center: targetCenter});
  return {
    id: "reactiveStrike", name: "反击",
    tags: new Set(["strike", "melee", "slashing"]),
    target: {type: "single", number: 1, distance: 1, scope: 2},
    range: {minimum: 0, maximum: 1}, cost: {action: 1, focus: 0, heroism: 0, health: 0},
    region: null, actor: {type: "hero"},
    token: tokenDoc({id: "t0", center: {x: 500, y: 500}}),
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

/**
 * Critical-1 的端到端闸门：从「Crucible 真会交出来的对象」一路走到计划里的坐标与选材。
 *
 * `strike.melee`（scripts/armory/travel.mjs）同时消费三样几何：
 * `ctx.geom.adjacent(target)` 决定短剑（933ms）还是野太刀（767ms）、
 * `ctx.geom.onLeft(target)` 决定 mirrorY、`aim.towards` 与 `at` 冻结目标中心坐标。
 * tokenGeom 一旦只认 placeable，这三样在 TokenDocument 上会分别退化成
 * 恒贴身、恒不镜像、恒 (0,0)——本用例的三段断言会同时变红。
 */
test("Critical-1：token 是 TokenDocument 时，坐标/贴身/左右一路传到计划里", () => {
  const melee = plan => plan.cues.find(c => c.rule === "strike.melee");

  // 紧邻右侧：origin(500,500) 与 target(600,500) 边缘相接
  const near = melee(buildPlanFor(mockAction(), ENV, deps(), {nativeConfig: null}));
  assert.ok(near, "strike.melee 应该匹配");
  assert.deepEqual([near.at.x, near.at.y], [600, 500],
    "at 必须冻结 TokenDocument 的真实中心；读成 (0,0) 说明又按 placeable 的 token.center 取了");
  assert.equal(near.at.uuid, "Scene.s.Token.t1");
  assert.deepEqual([near.aim.towards.x, near.aim.towards.y], [600, 500]);
  // duration 现在**逐文件**从量测里取（armory/clip-table.mjs），不再是常数 933——
  // 短剑那一支的四个变体可播时长是 800-967ms 不等，而 ctx.pick 按种子随机取一个。
  // 这里只断言「取到了表里的值、且落在这一族的实测区间内」，不钉死某个数字：
  // 钉死等于把随机变体的选择也钉死，那是另一回事。
  assert.ok(near.duration >= 800 && near.duration <= 967,
    `贴身分支（短剑）时长 ${near.duration}ms 不在实测区间 800-967ms 内`);
  // 交棒点必须与所选变体的实测命中时刻一致，不是常数
  const clip = clipOf(near.file);
  assert.ok(clip, "短剑素材必须在时序表里");
  assert.equal(near.waitUntilFinished, clip.contactMs - clip.durationMs,
    "交棒点要按这一支素材自己的命中时刻算");
  assert.equal(near.mirrorY, false);

  // 隔 9 格：adjacent 必须为假，否则就是「恒贴身」的老 bug
  const far = melee(buildPlanFor(mockAction({targetCenter: {x: 1500, y: 500}}), ENV, deps(),
    {nativeConfig: null}));
  assert.deepEqual([far.at.x, far.at.y], [1500, 500]);
  // 分支判据改成看**素材本身**，不再看时长：两支的时长现在都从量测里逐文件取
  // （armory/clip-table.mjs），恰好可能相同，用它区分分支已经失效——而「选到了哪一支」
  // 本来就是这条测试真正要查的东西。
  assert.match(far.file, /Nodachi/i, "隔格分支必须是野太刀；选到短剑说明 adjacent 恒真");
  assert.match(near.file, /ShortSword/i, "贴身分支必须是短剑");
  assert.notEqual(far.file, near.file, "贴身与隔格必须选到不同的素材");

  // 紧邻左侧：mirrorY 必须翻真（旧实现 onLeft 恒假，挥击永不镜像）
  const left = melee(buildPlanFor(mockAction({targetCenter: {x: 400, y: 500}}), ENV, deps(),
    {nativeConfig: null}));
  assert.equal(left.mirrorY, true, "目标在左侧时必须 mirrorY");
  assert.deepEqual([left.at.x, left.at.y], [400, 500]);
});
