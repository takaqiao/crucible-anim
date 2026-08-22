import {META_KEY, PERSIST_LEAD_MS, SETTINGS} from "../const.mjs";
import {getSetting} from "../settings.mjs";
import {playPlan} from "../player/play.mjs";
import {createSemaphore, TIMED_OUT} from "../player/semaphore.mjs";
import {debug, warn} from "../log.mjs";

/**
 * 一个进程内共享的播放队列，被本文件与 trigger/effects.mjs 共用——两者最终都在给
 * 同一块画布叠 Sequencer 序列，用同一条队列才能真正防止「动作动画」与「状态上身动画」
 * 彼此重叠。
 *
 * 不传 timeoutMs：让它吃 semaphore.mjs 自己的默认值。Task 13 把默认值从 8000 调到
 * 15000——434 条计划按 Sequencer 的等待语义模拟，最长的落在 7-8 秒量级，而 preload
 * （`Sequence.play()` 先 await 初始化、再 await Preloader.preload，都发生在任何一段
 * 播放之前）在冷缓存下走网络加载 jb2a webm 秒级很常见，8000ms 对最长的那几条只剩个位数
 * 百分比余量。这里如果再显式传一个 timeoutMs，就是把那次调参原样撤销；不传，未来
 * semaphore.mjs 的默认值再变也会自动跟上，不会重演“简报写死旧值把新默认覆盖回去”的
 * 这次事故。
 */
const semaphore = createSemaphore();

/**
 * 共享串行队列此刻的排队深度。只读，供诊断与测试观察——persist 通道的全部要点就是
 * 它**不该**让这个数字增长（让路期间不入队、播放时也不入队）。
 */
export const queueDepth = () => semaphore.pending;

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
 *
 * 三条优先级，缺一不可（与 test/play-contract.test.mjs 的 makeResolveRef——那是这份
 * 契约的参考实现——行为一致）：
 *   1. `ref:"point"` 必须最先短路，且**不看它是否恰好也带着 tokenId**：这是模板/区域
 *      的冻结坐标（travel.mjs 的 templateAnchor、aftermath.mjs 的 residueAnchor、
 *      本文件下方 play.mjs 里 aim.towards 的换算都会在这个 ref 上带 tokenId，因为它是
 *      从目标格拼出来的）。ray/cone 的 stretchTo 终点与 mask 都取自 region 坐标；如果
 *      先按身份查 token 再回退坐标，锥形的锚点会被施法者/目标 token 中心顶掉，而
 *      stretchTo 与 mask 仍然钉在 region 坐标上——起点、终点、遮罩来自两套原点，几何
 *      自相矛盾，且没有任何 warning 能抓住这个错位。
 *   2. 带 uuid 或 tokenId 的身份锚点——attachTo / copySprite 必须拿到一个真正的
 *      placeable，优先解析。uuid 走 fromUuidSync（跨 compendium/跨场景都稳），
 *      解析不到再退回本场景的 token 集合按 id 查——这是 makeResolveRef 在纯数据测试
 *      环境下唯一能用的路径，真实环境里两条都要试。
 *   3. 只剩坐标——退化成裸点，用于 token 已从画面消失（离场、跨场景）时。
 *
 * @param {Scene} scene
 */
export function resolveRefIn(scene) {
  return function resolveRef(at) {
    if (!at) return null;
    if (at.ref === "point") {
      return Number.isFinite(at.x) && Number.isFinite(at.y) ? {x: at.x, y: at.y} : null;
    }
    const byUuid = at.uuid ? (fromUuidSync(at.uuid)?.object ?? null) : null;
    const byId = byUuid ? null : (at.tokenId ? (scene?.tokens?.get?.(at.tokenId)?.object ?? null) : null);
    const token = byUuid ?? byId;
    if (token) return token;
    if (Number.isFinite(at.x) && Number.isFinite(at.y)) return {x: at.x, y: at.y};
    return null;
  };
}

