/**
 * Sequencer 数据库路径的降级解析。
 *
 * 算法与 eskie-macros 的 lib/filemanager.js#bestFit 一致：沿点分路径逐级下行，
 * 某一级不存在就取该级第一个可用项并记录，继续往下走。从构造上不可能产出
 * 数据库里没有的路径。
 *
 * 两个后端共用同一套算法：离线后端读 data/asset-index.json 供 Node 测试，
 * 运行时后端读 Sequencer.Database 供游戏内使用。同源数据，测试与运行时天然一致。
 */

const META_KEYS = new Set(["_template", "_metadata", "_templates"]);

/* -------------------------------------------- */
/*  后端                                         */
/* -------------------------------------------- */

/**
 * @param {object} index  data/asset-index.json 的内容
 * @returns {Backend}
 */
export function offlineBackend(index) {
  const roots = index.tree;

  /** 沿点分路径下行到对应节点。 */
  function node(path) {
    if (!path) return null;
    const parts = path.split(".");
    let cur = roots[parts[0]];
    for (let i = 1; i < parts.length && cur; i++) {
      cur = (cur && typeof cur === "object" && !Array.isArray(cur)) ? cur[parts[i]] : undefined;
    }
    return cur ?? null;
  }

  /** 从节点自身或其最近的祖先继承 _template。 */
  function templateOf(path) {
    const parts = path.split(".");
    for (let i = parts.length; i > 0; i--) {
      const n = node(parts.slice(0, i).join("."));
      if (n && typeof n === "object" && !Array.isArray(n) && Array.isArray(n._template)) {
        return n._template;
      }
      if (n && typeof n === "object" && !Array.isArray(n) && typeof n._template === "string") {
        return roots[parts[0]]?._templates?.[n._template] ?? null;
      }
    }
    return null;
  }

  return {
    getPathsUnder(path) {
      const n = path ? node(path) : null;
      const target = path ? n : roots;
      if (!target || typeof target !== "object" || Array.isArray(target)) return [];
      return Object.keys(target).filter(k => !META_KEYS.has(k));
    },
    getEntry(path) {
      const n = node(path);
      if (typeof n === "string") return {file: n, template: templateOf(path)};
      if (Array.isArray(n)) return {file: n, template: templateOf(path)};
      if (n && typeof n === "object") {
        // 中间节点：取其下第一个叶子作为代表
        for (const k of Object.keys(n)) {
          if (META_KEYS.has(k)) continue;
          const sub = this.getEntry(`${path}.${k}`);
          if (sub) return sub;
        }
      }
      return null;
    }
  };
}

/**
 * 把 `Sequencer.Database.getEntry()` 的返回值压平成字符串文件路径数组。
 *
 * **这里是上机才暴露的一处硬伤**（2026-08-23 预览宏实测）。先前的实现读 `e.file ?? e.files`，
 * 而 Sequencer 4.2.3 的 `getEntry` 会返回五种完全不同的东西（`sequencer.js:6732` 起）：
 *
 * | 返回形态 | 何时 | `e.file` 是什么 | 旧实现的后果 |
 * | --- | --- | --- | --- |
 * | `SequencerFilePlain` | 单文件条目 | **私有字段 `#file`，外部读不到** | `undefined` → 返回 null → **整条 cue 静默消失** |
 * | `SequencerFile` | 变体数组条目 | string 或 array | 正确 |
 * | `SequencerFileRangeFind` | 带 ft 距离档的条目 | **按 ft 键的对象** | 把对象当路径下发 → `Sequencer \| preload \| each entry in inSrcs must be of type string` |
 * | `Array<string>` | 查询里带 ft、且该档是变体数组 | — | 取 `e[0].file` → `undefined` → 返回 null → cue 消失 |
 * | `string` | 查询里带 ft、该档单文件 | — | 正确 |
 *
 * 三个子类都实现了 `getAllFiles()`（`sequencer.js:6387 / 6454 / 6508`），那才是对外 API：
 * Plain 返回 `[#file]`、SequencerFile 返回 `[this.file].deepFlatten()`、
 * RangeFind 返回 `Object.values(this.file).deepFlatten()`。优先走它。
 *
 * 离线测试为什么没抓到：`offlineBackend` 读的是 `data/asset-index.json` 里的纯字符串，
 * 根本走不到这些类。这正是本项目第 6 类失败模式「离线全绿、上机静默失效」。
 * 形态假设由 `test/sequencer-contract.test.mjs` 钉在 Sequencer 源码上。
 */
