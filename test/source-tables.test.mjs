import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

import {GESTURE_TARGET, STATUSES, TARGET_REGION, RUNE_DAMAGE,
        RUNE_RESOURCE} from "../tools/dump-fixtures.mjs";
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
