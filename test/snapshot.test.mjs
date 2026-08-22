import {test} from "node:test";
import assert from "node:assert/strict";
import {tokenDoc, tokenPlaceable} from "../tools/token-mocks.mjs";
import {edgesIntersect, isOnLeft, hashSeed, snapshotAction, snapshotEffect, statusIdOf}
  from "../scripts/trigger/snapshot.mjs";

const ENV = {gridSize: 100, distancePixels: 100};

test("edgesIntersect 认定相邻格为贴身、隔格为非贴身", () => {
  const a = {x: 500, y: 500, w: 100, h: 100};
  assert.equal(edgesIntersect(a, {x: 600, y: 500, w: 100, h: 100}), true);
  assert.equal(edgesIntersect(a, {x: 600, y: 600, w: 100, h: 100}), true, "斜相邻也算贴身");
  assert.equal(edgesIntersect(a, {x: 900, y: 500, w: 100, h: 100}), false);
});

test("大体型 token 的贴身判定按边缘而非中心", () => {
  const big = {x: 500, y: 500, w: 300, h: 300};      // 3x3, 半宽 150，右边缘在 x=650
  // 半宽 150 + 50 = 200，触边中心距应为 500+200=700（若按中心距硬编码 gridSize 阈值判断会误判为 false，
  // 这正是本测试要覆盖的「按边缘而非中心」场景）。
  assert.equal(edgesIntersect(big, {x: 700, y: 500, w: 100, h: 100}), true,
    "紧贴 3x3 右边缘应算贴身");
  assert.equal(edgesIntersect(big, {x: 1000, y: 500, w: 100, h: 100}), false);
});

test("isOnLeft 按中心 x 比较", () => {
  assert.equal(isOnLeft({x: 500, y: 500, w: 100, h: 100}, {x: 300, y: 500, w: 100, h: 100}), true);
  assert.equal(isOnLeft({x: 500, y: 500, w: 100, h: 100}, {x: 700, y: 500, w: 100, h: 100}), false);
});

test("hashSeed 确定、稳定、非负 32 位", () => {
  assert.equal(hashSeed("abc"), hashSeed("abc"));
  assert.notEqual(hashSeed("abc"), hashSeed("abd"));
  const h = hashSeed("reactiveStrike");
  assert.ok(Number.isInteger(h) && h >= 0 && h < 2 ** 32);
});

test("snapshotAction 提取全部必填字段并固化坐标", () => {
  const targetToken = tokenDoc({id: "t1", center: {x: 600, y: 500}});
  const targetActor = {id: "a1"};
  // 真实 CrucibleActionEvent 形状（见 crucible/module/models/action.mjs #_resolveEventStream）：
  // resources 是数组 [{resource, delta, damageType, restoration}]，不是 `ev.resource.health`。
  const rollEvent = {
    roll: {data: {result: 7, strike: 0}, isCriticalSuccess: false},
    resources: [{resource: "health", delta: -8, damageType: "slashing"}],
    effects: []
  };
  const action = {
    id: "reactiveStrike", name: "反击",
    tags: new Set(["strike", "melee", "slashing"]),
    target: {type: "single", number: 1, distance: 1, scope: 2},
    range: {minimum: 0, maximum: 1},
    cost: {action: 1, focus: 0, heroism: 0, health: 0},
    region: null,
    actor: {type: "hero"},
    token: tokenDoc({id: "t0", center: {x: 500, y: 500}}),
    targets: new Map([[targetActor, {token: targetToken}]]),
    usage: {damageType: "slashing", isAttack: true, isRanged: false,
            strikes: [{category: "balanced1", system: {damageType: "slashing"}}]},
    eventsByTarget: new Map([[targetActor, {
      all: [rollEvent], roll: [rollEvent]
    }]])
  };

  const s = snapshotAction(action, ENV);
  assert.equal(s.id, "reactiveStrike");
  assert.deepEqual(s.tags.sort(), ["melee", "slashing", "strike"]);
  assert.equal(s.origin.x, 500);
  assert.equal(s.targets.length, 1);
  assert.equal(s.targets[0].adjacent, true);
  assert.equal(s.targets[0].onLeft, false);
  assert.equal(s.targets[0].results[0].result, 7);
  assert.deepEqual(s.targets[0].damage, {total: 8, type: "slashing", resource: "health"});
  assert.equal(s.targets[0].healed, 0);
  assert.equal(s.usage.isAttack, true);
  assert.equal(s.spell, null);
  assert.equal(typeof s.seed, "number");
});

