/**
 * 双闪守卫：「自带闪爆」的素材不许再在同一个锚点上叠通用闪光层。
 *
 * 设计取舍——为什么主守卫是**结构性**的而不是「两次闪光间隔必须大于 N 毫秒」：
 *   1. 间隔断言需要在测试里硬编码每条素材的自带闪爆偏移，等于把 ASSET-NOTES 抄了
 *      第二份；有人调 waitUntilFinished 时，测试要么误红、要么被「顺手改掉常数」修绿。
 *   2. 间隔断言还依赖「下一段在 duration + waitUntilFinished 时刻起播」这套时序语义，
 *      而 scripts/player/ 至今是空的（Task 13）。把没实现的语义写死进断言，
 *      既可能在真的错的时候绿，也可能在 Task 13 选了别的语义时无故红。
 *   3. N 是连续量，任何阈值都是拍脑袋的。
 * 所以：T1 只查「有没有在同一个锚点上叠两层」，不含任何毫秒数；T2 拿 ASSET-NOTES
 * 当唯一真相来源反查标记有没有漏打；T3 才碰时间，而且比较的两个数都来自同一条 cue
 * 自己（交棒点 vs 它自己申报的闪爆区间），不引用任何外部常量。
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {resolve} from "../scripts/resolver/resolve.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import {RESULT, HIT_RESULTS} from "../scripts/const.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const md = readFileSync(join(ROOT, "docs/ASSET-NOTES.md"), "utf8");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const actions = JSON.parse(readFileSync(join(ROOT, "test/fixtures/actions.json"), "utf8"));
const mk = () => createAssets(offlineBackend(index));

/**
 * 主表：DB 路径 → 该行的「自带闪爆」列。
 *
 * 用「兵库 → 表」的口径，与 test/armory-assets.test.mjs 完全一致：规则写下的路径
 * 合法当且仅当它精确命中某一行，或者是某一行的父路径（规则传 {color} 时写的正是不含
 * 颜色段的父路径）。取标记时：精确命中就用那一行，否则把所有以它为前缀的行取「或」
 * ——同族里只要有一支自带闪爆就按「是」守，宁可多守一层也不要漏掉一次双闪。
 */
