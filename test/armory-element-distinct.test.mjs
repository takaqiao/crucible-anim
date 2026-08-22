/**
 * 元素层区分度守卫：12 种伤害类型打在同一个 token 上，画面必须能分辨。
 *
 * 这条测试补的是 test/armory-impact.test.mjs 里 `seen.size >= 5` 那个空洞——12 种类型
 * 只要凑出 5 种不同的 file 它就绿，而实际撞车的方式恰恰不是「file 相同」：
 * eskie.damage.* 八支共用同一套模板动作（小光球 → 扩张光环 → f5 满画面白爆闪 →
 * 类型专属残留），acid.green 与 poison.green 是两个不同的文件、两条不同的 DB 路径，
 * seen.size 照样把它们数成两种，但 ASSET-NOTES 的 acid 行早就写明「0.5 秒里两者的观感
 * 差别基本只剩色相」——它们在屏幕上就是同一个东西。impact.mjs 用 startTime 把 f0-f6
 * 整段裁掉之后这件事更极端了：元素层现在**只播残留段**，色相就是它携带的全部信息。
 *
 * 所以这里分三层判定：
 *   1. 结构层：file + filter.data.hue 的组合不许重复（题面给的判据）。物理三系
 *      bludgeoning/piercing/slashing 是**有意**共用血迹的，不写成豁免、而是写成正向
 *      断言「三者必须完全相同」——豁免只是不拦，正向断言连「谁把血迹改成三条不同素材」
 *      也一起拦住。
 *   2. 选材层：PALETTE 表与 ELEMENT_LAYER 的实际解析逐条对齐，且每条都能无降级解析。
 *      表一旦陈旧就红，下面一层依赖的 family/colour/lab 才不会是纸面数字。
 *   3. 感知层：同一个模板家族内部，颜色分支不许复用；且残留主色的 CIEDE2000 不得低于
 *      MIN_DELTA_E。跨家族不做色差判定——形状本身已经把它们分开了（物理三系的血溅、
 *      void 的 jb2a.impact.012 暗环，与 eskie 的爆环不是一回事）。
 *
 * lab 这些数字全部来自 tools/element-residual-colour.mjs 对真实 webm 的逐帧解码
 * （libvpx-vp9 解出 alpha 平面，与 tools/contact-sheet.sh 同法），改素材时用那个脚本
 * 重算后同步到本文件。
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {resolve} from "../scripts/resolver/resolve.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import {RESULT} from "../scripts/const.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const actions = JSON.parse(readFileSync(join(ROOT, "test/fixtures/actions.json"), "utf8"));
const base = actions.find(a => a.tags.includes("strike") && a.targets.length);

/** 物理三系：设计上共用同一条血迹。 */
const PHYSICAL = Object.freeze(["bludgeoning", "piercing", "slashing"]);
/** 其余九种：各自必须有独立视觉。 */
const ELEMENTAL = Object.freeze(["fire", "cold", "electricity", "acid", "poison",
                                 "radiant", "psychic", "corruption", "void"]);
const ALL = Object.freeze([...PHYSICAL, ...ELEMENTAL]);

/**
 * 出厂选材 + 实测残留色。
 *
 * parent/colour  拆开写是为了让「同族换色」这件事在表面上可读，并由下面的对齐测试校验
 *                `${parent}.${colour}` 必须逐字等于 ELEMENT_LAYER 用的路径。
 * template       共用同一套模板动作的素材族 id。注意它不等于 parent：eskie.damage 的八支
 *                parent 各不相同（eskie.damage.acid.01 / …poison.01 / …），但它们播的是
 *                同一段动画，只有残留段和色相不同——这正是撞车的成因。
 * lab            残留段 alpha 加权主色的 CIELAB。取样窗口就是这一层实际播出的那一段：
 *                eskie.damage 取 f7-f14（startTime 裁掉 f0-f6 之后剩下的），
 *                jb2a.liquid.splash 与 jb2a.impact.012 取全片（它们不裁）。
 *                只统计 alpha>=64 且 chroma>=20 的像素（把模板自带的那帧纯白爆闪与亮核
 *                排除掉，它对所有类型都一样、不携带身份信息）。
 */
