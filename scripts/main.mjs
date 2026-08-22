import {registerSettings} from "./settings.mjs";
import {log, warn, error} from "./log.mjs";
import {createAssets, runtimeBackend} from "./resolver/assets.mjs";
import {ARMORY} from "./armory/index.mjs";
import {installWrap} from "./trigger/wrap.mjs";
import {installDispatch} from "./trigger/dispatch.mjs";
import {installEffectTriggers, installPersistResync, flushPersistResync} from "./trigger/effects.mjs";
import {installPreview, installPreviewCommand, installReplayMenu} from "./player/preview.mjs";

/**
 * 模组运行时状态，供控制台排查与 api.preview 使用。
 *
 * 语义是「装配有没有真的完成」，不是「钩子有没有注册」——A 组修复之后有三处接线提前到
 * `init`（见下面），它们在自检失败时仍然在册，只是全部通过 `isActive()` / `liveDeps()`
 * 自己短路。因此 active 必须在**挂载成功之后**才置 true，且这两个读取器是提前注册的
 * 钩子判断"我现在能不能干活"的唯一依据。
 */
export const state = {active: false, reason: null, deps: null};

/** 提前注册的钩子用来判断模组是否真的可用。 */
export const isActive = () => state.active === true;

/**
 * 提前注册的钩子取依赖的唯一入口：只有自检通过、五次挂载全部成功之后才交出 deps，
 * 否则返回 null。这就是「模组被自检禁用时，提前注册的钩子必须自己短路」那条要求的
 * 落点——不必每个回调各写一遍 state 判断，拿不到依赖就什么都不做。
 */
export const liveDeps = () => (state.active ? state.deps : null);

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

/**
 * init 阶段做两件事：注册设置项，以及注册**三处赶不上 ready 的接线**。
 *
 * 三处各自的时序依据写在它们自己的实现旁边（都逐行核对过上游源码）：
 *  · `installReplayMenu`   —— `getChatMessageContextOptions` 只在 ChatLog 首渲染时
 *    派发一次、条目当场冻进 ContextMenu，而首渲染发生在 `game.initializeUI()`
 *    （client/game.mjs:764，未 await），早于 `Hooks.callAll("ready")`（:779）。
 *  · `installPreviewCommand` —— `ChatLog.CHAT_COMMANDS` 是静态注册表，必须在用户第一次
 *    敲命令之前就位；顺带这条命令的 HTML 匹配问题也在那里一并修掉。
 *  · `installPersistResync` —— `sequencerEffectManagerReady` 每次画布加载只发一次，
 *    Sequencer 在 canvas.ready 后很快就发（sequencer.js:30875-30879 → 11953），
 *    而 ready 还排在 `await documentIndex.index()` 与 `await canvas.initializing` 之后。
 *
 * **不把 selfCheck() 或自我禁用逻辑一起提前**：自检探的是 `ready` 那一刻的两个接触点
 * （`crucible.api.models.CrucibleAction` 与 `Sequencer.Database`），init 时它们还没就位，
 * 提前只会误判。三处提前注册的回调因此各自带短路：`isActive()` / `liveDeps()` /
 * `api.preview` 是否存在。
 */
Hooks.once("init", () => {
  registerSettings();
  installReplayMenu(isActive);
  installPreviewCommand();
  installPersistResync(liveDeps);
  log("设置项与提前接线（重放菜单 / 聊天命令 / persist 重同步）已注册");
});

Hooks.once("ready", async () => {
  const reason = selfCheck();
  if (reason) {
    state.reason = reason;
    error(`自检失败，模组已自我禁用：${reason}`);
    if (game.user.isGM) {
      ui.notifications.error(game.i18n.format("CANIM.SelfCheckFailed", {reason}));
    }
    return;
  }
  log("自检通过");

  const assetModules = ["jb2a_patreon", "eskie-effects", "blfx-assets-pack01", "psfx-patreon"];
  const missing = assetModules.filter(id => !game.modules.get(id)?.active);
  if (missing.length) warn(`以下素材模组未激活，相关动画将降级：${missing.join(", ")}`);

  // 挂载整体 try/catch。自检只探了 ready 那一瞬间的两个接触点，挂载本身还会建资源后端、
  // 改 CrucibleAction 原型。缺了这层保护，任何一步抛错都变成一条无人处理的 rejection：
  // GM 什么提示都收不到，而 state.active 停在 false 让提前注册的三处钩子静默失效。
  //
  // 【与 Task 15 交付版的差异】那一版这里做了 6 次 `await import(...)`，为的是把
  // "模组脚本 404" 也纳入同一条 catch。A 组把三处接线提前到 init 之后这个理由不再成立：
  // init 时就要用 player/preview.mjs 与 trigger/effects.mjs，只能静态 import，而它们
  // 又已经把 play / resolve / dispatch / snapshot 整条链拉进来了——动态 import 只剩
  // assets / armory / wrap 三个文件仍受保护，"保护"名存实亡。改成全静态之后 404 的
  // 表现从"半装配"变成"整个模组加载失败"（控制台一条红），而半装配恰恰是最坏的那种：
  // installWrap 成功而后几个失败 = 动画计划照写进每张聊天卡，却永远没人播。
  try {
    const deps = {assets: createAssets(runtimeBackend()), armory: ARMORY};
    installWrap(deps);
    installDispatch();
    installEffectTriggers(deps);
    installPreview(deps);

    // 顺序要紧：先公开 deps + 置 active（提前注册的钩子从这一刻起才开始干活），
    // 再补跑 sequencerEffectManagerReady 那一次可能已经错过的 resync。
    state.deps = deps;
    state.active = true;
    flushPersistResync();

    log("触发层、预览宏与重放菜单已挂载");
  } catch (err) {
    state.deps = null;
    state.active = false;
    state.reason = `挂载失败：${err?.message ?? err}`;
    error("触发层挂载失败，模组已自我禁用", err);
    if (game.user.isGM) {
      ui.notifications.error(game.i18n.format("CANIM.SelfCheckFailed", {reason: state.reason}));
    }
  }
});
