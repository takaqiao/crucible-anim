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

/** 目标：一路涨到全语料。**只许增不许减。** */
const BASELINE = Object.freeze({actionsWithSound: 99});

/** 一条音效 cue 实际**响**在第几毫秒。 */
const heard = c => (c.delay ?? 0) + (SFX[c.file][0] - (c.startTime ?? 0));

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
      const clip = clipOf(visual.file);
      if (!clip) continue;
      checked++;
      // `strikeSounds` 先推风声再推命中音，所以**最后一条就是命中音**。短挥击来不及
      // 塞风声时只有一条，那一条也是命中音。
      // 响点 = delay + （峰值 − startTime）。**startTime 不能漏**：来不及提前时规则会
      // 用 startTime 跳进音频（跳过的是纯静音段），漏算它会把已经对齐的判成不齐。
      const contactAt = (visual.delay ?? 0) + clip.contactMs;
      const hit = heard(sounds[sounds.length - 1]);
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
      if (h[0] >= h[1]) bad.push(`${s.id}: 风声响于 ${h[0]}ms，命中音响于 ${h[1]}ms`);
    }
  }
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} 组的两声顺序反了`);
});
