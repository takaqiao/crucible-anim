import {test} from "node:test";
import assert from "node:assert/strict";
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
  const targetToken = {
    id: "t1", uuid: "Scene.s.Token.t1",
    document: {elevation: 0, width: 1, height: 1},
    center: {x: 600, y: 500}
  };
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
    token: {id: "t0", document: {elevation: 0, width: 1, height: 1}, center: {x: 500, y: 500}},
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
  const dmgToken = {id: "t1", uuid: "Scene.s.Token.t1",
    document: {elevation: 0, width: 1, height: 1}, center: {x: 600, y: 500}};
  const healToken = {id: "t2", uuid: "Scene.s.Token.t2",
    document: {elevation: 0, width: 1, height: 1}, center: {x: 700, y: 500}};
  const dmgActor = {id: "a1"};
  const healActor = {id: "a2"};
  const action = {
    id: "test.mixedEvents", name: "混合事件",
    tags: new Set(), target: {type: "multiple", number: 2, distance: 5, scope: 2},
    range: {minimum: 0, maximum: 5}, cost: {action: 1, focus: 0, heroism: 0, health: 0},
    region: null, actor: {type: "hero"},
    token: {id: "t0", document: {elevation: 0, width: 1, height: 1}, center: {x: 500, y: 500}},
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
  const targetToken = {id: "t1", uuid: "Scene.s.Token.t1",
    document: {elevation: 0, width: 1, height: 1}, center: {x: 600, y: 500}};
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
    token: {id: "t0", document: {elevation: 0, width: 1, height: 1}, center: {x: 500, y: 500}},
    targets: new Map([[targetActor, {token: targetToken}]]),
    usage: {damageType: "slashing", isAttack: true, isRanged: false},
    eventsByTarget: new Map([[targetActor, {all: [mainHand, offHand], roll: []}]])
  };
  const s = snapshotAction(action, ENV);
  assert.deepEqual(s.targets[0].damage, {total: 10, type: "slashing", resource: "health"});
});

test("morale 资源动作（control/illusion/oblivion/soul 系）按 usage.resource 提取伤害，不硬编码 health", () => {
  const targetToken = {id: "t1", uuid: "Scene.s.Token.t1",
    document: {elevation: 0, width: 1, height: 1}, center: {x: 600, y: 500}};
  const targetActor = {id: "a1"};
  const moraleEvent = {resources: [{resource: "morale", delta: -5, damageType: "psychic"}], effects: []};
  const action = {
    id: "spell.oblivion.test", name: "湮灭术", tags: new Set(["spell"]),
    target: {type: "single", number: 1, distance: 5, scope: 2},
    range: {minimum: 0, maximum: 10}, cost: {action: 1, focus: 1, heroism: 0, health: 0},
    region: null, actor: {type: "hero"},
    token: {id: "t0", document: {elevation: 0, width: 1, height: 1}, center: {x: 500, y: 500}},
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
    token: {id: "t0", document: {elevation: 0, width: 1, height: 1}, center: {x: 500, y: 500}},
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
    token: {id: "t0", document: {elevation: 0, width: 1, height: 1}, center: {x: 500, y: 500}},
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

const TOKEN = () => ({
  id: "t1",
  document: {uuid: "Scene.s.Token.t1", width: 1, height: 1, elevation: 0},
  center: {x: 500, y: 500}
});

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
  // 表外的效果（天赋自定义效果等）原样返回 _id，由 generic.persist 兜底。
  assert.equal(statusIdOf({_id: "berserkerRage000"}), "berserkerRage000");
  assert.equal(statusIdOf(null), null);
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
    token: {id: "t0", document: {elevation: 0, width: 1, height: 1}, center: {x: 400, y: 500}},
    targets: new Map([[targetActor, {token: TOKEN()}]]),
    usage: {},
    eventsByTarget: new Map([[targetActor, {all: [ev], roll: []}]])
  };
  assert.deepEqual(snapshotAction(action, ENV).targets[0].effects, ["decaying", "dead"]);
});
