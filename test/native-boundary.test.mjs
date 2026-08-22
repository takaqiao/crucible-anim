/**
 * 「只补空缺」这条边界的源码锁。
 *
 * 本模组全部正当性建立在一条等价式上（见 scripts/trigger/wrap.mjs 的文档）：
 *
 *     Crucible 的 configureVFXEffect() 链最终返回 null  ⟺  系统对此动作无动画
 *
 * 这条等价式是**运行时**性质：`buildPlanFor` 只看返回值，`scripts/` 全文不硬编码任何
 * 组合名单——这正是「上游补齐实现时本模组自动让位」的来源，不能为了测试把它写死。
 * 于是它在离线测试里一条断言都没有：上游或本仓库任一侧漂移一点，边界就静默失效，
 * 而全部测试照样全绿（Task 14 评审的四个视角都独立指出了这一点）。
 *
 * 这个文件用 test/source-tables.test.mjs 已经验证过的手法——解析 Crucible 源码逐项对表
 * ——把等价式赖以成立的六件事钉在源码上。任何一条被上游改动，这里先红。
 *
 * 判据来源：/root/fvtt14-data/Data/systems/crucible/module/
 *   models/action.mjs:3037-3044   configureVFXEffect() 聚合器
 *   const/action.mjs:566, 794     TAGS.composed / TAGS.strike 的 configureVFX
 *   hooks/action.mjs:758          HOOKS.fall 的 configureVFX
 *   canvas/vfx/spells.mjs         configureSpellVFXEffect + 5 个 gesture configurator
 *   canvas/vfx/strikes.mjs        configureStrikeVFXEffect
 *   canvas/vfx/landing.mjs        configureLandingVFXEffect
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {tokenDoc} from "../tools/token-mocks.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CRUCIBLE = "/root/fvtt14-data/Data/systems/crucible/module";
const VFX = `${CRUCIBLE}/canvas/vfx`;

/* ---- 源码解析工具 -------------------------------------------------------- */

/**
 * 先剥注释再解析。Crucible 的注释里有大量撇号（`caster's`、`doesn't`），不剥的话
 * 下面的字符串状态机会从那里开始把整份源码当成字符串，括号配对全部错位。
 */
function stripComments(src) {
  let out = "";
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c; let s = c; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === "\\") { s += src[i]; i++; } s += src[i]; i++; }
      out += s + q; continue;
    }
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; out += "\n"; continue; }
    if (c === "/" && src[i + 1] === "*") { i += 2; while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++; i++; out += " "; continue; }
    out += c;
  }
  return out;
}

function matchPair(s, i0, open, close) {
  let d = 0;
  for (let i = i0; i < s.length; i++) {
    const c = s[i];
    if (c === '"' || c === "'" || c === "`") { const q = c; i++; while (i < s.length && s[i] !== q) { if (s[i] === "\\") i++; i++; } continue; }
    if (c === open) d++;
    else if (c === close) { d--; if (d === 0) return i; }
  }
  throw new Error(`括号不配对，起点 ${i0}`);
}

const srcOf = (() => {
  const cache = new Map();
  return f => {
    if (!cache.has(f)) cache.set(f, stripComments(readFileSync(f, "utf8")));
    return cache.get(f);
  };
})();

/** 取一个具名 `const X = { ... }` 的对象字面量块（含外层花括号）。 */
function constBlock(src, name) {
  const idx = src.indexOf(`const ${name} = {`);
  assert.notEqual(idx, -1, `源码里找不到 const ${name}`);
  const ob = src.indexOf("{", idx);
  return src.slice(ob, matchPair(src, ob, "{", "}") + 1);
}

