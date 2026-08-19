import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync, existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {resolve, resolveEffect} from "../scripts/resolver/resolve.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import {RESULT} from "../scripts/const.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FOUNDRY_DATA = "/root/fvtt14-data/Data";
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const actions = JSON.parse(readFileSync(join(ROOT, "test/fixtures/actions.json"), "utf8"));
const effects = JSON.parse(readFileSync(join(ROOT, "test/fixtures/effects.json"), "utf8"));
const mk = () => createAssets(offlineBackend(index));

test("覆盖率：每个动作都解析出至少一个 cue", () => {
  const empty = [];
  for (const s of actions) {
    const plan = resolve(s, {assets: mk(), armory: ARMORY});
    if (!plan || !plan.cues.length) empty.push(s.id);
  }
  assert.deepEqual(empty.slice(0, 20), [], `${empty.length} 个动作没有动画`);
});

test("零目标的攻击类动作必须解析出 cast cue", () => {
  // Crucible 的 composed 标签动作无条件把 usage.isAttack 设为 true，不看目标类型
  // （见 action.mjs 的 initialize()）；自我增益/召唤类法术（aspect/ward/conjure/create
  // 等 gesture）因此是 isAttack === true 但 targets 为空。travel/impact 按 targets
  // 循环触发，零目标时不会执行，起手动画必须由 cast 段自己兜住。这条测试锁的不是「至少
  // 一个 cue」的笼统覆盖率，而是「这类动作的 cue 具体来自 cast 段」这个机制本身——否则
  // 将来有人给这类动作在别的槽加了内容，覆盖率断言会绿，但起手动画依然缺失也不会被发现。
  const zeroTarget = actions.filter(a => a.usage.isAttack && !a.targets.length);
  assert.ok(zeroTarget.length > 0, "fixture 里应存在零目标的攻击类动作");
  const missing = [];
  for (const s of zeroTarget) {
    const plan = resolve(s, {assets: mk(), armory: ARMORY});
    const hasCast = plan?.cues?.some(c => c.slot === "cast");
    if (!hasCast) missing.push(s.id);
  }
  assert.deepEqual(missing, [], `${missing.length} 个零目标攻击动作没有 cast cue`);
});

test("覆盖率：8 种攻击结果各自都能解析", () => {
  const attack = actions.filter(a => a.usage.isAttack && a.targets.length).slice(0, 40);
  for (const base of attack) {
    for (const result of Object.values(RESULT)) {
      const s = {...base, targets: base.targets.map(t => ({...t, results: [{result, critical: false}]}))};
      const plan = resolve(s, {assets: mk(), armory: ARMORY});
      assert.ok(plan && plan.cues.length, `${base.id} 在结果 ${result} 下无动画`);
    }
  }
});

test("覆盖率：46 个状态都解析出持续特效", () => {
  const empty = [];
  for (const e of effects) {
    const plan = resolveEffect(e, {assets: mk(), armory: ARMORY});
    if (!plan || !plan.cues.length) empty.push(e.statusId);
  }
  assert.deepEqual(empty, [], `${empty.length} 个状态没有动画`);
});

test("路径存在性：所有 cue 引用的文件在磁盘上真实存在", () => {
  const missing = new Set();
  for (const s of actions) {
    const plan = resolve(s, {assets: mk(), armory: ARMORY});
    for (const c of plan?.cues ?? []) {
      if (!c.file || typeof c.file !== "string") continue;
      if (!existsSync(join(FOUNDRY_DATA, c.file))) missing.add(c.file);
    }
  }
  assert.deepEqual([...missing].slice(0, 10), [], `${missing.size} 个文件不存在`);
});

test("降级次数不超过阈值", () => {
  let diverged = 0, total = 0;
  for (const s of actions) {
    const assets = mk();
    resolve(s, {assets, armory: ARMORY});
    diverged += assets.warnings.length;
    total += 1;
  }
  const rate = diverged / total;
  assert.ok(rate < 0.15, `降级率 ${(rate * 100).toFixed(1)}%，超过 15% 说明兵库路径写错了`);
});
