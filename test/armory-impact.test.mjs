import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {resolve} from "../scripts/resolver/resolve.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import {RESULT} from "../scripts/const.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const actions = JSON.parse(readFileSync(join(ROOT, "test/fixtures/actions.json"), "utf8"));
const mk = () => createAssets(offlineBackend(index));
const base = actions.find(a => a.tags.includes("strike") && a.targets.length);

function impactCues(result, {critical = false, damageType = "slashing"} = {}) {
  const s = {
    ...base, usage: {...base.usage, damageType},
    targets: [{...base.targets[0], results: [{result, critical}],
               damage: {total: 8, type: damageType, resource: "health"}}]
  };
  return resolve(s, {assets: mk(), armory: ARMORY}).cues.filter(c => c.slot === "impact");
}

test("8 种结果各自都产出 impact 内容", () => {
  for (const [name, code] of Object.entries(RESULT)) {
    const cues = impactCues(code);
    assert.ok(cues.length > 0, `结果 ${name} 无 impact`);
  }
});

test("命中与掠过叠加元素层，防御类不叠", () => {
  const layers = r => impactCues(r, {damageType: "fire"}).filter(c => c.layer === "element").length;
  assert.ok(layers(RESULT.HIT) >= 1, "命中应有元素层");
  assert.ok(layers(RESULT.GLANCE) >= 1, "掠过应有元素层");
  for (const r of [RESULT.ARMOR, RESULT.BLOCK, RESULT.PARRY, RESULT.RESIST,
                   RESULT.DODGE, RESULT.MISS]) {
    assert.equal(layers(r), 0, `结果 ${r} 不应有元素层`);
  }
});

test("掠过缩小到六成且不抖动", () => {
  const glance = impactCues(RESULT.GLANCE).find(c => c.layer === "result");
  const hit = impactCues(RESULT.HIT).find(c => c.layer === "result");
  assert.ok(glance.objectScale < hit.objectScale);
  assert.equal(impactCues(RESULT.GLANCE).some(c => c.kind === "shake"), false);
});

test("未命中与闪避走 missed，其余不走", () => {
  for (const r of [RESULT.MISS, RESULT.DODGE]) {
    const c = impactCues(r).find(x => x.kind === "effect");
    assert.equal(c.aim?.missed, true, `结果 ${r} 应 missed`);
  }
  const hit = impactCues(RESULT.HIT).find(x => x.kind === "effect");
  assert.equal(hit.aim?.missed, false);
});

test("暴击追加抖动轨且抖动只作用于目标 sprite", () => {
  const cues = impactCues(RESULT.HIT, {critical: true});
  const shake = cues.find(c => c.kind === "shake");
  assert.ok(shake, "暴击应有抖动");
  assert.equal(shake.at.ref, "target", "抖动必须锚在目标，不能是全屏");
  assert.ok(shake.intensity > 0 && shake.duration > 0);
});

test("12 种伤害类型的元素层各自可解析", () => {
  const seen = new Set();
  for (const d of ["bludgeoning", "corruption", "piercing", "slashing", "poison", "acid",
                   "fire", "cold", "electricity", "psychic", "radiant", "void"]) {
    const cues = impactCues(RESULT.HIT, {damageType: d});
    const el = cues.find(c => c.layer === "element");
    assert.ok(el?.file, `伤害类型 ${d} 无元素层素材`);
    seen.add(el.file);
  }
  assert.ok(seen.size >= 5, `12 种伤害类型只有 ${seen.size} 种视觉，区分度不足`);
});

test("每个 cue 的 playIf 与实际结果一致", () => {
  const cues = impactCues(RESULT.BLOCK);
  for (const c of cues) {
    assert.ok(["always", "block", "defended"].includes(c.playIf),
      `格挡场景下出现了 playIf=${c.playIf}`);
  }
});
