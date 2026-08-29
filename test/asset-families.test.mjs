/**
 * 族级选材记录的守卫。
 *
 * ## 为什么要有「族」这一级
 *
 * `docs/ASSET-NOTES.md` 主表的每一行都是人抽帧读图的产物，96 行。V2 要引入的素材是
 * 600–1000 条量级（`V2-PLAN.md` D4），逐条读图不可能。
 *
 * 族级记录的**全部合法性来自一个前提：族内是均匀的**。均匀，抽样才能代表全族；
 * 不均匀，「我看了两条就替 648 条签字」就是一句假话——而假话恰恰是本项目
 * 第 5 类失败模式（注释声称取自源码但其实没有）的变体。
 *
 * 所以这份守卫的重点不是「放宽」，是**逼着族级记录兑现那个前提**：
 *
 *   1. 前缀在索引里解析得到，成员数与记录一致（库升级会先在这里红）
 *   2. **全族每一条都有机器量测**（`data/asset-profiles.json`），不是抽样量测
 *   3. 抽样条目真的属于这个族
 *   4. **族内均匀性**：帧率一致、alpha 一致、帧数与内容占比的离散度在阈值内
 *   5. **抽样覆盖族内每一种形态**（内容占比聚出几簇就得看过几簇）
 *
 * 第 4、5 条是承重的。阈值不是拍的，是对着实测分布定的——见下面各常量的注释。
 *
 * ⚠ 这六条**全是 ∀ 形状**，前提集合空掉就会一起静默通过。所以还有第 7 条用例
 * 与十处 `floor()` 守着样本量下限——见下面「样本量下限（反空真）」一节。
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync, existsSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {familyRows, filesUnder} from "../tools/asset-families.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const md = readFileSync(join(ROOT, "docs/ASSET-NOTES.md"), "utf8");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const PROFILES_PATH = join(ROOT, "data/asset-profiles.json");
const profiles = existsSync(PROFILES_PATH)
  ? (JSON.parse(readFileSync(PROFILES_PATH, "utf8")).profiles ?? {}) : {};


const families = familyRows();

/**
 * 成员查询要走这里，不要直接调 `filesUnder(prefix)`。
 *
 * `filesUnder` 的 index 参数有默认值，缺省时**每调一次就重新解析一遍 2.9MB 的
 * `data/asset-index.json`**。本文件六条用例各自遍历 54 个族，缺省调法是 324 次解析，
 * 实测每条用例 440-460ms。这里把索引（第 31 行已经读进来了）传进去并按前缀记忆化。
 */
const memberCache = new Map();
const membersOf = prefix => {
  if (!memberCache.has(prefix)) memberCache.set(prefix, filesUnder(prefix, index));
  return memberCache.get(prefix);
};

/* -------------------------------------------- */
/*  均匀性阈值                                    */
/* -------------------------------------------- */

