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
