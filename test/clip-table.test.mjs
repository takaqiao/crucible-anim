/**
 * 时序表守卫 —— `scripts/armory/clip-table.mjs` 是生成物，这里核它有没有生成对。
 *
 * ## 为什么需要一条单独的守卫
 *
 * 兵库规则用 `clipOf(file)` 算 `duration` 与 `waitUntilFinished`。第一版我在
 * `test/wrap.test.mjs` 里写的是
 *
 *     assert.equal(near.waitUntilFinished, clip.contactMs - clip.durationMs)
 *
 * ——**那是同义反复**：等号两边都来自同一张生成表，把生成规则改错（比如命中时刻改成
 * 用总帧数而不是峰值帧）两边一起变，测试照绿。变异验证当场逮到了这个洞。
 *
 * 所以这里**不读生成表去核生成表**，而是回到源头 `data/asset-profiles.json`，
 * 拿它自己重算一遍再对照。
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {CLIP, clipOf} from "../scripts/armory/clip-table.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const profiles = JSON.parse(readFileSync(join(ROOT, "data/asset-profiles.json"), "utf8")).profiles;
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));

test("表里每条都与 data/asset-profiles.json 的实测一致（不是从表核表）", () => {
  const bad = [];
  for (const [file, row] of Object.entries(CLIP)) {
    const p = profiles[file];
    if (!p) { bad.push(`${file}: 量测里没有这个文件`); continue; }
    const want = [p.frames, p.fps, p.peak, p.tailEmpty];
    if (row.length !== 4 || want.some((v, i) => v !== row[i])) {
      bad.push(`${file}: 表里 [${row}]，实测 [${want}]`);
    }
  }
  assert.ok(Object.keys(CLIP).length >= 200, `表里只有 ${Object.keys(CLIP).length} 条，是不是没重新生成？`);
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} 条与实测对不上——跑 npm run clips 重新生成`);
});

/**
 * 派生量的定义**逐条钉死**，且判据独立算自实测值。
 *
 * 这两条就是 wrap.test.mjs 那条同义反复没能守住的东西：
 *   · `contactMs` 必须来自**亮度峰值帧**。改成总帧数、改成中间帧、改成常数，这里都红。
 *     这个代理是验证过的——V1 手调的 strike.melee 交棒点 533ms 与
 *     `MeleeAttack01_ShortSword01_01` 的峰值 f16 @30fps 差 0ms。
 *   · `durationMs` 必须**裁掉空尾**。本库素材空尾中位数占三成以上，不裁的话
 *     `waitUntilFinished` 会白等那一段。
 */
test("contactMs 来自峰值帧、durationMs 裁掉空尾（判据独立算自实测）", () => {
  const bad = [];
  let checked = 0;
  for (const file of Object.keys(CLIP)) {
    const p = profiles[file];
    if (!p?.fps) continue;
    checked++;
    const c = clipOf(file);
    const wantContact = Math.round(p.peak / p.fps * 1000);
    const wantDuration = Math.round((p.frames - p.tailEmpty) / p.fps * 1000);
    if (c.contactMs !== wantContact) bad.push(`${file}: contactMs ${c.contactMs}，按峰值帧应为 ${wantContact}`);
    if (c.durationMs !== wantDuration) bad.push(`${file}: durationMs ${c.durationMs}，裁掉空尾应为 ${wantDuration}`);
    if (c.handoffMs !== c.contactMs - c.durationMs) bad.push(`${file}: handoffMs 不等于 contactMs - durationMs`);
  }
  assert.ok(checked >= 200, `只核了 ${checked} 条`);
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} 条派生量算错了`);
});

/**
 * 覆盖面：兵库能取到的每个文件都必须在表里。
 *
 * `ctx.pick` 会在一个 DB 节点下的变体与颜色分支里按种子随机取一个，**任何一支取不到
 * 时序就会退回常数**——而那个常数正是本轮要消灭的东西（一条规则服务 20 多种形制，
 * 命中时刻从 167ms 到 633ms）。素材库升级新增文件时，这条会先红。
 */
test("兵库能取到的每个素材文件都在表里", () => {
  const NS = Object.keys(index.tree);
  const re = new RegExp(`["'\`]((?:${NS.join("|")})\.[a-zA-Z0-9_.-]+)["'\`]`, "g");
  const strip = src => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  const dir = join(ROOT, "scripts/armory");
  const paths = new Set();
  for (const f of readdirSync(dir).filter(x => x.endsWith(".mjs"))) {
    const src = strip(readFileSync(join(dir, f), "utf8"));
    let m;
    const r = new RegExp(re.source, "g");
    while ((m = r.exec(src))) paths.add(m[1]);
  }
  const filesUnder = path => {
    let node = index.tree;
    for (const seg of path.split(".")) {
      if (!node || typeof node !== "object" || Array.isArray(node)) return [];
      node = node[seg];
    }
    const out = [];
    const walk = n => {
      if (typeof n === "string") { out.push(n); return; }
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (n && typeof n === "object") for (const k of Object.keys(n)) if (!k.startsWith("_")) walk(n[k]);
    };
    walk(node);
    return [...new Set(out)].filter(f => /\.(webm|mp4)$/i.test(f));
  };
  const missing = [];
  for (const p of paths) {
    for (const f of filesUnder(p)) {
      if (!(f in CLIP) && profiles[f]) missing.push(`${p} → ${f}`);
    }
  }
  assert.deepEqual(missing.slice(0, 8), [],
    `${missing.length} 个兵库能取到的文件不在时序表里——跑 npm run clips 重新生成`);
});
