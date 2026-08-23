/**
 * 把 N 个候选素材各自的**峰值帧**拼成一张图 —— 一眼看完一整族。
 *
 * ## 与 contact-sheet.sh 的分工
 *
 * | | 看什么 | 一张图 = |
 * | --- | --- | --- |
 * | `contact-sheet.sh` | **一个**素材的相位结构（空头帧、闪爆在第几帧、什么时候熄灭） | 1 个素材 × 12 帧 |
 * | `family-sheet.mjs` | **一族**素材长什么样，挑哪一个 | 12 个素材 × 1 帧 |
 *
 * V2 要选 600–1000 条素材（`V2-PLAN.md` D4）。逐条出 contact sheet 是 600 张图；
 * 先用 family sheet 把族里该用哪几条挑出来（约 50 张图），**再**对选中的那几条出
 * contact sheet 确认时序。这是把「specific 选材」变得可做的关键一步。
 *
 * ## 峰值帧从哪来
 *
 * 优先读 `data/asset-profiles.json` 里 `tools/profile-family.mjs` 量出的 `peak`
 * （亮度峰值帧）。没量过就取中间帧——但会在 stdout 标出来，因为中间帧对
 * 「前段生长 / 后段衰减」型素材经常不是主体。
 *
 * ## 底色与 contact-sheet 一致
 *
 * 都合成到 0x303030。**这不是审美选择**：RGBA 的 PNG 在查看器里透明区会被画成白色，
 * 而这些素材实际是叠在深色地图上的，白底会把「暗地图上糊没」的素材看成正常。
 * 两个工具用同一个底色，判断才可比。
 *
 * ## 用法
 *
 *   node tools/family-sheet.mjs --db eskie.damage --out sheet.png
 *   node tools/family-sheet.mjs --db jb2a.impact.011 --out x.png --cols 5 --size 200
 *   node tools/family-sheet.mjs --files a.webm,b.webm --out x.png
 *   node tools/family-sheet.mjs --db eskie.damage --out x.png --at peak
 *
 * `--at` 取帧策略：auto（默认，自带闪爆的取残留段）/ peak / late / 具体帧号。
 *
 * stdout 会打出格子编号 → 素材路径的对照表，图里只标编号（文件名太长，
 * 而且 drawtext 依赖 fontconfig，在 Windows 上不一定装了）。
 */
import {readFileSync, existsSync, mkdtempSync, rmSync} from "node:fs";
import {join, dirname} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {execFileSync} from "node:child_process";
import {tmpdir} from "node:os";
import {FOUNDRY_DATA} from "./paths.mjs";
import {FFMPEG, probeVideo, alphaDecoder} from "./media.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PROFILES = join(ROOT, "data/asset-profiles.json");

/** 与 tools/contact-sheet.sh 同一个底色，两边的判断才可比。 */
const BG = "0x303030";

const arg = name => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
};

/** 取某个 DB 前缀底下的全部 webm（去重、保持索引顺序）。 */
function filesUnderDbPrefix(prefix) {
  const idx = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
  let node = idx.tree;
  for (const p of prefix.split(".")) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return [];
    node = node[p];
  }
  const out = [];
  const seen = new Set();
  const walk = n => {
    if (typeof n === "string") { if (!seen.has(n)) { seen.add(n); out.push(n); } return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n && typeof n === "object") for (const [k, v] of Object.entries(n)) { if (!k.startsWith("_")) walk(v); }
  };
  walk(node);
  return out.filter(f => f.toLowerCase().endsWith(".webm"));
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;

