import {DAMAGE_COLOR} from "../resolver/palette.mjs";

/**
 * 武器形制表 —— 「哪件武器挥出什么形状」。
 *
 * ## 为什么需要它
 *
 * Crucible 里**武器自己没有动作**，所有武器共用同一个「打击」动作，动作由天赋给。
 * 于是「这一下该播什么」只能从武器身上取。改造前的实测：**92 件武器只命中 6 个不同的
 * travel 素材**，最大的一个桶里 20 件共用同一段短剑横斩——`giantBeak`（巨喙）、
 * `greathammer`（巨锤）、`greatsword`（巨剑）、`chainHook`（链钩）全在里面。
 *
 * ## 派发键是 `system.identifier`
 *
 * 逐条读 Crucible 源码定的，三个候选里只有它在「装到角色身上」之后还活着：`_id` 在
 * 官方 pack 里是语义 slug 但角色身上是随机串（`standardizeItemIds()` 只规范化世界物品，
 * crucible-compiled.mjs:48925），`_stats.compendiumSource` 两边都是 null。
 * identifier 还不是显示名，Babele / crucible-cn 把名字译成「匕首 Dagger」也动不到它。
 *
 * ## 选材依据
 *
 * 全部来自 `docs/ASSET-NOTES.md` 的族级记录（21 个族已登记，含全族机器量测 + 每个
 * 内容占比簇各一条抽样读图）。**否决清单压过族级记录**：`greatsword.01` 与 `scythe.01`
 * 原本在否决清单上，本轮不是绕过而是**正式限定了原否决的适用范围**——原判据是
 * 「拿它当通用近战挥击好不好」，答案仍然是否；这里的用法是「给巨剑配巨剑的挥击」，
 * 判据不同。两条否决条目里都写清楚了。
 *
 * ## 表里没有的怎么办
 *
 * 落 `CATEGORY_SHAPE` 按分类兜底，再落不着就交回调用方（兵库的兜底规则）。
 * **不硬凑**：找不到像的形制，用一个不像的还不如让它走兜底——兜底至少是「没为它选」，
 * 而错配是「为它选错了」，后者更难发现。
 */

/**
 * 具名武器 → jb2a.melee_attack 形制节点。
 *
 * 只在素材真的**像**那件武器时才写进来。`spear` / `javelin` / `warlance` 这类纯突刺
 * 武器故意留空——整个 melee_attack 族没有一条是突刺，硬配一条挥砍弧不如走分类兜底。
 */
export const WEAPON_SHAPE = Object.freeze({
  // —— 刀剑 ——
  shortsword: "jb2a.melee_attack.01.shortsword.01",
  longsword:  "jb2a.melee_attack.01.shortsword.01",
  katana:     "jb2a.melee_attack.04.katana.01",
  scimitar:   "jb2a.melee_attack.04.scimitar.01",
  bastardSword: "jb2a.melee_attack.03.khybersword.01",
  greatsword: "jb2a.melee_attack.03.greatsword.01",

  // —— 斧 ——
  handAxe:   "jb2a.melee_attack.02.handaxe.01",
  battleAxe: "jb2a.melee_attack.02.battleaxe.01",
  greataxe:  "jb2a.melee_attack.03.greataxe.01",

  // —— 锤棒 ——
  club:        "jb2a.melee_attack.02.club.01",
  mace:        "jb2a.melee_attack.02.mace.01",
  warhammer:   "jb2a.melee_attack.02.warhammer.01",
  clawHammer:  "jb2a.melee_attack.02.hammer.01",
  pickaxe:     "jb2a.melee_attack.02.hammer.01",
  greatclub:       "jb2a.melee_attack.03.greatclub.01",
  spikedGreatclub: "jb2a.melee_attack.03.greatclub.01",
  greathammer: "jb2a.melee_attack.03.maul.01",

  // —— 长柄 ——
  // 木杆类用巨木棒（峰值帧看得见整根褐色木棒），带刃的用镰刀（看得见柄与弯刃）
  boStaff:     "jb2a.melee_attack.03.greatclub.01",
  quarterstaff: "jb2a.melee_attack.03.greatclub.01",
  glaive:      "jb2a.melee_attack.05.scythe.01",
  halberd:     "jb2a.melee_attack.05.scythe.01",

  // —— 异形 ——
  // 链钩带环，chakram 的峰值帧正是一个飞旋的环
  chainHook: "jb2a.melee_attack.01.chakram.01"
});

/**
 * 分类兜底形制。具名表查不到时按分类给。
 *
 * 天生武器（`natural`）走 `NATURAL_SHAPE`，不吃这张表——爪牙不该出金属刀光。
 */
