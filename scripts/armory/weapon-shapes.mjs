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
  // [D9] `.01` → `.02`（2026-08-29）。jb2a 本轮升级给这一族加了第二支，成员 4→8。
  // 两支都是纯 4 变体、都没有色轴，差别只在剑本身：`.01` 末端只有一条细长直线，token
  // 尺寸下读不出是剑；`.02` 是明显加宽的双手大剑、刃面看得见（ASSET-NOTES 逐变体
  // 内容占比 `.01`→`.02`：0.485→0.567 / 0.384→0.442 / 0.616→0.705 / 0.645→0.740）。
  // `.01` 留在 CATEGORY_SHAPE.heavy2 当分类兜底，不删。
  greatsword: "jb2a.melee_attack.03.greatsword.02",

  // —— 斧 ——
  handAxe:   "jb2a.melee_attack.02.handaxe.01",
  battleAxe: "jb2a.melee_attack.02.battleaxe.01",
  // [D9] `.01` → `.02`（2026-08-29）。同样是本轮升级新增的一支，且**是两种素材不是两个
  // 变体**（ASSET-NOTES 为此把原来一行拆成两族）：`.01` 是无色钢斧，峰值帧上只有一团
  // 白弧、**完全看不到斧头**；`.02` 是发光的魔法斧，斧刃与柄分得清，另带 9 色轴
  // （blue / bluepurple / blueteal / greenpurple / greenyellow / orangeyellow /
  // pinkyellow / purplered / white）。闪爆比 1.75-3.28 也比 `.01` 的 3.87-9.23 低一档，
  // 不会盖掉 impact 层。色支由 SHAPE_COLOR 钉成 white，理由写在那张表上。
  greataxe:  "jb2a.melee_attack.03.greataxe.02",

  // —— 锤棒 ——
  club:        "jb2a.melee_attack.02.club.01",
  mace:        "jb2a.melee_attack.02.mace.01",
  warhammer:   "jb2a.melee_attack.02.warhammer.01",
  clawHammer:  "jb2a.melee_attack.02.hammer.01",
  pickaxe:     "jb2a.melee_attack.02.hammer.01",
  greatclub:       "jb2a.melee_attack.03.greatclub.01",
  spikedGreatclub: "jb2a.melee_attack.03.greatclub.01",
  greathammer: "jb2a.melee_attack.03.maul.01",

  // —— 突刺 ——
  // **`melee_attack` 整族没有突刺，但 `melee_generic` 有。** 早先「素材库里没有突刺动画」
  // 那句话是错的，只是找错了族：`jb2a.melee_generic.piercing.one_handed` 是一记横向直刺
  // （亮尖前突），two_handed 是弧线冲刺。刺剑 / 短击剑 / 细身匕 / 长矛 / 标枪本来都被
  // 分类兜底成短剑横斩，现在各自刺出去。
  rapier:   "jb2a.melee_generic.piercing.one_handed",
  sai:      "jb2a.melee_generic.piercing.one_handed",
  stiletto: "jb2a.melee_generic.piercing.one_handed",
  spear:    "jb2a.melee_generic.piercing.one_handed",
  javelin:  "jb2a.melee_generic.piercing.one_handed",
  warlance: "jb2a.melee_generic.piercing.two_handed",

  // —— 长柄 ——
  // 木杆类用巨木棒（峰值帧看得见整根褐色木棒），带刃的用镰刀（看得见柄与弯刃）
  boStaff:     "jb2a.melee_attack.03.greatclub.01",
  quarterstaff: "jb2a.melee_attack.03.greatclub.01",
  glaive:      "jb2a.melee_attack.05.scythe.01",
  halberd:     "jb2a.melee_attack.05.scythe.01",

  // —— 异形 ——
  // [D9] chakram → flail（2026-08-29）。原判据「链钩带环，chakram 的峰值帧正是一个飞旋
  // 的环」看反了语义：链钩是「链上挂重物甩出去」，而 chakram 是**脱手飞出去的环形飞盘**
  // ——环在这里是抛射体不是配重。`flail.01` 的峰值帧（f16）末端是**一根短柄 + 一节链 +
  // 一颗带刺流星球**，「柄—链—重物」的剪影完整可读；内容占比 0.353-0.502，也比 chakram
  // 的 0.31-0.37（本组剪影最小的一支）大一档。
  // ⚠ 空尾 15-17 帧（约半秒），duration 要自己裁，别 waitUntilFinished 白等。
  chainHook: "jb2a.melee_attack.01.flail.01"
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
 * 形制素材的钉死色支。**只给「本身带色轴、但武器语义上不该随机换色」的那几支用。**
 *
 * `WEAPON_SHAPE` / `CATEGORY_SHAPE` 的值是纯几何叶子时不需要这张表（`pickFor` 给
 * `color: null`，调用方就不传 color）。但 `jb2a.melee_attack.03.greataxe.02` 是一支
 * **带 9 色轴**的族——不指定颜色的话 `ctx.pick` 会在 9 支里随机取一支，同一把巨斧这一
 * 下蓝、下一下紫。
 *
 * 钉 `white` 的两条理由，都在 ASSET-NOTES 的族级记录里量过：
 *  · **亮度**：9 色的暗底亮度跨 72.0-145.5，`purplered` 只有 72.0-98.3，深色地图上比
 *    `greenyellow`（143.5-145.5）暗一半；`white` 支 114.1-131.9 属安全档。
 *  · **语义**：⚠ 这一族的 `white` **不是无彩**（读图确认斧刃是蓝白水晶色）。真要无色
 *    钢斧只能回 `.01`，而 `.01` 的峰值帧上根本看不到斧头——两害相权取「看得见斧头」。
 *
 * ⚠ 这不是「巨斧只能是白的」。将来若要让元素打击染色（火焰巨斧走 orangeyellow、
 * 寒冰巨斧走 blueteal），入口在**调用方**：`pickFor` 只拿得到武器、拿不到动作的
 * `usage.damageType`，改法是让 travel 那条规则在 `shape.color` 之上再覆写一层，
 * 而不是把动作塞进这张表。
 */
