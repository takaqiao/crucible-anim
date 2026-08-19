import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync, existsSync, readdirSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 递归遍历目录，返回所有 .mjs 文件的完整路径。
 * 目录不存在或为空时返回空数组。
 */
function walk(dir) {
  let out = [];
  let entries;
  try { entries = readdirSync(dir, {withFileTypes: true}); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith(".mjs")) out.push(p);
  }
  return out;
}

test("module.json 字段完整且与常量一致", async () => {
  const mj = JSON.parse(readFileSync(join(ROOT, "module.json"), "utf8"));
  const {MODULE_ID} = await import("../scripts/const.mjs");
  assert.equal(mj.id, MODULE_ID);
  assert.equal(mj.compatibility.minimum, "14");
  assert.equal(mj.compatibility.verified, "14.366");
  assert.deepEqual(mj.esmodules, ["scripts/main.mjs"]);
  const reqIds = mj.relationships.requires.map(r => r.id);
  assert.ok(reqIds.includes("sequencer"), "必须声明 sequencer 依赖");
  assert.equal(mj.relationships.systems[0].id, "crucible");
});

test("清单引用的每个文件都存在", () => {
  const mj = JSON.parse(readFileSync(join(ROOT, "module.json"), "utf8"));
  for (const f of [...mj.esmodules, ...mj.languages.map(l => l.path)]) {
    assert.ok(existsSync(join(ROOT, f)), `缺文件 ${f}`);
  }
});

test("两份语言文件键集合完全一致", () => {
  const flat = (o, p = "") => Object.entries(o).flatMap(([k, v]) =>
    v && typeof v === "object" ? flat(v, `${p}${k}.`) : [`${p}${k}`]);
  const en = flat(JSON.parse(readFileSync(join(ROOT, "lang/en.json"), "utf8")));
  const zh = flat(JSON.parse(readFileSync(join(ROOT, "lang/zh-CN.json"), "utf8")));
  assert.deepEqual(en.sort(), zh.sort());
});

test("常量自洽", async () => {
  const C = await import("../scripts/const.mjs");
  assert.deepEqual([...C.SLOTS], ["cast", "travel", "impact", "aftermath", "persist"]);
  assert.equal(C.RESULT.HIT, 7);
  assert.equal(C.RESULT.MISS, 0);
  assert.equal(Object.keys(C.RESULT).length, 8);
  assert.equal(C.META_KEY, "cav");
});

test("resolver 与 armory 不得引用 Foundry 全局", async () => {
  const files = [
    ...walk(join(ROOT, "scripts/resolver")),
    ...walk(join(ROOT, "scripts/armory"))
  ];
  const banned = /\b(game|canvas|Hooks|Sequencer|ui|CONFIG)\s*\./;
  for (const f of files) {
    const src = readFileSync(f, "utf8")
      .split("\n").filter(l => !l.trimStart().startsWith("//")).join("\n");
    assert.ok(!banned.test(src), `${f} 引用了 Foundry 全局`);
  }
});
