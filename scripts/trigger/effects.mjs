import {PERSIST_VISIBLE_TIMEOUT_MS, SETTINGS} from "../const.mjs";
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
 * `slot` 让同一段逻辑服务两个由 ActiveEffect 驱动的槽（两者的快照形状与规则签名完全
 * 相同，见 resolver/resolve.mjs 的 resolveEffect）：默认的 `persist` 是状态光环，
 * `death` 是击杀那一刻的一次性爆发（armory/death.mjs）。日志前缀跟着槽走，免得两条
 * 通道的告警在控制台里分不出是谁。
 *
 * @param {ActiveEffect} effect
 * @param {Token|null} token
 * @param {{gridSize: number}} env
 * @param {{assets: object, armory: object}} deps
 * @param {"persist"|"death"} [slot]
 * @returns {FXPlan|null}
 */
export function planForEffect(effect, token, env, deps, slot = "persist") {
  try {
    const snapshot = snapshotEffect(effect, token, env);
    if (!snapshot?.statusId) return null;
    const tag = msg => warn(`[${slot}:${snapshot.statusId}] ${msg}`);
    // onWarn 只在 resolveEffect 产出空计划时被调用（见 resolve.mjs 的 drainWarnings）：
    // persist 规则每条只产 1 个 cue，被 keepTied 丢掉后计划为空、warning 本会随之蒸发。
    const plan = resolveEffect(snapshot, {...deps, onWarn: tag}, slot);
    if (plan) for (const msg of plan.warnings ?? []) tag(msg);
    return plan;
  } catch (err) {
    error("为状态效果构造动画计划失败，已跳过", err);
    return null;
  }
}

/**
 * 画布网格尺寸。提到模块层是因为 `installPersistResync()` 在 `init` 就要用它，
 * 那时 `installEffectTriggers()` 还没跑（见下面 wiring 一节）。
 * 取名 currentEnv 而不是 env：下面几个函数的形参就叫 `env`（是一个对象），同名会
 * 让「在那些函数体里写 env() 」变成一个静默的 TypeError 陷阱。
 */
const currentEnv = () => ({gridSize: canvas?.dimensions?.size ?? 100});

/**
 * 提前注册的钩子 ←→ 依赖装配之间的握手。
 *
 * `sequencerEffectManagerReady` 每次画布加载**只发一次**，而 Sequencer 是在 canvas.ready
 * 之后很快就发（sequencer.js:30875-30879 的 setupModule → initializePersistentEffects →
 * 11953 的 `Hooks.callAll`），核心的 `Hooks.callAll("ready")` 却排在
 * `await documentIndex.index()` 与 `await canvas.initializing`（整场景绘制）之后
 * （foundry client/game.mjs:763-779）。把注册放在 `ready` 里 = 这一次画布加载的钩子
 * 已经播完了，而且**不会再发第二次**——症状是「重载/切场景回来所有持续光环消失」。
 *
 * 所以注册（`installPersistResync`，init）与依赖装配（`installEffectTriggers`，ready）
 * 必须拆开，且两种到达顺序都要正确：
 *   · 钩子先到 → `getDeps()` 还是 null，记下 `pendingResync`，等 main.mjs 装配完调
 *     `flushPersistResync()` 补跑一次；
 *   · deps 先好 → `getDeps()` 直接给出依赖，钩子照常处理。
 *
 * `getDeps` 由 main.mjs 注入，并且**只在自检通过且五次挂载全部成功之后**才返回非 null
 * （main.mjs 的 `liveDeps`，判据就是 `state.active`）——这正是「模组被自检禁用时提前
 * 注册的钩子必须自己短路」那条要求的落点：不需要每个回调各写一遍 state 判断，拿不到
 * 依赖就什么都不做。
 *
 * 每次 `installPersistResync()` 都把 `pendingResync` 清零，测试因此可以在同一个进程里
 * 反复重装而不串味。
 */
const wiring = {getDeps: () => null, pendingResync: false};

