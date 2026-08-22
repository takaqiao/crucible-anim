/**
 * 离线提取各素材模组注册进 Sequencer 的数据库树。
 *
 * 做法：造一个够用的 Foundry 全局桩，import 模组的入口脚本，捕获它注册的钩子，
 * 按 Foundry 的真实顺序逐个触发，拦截 Sequencer.Database.registerEntries 的入参。
 * 得到的树与游戏内 Sequencer 构建的完全一致。
 *
 * 用法： node tools/extract-db.mjs [--data <Foundry Data>]
 */
import {readFileSync, writeFileSync, existsSync} from "node:fs";
import {join, dirname} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {FOUNDRY_DATA} from "./paths.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const argData = process.argv.indexOf("--data");
const DATA = argData > -1 ? process.argv[argData + 1] : FOUNDRY_DATA;
const MODULES = join(DATA, "modules");

/** 提取顺序即优先级：先提取的占位，后提取的只补空缺（见 mergeTree）。 */
const TARGETS = [
  "jb2a_patreon", "JB2A_DnD5e", "jb2a-extras", "eskie-effects",
  "blfx-assets-pack01", "psfx-patreon", "animated-spell-effects-cartoon",
  // 两个已注册 Sequencer DB 但从未进过索引的库（V2 线 0.1）：
  //   ggg    → ggg-sfx 3049 条战斗音效 / ggg-vfx 49 条 basis 精灵表（后者不用，见 V2-PLAN D5）
  //   jaamod → 34 个具名状态的 token 循环，状态层的现成素材
  "ggg", "jaamod"
];

/** 免费版与付费版互斥；提取一方时另一方必须视为未激活，否则注册守卫会跳过。 */
const RIVALS = {
  "jb2a_patreon": "JB2A_DnD5e", "JB2A_DnD5e": "jb2a_patreon",
  "boss-loot-assets-premium": "boss-loot-assets-free",
  "boss-loot-assets-free": "boss-loot-assets-premium",
  "psfx-patreon": "psfx", "psfx": "psfx-patreon",
  "eskie-effects": "eskie-effects-free", "eskie-effects-free": "eskie-effects"
};

/** Foundry 钩子的真实触发顺序；剩余未列出的钩子在最后兜底触发。 */
const HOOK_ORDER = ["init", "i18nInit", "setup", "sequencerReady", "sequencer.ready",
                    "ready", "canvasReady"];

