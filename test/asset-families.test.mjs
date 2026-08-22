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
 *
 * 第 4 条是承重的。阈值不是拍的，是对着实测分布定的——见下面各常量的注释。
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

/* -------------------------------------------- */
/*  均匀性阈值                                    */
/* -------------------------------------------- */

/**
 * 帧数离散度上限：`(max - min) / max`。
 *
 * 0.25 不是拍的。`ASSET-NOTES` 的「同族分支的帧数与帧率不一致」一节记着最坏的一例是
 * `jb2a.impact.007` 的 white 分支对其余色**差 1.83 倍**（即离散度 0.45）——那种族
 * **就不该按族记录**，必须逐条。0.25 划在它下面，既放过真正均匀的正交矩阵，
 * 又把 1.83 倍那种挡在外面。
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

test("族表若存在，每一行的前缀都要在索引里解析得到", () => {
  const bad = families.filter(f => filesUnder(f.prefix) === null).map(f => f.prefix);
  assert.deepEqual(bad, [], "族前缀在 data/asset-index.json 里不存在——写错了或库没装");
});

test("族的成员数与索引实际一致（库升级会先在这里红）", () => {
  const drift = [];
  for (const f of families) {
    const actual = filesUnder(f.prefix)?.length ?? 0;
    if (actual !== f.count) drift.push(`${f.prefix}: 记录 ${f.count}，实际 ${actual}`);
  }
  assert.deepEqual(drift, [],
    "族的成员数变了。素材库升级会增删文件，而族级记录是替全族签字的——" +
    "成员变了就必须重新量测并复核抽样，不能让旧结论替新文件背书。");
});

test("族内每一条都有机器量测，不是抽样量测", () => {
  const gaps = [];
  for (const f of families) {
    const members = filesUnder(f.prefix) ?? [];
    const missing = members.filter(m => !profiles[m]);
    if (missing.length) gaps.push(`${f.prefix}: ${missing.length}/${members.length} 条没量测`);
  }
  assert.deepEqual(gaps, [],
    "族级记录的前提是「客观项全族都测过、主观项抽样看过」。" +
    "量测有缺口时，均匀性判定本身就是在一个不完整的样本上做的——" +
    "跑 node tools/profile-family.mjs --db <前缀> 补齐。");
});

test("抽样条目必须真的属于这个族，且不少于下限", () => {
  const bad = [];
  for (const f of families) {
    const members = new Set(filesUnder(f.prefix) ?? []);
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
  const bad = [];
  for (const f of families) {
    const members = (filesUnder(f.prefix) ?? []).map(m => profiles[m]).filter(Boolean);
    if (members.length < 2) continue;

    const fps = new Set(members.map(p => p.fps));
    if (fps.size > 1) bad.push(`${f.prefix}: 族内帧率不一致（${[...fps].join(" / ")}）——毫秒换算会对一部分成员失效`);

    const alpha = new Set(members.map(p => p.alpha));
    if (alpha.size > 1) bad.push(`${f.prefix}: 族内 alpha 不一致——没 alpha 的那些会在深色地图上露黑底`);

    const frames = members.map(p => p.frames);
    const fSpread = (Math.max(...frames) - Math.min(...frames)) / Math.max(...frames);
    if (fSpread > MAX_FRAME_SPREAD) {
      bad.push(`${f.prefix}: 帧数离散度 ${fSpread.toFixed(2)} > ${MAX_FRAME_SPREAD}` +
               `（${Math.min(...frames)}–${Math.max(...frames)} 帧）——startTime/duration 配不了全族`);
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
  const bad = [];
  for (const f of families) {
    const members = filesUnder(f.prefix) ?? [];
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
