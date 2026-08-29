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
  // death 是 Task 15b 新增的一次性槽（击杀爆发）：它由 createActiveEffect 驱动、
  // 不挂在动作时间轴上，所以排在 persist 之后。见 armory/death.mjs 的文件头。
  // persistOff 是批次 E 新增的第七槽（状态摘下那一刻的提示音）：只由 deleteActiveEffect
  // 驱动，与 death 同构但不让路。见 armory/persist-off.mjs 的文件头。
  assert.deepEqual([...C.SLOTS],
                   ["cast", "travel", "impact", "aftermath", "persist", "death", "persistOff"]);
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

/**
 * 面向用户的 `ui.notifications.*` 文案一律走 `game.i18n`，两份语言文件的键集合又由上面
 * 那条用例钉死——三者合起来才是「i18n 补齐」这个交付项的守卫。
 *
 * 光靠人眼很难守住：Task 15 交付时 scripts/player/coverage 同一个文件里 4 处走 i18n、
 * 3 处硬编码中文模板串，全部测试照样全绿。判据取「参数里出现的每一个字符串字面量都必须
 * 是 CANIM. 开头的 i18n 键」——模板串（`${...}`）与任何裸中文/英文文案都会因此落网，
 * 而 `game.i18n.format(key, {...})` 的数据对象里只有标识符、没有字符串字面量。
 */
