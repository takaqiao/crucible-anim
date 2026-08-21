/**
 * 「兵库 → ASSET-NOTES」结构性守卫。
 *
 * test/asset-notes.test.mjs 只查「表 → 索引」（表里的路径能不能在 data/asset-index.json
 * 里无降级解析）。那条测试完全不知道 scripts/armory/** 里实际用了哪些路径——所以兵库
 * 规则引用一条主表里没有、甚至是文末「被否掉的候选」明确否掉的路径，degradation-rate/
 * coverage 之类的断言照样全绿（bestFit 总能兜住、resolve() 总能返回点什么），这个坑
 * 正是 Task 9 review 抓到 `jb2a.cast_generic.03`（否决清单第一条）被当成 cast 槽兜底
 * 规则用了一整个任务的方式。
 *
 * 这里反过来查「兵库 → 表」：扫描 scripts/armory/**\/*.mjs 里所有 ctx.pick()/ctx.sound()
 * 调用的 DB 路径字面量，逐条判定合法当且仅当：
 *   (a) 精确命中主表的某一行，**或者**是主表某一行的父路径（规则传 {color} 时代码里
 *       写的正是不含颜色段的父路径，ctx.pick 会在运行时拼上 pickColor 选中的颜色分支）；
 *   且
 *   (b) 不在文末「被否掉的候选」清单里（含它自己的任何颜色叶子、也不能是某个否决条目
 *       的父路径或子路径——例如否掉的是 `a.b.c.red`，规则写 `a.b.c` 传 {color:"red"}
 *       同样该被拦下）。
 *
 * 扫描整个 armory 目录而不只是 cast.mjs，这样 Task 10/11/12 往 travel/impact/aftermath/
 * persist 里新增规则时，同一类「记录里查得到但选错了」的错误会被立刻拦住。
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const md = readFileSync(join(ROOT, "docs/ASSET-NOTES.md"), "utf8");

/** 主表：定位 `| DB 路径 |` 表头后连续的表格行，取第一列去掉反引号。与 asset-notes.test.mjs 同法。 */
function tablePaths() {
  const lines = md.split("\n");
  const head = lines.findIndex(l => l.startsWith("| DB 路径 |"));
  assert.ok(head >= 0, "找不到主表表头行（| DB 路径 | …）");
  const block = [];
  for (let i = head + 1; i < lines.length; i++) {
    if (!lines[i].startsWith("|")) break;
    block.push(lines[i]);
  }
  return block
    .filter(l => !/^\|\s*-{3,}\s*\|/.test(l))
    .map(r => r.split("|")[1].trim().replace(/`/g, ""));
}

/** 否决清单：文末「被否掉的候选」小节里 `- **`path`** — ...` 形式的条目。 */
function rejectedPaths() {
  const re = /^- \*\*`([^`]+)`\*\*/gm;
  const out = [];
  let m;
  while ((m = re.exec(md))) out.push(m[1]);
  return out;
}

/** scripts/armory/ 下所有 .mjs 文件（当前是平铺目录，未来若分子目录也能扫到）。 */
function armoryFiles() {
  const dir = join(ROOT, "scripts/armory");
  return readdirSync(dir, {withFileTypes: true})
    .filter(e => e.isFile() && e.name.endsWith(".mjs"))
    .map(e => join(dir, e.name));
}

/** 扫描一个文件里所有 ctx.pick(...)/ctx.sound(...) 调用的首个字符串字面量参数。 */
function pickedPaths(src) {
  const re = /ctx\.(?:pick|sound)\(\s*["']([^"']+)["']/g;
  const out = [];
  let m;
  while ((m = re.exec(src))) out.push(m[1]);
  return out;
}

/**
 * 已知的历史欠账：travel/impact/aftermath/persist 四个槽各自唯一的 pri:10 兜底规则，
 * 写于 ASSET-NOTES 存在之前（与本轮修掉的 jb2a.cast_generic.03 同源问题），分属
 * Task 10/11/12 尚未开始的迁移范围，不在本轮 Task 9 修复范围内。这里显式白名单，
 * 避免把不属于本轮的技术债务当成本轮的回归——但白名单只覆盖这 4 条已知路径，
 * 这几个文件里任何其它新路径仍会被下面的判定正常拦截。
 *
 * 这是一个只能变小、不能变大的逃生舱，靠下面两条测试钉死：
 *   1. 「不许新增」——条目数与内容都锁死成当前这 4 条，想加第 5 条测试立刻红。
 *   2. 「自动失效」——每条都必须仍被某个兵库文件实际引用；一旦 Task 10/11/12 把某条
 *      路径迁移到 ASSET-NOTES 认可的路径，白名单里那一条就成了无人引用的僵尸条目，
 *      测试会红，强制它被删掉。白名单因此会自我清算，不需要谁记得回来打扫。
 */
const LEGACY_UNVERIFIED = new Set([
  "jb2a.magic_missile",              // travel.mjs generic.travel，待 Task 10 迁移
  "jb2a.impact.004",                 // impact.mjs generic.impact，待 Task 11 迁移
  "jb2a.healing_generic.burst",      // aftermath.mjs generic.aftermath，待 Task 12 迁移
  "jb2a.extras.tmfx.outflow.circle.01" // persist.mjs generic.persist，待 Task 12 迁移
]);

/** 全部兵库文件里出现过的路径字面量（不去重来源文件，只关心「有没有人引用」）。 */
function allPickedPaths() {
  const out = new Set();
  for (const file of armoryFiles()) {
    for (const p of pickedPaths(readFileSync(file, "utf8"))) out.add(p);
  }
  return out;
}

test("兵库规则引用的每条 DB 路径都能在 ASSET-NOTES 主表里查到依据，且不在否决清单里", () => {
  const tbl = tablePaths();
  const rej = rejectedPaths();
  assert.ok(tbl.length >= 90, `主表行数异常：${tbl.length}`);
  assert.ok(rej.length >= 40, `否决清单条目数异常：${rej.length}`);

  const bad = [];
  for (const file of armoryFiles()) {
    const src = readFileSync(file, "utf8");
    for (const p of pickedPaths(src)) {
      if (LEGACY_UNVERIFIED.has(p)) continue;

      const exact = tbl.includes(p);
      const asPrefix = tbl.some(t => t.startsWith(p + "."));
      const rejected = rej.some(r => r === p || r.startsWith(p + ".") || p.startsWith(r + "."));

      if (!((exact || asPrefix) && !rejected)) {
        const reason = rejected ? "在否决清单里" : "主表里查不到依据（既非精确命中也非某行的父路径）";
        bad.push(`${file}: "${p}" — ${reason}`);
      }
    }
  }
  assert.deepEqual(bad, [], `${bad.length} 条兵库路径没有 ASSET-NOTES 依据或已被否决：\n${bad.join("\n")}`);
});

test("LEGACY_UNVERIFIED 白名单不许新增：条目数与内容锁死为当前已知的 4 条", () => {
  const KNOWN = [
    "jb2a.extras.tmfx.outflow.circle.01",
    "jb2a.healing_generic.burst",
    "jb2a.impact.004",
    "jb2a.magic_missile"
  ];
  assert.ok(LEGACY_UNVERIFIED.size <= 4,
    `LEGACY_UNVERIFIED 有 ${LEGACY_UNVERIFIED.size} 条，超过已知的 4 条——新增白名单项需要走评审，不能随手加`);
  assert.deepEqual([...LEGACY_UNVERIFIED].sort(), KNOWN,
    "LEGACY_UNVERIFIED 的内容与已知的 4 条不完全一致（可能被新增或替换了未经评审的条目）");
});

test("LEGACY_UNVERIFIED 白名单里每一条都仍被某个兵库文件实际引用（否则应删除）", () => {
  const referenced = allPickedPaths();
  const zombies = [...LEGACY_UNVERIFIED].filter(p => !referenced.has(p));
  assert.deepEqual(zombies, [],
    zombies.map(p => `白名单条目 "${p}" 已无人引用，说明对应任务已完成迁移，请从 LEGACY_UNVERIFIED 中删除`).join("\n"));
});
