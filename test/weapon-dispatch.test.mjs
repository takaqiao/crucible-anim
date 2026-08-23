/**
 * 武器派发 —— V2 线 A 的进度表，同时是回归闸门。
 *
 * ## 语料
 *
 * `test/fixtures/weapon-strikes.json`：Crucible 的 **92 件武器**（equipment +
 * adversary-equipment 两个包枚举得来，见 `tools/dump-weapons.mjs`）各一份平打快照。
 * 「每件武器都有为它选的画面」里的「每件」就是这 92 件，定义域必须来自枚举而不是
 * 手写清单——本项目已经在「本机装了哪些模块」上栽过一次。
 *
 * ## 2026-08-23 的起点
 *
 * | | |
 * | --- | --- |
 * | 92 件武器命中的不同 travel 素材 | **6 个** |
 * | 最大碰撞桶 | **20 件**共用同一段短剑挥砍 |
 * | 完全不出 travel cue | **14 件**（5 面盾 + 9 件法器） |
 *
 * 那 20 件里有 `giantBeak`（巨喙）、`greathammer`（巨锤）、`greatsword`（巨剑）、
 * `chainHook`（链钩）——巨喙啄击播的是一段短剑横斩。8 件远程武器（手弩/手枪/重弩/
 * 吹箭/箭刺/投石索/长弓/短弓）共用同一支蓝色箭矢。
 *
 * ## 规矩
 *
 * 与兜底棘轮同一套：**只许变好不许变坏**，而且基线要贴着实测值（不许留放水余量），
 * 于是「又配好一批」必须同步调基线，数字本身就是进度。
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
const weapons = JSON.parse(readFileSync(join(ROOT, "data/weapons.json"), "utf8"));
const corpus = JSON.parse(readFileSync(join(ROOT, "test/fixtures/weapon-strikes.json"), "utf8"));
const mk = () => createAssets(offlineBackend(index));

/** 目标：silent → 0，distinctTravel → 上升，biggestBucket → 下降。 */
const BASELINE = Object.freeze({
  silent: 14,          // 一条 travel cue 都不出的武器数
  distinctTravel: 6,   // 92 件武器命中的不同 travel 素材数
  biggestBucket: 20    // 最大的一个「多件武器共用同一素材」桶
});

function measure() {
  const files = new Map();
  const silent = [];
  for (const s of corpus) {
    const plan = resolve(s, {assets: mk(), armory: ARMORY});
    const travel = (plan?.cues ?? []).filter(c => c.slot === "travel" && c.file);
    if (!travel.length) { silent.push(s.id); continue; }
    files.set(s.id, travel[0].file);
  }
  const buckets = new Map();
  for (const [id, f] of files) {
    if (!buckets.has(f)) buckets.set(f, []);
    buckets.get(f).push(id);
  }
  const biggest = [...buckets.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  return {silent, distinct: buckets.size, biggest, buckets};
}

const m = measure();

test("武器语料就是 data/weapons.json 的全集", () => {
  assert.equal(corpus.length, weapons.count,
    `武器语料 ${corpus.length} 份，但枚举出来是 ${weapons.count} 件。` +
    "语料是 `npm run fixtures` 生成的，重跑一次。");
  assert.ok(weapons.count >= 90, `只枚举到 ${weapons.count} 件武器，包路径是不是变了？`);
  // 定义域必须逐件对上，不能只对数量——数量相同而内容错位是最难发现的一种坏
  const want = new Set(weapons.weapons.map(w => `weapon:${w.category}:${w.identifier}`));
  const got = new Set(corpus.map(s => s.id));
  assert.deepEqual([...want].filter(x => !got.has(x)), [], "枚举里有、语料里没有的武器");
});

test("武器棘轮：不出 travel cue 的武器只许减不许增", () => {
  assert.ok(m.silent.length <= BASELINE.silent,
    `不出 travel cue 的武器从 ${BASELINE.silent} 涨到 ${m.silent.length}：` +
    m.silent.slice(0, 12).join(", "));
});

test("武器棘轮：不同 travel 素材数只许增不许减", () => {
  assert.ok(m.distinct >= BASELINE.distinctTravel,
    `92 件武器命中的不同素材从 ${BASELINE.distinctTravel} 掉到 ${m.distinct}——` +
    "有规则被写宽了，把本来分开的武器又并到一起了。");
});

test("武器棘轮：最大碰撞桶只许缩不许涨", () => {
  assert.ok(m.biggest.length <= BASELINE.biggestBucket,
    `最大碰撞桶从 ${BASELINE.biggestBucket} 涨到 ${m.biggest.length} 件：` +
    m.biggest.slice(0, 10).map(x => x.split(":")[2]).join(", "));
});

/**
 * 基线不许虚高。没有这一条，上面三条都能被「把基线调松」绕过——而那正是最坏的用法：
 * 数字看着在管着，实际一路放水。
 */
test("武器基线必须贴着实测值", () => {
  const stale = [];
  if (BASELINE.silent - m.silent.length > 2) stale.push(`silent: 基线 ${BASELINE.silent}，实测 ${m.silent.length}`);
  if (m.distinct - BASELINE.distinctTravel > 2) stale.push(`distinctTravel: 基线 ${BASELINE.distinctTravel}，实测 ${m.distinct}`);
  if (BASELINE.biggestBucket - m.biggest.length > 2) stale.push(`biggestBucket: 基线 ${BASELINE.biggestBucket}，实测 ${m.biggest.length}`);
  assert.deepEqual(stale, [],
    "武器派发已经变好了，但基线还挂在旧值上。把 BASELINE 调到实测值——棘轮只有贴着走才有意义。");
});

/** 终点：这条转绿的那天，线 A 的 travel 部分就做完了。现在是 skip，不是 fail。 */
test("线 A 终点：92 件武器没有一件是哑的", {skip: m.silent.length ? `还有 ${m.silent.length} 件不出画面` : false}, () => {
  assert.equal(m.silent.length, 0);
});
