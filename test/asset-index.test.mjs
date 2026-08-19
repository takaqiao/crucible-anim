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

test("_template 根表存在且字符串引用能解析到锚点", () => {
  // 叶子上的 _template 只是字符串引用（如 "melee"），真正的锚点数组
  // （授权网格 px、前导 px、拖尾 px）活在命名空间根部的 _templates 查找表里。
  // stretchTo 靠这条「字符串 → 根表」的链路取锚点，链路断了特效会静默贴不准。
  for (const ns of ["jb2a", "eskie", "blfx"]) {
    assert.equal(typeof index.tree[ns]._templates, "object", `${ns} 缺 _templates 根表`);
    assert.ok(index.tree[ns]._templates, `${ns}._templates 为空`);
  }

  assert.deepEqual(index.tree.jb2a._templates.melee, [200, 300, 300],
    "jb2a._templates.melee 锚点数组应为 [授权网格200, 前导300, 拖尾300]");

  // 抽一条真实存在的字符串引用叶子，断言它指向的键确实能在根表里查到（引用不悬空）。
  const leaf = index.tree.jb2a.melee_attack?.["01"]?.shortsword;
  assert.ok(leaf, "预期存在 jb2a.melee_attack.01.shortsword 分支");
  assert.equal(leaf._template, "melee");
  assert.ok(
    Object.prototype.hasOwnProperty.call(index.tree.jb2a._templates, leaf._template),
    `_template 引用 "${leaf._template}" 在根表 jb2a._templates 里查不到，引用悬空`
  );
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

test("extract() 对未安装的模组返回 error 而非抛出或静默通过", async () => {
  const {extract} = await import("../tools/extract-db.mjs");
  const r = await extract("__does_not_exist__");
  assert.equal(r.error, "模组未安装");
});
