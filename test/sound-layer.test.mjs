/**
 * 音效层 —— 覆盖率棘轮 + 时序正确性。
 *
 * ## 改造前的状态
 *
 * 434 个动作里**只有 11 个有声音**（远程拉弓那一条）。刀砍上去没有声音，砍空了也没有。
 *
 * ## 这一层最容易做错的事：把「开始播」当成「听见」
 *
 * 全库 7,322 条音频量测里，psfx 家族的起音中位数是 **200ms**，
 * `psfx.impacts.bludgeoning.v1` 更是 **210-240ms 才有声、峰值在 250ms**。
 * 按命中时刻直接排下去，玩家会在刀已经收招之后四分之一秒才听见那一声。
 *
 * 所以排音效的口径是 `delay = 想让它响的时刻 − 响度峰值时刻`（`armory/sound-table.mjs`
 * 的 `soundAt`）。下面第二条守卫钉的就是这个：**音效的响点必须落在画面的命中点上**。
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {resolve} from "../scripts/resolver/resolve.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import {SFX} from "../scripts/armory/sound-table.mjs";
import {clipOf} from "../scripts/armory/clip-table.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const actions = JSON.parse(readFileSync(join(ROOT, "test/fixtures/actions.json"), "utf8"));
const mk = () => createAssets(offlineBackend(index));

/**
 * 目标：一路涨到全语料。**只许增不许减。**
 *
 * 【2026-08-30 批次 E · §4.1】303 → **429**。改造前 434 个动作里 128 条全程无声
 *（29.5%），全部落在 8 条「从来不发声」的规则上；本轮 cast 槽那 6 条
 *（`self.shape` / `generic.cast` / `tag.skill` / `cast.target.single` /
 * `cast.spell.iconic` / `tag.healing`）各按 `self-shapes.mjs` 的 `actionSoundFor`
 * 分档配音，另加一条 `spell.wordless` 接住 12 条连 cast cue 都拿不到的无符文戏法。
 *
 * **429 = 434 − 5**，而不是 434：`move` / `fall` / `delay` / `cast` / `rest` 五条是
 * **有意静音**（逐条理由见 `self-shapes.mjs` 的 `SILENT_ACTION`，其中 `fall` 是原生
 * `canvas/vfx/landing.mjs` 独占的地盘，本模组在它身上不出手）。所以这条棘轮到顶了：
 * 再涨说明有人把那五条里的某一条弄出声了。
 */
const BASELINE = Object.freeze({actionsWithSound: 429});

/**
 * 用**素材亮度峰值**定命中点的规则——也就是走 `clip-table` 那一套的挥击规则。
 * 法术规则不在此列：它们的交棒点是手调的、锚在自带闪爆窗口上。
 */
const CLIP_DRIVEN = new Set([
  "strike.melee", "strike.unarmed", "strike.melee.combo", "strike.ranged.weapon"
]);

/**
 * 一条音效 cue 的**播出窗**（相对素材自身的第 0 毫秒）。
 *
 * `duration` 的口径是「从 startTime 起还播多久」（见 `resolver/resolve.mjs` 的
 * CUE_DEFAULTS 注释与 `player/play.mjs` 的 `applyTimeWindow`），所以窗是
 * `[startTime, startTime + duration]`；`duration` 为空表示一直播到素材自然结束。
 */
function window_(c) {
  const start = c.startTime ?? 0;
  const total = SFX[c.file]?.[3] ?? Infinity;     // 第 4 列：素材总长
  return {start, end: c.duration == null ? total : start + c.duration};
}

/**
 * 一条音效 cue 实际**响**在第几毫秒；**峰值播不出来时返回 null**。
 *
 * ⚠ 这里从前只看 `delay` 与 `startTime`，**假定峰值一定播得出来**——那是个真实的盲点：
 * `peakMs` 相对素材第 0 毫秒量，而 `effectiveMs` 相对**起振点** `onsetMs` 量
 *（`tools/profile-audio.mjs`），内容真实区间是 `[onsetMs, onsetMs+effectiveMs]`。
 * 兵库四处把 `duration` 写成 `effectiveMs`，播出窗于是比内容整整早收一个 `onsetMs`，
 * 33 条挥击风声的峰值被切在窗外——而旧 `heard()` 照样给它们算出一个漂亮的响点，
 * 两条既有守卫（音画同步、风声在前）因此对「这一声根本没播出来」完全无感。
 */
function heard(c) {
  const [peakMs] = SFX[c.file];
  const w = window_(c);
  if (peakMs < w.start || peakMs > w.end) return null;   // 峰值不在窗内 = 没播到那一声
  return (c.delay ?? 0) + (peakMs - w.start);
}

/** 全语料的音效 cue（单目标口径：`parallelizeTargets` 只改 delay，不改 file/duration）。 */
const soundCues = () => actions.flatMap(s => {
  const p = resolve({...s, targets: (s.targets ?? []).slice(0, 1)}, {assets: mk(), armory: ARMORY});
  return (p?.cues ?? []).filter(c => c.kind === "sound" && SFX[c.file]).map(c => [s, c]);
});