const SHAPE_COLOR = Object.freeze({
  "jb2a.melee_attack.03.greataxe.02": "white"
});

/**
 * 天生武器怎么分类。**按 identifier 里的部位词认**，不看伤害类型——
 * 部位决定形状（獠牙是一张嘴、利爪是几道抓痕），伤害类型只决定颜色。
 *
 * 39 件天生武器改造前全部落在骨棒上（更早是短剑）。`jb2a.bite.400px` 是一张咬合的
 * 獠牙大口（7 色），`jb2a.claws.400px` 是 3-4 道平行抓痕（8 色），两族都是 0.00 帧数
 * 离散度的正交色矩阵，**元素变体正好落在颜色轴上**：burningBite 橙、frigidBite 蓝、
 * venomousBite 绿、psychicBite 紫、radiantBite 黄，一条规则全覆盖。
 */
const BITE_PARTS = /bite|fangs|jaws|beak/i;
const CLAW_PARTS = /claw|talon|pincer|limb|thorn|stinger/i;
/** 拳套 / 指虎 / 徒手。`katar` 是拳刃、`spikedKnuckles` 是指虎，都靠拳出手。 */
const FIST_PARTS = /fist|knuckle|katar|gauntlet|hoof|hooves/i;

/**
 * 把 identifier 切成词。`burningBite` → `["burning","bite"]`。
 *
 * 上面三条部位正则是**子串**匹配（`burningBite` 要能命中 `bite`），而下面的骨刃判据
 * 必须是**整词**匹配：`thorns`（荆棘，是抓刺）里含着 `horn`，子串匹配会把它错判成犄角。
 * 光靠「CLAW_PARTS 排在前面先接走 thorns」也能躲过去，但那是靠顺序而不是靠判据——
 * 哪天有人调换两行的次序，荆棘就变成犄角，而且没有任何守卫会响。
 */
const partWords = id => String(id ?? "")
  .replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z]+/).filter(Boolean);

