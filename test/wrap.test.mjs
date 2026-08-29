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
 * `ctx.geom.adjacent(target)` 决定短剑还是野太刀、`aim.towards` 冻结**目标**中心坐标、
 * `at` 与 `scale`（中心距）一起冻结**施法者**中心坐标。tokenGeom 一旦只认 placeable，
 * 这三样在 TokenDocument 上会分别退化成恒贴身、恒 (0,0)、恒同一个缩放——
 * 本用例的三段断言会同时变红。
 *
 * ⚠ 2026-08-29 批次 B 第 5 步改过口径：`at` 从目标改成**施法者**、`mirrorY` 不再跟
 * `onLeft`（它们守的是「贴图中心压在目标身上、靠翻转冒充方向」那套错几何，见
 * 施工清单 §0.2）。「几何真的传下来了」这件事改由 aim.towards（目标侧）与 scale
 * （两者的中心距）承担——**判据比原来更强**：scale 是连续量，坐标读成 (0,0) 会让它
 * 从 0.5 跳到 5，而旧的 mirrorY 只是个布尔。
 */
test("Critical-1：token 是 TokenDocument 时，坐标/贴身/左右一路传到计划里", () => {
  // 只取画面 cue：strike.melee 现在还会发风声与命中音，它们排在画面之前
  const melee = plan => plan.cues.find(c => c.rule === "strike.melee" && c.kind !== "sound");

  // 紧邻右侧：origin(500,500) 与 target(600,500) 边缘相接
  const near = melee(buildPlanFor(mockAction(), ENV, deps(), {nativeConfig: null}));
  assert.ok(near, "strike.melee 应该匹配");
  assert.deepEqual([near.at.x, near.at.y], [500, 500],
    "at 必须冻结施法者 TokenDocument 的真实中心；读成 (0,0) 说明又按 placeable 的 token.center 取了");
  assert.equal(near.at.uuid, "Scene.s.Token.t0");
  assert.deepEqual([near.aim.towards.x, near.aim.towards.y], [600, 500],
    "瞄准点必须冻结目标 TokenDocument 的真实中心");
  assert.equal(near.aim.towards.tokenId, "t1");
  // 中心距 1 格 ÷ 授权网格 200/100 = 0.5。坐标退化成 (0,0) 时这里会变成 5×0.5=2.5 以上。
  assert.equal(near.scale, 0.5, "尺寸＝中心距，两端坐标任何一侧读错都会立刻偏掉");
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

  // 隔 9 格：adjacent 必须为假，否则就是「恒贴身」的老 bug
  const far = melee(buildPlanFor(mockAction({targetCenter: {x: 1500, y: 500}}), ENV, deps(),
    {nativeConfig: null}));
  assert.deepEqual([far.aim.towards.x, far.aim.towards.y], [1500, 500]);
  assert.equal(far.scale, 5, "中心距 10 格 ÷ 授权网格 200/100 —— 尺寸必须跟着距离走");
  // 判据变迁：时长 → 素材名 → **尺寸**。
  //
  // 原来断言 `far.file` 匹配 /Nodachi/：改造前隔格一律换成野太刀，因为它是全族唯一
  // 1000×800、弧幅够得到隔一格的一支——本质是**拿画幅冒充长度**，代价是施工清单 §0.14
  // 记的「48 件真能够到的近战武器塌成同一记野太刀下劈」。
  //
  // 批次 B 之后长度是几何量（握把锚施法者、刀锋锚目标、`scale` = 中心距），批次 C+D 的
  // D3 因此让隔格保留武器自己的形制。素材名不再区分两档，**上面那句
  // `far.scale === 5` 才是「adjacent 没有恒真」的直接证据**，而且比看名字强：
  // 名字对了距离仍可能算错，尺寸对了距离一定是对的。
  //
  // 这里保留一条素材侧的断言，守的是另一件事：别掉进兜底。
  assert.ok(clipOf(far.file), "隔格所选素材必须在时序表里——查不到就会退回硬编码常数，节拍与画面脱节");
  assert.notEqual(far.scale, near.scale,
    "贴身与隔格的尺寸必须不同；相等说明 adjacent 恒真或 scale 退化成了常数");
  assert.match(near.file, /ShortSword/i, "贴身分支必须是短剑");
  // 同上：素材**应当**保持一致（武器身份在隔格时不该丢），长度由 scale 表达。
  assert.equal(far.file, near.file,
    "同一件武器在贴身与隔格应当是同一支形制——换素材就是又回到「拿画幅冒充长度」，"
    + "48 件够得到的近战武器会再次塌成同一记野太刀下劈（施工清单 §0.14）");

  // 紧邻左侧：坐标必须真的往左走。旧断言是「mirrorY 必须翻真」——那守的是靠翻转贴图
  // 冒充方向的错几何；现在方向由 at(施法者) → aim(目标) 这条真旋转表达，判据换成
  // 「瞄准点落在施法者西侧」，比布尔镜像更直接地钉住方向感知。
  const left = melee(buildPlanFor(mockAction({targetCenter: {x: 400, y: 500}}), ENV, deps(),
    {nativeConfig: null}));
  assert.deepEqual([left.aim.towards.x, left.aim.towards.y], [400, 500]);
  assert.deepEqual([left.at.x, left.at.y], [500, 500], "锚点仍在施法者，不随目标左右跑");
  assert.ok(left.aim.towards.x < left.at.x, "目标在左侧时，攻击轴必须指向屏幕西侧");
  assert.ok(near.aim.towards.x > near.at.x, "目标在右侧时，攻击轴必须指向屏幕东侧");
});
