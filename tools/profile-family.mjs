/**
 * 批量机器量测素材，产出 `data/asset-profiles.json`。
 *
 * ## 它解决的问题
 *
 * `docs/ASSET-NOTES.md` 的主表现在 96 条，每条都是人抽帧读图的产物。V2 要引入的素材是
 * 600–1000 条量级，逐条人工读图不可能（见 `V2-PLAN.md` D4）。
 *
 * 但**只有一部分判断真的需要人眼**。下面这些全是客观可测的，可以对上千个文件跑：
 *
 * | 量 | 为什么要 |
 * | --- | --- |
 * | `frames` / `fps` | 兵库的 startTime/duration 是毫秒，换算要帧率。ASSET-NOTES 实测 71 条视觉记录里 **54% 不是整 30fps**（24 / 25 / 29.97 / 30 / 60 五种），按 30 算会短算 20% 或长算一倍 |
 * | `alpha` | 判据是容器 tag `alpha_mode=1`，不是 `pix_fmt`。没 alpha 的素材在深色地图上会露黑底 |
 * | `leadEmpty` / `tailEmpty` | 大量素材首尾有纯空帧，`waitUntilFinished` 会白等半秒到一秒；空头帧还会让 fadeIn 压在没画面的时段上 |
 * | `peak` | 主体爆发在第几帧。裁切点（startTime）必须避开它 |
 * | `flashRatio` | 素材**自带闪爆**时不能再叠闪光层（ASSET-NOTES 93 行里 29 行标「是」）。峰值亮度 ÷ 中位亮度就是它的客观形态 |
 * | `contentRatio` | 内容占画幅比。Sequencer 的 `scaleToObject` 按**目标宽 × scale** 定尺寸，源文件像素不参与，所以观感尺寸 = 内容占比 × objectScale——跨库混排（jb2a 400、eskie 800、blfx 1200）全靠它归一 |
 * | `darkLuma` | 合成到 0x303030 深色底后的平均亮度。C1 那条「dark_* 分支在暗地图上糊没」就是这个数字太低 |
 * | `loopDelta` | 首尾非空帧的差异。做持续光环要能无缝循环 |
 *
 * **机器测不了的只有一件：这个素材配不配这个动作。** 那个躲不掉，但只需对族的代表做，
 * 配合 `tools/family-sheet.sh`（一张图看 12 个候选的峰值帧）。
 *
 * ## 用法
 *
 *   node tools/profile-family.mjs --db jb2a.impact.011
 *   node tools/profile-family.mjs --dir "modules/eskie-effects/assets/Damage"
 *   node tools/profile-family.mjs --db eskie.damage --jobs 6 --step 2
 *
 * 结果按文件路径并进 `data/asset-profiles.json`，可以分多次跑、逐族累积。
 */
import {readFileSync, writeFileSync, existsSync, readdirSync} from "node:fs";
import {join, dirname, relative, sep, extname} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {FOUNDRY_DATA} from "./paths.mjs";
import {probeVideo, eachFrame} from "./media.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data/asset-profiles.json");

/**
 * 「有内容」的 alpha 阈值。取 26 与项目既有口径一致——`task-16-carried-items.md` 的 C19
 * 记录血泊内容占比时用的就是「alpha≥26 的包围盒」。低于它的像素是抗锯齿边缘的余晖，
 * 算进包围盒会让内容占比虚高。
 */
const ALPHA_FLOOR = 26;

/** 一帧的 alpha 总和低于峰值的这个比例，就算「空帧」。 */
const EMPTY_RATIO = 0.005;

/** Rec.709 亮度。alpha 加权——透明区不该拉低平均亮度。 */
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

/**
 * 量测一个文件。
 * @param {string} abs 绝对路径
 * @param {number} step 像素采样步长（每 step 个像素取一个，两个轴都用）。1 = 全采样。
 */