/**
 * [D9] 骨刃类天生武器：**拿骨头当刃使**的那几件（獠牙 tusks / 犄角 horns）。
 *
 * 它们既不是咬（那是一张嘴）也不是抓（那是几道平行痕），改造前一律落进 NATURAL_BLUNT
 * 的 `greatbone.01`——一根粗白骨棒，读作**钝击**。而 tusks 在 weapons.json 里是
 * `heavy1 / slashing`、horns 是 `heavy1 / piercing`，两件都不是钝击。
 *
 * `jb2a.melee_attack.01.bonesword.01` 的峰值帧（f16）末端是**一柄褐色骨柄宽刃刀、刃背
 * 带倒钩**，是 Group01 里剪影最大、骨质感最明确的一支（内容占比 0.548-0.608，全组最高）。
 *
 * ⚠ **只收这两件，别扩。** 尾 tail / 巨尾 giantTail / 触手 tentacles / 伪足 pseudopod /
 * 蹄 hooves 是真的钝击，它们落回骨棒才对——兜底优于错配（ASSET-NOTES 这一行专门写了
 * 这句警告）。
 */
const BONE_BLADE_PARTS = new Set(["tusk", "tusks", "horn", "horns"]);

/**
 * 这个 identifier 是不是骨刃部位。**导出是为了让守卫能单独量这条判据**：
 * `pickFor` 里骨刃分支排在爪痕分支之后，于是 `thorns` 永远先被爪痕接走——
 * 把整词匹配改回子串匹配，走 `pickFor` 是量不出差别的（顺序替判据挡了枪），
 * 守卫会空真通过。直接量这个谓词就没有这层遮蔽。
 */
export const isBoneBlade = id => partWords(id).some(x => BONE_BLADE_PARTS.has(x));

/**
 * 认不出部位的天生武器（尾、蹄、触手、伪足）退回骨棒。
 * 它们是钝击/顶撞，既不是咬也不是抓，硬塞进那两族反而错。
 */
const NATURAL_BLUNT = Object.freeze({
  light1: "jb2a.melee_attack.02.bone.01",
  balanced1: "jb2a.melee_attack.02.bone.01",
  balanced2: "jb2a.melee_attack.03.greatbone.01",
  simple1: "jb2a.melee_attack.02.bone.01",
  heavy1: "jb2a.melee_attack.03.greatbone.01",
  heavy2: "jb2a.melee_attack.03.greatbone.01",
  projectile1: "jb2a.melee_attack.02.bone.01"
});

/**
 * 盾撞。改造前 5 面盾**一条 travel cue 都不出**——`strike.melee` 的 when 不含
 * shieldLight / shieldHeavy。
 *
 * 用 `.01` 这一支而不是整个 `06.shield`：整族 8 条帧数离散度 0.49 **不合格**
 * （`Shield02_01` 是 96 帧、其中 60 帧是空尾，其余 7 条都是 49-50 帧）。
 * `.01` 单独 2 条 50/49 帧、离散度 0.02，族级记录才立得住。
 */
export const SHIELD_SHAPE = "jb2a.melee_attack.06.shield.01";

/**
 * 远程武器的飞行物。改造前 8 件远程武器**共用同一支蓝箭**
 * （`eskie.attack.ranged.arrow.ray.physical.blue.30ft`，兜底规则给的）。
 *
 * ft 档位就是**飞行时间**，仓库既有约定是钉 30ft（见 travel.mjs 顶部的 ft 说明）。
 */
export const RANGED_SHAPE = Object.freeze({
  longbow:       "jb2a.arrow.physical.orange.30ft",
  shortbow:      "jb2a.arrow.physical.orange.30ft",
  quills:        "jb2a.arrow.physical.orange.30ft",
  handCrossbow:  "jb2a.bolt.physical.white.30ft",
  heavyCrossbow: "jb2a.bolt.physical.white.30ft",
  dartgun:       "jb2a.bolt.physical.white.30ft",
  pistol:        "jb2a.bullet.01.orange.30ft",
  sling:         "jb2a.bullet.01.red.30ft"
});

