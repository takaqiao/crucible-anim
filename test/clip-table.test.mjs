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
    const want = [p.frames, p.fps, p.peak, p.tailEmpty, p.leadEmpty];
    if (row.length !== 5 || want.some((v, i) => v !== row[i])) {
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
    const wantLead = Math.round(p.leadEmpty / p.fps * 1000);
    if (c.leadMs !== wantLead) bad.push(`${file}: leadMs ${c.leadMs}，按空头帧应为 ${wantLead}`);
  }
  assert.ok(checked >= 200, `只核了 ${checked} 条`);
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} 条派生量算错了`);
});

/**
 * 覆盖面：兵库能取到的每个文件都必须**有量测**、并且在表里。
 *
 * `ctx.pick` 会在一个 DB 节点下的变体与颜色分支里按种子随机取一个，**任何一支取不到
 * 时序就会退回常数**——而那个常数正是本轮要消灭的东西（一条规则服务 20 多种形制，
 * 命中时刻从 167ms 到 633ms）。素材库升级新增文件时，这条会先红。
 *
 * ## 2026-08-30：拆掉 `&& profiles[f]`（否决复审 §三 第 1 条）
 *
 * 旧写法是 `if (!(f in CLIP) && profiles[f]) missing.push(...)`。那个 `&& profiles[f]`
 * 把**没有量测的文件整个跳过检查**——而「没量测」**正是**一个文件进不了 CLIP 的
 * 唯一原因（`npm run clips` 从 `data/asset-profiles.json` 生成，量测缺就没这一行）。
 * 也就是说：守卫恰好在真正的故障形态上闭眼，只在「量测有、表没重新生成」这种
 * 顺手就能发现的情况下报警。
 *
 * 这是**静默失效**，不是漏报一条边界：链路是
 * 「文件没量测 → `clipOf()` 返回 null → 规则退回硬编码常数 → 画面换了、节拍没换」。
 * 全仓所有量测里，只有「压根没量」是真正的硬阻塞（其余 flashRatio / darkLuma /
 * contentRatio 都只是排序与提示，不该单独否掉任何素材）。守卫必须守住这一个。
 *
 * 今天没有实际缺口（2026-08-30 实测：兵库 246 条 DB 路径 → 1000 个文件，
 * 缺量测 0、不在 CLIP 0），所以这次改动是**先把洞堵上**，不是修一个现行 bug。
 * 但暴露面早就在了：那 1000 个文件里 **288 个**不落在 `docs/ASSET-NOTES.md` 的族表
 * 前缀下，因而不受 `test/asset-families.test.mjs`「族内每一条都有量测」的覆盖；
 * 而全库索引 18127 个文件里已经有 **43 个没量测**。规则里换一条 DB 路径、
 * 或者素材库升级往在用的叶子下塞一个新文件，就够把其中一个拉进兵库。
 */
test("兵库能取到的每个素材文件都有量测、且都在表里", () => {
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
  const unmeasured = [];   // 硬阻塞：没量测 → clipOf 必然返回 null → 静默错拍
  const notInTable = [];   // 有量测却不在表里 → 生成物过期，跑一次 npm run clips 就好
  let reachable = 0;
  for (const p of paths) {
    for (const f of filesUnder(p)) {
      reachable++;
      if (!profiles[f]) { unmeasured.push(`${p} → ${f}`); continue; }
      if (!(f in CLIP)) notInTable.push(`${p} → ${f}`);
    }
  }

  /**
   * 反空真下限。上面这条是 ∀ 形状：`paths` 空掉（NS 正则失配、索引换了根命名空间、
   * 或 `scripts/armory` 被挪走）时两个数组恒为空，断言静默通过。
   *
   * ⚠ 这里**故意不套用 `asset-families.test.mjs` 那条「下限贴着实测、余量不超 5%」**：
   * 那边的基线数来自 `docs/ASSET-NOTES.md` 的族表，是人写的、改动有意为之；
   * 这边的数是从 `scripts/armory/*.mjs` 的源码里扫出来的，规则改一条 DB 路径就会浮动，
   * 贴死实测会让**别人正常的规则改动在这条守卫上误报**。所以下限只负责拦住
   * 「集合塌成 0 / 塌掉一大半」这种退化，取 2026-08-30 实测（246 条路径 / 1000 个文件）
   * 的八成，并把实测值写在这里备查。
   */
  assert.ok(paths.size >= 200,
    `只从 scripts/armory 扫出 ${paths.size} 条 DB 路径（2026-08-30 实测 246）——` +
    `正则或索引根命名空间变了，这条 ∀ 断言正在空真通过`);
  assert.ok(reachable >= 800,
    `兵库只能取到 ${reachable} 个文件（2026-08-30 实测 1000）——同上，前提集合塌了`);

  assert.deepEqual(unmeasured.slice(0, 8), [],
    `${unmeasured.length} 个兵库能取到的文件在 data/asset-profiles.json 里没有量测。` +
    `这是硬阻塞不是记账问题：clipOf() 会返回 null，规则退回硬编码常数，` +
    `画面换了而节拍没换（静默错拍）。跑 node tools/profile-family.mjs --db <前缀> 补量测，` +
    `再跑 npm run clips`);
  assert.deepEqual(notInTable.slice(0, 8), [],
    `${notInTable.length} 个兵库能取到的文件有量测却不在时序表里——跑 npm run clips 重新生成`);
});
