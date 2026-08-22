import {META_KEY, SETTINGS} from "../const.mjs";
import {getSetting} from "../settings.mjs";
import {snapshotAction} from "./snapshot.mjs";
import {resolve} from "../resolver/resolve.mjs";
import {debug, warn, error} from "../log.mjs";

/**
 * 纯逻辑：决定是否接管，接管则产出计划。抽出来是为了能脱离 Foundry 单测。
 *
 * 「只补空缺」的判定压缩成一个条件：Crucible 全部 gesture configurator 与
 * configureStrikeVFXEffect 都以 return null 优雅退出（三个 configureVFX 钩子的全部
 * return 表达式只有 `null` 与 `vfxConfig` 两种，而聚合器 configureVFXEffect() 是
 * `let vfxConfig = null` 起手、`fn(...) ?? vfxConfig`——见 test/native-boundary.test.mjs
 * 把这两件事逐条钉在 Crucible 源码上），因此
 * 「原生链最终返回 null」⟺「系统对此动作无动画」。
 *
 * 判据用真值而不是 `=== null` 是有意的：第三方模组可以往 crucible.api.hooks.action /
 * .spellcraft 注册自己的 configureVFX（models/action.mjs:598 的文档明写这是给模组作者
 * 扩展的注册表），它返回 0/""/false 时 `??` 不会归一化，链输出会是那个假值——而原生
 * CrucibleChatMessage#_onUpdate 的播放闸门同样是 `flags.vfxConfig` 真值判断，两边对
 * 「有没有动画」的结论因此始终一致。
 *
 * 这个等价式有一个**已知的、有意为之的例外**：原生链抛异常时（configureVFXEffect 的
 * for 循环没有 try/catch，异常会一路掀翻 _prepareMessage → toMessage，玩家连聊天卡都
 * 发不出去）本包装体吞掉异常、把 nativeConfig 留在 null，于是照常接管。抛错既不是 null
 * 也不等于「系统对此动作无动画」，但此时原生**事实上**什么也没产出，接管是严格更好的
 * 降级：玩家不会被系统 bug 卡住出手，代价是画风会静默换成本模组的。这条路径必须留下
 * error 级日志（下面 installWrap 的 catch），并且只在这一处发生。
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
    const plan = resolve(snapshot, {...deps, onWarn: msg => warn(`[${action.id}] ${msg}`)});
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
    catch (err) { error("原生 configureVFXEffect 抛错（本模组将接管，画风会与原生不同）", err); }

    try {
      // 世界级总开关关掉时连计划都不产：否则每条动作都往聊天卡的 flags 里写一份平均
      // 4KB、永远不会被读的死数据，落进世界库且只能靠清空聊天记录回收。
      //
      // 这里**只能**读 SETTINGS.ENABLED（world scope），不能用 dispatch.mjs 的
      // animationsEnabled()——那个函数还包含 crucible/enableVFX（client scope），
      // 用它会让「出手这台客户端有没有开动画」决定全场其他人能不能看到动画。
      //
      // 读设置失败时按「开」处理（fail-open）：产出侧多写一份计划只是浪费，播放侧的
      // animationsEnabled() 才是权威闸门；产出侧 fail-closed 会让模组在一次设置读取
      // 抖动后彻底静默且无任何诊断。
      let enabled = true;
      try { enabled = getSetting(SETTINGS.ENABLED) !== false; } catch { /* 未注册，按开处理 */ }
      if (!enabled) return nativeConfig;

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
      // 没接管就必须把上一次留下的计划擦掉。今天 configureVFXEffect() 每个 action 实例
      // 只会被调用一次（唯一调用点 _prepareMessage，唯一调用点 toMessage），所以这条
      // 分支不可达；但 CrucibleAction.fromChatMessage（action.mjs:3510-3578）会把聊天卡
      // 里的 metadata 原样灌回一个活的 action 实例——包括我们的 cav。哪一天有人对这样
      // 一个实例再调一次 toMessage（重放菜单、interpose 之类的改写流程），而这次原生
      // 给出了配置，同一张卡上就会同时挂着 flags.vfxConfig 与 metadata.cav，两套动画
      // 一起播。这是本模组与原生唯一可能同时播放的门，一行就能永久关死。
      else delete this.metadata[META_KEY];
    } catch (err) {
      error("动画包装体失败，已降级", err);
    }
    return nativeConfig;
  };
}
