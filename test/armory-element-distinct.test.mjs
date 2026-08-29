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
 *      bludgeoning/piercing/slashing 从前**有意**共用一条血迹，这里写的是正向断言
 *      「三者必须完全相同」；批次 D1 按施工清单 §0.15 把它翻案了，现在的正向断言反了
 *      过来——**三者必须解析到三条不同素材**。方向变了，「正向钉死而不是豁免」这条
 *      写法没变：豁免只是不拦，正向断言连「谁把它们又合并回一条」也一起拦住。
 *   2. 选材层：PALETTE 表与 ELEMENT_LAYER 的实际解析逐条对齐，且每条都能无降级解析。
 *      表一旦陈旧就红，下面一层依赖的 family/colour/lab 才不会是纸面数字。
 *   3. 感知层：同一个模板家族内部，颜色分支不许复用；且残留主色的 CIEDE2000 不得低于
 *      MIN_DELTA_E。跨家族不做色差判定——形状本身已经把它们分开了（void 的
 *      jb2a.impact.012 暗环与 eskie 的爆环不是一回事）。
 *      **物理三系是这一层里唯一一组按形状判的**：三支同模板、同为 red（物理伤害共用血色
 *      语义是设计），残留主色 ΔE00 只有 4.0/5.3/9.0，颜色阈值对它们必然不成立。施工清单
 *      拍板 #11 的原话是「必须显式登记『物理三系靠形状而非颜色区分』并为这三键改 shape
 *      判据，不能默认继承也不能默认豁免」——落地成下面的 SHAPE_JUDGED + SHAPE_MEASURED：
 *      跳过颜色判定的同时，用两条独立的形状量测顶上，两侧都不留空。
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
import {ciede2000} from "../tools/element-residual-colour.mjs";
import {RESULT} from "../scripts/const.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const actions = JSON.parse(readFileSync(join(ROOT, "test/fixtures/actions.json"), "utf8"));
const base = actions.find(a => a.tags.includes("strike") && a.targets.length);

/**
 * 物理三系：批次 D1 之前共用同一条血迹（jb2a.liquid.splash.red），现在三支各有各的
 * eskie.damage.*.01.red，靠**形状**而不是颜色区分。见 SHAPE_MEASURED。
 */
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
 *                eskie.damage 取 f7-f14（startTime 裁掉 f0-f6 之后剩下的，D1 之后物理
 *                三系也在其内），jb2a.impact.012 取全片（它不裁）。
 *                只统计 alpha>=64 且 chroma>=20 的像素（把模板自带的那帧纯白爆闪与亮核
 *                排除掉，它对所有类型都一样、不携带身份信息）。
 */
