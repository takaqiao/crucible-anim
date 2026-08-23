import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const actions = JSON.parse(readFileSync(join(ROOT, "test/fixtures/actions.json"), "utf8"));
const weaponStrikes = JSON.parse(readFileSync(join(ROOT, "test/fixtures/weapon-strikes.json"), "utf8"));
const effects = JSON.parse(readFileSync(join(ROOT, "test/fixtures/effects.json"), "utf8"));

test("动作 fixture 数量达到预期规模", () => {
  // 简报预期 435 = 131+46+15+26 (compendium 四包) + 13 (DEFAULT_ACTIONS) + 204 (法术矩阵)。
  // 实测四包的原始动作数与简报table完全一致(131/46/15/26)。三个撞 id 经逐字段核实：
  // graveMark 两处内容全等（Crucible 核心与 Ember 间的移植，去重无害），但 steamVent
  // （"Burnout" vs "Steam Vent"）与 invisibility（"Natural Invisibility" vs 法术
  // "Invisibility"）两处内容并不相同、是两个独立动作。去重判据已改为内容签名
  // （id+tags+target+range+cost）而非纯 id，因此这两个 id 各保留 2 条、graveMark 保留 1
  // 条，理论值 435 - 1(graveMark 去重) = 434。
  assert.ok(actions.length >= 434, `只有 ${actions.length} 个，应 >= 434`);
});

test("合成法术矩阵 12 × 17 完整", () => {
  const spells = actions.filter(a => a.spell);
  const combos = new Set(spells.map(a => `${a.spell.rune}.${a.spell.gesture}`));
  assert.equal(combos.size, 204, `法术组合 ${combos.size} 个，应为 204`);
});

test("每个 fixture 的必填字段齐全", () => {
  for (const a of actions) {
    for (const k of ["id", "tags", "target", "range", "cost", "origin", "targets", "usage", "seed"]) {
      assert.ok(k in a, `${a.id} 缺字段 ${k}`);
    }
    assert.ok(Array.isArray(a.tags));
    assert.ok(Array.isArray(a.targets));
    assert.equal(typeof a.origin.x, "number");
    assert.equal(typeof a.seed, "number");
  }
});

test("同时覆盖贴身与隔格两种几何", () => {
  const adj = actions.filter(a => a.targets.some(t => t.adjacent));
  const far = actions.filter(a => a.targets.some(t => !t.adjacent));
  assert.ok(adj.length > 0 && far.length > 0);
});

test("状态 fixture 覆盖全部 46 个状态", () => {
  // 46 个，取自 statuses.mjs 的 statusEffects；不含 flanked——那是 derivedConditions
  // 里「由情境派生、不可赋予」的条件，永远不会作为 ActiveEffect 出现。
  assert.equal(effects.length, 46);
  assert.ok(!effects.some(e => e.statusId === "flanked"), "flanked 不应出现在状态 fixture 里");
  assert.ok(effects.every(e => e.statusId && typeof e.target.x === "number"));
});

test("每个 token 几何都带 uuid —— 缺了它一批断言会退化成同义反复", () => {
  // 生产环境 trigger/snapshot.mjs 的 tokenGeom() 恒写 uuid；语料缺它会让
  // armory-persist 的 `notEqual(c.tieTo, e.target.uuid)` 变成「真字符串 ≠ undefined」
  // 恒真，也让 Task 14 resolveRefIn 的 fromUuidSync 主路径一次都行使不到。
  const geoms = [
    ...actions.flatMap(a => [a.origin, ...a.targets]),
    ...effects.map(e => e.target)
  ];
  assert.ok(geoms.length > 1000, `只有 ${geoms.length} 个 token 几何，扫描面可疑`);
  for (const g of geoms) {
    assert.equal(typeof g.uuid, "string", `${g.tokenId} 缺 uuid`);
    assert.ok(g.uuid.includes(g.tokenId), `${g.uuid} 与 tokenId ${g.tokenId} 对不上`);
  }
});

/* ================================================================
 * 武器通路的语料覆盖（2026-08-23 补）
 *
 * 这组守卫补的是一个**存在了整个 V1 期、但没有任何测试能发现**的语料缺陷：
 *
 * Crucible 的天赋物品上写的是 `melee` / `twohand` / `thrown` 这些标签，
 * **没有一个带字面 `strike`**——运行时由 `TAGS[].propagate` 补上（`melee → strike`、
 * `thrown → melee → strike`、`projectile → ranged → strike`）。而 dump-fixtures 从前
 * 直接读原始标签，于是 `tags.includes("strike")` 恒假、69 条 `cost.weapon === true` 的
 * 动作 `usage.strikes` 全是 `[]`。
 *
 * 后果：那 69 条里 55 条一条 travel cue 都不出，`strike.unarmed` 命中 0 次、
 * `strike.melee` 只服务两个默认动作。**整个武器天赋空间从未被执行过**，
 * 而覆盖率、判别度、兜底率所有指标都照常给出「看起来合理」的数字。
 *
 * `test/fallback-ratchet.test.mjs` 能间接抓到回归（兜底率会涨），但它只说
 * 「兜底涨了」，不说为什么。下面三条直接钉在根因上。
 * ================================================================ */

