# crucible-anim V1 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Crucible 0.10.2 补齐其原生 VFX 未覆盖的动作、法术与状态动画，用一套标签驱动的通用兵库覆盖 218 个天赋动作、11 个缺失姿态、8 个缺失符文与 47 种状态。

**Architecture:** 包装 `CrucibleAction#configureVFXEffect`，在原生链返回 `null`（即系统对该动作无动画）时接管；把动画计划写入 `action.metadata.cav`，随聊天卡广播；各客户端在 `updateChatMessage` 且 `confirmed` 翻真时用 Sequencer 本地播放。解析层是纯函数（`ActionSnapshot → FXPlan`），不引用任何 Foundry 全局，因此可在 Node 中直测。

**Tech Stack:** Foundry VTT v14.366 / Crucible 0.10.2 / Sequencer 4.2.3 / 纯 ESM 无构建 / `node --test` / `classic-level`（仅工具与测试）/ ffmpeg（仅识图）

**Spec:** `/root/crucible-anim/docs/DESIGN.md`

## Global Constraints

- 模组 id 固定 `crucible-anim`；`action.metadata` 命名空间固定单键 `cav`
- 目标环境：Foundry v14.366、Crucible 0.10.2、Sequencer ≥ 4.2；`compatibility.minimum: "14"`
- 纯 ESM，无构建步骤，无打包器。`scripts/` 下所有文件可被浏览器直接 `import`
- `scripts/resolver/**` 与 `scripts/armory/**` **禁止**引用 `game` / `canvas` / `Hooks` / `Sequencer` / `foundry` 等 Foundry 全局，也禁止 `import` `scripts/trigger/**` 或 `scripts/player/**`。这是 headless 可测性的硬约束
- 随机性一律经 `ctx.rng()`（由 `snapshot.seed` 驱动），禁止直接 `Math.random()`
- 兵库规则中禁止出现绝对文件路径，一律经 `ctx.pick()`
- 所有 Sequencer 序列使用 `new Sequence({moduleName: "crucible-anim", softFail: true})`
- 播放前必须同时满足：`game.settings.get("crucible", "enableVFX")` 与 `game.settings.get("crucible-anim", "enabled")`
- 用户偏好：commit message 只写标题行，不写正文，不出现 AI/Claude 字样
- 计划文档位置沿用同仓库既有约定 `docs/IMPLEMENTATION-PLAN.md`（与 `/root/leak-doctor` 一致），不用 skill 默认路径

## 起始状态

仓库 `/root/crucible-anim` 已存在，含：

- `.git`（已有一次提交：设计文档）
- `docs/DESIGN.md`
- `docs/_harness-verified.mjs`：**已实测通过**的 Sequencer DB 提取沙箱原型，Task 2 以它为基础
- `package.json`（`npm init -y` 自动生成的草稿，Task 1 覆盖）、`package-lock.json`、`node_modules/`（已装 `classic-level@^3.0.0`）
- 空目录：`scripts/{trigger,resolver,armory,player}`、`tools`、`test/fixtures`、`data`、`lang`

## File Structure

| 文件 | 职责 |
| --- | --- |
| `module.json` | 模组清单 |
| `scripts/const.mjs` | 模组 id、槽位名、`RESULT_TYPES` 镜像、色表键；无依赖 |
| `scripts/log.mjs` | 统一日志与 debug 开关读取 |
| `scripts/settings.mjs` | 5 个设置项注册 |
| `scripts/main.mjs` | init/setup/ready 挂载与自检 |
| `scripts/trigger/snapshot.mjs` | `CrucibleAction`/`ActiveEffect` → 纯数据快照；导出可单测的几何函数 |
| `scripts/trigger/wrap.mjs` | `configureVFXEffect` 原型包装 |
| `scripts/trigger/dispatch.mjs` | `updateChatMessage` → 播放 |
| `scripts/trigger/effects.mjs` | ActiveEffect 增删 → persist 槽 |
| `scripts/resolver/assets.mjs` | `bestFit` 降级解析；离线/运行时双后端 |
| `scripts/resolver/palette.mjs` | 符文与伤害类型色表、色相差计算 |
| `scripts/resolver/context.mjs` | `ctx` 能力袋（pick/sound/rng/geom/warn） |
| `scripts/resolver/resolve.mjs` | 五槽装配与优先级 |
| `scripts/armory/index.mjs` | 汇总五槽规则表 |
| `scripts/armory/{cast,travel,impact,aftermath,persist}.mjs` | 各槽规则 |
| `scripts/player/semaphore.mjs` | 并发串行化 |
| `scripts/player/play.mjs` | `FXPlan` → Sequencer |
| `scripts/player/preview.mjs` | `/canim-preview` 预览宏 |
| `tools/extract-db.mjs` | 素材模组 → `data/asset-index.json` |
| `tools/dump-fixtures.mjs` | leveldb + 法术矩阵 → `test/fixtures/*.json` |
| `tools/contact-sheet.sh` | webm → 抽帧拼图 |
| `docs/ASSET-NOTES.md` | 识图记录 |
| `lang/{zh-CN,en}.json` | 本地化 |

依赖方向：`trigger → resolver → armory`，`player → resolver`，`resolver`/`armory` 无出边。

---

## Task 1: 模组骨架、设置项与自检

**Files:**
- Create: `module.json`, `.gitignore`, `scripts/const.mjs`, `scripts/log.mjs`, `scripts/settings.mjs`, `scripts/main.mjs`, `lang/en.json`, `lang/zh-CN.json`
- Modify: `package.json`（覆盖草稿）
- Test: `test/manifest.test.mjs`

**Interfaces:**
- Consumes: 无
- Produces:
  - `const.mjs`: `MODULE_ID: "crucible-anim"`、`META_KEY: "cav"`、`PLAN_VERSION: 1`、`SLOTS: readonly string[]`、`RESULT: {MISS:0,DODGE:1,PARRY:2,BLOCK:3,ARMOR:4,RESIST:5,GLANCE:6,HIT:7}`、`SETTINGS: {ENABLED:"enabled",DENSITY:"density",VOLUME:"volume",SHAKE:"shake",DEBUG:"debug"}`
  - `log.mjs`: `log(...args)`、`warn(...args)`、`error(...args)`、`debug(...args)`
  - `settings.mjs`: `registerSettings()`、`getSetting(key)`
  - `main.mjs`: 无导出，副作用挂载

- [ ] **Step 1: 写失败测试**

`test/manifest.test.mjs`：

```js
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync, existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

test("module.json 字段完整且与常量一致", async () => {
  const mj = JSON.parse(readFileSync(join(ROOT, "module.json"), "utf8"));
  const {MODULE_ID} = await import("../scripts/const.mjs");
  assert.equal(mj.id, MODULE_ID);
  assert.equal(mj.compatibility.minimum, "14");
  assert.equal(mj.compatibility.verified, "14.366");
  assert.deepEqual(mj.esmodules, ["scripts/main.mjs"]);
  const reqIds = mj.relationships.requires.map(r => r.id);
  assert.ok(reqIds.includes("sequencer"), "必须声明 sequencer 依赖");
  assert.equal(mj.relationships.systems[0].id, "crucible");
});

test("清单引用的每个文件都存在", () => {
  const mj = JSON.parse(readFileSync(join(ROOT, "module.json"), "utf8"));
  for (const f of [...mj.esmodules, ...mj.languages.map(l => l.path)]) {
    assert.ok(existsSync(join(ROOT, f)), `缺文件 ${f}`);
  }
});

test("两份语言文件键集合完全一致", () => {
  const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === "object" ? flat(v, `${p}${k}.`) : [`${p}${k}`]);
  const en = flat(JSON.parse(readFileSync(join(ROOT, "lang/en.json"), "utf8")));
  const zh = flat(JSON.parse(readFileSync(join(ROOT, "lang/zh-CN.json"), "utf8")));
  assert.deepEqual(en.sort(), zh.sort());
});

test("常量自洽", async () => {
  const C = await import("../scripts/const.mjs");
  assert.deepEqual([...C.SLOTS], ["cast", "travel", "impact", "aftermath", "persist"]);
  assert.equal(C.RESULT.HIT, 7);
  assert.equal(C.RESULT.MISS, 0);
  assert.equal(Object.keys(C.RESULT).length, 8);
  assert.equal(C.META_KEY, "cav");
});

test("resolver 与 armory 不得引用 Foundry 全局", async () => {
  const {globSync} = await import("node:fs");
  const files = globSync("scripts/{resolver,armory}/**/*.mjs", {cwd: ROOT});
  const banned = /\b(game|canvas|Hooks|Sequencer|ui|CONFIG)\s*\./;
  for (const f of files) {
    const src = readFileSync(join(ROOT, f), "utf8")
      .split("\n").filter(l => !l.trimStart().startsWith("//")).join("\n");
    assert.ok(!banned.test(src), `${f} 引用了 Foundry 全局`);
  }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /root/crucible-anim && node --test test/`
Expected: FAIL — `ENOENT: module.json`

- [ ] **Step 3: 写 `package.json` 与 `.gitignore`**

`package.json`（覆盖 `npm init -y` 的草稿）：

```json
{
  "name": "crucible-anim",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "description": "Crucible 系统动画补齐模组的开发工具与测试",
  "scripts": {
    "test": "node --test test/",
    "index": "node tools/extract-db.mjs",
    "fixtures": "node tools/dump-fixtures.mjs"
  },
  "devDependencies": {
    "classic-level": "^3.0.0"
  }
}
```

`.gitignore`：

```
node_modules/
*.log
scratch/
```

`data/asset-index.json` 与 `test/fixtures/*.json` **要提交**（测试依赖它们），不要加进 `.gitignore`。

- [ ] **Step 4: 写 `module.json`**

```json
{
  "id": "crucible-anim",
  "title": "Crucible 动画补齐",
  "description": "为 Crucible 系统补齐原生 VFX 未覆盖的动作、法术与状态动画。",
  "version": "0.1.0",
  "compatibility": {"minimum": "14", "verified": "14.366"},
  "authors": [{"name": "gaoqiao"}],
  "esmodules": ["scripts/main.mjs"],
  "languages": [
    {"lang": "en", "name": "English", "path": "lang/en.json"},
    {"lang": "zh-CN", "name": "中文（简体）", "path": "lang/zh-CN.json"}
  ],
  "relationships": {
    "systems": [
      {"id": "crucible", "type": "system", "compatibility": {"minimum": "0.10.2"}}
    ],
    "requires": [
      {"id": "sequencer", "type": "module", "compatibility": {"minimum": "4.2"}}
    ]
  },
  "socket": false
}
```

- [ ] **Step 5: 写 `scripts/const.mjs`**

```js
/** 模组标识，与 module.json 的 id 必须一致。 */
export const MODULE_ID = "crucible-anim";

/** 写入 action.metadata 的唯一键，避免与系统自用的 metadata 字段撞名。 */
export const META_KEY = "cav";

/** FXPlan 结构版本；结构不兼容变更时递增，播放端据此拒绝旧计划。 */
export const PLAN_VERSION = 1;

/** 五个动画槽位，顺序即时间顺序（persist 独立于动作，排在最后）。 */
export const SLOTS = Object.freeze(["cast", "travel", "impact", "aftermath", "persist"]);

/** crucible.api.dice.AttackRoll.RESULT_TYPES 的镜像，供纯函数层使用而不依赖运行时。 */
export const RESULT = Object.freeze({
  MISS: 0, DODGE: 1, PARRY: 2, BLOCK: 3, ARMOR: 4, RESIST: 5, GLANCE: 6, HIT: 7
});

/** 结果码 → playIf 词汇。 */
export const RESULT_NAME = Object.freeze({
  0: "miss", 1: "dodge", 2: "parry", 3: "block", 4: "armor", 5: "resist", 6: "glance", 7: "hit"
});

/** 命中类结果：只有这两种会叠加元素层（见 DESIGN.md §6.5）。 */
export const HIT_RESULTS = Object.freeze([RESULT.GLANCE, RESULT.HIT]);

/** 设置项键名。 */
export const SETTINGS = Object.freeze({
  ENABLED: "enabled", DENSITY: "density", VOLUME: "volume", SHAKE: "shake", DEBUG: "debug"
});
```

- [ ] **Step 6: 写 `scripts/log.mjs`**

```js
import {MODULE_ID, SETTINGS} from "./const.mjs";

const PREFIX = `${MODULE_ID} |`;

/** debug 设置尚未注册时读取会抛错，因此吞掉异常并视为关闭。 */
function debugEnabled() {
  try { return game.settings.get(MODULE_ID, SETTINGS.DEBUG) === true; }
  catch { return false; }
}

export function log(...args) { console.log(PREFIX, ...args); }
export function warn(...args) { console.warn(PREFIX, ...args); }
export function error(...args) { console.error(PREFIX, ...args); }
export function debug(...args) { if (debugEnabled()) console.debug(PREFIX, ...args); }
```

- [ ] **Step 7: 写 `scripts/settings.mjs`**

```js
import {MODULE_ID, SETTINGS} from "./const.mjs";

export function registerSettings() {
  const S = game.settings;
  S.register(MODULE_ID, SETTINGS.ENABLED, {
    name: "CANIM.Settings.Enabled.Name", hint: "CANIM.Settings.Enabled.Hint",
    scope: "world", config: true, type: Boolean, default: true, requiresReload: false
  });
  S.register(MODULE_ID, SETTINGS.DENSITY, {
    name: "CANIM.Settings.Density.Name", hint: "CANIM.Settings.Density.Hint",
    scope: "world", config: true, type: String, default: "standard",
    choices: {
      minimal: "CANIM.Settings.Density.Minimal",
      standard: "CANIM.Settings.Density.Standard",
      full: "CANIM.Settings.Density.Full"
    }
  });
  S.register(MODULE_ID, SETTINGS.VOLUME, {
    name: "CANIM.Settings.Volume.Name", hint: "CANIM.Settings.Volume.Hint",
    scope: "world", config: true, type: Number, default: 0.7,
    range: {min: 0, max: 1, step: 0.05}
  });
  S.register(MODULE_ID, SETTINGS.SHAKE, {
    name: "CANIM.Settings.Shake.Name", hint: "CANIM.Settings.Shake.Hint",
    scope: "world", config: true, type: Boolean, default: true
  });
  S.register(MODULE_ID, SETTINGS.DEBUG, {
    name: "CANIM.Settings.Debug.Name", hint: "CANIM.Settings.Debug.Hint",
    scope: "world", config: true, type: Boolean, default: false
  });
}

export function getSetting(key) {
  return game.settings.get(MODULE_ID, key);
}
```

- [ ] **Step 8: 写 `scripts/main.mjs`**

自检的意义：Crucible 0.10.2 迭代快，包装点消失时必须自我禁用而不是静默失效或炸掉出手。

```js
import {MODULE_ID} from "./const.mjs";
import {registerSettings} from "./settings.mjs";
import {log, warn, error} from "./log.mjs";

/** 模组运行时状态；自检失败时 active 置 false，所有钩子提前返回。 */
export const state = {active: false, reason: null};

/**
 * 确认本模组赖以工作的两个外部接触点仍然存在。
 * @returns {string|null}  失败原因，通过则 null
 */
function selfCheck() {
  const Action = globalThis.crucible?.api?.models?.CrucibleAction;
  if (!Action) return "crucible.api.models.CrucibleAction 不可用";
  if (typeof Action.prototype.configureVFXEffect !== "function") {
    return "CrucibleAction#configureVFXEffect 不存在（系统结构已变）";
  }
  if (!globalThis.Sequencer?.Database) return "Sequencer 未加载";
  return null;
}

Hooks.once("init", () => {
  registerSettings();
  log("设置项已注册");
});

Hooks.once("ready", () => {
  const reason = selfCheck();
  if (reason) {
    state.reason = reason;
    error(`自检失败，模组已自我禁用：${reason}`);
    if (game.user.isGM) {
      ui.notifications.error(game.i18n.format("CANIM.SelfCheckFailed", {reason}));
    }
    return;
  }
  state.active = true;
  log("自检通过");

  const assetModules = ["jb2a_patreon", "eskie-effects", "blfx-assets-pack01", "psfx-patreon"];
  const missing = assetModules.filter(id => !game.modules.get(id)?.active);
  if (missing.length) warn(`以下素材模组未激活，相关动画将降级：${missing.join(", ")}`);
});
```

- [ ] **Step 9: 写两份语言文件**

`lang/en.json`：

```json
{
  "CANIM": {
    "SelfCheckFailed": "Crucible Anim disabled itself: {reason}",
    "Settings": {
      "Enabled": {"Name": "Enable animations", "Hint": "Master switch. Crucible's own \"Enable VFX\" setting is always respected as well."},
      "Density": {
        "Name": "Animation density", "Hint": "How many actions receive animations.",
        "Minimal": "Minimal — attacks and spells only",
        "Standard": "Standard — restrained, matches Crucible's own style",
        "Full": "Full — every action (not implemented in V1)"
      },
      "Volume": {"Name": "Sound volume", "Hint": "Volume for sounds played by this module."},
      "Shake": {"Name": "Impact shake", "Hint": "Shake the target sprite on critical hits."},
      "Debug": {"Name": "Debug logging", "Hint": "Print action snapshots, resolved plans and asset fallback warnings to the console."}
    },
    "Replay": "Replay animation",
    "Preview": {"Title": "Animation preview", "NoToken": "Select a token first."}
  }
}
```

`lang/zh-CN.json`：

```json
{
  "CANIM": {
    "SelfCheckFailed": "Crucible 动画补齐已自我禁用：{reason}",
    "Settings": {
      "Enabled": {"Name": "启用动画", "Hint": "总开关。Crucible 自带的「启用 VFX」设置始终同时生效。"},
      "Density": {
        "Name": "动画密度", "Hint": "有多少动作会播放动画。",
        "Minimal": "精简 — 仅攻击与法术",
        "Standard": "标准 — 克制，与 Crucible 原生风格一致",
        "Full": "饱满 — 每个动作都有（V1 未实现）"
      },
      "Volume": {"Name": "音效音量", "Hint": "本模组播放音效的音量。"},
      "Shake": {"Name": "受击抖动", "Hint": "暴击时抖动目标 sprite。"},
      "Debug": {"Name": "调试日志", "Hint": "在控制台打印动作快照、解析结果与素材降级警告。"}
    },
    "Replay": "重放动画",
    "Preview": {"Title": "动画预览", "NoToken": "请先选中一个 token。"}
  }
}
```

- [ ] **Step 10: 运行测试确认通过**

Run: `cd /root/crucible-anim && npm test`
Expected: 5 个测试全部 PASS

- [ ] **Step 11: 提交**

```bash
cd /root/crucible-anim
git add -A
git commit -m "模组骨架：清单、常量、设置项与自检"
```

---

## Task 2: 素材索引与识图工具

**Files:**
- Create: `tools/extract-db.mjs`, `tools/contact-sheet.sh`, `data/asset-index.json`（生成物）
- Delete: `docs/_harness-verified.mjs`（内容并入 `tools/extract-db.mjs`）
- Test: `test/asset-index.test.mjs`

**Interfaces:**
- Consumes: 无
- Produces: `data/asset-index.json`，结构为

```js
{
  generated: "2026-08-19",
  modules: {                     // 每个成功提取的素材模组
    "jb2a_patreon": {namespace: "jb2a", leaves: 10038}
  },
  failed: {"boss-loot-assets-premium": "FormDataExtended is not defined"},
  tree: {                        // 命名空间 → 该命名空间的完整 DB 子树
    "jb2a": { /* 原样保留 registerEntries 传入的树 */ }
  }
}
```

`tree` 直接保留原始形状（叶子是文件路径字符串或路径数组，`_template` / `_metadata` 原样保留），
这样 `resolver/assets.mjs` 的离线后端与运行时后端能共用同一套遍历逻辑。

**背景（已实测，不要重新摸索）：**

素材模组并不在 `init` 注册数据库，而是在 `sequencerReady` 或 `sequencer.ready`（带点）钩子上注册。
JB2A 还有免费/付费互斥守卫：`jb2a_patreon` 只在 `JB2A_DnD5e` **未激活**时注册。
blfx 资源包要求 `foundry.utils.isNewerVersion(coreVersion, "3.0")` 为真。
`soundfxlibrary` 用的是 `scripts` 而非 `esmodules`，且注册进 SoundBoard 而不是 Sequencer。

实测结果（沙箱原型见 `docs/_harness-verified.mjs`）：

| 模组 | 命名空间 | 叶子数 |
| --- | --- | --- |
| jb2a_patreon | `jb2a` | 10038 |
| JB2A_DnD5e | `jb2a` | 1687 |
| jb2a-extras | `jb2a-extras` | 135 |
| eskie-effects | `eskie` | 3236 |
| blfx-assets-pack01 | `blfx` | 1412 |
| psfx-patreon | `psfx` | 930 |
| animated-spell-effects-cartoon | `animated-spell-effects-cartoon` | 724 |
| boss-loot-assets-premium / free | — | 提取失败，非 Sequencer 资源库 |
| soundfxlibrary | — | 注册进 SoundBoard，非 Sequencer |

`jb2a_patreon` 与 `JB2A_DnD5e` 都注册到 `jb2a` 命名空间。提取时**以 Patreon 版为准**，
免费版只用于填补 Patreon 版没有的分支（合并时 Patreon 优先）。

- [ ] **Step 1: 写失败测试**

`test/asset-index.test.mjs`：