export async function profileAsset(abs, step = 2) {
  const meta = probeVideo(abs);
  const per = [];                       // 每帧的 {alphaSum, lumaSum, x0,y0,x1,y1}
  // 只留**亮度峰值**那一帧的像素，用来算暗底可读性。留整片会撑爆内存
  // （800×800×4 × 15 帧 = 38 MB，×1250 个文件不可能）。
  // 必须与下面 contentRatio 取的是同一帧，否则「内容有多大」和「内容有多亮」说的是两回事。
  let peakBuf = null, peakLumaSeen = -1;

  const info = await eachFrame(abs, (buf, w, h, n) => {
    let alphaSum = 0, lumaSum = 0;
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y += step) {
      const row = y * w * 4;
      for (let x = 0; x < w; x += step) {
        const i = row + x * 4;
        const a = buf[i + 3];
        if (!a) continue;
        alphaSum += a;
        if (a >= ALPHA_FLOOR) {
          lumaSum += (a / 255) * luma(buf[i], buf[i + 1], buf[i + 2]);
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    per.push({alphaSum, lumaSum, x0, y0, x1, y1});
    if (lumaSum > peakLumaSeen) { peakLumaSeen = lumaSum; peakBuf = Buffer.from(buf); }
  });

  if (!per.length) return null;
  const {w, h, frames} = info;

  const maxAlpha = Math.max(...per.map(f => f.alphaSum));
  const isEmpty = f => f.alphaSum < maxAlpha * EMPTY_RATIO;
  let leadEmpty = 0;
  while (leadEmpty < per.length && isEmpty(per[leadEmpty])) leadEmpty++;
  let tailEmpty = 0;
  while (tailEmpty < per.length - leadEmpty && isEmpty(per[per.length - 1 - tailEmpty])) tailEmpty++;

  // 自带闪爆：亮度峰值相对**非空帧**中位数的倍数。中位数用非空帧算，
  // 否则首尾空帧会把中位数压到 0，任何素材看起来都像在闪。
  const lums = per.filter(f => !isEmpty(f)).map(f => f.lumaSum).sort((a, b) => a - b);
  const medLuma = lums.length ? lums[Math.floor(lums.length / 2)] : 0;
  const peakLuma = Math.max(...per.map(f => f.lumaSum));
  const flashRatio = medLuma > 0 ? +(peakLuma / medLuma).toFixed(2) : null;
  const lumaPeakIdx = per.findIndex(f => f.lumaSum === peakLuma);

  // 内容包围盒取**亮度峰值那一帧**（与 peakBuf 同一帧）：观感尺寸由主体决定，
  // 而 alpha 峰值可能落在一片低亮度的大面积烟雾上。
  const pf = per[lumaPeakIdx] ?? per[0];
  const bw = pf.x1 >= pf.x0 ? (pf.x1 - pf.x0 + step) : 0;
  const bh = pf.y1 >= pf.y0 ? (pf.y1 - pf.y0 + step) : 0;

  // 暗底可读性：把峰值帧按 alpha 合成到 0x303030 上，取内容区的平均亮度。
  // 0x303030 与 tools/contact-sheet.sh 的底色一致，两边的判断才可比。
  let darkLuma = null;
  if (peakBuf) {
    const BG = 0x30;
    let sum = 0, cnt = 0;
    for (let y = 0; y < h; y += step) {
      const row = y * w * 4;
      for (let x = 0; x < w; x += step) {
        const i = row + x * 4;
        const a = peakBuf[i + 3];
        if (a < ALPHA_FLOOR) continue;
        const t = a / 255;
        sum += luma(
          peakBuf[i] * t + BG * (1 - t),
          peakBuf[i + 1] * t + BG * (1 - t),
          peakBuf[i + 2] * t + BG * (1 - t));
        cnt++;
      }
    }
    darkLuma = cnt ? +(sum / cnt).toFixed(1) : null;
  }

  // 可循环性：首尾两个非空帧的 alpha 总量差（归一化）。越小越可能无缝循环。
  const firstReal = per[leadEmpty], lastReal = per[per.length - 1 - tailEmpty];
  const loopDelta = (firstReal && lastReal && maxAlpha)
    ? +(Math.abs(firstReal.alphaSum - lastReal.alphaSum) / maxAlpha).toFixed(3) : null;

  return {
    w, h, frames, fps: meta.fps, codec: meta.codec, alpha: meta.alpha,
    leadEmpty, tailEmpty,
    peak: lumaPeakIdx,
    flashRatio,
    contentRatio: +(Math.max(bw / w, bh / h)).toFixed(3),
    darkLuma,
    loopDelta,
    step
  };
}

/* -------------------------------------------- */
/*  批量入口                                      */
/* -------------------------------------------- */

function* walkVideos(dir) {
  for (const e of readdirSync(dir, {withFileTypes: true})) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walkVideos(p);
    else if (extname(e.name).toLowerCase() === ".webm") yield p;
  }
}

/** 从 data/asset-index.json 里取某个 DB 前缀底下的全部文件（去重）。 */
function filesUnderDbPrefix(prefix) {
  const idx = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
  const out = new Set();
  const parts = prefix.split(".");
  let node = idx.tree;
  for (const p of parts) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return [];
    node = node[p];
  }
  const walk = n => {
    if (typeof n === "string") { out.add(n); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n && typeof n === "object") for (const [k, v] of Object.entries(n)) { if (!k.startsWith("_")) walk(v); }
  };
  walk(node);
  return [...out].filter(f => f.toLowerCase().endsWith(".webm"));
}