/**
 * 把一次动画播放交给共享队列，统一吸收两种"没有正常播完"的结局：
 *   · 拒绝——playPlan 本身抛错，记一条 warning 并吞掉，不让它冒泡成未处理 rejection；
 *   · TIMED_OUT——semaphore.run() 现在不再是简单的 resolve/reject：单条任务在
 *     timeoutMs 内没播完时，run() 用这个哨兵值 resolve（不是 reject），队列继续放行
 *     后面排队的任务，而这一条本身仍在后台跑完（见 semaphore.mjs 的文档）。
 *     semaphore 自己已经在超时那一刻打过一条 warn；这里额外留一条带上下文（是哪条
 *     消息/哪个状态）的 debug，方便回放时定位是谁把队列顶住了。
 * @param {string} label  用于日志的可读标识（聊天卡 id 或状态名）
 * @param {() => Promise<void>} fn
 */
export async function runAnimation(label, fn) {
  const result = await semaphore.run(fn).catch(err => {
    warn(`${label} 的动画播放失败`, err);
    return undefined;
  });
  if (result === TIMED_OUT) debug(`${label} 的动画播放超时放行，队列已继续`);
}

/**
 * persist 计划的专用通道：**不进**共享串行队列，但主动给动作动画让路。
 *
 * 为什么不能走 runAnimation（Critical-2）：`playPlan()` 对带 persist cue 的计划
 * 在把序列交给 Sequencer 之后就返回（见 player/play.mjs 末尾），但即便如此，把状态动画
 * 塞进串行队列在语义上也是错的——
 *  · 队列的用途是防止**转瞬即逝**的动作画面叠成一团；持久光环是稳态标记，本来就该与
 *    任何东西共存。一次 AoE 让 5 个人上毒，5 圈光环必须同时出现，而不是排队。
 *  · Sequencer 自己对并发持久特效毫无串行化：`EffectManager._playEffect`
 *    （sequencer.js:11817）每次 `CanvasEffect.make(data)`（15159，persist 走
 *    `PersistentCanvasEffect`，17784）都造一枚独立对象，按各自的 id 记进
 *    `SequenceManager.VisibleEffects`；清理走 `_filterEffects`（11694-11703）逐枚过滤。
 *    全链路没有任何跨序列的锁——串行是本模组自己加的约束，不是 Sequencer 的要求。
 *
 * 两段有界等待解决顺序倒置（见 const.mjs 的 PERSIST_LEAD_MS）：
 *  1. whenBusy(PERSIST_LEAD_MS)：等造成这个状态的那个动作把它的动画排进队列。
 *     Crucible 先创建 ActiveEffect、后翻 confirmed，两者之间隔一次数据库往返；
 *     等到了就进第 2 步，等不到（GM 手搓状态、回合开始的 DoT、别的模组加的效果）
 *     就直接播，最多晚 PERSIST_LEAD_MS。
 *  2. whenIdle()：等那条动作动画播完。只等此刻已排在队里的，自己不入队，
 *     所以后面新来的动作动画不会被这一步挡住。
 *
 * @param {string} label
 * @param {() => Promise<void>} fn
 */
export async function runPersistAnimation(label, fn) {
  try {
    if (await semaphore.whenBusy({timeoutMs: PERSIST_LEAD_MS})) {
      if (!await semaphore.whenIdle()) {
        debug(`${label} 等动作队列排空超时，直接播出（可能与动作动画重叠）`);
      }
    } else {
      debug(`${label} 宽限期内没有动作动画入队，直接播出`);
    }
    await fn();
  } catch (err) {
    warn(`${label} 的动画播放失败`, err);
  }
}

/**
 * 这条聊天卡是否带着本模组的计划。
 *
 * 抽成一个导出的判据，是因为它有三个消费者且必须永远一致：下面的播放闸门、
 * playFromMessage 自己的守卫、以及 Task 15 的重放菜单 condition
 * （IMPLEMENTATION-PLAN.md 里目前是就地重写的
 * `!!msg?.flags?.crucible?.metadata?.[META_KEY]`）。三处各写一遍迟早漂移，
 * 而漂移的表现是「菜单出现但点了没反应」这类最难查的症状。
 */