/** 与 `const/action.mjs` 的 `TAGS[].propagate` 逐条对应；改这里之前先去读那张表。 */
const PROPAGATE = {
  projectile: ["ranged"], mechanical: ["ranged"], talisman: ["strike"],
  unarmed: ["melee"], rest: ["noncombat"], melee: ["strike"], ranged: ["strike"],
  mainhand: ["strike"], twohand: ["strike"], offhand: ["strike"], thrown: ["melee"],
  natural: ["melee"]
};

test("语料已应用 Crucible 的标签传播（melee → strike 等）", () => {
  const missing = [];
  for (const a of actions) {
    const tags = new Set(a.tags ?? []);
    for (const [src, dsts] of Object.entries(PROPAGATE)) {
      if (!tags.has(src)) continue;
      for (const d of dsts) {
        if (!tags.has(d)) missing.push(`${a.id}: 有 ${src} 却没有传播出的 ${d}`);
      }
    }
  }
  assert.deepEqual(missing.slice(0, 8), [],
    `${missing.length} 处标签传播没做。天赋物品上没有字面 strike 标签，` +
    "不做传播的话按 strike/ranged 匹配的兵库规则在语料上永远不可达——" +
    "而所有覆盖率指标仍会给出看起来合理的数字。");
});

test("绑武器的动作都带得动武器（strikes 非空）", () => {
  const wb = actions.filter(a => !a.spell && a.cost?.weapon === true);
  assert.ok(wb.length >= 60, `绑武器动作只有 ${wb.length} 条，语料是不是缺了？`);
  const naked = wb.filter(a => !(a.strikes ?? []).length).map(a => a.id);
  assert.deepEqual(naked.slice(0, 10), [],
    `${naked.length}/${wb.length} 条 cost.weapon===true 的动作没有武器。` +
    "Crucible 的 strike.prepare() 会在 usage.strikes 为空时把手上的武器塞进去，" +
    "语料不合成武器就等于让整条武器通路测不到。");
});

/**
 * 两份语料合起来看。
 *
 * 动作语料里一个动作只带一件武器（`synthWeapon` 按标签推），推得再准也只覆盖 8 件、
 * 4 种伤害类型——**而且这是对的**：武器的伤害类型不等于动作的伤害类型，
 * `flamingArrow` 的火来自动作，弓仍是穿刺的。12 种武器伤害类型的覆盖由
 * `weapon-strikes.json`（92 件武器各一份平打快照）提供，那也正是 ELEMENT_LAYER
 * 第 3 级回退唯一被行使到的地方：平打不带伤害标签，链子才够得到武器那一层。
 */
test("语料行使到多种武器分类与伤害类型，不是单一值", () => {
  const cats = new Set(), dmgs = new Set();
  for (const a of [...actions, ...weaponStrikes]) for (const w of (a.strikes ?? [])) {
    if (w.category) cats.add(w.category);
    if (w.damageType) dmgs.add(w.damageType);
  }
  assert.ok(cats.size >= 6,
    `武器分类只行使到 ${cats.size} 种（${[...cats].join(",")}）。` +
    "Crucible 有 16 个分类，武器派发规则按 category 分支——" +
    "单一分类的语料测它等于没测。");
  assert.ok(dmgs.size >= 6,
    `武器伤害类型只行使到 ${dmgs.size} 种（${[...dmgs].join(",")}）。` +
    "impact 的 ELEMENT_LAYER 有 12 支，靠武器决定伤害类型是它的第 3 级回退。");
});

test("武器动作确实产出 travel cue（不是解析出来就完事）", async () => {
  const {offlineBackend, createAssets} = await import("../scripts/resolver/assets.mjs");
  const {resolve} = await import("../scripts/resolver/resolve.mjs");
  const {ARMORY} = await import("../scripts/armory/index.mjs");
  const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
  const mk = () => createAssets(offlineBackend(index));

  const wb = actions.filter(a => !a.spell && a.cost?.weapon === true);
  const silent = [];
  for (const s of wb) {
    const plan = resolve(s, {assets: mk(), armory: ARMORY});
    if (!(plan?.cues ?? []).some(c => c.slot === "travel")) silent.push(s.id);
  }
  // 修复前是 55/69；留 5 条余量给「本来就不该有 travel 的」（如纯自身增益）
  assert.ok(silent.length <= 5,
    `${silent.length}/${wb.length} 条武器动作一条 travel cue 都不出：` +
    `${silent.slice(0, 10).join(", ")}。` +
    "这正是语料缺武器时的症状——规则写得再好也够不着。");
});