export function flattenEntry(e) {
  if (!e) return [];
  if (typeof e === "string") return [e];

  if (Array.isArray(e)) {
    /*
     * 两种数组，语义完全不同，**不能一起摊平**：
     *
     *   · `Array<string>` —— 一个条目内部的变体池（查询带 ft 时 getEntry 已经把
     *     `entry.file[ft]` 取出来了，那一档本身就是数组）。Sequencer 自己也是在这
     *     一层随机（`SequencerFile.getFile()` 走 random_array_element），所以整池带走，
     *     由 ctx.pick 用出手端的 seeded rng 摇定。
     *
     *   · `Array<SequencerFile>` —— **前缀匹配到了多个不同条目**（如查 `…shortsword`
     *     而库里有 `.blue` 与 `.orange`）。这些是兄弟分支，不是同一条目的变体：
     *     ASSET-NOTES 实测同族分支帧数能差到 1.83 倍、帧率有五种，而兵库的
     *     startTime/duration/fade 是**逐条实测值**。把它们当池随机取，会让那些数字
     *     静默配到帧数对不上的素材上（V2-PLAN D6(b)）。所以只取第一条，与既有契约一致；
     *     要跨分支随机必须在兵库里显式声明池并逐条实测。
     */
    if (e.every(x => typeof x === "string")) return e;
    return flattenEntry(e[0]);
  }

  // 三个 SequencerFile 子类的统一出口；RangeFind 会把所有距离档一起摊平，
  // 但带 ft 的查询在 getEntry 内部就已经被解析掉了，走到这里的必然是不分档的条目。
  if (typeof e.getAllFiles === "function") {
    try {
      const all = e.getAllFiles();
      const flat = Array.isArray(all) ? all.flat(Infinity) : [all];
      const strings = flat.filter(f => typeof f === "string");
      if (strings.length) return strings;
    } catch { /* 落到下面的兜底 */ }
  }

  const f = e.file ?? e.files;
  if (typeof f === "string") return [f];
  // 走同一条数组分支：字符串数组是变体池，条目数组只取第一条
  if (Array.isArray(f)) return flattenEntry(f);
  // ft 键对象（`{"05ft": …, "30ft": …}`）：getAllFiles 不可用时的兜底。
  // 这里**必须**把各档摊平——调用方要的是「这个条目涉及哪些文件」，
  // 而带 ft 的查询根本走不到这个分支（getEntry 已在内部选好档）。
  if (f && typeof f === "object") return Object.values(f).flat(Infinity).filter(x => typeof x === "string");
  return [];
}

/** 条目自带的锚点模板（授权网格 px / 前导 px / 拖尾 px），拿不到就 null。 */
function templateOfEntry(e) {
  if (Array.isArray(e)) return templateOfEntry(e[0]);
  return (e && typeof e === "object" && Array.isArray(e.template)) ? e.template : null;
}

/**
 * 运行时后端。函数体内才触碰 Sequencer 全局，因此本模块在 Node 中导入无副作用。
 *
 * 注意 Sequencer 4.2.3 的真实行为：
 * - getEntry 的返回形态见 flattenEntry 的表
 * - getPathsUnder 未命中返回 false（会弹红色错误提示），不要试探拼错的命名空间
 * @returns {Backend}
 */
