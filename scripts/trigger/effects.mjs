import {SETTINGS} from "../const.mjs";
import {getSetting} from "../settings.mjs";
import {snapshotEffect} from "./snapshot.mjs";
import {resolveEffect} from "../resolver/resolve.mjs";
import {animationsEnabled, resolveRefIn, runPersistAnimation} from "./dispatch.mjs";
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
    const tag = msg => warn(`[persist:${snapshot.statusId}] ${msg}`);
    // onWarn 只在 resolveEffect 产出空计划时被调用（见 resolve.mjs 的 drainWarnings）：
    // persist 规则每条只产 1 个 cue，被 keepTied 丢掉后计划为空、warning 本会随之蒸发。
    const plan = resolveEffect(snapshot, {...deps, onWarn: tag});
    if (plan) for (const msg of plan.warnings ?? []) tag(msg);
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
 * 除了创建/删除两端，持续特效还有三个必须补的入口（Task 15，`resyncPersist` 一节）：
 * GM 在 token HUD 上直接 toggle 一个状态（update 而非增删）、客户端重载/切场景回来、
 * 以及带着状态的 token 被拖进当前场景。三者共用下面的 `playPersist`/`endPersist`，
 * 保证"什么时候该播"与"具体怎么播"只有一处实现。
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
      for (const token of actor.getActiveTokens()) playPersist(effect, token, deps, env());
    } catch (err) {
      error("状态特效触发失败，已跳过", err);
    }
  });

  // GM 在 token HUD 上直接 toggle 一个状态走的是 update（`disabled` 翻转），不是增删——
  // 缺了这个钩子，GM 手动禁用一个状态后光环仍在转，重新启用也不会补回来。只关心
  // `disabled` 这一个字段：其余字段变化（duration、描述文本…）与"该不该有光环"无关，
  // 全部忽略，避免每次编辑效果都触发一轮多余的 Sequencer 查询。
  Hooks.on("updateActiveEffect", (effect, changed) => {
    try {
      if (!("disabled" in changed)) return;
      if (!animationsEnabled()) return;
      if (effect.active) syncEffect(effect, deps, env());
      else endPersist(effect?.uuid);
    } catch (err) {
      error("状态启停触发失败，已跳过", err);
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
    endPersist(effect?.uuid);
  });

  // 重载 / 切场景回来 / 中途进场。
  // ⚠ 不能挂 canvasReady（已核对 Sequencer 4.2.3 源码）：canvasReady 处理是
  // `setTimeout(setupModule, isSceneSwitch ? 450 : 100)`（sequencer.js:30881-30886），
  // setupModule → initializePersistentEffects()，而它第一件事就是
  // `await tearDownPersistentEffects()`（11920），会 destroy 掉 VisibleEffects 里的
  // **全部**效果，包括我们抢在前面播的。必须等它跑完，也就是挂它末尾的
  // `Hooks.callAll("sequencerEffectManagerReady")`（11953）。该钩子走的是
  // `Promise.all(promises).then(...)`，「一条持久化记录都没有」时照样触发——
  // worldPersist:false 让我们一条都不落盘，正是这个情况。
  // 挂错成 canvasReady 的症状是「切场景回来光环没了」。
  Hooks.on("sequencerEffectManagerReady", () => { void resyncPersist(deps, env()); });

  // 把已经带着状态的 token 拖进/放进当前场景。doc.parent 是 TokenDocument#scene 的
  // 别名，doc.object 是渲染出来的 Token placeable——刚创建时可能尚未渲染完成，为空
  // 时静默跳过（下一次 sequencerEffectManagerReady 会补上）。
  Hooks.on("createToken", (doc) => {
    try {
      if (!animationsEnabled()) return;
      if (doc?.parent?.isView && doc.object) syncToken(doc.object, deps, env());
    } catch (err) {
      error("token 入场触发失败，已跳过", err);
    }
  });
}

/**
 * 当前场景全部 token 补齐一遍。幂等，随便多调——`isPlayingPersist` 保证已经在播的
 * 不会被重新播放一次。canvas.ready 为假时（尚在加载）直接跳过，等下一次
 * sequencerEffectManagerReady 自然补上。
 * @param {{assets: object, armory: object}} deps
 * @param {{gridSize: number}} env
 */
export async function resyncPersist(deps, env) {
  if (!canvas?.ready) return;
  for (const token of canvas.tokens?.placeables ?? []) syncToken(token, deps, env);
}

/** 一个 token 身上全部生效中的效果各补一遍持续特效。 */
function syncToken(token, deps, env) {
  for (const effect of token?.actor?.effects ?? []) {
    if (!effect.active) continue;
    playPersist(effect, token, deps, env);
  }
}

/** 一份效果重新生效（GM 在 HUD 上把 disabled 翻回 false）时，给它挂着的每个 token 补齐。 */
function syncEffect(effect, deps, env) {
  if (!(effect.parent instanceof Actor) || !effect.active) return;
  for (const token of effect.parent.getActiveTokens()) playPersist(effect, token, deps, env);
}