```js
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync, existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FOUNDRY_DATA = "/root/fvtt14-data/Data";
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));

/** 遍历 DB 子树，产出 [路径, 文件或文件数组]。 */
function* leaves(node, path = "") {
  for (const [k, v] of Object.entries(node)) {
    if (k === "_template" || k === "_metadata" || k === "_templates") continue;
    const p = path ? `${path}.${k}` : k;
    if (typeof v === "string" || Array.isArray(v)) yield [p, v];
    else if (v && typeof v === "object") yield* leaves(v, p);
  }
}

test("七个素材命名空间齐备", () => {
  for (const ns of ["jb2a", "jb2a-extras", "eskie", "blfx", "psfx",
                    "animated-spell-effects-cartoon"]) {
    assert.ok(index.tree[ns], `缺命名空间 ${ns}`);
  }
});

test("jb2a 叶子数达到 Patreon 版实测量级", () => {
  const n = [...leaves(index.tree.jb2a)].length;
  assert.ok(n >= 10038, `jb2a 只有 ${n} 个叶子，应 >= 10038`);
});

test("_template 元数据被保留", () => {
  const json = JSON.stringify(index.tree.jb2a);
  assert.ok(json.includes('"_template"'), "_template 丢失，stretchTo 锚点信息会缺");
});

test("抽样 200 个条目的文件在磁盘上真实存在", () => {
  const all = [...leaves(index.tree.jb2a)];
  const step = Math.floor(all.length / 200) || 1;
  const missing = [];
  for (let i = 0; i < all.length; i += step) {
    const v = all[i][1];
    const file = Array.isArray(v) ? v[0] : v;
    if (typeof file !== "string" || !file.endsWith(".webm")) continue;
    if (!existsSync(join(FOUNDRY_DATA, file))) missing.push(file);
  }
  assert.deepEqual(missing, [], `${missing.length} 个索引条目在磁盘上不存在`);
});

test("提取失败的模组被显式记录而非静默丢弃", () => {
  assert.ok(index.failed && typeof index.failed === "object");
  assert.ok(Object.keys(index.modules).length >= 6);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /root/crucible-anim && node --test test/asset-index.test.mjs`
Expected: FAIL — `ENOENT: data/asset-index.json`

- [ ] **Step 3: 写 `tools/extract-db.mjs`**

以 `docs/_harness-verified.mjs` 为基础，补上合并与落盘。

```js
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
import {fileURLToPath} from "node:url";

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

async function extract(moduleId) {
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
```

- [ ] **Step 4: 生成索引**

Run: `cd /root/crucible-anim && npm run index`
Expected: 7 行 `✓`，`boss-loot-*` 与 `soundfxlibrary` 不在 TARGETS 中所以不出现；
合并后 `jb2a` 叶子数 ≥ 10038（Patreon 10038 + 免费版补空缺）

- [ ] **Step 5: 写 `tools/contact-sheet.sh`**

```bash
#!/bin/bash
# 把一个 webm 均匀抽帧拼成一张联系表，用于判断动画的相位结构与锚点。
# JB2A 的透明区在默认解码器下呈黑色，亮色特效在黑底上可读性良好。
#
# 用法： tools/contact-sheet.sh <webm> <out.png> [cols] [rows]
set -euo pipefail
F="$1"; OUT="$2"; C="${3:-6}"; R="${4:-2}"; N=$((C * R))
TOT=$(ffprobe -v error -count_frames -select_streams v:0 \
      -show_entries stream=nb_read_frames -of csv=p=0 "$F")
STEP=$((TOT / N)); [ "$STEP" -lt 1 ] && STEP=1
ffmpeg -y -v error -i "$F" \
  -vf "select='not(mod(n\,$STEP))',scale=170:-1,\
drawtext=text='%{n}':x=4:y=4:fontsize=14:fontcolor=yellow,\
tile=${C}x${R}:padding=2:color=0x202020" \
  -frames:v 1 -vsync 0 "$OUT"
echo "$F  frames=$TOT step=$STEP -> $OUT"
```

- [ ] **Step 6: 验证识图工具**

```bash
cd /root/crucible-anim && chmod +x tools/contact-sheet.sh
tools/contact-sheet.sh \
  /root/fvtt14-data/Data/modules/jb2a_patreon/Library/Generic/Weapon_Attacks/Melee/Club01_01_Regular_Blue_800x600.webm \
  /tmp/sheet-check.png 6 2
```

Expected: 输出 `frames=66 step=5`，`/tmp/sheet-check.png` 生成。用 Read 工具查看该图，
应能看到「起手 → 挥砍弧光 → 命中闪爆 → 收招」四个相位。

- [ ] **Step 7: 运行测试确认通过**

Run: `cd /root/crucible-anim && node --test test/asset-index.test.mjs`
Expected: 5 个测试全部 PASS

- [ ] **Step 8: 清理并提交**

```bash
cd /root/crucible-anim
rm docs/_harness-verified.mjs
git add -A
git commit -m "素材索引提取器与识图工具"
```

---

## Task 3: bestFit 资源解析器（双后端）

**Files:**
- Create: `scripts/resolver/assets.mjs`
- Test: `test/assets.test.mjs`

**Interfaces:**
- Consumes: `data/asset-index.json`（Task 2）
- Produces:
  - `offlineBackend(index) -> Backend`
  - `runtimeBackend() -> Backend`
  - `Backend = {getPathsUnder(path: string): string[], getEntry(path: string): {file: string|string[], template: number[]|null}|null}`
  - `bestFit(backend, path: string) -> {path: string, diverged: boolean, divergedAt: string|null, options: string[]}`
  - `createAssets(backend) -> {resolve, colorsUnder, warnings}`
    - `resolve(path: string) -> {path, file: string, files: string[], template: number[]|null, diverged: boolean}|null`
    - `colorsUnder(path: string) -> string[]`
    - `warnings: Array<{requested: string, resolved: string, at: string|null}>`

`resolve()` 对变体数组返回 `files`（全部）与 `file`（`files[0]`）；调用方要随机取变体时
用 `ctx.rng()` 从 `files` 里选，**不在这里随机**，以保证本层是纯函数。

含 `/` 的输入视为直接文件路径，原样返回（学自 eskie 的 `closest()`）。

- [ ] **Step 1: 写失败测试**

`test/assets.test.mjs`：

```js
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, bestFit, createAssets} from "../scripts/resolver/assets.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const backend = offlineBackend(index);

test("精确路径直接命中，不降级", () => {
  const r = bestFit(backend, "jb2a.melee_attack.01.shortsword");
  assert.equal(r.path, "jb2a.melee_attack.01.shortsword");
  assert.equal(r.diverged, false);
});

test("不存在的分支降级到同级第一个可用项并记录位置", () => {
  const r = bestFit(backend, "jb2a.melee_attack.01.没有这种武器");
  assert.equal(r.diverged, true);
  assert.equal(r.divergedAt, "jb2a.melee_attack.01");
  assert.ok(r.path.startsWith("jb2a.melee_attack.01."));
  assert.ok(r.options.length > 0, "应报告降级处的可选项");
});

test("resolve 返回真实文件路径", () => {
  const a = createAssets(backend);
  const r = a.resolve("jb2a.melee_attack.01.shortsword");
  assert.ok(r, "应解析出结果");
  assert.ok(r.file.endsWith(".webm"), `不是 webm: ${r.file}`);
  assert.ok(Array.isArray(r.files) && r.files.length >= 1);
});

test("_template 元数据随解析结果一并返回", () => {
  const a = createAssets(backend);
  const r = a.resolve("jb2a.melee_attack.01.shortsword");
  assert.ok(Array.isArray(r.template), "melee 分支应带 _template 三元组");
  assert.equal(r.template.length, 3);
});

test("含斜杠的输入按直接文件路径原样返回", () => {
  const a = createAssets(backend);
  const p = "modules/jb2a_patreon/Library/Generic/Impact/Foo.webm";
  const r = a.resolve(p);
  assert.equal(r.file, p);
  assert.equal(r.diverged, false);
});

test("colorsUnder 列出某特效实际可用的颜色", () => {
  const a = createAssets(backend);
  const colors = a.colorsUnder("jb2a.melee_attack.01.magic_sword");
  assert.ok(colors.includes("blue"), `实际颜色: ${colors.join(",")}`);
  assert.ok(colors.includes("orange"));
});

test("降级会累积进 warnings", () => {
  const a = createAssets(backend);
  a.resolve("jb2a.melee_attack.01.没有这种武器");
  assert.equal(a.warnings.length, 1);
  assert.equal(a.warnings[0].at, "jb2a.melee_attack.01");
});

test("解析不出任何东西时返回 null 而不抛错", () => {
  const a = createAssets(backend);
  assert.equal(a.resolve("完全不存在的命名空间.foo"), null);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/assets.test.mjs`
Expected: FAIL — `Cannot find module '../scripts/resolver/assets.mjs'`

- [ ] **Step 3: 写 `scripts/resolver/assets.mjs`**

```js
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
      try { return Sequencer.Database.getPathsUnder(path) ?? []; }
      catch { return []; }
    },
    getEntry(path) {
      try {
        const e = Sequencer.Database.getEntry(path, {softFail: true});
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /root/crucible-anim && node --test test/assets.test.mjs`
Expected: 8 个测试全部 PASS

若 `colorsUnder("jb2a.melee_attack.01.magic_sword")` 的断言失败，先运行
`node -e 'const i=require("fs").readFileSync("data/asset-index.json","utf8");
console.log(Object.keys(JSON.parse(i).tree.jb2a.melee_attack["01"].magic_sword))'`
查看实际颜色键，据实修正测试而不是修改实现。

- [ ] **Step 5: 提交**

```bash
cd /root/crucible-anim
git add -A
git commit -m "bestFit 资源解析器与离线/运行时双后端"
```

---

## Task 4: 调色板与色相补偿

**Files:**
- Create: `scripts/resolver/palette.mjs`
- Test: `test/palette.test.mjs`

**Interfaces:**
- Consumes: `scripts/const.mjs`
- Produces:
  - `RUNE_COLOR: Record<string, string>` — 12 个符文 id → 颜色名
  - `DAMAGE_COLOR: Record<string, string|null>` — 12 个伤害类型 → 颜色名，物理三种为 `null`
  - `COLOR_HUE: Record<string, number>` — 颜色名 → 色相角 0–359
  - `hueDelta(from: string, to: string): number` — 返回 −180..180 的最短色相差
  - `pickColor(assets, dbPath: string, want: string): {color: string, hue: number}` — 在该特效实际可用的颜色里取最接近 `want` 的，`hue` 为需要补的色相旋转量

12 个符文来自 `crucible/module/const/spellcraft.mjs` 的 `RUNES`，
12 个伤害类型来自 `crucible/module/const/attributes.mjs` 的 `DAMAGE_TYPES`。

- [ ] **Step 1: 写失败测试**

`test/palette.test.mjs`：

```js
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {RUNE_COLOR, DAMAGE_COLOR, COLOR_HUE, hueDelta, pickColor}
  from "../scripts/resolver/palette.mjs";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUNES = ["control", "death", "earth", "flame", "frost", "illumination",
               "illusion", "kinesis", "life", "oblivion", "soul", "storm"];
const DAMAGE = ["bludgeoning", "corruption", "piercing", "slashing", "poison", "acid",
                "fire", "cold", "electricity", "psychic", "radiant", "void"];

test("12 个符文全部有配色", () => {
  for (const r of RUNES) {
    assert.ok(RUNE_COLOR[r], `符文 ${r} 缺配色`);
    assert.ok(COLOR_HUE[RUNE_COLOR[r]] !== undefined, `颜色 ${RUNE_COLOR[r]} 不在色相表中`);
  }
  assert.equal(Object.keys(RUNE_COLOR).length, 12);
});

test("12 个伤害类型全部有条目，物理三种为 null", () => {
  for (const d of DAMAGE) assert.ok(d in DAMAGE_COLOR, `伤害类型 ${d} 缺条目`);
  for (const d of ["bludgeoning", "piercing", "slashing"]) {
    assert.equal(DAMAGE_COLOR[d], null, `${d} 是物理伤害，不应配色`);
  }
  for (const d of DAMAGE.filter(x => !["bludgeoning", "piercing", "slashing"].includes(x))) {
    assert.ok(COLOR_HUE[DAMAGE_COLOR[d]] !== undefined, `${d} 的颜色不在色相表中`);
  }
});

test("hueDelta 走最短弧且带符号", () => {
  assert.equal(hueDelta("blue", "blue"), 0);
  assert.ok(Math.abs(hueDelta("red", "orange")) <= 60);
  const d = hueDelta("red", "purple");
  assert.ok(d >= -180 && d <= 180, `越界: ${d}`);
  // 350° → 10° 应是 +20 而不是 −340
  assert.equal(hueDelta("__t350", "__t10"), 20);
});

test("pickColor 在实际可用颜色中取最近色并给出补偿量", () => {
  const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
  const assets = createAssets(offlineBackend(index));
  const p = "jb2a.melee_attack.01.magic_sword";
  const exact = pickColor(assets, p, "blue");
  assert.equal(exact.color, "blue");
  assert.equal(exact.hue, 0, "精确命中不应有色相补偿");

  const near = pickColor(assets, p, "red");
  assert.ok(assets.colorsUnder(p).includes(near.color), "必须返回实际存在的颜色");
  assert.notEqual(near.hue, 0, "取了近似色就应给出补偿量");
});

test("特效没有任何颜色分支时返回空颜色且不补偿", () => {
  const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
  const assets = createAssets(offlineBackend(index));
  const r = pickColor(assets, "完全不存在的路径", "blue");
  assert.equal(r.color, null);
  assert.equal(r.hue, 0);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /root/crucible-anim && node --test test/palette.test.mjs`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 写 `scripts/resolver/palette.mjs`**

```js
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
  blue_yellow: 235, green_yellow: 90, orange_purple: 340, blue_purple: 250,
  white: -1, dark_red: 355, dark_orange: 25,
  // 测试用的合成键，形如 __tNNN 表示色相角 NNN
  __t350: 350, __t10: 10
});

/** 12 个符文的主色。取自各符文的意象：storm 用电蓝、earth 用土绿、soul 用青、oblivion 用暗紫。 */
export const RUNE_COLOR = Object.freeze({
  flame: "orange",
  frost: "blue",
  life: "green",
  death: "purple",
  storm: "blue",
  earth: "dark_green",
  illumination: "yellow",
  illusion: "pink",
  kinesis: "teal",
  control: "blue_purple",
  oblivion: "dark_purple",
  soul: "teal"
});

/** 12 个伤害类型的主色。物理三种走血迹与火花，不配色。 */
export const DAMAGE_COLOR = Object.freeze({
  bludgeoning: null, piercing: null, slashing: null,
  fire: "orange", cold: "blue", electricity: "blue",
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
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /root/crucible-anim && node --test test/palette.test.mjs`
Expected: 5 个测试全部 PASS

- [ ] **Step 5: 提交**

```bash
cd /root/crucible-anim
git add -A
git commit -m "符文与伤害类型调色板及色相补偿"
```

---

## Task 5: fixture 生成器

**Files:**
- Create: `tools/dump-fixtures.mjs`, `test/fixtures/actions.json`（生成物）, `test/fixtures/effects.json`（生成物）
- Test: `test/fixtures.test.mjs`

**Interfaces:**
- Consumes: 无（直读 leveldb）
- Produces: 两份 fixture，元素均为 `ActionSnapshot` / `EffectSnapshot` 形状（结构见 Task 6）

fixture 是**合成快照**：直接从 compendium 的动作数据 + 参数化的目标与结果拼出来，
不经过 `snapshotAction()`。`snapshotAction()` 由 Task 6 用手写 mock 单独测试。
两者分开，避免快照层的 bug 被 fixture 掩盖。

数据来源与规模：

| 来源 | 动作数 |
| --- | --- |
| `systems/crucible/packs/talent` | 131 |
| `systems/crucible/packs/adversary-talents` | 46 |
| `systems/crucible/packs/spell` | 15 |
| `modules/ember/packs/crucible-adversary` | 26 |
| `DEFAULT_ACTIONS`（硬编码 13 个 id） | 13 |
| 合成法术矩阵 12 符文 × 17 姿态 | 204 |
| **合计** | **435** |

再按 8 种攻击结果参数化 → 约 1500 个断言样本（在测试里展开，不写进 fixture 文件）。

- [ ] **Step 1: 写失败测试**

`test/fixtures.test.mjs`：

```js
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const actions = JSON.parse(readFileSync(join(ROOT, "test/fixtures/actions.json"), "utf8"));
const effects = JSON.parse(readFileSync(join(ROOT, "test/fixtures/effects.json"), "utf8"));

test("动作 fixture 数量达到预期规模", () => {
  assert.ok(actions.length >= 435, `只有 ${actions.length} 个，应 >= 435`);
});

test("合成法术矩阵 12 × 17 完整", () => {
  const spells = actions.filter(a => a.spell);
  const combos = new Set(spells.map(a => `${a.spell.rune}.${a.spell.gesture}`));
  assert.equal(combos.size, 204, `法术组合 ${combos.size} 个，应为 204`);
});

test("每个 fixture 的必填字段齐全", () => {
  for (const a of actions) {
    for (const k of ["id", "tags", "target", "range", "cost", "origin", "targets", "usage", "seed"]) {
      assert.ok(k in a, `${a.id} 缺字段 ${k}`);
    }
    assert.ok(Array.isArray(a.tags));
    assert.ok(Array.isArray(a.targets));
    assert.equal(typeof a.origin.x, "number");
    assert.equal(typeof a.seed, "number");
  }
});

test("同时覆盖贴身与隔格两种几何", () => {
  const adj = actions.filter(a => a.targets.some(t => t.adjacent));
  const far = actions.filter(a => a.targets.some(t => !t.adjacent));
  assert.ok(adj.length > 0 && far.length > 0);
});

test("状态 fixture 覆盖全部 47 个状态", () => {
  assert.equal(effects.length, 47);
  assert.ok(effects.every(e => e.statusId && typeof e.target.x === "number"));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /root/crucible-anim && node --test test/fixtures.test.mjs`
Expected: FAIL — fixture 文件不存在

- [ ] **Step 3: 写 `tools/dump-fixtures.mjs`**

