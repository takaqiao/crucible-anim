import {ClassicLevel} from "classic-level";
import {join} from "node:path";
import {FOUNDRY_DATA} from "./tools/paths.mjs";
const db = new ClassicLevel(join(FOUNDRY_DATA, "systems/crucible/packs/pregens"), {valueEncoding: "json"});
await db.open();
let n = 0;
for await (const [k, v] of db.iterator()) {
  if (!k.startsWith("!actors!")) continue;
  if (n++ > 0) break;
  console.log("角色:", v.name, "type:", v.type);
  console.log("items 条数:", (v.items ?? []).length);
  const types = {};
  for (const it of v.items ?? []) types[it.type] = (types[it.type] ?? 0) + 1;
  console.log("items 类型分布:", types);
  const w = (v.items ?? []).find(i => i.type === "weapon");
  console.log("找到武器?", !!w);
  console.log("system.equipment:", JSON.stringify(v.system?.equipment ?? null).slice(0, 400));
  const sample = (v.items ?? []).slice(0,3).map(i => ({id: i._id, type: i.type, name: i.name, src: i._stats?.compendiumSource}));
  console.log("前 3 个 item:", JSON.stringify(sample, null, 1));
}
await db.close();
