/**
 * 符文与伤害类型到 JB2A 颜色名的映射，以及色相补偿。
 *
 * 素材库里每个特效可用的颜色各不相同（Club01 只有 blue/orange/purple/white，
 * magic_sword 还有 dark_green/dark_purple/yellow）。因此不能直接拿配色去拼路径，
 * 必须在该特效实际可用的颜色里取最近色，再用 ColorMatrix 的 hue 旋转补足差值。
 * 这一手法取自 pf2e-jb2a-macros 的 Cone Hands 宏。
 */

/** JB2A 常见颜色名 → 色相角（度）。灰阶色给 null 语义的 -1，不参与最近色计算。 */
export const COLOR_HUE = Object.freeze({
  red: 0, orange: 30, yellow: 55, green: 120, teal: 165, blue: 215,
  dark_blue: 225, purple: 275, dark_purple: 285, pink: 320, dark_green: 130,
  blueyellow: 235, greenyellow: 90, orangepurple: 340, bluepurple: 250,
  white: -1, dark_red: 355, dark_orange: 25,
  // JB2A 的 bright_ 前缀是同色的高亮版（jb2a.claws 整族只有这一套命名），brown 与 grey
  // 同样只出现在天生武器那两族。**不补进来 pickColor 就整族失效**：它先
  // `filter(c => c in COLOR_HUE)`，认不出的分支直接不进候选集，于是 jb2a.claws 的 8 个
  // 分支只剩 red / dark_red 两支可选，10 件元素爪击（冰/电/心灵/虚空…）全塌成同一支。
  // grey 归 -1（灰阶，可显式指定但不作为任何饱和色的近似）。
  bright_blue: 215, bright_green: 120, bright_orange: 30, bright_purple: 275,
  bright_yellow: 55, brown: 25, grey: -1,
  // melee_attack 各组的 trail（强度叠加层）只有这三支，其中两支原先也不在表里，
  // pickColor 会把它们过滤掉、只剩 blueyellow 一支可选。orangered 取红橙之间、
  // pinkpurple 取紫粉之间。
  orangered: 10, pinkpurple: 300,

  // ==========================================================================
  // 2026-08-29（批次 D / D6）：补全全库色名。
  //
  // ## 为什么必须补全，而不是「用到再加」
  //
  // `pickColor` 的第一句是 `colorsUnder(path).filter(c => c in COLOR_HUE)`——
  // **表里没有的分支根本不进候选集**，不是「排在后面」而是「不存在」。所以漏一个色名
  // 的代价不是选色差一点，而是整支素材对规则不可见：实测 `jb2a.melee_attack.03.greataxe.02`
  // 的 9 个色支只有 4 支进候选，5 支（blueteal / greenpurple / orangeyellow / pinkyellow /
  // purplered）被静默滤掉；`jb2a.melee_attack.03.magical_greatsword` 更极端——
  // 它下面只有一个 `01` 段，候选集**空**，附魔巨剑的颜色轴整条失效。
  //
  // ## 清单怎么来的（枚举，不是手写）
  //
  // 扫 `data/asset-index.json` 全树的段名，用色词正则
  // `^(dark_?|light|bright_)?<基色>(_?<基色>)?\d{0,2}$` 以及 `<基色>-<基色>` 命中 95 个
  // 不在表里的段名（另加 ggg-vfx 的 `red_and_blood`，带 `_and_` 正则够不着，手工补一条）。
  // **刻意没有全收**：同一次枚举里还有一批「站在颜色分支位置上、但不是颜色」的段名——
  // `01`/`02`/`001`-`014`/`200`/`400`/`1200`（变体号）、`loop`/`still_frame`/`standard`/
  // `single`/`textured`/`unlit`/`reversed`（形态）、`dark`/`earth`/`fire`/`water`/`frost`/
  // `boulder`/`rock`/`ground_crack`/`shrapnel`/`sound`（题材，jb2a.impact 与 jb2a.cast_generic
  // 把它们和颜色混在同一层）、以及 jaamod 的 `teleporter`/`sci_fi_hud`/`asteroid` 一类。
  // **这些一条都不能进表**：进了表就成了候选集成员，`want` 是灰阶时的 `available[0]`
  // 兜底会把一记挥击选成 `still_frame`。判据是「这个段名是不是在说颜色」，不是「它是不是
  // 站在颜色那一层」。
  //
  // ## 数值规则
  //
  // 1. **单色名**照基色；`dark_` / `light` / 尾号 `01`-`03` 是**明度或渲染批次，不是色相**，
  //    与无前缀同色相。表里五条历史 dark_ 条目（dark_blue 225 / dark_purple 285 /
  //    dark_red 355 / dark_orange 25 / dark_green 130）各偏 ±10，那是历史值，不动。
  // 2. **双色名**取两色的**最短色相中点**；色相差 >150°（近乎对立，中点会落到与两色都
  //    无关的第三色上）时取**首色**——jb2a 的双色命名是「首色为主、次色为辅」
  //    （blueyellow 是蓝底黄电弧、orangeyellow 是橙底黄边）。表里 5 条历史双色名正好落在
  //    中点上（greenyellow 90 / bluepurple 250 / orangered 10 / pinkpurple 300 /
  //    orangepurple 340），第 6 条 blueyellow 235 正是走对立分支的那一条（Δ=160，取蓝 215
  //    再朝黄偏 20°），历史值同样不动。
  // 3. **灰阶与多彩记 -1**：可以被显式指定（`RUNE_COLOR.kinesis` 就指定 white），
  //    但不作为任何饱和色的近似——`pickColor` 的最近色循环显式跳过 `hue < 0`。
  //    多彩（rainbow / multicolored）归这一档的理由是它没有单一色相，拿它去近似「红」
  //    会得到一道彩虹。
  // ==========================================================================

  // —— 灰阶与多彩（-1：可显式指定，不作近似）——
  black: -1, dark_black: -1, dark_white: -1, dark_grey: -1, gray: -1, silver: -1,
  colorless: -1, white02: -1, white1: -1,
  rainbow: -1, rainbow01: -1, rainbow02: -1,
  multicolored: -1, multicolored01: -1, multicolored02: -1, multicolor1: -1,

  // —— 单色名：明度前缀 / 渲染批次尾号，色相同基色 ——
  dark_yellow: 55, dark_pink: 320, dark_teal: 165, dark_brown: 25,
  lightblue: 215, lightgreen: 120, lightpurple: 275, darkpurple: 285,
  red02: 0, yellow02: 55, green02: 120, blue02: 215, blue03: 215, purple02: 275,
  dark_purple02: 285,
  // blfx / jaamod 的 `<色>1` `<色>2` 是同色的两支渲染，不是两种颜色
  red1: 0, orange1: 30, yellow1: 55, green1: 120, green2: 120,
  blue1: 215, blue2: 215, blue3: 215, purple1: 275, purple2: 275,
  // 表里原本一个都没有的具名色：cyan 在青绿之间、azure 是天蓝、violet 同紫、
  // gold 偏黄橙、tan 与 sandstone 是土黄档（brown 25 的两个更浅的邻居）
  cyan: 180, azure: 205, violet: 285, gold: 45, tan: 30, sandstone: 35,
  // bluegrey 是掉了饱和度的蓝，不是灰阶——它与同族的 grey 分支并存（jb2a.whirlwind）
  bluegrey: 215, bluegrey02: 215,
  // ggg-vfx 的「红 + 血」，与同族 red 并存
  red_and_blood: 0,

  // —— 双色名：最短中点；Δ>150° 取首色（见上面的规则 2）——
  orangeyellow: 43,        // 30 / 55
  pinkyellow: 8,           // 320 / 55  → 320+47.5
  pink_yellow: 8,
  purplered: 318,          // 275 / 0（→360）
  dark_purplered: 318,
  blueteal: 190,           // 215 / 165
  greenorange: 75,         // 120 / 30
  bluegreen: 168,          // 215 / 120
  greenblue: 168,
  redyellow: 28,           // 0 / 55
  "yellow-red": 28,
  dark_red_yellow: 25,     // 355 / 55
  purplepink: 298,         // 275 / 320
  dark_pinkpurple: 300,    // 同历史条目 pinkpurple
  pink_purple: 300,
  greenred: 60,            // 120 / 0
  bluepink: 268,           // 215 / 320
  orangepink: 355,         // 30 / 320
  purpleblue: 245,         // 275 / 215
  purpleteal: 220,         // 275 / 165
  tealyellow: 110,         // 165 / 55
  redorange: 15,           // 0 / 30
  green_yellow: 90,        // 同历史条目 greenyellow
  purple_yellow: 345,      // 275 / 55（→415）
  purpleyellow: 345,
  browngreen: 72,          // 25 / 120
  dark_orangepurple: 340,  // 同历史条目 orangepurple
  // Δ>150°：取首色。中点会落到与两色都无关的第三色上（greenpurple 的中点是 198＝青蓝，
  // 而它画面上是绿芯紫边），所以按 jb2a 的命名约定取主色。
  greenpurple: 120,        // Δ155
  dark_greenpurple: 120,
  purplegreen: 275,        // Δ155
  greenpink: 120,          // Δ160
  yellowblue: 55,          // Δ160
  blueorange: 215,         // Δ175
  pinkteal: 320,           // Δ155
  // 与灰阶组合：灰阶没有色相，取有彩的那一半
  bluewhite: 215, dark_bluewhite: 215, dark_whiteblue: 215, blue_white: 215,
  greenwhite: 120, yellowwhite: 55,
  blackblue: 215, blackyellow: 55, "black-purple": 275,
  purpleblack: 275, redblack: 0, greenblack: 120,
});

