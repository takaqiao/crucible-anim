import {MODULE_ID, SETTINGS} from "./const.mjs";

const PREFIX = `${MODULE_ID} |`;

/** debug 设置尚未注册时读取会抛错，因此吞掉异常并视为关闭。 */
function debugEnabled() {
  try { return game.settings.get(MODULE_ID, SETTINGS.DEBUG) === true; }
  catch { return false; }
}

export function log(...args) { console.log(PREFIX, ...args); }
export function warn(...args) { console.warn(PREFIX, ...args); }
export function error(...args) { console.error(PREFIX, ...args); }
export function debug(...args) { if (debugEnabled()) console.debug(PREFIX, ...args); }
