/**
 * 兜底率棘轮 —— V2 的进度表，同时是回归闸门。
 *
 * ## 判据 J1
 *
 * `V2-PLAN.md` §1 的目标是「573 个派发目标，每个都有为它选的素材」，可测形态是：
 * **语料里任何一个动作都不该命中 `generic.*` 规则**。兜底规则保留，但只作为将来新增内容
 * （自制天赋、系统升级带的新动作）的安全网。
 *
 * ## 为什么是棘轮而不是「一开始就红」
 *
 * 计划初稿写的是「先写成红的，当进度表」。**那是个坏主意**：一条长期红着的测试会让
 * `npm test` 的红绿失去意义，下一条真的坏了也没人看。
 *
 * 改成钉住当前基线、**只许降不许升**：
 *   · 今天是绿的，所以红了一定是真的出事
 *   · 每完成一批 specific 选材就把基线调低，数字本身就是进度
 *   · 有人不小心让某条规则退回兜底（比如 when() 条件写窄了），立刻红
 *
 * ## 调基线的规矩
 *
 * 只在**兜底数真的下降**之后调，而且要连同下面三个数一起调。
 * 绝不允许「为了让测试变绿而调高」——那正是这个守卫要防的事。
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {resolve} from "../scripts/resolver/resolve.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const actions = JSON.parse(readFileSync(join(ROOT, "test/fixtures/actions.json"), "utf8"));
const mk = () => createAssets(offlineBackend(index));

/**
 * 基线。**目标是全部降到 0。**
 *
 * ## 2026-08-23 修订：第一版基线是在一份坏掉的语料上量的
 *
 * 初版写的是 180 / 270 / 616。那组数字**低估了现有兵库**，因为
 * `tools/dump-fixtures.mjs` 合成快照时漏掉了 Crucible 的**标签传播**——
 * 天赋物品上写的是 `melee` / `twohand` / `thrown`，**没有一个带字面 `strike`**，
 * 而运行时 `melee → strike` 是靠传播补的（`const/action.mjs` 的 `TAGS[].propagate`）。
 * 于是 `tags.includes("strike")` 恒假、69 条 `cost.weapon === true` 的动作
 * `usage.strikes` **全部是 `[]`**。
 *
 * 后果：那 69 条里 **55 条一条 travel cue 都不出**，`strike.unarmed` 命中 **0 次**、
 * `strike.melee` 只服务两个默认动作（4 次）。**整个武器天赋空间从未被任何测试执行过。**
 * （`armory/travel.mjs:349` 的注释早就写着这件事，只是没人回头补语料。）
 *
 * 补上传播 + 按标签合成合理武器之后，**一条新规则都没写**，兜底就降了 37%：
 *
 * | | 坏语料 | 修好之后 |
 * | --- | --- | --- |
 * | 全兜底动作 | 180 | **105** |
 * | 沾兜底动作 | 270 | **203** |
 * | 兜底 cue | 616 | **387** |
 * | 武器动作无 travel | 55/69 | **1/69** |
 * | `strike.unarmed` / `strike.melee` | 0 / 4 | **66 / 64** |
 *
 * ## 2026-08-23 三次下调：39 / 144 / 307
 *
 * 补上「非武器非法术动作」这一块之后——它是本仓库最大的空白：434 个动作里武器 69、
 * 法术 204，剩下 161 条「其它」中**104 条只播通用兜底**，按条数比法术与状态加起来还多。
 * 新增 `self.shape` 规则（元素架势 / 英雄气概 / 吟唱光环 / 召唤 / 自身增益五簇）并把
 * 区域形状规则放开到非武器动作，全兜底动作 **105 → 39**。
 *
 * ⚠ 剩下的 39 条**不打算硬凑**：它们是系统默认动作（move / delay / escape）与无标签
 * 天赋，快照上没有可算的判据，配一个错的不如让它走兜底。
 *
 * ## 2026-08-23 二次下调：191 / 363
 *
 * 线 A 第二轮新增 `strike.ranged.weapon`（8 件远程武器按弓/弩/枪分飞行物）之后，
 * 原先掉在 `generic.travel` 上的远程动作被接管：沾兜底动作 203 → **191**，
 * 兜底 cue 387 → **363**。全兜底动作数不变（105）——那批是无结构可算的具名动作，
 * 与武器通路无关。
 *
 * 这条订正本身就是「基线必须贴着实测值」那条守卫的第一次实战——它在语料修好后
 * 立刻报警，逼着基线跟着下调，而不是让旧数字继续替新现实背书。
 */
