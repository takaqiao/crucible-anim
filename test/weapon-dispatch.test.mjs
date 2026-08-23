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
 * ## 2026-08-23 第三轮之后
 *
 * ⚠ **本轮换过度量口径**：`distinctTravel` 从「不同文件数」改成「不同 DB 路径数」。
 * 原口径把变体随机性当成了派发区分度——`ctx.pick` 在同一节点的 4 个变体里按种子取一个，
 * 于是「短剑类武器都落在 shortsword」这**一个**决策被算成 4 种素材。所以下表第三列的
 * 43 与第二列的 58 **不可直接比较**，43 才是真实的「兵库做了多少种不同的选择」。
 *
 * | | 起点 | 一轮 | 二轮 | 三轮 |
 * | --- | --- | --- | --- | --- |
 * | 不同 travel 素材（旧口径·文件） | 6 | 43 | 58 | — |
 * | 不同 travel 路径（新口径） | — | — | — | **43** |
 * | 最大碰撞桶 | 20 | 8 | 6 | **6** |
 * | 哑的武器 | 14 | 5 | 0 | **0** ✅ |
 *
 * 三轮做的：突刺武器（刺剑/短击剑/细身匕/长矛/标枪/骑枪）改用
 * `jb2a.melee_generic.piercing.*`——早先说的「素材库里没有突刺动画」是错的，只是找错了族。
 *
 * 剩下的四个大桶**都是语义正确的复用**：6 个物理爪、5 个物理咬、5 件单手突刺、5 面盾。
 *
 * ## 起点
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
  silent: 0,           // 一条 travel cue 都不出的武器数 —— **已归零**
  distinctTravel: 43,  // 92 件武器命中的不同 travel **DB 路径**数（不是文件数，见 buildFileToPath）
  // 6 → 7：`unarmed/claws` 也接进了爪痕路由（此前掉在徒手那支拳影上）。桶变大是
  // **正确的复用**——7 件都是物理爪，共用同一张爪痕本来就对。
  biggestBucket: 7     // 最大的一个「多件武器共用同一路径」桶
});

/**
 * 文件 → 它所在的 DB 节点路径。
 *
 * **不能拿文件数当派发区分度。** `ctx.pick` 会在同一个节点的变体数组里按种子随机取一个
 * （短剑那一支有 4 个变体 = 4 种挥击方向），于是「所有短剑类武器都落在 shortsword」这
 * **一个**派发决策，会被文件计数算成 4 种不同素材。初版棘轮正是这么数的，结果是：把 6 件
 * 突刺武器从「散落在短剑/木棒/巨剑的随机变体上」改成「统一刺出去」——一个明确的改进——
 * 反而让数字从 58 掉到 57，棘轮报了假警。
 *
 * 按节点路径数就没有这个问题：它数的是「兵库做了多少种不同的选择」，正是这条棘轮想说的。
 */
function buildFileToPath() {
  const out = new Map();
  const walk = (node, path) => {
    if (typeof node === "string") { out.set(node, path); return; }
    if (Array.isArray(node)) { for (const f of node) if (typeof f === "string") out.set(f, path); return; }
    if (node && typeof node === "object") {
      for (const k of Object.keys(node)) if (!k.startsWith("_")) walk(node[k], path ? `${path}.${k}` : k);
    }
  };
  walk(index.tree, "");
  return out;
}
const FILE_TO_PATH = buildFileToPath();

function measure() {
  const files = new Map();
  const silent = [];
  for (const s of corpus) {
    const plan = resolve(s, {assets: mk(), armory: ARMORY});
    const travel = (plan?.cues ?? []).filter(c => c.slot === "travel" && c.file);
    if (!travel.length) { silent.push(s.id); continue; }
    // 记的是派发到哪个 DB 节点，不是随机到哪个变体文件（见 buildFileToPath）
    files.set(s.id, FILE_TO_PATH.get(travel[0].file) ?? travel[0].file);
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
