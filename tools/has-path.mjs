/**
 * 校验一条 DB 路径是否真的存在于 data/asset-index.json 的树里。
 * 用法：node tools/has-path.mjs jb2a.rapier.melee.01.white [更多路径...]
 * 输出：每行一条，四种形态
 *   OK   … — 叶子，1 个文件：<路径>          （树里存的是**字符串**：单文件叶子）
 *   OK   … — 叶子，N 个文件：<前 3 条>       （树里存的是数组：多文件叶子）
 *   OK   … — 分支，N 个子节点：<前 40 个>
 *   MISS … — 断在 "<段>"（已走通 …；该处可选：…）
 */
import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const index = JSON.parse(fs.readFileSync(path.join(here, "..", "data", "asset-index.json"), "utf8"));

function look(dbPath) {
  const segs = dbPath.split(".");
  let node = index.tree;
  const walked = [];
  for (const s of segs) {
    if (node && typeof node === "object" && !Array.isArray(node) && s in node) {
      node = node[s];
      walked.push(s);
    } else {
      const opts = node && typeof node === "object" && !Array.isArray(node)
        ? Object.keys(node).filter(k => !k.startsWith("_")).slice(0, 40).join(" ")
        : "(叶子，不能再往下)";
      return `MISS ${dbPath} — 断在 "${s}"（已走通 ${walked.join(".") || "(根)"}；该处可选：${opts}）`;
    }
  }
  // ⚠ 字符串叶子必须先判，否则下面的 Object.keys 会把字符串按下标拆开，
  // 报成「分支，N 个子节点：0 1 2 3 …」（N = 路径的字符数）。
  // 实测（本文件同一份 asset-index.json 逐节点枚举）：字符串叶子 21695、数组叶子 1417、
  // 分支 10198。字符串叶子占全部叶子 21695/23112 = 93.9%、占全部节点 65.1%。
  // 纪律 2 指定用这个工具做枚举，它却对九成叶子谎报形态——本轮多路审计都被误导过。
  if (typeof node === "string") return `OK ${dbPath} — 叶子，1 个文件：${node}`;
  if (Array.isArray(node)) return `OK ${dbPath} — 叶子，${node.length} 个文件：${node.slice(0, 3).join(" ")}`;
  const kids = Object.keys(node).filter(k => !k.startsWith("_"));
  return `OK ${dbPath} — 分支，${kids.length} 个子节点：${kids.slice(0, 40).join(" ")}`;
}

const args = process.argv.slice(2);
if (!args.length) { console.error("给我至少一条路径"); process.exit(2); }
for (const a of args) console.log(look(a));
