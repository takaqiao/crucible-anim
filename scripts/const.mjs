/** 模组标识，与 module.json 的 id 必须一致。 */
export const MODULE_ID = "crucible-anim";

/** 写入 action.metadata 的唯一键，避免与系统自用的 metadata 字段撞名。 */
export const META_KEY = "cav";

/** FXPlan 结构版本；结构不兼容变更时递增，播放端据此拒绝旧计划。 */
export const PLAN_VERSION = 1;

/** 五个动画槽位，顺序即时间顺序（persist 独立于动作，排在最后）。 */
export const SLOTS = Object.freeze(["cast", "travel", "impact", "aftermath", "persist"]);

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
