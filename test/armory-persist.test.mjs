import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {resolve, resolveEffect} from "../scripts/resolver/resolve.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import persist from "../scripts/armory/persist.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const effects = JSON.parse(readFileSync(join(ROOT, "test/fixtures/effects.json"), "utf8"));
const actions = JSON.parse(readFileSync(join(ROOT, "test/fixtures/actions.json"), "utf8"));
const mk = () => createAssets(offlineBackend(index));
const planFor = id => resolveEffect(effects.find(e => e.statusId === id), {assets: mk(), armory: ARMORY});

test("persist 规则表规模", () => {
  assert.ok(persist.length >= 13, `只有 ${persist.length} 条（12 组 + 兜底）`);
});

test("每个 persist cue 都带 persist 与 tieTo，否则效果移除后动画不会清理", () => {
  for (const e of effects) {
    const plan = resolveEffect(e, {assets: mk(), armory: ARMORY});
    for (const c of plan.cues) {
      assert.equal(c.persist, true, `${e.statusId} 的 cue 没开 persist`);
      assert.equal(c.tieTo, e.effectUuid, `${e.statusId} 的 tieTo 不是 effectUuid`);
    }
  }
});

test("同组状态共用素材，不同组视觉可区分", () => {
  const f = id => planFor(id).cues[0].file;
  assert.equal(f("poisoned"), f("diseased"), "同组应共用");
  assert.notEqual(f("burning"), f("freezing"), "不同组应可区分");
  const groups = new Set(effects.map(e => planFor(e.statusId).cues[0].rule));
  assert.ok(groups.size >= 10, `46 个状态只归出 ${groups.size} 组，区分度不足`);
});

test("燃烧与冰冻命中专属规则而非兜底", () => {
  assert.notEqual(planFor("burning").cues[0].rule, "generic.persist");
  assert.notEqual(planFor("freezing").cues[0].rule, "generic.persist");
});

test("全部 46 个状态都归了组（不落在 generic.persist 兜底上）", () => {
  const fallback = effects.filter(e => planFor(e.statusId).cues[0].rule === "generic.persist");
  assert.deepEqual(fallback.map(e => e.statusId), [],
    `${fallback.length} 个状态没有命中任何一组，落在了兜底上`);
});

test("治疗动作产出 aftermath 辉光", () => {
  const base = actions.find(a => a.targets.length);
  const s = {...base, targets: [{...base.targets[0], healed: 12}]};
  const cues = resolve(s, {assets: mk(), armory: ARMORY}).cues.filter(c => c.slot === "aftermath");
  assert.ok(cues.length >= 1);
  assert.ok(cues[0].file);
});

test("兵库两文件均不引用绝对路径", () => {
  for (const f of ["aftermath.mjs", "persist.mjs"]) {
    const src = readFileSync(join(ROOT, "scripts/armory", f), "utf8");
    assert.ok(!src.includes("modules/"), `${f} 出现绝对路径`);
  }
});