/**
 * 12 个符文的主色。取自各符文的意象：storm 用蓝黄电光、earth 用土绿、soul 用青、oblivion 用暗紫。
 *
 * ⚠ **kinesis 2026-08-29 从 teal 改成 white**，两个理由：
 *
 * 1. **原值与 soul 撞色。** 两个符文都是 `teal`，`pickColor` 对同一族给出的是同一个分支，
 *    于是「动能」与「灵魂」两条线在**所有**颜色轴素材上逐字相同——这是 12 符文里唯一
 *    一对完全无法分辨的。
 * 2. **系统自己给了答案。** Crucible 的 `#GLOW_COLORS`（crucible-compiled.mjs:1082175）
 *    逐符文钉了辉光色，kinesis 是 `#d7d7d7`——浅灰，而 soul 是 `#00faff`（青）。
 *    12 条里只有 kinesis 是无彩的，正对上「动能是力场，不是元素」这层语义。
 *    `#d7d7d7` 比中灰更靠近白，而 jb2a 的 `white` 分支覆盖面远大于 `grey`，取 white。
 *
 * white 在 COLOR_HUE 里是 -1（灰阶）。**这不是「没配色」**：`pickColor` 对灰阶 want 会
 * 先在候选里找另一个灰阶分支（见该函数的灰阶分支），找得到就精确命中；找不到才退回
 * `available[0]`。所以 kinesis 在带 white 的族上是真正独立的一支，在只有彩色分支的族上
 * （如 `jb2a.magic_signs.circle.02.*.loop` 的 12 色里没有白）仍走兜底——那是素材的缺口，
 * 不是表的错，硬指一个彩色只会又和别的符文撞上。
 */