const PALETTE = Object.freeze({
  bludgeoning: {parent: "jb2a.liquid.splash", colour: "red", template: "jb2a.liquid.splash",
                lab: [15.6, 32.8, 20.4]},
  piercing:    {parent: "jb2a.liquid.splash", colour: "red", template: "jb2a.liquid.splash",
                lab: [15.6, 32.8, 20.4]},
  slashing:    {parent: "jb2a.liquid.splash", colour: "red", template: "jb2a.liquid.splash",
                lab: [15.6, 32.8, 20.4]},
  fire:        {parent: "eskie.damage.fire.01", colour: "orange", template: "eskie.damage.01",
                lab: [76.8, 15.3, 66.7]},
  cold:        {parent: "eskie.damage.cold.01", colour: "blue", template: "eskie.damage.01",
                lab: [88.8, -14.4, -15.6]},
  electricity: {parent: "eskie.damage.electricity.01", colour: "blue", template: "eskie.damage.01",
                lab: [74.8, -7.4, -36.5]},
  acid:        {parent: "eskie.damage.acid.01", colour: "green", template: "eskie.damage.01",
                lab: [91.1, -57.7, 70.7]},
  poison:      {parent: "eskie.damage.poison.01", colour: "purple", template: "eskie.damage.01",
                lab: [48.7, 77.3, -76.2]},
  radiant:     {parent: "eskie.damage.radiant.01", colour: "yellow", template: "eskie.damage.01",
                lab: [94.9, -10.9, 49.8]},
  psychic:     {parent: "eskie.damage.psychic.01", colour: "pink", template: "eskie.damage.01",
                lab: [59.5, 73.8, -53.8]},
  corruption:  {parent: "eskie.damage.necrotic.01", colour: "teal", template: "eskie.damage.01",
                lab: [91.4, -50.7, 17.4]},
  void:        {parent: "jb2a.impact.012", colour: "dark_purple", template: "jb2a.impact.012",
                lab: [35.8, 73.7, -77.8]}
});

/**
 * 同族色分离阈值（CIEDE2000，残留主色）。取 11.5 的理由是三个实测锚点：
 *    9.7  acid.green / poison.green      —— 本轮认定为真撞车、已经修掉的那一对
 *   10.8  poison.green / radiant.yellow  —— 同一次修复顺带解掉的第二紧的一对
 *   12.4  poison.purple / psychic.pink   —— 修完之后同族里仍然最紧的一对
 * 阈值必须落在 (10.8, 12.4]：低于 10.8，把 poison 改回 green 时第二紧那一对不会变红；
 * 高于 12.4，出厂配置自己就是红的。11.5 两边各留 0.7-0.9 的余量。
 *
 * 注意这是**刻意的脆性**：往后任何一次元素层换色都可能触到它，那正是它存在的意义——
 * 换色必须重新量一次残留主色，而不是凭文件名觉得「紫色和粉色应该分得开」。
 */
const MIN_DELTA_E = 11.5;

/**
 * 同族同色分支的记名豁免。只能变小不能变大（下面有锁）。每条都必须说明为什么「同族只剩
 * 色相能分」这条通则在这一对上不成立，并给出实测依据。
 */