test("面向用户的 ui.notifications 文案一律走 game.i18n，不得硬编码", () => {
  /** 从 src[open]（"("）开始取到配对的 ")"，跳过字符串内容。 */
  function argText(src, open) {
    let depth = 0;
    for (let i = open; i < src.length; i++) {
      const c = src[i];
      if (c === '"' || c === "'" || c === "`") {
        const q = c; i++;
        while (i < src.length && src[i] !== q) { if (src[i] === "\\") i++; i++; }
        continue;
      }
      if (c === "(") depth++;
      else if (c === ")") { depth--; if (depth === 0) return src.slice(open + 1, i); }
    }
    throw new Error("括号不配对");
  }

  const offenders = [];
  let sites = 0;
  for (const f of walk(join(ROOT, "scripts"))) {
    const src = readFileSync(f, "utf8");
    const re = /ui\.notifications\.(info|warn|error)\(/g;
    for (const m of src.matchAll(re)) {
      // 跳过注释里引用的调用（armory/travel.mjs 里引了一句 Sequencer 的报错）
      const lineStart = src.lastIndexOf("\n", m.index) + 1;
      const line = src.slice(lineStart, m.index);
      if (line.trimStart().startsWith("*") || line.includes("//")) continue;
      sites++;
      const arg = argText(src, m.index + m[0].length - 1);
      const where = `${f}: ui.notifications.${m[1]}(${arg.slice(0, 60)}…`;
      if (!arg.includes("game.i18n.")) { offenders.push(`${where}（没有走 game.i18n）`); continue; }
      for (const lit of arg.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|`([^`\\]*(?:\\.[^`\\]*)*)`/g)) {
        const body = lit[1] ?? lit[2] ?? lit[3] ?? "";
        if (!body.startsWith("CANIM.")) offenders.push(`${where}（字面量 ${JSON.stringify(body)} 不是 i18n 键）`);
      }
    }
  }
  assert.ok(sites >= 8, `扫到的 ui.notifications 调用点只有 ${sites} 个，扫描逻辑可能失效了`);
  assert.deepEqual(offenders, [], offenders.join("\n"));
});

/**
 * **兵库用到的每个素材命名空间，都必须在 `module.json` 里声明成依赖。**
 *
 * ## 它堵的是哪个洞
 *
 * 缺包时素材路径 resolve 返回 null，cue **静默消失**——不报错、不降级、不留 warn。
 * 玩家侧的表现是「这个动作怎么没声音/没画面了」，而离线测试**全绿**（离线后端读的是
 * 本机索引，本机装着包，所以永远看不出来）。
 *
 * 2026-08-30 批次 E 实测到了这个洞的代价：新接进来的 `ggg-sfx` 供着
 * **311 / 873 条音效 cue（36%）、289 个动作**，而 `relationships.requires` 里没有它，
 * **618 条测试全绿**。批次 E 的全部卖点都在那 36% 里，没装 ggg 的用户一声都听不到。
 *
 * ## 判据
 *
 * 从兵库源码里抓出实际引用的命名空间，经 `data/asset-index.json` 的 `modules` 表
 * 反查模块 id，逐个要求出现在 `requires` 里。**索引是唯一事实来源**，不在这里手写
 * 「命名空间 → 模块」的对照表——那种表会跟着素材包升级悄悄过期。
 */
test("兵库引用的每个素材命名空间都在 module.json 里声明了依赖", () => {
  const mj = JSON.parse(readFileSync(join(ROOT, "module.json"), "utf8"));
  const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
  const declared = new Set(mj.relationships.requires.map(r => r.id));

  /**
   * 命名空间 → 提供它的模块 id，**从该命名空间底下任意一个真实文件路径反查**
   * （文件路径形如 `modules/<模块id>/…`，那是事实来源）。
   *
   * ⚠ **不能用 `index.modules`**：那张表以**模块 id 为键**，而一个模块可以注册**多个**
   * 命名空间——`ggg` 同时注册了 `ggg-sfx`（3400 条音效）与 `ggg-vfx`（49 条画面），
   * 表里只留得下后写入的那个，**`ggg-sfx` 整个丢失**。初版守卫正是因此对
   * 「兵库 311 条 cue 依赖 ggg 却没声明」完全失明——把 ggg 从 requires 里删掉它照样全绿。
   */
  const providerOf = new Map();
  for (const [nsName, root] of Object.entries(index.tree ?? {})) {
    let file = null;
    (function firstFile(n) {
      if (file) return;
      if (typeof n === "string") { file = n; return; }
      if (Array.isArray(n)) { n.forEach(firstFile); return; }
      if (n && typeof n === "object") {
        for (const [k, v] of Object.entries(n)) { if (!k.startsWith("_")) firstFile(v); }
      }
    })(root);
    const m = /^modules\/([^/]+)\//.exec(file ?? "");
    if (m) providerOf.set(nsName, m[1]);
  }

  /**
   * `canim` 是本模组**自己**注册的（`scripts/register-sfx.mjs` 把 `data/sfx-index.json`
   * 塞进 Sequencer），它底下的文件是 `assets/MGS/…` 这种**世界 assets 目录下的裸目录**，
   * 不是模块——`module.json` 结构上挂不住它。这是既有的分发问题（素材得随世界一起走），
   * 与本条守卫无关，显式排除并留档。
   */
  const NOT_A_MODULE = new Set(["canim"]);

  // ⚠ **必须先剥注释**：本仓库的注释里大量拿 DB 路径举例（`assets.mjs:294` 就引用
  // "jb2a-extras.magic_signs…" 说明前缀匹配的坑）。不剥的话注释里的举例会被当成真引用
  // ——初版正是这么误报了 jb2a-extras。剥法与 tools/gen-sound-table.mjs 的 stripComments 同式。
  const stripComments = s => s
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  const src = walk(join(ROOT, "scripts"))
    .map(f => stripComments(readFileSync(f, "utf8"))).join("\n");
  const ns = [...providerOf.keys()].filter(n => !NOT_A_MODULE.has(n));
  // 三种引号都要认：`armory-assets.test.mjs` 记过一次「三条守卫对反引号路径完全失明」。
  // 命名空间名里的 `-` / `.` 要转义成字面量，否则 `.` 会变成「任意字符」。
  const esc = s => s.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
  const used = ns.filter(n => new RegExp("[\"'`]" + esc(n) + "\\.").test(src));

  assert.ok(used.length >= 4,
    `只在兵库里认出 ${used.length} 个命名空间（${used}），正则或源码路径变了，这条守卫已经失明`);

  const missing = used.filter(n => !declared.has(providerOf.get(n)))
    .map(n => `${n} → 需要声明模块 "${providerOf.get(n)}"`);
  assert.deepEqual(missing, [],
    `${missing.length} 个命名空间被兵库引用却没在 module.json 的 requires 里声明。`
    + "缺包时 cue 会**静默消失**（不报错、不降级），而离线测试因为本机装着包永远发现不了。");
});