export const RUNE_COLOR = Object.freeze({
  flame: "orange",
  frost: "blue",
  life: "green",
  death: "purple",
  storm: "blueyellow",
  earth: "dark_green",
  illumination: "yellow",
  illusion: "pink",
  kinesis: "white",
  control: "bluepurple",
  oblivion: "dark_purple",
  soul: "teal"
});

/** 12 个伤害类型的主色。物理三种走血迹与火花，不配色。 */
export const DAMAGE_COLOR = Object.freeze({
  bludgeoning: null, piercing: null, slashing: null,
  fire: "orange", cold: "blue", electricity: "blueyellow",
  acid: "green", poison: "dark_green", radiant: "yellow",
  void: "dark_purple", psychic: "purple", corruption: "dark_green"
});

/**
 * **真·无彩**色名。`COLOR_HUE` 里记 -1 的有两类，这里只收第一类：
 *
 *   · 无彩（白/灰/黑/无色）—— 没有色相，但彼此是合理的近似：白与灰的差别远小于白与紫。
 *   · 多彩（rainbow / multicolored）—— 同样没有单一色相，但它**不是任何颜色的近似**，
 *     拿它去代替「白」会得到一道彩虹。
 *
 * 两类都记 -1（都不进最近色循环），差别只在 `pickColor` 的灰阶兜底该挑谁。
 * ⚠ 这条是实测逼出来的：只按 `COLOR_HUE[c] < 0` 找兜底时，`RUNE_COLOR.kinesis`（white）
 * 的锥形喷吐选到了 `BreathWeapon_Fire01_Regular_MultiColor01` —— 一道彩虹龙息。
 */
