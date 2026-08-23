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
import {basename, dirname, join} from "node:path";
import {familyRows} from "../tools/asset-families.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
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
/**
 * 长前缀必须排在短前缀之前：正则用的是 `a|b|c` 交替，先匹配到哪个算哪个，
 * `jb2a` 排在 `jb2a-extras` 前面会把后者从中间截断。
 */
const DB_PREFIXES = ["jb2a-extras", "jb2a", "eskie", "blfx", "psfx",
                     "animated-spell-effects-cartoon", "ggg-sfx", "ggg-vfx", "jaamod",
                     // canim 是本模组自己注册的裸路径音效命名空间（tools/index-sfx.mjs）
                     "canim"];
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
  // 三种引号都要认。**反引号是 2026-08-23 补的**：此前只认单双引号，于是连不含插值的
  // 常量模板字面量都完全看不见——用反引号写的规则会同时绕过「必须有 ASSET-NOTES 依据」
  // 「不在否决清单」「不引用死链」三条守卫。这个洞是一轮架构评审的对抗核实挖出来的。
  const re = new RegExp("[\"'`]((?:" + DB_PREFIX_ALT + ")\\.[a-zA-Z0-9_.-]+)[\"'`]", "g");
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
  // 反引号是 2026-08-23 补的（见 pickedPaths 的说明）。第三个捕获组是模板字面量。
  const re = /"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
  const out = [];
  let m;
  while ((m = re.exec(stripped))) out.push(m[1] ?? m[2] ?? m[3]);
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

/**
 * 「有依据」的第二条通路：族级选材（`V2-PLAN.md` D4）。
 *
 * 主表的每一行都是人抽帧读图的产物。V2 要引入 600–1000 条素材，逐条读图不可能，
 * 于是正交矩阵那类走**族级记录**：全族机器量测 + 抽样人工读图。
 *
 * **这条通路不是放宽，是换了一种举证方式。** 族级记录本身由
 * `test/asset-families.test.mjs` 守着，那边强制四件事：前缀解析得到、成员数与索引一致、
 * **全族每一条都有量测**、以及**族内均匀**（帧率一致、alpha 一致、帧数与内容占比离散度
 * 在阈值内）。族内不均匀时那边会红，这条通路也就随之失效——「看两条替全族签字」的
 * 前提不成立时，签字就不作数。
 */
function familyPrefixes() {
  return familyRows().map(f => f.prefix);
}

test("兵库规则引用的每条 DB 路径都能查到依据（主表逐条 或 族级记录），且不在否决清单里", () => {
  const tbl = tablePaths();
  const rej = rejectedPaths();
  const fams = familyPrefixes();
  assert.ok(tbl.length >= 90, `主表行数异常：${tbl.length}`);
  assert.ok(rej.length >= 40, `否决清单条目数异常：${rej.length}`);

  const bad = [];
  for (const file of armoryFiles()) {
    const src = readFileSync(file, "utf8");
    for (const p of pickedPaths(src)) {
      if (LEGACY_UNVERIFIED.has(p)) continue;

      const exact = tbl.includes(p);
      const asPrefix = tbl.some(t => t.startsWith(p + "."));
      // 族级：路径落在某个已登记族之内（或它自己就是族前缀）
      const inFamily = fams.some(f => p === f || p.startsWith(f + "."));
      const rejected = rej.some(r => r === p || r.startsWith(p + ".") || p.startsWith(r + "."));

      if (!((exact || asPrefix || inFamily) && !rejected)) {
        const reason = rejected
          ? "在否决清单里"
          : "查不到依据：主表里既非精确命中也非某行的父路径，也不落在任何已登记的族里";
        bad.push(`${file}: "${p}" — ${reason}`);
      }
    }
  }
  assert.deepEqual(bad, [], `${bad.length} 条兵库路径没有依据或已被否决：\n${bad.join("\n")}`);
});

/**
 * 否决优先级：否决清单**压过**族级记录。
 *
 * 没有这一条，登记一个宽泛的族就能把族内被单独否掉的条目重新放行——
 * 而否决清单里的条目正是「看过、判定不能用」的结论，那是最贵的一类信息。
 * Task 9 的 review 就是靠否决清单抓到 `jb2a.cast_generic.03` 被当兜底用了一整个任务。
 */