export function runtimeBackend() {
  return {
    getPathsUnder(path) {
      try {
        const r = Sequencer.Database.getPathsUnder(path); // foundry-global-ok
        return Array.isArray(r) ? r : [];
      } catch { return []; }
    },
    getEntry(path) {
      try {
        const e = Sequencer.Database.getEntry(path, {softFail: true}); // foundry-global-ok
        if (e === false || !e) return null;
        const files = flattenEntry(e);
        if (!files.length) return null;
        return {file: files.length === 1 ? files[0] : files, template: templateOfEntry(e)};
      } catch { return null; }
    }
  };
}

/* -------------------------------------------- */
/*  bestFit                                      */
/* -------------------------------------------- */

/**
 * 沿路径逐级下行，遇到不存在的一级就取同级第一个可用项。
 * @param {Backend} backend
 * @param {string} path  点分路径，如 "jb2a.melee_attack.01.shortsword"
 * @returns {{path: string, diverged: boolean, divergedAt: string|null, options: string[]}}
 */
export function bestFit(backend, path) {
  const parts = path.split(".");
  let current = parts.shift();
  let diverged = false;
  let divergedAt = null;
  let options = [];

  let available = backend.getPathsUnder(current);
  while (parts.length && available.length) {
    const want = parts[0];
    if (available.includes(want)) {
      current = `${current}.${parts.shift()}`;
    } else {
      if (!diverged) { diverged = true; divergedAt = current; options = available.slice(); }
      current = `${current}.${available[0]}`;
      parts.shift();
    }
    available = backend.getPathsUnder(current);
  }
  return {path: current, diverged, divergedAt, options};
}

/* -------------------------------------------- */
/*  对外门面                                     */
/* -------------------------------------------- */

/**
 * @param {Backend} backend
 * @returns {{resolve: Function, colorsUnder: Function, warnings: object[]}}
 */
export function createAssets(backend) {
  const warnings = [];

  function resolve(path) {
    if (!path) return null;
    // 直接文件路径（含斜杠或 http）不走数据库
    if (path.includes("/")) {
      return {path, file: path, files: [path], template: null, diverged: false};
    }

    /*
     * 快路径：先按完整路径试一次，命中就不走 bestFit 的逐级下行。
     *
     * 两个理由，都是上机实测出来的（2026-08-23）：
     *
     * 1. **消除 Sequencer 的弃用警告刷屏。** bestFit 的第一步是
     *    `getPathsUnder(裸命名空间)`，而 Sequencer 的 `entryExists`
     *    （`sequencer.js:6709`）用的是 `flattenedEntries.find(e => e.startsWith(inString))`
     *    ——查 `"jb2a"` 会先命中 `"jb2a-extras.magic_signs..."`（`-` 的 ASCII 小于 `_`，
     *    jb2a-extras 先注册），于是每次解析都打一条
     *    「matched via partial segment prefix … will be removed in a future version」。
     *    带点的完整路径不会触发这条（`match === inString` 或 `match.startsWith(inString + ".")`）。
     *
     * 2. **省掉 N 次全库扫描。** 每级 `getPathsUnder` 都要过一遍 `flattenedEntries`
     *    并做三次 map + 去重。一条七段路径就是七次全库扫描，而兵库里绝大多数路径是精确的。
     *
     * 语义不变：精确命中 ⟹ 本来 bestFit 也不会 diverge，两条路的结果逐字段相同；
     * 没命中才落到下面的降级walk，divergence 警告照旧。
     */
    const exact = backend.getEntry(path);
    if (exact) {
      const files = Array.isArray(exact.file) ? exact.file : [exact.file];
      return {path, file: files[0], files, template: exact.template ?? null, diverged: false};
    }

    const fit = bestFit(backend, path);
    const entry = backend.getEntry(fit.path);
    if (!entry) return null;
    if (fit.diverged) {
      warnings.push({requested: path, resolved: fit.path, at: fit.divergedAt});
    }
    const files = Array.isArray(entry.file) ? entry.file : [entry.file];
    return {
      path: fit.path, file: files[0], files,
      template: entry.template ?? null, diverged: fit.diverged
    };
  }

  function colorsUnder(path) {
    return backend.getPathsUnder(path);
  }

  return {resolve, colorsUnder, warnings};
}