test("targets[].damage/healed 从 event.resources 数组提取（真实事件结构，非 ev.resource.health）", () => {
  const dmgToken = tokenDoc({id: "t1", center: {x: 600, y: 500}});
  const healToken = tokenDoc({id: "t2", center: {x: 700, y: 500}});
  const dmgActor = {id: "a1"};
  const healActor = {id: "a2"};
  const action = {
    id: "test.mixedEvents", name: "混合事件",
    tags: new Set(), target: {type: "multiple", number: 2, distance: 5, scope: 2},
    range: {minimum: 0, maximum: 5}, cost: {action: 1, focus: 0, heroism: 0, health: 0},
    region: null, actor: {type: "hero"},
    token: tokenDoc({id: "t0", center: {x: 500, y: 500}}),
    targets: new Map([[dmgActor, {token: dmgToken}], [healActor, {token: healToken}]]),
    usage: {damageType: "fire", isAttack: true, isRanged: true},
    eventsByTarget: new Map([
      [dmgActor, {all: [{resources: [{resource: "health", delta: -6, damageType: "fire"}], effects: []}], roll: []}],
      [healActor, {all: [{resources: [{resource: "health", delta: 4, restoration: true}], effects: []}], roll: []}]
    ])
  };
  const s = snapshotAction(action, ENV);
  const dmg = s.targets.find(t => t.tokenId === "t1");
  const heal = s.targets.find(t => t.tokenId === "t2");
  assert.deepEqual(dmg.damage, {total: 6, type: "fire", resource: "health"});
  assert.equal(dmg.healed, 0);
  assert.equal(heal.damage, null);
  assert.equal(heal.healed, 4);
});

test("双持攻击同一目标时伤害应累加，type 取伤害量最大的一条", () => {
  const targetToken = tokenDoc({id: "t1", center: {x: 600, y: 500}});
  const targetActor = {id: "a1"};
  // 双持角色对同一目标必然产生两个 strike 事件（见 crucible/module/const/action.mjs
  // 的 strike 标签 roll(target)：遍历 usage.strikes.entries()），各自带一条 resource:"health" 的 delta。
  const mainHand = {resources: [{resource: "health", delta: -6, damageType: "slashing"}], effects: []};
  const offHand = {resources: [{resource: "health", delta: -4, damageType: "piercing"}], effects: []};
  const action = {
    id: "test.dualWield", name: "双持", tags: new Set(),
    target: {type: "single", number: 1, distance: 1, scope: 2},
    range: {minimum: 0, maximum: 1}, cost: {action: 1, focus: 0, heroism: 0, health: 0},
    region: null, actor: {type: "hero"},
    token: tokenDoc({id: "t0", center: {x: 500, y: 500}}),
    targets: new Map([[targetActor, {token: targetToken}]]),
    usage: {damageType: "slashing", isAttack: true, isRanged: false},
    eventsByTarget: new Map([[targetActor, {all: [mainHand, offHand], roll: []}]])
  };
  const s = snapshotAction(action, ENV);
  assert.deepEqual(s.targets[0].damage, {total: 10, type: "slashing", resource: "health"});
});

test("morale 资源动作（control/illusion/oblivion/soul 系）按 usage.resource 提取伤害，不硬编码 health", () => {
  const targetToken = tokenDoc({id: "t1", center: {x: 600, y: 500}});
  const targetActor = {id: "a1"};
  const moraleEvent = {resources: [{resource: "morale", delta: -5, damageType: "psychic"}], effects: []};
  const action = {
    id: "spell.oblivion.test", name: "湮灭术", tags: new Set(["spell"]),
    target: {type: "single", number: 1, distance: 5, scope: 2},
    range: {minimum: 0, maximum: 10}, cost: {action: 1, focus: 1, heroism: 0, health: 0},
    region: null, actor: {type: "hero"},
    token: tokenDoc({id: "t0", center: {x: 500, y: 500}}),
    targets: new Map([[targetActor, {token: targetToken}]]),
    usage: {damageType: "psychic", isAttack: true, isRanged: true, resource: "morale"},
    eventsByTarget: new Map([[targetActor, {all: [moraleEvent], roll: []}]])
  };
  const s = snapshotAction(action, ENV);
  assert.deepEqual(s.targets[0].damage, {total: 5, type: "psychic", resource: "morale"});
  assert.equal(s.usage.resource, "morale");
});

test("快照是纯数据，JSON 往返后完全相等", () => {
  const action = {
    id: "defend", name: "防御", tags: new Set(["generic"]),
    target: {type: "self", number: 0, distance: 0, scope: 1},
    range: {minimum: 0, maximum: 0}, cost: {action: 1, focus: 0, heroism: 0, health: 0},
    region: null, actor: {type: "hero"},
    token: tokenDoc({id: "t0", center: {x: 500, y: 500}}),
    targets: new Map(), usage: {}, eventsByTarget: new Map()
  };
  const s = snapshotAction(action, ENV);
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
});

