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
  /**
   * 第三条独立随机流，专供**音效**选材（`sound` / `soundFrom`）。
   *
   * **为什么非分不可**（声效层重做方案 §3.2，与上面 rngAux 是同一个理由的第二次发作）：
   * `sound()` 对单文件路径**一次抽取都不消耗**（下面那行的 `files.length > 1` 短路），
   * 而兵库里音效常排在视觉之前——`travel.mjs` 是先 `strikeSounds(...)` 再
   * `ctx.pick(trailPath)`。于是只要某条规则的抽取次数从 0 变 1（也就是「给这个音效加一个
   * 随机池」这件事本身），**这条 cue 之后的每一个 `pick()` 都会摇到另一个 variant**，
   * 跨目标、跨槽位一路传染：一次纯音效改动会静默改掉 434 个动作的画面选材，
   * 而 clip-table 的逐文件时序、ASSET-NOTES 的逐条读图结论、sound-layer 的音画对齐
   * 全部跟着漂，「改了音效画面变了」只会被误当成别的回归。
   *
   * 分流之后，音效池怎么扩、扩多少，`ctx.pick` 的取数位置一格都不动。
   * 异或 0x85EBCA6B（murmur3 的 finalizer 混淆常数，与 rngAux 用黄金比例常数是同源手法）
   * 后种子仍是 snapshot.seed 的纯函数，全场一致与可复现都不受影响。
   *
   * 守卫在 `test/rng-streams.test.mjs`：把某条单文件音效换成多文件池后求解全语料，
   * 所有非 sound cue 的 file 必须逐条相等——共用一条流即红。
   */
  const rngSfx = mulberry32((baseSeed ^ 0x85EBCA6B) >>> 0);
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

  /**
   * 单条 DB 路径的音效选材。摇的是 **rngSfx**，不是 rng（理由见上面 rngSfx 的注释）。
   * @param {string} dbPath
   * @returns {{file: string}|null}
   */
  function sound(dbPath) {
    const r = assets.resolve(dbPath);
    if (!r) return null;
    const file = r.files.length > 1 ? r.files[Math.floor(rngSfx() * r.files.length)] : r.file;
    return {file};
  }

  /**
   * **显式池**的音效选材：给一组路径，摇一条。
   *
   * 为什么要有这个而不是只靠 `sound()` 的单路径：一部分素材族（ggg-sfx 全部如此）把
   * 「同一种声音的几个变体」拆成了**并列的编号子枝**（`….01` / `….02` / …），
   * 而 `assets.resolve` 对分支节点只取其下第一个叶子作代表（`assets.mjs` 的
   * `getEntry`：中间节点取第一个叶子；运行时侧 `flattenEntry` 对条目数组同样只取第一条）
   * ——单条路径在这种族上恒定拿到同一个文件，取不到池。所以池必须由调用方**逐条列出**。
   *
   * 三条约定：
   * - **查不到的路径跳过**，不是让整个池塌成 undefined：兵库里一条路径写错/素材包没装，
   *   不该把剩下四条也一起废掉。
   * - **全部查不到才返回 null**，让调用方能识别并退回单条兜底；这一层绝不静默无声。
   * - 池按文件去重：同一个文件被两条路径指到（分支与其唯一叶子并列写进来是常见笔误）
   *   不该因此拿到双倍权重。
   *
   * 与 `sound()` 一致地在池长为 1 时短路不摇——这两条流已经与 `rng` 隔开，
   * 池大小的增减只会挪动 rngSfx 自己后续的取数，动不到任何画面选材。
   *
   * @param {string[]} paths  DB 路径数组（也可以是直接的文件路径，`resolve` 两者都吃）
   * @returns {{file: string, files: string[]}|null}  files 是去重后的整池，供守卫查池大小
   */
  function soundFrom(paths) {
    if (!Array.isArray(paths) || !paths.length) return null;
    const pool = [];
    for (const p of paths) {
      const r = assets.resolve(p);
      if (!r) continue;
      for (const f of r.files) if (f && !pool.includes(f)) pool.push(f);
    }
    if (!pool.length) return null;
    const file = pool.length > 1 ? pool[Math.floor(rngSfx() * pool.length)] : pool[0];
    return {file, files: pool};
  }

  const originWidth = () => snapshot?.origin?.width ?? 1;

  const geom = {
    /**
     * 大体型施法者的特效要放大，否则相对身位显得太小。
     *
     * **连续，不是两档**（施工清单 §2.1）。从前写的是 `originWidth() > 1 ? 1.4 : 1`：
     * 2×2 的狗头人与 4×4 的巨龙拿到同一个 1.4——身位差四倍，放大系数一模一样。
     * 1.4 这个数本身来自 blfx，它是**一档**大体型的经验值，把它当成「所有大体型」的
     * 答案是把一个样本点当成了一条曲线。
     *
     * 改成 `1 + 0.4·(w-1)`：w=1 → 1、w=2 → 1.4（与旧值逐字相同，中体型对狗头人这一档
     * 的观感不变，也就是说这次改动**不会动到现有语料的任何一条 cue**——全语料 434 条
     * 动作的 origin.width 都是 1），w=3 → 1.8、w=4 → 2.2。
     *
     * 为什么是线性而不是按面积（w²）：这个系数最终乘进 `objectScale`，而
     * `scaleToObject` 本身已经把贴图宽定成「锚定对象宽 × objectScale」——面积那一档
     * 已经由锚定对象承担了，这里补的只是「大家伙的动作幅度也该更大」这一层，
     * 再乘一次平方会让 4×4 的挥击涨到 4.84 倍，盖掉半个战场。
     */
    sizeScale: () => 1 + 0.4 * (originWidth() - 1),
    adjacent: target => target?.adjacent === true
  };

  return {
    rng, rngAux, rngSfx,
    pickOne: arr => arr[Math.floor(rng() * arr.length)],
    pick, sound, soundFrom, runeColor, damageColor, geom,
    warn: msg => warnings.push(msg),
    warnings
  };
}
