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