/**
 * 元素弹药：**箭矢跟着动作的元素走**。
 *
 * `flamingArrow`（灼热箭）此前射的是一支普通箭——武器是弓，火来自动作，而选材只看了
 * 武器。`jb2a.arrow` / `jb2a.bolt` 各有 cold / fire / lightning / poison / physical 五支
 * 元素分支，同结构同色系，正好接 `usage.damageType`。
 *
 * 颜色按元素取语义色（火橙、冰蓝、电蓝、毒紫——箭矢那一族的 poison 没有绿色 30ft 分支），不走 pickColor——这一族的颜色是
 * **弹药本身的颜色**而不是可染色的中性素材，取错色会得到一支绿色的火箭。
 *
 * 对不上的元素（腐蚀 / 虚空 / 心灵 / 光耀）落回 physical：**这是缺口不是选择**，
 * 那四种没有对应的箭矢分支，配一支绿毒箭去表示「光耀」比射普通箭更糟。
 */
export const AMMO_ELEMENT = Object.freeze({
  arrow: Object.freeze({
    fire:        "jb2a.arrow.fire.orange.30ft",
    cold:        "jb2a.arrow.cold.blue.30ft",
    electricity: "jb2a.arrow.lightning.blue.30ft",
    poison:      "jb2a.arrow.poison.purple.30ft",
    acid:        "jb2a.arrow.poison.purple.30ft"
  }),
  bolt: Object.freeze({
    fire:        "jb2a.bolt.fire.orange.30ft",
    cold:        "jb2a.bolt.cold.blue.30ft",
    electricity: "jb2a.bolt.lightning.blue.30ft",
    poison:      "jb2a.bolt.poison.purple.30ft",
    acid:        "jb2a.bolt.poison.purple.30ft"
  })
});

/**
 * 这一发该射什么弹药。先看动作的元素，没有元素就用武器自己的形制。
 *
 * @param {{identifier: string|null, category: string|null}|null} w
 * @param {string|null} damageType 动作的伤害类型（`usage.damageType`）
 * @returns {string|null}
 */
export function ammoFor(w, damageType) {
  const base = RANGED_SHAPE[w?.identifier] ?? RANGED_CATEGORY[w?.category];
  if (!base) return null;
  // 只有箭与弩矢有元素分支；弹丸（bullet）没有，火枪射火弹这件事素材里不存在。
  // 取路径的第二段而不是写 `startsWith("jb2a.arrow.")`：那种半截串会被
  // `test/armory-assets.test.mjs` 的路径抽取当成一条 DB 路径，而它根本解析不到。
  const fam = base.split(".")[1];
  return AMMO_ELEMENT[fam]?.[damageType] ?? base;
}

/** 远程分类兜底：认不出具体武器时按分类给（弩类走弩矢，其余走箭）。 */
export const RANGED_CATEGORY = Object.freeze({
  projectile1: "jb2a.arrow.physical.orange.30ft",
  projectile2: "jb2a.arrow.physical.orange.30ft",
  mechanical1: "jb2a.bolt.physical.white.30ft",
  mechanical2: "jb2a.bolt.physical.white.30ft"
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
  // ⚠ **必须写到 `.01` 这一级**（2026-08-29 修）。两族的树形不一样：
  // `magic_sword` 下一级直接是 5 个颜色，而 `magical_greatsword` 下一级只有一个 `01`
  // 段、颜色在再下一级。写到族根的后果不是「随机选个颜色」而是**整条颜色轴静默失效**：
  // `pickColor` 的第一句 `colorsUnder(path).filter(c => c in COLOR_HUE)` 拿到的是
  // `["01"]`，过滤后**候选集为空**，直接 `return {color: null}`，于是 4 件双手法器
  // （火杖 / 冰杖 / …）落到 bestFit 随机取的 16 个文件里，配色一次都没生效。
  // 这个洞是 D6 补全色名时用「每族候选数」的普查扫出来的——全库唯一一个候选数为 0 的族。
  talisman2: "jb2a.melee_attack.03.magical_greatsword.01"
});

/**
 * 附魔剑族实际存在的颜色分支（DB 实测，不是猜的）。**描述性常量，规则不读它**——
 * 颜色由 `pickColor` 在运行时从 `colorsUnder` 现取，这里只是给读代码的人一眼看到
 * 「这两支能染成什么」，顺带解释 `talismanColorFor` 为什么要退回 blue。
 *
 * 键与 `TALISMAN_SHAPE` 的值逐一对应（`magical_greatsword` 那条 2026-08-29 跟着改到
 * `.01`，原来那条键写在族根上、而族根下面根本没有颜色）。
 */