const GREY_COLORS = new Set([
  "white", "grey", "gray", "silver", "colorless",
  "black", "dark_white", "dark_grey", "dark_black", "white02", "white1"
]);

/**
 * `dark_` / `dark` 明度前缀。
 *
 * ⚠ 它**只剩灰阶兜底那一处用途**（在 white / dark_white 这类中性档里优先取不带 dark 的一支）。
 * 色相同距的 tie-break 从前也用它「非 dark 恒赢」，2026-08-29 已改掉——见 `pickColor` 里
 * 那段翻案说明：三张族图证伪了「暗支在深色地图上糊没」，而那条 tie-break 的代价是
 * 把 12 色的族**压回 6 色**。
 */
const DARK_PREFIX = /^dark_?/;

/**
 * 同距并列时的稳定散列（FNV-1a 32 位，与 `trigger/snapshot.mjs` 的 `hashSeed` 同式）。
 *
 * 只用来在**色相距离完全相同**的候选之间挑一个：它是纯函数，同一个色名恒得同一个值，
 * 所以多客户端一致、可复现，且**不消耗任何随机流**（`pickColor` 在 `ctx.pick` 内部被调用，
 * 动一下抽取次数会让这条 cue 之后的全部选材漂移——见 `resolver/context.mjs` 里
 * `rngAux` / `rngSfx` 为什么要分流）。
 *
 * 为什么不按 `dark_` 前缀分优劣：见下面 `pickColor` 里那段翻案说明。
 */
