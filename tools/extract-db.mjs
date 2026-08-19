/**
 * 离线提取各素材模组注册进 Sequencer 的数据库树。
 *
 * 做法：造一个够用的 Foundry 全局桩，import 模组的入口脚本，捕获它注册的钩子，
 * 按 Foundry 的真实顺序逐个触发，拦截 Sequencer.Database.registerEntries 的入参。
 * 得到的树与游戏内 Sequencer 构建的完全一致。
 *
 * 用法： node tools/extract-db.mjs [--data /root/fvtt14-data/Data]
 */
import {readFileSync, writeFileSync, existsSync} from "node:fs";
import {join, dirname} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const argData = process.argv.indexOf("--data");
const DATA = argData > -1 ? process.argv[argData + 1] : "/root/fvtt14-data/Data";
const MODULES = join(DATA, "modules");

/** 提取顺序即优先级：先提取的占位，后提取的只补空缺（见 mergeTree）。 */
const TARGETS = [
  "jb2a_patreon", "JB2A_DnD5e", "jb2a-extras", "eskie-effects",
  "blfx-assets-pack01", "psfx-patreon", "animated-spell-effects-cartoon"
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
    try { await import(join(MODULES, moduleId, e.replace(/^\.\//, ""))); }
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
  writeFileSync(join(ROOT, "data/asset-index.json"), JSON.stringify(out));
  console.log(`已写入 data/asset-index.json`);
}
