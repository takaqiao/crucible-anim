/**
 * 音频探针：采样率 / 声道 / 时长。
 *
 * ogg 走纯 Node 解容器头，不起子进程——MGS 的 SFX 树有 2263 个文件，
 * 逐个调 ffmpeg 要跑很久，而我们只需要三个数字，它们都明摆在 Ogg 页里。
 * 其余格式（soundfxlibrary 是 mp3）回退到 `ffmpeg -i`。
 *
 * ⚠ **文件时长不等于音效时长。** psfx 大量文件被 padding 到整数秒（swoosh 恰好 3.00s、
 * weapon-attacks 3.50s、conditions 6.00s），尾部是数字静音，实际可听内容常常只占前
 * 1–1.5 秒。做音画同步时不能拿这里的 duration 当依据——那要靠起振点检测。
 * 这个函数只用于**分类与过滤**（挑出 ≥10s 的环境循环），不用于时序标注。
 */
import {openSync, readSync, closeSync, statSync} from "node:fs";
import {extname} from "node:path";
import {execFileSync} from "node:child_process";

/**
 * Ogg/Vorbis：
 *   - 采样率与声道数在第一个 Ogg page 里的 identification header（0x01 "vorbis"）
 *   - 时长 = 最后一个 Ogg page 的 granule position ÷ 采样率
 *     （granule 对 Vorbis 而言就是已解码的采样点数）
 */
function probeOgg(file) {
  const fd = openSync(file, "r");
  try {
    const size = statSync(file).size;
    const head = Buffer.alloc(Math.min(4096, size));
    readSync(fd, head, 0, head.length, 0);
    const i = head.indexOf(Buffer.from([0x01, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73])); // 0x01 "vorbis"
    if (i < 0) return null;
    const channels = head[i + 11];
    const sampleRate = head.readUInt32LE(i + 12);
    if (!sampleRate) return null;

    // 尾部倒着找最后一个 "OggS"；granule position 是它偏移 6 起的 8 字节小端
    const tailLen = Math.min(65536, size);
    const tail = Buffer.alloc(tailLen);
    readSync(fd, tail, 0, tailLen, size - tailLen);
    let last = -1, p = 0;
    while ((p = tail.indexOf("OggS", p)) !== -1) { last = p; p += 4; }
    let duration = null;
    if (last >= 0 && last + 14 <= tailLen) {
      const granule = tail.readBigUInt64LE(last + 6);
      // 0xFFFFFFFFFFFFFFFF 是「本页无 granule」的哨兵，不是天文数字的时长
      if (granule !== 0xFFFFFFFFFFFFFFFFn) duration = Number(granule) / sampleRate;
    }
    return {sampleRate, channels, duration, bytes: size};
  } finally { closeSync(fd); }
}

/**
 * ffmpeg 惰性解析。**刻意不 import `./media.mjs`**：那个模块在加载时就会因为找不到
 * ffmpeg 抛错，而 MGS 全是 ogg，只处理 ogg 的机器不该被一个用不到的依赖挡住。
 * 与 media.mjs 共用同一个环境变量名，行为一致。
 */
let ffmpegPath;
function resolveFfmpeg() {
  if (ffmpegPath !== undefined) return ffmpegPath;
  const local = process.env.LOCALAPPDATA || "";
  const candidates = [
    process.env.CRUCIBLE_ANIM_FFMPEG,
    "ffmpeg",
    local && `${local}\\oopz\\ffmpeg.exe`
  ].filter(Boolean);
  for (const c of candidates) {
    try { execFileSync(c, ["-version"], {stdio: "ignore"}); return (ffmpegPath = c); }
    catch { /* 试下一个 */ }
  }
  return (ffmpegPath = null);
}

function probeViaFfmpeg(file) {
  const bin = resolveFfmpeg();
  if (!bin) return null;
  let out = "";
  try {
    // `ffmpeg -i` 只为打印信息时以非 0 退出，这不是失败——信息在 stderr 里
    execFileSync(bin, ["-hide_banner", "-i", file], {stdio: ["ignore", "ignore", "pipe"]});
  } catch (e) { out = (e.stderr ?? "").toString(); }
  const d = out.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  const a = out.match(/Audio:\s*[^,]+,\s*(\d+)\s*Hz,\s*(\w+)/);
  if (!d && !a) return null;
  return {
    sampleRate: a ? +a[1] : null,
    channels: a ? (a[2] === "mono" ? 1 : a[2] === "stereo" ? 2 : null) : null,
    duration: d ? (+d[1] * 3600 + +d[2] * 60 + +d[3]) : null,
    bytes: statSync(file).size
  };
}

/** @returns {{sampleRate: number|null, channels: number|null, duration: number|null, bytes: number}|null} */
export function probeAudio(file) {
  const ext = extname(file).toLowerCase();
  if (ext === ".ogg" || ext === ".oga") {
    const r = probeOgg(file);
    if (r) return r;
  }
  return probeViaFfmpeg(file);
}
