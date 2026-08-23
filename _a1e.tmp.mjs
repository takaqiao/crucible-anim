import {ClassicLevel} from "classic-level";
import {join} from "node:path";
import {FOUNDRY_DATA} from "./tools/paths.mjs";
const base = join(FOUNDRY_DATA, "systems/crucible/packs");
console.log("=== 官方 equipment pack 里的武器 ===");
let db = new ClassicLevel(join(base,"equipment"), {valueEncoding:"json"}); await db.open();
const packW = [];
for await (const [k,v] of db.iterator()) if (k.startsWith("!items!") && v?.type==="weapon") packW.push(v);
await db.close();
for (const w of packW.slice(0,6))
  console.log(`  ${w._id.padEnd(18)} ident=${JSON.stringify(w.system?.identifier).padEnd(18)} img=${w.img}`);
console.log(`  identifier 非空的: ${packW.filter(w=>w.system?.identifier).length}/${packW.length}`);

console.log("\n=== 角色身上的武器 ===");
for (const pack of ["pregens","summons"]) {
  db = new ClassicLevel(join(base,pack), {valueEncoding:"json"}); await db.open();
  const rows = [];
  for await (const [k,v] of db.iterator()) {
    if (!k.startsWith("!actors.items!") || v?.type !== "weapon") continue;
    rows.push(v);
  }
  await db.close();
  console.log(`--- ${pack}: ${rows.length} 件`);
  for (const w of rows.slice(0,8))
    console.log(`  _id=${w._id.padEnd(18)} ident=${JSON.stringify(w.system?.identifier).padEnd(16)} name=${String(w.name).padEnd(16)} img=${w.img}`);
  console.log(`  identifier 非空: ${rows.filter(w=>w.system?.identifier).length}/${rows.length}`,
              ` img 非空: ${rows.filter(w=>w.img).length}/${rows.length}`);
}
