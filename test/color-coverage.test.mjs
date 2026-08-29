/**
 * D6 —— COLOR_HUE 的**覆盖率**守卫。
 *
 * ## 为什么要单开一条覆盖率守卫
 *
 * `palette.test.mjs` 已经守着「表里的每个键都在 DB 里存在」（可达性）。那是**只出不进**
 * 的方向：它挡得住写错的色名，挡不住**漏掉**的色名。而漏掉的代价比写错大得多——
 * `pickColor` 的第一句是 `colorsUnder(path).filter(c => c in COLOR_HUE)`，表里没有的分支
 * **根本不进候选集**。所以一个色名没补进来，表现不是「选色差一点」，而是那支素材对整个
 * 兵库不可见：改造前 `jb2a.melee_attack.03.greataxe.02` 的 9 个色支只有 4 支进候选，
 * `jb2a.melee_attack.03.magical_greatsword` 的候选集**是空的**（附魔巨剑的颜色轴整条失效）。
 *
 * 本文件的四条断言全部是 `palette.mjs` + `data/asset-index.json` 的**纯函数**，
 * 不 resolve 任何动作，因此不受兵库规则改动的影响——它守的是「色表认不认得出素材库」。
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {COLOR_HUE, pickColor} from "../scripts/resolver/palette.mjs";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const {tree} = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const known = new Set(Object.keys(COLOR_HUE));

/** 树里的每个内部节点及其（去掉下划线元数据后的）子段名。 */
function nodes() {
  const out = [];
  (function walk(node, path) {
    if (Array.isArray(node) || typeof node !== "object" || node === null) return;
    const kids = Object.keys(node).filter(k => !k.startsWith("_"));
    if (kids.length) out.push({path, kids});
    for (const k of kids) walk(node[k], path ? `${path}.${k}` : k);
  })(tree, "");
  return out;
}

/**
 * 「色层节点」＝ 子段里至少有一个是已知色名的节点。
 *
 * 这个判据是**自举**的（用当前的 COLOR_HUE 去认颜色），所以它只能量「已经认出来的那些
 * 节点里还漏了多少」，不能用来发现整族都不认识的节点——后者由下面第三条的色词正则守。
 * 两条判据故意用不同的算法，一条塌了另一条还在。
 */
function colorNodes() {
  return nodes().filter(n => n.kids.some(k => known.has(k)));
}

test("D6 覆盖率：色层节点的子段有 ≥96% 能进 pickColor 的候选集", () => {
  const ns = colorNodes();
  assert.ok(ns.length >= 1800, `色层节点只剩 ${ns.length} 个，索引是不是换了？`);
  let total = 0, survive = 0;
  for (const {kids} of ns) {
    total += kids.length;
    survive += kids.filter(k => known.has(k)).length;
  }
  const rate = survive / total;
  // 补全前实测 6784/8394 = 80.8%，补全后 8502/8700 = 97.7%。剩下的 2.3% 是**故意**
  // 不收的：站在颜色分支位置上但不是颜色的段名（`01`/`02` 变体号、`loop`/`still_frame`
  // 形态、`fire`/`earth`/`water` 题材）——把它们塞进色表会让灰阶兜底把一记挥击选成
  // `still_frame`。判据是「这个段名是不是在说颜色」，不是「它是不是站在颜色那一层」。
  assert.ok(rate >= 0.96,
    `候选存活率掉到 ${(rate * 100).toFixed(1)}%（下限 96%，补全前是 80.8%）——` +
    "有一批色名从 COLOR_HUE 里掉了，那些素材分支已经对兵库不可见了。");
});

