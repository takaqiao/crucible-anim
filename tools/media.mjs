/**
 * ffmpeg / ffprobe 定位与视频探针。
 *
 * 这个项目的选材方法学建立在「真的把素材解出来看」之上——逐帧 alpha 采样、联系表读图、
 * 残留主色的 CIEDE2000。全部依赖 ffmpeg，且**必须是带 libvpx / libvpx-vp9 的构建**：
 * JB2A / eskie / blfx 的 WebM 把 alpha 存在 Matroska 的 BlockAdditional 里，
 * ffmpeg 的默认原生解码器不解这个平面，只吐 RGB —— 据此做出的密度/亮度判断全是错的
 * （`jb2a.cast_generic.01.blue` 会被解成「白底蓝漩涡」，与它在游戏里的样子南辕北辙）。
 *
 * 另一件在 Windows 上常见的事：**只有 ffmpeg 没有 ffprobe**（大量应用随附 ffmpeg.exe
 * 单文件）。全仓用到 ffprobe 的地方只取 codec / 宽 / 高 / 帧数四样，`ffmpeg -i` 的
 * stderr 里全都有，所以这里给出无 ffprobe 的等价实现，不必为此额外装一个二进制。
 *
 *   CRUCIBLE_ANIM_FFMPEG   ffmpeg 可执行文件路径
 *   CRUCIBLE_ANIM_FFPROBE  ffprobe 可执行文件路径（可选）
 */
