import {ClassicLevel} from "classic-level";
import {join} from "node:path";
import {FOUNDRY_DATA} from "./tools/paths.mjs";
const base = join(FOUNDRY_DATA, "systems/crucible/packs");
const all = [];
for (const pack of ["equipment", "adversary-equipment"]) {
  const db = new ClassicLevel(join(base, pack), {valueEncoding: "json"});
  await db.open();
  for await (const [k, v] of db.iterator())
    if (k.startsWith("!items!") && v?.type === "weapon") all.push({pack, ...v});
  await db.close();
}
console.log("武器总数:", all.length);
const cat = {}, dmg = {}, props = {};
for (const w of all) {
  cat[w.system.category] = (cat[w.system.category] ?? 0) + 1;
  dmg[w.system.damageType] = (dmg[w.system.damageType] ?? 0) + 1;
  for (const p of (w.system.properties ?? [])) props[p] = (props[p] ?? 0) + 1;
}
console.log("\n分类分布:", JSON.stringify(cat, null, 0));
console.log("\n伤害类型分布:", JSON.stringify(dmg, null, 0));
console.log("\nproperties 分布:", JSON.stringify(props, null, 0));
console.log("\n=== 全部 92 件 ===");
for (const w of all.sort((a,b)=> (a.system.category+a.system.identifier).localeCompare(b.system.category+b.system.identifier)))
  console.log(`  ${w.system.category.padEnd(13)} ${String(w.system.identifier).padEnd(20)} ${String(w.system.damageType).padEnd(13)} ${(w.system.properties??[]).join("/")}`);
