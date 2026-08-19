import {test} from "node:test";
import assert from "node:assert/strict";
import {edgesIntersect, isOnLeft, hashSeed, snapshotAction}
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