test("合成法术会带上 rune/gesture/inflection", () => {
  const action = {
    id: "spell.storm.arrow", name: "风暴箭",
    tags: new Set(["spell", "composed", "electricity"]),
    target: {type: "single", number: 1, distance: 5, scope: 2},
    range: {minimum: 0, maximum: 10}, cost: {action: 1, focus: 1, heroism: 0, health: 0},
    region: null, actor: {type: "hero"},
    token: tokenDoc({id: "t0", center: {x: 500, y: 500}}),
    targets: new Map(), usage: {damageType: "electricity", isAttack: true, isRanged: true},
    eventsByTarget: new Map(),
    rune: {id: "storm"}, gesture: {id: "arrow"}, inflection: {id: "extend"}
  };
  const s = snapshotAction(action, ENV);
  assert.deepEqual(s.spell, {rune: "storm", gesture: "arrow", inflection: "extend"});
});

/* -------------------------------------------- */
/*  statusIdOf / snapshotEffect                  */
/* -------------------------------------------- */

/**
 * snapshotEffect 的 token 走的是 `Actor#getActiveTokens()`（foundry
 * client/documents/actor.mjs:286-296，document 参数为假时 push 的是 `t.object`），
 * 也就是 **Token placeable**——与动作路径的 TokenDocument 是两种对象，
 * 所以这里刻意用 tokenPlaceable() 而不是 tokenDoc()。
 */
const TOKEN = () => tokenPlaceable({id: "t1", center: {x: 500, y: 500}});

test("statusIdOf 优先取 statuses[0]，即使它与效果来源的状态 id 不同", () => {
  // entropy 的 generator 产出 statuses:["frightened"]（crucible/module/const/effects.mjs）。
  // 落地的效果**真的**是恐惧而不是熵，所以取 frightened 才对得上角色身上的状态。
  assert.equal(statusIdOf({_id: "entropy000000000", statuses: ["frightened"]}), "frightened");
  // 复合效果取首元素：freezing 的 generator 同时给 slowed。
  assert.equal(statusIdOf({_id: "freezing00000000", statuses: ["freezing", "slowed"]}), "freezing");
  // ActiveEffect 文档上 statuses 是 Set，同样只取第一个。
  assert.equal(statusIdOf({id: "x", statuses: new Set(["poisoned"])}), "poisoned");
});

test("statusIdOf 把没有 statuses 的 DoT 效果按 _id 翻回规范状态 id", () => {
  // corroding/decay/irradiated/mending/inspired 五个 generator 不写 statuses；战斗直调
  // （符文暴击 → event.effects.push）落地的 ActiveEffect 因此一个状态都不带，只剩
  // generator 里写死的 16 位补零 _id。不翻译的话这五个状态会全部掉进 generic.persist。
  assert.equal(statusIdOf({_id: "corroding0000000"}), "corroding");
  assert.equal(statusIdOf({_id: "decaying00000000", statuses: []}), "decaying");
  assert.equal(statusIdOf({_id: "irradiated000000"}), "irradiated");
  assert.equal(statusIdOf({_id: "mending000000000"}), "mending");
  assert.equal(statusIdOf({_id: "inspired00000000"}), "inspired");
  // 表外的效果不是状态，返回 null。GENERATED_EFFECT_STATUS 是 test/source-tables.test.mjs
  // 从 const/effects.mjs 逐项反推出来的完整集合（「没有 statuses 字段的 generator 的 _id」），
  // Crucible 将来新增这类 generator 会先让那条测试变红、强制补表，所以这里退回 null 不会
  // 漏掉真状态；而放行裸 _id 会让每一个纯记账 ActiveEffect（Amplify Affix 标记、aspect 抗性
  // 增益、senseCreature、Dominance 标记、GM 手搓效果）都挂上一圈 generic.persist 白环。
  assert.equal(statusIdOf({_id: "berserkerRage000"}), null);
  assert.equal(statusIdOf({id: "aBcD1234EfGh5678"}), null);
  assert.equal(statusIdOf(null), null);
});

