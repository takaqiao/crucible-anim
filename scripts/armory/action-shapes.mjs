/**
 * 动作形状表 —— 「这一下是什么形状的动作」。
 *
 * ## 与武器形制表的分工
 *
 * 玩家做了**两个选择**：用哪个动作、拿哪把武器。`weapon-shapes.mjs` 答第二个
 * （巨剑挥巨剑、长矛刺出去），这张表答第一个。
 *
 * 判据是 Crucible 动作自己的 `target.type`——它写着这一下打到哪儿：
 *
 * | target.type | 是什么 | 语料里的例子 |
 * | --- | --- | --- |
 * | `cone` | 朝一个方向扇形喷出 | `acidSpray` 喷酸、`fanOfArrows` 箭雨 |
 * | `ray` | 一条直线穿过去 | `penetratingShot` 贯穿射击、`noxiousSpray` |
 * | `pulse` | 以自己为中心一圈 | `tailSweep` 尾扫、`sentinelSpin` 回旋、`lightningBurst` |
 *
 * ## 改造前它们播的是什么
 *
 * 全部落到按武器选的单体挥击上，**每个目标各挥一次**：
 *
 *   tailSweep（尾巴横扫一圈）  → 一记拳击 ×2
 *   acidSpray（喷一口酸）      → 一记拳击 ×2
 *   penetratingShot（贯穿射击）→ 一发普通子弹 ×2
 *   fanOfArrows（扇形箭雨）    → 一支普通箭 ×2
 *
 * 这三类规则都是 `once: true`：区域动作一次只该出一份画面，锥形打中 5 个人不该叠 5 份。
 *
 * ## 颜色
 *
 * 走**动作**的伤害类型（`usage.damageType`），不是武器的——喷酸的酸来自动作。
 * 物理伤害在 DAMAGE_COLOR 里是 null，退回各自族里中性的一支。
 */

/** 锥形：远程武器射的是箭雨，其余是元素喷吐。 */
export const CONE_VOLLEY = "jb2a.volley_of_projectiles_ConePF2e.arrow.001.001";
export const CONE_GENERIC = "jb2a.template_cone_PF2e.001.001";

/** 直线贯穿。5 色（blue/green/orange/purple/yellow），15 帧 @30fps = 0.5s。 */
export const RAY_GENERIC = "jb2a.template_line_piercing.generic.01";

/** 自身一圈：向外炸开的火花环。4 色，64 帧 @30fps = 2.1s，需裁。 */
export const PULSE_BURST = "jb2a.particle_burst.01.circle";

/** 物理伤害没有配色时各族的中性退回色（都是族内实际存在的分支）。 */
export const NEUTRAL = Object.freeze({
  [CONE_GENERIC]: "blue",
  [RAY_GENERIC]: "orange",
  [PULSE_BURST]: "yellow"
});

/**
 * 这个动作是不是区域形状，是的话该出什么。
 * @param {{target: {type: string}, usage: {isRanged: boolean}}} s
 * @returns {{path: string, neutral: string|null}|null}
 */
export function shapeOfAction(s) {
  switch (s?.target?.type) {
    case "cone":
      return s.usage?.isRanged
        ? {path: CONE_VOLLEY, neutral: null}
        : {path: CONE_GENERIC, neutral: NEUTRAL[CONE_GENERIC]};
    case "ray":   return {path: RAY_GENERIC, neutral: NEUTRAL[RAY_GENERIC]};
    case "pulse": return {path: PULSE_BURST, neutral: NEUTRAL[PULSE_BURST]};
    default: return null;
  }
}
