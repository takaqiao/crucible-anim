/**
 * Foundry 安装路径解析 —— 让测试与工具能在不同机器上跑。
 *
 * 项目最初只在一台 Linux VPS 上开发，路径直接写死成 /root/fvtt14-data/Data 与
 * /root/foundryvtt/client。转到本地后这些路径不存在，21 条守卫会以 ENOENT 变红——
 * 那不是「上游漂移」的信号，是环境问题，会淹没真正的告警。
 *
 * 解析顺序：环境变量 → 平台候选表 → 抛错。
 *
 * **刻意不做「找不到就 skip」**：这两个根目录喂的是把断言钉在上游源码上的守卫
 * （native-boundary / source-tables / sequencer-contract）。静默跳过等于在没装
 * Foundry 的机器上全绿，正是这个项目反复栽过的「守卫比以为的弱」。
 * 找不到就大声报错，并指明该设哪个环境变量。
 *
 *   CRUCIBLE_ANIM_DATA  Foundry 用户数据目录（含 modules/ systems/ worlds/）
 *   CRUCIBLE_ANIM_CORE  Foundry 客户端源码目录（含 game.mjs）；也接受装机根目录，
 *                       会自动往下找 client/ 或 resources/app/client/
 */
import {existsSync} from "node:fs";
import {join, resolve as resolvePath} from "node:path";
import {homedir} from "node:os";

const home = homedir();
const localAppData = process.env.LOCALAPPDATA || join(home, "AppData", "Local");
const programFiles = process.env.ProgramFiles || "C:\\Program Files";

/** Data 根的判据：Foundry 一定会在里面建 systems/ 与 modules/。 */
const DATA_SENTINELS = ["systems", "modules"];

/** client 根的判据：game.mjs 是客户端入口，v13/v14 都在这一层。 */
const CORE_SENTINEL = "game.mjs";

const DATA_CANDIDATES = [
  join(localAppData, "FoundryVTT", "Data"),                     // Windows 默认
  "/root/fvtt14-data/Data",                                     // 本项目的开发 VPS
  join(home, ".local", "share", "FoundryVTT", "Data"),          // Linux 默认
  join(home, "Library", "Application Support", "FoundryVTT", "Data"), // macOS 默认
  "/data/Data",                                                 // 常见容器布局
];

const CORE_CANDIDATES = [
  join(programFiles, "Foundry Virtual Tabletop", "resources", "app"), // Windows 安装
  "/root/foundryvtt",                                                 // 本项目的开发 VPS
  "/opt/foundryvtt",
  join(home, "foundryvtt"),
  "/Applications/Foundry Virtual Tabletop.app/Contents/Resources/app", // macOS
];

const isData = p => !!p && DATA_SENTINELS.every(s => existsSync(join(p, s)));

/** 接受 client/ 本身、装机根目录、或 Electron 的 resources/app —— 归一到含 game.mjs 的那层。 */
function asCore(p) {
  if (!p) return null;
  for (const sub of ["", "client", join("resources", "app", "client")]) {
    const c = sub ? join(p, sub) : p;
    if (existsSync(join(c, CORE_SENTINEL))) return c;
  }
  return null;
}

function pick(envVar, envValue, candidates, probe, what) {
  if (envValue) {
    const hit = probe(resolvePath(envValue));
    if (hit) return hit;
    throw new Error(
      `${envVar} 指向 ${envValue}，但那里不是${what}。` +
      `\n判据：${envVar === "CRUCIBLE_ANIM_DATA"
        ? `目录下同时有 ${DATA_SENTINELS.join(" 和 ")}`
        : `目录下（或其 client/、resources/app/client/ 子目录下）有 ${CORE_SENTINEL}`}`
    );
  }
  for (const c of candidates) {
    const hit = probe(c);
    if (hit) return hit;
  }
  throw new Error(
    `找不到${what}。请设环境变量 ${envVar}，或把它装到下列位置之一：\n` +
    candidates.map(c => `  - ${c}`).join("\n") +
    `\n\n例（PowerShell）：$env:${envVar} = "D:\\FoundryVTT\\Data"` +
    `\n例（bash）：      export ${envVar}=/srv/fvtt/Data`
  );
}

/** Foundry 用户数据目录。缺失时抛错，不静默降级。 */
export const FOUNDRY_DATA = pick(
  "CRUCIBLE_ANIM_DATA", process.env.CRUCIBLE_ANIM_DATA,
  DATA_CANDIDATES, p => (isData(p) ? p : null), "Foundry 用户数据目录"
);

/** Foundry 客户端源码目录（含 game.mjs）。缺失时抛错，不静默降级。 */
export const FOUNDRY_CORE = pick(
  "CRUCIBLE_ANIM_CORE", process.env.CRUCIBLE_ANIM_CORE,
  CORE_CANDIDATES, asCore, "Foundry 客户端源码目录"
);

export const CRUCIBLE_MODULE = join(FOUNDRY_DATA, "systems", "crucible", "module");
export const SEQUENCER_DIR = join(FOUNDRY_DATA, "modules", "sequencer");
