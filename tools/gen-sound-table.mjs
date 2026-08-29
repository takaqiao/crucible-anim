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
 * ## 为什么表里还要有响度
 *
 * 同一个理由的第二层：**素材之间的响度差得离谱，而 volume 是逐规则手挑的常数**。
 * 实测（改造前）有效峰值 `peakDb + 20·log10(volume)` 跨度 **21.3 dB ≈ 12 倍振幅**，
 * 235 个双段动作里 **153 个「命中音比它前面的风声还轻」**——该最响的那一下排第三。
 * 每条素材的 `peakDb`/`rmsDb` 明明早就量在 `data/audio-profiles.json` 里，只是没人用。
 * 所以第 5/6 列把它们搬进表，由 `gainFor(file, role)` 反算出 volume（见生成物里那段注释）。
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
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";

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
    // 后两列是**响度**，与前四列的时序无关：`peakDb` 给瞬态（打中/挥空这种一下就过去的），
    // `rmsDb` 给持续段（施法床垫）。两者都保留一位小数——`data/audio-profiles.json` 本来
    // 就只量到 0.1 dB，凑更多位是假精度；而 0.1 dB 在 volume 上只有 1.2%，听不出来。
    files.set(f, [Math.round(pr.peakMs ?? 0), Math.round(pr.onsetMs ?? 0),
                  Math.round(pr.effectiveMs ?? pr.durationMs ?? 0),
                  Math.round(pr.durationMs ?? 0),
                  Math.round((pr.peakDb ?? 0) * 10) / 10,
                  Math.round((pr.rmsDb ?? 0) * 10) / 10]);
  }
}