export const TALISMAN_COLORS = Object.freeze({
  "jb2a.melee_attack.01.magic_sword": ["dark_green", "dark_purple", "blue", "orange", "yellow"],
  "jb2a.melee_attack.03.magical_greatsword.01": ["dark_green", "dark_purple", "blue", "orange"]
});

/**
 * 强度叠加层：**同一记挥击，加一道彩色拖尾**。
 *
 * `jb2a.melee_attack.<组>.trail` 是 JB2A 给每组挥击配的拖尾，**逐帧与挥击对齐**——
 * Group01 的 trail 四个变体帧数是 46/40/39/41，与 shortsword.01 逐位相同，峰值帧也对上
 *（trail f17 对挥击 f16）。所以它是天然的叠加层：不换画面、只多一道颜色。
 *
 * 用途是 `empowered`（强力打击）这类**强度修饰**：改造前 7 条带 empowered 的动作与
 * 同武器的普通打击画面完全一样，`heavyStrike`（重击）和普通挥击看不出区别。
 *
 * ⚠ 路径要写到 `.trail.01` 这一级：`trail` 下一级是**变体**（01-04）不是颜色，写到 `trail`
 * 的话 `colorsUnder` 拿到的是变体号、全被 pickColor 过滤掉，颜色静默失效。
 *
 * ⚠ **变体必须与挥击对齐**：`trail.01.<色>` 是 4 文件数组，帧数与该组挥击的 4 个变体
 * 逐位相同（Group01 都是 46/40/39/41）。`ctx.pick` 对两边各摇一次的话会画出两道不同的弧，
 * 所以规则里按挥击文件在自己数组里的下标去取拖尾文件。
 *
 * ⚠ 只有 Group01-05 有 trail，Group06（盾）没有。查不到就返回 null，不硬凑。
 */
// 键是**组号**不是路径前缀：写成 `"jb2a.melee_attack.01."` 那种半截串会被
// `test/armory-assets.test.mjs` 的路径抽取当成一条 DB 路径，而它根本解析不到。
const TRAIL_BY_GROUP = Object.freeze({
  "01": "jb2a.melee_attack.01.trail.01",
  "02": "jb2a.melee_attack.02.trail.01",
  "03": "jb2a.melee_attack.03.trail.01",
  "04": "jb2a.melee_attack.04.trail.01",
  "05": "jb2a.melee_attack.05.trail.01"
});

/**
 * 这记挥击的拖尾层在哪。
 *
 * 按前缀查表而不是拼字符串：DB 路径必须是完整字面量，插值拼出来的路径静态扫描
 * 还原不了，`test/armory-assets.test.mjs` 的三条依据守卫会整体失效。
 *
 * @param {string|null} shapePath  挥击素材的路径
 * @returns {string|null}
 */
export function trailFor(shapePath) {
  const seg = String(shapePath ?? "").split(".");
  return seg[0] === "jb2a" && seg[1] === "melee_attack" ? TRAIL_BY_GROUP[seg[2]] ?? null : null;
}

/**
 * 强度层该染成什么颜色。跟动作的伤害类型走；没有配色时用 orangered——
 * 「更用力」读作暖色，而 trail 族只有 blueyellow / orangered / pinkpurple 三支。
 */
export const trailColorFor = dmg => DAMAGE_COLOR[dmg] ?? "orangered";

/**
 * 连段素材：**同一件武器打好几下**。
 *
 * `jb2a.<武器>.melee.*` 是与 `jb2a.melee_attack.*` 并列的另一族，20 件武器各有 5-6 色 ×
 * 6 变体。两族的差别是**长度**：
 *
 *   melee_attack.<形制>       39-51 帧（1.3-1.7s）  一记挥击
 *   <武器>.melee.01           66-86 帧（2.2-2.9s）  一套连段（2-3 下）
 *
 * 这一族是照 `pf2e-trigger-animations-trove` 的成品配方翻出来的——它给 Rapier / Staff /
 * Halberd 用的正是 `jb2a.rapier.melee.01.white` / `jb2a.quarterstaff.melee.01.white` /
 * `jb2a.halberd.melee.01.white`，而本仓库此前整族没发现。
 *
 * 部分武器只有 `standard` 一支（单文件无颜色分支），路径逐字写死，不做拼接。
 */