const SAME_TEMPLATE_ALLOWED = Object.freeze([
  Object.freeze({
    pair: Object.freeze(["cold", "electricity"]),
    /*
     * 两支都只有 blue 可用，这是死局而不是懒：
     *   electricity 的另外两支 —— purple 对 psychic.pink 的残留主色 ΔE00 只有 5.3、
     *     yellow 对 radiant.yellow 只有 3.4，都远差于现状；
     *   cold 的另外两支 —— white 的残留主色 Lab 是 [97.2,-7.5,-3.0]（近乎纯白），与模板
     *     自带的白爆闪撞死，ASSET-NOTES cold 行原话「冷伤绝不能选 white」；darkpurple
     *     裁掉 f0-f6 之后在暗底上**完全看不见**（合成到 0x1a1a1a 后亮度抬升 ≥40 的像素
     *     占比 f7-f14 恒为 0.0%，与已进否决清单的 necrotic.black 同类），而且它对
     *     psychic.darkpurple 的 ΔE00 只有 7.3。
     *   radiant 只有 yellow/rainbow、corruption 借用的 necrotic 只有 black/teal
     *     （black 在否决清单里），两支都锁死，也让不出 yellow / teal 这两个坑位。
     * 允许它们共用 blue 的实据是**残留形状差异足够大，不靠色相也分得开**：
     *   · 残留主色 ΔE00 实测 14.3，本来就在 MIN_DELTA_E 之上，这条豁免只解除「同色分支
     *     不许复用」那一条结构规则；
     *   · 残留段 f7-f14 的 alpha 平面 PSNR 只有 12.3 dB，是 eskie.damage 八支两两之间
     *     最低（最不像）的一对；被判定为真撞车的 acid/poison.green 反而是 14.5 dB。
     *   · 逐帧也对得上：electricity 从 f7 起球体整个消失、只剩几道稀疏电弧（全帧 alpha
     *     均值 40.4→15.0→3.5→0.05），cold 反而在 f8-f11 把冰晶簇堆到最厚（42.2→29.6）。
     * 想彻底拆开只能把 electricity 挪出 eskie.damage 家族（候选 jb2a.impact.011.blue），
     * 但那要新开一条 ASSET-NOTES 记录并单独配时长（011 的 f24/f26/f29 各回闪一次，
     * 不裁会被读成「打了好几下」），本轮不做。
     */
    evidence: "residual alpha-plane PSNR 12.3 dB (lowest of the eight), residual ΔE00 14.3"
  })
]);

/* -------------------------------------------------- */
/*  CIEDE2000                                          */
/* -------------------------------------------------- */

/**
 * CIEDE2000 色差。用它而不是 HSV 色相角之差，是因为色相角在感知上远不均匀：
 * acid.green 与 poison.green 的残留主色色相差 25°、cold.blue 与 electricity.blue 差 14°，
 * 按色相角排 acid/poison 反而「更安全」，与 ASSET-NOTES 实际看图得出的结论正好相反；
 * 换成 CIEDE2000 之后 acid/poison 是 9.7、cold/electricity 是 14.3，排序才与人眼一致。
 */
function ciede2000([L1, a1, b1], [L2, a2, b2]) {
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const A1 = (1 + G) * a1, A2 = (1 + G) * a2;
  const Cp1 = Math.hypot(A1, b1), Cp2 = Math.hypot(A2, b2);
  const ang = (x, y) => (x === 0 && y === 0) ? 0 : ((Math.atan2(y, x) / rad) + 360) % 360;
  const h1 = ang(A1, b1), h2 = ang(A2, b2);
  const dL = L2 - L1, dC = Cp2 - Cp1;
  let dh = 0;
  if (Cp1 * Cp2 !== 0) { dh = h2 - h1; if (dh > 180) dh -= 360; if (dh < -180) dh += 360; }
  const dH = 2 * Math.sqrt(Cp1 * Cp2) * Math.sin((dh / 2) * rad);
  const Lb = (L1 + L2) / 2, Cbp = (Cp1 + Cp2) / 2;
  let hb;
  if (Cp1 * Cp2 === 0) hb = h1 + h2;
  else { hb = (h1 + h2) / 2; if (Math.abs(h1 - h2) > 180) hb += (h1 + h2 < 360) ? 180 : -180; }
  const T = 1 - 0.17 * Math.cos((hb - 30) * rad) + 0.24 * Math.cos(2 * hb * rad)
              + 0.32 * Math.cos((3 * hb + 6) * rad) - 0.20 * Math.cos((4 * hb - 63) * rad);
  const dTh = 30 * Math.exp(-(((hb - 275) / 25) ** 2));
  const Rc = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const Sl = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2);
  const Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTh * rad) * Rc;
  return Math.sqrt((dL / Sl) ** 2 + (dC / Sc) ** 2 + (dH / Sh) ** 2 + Rt * (dC / Sc) * (dH / Sh));
}