import {execFileSync, spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {join} from "node:path";
import {homedir} from "node:os";

const home = homedir();
const localAppData = process.env.LOCALAPPDATA || join(home, "AppData", "Local");

/** PATH 上有没有；execFileSync 抛错即视为没有。 */
function onPath(exe) {
  try { execFileSync(exe, ["-version"], {stdio: "ignore"}); return exe; }
  catch { return null; }
}

function locate(envVar, exe, extraCandidates) {
  const fromEnv = process.env[envVar];
  if (fromEnv) {
    if (existsSync(fromEnv)) return fromEnv;
    throw new Error(`${envVar} 指向 ${fromEnv}，但那里没有文件`);
  }
  const p = onPath(exe);
  if (p) return p;
  for (const c of extraCandidates) if (existsSync(c)) return c;
  return null;
}

/** ffmpeg 是硬依赖：缺了整套选材方法学都跑不了，所以在这里就报错，不留给调用方猜。 */
export const FFMPEG = (() => {
  const hit = locate("CRUCIBLE_ANIM_FFMPEG", "ffmpeg", [
    join(localAppData, "oopz", "ffmpeg.exe"),          // 本机随某应用安装的一份，带 libvpx
    "C:\\ffmpeg\\bin\\ffmpeg.exe",
    "/usr/bin/ffmpeg", "/usr/local/bin/ffmpeg"
  ]);
  if (!hit) {
    throw new Error(
      "找不到 ffmpeg。设 CRUCIBLE_ANIM_FFMPEG 指向可执行文件。\n" +
      "必须是带 libvpx / libvpx-vp9 的构建——否则解不出 WebM 的容器级 alpha，读图判断会全错。\n" +
      "自检：ffmpeg -decoders | grep libvpx  应当同时列出 libvpx 与 libvpx-vp9。"
    );
  }
  return hit;
})();

/** ffprobe 是可选的：没有就走 `ffmpeg -i` 解析。 */
export const FFPROBE = locate("CRUCIBLE_ANIM_FFPROBE", "ffprobe", [
  join(localAppData, "oopz", "ffprobe.exe"),
  "C:\\ffmpeg\\bin\\ffprobe.exe",
  "/usr/bin/ffprobe", "/usr/local/bin/ffprobe"
]);

/** `ffmpeg -i` 只为打印信息时以非 0 退出，这不是失败——把 stderr 取出来即可。 */
function ffmpegInfo(file, extraArgs = []) {
  try {
    execFileSync(FFMPEG, ["-hide_banner", "-i", file, ...extraArgs],
      {stdio: ["ignore", "ignore", "pipe"], maxBuffer: 1 << 26});
    return "";
  } catch (e) {
    return (e.stderr ?? "").toString();
  }
}

/**
 * 取视频流的基本参数。
 * @returns {{codec: string, width: number, height: number, fps: number|null, alpha: boolean}}
 *
 * `alpha` 的判据是**容器 tag `alpha_mode=1`**，不是 `pix_fmt`。本机主力库
 * （jb2a / eskie / blfx / cartoon）的 pix_fmt 一律报 yuv420p，用它判会全部假阴性。
 */
export function probeVideo(file) {
  if (FFPROBE) {
    const csv = execFileSync(FFPROBE, ["-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=codec_name,width,height,r_frame_rate:stream_tags=alpha_mode",
      "-of", "default=nw=1:nk=1", file]).toString().trim().split("\n").map(s => s.trim());
    const [codec, w, h, rate, alpha] = csv;
    const [num, den] = String(rate ?? "").split("/").map(Number);
    return {codec, width: +w, height: +h,
            fps: den ? num / den : null, alpha: alpha === "1"};
  }
  const out = ffmpegInfo(file);
  const m = out.match(/Video:\s*([A-Za-z0-9_]+)[^\n]*?,\s*(\d+)x(\d+)/);
  if (!m) throw new Error(`无法解析视频流参数: ${file}`);
  const fpsM = out.match(/,\s*([\d.]+)\s*fps/);
  return {
    codec: m[1], width: +m[2], height: +m[3],
    fps: fpsM ? +fpsM[1] : null,
    alpha: /alpha_mode\s*:\s*1/.test(out)
  };
}

/** 精确帧数。ffprobe 用 -count_frames；否则让 ffmpeg 走一遍 null 输出数 frame=。 */
export function countFrames(file) {
  if (FFPROBE) {
    const n = execFileSync(FFPROBE, ["-v", "error", "-count_frames", "-select_streams", "v:0",
      "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", file]).toString().trim();
    if (/^\d+$/.test(n)) return +n;
  }
  const out = ffmpegInfo(file, ["-map", "0:v:0", "-c", "copy", "-f", "null", "-"]);
  const all = [...out.matchAll(/frame=\s*(\d+)/g)];
  if (!all.length) throw new Error(`无法统计帧数: ${file}`);
  return +all[all.length - 1][1];
}

/** 按 codec 选出能解 alpha 平面的解码器参数。非 VP8/VP9 返回空数组（用默认解码器）。 */
export function alphaDecoder(codec) {
  if (codec === "vp9") return ["-c:v", "libvpx-vp9"];
  if (codec === "vp8") return ["-c:v", "libvpx"];
  return [];
}

/**
 * 逐帧解出 RGBA 并回调，**不把整段视频读进内存**。
 *
 * 一个 800×800 的 15 帧素材是 38 MB RGBA；eskie 的近战矩阵有 1250 个文件，
 * 批量量测时整片 buffer 会直接把 Node 撑爆。这里按 stride 切帧、回调完就扔。
 *
 * 必须显式指定 libvpx 系解码器（`alphaDecoder`），否则 ffmpeg 的默认原生解码器
 * **不解 alpha 平面**：JB2A / eskie / blfx 的 alpha 存在 Matroska 的 BlockAdditional 里，
 * 用默认解码器出来的 RGB 有的是黑底预乘、有的完全不是，据此做的密度/亮度判断全错。
 *
 * @param {string} file
 * @param {(frame: Buffer, w: number, h: number, n: number) => void} cb  每帧一次，frame 是 w*h*4 的 RGBA
 * @returns {Promise<{w: number, h: number, frames: number}>}
 */
export function eachFrame(file, cb, {maxDim = 0} = {}) {
  const {codec, width: srcW, height: srcH} = probeVideo(file);
  const dec = alphaDecoder(codec);

  /*
   * `maxDim` —— 在 **ffmpeg 里**先缩再出流，不是在 Node 里跳像素。
   *
   * 实测出来的必要性：jb2a 的帧数中位 47（最多 213），还有 4000×400 这类宽条素材，
   * 一个文件要通过管道传 90 MB 的 RGBA；全库 11,700 个就是 1 TB 的管道流量。
   * 瓶颈在 IPC，不在计算——只调 Node 侧的采样步长（step）一点用都没有。
   * 缩到 240px 宽后管道流量降到 1/16，实测 3.5 s/文件 → 0.2 s/文件。
   *
   * 为什么可以缩：profile-family 算的量全部是**比值或帧序号**——
   * contentRatio 是包围盒÷画幅、flashRatio 是亮度比、darkLuma 是内容区均值、
   * peak/leadEmpty/tailEmpty 是帧号。它们对分辨率不敏感。
   * （这句话由 test/profile-scale.test.mjs 对着全分辨率量测结果逐项核，不是口头保证。）
   *
   * 回报的 w/h 仍是**原始**尺寸：调用方要的是素材的真实画幅。
   */
  let w = srcW, h = srcH;
  const vf = [];
  if (maxDim > 0 && srcW * srcH > maxDim * maxDim) {
    /*
     * 按**面积**限制，不是按最长边。
     *
     * 实测踩出来的：初版按最长边缩到 240，jb2a 的 `4000×400` 宽条素材会变成 `240×24`
     * ——只剩 5760 个像素，空帧判据（alphaSum 相对峰值的比例）和暗底均值直接失真。
     * 抽样 40 条对全分辨率基线：tailEmpty 只有 33/40 一致、darkLuma 最大差 22%、
     * loopDelta 最大差 100%。
     *
     * 改成「总像素数 ≤ maxDim²」并保持长宽比之后，宽条素材缩成 `1096×110` 而不是 `240×24`，
     * 像素数与方形素材同量级，阈值类判据才可比。
     */
    const k = Math.sqrt((maxDim * maxDim) / (srcW * srcH));
    // 缩到偶数：部分滤镜链对奇数尺寸挑剔，且 rawvideo 的 stride 要能整除
    w = Math.max(2, Math.round(srcW * k / 2) * 2);
    h = Math.max(2, Math.round(srcH * k / 2) * 2);
    vf.push(`scale=${w}:${h}`);
  }
  vf.push("format=rgba");

  const stride = w * h * 4;
  return new Promise((res, rej) => {
    const p = spawn(FFMPEG, ["-v", "error", ...dec, "-i", file,
      "-vf", vf.join(","), "-f", "rawvideo", "-pix_fmt", "rgba", "-"]);
    let tail = null, n = 0;
    p.stdout.on("data", d => {
      const buf = tail ? Buffer.concat([tail, d]) : d;
      let off = 0;
      while (buf.length - off >= stride) { cb(buf.subarray(off, off + stride), w, h, n++); off += stride; }
      tail = off < buf.length ? Buffer.from(buf.subarray(off)) : null;
    });
    p.stderr.on("data", d => process.stderr.write(d));
    p.on("error", rej);
    p.on("close", c => c === 0
      ? res({w: srcW, h: srcH, scaledW: w, scaledH: h, frames: n})
      : rej(new Error(`ffmpeg exit ${c} on ${file}`)));
  });
}