const rows = [...files.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  .map(([f, v]) => `  ${JSON.stringify(f)}: [${v.join(",")}]`).join(",\n");

/* -------------------------------------------- */
/*  POOL —— resolve() 够不到的那半个池              */
/* -------------------------------------------- */

/**
 * 第二张表：**兵库路径 → 它底下真正的整池文件**，只收 `assets.resolve()` 够不到的那些。
 *
 * ## 为什么非有这张表不可
 *
 * `offlineBackend.getEntry`（`resolver/assets.mjs`）对**中间节点取其下第一个叶子作代表**，
 * 运行时侧 `flattenEntry` 对条目数组同样只取第一条。于是「路径指到分支 = 1 个文件」。
 * psfx / MGS 把变体存成**数组叶子**（`resolve` 一次拿到整池，`ctx.sound` 就能摇），
 * 而 **ggg-sfx 全库都是并列的编号子枝**（`….05.01` / `….05.02` / `….05.03`）——
 * 同一条路径每次解析恒定拿到 `01`，「同一件武器连挥三次是三次一模一样的声音」。
 *
 * 池只能由调用方**逐条列出**（`ctx.soundFrom(paths)`），可是叶子路径写不进兵库：
 * `test/armory-assets.test.mjs` 要求规则里的每条路径「精确命中 ASSET-NOTES 主表某行，
 * 或者是某行的**父**路径」，而选材是登记到「装着这一池文件的那个分支」（`….05`）这一级的
 * ——写 `….05.01` 比登记的那一级**更深**，过不了闸。
 *
 * 所以这张表由生成器从索引**机械展开**：兵库只写登记过的那一级分支路径（照样过闸、
 * 照样被死链/否决清单守卫看得见），整池文件由 `POOL[路径]` 给出。展开的每个文件都在
 * 同一行登记的量测范围内（选材那一轮是逐文件量的），不引入任何没签过字的素材。
 *
 * ## 为什么只收「resolve 够不到」的那些
 *
 * 收全了会**关掉 `test/rng-streams.test.mjs` 的火**：那条守卫靠包一层 `assets.resolve`
 * 把兵库里的单文件音效路径伪装成 5 文件池来点火，兵库若一律改走文件路径就再也
 * 点不着（`resolve` 对含 `/` 的路径直接原样返回，绕过了包装）。
 * 判据取 `filesUnder(p).length > 1 && resolve(p).files.length <= 1`：
 * 恰好是「索引里明明有一池、而 resolve 只给得出一个」这一类，也就是 ggg 那种编号子枝
 * （外加 `psfx.casting.generic` 那条跨两层的漏网）。数组叶子一条都不会进来。
 */
const assets = createAssets(offlineBackend(visual));
const pools = new Map();
for (const p of armoryPaths()) {
  const under = filesUnder(p);
  if (under.length <= 1) continue;
  const r = assets.resolve(p);
  if (r && r.files.length > 1) continue;          // resolve 已经拿得到整池，不用这张表
  pools.set(p, under);
}
const poolRows = [...pools.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  .map(([p, v]) => `  ${JSON.stringify(p)}: [\n${v.map(f => `    ${JSON.stringify(f)}`).join(",\n")}\n  ]`)
  .join(",\n");

const BT = "`";
const out = `/**
 * 兵库音效的时序事实 —— **本文件由 ${BT}tools/gen-sound-table.mjs${BT} 生成，不要手改。**
 *
 * 每条是 ${BT}[peakMs, onsetMs, effectiveMs, totalMs, peakDb, rmsDb]${BT}，来自
 * ${BT}data/audio-profiles.json${BT} 的全库量测。前四列是**时序**（毫秒），后两列是**响度**（dBFS，
 * 满刻度为 0）：${BT}peakDb${BT} 是整段的最大瞬时幅度，${BT}rmsDb${BT} 是整段的均方根。
 * 后两列只被 ${BT}gainFor()${BT} 使用，与 ${BT}soundAt()${BT} 的排期完全无关。
 *
 * ⚠ **四个时序量的基准不一样。** ${BT}peakMs${BT} / ${BT}onsetMs${BT} / ${BT}totalMs${BT} 相对素材第 0 毫秒，
 * 而 ${BT}effectiveMs${BT} 相对**起振点**（见 ${BT}tools/profile-audio.mjs${BT} 的包络分析）。所以
 * 「有声内容到第几毫秒为止」是 ${BT}min(totalMs, onsetMs + effectiveMs)${BT}，**不是** ${BT}effectiveMs${BT}。
 * 把 ${BT}effectiveMs${BT} 直接当播放时长用，播出窗会整整早收一个 ${BT}onsetMs${BT}——
 * 曾因此把 33 条挥击风声的响度峰值切在窗外（psfx swooshes 的起振点普遍 170-190ms），
 * 玩家侧的表现就是「挥击没有声音」。
 *
 * 排音效的口径是**「什么时候听见」**而不是「什么时候开始播」：psfx 家族的起音中位数
 * 是 200ms，${BT}psfx.impacts.bludgeoning.v1${BT} 更是 210-240ms 才有声。按命中时刻直接排，
 * 玩家会在刀收招之后才听见那一声。
 *
 * 重新生成： npm run sounds
 */

/** @type {Record<string, [peakMs: number, onsetMs: number, effectiveMs: number, totalMs: number,
 *                         peakDb: number, rmsDb: number]>} */
export const SFX = Object.freeze({
${rows}
});

/**
 * **显式池** —— 兵库路径 → 它底下真正的整池文件。
 *
 * ## 这张表补的是 ${BT}assets.resolve()${BT} 的一个结构性缺口
 *
 * ${BT}offlineBackend.getEntry${BT} 对**中间节点取其下第一个叶子作代表**，运行时侧
 * ${BT}flattenEntry${BT} 对条目数组同样只取第一条：**路径指到分支 = 1 个文件**。
 * psfx / MGS 把变体存成**数组叶子**，${BT}resolve${BT} 一次拿到整池，${BT}ctx.sound${BT} 就能摇；
 * 而 **ggg-sfx 全库都是并列的编号子枝**（${BT}….05.01${BT} / ${BT}….05.02${BT} / …），
 * 同一条路径每次解析恒定拿到 ${BT}01${BT}——「同一件武器连挥三次是三次一模一样的声音」。
 *
 * 池只能由调用方逐条列出（${BT}ctx.soundFrom(paths)${BT}），可是**叶子路径写不进兵库**：
 * ${BT}test/armory-assets.test.mjs${BT} 只认「ASSET-NOTES 主表某一行本身、或它的**父**路径」，
 * 而选材登记到的是「装着这一池文件的那个分支」（${BT}….05${BT}）这一级，写 ${BT}….05.01${BT} 更深、过不了闸。
 * 所以兵库照旧只写登记过的那一级（死链 / 否决清单 / 依据三条守卫照样看得见它），
 * 整池由这张**机械展开**的表给出；展开的每个文件都落在同一行登记的逐文件量测里。
 *
 * ## 只收「resolve 够不到」的那些
 *
 * 判据 ${BT}filesUnder(p).length > 1 且 resolve(p).files.length <= 1${BT}。收全了会关掉
 * ${BT}test/rng-streams.test.mjs${BT} 的火——那条守卫靠包一层 ${BT}assets.resolve${BT} 把兵库的单文件
 * 音效路径伪装成 5 文件池来点火，兵库若一律改走文件路径就再也点不着
 * （${BT}resolve${BT} 对含 ${BT}/${BT} 的路径直接原样返回，绕过包装）。
 *
 * 调用方一律走 ${BT}poolFor()${BT}：表里没有就返回 ${BT}[path]${BT}，退回 ${BT}ctx.sound${BT} 的老路。
 */
export const POOL = Object.freeze({
${poolRows}
});

/**
 * 这条路径该喂给 ${BT}ctx.soundFrom${BT} 的池。表里没有就是「${BT}resolve${BT} 自己够得到」，
 * 原样返回单条路径——调用方拿它走 ${BT}ctx.sound${BT} 与改造前逐字节一致。
 * @param {string|null|undefined} path
 * @returns {string[]}
 */
export function poolFor(path) {
  if (!path) return [];
  return POOL[path] ?? [path];
}

/**
 * 一条音效该在什么时候开始播，才能让它**在 ${BT}atMs${BT} 那一刻响**。
 *
 * ${BT}playFor${BT} 是调用方该写进 cue 的 ${BT}duration${BT}：从 ${BT}startTime${BT} 起播到**有声内容结束**为止。
 *
 * ⚠ **不要用 ${BT}effectiveMs${BT} 当 duration。** 它相对起振点量，而 ${BT}duration${BT} 的口径是
 * 「从 startTime 起还播多久」，两者基准差一个 ${BT}onsetMs${BT}；直接拿来用会把播出窗整整
 * 早收一个起振点。实测曾因此让 379 条 cue 被误裁、其中 33 条挥击风声的响度峰值
 * 落在窗外——那不是「声音小」，是那一声根本没播出来。
 * ${BT}totalMs${BT} 的上钳是必需的：10ms 包络窗的量化误差会让 ${BT}onset+effective${BT} 比素材总长多出
 * 几毫秒，不钳会写出越界的 timeRange。
 *
 * @param {string|null|undefined} file
 * @param {number} atMs  想让它响的时刻（相对本条 cue 所在的时间基准）
 * @returns {{delay: number, startTime: number, peakMs: number, effectiveMs: number,
 *            playFor: number, lateBy: number}|null}
 *          null = 表里没有这个文件（调用方应退回 delay 0，不要静默按 0 当成对齐）
 */
export function soundAt(file, atMs = 0) {
  const s = SFX[file];
  if (!s) return null;
  const [peakMs, onsetMs, effectiveMs, totalMs] = s;
  /** 有声内容的结束时刻（相对素材第 0 毫秒），再减去 startTime 就是该播多久。 */
  const contentEnd = Math.min(totalMs ?? Infinity, onsetMs + effectiveMs);
  const playFrom = st => Math.max(0, Math.round(contentEnd - st));
  if (atMs >= peakMs) {
    return {delay: Math.round(atMs - peakMs), startTime: 0, peakMs, effectiveMs,
            playFor: playFrom(0), lateBy: 0};
  }
  // 想让它响的时刻比它自己的峰值还早——延迟已经压到 0 仍然来不及。
  // 用 startTime 跳进音频：**只跳到起音为止**，那一段是纯静音，跳过去不损失任何声音
  //（psfx.impacts.bludgeoning.v1 的前 240ms 就是静音）。再往后跳会削掉真正的起振，
  // 而起振正是「打中」这个瞬态的听感来源，宁可晚一点也不削。
  const startTime = Math.min(onsetMs, Math.round(peakMs - atMs));
  const lateBy = Math.max(0, Math.round(peakMs - startTime - atMs));
  return {delay: 0, startTime, peakMs, effectiveMs, playFor: playFrom(startTime), lateBy};
}

/**
 * 这条素材的**有声内容到第几毫秒为止**（相对素材第 0 毫秒）。
 *
 * 从第 0 毫秒起播的 cue（施法床垫那一路：${BT}delay: 0${BT}、不写 ${BT}startTime${BT}）该写的
 * ${BT}duration${BT} 就是这个数。
 *
 * ⚠ **不要拿 ${BT}soundAt(f, 0).playFor${BT} 当它用。** ${BT}soundAt${BT} 在「想让它响的时刻早于峰值」
 * 时会用 ${BT}startTime${BT} 跳进音频（跳掉起音那段静音），它返回的 ${BT}playFor${BT} 是**配套那个
 * startTime** 的；调用方若只取 ${BT}playFor${BT} 而不把 ${BT}startTime${BT} 一起写进 cue，播出窗就会
 * 整整**短一个 ${BT}onsetMs${BT}**，从尾巴上削掉同样长的有声内容。
 * psfx 施法族的起音是 0-30ms，正好躲在 ${BT}test/sound-layer.test.mjs${BT} 那条 30ms 容差里，
 * 这个错法一直没被抓住；换上起音 0-130ms 的 ggg 施法族之后一次冒出 31 条。
 *
 * @param {string|null|undefined} file
 * @returns {number|null} null = 表里没有这个文件
 */
export function contentEndOf(file) {
  const s = SFX[file];
  if (!s) return null;
  const [, onsetMs, effectiveMs, totalMs] = s;
  return Math.max(0, Math.round(Math.min(totalMs ?? Infinity, onsetMs + effectiveMs)));
}

/**
 * 响度目标 —— **每个角色该被听成多响**，单位 dBFS（满刻度为 0）。
 *
 * ## 为什么要有这张表
 *
 * 改造前 volume 是五处逐规则手挑的常数（0.55 / 0.6 / 0.7 / 0.8 两处），**与实测响度完全
 * 无关**——尽管每条素材的 ${BT}peakDb${BT}/${BT}rmsDb${BT} 早就量在 ${BT}data/audio-profiles.json${BT} 里。
 * 实测有效峰值（${BT}peakDb + 20·log10(volume)${BT}）跨度 **21.3 dB ≈ 12 倍振幅**：最轻的是重武器
 * 挥击风声 −29.3，最响的是钝击命中音 −8.0；**235 个双段动作里 153 个「命中音比它前面的
 * 风声还轻」**（中位倒挂 −6.7 dB、最深 −13.0）。按角色中位排序是 cast −12.7 > draw −13.3 >
 * impact −17.0 > swing −20.4：**该最响的那一下排第三**。换句话说「哪一声该突出」从前完全由素材录制时
 * 的电平随机决定，而不是由这一下在打斗里的地位决定。
 *
 * ## 档位与基准
 *
 * | 角色 | 是哪一声 | 目标 | 基准 |
 * | --- | --- | --- | --- |
 * | ${BT}impact${BT} | 打中 / 打空 | −12 dB | peak |
 * | ${BT}draw${BT} | 拉弓放弦 | −14 dB | peak |
 * | ${BT}swing${BT} | 挥击风声 | −18 dB | peak |
 * | ${BT}cast${BT} | 施法床垫 | −30 dB | **rms** |
 *
 * **瞬态对齐峰值、持续段对齐 RMS**：一记命中的听感由那个几毫秒的尖峰决定，峰外能量再多
 * 也不改变「响不响」；施法音是一整段渐强的床垫，用峰值对齐会被段内单个爆点带偏
 * （${BT}cast-water-03${BT} 的峰值落在 2420ms 那一团上，而同族其余四条都在 760-770ms）。
 * 时域包络峰均比 ${BT}peakDb − rmsDb${BT} 佐证了这个分野：表内 24 条 cast 素材全部 ≤10.3 dB，
 * 而 impact/swing/draw 的中位是 12.1/14.1/12.9——cast 族确实是「厚而不尖」的那一类。
 *
 * cast 的 −30 是**扫出来的**，不是拍的：固定另外三档扫 cast 的 RMS 目标。
 * 上一轮（psfx 施法族语料，540 条 cue）扫出的是 −25：
 * ${BT}−20→跨度15.2dB/倒挂130${BT}、${BT}−22→13.2/96${BT}、${BT}−24→12.9/77${BT}、${BT}−25→12.9/34${BT}、${BT}−26..−28→12.9/34${BT}。
 *
 * **12 符文施法音落地后必须重扫，而且最优值真的搬家了。** 换上的 ggg 施法族峰均比
 * 明显更高（${BT}Arcane Ripple 004${BT} peak −8.0 / rms −21.2 = **13.2 dB**，而 psfx 施法族
 * 24/24 都在 10.4 dB 以下）——同一个 RMS 目标下，它们的**峰值**要高出 4-5 dB。
 * 本语料 567 条 cue 重扫：
 * ${BT}−25→跨度13.1/倒挂85${BT}、${BT}−26→12.9/75${BT}、${BT}−27→12.9/56${BT}、${BT}−28→12.9/48${BT}、
 * ${BT}−29→12.9/44${BT}、**${BT}−30→12.9/36${BT}**、${BT}−31→13.0/20${BT}、${BT}−32→14.0/17${BT}。
 * −30 是**跨度仍守在 12.9、而倒挂降回棘轮线以下**的第一个（也就是最响的）取值；
 * 再往下 −31/−32 倒挂还能降，但全局跨度开始反弹（床垫本身变成了最轻的那一端），
 * 那是用「让床垫听不见」换来的，不算改进。
 *
 * 换句话说，**这一档不是「音量偏好」而是「峰均比模型的补偿量」**：换施法素材族就要重扫。
 * 若哪天施法族换回低峰均比的素材，这个数会自己往回走。
 *
 * 方向与既有记录一致，不是翻案：${BT}docs/ASSET-NOTES.md${BT} 早写着
 * ${BT}psfx.weapon-swooshes.heavy.v1.group01${BT}「低频量明显多于 light 组，和 impacts.bludgeoning
 * 同帧叠加时低频会堆到爆，impact 那一路建议压 -3dB」——本表把 bludgeoning 从 0.8 压到 0.507
 * （−4.0 dB），方向与幅度都落在这条上。
 * **反向风险为零**：gain 恒 ≤1，没有任何素材被放大，底噪抬不起来。
 *
 * ## 三条必须留在这里的订正
 *
 * 1. 「cast 与其余三族峰均比零重叠」**不成立，只单向成立**：cast 24/24 都在 10.4 dB 线下，
 *    但线下另有 6 条非 cast（impact 4 条：slashing-02 8.0 / necrotic-00 8.0 / slashing-03 8.9 /
 *    slashing-00 9.3；swing 2 条：swoosh-heavy-03 9.7 / -01 9.8）。所以峰均比**只能做交叉验证，
 *    绝不能做运行时判据**——角色必须由规则显式给出。这正是 ${BT}role${BT} 做成必填入参、而本函数
 *    绝不自己从素材去猜的原因；把那 6 条按峰均比猜成 cast，等于把命中音压到床垫档。
 * 2. 归一化之后 impact 只升到**第二**：draw −14.0 > impact −14.4 > swing −18.0 > cast −21.0（按角色中位）。
 *    差额不在这张表里，在**素材**——19 个命中素材有 12 个连 −12 dB 都够不到（最惨的
 *    ${BT}necrotic-00${BT} 峰值只有 −22.6，欠 10.6 dB），而 volume 只能衰减不能放大：Sequencer 的
 *    ${BT}this._volume = Math.max(0, Math.min(1, inVolume))${BT}（${BT}test/sequencer-contract.test.mjs${BT} 有
 *    源码断言钉住它）。要让命中音真正排第一得换素材，不是调这张表。
 * 3. ${BT}GAIN_FLOOR = 0.10${BT} 在当前语料上**永不触发**（未钳制的最小值是 cast 的 0.148）。
 *    它是纯防御值，**别当成在起作用的机制**：真触发意味着某条素材比它的角色目标还响
 *    20 dB 以上，那更可能是量测出错而不是素材太响。
 */
export const GAIN_TARGET = Object.freeze({
  impact: Object.freeze({db: -12, base: "peak"}),
  draw:   Object.freeze({db: -14, base: "peak"}),
  swing:  Object.freeze({db: -18, base: "peak"}),
  cast:   Object.freeze({db: -30, base: "rms"})
});

/** 下钳。当前语料上永不触发（见 GAIN_TARGET 注释第 3 条），纯防御。 */
export const GAIN_FLOOR = 0.10;
/**
 * 上钳。**这一条是硬约束不是选择**：Sequencer 的 SoundSection.volume() 自己就在
 * ${BT}Math.max(0, Math.min(1, inVolume))${BT}，写 >1 不会更响、只会让计划里的数字骗人。
 */
export const GAIN_CEIL = 1.00;

/**
 * 这条素材在这个角色上该用多大 volume。
 *
 * ${BT}volume = 10^((目标dB − 基准dB) / 20)${BT}，再钳到 ${BT}[GAIN_FLOOR, GAIN_CEIL]${BT}。
 *
 * @param {string|null|undefined} file
 * @param {"impact"|"draw"|"swing"|"cast"|null|undefined} role
 * @returns {number|null} null = 表里没有这个文件、或者角色不认识。
 *          **调用方必须写成 ${BT}gainFor(f, role) ?? <原来的常数>${BT}，不许静默按 1** —— 按 1 会让
 *          一条查不到的素材突然比全场响 3-8 dB，那比不归一化更糟。
 */
export function gainFor(file, role) {
  const s = SFX[file];
  const t = GAIN_TARGET[role];
  if (!s || !t) return null;
  // 第 5 列 peakDb 给瞬态，第 6 列 rmsDb 给持续段。
  const base = t.base === "rms" ? s[5] : s[4];
  if (typeof base !== "number" || !Number.isFinite(base)) return null;
  const raw = 10 ** ((t.db - base) / 20);
  // 保留三位小数：volume 再往下的位在听感上早已无意义，而计划是要下发给每个客户端的，
  // 短数字让 plan 的 diff 可读（0.1 dB 的量测精度对应 volume 上约 1.2%，三位小数够用）。
  return Math.round(Math.min(GAIN_CEIL, Math.max(GAIN_FLOOR, raw)) * 1000) / 1000;
}
`;

writeFileSync(join(ROOT, "scripts/armory/sound-table.mjs"), out);
console.log(`${files.size} 个音效文件 / ${pools.size} 条显式池 → scripts/armory/sound-table.mjs`);
