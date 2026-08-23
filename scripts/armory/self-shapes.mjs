/**
 * 非武器非法术动作的形制表 —— 「这不是打人，那是在干什么」。
 *
 * ## 这一块是最大的空白
 *
 * 全量语料 434 个动作里，武器 69 条、法术 204 条，剩下 **161 条「其它动作」**——
 * 其中 **104 条只播通用兜底**。按条数它比法术与状态加起来还多。
 *
 * 它们不是没有判别信息：这 104 条在快照原始字段上能区分出 **77 种**。形状高度集中：
 *
 * | target.type | 条数 | 是什么 |
 * | --- | --- | --- |
 * | `self` | 51 | 架势、自身增益、变形、系统默认动作 |
 * | `single` | 21 | 反应类（格挡 / 拦截 / 抢位） |
 * | `pulse` | 12 | 以自己为中心的爆发 |
 * | `summon` | 8 | 召唤 |
 * | `aura` | 7 | 吟唱光环 |
 * | `movement` / `none` / `blast` | 5 | 位移与其它 |
 *
 * 本文件只管前四类里判据最硬的几簇；剩下的仍走兜底，**不硬凑**。
 */
import {DAMAGE_COLOR} from "../resolver/palette.mjs";

/**
 * 四大元素架势。
 *
 * 按**动作 id** 派发。这与武器按 `system.identifier` 派发是同一件事：Crucible 的动作 id
 * 是物品 slug，稳定且翻译不动它（Babele 译的是 `name`）。这四条动作既没有 `damageType`
 * 也没有元素标签，id 是唯一的判据。
 */
export const STANCE_COLOR = Object.freeze({
  stormStance:  "blueyellow",   // 雷
  cinderStance: "orange",       // 火
  waterStance:  "blue",         // 水
  stoneStance:  "dark_green"    // 土
});

/** 架势的光环素材。9 色、55 帧 @30fps，**中心 55 帧全透明**，不挡 token 的脸。 */
export const STANCE_RING = "jb2a.on_token_buff.002.001";

/**
 * 英雄气概类动作：`adrenalineSurge` / `decisiveAction` / `gambitAllIn` / `coldFocus` /
 * `flashBrilliance` / `unshakeablePoise` 等，判据是 `cost.heroism > 0`——花英雄点是
 * Crucible 里最重的一类决定，画面上该看得出来。
 *
 * 素材是升腾的剑形符号（`eskie.buff.one_shot.attack` 的峰值帧上确实是一排剑）。
 */
export const HEROISM_SURGE = "eskie.buff.one_shot.attack";

/** 通用自身增益：升腾的光条，最克制的一支。 */
export const SELF_BUFF = "eskie.buff.one_shot.simple";

/**
 * 吟唱光环：`songOf*` 三首增益、`dirgeOf*` 三首减益，外加 `terrifyingPresence`。
 * 判据是 `vocal` 标签 + aura/pulse 形状。
 *
 * 素材是锯齿状的音波环（`jb2a.soundwave.02`，8 色、62 帧 @24fps）。
 * **⚠ 24fps 不是 30**——按 30 算会短算 20%。
 */
export const VOCAL_WAVE = "jb2a.soundwave.02";

/**
 * 召唤法阵：`jb2a.magic_signs.circle.02.conjuration.intro`（12 色、85 帧 @24fps）。
 * 取 `intro`（法阵浮现）而不是 `complete`（265 帧 = 11 秒的持续版）——召唤是一次动作，
 * 不是一个持续状态。
 */
export const SUMMON_CIRCLE = "jb2a.magic_signs.circle.02.conjuration.intro";

/**
 * 这个非武器非法术动作该出什么自身画面。
 *
 * @param {object} s 动作快照
 * @returns {{path: string, color: string|null}|null} null = 不归本表管，走兜底
 */
export function selfShapeFor(s) {
  if (s?.spell || s?.cost?.weapon === true) return null;

  const stance = STANCE_COLOR[s?.id];
  if (stance) return {path: STANCE_RING, color: stance};

  const t = new Set(s?.tags ?? []);
  const shape = s?.target?.type;

  // 吟唱：vocal + 光环/脉冲。增益与减益靠颜色分开——songOf* 走蓝、dirgeOf* 走红。
  // 这里用 id 前缀而不是标签，是因为 Crucible 没有把「这是增益还是减益」写进快照。
  if (t.has("vocal") && (shape === "aura" || shape === "pulse")) {
    const dirge = String(s.id ?? "").startsWith("dirge");
    return {path: VOCAL_WAVE, color: dirge ? "red" : "blue"};
  }

  if (shape === "summon") return {path: SUMMON_CIRCLE, color: null};

  if ((s?.cost?.heroism ?? 0) > 0) return {path: HEROISM_SURGE, color: null};

  // 自身增益：排除掉系统默认动作里那些本就不该有画面的（move/delay 之类由
  // ALWAYS_SILENT 与兜底规则各自处理，这里只认真正「对自己做了什么」的）
  if (shape === "self" && !t.has("noncombat") && !t.has("rest") && (s?.cost?.action ?? 0) > 0) {
    return {path: SELF_BUFF, color: DAMAGE_COLOR[s?.usage?.damageType] ?? null};
  }
  return null;
}