/**
 * 帧数离散度上限：`(max - min) / max`，算的是**原始帧数**。
 *
 * 0.25 不是拍的。`ASSET-NOTES` 的「同族分支的帧数与帧率不一致」一节记着最坏的一例是
 * `jb2a.impact.007` 的 white 分支对其余色**差 1.83 倍**（即离散度 0.45）——那种族
 * **就不该按族记录**，必须逐条。0.25 划在它下面，既放过真正均匀的正交矩阵，
 * 又把 1.83 倍那种挡在外面。
 *
 * ## 2026-08-30：口径澄清（否决复审 §三 第 2 条）——只改文案，不动阈值
 *
 * 这条守卫**从来不排除素材**：它只让 `docs/ASSET-NOTES.md` 的一行族表变红，
 * 出路写在下面的失败文案里（「拆细或退回逐条记录」），仓库两次都照做了。
 * 所以它不是「阈值太严」的问题。真问题在**度量口径差一层**：
 *
 *   · 它自称回答的是「一套 `startTime`/`duration` 配不配得了全族」；
 *   · 但规则实际用的时长是 `clipOf()` 的 `(frames − tailEmpty) / fps`
 *     （`scripts/armory/clip-table.mjs`），**空尾先被裁掉**；
 *   · 而这里比的是没裁尾的 `frames`。
 *
 * 两个口径能差很远。2026-08-30 全库 54 族实测，两者相差 >0.08 的有 **12 族**，
 * 最大一例 `jb2a.melee_attack.02.battleaxe`：原始 45–49 帧、离散度仅 0.082，
 * 裁尾后是 0.83–1.10 秒、离散度 0.242——**排期上的真实分散度是原始口径的三倍**。
 * 反过来也有：`jb2a.melee_attack.06.shield.01` 原始 0.020 / 裁尾后 0.111。
 * （盾撞族当初就是被原始帧数口径判死的：唯一离群的 `Shield02_01` 96 帧里有 60 帧空尾，
 * 而 `clipOf` 第一件事就是裁尾；裁后 8 条落在 1.07/1.20 秒两档、离散度 0.11。）
 *
 * **那为什么不干脆改成按裁尾后时长判？** 实测过：改了会误伤 `jb2a.melee_attack.01.trail.01`
 * ——它原始 39–46 帧（0.152，过），裁尾后 0.63–0.90 秒（**0.296，超线**），
 * 一改就把一个今天正常在用的族判红。今天全库**没有任何族**的原始离散度超 0.25，
 * 换口径等于凭一个没看过图的数字去否掉一个族，正是本仓一再翻车的那种做法。
 *
 * 所以：**判定继续用原始帧数、阈值继续是 0.25**（保守，只拦 1.83 倍那种混装叶子），
 * 失败文案里**同时打印裁尾后时长的离散度**，让读到红的人一眼看见真正的排期口径，
 * 自己判断该拆族还是该逐条记录。哪天要动阈值，先去看 `trail.01` 的族图。
 */
const MAX_FRAME_SPREAD = 0.25;

/**
 * 内容占画幅比的聚类容差（相对）。
 *
 * **这一项刻意不做「离散度上限」，而是转成「抽样必须覆盖每一簇」。** 理由是实测出来的：
 *
 * `eskie.attack.melee.generic.01.slashing.light` 全族内容占比 0.46–0.98，离散度 0.29，
 * 一开始被判不均匀。但拆开看，决定它的是**变体号**（`_01` 0.73 / `_02` 0.52 / `_03` 0.65），
 * 同一变体内跨 9 色 × 3 速度只差 0.006–0.026。而变体是「三种不同的挥砍形状」——
 * **占画幅不同是对的，不是缺陷**。
 *
 * 而且变体在 DB 树里是最后一级（`…<色>.<速度>.<01|02|03>`），规则写到 `<速度>` 这一层时
 * `resolve()` 对中间节点只取第一个叶子，**变体今天根本不会被池化**，一个 objectScale
 * 配的始终是同一个形状。所以「族内数字必须一致」是个错误的判据。
 *
 * 对的判据是：**族内有几种形态，抽样就必须看过几种**。族级记录的承诺是
 * 「看过的能代表没看过的」，而不是「族内长得都一样」。
 */
const CONTENT_CLUSTER_TOLERANCE = 0.10;

/** 抽样下限：一个族至少要有人真的看过这么多条。 */
const MIN_SAMPLES = 2;

/* -------------------------------------------- */
/*  样本量下限（反空真）                          */
/* -------------------------------------------- */

/**
 * 下面六条用例**全是 ∀ 形状**：「对所有族 X，必须 Q」。∀ 断言有一个致命的退化方向——
 * 前提集合空掉的时候 `bad` 恒为 `[]`，`assert.deepEqual(bad, [])` 静默通过。
 *
 * 这不是假想。`familyRows()` 的前提是 `docs/ASSET-NOTES.md` 里那句 `| 族前缀 |` 表头
 * （`tools/asset-families.mjs:21`）：**表头被改一个字、表被挪走、或表格语法被 prettier
 * 之类的东西重排**，`familyRows()` 就返回 `[]`，这六条用例会一起变成绿的，
 * 而「族级记录替 817 条素材签的字」当场全部失效——`test/armory-assets.test.mjs:195`
 * 的第二条举证通路也跟着一起空掉，那边是靠 `familyPrefixes()` 放行素材路径的。
 *
 * 所以每条 ∀ 用例都配一条**样本量下限**：先证明前提集合非空且够大，再证明性质成立。
 *
 * 下限取实测值本身，**不留放水余量**（仓库惯例见 `test/fallback-ratchet.test.mjs:150`
 * 「基线必须贴着实测值，不许留放水余量」）。下面那条「下限必须贴着实测」把余量钉在 5%
 * 以内：族表长大了就必须同步抬下限，否则守卫会一路稀释成摆设。
 *
 * 各字段是 2026-08-29 的实测值（54 族全部来自 `docs/ASSET-NOTES.md` 的族表）：
 */