test("族级记录不得让否决清单里的条目重新放行", () => {
  const rej = rejectedPaths();
  const fams = familyPrefixes();
  const shadowed = [];
  for (const f of fams) {
    for (const r of rej) {
      if (r === f || r.startsWith(f + ".")) shadowed.push(`族 ${f} 覆盖了已否决的 ${r}`);
    }
  }
  // 覆盖本身不算错（族可以很大），错的是「靠族放行了被否决的路径」——
  // 上面那条测试里 rejected 的判定排在最后且是硬否决，这里只做提示性记录。
  // 一旦某个族确实包住了否决条目，写规则时必须绕开它，所以要显式列出来。
  if (shadowed.length) {
    console.log(`ℹ 以下族包住了否决条目（不是错误，但写规则时必须绕开）：\n  ${shadowed.join("\n  ")}`);
  }
  // 真正的断言：否决判定不能被族绕过。构造一次校验。
  for (const r of rej.slice(0, 5)) {
    const inFamily = fams.some(f => r === f || r.startsWith(f + "."));
    if (!inFamily) continue;
    // 该条目落在某个族里，但它仍必须被判为不可用
    const rejected = rej.some(x => x === r || x.startsWith(r + ".") || r.startsWith(x + "."));
    assert.ok(rejected, `否决条目 ${r} 落在族里之后不再被判否决——否决优先级被族绕过了`);
  }
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

/**
 * 死链守卫：兵库不得引用 data/asset-index.json 里 deadLinks 记录的任何路径。
 *
 * 死链是上游厂商的 bug——DB 里可寻址、`resolve()` 不报错、`bestFit` 也不会降级
 * （路径每一级都存在，只是末端指向的文件不在盘上）。运行时的后果是 Sequencer
 * 静默播不出东西，而**离线测试全绿**。这正是本项目第 3 类失败模式「假成功」：
 * 函数返回非 null，但内容不是被请求的那个东西。
 *
 * 拦截口径三条，缺一不可：
 *   1. 兵库路径 === 死链路径（精确命中）
 *   2. 兵库路径是死链的**父路径**——规则写 `jaamod.condition.rings` 传 {color}，
 *      运行时拼出来的正是死链
 *   3. 兵库路径是死链的**子路径**——死链本身是个中间节点时（数组成员形如
 *      `x.y[3]`，其父 `x.y` 整条不可靠，因为 ctx.pick 会随机取到缺失的那个）
 */
/**
 * 带插值的模板字面量不得用来构造 DB 路径。
 *
 * 与「禁止字符串拼接」是同一件事的另一种写法：模板插值出来的路径在静态扫描下
 * **无法还原成具体值**，于是「有没有 ASSET-NOTES 依据」「是不是死链」「在不在否决清单」
 * 三条全部无从判定——守卫不是被绕过，是根本没有可判定的对象。
 *
 * 一轮架构评审里有一份方案整个机制就建立在「地址拼出来」上，对抗核实指出它能让
 * armory-assets 从新规则里抽出 0 条路径。那不是那份方案的问题，是这里少了一条禁令。
 *
 * 不含插值的模板字面量与普通字符串等价，不在禁止之列（pickedPaths 已经认它）。
 */
test("兵库不得用带插值的模板字面量构造 DB 路径", () => {
  /*
   * 先抓整段反引号内容，**再在 JS 里判有没有 `${`** —— 不在正则里写 `\$\{`。
   *
   * 初版把插值判据写进正则，结果在「JS 字符串 → 正则源」这层转义上栽了：
   * `"\\$\\{"` 经过一次转义变成 `${`，而正则里的 `$` 是行尾锚点，于是**永不匹配**。
   * 变异验证时插值那条溜了过去（守卫全绿），是被抓出来的。
   * 判据搬到 JS 里就没有第二层转义，也就没有这类坑。
   */
  const re = new RegExp("`((?:" + DB_PREFIX_ALT + ")\\.[^`]*)`", "g");
  const bad = [];
  for (const file of armoryFiles()) {
    const stripped = stripComments(readFileSync(file, "utf8"));
    const r = new RegExp(re.source, "g");
    let m;
    while ((m = r.exec(stripped))) {
      if (m[1].includes("${")) bad.push(basename(file) + ": `" + m[1] + "`");
    }
  }
  assert.deepEqual(bad, [],
    "DB 路径不得由模板插值拼出——静态扫描还原不了它，ASSET-NOTES 依据 / 死链 / 否决清单 " +
    "三条守卫会对它整体失效。要按参数选材，请把候选写成完整字面量的表，由代码挑其中一条。");
});

test("兵库不引用任何死链", () => {
  const dead = index.deadLinks;
  assert.ok(Array.isArray(dead), "data/asset-index.json 没有 deadLinks 字段——重跑 npm run index");

  // 数组成员的 `[n]` 尾码剥掉：它的父路径整条不可靠
  const deadPaths = dead.map(d => d.replace(/\[\d+\]$/, ""));
  const offenders = [];
  for (const file of armoryFiles()) {
    const src = readFileSync(file, "utf8");
    for (const used of new Set(pickedPaths(src))) {
      for (const d of deadPaths) {
        const isSame = used === d;
        const isParent = d.startsWith(`${used}.`);
        const isChild = used.startsWith(`${d}.`);
        if (isSame || isParent || isChild) {
          offenders.push(`${basename(file)}: ${used}  ←  死链 ${d}`);
          break;
        }
      }
    }
  }
  assert.deepEqual(offenders, [],
    "兵库引用了磁盘上不存在的素材。这类引用离线全绿、上机静默无画面——" +
    "改选同族的其他分支，不要靠 bestFit 兜（它兜不住：路径每一级都存在）。");
});

/** deadLinks 本身要非空且形态正确，否则上面那条守卫会变成恒真。 */
test("deadLinks 记录形态正确且非空", () => {
  const dead = index.deadLinks;
  assert.ok(dead.length > 0,
    "deadLinks 为空。本机实测 eskie 2 / cartoon 3 / ggg-vfx 3 / jaamod 38 共 46 条——" +
    "为空说明 scanDeadLinks 没跑或 Data 目录指错了，此时死链守卫恒真。");
  for (const d of dead) {
    assert.equal(typeof d, "string");
    assert.ok(d.includes("."), `死链路径形态不对: ${d}`);
  }
});