const BASELINE = Object.freeze({
  actionsAllFallback: 39,    // 全部 cue 都来自兜底的动作数
  actionsAnyFallback: 144,   // 至少一条 cue 来自兜底的动作数
  fallbackCues: 307          // 兜底 cue 总条数
});

/** 跑一遍全量语料，统计兜底命中。 */
function measure() {
  let allFb = 0, anyFb = 0, cues = 0, total = 0;
  const worst = [];
  for (const s of actions) {
    const plan = resolve(s, {assets: mk(), armory: ARMORY});
    // 只数**画面** cue。音效 cue 挂在发它的那条规则名下，而 `generic.travel` 现在也
    // 发法术命中音——把它算成「兜底 cue」会让这条棘轮凭空涨 168，而画面派发一点没变差。
    // 这条棘轮量的是画面派发质量，声音有自己的棘轮（test/sound-layer.test.mjs）。
    const rules = (plan?.cues ?? []).filter(c => c.kind !== "sound").map(c => c.rule ?? "?");
    if (!rules.length) continue;
    total += rules.length;
    const fb = rules.filter(r => String(r).startsWith("generic"));
    cues += fb.length;
    if (fb.length) anyFb++;
    if (fb.length === rules.length) { allFb++; worst.push(s.id); }
  }
  return {allFb, anyFb, cues, total, worst};
}

const m = measure();

test("兜底棘轮：全靠兜底的动作数只许降不许升", () => {
  assert.ok(m.allFb <= BASELINE.actionsAllFallback,
    `全靠兜底的动作从 ${BASELINE.actionsAllFallback} 涨到了 ${m.allFb}。` +
    `新增的（前 10 个）：${m.worst.slice(0, 10).join(", ")}`);
});

test("兜底棘轮：沾兜底的动作数只许降不许升", () => {
  assert.ok(m.anyFb <= BASELINE.actionsAnyFallback,
    `沾兜底的动作从 ${BASELINE.actionsAnyFallback} 涨到了 ${m.anyFb}`);
});

test("兜底棘轮：兜底 cue 总数只许降不许升", () => {
  assert.ok(m.cues <= BASELINE.fallbackCues,
    `兜底 cue 从 ${BASELINE.fallbackCues} 涨到了 ${m.cues}（总 cue ${m.total}）`);
});

/**
 * 基线不许虚高。
 *
 * 没有这一条，上面三条就能被「把基线调大」轻易绕过——而那恰恰是最坏的用法：
 * 数字看着在管着，实际一路放水。这里要求基线**贴着实测值**（不得高出 5%），
 * 于是「兜底降下来了」必须同步下调基线，进度表才是真的。
 */
test("基线必须贴着实测值，不许留放水余量", () => {
  const slack = (base, actual) => base === 0 ? 0 : (base - actual) / base;
  const rows = [
    ["actionsAllFallback", BASELINE.actionsAllFallback, m.allFb],
    ["actionsAnyFallback", BASELINE.actionsAnyFallback, m.anyFb],
    ["fallbackCues", BASELINE.fallbackCues, m.cues]
  ];
  const stale = rows.filter(([, b, a]) => slack(b, a) > 0.05)
    .map(([k, b, a]) => `${k}: 基线 ${b}，实测 ${a}`);
  assert.deepEqual(stale, [],
    "兜底已经降下来了，但基线还挂在旧值上。把 BASELINE 调到实测值——" +
    "棘轮只有贴着走才有意义。");
});

/** 终点：这条转绿的那天，J1 就达成了。现在它是 skip，不是 fail。 */
test("J1 终点：语料里零兜底", {skip: m.cues > 0 ? `还剩 ${m.cues} 条兜底 cue` : false}, () => {
  assert.equal(m.cues, 0);
});