const BASELINE = {
  /** 族表行数。 */
  families: 54,
  /** 全部族的成员并集大小（各族相加，不去重——族之间不重叠）。 */
  members: 817,
  /** 其中在 `data/asset-profiles.json` 里有量测的条数。今天两者相等，正是第 3 条用例要守的。 */
  measured: 817,
  /** 族表里登记的抽样条目总数。 */
  samples: 157,
  /** 进入均匀性判定的族数（成员 ≥ 2 才判，少于 2 条的会被 `continue` 跳过）。 */
  uniformFamilies: 54,
  /** 上一项那些族的成员总数——真正被逐条比过 fps/alpha/frames 的条数。 */
  uniformMembers: 817,
  /** 进入形态覆盖判定的族数（内容占比聚出 >1 簇才判）。 */
  shapeFamilies: 44,
  /** 上一项那些族的簇总数——真正被要求「抽样得盖到」的形态数。 */
  clusters: 136
};

/**
 * 把六条用例各自的前提集合数一遍。只数一次，六条用例共用。
 *
 * 计数口径必须与用例里的过滤条件**逐字一致**，否则下限守的是另一个集合，
 * 空真照样漏过去。下面每一行都标了它对应用例里的哪一句。
 */
const census = (() => {
  const c = {
    families: families.length, members: 0, measured: 0, samples: 0,
    uniformFamilies: 0, uniformMembers: 0, shapeFamilies: 0, clusters: 0
  };
  for (const f of families) {
    const members = membersOf(f.prefix) ?? [];
    c.members += members.length;
    c.samples += f.samples.length;                       // 用例 4：for (const s of f.samples)
    const withProf = members.filter(m => profiles[m]);   // 用例 3：members.filter(m => !profiles[m])
    c.measured += withProf.length;
    if (withProf.length < 2) continue;                   // 用例 5/6：members.length < 2 → continue
    c.uniformFamilies++;
    c.uniformMembers += withProf.length;
    const clusters = clusterByContent(withProf.map(m => profiles[m].contentRatio));
    if (clusters.length <= 1) continue;                  // 用例 6：clusters.length <= 1 → continue
    c.shapeFamilies++;
    c.clusters += clusters.length;
  }
  return c;
})();

/** 下限断言的统一写法：先证明前提非空且够大，再让调用方去证性质。 */
function floor(key, what) {
  assert.ok(census[key] >= BASELINE[key],
    `${what}只剩 ${census[key]} 个（下限 ${BASELINE[key]}）——` +
    `前提集合塌了，这条 ∀ 断言正在空真通过。先查 docs/ASSET-NOTES.md 的族表还在不在。`);
}

/* -------------------------------------------- */

test("族表若存在，每一行的前缀都要在索引里解析得到", () => {
  floor("families", "族表里的族");
  const bad = families.filter(f => membersOf(f.prefix) === null).map(f => f.prefix);
  assert.deepEqual(bad, [], "族前缀在 data/asset-index.json 里不存在——写错了或库没装");
});

test("族的成员数与索引实际一致（库升级会先在这里红）", () => {
  floor("families", "族表里的族");
  floor("members", "被族级记录签过字的素材");
  const drift = [];
  for (const f of families) {
    const actual = membersOf(f.prefix)?.length ?? 0;
    if (actual !== f.count) drift.push(`${f.prefix}: 记录 ${f.count}，实际 ${actual}`);
  }
  assert.deepEqual(drift, [],
    "族的成员数变了。素材库升级会增删文件，而族级记录是替全族签字的——" +
    "成员变了就必须重新量测并复核抽样，不能让旧结论替新文件背书。");
});