function notesFlashByPath() {
  const lines = md.split("\n");
  const head = lines.findIndex(l => l.startsWith("| DB 路径 |"));
  assert.ok(head >= 0, "找不到主表表头行");
  const rows = [];
  for (let i = head + 1; i < lines.length; i++) {
    if (!lines[i].startsWith("|")) break;
    if (/^\|\s*-{3,}\s*\|/.test(lines[i])) continue;
    const cols = lines[i].split("|").map(c => c.trim());
    rows.push({path: cols[1].replace(/`/g, ""), flash: cols[8] === "是"});
  }
  assert.ok(rows.length >= 90, `主表行数异常：${rows.length}`);
  /** @returns {boolean|undefined} undefined = 表里查不到依据 */
  return p => {
    const exact = rows.find(r => r.path === p);
    if (exact) return exact.flash;
    const kids = rows.filter(r => r.path.startsWith(p + "."));
    return kids.length ? kids.some(r => r.flash) : undefined;
  };
}

/**
 * 把 travel.mjs 拆成一条规则一段源码：从每个 `id: "..."` 起到下一个 `id:` 为止。
 * 每段里取 ctx.pick() 的路径字面量，以及这段里有没有写 selfFlash。
 * 走源码而不是走 plan，是因为 cue 上只留下解析后的文件路径、丢掉了规则写下的 DB 路径，
 * 而「表 → 规则」的对照必须按 DB 路径做。
 */
function travelRuleSources() {
  const src = readFileSync(join(ROOT, "scripts/armory/travel.mjs"), "utf8");
  const ids = [...src.matchAll(/\bid:\s*["']([^"']+)["']/g)];
  return ids.map((m, i) => {
    const body = src.slice(m.index, i + 1 < ids.length ? ids[i + 1].index : src.length);
    return {
      id: m[1],
      picks: [...body.matchAll(/ctx\.pick\(\s*["']([^"']+)["']/g)].map(x => x[1]),
      hasSelfFlash: /\bselfFlash\s*:/.test(body)
    };
  });
}

/**
 * 把一个动作解析成 {targetTokenId → {travel, impact, aftermath}}，与 resolve.mjs 给
 * build() 的那份「前序槽视图」同构：once 规则的产出不带 tokenId、不属于任何单个目标，
 * 但对每个目标都可见。
 */
function byTarget(snapshot) {
  const cues = resolve(snapshot, {assets: mk(), armory: ARMORY})?.cues ?? [];
  const out = new Map();
  for (const t of snapshot.targets) {
    const own = c => c.at?.tokenId === t.tokenId;
    const shared = c => c.at?.tokenId === undefined;
    const of = (slot, pick) => cues.filter(c => c.slot === slot && pick(c));
    out.set(t.tokenId, {
      travel: of("travel", c => own(c) || shared(c)),
      impact: of("impact", own),
      aftermath: of("aftermath", own)
    });
  }
  return out;
}

/** travel 里落在目标身上的那条自带闪爆（origin/region 锚点的不占目标这一层）。 */
const targetFlash = slots => slots.travel.find(c => c.selfFlash && (c.selfFlash.anchor ?? "target") === "target");

/** 把整个动作的攻击结果改写成同一种，用来分别检查命中类与防御类。 */
function asResult(a, result = RESULT.HIT) {
  return {...a, targets: a.targets.map(t => ({...t, results: [{result, critical: false}]}))};
}

test("T1 同一个锚点上不许出现两层命中闪光：travel 自带闪爆 ⇒ impact 不再出通用冲击层", () => {
  // Task 11 把 impact 槽拆成「结果层 + 元素层」（impact.layered，pri 500，isAttack
  // 动作接管原来 generic.impact 的位置），双闪抑制因此只作用于结果层（layer:"result"）
  // ——元素层携带的是「打中了什么属性」这条新信息，不是通用冲击闪光的重复，见
  // scripts/armory/impact.mjs 里 ELEMENT_LAYER 上方的注释与 task-11-report.md。
  // 非攻击动作仍落在 generic.impact 兜底（rule 名不变），两条规则都要查。
  const bad = [];
  for (const a of actions) {
    if (!a.targets?.length) continue;
    for (const result of HIT_RESULTS) {
      for (const [key, slots] of byTarget(asResult(a, result))) {
        const flash = targetFlash(slots);
        if (!flash) continue;
        const stacked = slots.impact.filter(c =>
          c.rule === "generic.impact" || (c.rule === "impact.layered" && c.layer === "result"));
        if (stacked.length) {
          bad.push(`${a.id} 结果${result} 目标${key}：travel "${flash.rule}" 自带闪爆，`
                 + `impact 仍叠了 ${stacked.map(c => `"${c.rule}"`).join("/")}`);
        }
      }
    }
  }
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} 处双闪`);
});

test("T1b 反向：travel 没有落在目标身上的自带闪爆时，命中类结果必须仍有 impact 层", () => {
  // 不许靠一刀切删光闪光来变绿；也守着「射线的星爆记在模板末端（anchor region）、
  // 不替逐目标的命中闪光让位」这个判断——它一旦被改成 target，这里会立刻红。
  const bad = [];
  let checked = 0;
  for (const a of actions) {
    if (!a.targets?.length) continue;
    for (const [key, slots] of byTarget(asResult(a, RESULT.HIT))) {
      if (targetFlash(slots)) continue;
      checked++;
      if (!slots.impact.length) bad.push(`${a.id} 目标${key}：travel 没有自带闪爆，impact 却是空的`);
    }
  }
  assert.ok(checked > 20, `只检查了 ${checked} 个目标，样本太小`);
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} 个目标丢了命中反馈`);
});

test("T1c 防御/落空类结果不让位：挡下与闪开仍要有自己的 impact 反馈", () => {
  const defended = [RESULT.MISS, RESULT.DODGE, RESULT.PARRY, RESULT.BLOCK, RESULT.ARMOR, RESULT.RESIST];
  const bad = [];
  for (const a of actions) {
    if (!a.targets?.length) continue;
    for (const result of defended) {
      for (const [key, slots] of byTarget(asResult(a, result))) {
        if (!slots.travel.length) continue;      // blast 之类本来就没有 travel
        if (!slots.impact.length) bad.push(`${a.id} 结果${result} 目标${key} 没有 impact 反馈`);
      }
    }
  }
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} 处防御类结果丢了反馈`);
});