function tieHash(name) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) { h ^= name.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** 多彩：rainbow / multicolored / multicolor1。与灰阶一样记 -1，但见 GREY_COLORS 的说明。 */
const MULTI_COLOR = /^(?:rainbow|multicolor)/;

/**
 * 「实在没有依据」时该退回哪一支。
 *
 * 原来直接写 `available[0]`——`getPathsUnder` 的顺序，与想要的颜色毫无关系。保留这个语义
 * （没有色相就没有依据，随便挑一支比返回 null 好），只加一条：**多彩排最后**。
 * 一道彩虹是任何单色的最差近似，而它在 DB 里常常正好排第一
 * （`blfx.spell.range.missile1` 的子段就是 `[rainbow, ice]`）。
 * 整族只有多彩可选时仍然返回多彩——那是素材本来的样子，不是选错。
 */
const firstUseful = available =>
  available.find(c => !MULTI_COLOR.test(c)) ?? available[0];

/**
 * 两个颜色之间的最短色相差，带符号，范围 −180..180。
 * 任一颜色是灰阶（−1）或未知时返回 0，即不做补偿。
 * @param {string} from
 * @param {string} to
 * @returns {number}
 */
export function hueDelta(from, to) {
  const a = COLOR_HUE[from];
  const b = COLOR_HUE[to];
  if (a === undefined || b === undefined || a < 0 || b < 0) return 0;
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

/**
 * 在某个特效实际可用的颜色分支里取最接近目标色的一个。
 * @param {{colorsUnder: Function}} assets  createAssets 的返回值
 * @param {string} dbPath                    颜色分支所在的父路径
 * @param {string} want                      期望颜色名
 * @returns {{color: string|null, hue: number}}  hue 为需要额外旋转的度数
 */
export function pickColor(assets, dbPath, want) {
  const available = assets.colorsUnder(dbPath).filter(c => c in COLOR_HUE);
  if (!available.length) return {color: null, hue: 0};
  if (available.includes(want)) return {color: want, hue: 0};

  const target = COLOR_HUE[want];
  if (target === undefined) return {color: firstUseful(available), hue: 0};

  /*
   * 灰阶 want（white / grey / black / colorless…，COLOR_HUE 记 -1）没有色相，进不了下面的
   * 最近色循环。**但「找另一个灰阶」是有意义的近似**：白与灰的差别远小于白与紫。
   * 改造前这里直接 `return available[0]`——候选集的第一个，也就是 `Object.keys` 的顺序，
   * 与想要的颜色毫无关系。实测代价：`comboFor` 对物理伤害的连段用的正是 `?? "white"`，
   * 于是 20 件武器的连段在「本族没有 white」时抽到的是排在最前面的那一支
   * （`jb2a.glaive.melee.01` 排第一的是 `black`）；`RUNE_COLOR.kinesis` 改成 white 之后
   * 这条路径还会承载一整个符文。
   *
   * 先在候选里找灰阶同类，找不到才退回原来的 `available[0]`（那是「实在没有依据」时的
   * 兜底，保持原样，不硬指一个彩色）。
   */
  if (target < 0) {
    // 只在**真·无彩**里找（GREY_COLORS），不是所有 -1——rainbow / multicolored 同样记 -1，
    // 但它们不是白的近似。同样偏好不带 dark_ 的那一支，理由与下面的 tie-break 相同。
    const greys = available.filter(c => GREY_COLORS.has(c));
    const grey = greys.find(c => !DARK_PREFIX.test(c)) ?? greys[0];
    return {color: grey ?? firstUseful(available), hue: 0};
  }

  // 起点也用 firstUseful：整族都是灰阶/多彩时下面的循环一次都不会更新 best，
  // 那时 best 就是最终答案，不能让它是一道彩虹。
  let best = firstUseful(available);
  let bestDist = Infinity;
  for (const c of available) {
    const h = COLOR_HUE[c];
    if (h < 0) continue;                      // 灰阶不作为近似色候选
    const dist = Math.abs(hueDelta(c, want));
    // 同距并列怎么办。**这条要解决的问题是真的，原来给的答案是错的。**
    //
    // 真问题：补全色名之后同距并列变成常态（magic_signs 那 12 色里 dark_yellow 与
    // yellow 到「橙」都是 25°），而并列时原本是「谁先出现谁赢」＝ `getPathsUnder` 的
    // 顺序＝ DB 的 key 序。**顺序是偶然，不是选择**——这一层必须钉死，否则同一个符文
    // 换个素材包版本就换个颜色。
    //
    // 【2026-08-29 改】原答案是「同距时取**不带 `dark_` 前缀**的那一支」，依据是
    // ASSET-NOTES 记的暗支「深色地图上直接糊没」（附魔剑族暗底亮度 37.9 vs 128.5、
    // greataxe.02 的 purplered 72.0 vs greenyellow 145.5）。**三张族图逐一证伪**：
    // `melee_attack.01.magic_sword` 的 dark_green 是荧光绿刀弧、dark_purple 是亮品红刀弧；
    // `magic_signs.circle.02.{conjuration,necromancy,evocation}.loop` 的 6 个 dark 支
    // 外环/星形/符号位全部清晰可读，只是线更细、发光更收敛。
    // `darkLuma` 是**内容区平均亮度**（tools/profile-family.mjs），刀弧只占画幅百分之几
    // 且弧内带暗条纹，平均值自然低——它答的是「平均多亮」，**不是「看不看得见」**。
    //
    // 而这条 tie-break 的代价是全库性的：同距恒选 regular，等于把 12 色的族**压回 6 色**，
    // 正好抵消 `CIRCLE_COLORS` 那次翻案的收益（owner 的 KPI 是「尽量不复用」）。
    //
    // 新答案：并列时用**色名的稳定散列**决定，既不受 key 序影响（真问题解决了），
    // 又不系统性偏向任何一侧（假问题不再花钱）。散列是纯函数，多客户端一致、
    // 与 `ctx.rng` 无关，不消耗任何随机流——这一点很重要：`pickColor` 在 `ctx.pick` 内部
    // 被调用，动一下抽取次数会让后续全部选材漂移（见 context.mjs 的 rngAux/rngSfx 注释）。
    const better = dist < bestDist || (dist === bestDist && tieHash(c) > tieHash(best));
    if (better) { bestDist = dist; best = c; }
  }
  return {color: best, hue: hueDelta(best, want)};
}
