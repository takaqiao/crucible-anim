import {SETTINGS} from "../const.mjs";
import {getSetting} from "../settings.mjs";
import {snapshotEffect} from "./snapshot.mjs";
import {resolveEffect} from "../resolver/resolve.mjs";
import {animationsEnabled, resolveRefIn, runAnimation} from "./dispatch.mjs";
import {playPlan} from "../player/play.mjs";
import {debug, warn, error} from "../log.mjs";

/**
 * persist 槽的纯逻辑部分：从一个活的 ActiveEffect + Token 产出计划，抽出来是为了能
 * 脱离 Foundry 单测（与 wrap.mjs 的 buildPlanFor 同一个理由）。
 *
 * `snapshot?.statusId` 而不是 `snapshot.statusId`：snapshotEffect 在没有 token 时
 * 直接返回 null（离场角色、跨场景、未链接 token 尚未渲染都是正常情形，不是错误），
 * 裸着访问 `.statusId` 会在这条完全正常的路径上抛 TypeError，被下面的 catch 接住后
 * 误报成"构造失败"——同一次降级，日志却从"静默"变成"报错"，误导排查。
 *
 * @param {ActiveEffect} effect
 * @param {Token|null} token
 * @param {{gridSize: number}} env
 * @param {{assets: object, armory: object}} deps
 * @returns {FXPlan|null}
 */
export function planForEffect(effect, token, env, deps) {
  try {
    const snapshot = snapshotEffect(effect, token, env);
    if (!snapshot?.statusId) return null;
    const plan = resolveEffect(snapshot, deps);
    if (plan) for (const msg of plan.warnings ?? []) warn(`[persist:${snapshot.statusId}] ${msg}`);
    return plan;
  } catch (err) {
    error("为状态效果构造动画计划失败，已跳过", err);
    return null;
  }
}

/**
 * 状态效果的持续特效由 ActiveEffect 增删驱动，独立于动作（不挂在任何动作的时间轴上，
 * 见 resolver/resolve.mjs 的 resolveEffect 与 NO_PRIOR_SLOTS）。
 *
 * 创建侧：`effect.statuses` 在 createActiveEffect 钩子触发时保证已经填好——它是
 * ActiveEffectData 的 schema 字段（SetField），要么由状态生成器/_fromStatusEffect
 * 在 _preCreate 之前就写进 source 数据，要么由战斗直调的 event.effects 原样带着；
 * 两条路径都在文档真正落地（createActiveEffect 是 _onCreate 之后才触发的钩子）之前
 * 就已经确定，不存在"字段还没来得及填"的竞态。核实过 Crucible 自己的
 * CrucibleActiveEffect#_preCreate（/root/fvtt14-data 的 module/documents/
 * active-effect.mjs）在 `_preCreate` 里就同步遍历 `this.statuses` 拼描述文本，
 * 证明这个字段在文档构造完成的那一刻就已经可读，不是异步派生。
 *
 * 删除侧：cue 带了 persist + tieTo，Sequencer 在被绑定的 document 消失时会自动清理
 * 动画（tiedDocuments 的 delete 钩子），这里只补一条兜底，处理 tieToDocuments 解析
 * 失败等边界情况。
 *
 * @param {{assets: object, armory: object}} deps
 */
export function installEffectTriggers(deps) {
  const env = () => ({gridSize: canvas?.dimensions?.size ?? 100});

  Hooks.on("createActiveEffect", (effect) => {
    try {
      const actor = effect.parent;
      if (!(actor instanceof Actor)) return;
      if (!animationsEnabled()) return;
      // getActiveTokens() 已经把范围限定在 canvas.scene（当前查看的场景）——离场角色、
      // 跨场景、尚未渲染的 token 在这里自然拿到空数组，不需要额外的 isView 判断。
      for (const token of actor.getActiveTokens()) {
        const plan = planForEffect(effect, token, env(), deps);
        if (!plan) continue;
        debug(`状态 ${plan.source} 上身`, plan);
        // 复用 dispatch.mjs 的共享队列：动作动画与状态上身动画最终都在同一块画布上
        // 叠 Sequencer 序列，只有共用同一条队列才能真正防止两者互相重叠（AoE 一次
        // 命中数人、每人各上一个状态的场景尤其容易撞在一起）。不 await——多个目标各自
        // 排队即可，串行化交给队列自己处理。
        // volume 走用户设置而不是硬编码 1：目前 persist 兵库里没有一条 sound cue，
        // 这两种写法暂时观察不出差异，但 play.mjs 对 volume 的处理不区分槽位来源，
        // 硬编码在这里等于给"状态特效的音量不受设置项控制"埋了一个将来才会兑现的坑。
        runAnimation(`状态 ${plan.source}@${token.id}`, () => playPlan(plan, {
          volume: getSetting(SETTINGS.VOLUME), shake: false, resolveRef: resolveRefIn(token.scene)
        }));
      }
    } catch (err) {
      error("状态特效触发失败，已跳过", err);
    }
  });

  Hooks.on("deleteActiveEffect", (effect) => {
    // 兜底：tieToDocuments 未生效（或该效果从没产出过 cue）时按 origin 收尾。
    // 只按 origin 过滤：play.mjs 只设 .origin(cue.tieTo)、不设 .name()，而
    // _filterEffects（sequencer.js:11694-11703）的 name 与 origin 是 AND —— 带上 name
    // 子句会因为 effect.data.name 恒为 null 而匹配 0 条，兜底清理形同虚设。
    // 第二个参数 push 必须显式给 false：默认 true 会走 Sequencer 的跨客户端通路
    // （sequencer.js:11626-11639），违反 DESIGN §5.4 的契约 3
    // （test/armory-persist.test.mjs 的仓库级扫描会在这一行落地时抓住）。
    if (!effect?.uuid) return;
    try { Sequencer.EffectManager.endEffects({origin: effect.uuid}, false); }
    catch (err) { warn(`清理状态 ${effect.uuid} 的持续特效失败`, err); }
  });
}