if (isMain) {
  const dbPrefix = arg("db");
  const fileList = arg("files");
  const out = arg("out");
  const cols = Math.max(1, +(arg("cols") ?? 6));
  const size = Math.max(48, +(arg("size") ?? 170));
  const at = arg("at") ?? "auto";   // auto | peak | late | <帧号>

  if (!out || (!dbPrefix && !fileList)) {
    console.error("用法： node tools/family-sheet.mjs (--db <DB 前缀> | --files a,b,c) --out <png> [--cols 6] [--size 170] [--at auto|peak|late|<帧号>]");
    process.exit(2);
  }

  let rels = dbPrefix ? filesUnderDbPrefix(dbPrefix) : fileList.split(",").map(s => s.trim()).filter(Boolean);
  rels = rels.filter(r => existsSync(join(FOUNDRY_DATA, decodeURI(r))));
  if (!rels.length) { console.error("没有可用的素材"); process.exit(3); }

  const profiles = existsSync(PROFILES)
    ? (JSON.parse(readFileSync(PROFILES, "utf8")).profiles ?? {}) : {};

  const tmp = mkdtempSync(join(tmpdir(), "canim-sheet-"));
  const stills = [];
  const legend = [];

  try {
    rels.forEach((rel, i) => {
      const abs = join(FOUNDRY_DATA, decodeURI(rel));
      const [peak, peakSrc] = pickFrame(rel, abs, profiles[rel], at);
      const still = join(tmp, `${String(i).padStart(3, "0")}.png`);
      const {codec} = probeVideo(abs);
      const dec = alphaDecoder(codec);
      // select=eq(n\,PEAK) 取那一帧；合成到已知底色后再输出，透明区必定精确等于底色，
      // 任何偏离底色的像素都是素材真的画上去的。
      // `setpts=N/TB` 不能省：底色源是 r=1，而 select 选出的帧仍带原始 PTS
      // （f5 @ 29.97fps 是 0.167s）。overlay 走 framesync，两边时间轴对不上就
      // 什么都不输出——实测拼出来是一张纯底色的空网格。contact-sheet.sh 里有同一句，
      // 那边的注释记的是「30fps 素材被按 25fps 重采样，14 帧掉成 11 帧」。
      /*
       * 每格统一装进 size×size 的方框（等比缩放后居中留边），**不是**只定宽度。
       *
       * 拼图那一步用的是 `concat`，它要求所有输入的尺寸与 SAR 完全一致。只定宽度时
       * 不同长宽比的素材会得到不同高度——同族素材尺寸统一所以前几次没暴露，
       * 一混用（400×400 的冲击 + 1600×400 的箭矢）就报
       * `Input link parameters do not match the corresponding output link`。
       *
       * 顺带好处：留边之后各格视觉基线一致，一眼能看出哪条素材内容占比大。
       */
      const vf = `[0:v]select='eq(n\\,${peak})',` +
                 `scale=${size}:${size}:force_original_aspect_ratio=decrease,` +
                 `pad=${size}:${size}:(ow-iw)/2:(oh-ih)/2:color=${BG}@0,` +
                 `format=rgba,setpts=N/TB[fg];` +
                 `color=c=${BG}:s=${size}x${size}:r=1,format=rgb24[bg];` +
                 `[bg][fg]overlay=shortest=1:format=rgb,format=rgb24,setsar=1`;
      execFileSync(FFMPEG, ["-y", "-v", "error", ...dec, "-i", abs,
        "-filter_complex", vf, "-frames:v", "1", "-vsync", "0", still],
        {stdio: ["ignore", "ignore", "pipe"]});
      stills.push(still);
      legend.push(`${String(i).padStart(3, " ")}  f${String(peak).padStart(2)} ${peakSrc.padEnd(14)} ${rel}`);
    });

    // 把单帧拼起来。每张图作为一个输入，tile 滤镜按行列排布。
    const inputs = stills.flatMap(s => ["-i", s]);
    const rows = Math.ceil(stills.length / cols);
    const chain = stills.map((_, i) => `[${i}:v]`).join("") +
      `concat=n=${stills.length}:v=1:a=0,tile=${cols}x${rows}:padding=3:color=0x101010`;
    execFileSync(FFMPEG, ["-y", "-v", "error", ...inputs, "-filter_complex", chain,
      "-frames:v", "1", out], {stdio: ["ignore", "ignore", "pipe"]});

    console.log(`${stills.length} 个素材 → ${cols}×${rows} 拼图 → ${out}\n`);
    console.log("格子  峰值帧  来源            素材");
    legend.forEach(l => console.log(l));
    const unmeasured = legend.filter(l => l.includes("未量测")).length;
    if (unmeasured) {
      console.log(`\n⚠ ${unmeasured} 个素材没量过，用的是中间帧——` +
                  `先跑 node tools/profile-family.mjs --db <前缀> 会准得多`);
    }
  } finally {
    rmSync(tmp, {recursive: true, force: true});
  }
}

