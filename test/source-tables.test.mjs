import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

import {GESTURE_TARGET, STATUSES, TARGET_REGION, RUNE_DAMAGE, RUNE_RESOURCE,
        TARGET_TYPE_REGION, GESTURE_TARGET_SIZE, GESTURE_RANGE, INFLECTIONS,
        TAG_PROPAGATE, SKILL_TAGS, MOVEMENT_TAGS} from "../tools/dump-fixtures.mjs";
import {ELEMENT_LAYER, DAMAGE_ALIAS} from "../scripts/armory/impact.mjs";
import {STATUS_GROUP, UNREACHABLE_STATUSES} from "../scripts/armory/persist.mjs";
import {GENERATED_EFFECT_STATUS} from "../scripts/trigger/snapshot.mjs";
import {FOUNDRY_DATA, FOUNDRY_CORE} from "../tools/paths.mjs";

const SPELLCRAFT = `${FOUNDRY_DATA}/systems/crucible/module/const/spellcraft.mjs`;
const STATUSES_SRC = `${FOUNDRY_DATA}/systems/crucible/module/const/statuses.mjs`;
const ACTION_SRC = `${FOUNDRY_DATA}/systems/crucible/module/const/action.mjs`;
const ATTRIBUTES_SRC = `${FOUNDRY_DATA}/systems/crucible/module/const/attributes.mjs`;
const EFFECTS_SRC = `${FOUNDRY_DATA}/systems/crucible/module/const/effects.mjs`;

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

  // TARGET_REGION 现在按**手势**建表（aura/sense 与 ray/surge 各自的尺寸差得远，
  // 老的按 target.type 建表把它们合并了）。cone / fan 两个手势的目标类型恰好同名，
  // 张角这一项因此仍能逐项对上。
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

/**
 * 解析 spellcraft.mjs 的 `export const RUNES = { <rune>: {..., damageType, resource,
 * restoration}, ... }`，返回 `{符文: {damageType, resource, restoration}}`。与
 * parseGestureTargets 同构：括号配对切块 + 正则取字段，不手抄。tools/dump-fixtures.mjs
 * 的符文表靠它锁定——那些表决定了法术语料写进 target.damage.type 的是什么，一旦 Crucible
 * 改了某个符文的伤害类型，元素层覆盖断言会连带失真，必须先在这里报警。
 */
function parseRunes() {
  const src = readFileSync(SPELLCRAFT, "utf8");
  const declStart = src.indexOf("export const RUNES");
  assert.ok(declStart > -1, "spellcraft.mjs 里找不到 export const RUNES");
  const openBrace = src.indexOf("{", declStart);
  const closeBrace = matchBrace(src, openBrace);
  const runes = parseTopLevelBlocks(src.slice(openBrace, closeBrace + 1));
  const out = {};
  for (const [rune, block] of Object.entries(runes)) {
    out[rune] = {
      damageType: /damageType\s*:\s*"(\w+)"/.exec(block)?.[1] ?? null,
      resource: /resource\s*:\s*"(\w+)"/.exec(block)?.[1] ?? null,
      restoration: /restoration\s*:\s*true/.test(block)
    };
  }
  return out;
}

/** 解析 attributes.mjs 的 DAMAGE_TYPES / DAMAGE_CATEGORIES 键集合。 */
function parseDamageEnum(name) {
  const src = readFileSync(ATTRIBUTES_SRC, "utf8");
  const declStart = src.indexOf(`export const ${name}`);
  assert.ok(declStart > -1, `attributes.mjs 里找不到 export const ${name}`);
  const openBrace = src.indexOf("{", src.indexOf("defineEnum(", declStart));
  const closeBrace = matchBrace(src, openBrace);
  return Object.keys(parseTopLevelBlocks(src.slice(openBrace, closeBrace + 1)));
}

test("RUNE_DAMAGE / RUNE_RESOURCE 与 spellcraft.mjs 的 RUNES 逐项一致", () => {
  const real = parseRunes();
  const realKeys = Object.keys(real);
  assert.equal(realKeys.length, 12, `源码解析出 ${realKeys.length} 个符文，应为 12`);
  assert.deepEqual(Object.keys(RUNE_DAMAGE).sort(), [...realKeys].sort(), "RUNE_DAMAGE 键集合与源码不一致");
  assert.deepEqual(Object.keys(RUNE_RESOURCE).sort(), [...realKeys].sort(), "RUNE_RESOURCE 键集合与源码不一致");

  const badDmg = realKeys.filter(k => RUNE_DAMAGE[k] !== real[k].damageType);
  assert.deepEqual(badDmg, [], `伤害类型不一致：${badDmg.map(k =>
    `${k}(表=${RUNE_DAMAGE[k]} 源=${real[k].damageType})`).join(", ")}`);
  const badRes = realKeys.filter(k => RUNE_RESOURCE[k] !== real[k].resource);
  assert.deepEqual(badRes, [], `资源池不一致：${badRes.map(k =>
    `${k}(表=${RUNE_RESOURCE[k]} 源=${real[k].resource})`).join(", ")}`);

  // restoration 符文的结算方向（正 delta → healed）目前是 tools/dump-fixtures.mjs 明写的
  // 已知简化，见那里 RUNE_DAMAGE 下方的说明。源码新增/去掉 restoration 符文时这里先红，
  // 逼着复核那段简化还成不成立（以及元素层覆盖会不会因此掉一支）。
  assert.deepEqual(realKeys.filter(k => real[k].restoration).sort(), ["life", "soul"],
    "源码 restoration:true 的符文集合变了，dump-fixtures.mjs 的已知简化需要复核");

  // kinesis 的 damageType 是伤害「类别」而不是类型——这正是 impact.mjs 的 DAMAGE_ALIAS
  // 存在的理由。源码哪天把它改成真正的伤害类型，这里要先红。
  assert.equal(real.kinesis.damageType, "physical",
    "kinesis 的 damageType 不再是 physical，impact.mjs 的 DAMAGE_ALIAS 需要复核");
});

test("ELEMENT_LAYER 的键集合等于 attributes.mjs 的 DAMAGE_TYPES，DAMAGE_ALIAS 只收类别名", () => {
  // 12/12 的覆盖断言只有在「12 到底是哪 12 个」也被源码钉住时才有意义：如果 Crucible 加了
  // 第 13 种伤害类型，光看覆盖断言是全绿的（12 个都跑到了），只有这条会红。
  const types = parseDamageEnum("DAMAGE_TYPES");
  const categories = parseDamageEnum("DAMAGE_CATEGORIES");
  assert.equal(types.length, 12, `源码 DAMAGE_TYPES 解析出 ${types.length} 个，应为 12`);
  assert.deepEqual(Object.keys(ELEMENT_LAYER).sort(), [...types].sort(),
    "ELEMENT_LAYER 的键集合必须与 crucible 的 DAMAGE_TYPES 完全相同——多一个键是死代码，" +
    "少一个键就是一整类伤害悄悄退回血溅");

  // 别名的定义域必须是「伤害类别」，值域必须落在 DAMAGE_TYPES 里。
  for (const [from, to] of Object.entries(DAMAGE_ALIAS)) {
    assert.ok(categories.includes(from),
      `DAMAGE_ALIAS 的键 "${from}" 不是 DAMAGE_CATEGORIES 里的类别（源码类别：${categories.join("/")}）`);
    assert.ok(types.includes(to), `DAMAGE_ALIAS["${from}"] = "${to}" 不是合法伤害类型`);
    assert.ok(!types.includes(from), `"${from}" 已经是合法伤害类型，不该再走别名`);
  }
  // kinesis 用的那一个必须在表里，否则 spell.kinesis.* 全系静默退回血溅。
  assert.ok(DAMAGE_ALIAS.physical, "DAMAGE_ALIAS 必须覆盖 physical（kinesis 符文的 damageType）");
});

