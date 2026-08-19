import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const actions = JSON.parse(readFileSync(join(ROOT, "test/fixtures/actions.json"), "utf8"));
const effects = JSON.parse(readFileSync(join(ROOT, "test/fixtures/effects.json"), "utf8"));

test("动作 fixture 数量达到预期规模", () => {
  // 简报预期 435 = 131+46+15+26 (compendium 四包) + 13 (DEFAULT_ACTIONS) + 204 (法术矩阵)。
  // 实测四包的原始动作数与简报table完全一致(131/46/15/26)。三个撞 id 经逐字段核实：
  // graveMark 两处内容全等（Crucible 核心与 Ember 间的移植，去重无害），但 steamVent
  // （"Burnout" vs "Steam Vent"）与 invisibility（"Natural Invisibility" vs 法术
  // "Invisibility"）两处内容并不相同、是两个独立动作。去重判据已改为内容签名
  // （id+tags+target+range+cost）而非纯 id，因此这两个 id 各保留 2 条、graveMark 保留 1
  // 条，理论值 435 - 1(graveMark 去重) = 434。
  assert.ok(actions.length >= 434, `只有 ${actions.length} 个，应 >= 434`);
});

test("合成法术矩阵 12 × 17 完整", () => {
  const spells = actions.filter(a => a.spell);
  const combos = new Set(spells.map(a => `${a.spell.rune}.${a.spell.gesture}`));
  assert.equal(combos.size, 204, `法术组合 ${combos.size} 个，应为 204`);
});

test("每个 fixture 的必填字段齐全", () => {
  for (const a of actions) {
    for (const k of ["id", "tags", "target", "range", "cost", "origin", "targets", "usage", "seed"]) {
      assert.ok(k in a, `${a.id} 缺字段 ${k}`);
    }
    assert.ok(Array.isArray(a.tags));
    assert.ok(Array.isArray(a.targets));
    assert.equal(typeof a.origin.x, "number");
    assert.equal(typeof a.seed, "number");
  }
});

test("同时覆盖贴身与隔格两种几何", () => {
  const adj = actions.filter(a => a.targets.some(t => t.adjacent));
  const far = actions.filter(a => a.targets.some(t => !t.adjacent));
  assert.ok(adj.length > 0 && far.length > 0);
});

test("状态 fixture 覆盖全部 46 个状态", () => {
  // 46 个，取自 statuses.mjs 的 statusEffects；不含 flanked——那是 derivedConditions
  // 里「由情境派生、不可赋予」的条件，永远不会作为 ActiveEffect 出现。
  assert.equal(effects.length, 46);
  assert.ok(!effects.some(e => e.statusId === "flanked"), "flanked 不应出现在状态 fixture 里");
  assert.ok(effects.every(e => e.statusId && typeof e.target.x === "number"));
});
