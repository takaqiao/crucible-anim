import {MODULE_ID} from "./const.mjs";
import {registerSettings} from "./settings.mjs";
import {log, warn, error} from "./log.mjs";

/**
 * 模组运行时状态，供控制台排查与将来的 api.preview 使用。
 *
 * 语义是「三个钩子有没有真的挂上」，不是「钩子挂上了但会提前返回」——自检失败或挂载
 * 抛错时 installWrap / installDispatch / installEffectTriggers 压根不会被调用，钩子
 * 从未注册。因此 active 必须在**挂载成功之后**才置 true。
 */
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

  // 挂载整体 try/catch。自检只探了 ready 那一瞬间的两个接触点，挂载本身还会做五次
  // 动态 import（模组脚本 404 是 Foundry 里真实存在的失败模式）、建资源后端、改
  // CrucibleAction 原型。缺了这层保护，任何一步抛错都变成一条无人处理的 rejection：
  // state.active 停在 true、GM 什么提示都收不到、钩子一个没挂上。最坏的组合是
  // installWrap 成功而后两个失败——动画计划照写进每张聊天卡，却永远没人播。
  try {
    const {createAssets, runtimeBackend} = await import("./resolver/assets.mjs");
    const {ARMORY} = await import("./armory/index.mjs");
    const {installWrap} = await import("./trigger/wrap.mjs");
    const {installDispatch} = await import("./trigger/dispatch.mjs");
    const {installEffectTriggers} = await import("./trigger/effects.mjs");

    const deps = {assets: createAssets(runtimeBackend()), armory: ARMORY};
    installWrap(deps);
    installDispatch();
    installEffectTriggers(deps);
    state.active = true;
    log("触发层已挂载");
  } catch (err) {
    state.reason = `挂载失败：${err?.message ?? err}`;
    error("触发层挂载失败，模组已自我禁用", err);
    if (game.user.isGM) {
      ui.notifications.error(game.i18n.format("CANIM.SelfCheckFailed", {reason: state.reason}));
    }
  }
});