test("纯记账 ActiveEffect（无 statuses、id 是真实文档 id）不产出持续特效", () => {
  // 回归钉：真实 ActiveEffect 文档的 id 永远非空，planForEffect 的 `if (!snapshot?.statusId)`
  // 这道闸只有在 statusIdOf 对非状态效果返回 null 时才拦得住它们。现有的
  // effects-trigger.test.mjs「无 statuses 的效果不产出计划」用的是 id:null，真实文档不可能
  // 如此，那条用例给的是虚假的安全感。
  const snap = snapshotEffect({uuid: "Actor.a.ActiveEffect.amplifyaffix0000",
                               statuses: new Set(), id: "amplifyaffix0000"},
                              tokenPlaceable({id: "t1", center: {x: 500, y: 500}}), ENV);
  assert.equal(snap.statusId, null);
});

test("snapshotEffect 取首个 status 与效果 uuid，几何来自 token", () => {
  const snap = snapshotEffect(
    {uuid: "Scene.s.Token.t1.ActiveEffect.abc", statuses: new Set(["burning"]), id: "abc"},
    TOKEN(), ENV);
  assert.equal(snap.statusId, "burning");
  assert.equal(snap.effectUuid, "Scene.s.Token.t1.ActiveEffect.abc");
  assert.equal(snap.target.tokenId, "t1");
  assert.equal(snap.target.uuid, "Scene.s.Token.t1");
  assert.deepEqual([snap.target.x, snap.target.y], [500, 500]);
});

test("snapshotEffect 的 statusId 走 statusIdOf，酸蚀不再退化成 16 位 _id", () => {
  const s = snapshotEffect({id: "corroding0000000", statuses: new Set(),
                            uuid: "Actor.a.ActiveEffect.corroding0000000"}, TOKEN(), ENV);
  assert.equal(s.statusId, "corroding");
  assert.equal(s.effectUuid, "Actor.a.ActiveEffect.corroding0000000");
  assert.equal(s.target.x, 500);
});

test("snapshotEffect 在没有 token 时返回 null，而不是造一份 (0,0) 兜底几何", () => {
  // 持续标记必须挂在某个 token 上（cue 带 attachTo:true）。照搬 snapshotAction 的原点
  // 兜底会在地图左上角挂一枚附着不到目标的光环；ActiveEffect 挂在当前场景没有 token
  // 的 actor 上是正常情形，正确答案是不画。
  const effect = {uuid: "Actor.a.ActiveEffect.abc", statuses: new Set(["burning"]), id: "abc"};
  assert.equal(snapshotEffect(effect, null, ENV), null);
  assert.equal(snapshotEffect(effect, undefined, ENV), null);
});

test("snapshotEffect 如实记录缺失的 uuid，不替它编一个", () => {
  // 下游 resolveEffect 靠这个 null 判断能不能安全地出 persist cue（见 keepTied）。
  const snap = snapshotEffect({statuses: new Set(["burning"]), id: "abc"}, TOKEN(), ENV);
  assert.equal(snap.effectUuid, null);
  assert.equal(snap.statusId, "burning");
});

test("snapshotAction 的 target.effects 同样过 statusIdOf", () => {
  // 与 snapshotEffect 是同一个坑的第二个现场：aftermath.kill 靠 effects.includes("dead")
  // 判定，而死亡走的是 toggleStatusEffect（带 statuses），酸蚀/腐朽走的是直调（不带）。
  const targetActor = {id: "a1"};
  const ev = {roll: null, resources: [],
              effects: [{_id: "decaying00000000"}, {_id: "x", statuses: ["dead"]}]};
  const action = {
    id: "spell.death.strike", tags: new Set(["spell"]),
    target: {type: "single", number: 1, distance: 1, scope: 2},
    range: {minimum: 0, maximum: 1}, cost: {action: 1, focus: 1, heroism: 0, health: 0},
    region: null, actor: {type: "hero"},
    token: tokenDoc({id: "t0", center: {x: 400, y: 500}}),
    targets: new Map([[targetActor, {token: tokenDoc({id: "t1", center: {x: 500, y: 500}})}]]),
    usage: {},
    eventsByTarget: new Map([[targetActor, {all: [ev], roll: []}]])
  };
  assert.deepEqual(snapshotAction(action, ENV).targets[0].effects, ["decaying", "dead"]);
});

/* -------------------------------------------- */
/*  Critical-1：TokenDocument vs Token placeable */
/* -------------------------------------------- */

