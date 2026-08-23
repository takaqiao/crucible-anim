import {ClassicLevel} from "classic-level";
import {join} from "node:path";
import {FOUNDRY_DATA} from "./tools/paths.mjs";
const base = join(FOUNDRY_DATA, "systems/crucible/packs");
for (const pack of ["adversary-equipment", "pregens", "summons"]) {
  const db = new ClassicLevel(join(base, pack), {valueEncoding: "json"});
  await db.open();
  let weapons = 0, actors = 0; const embedded = [];
  for await (const [k, v] of db.iterator()) {
    if (k.startsWith("!items!") && v?.type === "weapon") { weapons++; if (embedded.length<4) embedded.push(["pack-item", v._id, v.name, v._stats?.compendiumSource]); }
    if (k.startsWith("!actors!")) {
      actors++;
      for (const it of (v.items ?? [])) if (it.type === "weapon" && embedded.length < 14)
        embedded.push(["actor:"+v.name, it._id, it.name, it._stats?.compendiumSource]);
    }
  }
  await db.close();
  console.log(`\n### ${pack}: 独立武器 ${weapons} 件，角色 ${actors} 个`);
  for (const [src, id, name, cs] of embedded)
    console.log(`  ${src.slice(0,22).padEnd(23)} ${String(id).padEnd(18)} ${String(name).padEnd(20)} src=${cs ?? "null"}`);
}