const plans = actions.map(s => [s, resolve(s, {assets: mk(), armory: ARMORY})]);

test("音效棘轮：有声音的动作数只许增不许减", () => {
  const n = plans.filter(([, p]) => (p?.cues ?? []).some(c => c.kind === "sound")).length;
  assert.ok(n >= BASELINE.actionsWithSound,
    `有声音的动作从 ${BASELINE.actionsWithSound} 掉到 ${n}`);
});

test("音效基线必须贴着实测值", () => {
  const n = plans.filter(([, p]) => (p?.cues ?? []).some(c => c.kind === "sound")).length;
  assert.ok(n - BASELINE.actionsWithSound <= 3,
    `音效覆盖已经涨到 ${n}，基线还挂在 ${BASELINE.actionsWithSound}。棘轮只有贴着走才有意义。`);
});

/**
 * **音效的响点必须落在画面的命中点上。**
 *
 * 这是整层唯一真正难做对的事，也是唯一值得写守卫的地方。判据独立算：
 * 从计划里取同一目标的 travel 画面 cue 与音效 cue，
 * 用 `clipOf` 拿画面的命中时刻、用 `SFX` 拿音效的响度峰值，两者相加必须对齐。
 *
 * 不比「delay 等于某个数」——那会退化成同义反复（两边都来自同一张表）。
 */
test("命中音的响点落在画面的命中点上，晚了必须是物理上避不开的", () => {
  const bad = [];
  let checked = 0;
  for (const [s, plan] of plans) {
    if (!plan) continue;
    for (const t of s.targets ?? []) {
      const own = plan.cues.filter(c => c.slot === "travel" && c.forTarget === t.tokenId);
      // 取**最后**一条画面 cue：强力打击会在挥击之前先推一条拖尾，拿 `find` 会取到拖尾，
      // 而命中时刻是按挥击那一支算的（两者素材不同、峰值帧也不同）。
      const visuals = own.filter(c => c.kind !== "sound" && c.file);
      const visual = visuals[visuals.length - 1];
      const sounds = own.filter(c => c.kind === "sound" && SFX[c.file]);
      if (!visual || !sounds.length) continue;
      // **只核挥击类规则。** 这条守卫的判据是「画面命中点 = 素材的亮度峰值」，
      // 那是挥击规则的构造方式（`waitUntilFinished = contactMs - durationMs`）。
      // 法术规则的交棒点是**手调**的、锚在素材自带闪爆的窗口上，与亮度峰值不是一回事
      // ——实测 `spell.control.arrow` 的亮度峰值在 1567ms 而交棒点在 1667ms，
      // 拿峰值当参照会把排得完全正确的声音判成晚了 100ms。
      if (!CLIP_DRIVEN.has(visual.rule)) continue;
      const clip = clipOf(visual.file);
      if (!clip) continue;
      checked++;
      // `strikeSounds` 先推风声再推命中音，所以**最后一条就是命中音**。短挥击来不及
      // 塞风声时只有一条，那一条也是命中音。
      // 响点 = delay + （峰值 − startTime）。**startTime 不能漏**：来不及提前时规则会
      // 用 startTime 跳进音频（跳过的是纯静音段），漏算它会把已经对齐的判成不齐。
      const contactAt = (visual.delay ?? 0) + clip.contactMs;
      const hit = heard(sounds[sounds.length - 1]);
      if (hit === null) {
        bad.push(`${s.id}: 命中音的峰值落在播出窗之外——这一声根本没播出来，谈不上对不对齐`);
        continue;
      }
      const off = hit - contactAt;
      if (off < -2) {
        bad.push(`${s.id}: 命中音**早**了 ${-off}ms（响于 ${hit}，画面命中 ${contactAt}）——早于画面是纯错误`);
      } else if (off > 2) {
        // 晚是可以的，但**必须是物理上避不开的那种**：把这条音效前面的静音全部跳掉之后，
        // 它的响度峰值仍然落在命中时刻之后。判据独立算自量测（峰值 − 起音），
        // 不引用 soundAt 的实现，否则就是同义反复。
        const [peakMs, onsetMs] = SFX[sounds[sounds.length - 1].file];
        const earliestPossible = peakMs - onsetMs;
        if (earliestPossible <= clip.contactMs) {
          bad.push(`${s.id}: 命中音晚了 ${off}ms，但它跳掉静音后最早能在 ${earliestPossible}ms 响、`
                 + `画面命中在 ${clip.contactMs}ms——本来排得进去`);
        }
      }
    }
  }
  assert.ok(checked >= 100, `只核了 ${checked} 组`);
  assert.deepEqual(bad.slice(0, 8), [],
    `${bad.length} 组音画不同步。排音效要按「什么时候听见」而不是「什么时候开始播」：` +
    "delay = 目标时刻 − 峰值时刻；来不及时用 startTime 跳掉前面的静音段。");
});

