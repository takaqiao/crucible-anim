/**
 * 把 Crucible 的全部武器导出成 `data/weapons.json` —— 武器派发表的**定义域**。
 *
 * ## 为什么要这份数据
 *
 * V2 线 A 要给每件武器配专属画面。「每件」是哪些件、一共几件，必须来自**枚举**而不是
 * 手写清单——本项目已经在「本机装了哪些模块」上栽过一次（见 LOCAL-STATUS）。
 * 有了这份枚举，覆盖率守卫才能说「92 件里还有 N 件没配」，而不是「我以为都配了」。
 *
 * 同时它也是语料合成的素材来源：`dump-fixtures.mjs` 从前用 `synthWeapon()` 凭标签造一件
 * 抽象武器（只有 category + damageType），派发表按 identifier 分支时那种语料**一条都测不到**。
 *
 * ## 派发键为什么是 `system.identifier`
 *
 * 逐条读源码定的，三个候选里只有它活得下来：
 *
 * | 候选 | 官方 pack 里 | **装在角色身上时** |
 * | --- | --- | --- |
 * | `_id` | 语义 slug（`dagger0000000000`） | **随机**（`U0pzlydffRGomINf`）——补零 slug 是 `standardizeItemIds()`（crucible-compiled.mjs:48925）给**世界物品**做的规范化，嵌入物品不走它 |
 * | `_stats.compendiumSource` | null | **null** |
 * | `system.identifier` | `dagger` | **`dagger`** ✓ |
 *
 * identifier 还有两个好处：不是显示名，Babele / crucible-cn 把名字译成「匕首 Dagger」
 * 也动不到它（名字派发在本项目是已知的坑）；以及创建时若没给，`_preCreate`
 * （crucible-compiled.mjs:7992）会用 `generateId(name)` 按名字生成。
 *
 * ⚠ 它**不保证**是语义的：`ItemIdentifierField` 的默认值是 `randomID(10)`（23881），
 * pack 作者没填时就会留下 `G63t1Pjsjr` 这种串（summons 包里 9 件有 4 件如此）。
 * 不必检测——派发表里查不到的自然落回 category 级联，正是现有行为。
 *
 * ⚠ identifier **不唯一**：`claws` 在 `light1` 与 `unarmed` 各有一件。两件都是 slashing
 * 爪击，共用一份画面反而是对的，所以不去重，只在下面记一笔。
 *
 * 用法： node tools/dump-weapons.mjs [--data <Foundry Data>]
 */
import {ClassicLevel} from "classic-level";
import {writeFileSync} from "node:fs";
import {join, dirname} from "node:path";
import {fileURLToPath} from "node:url";
import {FOUNDRY_DATA} from "./paths.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 两个包：玩家装备 + 敌人装备（后者是 39 件 natural 天生武器的家）。 */
const PACKS = ["equipment", "adversary-equipment"];

export async function dumpWeapons(dataDir = FOUNDRY_DATA) {
  const out = [];
  for (const pack of PACKS) {
    const db = new ClassicLevel(join(dataDir, "systems/crucible/packs", pack), {valueEncoding: "json"});
    await db.open();
    try {
      for await (const [k, v] of db.iterator()) {
        if (!k.startsWith("!items!") || v?.type !== "weapon") continue;
        out.push({
          identifier: v.system?.identifier ?? null,
          name: v.name ?? null,
          pack,
          category: v.system?.category ?? null,
          damageType: v.system?.damageType ?? null,
          // properties 决定形态修正：versatile 双持、oversized 更大、thrown 可投掷、
          // natural 是天生武器（不该出金属反光与刀光，该出爪牙）
          properties: [...(v.system?.properties ?? [])].sort(),
          img: v.img ?? null
        });
      }
    } finally { await db.close(); }
  }
  out.sort((a, b) => `${a.category}${a.identifier}`.localeCompare(`${b.category}${b.identifier}`));
  return out;
}

if (import.meta.url === (await import("node:url")).pathToFileURL(process.argv[1] ?? "").href) {
  const i = process.argv.indexOf("--data");
  const weapons = await dumpWeapons(i > -1 ? process.argv[i + 1] : FOUNDRY_DATA);
  const dupes = {};
  for (const w of weapons) (dupes[w.identifier] ??= []).push(w.category);
  const collided = Object.entries(dupes).filter(([, v]) => v.length > 1);
  const file = join(ROOT, "data/weapons.json");
  writeFileSync(file, JSON.stringify({
    generatedFrom: "systems/crucible/packs/{equipment,adversary-equipment}",
    dispatchKey: "system.identifier",
    count: weapons.length,
    weapons
  }, null, 1) + "\n");
  console.log(`${weapons.length} 件武器 → data/weapons.json`);
  const by = k => Object.entries(weapons.reduce((a, w) => (a[w[k]] = (a[w[k]] ?? 0) + 1, a), {}))
    .sort((a, b) => b[1] - a[1]).map(([x, n]) => `${x}:${n}`).join("  ");
  console.log(`  分类 ${new Set(weapons.map(w => w.category)).size} 种 — ${by("category")}`);
  console.log(`  伤害 ${new Set(weapons.map(w => w.damageType)).size} 种 — ${by("damageType")}`);
  console.log(`  natural ${weapons.filter(w => w.properties.includes("natural")).length} 件`);
  if (collided.length) console.log(`  identifier 撞名（不去重）：${collided.map(([k, v]) => `${k}[${v.join(",")}]`).join(" ")}`);
}
