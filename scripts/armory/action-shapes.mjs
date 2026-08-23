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

/**
 * 横扫多人（fan / blast）：一记绕身 360° 的刀光环。
 *
 * `cleave` 与 `vaultingSweep` 此前是**每个目标各挥一次**——一记横扫劈中三个人会播三次
 * 独立挥砍，读起来像连续三次攻击。
 *
 * ⚠ **必须写死到文件，不能写到节点。** `jb2a.melee_generic.whirlwind.01.<色>` 的叶子是
 * 一个 2 元素数组，两条长度差一倍：`_01` 是 84 帧但**前 22 帧全空**（733ms 干等），
 * `_02` 是 24 帧、f4 就起。`ctx.pick` 在数组里均匀随机取一个，写到节点等于一半概率
 * 白等 0.73 秒。这里取 `_02`。
 */
export const SWEEP_RING = "jb2a.melee_generic.whirlwind.01";

/**
 * 冲扑（movement）：从这里冲到那里。
 *
 * `ferociousLeap` / `flyingKick` / `ruthlessMomentum` / `shieldCharge` / `tuskCharge`
 * 此前播的是**原地挥击**——角色明明冲过去了，画面上完全看不出移动。
 *
 * 用两层拼：`MOVE_TRAIL` 是 1200×200 的尘团横条，自己从左走到右（逐帧 alpha 重心
 * 0.135 → 0.822），配 stretchTo 正好从施法者铺到目标；它挂的是 jb2a `ray` 模板
 * [100,0,0]，startPoint/endPoint 都是 0，不吃「stretchTo 首尾各缩进 12.5%·d」那个坑。
 *
 * ⚠ 主体只有 f1-f19 = 633ms，profile 记的 lead 0 / tail 0 是被极淡的横线撑住的假象
 *（f0 的 alpha 总量只有峰值的 2.4%），时长必须自己裁到 ~650ms，不能用整段 1000ms。
 * 只有 white 一色。同级 `default` 是 121 帧的持续版，别错拿。
 */
export const MOVE_TRAIL = "jb2a.gust_of_wind.veryfast";

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
    case "fan":
    case "blast": return {path: SWEEP_RING, neutral: "orange"};
    default: return null;
  }
}