/** 风声必须排在命中音之前，否则听起来是「铛——唰」。 */
test("风声响在命中音之前", () => {
  const bad = [];
  for (const [s, plan] of plans) {
    if (!plan) continue;
    for (const t of s.targets ?? []) {
      const sounds = plan.cues.filter(c => c.slot === "travel" && c.forTarget === t.tokenId
                                        && c.kind === "sound" && SFX[c.file]);
      if (sounds.length < 2) continue;
      const h = sounds.map(heard);
      if (h[0] === null || h[1] === null) {
        bad.push(`${s.id}: 有一声的峰值落在播出窗之外（风声=${h[0]} 命中=${h[1]}），顺序无从谈起`);
      } else if (h[0] >= h[1]) {
        bad.push(`${s.id}: 风声响于 ${h[0]}ms，命中音响于 ${h[1]}ms`);
      }
    }
  }
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} 组的两声顺序反了`);
});

/**
 * **每一条音效的响度峰值都必须落在它自己的播出窗内。**
 *
 * 这是「声效不够明显」的机制性来源：不是音量小，是**那一声根本没播**。
 * 判据独立算自 `data/audio-profiles.json` 生成的 SFX 表原始列（peakMs 与素材总长），
 * 不引用 `soundAt()` 的任何返回值，因此不是同义反复。
 */
test("音效的响度峰值必须落在播出窗内 —— 切掉峰值等于这一声没播", () => {
  const bad = [];
  for (const [s, c] of soundCues()) {
    if (heard(c) === null) {
      const [peakMs] = SFX[c.file];
      const w = window_(c);
      bad.push(`${s.id} / ${c.rule}: 窗=[${w.start},${w.end}] 峰值@${peakMs}ms —— ${c.file.split("/").pop()}`);
    }
  }
  assert.deepEqual(bad.slice(0, 10), [],
    `${bad.length} 条音效被裁掉了响度峰值。duration 的基准必须是「内容真实区间」`
    + "`[onsetMs, onsetMs+effectiveMs]`，不是 `effectiveMs`——后者相对起振点量，"
    + "直接当播放时长用会让窗整整早收一个 onsetMs。");
});

/**
 * **播出窗不许越过素材末尾。**
 *
 * `armory-impact.test.mjs` 里有一条同样口径的断言，但它只走**画面** cue，对音效完全失明。
 * 这条补上音效那一半，同时它是 `soundAt()` 里 `Math.min(totalMs, …)` 那个上钳的唯一守卫：
 * 量测用的是 10ms 包络窗，`onsetMs + effectiveMs` 会因量化比素材总长多出几毫秒
 *（实测 14 条，最多 5ms，全是 `Slingshot Poison Hit 1.ogg` 那一支）。
 * 去掉上钳这条立刻红 14 条 —— 已做过变异验证。
 */
test("音效的播出窗不得越过素材末尾", () => {
  const bad = [];
  for (const [s, c] of soundCues()) {
    if (c.duration == null) continue;
    const totalMs = SFX[c.file][3];
    if (totalMs == null) continue;
    const end = (c.startTime ?? 0) + c.duration;
    if (end > totalMs) {
      bad.push(`${s.id} / ${c.rule}: startTime ${c.startTime ?? 0} + duration ${c.duration} = ${end}ms `
             + `> 素材总长 ${totalMs}ms（${c.file.split("/").pop()}）`);
    }
  }
  assert.deepEqual(bad.slice(0, 10), [],
    `${bad.length} 条音效的播出窗越过了素材末尾。`
    + "`soundAt()` 必须把内容结束时刻钳到素材总长——量测的 10ms 包络窗会让 "
    + "`onsetMs + effectiveMs` 比总长多出几毫秒。");
});

/**
 * **尾部裁剪必须是有意的。**
 *
 * `sounds.mjs` 里裁剪的自陈意图是「裁掉尾部静音」（casting.water 4.1 秒不裁会盖住命中音），
 * 而不是裁掉内容。凡是把**有声内容**裁掉超过 30ms 的，要么是 bug，要么必须显式声明
 * `trimIntent`（说明为什么这条非裁不可）。30ms 的容差留给 10ms 包络窗的量化误差。
 */
test("裁掉有声内容必须显式声明 trimIntent", () => {
  const bad = [];
  for (const [s, c] of soundCues()) {
    if (c.trimIntent) continue;
    const [, onsetMs, effectiveMs, totalMs = Infinity] = SFX[c.file];
    const contentEnd = Math.min(totalMs, onsetMs + effectiveMs);
    const cut = contentEnd - window_(c).end;
    if (cut > 30) bad.push(`${s.id} / ${c.rule}: 裁掉 ${Math.round(cut)}ms 有声内容（${c.file.split("/").pop()}）`);
  }
  assert.ok(bad.length <= 11,
    `${bad.length} 条在无声明地裁掉有声内容（允许 ≤11，即 strike.ranged.draw 那一族有意为之的裁剪）：\n`
    + bad.slice(0, 10).join("\n"));
});
