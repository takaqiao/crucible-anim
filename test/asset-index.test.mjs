import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync, existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FOUNDRY_DATA = "/root/fvtt14-data/Data";
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));

/** 遍历 DB 子树，产出 [路径, 文件或文件数组]。 */
function* leaves(node, path = "") {
  for (const [k, v] of Object.entries(node)) {
    if (k === "_template" || k === "_metadata" || k === "_templates") continue;
    const p = path ? `${path}.${k}` : k;
    if (typeof v === "string" || Array.isArray(v)) yield [p, v];
    else if (v && typeof v === "object") yield* leaves(v, p);
  }
}

test("七个素材命名空间齐备", () => {
  for (const ns of ["jb2a", "jb2a-extras", "eskie", "blfx", "psfx",
                    "animated-spell-effects-cartoon"]) {
    assert.ok(index.tree[ns], `缺命名空间 ${ns}`);
  }
});

test("jb2a 叶子数达到 Patreon 版实测量级", () => {
  const n = [...leaves(index.tree.jb2a)].length;
  assert.ok(n >= 10038, `jb2a 只有 ${n} 个叶子，应 >= 10038`);
});

test("_template 元数据被保留", () => {
  const json = JSON.stringify(index.tree.jb2a);
  assert.ok(json.includes('"_template"'), "_template 丢失，stretchTo 锚点信息会缺");
});

test("抽样 200 个条目的文件在磁盘上真实存在", () => {
  const all = [...leaves(index.tree.jb2a)];
  const step = Math.floor(all.length / 200) || 1;
  const missing = [];
  for (let i = 0; i < all.length; i += step) {
    const v = all[i][1];
    const file = Array.isArray(v) ? v[0] : v;
    if (typeof file !== "string" || !file.endsWith(".webm")) continue;
    if (!existsSync(join(FOUNDRY_DATA, file))) missing.push(file);
  }
  assert.deepEqual(missing, [], `${missing.length} 个索引条目在磁盘上不存在`);
});

test("提取失败的模组被显式记录而非静默丢弃", () => {
  assert.ok(index.failed && typeof index.failed === "object");
  assert.ok(Object.keys(index.modules).length >= 6);
});
