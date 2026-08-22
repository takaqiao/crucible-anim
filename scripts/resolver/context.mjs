import {RUNE_COLOR, DAMAGE_COLOR, pickColor} from "./palette.mjs";

/** mulberry32：小、快、确定。用它替代 Math.random 以保证全场画面一致与测试可复现。 */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * 构造注入兵库 build() 的能力袋。
 * @param {{assets: object, snapshot: object, seed: number}} opts
 */
export function createContext({assets, snapshot, seed}) {
  const baseSeed = seed ?? snapshot?.seed ?? 0;
  const rng = mulberry32(baseSeed);
  /**
   * 第二条独立随机流，专供 resolve.mjs 的 freezeRandom() 固化「本该由播放端摇」的随机项。
   * 必须与 rng 分开：共用一条会让每条带 randomRotation 的 cue 挪动后续 pick() 的取数
   * 位置，同一个动作的选材结果凭空改变（确定性仍在，但所有既有计划的素材选择都会变）。
   * 异或 0x9E3779B9（黄金比例常数，mulberry32 作者建议的 stream 分离手法）后种子仍是
   * snapshot.seed 的纯函数，全场一致与可复现都不受影响。
   */
  const rngAux = mulberry32((baseSeed ^ 0x9E3779B9) >>> 0);
  const warnings = [];

  const runeColor = () => (snapshot?.spell ? RUNE_COLOR[snapshot.spell.rune] ?? null : null);
  const damageColor = () => DAMAGE_COLOR[snapshot?.usage?.damageType] ?? null;

  /**
   * 解析一个素材路径，可选地在其颜色分支里取最近色。
   * @param {string} dbPath  不含颜色段的路径；给了 color 时会拼在末尾
   * @param {{color?: string}} [opts]
   * @returns {{file: string, files: string[], hue: number, template: number[]|null, path: string}|null}
   */
  function pick(dbPath, {color} = {}) {
    let path = dbPath;
    let hue = 0;
    if (color) {
      const chosen = pickColor(assets, dbPath, color);
      if (chosen.color) { path = `${dbPath}.${chosen.color}`; hue = chosen.hue; }
    }
    const r = assets.resolve(path);
    if (!r) return null;
    // 变体数组在此确定性取一，保证全场一致
    const file = r.files.length > 1 ? r.files[Math.floor(rng() * r.files.length)] : r.file;
    return {file, files: r.files, hue, template: r.template, path: r.path};
  }

  function sound(dbPath) {
    const r = assets.resolve(dbPath);
    if (!r) return null;
    const file = r.files.length > 1 ? r.files[Math.floor(rng() * r.files.length)] : r.file;
    return {file};
  }

  const originWidth = () => snapshot?.origin?.width ?? 1;

  const geom = {
    /** 大体型施法者的特效要放大，否则相对身位显得太小。取自 blfx 的 ×1.4。 */
    sizeScale: () => (originWidth() > 1 ? 1.4 : 1),
    /** 特效沿攻击方向的前移量；隔格时折半，否则会越过目标。 */
    offsetFor: (target, base) => {
      const w = originWidth();
      return (w > 1 && !target?.adjacent) ? (w * base) / 2 : w * base;
    },
    adjacent: target => target?.adjacent === true,
    onLeft: target => target?.onLeft === true
  };

  return {
    rng, rngAux,
    pickOne: arr => arr[Math.floor(rng() * arr.length)],
    pick, sound, runeColor, damageColor, geom,
    warn: msg => warnings.push(msg),
    warnings
  };
}