test("族内每一条都有机器量测，不是抽样量测", () => {
  floor("members", "被族级记录签过字的素材");
  const gaps = [];
  for (const f of families) {
    const members = membersOf(f.prefix) ?? [];
    const missing = members.filter(m => !profiles[m]);
    if (missing.length) gaps.push(`${f.prefix}: ${missing.length}/${members.length} 条没量测`);
  }
  assert.deepEqual(gaps, [],
    "族级记录的前提是「客观项全族都测过、主观项抽样看过」。" +
    "量测有缺口时，均匀性判定本身就是在一个不完整的样本上做的——" +
    "跑 node tools/profile-family.mjs --db <前缀> 补齐。");
});

test("抽样条目必须真的属于这个族，且不少于下限", () => {
  floor("families", "族表里的族");
  floor("samples", "族表里登记的抽样条目");
  const bad = [];
  for (const f of families) {
    const members = new Set(membersOf(f.prefix) ?? []);
    if (f.samples.length < MIN_SAMPLES) {
      bad.push(`${f.prefix}: 只抽样了 ${f.samples.length} 条，至少要 ${MIN_SAMPLES}`);
      continue;
    }
    for (const s of f.samples) {
      if (!members.has(s)) bad.push(`${f.prefix}: 抽样 ${s} 不是这个族的成员`);
    }
  }
  assert.deepEqual(bad, [],
    "抽样记录对不上。抽样是族级记录里唯一的人工环节，它必须指向真实存在的成员。");
});

test("族内均匀 —— 这是族级记录唯一的合法性来源", () => {
  floor("uniformFamilies", "进入均匀性判定的族");
  floor("uniformMembers", "被逐条比过 fps/alpha/frames 的素材");
  const bad = [];
  for (const f of families) {
    const members = (membersOf(f.prefix) ?? []).map(m => profiles[m]).filter(Boolean);
    if (members.length < 2) continue;

    const fps = new Set(members.map(p => p.fps));
    if (fps.size > 1) bad.push(`${f.prefix}: 族内帧率不一致（${[...fps].join(" / ")}）——毫秒换算会对一部分成员失效`);

    const alpha = new Set(members.map(p => p.alpha));
    if (alpha.size > 1) bad.push(`${f.prefix}: 族内 alpha 不一致——没 alpha 的那些会在深色地图上露黑底`);

    const frames = members.map(p => p.frames);
    const fSpread = (Math.max(...frames) - Math.min(...frames)) / Math.max(...frames);
    if (fSpread > MAX_FRAME_SPREAD) {
      // 判定用原始帧数（阈值口径，见 MAX_FRAME_SPREAD 的注释），
      // 但报错时把 clipOf 真正用的口径——裁掉空尾后的秒数——一并打出来：
      // 读到红的人要拿它决定「拆族」还是「退回逐条记录」，光看原始帧数会判错方向。
      const secs = members.map(p => (p.frames - p.tailEmpty) / p.fps);
      const sSpread = (Math.max(...secs) - Math.min(...secs)) / Math.max(...secs);
      bad.push(`${f.prefix}: 原始帧数离散度 ${fSpread.toFixed(2)} > ${MAX_FRAME_SPREAD}` +
               `（${Math.min(...frames)}–${Math.max(...frames)} 帧）；` +
               `clipOf 实际用的裁尾后时长离散度 ${sSpread.toFixed(2)}` +
               `（${Math.min(...secs).toFixed(2)}–${Math.max(...secs).toFixed(2)} 秒）` +
               `——一套 startTime/duration 配不了全族。` +
               `⚠ 两个数差很远时，以裁尾后那个为准判断该不该拆族：` +
               `空尾长短不影响排期，clipOf 会先裁掉`);
    }

  }
  assert.deepEqual(bad, [],
    "族内不均匀。**这时不该放宽阈值，该把族拆细或退回逐条记录**——" +
    "族级记录的意思是「看两条就能替全族签字」，前提不成立时那就是一句假话。");
});