/* -------------------------------------------------- */
/*  取样                                               */
/* -------------------------------------------------- */

/** 解析某个伤害类型在 HIT 下的元素层 cue。 */
function elementCue(damageType) {
  const s = {
    ...base, usage: {...base.usage, damageType},
    targets: [{...base.targets[0], results: [{result: RESULT.HIT, critical: false}],
               damage: {total: 8, type: damageType, resource: "health"}}]
  };
  const cues = resolve(s, {assets: createAssets(offlineBackend(index)), armory: ARMORY}).cues;
  return cues.find(c => c.slot === "impact" && c.layer === "element");
}

/** 题面给的判据：视觉身份 = file 与色相旋转的组合。 */
const visualKey = c => `${c.file}|${c.filter?.data?.hue ?? 0}`;

/* -------------------------------------------------- */
/*  1. 结构层                                          */
/* -------------------------------------------------- */

test("12 种伤害类型都拿得到元素层", () => {
  for (const d of ALL) assert.ok(elementCue(d)?.file, `伤害类型 ${d} 无元素层素材`);
});

test("物理三系共用同一条血迹——是设计，所以正向钉死而不是豁免", () => {
  const keys = PHYSICAL.map(d => visualKey(elementCue(d)));
  assert.equal(new Set(keys).size, 1,
    `bludgeoning/piercing/slashing 应当共用同一条血迹，实际有 ${new Set(keys).size} 种：\n${keys.join("\n")}`);
});

test("其余九种伤害类型的 file+hue 两两不重复", () => {
  const seen = new Map();
  const dup = [];
  for (const d of ELEMENTAL) {
    const k = visualKey(elementCue(d));
    if (seen.has(k)) dup.push(`${seen.get(k)} 与 ${d} 解析到完全相同的视觉：${k}`);
    else seen.set(k, d);
  }
  assert.deepEqual(dup, [], dup.join("\n"));
  assert.equal(seen.size, ELEMENTAL.length);
});

test("元素层与物理血迹之间也不许重合", () => {
  const blood = visualKey(elementCue("bludgeoning"));
  for (const d of ELEMENTAL) {
    assert.notEqual(visualKey(elementCue(d)), blood, `${d} 与物理血迹撞车`);
  }
});

/* -------------------------------------------------- */
/*  2. 选材层：PALETTE 不许陈旧                        */
/* -------------------------------------------------- */

test("PALETTE 表与 ELEMENT_LAYER 的实际解析逐条对齐，且都能无降级解析", () => {
  for (const d of ALL) {
    const {parent, colour} = PALETTE[d];
    const path = `${parent}.${colour}`;
    const assets = createAssets(offlineBackend(index));

    assert.ok(assets.colorsUnder(parent).includes(colour),
      `${d}: ${parent} 下没有 ${colour} 分支——颜色段是 bestFit 编出来的，不是真分支`);

    const r = assets.resolve(path);
    assert.ok(r, `${d}: ${path} 解析失败`);
    assert.equal(r.path, path, `${d}: ${path} 被降级/尾段被吞成了 ${r.path}`);
    assert.equal(assets.warnings.length, 0, `${d}: ${path} 解析留下了降级警告`);

    assert.equal(elementCue(d).file, r.file,
      `${d}: ELEMENT_LAYER 换了素材，但本文件的 PALETTE 没跟着改——`
      + `下面的同族色差判定会拿着过期的 lab 数字放行。`
      + `请用 tools/element-residual-colour.mjs 重算并同步 parent/colour/template/lab。`);
  }
});

