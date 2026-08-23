import {ClassicLevel} from "classic-level";
import {join} from "node:path";
import {FOUNDRY_DATA} from "./tools/paths.mjs";
const p = join(FOUNDRY_DATA, "systems/crucible/packs/equipment");
const db = new ClassicLevel(p, {valueEncoding: "json"});
await db.open();
const ws = [];
for await (const [k, v] of db.iterator()) {
  if (!k.startsWith("!items!")) continue;
  if (v?.type !== "weapon") continue;
  ws.push(v);
}
await db.close();
console.log("武器件数:", ws.length);
const w = ws[0];
console.log("\n=== 一件武器的顶层字段 ===");
console.log(Object.keys(w).join(", "));
console.log("\n=== system 字段 ===");
console.log(Object.keys(w.system ?? {}).join(", "));
console.log("\n=== _stats ===");
console.log(JSON.stringify(w._stats));
console.log("\n=== 前 12 件的 (id, name, category, damageType) ===");
for (const x of ws.slice(0, 12))
  console.log(`  ${String(x._id).padEnd(18)} ${String(x.name).padEnd(22)} ${String(x.system?.category).padEnd(14)} ${x.system?.damageType}`);
console.log("\n=== _id 是不是语义 slug ===");
const semantic = ws.filter(x => /^[a-z]/i.test(x._id) && !/^[a-zA-Z0-9]{16}$/.test(x._id.replace(/0+$/,"")+"x".repeat(0)));
console.log("总数", ws.length, "；_id 全 16 位:", ws.every(x => x._id.length === 16));
console.log("补零型（尾部一串 0）:", ws.filter(x => /0{3,}$/.test(x._id)).length);