function installStubs(moduleId) {
  const inactive = new Set([RIVALS[moduleId]].filter(Boolean));
  const captured = [];
  const hooks = [];
  const settingDefaults = new Map();
  const modReg = new Map();

  globalThis.Hooks = {
    once: (n, f) => { if (typeof f === "function") hooks.push([n, f]); },
    on: (n, f) => { if (typeof f === "function") hooks.push([n, f]); },
    call: () => true, callAll: () => true, off: () => {}
  };
  globalThis.Sequencer = {
    Database: {
      registerEntries: (ns, tree) => { captured.push({ns, tree}); return true; },
      getPathsUnder: () => [], getEntry: () => null
    },
    BaseEffectElement: class {}
  };
  globalThis.game = {
    settings: {
      register: (ns, key, cfg) => settingDefaults.set(`${ns}.${key}`, cfg?.default),
      registerMenu: () => {}, set: () => {},
      get: (ns, key) => {
        const k = `${ns}.${key}`;
        const d = settingDefaults.get(k);
        if (d !== undefined && d !== "") return d;
        return /path|location/i.test(key) ? "modules" : undefined;
      }
    },
    modules: {
      get(k) {
        if (!modReg.has(k)) {
          modReg.set(k, {id: k, active: !inactive.has(k), version: "99.0.0", api: {}, flags: {}});
        }
        return modReg.get(k);
      },
      has: () => true, set: (k, v) => modReg.set(k, v),
      values: () => modReg.values(), keys: () => modReg.keys(),
      entries: () => modReg.entries(), forEach: f => modReg.forEach(f),
      get size() { return modReg.size; },
      [Symbol.iterator]() { return modReg[Symbol.iterator](); }
    },
    packs: new Map(), i18n: {localize: s => s, format: s => s, has: () => false},
    user: {isGM: true}, users: {activeGM: null}, system: {id: "crucible"},
    version: "14.366", keybindings: {register: () => {}}, socket: {on: () => {}, emit: () => {}}
  };
  globalThis.ui = {notifications: {warn: () => {}, error: () => {}, info: () => {}}};
  globalThis.CONFIG = {};
  globalThis.CONST = {TEXT_ANCHOR_POINTS: {}, GRID_SNAPPING_MODES: {}};
  globalThis.Ray = class { constructor(a, b) { this.A = a; this.B = b; } };
  globalThis.PIXI = {
    Sprite: class {}, Container: class {}, Rectangle: class {},
    Texture: {from: () => ({})}, filters: {}
  };
  globalThis.canvas = {
    grid: {size: 100}, scene: null, tokens: {placeables: []},
    templates: {placeables: []}, dimensions: {size: 100, distancePixels: 1}
  };
  globalThis.foundry = {
    utils: {
      mergeObject: (a, b) => Object.assign({}, a, b),
      deepClone: o => structuredClone(o),
      getProperty: () => undefined, setProperty: () => {}, randomID: () => "x",
      isNewerVersion: (a, b) => {
        const p = v => String(v ?? "0").split(".").map(n => parseInt(n, 10) || 0);
        const [x, y] = [p(a), p(b)];
        for (let i = 0; i < Math.max(x.length, y.length); i++) {
          const d = (x[i] || 0) - (y[i] || 0);
          if (d) return d > 0;
        }
        return false;
      }
    },
    applications: {api: {ApplicationV2: class {}, HandlebarsApplicationMixin: c => c}}
  };
  const Stub = class {
    static registerSheet() {} static get defaultOptions() { return {}; }
    render() {} close() {}
  };
  for (const g of ["FormApplication", "Application", "ApplicationV2", "ChatMessage", "Dialog",
                   "DialogV2", "FilePicker", "Actor", "Item", "Token", "TokenDocument",
                   "Scene", "Macro", "Folder", "SettingsConfig", "JournalEntry",
                   "FormDataExtended"]) {
    globalThis[g] = Stub;
  }
  return {captured, hooks};
}

