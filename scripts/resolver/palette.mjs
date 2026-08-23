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
});

/** 12 个符文的主色。取自各符文的意象：storm 用蓝黄电光、earth 用土绿、soul 用青、oblivion 用暗紫。 */
export const RUNE_COLOR = Object.freeze({
  flame: "orange",
  frost: "blue",
  life: "green",
  death: "purple",
  storm: "blueyellow",
  earth: "dark_green",
  illumination: "yellow",
  illusion: "pink",
  kinesis: "teal",
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
  if (target === undefined || target < 0) return {color: available[0], hue: 0};

  let best = available[0];
  let bestDist = Infinity;
  for (const c of available) {
    const h = COLOR_HUE[c];
    if (h < 0) continue;                      // 灰阶不作为近似色候选
    const dist = Math.abs(hueDelta(c, want));
    if (dist < bestDist) { bestDist = dist; best = c; }
  }
  return {color: best, hue: hueDelta(best, want)};
}