/**
 * 本客户端是不是已经在放这一份光环。只查本地 EffectManager（`getEffects` 只看
 * `SequenceManager.VisibleEffects`，sequencer.js:11538-11540），这正是需要的粒度——
 * 世界存档里别的客户端各自那份记录不该影响本地判断。
 * 必须 origin **和** object 一起过滤：一个 linked actor 的两个 token 共用同一个 effect
 * uuid，只按 origin 判会让第二个 token 永远补不上光环。`object` 会被
 * `_validateFilters` 映射成 source（11763-11766），而我们的 persist cue 是
 * attachTo:true → data.source 就是 token 的 uuid，对得上。
 */
function isPlayingPersist(effectUuid, token) {
  try {
    return Sequencer.EffectManager.getEffects({origin: effectUuid, object: token}).length > 0;
  } catch { return false; }
}

/**
 * 播放一份状态持续特效——五个入口（创建、update 重新生效、resync 的两条路径）共用的
 * 唯一落点。幂等：本地已经在放同一份（同 effect + 同 token）时直接跳过，resync 才能
 * 随便多调而不叠层。
 * @param {ActiveEffect} effect
 * @param {Token} token  Token placeable（getActiveTokens()/canvas.tokens.placeables 给的都是这个形状）
 * @param {{assets: object, armory: object}} deps
 * @param {{gridSize: number}} env
 */
function playPersist(effect, token, deps, env) {
  if (isPlayingPersist(effect.uuid, token)) return;
  const plan = planForEffect(effect, token, env, deps);
  if (!plan) return;
  debug(`状态 ${plan.source} 上身`, plan);
  // 走 persist 专用通道而不是共享串行队列：持久光环是稳态标记，既不该占住队列，
  // 也不该彼此排队（AoE 一次让 5 个人上毒，5 圈光环必须同时出现）。让路与顺序倒置
  // 的处理全在 runPersistAnimation 里，理由与源码依据见那里的注释。不 await——
  // 多个目标各自让路即可。
  // volume 走用户设置而不是硬编码 1：目前 persist 兵库里没有一条 sound cue，
  // 这两种写法暂时观察不出差异，但 play.mjs 对 volume 的处理不区分槽位来源，
  // 硬编码在这里等于给"状态特效的音量不受设置项控制"埋了一个将来才会兑现的坑。
  runPersistAnimation(`状态 ${plan.source}@${token.id}`, () => {
    // 让路期间状态可能已经没了（GM 撤销、瞬时过期）。这时候再播就是一枚**永远
    // 清不掉**的光：CanvasEffect 注册 tie 钩子时是 `const tiedDocument =
    // fromUuidSync(uuid); if (tiedDocument) { …addHook… }`（sequencer.js:16932-
    // 16943），解析不到就不注册；而 deleteActiveEffect 里按 origin 收尾的那条兜底
    // 早在我们播出之前就跑过了，扫不到还没存在的特效。判据用 fromUuidSync 而不是
    // `effect.parent.effects.has(...)`，是为了与 Sequencer 用的解析路径逐字一致。
    if (!fromUuidSync(effect.uuid)) {
      debug(`状态 ${plan.source} 在让路期间已被移除，放弃播放（否则光效清不掉）`);
      return undefined;
    }
    return playPlan(plan, {
      volume: getSetting(SETTINGS.VOLUME), shake: false, resolveRef: resolveRefIn(token.scene)
    });
  });
}

/**
 * 收尾一份持久特效播放。origin 为空（effect 缺 uuid）时直接跳过。
 *
 * endEffects 是 `static async`（sequencer.js:11626）：_validateFilters 的
 * custom_error（11748-11761）与 _endManyEffects 的失败**全部**发生在异步函数体内，
 * 同步 try/catch 一条都接不住，只会在每个客户端的控制台里留下一条既没有本模组前缀、
 * 也没有 effect uuid 的 unhandled rejection。必须用 .catch()。
 * 外面套 Promise.resolve().then(...) 而不是直接 .catch()，是为了让「Sequencer 全局
 * 本身不存在」抛的那个**同步** TypeError 也落进同一条 catch——两种失败一个出口。
 *
 * 不传 sceneId：评审建议的「显式传 token 所在场景的 sceneId 以覆盖跨场景」是空操作。
 * _filterEffects 根本不看 sceneId（只按 effects/name/source/target/origin 五项过滤，
 * 11694-11703），_validateFilters 写进去的那个 sceneId 只喂给 _validateObject；
 * 真正的范围限制来自 SequencerEffectManager.effects ≡ SequenceManager.VisibleEffects
 * （11538-11540）。而本模组的 persist cue 是 e.temporary(true)（worldPersist:false），
 * _playEffect 的 `!data.temporary` 守卫（11819）让它根本不落 flag——别的场景上没有
 * 可清理的残留（那是「切场景往返光环消失」的另一个问题，不归这条兜底管）。
 * @param {string|null|undefined} originUuid
 */
function endPersist(originUuid) {
  if (!originUuid) return;
  Promise.resolve()
    .then(() => Sequencer.EffectManager.endEffects({origin: originUuid}, false))
    .catch(err => warn(`清理状态 ${originUuid} 的持续特效失败`, err));
}