export const COMBO_SHAPE = Object.freeze({
  shortsword:      "jb2a.shortsword.melee.01",
  longsword:       "jb2a.shortsword.melee.01",
  bastardSword:    "jb2a.sword.melee.01",
  greatsword:      "jb2a.greatsword.melee.standard",
  katana:          "jb2a.scimitar.melee.01",
  scimitar:        "jb2a.scimitar.melee.01",
  rapier:          "jb2a.rapier.melee.01",
  sai:             "jb2a.rapier.melee.01",
  stiletto:        "jb2a.rapier.melee.01",
  dagger:          "jb2a.dagger.melee.02",
  handAxe:         "jb2a.handaxe.melee.standard",
  battleAxe:       "jb2a.handaxe.melee.standard",
  greataxe:        "jb2a.greataxe.melee.standard",
  warhammer:       "jb2a.warhammer.melee.01",
  greathammer:     "jb2a.maul.melee.standard",
  mace:            "jb2a.mace.melee.01",
  club:            "jb2a.club.melee.01",
  greatclub:       "jb2a.club.melee.01",
  spikedGreatclub: "jb2a.club.melee.01",
  clawHammer:      "jb2a.hammer.melee.01",
  pickaxe:         "jb2a.hammer.melee.01",
  boStaff:         "jb2a.quarterstaff.melee.01",
  quarterstaff:    "jb2a.quarterstaff.melee.01",
  glaive:          "jb2a.glaive.melee.01",
  halberd:         "jb2a.halberd.melee.01",
  spear:           "jb2a.spear.melee.01",
  javelin:         "jb2a.spear.melee.01"
});

/**
 * 徒手与天生武器的连段。`jb2a.flurry_of_blows` 字面就是「连击」——一串拳影连打。
 *
 * 用 `magical.02` 而不是 `physical` 或 `magical.01`：**只有这一支七个颜色分支都是 50 帧**
 * （physical 是 36/41 混排、magical.01 是 50/54 混排），换色不会连带改变时长。
 */
export const COMBO_UNARMED = "jb2a.flurry_of_blows.magical.02";

/**
 * 这个动作要打好几下时，该出什么。
 *
 * 颜色跟武器自己的伤害类型走；物理伤害退回 white（本族的中性档，`sword` 那支没有 white
 * 时 pickColor 会落到 available[0]）。
 *
 * @param {{identifier: string|null, category: string|null, damageType: string|null,
 *          properties: string[]}} w
 * @returns {{path: string, color: string}|null}
 */
export function comboFor(w) {
  if (!w) return null;
  const color = DAMAGE_COLOR[w.damageType] ?? "white";
  if (w.properties?.includes("natural") || w.category === "unarmed") {
    // 只有爪 / 肢 / 徒手能读成「连打」。**咬击不行**——一串拳影不是「咬了好几口」，
    // 而素材库里没有连咬。退回 null，让它走单击规则，比配一个错的强。
    const id = w.identifier ?? "";
    return (CLAW_PARTS.test(id) || w.category === "unarmed") ? {path: COMBO_UNARMED, color} : null;
  }
  const path = COMBO_SHAPE[w.identifier];
  return path ? {path, color} : null;
}

/**
 * 这件武器该出什么画面。
 *
 * @param {{identifier: string|null, category: string|null, damageType: string|null,
 *          properties: string[]}} w
 * @returns {{path: string, color: string|null}|null} null = 表里没有，交回调用方走兜底
 */