export async function extract(moduleId) {
  const manifestPath = join(MODULES, moduleId, "module.json");
  if (!existsSync(manifestPath)) return {error: "模组未安装"};
  const mj = JSON.parse(readFileSync(manifestPath, "utf8"));
  const entries = [...(mj.esmodules ?? []), ...(mj.scripts ?? [])];
  const {captured, hooks} = installStubs(moduleId);
  let firstError = null;

  for (const e of entries) {
    // Windows 下裸绝对路径不是合法 ESM 说明符，必须转 file:// URL
    try { await import(pathToFileURL(join(MODULES, moduleId, e.replace(/^\.\//, ""))).href); }
    catch (x) { firstError ??= x.message.slice(0, 120); }
  }
  const fired = new Set();
  const fire = async (name, fn) => {
    try { await fn(); } catch (x) { firstError ??= `${name}: ${x.message.slice(0, 100)}`; }
  };
  for (const phase of HOOK_ORDER) {
    for (const h of hooks) if (h[0] === phase) { fired.add(h); await fire(h[0], h[1]); }
  }
  for (const h of hooks) if (!fired.has(h)) await fire(h[0], h[1]);

  if (!captured.length) return {error: firstError ?? "未注册任何条目"};
  return {captured};
}

/** 深合并：已存在的分支不覆盖，只补空缺。先提取的模组因此优先。 */
function mergeTree(dst, src) {
  for (const [k, v] of Object.entries(src)) {
    if (!(k in dst)) { dst[k] = v; continue; }
    if (v && typeof v === "object" && !Array.isArray(v)
        && dst[k] && typeof dst[k] === "object" && !Array.isArray(dst[k])) {
      mergeTree(dst[k], v);
    }
  }
}

function countLeaves(node) {
  let n = 0;
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith("_")) continue;
    if (typeof v === "string" || Array.isArray(v)) n++;
    else if (v && typeof v === "object") n += countLeaves(v);
  }
  return n;
}

/**
 * 逐条核实叶子指向的文件真的在盘上，返回死链的点分路径清单。
 *
 * 死链是**上游厂商的 bug**，不是我们的：ggg-vfx 的 magic.buff.general.01.* 三条指向
 * buff_a/b/c.json 而磁盘上是 buff_2a/2b/2c.json；jaamod 的 condition.rings 整支 38 条
 * 只有 webp 缩略图没有 webm。它们在 DB 里可寻址、解析不报错，只会静默降级成「没动画」——
 * 正是本项目第 3 类失败模式（假成功）。所以把清单落进索引，由守卫挡住兵库引用它们。
 */
function scanDeadLinks(tree, dataDir) {
  const dead = [];
  const walk = (node, path) => {
    for (const [k, v] of Object.entries(node)) {
      if (k.startsWith("_")) continue;
      const p = path ? `${path}.${k}` : k;
      if (typeof v === "string") {
        if (!existsSync(join(dataDir, decodeURI(v)))) dead.push(p);
      } else if (Array.isArray(v)) {
        // 数组成员逐个核；只要有一个缺，整条路径就不可靠（ctx.pick 会随机取到它）
        v.forEach((f, i) => {
          if (typeof f === "string" && !existsSync(join(dataDir, decodeURI(f)))) dead.push(`${p}[${i}]`);
        });
      } else if (v && typeof v === "object") walk(v, p);
    }
  };
  for (const [ns, node] of Object.entries(tree)) walk(node, ns);
  return dead;
}

/** 直跑守卫：只有脚本被直接执行（而非被测试 import）时才跑整轮提取。 */
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;

if (isMain) {
  const out = {generated: new Date().toISOString().slice(0, 10), modules: {}, failed: {}, tree: {}};

  for (const id of TARGETS) {
    const r = await extract(id);
    if (r.error) { out.failed[id] = r.error; console.log(`✗ ${id.padEnd(32)} ${r.error}`); continue; }
    for (const {ns, tree} of r.captured) {
      out.tree[ns] ??= {};
      mergeTree(out.tree[ns], tree);
      const n = countLeaves(tree);
      out.modules[id] = {namespace: ns, leaves: n};
      console.log(`✓ ${id.padEnd(32)} ${ns.padEnd(32)} ${n}`);
    }
  }

  for (const ns of Object.keys(out.tree)) {
    console.log(`  合并后 ${ns}: ${countLeaves(out.tree[ns])} 叶子`);
  }
  // 裸路径来源（MGS / soundfxlibrary）由 tools/index-sfx.mjs 单独生成，在这里并进
  // 同一棵树——离线侧只有 data/asset-index.json 一个索引，测试与守卫不必知道有两份。
  // 运行时走另一条路：main.mjs 把 sfx-index.json 直接 registerEntries 进 Sequencer。
  const sfxPath = join(ROOT, "data/sfx-index.json");
  if (existsSync(sfxPath)) {
    const sfx = JSON.parse(readFileSync(sfxPath, "utf8"));
    for (const [ns, tree] of Object.entries(sfx.tree ?? {})) {
      out.tree[ns] ??= {};
      mergeTree(out.tree[ns], tree);
      console.log(`✓ ${"(sfx-index)".padEnd(32)} ${ns.padEnd(32)} ${countLeaves(tree)}`);
    }
  } else {
    console.log("  ⚠ data/sfx-index.json 不存在——先跑 node tools/index-sfx.mjs");
  }

  out.deadLinks = scanDeadLinks(out.tree, DATA);
  if (out.deadLinks.length) {
    const byNs = {};
    for (const p of out.deadLinks) { const ns = p.split(".")[0]; byNs[ns] = (byNs[ns] ?? 0) + 1; }
    console.log(`  死链 ${out.deadLinks.length} 条：` +
      Object.entries(byNs).map(([n, c]) => `${n} ${c}`).join("  "));
  }
  writeFileSync(join(ROOT, "data/asset-index.json"), JSON.stringify(out));
  console.log(`已写入 data/asset-index.json`);
}
