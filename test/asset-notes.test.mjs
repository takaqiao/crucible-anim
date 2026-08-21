/**
 * docs/ASSET-NOTES.md 的守卫测试。
 *
 * 这份清单是后续四个兵库任务的选材依据，它唯一的价值在于「每条记录都对应一个
 * 实际看过图的真实文件」。所以这里守三件事：
 *   1. 表格里的路径都能在 data/asset-index.json 里无降级地解析出来，
 *      **且解析回来的路径与写下的路径逐字相等**（降级 = resolver 沿点分路径找不到
 *      某一级时自动取了第一个可用项；而 bestFit 还有一种更隐蔽的失配：路径尾部多写
 *      了一级时，while 循环遇到叶子就退出、剩余段被静默吞掉，diverged 仍是 false。
 *      只查 diverged 拦不住它，必须比对 r.path === p）；
 *   2. 表格行的形状合法——九列齐全、首列是反引号包起来的 DB 点分路径。
 *      （早先的实现用 `l.startsWith("| \`")` 挑行，首列忘记加反引号的行会被所有断言
 *        静默跳过，正好是手写 Markdown 表最容易犯的错；含斜杠的裸文件路径也要挡掉——
 *        resolve() 对含斜杠的输入直接短路返回，连存不存在都不查。）
 *   3. 五个视觉槽位都有选材（按行的槽位列取集合，不是全文档子串匹配），
 *      且每条记录的结构化字段没有留空或占位符。
 *
 * 兵库规则改选素材时先在 md 里补记录，这几条测试会跟着守住。
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const md = readFileSync(join(ROOT, "docs/ASSET-NOTES.md"), "utf8");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));

/**
 * 清单条目数下限。
 *
 * 第一轮侦察实际写入 93 行（cast 14 / travel 10 / impact 22 / aftermath 8 /
 * persist 17 / sound 22），全部经 resolver 复核为无降级。下限取实际行数而不是
 * brief 里估算的 61，这样删掉任何一条已侦察过的记录都会立刻失败——清单只能增补，
 * 不能悄悄缩水。将来若有素材被实机验证后否掉，改这个数字并在提交信息里说明。
 */
const MIN_ROWS = 93;

/** 每行的列数：路径/槽位/相位结构/锚点/帧数/stretchTo/mirrorY/自带闪爆/备注。 */
const COLS = 9;

/** 视觉五槽（sound 是音效层，不算在内）。 */
const SLOTS = ["cast", "travel", "impact", "aftermath", "persist"];

/**
 * 主表定位：以表头行为锚，取其后连续的表格行。
 * 文末附录（帧率清单、订正清单）里的表格因此不会被卷进来，
 * 而主表里格式跑偏的行也逃不掉——它只要还在表内就会被取到。
 */
function tableBlock() {
  const lines = md.split("\n");
  const head = lines.findIndex(l => l.startsWith("| DB 路径 |"));
  assert.ok(head >= 0, "找不到主表表头行（| DB 路径 | …）");
  const block = [];
  for (let i = head + 1; i < lines.length; i++) {
    if (!lines[i].startsWith("|")) break;
    block.push(lines[i]);
  }
  return block;
}

/** 主表里的数据行（去掉 | --- | 分隔行）。 */
function rows() {
  return tableBlock().filter(l => !/^\|\s*-{3,}\s*\|/.test(l));
}

/** 一行切成列：cols[0] 是行首空串，cols[1..COLS] 才是内容。 */
function cells(row) {
  return row.split("|").map(c => c.trim());
}

/** 抽出表格里第一列的 DB 路径。 */
function paths() {
  return rows().map(r => cells(r)[1].replace(/`/g, ""));
}

test("清单条目数达到覆盖五槽所需的规模", () => {
  assert.ok(paths().length >= MIN_ROWS,
    `只有 ${paths().length} 条，应 >= ${MIN_ROWS}`);
});

test("表格行的形状合法：九列齐全、首列是反引号包起来的 DB 点分路径", () => {
  for (const r of rows()) {
    const cols = cells(r);
    assert.equal(cols.length, COLS + 2, `列数不是 ${COLS}：${r.slice(0, 80)}`);
    const first = cols[1];
    assert.match(first, /^`[^`]+`$/,
      `首列不是反引号包起来的路径：${r.slice(0, 80)}`);
    const p = first.replace(/`/g, "");
    assert.match(p, /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/,
      `首列不是 DB 点分路径（裸文件路径 / 含空格）：${p}`);
  }
});

test("清单里每条路径都能无降级地解析，且解析结果与写下的路径逐字相等", () => {
  const bad = [];
  for (const p of paths()) {
    const a = createAssets(offlineBackend(index));
    const r = a.resolve(p);
    if (!r) bad.push(`${p} (解析失败)`);
    else if (r.diverged) bad.push(`${p} → ${r.path} (降级)`);
    else if (r.path !== p) bad.push(`${p} → ${r.path} (尾段被静默吞掉)`);
    else if (!r.files || r.files.length === 0) bad.push(`${p} (没有文件)`);
    else if (a.warnings.length) bad.push(`${p} (留下了降级警告)`);
  }
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} 条路径有问题`);
});

test("五个槽位都有选材", () => {
  // 按行的槽位列取集合，而不是在全文档里子串匹配 "| persist |"——
  // 后者被正文里随便一句话就能满足，删光某个槽的行也照样绿。
  const seen = new Set(rows().map(r => cells(r)[2]));
  for (const slot of SLOTS) {
    assert.ok(seen.has(slot), `槽位 ${slot} 无选材（表内出现的槽位：${[...seen].join("/")}）`);
  }
});

test("每条记录都填了相位结构与锚点，没有留空", () => {
  for (const r of rows()) {
    const cols = cells(r);
    for (let i = 1; i <= 5; i++) {
      assert.ok(cols[i] && cols[i] !== "-" && !/^(TBD|TODO|\?)$/i.test(cols[i]),
        `第 ${i} 列为空：${r.slice(0, 80)}`);
    }
  }
});

test("自带闪爆列只能是 是 / 否", () => {
  // impact 槽再叠通用闪光层会不会双闪，全靠这一列判断，留空或写别的值等于没记。
  for (const r of rows()) {
    const v = cells(r)[8];
    assert.ok(v === "是" || v === "否",
      `自带闪爆列不是「是」或「否」：${r.slice(0, 80)}`);
  }
});