export function pickFor(w) {
  if (!w) return null;
  const id = w.identifier ?? "";

  // **部位路由要覆盖 `unarmed` 分类，不能只看 `natural` 属性。**
  // Crucible 的 `unarmed` 分类里有 claws / fists / katar / spikedKnuckles，其中只有
  // fists 带 natural 属性；而语料合成的天生武器动作（necroticBite 之类）也一律落在
  // unarmed 分类上。只认 natural 属性的话，这些全部漏进 `strike.unarmed` 那条
  // 只有一支拳影素材的规则——实测 14 条动作共用同一支，腐蚀咬击播的是蓝色拳影。
  if (w.properties?.includes("natural") || w.category === "unarmed") {
    // 部位决定形状，伤害类型只决定颜色。物理伤害在 DAMAGE_COLOR 里是 null——
    // 咬击退回 red（血），抓痕退回 brown（本色爪），拳击退回 red（creature_attack 族里
    // 实际存在的分支），三者都是族内真有的颜色。
    const color = DAMAGE_COLOR[w.damageType] ?? null;
    if (BITE_PARTS.test(id)) return {path: "jb2a.bite.400px", color: color ?? "red"};
    if (CLAW_PARTS.test(id)) return {path: "jb2a.claws.400px", color: color ?? "brown"};
    // 拳套 / 指虎 / 徒手：用 creature_attack 的拳影弧（12 条同规格，带颜色分支），
    // 比 unarmed_strike 那支单色单文件多一个元素维度。trove 给 Gauntlet 用的正是它。
    if (FIST_PARTS.test(id) || w.category === "unarmed") {
      return {path: "jb2a.melee_generic.creature_attack.fist.001", color: color ?? "red"};
    }
    // 骨刃（獠牙 / 犄角）在退回骨棒**之前**截住：它们是刃不是棒。整词匹配，见
    // BONE_BLADE_PARTS 的说明（`thorns` 含 `horn`，子串匹配会误伤）。
    if (isBoneBlade(id)) {
      return {path: "jb2a.melee_attack.01.bonesword.01", color: null};
    }
    const blunt = NATURAL_BLUNT[w.category];
    return blunt ? {path: blunt, color: null} : null;
  }

  if (w.category === "shieldLight" || w.category === "shieldHeavy") {
    return {path: SHIELD_SHAPE, color: null};
  }

  const ranged = RANGED_SHAPE[id] ?? RANGED_CATEGORY[w.category];
  if (ranged) return {path: ranged, color: null};

  const melee = WEAPON_SHAPE[id] ?? CATEGORY_SHAPE[w.category];
  // 绝大多数制式形制是纯几何叶子（color: null，调用方不传 color）；只有带色轴的那几支
  // 要钉死色支，见 SHAPE_COLOR。
  return melee ? {path: melee, color: SHAPE_COLOR[melee] ?? null} : null;
}

/** 只要路径的旧口径，给不需要颜色的调用方。 */
export const shapeFor = w => pickFor(w)?.path ?? null;

