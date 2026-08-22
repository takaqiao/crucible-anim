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
 * `plan.warnings`（解析层在规则 when()/build() 抛异常、或 persist cue 缺 tieTo 时留下
 * 的诊断）在这里第一次有了消费者：这一层是唯一同时拿得到完整 plan、又能安全调用
 * log.mjs（不需要 Foundry 全局）的地方——resolve() 本身要保持对 Foundry 无感知，
 * play.mjs 拿到的只是丢过网络的 plan，不知道"为什么没匹配到规则"与"规则本身报错"
 * 有什么区别。正常语料这里应该永远不产出任何 warning（test/coverage.test.mjs 已经
 * 在全量 fixture 上钉死这一点）；一旦出现，说明兵库规则表本身有錯，用不受 debug 开关
 * 影响的 warn() 而不是 debug()，与 play.mjs 里同类诊断（未知 playIf、mask 转换失败等）
 * 保持同一严重度。
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
    if (plan) {
      debug(`接管 ${action.id}`, {snapshot, plan});
      for (const msg of plan.warnings ?? []) warn(`[${action.id}] ${msg}`);
    } else {
      debug(`${action.id} 未接管：兵库没有匹配的规则`, {snapshot});
    }
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
        // this.metadata 由 CrucibleAction#_configure 用 Object.defineProperty 定义成
        // {value: metadata, writable: false}——不可重新赋值，但默认值恒为 {}（_configure
        // 的解构默认参数），从不是 null/undefined，因此只需写入键，不需要（也不能）
        // `this.metadata ??= {}` 之类的重新赋值。
        // metadata 会随 flags.crucible.metadata 序列化进聊天卡并广播给所有客户端
        // （见 CrucibleAction#_prepareMessage：`if (!isEmpty(this.metadata))
        // actionData.metadata = this.metadata` 与 `flags: {crucible: actionData}`）。
        this.metadata[META_KEY] = plan;
      }
    } catch (err) {
      error("动画包装体失败，已降级", err);
    }
    return nativeConfig;
  };
}
