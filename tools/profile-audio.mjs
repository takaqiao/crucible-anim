/**
 * 批量量测音频，产出 `data/audio-profiles.json`。
 *
 * ## 它解决的问题
 *
 * **文件时长不等于音效时长。** `V2-ASSET-SURVEY.md` §5.4 记着：psfx 大量文件被 padding
 * 到整数秒（swoosh 恰好 3.00s、weapon-attacks 3.50s、conditions 6.00s），尾部是数字静音，
 * 实际可听内容常常只占前 1–1.5 秒。而 `weapon-swooshes` 家族还有 0.55 秒的**前置静音**
 * （ASSET-NOTES 的 psfx 行原话：「swooshes 家族通病，需提前触发」）。
 *
 * 拿 duration 去对齐画面，结果就是「挥砍动画都放完了声音才响」。V2 的音效层有 1818 条 cue
 * 要对齐，这个数必须是量出来的，不能是猜的。
 *
 * | 量 | 为什么要 |
 * | --- | --- |
 * | `onsetMs` | 起振点。音画同步的锚在这里，不在文件开头 |
 * | `peakMs` | 最响的时刻。命中音要把它对到冲击帧上 |
 * | `tailSilenceMs` | 尾部静音。`waitUntilFinished` 会白等这么久；也是 psfx padding 的直接度量 |
 * | `effectiveMs` | 起振到实际结束。这才是「这条音效有多长」 |
 * | `peakDb` / `rmsDb` | 响度。跨库混用时（psfx 44.1k / ggg 192k / MGS 48k）用来配平，不然有的震耳有的听不见 |
 * | `sampleRate` / `channels` | ggg 全库 192kHz，本地已实测；混用时要知道谁是谁 |
 *
 * ## 做法
 *
 * 时域：ffmpeg 解成单声道 22050Hz 的 s16le PCM（包络分析用不着更高），在 Node 里按 10ms 窗
 * 算 RMS 包络，再从包络推出上面那些量。降采样让全库两千多条跑得动。
 *
 * ## 用法
 *
 *   node tools/profile-audio.mjs --ns psfx --jobs 12
 *   node tools/profile-audio.mjs --db canim.mgs.basic.combat
 *   node tools/profile-audio.mjs --dir systems/crucible/assets/sfx
 *
 * 断点续跑：每 200 个文件落一次盘，已量测过的默认跳过（--redo 强制重量）。
 */
import {readFileSync, writeFileSync, renameSync, existsSync, readdirSync} from "node:fs";
import {join, dirname, relative, sep, extname} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {spawn} from "node:child_process";
import {FOUNDRY_DATA} from "./paths.mjs";
import {FFMPEG} from "./media.mjs";
import {probeAudio} from "./audio.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data/audio-profiles.json");

/** 包络分析的采样率。22050 足够定位起振与峰值，且比原始码流快一个数量级。 */
const ANALYSIS_RATE = 22050;
/** 包络窗长（毫秒）。10ms 对「起振点」这个量级的判断足够细。 */
const WINDOW_MS = 10;

/**
 * 「有声」的门限，相对全曲峰值的分贝。
 *
 * -45 dB 不是拍的：psfx 的 padding 是**数字静音**（精确的 0 采样），而模拟录音的底噪
 * 通常在 -60 dB 上下。门限设在两者之间，既能把数字静音准确切掉，又不会把很轻的
 * 尾音（残响、耳鸣尾）误判成静音——`psfx.cantrips.mind-sliver` 那条 3.3 秒的耳鸣尾
 * 就在 -40 dB 附近，切掉它是错的。
 */
const SILENCE_DB = -45;

const AUDIO_EXT = new Set([".ogg", ".oga", ".mp3", ".wav", ".m4a"]);

/** 解成单声道 PCM 并按窗算 RMS 包络。不整片读进内存。 */
function envelope(abs) {
  return new Promise((res, rej) => {
    const p = spawn(FFMPEG, ["-v", "error", "-i", abs,
      "-f", "s16le", "-acodec", "pcm_s16le", "-ac", "1", "-ar", String(ANALYSIS_RATE), "-"]);
    const per = Math.round(ANALYSIS_RATE * WINDOW_MS / 1000);   // 每窗采样数
    const env = [];
    let acc = 0, n = 0, carry = null;
    p.stdout.on("data", d => {
      let buf = d;
      if (carry) { buf = Buffer.concat([carry, d]); carry = null; }
      const usable = buf.length - (buf.length % 2);
      for (let i = 0; i < usable; i += 2) {
        const s = buf.readInt16LE(i) / 32768;
        acc += s * s;
        if (++n === per) { env.push(Math.sqrt(acc / per)); acc = 0; n = 0; }
      }
      if (usable < buf.length) carry = Buffer.from(buf.subarray(usable));
    });
    let err = "";
    p.stderr.on("data", d => { err += d.toString(); });
    p.on("error", rej);
    p.on("close", c => {
      if (n) env.push(Math.sqrt(acc / n));
      c === 0 ? res(env) : rej(new Error(`ffmpeg exit ${c} on ${abs}: ${err.slice(0, 120)}`));
    });
  });
}