/* -------------------------------------------------- */
/*  3. 感知层：同模板家族内部                          */
/* -------------------------------------------------- */

/** 一对类型是否被记名豁免。 */
function allowed(a, b) {
  return SAME_TEMPLATE_ALLOWED.some(e => e.pair.includes(a) && e.pair.includes(b));
}

test("同一个模板家族内部，颜色分支不许复用", () => {
  // 物理三系整组共用一条素材，已由上面的正向断言管住，这里只看九种元素。
  const bad = [];
  for (let i = 0; i < ELEMENTAL.length; i++) {
    for (let j = i + 1; j < ELEMENTAL.length; j++) {
      const a = ELEMENTAL[i], b = ELEMENTAL[j];
      if (PALETTE[a].template !== PALETTE[b].template) continue;
      if (PALETTE[a].colour !== PALETTE[b].colour) continue;
      if (allowed(a, b)) continue;
      bad.push(`${a} 与 ${b} 同属模板 ${PALETTE[a].template} 且同取 ${PALETTE[a].colour} 分支`
             + `——同族动画只有色相能区分（见 ASSET-NOTES 的 acid 行）`);
    }
  }
  assert.deepEqual(bad, [], bad.join("\n"));
});

test(`同一个模板家族内部，残留主色的 CIEDE2000 不得低于 ${MIN_DELTA_E}`, () => {
  const bad = [];
  for (let i = 0; i < ELEMENTAL.length; i++) {
    for (let j = i + 1; j < ELEMENTAL.length; j++) {
      const a = ELEMENTAL[i], b = ELEMENTAL[j];
      if (PALETTE[a].template !== PALETTE[b].template) continue;
      const d = ciede2000(PALETTE[a].lab, PALETTE[b].lab);
      if (d < MIN_DELTA_E) {
        bad.push(`${a} 对 ${b}：ΔE00 = ${d.toFixed(1)} < ${MIN_DELTA_E}`
               + `（同属模板 ${PALETTE[a].template}，形状一样，只剩色相能区分）`);
      }
    }
  }
  assert.deepEqual(bad, [], bad.join("\n"));
});

test("被豁免的那一对必须仍然构成撞车——豁免不许挂在已经拆开的组合上", () => {
  // 反向锁：如果哪天 cold/electricity 被真正拆到两个颜色分支上，这条会红，逼着把豁免
  // 条目删掉，而不是让一条无意义的豁免长期留在表里稀释这道守卫。
  for (const e of SAME_TEMPLATE_ALLOWED) {
    const [a, b] = e.pair;
    const sameTemplate = PALETTE[a].template === PALETTE[b].template;
    const sameColour = PALETTE[a].colour === PALETTE[b].colour;
    const tooClose = ciede2000(PALETTE[a].lab, PALETTE[b].lab) < MIN_DELTA_E;
    assert.ok(sameTemplate && (sameColour || tooClose),
      `${a}/${b} 已经不构成撞车了，请删掉 SAME_TEMPLATE_ALLOWED 里的这条豁免`);
  }
});

test("SAME_TEMPLATE_ALLOWED 只能变小：条目数与内容锁死为当前已知的 1 条", () => {
  const KNOWN = [["cold", "electricity"]];
  assert.equal(SAME_TEMPLATE_ALLOWED.length, KNOWN.length,
    `豁免表有 ${SAME_TEMPLATE_ALLOWED.length} 条，超过已知的 ${KNOWN.length} 条`
    + `——新增豁免要走评审，不能随手加。`);
  assert.deepEqual(SAME_TEMPLATE_ALLOWED.map(e => [...e.pair].sort()), KNOWN.map(p => [...p].sort()));
  for (const e of SAME_TEMPLATE_ALLOWED) {
    assert.ok(e.evidence && e.evidence.length > 20, `豁免 ${e.pair.join("/")} 没写实测依据`);
    for (const t of e.pair) assert.ok(PALETTE[t], `豁免里的 ${t} 不是已知伤害类型`);
  }
});
