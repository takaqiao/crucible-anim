/**
 * 生成 `scripts/armory/clip-table.mjs` —— 兵库用得到的每个素材文件的**时序事实**。
 *
 * ## 为什么需要它
 *
 * 兵库里的 `duration` / `waitUntilFinished` 原本是手写常数。V1 时每条规则只对一两个
 * 素材，手调没问题；线 A 之后 `strike.melee` 一条规则要服务 **20 多种形制**，而各形制的
 * 命中时刻差得很远（咬击 167ms、突刺 233ms、短剑 400ms、巨剑 633ms），一个常数按不住。
 *
 * 更隐蔽的一层：**同一形制的几个变体峰值也不同**。短剑那一支的四个变体峰值是
 * f16 / f10 / f9 / f11，而 `ctx.pick` 按种子随机取一个——手调的 533ms 只对 `_01` 成立，
 * 取到另外三支就偏 166-233ms。所以这张表按**文件**而不是按路径。
 *
 * ## 「命中时刻 = 亮度峰值帧」这个代理是验证过的，不是假定
 *
 * V1 手调的 `strike.melee` 交棒点是 933-400 = **533ms**，而
 * `MeleeAttack01_ShortSword01_01` 的峰值帧 f16 @30fps = **533ms**，差 0ms——
 * 也就是当初那个手调值本来就是「_01 那一支的峰值」。野太刀（手调 367ms，峰值
 * 400-500ms）与拳击（手调 500ms，峰值 600ms）也都在 33-133ms 内。
 *
 * ⚠ 代理不是真理：亮度峰值是「画面最亮的一帧」，对挥砍类等于弧线拉满的瞬间，对别的
 * 形态未必。规则可以覆盖，表只提供事实。
 *
 * ## 输出的两个量
 *
 *   durationMs = (frames - tailEmpty) / fps × 1000   播到最后一帧有内容的地方
 *   contactMs  = peak / fps × 1000                   命中时刻
 *
 * 交棒点 `waitUntilFinished = contactMs - durationMs`（相对片尾的负偏移）。
 * `durationMs` 裁掉空尾这件事单独就值回票价：本库素材空尾中位数占三成以上，
 * 不裁的话 `waitUntilFinished` 会白等那一段。
 *
 * ## 为什么生成成 .mjs 而不是 .json
 *
 * 兵库是纯 JS、在 Foundry 里以 ESM 加载，读 JSON 要走 fetch（`register-sfx.mjs` 那套），
 * 而时序是**规则装配期**就要用的，不能是异步的。生成成模块直接 import 最省事。
 *
 * 用法： node tools/gen-clip-table.mjs
 */
import {readFileSync, writeFileSync, readdirSync} from "node:fs";
import {join, dirname} from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const profiles = JSON.parse(readFileSync(join(ROOT, "data/asset-profiles.json"), "utf8")).profiles;

const NS = Object.keys(index.tree);
/** 与 test/armory-assets.test.mjs 同一套抽取方式：三种引号都认。 */
const PATH_RE = new RegExp(`["'\`]((?:${NS.join("|")})\.[a-zA-Z0-9_.-]+)["'\`]`, "g");

const stripComments = src => src
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

function armoryPaths() {
  const dir = join(ROOT, "scripts/armory");
  const out = new Set();
  for (const f of readdirSync(dir).filter(x => x.endsWith(".mjs"))) {
    const src = stripComments(readFileSync(join(dir, f), "utf8"));
    let m;
    const re = new RegExp(PATH_RE.source, "g");
    while ((m = re.exec(src))) out.add(m[1]);
  }
  return [...out].sort();
}

/** 路径 → 它下面所有 webm（含颜色分支：规则可能按 pickColor 落到任意一支）。 */
function filesUnder(path) {
  let node = index.tree;
  for (const seg of path.split(".")) {
    if (!node || typeof node !== "object") return [];
    node = Array.isArray(node) ? undefined : node[seg];
  }
  const out = [];
  const walk = n => {
    if (typeof n === "string") { out.push(n); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n && typeof n === "object") for (const k of Object.keys(n)) if (!k.startsWith("_")) walk(n[k]);
  };
  walk(node);
  return [...new Set(out)].filter(f => /\.(webm|mp4)$/i.test(f));
}

const paths = armoryPaths();
const files = new Map();
const missing = [];
for (const p of paths) {
  for (const f of filesUnder(p)) {
    const pr = profiles[f];
    if (!pr) { missing.push(f); continue; }
    files.set(f, [pr.frames, pr.fps, pr.peak, pr.tailEmpty]);
  }
}

const rows = [...files.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  .map(([f, v]) => `  ${JSON.stringify(f)}: [${v.join(",")}]`).join(",\n");

const out = `/**
 * 兵库素材的时序事实 —— **本文件由 \`tools/gen-clip-table.mjs\` 生成，不要手改。**
 *
 * 每条是 \`[frames, fps, peak, tailEmpty]\`，来自 \`data/asset-profiles.json\` 的全库量测。
 * 覆盖面是「兵库里出现过的 DB 路径底下的全部文件」——包括颜色分支与变体，因为
 * \`ctx.pick\` 会在其中按种子随机取一个，时序必须逐文件成立。
 *
 * 为什么按文件而不是按路径：同一形制的变体峰值并不一致。短剑那一支四个变体的峰值是
 * f16 / f10 / f9 / f11，差 233ms；按路径取平均等于对四分之三的情况算错。
 *
 * 重新生成： npm run clips
 */

/** @type {Record<string, [frames: number, fps: number, peak: number, tailEmpty: number]>} */
export const CLIP = Object.freeze({
${rows}
});

/**
 * 一个素材文件的播放时长与命中时刻。
 *
 *   durationMs —— 播到最后一帧有内容的地方（裁掉空尾；本库空尾中位数占三成以上，
 *                 不裁的话 waitUntilFinished 会白等那一段）
 *   contactMs  —— 亮度峰值帧的时刻，当作「打中」的时刻
 *
 * 「亮度峰值 = 命中时刻」这个代理验证过：V1 手调的 strike.melee 交棒点 533ms 与
 * \`MeleeAttack01_ShortSword01_01\` 的峰值 f16 @30fps 差 0ms。⚠ 但它只是代理，
 * 对挥砍类成立不代表对所有形态成立，规则可以覆盖。
 *
 * @param {string|null|undefined} file
 * @returns {{durationMs: number, contactMs: number, handoffMs: number}|null}
 *          null = 表里没有这个文件（调用方应退回自己的常数，不要静默按 0 算）
 */
export function clipOf(file) {
  const c = CLIP[file];
  if (!c) return null;
  const [frames, fps, peak, tailEmpty] = c;
  if (!fps) return null;
  const durationMs = Math.round((frames - tailEmpty) / fps * 1000);
  const contactMs = Math.round(peak / fps * 1000);
  return {durationMs, contactMs, handoffMs: contactMs - durationMs};
}
`;

writeFileSync(join(ROOT, "scripts/armory/clip-table.mjs"), out);
console.log(`${files.size} 个文件（来自 ${paths.length} 条兵库路径）→ scripts/armory/clip-table.mjs`);
if (missing.length) {
  console.log(`⚠ ${missing.length} 个文件没有量测数据，未收录：`);
  for (const f of missing.slice(0, 8)) console.log(`    ${f}`);
}
