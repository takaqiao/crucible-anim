import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync, existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {resolve, resolveEffect} from "../scripts/resolver/resolve.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import {RESULT} from "../scripts/const.mjs";
import {ELEMENT_LAYER} from "../scripts/armory/impact.mjs";
import {NO_PERSIST} from "../scripts/armory/persist.mjs";
import {FOUNDRY_DATA} from "../tools/paths.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
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

test("覆盖率：除 NO_PERSIST 外的状态都解析出持续特效", () => {
  const empty = [];
  for (const e of effects) {
    if (NO_PERSIST.includes(e.statusId)) continue;   // dead 刻意静默，见 armory/persist.mjs
    const plan = resolveEffect(e, {assets: mk(), armory: ARMORY});
    if (!plan || !plan.cues.length) empty.push(e.statusId);
  }
  assert.deepEqual(empty, [], `${empty.length} 个状态没有动画`);
  // 正向的「静默」断言在 test/armory-persist.test.mjs，两边合起来仍是全覆盖。
  assert.equal(effects.length, 46, "状态语料条数变了，NO_PERSIST 的豁免范围需要复核");
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

test("兵库规则不抛异常：全量 fixture 的 plan.warnings 恒为空", () => {
  // firstMatch / runBuild 会把规则抛出的异常降级成一条 warning 而不是让 resolve 崩掉。
  // 这条断言保证「降级」不会变成「无人察觉」：正常代码路径上一条警告都不该有。
  // （coneYScale 的张角截断告警也走这里，所以真实语料里出现超范围张角同样会被点出来。）
  const noisy = [];
  for (const s of actions) {
    const plan = resolve(s, {assets: mk(), armory: ARMORY});
    for (const w of plan?.warnings ?? []) noisy.push(`${s.id}: ${w}`);
  }
  // effects 侧同样要走一遍：persist 槽的 warning 通道（规则抛异常、persist cue 缺 tieTo
  // 被丢弃）从前完全没有被断言过，规则里的编程错误会一路静默到游戏里。
  for (const e of effects) {
    const plan = resolveEffect(e, {assets: mk(), armory: ARMORY});
    for (const w of plan?.warnings ?? []) noisy.push(`${e.statusId}: ${w}`);
  }
  assert.deepEqual(noisy.slice(0, 10), [], `${noisy.length} 条规则告警`);
});

test("覆盖率：12 种伤害类型的元素层都被全量语料行使过", () => {
  // 这条断言守的是「12 种伤害类型分层」这个交付物本身在**真实语料**上的回归网，而不是
  // 手写用例上的。判据是 impact 元素层 cue 自带的 `element` 字段（选中的 ELEMENT_LAYER
  // 键），不能用 cue.file 代替——bludgeoning/piercing/slashing 三键共用同一条血溅素材，
  // 按 file 统计这三支永远只看得见一支，测出来的「覆盖」是假的。
  //
  // 阈值取全等（12/12）而不是「至少 N 种」：
  //   · 语料现在真的能跑满 12 支——9 支来自法术矩阵（符文的 damageType，见
  //     tools/dump-fixtures.mjs 的 RUNE_DAMAGE，其中 kinesis 的 "physical" 经
  //     impact.mjs 的 DAMAGE_ALIAS 落到 bludgeoning）、slashing/piercing 来自 strike 与
  //     reactiveStrike 两个默认动作的武器（走 elementFor 的第 3 级回退），bludgeoning
  //     另有 throw/overrun 等带伤害标签的动作，所以全等是可达的，不需要为了让测试变绿
  //     而放宽；
  //   · 「至少 N 种」放过的正是这条测试要抓的那类回归：某一支符文/某一把武器的伤害类型
  //     断掉，整支元素静默退回血溅，而计数仍然 ≥ N。
  const seen = new Set();
  for (const s of actions) {
    const plan = resolve(s, {assets: mk(), armory: ARMORY});
    for (const c of plan?.cues ?? []) {
      if (c.slot !== "impact" || c.layer !== "element") continue;
      assert.ok(c.element, `${s.id} 的元素层 cue 没有 element 标注`);
      seen.add(c.element);
    }
  }
  const expected = Object.keys(ELEMENT_LAYER).sort();
  const missing = expected.filter(k => !seen.has(k));
  assert.deepEqual(missing, [],
    `${missing.length} 种伤害类型的元素层从未被语料跑到：${missing.join("、")}——` +
    "要么 tools/dump-fixtures.mjs 不再产出这些伤害类型，要么 impact.mjs 的回退链把它们吃掉了");
  assert.deepEqual([...seen].sort(), expected, "语料跑出了 ELEMENT_LAYER 之外的元素键");
});

test("元素层 cue 的 element 标注与实际素材路径一致", () => {
  // element 是给上一条覆盖断言当判据用的标注字段。标注和真正播出去的 file 一旦脱节，
  // 覆盖率就成了自说自话，所以这里逐条回查：file 必须属于该键在 ELEMENT_LAYER 里
  // 登记的那条路径解析出的文件集合。
  const assets = mk();
  const filesFor = new Map();
  for (const [key, spec] of Object.entries(ELEMENT_LAYER)) {
    const r = assets.resolve(spec.path);
    assert.ok(r, `ELEMENT_LAYER.${key} 的路径 ${spec.path} 解析不到`);
    filesFor.set(key, new Set(r.files));
  }
  const bad = [];
  for (const s of actions) {
    const plan = resolve(s, {assets: mk(), armory: ARMORY});
    for (const c of plan?.cues ?? []) {
      if (c.slot !== "impact" || c.layer !== "element") continue;
      if (!filesFor.get(c.element)?.has(c.file)) bad.push(`${s.id}: ${c.element} → ${c.file}`);
    }
  }
  assert.deepEqual(bad.slice(0, 5), [], `${bad.length} 条元素层 cue 的标注与素材不符`);
});