/**
 * 在 `init` 注册 `sequencerEffectManagerReady`。理由与两种到达顺序见 `wiring` 的注释。
 *
 * ⚠ 不能改挂 canvasReady（已核对 Sequencer 4.2.3 源码）：canvasReady 处理是
 * `setTimeout(setupModule, isSceneSwitch ? 450 : 100)`（sequencer.js:30881-30886），
 * setupModule → initializePersistentEffects()，而它第一件事就是
 * `await tearDownPersistentEffects()`（11920），会 destroy 掉 VisibleEffects 里的
 * **全部**效果，包括我们抢在前面播的。必须等它跑完，也就是挂它末尾的
 * `Hooks.callAll("sequencerEffectManagerReady")`（11953）。该钩子走的是
 * `Promise.all(promises).then(...)`，「一条持久化记录都没有」时照样触发——
 * worldPersist:false 让我们一条都不落盘，正是这个情况。
 * 挂错成 canvasReady 的症状是「切场景回来光环没了」。
 *
 * @param {() => ({assets: object, armory: object}|null)} getDeps
 */
export function installPersistResync(getDeps) {
  wiring.getDeps = typeof getDeps === "function" ? getDeps : () => null;
  wiring.pendingResync = false;
  Hooks.on("sequencerEffectManagerReady", () => {
    const deps = wiring.getDeps();
    if (!deps) {
      wiring.pendingResync = true;
      debug("sequencerEffectManagerReady 早于依赖装配到达，已记下待补的 resyncPersist");
      return;
    }
    void resyncPersist(deps, currentEnv());
  });
}

/**
 * 依赖装配完成后调用一次：如果 `sequencerEffectManagerReady` 已经先到过，就在这里补跑
 * 那一次 `resyncPersist`（本次画布加载不会再发第二次钩子）。没有待补项时是空操作。
 * @returns {boolean}  是否真的补跑了
 */
