#!/usr/bin/env node
/**
 * 量出「元素层残留主色」，供 test/armory-element-distinct.test.mjs 的 PALETTE.lab 使用。
 *
 * 为什么需要这个数：eskie.damage.* 的八支共用同一套模板动作，前 7 帧（含 f5 那帧满画面
 * 纯白爆闪）几乎一模一样，而 impact 元素层现在用 startTime 把 f0-f6 整段裁掉了——一次命中
 * 在屏幕上只剩 0.27 秒，能让玩家区分「打中了什么属性」的信息几乎全部落在这段残留的颜色上
 * （ASSET-NOTES 的 acid 行：「0.5 秒里两者的观感差别基本只剩色相」）。所以取样规则是：
 *   - 只取白爆闪之后、也就是元素层真正播出的帧（--from，eskie.damage 用 7）；
 *   - 只统计 alpha>=64 的像素（半透明边缘不代表主色）；
 *   - 再剔掉 chroma<20 的近灰像素——模板白闪与亮核对所有类型都一样、不携带身份信息，
 *     留着会把所有类型一起拉向白色、人为抬高彼此的相似度；
 *   - 以 alpha 为权重求平均 RGB，转 sRGB→CIELAB（D65）输出。
 *
 * 解码沿用 tools/contact-sheet.sh 的结论：JB2A / eskie 的 webm 是 VP8/VP9 + alpha，
 * ffmpeg 默认解码器**不解 alpha 平面**，必须按 codec 显式指定 libvpx / libvpx-vp9，
 * 否则量到的是错误的 RGB，整张表都是错的。
 *
 * 用法：
 *   node tools/element-residual-colour.mjs --from 7 <file.webm> [<file.webm> ...]
 *   node tools/element-residual-colour.mjs --from 7 --delta a.webm b.webm   # 顺带打 ΔE00
 *
 * 路径给的是磁盘上的真实文件（Foundry 的 Data 目录），不是 DB 点分路径——DB 路径到文件的
 * 映射用 data/asset-index.json 或 scripts/resolver/assets.mjs 自行换算。
 */
import {execFileSync} from "node:child_process";

function decode(file) {
  const meta = execFileSync("ffprobe", ["-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=codec_name,width,height", "-of", "csv=p=0", file])
    .toString().trim().split(",");
  const [codec, w, h] = [meta[0], +meta[1], +meta[2]];
  const dec = codec === "vp9" ? ["-c:v", "libvpx-vp9"] : codec === "vp8" ? ["-c:v", "libvpx"] : [];
  const buf = execFileSync("ffmpeg", ["-v", "error", ...dec, "-i", file,
    "-f", "rawvideo", "-pix_fmt", "rgba", "-"], {maxBuffer: 1 << 30});
  const stride = w * h * 4;
  const frames = [];
  for (let i = 0; i + stride <= buf.length; i += stride) frames.push(buf.subarray(i, i + stride));
  return {w, h, stride, frames};
}

const srgbToLinear = v => (v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;

function toLab(r, g, b) {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

/** CIEDE2000，与 test/armory-element-distinct.test.mjs 里的实现同式。 */
function ciede2000([L1, a1, b1], [L2, a2, b2]) {
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const A1 = (1 + G) * a1, A2 = (1 + G) * a2;
  const Cp1 = Math.hypot(A1, b1), Cp2 = Math.hypot(A2, b2);
  const ang = (x, y) => (x === 0 && y === 0) ? 0 : ((Math.atan2(y, x) / rad) + 360) % 360;
  const h1 = ang(A1, b1), h2 = ang(A2, b2);
  const dL = L2 - L1, dC = Cp2 - Cp1;
  let dh = 0;
  if (Cp1 * Cp2 !== 0) { dh = h2 - h1; if (dh > 180) dh -= 360; if (dh < -180) dh += 360; }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dh / 2) * rad);
  const Lb = (L1 + L2) / 2, Cbp = (Cp1 + Cp2) / 2;
  let hb;
  if (Cp1 * Cp2 === 0) hb = h1 + h2;
  else { hb = (h1 + h2) / 2; if (Math.abs(h1 - h2) > 180) hb += (h1 + h2 < 360) ? 180 : -180; }
  const T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad)
              + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.20 * Math.cos((4 * hb - 63) * rad);
  const dTh = 30 * Math.exp(-(((hb - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTh * rad) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

function residual(file, from) {
  const {stride, frames} = decode(file);
  let R = 0, G = 0, B = 0, W = 0;
  for (let i = from; i < frames.length; i++) {
    const f = frames[i];
    for (let p = 0; p < stride; p += 4) {
      const a = f[p + 3];
      if (a < 64) continue;
      const r = f[p], g = f[p + 1], b = f[p + 2];
      if (Math.max(r, g, b) - Math.min(r, g, b) < 20) continue;   // 近灰：白闪与亮核，不算主色
      R += a * r; G += a * g; B += a * b; W += a;
    }
  }
  if (!W) return null;
  const rgb = [R / W, G / W, B / W];
  return {frames: frames.length, rgb: rgb.map(Math.round), lab: toLab(...rgb).map(v => +v.toFixed(1))};
}

const argv = process.argv.slice(2);
let from = 0, delta = false;
const files = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === "--from") from = +argv[++i];
  else if (argv[i] === "--delta") delta = true;
  else files.push(argv[i]);
}
if (!files.length) {
  console.error("usage: node tools/element-residual-colour.mjs --from <frame> <file.webm> ...");
  process.exit(2);
}

const out = [];
for (const f of files) {
  const r = residual(f, from);
  if (!r) { console.log(`${f}\t(全片没有非灰像素)`); continue; }
  out.push({f, ...r});
  console.log(`${f}\tframes=${r.frames}\trgb=[${r.rgb}]\tlab=[${r.lab}]`);
}

if (delta && out.length >= 2) {
  console.log("\nCIEDE2000:");
  for (let i = 0; i < out.length; i++) {
    for (let j = i + 1; j < out.length; j++) {
      console.log(`  ${ciede2000(out[i].lab, out[j].lab).toFixed(1)}\t${out[i].f}\n\t\t${out[j].f}`);
    }
  }
}