export function planOf(message) {
  return message?.flags?.crucible?.metadata?.[META_KEY] ?? null;
}

/**
 * 解析这条聊天卡该在哪个场景播放。
 *
 * 两条分支必须同宽严。`flags.crucible.token` 记的是出手 TokenDocument 的 uuid
 * （CrucibleAction#_prepareMessage：`if (this.token) actionData.token = this.token.uuid`，
 * models/action.mjs:3282）。召唤物出手后被消灭、token 被删、整张场景被删，
 * fromUuidSync 都会返回 null——这不代表「不该播」，只代表「问不出它当初在哪」，
 * 此时必须与「压根没有 token flag」那条分支一样退回 canvas.scene，剩下的由
 * resolveRefIn 的第三优先级（裸坐标）兜住已经消失的锚点。原来的三元写法在这里
 * 直接放弃，两条分支一严一宽，且没有任何日志：现象是「某些卡完全没动画、
 * 控制台一片空白」。
 *
 * 但「解析出来了、只是不在当前视图」不走兜底——那是真正的跨场景，本来就不该播。
 * 兜底只针对解析失败，不针对解析成功但结论是「别处」。
 *
 * `{strict: false}`：fromUuidSync 默认 strict:true，对 compendium 内嵌文档 uuid 会
 * **同步抛错**（foundry client/utils/helpers.mjs:188-198），而这里位于一个 async
 * 函数的调用链里，抛出来就变成挂在 message._vfxPlayback 上的 rejected promise——除了
 * 执行 confirm() 的那一个客户端会 `.catch(()=>{})`（models/action.mjs:2685），其余
 * 所有客户端都无人处理。strict:false 让它老实返回 null，走上面的兜底。
 */
export function sceneForMessage(message) {
  const tokenUuid = message?.flags?.crucible?.token;
  if (tokenUuid) {
    const scene = fromUuidSync(tokenUuid, {strict: false})?.parent ?? null;
    if (scene) return scene;
    debug(`聊天卡 ${message.id} 的出手 token 已解析不到，场景退回 canvas.scene`);
  }
  return canvas?.scene ?? null;
}

/**
 * 播放一条聊天消息携带的动画计划。
 *
 * 两个调用方：下面的 confirmed 闸门，以及 Task 15 的重放菜单（直接 await 调用，
 * 不碰 _vfxPlayback——重放发生在 confirm 早已结束之后，没有 postConfirm 需要推迟）。
 * 因此这个函数必须保持无状态、可重复调用：任何「是否已经播过」的记忆都只能留在
 * 闸门里，不能沉到这里，否则重放菜单会跟着一起哑掉。
 *
 * 整体 try/catch 不可省：本函数是 async，准备阶段（fromUuidSync、canvas）同步抛错
 * 会变成 rejected promise，installDispatch 的 try/catch 接不住，而它又被直接赋给
 * message._vfxPlayback 广播给所有客户端 —— 只有出手那一端会 catch。
 */
export async function playFromMessage(message) {
  try {
    const plan = planOf(message);
    if (!plan) { debug(`聊天卡 ${message?.id} 没有本模组的动画计划（原生已处理或本来无内容）`); return; }
    if (!animationsEnabled()) return;

    const scene = sceneForMessage(message);
    if (!scene?.isView) {                          // 不在当前视图的场景不播
      debug(`聊天卡 ${message.id} 的场景不在当前视图，跳过播放`);
      return;
    }

    await runAnimation(`聊天卡 ${message.id}`, () => playPlan(plan, {
      volume: getSetting(SETTINGS.VOLUME),
      shake: getSetting(SETTINGS.SHAKE),
      resolveRef: resolveRefIn(scene)
    }));
  } catch (err) {
    warn(`聊天卡 ${message?.id} 的动画播放准备失败`, err);
  }
}

