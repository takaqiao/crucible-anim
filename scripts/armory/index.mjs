import cast from "./cast.mjs";
import travel from "./travel.mjs";
import impact from "./impact.mjs";
import aftermath from "./aftermath.mjs";
import persist from "./persist.mjs";

/** 五槽规则表。resolve() 按槽取用，槽内按 pri 降序取第一个命中者。 */
export const ARMORY = Object.freeze({cast, travel, impact, aftermath, persist});
