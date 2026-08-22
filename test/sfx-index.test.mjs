/**
 * `data/sfx-index.json` 的结构性守卫，与 test/asset-index.test.mjs 同构。
 *
 * 这份索引和 Sequencer 那几个官方 DB 不一样：**它是我们自己生成的**，
 * 没有上游厂商替我们保证「路径指向的文件真的存在」。生成器（tools/index-sfx.mjs）
 * 只收录 walk 到的真实文件，所以理论上不会有死链——但生成器改坏了、Data 目录换了、
 * 或者有人手改了 JSON，都会让这条保证悄悄失效。运行时的表现是「没声音」，
 * 而离线测试全绿：本项目第 3 类失败模式。
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync, existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {FOUNDRY_DATA} from "../tools/paths.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sfx = JSON.parse(readFileSync(join(ROOT, "data/sfx-index.json"), "utf8"));
const assetIndex = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));

/** 遍历树，收集 [点分路径, 文件路径]；数组成员逐个展开成 `path[i]`。 */
function collect(node, path = "", out = []) {
  for (const [k, v] of Object.entries(node)) {
    if (k.startsWith("_")) continue;
    const p = path ? `${path}.${k}` : k;
    if (typeof v === "string") out.push([p, v]);
    else if (Array.isArray(v)) v.forEach((f, i) => { if (typeof f === "string") out.push([`${p}[${i}]`, f]); });
    else if (v && typeof v === "object") collect(v, p, out);
  }
  return out;
}

const all = collect(sfx.tree);

test("canim 命名空间齐备，两个来源都在", () => {
  assert.ok(sfx.tree.canim, "缺 tree.canim");
  for (const ns of ["mgs", "sfxlib"]) {
    assert.ok(sfx.tree.canim[ns], `缺 canim.${ns}`);
  }
  for (const [ns, meta] of Object.entries(sfx.sources)) {
    assert.ok(!meta.error, `来源 ${ns} 生成失败：${meta.error}`);
    assert.ok(meta.files > 0, `来源 ${ns} 收录了 0 个文件`);
  }
});

test("索引里每一条路径都指向磁盘上真实存在的文件", () => {
  const missing = all.filter(([, f]) => !existsSync(join(FOUNDRY_DATA, decodeURI(f))));
  assert.deepEqual(missing.slice(0, 10).map(m => m[0]), [],
    `${missing.length} 条路径指向不存在的文件。生成器只收录 walk 到的真实文件，` +
    "出现缺失说明 JSON 被手改过、Data 目录换了、或生成器坏了——重跑 npm run index:sfx");
});

test("主树里没有 ≥longSeconds 的长音，它们全在 excluded 里", () => {
  assert.ok(sfx.longSeconds > 0, "缺 longSeconds 字段");
  const excludedPaths = new Set(sfx.excluded.map(e => e.path));
  const leaked = all.filter(([, f]) => excludedPaths.has(f));
  assert.deepEqual(leaked.slice(0, 5), [],
    "被判为长音的文件同时出现在主树里——主树是给 one-shot 用的，" +
    "混进 10 秒以上的环境循环会让战斗音效层很难听");
  for (const e of sfx.excluded) {
    assert.ok(e.seconds >= sfx.longSeconds,
      `${e.path} 只有 ${e.seconds}s 却被排除，阈值是 ${sfx.longSeconds}s`);
  }
});

test("文件数对账：主树 + excluded == 各来源实际扫到的总数", () => {
  const declared = Object.values(sfx.sources).reduce((a, s) => a + (s.files ?? 0), 0);
  const actual = all.length + sfx.excluded.length;
  assert.equal(actual, declared,
    `对不上：主树 ${all.length} + excluded ${sfx.excluded.length} = ${actual}，` +
    `而各来源声称扫到 ${declared}。差额意味着有文件被静默丢弃。`);
  assert.deepEqual(sfx.unreadable, [],
    "有文件探针读不出参数——它们既不在主树也不在 excluded，是真正的丢失");
});