const PALETTE = Object.freeze({
  // 物理三系（D1）：同模板 eskie.damage.01、同色 red，三支的 lab 彼此只差 4.0-9.0 ΔE00
  // ——它们不靠颜色分，靠形状分，见 SHAPE_JUDGED / SHAPE_MEASURED。lab 照样记：跨组
  // （物理 vs 九种元素）仍然由颜色判定管着，最紧的一对是 bludgeoning/psychic 的 30.6。
  bludgeoning: {parent: "eskie.damage.bludgeoning.01", colour: "red", template: "eskie.damage.01",
                lab: [54.3, 66.1, 29.5]},
  piercing:    {parent: "eskie.damage.piercing.01", colour: "red", template: "eskie.damage.01",
                lab: [51.0, 71.5, 40.1]},
  slashing:    {parent: "eskie.damage.slashing.01", colour: "red", template: "eskie.damage.01",
                lab: [49.7, 73.2, 49.4]},
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
 * 【按形状判定的那一组】（施工清单 §0.15 / 拍板 #11 / 批次 D1）
 *
 * 组内两两之间**跳过颜色判定、改判形状**；组内对组外仍然照常判颜色。现在只有物理三系
 * 一组，加第二组要走评审（下面有条数锁）。
 *
 * 为什么它们必须跳过颜色：三支是 `eskie.damage.{slashing,piercing,bludgeoning}.01.red`
 * ——同一套模板动作、同一个 red 色轴。同色是**设计**（物理伤害共用血色语义，ASSET-NOTES
 * 主表 225-227 行逐行写着），不是选材偷懒；代价是残留主色 CIEDE2000 实测只有
 * 4.0（斩/刺）、5.3（刺/钝）、9.0（斩/钝），拿 MIN_DELTA_E=11.5 去量它们必然全红。
 * 但**不能就这么豁免掉**：豁免只是不拦，那样「谁把三支换成三条一模一样的素材」也不会红。
 * 所以这一组换一把尺子量，两条独立的形状量测都要过。
 */
const SHAPE_JUDGED = Object.freeze([Object.freeze(["bludgeoning", "piercing", "slashing"])]);

/**
 * 形状区分度实测（批次 D1 量的，配方写在下面，换素材必须重量）。
 *
 * 配方：用 `tools/element-residual-colour.mjs` 的 `decode()` 解出 RGBA 帧（VP9+alpha，
 * 必须显式指定 libvpx-vp9，默认解码器不出 alpha 平面），取**这一层实际播出的那一段**
 * f7-f14，然后算两个互相独立的量：
 *
 *   iou      逐帧 alpha≥64 掩膜的交并比累加（∑交 / ∑并）。回答「两支的亮处落在不落在
 *            同一批像素上」。越小越不像。
 *   radialL1 以画幅中心为极点、按 r/R 分 6 桶的 alpha 质量分布（归一化后逐桶取 |差| 求和）。
 *            回答「两支的物质堆在不同的半径上没有」。越大越不像。
 *
 * 为什么两条一起判（**与**，不是或）：单独任何一条都有已知反例。IoU 对这种稀疏残留天然
 * 偏乐观（八成画幅是空的，随手两支都能拿到 0.3 上下）；径向分布对同心构图偏乐观
 * （cold/poison 的 IoU 高达 0.623、肉眼几乎同一团，径向 L1 却有 0.274）。两条都要过，
 * 才谈得上「靠形状分得开」。
 *
 * 实测值（同模板九种元素那 10 对是标尺，一并列出以便对照）：
 *   物理三系   斩/刺 iou 0.354 L1 0.466 ｜ 斩/钝 iou 0.310 L1 0.322 ｜ 刺/钝 iou 0.382 L1 0.310
 *   最像的一对 cold/poison    iou 0.623 L1 0.274   ← 两条判据里 IoU 这条拦下它
 *   次像的一对 fire/cold      iou 0.434 L1 0.226   ← 两条都拦得下
 *   已记名可分 cold/electricity iou 0.273 L1 0.911
 * 读图对照（ASSET-NOTES 主表，f8 残留帧）：斩=一道长斜划线；刺=一圈朝外的短箭状尖刺；
 * 钝=一团四芒星火花绕成螺旋。量出来的数与看图看到的是同一件事。
 */
const SHAPE_MEASURED = Object.freeze({
  "bludgeoning|piercing": Object.freeze({iou: 0.382, radialL1: 0.310}),
  "bludgeoning|slashing": Object.freeze({iou: 0.310, radialL1: 0.322}),
  "piercing|slashing":    Object.freeze({iou: 0.354, radialL1: 0.466})
});

/**
 * 形状分离阈值。两条都必须过。
 *
 * MAX_IOU 0.42：三对实测 0.310/0.354/0.382，余量 0.038-0.110；同模板里最像的两对
 *   （cold/poison 0.623、fire/cold 0.434）都在这条线之上，也就是说这条线真的拦得住
 *   「换了个看起来一样的」。
 * MIN_RADIAL_L1 0.25：三对实测 0.310/0.322/0.466，余量 0.06-0.216；最像的一对
 *   fire/cold 只有 0.226，在线下。
 * 两个数都刻意留窄余量——它们和 MIN_DELTA_E 一样是**刻意的脆性**：换素材就得重新量，
 * 不许凭「一个是划线一个是尖刺，应该分得开」下断言。
 */
const SHAPE_MAX_IOU = 0.42;
const SHAPE_MIN_RADIAL_L1 = 0.25;

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

/*
 * CIEDE2000 从 tools/element-residual-colour.mjs import（见文件顶部），全仓只此一份实现，
 * test/armory-persist-distinct.test.mjs 也用同一份。本文件早先内联过一份逐字相同的拷贝
 * （已用括号配对提取后逐字符 diff 确认相同），两处各改一次就会悄悄分叉，而分叉的后果是
 * 两条守卫对「算不算同一个颜色」给出不同答案。
 *
 * 用它而不是 HSV 色相角之差，是因为色相角在感知上远不均匀：acid.green 与 poison.green
 * 的残留主色色相差 25°、cold.blue 与 electricity.blue 差 14°，按色相角排 acid/poison 反而
 * 「更安全」，与 ASSET-NOTES 实际看图得出的结论正好相反；换成 CIEDE2000 之后 acid/poison
 * 是 9.7、cold/electricity 是 14.3，排序才与人眼一致。
 */

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

test("物理三系必须是三条不同素材——D1 把「共用一条血迹」翻案了，反向正向钉死", () => {
  // 从前这里断言的是「三者完全相同」（共用 jb2a.liquid.splash.red 是设计）。施工清单
  // §0.15 推翻了那个前提：impact/element 那个 82 的最大桶就是这三键叠出来的，等于
  // 66/92 件武器的命中层逐字相同，巨剑劈中与匕首刺中一个像素都不差。
  // 这条断言是本轮 KPI 的钉子：谁把三键改回同一条素材，这里当场红。
  const keys = PHYSICAL.map(d => visualKey(elementCue(d)));
  assert.equal(new Set(keys).size, PHYSICAL.length,
    `bludgeoning/piercing/slashing 必须各有各的素材，实际只有 ${new Set(keys).size} 种：\n${keys.join("\n")}`);
  const files = PHYSICAL.map(d => elementCue(d).file);
  assert.equal(new Set(files).size, PHYSICAL.length,
    `三键的 file 必须互不相同（判据独立算自文件名，不看 hue）：\n${files.join("\n")}`);
});

test("按形状判定的那一组：两条独立形状量测都要过", () => {
  const bad = [];
  for (const group of SHAPE_JUDGED) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const [a, b] = [group[i], group[j]].sort();
        const m = SHAPE_MEASURED[`${a}|${b}`];
        if (!m) { bad.push(`${a}/${b}：SHAPE_MEASURED 里没有这一对的实测——形状判据是空的`); continue; }
        if (!(m.iou <= SHAPE_MAX_IOU)) {
          bad.push(`${a}/${b}：alpha 掩膜 IoU ${m.iou} > ${SHAPE_MAX_IOU}——两支的亮处压在同一批像素上`);
        }
        if (!(m.radialL1 >= SHAPE_MIN_RADIAL_L1)) {
          bad.push(`${a}/${b}：径向质量分布 L1 ${m.radialL1} < ${SHAPE_MIN_RADIAL_L1}`
                 + `——物质堆在同一批半径上，只是纹理不同`);
        }
      }
    }
  }
  assert.deepEqual(bad, [], bad.join("\n"));
});