/**
 * 把一组内容占比按相对容差聚成簇。同一簇 = 同一种形态。
 * 返回 [{lo, hi, n}]，按 lo 升序。
 */
export function clusterByContent(values, tol = CONTENT_CLUSTER_TOLERANCE) {
  const sorted = [...values].filter(v => typeof v === "number").sort((a, b) => a - b);
  const out = [];
  for (const v of sorted) {
    const last = out[out.length - 1];
    // 与本簇下界的相对差在容差内就并进去；否则起新簇
    if (last && (v - last.lo) / Math.max(v, last.lo) <= tol) { last.hi = v; last.n++; }
    else out.push({lo: v, hi: v, n: 1});
  }
  return out;
}

test("抽样必须覆盖族内的每一种形态 —— 这才是「代表性」的实际含义", () => {
  floor("shapeFamilies", "进入形态覆盖判定的族");
  floor("clusters", "被要求抽样盖到的形态簇");
  const bad = [];
  for (const f of families) {
    const members = membersOf(f.prefix) ?? [];
    const withProf = members.map(m => [m, profiles[m]]).filter(([, p]) => p);
    if (withProf.length < 2) continue;

    const clusters = clusterByContent(withProf.map(([, p]) => p.contentRatio));
    if (clusters.length <= 1) continue;      // 只有一种形态，MIN_SAMPLES 已经够了

    // 每个抽样落在哪一簇
    const hit = new Set();
    for (const s of f.samples) {
      const p = profiles[s];
      if (!p) continue;
      const i = clusters.findIndex(c => p.contentRatio >= c.lo * (1 - 1e-9) && p.contentRatio <= c.hi * (1 + 1e-9));
      if (i >= 0) hit.add(i);
    }
    const missed = clusters.map((c, i) => [c, i]).filter(([, i]) => !hit.has(i));
    if (missed.length) {
      bad.push(`${f.prefix}: 族内有 ${clusters.length} 种形态（内容占比 ` +
        clusters.map(c => `${c.lo.toFixed(2)}–${c.hi.toFixed(2)}×${c.n}`).join(" / ") +
        `），抽样只覆盖了 ${hit.size} 种，漏了 ` +
        missed.map(([c]) => `${c.lo.toFixed(2)}–${c.hi.toFixed(2)}`).join(" / "));
    }
  }
  assert.deepEqual(bad, [],
    "抽样没覆盖全族的形态。族级记录的承诺是「看过的能代表没看过的」——" +
    "族里有三种挥砍形状而只看了一种，那句承诺就没兑现。补抽样（跑 " +
    "node tools/family-sheet.mjs --db <前缀> 一张图就能挑），或者把族拆细。");
});

/**
 * 下限不许虚低。
 *
 * 没有这一条，上面那十条 `floor()` 就能被「把下限调小」轻易绕过——而那恰恰是最坏的
 * 用法：数字看着在管着，实际一路稀释。族表长大（新登记一个族、某个族被库升级加了成员）
 * 之后下限不跟着抬，`floor()` 守的就是一个越来越松的旧集合，直到某天前提塌了一大半
 * 它还是绿的。这里要求下限**贴着实测**（不得低出 5%）。
 *
 * 5% 这个余量是给「族表刚加一行、还没来得及改基线」留的缓冲，不是给放水留的：
 * 54 个族里加 2 个族就会顶到 3.6%，加 3 个就红。
 */
test("下限必须贴着实测值，不许留放水余量", () => {
  const slack = (base, actual) => actual === 0 ? 0 : (actual - base) / actual;
  const stale = Object.keys(BASELINE)
    .filter(k => slack(BASELINE[k], census[k]) > 0.05)
    .map(k => `${k}: 下限 ${BASELINE[k]}，实测 ${census[k]}`);
  assert.deepEqual(stale, [],
    "族表已经长大了，但样本量下限还挂在旧值上。把 BASELINE 调到实测值——" +
    "下限只有贴着走才拦得住空真。");
});