```js
/**
 * 从 Crucible 与 Ember 的 compendium 抽出全部动作，合成 ActionSnapshot 形状的测试样本。
 *
 * 直读 leveldb，不启动 Foundry。目标与结果是参数化合成的：每个动作配两个目标，
 * 一个贴身一个隔格，覆盖 §8.2 的两条几何分支。
 *
 * 用法： node tools/dump-fixtures.mjs [--data /root/fvtt14-data/Data]
 */
import {ClassicLevel} from "classic-level";
import {writeFileSync, existsSync} from "node:fs";
import {join, dirname} from "node:path";
import {fileURLToPath} from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const argData = process.argv.indexOf("--data");
const DATA = argData > -1 ? process.argv[argData + 1] : "/root/fvtt14-data/Data";

const GRID = 100;                       // 合成场景的网格像素
const ORIGIN = {x: 500, y: 500};
const ADJACENT = {x: 600, y: 500};      // 相邻一格
const DISTANT = {x: 900, y: 500};       // 隔三格

const PACKS = [
  join(DATA, "systems/crucible/packs/talent"),
  join(DATA, "systems/crucible/packs/adversary-talents"),
  join(DATA, "systems/crucible/packs/spell"),
  join(DATA, "modules/ember/packs/crucible-adversary")
];

const DEFAULT_ACTIONS = ["cast", "move", "fall", "defend", "delay", "escape", "reactiveStrike",
                         "throwWeapon", "investiture", "recover", "reload", "rest", "strike"];

const RUNES = ["control", "death", "earth", "flame", "frost", "illumination",
               "illusion", "kinesis", "life", "oblivion", "soul", "storm"];
const GESTURES = ["arrow", "aspect", "aura", "blast", "cone", "conjure", "create", "fan",
                  "influence", "pulse", "ray", "sense", "step", "strike", "surge", "touch", "ward"];

/** 法术姿态 → 目标形态与模板形状，取自 crucible/module/const/spellcraft.mjs 的 GESTURES。 */
const GESTURE_TARGET = {
  arrow: "single", aspect: "self", aura: "aura", blast: "blast", cone: "cone",
  conjure: "summon", create: "single", fan: "fan", influence: "single", pulse: "pulse",
  ray: "ray", sense: "self", step: "movement", strike: "single", surge: "self",
  touch: "single", ward: "self"
};
const TARGET_REGION = {
  blast: {type: "circle", x: 900, y: 500, radius: 200},
  cone: {type: "cone", x: 500, y: 500, radius: 300, angle: 60, rotation: 0},
  fan: {type: "cone", x: 500, y: 500, radius: 200, angle: 120, rotation: 0},
  ray: {type: "line", x: 500, y: 500, length: 400, width: 100, rotation: 0},
  pulse: {type: "circle", x: 500, y: 500, radius: 200},
  aura: {type: "circle", x: 500, y: 500, radius: 150}
};

/** 一个确定性的字符串哈希，用作 fixture 的 seed，保证跨机器可复现。 */
function hashSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function makeToken(pos, {width = 1} = {}) {
  return {
    tokenId: `tok-${pos.x}-${pos.y}`, x: pos.x, y: pos.y, elevation: 0,
    width, height: width, radiusPx: (width * GRID) / 2
  };
}

function makeTarget(pos, {adjacent, damageType, width = 1}) {
  const t = makeToken(pos, {width});
  return {
    ...t, adjacent, onLeft: pos.x < ORIGIN.x,
    results: [{result: 7, critical: false}],
    damage: damageType ? {total: 8, type: damageType, resource: "health"} : null,
    healed: 0, effects: []
  };
}

function baseSnapshot(id, {tags = [], target, range, cost, spell = null, region = null,
                          strikes = [], usage = {}}) {
  const dmg = tags.find(t => ["bludgeoning", "corruption", "piercing", "slashing", "poison",
    "acid", "fire", "cold", "electricity", "psychic", "radiant", "void"].includes(t)) ?? null;
  const wantsTargets = target?.type && !["none", "self", "summon"].includes(target.type);
  return {
    id, name: id, actorType: "hero",
    tags, target, range, cost, spell, region, strikes,
    origin: makeToken(ORIGIN),
    targets: wantsTargets
      ? [makeTarget(ADJACENT, {adjacent: true, damageType: dmg}),
         makeTarget(DISTANT, {adjacent: false, damageType: dmg})]
      : [],
    usage: {
      damageType: dmg, isAttack: !!usage.isAttack, isRanged: !!usage.isRanged,
      skillId: usage.skillId ?? null, resource: usage.resource ?? "health"
    },
    seed: hashSeed(id)
  };
}

const out = [];
const seen = new Set();

for (const p of PACKS) {
  if (!existsSync(p)) { console.warn(`跳过不存在的包: ${p}`); continue; }
  const db = new ClassicLevel(p, {valueEncoding: "json"});
  for await (const [key, doc] of db.iterator()) {
    if (!key.startsWith("!items!") && !key.startsWith("!actors!")) continue;
    for (const a of (doc?.system?.actions ?? [])) {
      const id = a.id;
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(baseSnapshot(id, {
        tags: a.tags ?? [],
        target: a.target ?? {type: "single", number: 1, distance: 1, scope: 2},
        range: a.range ?? {minimum: 0, maximum: 1},
        cost: a.cost ?? {action: 1, focus: 0, heroism: 0, health: 0},
        strikes: (a.tags ?? []).includes("strike")
          ? [{category: (a.tags ?? []).includes("natural") ? "unarmed" : "balanced1",
              damageType: "slashing"}]
          : [],
        usage: {
          isAttack: (a.tags ?? []).some(t => ["strike", "spell", "skill"].includes(t)),
          isRanged: (a.tags ?? []).includes("ranged")
        }
      }));
    }
  }
  await db.close();
}

for (const id of DEFAULT_ACTIONS) {
  if (seen.has(id)) continue;
  seen.add(id);
  out.push(baseSnapshot(id, {
    tags: id === "strike" ? ["strike", "melee"] : [id === "move" ? "movement" : "generic"],
    target: id === "strike" ? {type: "single", number: 1, distance: 1, scope: 2}
                            : {type: "self", number: 0, distance: 0, scope: 1},
    range: {minimum: 0, maximum: 1},
    cost: {action: 1, focus: 0, heroism: 0, health: 0},
    strikes: id === "strike" ? [{category: "balanced1", damageType: "slashing"}] : [],
    usage: {isAttack: id === "strike"}
  }));
}

for (const rune of RUNES) {
  for (const gesture of GESTURES) {
    const id = `spell.${rune}.${gesture}`;
    const tt = GESTURE_TARGET[gesture];
    out.push(baseSnapshot(id, {
      tags: ["spell", "composed"],
      target: {type: tt, number: tt === "single" ? 1 : 0, distance: 5, scope: 2},
      range: {minimum: 0, maximum: 10},
      cost: {action: 1, focus: 1, heroism: 0, health: 0},
      spell: {rune, gesture, inflection: null},
      region: TARGET_REGION[tt] ?? null,
      usage: {isAttack: true, isRanged: tt !== "self"}
    }));
  }
}

writeFileSync(join(ROOT, "test/fixtures/actions.json"), JSON.stringify(out));
console.log(`actions.json: ${out.length} 个快照`);

/** 47 个状态，取自 crucible/module/const/statuses.mjs。 */
const STATUSES = ["weakened", "dead", "broken", "insane", "staggered", "stunned", "prone",
  "restrained", "slowed", "hastened", "disoriented", "exhausted", "blinded", "burrowing",
  "flying", "deafened", "silenced", "enraged", "frightened", "invisible", "invulnerable",
  "limitless", "resolute", "guarded", "exposed", "overrun", "diseased", "paralyzed", "asleep",
  "suffocating", "incapacitated", "unaware", "falling", "bleeding", "burning", "freezing",
  "confused", "corroding", "decaying", "dominated", "entropy", "irradiated", "mending",
  "inspired", "poisoned", "shocked", "flanked"];

const effects = STATUSES.map(statusId => ({
  statusId, effectUuid: `Scene.s.Token.t.ActiveEffect.${statusId}`,
  target: makeToken(ORIGIN), seed: hashSeed(statusId)
}));
writeFileSync(join(ROOT, "test/fixtures/effects.json"), JSON.stringify(effects));
console.log(`effects.json: ${effects.length} 个状态`);
```

- [ ] **Step 4: 生成 fixture**

Run: `cd /root/crucible-anim && npm run fixtures`
Expected: `actions.json: 435+ 个快照`、`effects.json: 47 个状态`

若动作数低于 435，先运行
`node -e 'import("classic-level").then(async({ClassicLevel})=>{const db=new ClassicLevel("/root/fvtt14-data/Data/systems/crucible/packs/talent",{valueEncoding:"json"});let n=0;for await(const[k,v]of db.iterator())if(v?.system?.actions?.length)n+=v.system.actions.length;await db.close();console.log(n)})'`
核对实际动作数，据实调整测试阈值而不是伪造 fixture。

- [ ] **Step 5: 运行测试确认通过**

Run: `cd /root/crucible-anim && node --test test/fixtures.test.mjs`
Expected: 5 个测试全部 PASS

- [ ] **Step 6: 提交**

```bash
cd /root/crucible-anim
git add -A
git commit -m "测试 fixture 生成器与 435 个动作快照"
```

---

## Task 6: ActionSnapshot 快照层

**Files:**
- Create: `scripts/trigger/snapshot.mjs`
- Test: `test/snapshot.test.mjs`

**Interfaces:**
- Consumes: `scripts/const.mjs`
- Produces:
  - `edgesIntersect(a, b): boolean` — `a`/`b` 为 `{x, y, w, h}` 像素矩形；判断两个 token 是否贴身
  - `isOnLeft(a, b): boolean` — b 是否在 a 的左侧
  - `hashSeed(s: string): number` — 与 `tools/dump-fixtures.mjs` 中同名函数**行为必须一致**（FNV-1a 32 位）
  - `snapshotAction(action, env): ActionSnapshot` — `env = {gridSize, distancePixels}`
  - `snapshotEffect(effect, tokenDoc, env): EffectSnapshot`

`snapshotAction` 内部会触碰 `action.actor` / `action.token` 等 Crucible 对象，但**只读属性**，
不调用 Foundry 全局；测试用手写 mock 覆盖。它属于 `trigger/` 而非 `resolver/`，
因此不受「禁止引用 Foundry 全局」的约束，但仍应保持无副作用。

- [ ] **Step 1: 写失败测试**

`test/snapshot.test.mjs`：

```js
import {test} from "node:test";
import assert from "node:assert/strict";
import {edgesIntersect, isOnLeft, hashSeed, snapshotAction}
  from "../scripts/trigger/snapshot.mjs";

const ENV = {gridSize: 100, distancePixels: 100};

test("edgesIntersect 认定相邻格为贴身、隔格为非贴身", () => {
  const a = {x: 500, y: 500, w: 100, h: 100};
  assert.equal(edgesIntersect(a, {x: 600, y: 500, w: 100, h: 100}), true);
  assert.equal(edgesIntersect(a, {x: 600, y: 600, w: 100, h: 100}), true, "斜相邻也算贴身");
  assert.equal(edgesIntersect(a, {x: 900, y: 500, w: 100, h: 100}), false);
});

test("大体型 token 的贴身判定按边缘而非中心", () => {
  const big = {x: 500, y: 500, w: 300, h: 300};      // 3x3
  assert.equal(edgesIntersect(big, {x: 800, y: 500, w: 100, h: 100}), true,
    "紧贴 3x3 右边缘应算贴身");
  assert.equal(edgesIntersect(big, {x: 1000, y: 500, w: 100, h: 100}), false);
});

test("isOnLeft 按中心 x 比较", () => {
  assert.equal(isOnLeft({x: 500, y: 500, w: 100, h: 100}, {x: 300, y: 500, w: 100, h: 100}), true);
  assert.equal(isOnLeft({x: 500, y: 500, w: 100, h: 100}, {x: 700, y: 500, w: 100, h: 100}), false);
});

test("hashSeed 确定、稳定、非负 32 位", () => {
  assert.equal(hashSeed("abc"), hashSeed("abc"));
  assert.notEqual(hashSeed("abc"), hashSeed("abd"));
  const h = hashSeed("reactiveStrike");
  assert.ok(Number.isInteger(h) && h >= 0 && h < 2 ** 32);
});

test("snapshotAction 提取全部必填字段并固化坐标", () => {
  const targetToken = {
    id: "t1", uuid: "Scene.s.Token.t1",
    document: {elevation: 0, width: 1, height: 1},
    center: {x: 600, y: 500}
  };
  const targetActor = {id: "a1"};
  const action = {
    id: "reactiveStrike", name: "反击",
    tags: new Set(["strike", "melee", "slashing"]),
    target: {type: "single", number: 1, distance: 1, scope: 2},
    range: {minimum: 0, maximum: 1},
    cost: {action: 1, focus: 0, heroism: 0, health: 0},
    region: null,
    actor: {type: "hero"},
    token: {id: "t0", document: {elevation: 0, width: 1, height: 1}, center: {x: 500, y: 500}},
    targets: new Map([[targetActor, {token: targetToken}]]),
    usage: {damageType: "slashing", isAttack: true, isRanged: false,
            strikes: [{category: "balanced1", system: {damageType: "slashing"}}]},
    eventsByTarget: new Map([[targetActor, {
      all: [], roll: [{roll: {data: {result: 7, strike: 0}, isCriticalSuccess: false}}]
    }]])
  };

  const s = snapshotAction(action, ENV);
  assert.equal(s.id, "reactiveStrike");
  assert.deepEqual(s.tags.sort(), ["melee", "slashing", "strike"]);
  assert.equal(s.origin.x, 500);
  assert.equal(s.targets.length, 1);
  assert.equal(s.targets[0].adjacent, true);
  assert.equal(s.targets[0].onLeft, false);
  assert.equal(s.targets[0].results[0].result, 7);
  assert.equal(s.usage.isAttack, true);
  assert.equal(s.spell, null);
  assert.equal(typeof s.seed, "number");
});

test("快照是纯数据，JSON 往返后完全相等", () => {
  const action = {
    id: "defend", name: "防御", tags: new Set(["generic"]),
    target: {type: "self", number: 0, distance: 0, scope: 1},
    range: {minimum: 0, maximum: 0}, cost: {action: 1, focus: 0, heroism: 0, health: 0},
    region: null, actor: {type: "hero"},
    token: {id: "t0", document: {elevation: 0, width: 1, height: 1}, center: {x: 500, y: 500}},
    targets: new Map(), usage: {}, eventsByTarget: new Map()
  };
  const s = snapshotAction(action, ENV);
  assert.deepEqual(JSON.parse(JSON.stringify(s)), s);
});

test("合成法术会带上 rune/gesture/inflection", () => {
  const action = {
    id: "spell.storm.arrow", name: "风暴箭",
    tags: new Set(["spell", "composed", "electricity"]),
    target: {type: "single", number: 1, distance: 5, scope: 2},
    range: {minimum: 0, maximum: 10}, cost: {action: 1, focus: 1, heroism: 0, health: 0},
    region: null, actor: {type: "hero"},
    token: {id: "t0", document: {elevation: 0, width: 1, height: 1}, center: {x: 500, y: 500}},
    targets: new Map(), usage: {damageType: "electricity", isAttack: true, isRanged: true},
    eventsByTarget: new Map(),
    rune: {id: "storm"}, gesture: {id: "arrow"}, inflection: {id: "extend"}
  };
  const s = snapshotAction(action, ENV);
  assert.deepEqual(s.spell, {rune: "storm", gesture: "arrow", inflection: "extend"});
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/snapshot.test.mjs`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 写 `scripts/trigger/snapshot.mjs`**

```js
/**
 * 把活的 CrucibleAction / ActiveEffect 压成纯数据快照。
 *
 * 快照必须能通过 JSON 往返（它要序列化进聊天卡 flag 广播给所有客户端），
 * 因此所有坐标在此固化为原始数值，不保留 token.center 之类的活引用。
 * 这一点取自 eskie-macros 的做法：先 snapshot 再入队，避免 token 中途移动导致锚点漂移。
 */

/** 两个像素矩形是否边缘相接或重叠（含斜相邻）。用于「贴身 vs 隔格」判定。 */
export function edgesIntersect(a, b) {
  const ax1 = a.x - a.w / 2, ax2 = a.x + a.w / 2;
  const ay1 = a.y - a.h / 2, ay2 = a.y + a.h / 2;
  const bx1 = b.x - b.w / 2, bx2 = b.x + b.w / 2;
  const by1 = b.y - b.h / 2, by2 = b.y + b.h / 2;
  const EPS = 1;                                  // 容忍 1px 浮点误差
  return (ax2 >= bx1 - EPS) && (bx2 >= ax1 - EPS)
      && (ay2 >= by1 - EPS) && (by2 >= ay1 - EPS);
}

/** b 是否位于 a 的左侧。用于决定武器挥击是否需要 mirrorY。 */
export function isOnLeft(a, b) {
  return b.x < a.x;
}

/** FNV-1a 32 位。与 tools/dump-fixtures.mjs 的同名函数必须行为一致。 */
export function hashSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** 从一个 Token 对象取出快照所需的几何。 */
function tokenGeom(token, gridSize) {
  const w = (token.document?.width ?? 1) * gridSize;
  const h = (token.document?.height ?? 1) * gridSize;
  return {
    tokenId: token.id ?? null,
    uuid: token.document?.uuid ?? token.uuid ?? null,
    x: token.center?.x ?? 0, y: token.center?.y ?? 0,
    elevation: token.document?.elevation ?? 0,
    width: token.document?.width ?? 1, height: token.document?.height ?? 1,
    w, h, radiusPx: Math.max(w, h) / 2
  };
}

/**
 * @param {CrucibleAction} action
 * @param {{gridSize: number, distancePixels: number}} env
 * @returns {ActionSnapshot}
 */
export function snapshotAction(action, env) {
  const gridSize = env.gridSize;
  const origin = action.token
    ? tokenGeom(action.token, gridSize)
    : {tokenId: null, uuid: null, x: 0, y: 0, elevation: 0, width: 1, height: 1,
       w: gridSize, h: gridSize, radiusPx: gridSize / 2};

  const targets = [];
  const byTarget = action.eventsByTarget ?? new Map();
  for (const [actor, t] of (action.targets ?? new Map())) {
    if (!t?.token) continue;
    const g = tokenGeom(t.token, gridSize);
    const group = byTarget.get(actor);
    const results = [];
    let damage = null;
    let healed = 0;
    for (const ev of (group?.roll ?? [])) {
      if (!ev?.roll?.data) continue;
      results.push({
        result: ev.roll.data.result ?? null,
        critical: ev.roll.isCriticalSuccess === true,
        strike: ev.roll.data.strike ?? null
      });
    }
    for (const ev of (group?.all ?? [])) {
      const d = ev?.resource?.health ?? null;
      if (typeof d === "number") { if (d < 0) damage = {total: -d, type: action.usage?.damageType ?? null, resource: "health"}; else healed += d; }
    }
    targets.push({
      ...g,
      adjacent: edgesIntersect(origin, g),
      onLeft: isOnLeft(origin, g),
      results, damage, healed,
      effects: (group?.all ?? []).flatMap(ev => (ev?.effects ?? []).map(e => e.statuses?.[0] ?? e._id).filter(Boolean))
    });
  }

  const spell = action.rune && action.gesture
    ? {rune: action.rune.id, gesture: action.gesture.id, inflection: action.inflection?.id ?? null}
    : null;

  const region = action.region?.shapes?.[0]
    ? {...action.region.shapes[0].toObject?.() ?? action.region.shapes[0]}
    : null;

  return {
    id: action.id, name: action.name ?? action.id,
    actorType: action.actor?.type ?? null,
    tags: [...(action.tags ?? [])],
    target: {...(action.target ?? {type: "none", number: 0, distance: 0, scope: 0})},
    range: {...(action.range ?? {minimum: 0, maximum: 0})},
    cost: {...(action.cost ?? {action: 0, focus: 0, heroism: 0, health: 0})},
    spell, region,
    strikes: (action.usage?.strikes ?? []).map(w => ({
      category: w.category ?? w.system?.category ?? null,
      damageType: w.system?.damageType ?? w.damageType ?? null
    })),
    origin, targets,
    usage: {
      damageType: action.usage?.damageType ?? null,
      isAttack: action.usage?.isAttack === true,
      isRanged: action.usage?.isRanged === true,
      skillId: action.usage?.skillId ?? null,
      resource: action.usage?.resource ?? "health"
    },
    seed: hashSeed(`${action.id}:${origin.x},${origin.y}:${targets.length}`)
  };
}

/**
 * 状态效果快照，驱动 persist 槽。
 * @param {ActiveEffect} effect
 * @param {Token} token
 * @param {{gridSize: number}} env
 * @returns {EffectSnapshot}
 */
export function snapshotEffect(effect, token, env) {
  const statusId = [...(effect.statuses ?? [])][0] ?? effect.id ?? null;
  return {
    statusId,
    effectUuid: effect.uuid ?? null,
    target: tokenGeom(token, env.gridSize),
    seed: hashSeed(`${statusId}:${effect.uuid ?? ""}`)
  };
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `cd /root/crucible-anim && node --test test/snapshot.test.mjs`
Expected: 7 个测试全部 PASS

- [ ] **Step 5: 校验两处 hashSeed 一致**

Run:
```bash
cd /root/crucible-anim && node -e '
import("./scripts/trigger/snapshot.mjs").then(m => {
  const local = s => { let h=2166136261; for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);} return h>>>0; };
  for (const s of ["abc", "reactiveStrike", "spell.storm.arrow", ""])
    if (m.hashSeed(s) !== local(s)) { console.error("不一致:", s); process.exit(1); }
  console.log("hashSeed 与 fixture 生成器一致");
})'
```
Expected: `hashSeed 与 fixture 生成器一致`

- [ ] **Step 6: 提交**

```bash
cd /root/crucible-anim
git add -A
git commit -m "ActionSnapshot 与 EffectSnapshot 快照层"
```

---

## Task 7: ctx 能力袋、解析器骨架与兜底兵库

本任务的交付是**覆盖率断言首次转绿**：435 个 fixture 全部能解析出非空动画计划。
此时兵库里只有兜底规则，画面很单调，但管线是通的，后续任务只往兵库里加内容。

**Files:**
- Create: `scripts/resolver/context.mjs`, `scripts/resolver/resolve.mjs`, `scripts/armory/index.mjs`, `scripts/armory/cast.mjs`, `scripts/armory/travel.mjs`, `scripts/armory/impact.mjs`, `scripts/armory/aftermath.mjs`, `scripts/armory/persist.mjs`
- Test: `test/resolve.test.mjs`, `test/coverage.test.mjs`

**Interfaces:**
- Consumes: `assets.mjs`（Task 3）、`palette.mjs`（Task 4）、fixture（Task 5）
- Produces:
  - `createContext({assets, snapshot, seed}) -> Ctx`
    - `Ctx.rng(): number` — 0..1，由 seed 驱动的 mulberry32
    - `Ctx.pickOne(arr): any` — 用 `rng` 从数组取一个
    - `Ctx.pick(dbPath, {color, want}): {file, files, hue, template}|null`
    - `Ctx.sound(dbPath, opts): {file}|null`
    - `Ctx.runeColor(): string|null` / `Ctx.damageColor(): string|null`
    - `Ctx.geom`: `{sizeScale(): number, offsetFor(target, base): number, adjacent(target): boolean, onLeft(target): boolean}`
    - `Ctx.warn(msg)`
  - `resolve(snapshot, {assets, armory}) -> FXPlan|null`
  - `resolveEffect(effectSnapshot, {assets, armory}) -> FXPlan|null`
  - `ARMORY = {cast, travel, impact, aftermath, persist}`，每项为规则数组
  - 规则形状：`{id: string, pri: number, when(s, ctx): boolean, build(s, ctx, target): Cue[]|Cue|null}`
    - `cast` 的 `build` 只收 `(s, ctx)`；`travel`/`impact`/`aftermath` 收 `(s, ctx, target)` 并按目标各调一次；`persist` 收 `(effectSnapshot, ctx)`

- [ ] **Step 1: 写失败测试**

`test/resolve.test.mjs`：

```js
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {createContext} from "../scripts/resolver/context.mjs";
import {resolve} from "../scripts/resolver/resolve.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const actions = JSON.parse(readFileSync(join(ROOT, "test/fixtures/actions.json"), "utf8"));
const mkAssets = () => createAssets(offlineBackend(index));
const strike = actions.find(a => a.tags.includes("strike") && a.targets.length);

test("rng 由 seed 决定，同 seed 同序列", () => {
  const a = createContext({assets: mkAssets(), snapshot: {seed: 42}, seed: 42});
  const b = createContext({assets: mkAssets(), snapshot: {seed: 42}, seed: 42});
  const sa = [a.rng(), a.rng(), a.rng()];
  const sb = [b.rng(), b.rng(), b.rng()];
  assert.deepEqual(sa, sb);
  assert.ok(sa.every(v => v >= 0 && v < 1));
  const c = createContext({assets: mkAssets(), snapshot: {seed: 43}, seed: 43});
  assert.notDeepEqual(sa, [c.rng(), c.rng(), c.rng()]);
});