/** 对象字面量块的顶层 `key: {...}` 条目，返回 {key: 子块}。 */
function topLevelBlocks(block) {
  const out = {};
  let i = 1;
  const n = block.length - 1;
  while (i < n) {
    while (i < n && /[\s,]/.test(block[i])) i++;
    if (i >= n) break;
    const m = /^(\w+)\s*:\s*\{/.exec(block.slice(i, i + 200));
    if (!m) { i++; continue; }
    const bi = i + m[0].length - 1;
    const ci = matchPair(block, bi, "{", "}");
    out[m[1]] = block.slice(bi, ci + 1);
    i = ci + 1;
  }
  return out;
}

/** 具名函数声明的函数体（含外层花括号）。 */
function fnBody(src, name) {
  const m = new RegExp(`function\\s+${name}\\s*\\(`).exec(src);
  assert.ok(m, `源码里找不到 function ${name}`);
  const ob = src.indexOf("{", m.index + m[0].length);
  return src.slice(ob, matchPair(src, ob, "{", "}") + 1);
}

/** 函数体里全部 `return <表达式>;` 的表达式原文（按出现顺序）。 */
function returnExprs(body) {
  return [...body.matchAll(/\breturn\b([^;]*);/g)].map(m => m[1].trim().replace(/\s+/g, " "));
}

/** 函数体里全部 `if (cond) return X;` 与 `if (cond) continue;`，归一成 `动作 ⇐ 条件`。 */
function guards(body) {
  const out = [];
  const re = /\bif\s*\(/g;
  let m;
  while ((m = re.exec(body))) {
    const op = body.indexOf("(", m.index);
    const cp = matchPair(body, op, "(", ")");
    const cond = body.slice(op + 1, cp).trim().replace(/\s+/g, " ");
    const after = body.slice(cp + 1).replace(/^\s+/, "");
    if (after.startsWith("continue")) out.push(`continue ⇐ ${cond}`);
    else if (after.startsWith("return")) {
      out.push(`return ${after.slice(6, after.indexOf(";")).trim().replace(/\s+/g, " ")} ⇐ ${cond}`);
    }
    re.lastIndex = cp;
  }
  return out;
}

/* ---- 1. configureVFX 钩子实现的全集与委托表达式 ---------------------------- */

/**
 * 全系统只有三处 `configureVFX(vfxConfig) {`，每一处都只是一行转发。
 * 多出第四处不必然是坏事（新钩子照样过 `?? vfxConfig` 归一化，我们照样自动让位），
 * 但那意味着有一个我们从没核过返回值的新出口——必须有人看一眼再更新这张表。
 */
const EXPECTED_HOOKS = {
  "const/action.mjs": [
    "return crucible.api.canvas.vfx.spells.configureSpellVFXEffect(this, vfxConfig);",
    "return crucible.api.canvas.vfx.strikes.configureStrikeVFXEffect(this, vfxConfig);"
  ],
  "hooks/action.mjs": [
    "return crucible.api.canvas.vfx.landing.configureLandingVFXEffect(this) ?? vfxConfig;"
  ]
};

function allHookImpls() {
  const found = {};
  const walk = dir => {
    for (const e of readdirSync(dir, {withFileTypes: true})) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { walk(p); continue; }
      if (!e.name.endsWith(".mjs")) continue;
      const src = srcOf(p);
      const re = /\bconfigureVFX\s*\(([^)]*)\)\s*\{/g;
      let m;
      while ((m = re.exec(src))) {
        const ob = src.indexOf("{", m.index + m[0].length - 1);
        const body = src.slice(ob, matchPair(src, ob, "{", "}") + 1);
        const rel = p.slice(CRUCIBLE.length + 1);
        (found[rel] ??= []).push(body.replace(/^\{\s*|\s*\}$/g, "").replace(/\s+/g, " ").trim());
      }
    }
  };
  walk(CRUCIBLE);
  return found;
}

test("configureVFX 钩子实现恰好 3 处，且都只是一行转发", () => {
  assert.deepEqual(allHookImpls(), EXPECTED_HOOKS,
    "Crucible 的 configureVFX 出口集合变了。多一处 = 多一个从未核过返回值的出口；"
    + "转发表达式变了 = 委托目标换人。两种情况都要重新核一遍「无动画时返回什么」，"
    + "然后才更新这张表——不要直接把实测值抄进来。");
});

test("configureVFXEffect 聚合器仍是 `let vfxConfig = null` 起手、`?? vfxConfig` 归一化", () => {
  const body = srcOf(`${CRUCIBLE}/models/action.mjs`);
  const i = body.indexOf("configureVFXEffect() {");
  assert.notEqual(i, -1, "CrucibleAction#configureVFXEffect 不见了（main.mjs 的自检也会拦下）");
  const b = body.slice(i, matchPair(body, body.indexOf("{", i), "{", "}") + 1).replace(/\s+/g, " ");
  assert.match(b, /let vfxConfig = null;/,
    "聚合器不再以 null 起手——「链输出 null」就不再等于「没人产出配置」");
  assert.match(b, /vfxConfig = test\.configureVFX\.call\(this, vfxConfig\) \?\? vfxConfig;/,
    "`?? vfxConfig` 没了：钩子返回 undefined 将不再被归一化成「保持前值」，"
    + "第三方钩子一个漏写的 return 就能把已有配置抹掉，我们会误判成「原生无动画」");
  assert.doesNotMatch(b, /try\s*\{/,
    "聚合器加了 try/catch：原生抛错不再掀翻 toMessage，wrap.mjs「抛错也接管」那条"
    + "有意为之的例外需要重新评估");
});

/* ---- 2. 三个 configurator 的 return 表达式：只准是 null / 透传 / 成功分支 ---- */

/**
 * 这是整条等价式的核心：**没有任何一个出口在「无动画」时返回 null 以外的假值**。
 * 一旦出现 `return undefined` / `return {}` / `return false`，我们的真值闸门就会
 * 把它当成「原生已接管」而让位，模组在那条路径上整体变哑巴，只留一行 debug()。
 */
const EXPECTED_RETURNS = {
  configureSpellVFXEffect:   ["null", "vfxConfig", "null", "null", "vfxConfig"],
  configureStrikeVFXEffect:  ["null", "vfxConfig"],
  configureLandingVFXEffect: ["null", "null", "null", "vfxConfig"]
};

test("三个 configurator 的 return 表达式只有 null 与 vfxConfig 两种", () => {
  const actual = {
    configureSpellVFXEffect: returnExprs(fnBody(srcOf(`${VFX}/spells.mjs`), "configureSpellVFXEffect")),
    configureStrikeVFXEffect: returnExprs(fnBody(srcOf(`${VFX}/strikes.mjs`), "configureStrikeVFXEffect")),
    configureLandingVFXEffect: returnExprs(fnBody(srcOf(`${VFX}/landing.mjs`), "configureLandingVFXEffect"))
  };
  assert.deepEqual(actual, EXPECTED_RETURNS,
    "configurator 的返回值集合变了。只要出现 null / vfxConfig 之外的东西（尤其 undefined、"
    + "{}、false），wrap.mjs 的 `if (nativeConfig) return null` 就会做出错误判断——"
    + "先确认新出口在「无动画」时到底返回什么，再更新这张表。");
  for (const [fn, rets] of Object.entries(actual)) {
    for (const r of rets) {
      assert.ok(!["undefined", "{}", "false", "0", '""'].includes(r),
        `${fn} 出现了非 null 的假值出口 \`return ${r}\`——「无动画」的哨兵值变了`);
    }
  }
});

/* ---- 3. 五个 gesture configurator 的 early-return 与 continue 条件 --------- */

/**
 * 冻结成字面量清单，为的是让**新增一条守卫**这件事本身变红。
 *
 * 具体在担心什么：`configureArrowVFXEffect` / `configureContactVFXEffect` 已有的
 * `continue ⇐ !result`，配上 `AttackRoll.RESULT_TYPES.MISS = 0`（dice/attack-roll.mjs:68）
 * 这个**假值**结果码，意味着「唯一目标 miss ⇒ timeline 为空 ⇒ 原生 return null ⇒ 我们接管」。
 * 今天走不到（documents/actor.mjs:701 的 testDefense 不产出 MISS），但 MISS 在枚举里、
 * 有 label，strikes.mjs 与 helpers.mjs 都写好了 `case T.MISS:` 分支——它是被预留的。
 * 一旦启用，arrow/touch/influence 三个姿态（12 个原生组合）会在每次失手时换成本模组的
 * 画风，命中时又切回 Crucible 粒子，玩家侧表现为画风闪跳；而 Task 16 第 12 项只要
 * 测试者手气好（全命中）就会误判为通过。这张表是唯一能提前发现它的地方。
 */
const EXPECTED_GUARDS = {
  configureArrowVFXEffect: [
    'return null ⇐ action.target.type !== "single"',
    "return null ⇐ !runeProps",
    "continue ⇐ !group.hasRoll",
    "continue ⇐ !token",
    "continue ⇐ !result",
    "return null ⇐ !timeline.length"
  ],
  configureBlastVFXEffect: [
    'return null ⇐ !regionShape || (regionShape.type !== "circle")',
    "return null ⇐ !runeProps",
    "continue ⇐ !group.hasRoll",
    "continue ⇐ !token"
  ],
  configureFanVFXEffect: [
    'return null ⇐ !regionShape || (regionShape.type !== "cone")',
    "return null ⇐ !runeProps",
    "continue ⇐ !group.hasRoll",
    "continue ⇐ !token",
    "continue ⇐ !isHit && (result !== T.RESIST)"
  ],
  configureRayVFXEffect: [
    'return null ⇐ !regionShape || (regionShape.type !== "line")',
    "return null ⇐ !runeProps",
    "continue ⇐ !group.hasRoll",
    "continue ⇐ !token"
  ],
  configureContactVFXEffect: [
    'return null ⇐ action.target.type !== "single"',
    "return null ⇐ !runeProps",
    "continue ⇐ !group.hasRoll",
    "continue ⇐ !token",
    "continue ⇐ !result",
    "return null ⇐ !impacts.length"
  ],
  configureStrikeVFXEffect: [
    "continue ⇐ !token",
    'continue ⇐ !["projectile1", "projectile2"].includes(weapon?.category)',
    "return null ⇐ !timeline.length"
  ],
  configureLandingVFXEffect: [
    "return null ⇐ !distance || (distance <= 0)",
    "return null ⇐ !token"
  ]
};

test("configurator 的 early-return / continue 条件与冻结清单逐条相等", () => {
  const spells = srcOf(`${VFX}/spells.mjs`);
  const actual = {};
  for (const fn of ["configureArrowVFXEffect", "configureBlastVFXEffect", "configureFanVFXEffect",
                    "configureRayVFXEffect", "configureContactVFXEffect"]) {
    actual[fn] = guards(fnBody(spells, fn));
  }
  actual.configureStrikeVFXEffect = guards(fnBody(srcOf(`${VFX}/strikes.mjs`), "configureStrikeVFXEffect"));
  actual.configureLandingVFXEffect = guards(fnBody(srcOf(`${VFX}/landing.mjs`), "configureLandingVFXEffect"));
  assert.deepEqual(actual, EXPECTED_GUARDS,
    "原生「什么时候画不出东西」的条件变了：多一条守卫 = 多一批本来归原生、现在会掉到"
    + "我们手里的动作（同一个法术命中/失手画风不同是玩家最容易察觉的那种闪跳）；"
    + "少一条 = 我们本来接管的场合现在归原生。两种都要先想清楚再更新清单。");
});

/* ---- 4. SPELL_VFX_GESTURES：17 个姿态、6 个有 configure、0 个 configure:null -- */

/**
 * `configure: null` 是 Crucible 唯一的官方「刻意不给这个姿态动画」通道
 * （spells.mjs:57 `if ( hooks?.configure === null ) return null;`，源码注释原文：
 * `null` explicitly suppresses VFX; absent defers to existing config）。
 * 它在链末端的输出与「压根没实现」一模一样，都是 null，本模组无从区分——一旦有人用上，
 * 我们就会去覆盖一个上游刻意做出的「这里不该有动画」的决定。0.10.2 里 17 个姿态无一
 * 使用它，这条断言就是它启用那天的第一声警报。
 */
const NATIVE_CONFIGURED_GESTURES = ["arrow", "blast", "fan", "influence", "ray", "touch"];
const NATIVE_VFX_RUNES = ["death", "flame", "frost", "life"];

function gestureTable() {
  return topLevelBlocks(constBlock(srcOf(`${VFX}/spells.mjs`), "SPELL_VFX_GESTURES"));
}

test("SPELL_VFX_GESTURES：17 个姿态，6 个带 configure，0 个 configure: null", () => {
  const g = gestureTable();
  assert.equal(Object.keys(g).length, 17, `姿态数变成 ${Object.keys(g).length}，缺口矩阵要重算`);
  const withConfigure = Object.entries(g)
    .filter(([, b]) => /(^|[{,\s])configure\s*:/.test(b)).map(([k]) => k).sort();
  assert.deepEqual(withConfigure, [...NATIVE_CONFIGURED_GESTURES].sort(),
    "原生已实现的姿态集合变了。补齐时本模组自动让位（不需要改代码），"
    + "但 docs/DESIGN.md §1 的缺口矩阵与 README 的「6/17 个姿态」都要跟着改。");
  const suppressed = Object.entries(g).filter(([, b]) => /configure\s*:\s*null/.test(b)).map(([k]) => k);
  assert.deepEqual(suppressed, [],
    `${suppressed.join("/")} 用上了 Crucible 的「显式禁画」通道（configure: null）。`
    + "它在链末端与「没实现」一样都是 null，本模组会照常接管，"
    + "等于覆盖上游刻意做出的决定——必须在 wrap.mjs 里按姿态名单显式让位。");
});

test("五张 runes 表都只有 death/flame/frost/life，叉乘出 24 个原生组合", () => {
  const spells = srcOf(`${VFX}/spells.mjs`);
  const tables = {arrow: "ARROW_VFX_PROPS", blast: "BLAST_VFX_PROPS", fan: "FAN_VFX_PROPS",
                  ray: "RAY_VFX_PROPS", touch: "TOUCH_VFX_PROPS", influence: "TOUCH_VFX_PROPS"};
  const combos = [];
  for (const gesture of NATIVE_CONFIGURED_GESTURES) {
    const runes = Object.keys(topLevelBlocks(constBlock(spells, tables[gesture]))).sort();
    assert.deepEqual(runes, [...NATIVE_VFX_RUNES].sort(),
      `${tables[gesture]} 的符文集合变了：${runes.join(",")}`);
    for (const rune of runes) combos.push(`spell.${rune}.${gesture}`);
  }
  assert.equal(combos.length, 24,
    `原生覆盖的法术组合数变成 ${combos.length}（12 符文 × 17 姿态 = 204 里的一部分），`
    + "README 与 docs/DESIGN.md §1 的数字要同步");
});

/* ---- 5. 本仓库侧：闸门必须是纯真值判断，且不得硬编码组合名单 ---------------- */

test("scripts/ 里不出现任何原生组合的硬编码名单", () => {
  // 「上游补齐实现时自动让位」这条设计承诺的全部依据就是这里：闸门只看
  // configureVFXEffect() 的返回值，不认识任何具体 id。哪天有人为了省事写死一张
  // 24 组名单，上游补第 25 组时我们就会去覆盖它，而且没有任何东西会报警。
  const combos = [];
  for (const g of NATIVE_CONFIGURED_GESTURES) for (const r of NATIVE_VFX_RUNES) combos.push(`${r}.${g}`);
  const walk = (dir, out = []) => {
    for (const e of readdirSync(dir, {withFileTypes: true})) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (e.name.endsWith(".mjs")) out.push(p);
    }
    return out;
  };
  const hits = [];
  for (const f of walk(join(ROOT, "scripts"))) {
    const src = readFileSync(f, "utf8");
    for (const c of combos) if (src.includes(c)) hits.push(`${f.slice(ROOT.length + 1)} 提到了 ${c}`);
  }
  assert.deepEqual(hits, [], hits.join("\n"));
});

test("闸门是真值判断而不是 `=== null`：任何假值都视为「原生无动画」", async () => {
  const {offlineBackend, createAssets} = await import("../scripts/resolver/assets.mjs");
  const {ARMORY} = await import("../scripts/armory/index.mjs");
  const {buildPlanFor} = await import("../scripts/trigger/wrap.mjs");
  const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
  const deps = () => ({assets: createAssets(offlineBackend(index)), armory: ARMORY});
  const ENV = {gridSize: 100, distancePixels: 100};
  const targetActor = {id: "a1"};
  const action = () => ({
    id: "spell.storm.arrow", name: "风暴箭",
    tags: new Set(["spell", "composed"]),
    target: {type: "single", number: 1, distance: 6, scope: 2},
    range: {minimum: 0, maximum: 6}, cost: {action: 1, focus: 1, heroism: 0, health: 0},
    region: null, actor: {type: "hero"},
    token: tokenDoc({id: "t0", center: {x: 500, y: 500}}),
    targets: new Map([[targetActor, {token: tokenDoc({id: "t1", center: {x: 900, y: 500}})}]]),
    usage: {damageType: "lightning", isAttack: true, isRanged: true, strikes: []},
    rune: {id: "storm"}, gesture: {id: "arrow"}, inflection: null,
    eventsByTarget: new Map([[targetActor,
      {all: [], roll: [{roll: {data: {result: 7}, isCriticalSuccess: false}}]}]])
  });

  // Crucible 自己只会给出 null 或一个真配置对象（上面几条断言钉住了这一点）。但
  // crucible.api.hooks.action / .spellcraft 是**给模组作者扩展的注册表**
  // （models/action.mjs:598 的文档原文），第三方钩子返回 0/""/false 时 `?? vfxConfig`
  // 不做归一化，链输出会是那个假值。原生 CrucibleChatMessage#_onUpdate 的播放闸门
  // 同样是 `flags.vfxConfig` 真值判断，所以真值判断让两边对「有没有动画」的结论恒等；
  // 换成 `=== null` 会出现「原生不播、我们也不播」的黑屏。
  for (const falsy of [null, undefined, 0, "", false, NaN]) {
    assert.ok(buildPlanFor(action(), ENV, deps(), {nativeConfig: falsy}),
      `nativeConfig=${String(falsy)} 时必须接管——原生在这个取值下也不会播`);
  }
  for (const truthy of [{}, {components: {}}, [], "x"]) {
    assert.equal(buildPlanFor(action(), ENV, deps(), {nativeConfig: truthy}), null,
      `nativeConfig=${JSON.stringify(truthy)} 时必须让位——原生的播放闸门会认这个值`);
  }
});
