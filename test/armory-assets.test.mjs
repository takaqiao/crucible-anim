/**
 * 「兵库 → ASSET-NOTES」结构性守卫。
 *
 * test/asset-notes.test.mjs 只查「表 → 索引」（表里的路径能不能在 data/asset-index.json
 * 里无降级解析）。那条测试完全不知道 scripts/armory/** 里实际用了哪些路径——所以兵库
 * 规则引用一条主表里没有、甚至是文末「被否掉的候选」明确否掉的路径，degradation-rate/
 * coverage 之类的断言照样全绿（bestFit 总能兜住、resolve() 总能返回点什么），这个坑
 * 正是 Task 9 review 抓到 `jb2a.cast_generic.03`（否决清单第一条）被当成 cast 槽兜底
 * 规则用了一整个任务的方式。
 *
 * 这里反过来查「兵库 → 表」：扫描 scripts/armory/**\/*.mjs 里所有看起来像 DB 路径的
 * 字符串字面量，逐条判定合法当且仅当：
 *   (a) 精确命中主表的某一行，**或者**是主表某一行的父路径（规则传 {color} 时代码里
 *       写的正是不含颜色段的父路径，ctx.pick 会在运行时拼上 pickColor 选中的颜色分支）；
 *   且
 *   (b) 不在文末「被否掉的候选」清单里（含它自己的任何颜色叶子、也不能是某个否决条目
 *       的父路径或子路径——例如否掉的是 `a.b.c.red`，规则写 `a.b.c` 传 {color:"red"}
 *       同样该被拦下）。
 *
 * 扫描整个 armory 目录而不只是 cast.mjs，这样 Task 10/11/12 往 travel/impact/aftermath/
 * persist 里新增规则时，同一类「记录里查得到但选错了」的错误会被立刻拦住。
 *
 * 【本轮修复】早先版本只匹配 `ctx.pick("...")`/`ctx.sound("...")` 里直接写的字面量
 * 参数，对「路径先进表对象、再以变量传给 ctx.pick()」这种写法（impact.mjs 的
 * RESULT_LAYER/ELEMENT_LAYER、travel.mjs strike.melee 的 `branch` 三元表达式）完全
 * 视而不见——实测 impact.mjs 18 条路径只看得到 1 条，travel.mjs 10 条只看得到 8 条。
 * 现在改成扫描剥离注释后的整份源码，抓取所有匹配已知命名空间前缀（jb2a/jb2a-extras/
 * eskie/blfx/psfx/animated-spell-effects-cartoon）的完整字符串字面量，不再关心它是不是
 * 直接躺在 ctx.pick() 的括号里。字符类里特意带上连字符 `-`：psfx 命名空间下 17 条主表
 * 路径本身就含连字符（如 `psfx.ranged-weapons.longbow.v1.30ft`），漏掉连字符会把这些
 * 合法路径从字面量中间截断，反而制造新的假阳性。
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const md = readFileSync(join(ROOT, "docs/ASSET-NOTES.md"), "utf8");

/** 主表：定位 `| DB 路径 |` 表头后连续的表格行，取第一列去掉反引号。与 asset-notes.test.mjs 同法。 */
function tablePaths() {
  const lines = md.split("\n");
  const head = lines.findIndex(l => l.startsWith("| DB 路径 |"));
  assert.ok(head >= 0, "找不到主表表头行（| DB 路径 | …）");
  const block = [];
  for (let i = head + 1; i < lines.length; i++) {
    if (!lines[i].startsWith("|")) break;
    block.push(lines[i]);
  }
  return block
    .filter(l => !/^\|\s*-{3,}\s*\|/.test(l))
    .map(r => r.split("|")[1].trim().replace(/`/g, ""));
}

/** 否决清单：文末「被否掉的候选」小节里 `- **`path`** — ...` 形式的条目。 */
function rejectedPaths() {
  const re = /^- \*\*`([^`]+)`\*\*/gm;
  const out = [];
  let m;
  while ((m = re.exec(md))) out.push(m[1]);
  return out;
}

/** scripts/armory/ 下所有 .mjs 文件（当前是平铺目录，未来若分子目录也能扫到）。 */
function armoryFiles() {
  const dir = join(ROOT, "scripts/armory");
  return readdirSync(dir, {withFileTypes: true})
    .filter(e => e.isFile() && e.name.endsWith(".mjs"))
    .map(e => join(dir, e.name));
}

/** 已知的素材命名空间前缀，来自 ASSET-NOTES 与 data/asset-index.json 的 modules 清单。 */
const DB_PREFIXES = ["jb2a-extras", "jb2a", "eskie", "blfx", "psfx", "animated-spell-effects-cartoon"];
const DB_PREFIX_ALT = DB_PREFIXES.join("|");

/**
 * 剥离注释，与 test/manifest.test.mjs 的 stripComments 同法：先去块注释 /* … *\/，
 * 再去行尾 //。兵库源码里大量在注释里引用路径做说明（例如「改用 `xxx`」「原来的
 * "xxx" 条目已删除」），不剥掉会把纯文档性质的提及也当成「代码里用到的路径」，
 * 既误报又会污染下面的覆盖率自查。
 */
function stripComments(src) {
  let stripped = src.replace(/\/\*[\s\S]*?\*\//g, "");
  stripped = stripped
    .split("\n")
    .map(line => {
      const i = line.indexOf("//");
      return i === -1 ? line : line.substring(0, i);
    })
    .join("\n");
  return stripped;
}

/**
 * 扫描一个文件（源码，未剥注释）里所有看起来像 DB 路径的字符串字面量——不再限定
 * 必须是 ctx.pick()/ctx.sound() 的直接参数，表对象里的 `path: "jb2a.xxx"` 同样会
 * 被抓到。判定标准：引号内整体匹配「已知前缀 + 点 + 路径字符」，字符类含 `-`（psfx
 * 命名空间里的合法路径需要它，见文件头注释）。先剥注释，避免把注释里提到的路径
 * 误当成代码引用。
 */
function pickedPaths(src) {
  const stripped = stripComments(src);
  const re = new RegExp(`["']((?:${DB_PREFIX_ALT})\\.[a-zA-Z0-9_.-]+)["']`, "g");
  const out = [];
  let m;
  while ((m = re.exec(stripped))) out.push(m[1]);
  return out;
}

/**
 * 独立的第二套抽取算法，只用于下面的「覆盖率自查」断言，刻意不复用 pickedPaths()
 * 的实现：先用一个不关心内容、只认引号与转义的通用字符串字面量正则切出剥注释后
 * 源码里**所有**引号字符串，再对每一条单独判定「首个 `.` 之前的那一段是不是已知
 * 前缀」。如果 pickedPaths() 的字符类将来又被谁改窄（比如像本轮修复前那样漏掉
 * `-`），这里会照样切出完整字面量、独立判定出它「看起来像」DB 路径，两边条数就会
 * 对不上，自查断言变红——这正是它区别于「拿同一个正则再跑一遍」的地方。
 */
function allQuotedLiterals(stripped) {
  const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g;
  const out = [];
  let m;
  while ((m = re.exec(stripped))) out.push(m[1] ?? m[2]);
  return out;
}
function looksLikeDbPath(literal) {
  if (!literal.includes(".")) return false;
  const head = literal.slice(0, literal.indexOf("."));
  if (!DB_PREFIXES.includes(head)) return false;
  return /^[a-zA-Z0-9_.-]+$/.test(literal);
}

/**
 * 已知的历史欠账：travel/impact/aftermath/persist 四个槽各自唯一的 pri:10 兜底规则，
 * 写于 ASSET-NOTES 存在之前（与本轮修掉的 jb2a.cast_generic.03 同源问题），分属
 * Task 10/11/12 尚未开始的迁移范围，不在本轮 Task 9 修复范围内。这里显式白名单，
 * 避免把不属于本轮的技术债务当成本轮的回归——但白名单只覆盖这些已知路径，
 * 这几个文件里任何其它新路径仍会被下面的判定正常拦截。
 *
 * 这是一个只能变小、不能变大的逃生舱，靠下面两条测试钉死：
 *   1. 「不许新增」——条目数与内容都锁死成当前已知的这几条，想加新条目测试立刻红。
 *   2. 「自动失效」——每条都必须仍被某个兵库文件实际引用；一旦 Task 10/11/12 把某条
 *      路径迁移到 ASSET-NOTES 认可的路径，白名单里那一条就成了无人引用的僵尸条目，
 *      测试会红，强制它被删掉。白名单因此会自我清算，不需要谁记得回来打扫。
 *
 * Task 11 把 impact.mjs 的 generic.impact 迁到了 jb2a.impact.005.white（ASSET-NOTES
 * 已验证条目），原来的 "jb2a.impact.004" 条目已从这里删除——见下一条「自动失效」测试。
 *
 * Task 12 把 aftermath.mjs 的 generic.aftermath 改成恒返回 null（不再引用任何路径）、
 * persist.mjs 的 generic.persist 迁到了 jb2a.extras.tmfx.inflow.circle.01（ASSET-NOTES
 * 已验证条目），原来的 "jb2a.healing_generic.burst" 与
 * "jb2a.extras.tmfx.outflow.circle.01" 两条已从这里删除——四个兵库任务至此清空。
 */
const LEGACY_UNVERIFIED = new Set([]);

/** 全部兵库文件里出现过的路径字面量（不去重来源文件，只关心「有没有人引用」）。 */
function allPickedPaths() {
  const out = new Set();
  for (const file of armoryFiles()) {
    for (const p of pickedPaths(readFileSync(file, "utf8"))) out.add(p);
  }
  return out;
}

test("兵库规则引用的每条 DB 路径都能在 ASSET-NOTES 主表里查到依据，且不在否决清单里", () => {
  const tbl = tablePaths();
  const rej = rejectedPaths();
  assert.ok(tbl.length >= 90, `主表行数异常：${tbl.length}`);
  assert.ok(rej.length >= 40, `否决清单条目数异常：${rej.length}`);

  const bad = [];
  for (const file of armoryFiles()) {
    const src = readFileSync(file, "utf8");
    for (const p of pickedPaths(src)) {
      if (LEGACY_UNVERIFIED.has(p)) continue;

      const exact = tbl.includes(p);
      const asPrefix = tbl.some(t => t.startsWith(p + "."));
      const rejected = rej.some(r => r === p || r.startsWith(p + ".") || p.startsWith(r + "."));

      if (!((exact || asPrefix) && !rejected)) {
        const reason = rejected ? "在否决清单里" : "主表里查不到依据（既非精确命中也非某行的父路径）";
        bad.push(`${file}: "${p}" — ${reason}`);
      }
    }
  }
  assert.deepEqual(bad, [], `${bad.length} 条兵库路径没有 ASSET-NOTES 依据或已被否决：\n${bad.join("\n")}`);
});

test("LEGACY_UNVERIFIED 白名单不许新增：四个兵库任务后应已清空", () => {
  // Task 10 把 travel.mjs 的 generic.travel 迁到了 ASSET-NOTES 认可的路径，原来的
  // "jb2a.magic_missile" 条目已从这里删除；Task 11 把 impact.mjs 的 generic.impact
  // 迁到了 jb2a.impact.005.white，原来的 "jb2a.impact.004" 条目同样已删除；Task 12
  // 把 aftermath.mjs / persist.mjs 的最后两条也迁完——均见下一条「自动失效」测试。
  assert.equal(LEGACY_UNVERIFIED.size, 0,
    `LEGACY_UNVERIFIED 有 ${LEGACY_UNVERIFIED.size} 条，应已在四个兵库任务后清空——新增白名单项需要走评审，不能随手加`);
});

test("LEGACY_UNVERIFIED 白名单里每一条都仍被某个兵库文件实际引用（否则应删除）", () => {
  const referenced = allPickedPaths();
  const zombies = [...LEGACY_UNVERIFIED].filter(p => !referenced.has(p));
  assert.deepEqual(zombies, [],
    zombies.map(p => `白名单条目 "${p}" 已无人引用，说明对应任务已完成迁移，请从 LEGACY_UNVERIFIED 中删除`).join("\n"));
});

test("覆盖率自查：pickedPaths() 抓到的路径数必须等于文件里独立统计出的 DB 路径字面量数", () => {
  // 这条测试本身就是「缺陷 1」的回归钉子：早先版本只认 ctx.pick()/ctx.sound() 的直接
  // 参数，impact.mjs 18 条路径只看得到 1 条——但当时没有任何断言会因为这种「看漏了」
  // 而变红，因为凡是没被抓到的路径根本不会进入上面的校验循环，天然不会报错。这里用一套
  // 完全独立的算法（先切出所有引号字符串，再逐条判定前缀，见 allQuotedLiterals()/
  // looksLikeDbPath()）重新数一遍，两个数必须相等；将来再有人发明新的传参方式把
  // pickedPaths() 绕过去，这条断言会先变红，而不是像当年那样悄无声息地漏检。
  const bad = [];
  for (const file of armoryFiles()) {
    const src = readFileSync(file, "utf8");
    const stripped = stripComments(src);
    const guardCount = pickedPaths(src).length;
    const actualCount = allQuotedLiterals(stripped).filter(looksLikeDbPath).length;
    console.log(`  [覆盖率自查] ${file}: 守卫看到 ${guardCount} 条 / 文件实际 ${actualCount} 条`);
    if (guardCount !== actualCount) {
      bad.push(`${file}: 守卫看到 ${guardCount} 条，独立统计文件里实际有 ${actualCount} 条 DB 路径字面量，两者不相等——扫描逻辑有遗漏`);
    }
  }
  assert.deepEqual(bad, [], bad.join("\n"));
});

test("兵库文件里的 DB 路径不得以字符串拼接的形式出现（禁止绕过路径扫描器）", () => {
  // 取舍：只在「两个引号字符串字面量之间紧挨着一个 `+`」这个窄口子上判定，且要求把
  // 两段内容拼起来之后**整体**匹配完整的 DB 路径模式（已知前缀 + 点 + 合法路径字符）
  // 才算违规。别的字符串拼接——拼错误提示、拼日志、拼跟路径无关的任意两段文本——
  // 拼出来的结果不会长得像 "jb2a.xxx"，不会命中，不会被误伤；同时不要求两段各自单独
  // 就像路径（例如 "jb2a.ui" + ".miss.white"，前一段独立看确实已经像半条路径，但即使
  // 故意把断点切在前缀内部、比如 "jb2a" + ".ui.miss.white"，拼起来的整体判定同样会
  // 命中），比只检查「第一段是不是以已知前缀开头」更难绕过去。已知的局限：只处理相邻
  // 两段字面量的拼接，三段及以上的链式拼接（"a" + "b" + "c"）只保证前两段被纳入判定，
  // 不在本轮已知的绕法范围内，多出的部分靠上面的覆盖率自查兜底发现新增的可疑字面量。
  const DB_PATH_FULL = new RegExp(`^(?:${DB_PREFIX_ALT})\\.[a-zA-Z0-9_.-]+$`);
  const pairRe = /(["'])((?:(?!\1)[^\\]|\\.)*)\1\s*\+\s*(["'])((?:(?!\3)[^\\]|\\.)*)\3/g;
  const bad = [];
  for (const file of armoryFiles()) {
    const stripped = stripComments(readFileSync(file, "utf8"));
    const re = new RegExp(pairRe.source, "g");
    let m;
    while ((m = re.exec(stripped))) {
      const combined = m[2] + m[4];
      if (DB_PATH_FULL.test(combined)) {
        bad.push(`${file}: "${m[2]}" + "${m[4]}" 拼出 "${combined}"——DB 路径不得用字符串拼接绕过扫描器，请写成完整字面量`);
      }
    }
  }
  assert.deepEqual(bad, [], bad.join("\n"));
});
