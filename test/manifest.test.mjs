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

  const sequencer = mj.relationships.requires.find(r => r.id === "sequencer");
  assert.ok(sequencer, "必须声明 sequencer 依赖");
  assert.equal(sequencer.compatibility.minimum, "4.2", "sequencer 最低版本必须是 4.2");

  const crucible = mj.relationships.systems.find(s => s.id === "crucible");
  assert.ok(crucible, "必须声明 crucible 系统依赖");
  assert.equal(crucible.compatibility.minimum, "0.10.2", "crucible 最低版本必须是 0.10.2");
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
  assert.deepEqual(C.RESULT, {
    MISS: 0, DODGE: 1, PARRY: 2, BLOCK: 3, ARMOR: 4, RESIST: 5, GLANCE: 6, HIT: 7
  });
  assert.equal(C.PLAN_VERSION, 1);
  assert.equal(C.META_KEY, "cav");
});

test("resolver 与 armory 不得引用 Foundry 全局或 Math.random", async () => {
  const files = [
    ...walk(join(ROOT, "scripts/resolver")),
    ...walk(join(ROOT, "scripts/armory"))
  ];
  // 随机性必须经 ctx.rng()（mulberry32，seed 确定）：Math.random 会让同 seed 的两次
  // resolve() 结果不同，多客户端画面不同步，且测试不可复现——这是最难靠人工发现的一类回归。
  //
  // 第一个分支用 (?<![\w.]) 取代 \b：\b 只看「是不是标识符边界」，不看边界前到底是
  // 字母还是点号，于是 DB 路径字面量里的 "jb2a.ui.miss.white" 会在 "ui" 前的那个
  // `.` 处被误判成 `ui.` 全局引用（`.` 是非单词字符，"ui" 是单词字符，\b 照样成立）。
  // 真正引用 Foundry 全局时，这几个标识符前面绝不会是字母/数字/下划线或点号（要么是
  // 语句开头，要么前面是空格/括号/等号之类），所以要求「前一个字符不是单词字符也不是
  // 点号」才收紧到刚好排除「作为某个路径的一段被点出来」这一种情况，不影响真正的全局
  // 引用照样被抓——见 test/armory-assets.test.mjs 里 "const x = ui.notifications" /
  // "const y = game.actors" 两个红例。Math.random 那半段不受影响，原样保留。
  const banned = /(?<![\w.])(game|canvas|Hooks|Sequencer|ui|CONFIG)\s*\.|Math\.random\s*\(/;

  // 剥离注释的辅助函数
  function stripComments(src) {
    // 第一步：去掉块注释 /* ... */（包括跨行）
    let stripped = src.replace(/\/\*[\s\S]*?\*\//g, "");

    // 第二步：去掉行尾注释 //，但过滤掉标记为 foundry-global-ok 的整行
    stripped = stripped
      .split("\n")
      .filter(line => !line.includes("// foundry-global-ok"))
      .map(line => {
        const commentIdx = line.indexOf("//");
        if (commentIdx !== -1) return line.substring(0, commentIdx);
        return line;
      })
      .join("\n");

    return stripped;
  }

  for (const f of files) {
    const src = readFileSync(f, "utf8");
    const stripped = stripComments(src);
    assert.ok(!banned.test(stripped), `${f} 引用了 Foundry 全局或 Math.random`);
  }
});