/**
 * tokenGeom 此前只认 placeable（`token.center.x/y`、`token.document.width/height`），
 * 而动作路径交给它的其实是 **TokenDocument**——`CrucibleAction.#getTargetFromToken`
 * （crucible/module/models/action.mjs:1541-1545）显式 `if (token instanceof Token)
 * token = token.document`，action.mjs:1719 的注释也写死了「this.token is a
 * TokenDocument」。TokenDocument 上没有 `center` 也没有 `.document`，于是 x/y 恒 0、
 * width/height 恒 1：贴身判定恒真、onLeft 恒假、`ref:"point"` 的模板锚点全画在
 * 场景左上角。旧测试之所以全绿，是因为 mock 被手搓成了一个现实中不存在的混合形状。
 *
 * 这一组用例钉住「两种形状都要吃、且吃出同一份几何」。把 tokenGeom 改回只认
 * placeable，第一条与第三条立刻变红。
 */
test("Critical-1：TokenDocument 形状的 token 也能取出正确的 x/y/width", () => {
  const doc = tokenDoc({id: "t9", center: {x: 1250, y: 750}, width: 2, height: 3, elevation: 15});
  // 先自证 mock 本身是文档形状而不是 placeable 形状，否则这条用例什么也没测。
  assert.equal(doc.center, undefined, "TokenDocument 上不存在 center 取值器");
  assert.equal(doc.document, undefined, "TokenDocument 上不存在 .document");
  assert.deepEqual([doc.x, doc.y], [1150, 600], "文档的 x/y 是左上角，不是中心");

  const s = snapshotAction({
    id: "probe", tags: new Set(), target: {}, range: {}, cost: {}, region: null, actor: {},
    token: doc, targets: new Map(), usage: {}, eventsByTarget: new Map()
  }, ENV);
  assert.deepEqual([s.origin.x, s.origin.y], [1250, 750], "中心点必须走 getCenterPoint()");
  assert.deepEqual([s.origin.width, s.origin.height], [2, 3], "width/height 是格数");
  assert.deepEqual([s.origin.w, s.origin.h], [200, 300], "w/h 是像素，走 getSize()");
  assert.equal(s.origin.radiusPx, 150);
  assert.equal(s.origin.elevation, 15);
  assert.equal(s.origin.tokenId, "t9");
  assert.equal(s.origin.uuid, "Scene.s.Token.t9");
});

test("Critical-1：Token placeable 与它的 TokenDocument 取出的几何完全相同", () => {
  const opts = {id: "t9", center: {x: 1250, y: 750}, width: 2, height: 3, elevation: 15};
  const viaDoc = snapshotEffect({uuid: "u", statuses: new Set(["burning"])}, tokenDoc(opts), ENV);
  const viaPlaceable =
    snapshotEffect({uuid: "u", statuses: new Set(["burning"])}, tokenPlaceable(opts), ENV);
  assert.deepEqual(viaPlaceable.target, viaDoc.target,
    "同一个 token 的两种表示必须归一化成同一份几何");
  assert.deepEqual([viaPlaceable.target.x, viaPlaceable.target.y], [1250, 750]);
});

test("Critical-1：贴身/隔格/左右判定在 TokenDocument 上真的会变", () => {
  // 旧实现下三个目标的 x 全是 0，adjacent 恒 true、onLeft 恒 false。
  const a = {id: "a1"}, b = {id: "a2"}, c = {id: "a3"};
  const s = snapshotAction({
    id: "probe", tags: new Set(), target: {}, range: {}, cost: {}, region: null, actor: {},
    token: tokenDoc({id: "t0", center: {x: 500, y: 500}}),
    targets: new Map([
      [a, {token: tokenDoc({id: "adj", center: {x: 600, y: 500}})}],   // 紧邻右侧
      [b, {token: tokenDoc({id: "far", center: {x: 1500, y: 500}})}],  // 隔 9 格
      [c, {token: tokenDoc({id: "lft", center: {x: 400, y: 500}})}]    // 紧邻左侧
    ]),
    usage: {}, eventsByTarget: new Map()
  }, ENV);
  const by = Object.fromEntries(s.targets.map(t => [t.tokenId, t]));
  assert.deepEqual([by.adj.adjacent, by.adj.onLeft], [true, false]);
  assert.deepEqual([by.far.adjacent, by.far.onLeft], [false, false], "隔 9 格不能算贴身");
  assert.deepEqual([by.lft.adjacent, by.lft.onLeft], [true, true], "左侧目标 onLeft 必须为真");
});

test("Critical-1：seed 随施法者位置分散，不再因为坐标恒 0 而撞种", () => {
  const mk = center => snapshotAction({
    id: "probe", tags: new Set(), target: {}, range: {}, cost: {}, region: null, actor: {},
    token: tokenDoc({id: "t0", center}), targets: new Map(), usage: {}, eventsByTarget: new Map()
  }, ENV).seed;
  assert.notEqual(mk({x: 500, y: 500}), mk({x: 900, y: 300}));
});