/**
 * updateChatMessage 闸门的全部判断逻辑，从 installDispatch 里抽出来，
 * 好在没有 Hooks/ChatMessage 的环境下直接单测（play 可注入）。
 *
 * **接管 _vfxPlayback 的条件是「本模组确实有 plan」，不是「这个字段还空着」。**
 * 原来的 `message._vfxPlayback = message._vfxPlayback ?? playFromMessage(message)`
 * 有两个分支，它防住的那个永远不发生，误伤的那个天天发生：
 *
 *  · 「原生已写」：原生只在 flags.vfxConfig 为真时写这个字段
 *    （CrucibleChatMessage#_onUpdate，documents/chat-message.mjs:42-44），而
 *    flags.vfxConfig 就是我们包装体的返回值（models/action.mjs:3286
 *    `actionData.vfxConfig = this.configureVFXEffect()`）——我们产出 plan 的前提正是
 *    nativeConfig 为 null（wrap.mjs 的第一行 `if (nativeConfig) return null`），两者
 *    互斥，这个分支不存在。
 *  · 「本模组已写」：_vfxPlayback 从不清空。撤销（confirm({reverse:true}) 把 confirmed
 *    写回 false，models/action.mjs:2680 的 `!reverse`）之后 confirmMessage 的双重确认
 *    守卫（models/action.mjs:3495 只看 confirmed flag）不再拦截，GM 可以再点一次
 *    确认——这是聊天卡右键菜单直接提供的常规流程。此时 `??` 撞上第一轮留下的、早已
 *    settle 的 promise 直接短路，playFromMessage 一次都不被调用。原生在同一条路径上是
 *    **无条件重新赋值**、因此会重播的。
 *
 * 次生后果同样要命：`confirm()` 随后 `Promise.race([this.message._vfxPlayback…])`
 * （models/action.mjs:2683-2686）拿到的是一枚陈旧的已兑现 promise，本次集成最核心的
 * 收益——推迟 postConfirm 连锁动作直到动画播完——在这条路径上一并失效。
 *
 * 改成「有 plan 才覆盖赋值」后，重播恢复，而且比 `??` 更严格：没有 plan 时我们连读都
 * 不读这个字段，原生那份真 promise 一个字节都碰不到。
 *
 * `if (flags.vfxConfig) return;` 是额外的一道防御，代价为零：正常路径下它与
 * `planOf()` 互斥，唯一能同时为真的情形是同一个 action 实例上 configureVFXEffect()
 * 被调用两次、第二次原生给出了配置（wrap.mjs 现在会在那一次 `delete` 掉旧 plan，
 * 但读到的仍可能是一张早已写好的卡）。那种情况下原生会自己在 _onUpdate 里播，
 * 让位给它才是对的。
 */
export function onMessageConfirmed(message, changed, play = playFromMessage) {
  try {
    const flags = message.flags?.crucible ?? {};
    if (!flags.action) return;
    if (foundry.utils.getProperty(changed, "flags.crucible.confirmed") !== true) return;
    if (flags.vfxConfig) return;                   // 原生接管了这条动作，让位
    if (!planOf(message)) {
      debug(`聊天卡 ${message.id} 已确认，但没有本模组的计划（兵库无匹配）`);
      return;
    }
    debug(`聊天卡 ${message.id} 已确认，尝试播放`);
    message._vfxPlayback = play(message);
  } catch (err) {
    warn("聊天卡确认钩子处理失败", err);
  }
}

/**
 * 复用 Crucible 自己的闸门：动画只在 confirmed 由假翻真时播放。
 * 白拿三件事：撤销动作不播（撤销把 confirmed 翻回 false，走同一条 update 但方向相反，
 * 见 CrucibleAction#confirm 的 `confirmed: !reverse`）、3D 骰子播完才播
 * （CrucibleChatMessage#autoConfirmMessage 在翻 confirmed 之前就 await 过
 * game.dice3d.waitFor3DAnimationByMessageID，我们的钩子只在翻转之后才触发）、
 * 各客户端本地播放因此不需要 socket，也就不会双播。
 */
export function installDispatch() {
  Hooks.on("updateChatMessage", (message, changed) => onMessageConfirmed(message, changed));
}