/**
 * 选取用来代表这个素材的那一帧。
 *
 * **默认 auto，而不是「亮度峰值帧」——这是实测踩出来的。** 第一版用亮度峰值，
 * 对 `eskie.damage` 这一族拼出来前九格（bludgeoning/piercing/slashing 的 red/yellow/white）
 * 长得**一模一样**：那一族的峰值帧正是素材自带的白色闪爆，颜色被冲干净了。
 * 而选材恰恰要看颜色与形状。
 *
 * 判据用量测出来的 `flashRatio`（峰值亮度 ÷ 非空帧亮度中位数）：
 *   · ≥ 2 视为自带闪爆 → 取闪爆**之后**的残留段（峰值帧与末个非空帧之间 40% 处）。
 *     这也正是游戏里实际看到的：兵库对 eskie.damage 用 `startTime: 234ms`
 *     ≈ 29.97fps 的第 7 帧，就是在跳过闪爆。
 *   · < 2 视为无闪爆 → 峰值帧就是主体。
 *
 * ⚠ **这条启发式不是普适的，用之前先想清楚这一族的「闪爆」是什么。**
 *
 * 对 `eskie.damage`：闪爆是叠在主体上的白光，会把颜色冲掉，所以要躲开它。
 * 对 `jb2a.melee_attack`：**闪爆本身就是那一挥**（挥砍弧的亮轨，flashRatio 实测 3–62），
 * 残留只是挥完之后静止的武器。用 auto 拼出来的 12 格全是「挥完的武器停在那里」，
 * 看不出弧形——**判断朝向与弧形必须 `--at peak`**。
 *
 * 一句话：素材的主体是「持续的形状」时用 auto，主体是「一瞬间的轨迹」时用 peak。
 *
 * @returns {[number, string]} [帧号, 来源说明]
 */
function pickFrame(rel, abs, prof, at) {
  if (/^\d+$/.test(at)) return [+at, `指定 f${at}`];

  if (!prof) {
    let frames = 0;
    try { frames = probeVideoFrames(abs); } catch { frames = 0; }
    return [frames ? Math.floor(frames / 2) : 0, "中间帧(未量测)"];
  }

  const last = Math.max(0, prof.frames - 1 - (prof.tailEmpty ?? 0));
  const late = Math.min(last, Math.round(prof.peak + (last - prof.peak) * 0.4));

  if (at === "peak") return [prof.peak, "峰值"];
  if (at === "late") return [late, "残留段"];
  // auto
  return (prof.flashRatio ?? 0) >= 2
    ? [late, `残留段(闪爆比 ${prof.flashRatio})`]
    : [prof.peak, "峰值"];
}

/** 只在没有量测数据时用一次，所以不进 media.mjs。 */
function probeVideoFrames(abs) {
  const out = (() => {
    try { execFileSync(FFMPEG, ["-hide_banner", "-i", abs, "-map", "0:v:0", "-c", "copy", "-f", "null", "-"],
      {stdio: ["ignore", "ignore", "pipe"]}); return ""; }
    catch (e) { return (e.stderr ?? "").toString(); }
  })();
  const all = [...out.matchAll(/frame=\s*(\d+)/g)];
  return all.length ? +all[all.length - 1][1] : 0;
}
