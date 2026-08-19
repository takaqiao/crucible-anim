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
  // 实测四包的原始动作数与简报table完全一致(131/46/15/26)，但 dedup 用的 seen 集合
  // 命中了 3 个跨/同包重复的真实 action id (steamVent, invisibility, graveMark)，
  // 使去重后的合计比理论值少 3 —— 简报本身预告过这种情况"属正常"。故阈值下调为 432。
  assert.ok(actions.length >= 432, `只有 ${actions.length} 个，应 >= 432`);
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

test("状态 fixture 覆盖全部 47 个状态", () => {
  assert.equal(effects.length, 47);
  assert.ok(effects.every(e => e.statusId && typeof e.target.x === "number"));
});