/**
 * [D3] 隔格（施法者与目标相距 ≥2 格）时该出什么画面。
 *
 * ## 改造前：48 件武器塌成同一记野太刀
 *
 * `travel.mjs` 的隔格分支写的是 `ctx.pick("jb2a.melee_attack.05.nodachi.01")`——一个常量。
 * 按 `const/weapon.mjs` 的 CATEGORIES 过滤（`range >= 2` 的是 balanced1 / heavy1 /
 * simple2 / balanced2 / heavy2），真能走到隔格的是 **48 件**（其中 **28 件是天生武器**），
 * 逐个都在那一个桶里：一记咬击、一根触手、一柄巨锤，隔一格打出来全是同一段金属野太刀。
 *
 * ## 为什么答案是「零新素材」
 *
 * 施工清单 §0.14 原本给了三层方案，选材阶段逐条量测读图后**两条走不通**（结论写在
 * ASSET-NOTES 的「D3 隔格」一节与否决清单里）：
 *
 *  · **blfx 的 `reach-10ft` 分支：否决。** 全库 16 条叶子里形制相关的四条
 *    （pike1 / lance1 / halberd2 / glaive2）**画面里根本没有武器**——2400×2400 的幅面中
 *    只有一道细线加一颗八角星爆闪，四支在四个采样帧上肉眼完全一样。用它只是把野太刀
 *    那个 48 的大桶换成八角星那个 48 的大桶，桶没拆开还丢了剪影。
 *  · **eskie 的 heavy/slow 档：接不上线。** 量测很干净（各 54-81 成员、30 帧 @29.97、
 *    帧数离散度 0.000、内容占比随重量单调上升），但整族 `template` 解析为 **null**
 *    （`eskie._templates` 没有 melee 键）。批次 B 之后近战几何靠 `template` +
 *    `swingScale()` 吃饭，template 为 null 会退回「贴图中心压在施法者身上」的历史语义，
 *    今天接进来必然错位。要用它得先给索引生成器补 `_template`——列在 blockers 里。
 *
 * ## 更重要的：「够不够得到」已经不是选材问题
 *
 * ⚠ 野太刀当初被选中的**唯一**理由是「全族唯一弧幅真够得到隔一格的一支」。那句话
 * **从来就不成立**，2026-08-29 已在 ASSET-NOTES 的「射程口径」一节证过：`x=758` 那类数字
 * 量的是**贴图内部像素**，而改造前 `scaleToObject` 把画幅差归一化掉（野太刀相对短剑的净
 * 增益只有 9.4 画布 px = 0.094 格，缺口是整整 1 格）；批次 B 之后近战改走 `swingScale()`，
 * 握把→刀锋的画布跨距恒等于中心距，**与画幅、与格像素数都无关**。
 * `jb2a.melee_attack` + `jb2a.unarmed_strike` 482 个叶文件的模板只有 `[200,300,300]`
 * 与 `[200,400,400]` 两种、授权跨距**全是 1.00 格零例外**——全族每一支都够得到任意距离。
 *
 * 所以隔格该出什么，判据只剩「画面像不像这件武器」，而那正是 `pickFor` 已经答完的问题。
 * **默认就取贴身同一件武器的形状**：`WEAPON_SHAPE` / `CATEGORY_SHAPE` / 部位路由 /
 * `NATURAL_BLUNT` 已经覆盖全部 92 件，一件新素材都不需要。
 *
 * 隔格与贴身要不要有观感差别，用**时长 / 叠加层**去表达，不要靠换成另一件武器——
 * 换武器身份是这一批要消灭的东西，不是要保留的东西。
 *
 * @param {{identifier: string|null, category: string|null, damageType: string|null,
 *          properties: string[]}} w
 * @returns {{path: string, color: string|null}|null} null = 交回调用方走兜底
 */
export function reachFor(w) {
  const base = pickFor(w);
  if (!base) return null;
  const over = REACH_SHAPE[w?.identifier ?? ""];
  // 覆写只换形状，颜色仍跟着 pickFor 走（天生武器的颜色轴不能因为隔一格就丢掉）。
  // 但覆写表里今天只有制式武器，所以实际上 color 恒为 base.color。
  return over ? {path: over, color: base.color} : base;
}

/**
 * [D3] 隔格**覆写**表：这几件武器「够远的那一下」确实是另一支素材，而不是同一支拉长。
 *
 * ⚠ **这张表天生就该很短。** 它不是「隔格的形制表」——那是 `pickFor`。能进这张表的
 * 条件很硬：素材库里得真有一支「同一件武器的长打版」，而且它**比同一支拉长更像**。
 * 逐族翻过 `jb2a.melee_attack` 五个 Group 之后只有一条满足：
 *
 *  · `katana` → `nodachi`。野太刀字面就是「长太刀」，是太刀的长兵版本；
 *    它也是全族唯一 1000×800 画幅的一支（其余 478 个叶文件都是 800×600），
 *    大幅过顶下劈在画面上就是「够远的一记」。ASSET-NOTES 主表逐帧读过：
 *    f11-13 是最大的下劈弧光，f16-23 定格残影，**f24-41 全空（占 43%）**，
 *    命中点对齐 f12 而不是片尾；手性极强，向左施放必须 mirrorY。
 *
 * 长柄（glaive / halberd）**故意不进表**：它们贴身用的 `.05.scythe.01` 峰值帧能看见
 * 完整的镰刀柄与弯刃，是全族剪影辨识度最高的一支，换成野太刀等于把长柄变成刀。
 * 巨剑 / 巨斧同理——D9 刚给它们配上认得出形制的 `.02`，隔格再换回野太刀是倒退。
 * 天生武器更不能进：ASSET-NOTES 明写「隔格时保持 bite / claws 本族，绝不换成金属刀光」。
 *
 * 键是 `system.identifier`，与 `WEAPON_SHAPE` 同一套派发键（理由见本文件开头）。
 */
export const REACH_SHAPE = Object.freeze({
  katana: "jb2a.melee_attack.05.nodachi.01"
});
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