test("D6 覆盖率：候选集被压到 ≤2 支的塌陷节点 ≤32 个", () => {
  const bad = [];
  for (const {path, kids} of colorNodes()) {
    const ok = kids.filter(k => known.has(k)).length;
    if (ok <= 2 && kids.length > ok) bad.push(`${path}（${kids.length} 支 → ${ok} 支）`);
  }
  // 补全前 130 个，补全后 28 个。「塌陷」是最贵的一种漏：整族只剩一两支可选时，
  // 元素轴直接失效（jb2a.claws 曾经 8 支只剩 2 支，10 件元素爪击全塌成同一支）。
  assert.ok(bad.length <= 32,
    `塌陷节点从 28 涨到 ${bad.length} 个：\n  ` + bad.slice(0, 15).join("\n  "));
});

test("D6 覆盖率：DB 里看起来是颜色的段名，一个都不许不在 COLOR_HUE 里", () => {
  // 独立的第二套判据：不看「有没有已知色名做邻居」，直接用色词正则认。
  // 这一条是**给素材包升级用的**——jb2a / eskie 加一批新色支时它会先红，
  // 提醒把新色名补进 COLOR_HUE，而不是等到某族的元素轴悄悄塌掉才发现。
  const BASE = "red|orange|yellow|green|teal|blue|purple|pink|white|black|grey|gray|brown|" +
               "cyan|azure|violet|gold|tan|magenta|indigo|silver|sandstone|rainbow|" +
               "multicolor(?:ed)?|colorless";
  const RE = new RegExp(`^(?:dark_?|light|bright_)?(?:${BASE})(?:_?(?:${BASE}))?[0-9]{0,2}$`, "i");
  const HY = new RegExp(`^(?:${BASE})-(?:${BASE})$`, "i");
  const miss = new Map();
  for (const {kids} of nodes()) {
    for (const k of kids) {
      if (!known.has(k) && (RE.test(k) || HY.test(k))) miss.set(k, (miss.get(k) ?? 0) + 1);
    }
  }
  assert.deepEqual([...miss.keys()].sort(), [],
    `${miss.size} 个色名不在 COLOR_HUE 里，用到它们的素材分支进不了 pickColor 的候选集：\n  ` +
    [...miss].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}（${n} 处）`).join("\n  "));
});

test("D6：灰阶 want 绝不落到 rainbow / multicolored 上", () => {
  const assets = createAssets(offlineBackend(index()));
  // 实测踩过的那一条：`RUNE_COLOR.kinesis` 改成 white 之后，锥形喷吐选到了
  // `BreathWeapon_Fire01_Regular_MultiColor01`——一道彩虹龙息。rainbow / multicolored
  // 与 white / grey 一样记 -1（都没有单一色相），但**多彩不是无彩的近似**。
  const MULTI = /^(rainbow|multicolor)/;
  const bad = [];
  for (const {path, kids} of colorNodes()) {
    if (!kids.some(k => MULTI.test(k))) continue;
    // 整族只有多彩可选时返回多彩是对的（那是素材本来的样子）。只有在**还有别的候选**
    // 时选了多彩，才是选错。
    if (!kids.some(k => known.has(k) && !MULTI.test(k))) continue;
    for (const want of ["white", "grey"]) {
      const got = pickColor(assets, path, want).color;
      if (got && MULTI.test(got)) bad.push(`${path} want=${want} → ${got}`);
    }
  }
  assert.deepEqual(bad, [], `灰阶兜底选中了多彩分支：\n  ${bad.join("\n  ")}`);

  /*
   * ⚠ 上面那段全库扫描**今天是空真的**：DB 里凡是「多彩 + 别的颜色」并存的节点，多彩都
   * 恰好没排在第一位，所以把「多彩排最后」这条规则删掉它也不会红。空真的守卫等于没有，
   * 所以这里再钉一个**合成候选集**——顺序由本测试自己控制，直接量 pickColor 的判据本身。
   * 三种 want 各走一条不同的分支：白走灰阶兜底、未知色名走 `target === undefined` 兜底、
   * 而 `best` 的初值决定循环里全是 -1 时的答案。
   */
  const fake = {colorsUnder: () => ["rainbow", "white", "blue"]};
  assert.equal(pickColor(fake, "x", "white").color, "white", "有 white 时必须精确命中");
  const onlyMulti = {colorsUnder: () => ["multicolored", "blue"]};
  assert.equal(pickColor(onlyMulti, "x", "white").color, "blue",
    "没有灰阶可选时也不许退回多彩——一道彩虹是任何单色的最差近似");
  assert.equal(pickColor(onlyMulti, "x", "这不是颜色").color, "blue",
    "未知 want 的兜底同样不许选多彩");
  const greyless = {colorsUnder: () => ["rainbow", "grey"]};
  assert.equal(pickColor(greyless, "x", "white").color, "grey", "灰阶兜底优先挑真·无彩");
  const nothingElse = {colorsUnder: () => ["rainbow"]};
  assert.equal(pickColor(nothingElse, "x", "white").color, "rainbow",
    "整族只有多彩时返回多彩是对的——那是素材本来的样子，不是选错");
});

function index() {
  return JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
}

test("D6：COLOR_HUE 里不许混进「不是颜色」的段名", () => {
  // 反方向的守卫。补全色名时最容易犯的错不是漏，而是把**站在颜色那一层但不是颜色**的
  // 段名一起收进来——它们进表之后就成了候选集成员，灰阶兜底的 `available[0]` 会把
  // 一记挥击选成 `still_frame`、把施法圈选成 `loop`。
  const NOT_COLORS = /^(\d+|loop|still_frame|standard|single|textured|unlit|reversed|dark|earth|fire|water|frost|ice|sound|boulder|rock|ground_crack|shrapnel|square|physical|magical)$/;
  const bad = Object.keys(COLOR_HUE).filter(k => NOT_COLORS.test(k));
  assert.deepEqual(bad, [], `这些不是颜色，不该进 COLOR_HUE：${bad.join(", ")}`);
});

test("D6：双色名的值＝最短中点，或（近乎对立时）首色", () => {
  // 表里的双色名是照一条规则算出来的，不是逐个拍脑袋定的。这条守卫把规则本身钉住，
  // 免得后来补的条目各写各的。规则见 palette.mjs 的 COLOR_HUE 注释：
  // 取两色的最短色相中点；色相差 >150°（中点会落到与两色都无关的第三色上）时取首色。
  const BASES = ["red", "orange", "yellow", "green", "teal", "blue", "purple", "pink", "brown"];
  const bad = [];
  for (const [name, hue] of Object.entries(COLOR_HUE)) {
    if (hue < 0) continue;
    const m = name.match(new RegExp(`^(${BASES.join("|")})(${BASES.join("|")})$`));
    if (!m) continue;
    const [, a, b] = m;
    const ha = COLOR_HUE[a], hb = COLOR_HUE[b];
    let d = (hb - ha) % 360;
    if (d > 180) d -= 360;
    if (d < -180) d += 360;
    const mid = ((ha + d / 2) % 360 + 360) % 360;
    // 容差 8°：历史条目取的是圆整过的值（orangepurple 340 vs 中点 332.5、
    // bluepurple 250 vs 245、orangered 10 vs 15），不是精确中点。
    const near = x => Math.min(Math.abs(hue - x), 360 - Math.abs(hue - x)) <= 8;
    // 历史条目 blueyellow 235 是唯一的例外：Δ=160 走对立分支该取蓝 215，实际值是
    // 「取蓝再朝黄偏 20°」。它是 storm 的主色，改了会让 storm 的最近色跳到黄绿，不动。
    if (name === "blueyellow") continue;
    if (!(near(mid) || near(ha))) {
      bad.push(`${name}=${hue}：${a}=${ha} / ${b}=${hb}，中点 ${mid.toFixed(1)}，Δ=${Math.abs(d)}`);
    }
  }
  assert.deepEqual(bad, [], `双色名没按规则取值：\n  ${bad.join("\n  ")}`);
});
