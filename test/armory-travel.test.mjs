import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {resolve} from "../scripts/resolver/resolve.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import travel from "../scripts/armory/travel.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const actions = JSON.parse(readFileSync(join(ROOT, "test/fixtures/actions.json"), "utf8"));
const mk = () => createAssets(offlineBackend(index));
const byId = id => actions.find(a => a.id === id);
const travelCues = s => resolve(s, {assets: mk(), armory: ARMORY})?.cues.filter(c => c.slot === "travel") ?? [];

const melee = () => ({
  ...byId("strike"),
  strikes: [{category: "balanced1", damageType: "slashing"}],
  usage: {...byId("strike").usage, isAttack: true, isRanged: false}
});

test("规则表规模与 id 唯一", () => {
  assert.ok(travel.length >= 10, `只有 ${travel.length} 条规则`);
  const ids = travel.map(r => r.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("射线姿态用 stretchTo 且带模板遮罩", () => {
  const c = travelCues(byId("spell.frost.ray"))[0];
  assert.equal(c?.rule, "spell.gesture.ray");
  assert.ok(c.stretchTo, "射线必须 stretchTo");
  assert.equal(c.mask, "region", "射线必须用模板遮罩，否则会溢出");
});

test("锥形姿态贴合模板张角", () => {
  const c = travelCues(byId("spell.flame.cone"))[0];
  assert.equal(c?.rule, "spell.gesture.cone");
  assert.ok(c.stretchTo);
  assert.equal(c.mask, "region");
});

test("近战贴身与隔格用不同素材", () => {
  const base = melee();
  const near = {...base, targets: [base.targets.find(t => t.adjacent)]};
  const far = {...base, targets: [base.targets.find(t => !t.adjacent)]};
  const a = travelCues(near)[0];
  const b = travelCues(far)[0];
  assert.ok(a && b);
  assert.notEqual(a.file, b.file, "贴身与隔格应换素材，否则长度对不上");
});

test("目标在左侧时挥击镜像", () => {
  const base = melee();
  const left = {...base, targets: [{...base.targets[0], onLeft: true, x: 300}]};
  const right = {...base, targets: [{...base.targets[0], onLeft: false, x: 700}]};
  assert.equal(travelCues(left)[0].mirrorY, true);
  assert.equal(travelCues(right)[0].mirrorY, false);
});

test("大体型施法者的挥击放大且偏移折半", () => {
  const base = melee();
  const big = {...base, origin: {...base.origin, width: 3},
               targets: [{...base.targets[0], adjacent: false}]};
  const small = {...base, targets: [{...base.targets[0], adjacent: false}]};
  const bc = travelCues(big)[0];
  const sc = travelCues(small)[0];
  assert.ok(bc.objectScale > sc.objectScale, "大体型应放大");
  assert.ok(bc.offset.x > sc.offset.x, "大体型应前移更多");
});

test("未命中时投射物走 missed", () => {
  const s = {...byId("spell.storm.arrow")};
  s.targets = [{...byId("strike").targets[0], results: [{result: 0, critical: false}]}];
  const c = travelCues(s)[0];
  assert.equal(c.aim?.missed, true);
});

test("爆发姿态没有飞行段", () => {
  const cues = travelCues(byId("spell.death.blast"));
  assert.equal(cues.length, 0, "blast 不应有 travel 内容");
});

test("travel 规则不引用绝对路径", () => {
  const src = readFileSync(join(ROOT, "scripts/armory/travel.mjs"), "utf8");
  assert.ok(!src.includes("modules/"));
});
