import {ClassicLevel} from "classic-level";
import {join} from "node:path";
import {FOUNDRY_DATA} from "./tools/paths.mjs";
const db = new ClassicLevel(join(FOUNDRY_DATA, "systems/crucible/packs/pregens"), {valueEncoding: "json"});
await db.open();
for await (const [k, v] of db.iterator()) {
  if (!k.startsWith("!actors!")) continue;
  console.log("key:", k, "name:", v.name);
  console.log("items[0] 原样:", JSON.stringify(v.items?.[0]));
  console.log("items[1] 原样:", JSON.stringify(v.items?.[1]));
  break;
}
// 嵌入 item 在 leveldb 里是独立的 !actors.items! 键
let seen = 0;
for await (const [k, v] of db.iterator()) {
  if (!k.includes("items")) continue;
  if (k.startsWith("!actors!")) continue;
  if (seen++ > 3) break;
  console.log(`\nkey=${k}`);
  console.log(`  type=${v.type} name=${v.name} _id=${v._id} src=${v._stats?.compendiumSource}`);
}
await db.close();
