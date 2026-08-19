import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, bestFit, createAssets} from "../scripts/resolver/assets.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const backend = offlineBackend(index);

test("精确路径直接命中，不降级", () => {
  const r = bestFit(backend, "jb2a.melee_attack.01.shortsword");
  assert.equal(r.path, "jb2a.melee_attack.01.shortsword");
  assert.equal(r.diverged, false);
});

test("不存在的分支降级到同级第一个可用项并记录位置", () => {
  const r = bestFit(backend, "jb2a.melee_attack.01.没有这种武器");
  assert.equal(r.diverged, true);
  assert.equal(r.divergedAt, "jb2a.melee_attack.01");
  assert.ok(r.path.startsWith("jb2a.melee_attack.01."));
  assert.ok(r.options.length > 0, "应报告降级处的可选项");
});

test("resolve 返回真实文件路径", () => {
  const a = createAssets(backend);
  const r = a.resolve("jb2a.melee_attack.01.shortsword");
  assert.ok(r, "应解析出结果");
  assert.ok(r.file.endsWith(".webm"), `不是 webm: ${r.file}`);
  assert.ok(Array.isArray(r.files) && r.files.length >= 1);
});

test("_template 元数据随解析结果一并返回", () => {
  const a = createAssets(backend);
  const r = a.resolve("jb2a.melee_attack.01.shortsword");
  assert.ok(Array.isArray(r.template), "melee 分支应带 _template 三元组");
  assert.equal(r.template.length, 3);
});

test("含斜杠的输入按直接文件路径原样返回", () => {
  const a = createAssets(backend);
  const p = "modules/jb2a_patreon/Library/Generic/Impact/Foo.webm";
  const r = a.resolve(p);
  assert.equal(r.file, p);
  assert.equal(r.diverged, false);
});

test("colorsUnder 列出某特效实际可用的颜色", () => {
  const a = createAssets(backend);
  const colors = a.colorsUnder("jb2a.melee_attack.01.magic_sword");
  assert.ok(colors.includes("blue"), `实际颜色: ${colors.join(",")}`);
  assert.ok(colors.includes("orange"));
});

test("降级会累积进 warnings", () => {
  const a = createAssets(backend);
  a.resolve("jb2a.melee_attack.01.没有这种武器");
  assert.equal(a.warnings.length, 1);
  assert.equal(a.warnings[0].at, "jb2a.melee_attack.01");
});

test("解析不出任何东西时返回 null 而不抛错", () => {
  const a = createAssets(backend);
  assert.equal(a.resolve("完全不存在的命名空间.foo"), null);
});