const toDb = v => v > 0 ? 20 * Math.log10(v) : -Infinity;

/**
 * 频域特征。
 *
 * V1 那轮 psfx 侦察的方法是 `ffmpeg showspectrumpic` 渲频谱图**并实际读图**，
 * 用肉眼判断音色（「低频轰鸣为主 + 宽频嘶声」「三条细高频正弦约 6.6k/11.5k/16.5kHz
 * 像耳鸣」）。那是音频版的联系表——**只做 RMS 包络等于只量了时间轴，没量音色**。
 *
 * `aspectralstats` 是它的机器版，逐帧给出：
 *
 * | 量 | 对应人读图时说的 |
 * | --- | --- |
 * | `centroid` (Hz) | 重心在哪：低 = 轰鸣/闷，高 = 嘶声/尖 |
 * | `flatness` (0–1) | 噪声型（挥砍、爆炸）vs 音调型（钟、咏唱） |
 * | `rolloff` (Hz) | 能量集中到多高 |
 * | `spread` (Hz) | 带宽，窄 = 单音，宽 = 宽频 |
 * | `flux` | 频谱变化速度，高 = 瞬态强（打击），低 = 平稳（持续层） |
 *
 * 取**有声段的中位数**：用逐帧 `mean`（谱能量）相对全曲峰值做门限筛掉静音帧，
 * 否则 psfx 那四成的 padding 会把所有统计量往零拉。
 *
 * 下混单声道后只解析 `.1.` 通道——立体声两个声道的谱统计几乎一致（实测 centroid
 * 6537 vs 6533），分别统计只是把解析量翻倍。
 */
export function spectralFeatures(abs) {
  return new Promise((res) => {
    const p = spawn(FFMPEG, ["-v", "error", "-i", abs,
      "-af", "aformat=channel_layouts=mono,aspectralstats=win_size=1024,ametadata=mode=print:file=-",
      "-f", "null", "-"]);
    let out = "";
    p.stdout.on("data", d => { out += d.toString(); });
    p.on("error", () => res(null));
    p.on("close", () => {
      const frames = [];
      let cur = null;
      for (const line of out.split("\n")) {
        if (line.startsWith("frame:")) { if (cur) frames.push(cur); cur = {}; continue; }
        const m = line.match(/^lavfi\.aspectralstats\.1\.(\w+)=([-\d.e+]+)$/);
        if (m && cur) cur[m[1]] = Number(m[2]);
      }
      if (cur) frames.push(cur);
      const voicedGate = Math.max(...frames.map(f => f.mean ?? 0)) * 0.02;
      const voiced = frames.filter(f => (f.mean ?? 0) >= voicedGate);
      if (!voiced.length) return res(null);
      const med = k => {
        const v = voiced.map(f => f[k]).filter(x => Number.isFinite(x)).sort((a, b) => a - b);
        return v.length ? +v[Math.floor(v.length / 2)].toFixed(3) : null;
      };
      res({
        centroidHz: med("centroid"), rolloffHz: med("rolloff"), spreadHz: med("spread"),
        flatness: med("flatness"), flux: med("flux"), crest: med("crest"),
        specFrames: voiced.length
      });
    });
  });
}

/** @returns {object|null} */
export async function profileAudioFile(abs) {
  const meta = probeAudio(abs);
  const env = await envelope(abs);
  if (!env.length) return null;

  const peak = Math.max(...env);
  if (peak <= 0) {
    return {sampleRate: meta?.sampleRate ?? null, channels: meta?.channels ?? null,
            durationMs: Math.round((meta?.duration ?? 0) * 1000),
            onsetMs: null, peakMs: null, tailSilenceMs: null, effectiveMs: 0,
            peakDb: null, rmsDb: null, silent: true};
  }
  const floor = peak * Math.pow(10, SILENCE_DB / 20);

  let first = 0;
  while (first < env.length && env[first] < floor) first++;
  let last = env.length - 1;
  while (last > first && env[last] < floor) last--;

  const peakIdx = env.indexOf(peak);
  const totalMs = env.length * WINDOW_MS;
  // RMS 只算有声段，否则 padding 会把响度算低，跨库配平就错了
  const voiced = env.slice(first, last + 1);
  const rms = voiced.length
    ? Math.sqrt(voiced.reduce((a, v) => a + v * v, 0) / voiced.length) : 0;

  const spec = await spectralFeatures(abs);

  return {
    ...(spec ?? {}),
    sampleRate: meta?.sampleRate ?? null,
    channels: meta?.channels ?? null,
    durationMs: Math.round((meta?.duration ?? totalMs / 1000) * 1000),
    onsetMs: first * WINDOW_MS,
    peakMs: peakIdx * WINDOW_MS,
    tailSilenceMs: (env.length - 1 - last) * WINDOW_MS,
    effectiveMs: (last - first + 1) * WINDOW_MS,
    peakDb: +toDb(peak).toFixed(1),
    rmsDb: +toDb(rms).toFixed(1),
    silent: false
  };
}