const arg = name => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
};

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;

if (isMain) {
  const dbPrefix = arg("db");
  const dir = arg("dir");
  const jobs = Math.max(1, +(arg("jobs") ?? 4));
  const step = Math.max(1, +(arg("step") ?? 2));

  let rels;
  if (dbPrefix) {
    rels = filesUnderDbPrefix(dbPrefix);
    if (!rels.length) { console.error(`--db ${dbPrefix} 底下没有 webm —— 前缀写错了？`); process.exit(2); }
  } else if (dir) {
    const abs = join(FOUNDRY_DATA, dir);
    if (!existsSync(abs)) { console.error(`--dir ${dir} 不存在`); process.exit(2); }
    rels = [...walkVideos(abs)].map(p => relative(FOUNDRY_DATA, p).split(sep).join("/"));
  } else {
    console.error("用法： node tools/profile-family.mjs (--db <DB 路径前缀> | --dir <相对 Data 的目录>) [--jobs 4] [--step 2]");
    process.exit(2);
  }

  const store = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {generated: null, profiles: {}};
  store.profiles ??= {};

  const todo = rels.filter(r => existsSync(join(FOUNDRY_DATA, decodeURI(r))));
  const skipped = rels.length - todo.length;
  console.log(`量测 ${todo.length} 个文件（跳过 ${skipped} 个不存在的），并发 ${jobs}，采样步长 ${step}`);

  let done = 0, failed = 0;
  const queue = todo.slice();
  async function worker() {
    for (;;) {
      const rel = queue.shift();
      if (!rel) return;
      try {
        const p = await profileAsset(join(FOUNDRY_DATA, decodeURI(rel)), step);
        if (p) store.profiles[rel] = p; else failed++;
      } catch (err) {
        failed++;
        console.error(`✗ ${rel}: ${err.message}`);
      }
      if (++done % 50 === 0 || done === todo.length) {
        console.log(`  ${done}/${todo.length}`);
      }
    }
  }
  await Promise.all(Array.from({length: jobs}, worker));

  store.generated = new Date().toISOString().slice(0, 10);
  writeFileSync(OUT, JSON.stringify(store));
  console.log(`已写入 data/asset-profiles.json（累计 ${Object.keys(store.profiles).length} 条，本轮失败 ${failed}）`);
}
