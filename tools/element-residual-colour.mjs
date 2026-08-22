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
 * 【persist 槽】上面那套取样规则是为 impact 元素层量身定的，直接拿去量 persist 的 12 组
 * 会给出错的数，四处失真都实测过：
 *   1. `chroma>=20` 这条近灰过滤器会把整支近灰素材过滤成空——debuff 的
 *      markers.runes.dark_black 实测返回「全片没有非灰像素」，slow 的灰链只剩下零星蓝噪点
 *      （量出 rgb=[31.5,30.9,50.2]，与它在屏幕上的银灰色毫无关系）。persist 的 12 组里有
 *      三支本来就是无彩的，近灰不是噪声而是它们的身份，必须 `--min-chroma 0`。
 *   2. impact 层恒 opacity=1 且只播 0.27 秒；persist 是 0.55-1.0 的长挂图层，玩家看到的是
 *      它**合成到地图底色之后**的颜色，不是素材自身的颜色。要 `--over` + `--opacity`。
 *   3. 以 alpha 为权重同样只对 impact 成立。marker 素材常自带大片高 alpha 的暗色配件
 *      （chain 四角那四团深色烟雾就是），alpha 加权会让「四团黑烟」压过「一圈亮银链环」，
 *      量出来的主色是烟不是链。persist 用 `--weight contrast`：以合成后**对底色的偏离量**
 *      ‖c − bg‖₂ 为权重，屏幕上看不见的像素自动不参与，与人眼锁定的部位一致。
 *   4. `alpha>=64` 这道硬门槛在 contrast 加权下是重复且有偏的：一个像素「显不显形」已经由
 *      权重连续地表达了，再拿 alpha 一刀切等于把同一件事算两遍，切掉的恰好是最靠近底色的
 *      那一档，会把淡雾类素材（hidden 的烟弧）的主色人为拉亮。persist 用 `--min-alpha 0`。
 * 四条合起来就是 `--persist` 这个预设
 * （= --from 0 --min-alpha 0 --min-chroma 0 --over 303030 --weight contrast）。
 *
 * 配方差异不是学术问题，它直接改结论：`jb2a.markers.skull.dark_red.01` 在 impact 配方下
 * 对 bleed 是 13.1，在屏幕配方下只有 7.7——一个过阈值一个不过。
 *
 * 用法：
 *   node tools/element-residual-colour.mjs --from 7 <file.webm> [<file.webm> ...]
 *   node tools/element-residual-colour.mjs --from 7 --delta a.webm b.webm   # 顺带打 ΔE00
 *   node tools/element-residual-colour.mjs --persist --opacity 0.8 --tint '#e0a060' <file.webm>
 *
 * 路径给的是磁盘上的真实文件（Foundry 的 Data 目录），不是 DB 点分路径——DB 路径到文件的
 * 映射用 data/asset-index.json 或 scripts/resolver/assets.mjs 自行换算。
 *
 * 本模块同时导出 decode / toLab / ciede2000 / residual / PERSIST_RECIPE，供
 * test/armory-element-distinct.test.mjs 与 test/armory-persist-distinct.test.mjs 复用——
 * 全仓只保留这一份 CIEDE2000 实现。
 */
import {execFileSync} from "node:child_process";
import {pathToFileURL} from "node:url";
import {FFMPEG, probeVideo, alphaDecoder} from "./media.mjs";

export function decode(file) {
  const {codec, width: w, height: h} = probeVideo(file);
  const dec = alphaDecoder(codec);
  const buf = execFileSync(FFMPEG, ["-v", "error", ...dec, "-i", file,
    "-f", "rawvideo", "-pix_fmt", "rgba", "-"], {maxBuffer: 1 << 30});
  const stride = w * h * 4;
  const frames = [];
  for (let i = 0; i + stride <= buf.length; i += stride) frames.push(buf.subarray(i, i + stride));
  return {w, h, stride, frames};
}