/* -------------------------------------------- */

function* walkAudio(dir) {
  for (const e of readdirSync(dir, {withFileTypes: true})) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walkAudio(p);
    else if (AUDIO_EXT.has(extname(e.name).toLowerCase())) yield p;
  }
}

/** 取某个 DB 前缀底下的全部音频（索引里 psfx / ggg-sfx / blfx / canim 都在）。 */
function filesUnderDbPrefix(prefix) {
  const idx = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
  let node = idx.tree;
  for (const p of prefix.split(".")) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return [];
    node = node[p];
  }
  const out = new Set();
  const walk = n => {
    if (typeof n === "string") { out.add(n); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n && typeof n === "object") for (const [k, v] of Object.entries(n)) { if (!k.startsWith("_")) walk(v); }
  };
  walk(node);
  return [...out].filter(f => AUDIO_EXT.has(extname(f).toLowerCase()));
}

const arg = name => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : null;
};

const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;

if (isMain) {
  const ns = arg("ns"), dbPrefix = arg("db"), dir = arg("dir");
  const jobs = Math.max(1, +(arg("jobs") ?? 8));
  const redo = process.argv.includes("--redo");
  const CHECKPOINT = 200;

  let rels;
  if (ns || dbPrefix) {
    rels = filesUnderDbPrefix(ns ?? dbPrefix);
    if (!rels.length) { console.error(`${ns ?? dbPrefix} 底下没有音频`); process.exit(2); }
  } else if (dir) {
    const abs = join(FOUNDRY_DATA, dir);
    if (!existsSync(abs)) { console.error(`--dir ${dir} 不存在`); process.exit(2); }
    rels = [...walkAudio(abs)].map(p => relative(FOUNDRY_DATA, p).split(sep).join("/"));
  } else {
    console.error("用法： node tools/profile-audio.mjs (--ns <命名空间> | --db <前缀> | --dir <相对 Data 的目录>) [--jobs 8] [--redo]");
    process.exit(2);
  }

  const store = existsSync(OUT) ? JSON.parse(readFileSync(OUT, "utf8")) : {generated: null, profiles: {}};
  store.profiles ??= {};

  const onDisk = rels.filter(r => existsSync(join(FOUNDRY_DATA, decodeURI(r))));
  const todo = redo ? onDisk : onDisk.filter(r => !store.profiles[r]);
  console.log(`待量测 ${todo.length} 个（磁盘缺失 ${rels.length - onDisk.length}，` +
              `已量测跳过 ${onDisk.length - todo.length}），并发 ${jobs}，每 ${CHECKPOINT} 个落盘`);
  if (!todo.length) { console.log("没有要做的。"); process.exit(0); }

  let done = 0, failed = 0, interrupted = false;
  const flush = () => {
    store.generated = new Date().toISOString().slice(0, 10);
    const tmp = `${OUT}.tmp`;
    writeFileSync(tmp, JSON.stringify(store));
    renameSync(tmp, OUT);
  };
  process.on("SIGINT", () => {
    if (interrupted) process.exit(130);
    interrupted = true;
    console.log("\n收到中断，落盘后退出……");
  });

  const queue = todo.slice();
  async function worker() {
    for (;;) {
      const rel = queue.shift();
      if (!rel || interrupted) return;
      try {
        const p = await profileAudioFile(join(FOUNDRY_DATA, decodeURI(rel)));
        if (p) store.profiles[rel] = p; else failed++;
      } catch (err) { failed++; console.error(`✗ ${rel}: ${err.message}`); }
      if (++done % CHECKPOINT === 0) { flush(); console.log(`  ${done}/${todo.length}  已落盘`); }
    }
  }
  await Promise.all(Array.from({length: jobs}, worker));

  flush();
  console.log(`已写入 data/audio-profiles.json（累计 ${Object.keys(store.profiles).length} 条，` +
              `本轮完成 ${done}/${todo.length}，失败 ${failed}${interrupted ? "，被中断" : ""}）`);
}
