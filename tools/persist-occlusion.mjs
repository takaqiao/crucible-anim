#!/usr/bin/env node
/**
 * 量出 persist 槽每一组素材的「遮挡剖面」，供 test/armory-persist-occlusion.test.mjs
 * 的 OCCLUSION 表使用。改素材、改 objectScale 之后重跑本脚本并把输出粘回那张表。
 *
 * 为什么需要这个数：persist 是**常驻**图层，一个状态挂多久它就盖多久。cue 里能影响
 * 「盖住多少 token」的只有 objectScale（决定素材的哪一部分落在脸上）、opacity 与
 * belowTokens 三个字段，而素材本身在中心区域有多少 alpha 是纯粹的素材属性，测一次
 * 就能钉住。测四样：
 *
 *   alpha   中心方框（边长 = rel × 画幅宽）内的逐帧 alpha 均值，再对全片取时间均值。
 *           播放层是 scaleToObject（Sequencer `sprite.width = 目标宽 × scale`，源文件
 *           像素尺寸只参与宽高比），所以「token 中心 40%」对应的源画幅方框是
 *           rel = 0.4 / objectScale——表里存一条 rel 剖面，测试按当时的 scale 现算插值，
 *           改 scale 不必重测。
 *   peak    同一窗口的**单帧最大值** ÷ 时间均值。持续特效的脉冲（haste 每 5s 两次金色
 *           光条穿过中心）在时间均值里被摊平，要单独看。
 *   hole    中心窗口内 alpha>=200 **且**亮度<96 的像素占比。这类像素不是「蒙一层膜」
 *           而是把 token 的像素整个换成近黑——debuff 的纯黑符文核就是这样，观感是在脸
 *           上打黑洞，与同样 alpha 的亮色完全不是一回事，所以单独一列。
 *   outer   alpha 落在 r > 0.6×半幅 之外的能量占比。它回答「压到 token 之下还剩多少
 *           看得见」——数值越高，belowTokens 的代价越小。
 *
 * 解码沿用 tools/contact-sheet.sh 与 tools/element-residual-colour.mjs 的结论：
 * JB2A / eskie 的 webm 是 VP8/VP9 + alpha，ffmpeg 默认解码器**不解 alpha 平面**，
 * 必须按 codec 显式指定 libvpx / libvpx-vp9，否则量到的是错的。整片逐帧流式读取
 * （eskie 的 800x800×180 帧解成 rgba 是 460MB，一次性 buffer 住不划算）。
 *
 * 用法：
 *   node tools/persist-occlusion.mjs                       # 按 GROUP_FX 现值全量重测
 *   node tools/persist-occlusion.mjs burning debuff        # 只测这几组
 *
 * 路径给的是 DB 点分路径，经 data/asset-index.json 换算到 Foundry Data 目录下的真实文件。
 */
import {execFileSync, spawn} from "node:child_process";
import {readFileSync} from "node:fs";
import {fileURLToPath, pathToFileURL} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {GROUP_FX} from "../scripts/armory/persist.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FOUNDRY_DATA = "/root/fvtt14-data/Data";
/** 兜底规则的素材不在 GROUP_FX 里，单独补一行，键名与测试表一致。 */
const EXTRA = {generic: {path: "jb2a.extras.tmfx.inflow.circle.01", scale: 1}};

/** 中心方框剖面的采样点。0.20-0.50 密一点：0.4/scale 落在这一段。 */
export const REL = [0.20, 0.25, 0.30, 0.35, 0.40, 0.45, 0.50, 0.60, 0.70, 0.85, 1.00];
const FACE = 0.4;