const srgbToLinear = v => (v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;

export function toLab(r, g, b) {
  const R = srgbToLinear(r), G = srgbToLinear(g), B = srgbToLinear(b);
  const X = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const Y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const Z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = t => t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116;
  return [116 * f(Y) - 16, 500 * (f(X) - f(Y)), 200 * (f(Y) - f(Z))];
}

/** CIEDE2000。全仓唯一实现，两条区分度守卫都从这里 import。 */
export function ciede2000([L1, a1, b1], [L2, a2, b2]) {
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

/**
 * 残留主色。
 *
 * @param {string} file
 * @param {object} [opt]
 * @param {number} [opt.from]       起始帧（impact 用 7 跳过模板白爆闪；persist 用 0）
 * @param {number} [opt.minAlpha]   低于此 alpha 的像素不计（半透明边缘不代表主色）
 * @param {number} [opt.minChroma]  低于此 chroma 的像素不计；0 = 关闭（persist 必须关）
 * @param {number} [opt.opacity]    图层 opacity，只在 over 非 null 时生效
 * @param {?number[]} [opt.over]    合成底色 [r,g,b]；null = 量素材自身的颜色
 * @param {?number[]} [opt.tint]    乘法 tint [r,g,b] 0-255；null = 不染色
 * @param {"alpha"|"contrast"} [opt.weight]  加权方式，见文件头
 */
export function residual(file, {from = 0, minAlpha = 64, minChroma = 20,
                                opacity = 1, over = null, tint = null,
                                weight = "alpha"} = {}) {
  const {stride, frames} = decode(file);
  const [tr, tg, tb] = tint ? tint.map(v => v / 255) : [1, 1, 1];
  let R = 0, G = 0, B = 0, W = 0, N = 0;
  for (let i = from; i < frames.length; i++) {
    const f = frames[i];
    for (let p = 0; p < stride; p += 4) {
      const a = f[p + 3];
      if (a < minAlpha) continue;
      let r = f[p] * tr, g = f[p + 1] * tg, b = f[p + 2] * tb;
      if (minChroma > 0 && Math.max(r, g, b) - Math.min(r, g, b) < minChroma) continue;
      let w = a;
      if (over) {
        const ae = (a / 255) * opacity;
        r = r * ae + over[0] * (1 - ae);
        g = g * ae + over[1] * (1 - ae);
        b = b * ae + over[2] * (1 - ae);
        w = weight === "contrast"
          ? Math.hypot(r - over[0], g - over[1], b - over[2])
          : a * opacity;
      }
      if (w <= 0) continue;
      R += w * r; G += w * g; B += w * b; W += w; N++;
    }
  }
  if (!W) return null;
  const rgb = [R / W, G / W, B / W];
  return {frames: frames.length, px: N, rgb: rgb.map(v => +v.toFixed(1)),
          lab: toLab(...rgb).map(v => +v.toFixed(1))};
}

/** persist 槽的取样预设，见文件头。 */
export const PERSIST_RECIPE = Object.freeze({
  from: 0, minAlpha: 0, minChroma: 0, over: Object.freeze([0x30, 0x30, 0x30]), weight: "contrast"
});

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;

if (isMain) {
  const argv = process.argv.slice(2);
  const opt = {from: 0, minAlpha: 64, minChroma: 20, opacity: 1, over: null, tint: null, weight: "alpha"};
  const hex = h => { const v = parseInt(h.replace(/^#/, ""), 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
  let delta = false;
  const files = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--from") opt.from = +argv[++i];
    else if (a === "--min-alpha") opt.minAlpha = +argv[++i];
    else if (a === "--min-chroma") opt.minChroma = +argv[++i];
    else if (a === "--opacity") opt.opacity = +argv[++i];
    else if (a === "--over") opt.over = hex(argv[++i]);
    else if (a === "--tint") opt.tint = hex(argv[++i]);
    else if (a === "--weight") opt.weight = argv[++i];
    else if (a === "--persist") Object.assign(opt, PERSIST_RECIPE, {over: [...PERSIST_RECIPE.over]});
    else if (a === "--delta") delta = true;
    else files.push(a);
  }
  if (!files.length) {
    console.error("usage: node tools/element-residual-colour.mjs [--from N] [--min-alpha N] "
                + "[--min-chroma N] [--persist] [--over RRGGBB] [--opacity F] [--tint RRGGBB] "
                + "[--delta] <file.webm> ...");
    process.exit(2);
  }
  const out = [];
  for (const f of files) {
    const r = residual(f, opt);
    if (!r) { console.log(`${f}\t(取样窗口内没有可计的像素)`); continue; }
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
}
