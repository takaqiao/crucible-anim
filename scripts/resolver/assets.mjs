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
 * 运行时后端。函数体内才触碰 Sequencer 全局，因此本模块在 Node 中导入无副作用。
 * @returns {Backend}
 */
export function runtimeBackend() {
  return {
    getPathsUnder(path) {
      try { return Sequencer.Database.getPathsUnder(path) ?? []; } // foundry-global-ok
      catch { return []; }
    },
    getEntry(path) {
      try {
        const e = Sequencer.Database.getEntry(path, {softFail: true}); // foundry-global-ok
        if (!e) return null;
        const file = typeof e === "string" ? e : (e.file ?? e.files ?? null);
        if (!file) return null;
        return {file, template: e.template ?? null};
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
