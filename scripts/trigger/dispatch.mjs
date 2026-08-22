import {META_KEY, SETTINGS} from "../const.mjs";
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

/** 播放一条聊天消息携带的动画计划。 */
export async function playFromMessage(message) {
  const plan = message?.flags?.crucible?.metadata?.[META_KEY];
  if (!plan) { debug(`聊天卡 ${message?.id} 没有本模组的动画计划（原生已处理或本来无内容）`); return; }
  if (!animationsEnabled()) return;
  const scene = message.flags?.crucible?.token
    ? fromUuidSync(message.flags.crucible.token)?.parent
    : canvas.scene;
  if (!scene?.isView) return;                   // 不在当前视图的场景不播

  await runAnimation(`聊天卡 ${message.id}`, () => playPlan(plan, {
    volume: getSetting(SETTINGS.VOLUME),
    shake: getSetting(SETTINGS.SHAKE),
    resolveRef: resolveRefIn(scene)
  }));
}

/**
 * 复用 Crucible 自己的闸门：动画只在 confirmed 由假翻真时播放。
 * 白拿三件事：撤销动作不播（闸门是 confirmed 翻 true，撤销把它翻回 false，走的是
 * 同一条 update 但方向相反，见 CrucibleAction#confirm 的 `confirmed: !reverse`）、
 * 3D 骰子播完才播（CrucibleChatMessage#autoConfirmMessage 在翻 confirmed 之前就
 * await 过 game.dice3d.waitFor3DAnimationByMessageID，我们的 hook 只在翻转之后才
 * 触发，天然排在骰子动画后面）、各客户端本地播放因此不需要 socket，也就不会双播。
 */
export function installDispatch() {
  Hooks.on("updateChatMessage", (message, changed) => {
    try {
      const flags = message.flags?.crucible ?? {};
      if (!flags.action) return;
      if (foundry.utils.getProperty(changed, "flags.crucible.confirmed") !== true) return;
      debug(`聊天卡 ${message.id} 已确认，尝试播放`);

      // 挂到 Crucible 自己的 _vfxPlayback 字段，而不是另起一个模组私有字段：
      // CrucibleAction#confirm() 在把 confirmed 写成 true 之后会
      // `await Promise.race([this.message._vfxPlayback.catch(()=>{}), maxWait(3000ms)])`
      // 才继续跑 postConfirm 钩子（连锁动作、英雄气概触发的后续流程都挂在这一步之后）。
      // 原生只在 flags.vfxConfig 为真（即原生真的接管了这条动作）时才会写这个字段
      // （CrucibleChatMessage#_onUpdate 的 `flags.action && flags.vfxConfig && …`）；
      // 我们只在 nativeConfig 为 null（原生没接管）时才会产出 plan——两者互斥，`??=`
      // 只是双保险，不会真的用到"已经有值所以跳过"这条分支。不这样接的话，原生会在
      // 我们的动画还没播完时就放行后续钩子，连锁反击/连锁法术会看见动画被自己的
      // 下一步打断。
      message._vfxPlayback = message._vfxPlayback ?? playFromMessage(message);
    } catch (err) {
      warn("聊天卡确认钩子处理失败", err);
    }
  });
}