/* -------------------------------------------- */
/*  归并表 vs generator 产出                     */
/* -------------------------------------------- */

/**
 * 复刻 crucible 的 `generateId(title, length)`（crucible-compiled.mjs 里的实现，
 * `const/effects.mjs#getEffectId` 就是它加一个可选后缀）：按空格分词、每段去掉非字母
 * 数字、首段首字母小写、其余段首字母大写，拼接后截到 length 位再用 "0" 补齐。
 *
 * 下面 parseEffectGenerators() 会断言每个标签都是单个纯字母数字词，所以这里的简化实现
 * （不引 Foundry 的 String#slugify / #titleCase——测试跑在裸 node 里没有那两个原型扩展）
 * 与源码在**当前所有标签上**逐字符等价；哪天 Crucible 把某个标签换成 "Acid Burn" 这种
 * 多词或带标点的写法，那条断言会先红，而不是静默算错 _id。
 */
function crucibleGenerateId(title, length) {
  const id = title.split(" ").map((w, i) => {
    const p = w.replace(/[^A-Za-z0-9]/g, "");
    return i ? (p.charAt(0).toUpperCase() + p.slice(1)) : (p.charAt(0).toLowerCase() + p.slice(1));
  }).join("");
  return id.slice(0, length).padEnd(length, "0");
}

/**
 * 解析 `const/effects.mjs` 的每一个 `export function`，取它返回的 ActiveEffectData 里的
 * `statuses: [...]` 与 `_id: getEffectId("<标签>")`。
 * 返回 `{函数名: {statuses: string[]|null, effectId: string}}`；`statuses: null` 表示这个
 * generator **压根没有 statuses 字段**（与 `statuses: []` 不是一回事）。
 */