test("形状组只能变小，且组内必须真的同模板同色——否则该回去判颜色", () => {
  // 反向锁，与 SAME_TEMPLATE_ALLOWED 那条同理：形状判据是「颜色这把尺子在这一组上不成立」
  // 的替代品，一旦某组不再同模板同色，它就该回到颜色判定，而不是长期挂着一条更宽松的尺子。
  const KNOWN = [["bludgeoning", "piercing", "slashing"]];
  assert.deepEqual(SHAPE_JUDGED.map(g => [...g].sort()), KNOWN.map(g => [...g].sort()),
    "形状判定组变了——新增一组要走评审（施工清单拍板 #11 是逐条裁定的，不是通用出口）");
  for (const group of SHAPE_JUDGED) {
    for (const d of group) assert.ok(PALETTE[d], `形状组里的 ${d} 不是已知伤害类型`);
    const tpl = new Set(group.map(d => PALETTE[d].template));
    const col = new Set(group.map(d => PALETTE[d].colour));
    assert.equal(tpl.size, 1, `${group.join("/")} 已经不同模板了，颜色判据重新成立，请把这组删掉`);
    assert.equal(col.size, 1, `${group.join("/")} 已经不同色了，颜色判据重新成立，请把这组删掉`);
  }
});

test("12 种伤害类型的 file+hue 两两不重复", () => {
  // D1 之前这条只能覆盖九种元素（物理三系故意共用一条素材，进来就红），物理与元素之间
  // 的撞车另写了一条。现在 12 键各有各的素材，两条合成一条，覆盖面反而更大。
  const seen = new Map();
  const dup = [];
  for (const d of ALL) {
    const k = visualKey(elementCue(d));
    if (seen.has(k)) dup.push(`${seen.get(k)} 与 ${d} 解析到完全相同的视觉：${k}`);
    else seen.set(k, d);
  }
  assert.deepEqual(dup, [], dup.join("\n"));
  assert.equal(seen.size, ALL.length);
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

/** 这一对是不是同属某个「按形状判定」的组——是的话下面两条颜色判据对它们不适用。 */
function shapeJudged(a, b) {
  return SHAPE_JUDGED.some(g => g.includes(a) && g.includes(b));
}

test("同一个模板家族内部，颜色分支不许复用", () => {
  // D1 之后物理三系与八支元素同属 eskie.damage.01 模板，所以这里从九种扩到 12 种全量：
  // 物理对元素那 24 对是新增覆盖（三支 red 对上八种色轴，一对都不许撞）。组内那三对走
  // 形状判据，由上面那条测试管。
  const bad = [];
  for (let i = 0; i < ALL.length; i++) {
    for (let j = i + 1; j < ALL.length; j++) {
      const a = ALL[i], b = ALL[j];
      if (shapeJudged(a, b)) continue;
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
  // 同上扩到 12 种全量。物理三系对九种元素最紧的一对是 bludgeoning/psychic 30.6，
  // 离阈值很远——跨组仍然由颜色管着，只有组内那三对（4.0/5.3/9.0）改判形状。
  const bad = [];
  for (let i = 0; i < ALL.length; i++) {
    for (let j = i + 1; j < ALL.length; j++) {
      const a = ALL[i], b = ALL[j];
      if (shapeJudged(a, b)) continue;
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
