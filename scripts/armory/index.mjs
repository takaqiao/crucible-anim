import cast from "./cast.mjs";
import travel from "./travel.mjs";
import impact from "./impact.mjs";
import aftermath from "./aftermath.mjs";
import death from "./death.mjs";
import persist from "./persist.mjs";
import persistOff from "./persist-off.mjs";

/**
 * 七槽规则表。槽内一律按 pri 降序取第一个命中者（resolver/resolve.mjs 的 firstMatch）。
 * 前四槽由 `resolve()` 按动作装配；后三槽由 ActiveEffect 驱动、各走自己的入口
 * （`resolveEffect(snapshot, deps, "persist" | "death" | "persistOff")`），不属于任何
 * 动作的时间轴。键名与 const.mjs 的 SLOTS 一一对应（test/manifest.test.mjs 钉着那张表）。
 */
export const ARMORY = Object.freeze(
  {cast, travel, impact, aftermath, persist, death, persistOff});
