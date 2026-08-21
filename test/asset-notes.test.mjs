/**
 * docs/ASSET-NOTES.md 的守卫测试。
 *
 * 这份清单是后续四个兵库任务的选材依据，它唯一的价值在于「每条记录都对应一个
 * 实际看过图的真实文件」。所以这里守两件事：
 *   1. 表格里的路径都能在 data/asset-index.json 里无降级地解析出来
 *      （降级 = resolver 沿点分路径找不到某一级时自动取了第一个可用项，
 *        结果路径不是作者写的那条，记录就和实际播放的素材对不上了）；
 *   2. 五个视觉槽位都有选材，且每条记录的结构化字段没有留空或占位符。
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

/** 表格行以 "| `" 开头；文末被否清单用的是无序列表，不会被误算进来。 */
function rows() {
  return md.split("\n").filter(l => l.startsWith("| `"));
}

/** 抽出表格里第一列的 DB 路径。 */
function paths() {
  return rows().map(l => l.split("|")[1].trim().replace(/`/g, ""));
}

test("清单条目数达到覆盖五槽所需的规模", () => {
  assert.ok(paths().length >= MIN_ROWS,
    `只有 ${paths().length} 条，应 >= ${MIN_ROWS}`);
});

test("清单里每条路径都能无降级地解析", () => {
  const bad = [];
  for (const p of paths()) {
    const a = createAssets(offlineBackend(index));
    const r = a.resolve(p);
    if (!r) bad.push(`${p} (解析失败)`);
    else if (r.diverged) bad.push(`${p} → ${r.path} (降级)`);
  }
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} 条路径有问题`);
});

test("五个槽位都有选材", () => {
  // sound 是音效层，不算在视觉五槽里，所以不列入这份断言。
  for (const slot of ["cast", "travel", "impact", "aftermath", "persist"]) {
    assert.ok(md.includes(`| ${slot} |`), `槽位 ${slot} 无选材`);
  }
});

test("每条记录都填了相位结构与锚点，没有留空", () => {
  for (const r of rows()) {
    const cols = r.split("|").map(c => c.trim());
    // cols[0] 是空串，cols[1..8] 是八列：路径/槽位/相位/锚点/帧数/stretchTo/mirrorY/备注
    assert.equal(cols.length, 10, `列数不是 8：${r.slice(0, 80)}`);
    for (let i = 1; i <= 5; i++) {
      assert.ok(cols[i] && cols[i] !== "-" && !/^(TBD|TODO|\?)$/i.test(cols[i]),
        `第 ${i} 列为空：${r.slice(0, 80)}`);
    }
  }
});