/** 逐帧回调，不整片 buffer。 */
export function eachFrame(file, cb) {
  const meta = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,width,height", "-of", "csv=p=0", file]).toString().trim().split(",");
  const [codec, w, h] = [meta[0], +meta[1], +meta[2]];
  const dec = codec === "vp9" ? ["-c:v", "libvpx-vp9"] : codec === "vp8" ? ["-c:v", "libvpx"] : [];
  const stride = w * h * 4;
  return new Promise((res, rej) => {
    const p = spawn("ffmpeg", ["-v", "error", ...dec, "-i", file, "-f", "rawvideo", "-pix_fmt", "rgba", "-"]);
    let tail = null, n = 0;
    p.stdout.on("data", d => {
      const buf = tail ? Buffer.concat([tail, d]) : d;
      let off = 0;
      while (buf.length - off >= stride) { cb(buf.subarray(off, off + stride), w, h, n++); off += stride; }
      tail = off < buf.length ? Buffer.from(buf.subarray(off)) : null;
    });
    p.stderr.on("data", d => process.stderr.write(d));
    p.on("close", c => c === 0 ? res({w, h, frames: n}) : rej(new Error(`ffmpeg exit ${c} on ${file}`)));
  });
}

/** 中心边长 rel×w 的方框内的 alpha 均值；同时数近黑近不透明像素。 */
function windowStats(buf, w, h, rel, countHoles) {
  const side = Math.min(w, Math.max(1, Math.round(rel * w)));
  const x0 = Math.floor((w - side) / 2), y0 = Math.floor((h - side) / 2);
  let sum = 0, hole = 0;
  for (let y = y0; y < y0 + side; y++) {
    let i = (y * w + x0) * 4;
    for (let x = 0; x < side; x++, i += 4) {
      const a = buf[i + 3];
      sum += a;
      if (countHoles && a >= 200 && (0.2126 * buf[i] + 0.7152 * buf[i + 1] + 0.0722 * buf[i + 2]) < 96) hole++;
    }
  }
  return {mean: sum / (side * side), holeFrac: hole / (side * side)};
}

/** 一支素材的完整剖面。faceRel = min(1, 0.4 / objectScale)。 */
export async function profile(file, faceRel) {
  const sums = REL.map(() => 0);
  let n = 0, faceSum = 0, facePeak = 0, holeSum = 0, outer = 0, total = 0;
  await eachFrame(file, (f, w, h) => {
    n++;
    for (let k = 0; k < REL.length; k++) sums[k] += windowStats(f, w, h, REL[k], false).mean;
    const s = windowStats(f, w, h, faceRel, true);
    faceSum += s.mean; holeSum += s.holeFrac;
    if (s.mean > facePeak) facePeak = s.mean;
    const cx = (w - 1) / 2, cy = (h - 1) / 2, R = 0.6 * Math.min(w, h) / 2;
    for (let y = 0; y < h; y++) {
      let i = y * w * 4;
      for (let x = 0; x < w; x++, i += 4) {
        const a = f[i + 3]; if (!a) continue;
        total += a;
        if (Math.hypot(x - cx, y - cy) > R) outer += a;
      }
    }
  });
  return {
    frames: n,
    alpha: REL.map((r, k) => [r, +(sums[k] / n).toFixed(1)]),
    face: +(faceSum / n).toFixed(2),
    peakRatio: +(facePeak / (faceSum / n)).toFixed(2),
    darkHole: +(holeSum / n).toFixed(4),
    outerFrac: +(outer / total).toFixed(3)
  };
}

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;

if (isMain) {
  const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
  const assets = createAssets(offlineBackend(index));
  const table = {...GROUP_FX, ...EXTRA};
  const want = process.argv.slice(2);
  const keys = want.length ? want : Object.keys(table);

  for (const g of keys) {
    const cfg = table[g];
    if (!cfg) { console.error(`未知分组 ${g}`); process.exitCode = 1; continue; }
    const fx = assets.resolve(cfg.path);
    if (!fx?.file) { console.error(`${g}: 解析不到 ${cfg.path}`); process.exitCode = 1; continue; }
    const pr = await profile(join(FOUNDRY_DATA, fx.file), Math.min(1, FACE / cfg.scale));
    const prof = pr.alpha.map(([r, v]) => `[${r.toFixed(2)}, ${v.toFixed(1)}]`).join(", ");
    console.log(`  ${g}: {
    path: "${cfg.path}", measuredScale: ${cfg.scale},
    alpha: [${prof}],
    peakRatio: ${pr.peakRatio.toFixed(2)}, darkHole: ${pr.darkHole.toFixed(4)}, outerFrac: ${pr.outerFrac.toFixed(3)}
  },`);
  }
}
