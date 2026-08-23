/**
 * 生成 `scripts/armory/sound-table.mjs` —— 兵库用到的每个音效文件的**时序事实**。
 *
 * ## 为什么音效也要一张表
 *
 * 与画面同一个理由，而且更刺耳：**音效的「响」不在文件开头**。全库 7,322 条音频量测里，
 * `psfx.impacts.bludgeoning.v1` 的起音在 **210-240ms**、峰值在 250ms——把它按「命中时刻」
 * 排下去，玩家会在刀已经收招之后四分之一秒才听见那一声。psfx 家族的起音中位数是 200ms。
 *
 * 所以排音效的口径不是「什么时候开始播」，而是**「什么时候听见」**：
 *
 *     delay = 想让它响的时刻 − peakMs
 *
 * 表里给出 `peakMs`（响的时刻）、`onsetMs`（有声的起点）与 `effectiveMs`（有效声长，
 * 尾部静音已扣除）。
 *
 * ## 与 clip-table 的分工
 *
 * | | 单位 | 关键量 |
 * | --- | --- | --- |
 * | `clip-table.mjs` | 帧 | `contactMs` = 亮度峰值帧，画面「打中」的一刻 |
 * | `sound-table.mjs` | 毫秒 | `peakMs` = 响度峰值，声音「响」的一刻 |
 *
 * 两者都要对齐到同一个「命中时刻」，画面与声音才同步。
 *
 * 用法： node tools/gen-sound-table.mjs
 */
import {readFileSync, writeFileSync, readdirSync} from "node:fs";
import {join, dirname} from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const visual = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const sfx = JSON.parse(readFileSync(join(ROOT, "data/sfx-index.json"), "utf8"));
const audio = JSON.parse(readFileSync(join(ROOT, "data/audio-profiles.json"), "utf8"));
const profiles = audio.profiles ?? audio;

/** 两棵树都要查：psfx/blfx 之类在视觉索引里，MGS 的 canim 在 sfx 索引里。 */
const TREES = [visual.tree, sfx.tree];
const NS = [...new Set([...Object.keys(visual.tree), ...Object.keys(sfx.tree)])];
const PATH_RE = new RegExp(`["'\`]((?:${NS.join("|")})\.[a-zA-Z0-9_.-]+)["'\`]`, "g");
const stripComments = src => src
  .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

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

/** 音频扩展名。视觉路径同样会命中这里，但它们底下没有音频文件，自然被过滤掉。 */
const AUDIO = /\.(ogg|mp3|wav|m4a|flac|webm)$/i;

function filesUnder(path) {
  for (const tree of TREES) {
    let node = tree;
    let ok = true;
    for (const seg of path.split(".")) {
      if (!node || typeof node !== "object" || Array.isArray(node)) { ok = false; break; }
      node = node[seg];
    }
    if (!ok || node === undefined) continue;
    const out = [];
    const walk = n => {
      if (typeof n === "string") { out.push(n); return; }
      if (Array.isArray(n)) { n.forEach(walk); return; }
      if (n && typeof n === "object") for (const k of Object.keys(n)) if (!k.startsWith("_")) walk(n[k]);
    };
    walk(node);
    const hit = [...new Set(out)].filter(f => AUDIO.test(f) && profiles[f]);
    if (hit.length) return hit;
  }
  return [];
}

const files = new Map();
for (const p of armoryPaths()) {
  for (const f of filesUnder(p)) {
    const pr = profiles[f];
    files.set(f, [Math.round(pr.peakMs ?? 0), Math.round(pr.onsetMs ?? 0),
                  Math.round(pr.effectiveMs ?? pr.durationMs ?? 0)]);
  }
}

const rows = [...files.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  .map(([f, v]) => `  ${JSON.stringify(f)}: [${v.join(",")}]`).join(",\n");

const BT = "`";
const out = `/**
 * 兵库音效的时序事实 —— **本文件由 ${BT}tools/gen-sound-table.mjs${BT} 生成，不要手改。**
 *
 * 每条是 ${BT}[peakMs, onsetMs, effectiveMs]${BT}，来自 ${BT}data/audio-profiles.json${BT} 的全库量测。
 *
 * 排音效的口径是**「什么时候听见」**而不是「什么时候开始播」：psfx 家族的起音中位数
 * 是 200ms，${BT}psfx.impacts.bludgeoning.v1${BT} 更是 210-240ms 才有声。按命中时刻直接排，
 * 玩家会在刀收招之后才听见那一声。
 *
 * 重新生成： npm run sounds
 */

/** @type {Record<string, [peakMs: number, onsetMs: number, effectiveMs: number]>} */
export const SFX = Object.freeze({
${rows}
});

/**
 * 一条音效该在什么时候开始播，才能让它**在 ${BT}atMs${BT} 那一刻响**。
 *
 * @param {string|null|undefined} file
 * @param {number} atMs  想让它响的时刻（相对本条 cue 所在的时间基准）
 * @returns {{delay: number, startTime: number, peakMs: number, effectiveMs: number, lateBy: number}|null}
 *          null = 表里没有这个文件（调用方应退回 delay 0，不要静默按 0 当成对齐）
 */
export function soundAt(file, atMs = 0) {
  const s = SFX[file];
  if (!s) return null;
  const [peakMs, onsetMs, effectiveMs] = s;
  if (atMs >= peakMs) {
    return {delay: Math.round(atMs - peakMs), startTime: 0, peakMs, effectiveMs, lateBy: 0};
  }
  // 想让它响的时刻比它自己的峰值还早——延迟已经压到 0 仍然来不及。
  // 用 startTime 跳进音频：**只跳到起音为止**，那一段是纯静音，跳过去不损失任何声音
  //（psfx.impacts.bludgeoning.v1 的前 240ms 就是静音）。再往后跳会削掉真正的起振，
  // 而起振正是「打中」这个瞬态的听感来源，宁可晚一点也不削。
  const startTime = Math.min(onsetMs, Math.round(peakMs - atMs));
  const lateBy = Math.max(0, Math.round(peakMs - startTime - atMs));
  return {delay: 0, startTime, peakMs, effectiveMs, lateBy};
}
`;

writeFileSync(join(ROOT, "scripts/armory/sound-table.mjs"), out);
console.log(`${files.size} 个音效文件 → scripts/armory/sound-table.mjs`);