test("geom.sizeScale 对大体型 token 放大 1.4 倍", () => {
  const small = createContext({assets: mkAssets(), snapshot: {seed: 1, origin: {width: 1}}, seed: 1});
  const big = createContext({assets: mkAssets(), snapshot: {seed: 1, origin: {width: 3}}, seed: 1});
  assert.equal(small.geom.sizeScale(), 1);
  assert.equal(big.geom.sizeScale(), 1.4);
});

test("geom.offsetFor 贴身不折半、隔格折半", () => {
  const ctx = createContext({assets: mkAssets(), snapshot: {seed: 1, origin: {width: 3}}, seed: 1});
  assert.equal(ctx.geom.offsetFor({adjacent: true}, 0.5), 3 * 0.5);
  assert.equal(ctx.geom.offsetFor({adjacent: false}, 0.5), (3 * 0.5) / 2);
});

test("解析产出带版本号与 cues 的计划", () => {
  const plan = resolve(strike, {assets: mkAssets(), armory: ARMORY});
  assert.ok(plan, "应产出计划");
  assert.equal(plan.v, 1);
  assert.ok(Array.isArray(plan.cues) && plan.cues.length > 0);
  for (const c of plan.cues) {
    assert.ok(["cast", "travel", "impact", "aftermath", "persist"].includes(c.slot));
    assert.ok(["effect", "sound", "shake"].includes(c.kind));
  }
});

test("解析确定：同快照两次结果完全相同", () => {
  const a = resolve(strike, {assets: mkAssets(), armory: ARMORY});
  const b = resolve(strike, {assets: mkAssets(), armory: ARMORY});
  assert.deepEqual(a, b);
});

test("高优先级规则截胡低优先级", () => {
  const probe = {
    ...strike,
    id: "__probe__",
    tags: ["__probe_tag__"]
  };
  const armory = {
    ...ARMORY,
    cast: [
      {id: "低", pri: 10, when: () => true, build: () => ({kind: "effect", file: "低"})},
      {id: "高", pri: 900, when: s => s.tags.includes("__probe_tag__"),
       build: () => ({kind: "effect", file: "高"})}
    ]
  };
  const plan = resolve(probe, {assets: mkAssets(), armory});
  const cast = plan.cues.find(c => c.slot === "cast");
  assert.equal(cast.rule, "高");
  assert.equal(cast.file, "高");
});

test("build 返回 null 时该槽静默跳过，不产生空 cue", () => {
  const armory = {...ARMORY, cast: [{id: "空", pri: 900, when: () => true, build: () => null}]};
  const plan = resolve(strike, {assets: mkAssets(), armory});
  assert.equal(plan.cues.some(c => c.slot === "cast"), false);
});

test("每个 cue 的数值字段无 NaN / undefined / 负时长", () => {
  for (const s of actions.slice(0, 120)) {
    const plan = resolve(s, {assets: mkAssets(), armory: ARMORY});
    if (!plan) continue;
    for (const c of plan.cues) {
      for (const k of ["delay", "duration", "fadeIn", "fadeOut", "opacity", "objectScale"]) {
        const v = c[k];
        if (v === undefined || v === null) continue;
        assert.ok(Number.isFinite(v), `${s.id}.${c.rule}.${k} = ${v}`);
        if (k !== "waitUntilFinished") assert.ok(v >= 0, `${s.id}.${c.rule}.${k} 为负`);
      }
    }
  }
});
```

`test/coverage.test.mjs`：

```js
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync, existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {resolve, resolveEffect} from "../scripts/resolver/resolve.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import {RESULT} from "../scripts/const.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FOUNDRY_DATA = "/root/fvtt14-data/Data";
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const actions = JSON.parse(readFileSync(join(ROOT, "test/fixtures/actions.json"), "utf8"));
const effects = JSON.parse(readFileSync(join(ROOT, "test/fixtures/effects.json"), "utf8"));
const mk = () => createAssets(offlineBackend(index));

test("覆盖率：每个动作都解析出至少一个 cue", () => {
  const empty = [];
  for (const s of actions) {
    const plan = resolve(s, {assets: mk(), armory: ARMORY});
    if (!plan || !plan.cues.length) empty.push(s.id);
  }
  assert.deepEqual(empty.slice(0, 20), [], `${empty.length} 个动作没有动画`);
});

test("覆盖率：8 种攻击结果各自都能解析", () => {
  const attack = actions.filter(a => a.usage.isAttack && a.targets.length).slice(0, 40);
  for (const base of attack) {
    for (const result of Object.values(RESULT)) {
      const s = {...base, targets: base.targets.map(t => ({...t, results: [{result, critical: false}]}))};
      const plan = resolve(s, {assets: mk(), armory: ARMORY});
      assert.ok(plan && plan.cues.length, `${base.id} 在结果 ${result} 下无动画`);
    }
  }
});

test("覆盖率：47 个状态都解析出持续特效", () => {
  const empty = [];
  for (const e of effects) {
    const plan = resolveEffect(e, {assets: mk(), armory: ARMORY});
    if (!plan || !plan.cues.length) empty.push(e.statusId);
  }
  assert.deepEqual(empty, [], `${empty.length} 个状态没有动画`);
});

test("路径存在性：所有 cue 引用的文件在磁盘上真实存在", () => {
  const missing = new Set();
  for (const s of actions) {
    const plan = resolve(s, {assets: mk(), armory: ARMORY});
    for (const c of plan?.cues ?? []) {
      if (!c.file || typeof c.file !== "string") continue;
      if (!existsSync(join(FOUNDRY_DATA, c.file))) missing.add(c.file);
    }
  }
  assert.deepEqual([...missing].slice(0, 10), [], `${missing.size} 个文件不存在`);
});

test("降级次数不超过阈值", () => {
  let diverged = 0, total = 0;
  for (const s of actions) {
    const assets = mk();
    resolve(s, {assets, armory: ARMORY});
    diverged += assets.warnings.length;
    total += 1;
  }
  const rate = diverged / total;
  assert.ok(rate < 0.15, `降级率 ${(rate * 100).toFixed(1)}%，超过 15% 说明兵库路径写错了`);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /root/crucible-anim && node --test test/resolve.test.mjs test/coverage.test.mjs`
Expected: FAIL — 模块不存在

- [ ] **Step 3: 写 `scripts/resolver/context.mjs`**

```js
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
  const rng = mulberry32(seed ?? snapshot?.seed ?? 0);
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
    rng,
    pickOne: arr => arr[Math.floor(rng() * arr.length)],
    pick, sound, runeColor, damageColor, geom,
    warn: msg => warnings.push(msg),
    warnings
  };
}
```

- [ ] **Step 4: 写 `scripts/resolver/resolve.mjs`**

```js
import {PLAN_VERSION, SLOTS} from "../const.mjs";
import {createContext} from "./context.mjs";

/** 每个 cue 的默认值，兵库规则只需写它关心的字段。 */
const CUE_DEFAULTS = {
  kind: "effect", playIf: "always",
  attachTo: false, bindScale: false, local: true,
  aim: null, stretchTo: null, offset: {x: 0, y: 0}, gridUnits: false,
  objectScale: 1, scale: null, mirrorY: false, randomizeMirrorY: false, randomRotation: false,
  filter: null, tint: null, opacity: 1,
  fadeIn: 200, fadeOut: 300, fadeInEase: "easeOutQuad", fadeOutEase: "easeInQuad",
  belowTokens: false, zIndex: 50, elevation: null, mask: null,
  delay: 0, duration: null, playbackRate: 1, startTime: 0, waitUntilFinished: null,
  persist: false, tieTo: null, extraEndDuration: 0, volume: 1
};

/** 槽内按 pri 降序取第一个 when 为真的规则。 */
function firstMatch(rules, s, ctx) {
  const sorted = [...rules].sort((a, b) => b.pri - a.pri);
  for (const r of sorted) {
    let ok = false;
    try { ok = r.when(s, ctx); } catch { ok = false; }
    if (ok) return r;
  }
  return null;
}

/** 规则可以返回单个 cue、cue 数组或 null；统一成数组并补默认值。 */
function normalize(out, slot, ruleId, at) {
  if (!out) return [];
  const arr = Array.isArray(out) ? out : [out];
  return arr.filter(Boolean).map(c => ({...CUE_DEFAULTS, ...c, slot, rule: ruleId, at: c.at ?? at}));
}

/**
 * 五槽装配。
 * @param {ActionSnapshot} snapshot
 * @param {{assets: object, armory: object}} deps
 * @returns {FXPlan|null}
 */
export function resolve(snapshot, {assets, armory}) {
  const ctx = createContext({assets, snapshot, seed: snapshot.seed});
  const cues = [];

  // S1 cast：整个动作一次，锚在施法者
  const castRule = firstMatch(armory.cast, snapshot, ctx);
  if (castRule) {
    cues.push(...normalize(castRule.build(snapshot, ctx), "cast", castRule.id, {ref: "origin"}));
  }

  // S2–S4：每个目标各解析一次
  for (const target of snapshot.targets) {
    for (const slot of ["travel", "impact", "aftermath"]) {
      const rule = firstMatch(armory[slot], snapshot, ctx);
      if (!rule) continue;
      const at = {ref: "target", tokenId: target.tokenId, uuid: target.uuid,
                  x: target.x, y: target.y};
      cues.push(...normalize(rule.build(snapshot, ctx, target), slot, rule.id, at));
    }
  }

  if (!cues.length) return null;
  return {v: PLAN_VERSION, seed: snapshot.seed, source: snapshot.id, cues};
}

/**
 * persist 槽：由 ActiveEffect 增删驱动，不经过动作。
 * @param {EffectSnapshot} effectSnapshot
 * @param {{assets: object, armory: object}} deps
 * @returns {FXPlan|null}
 */
export function resolveEffect(effectSnapshot, {assets, armory}) {
  const ctx = createContext({assets, snapshot: effectSnapshot, seed: effectSnapshot.seed});
  const rule = firstMatch(armory.persist, effectSnapshot, ctx);
  if (!rule) return null;
  const at = {ref: "target", tokenId: effectSnapshot.target.tokenId,
              uuid: effectSnapshot.target.uuid,
              x: effectSnapshot.target.x, y: effectSnapshot.target.y};
  const cues = normalize(rule.build(effectSnapshot, ctx), "persist", rule.id, at);
  if (!cues.length) return null;
  return {v: PLAN_VERSION, seed: effectSnapshot.seed, source: effectSnapshot.statusId, cues};
}

export {SLOTS};
```

- [ ] **Step 5: 写五个兵库文件的兜底规则**

本步只写 `pri < 100` 的终极兜底，后续任务往上加高优先级规则。
每个文件末尾用注释标出「高优先级规则加在这里」。

`scripts/armory/cast.mjs`：

```js
/**
 * S1 cast：动作开始，锚在施法者。
 * 规则按 pri 降序匹配，取第一个命中者。高优先级规则加在数组前部。
 */
export default [
  // ---- 高优先级规则加在这里（Task 9） ----

  /** 兜底：任何非攻击动作给一个中性施法圈；攻击动作的起手交给 travel 段。 */
  {
    id: "generic.cast", pri: 10,
    when: () => true,
    build: (s, ctx) => {
      if (s.usage.isAttack) return null;
      const fx = ctx.pick("jb2a.cast_generic.abjuration", {color: ctx.runeColor() ?? "blue"});
      if (!fx) return null;
      return {
        file: fx.file, objectScale: 0.9 * ctx.geom.sizeScale(),
        belowTokens: true, fadeIn: 200, fadeOut: 400,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null
      };
    }
  }
];
```

`scripts/armory/travel.mjs`：

```js
/** S2 travel：施法者 → 目标。 */
export default [
  // ---- 高优先级规则加在这里（Task 10） ----

  /** 兜底：远程动作给一枚中性投射物；近战不出内容，由 impact 承担。 */
  {
    id: "generic.travel", pri: 10,
    when: () => true,
    build: (s, ctx, target) => {
      if (!s.usage.isRanged) return null;
      const fx = ctx.pick("jb2a.magic_missile", {color: ctx.damageColor() ?? ctx.runeColor() ?? "blue"});
      if (!fx) return null;
      return {
        file: fx.file, objectScale: 1 * ctx.geom.sizeScale(),
        aim: {towards: {tokenId: target.tokenId, x: target.x, y: target.y},
              missed: target.results.some(r => r.result === 0 || r.result === 1)},
        waitUntilFinished: -300, zIndex: 100,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null
      };
    }
  }
];
```

`scripts/armory/impact.mjs`：

```js
import {RESULT, RESULT_NAME} from "../const.mjs";

/** S3 impact：命中判定后，锚在目标。结果层与元素层分开叠加，见 DESIGN.md §6.5。 */
export default [
  // ---- 高优先级规则加在这里（Task 11） ----

  /** 兜底：按攻击结果给一层通用冲击，未命中走 .missed()。 */
  {
    id: "generic.impact", pri: 10,
    when: () => true,
    build: (s, ctx, target) => {
      const res = target.results[0]?.result ?? RESULT.HIT;
      const missed = res === RESULT.MISS || res === RESULT.DODGE;
      const fx = ctx.pick("jb2a.impact.004", {color: ctx.damageColor() ?? "white"});
      if (!fx) return null;
      return {
        file: fx.file, playIf: RESULT_NAME[res] ?? "always",
        objectScale: res === RESULT.GLANCE ? 0.6 : 1,
        aim: {towards: {tokenId: target.tokenId, x: target.x, y: target.y}, missed},
        delay: 0, zIndex: 60,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null
      };
    }
  }
];
```

`scripts/armory/aftermath.mjs`：

```js
/** S4 aftermath：结算后，锚在目标或地面。 */
export default [
  // ---- 高优先级规则加在这里（Task 12） ----

  /** 兜底：有治疗量时给一层治疗辉光，否则不出内容。 */
  {
    id: "generic.aftermath", pri: 10,
    when: () => true,
    build: (s, ctx, target) => {
      if (!(target.healed > 0)) return null;
      const fx = ctx.pick("jb2a.healing_generic.burst", {color: "green"});
      if (!fx) return null;
      return {file: fx.file, objectScale: 1, attachTo: true, delay: 200, zIndex: 70};
    }
  }
];
```

`scripts/armory/persist.mjs`：

```js
/**
 * S5 persist：状态效果的持续特效。由 ActiveEffect 增删驱动，不属于任何动作。
 * 必须带 persist + tieTo，效果移除时 Sequencer 自动清理。
 */
export default [
  // ---- 高优先级规则加在这里（Task 12） ----

  /** 兜底：任何状态都挂一层中性光环，保证 47 个状态无一黑屏。 */
  {
    id: "generic.persist", pri: 10,
    when: () => true,
    build: (e, ctx) => {
      const fx = ctx.pick("jb2a.extras.tmfx.outflow.circle.01");
      if (!fx) return null;
      return {
        file: fx.file, objectScale: 1, attachTo: true, belowTokens: true,
        persist: true, tieTo: e.effectUuid, extraEndDuration: 300,
        opacity: 0.6, zIndex: 10
      };
    }
  }
];
```

`scripts/armory/index.mjs`：

```js
import cast from "./cast.mjs";
import travel from "./travel.mjs";
import impact from "./impact.mjs";
import aftermath from "./aftermath.mjs";
import persist from "./persist.mjs";

/** 五槽规则表。resolve() 按槽取用，槽内按 pri 降序取第一个命中者。 */
export const ARMORY = Object.freeze({cast, travel, impact, aftermath, persist});
```

- [ ] **Step 6: 运行测试，逐条修正兜底路径**

Run: `cd /root/crucible-anim && node --test test/resolve.test.mjs test/coverage.test.mjs`

上面五个兜底规则里的 DB 路径（`jb2a.cast_generic.abjuration`、`jb2a.magic_missile`、
`jb2a.impact.004`、`jb2a.healing_generic.burst`、`jb2a.extras.tmfx.outflow.circle.01`）
是按 JB2A 常见命名写的，**必须用真实索引核对**。核对命令：

```bash
cd /root/crucible-anim && node -e '
const i = JSON.parse(require("fs").readFileSync("data/asset-index.json","utf8"));
const at = p => p.split(".").reduce((o,k)=>o?.[k], i.tree);
for (const p of ["jb2a.cast_generic","jb2a.magic_missile","jb2a.impact",
                 "jb2a.healing_generic","jb2a-extras"]) {
  const n = at(p);
  console.log(p, "=>", n ? Object.keys(n).filter(k=>!k.startsWith("_")).slice(0,12) : "不存在");
}'
```

据实修正兵库里的路径。`bestFit` 会兜住写错的路径，但降级率断言（< 15%）会把错误暴露出来
——这正是那条断言的用途，不要通过放宽阈值来绕过。

Expected: `test/resolve.test.mjs` 8 个 PASS，`test/coverage.test.mjs` 5 个 PASS

- [ ] **Step 7: 提交**

```bash
cd /root/crucible-anim
git add -A
git commit -m "解析器骨架、ctx 能力袋与五槽兜底兵库"
```

---

## Task 8: 素材侦察与选材清单

兵库规则里每条路径都对应一个真实的动画文件，而**文件名不足以判断它长什么样**。
实测例：`Club01_01_Regular_Blue_800x600.webm` 不是单纯一次挥击，而是 66 帧的
「起手 → 挥砍弧光 → 命中闪爆 → 收招」完整序列，锚点在攻击者、朝向目标。
把它当成单段冲击特效用，画面就是错的。

本任务的交付是 `docs/ASSET-NOTES.md`：后续四个兵库任务的选材依据。
这是 V1 中唯一不能自动化的一步。

**Files:**
- Create: `docs/ASSET-NOTES.md`
- Test: `test/asset-notes.test.mjs`

**Interfaces:**
- Consumes: `data/asset-index.json`（Task 2）、`tools/contact-sheet.sh`（Task 2）
- Produces: `docs/ASSET-NOTES.md`，每条记录一行表格，字段：
  `DB 路径 | 槽位 | 相位结构 | 锚点 | 帧数 | 需要 stretchTo | 需要 mirrorY | 备注`

- [ ] **Step 1: 写失败测试**

`test/asset-notes.test.mjs`：

```js
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const md = readFileSync(join(ROOT, "docs/ASSET-NOTES.md"), "utf8");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const assets = createAssets(offlineBackend(index));

/** 抽出表格里第一列的 DB 路径。 */
function paths() {
  return md.split("\n")
    .filter(l => l.startsWith("| `"))
    .map(l => l.split("|")[1].trim().replace(/`/g, ""));
}

test("清单条目数达到覆盖五槽所需的规模", () => {
  assert.ok(paths().length >= 60, `只有 ${paths().length} 条，应 >= 60`);
});

test("清单里每条路径都能无降级地解析", () => {
  const bad = [];
  for (const p of paths()) {
    const a = createAssets(offlineBackend(index));
    const r = a.resolve(p);
    if (!r) bad.push(`${p} (解析失败)`);
    else if (r.diverged) bad.push(`${p} → ${r.path} (降级)`);
  }
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} 条路径有问题`);
});

test("五个槽位都有选材", () => {
  for (const slot of ["cast", "travel", "impact", "aftermath", "persist"]) {
    assert.ok(md.includes(`| ${slot} |`), `槽位 ${slot} 无选材`);
  }
});