export function flushPersistResync() {
  if (!wiring.pendingResync) return false;
  wiring.pendingResync = false;
  const deps = wiring.getDeps();
  if (!deps) return false;
  debug("依赖装配完成，补跑一次先前挂起的 resyncPersist");
  void resyncPersist(deps, currentEnv());
  return true;
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
 * 在**角色卡效果页**上停用/启用一个状态（走 update 的 `disabled` 翻转，见下面
 * updateActiveEffect 的订正注释——**不是** token HUD，HUD 走的是 create/delete）、
 * 客户端重载/切场景回来、以及带着状态的 token 被拖进当前场景。三者共用下面的
 * `playPersist`/`endPersist`，保证"什么时候该播"与"具体怎么播"只有一处实现。
 *
 * 注意 `sequencerEffectManagerReady` 不在这里注册（它在 `init` 就得挂上，见
 * `installPersistResync`）；本函数只负责三个由用户操作驱动、`ready` 之后才可能发生的
 * 钩子，外加 deleteActiveEffect 的兜底清理。
 *
 * createActiveEffect 还兼管**第二条**通道：击杀爆发（`playDeath`，Task 15b）。它与
 * persist 共用这一个钩子，但**只**共用这一个——下面 `playDeath` 的注释逐条写了为什么
 * 它不能接到 resync / createToken 上。
 *
 * @param {{assets: object, armory: object}} deps
 */
export function installEffectTriggers(deps) {
  Hooks.on("createActiveEffect", (effect) => {
    try {
      const actor = effect.parent;
      if (!(actor instanceof Actor)) return;
      const env = currentEnv();
      // getActiveTokens() 已经把范围限定在 canvas.scene（当前查看的场景）——离场角色、
      // 跨场景、尚未渲染的 token 在这里自然拿到空数组，不需要额外的 isView 判断。
      for (const token of actor.getActiveTokens()) {
        playPersist(effect, token, deps, env);
        // 击杀爆发（Task 15b）。**只挂在这一个钩子上**：它是「状态真的落地了」这个
        // 转变本身，而 resyncPersist / createToken 是「把该有的稳态补齐」——把一次性
        // 爆发接上那两条，等于每次切场景、每具尸体都重放一遍。
        playDeath(effect, token, deps, env);
      }
    } catch (err) {
      error("状态特效触发失败，已跳过", err);
    }
  });

  /**
   * 【订正】这个钩子**不是**为 token HUD 上的状态 toggle 准备的（原注释写反了，
   * 三个评审镜头各自命中）。HUD 上点一下状态图标走的是
   * `TokenHUD.#onToggleEffect`（foundry client/applications/hud/token-hud.mjs:322-332）
   * → `Actor#toggleStatusEffect`（client/documents/actor.mjs:547-579），而后者要么
   * `deleteEmbeddedDocuments("ActiveEffect", existing)`（569）、要么
   * `ActiveEffect.create(...)`（578）——发的是 **create / delete**，由上下两个钩子接管，
   * 一次 update 都没有。照着原注释去砍这条分支会砍掉一条真正在用的入口。
   *
   * `disabled` 翻转真正的来源是**角色卡的效果页**：Crucible 的
   * `CrucibleBaseActorSheet.#onEffectToggle`
   * （crucible/module/applications/sheets/base-actor-sheet.mjs:1050-1053）
   * `await effect.update({disabled: !effect.disabled})`；同一条路径也覆盖
   * ActiveEffect 配置窗里手改 disabled、以及别的模组/宏直接 `effect.update()`。
   * 缺了这个钩子，在角色卡上停用一个状态之后光环仍在转，重新启用也不会补回来
   * （test/effects-resync.test.mjs 的两条 updateActiveEffect 用例守着这一点）。
   *
   * 只关心 `disabled` 这一个字段：其余字段变化（duration、描述文本…）与"该不该有光环"
   * 无关，全部忽略，避免每次编辑效果都触发一轮多余的 Sequencer 查询。
   *
   * 这里**不设** animationsEnabled 闸：该不该播是 `playPersist` 一处说了算（见 B 组
   * 修复），而收尾侧更不能设——关掉动画开关不该顺带把已经画在画布上的光环的清理入口
   * 一起关掉。
   */
  Hooks.on("updateActiveEffect", (effect, changed) => {
    try {
      if (!("disabled" in changed)) return;
      if (effect.active) syncEffect(effect, deps, currentEnv());
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

  // 重载 / 切场景回来 / 中途进场走 `sequencerEffectManagerReady`，但那个钩子必须在
  // `init` 就注册（见本文件上方的 installPersistResync / wiring），不在这里。

  // 把已经带着状态的 token 拖进/放进当前场景。doc.parent 是 TokenDocument#scene 的
  // 别名，doc.object 是渲染出来的 Token placeable——刚创建时可能尚未渲染完成，为空
  // 时静默跳过（下一次 sequencerEffectManagerReady 会补上）。
  Hooks.on("createToken", (doc) => {
    try {
      if (doc?.parent?.isView && doc.object) syncToken(doc.object, deps, currentEnv());
    } catch (err) {
      error("token 入场触发失败，已跳过", err);
    }
  });
}

/**
 * 当前场景全部 token 补齐一遍。幂等，随便多调——两道闸一起保证已经在播、或正在送出
 * 途中的那一份不会被重播（`isPlayingPersist` 管前者，`inFlight` 管后者，见
 * `playPersist`）。canvas.ready 为假时（尚在加载）直接跳过，等下一次
 * sequencerEffectManagerReady 自然补上。
 *
 * 「该不该播」的开关判断**不在这里**，在 `playPersist`——这是 B 组修复的落点：从前
 * 本函数与它的两个私有帮手都不查 `animationsEnabled()`，关掉动画开关（或 Crucible 的
 * enableVFX）之后，切场景 / F5 仍会给全场每个带状态的 token 补满光环，而且此后只能
 * 靠移除状态才消得掉。闸放在唯一落点上，任何新增入口都自动受管。
 *
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

/** 一份效果重新生效（在角色卡效果页上把 disabled 翻回 false）时，给它挂着的每个 token 补齐。 */
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
 * 本客户端正在**送出**（尚未能被 Sequencer 观察到）的那些光环。
 *
 * `isPlayingPersist` 只查 Sequencer 的 VisibleEffects，而 `playPersist` 从被调用到
 * 特效真的登记进 VisibleEffects 之间有一段可观的空窗，**两段**：
 *  1. `runPersistAnimation` 的 PERSIST_LEAD_MS（500ms）让路期，加上等动作动画播完；
 *  2. `seq.play()` 发出之后到特效登记之间——`playPlan()` 对 persist 计划不 await
 *     `seq.play()`（play.mjs 末尾那条 Critical），而 `Sequence.play()` 要先 await
 *     初始化、再 await `Preloader.preload`（冷缓存下拉一段 jb2a webm 是秒级），
 *     之后才 `section._execute()` → `_playEffect` → `VisibleEffects.add`
 *     （sequencer.js:11826）。
 * 这两段里 `isPlayingPersist` 恒为假——于是 T=0 状态落地、T=100ms 一次 resync
 * （切场景 / 拖 token 进场）就会给同一个 (effect, token) 再排一份，两圈光环叠在一起，
 * 文档里承诺的「resync 幂等、随便多调」在这段窗口内并不成立。
 *
 * 所以销账**不是**挂在 `runPersistAnimation` 的 promise 上（那只走完第 1 段），而是
 * 挂在 `awaitPersistVisible()` 上：一直等到特效能被 `isPlayingPersist` 观察到，或到
 * PERSIST_VISIBLE_TIMEOUT_MS 为止，二者先到为准。
 *
 * 键取 `effectUuid|tokenId`，与 `isPlayingPersist` 的过滤维度（origin + object）
 * 一致：一个 linked actor 的两个 token 共用同一个 effect uuid，只按 uuid 去重会让
 * 第二个 token 永远补不上光环。
 */
const inFlight = new Set();
const flightKey = (effectUuid, token) => `${effectUuid}|${token?.id ?? "?"}`;

/**
 * 清空在途登记。**只服务测试隔离**，生产代码不调用。
 *
 * inFlight 是模块级状态，而销账现在要挂到「特效可被观察到 / PERSIST_VISIBLE_TIMEOUT_MS」
 * 为止（见上）。同一个进程里跑的下一条用例往往用同样的 tokenId 与状态名，键因此完全
 * 相同，会被上一条用例留下的登记直接挡住——表现是断言「一份都不播」的用例假绿、断言
 * 「必须补上光环」的用例假红。理由与 `installPersistResync()` 每次都把 pendingResync
 * 清零完全一样：模块级状态要给测试留一个归零点。
 *
 * 生产侧不能调：一次会话里的在途登记必须连贯，中途清零重开的正是 E1 要关掉的那个空窗。
 */
export function resetPersistInFlight() {
  inFlight.clear();
}

/** 轮询「特效登记进 Sequencer 了没有」的间隔（毫秒）。 */
const VISIBLE_POLL_MS = 100;

/**
 * 一段**不会把宿主进程吊住**的等待。
 *
 * `unref()` 只在 Node 上存在（浏览器的 setTimeout 返回的是数字，`?.` 让这两处成为空
 * 操作），Foundry 运行时行为完全不变。加它的理由与 player/semaphore.mjs 里那句
 * 「clearTimeout 不可省……在 Node 里它直接吊住事件循环」同源：下面这是一条纯后台轮询，
 * 任何情况下都不该成为「进程还有事要做」的理由，否则每一条播出过持久特效的测试都会把
 * 测试进程多挂一个 PERSIST_VISIBLE_TIMEOUT_MS。
 */
const idleSleep = ms => new Promise(resolve => {
  const t = setTimeout(resolve, ms);
  t?.unref?.();
});

/**
 * 等到这一份持久特效能被 `isPlayingPersist` 观察到，或到有界超时为止（先到为准）。
 *
 * 超时**必须**有：播放可能失败（素材 404、构造期异常被 dropSection 撤下）、也可能
 * 在更下游被放弃，那些情形下特效永远不会出现在 VisibleEffects 里，死等 = key 永久
 * 泄漏 = 这份光环在本次会话里再也补不回来（见 `playPersist` 末尾的销账注释）。
 *
 * 导出是为了能脱离整条播放链单测「有界」这一半（同一个理由见 planForEffect）：整合
 * 用例只能行使「观察到就提前放行」，超时那一支要靠注入一个小 timeoutMs 才测得动。
 *
 * @param {string} effectUuid
 * @param {Token} token
 * @param {{timeoutMs?: number, pollMs?: number}} [opts]
 * @returns {Promise<boolean>}  是否真的观察到了（false = 走的是超时）
 */
export async function awaitPersistVisible(effectUuid, token,
    {timeoutMs = PERSIST_VISIBLE_TIMEOUT_MS, pollMs = VISIBLE_POLL_MS} = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (isPlayingPersist(effectUuid, token)) return true;
    const left = deadline - Date.now();
    if (left <= 0) return false;
    await idleSleep(Math.min(pollMs, left));
  }
}

/**
 * 播放一份状态持续特效——五个入口（创建、update 重新生效、resync 的两条路径、
 * createToken）共用的唯一落点。
 *
 * 三道闸，顺序有意义：
 *  1. `animationsEnabled()`——B 组修复。放在这里而不是各入口，是因为「什么时候该播」
 *     在本文件里只能有一处实现；从前 resync 那条路绕过了开关（见 resyncPersist 注释）。
 *  2. `inFlight`——让路期 + 「已送出、尚未登记进 Sequencer」那段的幂等（E1），
 *     见上面 inFlight 的注释。
 *  3. `isPlayingPersist`——已经在画布上的那一份的幂等。
 *
 * @param {ActiveEffect} effect
 * @param {Token} token  Token placeable（getActiveTokens()/canvas.tokens.placeables 给的都是这个形状）
 * @param {{assets: object, armory: object}} deps
 * @param {{gridSize: number}} env
 */
function playPersist(effect, token, deps, env) {
  if (!animationsEnabled()) return;
  const key = flightKey(effect.uuid, token);
  if (inFlight.has(key)) return;
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
  inFlight.add(key);
  // 这一份到底有没有真的交给 Sequencer。下面的销账要靠它分两条路：交出去了就得一直
  // 等到特效能被观察到（否则空窗重现），没交出去（让路期内被移除/停用）就该立刻销账，
  // 不然这份光环要白等一个 PERSIST_VISIBLE_TIMEOUT_MS 才补得回来。
  let dispatched = false;
  runPersistAnimation(`状态 ${plan.source}@${token.id}`, () => {
    // 让路期间状态可能已经没了（GM 撤销、瞬时过期）。这时候再播就是一枚**永远
    // 清不掉**的光：CanvasEffect 注册 tie 钩子时是 `const tiedDocument =
    // fromUuidSync(uuid); if (tiedDocument) { …addHook… }`（sequencer.js:16932-
    // 16943），解析不到就不注册；而 deleteActiveEffect 里按 origin 收尾的那条兜底
    // 早在我们播出之前就跑过了，扫不到还没存在的特效。判据用 fromUuidSync 而不是
    // `effect.parent.effects.has(...)`，是为了与 Sequencer 用的解析路径逐字一致。
    //
    // 复检的判据是「还在**且仍然生效**」，不只是「文档还在不在」（E3）。让路期内被
    // 停用（角色卡效果页 toggle，走 update 的 disabled 翻转）时文档仍在，
    // `deleteActiveEffect` 与 tiedDocuments 的 delete 钩子都不会触发，
    // `updateActiveEffect` 的 `endPersist` 又早在我们播出之前就跑过、扫不到还没存在的
    // 特效——照播就是留下一枚只能靠**删除**这条效果才清得掉的光环。
    // `ActiveEffect#active` 是 `!disabled && !isSuppressed` 的派生取值器，正是这里要的。
    const live = fromUuidSync(effect.uuid);
    if (!live) {
      debug(`状态 ${plan.source} 在让路期间已被移除，放弃播放（否则光效清不掉）`);
      return undefined;
    }
    if (!live.active) {
      debug(`状态 ${plan.source} 在让路期间被停用，放弃播放（否则光效只能靠删除效果才清得掉）`);
      return undefined;
    }
    dispatched = true;
    return playPlan(plan, {
      volume: getSetting(SETTINGS.VOLUME), shake: false, resolveRef: resolveRefIn(token.scene)
    });
  })
    // 送出了就再等它能被 `isPlayingPersist` 观察到——`runPersistAnimation` 兑现的那一刻
    // 只走完了让路期，`seq.play()` 内部的 preload 还没跑完，特效尚未进 VisibleEffects
    // （见 inFlight 的注释）。这一步是 E1 的第二半：少了它，空窗只是从「500ms 让路期」
    // 缩短成「preload 那几秒」，并没有关掉。
    .then(() => (dispatched ? awaitPersistVisible(effect.uuid, token) : undefined))
    // runPersistAnimation 自带 try/catch、从不 reject，awaitPersistVisible 里的
    // isPlayingPersist 也自带 catch，所以这条 catch 只是兜住将来可能长出来的新失败——
    // 它必须在 finally 之前，否则一个异常会变成挂在 finally 返回值上的未处理 rejection。
    .catch(err => warn(`状态 ${plan.source} 的在途登记收尾失败`, err))
    // 无论播出、放弃还是失败，在途登记最终都必须销掉，否则这一份光环在本次会话里
    // 再也补不回来。
    .finally(() => inFlight.delete(key));
}

/**
 * 击杀爆发：`dead` 状态**落地那一次**的一次性画面（Task 15b）。
 *
 * 【为什么由这里驱动】原来的 `aftermath.kill` 在实战中永不命中——判据是建卡时刻的
 * 快照里有没有 `dead`，而 `dead` 是 Crucible 在**资源结算之后**单独
 * `toggleStatusEffect("dead", {active: this.system.isDead})` 打上的
 * （crucible/module/documents/actor.mjs:2926），比 `configureVFXEffect()` 所在的
 * `_prepareMessage()`（models/action.mjs:3286）晚得多。完整依据写在 armory/death.mjs
 * 的文件头，那里也解释了为什么不能改成在建卡时预测「这一下会不会打死」。
 *
 * 【与 persist 通道的三点不同，逐条对应 Task 15b 的硬约束】
 *  1. **只有 createActiveEffect 这一个入口**。`resyncPersist` / `createToken` 是「把该
 *     有的稳态补齐」，接上一次性爆发 = 每次切场景、每具尸体都重放一遍。落点就是本函数
 *     没有被 `syncToken` / `syncEffect` 调用这件事本身，由 test/effects-death.test.mjs
 *     的两条用例守着。
 *  2. **不进 inFlight / 不查 isPlayingPersist**：这枚特效没有「结束」语义，也不该被
 *     去重——同一具尸体第二次真的死了（复活后再被打死）就该再炸一次。
 *  3. **不产持久 cue**：`dead` 仍留在 armory/persist.mjs 的 NO_PERSIST 里（Foundry 自带
 *     dead overlay），本槽的 cue 是普通一次性特效，没有 tieTo，也不需要 endEffect。
 *
 * 走 `runPersistAnimation` 而不是 `runAnimation`：触发时机与状态光环完全一样——
 * Crucible 先落地 ActiveEffect、后翻聊天卡的 confirmed（见 const.mjs 的 PERSIST_LEAD_MS），
 * 所以这一枚天然比造成它的那记攻击**更早**。直接播 = 先见血、后见挥剑。让路那两段
 * （等动作动画入队 → 等它播完）正是为这个顺序倒置准备的。不入共享队列的理由也一样：
 * 它不该占住队列，多个目标同时死就该同时炸。
 *
 * 动画开关：与 B 组一致，闸只在**播放函数**里设一处，不在钩子入口重复。
 */
function playDeath(effect, token, deps, env) {
  if (!animationsEnabled()) return;
  const plan = planForEffect(effect, token, env, deps, "death");
  if (!plan) return;
  debug(`击杀爆发 ${plan.source}@${token.id}`, plan);
  void runPersistAnimation(`击杀 ${plan.source}@${token.id}`, () => {
    // 让路期内被撤销（GM 点「撤销」→ confirm({reverse:true}) 把资源加回去 →
    // `toggleStatusEffect("dead", {active:false})` 删掉这条效果）时不要再补一摊血。
    // 与 playPersist 的存活复检同判据、同源码依据，只是后果轻得多：这里照播只是画面
    // 撒谎，不会留下清不掉的东西。
    const live = fromUuidSync(effect.uuid);
    if (!live?.active) {
      debug(`击杀 ${plan.source} 在让路期间被撤销，放弃播放`);
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