function parseEffectGenerators() {
  const src = readFileSync(EFFECTS_SRC, "utf8");
  const fns = [];
  const fnRe = /export function (\w+)\s*\(/g;
  let m;
  while ((m = fnRe.exec(src))) fns.push({name: m[1], at: m.index});
  assert.ok(fns.length > 5, `effects.mjs 只解析出 ${fns.length} 个 export function，解析器可能失效了`);

  const out = {};
  for (let i = 0; i < fns.length; i++) {
    const body = src.slice(fns[i].at, i + 1 < fns.length ? fns[i + 1].at : src.length);
    const idMatch = /_id\s*:\s*getEffectId\(\s*"([^"]+)"/.exec(body);
    if (!idMatch) continue;                       // getEffectId 自身等辅助函数，不是 generator
    assert.match(idMatch[1], /^[A-Za-z0-9]+$/,
      `effects.mjs 的 getEffectId("${idMatch[1]}") 不再是单个纯字母数字词，`
      + "crucibleGenerateId 的简化实现需要复核");
    const stMatch = /\bstatuses\s*:\s*\[([^\]]*)\]/.exec(body);
    out[fns[i].name] = {
      effectId: crucibleGenerateId(idMatch[1], 16),
      statuses: stMatch
        ? stMatch[1].split(",").map(x => x.trim().replace(/^["'`]|["'`]$/g, "")).filter(Boolean)
        : null
    };
  }
  return out;
}

/** 解析 statuses.mjs 里 `<statusId>: { ..., generator: EFFECTS.<fn>, ... }`，返回 {statusId: fn名}。 */
function parseStatusGenerators() {
  const src = readFileSync(STATUSES_SRC, "utf8");
  const openBrace = src.indexOf("{", src.indexOf("export const statusEffects"));
  const blocks = parseTopLevelBlocks(src.slice(openBrace, matchBrace(src, openBrace) + 1));
  const out = {};
  for (const [id, block] of Object.entries(blocks)) {
    const g = /generator\s*:\s*EFFECTS\.(\w+)/.exec(block);
    if (g) out[id] = g[1];
  }
  return out;
}

/**
 * STATUS_GROUP 是按 `CONFIG.statusEffects` 的键抄的，但真正决定 `snapshotEffect` 取到什么
 * statusId 的是 generator 产出的 `statuses` 数组——两者会脱节，`entropy` 就是被这么漏掉的
 * （generator 产出 `statuses:["frightened"]`，`entropy: "decay"` 于是永远命不中，是一条
 * 纯死代码；而 fear 与 decay 的素材当时 ΔE00 只有 3.1，肉眼看不出差别，所以一直没被发现）。
 * 这条测试把「键抄自哪张表」换成「运行时到底会出现哪个 id」，逐 generator 核对。
 *
 * 三类情形，各有各的断言：
 *  1. generator 有 statuses 且首元素 === 自身 id ——正常，只要该 id 在 STATUS_GROUP 里；
 *  2. generator 有 statuses 但首元素 ≠ 自身 id ——自身 id 不可达，必须登记进
 *     UNREACHABLE_STATUSES，且它在表里的分组必须与真身相同（否则表还是在说谎）；
 *  3. generator 没有 statuses 字段 ——双入口：HUD/toggle 走 core 会补上自身 id；战斗直调
 *     则 statuses 全空、statusId 退化成 generator 写死的 `_id`，必须由 trigger/snapshot.mjs
 *     的 GENERATED_EFFECT_STATUS 翻译回来。
 */
test("STATUS_GROUP / GENERATED_EFFECT_STATUS 与 const/effects.mjs 的 generator 产出一致", () => {
  const gens = parseEffectGenerators();
  const byStatus = parseStatusGenerators();
  assert.ok(Object.keys(byStatus).length >= 16,
    `statuses.mjs 只解析出 ${Object.keys(byStatus).length} 个带 generator 的状态，应至少 16 个`);

  const unreachable = [];        // 情形 2
  const aliases = {};            // 情形 3：_id → 规范状态 id
  const problems = [];

  for (const [statusId, fnName] of Object.entries(byStatus)) {
    const gen = gens[fnName];
    assert.ok(gen, `statuses.mjs 的 ${statusId} 引用了 EFFECTS.${fnName}，但 effects.mjs 里找不到它`);

    if (gen.statuses === null) {
      aliases[gen.effectId] = statusId;
      if (!STATUS_GROUP[statusId]) problems.push(`${statusId}: 不在 STATUS_GROUP 里`);
      continue;
    }
    const landed = gen.statuses[0];
    if (!landed) { problems.push(`${statusId}: generator 的 statuses 是空数组`); continue; }
    // generator 顺带附加的状态（freezing→slowed / confused→disoriented / suffocating→silenced）
    // 也可能单独出现在别的效果上，同样必须归了组。
    for (const st of gen.statuses) {
      if (!STATUS_GROUP[st]) problems.push(`${statusId} 的 generator 产出的 "${st}" 不在 STATUS_GROUP 里`);
    }
    if (landed !== statusId) {
      unreachable.push(statusId);
      if (STATUS_GROUP[statusId] !== STATUS_GROUP[landed]) {
        problems.push(`${statusId}: generator 实际赋予 "${landed}"（→ ${STATUS_GROUP[landed]} 组），`
          + `但 STATUS_GROUP["${statusId}"] = "${STATUS_GROUP[statusId]}"——这是一条永远命不中的死映射`);
      }
    }
  }

  assert.deepEqual(problems, [], problems.join("\n"));

  // 不可达清单必须与源码算出来的完全一致：少一条是漏核（下一个 entropy），多一条是过期条目。
  assert.deepEqual([...UNREACHABLE_STATUSES].sort(), unreachable.sort(),
    "UNREACHABLE_STATUSES 与源码算出的不可达状态集合不一致");

  // _id 别名表同理：generator 补上 statuses 后这里会多出条目，删掉别名表条目则会少。
  assert.deepEqual(GENERATED_EFFECT_STATUS, aliases,
    "GENERATED_EFFECT_STATUS 与「没有 statuses 字段的 generator 的 _id」对不上——"
    + "这些效果在战斗直调路径上落地时不带任何状态，statusId 会退化成这些 _id");
});

/* -------------------------------------------- */
/*  Foundry 核心：ContextMenuEntry 键名           */
/* -------------------------------------------- */

const CORE_ROOT = FOUNDRY_CORE;
const CONTEXT_MENU_SRC = `${CORE_ROOT}/applications/ux/context-menu.mjs`;

/**
 * 重放菜单是本模组唯一一处往 Foundry 核心 UI 里插条目的地方，而 v14 把 ContextMenuEntry
 * 的三个键全改了名（`name`→`label`、`condition`→`visible`、`callback`→`onClick`），旧名
 * 只留到 v16。旧名现在还能跑，所以这类错误**不会有任何运行期症状**，只会在控制台吐弃用
 * 警告——正是最容易一路混到 v16 才炸的那种。这里直接从核心源码里把弃用表解析出来对账。
 */
test("installReplayMenu 不得使用 v14 已弃用的 ContextMenuEntry 键名", () => {
  const src = readFileSync(CONTEXT_MENU_SRC, "utf8");

  // 形如：logCompatibilityWarning("ContextMenuEntry#condition is deprecated. "
  //         + "Use ContextMenuEntry#visible instead.", {since: 14, until: 16, once: true});
  const renames = new Map();
  const re = /ContextMenuEntry#(\w+) is deprecated\.\s*"?\s*\+?\s*"?\s*Use ContextMenuEntry#(\w+) instead/g;
  for (const m of src.matchAll(re)) renames.set(m[1], m[2]);

  assert.ok(renames.size >= 3,
    `核心源码里应能解析出至少 3 组 ContextMenuEntry 弃用改名，实得 ${renames.size} 组：` +
    `${JSON.stringify([...renames])}。解析不到多半是核心把警告文案改了——` +
    `此时本守卫已失效，必须先修解析再谈通过。`);

  const preview = readFileSync(new URL("../scripts/player/preview.mjs", import.meta.url), "utf8");
  const start = preview.indexOf("export function installReplayMenu(");
  assert.ok(start > -1, "找不到 installReplayMenu");
  const end = preview.indexOf("\n}", start);
  const body = preview.slice(start, end);

  for (const [oldKey, newKey] of renames) {
    assert.ok(!new RegExp(`^\\s*${oldKey}:`, "m").test(body),
      `重放菜单用了已弃用的 ContextMenuEntry#${oldKey}，v14 起应改用 #${newKey}（v16 移除）`);
  }
  // 反向钉死：不能靠"把键删光"通过上面的检查。
  for (const newKey of renames.values()) {
    assert.ok(new RegExp(`^\\s*${newKey}:`, "m").test(body),
      `重放菜单缺少 ContextMenuEntry#${newKey}——菜单项不完整`);
  }
});


/* -------------------------------------------- */
/*  Foundry 核心 / Sequencer：钩子时序的三条依据   */
/* -------------------------------------------- */

const CHAT_SRC = `${CORE_ROOT}/applications/sidebar/tabs/chat.mjs`;
const APPLICATION_SRC = `${CORE_ROOT}/applications/api/application.mjs`;
const GAME_SRC = `${CORE_ROOT}/game.mjs`;
const SEQUENCER_SRC = `${FOUNDRY_DATA}/modules/sequencer/dist/sequencer.js`;

/** 去掉行首缩进，方便用连续子串比对多行片段。 */
const squash = s => s.replace(/\s+/g, " ");

/**
 * 【A1 的依据】`getChatMessageContextOptions` 只在 ChatLog **首渲染**时派发一次，
 * 条目当场冻进 ContextMenu，此后只重新求值 `visible`，从不重新征集条目。
 * 因此这条钩子必须在 `init` 注册——只要这三条源码事实还成立。
 *
 * 任何一条对不上（核心改成每次右键都征集、或把 _createContextMenu 挪出 _onFirstRender）
 * 都意味着 A1 的前提变了，那时可以重新讨论注册时机，但不能让它悄悄失效。
 */
test("A1 依据：getChatMessageContextOptions 只在 ChatLog 首渲染派发一次，条目当场冻结", () => {
  const chat = squash(readFileSync(CHAT_SRC, "utf8"));
  const firstRender = chat.indexOf("async _onFirstRender(");
  assert.ok(firstRender > -1, "ChatLog#_onFirstRender 不见了");
  const createMenu = chat.indexOf('hookName: "getChatMessageContextOptions"');
  assert.ok(createMenu > firstRender,
    "getChatMessageContextOptions 不再由 _onFirstRender 里的 _createContextMenu 派发——A1 的前提变了");
  assert.ok(chat.slice(firstRender, createMenu).includes("_createContextMenu("),
    "首渲染里那次 _createContextMenu 找不到了");

  const app = squash(readFileSync(APPLICATION_SRC, "utf8"));
  assert.ok(app.includes("const menuItems = this._doEvent(handler, {hookName, parentClassHooks, hookResponse: true});"),
    "_createContextMenu 征集条目的那一行变了");
  assert.ok(app.includes("return new ContextMenu.implementation(container, selector, menuItems,"),
    "_createContextMenu 不再把征集到的条目直接交给 ContextMenu 构造函数");

  const menu = squash(readFileSync(CONTEXT_MENU_SRC, "utf8"));
  assert.ok(menu.includes("this.menuItems = menuItems;"),
    "ContextMenu 不再把条目数组直接存下来——重新征集的可能性需要重新评估");
});

/**
 * 【A1/A2 的另一半】`Hooks.callAll("ready")` 排在 `initializeUI()`（未 await，聊天栏
 * 首渲染就在里面）之后，中间还隔着 `await documentIndex.index()` 与
 * `await canvas.initializing`。这是「在 ready 里注册就来不及」的时间差本身。
 */
test("A 依据：game.setupGame 里 ready 排在 initializeUI 与两次 await 之后", () => {
  const game = readFileSync(GAME_SRC, "utf8");
  const ui = game.indexOf("this.initializeUI();");
  const index = game.indexOf("await this.documentIndex.index();");
  const canvasWait = game.indexOf("await this.canvas.initializing;");
  const ready = game.indexOf('Hooks.callAll("ready");');
  assert.ok(ui > -1 && index > -1 && canvasWait > -1 && ready > -1, "setupGame 的关键行找不到了");
  assert.ok(ui < index && index < canvasWait && canvasWait < ready,
    "setupGame 的顺序变了：initializeUI → documentIndex.index → canvas.initializing → ready");
});

/**
 * 【A2 的依据】`sequencerEffectManagerReady` 在 `initializePersistentEffects()` 末尾
 * 一次性派发，而后者由 canvasReady 之后的 setupModule 调起——每次画布加载只发一次。
 * 也顺带钉住「不能改挂 canvasReady」的理由：那条路径第一件事是 tearDown 掉全部特效。
 */
test("A2 依据：sequencerEffectManagerReady 每次画布加载只在 initializePersistentEffects 末尾发一次", () => {
  const seq = readFileSync(SEQUENCER_SRC, "utf8");
  const calls = [...seq.matchAll(/Hooks\.callAll\("sequencerEffectManagerReady"\)/g)];
  assert.equal(calls.length, 1, "这个钩子的派发点不止一处了，A2 的补跑逻辑需要重新评估");

  const init = seq.indexOf("static async initializePersistentEffects()");
  assert.ok(init > -1 && init < calls[0].index, "派发点不在 initializePersistentEffects 里了");
  const body = squash(seq.slice(init, calls[0].index));
  assert.ok(body.includes("await this.tearDownPersistentEffects();"),
    "initializePersistentEffects 不再以 tearDownPersistentEffects 开头——"
    + "「不能挂 canvasReady」这条理由需要重新核");
  assert.ok(seq.includes("SequencerEffectManager.initializePersistentEffects();"),
    "setupModule 不再调 initializePersistentEffects");
});

/**
 * 【C 的依据】三件事，缺一条 `/canim-preview` 的注册方式就要重新想：
 *   1. 钩子/解析拿到的是 HTML，核心自己在 parse() 里剥最外层 `<p>`；
 *   2. 非 isRoll 的命令匹配的是剥过的 `html`（isRoll 才用 textContent）；
 *   3. `fn` 返回 false 阻止消息发出。
 * 第 1 条同时是 test/preview.test.mjs 里 CORE_HTML_STRIP 那个 helper 的出处——
 * 复刻一行核心逻辑而不钉住它，等于自测自嗨。
 */
test("C 依据：ChatLog.parse 对非 isRoll 命令匹配剥过 <p> 的 html，且 fn 返回 false 阻止发送", () => {
  const chat = readFileSync(CHAT_SRC, "utf8");
  assert.ok(chat.includes('const html = message.replace(/^<p>|<\\/p>$/gi, "");'),
    "核心剥最外层 <p> 的那一行变了——preview.test.mjs 的 CORE_HTML_STRIP 必须同步");

  const squashed = squash(chat);
  assert.ok(squashed.includes("const match = (isRoll ? text : html).match(rgx);"),
    "parse() 的单行命令匹配对象变了（非 isRoll 应当匹配 html）");
  assert.ok(squashed.includes("const result = await fn?.call(this, command, match, chatData, createOptions); if ( result === false ) return;"),
    "processMessage 不再靠 fn 返回 false 来阻止消息发出");
  assert.ok(squashed.includes("static CHAT_COMMANDS ="),
    "ChatLog.CHAT_COMMANDS 注册表不见了");
});

/**
 * 【E2 的依据】token HUD 上点状态图标走的是 create/delete，不是 update——
 * effects.mjs 那条被订正的注释就靠这两条钉住。
 */
test("E2 依据：token HUD 的状态 toggle 走 Actor#toggleStatusEffect 的 create/delete", () => {
  const hud = squash(readFileSync(`${CORE_ROOT}/applications/hud/token-hud.mjs`, "utf8"));
  assert.ok(hud.includes("await this.actor.toggleStatusEffect(statusId, {"),
    "TokenHUD 的状态 toggle 不再调 Actor#toggleStatusEffect");

  const actor = squash(readFileSync(`${CORE_ROOT}/documents/actor.mjs`, "utf8"));
  const fn = actor.indexOf("async toggleStatusEffect(statusId,");
  assert.ok(fn > -1, "Actor#toggleStatusEffect 不见了");
  const body = actor.slice(fn, fn + 2000);
  assert.ok(body.includes('await this.deleteEmbeddedDocuments("ActiveEffect", existing);'),
    "toggleStatusEffect 的移除分支不再是 deleteEmbeddedDocuments");
  assert.ok(body.includes("return ActiveEffect.create(effect.toObject(), {parent: this, keepId: true});"),
    "toggleStatusEffect 的新增分支不再是 ActiveEffect.create");
  assert.ok(!/disabled\s*:/.test(body),
    "toggleStatusEffect 里出现了 disabled——HUD 现在可能真的走 update 了，注释要再订正一次");

  // 而 disabled 翻转的真实来源是 Crucible 的角色卡效果页。
  const sheet = squash(readFileSync(
    `${FOUNDRY_DATA}/systems/crucible/module/applications/sheets/base-actor-sheet.mjs`, "utf8"));
  assert.ok(sheet.includes("await effect.update({disabled: !effect.disabled});"),
    "Crucible 角色卡的效果 toggle 变了——updateActiveEffect 分支的来源需要重新核");
});


/* ============================================================================
 *  批次 A · 语料表锁定
 *
 *  这一段全部服务同一个目的：`tools/dump-fixtures.mjs` 里那几张「照着 Crucible 源码
 *  抄下来」的表，必须由解析器逐条对账，而不是靠肉眼与记忆。上游改一个字段，这里先红，
 *  而不是等某条兜底率悄悄变差、或某条 ∀ 断言退化成空真。
 * ========================================================================== */

/** 从某个源码文件里取出 `export const NAME = ...({ ... })` 的顶层 `key: {...}` 块。 */
function parseExportedObject(file, name) {
  const src = readFileSync(file, "utf8");
  const declStart = src.indexOf(`export const ${name}`);
  assert.ok(declStart > -1, `${file} 里找不到 export const ${name}`);
  const openBrace = src.indexOf("{", src.indexOf("=", declStart));
  return parseTopLevelBlocks(src.slice(openBrace, matchBrace(src, openBrace) + 1));
}

/** `["a", "b"]` 的内容串 → 字符串数组。 */
const strList = s => s.split(",").map(x => x.trim().replace(/^["'`]|["'`]$/g, "")).filter(Boolean);

/* -------------------------------------------- */
/*  一、标签传播                                  */
/* -------------------------------------------- */

/**
 * 解析 `const/action.mjs` 里**所有**带 `propagate` 的 TAG，两个来源分开返回：
 *
 *   · `statics` —— `export const TAGS = {...}` 字面量里直接写的（12 条）；
 *   · `dynamic` —— 文件末尾那几个 `for (const ... of Object.keys|values(<枚举>)) {
 *                   TAGS[id] = {... propagate: [...] ...} }` 循环（技能 / 移动两条）。
 *
 * **动态那一半是这条守卫存在的全部理由**：只解析字面量的话，19 个技能/移动标签一个都
 * 看不见，而它们正是 `usage.isAttack` 与 `usage.skillId` 的来源——离线语料漏了它们，
 * 同一个动作离线走兜底、上机走攻击通路（施工清单 §4.3 称之为「本仓库最贵的失败模式」）。
 */
function parseTagPropagate() {
  const src = readFileSync(ACTION_SRC, "utf8");
  const statics = {};
  for (const [tag, block] of Object.entries(parseExportedObject(ACTION_SRC, "TAGS"))) {
    const m = /propagate\s*:\s*\[([^\]]*)\]/.exec(block);
    if (m) statics[tag] = strList(m[1]);
  }

  const dynamic = {};
  const loopRe = /for\s*\(\s*const\s+(?:\{[^}]*\}|\w+)\s+of\s+Object\.(?:keys|values)\(\s*(\w+)\s*\)\s*\)\s*\{/g;
  for (let m; (m = loopRe.exec(src));) {
    const bodyStart = m.index + m[0].length - 1;      // m[0] 以 "{" 收尾
    const body = src.slice(bodyStart, matchBrace(src, bodyStart) + 1);
    if (!/TAGS\s*\[/.test(body)) continue;            // 不是往 TAGS 里塞东西的循环
    const p = /propagate\s*:\s*\[([^\]]*)\]/.exec(body);
    if (p) dynamic[m[1]] = strList(p[1]);
  }
  return {statics, dynamic};
}

/** action.mjs 顶部的 `import {X} from "./y.mjs"` → 取出枚举 X 的顶层键。 */
function importedEnumKeys(name) {
  const src = readFileSync(ACTION_SRC, "utf8");
  const re = /import\s*\{([^}]*)\}\s*from\s*"\.\/([\w.-]+)"/g;
  for (let m; (m = re.exec(src));) {
    if (!strList(m[1]).includes(name)) continue;
    return Object.keys(parseExportedObject(
      `${FOUNDRY_DATA}/systems/crucible/module/const/${m[2]}`, name));
  }
  throw new Error(`action.mjs 没有从任何同级模块 import ${name}`);
}

test("TAG_PROPAGATE 与 const/action.mjs 所有带 propagate 的 TAG 逐条一致", () => {
  const {statics, dynamic} = parseTagPropagate();

  // 样本量下限，贴着实测：静态 12 条（行号 299/317/346/366/409/805/828/852/866/885/904/931）
  assert.equal(Object.keys(statics).length, 12,
    `源码 TAGS 字面量里带 propagate 的应为 12 条，实得 ${Object.keys(statics).length} 条：`
    + `${Object.keys(statics).join("/")}。解析器失效时这里会归零，比对反而全绿——先修解析。`);

  // 两条动态循环一条都不许丢：少一条就是 19 个标签整批消失
  assert.deepEqual(Object.keys(dynamic).sort(), ["MOVEMENT_ACTIONS", "SKILLS"],
    `源码里往 TAGS 塞 propagate 的循环应恰好两条（技能 / 移动），实得 ${JSON.stringify(dynamic)}`);
  assert.deepEqual(dynamic.SKILLS, ["skill"]);
  assert.deepEqual(dynamic.MOVEMENT_ACTIONS, ["movement"]);

  const skillKeys = importedEnumKeys("SKILLS");
  const moveKeys = importedEnumKeys("MOVEMENT_ACTIONS");
  assert.equal(skillKeys.length, 12,
    `const/skills.mjs 的 SKILLS 应有 12 个技能，实得 ${skillKeys.length}`);
  assert.equal(moveKeys.length, 9,
    `const/actor.mjs 的 MOVEMENT_ACTIONS 应有 7 个，实得 ${moveKeys.length}`);
  assert.deepEqual([...SKILL_TAGS].sort(), [...skillKeys].sort(),
    "SKILL_TAGS 与源码 SKILLS 键集合不一致");
  assert.deepEqual([...MOVEMENT_TAGS].sort(), [...moveKeys].sort(),
    "MOVEMENT_TAGS 与源码 MOVEMENT_ACTIONS 键集合不一致");

  const expanded = {...statics};
  for (const k of skillKeys) expanded[k] = dynamic.SKILLS;
  for (const k of moveKeys) expanded[k] = dynamic.MOVEMENT_ACTIONS;
  assert.equal(Object.keys(expanded).length, 33,
    `源码一共 33 条传播（12 静态 + 12 技能 + 9 移动），实得 ${Object.keys(expanded).length}`);

  // 逐条：多一条是死代码，少一条就是一整族动作在离线侧走错通路
  const tableKeys = Object.keys(TAG_PROPAGATE);
  assert.deepEqual([...tableKeys].sort(), Object.keys(expanded).sort(),
    "TAG_PROPAGATE 的键集合与源码不一致——"
    + `表里多出：${tableKeys.filter(k => !(k in expanded)).join("/") || "(无)"}；`
    + `源码里有而表里缺：${Object.keys(expanded).filter(k => !(k in TAG_PROPAGATE)).join("/") || "(无)"}`);
  const badTargets = tableKeys.filter(k =>
    JSON.stringify(TAG_PROPAGATE[k]) !== JSON.stringify(expanded[k]));
  assert.deepEqual(badTargets, [],
    `传播目标不一致：${badTargets.map(k =>
      `${k}(表=${JSON.stringify(TAG_PROPAGATE[k])} 源=${JSON.stringify(expanded[k])})`).join(", ")}`);
});

/* -------------------------------------------- */
/*  二、模板区域：五个字段 + 按手势复算            */
/* -------------------------------------------- */

/**
 * 解析 `TARGET_TYPES.<key>.region` 的五个决定性字段（外加 size / directionDelta /
 * ephemeral 三个附带字段），`region: null` 的目标类型返回 null。
 * 五个字段各自决定模板的哪一部分，见 tools/dump-fixtures.mjs 的 TARGET_TYPE_REGION 注释。
 */
function parseTargetTypeRegions() {
  const out = {};
  for (const [key, block] of Object.entries(parseExportedObject(ACTION_SRC, "TARGET_TYPES"))) {
    const idx = block.search(/\bregion\s*:\s*\{/);
    if (idx === -1) { out[key] = null; continue; }          // region: null
    const b = block.indexOf("{", idx);
    const region = block.slice(b, matchBrace(block, b) + 1);
    const num = k => {
      const m = new RegExp(`\\b${k}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`).exec(region);
      return m ? Number(m[1]) : undefined;
    };
    const str = k => new RegExp(`\\b${k}\\s*:\\s*"([^"]+)"`).exec(region)?.[1];
    const bool = k => {
      const m = new RegExp(`\\b${k}\\s*:\\s*(true|false)`).exec(region);
      return m ? m[1] === "true" : undefined;
    };
    out[key] = {
      shape: str("shape"), anchor: str("anchor"), addSize: bool("addSize"),
      width: num("width"), angle: num("angle"),
      size: num("size"), directionDelta: num("directionDelta"), ephemeral: bool("ephemeral")
    };
  }
  return out;
}

/**
 * 丢掉 undefined 字段并按键名排序，好与手写表（只写源码真有的字段、书写顺序也不同）
 * 逐字段比。排序是必须的：JSON.stringify 对键顺序敏感，不排就成了「书写顺序守卫」。
 */
const dropUndef = o => (o === null ? null
  : Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : 1))));

test("TARGET_TYPE_REGION 与 TARGET_TYPES.*.region 逐字段一致（shape/anchor/addSize/width/angle）", () => {
  const real = parseTargetTypeRegions();
  const realKeys = Object.keys(real);
  assert.equal(realKeys.length, 12,
    `源码 TARGET_TYPES 应有 12 个目标类型，实得 ${realKeys.length}：${realKeys.join("/")}`);
  // 样本量下限：8 个带 region、4 个 region:null。全 null 时逐字段比对会退化成空真。
  const withRegion = realKeys.filter(k => real[k]);
  assert.equal(withRegion.length, 8,
    "带 region 的目标类型应为 8 个（cone/fan/pulse/aura/blast/ray/summon/wall），"
    + `实得 ${withRegion.length}：${withRegion.join("/")}`);

  assert.deepEqual([...Object.keys(TARGET_TYPE_REGION)].sort(), [...realKeys].sort(),
    "TARGET_TYPE_REGION 的键集合与源码 TARGET_TYPES 不一致");

  const bad = realKeys.filter(k =>
    JSON.stringify(dropUndef(real[k])) !== JSON.stringify(dropUndef(TARGET_TYPE_REGION[k])));
  assert.deepEqual(bad, [],
    bad.map(k => `${k}: 表=${JSON.stringify(dropUndef(TARGET_TYPE_REGION[k]))} `
      + `源=${JSON.stringify(dropUndef(real[k]))}`).join("\n"));

  // 五个字段各自都得真的出现过，否则「逐字段一致」可以靠两边一起是 undefined 蒙混过关
  const present = f => realKeys.filter(k => real[k]?.[f] !== undefined).length;
  assert.equal(present("shape"), 8, "8 个 region 都必须有 shape");
  assert.equal(present("anchor"), 8, "8 个 region 都必须有 anchor");
  assert.equal(present("addSize"), 5, "写了 addSize 的应为 cone/fan/pulse/aura/ray 五个");
  assert.equal(present("width"), 2, "写了 width 的应为 ray/wall 两个");
  assert.equal(present("angle"), 2, "写了 angle 的应为 cone/fan 两个");
});

/**
 * 解析 `GESTURES.<gesture>` 的 `target.type` / `target.size` / `range.maximum`。
 * 这三样正是 `#getRegionData`（dice/action-use-dialog.mjs:491-600）算模板尺寸的全部输入。
 */
function parseGestureRegionInputs() {
  const out = {};
  for (const [g, block] of Object.entries(parseExportedObject(SPELLCRAFT, "GESTURES"))) {
    const sub = key => {
      const i = block.search(new RegExp(`\\b${key}\\s*:\\s*\\{`));
      if (i === -1) return null;
      const b = block.indexOf("{", i);
      return block.slice(b, matchBrace(block, b) + 1);
    };
    const t = sub("target"), r = sub("range");
    const n = (blk, k) => {
      if (!blk) return null;
      const m = new RegExp(`\\b${k}\\s*:\\s*(-?\\d+(?:\\.\\d+)?)`).exec(blk);
      return m ? Number(m[1]) : null;
    };
    out[g] = {
      type: t ? /type\s*:\s*"(\w+)"/.exec(t)?.[1] ?? null : null,
      size: n(t, "size"),
      rangeMax: n(r, "maximum")
    };
  }
  return out;
}

test("GESTURE_TARGET_SIZE / GESTURE_RANGE 与 spellcraft.mjs 的 GESTURES 逐项一致", () => {
  const real = parseGestureRegionInputs();
  const keys = Object.keys(real);
  assert.equal(keys.length, 17, `源码应解析出 17 个姿态，实得 ${keys.length}`);

  const realSizes = Object.fromEntries(
    keys.filter(g => real[g].size !== null).map(g => [g, real[g].size]));
  const realRanges = Object.fromEntries(
    keys.filter(g => real[g].rangeMax !== null).map(g => [g, real[g].rangeMax]));
  // 下限贴着实测：6 个手势写了 target.size、12 个写了 range.maximum。
  // 解析器坏掉时两个表都会变成 {}，而 deepEqual({}, {}) 恰恰是本批要消灭的空真。
  assert.equal(Object.keys(realSizes).length, 6,
    "写了 target.size 的姿态应为 6 个（aura/blast/pulse/ray/sense/surge），实得 "
    + `${Object.keys(realSizes).join("/")}`);
  assert.equal(Object.keys(realRanges).length, 12,
    `写了 range.maximum 的姿态应为 12 个，实得 ${Object.keys(realRanges).join("/")}`);

  assert.deepEqual(GESTURE_TARGET_SIZE, realSizes, "GESTURE_TARGET_SIZE 与源码 target.size 不一致");
  assert.deepEqual(GESTURE_RANGE, realRanges, "GESTURE_RANGE 与源码 range.maximum 不一致");

  // 老表把 aura/sense 与 ray/surge 各自合并成一条，正是因为它们的 target.type 相同——
  // 这几句把「共用类型但尺寸不同」这件事本身钉住，防止有人再合回去。
  assert.equal(real.aura.type, real.sense.type, "aura 与 sense 的目标类型本来就相同");
  assert.notEqual(realSizes.aura, realSizes.sense, "aura(20尺) 与 sense(30尺) 的 size 必须不同");
  assert.equal(real.ray.type, real.surge.type, "ray 与 surge 的目标类型本来就相同");
  assert.notEqual(realSizes.ray, realSizes.surge, "ray(宽1尺) 与 surge(宽10尺) 的 size 必须不同");
});

/**
 * 独立复算：不 import `regionForGesture`，而是**从解析出来的源码字段**重新算一遍模板，
 * 再与 `TARGET_REGION` 逐字段对。公式逐行对着 `#getRegionData`：
 *
 *   d          = canvas.dimensions.distancePixels = 100px/格 ÷ 5尺/格 = 20 px/尺
 *   baseRange  = target.size ? target.size : range.maximum        (:496-497)
 *   addRange   = region.addSize ? actor.size / 2 : 0              (:498)
 *   circle     radius = (baseRange + addRange) * d                (:510-518)
 *   cone       radius 同上；angle = region.angle ?? 60；
 *              curvature = angle <= 90 ? "flat" : "round"         (:519-529)
 *   emanation  radius 同上（aura 的 addSize 是 false）             (:530-545)
 *   line       length = (range.maximum + addRange) * d；
 *              width  = (region.width ?? 1) * d                   (:546-555)
 *   rectangle  summon 后处理：width = height = (target.size ?? region.size) * d，
 *              anchorX = anchorY = 0                              (:575-580)
 *   ray 后处理 target.size 覆盖 shape.width                        (:581-583)
 *
 * 合成施法者是中体型（origin.width = 1 格 = 5 尺），addRange 因此是 2.5 尺 = 50px。
 */
const REGION_D = 100 / 5;                  // GRID / grid.distance
const REGION_ORIGIN = {x: 500, y: 500};    // tools/dump-fixtures.mjs 的 ORIGIN
const REGION_CASTER_FT = 5;                // 中体型：width 1 格 × 5 尺
const REGION_VERTEX_FT = 20;               // 远目标在 +400px = 20 尺处

test("TARGET_REGION 每个手势的形状由 TARGET_TYPES 的五个字段与 GESTURES 的尺寸唯一决定", () => {
  const gestures = parseGestureRegionInputs();
  const regions = parseTargetTypeRegions();

  const withRegion = Object.keys(gestures).filter(g => regions[gestures[g].type]);
  // 下限贴着实测：17 个手势里 10 个有落地区域、7 个没有。全空时下面的循环一条都不跑。
  assert.equal(withRegion.length, 10,
    "应有 10 个手势带落地区域（aura/blast/cone/conjure/create/fan/pulse/ray/sense/surge），"
    + `实得 ${withRegion.length}：${withRegion.join("/")}`);

  const bad = [];
  const eq = (g, field, got, want) => {
    if (got !== want) bad.push(`${g}.${field}: 表=${got} 源算=${want}`);
  };

  for (const [g, gs] of Object.entries(gestures)) {
    const cfg = regions[gs.type];
    const got = TARGET_REGION[g];
    if (!cfg) {
      assert.equal(got, null,
        `${g} 的目标类型 ${gs.type} 没有 region，TARGET_REGION 却给了 ${JSON.stringify(got)}`);
      continue;
    }
    assert.ok(got, `${g}（目标类型 ${gs.type}）应有模板区域，TARGET_REGION 却是 ${got}`);

    const maxRange = gs.rangeMax ?? 0;
    const base = gs.size ?? maxRange;
    const add = cfg.addSize ? REGION_CASTER_FT / 2 : 0;

    eq(g, "type", got.type, cfg.shape);                                    // ← shape
    // ← anchor："self" 锚在施法者中心，"vertex" 由玩家在射程内点一个点（这里放在远目标处）
    const anchored = cfg.anchor === "self"
      ? REGION_ORIGIN
      : {x: REGION_ORIGIN.x + (Math.min(maxRange, REGION_VERTEX_FT) * REGION_D), y: REGION_ORIGIN.y};
    eq(g, "x", got.x, anchored.x);
    eq(g, "y", got.y, anchored.y);

    if (["circle", "cone", "emanation"].includes(cfg.shape)) {
      eq(g, "radius", got.radius, (base + add) * REGION_D);                // ← addSize
    }
    if (cfg.shape === "cone") {
      eq(g, "angle", got.angle, cfg.angle ?? 60);                          // ← angle
      eq(g, "curvature", got.curvature, (cfg.angle ?? 60) <= 90 ? "flat" : "round");
    }
    if (cfg.shape === "line") {
      eq(g, "length", got.length, (maxRange + add) * REGION_D);
      // ← width：region.width 是缺省值，ray 类型的 target.size 会盖掉它（#getRegionData:581-583）
      eq(g, "width", got.width,
        ((gs.type === "ray" && gs.size) ? gs.size : (cfg.width ?? 1)) * REGION_D);
    }
    if (gs.type === "summon") {
      const size = gs.size ?? cfg.size ?? 1;
      eq(g, "width", got.width, size * REGION_D);
      eq(g, "height", got.height, size * REGION_D);
      eq(g, "anchorX", got.anchorX, 0);
      eq(g, "anchorY", got.anchorY, 0);
    }
    if (cfg.shape === "emanation") eq(g, "base.type", got.base?.type, "token");
  }
  assert.deepEqual(bad, [], `TARGET_REGION 与按源码复算的结果不一致：\n${bad.join("\n")}`);

  // addSize 这一项必须真的改变了数字，否则上面那句 eq(radius) 在 add===0 时是空转
  const addSized = Object.keys(gestures).filter(g => regions[gestures[g].type]?.addSize);
  assert.ok(addSized.length >= 4,
    `带 addSize 的手势应至少 4 个（cone/fan/pulse/ray/surge），实得 ${addSized.join("/")}`);
  for (const g of addSized) {
    const gs = gestures[g];
    const base = (gs.size ?? gs.rangeMax ?? 0) * REGION_D;
    const measured = TARGET_REGION[g].radius ?? TARGET_REGION[g].length;
    assert.notEqual(measured, base,
      `${g} 声明了 addSize，模板尺寸却等于不加体型的 ${base}px——addSize 没被算进去`);
  }
});

test("TARGET_REGION 修掉了老表的五处不符（aura 形状 / ray-surge 宽度 / summon 缺项 / 半径 / curvature）", () => {
  // 这五条是施工清单 §4.3 逐条点名的旧缺陷，各锁一句，防止哪天有人「简化」回去。
  assert.equal(TARGET_REGION.aura.type, "emanation",
    "aura 的 region.shape 是 emanation（跟着 token 外形长），不是 circle");
  assert.equal(TARGET_REGION.sense.type, "emanation");
  assert.notEqual(TARGET_REGION.aura.radius, TARGET_REGION.sense.radius,
    "aura(20尺) 与 sense(30尺) 共用一条 region 是老表的错");

  assert.equal(TARGET_REGION.ray.type, "line");
  assert.equal(TARGET_REGION.surge.type, "line");
  assert.ok(TARGET_REGION.surge.width >= TARGET_REGION.ray.width * 5,
    `surge 宽 10 尺、ray 宽 1 尺，差一个数量级；`
    + `实得 ${TARGET_REGION.surge.width} vs ${TARGET_REGION.ray.width}`);

  for (const g of ["conjure", "create"]) {
    assert.equal(TARGET_REGION[g]?.type, "rectangle", `${g}（summon）在老表里整个缺项`);
  }

  assert.equal(TARGET_REGION.cone.curvature, "flat", "60° ≤ 90°，平底锥");
  assert.equal(TARGET_REGION.fan.curvature, "round",
    "210° > 90°，圆底扇——老表整个没有 curvature 字段");

  // 没有落地区域的 7 个手势必须是 null，不能凭空造一个模板出来
  const nulls = Object.keys(TARGET_REGION).filter(g => TARGET_REGION[g] === null);
  assert.deepEqual(nulls.sort(),
    ["arrow", "aspect", "influence", "step", "strike", "touch", "ward"],
    "没有 region 的手势集合变了");
});

/* -------------------------------------------- */
/*  三、屈折                                      */
/* -------------------------------------------- */

test("INFLECTIONS 与 spellcraft.mjs 的 INFLECTIONS 键集合一致", () => {
  const real = Object.keys(parseExportedObject(SPELLCRAFT, "INFLECTIONS"));
  assert.equal(real.length, 10, `源码应解析出 10 个屈折，实得 ${real.length}：${real.join("/")}`);
  assert.deepEqual([...INFLECTIONS].sort(), [...real].sort(),
    "INFLECTIONS 与源码不一致——法术语料的屈折轴会跟着错");
});

/* -------------------------------------------- */
/*  四、边界语料：六条盲区轴的样本量下限            */
/* -------------------------------------------- */

/**
 * `test/fixtures/edge-cases.json` 是批次 A 为六条结构性盲区（施工清单 §4.3）额外生成的
 * 合成语料。**它现在还没有消费者**——批次 B/C 的守卫（§1.8 落点复算、impact-harmless、
 * 治疗不喷血溅、大体型几何）才会用到它。
 *
 * 没有消费者的语料最容易烂掉：生成器改坏了、某条轴悄悄发空，等到批次 B 写守卫时
 * 得到的是一片空绿。所以这里先把**每条轴的样本量下限**钉住，数字一律贴着实测
 * （仓库惯例见 test/fallback-ratchet.test.mjs 的「基线必须贴着实测值，不许留放水余量」）。
 *
 * 计数一律**从数据里数**、不读生成器写的标记：标记可以说谎，数出来的不会。
 */
const EDGE = JSON.parse(readFileSync(
  new URL("./fixtures/edge-cases.json", import.meta.url), "utf8"));

test("边界语料六条轴：每条轴的样本量都贴着实测下限", () => {
  const targets = EDGE.flatMap(s => s.targets);
  assert.equal(EDGE.length, 100, `edge-cases.json 应有 100 条样本，实得 ${EDGE.length}`);
  assert.equal(new Set(EDGE.map(s => s.id)).size, EDGE.length, "边界语料的 id 有重复");
  assert.equal(targets.length, 178, `边界语料的目标总数应为 178，实得 ${targets.length}`);

  // 轴 1：8 个罗盘方向。数的是「施法者→目标」的方位角去重后有几个。
  const bearings = new Set(targets.map(t =>
    Math.round(Math.atan2(t.y - REGION_ORIGIN.y, t.x - REGION_ORIGIN.x) * 180 / Math.PI)));
  assert.equal(bearings.size, 8,
    `边界语料应覆盖 8 个罗盘方向，实得 ${bearings.size} 个：`
    + `${[...bearings].sort((a, b) => a - b).join("/")}`);

  // 轴 2：8 档结果全覆盖，且非 HIT 的目标不少于实测的 32 个
  const results = new Set(targets.map(t => t.results[0].result));
  assert.deepEqual([...results].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7],
    `8 档攻击结果（MISS…HIT）必须全被覆盖，实得 ${[...results].join("/")}`);
  const nonHit = targets.filter(t => t.results[0].result !== 7).length;
  assert.equal(nonHit, 32, `非 HIT 目标应为 32 个，实得 ${nonHit}`);

  // 轴 3：暴击
  const crits = targets.filter(t => t.results[0].critical).length;
  assert.equal(crits, 8, `暴击目标应为 8 个，实得 ${crits}`);

  // 轴 4：治疗。healed > 0 的目标必须同时 damage === null（结算只会落一边）
  const healed = targets.filter(t => t.healed > 0);
  assert.equal(healed.length, 56, `被治疗的目标应为 56 个，实得 ${healed.length}`);
  assert.deepEqual(healed.filter(t => t.damage).map(t => t.tokenId), [],
    "同一个目标不能既 healed > 0 又带 damage");

  // 轴 5：大体型施法者。sizeScale/offsetFor 的分支判据是 origin.width > 1
  const big = EDGE.filter(s => s.origin.width > 1);
  assert.deepEqual([...new Set(big.map(s => s.origin.width))].sort(), [2, 3],
    `大体型施法者体型应覆盖 2 与 3，实得 ${[...new Set(big.map(s => s.origin.width))]}`);
  assert.equal(big.length, 6, "大体型样本应为 6 条（2 种体型 × 近战/远程/锥形）");

  // 轴 6：屈折。10 个全覆盖，一个不许少
  const infl = EDGE.map(s => s.spell?.inflection).filter(Boolean);
  assert.deepEqual([...new Set(infl)].sort(), [...INFLECTIONS].sort(),
    `10 个屈折必须各有一条样本，实得 ${[...new Set(infl)].join("/")}`);

  // 轴 7：strike 手势带武器（法术里唯一 cost.weapon 的手势）
  const strikeGesture = EDGE.filter(s => s.spell?.gesture === "strike" && s.strikes.length > 0);
  assert.equal(strikeGesture.length, 12,
    `12 个符文的 strike 手势各应有一条带武器的样本，实得 ${strikeGesture.length}`);
  assert.ok(strikeGesture.every(s => s.strikes[0].identifier),
    "strike 手势的样本必须带一件**真实存在**的武器（identifier 非空），"
    + "否则按 identifier 分支的规则测不到");
});

test("边界语料不替换主语料：actions.json 与 edge-cases.json 的 id 不重叠", () => {
  const mainIds = JSON.parse(readFileSync(
    new URL("./fixtures/actions.json", import.meta.url), "utf8")).map(s => s.id);
  // 434 是条数不是去重 id 数：主语料按「id + tags + target + range + cost」的内容签名去重，
  // 同 id 不同内容的动作会各留一条（实测去重后 432 个 id）。
  assert.equal(mainIds.length, 434, `主语料应为 434 条，实得 ${mainIds.length}——边界语料掺进去了？`);
  const main = new Set(mainIds);
  const overlap = EDGE.map(s => s.id).filter(id => main.has(id));
  assert.deepEqual(overlap, [],
    "边界语料只许**额外**生成。掺进主语料会把兜底棘轮的三个基线整体抬高，"
    + "那三个数是 V2 的进度表（见 test/fallback-ratchet.test.mjs 的文件头）。");
});