test("每条记录都填了相位结构与锚点，没有留空", () => {
  const rows = md.split("\n").filter(l => l.startsWith("| `"));
  for (const r of rows) {
    const cols = r.split("|").map(c => c.trim());
    // cols[0] 是空串，cols[1..8] 是八列
    for (let i = 1; i <= 5; i++) {
      assert.ok(cols[i] && cols[i] !== "-" && !/^(TBD|TODO|\?)$/i.test(cols[i]),
        `第 ${i} 列为空：${r.slice(0, 80)}`);
    }
  }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/asset-notes.test.mjs`
Expected: FAIL — `docs/ASSET-NOTES.md` 不存在

- [ ] **Step 3: 列出候选路径**

按五槽各自的需求，从索引里挑候选分支。运行：

```bash
cd /root/crucible-anim && node -e '
const i = JSON.parse(require("fs").readFileSync("data/asset-index.json","utf8"));
const at = p => p.split(".").reduce((o,k)=>o?.[k], i.tree);
const kids = p => { const n = at(p); return n ? Object.keys(n).filter(k=>!k.startsWith("_")) : []; };
for (const p of ["jb2a", "eskie", "blfx", "psfx"]) {
  console.log("\n== " + p + " ==");
  console.log(kids(p).join(" "));
}'
```

再按槽位下钻。需要覆盖的最小集合：

| 槽 | 需要的候选 | 数量下限 |
| --- | --- | --- |
| cast | 通用施法圈 × 12 符文色、近战起手、远程拉弓、技能检定、治疗、增益 | 8 |
| travel | 投射物、射线、锥形、爆发、扇形、触碰、无（近战） | 7 |
| impact | 8 种攻击结果各一 + 12 伤害类型元素层（物理三种共用血迹/火花） | 18 |
| aftermath | 治疗、死亡、地面残留、资源变化 | 6 |
| persist | 47 状态归并成约 12 类（燃烧/冰冻/中毒/腐蚀/眩晕/恐惧/隐形/加速/减速/失能/增益/减益） | 12 |
| 音效 | psfx 的 charge / impact / miss / whoosh，按 12 伤害类型归并 | 10 |
| **合计** | | **61** |

- [ ] **Step 4: 逐个抽帧读图**

对每个候选，先取它的实际文件路径，再生成联系表并**用 Read 工具查看图片**：

```bash
cd /root/crucible-anim && node -e '
const i = JSON.parse(require("fs").readFileSync("data/asset-index.json","utf8"));
const p = process.argv[1];
const n = p.split(".").reduce((o,k)=>o?.[k], i.tree);
const f = typeof n === "string" ? n : Array.isArray(n) ? n[0] : JSON.stringify(Object.keys(n));
console.log(f);
' "jb2a.melee_attack.01.shortsword.01"
```

拿到相对路径后：

```bash
tools/contact-sheet.sh "/root/fvtt14-data/Data/<上一步输出的路径>" /tmp/s.png 6 2
```

然后 Read `/tmp/s.png`，从图上判断并记录：

- **相位结构**：`单段` / `起手-挥击-收招` / `intro-loop-outro` / `扩散` / `循环`
- **锚点**：`中心` / `左缘（朝右发射）` / `施法者脚下` / `目标身上`
- **帧数**：`contact-sheet.sh` 的输出里有 `frames=N`
- **需要 stretchTo**：画面是否是从左向右延伸的定向素材（射线、锥形、近战延伸）
- **需要 mirrorY**：是否有明确朝向、反向使用会穿帮

一次处理 6–8 个候选后写入表格，避免一次性积压太多。

- [ ] **Step 5: 写 `docs/ASSET-NOTES.md`**

格式如下（示例行为实测结果，其余按 Step 4 逐条填）：

```markdown
# 素材侦察记录

每条记录来自 `tools/contact-sheet.sh` 抽帧后的实际读图，不是从文件名推断。
兵库规则改选素材时，必须先在这里补上对应记录。

| DB 路径 | 槽位 | 相位结构 | 锚点 | 帧数 | stretchTo | mirrorY | 备注 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `jb2a.melee_attack.01.shortsword.01` | travel | 起手-挥击-收招 | 左缘朝右 | 66 | 否 | 是 | 含命中闪爆，不要再叠 impact 冲击层，否则双闪 |
```

**备注列是本任务真正的价值所在**——记录只有看图才能发现的坑，例如
「素材自带命中闪爆」「前 10 帧是空帧，需要 startTime 裁掉」
「循环段在 30–50 帧，intro/outro 要拆开用」。

- [ ] **Step 6: 运行测试确认通过**

Run: `cd /root/crucible-anim && node --test test/asset-notes.test.mjs`
Expected: 4 个测试全部 PASS

- [ ] **Step 7: 提交**

```bash
cd /root/crucible-anim
git add -A
git commit -m "素材侦察记录：61 条候选的相位结构与锚点"
```

---

## Task 9: 兵库 S1 cast

**Files:**
- Modify: `scripts/armory/cast.mjs`
- Test: `test/armory-cast.test.mjs`

**Interfaces:**
- Consumes: `ctx`（Task 7）、`docs/ASSET-NOTES.md`（Task 8）
- Produces: `cast.mjs` 默认导出的规则数组新增 8 条，`pri` 落在 300–899

规则清单：

| id | pri | 命中条件 | 表现 |
| --- | --- | --- | --- |
| `spell.gesture.ward` | 780 | `spell.gesture === "ward"` | 防护法阵，符文色 |
| `spell.gesture.conjure` | 780 | `spell.gesture === "conjure"` | 召唤法阵，地面层 |
| `spell.gesture.aspect` | 770 | `spell.gesture === "aspect"` | 自身增益辉光 |
| `spell.composed` | 700 | `spell !== null` | 通用施法圈，符文色 |
| `strike.ranged.draw` | 640 | 有 `projectile1/2` 武器 | 拉弓起手 + 弓弦音 |
| `strike.melee.heavy` | 620 | 有 `heavy1/heavy2/balanced2` 武器 | 不出内容（重武器直接进 travel） |
| `tag.healing` | 420 | `tags` 含 `healing` | 施法者手部绿光 |
| `tag.skill` | 380 | `tags` 含 `skill` | 轻量技能闪光 |

- [ ] **Step 1: 写失败测试**

`test/armory-cast.test.mjs`：

```js
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {resolve} from "../scripts/resolver/resolve.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import cast from "../scripts/armory/cast.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const actions = JSON.parse(readFileSync(join(ROOT, "test/fixtures/actions.json"), "utf8"));
const mk = () => createAssets(offlineBackend(index));
const byId = id => actions.find(a => a.id === id);
const castCue = s => resolve(s, {assets: mk(), armory: ARMORY})?.cues.find(c => c.slot === "cast");

test("规则表规模与 pri 区间合法", () => {
  assert.ok(cast.length >= 9, `只有 ${cast.length} 条规则`);
  for (const r of cast) {
    assert.equal(typeof r.id, "string");
    assert.ok(r.pri >= 0 && r.pri < 1000, `${r.id} 的 pri 越界`);
    assert.equal(typeof r.when, "function");
    assert.equal(typeof r.build, "function");
  }
  const ids = cast.map(r => r.id);
  assert.equal(new Set(ids).size, ids.length, "规则 id 重复");
});

test("ward 姿态命中专属规则而非通用施法圈", () => {
  const c = castCue(byId("spell.frost.ward"));
  assert.equal(c?.rule, "spell.gesture.ward");
});

test("未特化的姿态回落到通用法术规则", () => {
  const c = castCue(byId("spell.storm.surge"));
  assert.equal(c?.rule, "spell.composed");
});

test("12 个符文的通用施法圈都能解析且颜色各异", () => {
  const files = new Set();
  for (const rune of ["control", "death", "earth", "flame", "frost", "illumination",
                      "illusion", "kinesis", "life", "oblivion", "soul", "storm"]) {
    const c = castCue(byId(`spell.${rune}.surge`));
    assert.ok(c?.file, `${rune} 无 cast 特效`);
    files.add(`${c.file}|${JSON.stringify(c.filter)}`);
  }
  assert.ok(files.size >= 6, `12 个符文只产出 ${files.size} 种视觉，配色没起作用`);
});

test("重武器近战不出 cast 内容", () => {
  const s = {...byId("strike"), strikes: [{category: "heavy2", damageType: "slashing"}]};
  assert.equal(castCue(s), undefined);
});

test("弓弩起手带音效轨", () => {
  const s = {...byId("strike"), strikes: [{category: "projectile2", damageType: "piercing"}],
             usage: {...byId("strike").usage, isRanged: true}};
  const plan = resolve(s, {assets: mk(), armory: ARMORY});
  const sounds = plan.cues.filter(c => c.slot === "cast" && c.kind === "sound");
  assert.ok(sounds.length >= 1, "拉弓应有弓弦音");
  assert.ok(sounds[0].file);
});

test("cast 规则不引用绝对路径", () => {
  const src = readFileSync(join(ROOT, "scripts/armory/cast.mjs"), "utf8");
  assert.ok(!src.includes("modules/"), "兵库里出现了绝对路径，必须走 ctx.pick");
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd /root/crucible-anim && node --test test/armory-cast.test.mjs`
Expected: FAIL — 只有兜底规则，`spell.gesture.ward` 等断言不通过

- [ ] **Step 3: 按 ASSET-NOTES 填入 8 条规则**

在 `scripts/armory/cast.mjs` 的 `// ---- 高优先级规则加在这里 ----` 处插入。
路径一律取自 `docs/ASSET-NOTES.md` 中已验证无降级的条目。模板：

```js
  /** 防护姿态：闭合的法阵，地面层，符文色。 */
  {
    id: "spell.gesture.ward", pri: 780,
    when: s => s.spell?.gesture === "ward",
    build: (s, ctx) => {
      const fx = ctx.pick("<ASSET-NOTES 中的防护法阵路径>", {color: ctx.runeColor()});
      if (!fx) return null;
      return {
        file: fx.file,
        objectScale: 1.1 * ctx.geom.sizeScale(),
        belowTokens: true, fadeIn: 300, fadeOut: 500, zIndex: 20,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null,
        waitUntilFinished: -400
      };
    }
  },

  /** 弓弩起手：拉弓动作 + 弓弦音，两条平行轨。 */
  {
    id: "strike.ranged.draw", pri: 640,
    when: s => s.strikes.some(w => ["projectile1", "projectile2"].includes(w.category)),
    build: (s, ctx) => {
      const snd = ctx.sound("<ASSET-NOTES 中的弓弦音路径>");
      const cues = [];
      if (snd) cues.push({kind: "sound", file: snd.file, volume: 0.8});
      return cues.length ? cues : null;
    }
  },

  /** 重武器：起手不出内容，蓄力感由 travel 段的挥击弧线承担。 */
  {
    id: "strike.melee.heavy", pri: 620,
    when: s => s.strikes.some(w => ["heavy1", "heavy2", "balanced2"].includes(w.category)),
    build: () => null
  },
```

其余 5 条同构，逐条填写。每条都要：

1. `when` 只读快照字段，不抛错
2. 路径经 `ctx.pick`，颜色经 `ctx.runeColor()` / `ctx.damageColor()`
3. 有色相补偿时挂 `filter: {type: "ColorMatrix", data: {hue}}`
4. 缩放乘 `ctx.geom.sizeScale()`
5. 需要与下一段衔接时给负值 `waitUntilFinished`

- [ ] **Step 4: 运行全部测试**

Run: `cd /root/crucible-anim && npm test`
Expected: 全绿。特别注意 `test/coverage.test.mjs` 的降级率断言仍 < 15%

- [ ] **Step 5: 提交**

```bash
cd /root/crucible-anim
git add -A
git commit -m "兵库 cast 槽：法术姿态、武器起手与语义标签规则"
```

---

## Task 10: 兵库 S2 travel

本槽承载 §8.2 的三条几何修正：贴身/隔格换素材、大体型补偿、镜像朝向。

**Files:**
- Modify: `scripts/armory/travel.mjs`
- Test: `test/armory-travel.test.mjs`

**Interfaces:**
- Consumes: `ctx.geom`（Task 7）、`docs/ASSET-NOTES.md`（Task 8）
- Produces: `travel.mjs` 新增 9 条规则，`pri` 落在 100–899

规则清单：

| id | pri | 命中条件 | 表现 |
| --- | --- | --- | --- |
| `spell.gesture.ray` | 780 | `gesture === "ray"` | 射线，`stretchTo` 贴合 line 模板 + `mask` |
| `spell.gesture.cone` | 780 | `gesture === "cone"` | 锥形，`stretchTo` + `scale.y` 贴合张角 + `mask` |
| `spell.gesture.pulse` | 770 | `gesture === "pulse"` | 从施法者向外扩散的环 |
| `spell.gesture.surge` | 770 | `gesture === "surge"` | 自身爆发 |
| `spell.gesture.arrow` | 760 | `gesture === "arrow"` | 定向投射物 |
| `strike.melee` | 620 | 有近战武器 | 挥击弧线，贴身/隔格换素材，按 `onLeft` 镜像 |
| `strike.unarmed` | 610 | 有 `unarmed` 武器 | 拳击轨迹 |
| `strike.thrown` | 600 | `tags` 含 `thrown` | 投掷物飞行 |
| `target.blast` | 200 | `target.type === "blast"` | 无飞行段，直接落点 |

- [ ] **Step 1: 写失败测试**

`test/armory-travel.test.mjs`：

```js
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {resolve} from "../scripts/resolver/resolve.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import travel from "../scripts/armory/travel.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const actions = JSON.parse(readFileSync(join(ROOT, "test/fixtures/actions.json"), "utf8"));
const mk = () => createAssets(offlineBackend(index));
const byId = id => actions.find(a => a.id === id);
const travelCues = s => resolve(s, {assets: mk(), armory: ARMORY})?.cues.filter(c => c.slot === "travel") ?? [];

const melee = () => ({
  ...byId("strike"),
  strikes: [{category: "balanced1", damageType: "slashing"}],
  usage: {...byId("strike").usage, isAttack: true, isRanged: false}
});

test("规则表规模与 id 唯一", () => {
  assert.ok(travel.length >= 10, `只有 ${travel.length} 条规则`);
  const ids = travel.map(r => r.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("射线姿态用 stretchTo 且带模板遮罩", () => {
  const c = travelCues(byId("spell.frost.ray"))[0];
  assert.equal(c?.rule, "spell.gesture.ray");
  assert.ok(c.stretchTo, "射线必须 stretchTo");
  assert.equal(c.mask, "region", "射线必须用模板遮罩，否则会溢出");
});

test("锥形姿态贴合模板张角", () => {
  const c = travelCues(byId("spell.flame.cone"))[0];
  assert.equal(c?.rule, "spell.gesture.cone");
  assert.ok(c.stretchTo);
  assert.equal(c.mask, "region");
});

test("近战贴身与隔格用不同素材", () => {
  const base = melee();
  const near = {...base, targets: [base.targets.find(t => t.adjacent)]};
  const far = {...base, targets: [base.targets.find(t => !t.adjacent)]};
  const a = travelCues(near)[0];
  const b = travelCues(far)[0];
  assert.ok(a && b);
  assert.notEqual(a.file, b.file, "贴身与隔格应换素材，否则长度对不上");
});

test("目标在左侧时挥击镜像", () => {
  const base = melee();
  const left = {...base, targets: [{...base.targets[0], onLeft: true, x: 300}]};
  const right = {...base, targets: [{...base.targets[0], onLeft: false, x: 700}]};
  assert.equal(travelCues(left)[0].mirrorY, true);
  assert.equal(travelCues(right)[0].mirrorY, false);
});

test("大体型施法者的挥击放大且偏移折半", () => {
  const base = melee();
  const big = {...base, origin: {...base.origin, width: 3},
               targets: [{...base.targets[0], adjacent: false}]};
  const small = {...base, targets: [{...base.targets[0], adjacent: false}]};
  const bc = travelCues(big)[0];
  const sc = travelCues(small)[0];
  assert.ok(bc.objectScale > sc.objectScale, "大体型应放大");
  assert.ok(bc.offset.x > sc.offset.x, "大体型应前移更多");
});

test("未命中时投射物走 missed", () => {
  const s = {...byId("spell.storm.arrow")};
  s.targets = [{...byId("strike").targets[0], results: [{result: 0, critical: false}]}];
  const c = travelCues(s)[0];
  assert.equal(c.aim?.missed, true);
});

test("爆发姿态没有飞行段", () => {
  const cues = travelCues(byId("spell.death.blast"));
  assert.equal(cues.length, 0, "blast 不应有 travel 内容");
});

test("travel 规则不引用绝对路径", () => {
  const src = readFileSync(join(ROOT, "scripts/armory/travel.mjs"), "utf8");
  assert.ok(!src.includes("modules/"));
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/armory-travel.test.mjs`
Expected: FAIL

- [ ] **Step 3: 填入 9 条规则**

近战规则是本槽的核心，三条几何修正都在这里，完整写出：

```js
  /**
   * 近战挥击。三处几何修正缺一不可：
   *  1. 贴身与隔格用不同长度的素材，否则要么够不着要么穿模
   *  2. 大体型施法者放大 1.4 倍、偏移折半
   *  3. 目标在左侧时镜像，否则武器反手挥
   */
  {
    id: "strike.melee", pri: 620,
    when: s => s.strikes.some(w =>
      ["light1", "simple1", "balanced1", "heavy1", "simple2", "balanced2", "heavy2"]
        .includes(w.category)),
    build: (s, ctx, target) => {
      // ASSET-NOTES 里近战素材分近距/远距两支
      const branch = target.adjacent ? "<贴身分支路径>" : "<隔格分支路径>";
      const fx = ctx.pick(branch, {color: ctx.damageColor() ?? undefined});
      if (!fx) return null;
      return {
        file: fx.file,
        objectScale: 1 * ctx.geom.sizeScale(),
        offset: {x: ctx.geom.offsetFor(target, 0.5), y: 0}, gridUnits: true,
        mirrorY: ctx.geom.onLeft(target),
        aim: {towards: {tokenId: target.tokenId, x: target.x, y: target.y}, missed: false},
        zIndex: 100,
        elevation: target.elevation,
        waitUntilFinished: -600,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null
      };
    }
  },

  /** 射线：贴合 line 模板并用模板遮罩，否则会穿墙溢出。 */
  {
    id: "spell.gesture.ray", pri: 780,
    when: s => s.spell?.gesture === "ray" && s.region?.type === "line",
    build: (s, ctx, target) => {
      const fx = ctx.pick("<ASSET-NOTES 中的射线路径>", {color: ctx.runeColor()});
      if (!fx) return null;
      return {
        file: fx.file,
        stretchTo: {x: target.x, y: target.y},
        mask: "region",
        objectScale: 1, zIndex: 90,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null,
        waitUntilFinished: -200
      };
    }
  },

  /** 锥形：stretchTo 定长度，scale.y 撑张角，同样要遮罩。 */
  {
    id: "spell.gesture.cone", pri: 780,
    when: s => s.spell?.gesture === "cone" && s.region?.type === "cone",
    build: (s, ctx, target) => {
      const fx = ctx.pick("<ASSET-NOTES 中的锥形路径>", {color: ctx.runeColor()});
      if (!fx) return null;
      // JB2A 的锥形素材按 60° 授权；张角更大时纵向拉伸补足
      const yScale = (s.region.angle ?? 60) / 60;
      return {
        file: fx.file,
        stretchTo: {x: s.region.x + s.region.radius, y: s.region.y},
        scale: {x: 1, y: yScale},
        mask: "region", zIndex: 90,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null,
        waitUntilFinished: -300
      };
    }
  },

  /** 爆发：没有飞行段，全部交给 impact。 */
  {
    id: "target.blast", pri: 200,
    when: s => s.target?.type === "blast",
    build: () => null
  },
```

其余 5 条同构填写。

- [ ] **Step 4: 运行全部测试**

Run: `npm test`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
cd /root/crucible-anim
git add -A
git commit -m "兵库 travel 槽：射线锥形贴合模板与近战三处几何修正"
```

---

## Task 11: 兵库 S3 impact

结果层与元素层分开叠加：8 种结果各一条规则，12 种伤害类型作为附加层，
只有 `HIT` / `GLANCE` 才叠。这样 8 × 12 = 96 种组合只需 8 + 12 = 20 条内容。

**Files:**
- Modify: `scripts/armory/impact.mjs`
- Test: `test/armory-impact.test.mjs`

**Interfaces:**
- Consumes: `RESULT` / `RESULT_NAME` / `HIT_RESULTS`（`const.mjs`）、`docs/ASSET-NOTES.md`
- Produces: `impact.mjs` 新增 1 条主规则（`pri` 500，内部按结果分支并叠元素层）
  + 一张模块内的 `ELEMENT_LAYER` 表（12 伤害类型 → 素材路径）
  + 抖动 cue（`kind: "shake"`）

**为什么是一条主规则而不是 8 条：**槽内只取第一个命中的规则，8 条互斥的结果规则也能工作，
但元素层需要与结果层**同时**存在。一条主规则返回 `Cue[]` 更直接，也避免结果层与元素层
的 pri 竞争。

- [ ] **Step 1: 写失败测试**

`test/armory-impact.test.mjs`：

```js
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {resolve} from "../scripts/resolver/resolve.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import {RESULT} from "../scripts/const.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const actions = JSON.parse(readFileSync(join(ROOT, "test/fixtures/actions.json"), "utf8"));
const mk = () => createAssets(offlineBackend(index));
const base = actions.find(a => a.tags.includes("strike") && a.targets.length);

function impactCues(result, {critical = false, damageType = "slashing"} = {}) {
  const s = {
    ...base, usage: {...base.usage, damageType},
    targets: [{...base.targets[0], results: [{result, critical}],
               damage: {total: 8, type: damageType, resource: "health"}}]
  };
  return resolve(s, {assets: mk(), armory: ARMORY}).cues.filter(c => c.slot === "impact");
}

test("8 种结果各自都产出 impact 内容", () => {
  for (const [name, code] of Object.entries(RESULT)) {
    const cues = impactCues(code);
    assert.ok(cues.length > 0, `结果 ${name} 无 impact`);
  }
});

test("命中与掠过叠加元素层，防御类不叠", () => {
  const layers = r => impactCues(r, {damageType: "fire"}).filter(c => c.layer === "element").length;
  assert.ok(layers(RESULT.HIT) >= 1, "命中应有元素层");
  assert.ok(layers(RESULT.GLANCE) >= 1, "掠过应有元素层");
  for (const r of [RESULT.ARMOR, RESULT.BLOCK, RESULT.PARRY, RESULT.RESIST,
                   RESULT.DODGE, RESULT.MISS]) {
    assert.equal(layers(r), 0, `结果 ${r} 不应有元素层`);
  }
});

test("掠过缩小到六成且不抖动", () => {
  const glance = impactCues(RESULT.GLANCE).find(c => c.layer === "result");
  const hit = impactCues(RESULT.HIT).find(c => c.layer === "result");
  assert.ok(glance.objectScale < hit.objectScale);
  assert.equal(impactCues(RESULT.GLANCE).some(c => c.kind === "shake"), false);
});

test("未命中与闪避走 missed，其余不走", () => {
  for (const r of [RESULT.MISS, RESULT.DODGE]) {
    const c = impactCues(r).find(x => x.kind === "effect");
    assert.equal(c.aim?.missed, true, `结果 ${r} 应 missed`);
  }
  const hit = impactCues(RESULT.HIT).find(x => x.kind === "effect");
  assert.equal(hit.aim?.missed, false);
});

test("暴击追加抖动轨且抖动只作用于目标 sprite", () => {
  const cues = impactCues(RESULT.HIT, {critical: true});
  const shake = cues.find(c => c.kind === "shake");
  assert.ok(shake, "暴击应有抖动");
  assert.equal(shake.at.ref, "target", "抖动必须锚在目标，不能是全屏");
  assert.ok(shake.intensity > 0 && shake.duration > 0);
});

test("12 种伤害类型的元素层各自可解析", () => {
  const seen = new Set();
  for (const d of ["bludgeoning", "corruption", "piercing", "slashing", "poison", "acid",
                   "fire", "cold", "electricity", "psychic", "radiant", "void"]) {
    const cues = impactCues(RESULT.HIT, {damageType: d});
    const el = cues.find(c => c.layer === "element");
    assert.ok(el?.file, `伤害类型 ${d} 无元素层素材`);
    seen.add(el.file);
  }
  assert.ok(seen.size >= 5, `12 种伤害类型只有 ${seen.size} 种视觉，区分度不足`);
});

test("每个 cue 的 playIf 与实际结果一致", () => {
  const cues = impactCues(RESULT.BLOCK);
  for (const c of cues) {
    assert.ok(["always", "block", "defended"].includes(c.playIf),
      `格挡场景下出现了 playIf=${c.playIf}`);
  }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/armory-impact.test.mjs`
Expected: FAIL

- [ ] **Step 3: 改写 `scripts/armory/impact.mjs`**

```js
import {RESULT, RESULT_NAME, HIT_RESULTS} from "../const.mjs";

/**
 * 结果层：8 种攻击结果各自的表现，与伤害元素无关。
 * 路径取自 docs/ASSET-NOTES.md 中已验证的条目。
 */
const RESULT_LAYER = {
  [RESULT.HIT]:    {path: "<命中冲击>",   scale: 1.0,  missed: false, shake: true},
  [RESULT.GLANCE]: {path: "<命中冲击>",   scale: 0.6,  missed: false, shake: false},
  [RESULT.ARMOR]:  {path: "<金属刮擦>",   scale: 0.8,  missed: false, shake: false},
  [RESULT.BLOCK]:  {path: "<盾牌闪光>",   scale: 0.9,  missed: false, shake: false},
  [RESULT.PARRY]:  {path: "<兵器交击>",   scale: 0.8,  missed: false, shake: false},
  [RESULT.RESIST]: {path: "<抗性辉光>",   scale: 1.0,  missed: false, shake: false},
  [RESULT.DODGE]:  {path: "<残影>",       scale: 0.8,  missed: true,  shake: false},
  [RESULT.MISS]:   {path: "<落空>",       scale: 0.7,  missed: true,  shake: false}
};

/** 元素层：仅在命中类结果上叠加。物理三种共用血迹。 */
const ELEMENT_LAYER = {
  bludgeoning: "<血迹>", piercing: "<血迹>", slashing: "<血迹>",
  fire: "<火>", cold: "<冰>", electricity: "<电>", acid: "<酸>",
  poison: "<毒>", radiant: "<光>", void: "<虚空>", psychic: "<灵能>",
  corruption: "<腐蚀>"
};

export default [
  /**
   * 结果层 + 元素层叠加。一条规则返回多个 cue，避免两层争抢 pri。
   */
  {
    id: "impact.layered", pri: 500,
    when: s => s.usage.isAttack,
    build: (s, ctx, target) => {
      const hit = target.results[0] ?? {result: RESULT.HIT, critical: false};
      const spec = RESULT_LAYER[hit.result] ?? RESULT_LAYER[RESULT.HIT];
      const name = RESULT_NAME[hit.result] ?? "always";
      const aim = {towards: {tokenId: target.tokenId, x: target.x, y: target.y},
                   missed: spec.missed};
      const cues = [];

      const color = ctx.damageColor();
      const base = ctx.pick(spec.path, color ? {color} : undefined);
      if (base) {
        cues.push({
          layer: "result", file: base.file, playIf: name,
          objectScale: spec.scale * ctx.geom.sizeScale(),
          aim, zIndex: 60, elevation: target.elevation,
          filter: base.hue ? {type: "ColorMatrix", data: {hue: base.hue}} : null
        });
      }

      if (HIT_RESULTS.includes(hit.result)) {
        const elPath = ELEMENT_LAYER[s.usage.damageType ?? "bludgeoning"];
        const el = elPath ? ctx.pick(elPath, color ? {color} : undefined) : null;
        if (el) {
          cues.push({
            layer: "element", file: el.file, playIf: name,
            objectScale: spec.scale * 0.9 * ctx.geom.sizeScale(),
            aim, delay: 60, zIndex: 65, randomRotation: true,
            filter: el.hue ? {type: "ColorMatrix", data: {hue: el.hue}} : null
          });
        }
      }

      // 抖动只作用于目标 sprite 的副本，不震全屏。取自 blfx 的做法。
      if (spec.shake && hit.critical) {
        cues.push({
          kind: "shake", layer: "shake", playIf: name,
          intensity: 0.08, duration: 400, delay: 40
        });
      }
      return cues.length ? cues : null;
    }
  },

  /** 兜底保留：非攻击动作若有目标，给一层极轻的中性反馈。 */
  {
    id: "generic.impact", pri: 10,
    when: () => true,
    build: (s, ctx, target) => {
      const fx = ctx.pick("<中性轻反馈>");
      if (!fx) return null;
      return {file: fx.file, objectScale: 0.6, opacity: 0.7, attachTo: true, zIndex: 55,
              at: {ref: "target", tokenId: target.tokenId, uuid: target.uuid,
                   x: target.x, y: target.y}};
    }
  }
];
```

把 `<...>` 占位全部替换成 `docs/ASSET-NOTES.md` 中已验证的 DB 路径。
若某个结果找不到贴切素材，就复用相近的并在 ASSET-NOTES 备注列写明理由，
**不要留占位符**。

- [ ] **Step 4: 运行全部测试**

Run: `cd /root/crucible-anim && npm test`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
cd /root/crucible-anim
git add -A
git commit -m "兵库 impact 槽：8 种攻击结果与 12 种伤害元素分层叠加"
```

---

## Task 12: 兵库 S4 aftermath 与 S5 persist

47 个状态归并成约 12 类，避免为每个状态单独选材。

**Files:**
- Modify: `scripts/armory/aftermath.mjs`, `scripts/armory/persist.mjs`
- Test: `test/armory-persist.test.mjs`

**Interfaces:**
- Consumes: `docs/ASSET-NOTES.md`
- Produces:
  - `aftermath.mjs` 新增 4 条规则（治疗、击杀、地面残留、士气变化）
  - `persist.mjs` 新增 12 条规则 + 模块内的 `STATUS_GROUP` 表（47 状态 → 12 类）

状态分组：

| 组 | 状态 |
| --- | --- |
| `burning` | burning |
| `freezing` | freezing |
| `poison` | poisoned, diseased, corroding |
| `decay` | decaying, entropy, irradiated, corruption 相关 |
| `bleed` | bleeding |
| `stun` | stunned, staggered, paralyzed, incapacitated, asleep, dead |
| `fear` | frightened, broken, insane, confused, dominated, disoriented |
| `hidden` | invisible, unaware, hide 相关 |
| `haste` | hastened, limitless, inspired, resolute |
| `slow` | slowed, restrained, prone, overrun, exhausted, suffocating |
| `buff` | guarded, invulnerable, mending, enraged, flying, burrowing |
| `debuff` | weakened, exposed, blinded, deafened, silenced, shocked, flanked, falling |

- [ ] **Step 1: 写失败测试**

`test/armory-persist.test.mjs`：

```js
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {resolve, resolveEffect} from "../scripts/resolver/resolve.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import persist from "../scripts/armory/persist.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const effects = JSON.parse(readFileSync(join(ROOT, "test/fixtures/effects.json"), "utf8"));
const actions = JSON.parse(readFileSync(join(ROOT, "test/fixtures/actions.json"), "utf8"));
const mk = () => createAssets(offlineBackend(index));
const planFor = id => resolveEffect(effects.find(e => e.statusId === id), {assets: mk(), armory: ARMORY});

test("persist 规则表规模", () => {
  assert.ok(persist.length >= 13, `只有 ${persist.length} 条（12 组 + 兜底）`);
});

test("每个 persist cue 都带 persist 与 tieTo，否则效果移除后动画不会清理", () => {
  for (const e of effects) {
    const plan = resolveEffect(e, {assets: mk(), armory: ARMORY});
    for (const c of plan.cues) {
      assert.equal(c.persist, true, `${e.statusId} 的 cue 没开 persist`);
      assert.equal(c.tieTo, e.effectUuid, `${e.statusId} 的 tieTo 不是 effectUuid`);
    }
  }
});

test("同组状态共用素材，不同组视觉可区分", () => {
  const f = id => planFor(id).cues[0].file;
  assert.equal(f("poisoned"), f("diseased"), "同组应共用");
  assert.notEqual(f("burning"), f("freezing"), "不同组应可区分");
  const groups = new Set(effects.map(e => planFor(e.statusId).cues[0].rule));
  assert.ok(groups.size >= 10, `47 个状态只归出 ${groups.size} 组，区分度不足`);
});

test("燃烧与冰冻命中专属规则而非兜底", () => {
  assert.notEqual(planFor("burning").cues[0].rule, "generic.persist");
  assert.notEqual(planFor("freezing").cues[0].rule, "generic.persist");
});

test("治疗动作产出 aftermath 辉光", () => {
  const base = actions.find(a => a.targets.length);
  const s = {...base, targets: [{...base.targets[0], healed: 12}]};
  const cues = resolve(s, {assets: mk(), armory: ARMORY}).cues.filter(c => c.slot === "aftermath");
  assert.ok(cues.length >= 1);
  assert.ok(cues[0].file);
});

test("兵库两文件均不引用绝对路径", () => {
  for (const f of ["aftermath.mjs", "persist.mjs"]) {
    const src = readFileSync(join(ROOT, "scripts/armory", f), "utf8");
    assert.ok(!src.includes("modules/"), `${f} 出现绝对路径`);
  }
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/armory-persist.test.mjs`
Expected: FAIL

- [ ] **Step 3: 改写 `scripts/armory/persist.mjs`**

```js
/**
 * S5 persist：状态效果的持续特效。
 *
 * 由 ActiveEffect 的创建/删除驱动，不属于任何动作。每个 cue 必须同时带
 * persist + tieTo，Sequencer 才会在效果被移除时自动清理动画；否则光效会永久残留。
 *
 * 47 个状态归并成 12 组，避免逐个选材。
 */

const STATUS_GROUP = {
  burning: "burning",
  freezing: "freezing",
  poisoned: "poison", diseased: "poison", corroding: "poison",
  decaying: "decay", entropy: "decay", irradiated: "decay",
  bleeding: "bleed",
  stunned: "stun", staggered: "stun", paralyzed: "stun",
  incapacitated: "stun", asleep: "stun", dead: "stun",
  frightened: "fear", broken: "fear", insane: "fear",
  confused: "fear", dominated: "fear", disoriented: "fear",
  invisible: "hidden", unaware: "hidden",
  hastened: "haste", limitless: "haste", inspired: "haste", resolute: "haste",
  slowed: "slow", restrained: "slow", prone: "slow",
  overrun: "slow", exhausted: "slow", suffocating: "slow",
  guarded: "buff", invulnerable: "buff", mending: "buff",
  enraged: "buff", flying: "buff", burrowing: "buff",
  weakened: "debuff", exposed: "debuff", blinded: "debuff", deafened: "debuff",
  silenced: "debuff", shocked: "debuff", flanked: "debuff", falling: "debuff"
};

/** 每组的素材与呈现参数。路径取自 docs/ASSET-NOTES.md。 */
const GROUP_FX = {
  burning:  {path: "<燃烧循环>",   color: "orange",      scale: 1.0, below: false, opacity: 0.9},
  freezing: {path: "<冰冻循环>",   color: "blue",        scale: 1.0, below: false, opacity: 0.8},
  poison:   {path: "<中毒循环>",   color: "green",       scale: 0.9, below: false, opacity: 0.7},
  decay:    {path: "<腐朽循环>",   color: "dark_green",  scale: 0.9, below: false, opacity: 0.7},
  bleed:    {path: "<流血循环>",   color: "red",         scale: 0.8, below: true,  opacity: 0.8},
  stun:     {path: "<眩晕循环>",   color: "yellow",      scale: 0.7, below: false, opacity: 0.9},
  fear:     {path: "<恐惧循环>",   color: "purple",      scale: 0.9, below: false, opacity: 0.7},
  hidden:   {path: "<隐匿循环>",   color: "blue",        scale: 1.0, below: false, opacity: 0.4},
  haste:    {path: "<加速循环>",   color: "yellow",      scale: 1.0, below: true,  opacity: 0.7},
  slow:     {path: "<迟缓循环>",   color: "dark_blue",   scale: 1.0, below: true,  opacity: 0.7},
  buff:     {path: "<增益循环>",   color: "teal",        scale: 1.0, below: true,  opacity: 0.6},
  debuff:   {path: "<减益循环>",   color: "dark_purple", scale: 1.0, below: true,  opacity: 0.6}
};

/** 为一个分组生成规则。12 组结构相同，只有素材与参数不同。 */
function groupRule(group, pri) {
  return {
    id: `status.${group}`, pri,
    when: e => STATUS_GROUP[e.statusId] === group,
    build: (e, ctx) => {
      const cfg = GROUP_FX[group];
      const fx = ctx.pick(cfg.path, {color: cfg.color});
      if (!fx) return null;
      return {
        file: fx.file,
        objectScale: cfg.scale, attachTo: true, bindScale: true,
        belowTokens: cfg.below, opacity: cfg.opacity,
        persist: true, tieTo: e.effectUuid, extraEndDuration: 300,
        fadeIn: 400, fadeOut: 400, zIndex: cfg.below ? 10 : 40,
        randomizeMirrorY: true,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null
      };
    }
  };
}

export default [
  ...Object.keys(GROUP_FX).map((g, i) => groupRule(g, 500 - i)),

  /** 兜底：未归组的状态挂一层中性光环，保证无一黑屏。 */
  {
    id: "generic.persist", pri: 10,
    when: () => true,
    build: (e, ctx) => {
      const fx = ctx.pick("<中性光环>");
      if (!fx) return null;
      return {
        file: fx.file, objectScale: 1, attachTo: true, bindScale: true, belowTokens: true,
        persist: true, tieTo: e.effectUuid, extraEndDuration: 300,
        opacity: 0.5, zIndex: 10, fadeIn: 400, fadeOut: 400
      };
    }
  }
];
```

- [ ] **Step 4: 补 `scripts/armory/aftermath.mjs` 的 4 条规则**

在 `// ---- 高优先级规则加在这里 ----` 处插入：治疗辉光（`pri` 420）、
击杀（目标 `damage.total` 使其归零时的地面血泊，`pri` 430）、
地面残留（法术 blast/cone 后的焦痕，`pri` 300，`belowTokens: true`）、
士气变化（`usage.resource === "morale"`，`pri` 380）。结构同 persist 的分组规则。

- [ ] **Step 5: 运行全部测试**

Run: `cd /root/crucible-anim && npm test`
Expected: 全绿；`test/coverage.test.mjs` 的 47 状态断言应通过

- [ ] **Step 6: 提交**

```bash
cd /root/crucible-anim
git add -A
git commit -m "兵库 aftermath 与 persist 槽：47 状态归并 12 组持续特效"
```

---

## Task 13: 播放层

**Files:**
- Create: `scripts/player/semaphore.mjs`, `scripts/player/play.mjs`
- Test: `test/semaphore.test.mjs`

**Interfaces:**
- Consumes: `const.mjs`、`settings.mjs`
- Produces:
  - `createSemaphore({timeoutMs = 8000}) -> {run(fn): Promise<any>, pending: number}`
  - `playPlan(plan, {volume, shake, resolveRef}) -> Promise<void>`
    - `resolveRef(at)` 由调用方注入，把 `{ref, tokenId, uuid, x, y}` 解析成 Sequencer 能接受的目标（Token 对象或 `{x, y}`）。注入而非直接查 `canvas`，是为了让播放层能在预览宏里复用。

`playPlan` 只构造一条 `Sequence`，按 cue 顺序链接。`playIf` 在构造时求值成布尔量，
但仍用 `.playIf()` 交给 Sequencer——这样序列结构恒定，便于调试比对。

- [ ] **Step 1: 写失败测试**

`test/semaphore.test.mjs`（只测信号量；`play.mjs` 依赖 Sequencer 全局，由 Task 16 人工验收）：

```js
import {test} from "node:test";
import assert from "node:assert/strict";
import {createSemaphore} from "../scripts/player/semaphore.mjs";

const sleep = ms => new Promise(r => setTimeout(r, ms));

test("任务串行执行，不重叠", async () => {
  const sem = createSemaphore({timeoutMs: 2000});
  const log = [];
  await Promise.all([1, 2, 3].map(i => sem.run(async () => {
    log.push(`start${i}`);
    await sleep(20);
    log.push(`end${i}`);
  })));
  for (let i = 0; i < log.length; i += 2) {
    assert.ok(log[i].startsWith("start") && log[i + 1].startsWith("end"),
      `第 ${i} 处发生重叠: ${log.join(",")}`);
    assert.equal(log[i].slice(5), log[i + 1].slice(3));
  }
});

test("任务抛错不会卡死队列", async () => {
  const sem = createSemaphore({timeoutMs: 2000});
  await assert.rejects(sem.run(async () => { throw new Error("boom"); }));
  assert.equal(await sem.run(async () => "ok"), "ok");
  assert.equal(sem.pending, 0);
});

test("超时的任务不会永久阻塞后续任务", async () => {
  const sem = createSemaphore({timeoutMs: 60});
  const slow = sem.run(() => new Promise(() => {}));   // 永不 resolve
  const t0 = Date.now();
  const r = await sem.run(async () => "after");
  assert.equal(r, "after");
  assert.ok(Date.now() - t0 < 1000, "后续任务等待过久");
  slow.catch(() => {});
});

test("pending 反映排队数量", async () => {
  const sem = createSemaphore({timeoutMs: 2000});
  const p = [sem.run(() => sleep(30)), sem.run(() => sleep(30))];
  assert.ok(sem.pending >= 1);
  await Promise.all(p);
  assert.equal(sem.pending, 0);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/semaphore.test.mjs`
Expected: FAIL

- [ ] **Step 3: 写 `scripts/player/semaphore.mjs`**

```js
/**
 * 串行化动画播放。
 *
 * 多个动作接连确认时（连续反击、多目标群体动作、多人同时出手），并发播放会让画面
 * 叠成一团。用一个带超时的信号量把它们排成队。取自 blfx 的 waitForSemaphore 做法，
 * 超时上限保证单条卡住的序列不会永久阻塞后续动画。
 */
export function createSemaphore({timeoutMs = 8000} = {}) {
  let tail = Promise.resolve();
  let pending = 0;

  function run(fn) {
    pending++;
    const slot = tail.then(() => {
      // 单条任务最多占用 timeoutMs，超时后放行队列（任务本身继续跑完）
      return Promise.race([
        Promise.resolve().then(fn),
        new Promise(resolve => setTimeout(resolve, timeoutMs))
      ]);
    });
    // 队列尾部吞掉异常，否则一次失败会毒化后续所有任务
    tail = slot.then(() => {}, () => {});
    return slot.finally(() => { pending--; });
  }

  return {run, get pending() { return pending; }};
}
```

注意 `run` 返回的是 `slot` 而非 `tail`：调用方能拿到真实的成功/失败，
而队列本身只关心「这一格结束了」。

- [ ] **Step 4: 写 `scripts/player/play.mjs`**

```js
import {PLAN_VERSION} from "../const.mjs";
import {debug, warn} from "../log.mjs";

/** playIf 词汇 → 判定函数。cue 自带的结果名与实际结果比对。 */
function shouldPlay(cue) {
  return cue.playIf !== "never";
}

/**
 * 把一条 FXPlan 交给 Sequencer 播放。
 * @param {FXPlan} plan
 * @param {{volume: number, shake: boolean, resolveRef: (at: object) => any}} opts
 */
export async function playPlan(plan, {volume = 1, shake = true, resolveRef}) {
  if (!plan) return;
  if (plan.v !== PLAN_VERSION) {
    warn(`跳过版本不符的动画计划：v${plan.v}，当前 v${PLAN_VERSION}`);
    return;
  }
  debug("播放计划", plan);

  const seq = new Sequence({moduleName: "crucible-anim", softFail: true});

  for (const cue of plan.cues) {
    const target = resolveRef(cue.at);
    if (!target) continue;

    if (cue.kind === "sound") {
      seq.sound()
        .playIf(shouldPlay(cue))
        .file(cue.file)
        .volume((cue.volume ?? 1) * volume)
        .delay(cue.delay)
        .startTime(cue.startTime);
      if (cue.waitUntilFinished !== null) seq.waitUntilFinished(cue.waitUntilFinished);
      continue;
    }

    if (cue.kind === "shake") {
      // 只抖目标 sprite 的副本，不震全屏——全屏震动会让其他玩家不适。
      seq.effect()
        .playIf(shake && shouldPlay(cue))
        .copySprite(target)
        .zIndex(0)
        .delay(cue.delay)
        .duration(cue.duration ?? 400)
        .loopProperty("sprite", "position.x", {
          from: -(cue.intensity ?? 0.08), to: (cue.intensity ?? 0.08),
          duration: 60, pingPong: true
        });
      continue;
    }

    const e = seq.effect()
      .playIf(shouldPlay(cue))
      .file(cue.file)
      .opacity(cue.opacity)
      .fadeIn(cue.fadeIn, {ease: cue.fadeInEase})
      .fadeOut(cue.fadeOut, {ease: cue.fadeOutEase})
      .zIndex(cue.zIndex)
      .delay(cue.delay)
      .startTime(cue.startTime)
      .playbackRate(cue.playbackRate)
      .belowTokens(cue.belowTokens)
      .locally(cue.local);

    if (cue.attachTo) e.attachTo(target, {bindScale: cue.bindScale});
    else e.atLocation(target, {gridUnits: cue.gridUnits});

    if (cue.aim) {
      const towards = resolveRef({ref: "point", ...cue.aim.towards}) ?? cue.aim.towards;
      e.rotateTowards(towards, {rotationOffset: cue.aim.rotationOffset ?? 0});
      if (cue.aim.missed) e.missed(true);
    }
    if (cue.stretchTo) e.stretchTo(cue.stretchTo);

    // scaleToObject 是主流缩放方式；只有显式给了 scale 才用绝对缩放（锥形撑张角等）
    if (cue.scale) e.scale(cue.scale);
    else e.scaleToObject(cue.objectScale);

    if (cue.offset && (cue.offset.x || cue.offset.y)) {
      e.spriteOffset({x: cue.offset.x, y: cue.offset.y}, {gridUnits: cue.gridUnits});
    }
    if (cue.mirrorY) e.mirrorY(true);
    if (cue.randomizeMirrorY) e.randomizeMirrorY();
    if (cue.randomRotation) e.randomRotation();
    if (cue.elevation !== null) e.elevation(cue.elevation, {absolute: true});
    if (cue.duration !== null) e.duration(cue.duration);
    if (cue.tint) e.tint(cue.tint);
    if (cue.filter) e.filter(cue.filter.type, cue.filter.data);
    if (cue.mask === "region" && plan.regionShape) e.mask(plan.regionShape);

    if (cue.persist) {
      e.persist(true, {persistTokenPrototype: false});

      // 【多客户端契约】绝不让 Sequencer 把本模组的效果写进世界存档。
      // 依据与后果见 resolver/resolve.mjs 的 CUE_DEFAULTS.worldPersist 与 DESIGN §6.7。
      // 写 `!== true` 而不是 `=== false`：字段缺失（旧 plan、将来漏填默认值）时也落在
      // 不写盘的安全侧。test/armory-persist.test.mjs 有一条 grep 守卫盯着这一行。
      e.temporary(cue.worldPersist !== true);

      // 身份用 origin 而不是 name，两个理由：
      //  1. 设了 name 会让 Sequencer 额外挂一个逐帧 ticker 往 PositionContainer 写坐标，
      //     persist 用不到；origin 不挂。
      //  2. 原草案的 `crucible-anim:${plan.source}:${cue.rule}` 里 plan.source 是 statusId，
      //     两个 token 同挂 burning 会撞名。origin 用 effectUuid 天然唯一。
      // Task 15 的 deleteActiveEffect 兜底必须按 origin 过滤，见那一节。
      if (cue.tieTo) {
        e.origin(cue.tieTo);
        e.tieToDocuments([cue.tieTo]);
      }
      if (cue.extraEndDuration) e.extraEndDuration(cue.extraEndDuration);
    }
    if (cue.waitUntilFinished !== null) e.waitUntilFinished(cue.waitUntilFinished);
  }

  // local:true 是全槽通用的，不只 persist。少了它，preload 会走
  // Sequencer.Preloader.preloadForClients：向全场广播预载请求并**阻塞等所有客户端逐个
  // 应答**（带 ping 超时轮询）。本模组每个客户端都各播一份，于是每个动画都变成 N 次
  // 全场往返 + 等最慢的那台机器；role=PLAYER 还没有 permissions-preload 权限（默认 1），
  // 会走降级警告刷控制台。
  await seq.play({local: true, preload: true});
}
```

- [ ] **Step 5: 运行测试确认通过**

Run: `node --test test/semaphore.test.mjs`
Expected: 4 个测试全部 PASS

`play.mjs` 无 headless 测试（依赖 Sequencer 全局），由 Task 15 的预览宏与 Task 16 的
人工验收覆盖。它不被任何 headless 测试 import，因此不影响 `npm test`。

- [ ] **Step 6: 提交**

```bash
cd /root/crucible-anim
git add -A
git commit -m "播放层：并发信号量与 Sequencer 序列构造"
```

---

## Task 14: 触发层与传输通道

**Files:**
- Create: `scripts/trigger/wrap.mjs`, `scripts/trigger/dispatch.mjs`
- Modify: `scripts/main.mjs`（挂载两者）
- Test: `test/wrap.test.mjs`

**Interfaces:**
- Consumes: `snapshot.mjs`（Task 6）、`resolve.mjs`（Task 7）、`play.mjs`（Task 13）
- Produces:
  - `installWrap() -> void` — 包装 `CrucibleAction.prototype.configureVFXEffect`
  - `installDispatch() -> void` — 注册 `updateChatMessage` 钩子
  - `buildPlanFor(action, env, deps) -> FXPlan|null` — 从 wrap 中抽出的纯逻辑，可单测
  - `resolveRefIn(scene)` — 把 `at` 解析成 Token 或点，供 `playPlan` 注入

**关键约束：**包装体整体 `try/catch`。Crucible 迭代快，任何异常都必须降级为
「走原生路径」，绝不能阻断玩家出手。

- [ ] **Step 1: 写失败测试**

`test/wrap.test.mjs`：

```js
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import {buildPlanFor} from "../scripts/trigger/wrap.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const ENV = {gridSize: 100, distancePixels: 100};
const deps = () => ({assets: createAssets(offlineBackend(index)), armory: ARMORY});

function mockAction(overrides = {}) {
  const targetActor = {id: "a1"};
  const targetToken = {id: "t1", uuid: "Scene.s.Token.t1",
                       document: {elevation: 0, width: 1, height: 1, uuid: "Scene.s.Token.t1"},
                       center: {x: 600, y: 500}};
  return {
    id: "reactiveStrike", name: "反击",
    tags: new Set(["strike", "melee", "slashing"]),
    target: {type: "single", number: 1, distance: 1, scope: 2},
    range: {minimum: 0, maximum: 1}, cost: {action: 1, focus: 0, heroism: 0, health: 0},
    region: null, actor: {type: "hero"},
    token: {id: "t0", document: {elevation: 0, width: 1, height: 1}, center: {x: 500, y: 500}},
    targets: new Map([[targetActor, {token: targetToken}]]),
    usage: {damageType: "slashing", isAttack: true, isRanged: false,
            strikes: [{category: "balanced1", system: {damageType: "slashing"}}]},
    eventsByTarget: new Map([[targetActor,
      {all: [], roll: [{roll: {data: {result: 7, strike: 0}, isCriticalSuccess: false}}]}]]),
    ...overrides
  };
}

test("原生已产出配置时不接管，返回 null 计划", () => {
  const plan = buildPlanFor(mockAction(), ENV, deps(), {nativeConfig: {components: {}}});
  assert.equal(plan, null, "原生有动画时本模组必须让位");
});

test("原生返回 null 时接管并产出计划", () => {
  const plan = buildPlanFor(mockAction(), ENV, deps(), {nativeConfig: null});
  assert.ok(plan, "应接管");
  assert.equal(plan.v, 1);
  assert.ok(plan.cues.length > 0);
});

test("计划可 JSON 往返，能安全塞进聊天卡 flag", () => {
  const plan = buildPlanFor(mockAction(), ENV, deps(), {nativeConfig: null});
  assert.deepEqual(JSON.parse(JSON.stringify(plan)), plan);
});

test("快照阶段抛错时返回 null 而不外抛", () => {
  const broken = mockAction({get tags() { throw new Error("boom"); }});
  assert.doesNotThrow(() => {
    assert.equal(buildPlanFor(broken, ENV, deps(), {nativeConfig: null}), null);
  });
});

test("同一动作两次产出完全相同的计划", () => {
  const a = buildPlanFor(mockAction(), ENV, deps(), {nativeConfig: null});
  const b = buildPlanFor(mockAction(), ENV, deps(), {nativeConfig: null});
  assert.deepEqual(a, b);
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/wrap.test.mjs`
Expected: FAIL

- [ ] **Step 3: 写 `scripts/trigger/wrap.mjs`**

```js
import {META_KEY} from "../const.mjs";
import {snapshotAction} from "./snapshot.mjs";
import {resolve} from "../resolver/resolve.mjs";
import {debug, warn, error} from "../log.mjs";

/**
 * 纯逻辑：决定是否接管，接管则产出计划。抽出来是为了能脱离 Foundry 单测。
 *
 * 「只补空缺」的判定压缩成一个条件：Crucible 全部 gesture configurator 与
 * configureStrikeVFXEffect 都以 return null 优雅退出，因此
 * 「原生链最终返回 null」⟺「系统对此动作无动画」。
 *
 * @param {CrucibleAction} action
 * @param {{gridSize: number, distancePixels: number}} env
 * @param {{assets: object, armory: object}} deps
 * @param {{nativeConfig: object|null}} ctx
 * @returns {FXPlan|null}
 */
export function buildPlanFor(action, env, deps, {nativeConfig}) {
  if (nativeConfig) return null;                 // 原生已有动画，让位
  try {
    const snapshot = snapshotAction(action, env);
    const plan = resolve(snapshot, deps);
    if (plan) debug(`接管 ${action.id}`, {snapshot, plan});
    return plan;
  } catch (err) {
    error(`为 ${action?.id} 构造动画计划失败，已降级为无动画`, err);
    return null;
  }
}

/**
 * 包装 CrucibleAction#configureVFXEffect。
 *
 * 包装体整体 try/catch：Crucible 迭代快，任何异常都必须降级为走原生路径，
 * 绝不能阻断玩家出手。
 *
 * @param {{assets: object, armory: object}} deps
 */
export function installWrap(deps) {
  const proto = crucible.api.models.CrucibleAction.prototype;
  const original = proto.configureVFXEffect;

  proto.configureVFXEffect = function wrappedConfigureVFXEffect(...args) {
    let nativeConfig = null;
    try { nativeConfig = original.apply(this, args); }
    catch (err) { error("原生 configureVFXEffect 抛错", err); }

    try {
      const env = {
        gridSize: canvas?.dimensions?.size ?? 100,
        distancePixels: canvas?.dimensions?.distancePixels ?? 100
      };
      const plan = buildPlanFor(this, env, deps, {nativeConfig});
      if (plan) {
        // metadata 会随 flags.crucible.metadata 序列化进聊天卡并广播给所有客户端
        this.metadata ??= {};
        this.metadata[META_KEY] = plan;
      }
    } catch (err) {
      error("动画包装体失败，已降级", err);
    }
    return nativeConfig;
  };
}
```

- [ ] **Step 4: 写 `scripts/trigger/dispatch.mjs`**

```js
import {MODULE_ID, META_KEY, SETTINGS} from "../const.mjs";
import {getSetting} from "../settings.mjs";
import {playPlan} from "../player/play.mjs";
import {createSemaphore} from "../player/semaphore.mjs";
import {debug, warn} from "../log.mjs";

const semaphore = createSemaphore({timeoutMs: 8000});

/** 本模组与 Crucible 的动画开关必须同时为真。 */
export function animationsEnabled() {
  try {
    if (!game.settings.get("crucible", "enableVFX")) return false;
    return getSetting(SETTINGS.ENABLED) === true;
  } catch { return false; }
}

/**
 * 把计划里的 at 引用解析成 Sequencer 能接受的目标。
 * 注入而非直接查全局，是为了让预览宏能复用播放层。
 */
export function resolveRefIn(scene) {
  return function resolveRef(at) {
    if (!at) return null;
    if (at.ref === "origin" || at.ref === "target") {
      const tok = at.uuid ? fromUuidSync(at.uuid)?.object : null;
      if (tok) return tok;
      const byId = scene?.tokens?.get?.(at.tokenId)?.object;
      if (byId) return byId;
    }
    if (Number.isFinite(at.x) && Number.isFinite(at.y)) return {x: at.x, y: at.y};
    return null;
  };
}

/** 播放一条聊天消息携带的动画计划。 */
export async function playFromMessage(message) {
  const plan = message?.flags?.crucible?.metadata?.[META_KEY];
  if (!plan) return;
  if (!animationsEnabled()) return;
  const scene = message.flags?.crucible?.token
    ? fromUuidSync(message.flags.crucible.token)?.parent
    : canvas.scene;
  if (!scene?.isView) return;                   // 不在当前视图的场景不播

  await semaphore.run(() => playPlan(plan, {
    volume: getSetting(SETTINGS.VOLUME),
    shake: getSetting(SETTINGS.SHAKE),
    resolveRef: resolveRefIn(scene)
  })).catch(err => warn("动画播放失败", err));
}

/**
 * 复用 Crucible 自己的闸门：动画只在 confirmed 由假翻真时播放。
 * 白拿三件事：撤销动作不播、3D 骰子播完才播（Crucible 已在 #autoConfirmMessage 里 await 过）、
 * 各客户端本地播放因此不需要 socket，也就不会双播。
 */
export function installDispatch() {
  Hooks.on("updateChatMessage", (message, changed) => {
    const flags = message.flags?.crucible ?? {};
    if (!flags.action) return;
    if (foundry.utils.getProperty(changed, "flags.crucible.confirmed") !== true) return;
    debug(`聊天卡 ${message.id} 已确认，尝试播放`);
    message._canimPlayback = playFromMessage(message);
  });
}
```

- [ ] **Step 5: 在 `scripts/main.mjs` 中挂载**

在 `Hooks.once("ready")` 的自检通过之后追加：

```js
  const {createAssets, runtimeBackend} = await import("./resolver/assets.mjs");
  const {ARMORY} = await import("./armory/index.mjs");
  const {installWrap} = await import("./trigger/wrap.mjs");
  const {installDispatch} = await import("./trigger/dispatch.mjs");

  const deps = {assets: createAssets(runtimeBackend()), armory: ARMORY};
  installWrap(deps);
  installDispatch();
  log("触发层已挂载");
```

同时把 `Hooks.once("ready", () => {...})` 改成 `async` 回调以支持顶部的动态 import。

- [ ] **Step 6: 运行全部测试**

Run: `cd /root/crucible-anim && npm test`
Expected: 全绿

- [ ] **Step 7: 提交**

```bash
cd /root/crucible-anim
git add -A
git commit -m "触发层：configureVFXEffect 包装与聊天卡播放闸门"
```

---

## Task 15: 状态触发、重放菜单与预览宏

**Files:**
- Create: `scripts/trigger/effects.mjs`, `scripts/player/preview.mjs`
- Modify: `scripts/main.mjs`
- Test: `test/effects-trigger.test.mjs`

**Interfaces:**
- Consumes: `snapshotEffect`（Task 6）、`resolveEffect`（Task 7）、`playPlan`（Task 13）
- Produces:
  - `installEffectTriggers(deps) -> void`
  - `planForEffect(effect, token, env, deps) -> FXPlan|null`（可单测）
  - `installReplayMenu() -> void`
  - `installPreview() -> void` — 注册 `/canim-preview` 与全局 `game.modules.get("crucible-anim").api.preview()`

- [ ] **Step 1: 写失败测试**

`test/effects-trigger.test.mjs`：

```js
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import {planForEffect} from "../scripts/trigger/effects.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const ENV = {gridSize: 100};
const deps = () => ({assets: createAssets(offlineBackend(index)), armory: ARMORY});

const token = () => ({
  id: "t1", uuid: "Scene.s.Token.t1",
  document: {elevation: 0, width: 1, height: 1, uuid: "Scene.s.Token.t1"},
  center: {x: 500, y: 500}
});
const effect = (statusId) => ({
  uuid: `Scene.s.Token.t1.ActiveEffect.${statusId}`,
  statuses: new Set([statusId]), id: statusId
});

test("燃烧状态产出持久化计划且绑定到效果", () => {
  const plan = planForEffect(effect("burning"), token(), ENV, deps());
  assert.ok(plan);
  assert.ok(plan.cues.every(c => c.persist === true));
  assert.equal(plan.cues[0].tieTo, "Scene.s.Token.t1.ActiveEffect.burning");
});

test("无 statuses 的效果不产出计划", () => {
  const plan = planForEffect({uuid: "x", statuses: new Set(), id: null}, token(), ENV, deps());
  assert.equal(plan, null);
});

test("抛错时返回 null 而不外抛", () => {
  const broken = {get statuses() { throw new Error("boom"); }};
  assert.doesNotThrow(() => {
    assert.equal(planForEffect(broken, token(), ENV, deps()), null);
  });
});
```

- [ ] **Step 2: 运行测试确认失败**

Run: `node --test test/effects-trigger.test.mjs`
Expected: FAIL

- [ ] **Step 3: 写 `scripts/trigger/effects.mjs`**

```js
import {MODULE_ID} from "../const.mjs";
import {snapshotEffect} from "./snapshot.mjs";
import {resolveEffect} from "../resolver/resolve.mjs";
import {debug, error} from "../log.mjs";

/**
 * persist 槽的纯逻辑部分。
 * @returns {FXPlan|null}
 */
export function planForEffect(effect, token, env, deps) {
  try {
    // snapshotEffect 在没有 token 时返回 null（见 trigger/snapshot.mjs），必须用 ?. 取值。
    const snapshot = snapshotEffect(effect, token, env);
    if (!snapshot?.statusId) return null;
    if (!snapshot.effectUuid) {
      // 生产路径上 createActiveEffect 一定给得出 uuid；给不出说明触发点被改到了
      // preCreate、或收到的是未落库的合成 ActiveEffect。resolveEffect 的 keepTied 会拒绝
      // 出 persist cue（否则光效清不掉），这里把原因说清楚，免得只表现为「没动画」。
      // 日志放在这一层而不是解析层：只有这里同时拿得着活的 ActiveEffect 文档，而且
      // resolver/ 受 test/manifest.test.mjs 的「不得引用 Foundry 全局」守卫约束。
      warn(`状态 ${snapshot.statusId} 没有可绑定的 effect uuid，跳过持续特效`, effect);
      return null;
    }
    return resolveEffect(snapshot, deps);
  } catch (err) {
    error("为状态效果构造动画计划失败", err);
    return null;
  }
}

/**
 * 状态效果的持续特效由 ActiveEffect 增删驱动，独立于动作。
 *
 * 删除侧主要不靠这里：cue 带了 persist + tieTo，Sequencer 会在被绑定的 ActiveEffect
 * 消失时自动清理动画；下面的 deleteActiveEffect 只是 tie 失效时的兜底。
 *
 * ── persist 槽的持久化契约（与 resolve.mjs 的 CUE_DEFAULTS.worldPersist 配套）──
 * cue 带 worldPersist:false ⇒ 播放层调 .temporary(true) ⇒ Sequencer 一条记录都不落盘
 * （见 DESIGN §6.7）。代价是「重载 / 中途进场 / 切场景回来」该有的光环得本模组自己补，
 * 补法就是下面的 sequencerEffectManagerReady / createToken 两个钩子。
 *
 * 这样换来的是更强的性质：真相只有一份（ActiveEffect 文档本身），任何时刻都能从它重新
 * 推出该有的画面。不依赖任何 GM 在线，不存在 flag 日志与文档不同步，中途进场的玩家
 * 照样能补齐全场光环（靠 Sequencer 的 flag 回放**做不到**这一条——记录都属于别人）。
 */
export function installEffectTriggers(deps) {
  const env = () => ({gridSize: canvas?.dimensions?.size ?? 100});

  // 状态上身
  Hooks.on("createActiveEffect", (effect) => void syncEffect(effect, deps, env));

  // 状态被停用/启用（Crucible 有些状态是 toggle 而非增删）
  Hooks.on("updateActiveEffect", (effect, changed) => {
    if (!("disabled" in changed)) return;
    if (effect.active) void syncEffect(effect, deps, env);
    else endPersist(effect.uuid);
  });

  Hooks.on("deleteActiveEffect", (effect) => endPersist(effect.uuid));

  // 重载 / 切场景 / 中途进场 —— 见下面的时序坑
  //
  // ⚠ **不能挂 canvasReady**。Sequencer 自己的 canvasReady 处理是延时调 setupModule，
  // 其中 initializePersistentEffects() 第一件事就是 `await tearDownPersistentEffects()`，
  // 会 destroy 掉 VisibleEffects 里的**全部**效果——包括我们抢在前面播的。必须等它跑完，
  // 也就是挂它末尾 callAll 的 `sequencerEffectManagerReady`。该钩子在「一条持久化记录都
  // 没有」时照样触发，正是我们的情况。挂错成 canvasReady 的症状是「切场景回来光环没了」。
  Hooks.on("sequencerEffectManagerReady", () => void resyncPersist(deps, env));

  // 把已经带着状态的 token 拖进场景
  Hooks.on("createToken", (doc) => {
    if (doc.parent?.isView) void syncToken(doc.object, deps, env);
  });
}

/** 当前场景全部 token 补齐一遍。幂等，随便多调。 */
export async function resyncPersist(deps, env) {
  if (!canvas?.ready) return;
  for (const token of canvas.tokens?.placeables ?? []) await syncToken(token, deps, env);
}

async function syncToken(token, deps, env) {
  for (const effect of token?.actor?.effects ?? []) {
    if (!effect.active) continue;
    await playPersist(effect, token, deps, env);
  }
}

/** 一条 ActiveEffect 在它所有可见 token 上的持续特效。 */
async function syncEffect(effect, deps, env) {
  if (!(effect.parent instanceof Actor) || !effect.active) return;
  for (const token of effect.parent.getActiveTokens()) await playPersist(effect, token, deps, env);
}

async function playPersist(effect, token, deps, env) {
  if (!token?.scene?.isView) return;
  const {animationsEnabled, resolveRefIn} = await import("./dispatch.mjs");
  if (!animationsEnabled()) return;
  if (isPlayingPersist(effect.uuid, token)) return;          // 幂等
  const plan = planForEffect(effect, token, env(), deps);
  if (!plan) return;
  debug(`状态 ${plan.source} 上身`, plan);
  const {playPlan} = await import("../player/play.mjs");
  await playPlan(plan, {volume: 1, shake: false, resolveRef: resolveRefIn(token.scene)});
}

/**
 * tie 失效时的兜底收尾。必须按 origin 过滤，**不能**按 name——播放层不设 name（见
 * Task 13 的 persist 分支），而 Sequencer 的 _filterEffects 里 name 与 origin 是 AND
 * 关系，原草案的 `{name: "crucible-anim:*", origin: ...}` 会匹配到 0 条，那张兜底网是
 * 死的。push=false：各客户端副本的 _id 各不相同，把 id 推给别人匹配不上任何东西。
 */
function endPersist(effectUuid) {
  try { Sequencer.EffectManager.endEffects({origin: effectUuid}, false); }
  catch { /* 没有匹配的持续特效，忽略 */ }
}

/**
 * 本客户端是不是已经在放这一份光环。只查本地 EffectManager（getEffects 只看
 * SequenceManager.VisibleEffects），这正是需要的粒度：每客户端各放各的，判重也只该跟
 * 自己比。必须 origin **和** object 一起过滤：一个 linked actor 的两个 token 共用同一个
 * effect uuid，只按 origin 判会让第二个 token 永远补不上光环。
 */
function isPlayingPersist(effectUuid, token) {
  try {
    return Sequencer.EffectManager.getEffects({origin: effectUuid, object: token}).length > 0;
  } catch { return false; }
}
```

- [ ] **Step 4: 写 `scripts/player/preview.mjs`**

```js
import {MODULE_ID, META_KEY} from "../const.mjs";
import {playPlan} from "./play.mjs";
import {snapshotAction} from "../trigger/snapshot.mjs";
import {resolve, resolveEffect} from "../resolver/resolve.mjs";

/**
 * 逐条播放兵库里的每条规则，无需真实战斗即可过一遍所有配方。
 * 这是渲染层唯一必须人工观看的验收手段。
 *
 * 用法：选中一个 token（作为施法者），可选再目标一个 token，然后
 *   game.modules.get("crucible-anim").api.preview({slot: "impact"})
 */
export function installPreview(deps) {
  const api = {
    /**
     * @param {{slot?: string, filter?: string, gap?: number}} [opts]
     *   slot   只播某个槽；不给则全播
     *   filter 只播 rule id 含此子串的规则
     *   gap    每条之间的间隔毫秒，默认 1200
     */
    async preview({slot = null, filter = null, gap = 1200} = {}) {
      const [origin] = canvas.tokens.controlled;
      if (!origin) return ui.notifications.warn(game.i18n.localize("CANIM.Preview.NoToken"));
      const target = [...game.user.targets][0] ?? origin;
      const env = {gridSize: canvas.dimensions.size, distancePixels: canvas.dimensions.distancePixels};
      const {resolveRefIn} = await import("../trigger/dispatch.mjs");
      const resolveRef = resolveRefIn(canvas.scene);

      const slots = slot ? [slot] : ["cast", "travel", "impact", "aftermath", "persist"];
      let played = 0;
      for (const s of slots) {
        for (const rule of deps.armory[s]) {
          if (filter && !rule.id.includes(filter)) continue;
          const plan = s === "persist"
            ? previewEffectPlan(rule, target, env, deps)
            : previewActionPlan(rule, s, origin, target, env, deps);
          if (!plan) continue;
          ui.notifications.info(`${s} / ${rule.id}`);
          await playPlan(plan, {volume: 0.5, shake: true, resolveRef});
          played++;
          await new Promise(r => setTimeout(r, gap));
        }
      }
      ui.notifications.info(`预览完成，共 ${played} 条`);
    }
  };
  game.modules.get(MODULE_ID).api = api;
}

/** 用一条合成快照强制命中指定规则。 */
function previewActionPlan(rule, slot, origin, target, env, deps) {
  const action = {
    id: `__preview__.${rule.id}`, name: rule.id,
    tags: new Set(["strike", "melee", "slashing"]),
    target: {type: "single", number: 1, distance: 1, scope: 2},
    range: {minimum: 0, maximum: 1}, cost: {action: 1, focus: 0, heroism: 0, health: 0},
    region: null, actor: origin.actor, token: origin,
    targets: new Map([[target.actor ?? {id: "x"}, {token: target}]]),
    usage: {damageType: "slashing", isAttack: true, isRanged: false,
            strikes: [{category: "balanced1", system: {damageType: "slashing"}}]},
    eventsByTarget: new Map([[target.actor ?? {id: "x"},
      {all: [], roll: [{roll: {data: {result: 7}, isCriticalSuccess: true}}]}]])
  };
  const snapshot = snapshotAction(action, env);
  // 只保留待预览的那一条规则，绕开优先级竞争
  const armory = {...deps.armory, [slot]: [rule]};
  return resolve(snapshot, {assets: deps.assets, armory});
}

const PREVIEW_PERSIST_MS = 3000;

function previewEffectPlan(rule, target, env, deps) {
  const snapshot = {
    statusId: `__preview__.${rule.id}`,
    // 预览没有真的 ActiveEffect。resolveEffect 的 keepTied 不放行绑不上 document 的
    // 持久化 cue（会永久残留），所以借 token 文档当绑定目标让计划先成形，再在下面把
    // persist 摘掉。原草案写 `effectUuid: null`，加闸之后会让 12 条 persist 规则全部
    // plan=null——预览这条唯一的人工验收途径会静默失效。
    effectUuid: target.document.uuid,
    target: {tokenId: target.id, uuid: target.document.uuid,
             x: target.center.x, y: target.center.y, elevation: 0,
             width: 1, height: 1, w: env.gridSize, h: env.gridSize, radiusPx: env.gridSize / 2},
    seed: 1
  };
  const plan = resolveEffect(snapshot, {assets: deps.assets, armory: {...deps.armory, persist: [rule]}});
  if (!plan) return null;
  // 预览是「看一眼这条规则长什么样」，不是真给 token 挂状态：摘掉持久化并给一个有限
  // 时长。否则预览跑完一轮就在场上留下十几枚谁也清不掉的光环——正是 persist 槽最怕的
  // 那个失败模式，还偏偏发生在最常用的调试工具上。3000ms 取 5-6s 循环的一半。
  return {...plan, cues: plan.cues.map(c => ({
    ...c, persist: false, tieTo: null, extraEndDuration: 0, duration: PREVIEW_PERSIST_MS
  }))};
}

/**
 * Crucible 自带的重放菜单条件是 flags.vfxConfig，本模组的动作没有该 flag，
 * 所以要自己注册一条。
 */
export function installReplayMenu() {
  Hooks.on("getChatMessageContextOptions", (app, options) => {
    options.push({
      name: game.i18n.localize("CANIM.Replay"),
      icon: '<i class="fa-solid fa-repeat"></i>',
      condition: li => {
        const msg = game.messages.get(li.dataset.messageId);
        // 与 dispatch.mjs 的播放闸门共用同一个判据（Task 14 已导出 planOf），
        // 两处各写一遍迟早漂移成「菜单出现但点了没反应」。
        return !!planOf(msg);
      },
      callback: async li => {
        const msg = game.messages.get(li.dataset.messageId);
        const {playFromMessage} = await import("../trigger/dispatch.mjs");
        await playFromMessage(msg);
      }
    });
  });
}
```

- [ ] **Step 5: 在 `main.mjs` 中挂载三者**

在 Task 14 追加的挂载代码之后：

```js
  const {installEffectTriggers} = await import("./trigger/effects.mjs");
  const {installPreview, installReplayMenu} = await import("./player/preview.mjs");
  installEffectTriggers(deps);
  installPreview(deps);
  installReplayMenu();
  log("状态触发、预览与重放菜单已挂载");
```

- [ ] **Step 6: 运行全部测试**

Run: `cd /root/crucible-anim && npm test`
Expected: 全绿

- [ ] **Step 7: 提交**

```bash
cd /root/crucible-anim
git add -A
git commit -m "状态效果触发、聊天卡重放菜单与预览宏"
```

---

## Task 16: 部署与端到端验收

**Files:**
- Create: `README.md`
- Test: 无新增自动化测试；本任务是人工验收

- [ ] **Step 1: 全量测试与体检**

```bash
cd /root/crucible-anim
npm test
```
Expected: 全部测试通过。记录总断言数与降级率。

```bash
# 兵库规则总数
node -e '
import("./scripts/armory/index.mjs").then(({ARMORY}) => {
  let n = 0;
  for (const [slot, rules] of Object.entries(ARMORY)) {
    console.log(slot.padEnd(10), rules.length);
    n += rules.length;
  }
  console.log("合计", n, "条规则");
})'
```
Expected: 合计 40–55 条

- [ ] **Step 2: 部署为符号链接**

沿用同机其他模组的约定（`gesturecast`、`leak-doctor` 都是符号链接）：

```bash
ln -sfn /root/crucible-anim /root/fvtt14-data/Data/modules/crucible-anim
ls -la /root/fvtt14-data/Data/modules/crucible-anim
```

- [ ] **Step 3: 写 `README.md`**

````markdown
# crucible-anim

为 Foundry VTT 的 Crucible 系统补齐原生 VFX 未覆盖的动画。

- 设计文档：`docs/DESIGN.md`
- 实现计划：`docs/IMPLEMENTATION-PLAN.md`
- 素材侦察记录：`docs/ASSET-NOTES.md`

## 它做什么

Crucible 0.10.2 自带完整的 VFX 框架，但内容只覆盖 6/17 个法术姿态、4/12 个符文和弓弩射击。
本模组在原生链返回 `null`（即系统对该动作无动画）时接管，用 Sequencer + JB2A/eskie/blfx
素材补齐其余部分：11 个姿态、8 个符文、全部近战武器、默认动作与 47 个状态效果。

不替换原生已实现的部分。

## 依赖

必需：`sequencer` ≥ 4.2
素材（缺失则相应动画降级）：`jb2a_patreon`、`eskie-effects`、`blfx-assets-pack01`、`psfx-patreon`

## 开发

```bash
npm test           # headless 测试，1500+ 断言样本
npm run index      # 重新生成 data/asset-index.json
npm run fixtures   # 重新生成 test/fixtures/
```

素材包升级后须重跑 `npm run index` 并跑一遍测试，降级率断言会暴露失效的路径。

## 游戏内验收

选中一个 token，目标另一个 token，然后在控制台：

```js
game.modules.get("crucible-anim").api.preview()                    // 全部规则
game.modules.get("crucible-anim").api.preview({slot: "impact"})    // 只看 impact
game.modules.get("crucible-anim").api.preview({filter: "melee"})   // 只看近战
```
````

- [ ] **Step 4: 游戏内验收清单**

在 `ember-test` 世界中逐项确认（**不要在 `ember-` 二团正式世界里首测**）：

| # | 项 | 期望 |
| --- | --- | --- |
| 1 | 启动世界 | 控制台出现「设置项已注册」「自检通过」「触发层已挂载」，无红字 |
| 2 | 设置面板 | 5 个设置项显示中文，density 三个选项齐全 |
| 3 | `api.preview()` | 逐条播放全部规则，`ui.notifications` 报出 `槽/规则 id`，无卡死 |
| 4 | 近战攻击（贴身） | 挥击弧线长度与身位相符，朝向正确 |
| 5 | 近战攻击（隔一格） | 换用长版素材，未穿模 |
| 6 | 目标在左侧 | 挥击已镜像，未反手 |
| 7 | 暴击 | 目标 sprite 抖动，画面其余部分不动 |
| 8 | 未命中 / 闪避 | 特效偏移落空，未贴在目标身上 |
| 9 | 格挡 / 招架 / 护甲 | 三者视觉可区分，且都没有元素溅射层 |
| 10 | 大体型敌人出手 | 特效放大，未显得过小 |
| 11 | 缺失符文法术（如 storm.arrow） | 有动画，颜色与符文相符 |
| 12 | 已实现符文法术（如 frost.arrow） | 播放的是**原生**粒子效果，本模组未插手 |
| 13 | 射线 / 锥形法术 | 贴合模板形状，未溢出边界 |
| 14 | 状态上身（如燃烧） | 目标身上出现循环光效 |
| 15 | 状态移除 | 光效自动消失，无残留 |
| 16 | 撤销一个动作 | 不播放动画 |
| 17 | 关闭 Crucible 的 enableVFX | 本模组也不播 |
| 18 | 关闭本模组 enabled | 原生动画照常，本模组不播 |
| 19 | 聊天卡右键 | 出现「重放动画」，点击后重播 |
| 20 | 第二个客户端 | 同一动作只播一次，画面与主客户端一致 |
| 21 | 连续多次反击 | 动画排队播放，未叠成一团 |
| 22 | 开 debug 后出手 | 控制台打印快照与计划；降级 warning 数量可接受 |

第 12 项是「只补空缺」的核心验证——若原生法术被本模组接管了，说明
`buildPlanFor` 的 `nativeConfig` 判定有误，必须修复而不是绕过。

#### persist 多客户端契约与遮挡（至少 GM + 1 玩家两台客户端）

这一组离线测试完全测不出，必须上机。

| # | 项 | 期望 |
| --- | --- | --- |
| 23 | **零落盘**（本契约唯一的直接读数） | 给一个 token 挂 burning，然后在 GM 控制台跑下面那段，必须返回 `[]`。注意 Sequencer 4.2.x 的记录**不在 token flag 上**，在隐藏 JournalEntry 里 |
| 24 | GM F5 重载 | 光环只有一层，不变亮（刷新前后各截一张图，用 `tools/element-residual-colour.mjs` 量同一像素更稳） |
| 25 | 中途进场 | 状态挂上之后玩家 B 才登录/切进场景，B 必须看得到光环（这条只有 worldPersist:false + 自建重放能过；flag 回放方案下 B 什么都看不到） |
| 26 | 切场景往返 | GM 切到别的场景再切回来，光环恢复且只有一层。失败症状「切回来光环没了」= 重建误挂在 canvasReady 而非 sequencerEffectManagerReady |
| 27 | 移除即清理 | 移除状态，两端光环同时消失，且两端 `Sequencer.EffectManager.getEffects({origin: "<effectUuid>"})` 都返回 `[]` |
| 28 | linked actor 双 token | 同一个 actor 的两个 token 同挂一个状态，两个都要有光环。只有一个 = isPlayingPersist 的判重漏了 object 条件 |
| 29 | 无 GM 在线 | 关掉 GM 客户端，只有玩家在线时挂状态，玩家仍能看到光环 |
| 30 | preload 不再全场往返 | 用 role=PLAYER 的客户端打一次，控制台不得出现 `preloadForClients - You do not have permission`；一次动作不应看到 N 条 PRELOAD 广播 |
| 31 | **temporary 的位置 ticker 开销**（本方案唯一的实打实代价） | 10 个 token × 2 状态全挂上，拖动其中一个跨半个屏幕，看 F12 Performance 有没有可感掉帧、socket 面板里 UPDATE_EFFECT_POSITION 的量级 |
| 32 | 分层观感 | 9 支地面环压在 token 之下仍看得清（尤其 hidden，压下去只剩最弱的一支）；burning/haste/buff 在 token 之上不糊脸 |
| 33 | **tint 真的生效** | decay（腐朽/辐射）必须是酒红／绛紫骷髅环、hidden（隐匿）必须是靛蓝烟弧。若仍是紫色/灰蓝，说明播放端没接 `.tint()` 或把它当加法处理了——**这是本轮唯一测试兜不住的缺口**，测试量的是「按这个 tint 算出来的颜色」，不是「屏幕上真的是这个颜色」 |
| 34 | dead 不再挂环 | 打死一个敌人，尸体上只有 Foundry 自带的 dead overlay，没有青绿眩晕环 |
| 35 | 战斗直调的 DoT | 触发 death / illumination / earth / life / soul 符文暴击，落地的腐朽/辐射/酸蚀/治疗/鼓舞必须命中各自分组的颜色，而不是一颗无 tint 的白泡（那是 generic.persist 兜底，说明 GENERATED_EFFECT_STATUS 没生效） |

#### Task 14 修复的三条专项复验

| # | 项 | 期望 |
| --- | --- | --- |
| 36 | 撤销后重新确认 | 确认一次看到动画 → 右键 Reverse → 再点 Confirm，动画必须**重播**；开 debug 后控制台应出现两次「已确认，尝试播放」 |
| 37 | postConfirm 推迟仍然生效 | 带连锁动作的天赋，撤销后重新确认，连锁动作应等到动画播完（验证 `confirm()` 的 `Promise.race` 拿到的是本轮的新 promise） |
| 38 | 状态上身不再顶死队列 | `一条动画超过 15000ms 仍未播完` 这条 warn 必须彻底消失；观感是「挥剑 → 光环」；AoE 多人上状态时几圈光环同时出现 |

第 23 项的命令：

```js
const db = game.journal.getName("sequencerDatabase");
Object.entries(db?.flags?.sequencer?.effects ?? {})
  .flatMap(([k, v]) => v.map(([id, d]) => ({k, id, file: d.file, by: d.creatorUserId})))
  .filter(r => r.file?.includes("jb2a") || r.file?.includes("eskie"));
```

- [ ] **Step 5: 记录验收结果**

把逐项结果写进 `docs/VERIFICATION.md`（与 `/root/leak-doctor` 的约定一致），
未通过项写明现象与定位。**不要在有未通过项时声称完成。**

- [ ] **Step 6: 提交**

```bash
cd /root/crucible-anim
git add -A
git commit -m "部署符号链接、README 与游戏内验收记录"
```

---

## 计划自检

对照 `docs/DESIGN.md` 逐节核查覆盖情况：

| 设计文档章节 | 对应任务 |
| --- | --- |
| §1 背景与缺口矩阵 | Task 8–12（兵库内容按缺口矩阵组织） |
| §2 目标与非目标 | Global Constraints + Task 1 的 `density` 设置项 |
| §3 参考系统结论 | Task 2（DB 提取沙箱）、Task 3（bestFit）、Task 7（ctx）、Task 10（几何修正）、Task 11（分层叠加）、Task 13（释放手法） |
| §4 渲染层选型 | Task 13 |
| §5 架构与数据流 | Task 1（骨架）、Task 14（包装与传输） |
| §5.3 只补空缺的判定 | Task 14 Step 3 的 `nativeConfig` 判定 + Task 16 第 12 项验收 |
| §6.1 ActionSnapshot | Task 6 |
| §6.2 FXPlan 字段 | Task 7 的 `CUE_DEFAULTS` |
| §6.3 五槽 | Task 7 骨架 + Task 9–12 内容 |
| §6.4 六级优先级 | Task 7 的 `firstMatch` + 各兵库任务的 pri 分配 |
| §6.5 impact 分层叠加 | Task 11 |
| §6.6 调色 | Task 4 |
| §7.1 离线索引 | Task 2 |
| §7.2 bestFit 双后端 | Task 3 |
| §7.3 识图 | Task 8 |
| §7.4 素材路径策略 | Global Constraints + Task 1 的依赖检测 |
| §8.1 释放手法规范 | Task 13 的 `playPlan` |
| §8.2 几何修正 | Task 7 的 `ctx.geom` + Task 10 |
| §8.3 并发控制 | Task 13 的 semaphore |
| §9 设置项与本地化 | Task 1 |
| §10.1 headless 测试 | Task 5（fixture）+ Task 7（coverage） |
| §10.2 预览宏 | Task 15 |
| §10.3 识图验收 | Task 8 |
| §11 风险与降级 | Task 1（自检）、Task 14（try/catch）、Task 3（bestFit 降级） |
| §12 交付定义 | Task 16 |

无遗漏章节。

**类型一致性核查：**

- `hashSeed` 在 `tools/dump-fixtures.mjs`（Task 5）与 `scripts/trigger/snapshot.mjs`（Task 6）各有一份，Task 6 Step 5 有专门的一致性校验步骤
- `ctx.pick(dbPath, {color})` 的签名在 Task 7 定义，Task 9–12 一致使用
- `Cue.at = {ref, tokenId, uuid, x, y}` 在 Task 7 的 `resolve` 中产出，Task 13 的 `resolveRef` 与 Task 14 的 `resolveRefIn` 一致消费
- `RESULT` / `RESULT_NAME` / `HIT_RESULTS` 在 Task 1 定义，Task 11 消费
- `animationsEnabled` / `resolveRefIn` / `playFromMessage` 在 Task 14 的 `dispatch.mjs` 导出，Task 15 的 `effects.mjs` 与 `preview.mjs` 消费
- 兵库规则形状 `{id, pri, when, build}` 在 Task 7 定义，Task 9–12 一致遵循；`build` 的入参在 cast 是 `(s, ctx)`、travel/impact/aftermath 是 `(s, ctx, target)`、persist 是 `(e, ctx)`

**已知的占位符（是任务内容，不是计划缺陷）：**

Task 9–12 的兵库规则中出现 `<ASSET-NOTES 中的…路径>` 与 `<燃烧循环>` 之类的尖括号占位。
这些**不能**在写计划时填死：它们必须来自 Task 8 的实际读图结果，凭文件名猜测正是本设计
要避免的错误。每个任务都明确要求「替换为 `docs/ASSET-NOTES.md` 中已验证无降级的条目」，
且由 `test/coverage.test.mjs` 的路径存在性断言与降级率断言把关。