export const CATEGORY_SHAPE = Object.freeze({
  light1:   "jb2a.melee_attack.01.shortsword.01",
  balanced1:"jb2a.melee_attack.01.shortsword.01",
  balanced2:"jb2a.melee_attack.03.greatclub.01",
  simple1:  "jb2a.melee_attack.02.club.01",
  simple2:  "jb2a.melee_attack.03.greatclub.01",
  heavy1:   "jb2a.melee_attack.02.battleaxe.01",
  heavy2:   "jb2a.melee_attack.03.greatsword.01"
});

/**
 * 天生武器的形制。骨白偏黄，与金属武器的冷白拉得开。
 *
 * 按重量分两档：轻/中型用 `bone`，重型用 `greatbone`。**这是本轮的近似**——
 * jb2a 另有 `jb2a.claws.*`（8 色）与 `jb2a.bite.*`（7 色）两个更贴切的族，
 * 元素变体（burningBite 火 / frigidBite 冰 / venomousBite 毒 …）正好靠它们的颜色维度
 * 解决。那两个族**尚未登记**（族级记录要全族量测 + 每簇抽样读图），留作下一轮。
 */
export const NATURAL_SHAPE = Object.freeze({
  light1: "jb2a.melee_attack.02.bone.01",
  balanced1: "jb2a.melee_attack.02.bone.01",
  balanced2: "jb2a.melee_attack.03.greatbone.01",
  simple1: "jb2a.melee_attack.02.bone.01",
  heavy1: "jb2a.melee_attack.03.greatbone.01",
  heavy2: "jb2a.melee_attack.03.greatbone.01",
  projectile1: "jb2a.melee_attack.02.bone.01"
});

/**
 * 法器（talisman1/2）的附魔剑形制，按颜色分支。
 *
 * 改造前**9 件法器一条 travel cue 都不出**（`strike.melee` 的 when 不含 talisman）。
 * 法器是施法媒介而不是刀剑，用附魔剑/附魔巨剑那两支带辉光的正合适，颜色跟
 * `DAMAGE_COLOR[武器伤害类型]` 走：flameStaff 火→orange、iceStaff 冰→blue、
 * holySymbol 光→yellow、skullFetish 腐→dark_green、lyre 心灵→dark_purple。
 *
 * ⚠ 这两族的暗底亮度跨度是 37.9-128.5：**dark_green 与 dark_purple 两支在深色地图上
 * 接近隐形**（族级记录里记着）。取不到色时宁可退回 blue（亮度安全档）也不硬配暗色。
 */
export const TALISMAN_SHAPE = Object.freeze({
  talisman1: "jb2a.melee_attack.01.magic_sword",
  talisman2: "jb2a.melee_attack.03.magical_greatsword"
});

/** 附魔剑族实际存在的颜色分支（DB 实测，不是猜的）。 */
export const TALISMAN_COLORS = Object.freeze({
  "jb2a.melee_attack.01.magic_sword": ["dark_green", "dark_purple", "blue", "orange", "yellow"],
  "jb2a.melee_attack.03.magical_greatsword": ["dark_green", "dark_purple", "blue", "orange"]
});

/**
 * 一件武器该挥出什么形状。
 * @param {{identifier: string|null, category: string|null, properties: string[]}} w
 * @returns {string|null} DB 路径前缀；null = 表里没有，交回调用方走兜底
 */
export function shapeFor(w) {
  if (!w) return null;
  if (w.properties?.includes("natural")) return NATURAL_SHAPE[w.category] ?? null;
  return WEAPON_SHAPE[w.identifier] ?? CATEGORY_SHAPE[w.category] ?? null;
}

/**
 * 法器该染成什么颜色。
 *
 * 用**武器自己的**伤害类型，不是 `ctx.damageColor()`——后者读的是 `usage.damageType`
 * （动作的伤害类型），而平打不带伤害标签时它是 null。法器的颜色语义在武器身上：
 * flameStaff 是火杖，不管拿它做什么动作。
 *
 * 物理三种（bludgeoning / piercing / slashing）在 DAMAGE_COLOR 里是 null——法器里
 * `grimoire`（钝）与 `ceremonialDagger`（穿刺）就是这种。退回 blue：它是这两族里
 * 亮度安全的一档，而 dark_green / dark_purple 在深色地图上接近隐形（族级记录）。
 *
 * @param {{damageType: string|null}} w
 * @returns {string}
 */
export function talismanColorFor(w) {
  return DAMAGE_COLOR[w?.damageType] ?? "blue";
}