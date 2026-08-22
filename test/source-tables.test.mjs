import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

import {GESTURE_TARGET, STATUSES, TARGET_REGION} from "../tools/dump-fixtures.mjs";

const FOUNDRY_DATA = "/root/fvtt14-data/Data";
const SPELLCRAFT = `${FOUNDRY_DATA}/systems/crucible/module/const/spellcraft.mjs`;
const STATUSES_SRC = `${FOUNDRY_DATA}/systems/crucible/module/const/statuses.mjs`;
const ACTION_SRC = `${FOUNDRY_DATA}/systems/crucible/module/const/action.mjs`;

/**
 * 括号配对提取：从 src[openIdx]（必须是 "{"）开始找到匹配的闭括号下标，跳过字符串内容。
 * 用于把手写的常量表锁定到源码，而不是靠肉眼抄一遍——Crucible 升级改了定义，测试会自己报警。
 */
function matchBrace(src, openIdx) {
  let depth = 0;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < src.length && src[i] !== quote) { if (src[i] === "\\") i++; i++; }
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return i; }
  }
  throw new Error(`括号不配对，起点 ${openIdx}`);
}

/** 解析一个对象字面量块（含外层花括号）的顶层 `key: { ... }` 条目，返回 {key: 内容子串}。 */
function parseTopLevelBlocks(block) {
  const result = {};
  let i = 1;
  const n = block.length - 1;
  while (i < n) {
    while (i < n && /[\s,]/.test(block[i])) i++;
    if (i >= n) break;
    const m = /^(\w+)\s*:\s*\{/.exec(block.slice(i, i + 200));
    if (!m) { i++; continue; }
    const key = m[1];
    const braceIdx = i + m[0].length - 1;
    const closeIdx = matchBrace(block, braceIdx);
    result[key] = block.slice(braceIdx, closeIdx + 1);
    i = closeIdx + 1;
  }
  return result;
}

function parseGestureTargets() {
  const src = readFileSync(SPELLCRAFT, "utf8");
  const declStart = src.indexOf("export const GESTURES");
  assert.ok(declStart > -1, "spellcraft.mjs 里找不到 export const GESTURES");
  const openBrace = src.indexOf("{", src.indexOf("Object.seal(", declStart));
  const closeBrace = matchBrace(src, openBrace);
  const gestures = parseTopLevelBlocks(src.slice(openBrace, closeBrace + 1));
  const out = {};
  for (const [gesture, block] of Object.entries(gestures)) {
    const tIdx = block.search(/target\s*:\s*\{/);
    if (tIdx === -1) { out[gesture] = null; continue; }
    const braceIdx = block.indexOf("{", tIdx);
    const targetBlock = block.slice(braceIdx, matchBrace(block, braceIdx) + 1);
    const typeMatch = /type\s*:\s*"(\w+)"/.exec(targetBlock);
    out[gesture] = typeMatch ? typeMatch[1] : null;
  }
  return out;
}

/**
 * 解析 action.mjs 的 `export const TARGET_TYPES = defineEnum({ <key>: {label, region, scope}, ... })`，
 * 对每个 `region.angle` 有值的目标类型（不含 `region: null` 或没有 angle 字段的形状）返回
 * `{目标类型: angle}`。用来核对 tools/dump-fixtures.mjs 的 TARGET_REGION 表——那张表是给合成
 * fixture 用的规范摆位，angle 字段必须与源码的张角逐项相等，否则依赖张角公式（coneYScale）的
 * 规则测出来的都是错误角度下的假阳性。解析方式与 parseGestureTargets 同构：括号配对切块 +
 * 正则取字段，不手抄数字。
 */
function parseTargetTypeAngles() {
  const src = readFileSync(ACTION_SRC, "utf8");
  const declStart = src.indexOf("export const TARGET_TYPES");
  assert.ok(declStart > -1, "action.mjs 里找不到 export const TARGET_TYPES");
  const openBrace = src.indexOf("{", src.indexOf("defineEnum(", declStart));
  const closeBrace = matchBrace(src, openBrace);
  const targetTypes = parseTopLevelBlocks(src.slice(openBrace, closeBrace + 1));
  const out = {};
  for (const [key, block] of Object.entries(targetTypes)) {
    const regionIdx = block.search(/region\s*:\s*\{/);
    if (regionIdx === -1) continue;  // region: null，没有张角这回事
    const braceIdx = block.indexOf("{", regionIdx);
    const regionBlock = block.slice(braceIdx, matchBrace(block, braceIdx) + 1);
    const angleMatch = /angle\s*:\s*(-?\d+(?:\.\d+)?)/.exec(regionBlock);
    if (angleMatch) out[key] = Number(angleMatch[1]);
  }
  return out;
}

function parseStatusEffectIds() {
  const src = readFileSync(STATUSES_SRC, "utf8");
  const declStart = src.indexOf("export const statusEffects");
  assert.ok(declStart > -1, "statuses.mjs 里找不到 export const statusEffects");
  const openBrace = src.indexOf("{", declStart);
  const closeBrace = matchBrace(src, openBrace);
  return Object.keys(parseTopLevelBlocks(src.slice(openBrace, closeBrace + 1)));
}

test("GESTURE_TARGET 与 spellcraft.mjs 源码的 GESTURES.*.target.type 逐项一致", () => {
  const real = parseGestureTargets();
  const realKeys = Object.keys(real);
  assert.equal(realKeys.length, 17, `源码解析出 ${realKeys.length} 个姿态，应为 17`);

  const tableKeys = Object.keys(GESTURE_TARGET);
  assert.deepEqual([...tableKeys].sort(), [...realKeys].sort(),
    "GESTURE_TARGET 的键集合与源码姿态集合不一致");

  const mismatches = tableKeys.filter(k => GESTURE_TARGET[k] !== real[k]);
  assert.deepEqual(mismatches, [],
    `GESTURE_TARGET 与源码不一致的姿态：${mismatches.map(k =>
      `${k}(表=${GESTURE_TARGET[k]} 源=${real[k]})`).join(", ")}`);
});

test("TARGET_REGION 的 region.angle 与 action.mjs 源码的 TARGET_TYPES.*.region.angle 逐项一致", () => {
  const real = parseTargetTypeAngles();
  const realKeys = Object.keys(real);
  // 12 个目标类型里，只有 cone/fan 的 region 形状带 angle 字段（pulse/aura/blast/ray/
  // summon/wall 的 region 各有其它字段但没有 angle，none/self/single/movement 干脆
  // region:null）。这条断言把"以后源码新增了第三个带 angle 的目标类型"也纳入警戒——
  // 届时这里会先红，逼着把新类型一并补进 TARGET_REGION。
  assert.deepEqual([...realKeys].sort(), ["cone", "fan"],
    `源码里带 region.angle 的目标类型应为 cone/fan，实得 ${JSON.stringify(real)}`);
  assert.equal(real.cone, 60, `源码 TARGET_TYPES.cone.region.angle 应为 60，实为 ${real.cone}`);
  assert.equal(real.fan, 210, `源码 TARGET_TYPES.fan.region.angle 应为 210，实为 ${real.fan}`);

  const mismatches = realKeys.filter(k => TARGET_REGION[k]?.angle !== real[k]);
  assert.deepEqual(mismatches, [],
    `TARGET_REGION 与源码张角不一致：${mismatches.map(k =>
      `${k}(表=${TARGET_REGION[k]?.angle} 源=${real[k]})`).join(", ")}`);
});

test("STATUSES 与 statuses.mjs 源码的 statusEffects 键集合一致（46 个，不含 flanked）", () => {
  const real = parseStatusEffectIds();
  assert.equal(real.length, 46, `源码 statusEffects 解析出 ${real.length} 个，应为 46`);
  assert.ok(!real.includes("flanked"), "flanked 属于 derivedConditions，不应出现在 statusEffects 里");

  assert.deepEqual([...STATUSES].sort(), [...real].sort(),
    "STATUSES 与源码 statusEffects 键集合不一致");
  assert.ok(!STATUSES.includes("flanked"), "STATUSES 不应包含 flanked（不可赋予的派生状态）");
});
