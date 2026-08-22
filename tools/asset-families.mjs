/**
 * 族级选材记录的解析器。
 *
 * 记录本身写在 `docs/ASSET-NOTES.md` 的「族级选材」表里——与主表、否决清单同一份文档，
 * 因为它们说的是同一件事（这条素材有没有依据），分开放迟早会漂移。
 *
 * 抽成普通模块而不是留在测试里，是因为两个测试文件都要用：
 * `test/asset-families.test.mjs` 验记录本身，`test/armory-assets.test.mjs` 用它做第二条举证通路。
 * 从 `.test.mjs` 里 import 会让被引文件的用例在引用方的那一轮里**重复注册**。
 */
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 解析族表：定位 `| 族前缀 |` 表头后连续的表格行。 */
export function familyRows(md = readFileSync(join(ROOT, "docs/ASSET-NOTES.md"), "utf8")) {
  const lines = md.split(/\r?\n/);
  const head = lines.findIndex(l => l.startsWith("| 族前缀 |"));
  if (head < 0) return [];
  const out = [];
  for (let i = head + 1; i < lines.length; i++) {
    if (!lines[i].startsWith("|")) break;
    if (/^\|\s*-{3,}\s*\|/.test(lines[i])) continue;
    const cols = lines[i].split("|").slice(1, -1).map(c => c.trim());
    if (cols.length < 4) continue;
    out.push({
      prefix: cols[0].replace(/`/g, ""),
      count: Number(cols[1].replace(/[^\d]/g, "")),
      axes: cols[2],
      samples: cols[3].split(/[,，]/).map(s => s.trim().replace(/`/g, "")).filter(Boolean),
      note: cols[4] ?? ""
    });
  }
  return out;
}

/** 收集某个 DB 前缀底下的全部文件路径；前缀不存在返回 null（与「族是空的」区分开）。 */
export function filesUnder(prefix, index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"))) {
  let node = index.tree;
  for (const p of prefix.split(".")) {
    if (!node || typeof node !== "object" || Array.isArray(node)) return null;
    node = node[p];
  }
  if (node === undefined) return null;
  const out = new Set();
  const walk = n => {
    if (typeof n === "string") { out.add(n); return; }
    if (Array.isArray(n)) { n.forEach(walk); return; }
    if (n && typeof n === "object") for (const [k, v] of Object.entries(n)) { if (!k.startsWith("_")) walk(v); }
  };
  walk(node);
  return [...out];
}