test("T1d 射线的星爆记在模板末端，不替沿途每个目标的命中闪光让位", () => {
  // 修好几何之后光束拉的是 line 模板全长，那一下持续星爆就烧在**模板末端**，不在
  // 沿途每个目标脚下。所以它的 anchor 是 "region" 而不是 "target"：记成 target 会让
  // 站在光束中段的目标连自己的命中闪光一起被抑制掉，等于用「消除双闪」换掉了命中反馈。
  // 代价是站在模板末端的那个目标仍可能同时看到星爆与命中闪光——这一处残留是有意保留的，
  // 宁可多闪一下也不要让中段目标彻底没有反馈。
  const s = asResult(actions.find(a => a.id === "spell.frost.ray"), RESULT.HIT);
  assert.ok(s.targets.length > 1, "这条断言需要多目标射线");
  const cues = resolve(s, {assets: mk(), armory: ARMORY}).cues;
  const beam = cues.filter(c => c.slot === "travel");
  assert.equal(beam.length, 1, "射线是 once 规则，一次动作只有一条光束");
  assert.equal(beam[0].selfFlash?.anchor, "region",
    "射线的自带星爆必须记在模板末端（region），记成 target 会连坐沿途所有目标");
  for (const [key, slots] of byTarget(s)) {
    // Task 11 之后 HIT 结果会叠「结果层 + 元素层」两条 cue（见 impact.mjs），
    // 这条测试原本要守的是「结果层没被误抑制」，因此只数结果层（非攻击兜底的
    // generic.impact 不设 layer 字段，同样算作结果层）而不是笼统数总条数。
    const resultCues = slots.impact.filter(c => c.layer === "result" || c.rule === "generic.impact");
    assert.equal(resultCues.length, 1, `${key} 的命中闪光被射线的星爆误抑制了`);
  }
});

test("T2 selfFlash 标记必须与 ASSET-NOTES 的「自带闪爆」列一致（表是唯一真相来源）", () => {
  const flashOf = notesFlashByPath();
  const rules = travelRuleSources();
  assert.ok(rules.length >= 10, `只扫到 ${rules.length} 条 travel 规则`);
  const bad = [];
  let checked = 0;
  for (const r of rules) {
    if (!r.picks.length) continue;                       // target.blast 之类不出素材
    const noted = r.picks.map(flashOf);
    if (noted.some(v => v === undefined)) {
      bad.push(`${r.id}: ${r.picks.filter((_, i) => noted[i] === undefined).join(", ")} 在 ASSET-NOTES 主表里查不到依据`);
      continue;
    }
    checked++;
    const shouldFlag = noted.some(Boolean);
    if (shouldFlag && !r.hasSelfFlash) {
      bad.push(`${r.id}: ASSET-NOTES 标「自带闪爆＝是」，规则却没有写 selfFlash——impact 层会照常叠出第二次闪光`);
    }
    if (!shouldFlag && r.hasSelfFlash) {
      bad.push(`${r.id}: ASSET-NOTES 标「自带闪爆＝否」，规则却写了 selfFlash——会把本该出的命中闪光误抑制掉`);
    }
  }
  assert.ok(checked >= 8, `只对照了 ${checked} 条规则`);
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} 条 selfFlash 标记与 ASSET-NOTES 不一致`);
});

test("T3 交棒点必须锚在自带闪爆那一段上（两个数都来自同一条 cue，不引用外部常量）", () => {
  const bad = [];
  const seen = new Set();
  for (const a of actions) {
    if (!a.targets?.length) continue;
    for (const [, slots] of byTarget(asResult(a))) {
      for (const c of slots.travel) {
        const f = c.selfFlash;
        if (!f || seen.has(c.rule)) continue;
        seen.add(c.rule);
        // 前提：申报了 selfFlash 就必须显式给 duration，否则交棒点算不出来
        // （waitUntilFinished 是相对片尾的负偏移，duration 为 null 时片长只有播放层知道）。
        if (c.duration === null) { bad.push(`${c.rule}: 申报了 selfFlash 却没有显式 duration`); continue; }
        if (c.waitUntilFinished === null) { bad.push(`${c.rule}: 申报了 selfFlash 却没有 waitUntilFinished`); continue; }
        assert.ok(f.from <= f.at && f.at <= f.to, `${c.rule}: selfFlash 区间不自洽 ${JSON.stringify(f)}`);
        // 锚在施法者身上的爆闪与目标身上的交棒无关，跳过。
        if ((f.anchor ?? "target") === "origin") continue;
        // 上界取「峰值」而不是「熄灭」：闪爆过了峰值就在衰减，这时候才交棒，
        // 下一槽的反馈会被读成独立的第二下——strike.thrown 原来的 -500 正是这么错的
        // （交棒点 667ms 恰好压在光环熄灭那一帧上）。持续型（射线）没有单一峰值，
        // 整段都在闪，上界才取熄灭时刻。
        const handoff = c.duration + c.waitUntilFinished;
        const hi = f.sustained ? f.to : f.at;
        if (handoff < f.from || handoff > hi) {
          bad.push(`${c.rule}: 交棒点 ${handoff}ms 不在自带闪爆的 `
                 + `[起亮 ${f.from}, ${f.sustained ? "熄灭" : "峰值"} ${hi}] 区间内`);
        }
      }
    }
  }
  assert.ok(seen.size >= 3, `只检查了 ${seen.size} 条带 selfFlash 的规则`);
  assert.deepEqual(bad, [], `${bad.length} 条规则的交棒点没有锚在自带闪爆上`);
});