/**
 * 这条是这份索引存在的**理由**，不是形式检查。
 *
 * MGS 是全机唯一按伤害类型字面命名的音源矩阵，而 Crucible 恰好有 12 种伤害类型
 * （`const/attributes.mjs:107` 的 DAMAGE_TYPES）。三条命名不对齐的必须显式记下来，
 * 否则将来有人按 `combat.<类型>_damage` 的规律去拼路径，会静默拼空：
 *   · electricity → MGS 叫 Lightning，且在 Magic/ 不在 Combat/
 *   · corruption  → MGS 叫 Necrotic
 *   · void        → MGS **没有** `X Damage` 形态，只有 Spells/ 下三条法术名文件
 */
const DAMAGE_SOURCES = {
  bludgeoning: "canim.mgs.basic.combat.bludgeoning_damage",
  piercing:    "canim.mgs.basic.spells.piercing_damage_spell",
  slashing:    "canim.mgs.basic.weapons.slashing_damage_spell",
  poison:      "canim.mgs.basic.combat.poison_damage",
  acid:        "canim.mgs.basic.combat.acid_damage",
  fire:        "canim.mgs.basic.combat.fire_damage",
  cold:        "canim.mgs.basic.combat.cold_damage",
  electricity: "canim.mgs.basic.magic.lightning_damage",
  corruption:  "canim.mgs.basic.combat.necrotic_damage",
  psychic:     "canim.mgs.basic.combat.psychic_damage",
  radiant:     "canim.mgs.basic.combat.radiant_damage",
  void:        "canim.mgs.basic.spells.void_bolt"
};

function node(tree, dotted) {
  let cur = tree;
  for (const part of dotted.split(".")) {
    if (!cur || typeof cur !== "object" || Array.isArray(cur)) return undefined;
    cur = cur[part];
  }
  return cur;
}

test("Crucible 的 12 种伤害类型都能在索引里取到音源", () => {
  const missing = [];
  for (const [type, path] of Object.entries(DAMAGE_SOURCES)) {
    const n = node(sfx.tree, path);
    const ok = typeof n === "string" || (Array.isArray(n) && n.length > 0);
    if (!ok) missing.push(`${type} → ${path}`);
  }
  assert.deepEqual(missing, [],
    "伤害类型的音源路径解析不到。MGS 的命名有三处不规律（electricity=Lightning 且在 Magic/、" +
    "corruption=Necrotic、void 没有 Damage 形态），改动索引生成规则时最容易在这里断。");
});

test("同一份 canim 树已并进 asset-index，两边不会漂移", () => {
  assert.ok(assetIndex.tree.canim,
    "data/asset-index.json 里没有 canim —— extract-db.mjs 应当合并 sfx-index，" +
    "否则离线守卫看不到这些路径，兵库引用它们时 armory-assets 会误判为「不在记录里」");
  const inAsset = collect({canim: assetIndex.tree.canim}).length;
  assert.equal(inAsset, all.length,
    `asset-index 里的 canim 有 ${inAsset} 条，sfx-index 里有 ${all.length} 条——` +
    "两边漂移了，重跑 npm run index");
});

/**
 * 剥注释，与 test/manifest.test.mjs、test/armory-assets.test.mjs 同法。
 *
 * **不剥注释这条守卫就是假的**：正则匹配的是源码文本，把调用改成
 * `// await registerSfxDatabase();` 之后照样命中——变异验证时实测过一次，
 * 四条变异里只有这条溜过去了。
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .map(l => { const i = l.indexOf("//"); return i === -1 ? l : l.slice(0, i); })
    .join("\n");
}

test("main.mjs 真的调用了 registerSfxDatabase", () => {
  const main = stripComments(readFileSync(join(ROOT, "scripts/main.mjs"), "utf8"));
  assert.match(main, /import\s*\{\s*registerSfxDatabase\s*\}/,
    "main.mjs 没有 import registerSfxDatabase");
  assert.match(main, /await\s+registerSfxDatabase\s*\(\s*\)/,
    "main.mjs 没有 await registerSfxDatabase() —— 不注册的话 canim.* 在游戏里全部解析不到，" +
    "而离线测试照样全绿（离线走的是 asset-index，不走 Sequencer）");
});
