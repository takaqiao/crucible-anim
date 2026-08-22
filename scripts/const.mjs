/** 模组标识，与 module.json 的 id 必须一致。 */
export const MODULE_ID = "crucible-anim";

/** 写入 action.metadata 的唯一键，避免与系统自用的 metadata 字段撞名。 */
export const META_KEY = "cav";

/** FXPlan 结构版本；结构不兼容变更时递增，播放端据此拒绝旧计划。 */
export const PLAN_VERSION = 1;

/**
 * 六个动画槽位。前四个的顺序即动作时间轴上的先后；末尾两个都不挂在动作上，由
 * ActiveEffect 驱动，因此排在最后：
 *   · `persist` —— 状态的持续光环，创建/删除成对（trigger/effects.mjs 的 playPersist）；
 *   · `death`   —— 击杀那一刻的一次性爆发，只由 `dead` 落地那一次 createActiveEffect
 *                  驱动，没有「结束」语义（armory/death.mjs 的文件头写了为什么它不能
 *                  留在 aftermath 槽里）。
 * 这份清单的消费者是预览宏（player/preview.mjs 逐槽遍历兵库）；`resolve()` 自己按动作
 * 装配的那四槽是写死的，不读它。
 */
export const SLOTS = Object.freeze(["cast", "travel", "impact", "aftermath", "persist", "death"]);

/** crucible.api.dice.AttackRoll.RESULT_TYPES 的镜像，供纯函数层使用而不依赖运行时。 */
export const RESULT = Object.freeze({
  MISS: 0, DODGE: 1, PARRY: 2, BLOCK: 3, ARMOR: 4, RESIST: 5, GLANCE: 6, HIT: 7
});

/** 结果码 → playIf 词汇。 */
export const RESULT_NAME = Object.freeze({
  0: "miss", 1: "dodge", 2: "parry", 3: "block", 4: "armor", 5: "resist", 6: "glance", 7: "hit"
});

/** 命中类结果：只有这两种会叠加元素层（见 DESIGN.md §6.5）。 */
export const HIT_RESULTS = Object.freeze([RESULT.GLANCE, RESULT.HIT]);

/** 设置项键名。 */
export const SETTINGS = Object.freeze({
  ENABLED: "enabled", DENSITY: "density", VOLUME: "volume", SHAKE: "shake", DEBUG: "debug"
});

/**
 * 状态特效的「让路」宽限期（毫秒）。
 *
 * Crucible 的 `CrucibleAction#confirm()` **先**落地 ActiveEffect
 * （models/action.mjs:2670 `await this.#applyEvents({reverse})` →
 * documents/actor.mjs 的 modifyBatch → createActiveEffect），**后**才把聊天卡翻成
 * confirmed（models/action.mjs:2680 `await this.message?.update({flags: {crucible:
 * {confirmed: !reverse}}})`）。两个钩子之间隔着 `#recordHeroism` 的 actor 写入与
 * `message.update()` 的一次数据库往返；其它客户端收到的是两条先后到达的 socket 广播，
 * 间隔同量级。所以状态动画的触发天然比造成它的动作动画早，直接播就是
 * 「挨打上毒 → 光环出现 → 才看见挥剑」。
 *
 * 这个常量是 persist 播放前等待「那条动作动画入队」的上限。取值只需要盖住上面那一次
 * 往返，而**取大几乎无代价**：光环是持续数轮的稳态标记，晚半秒出现没有人看得出来；
 * 取小的失败方式也只是退回今天的表现（光环略早于挥剑），不会更糟。500ms 对本地/局域网
 * 服务器有一个数量级的余量，远端 VPS 也够。
 *
 * 注意它**不是**超时兜底：真的等到了动作动画入队，就改由 semaphore.whenIdle() 接管，
 * 一直等到那条动画播完为止（那一段的上限是信号量自己的 timeoutMs）。
 */
export const PERSIST_LEAD_MS = 500;

/**
 * 「在途登记」等待特效真正登记进 Sequencer 的上限（毫秒）。
 *
 * `playPersist` 把一份持久光环交给 Sequencer 之后并不能立刻销掉在途登记：`playPlan()`
 * 对带 persist cue 的计划在 `seq.play()` 发出之后就返回、**不 await**（player/play.mjs
 * 末尾那条 Critical：持久特效的 promise 只在 endEffect() 时兑现，await 它会把共享信号量
 * 堵死）。而 Sequencer 的 `Sequence.play()`（sequencer.js 的 async play()）顺序是
 * `await Promise.allSettled(初始化)` → `if (preload) await Sequencer.Preloader.preload(...)`
 * → `SequenceManager.RunningSequences.add` → 逐条 `section._execute()` → `_playEffect`
 * 里的 `SequenceManager.VisibleEffects.add`（sequencer.js:11826）——`isPlayingPersist`
 * 查的正是 VisibleEffects，特效要到最后那一步才看得见。冷缓存下 preload 拉一段 jb2a
 * webm 是秒级，这一整段都是「inFlight 已销账、isPlayingPersist 仍为假」的空窗。
 *
 * 所以在途登记要一直挂到特效可被观察到为止；本常量是那之外的兜底上限，用来防止播放
 * 失败/被放弃时 key 永久泄漏（泄漏 = 这份光环在本次会话里再也补不回来）。
 *
 * **取大几乎无代价**：等得久只会推迟「上一次没播成的那份什么时候允许重试」，而播成了
 * 的那份由 `isPlayingPersist` 自己挡住重复，与本常量无关；取小的失败方式才是真的——
 * 空窗重新出现，两圈光环叠一起。15000 与 player/semaphore.mjs 的默认超时同源，都是按
 * 「冷缓存下 Preloader.preload 走网络」这个最慢环节定的。
 */
export const PERSIST_VISIBLE_TIMEOUT_MS = 15000;
