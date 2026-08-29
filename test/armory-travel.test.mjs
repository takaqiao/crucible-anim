import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {resolve} from "../scripts/resolver/resolve.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import travel from "../scripts/armory/travel.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const actions = JSON.parse(readFileSync(join(ROOT, "test/fixtures/actions.json"), "utf8"));
const mk = () => createAssets(offlineBackend(index));
const byId = id => actions.find(a => a.id === id);
/**
 * travel 槽的**画面** cue。音效 cue 另走 `travelSounds`——它们排在画面之前
（见 armory/travel.mjs 里对 parallelizeTargets 顺序的说明），拿 `[0]` 会取到声音。
 */
const travelCues = s => resolve(s, {assets: mk(), armory: ARMORY})?.cues
  .filter(c => c.slot === "travel" && c.kind !== "sound") ?? [];

/** travel 槽的音效 cue。 */
const travelSounds = s => resolve(s, {assets: mk(), armory: ARMORY})?.cues
  .filter(c => c.slot === "travel" && c.kind === "sound") ?? [];

/**
 * 砍成单目标。
 *
 * 交棒点在计划里有两种表示法：单目标是 `waitUntilFinished`（相对片尾的负偏移），
 * ≥2 目标会被 `resolver/resolve.mjs` 的 `parallelizeTargets` 改写成下一槽 cue 上的
 * **绝对 delay**——那是在修「线性队列让两个目标的挥击排队、首目标血溅迟到中位 503ms」
 * 的实战 bug。语料里的快照一律带 2 个目标，所以要断言规则自己写的那个负偏移常数，
 * 得先把目标砍到 1 个。
 *
 * 断言规则常数用这个；要断言「实际交棒时刻」请直接读绝对 delay，别绕回相对式。
 */
const oneTarget = s => ({...s, targets: s.targets.slice(0, 1)});

const melee = () => ({
  ...byId("strike"),
  strikes: [{category: "balanced1", damageType: "slashing"}],
  usage: {...byId("strike").usage, isAttack: true, isRanged: false}
});

test("规则表规模与 id 唯一", () => {
  assert.ok(travel.length >= 10, `只有 ${travel.length} 条规则`);
  const ids = travel.map(r => r.id);
  assert.equal(new Set(ids).size, ids.length);
});

test("射线姿态用 stretchTo 且带模板遮罩", () => {
  const c = travelCues(byId("spell.frost.ray"))[0];
  assert.equal(c?.rule, "spell.gesture.ray");
  assert.ok(c.stretchTo, "射线必须 stretchTo");
  assert.equal(c.mask, "region", "射线必须用模板遮罩，否则会溢出");
});

test("锥形姿态贴合模板张角", () => {
  const c = travelCues(byId("spell.flame.cone"))[0];
  assert.equal(c?.rule, "spell.gesture.cone");
  assert.ok(c.stretchTo);
  assert.equal(c.mask, "region");
});

/**
 * 近战的「够得着」现在是**几何量**，不再靠换一支更大的素材来假装。
 *
 * 旧断言是 `notEqual(a.file, b.file)`——「贴身与隔格应换素材，否则长度对不上」。
 * 那守的是改造前的做法：贴身用武器自己的形制、隔格一律换成野太刀（全族唯一 1000×800、
 * 弧幅够得到隔一格的一支），本质是**拿画幅冒充长度**。代价是施工清单 §0.14 记的那条——
 * **48 件真能够到的近战武器塌成同一记野太刀下劈**，武器身份在隔格时全部丢失。
 *
 * 批次 B 之后握把锚在施法者、刀锋锚在目标，长度由 `scale = 中心距（格）` 表达，
 * 与画幅无关（`.scale(d)` 让握手→刀锋恰好 d 格，代数已在批次 B 验过）。于是
 * **同一支素材能同时服务贴身与隔格**，武器身份得以保留——这正是要的结果。
 *
 * 新判据因此比旧的更强：不是「换不换素材」，而是**长度必须真的跟着距离走**。
 */
test("近战的够得着由 scale 表达，不靠换素材冒充", () => {
  const base = melee();
  const near = {...base, targets: [base.targets.find(t => t.adjacent)]};
  const far = {...base, targets: [base.targets.find(t => !t.adjacent)]};
  const a = travelCues(near)[0];
  const b = travelCues(far)[0];
  assert.ok(a && b);
  assert.ok(a.scale > 0 && b.scale > 0, "两档都必须给出正的 scale");
  assert.ok(b.scale > a.scale,
    `隔格的 scale（${b.scale}）必须大于贴身（${a.scale}）——长度是距离的函数。`
    + "两者相等说明 scale 退化成常数，刀锋不会落在目标身上。");
  // 反过来钉住「别再退回换素材那条路」：同一件武器在两档下**应当**是同一个形制，
  // 换掉就说明武器身份又在隔格时被丢了（§0.14）。
  assert.equal(a.file, b.file,
    "同一件武器在贴身与隔格应当用同一支形制素材——换素材就是又回到「拿画幅冒充长度」，"
    + "48 件够得到的近战武器会再次塌成同一记野太刀下劈");
});

/**
 * 挥击的朝向从此由「锚源 → 瞄目标」这条真旋转表达，镜像退出方向职责。
 *
 * 旧断言是「目标在左侧时 mirrorY 为真」。那守的是**错几何**：改造前 `at` 与 `aim.towards`
 * 是同一个目标，`play.mjs` 的 `rotates` 恒 false、一次都不转向，于是 SW/W/NW 三个方向只能
 * 靠翻转贴图冒充「打向左边」，其余五个方向连冒充都做不到（施工清单 §0.2：8 个罗盘方向朝向
 * 恒 0°）。新判据比旧的**更强**：不是放宽成「镜像随便」，而是要求方向由 at→aim 承担，
 * 并**反过来**钉住「镜像不许再随左右翻」——回退到旧实现时这条会红。
 */
test("挥击的方向由锚源→瞄目标承担，镜像不再跟着左右翻", () => {
  const base = melee();
  const left = {...base, targets: [{...base.targets[0], onLeft: true, x: 300}]};
  const right = {...base, targets: [{...base.targets[0], onLeft: false, x: 700}]};
  const l = travelCues(left)[0], r = travelCues(right)[0];
  for (const [name, c, s] of [["左", l, left], ["右", r, right]]) {
    assert.equal(c.at.ref, "origin", `${name}：挥击必须锚在施法者，at 与 aim 同点就转不起来`);
    assert.deepEqual([c.at.x, c.at.y], [s.origin.x, s.origin.y], `${name}：锚点是施法者中心`);
    assert.deepEqual([c.aim.towards.x, c.aim.towards.y], [s.targets[0].x, s.targets[0].y],
      `${name}：瞄准点是这一击自己的目标`);
    assert.ok(c.template, `${name}：「锚点＝握把」靠素材模板表达，template 不许为空`);
  }
  assert.equal(l.mirrorY, r.mirrorY,
    "镜像不许再随 onLeft 翻——方向由 at→aim 的旋转表达，翻转只负责变体多样性");
});

/**
 * 尺寸：`scale` = 中心距（格），换算过素材自己的授权网格。
 *
 * 旧断言（objectScale 1.4 / offset 0.5 格 / 隔格折半）守的同样是错几何——那三个数
 * 全都建立在「贴图中心压在目标身上、再沿屏幕 +x 推一点」之上。新判据要求的性质更强：
 * **握把落在施法者中心、刀锋落在目标中心**，于是尺寸只能是距离的函数，体型自动含在
 * 距离里（3×3 的施法者中心离贴身目标中心就是更远），不需要再乘 1.4。
 */
test("挥击尺寸随中心距连续变化，偏移整族退休", () => {
  const base = melee();
  // ⚠ 合成大体型必须 width 与 w 一起改：tokenGeom 的构造式是 w = width * gridSize，
  // 只改 width 会让「一格多少像素」被算成 33.3px（gridPxOf 靠这两者相除还原格宽）。
  const big = {...base.origin, width: 3, height: 3, w: 300, h: 300, radiusPx: 150};
  const at = (t, patch) => ({...base, ...patch, targets: [{...base.targets[0], ...t}]});
  const near = travelCues(at({adjacent: true, x: 600}, {}))[0];       // 中心距 1 格
  const far = travelCues(at({adjacent: false, x: 900}, {}))[0];       // 中心距 4 格
  const bigNear = travelCues(at({adjacent: true, x: 600}, {origin: big}))[0];

  // shortsword 的模板是 [200,300,300]、跨距 1 格；播放层不下发 gridSize（play-contract
  // 的「不许下发 gridSize」钉死了这条），所以 scale 要把 200px 的授权网格换算回 100。
  assert.equal(near.scale, 0.5, "贴身：中心距 1 格 × 100 / 授权网格 200");
  assert.equal(far.scale, 2, "隔格：中心距 4 格（500→900），刀锋照样落在目标中心");
  assert.ok(far.scale > near.scale, "尺寸必须随距离连续变化，不是贴身/隔格两档");
  // 大体型贴身：施法者 3×3、目标仍在 (600,500)，中心距还是 1 格 —— 体型已经含在距离里，
  // 不该再额外乘一个 1.4（乘了刀锋就越过目标 40%）。
  assert.equal(bigNear.scale, near.scale, "体型不再另乘系数，尺寸只由中心距决定");

  for (const [name, c] of [["贴身", near], ["隔格", far], ["大体型", bigNear]]) {
    assert.deepEqual(c.offset, {x: 0, y: 0},
      `${name}：偏移必须归零——它活在旋转之后的坐标系里，锚点定对之后再推就是纯错位`);
    assert.equal(c.gridUnits, false, `${name}：没有偏移就不该再声明格单位`);
    assert.ok(c.template, `${name}：scale 的换算要用模板的授权网格，template 不许为空`);
  }
});

test("未命中时投射物走 missed", () => {
  const s = {...byId("spell.storm.arrow")};
  s.targets = [{...byId("strike").targets[0], results: [{result: 0, critical: false}]}];
  const c = travelCues(s)[0];
  assert.equal(c.rule, "spell.gesture.arrow",
    "未命中断言必须钉死在 arrow 规则上，否则 generic.travel 兜底会顶替它蒙混过关");
  assert.equal(c.aim?.missed, true);
});

/**
 * 【2026-08-29 翻案】原断言是「爆发姿态**没有**飞行段，cues.length === 0」。
 *
 * 那条是把「blast 没有飞行轨迹」误写成了「blast 在 travel 槽什么都不出」。施工清单 §0.13
 * 点名的正是这个后果：**blast 一条 travel cue 都不出**，于是 12 条爆发法术在画面上只剩
 * impact 的白闪——爆炸本体从来没有被画出来过。
 *
 * 正确的性质是：blast **没有从施法者飞向目标的那一段**（不 stretchTo、不锚在施法者），
 * 但它**必须**在爆心出一份爆炸本体，而且因为爆炸只有一个、不该按目标数叠 N 份，
 * 所以它是 `once`。
 */
test("爆发姿态出爆炸本体但没有飞行段", () => {
  const cues = travelCues(byId("spell.death.blast"));
  assert.equal(cues.length, 1, "blast 必须出且只出一份爆炸本体（once，不按目标数叠）");
  const c = cues[0];
  assert.equal(c.rule, "spell.gesture.blast");
  assert.ok(!c.stretchTo, "爆发没有飞行轨迹，不该 stretchTo");
  assert.notEqual(c.at?.ref, "origin",
    "爆炸锚在爆心（模板），不是施法者身上——锚错了会在施法者脚下炸");
});

test("travel 规则不引用绝对路径", () => {
  const src = readFileSync(join(ROOT, "scripts/armory/travel.mjs"), "utf8");
  assert.ok(!src.includes("modules/"));
});

/* ================================================================
 * 以下三组是 Task 10 的修复回归锁。
 *
 * 注意本文件上半部分的既有用例一律取 travelCues(...)[0]：第二条起会被静默丢掉，
 * 区域特效按目标重复渲染时它们全绿——全文件原本唯一的数量断言是 blast 的
 * length === 0。所以下面凡是数量断言都先确认 fixture 真的是多目标。
 * ================================================================ */

/** 素材条目的全部变体文件；用它断言"这条 cue 用的是这一家素材"而不必写死磁盘路径。 */
const filesOf = p => mk().resolve(p)?.files ?? [];
/** 只留一个目标，避免两个目标的 cue 互相干扰。 */
const one = (s, patch = {}) => ({...s, targets: [{...s.targets[0], ...patch}]});
/** 就地改 region，不动 test/fixtures/actions.json（理由见「模板几何」一组的说明）。 */
const withRegion = (id, patch) => {
  const base = byId(id);
  return {...base, region: {...base.region, ...patch}};
};
/** 模板类特效与目标无关，必须恰好一条；顺带把「多目标叠 N 条」钉死。 */
const onlyCue = s => {
  const cues = travelCues(s);
  assert.equal(cues.length, 1, `模板类特效应只出一条，实得 ${cues.length}`);
  return cues[0];
};
const planOf = s => resolve(s, {assets: mk(), armory: ARMORY});

const unarmed = () => one({
  ...byId("strike"),
  strikes: [{category: "unarmed", damageType: "bludgeoning"}],
  usage: {...byId("strike").usage, isAttack: true, isRanged: false}
});

/**
 * 真实形态的投掷攻击快照。
 *
 * fixture 里 4 个 thrown 动作的 strikes 恒为 []——tools/dump-fixtures.mjs 只对
 * tags 含 "strike" 的动作合成 strikes，而 compendium 里这些天赋的原始 tags 只有
 * ["melee","thrown"]。真实运行时不是这样：Crucible 的 ActionTags 里 thrown
 * propagate 到 melee、melee 再 propagate 到 strike，strike.prepare() 的
 * `if (!strikes.length && this.usage.weapon) strikes.push(...)` 会把手上那把匕首塞进
 * usage.strikes，snapshot.mjs 原样取用——所以真实的投掷匕首带 category "light1"；
 * 又因为匕首不属于 ranged 类别，usage.isRanged 是 false。这个 fixture 盲区正好掩盖了
 * strike.melee 抢走投掷的实战 bug。
 */
const thrownReal = () => one({
  ...byId("flashOfSteel"),
  tags: ["thrown", "melee", "strike"],
  strikes: [{category: "light1", damageType: "piercing"}],
  usage: {...byId("flashOfSteel").usage, isAttack: true, isRanged: false}
});

/* ---- 一、once（每动作一次）机制的回归锁 ---------------------------------- */

/**
 * 锚点是**冻结的模板坐标**（travel.mjs 的 templateAnchor，ref:"point"）的规则。
 * 其余 once 规则用 resolve.mjs 的默认施法者锚点（ref:"origin" + 施法者 tokenId/坐标）。
 */
const TEMPLATE_ANCHORED = new Set(["spell.gesture.ray", "spell.gesture.cone",
                                   // surge 本轮也搬到了模板上：锚点是线段中点（施工清单 §0.11）
                                   "spell.gesture.surge"]);

/** fixture 里各姿态的代表动作。断言前先确认它们真的是多目标，否则数量断言测不出重复。 */
const ONCE_CASES = [
  ["spell.frost.ray", "spell.gesture.ray"],
  ["spell.flame.cone", "spell.gesture.cone"],
  ["spell.flame.pulse", "spell.gesture.pulse"],
  ["spell.death.surge", "spell.gesture.surge"]
];

test("区域与自身姿态每个动作只出一条 travel cue", () => {
  for (const [id, ruleId] of ONCE_CASES) {
    const s = byId(id);
    assert.ok(s, `fixture 缺少 ${id}`);
    assert.ok(s.targets.length > 1,
      `${id} 的 fixture 只有 ${s.targets.length} 个目标，这条数量断言就测不出按目标重复`);
    const cues = travelCues(s);
    assert.equal(cues.length, 1,
      `${id} 应只出 1 条 travel cue，实际 ${cues.length} 条——区域特效被按目标各画了一份`);
    assert.equal(cues[0].rule, ruleId);
  }
});

test("投射物与近战仍然每个目标一份", () => {
  // 【2026-08-30 换样本】第二个样本原本是 `spell.flame.strike` / `generic.travel`。
  //
  // 两处都过期了：`strike` 手势现在有专属规则（`spell.gesture.strike`，施工清单 §0.10 的后半段
  // ——它是「借手上的武器施法」，画面是一记染符文色的附魔剑挥砍，**不是飞行物**）；
  // 而 `generic.travel` 至此**一条「每目标一份的飞行段」都不再产出**——原先落在它那儿的
  // 84 条法术已全部被 batch C 的六个手势规则 + 本条 strike 规则接管。
  //
  // 换成 `strike.thrown`：它仍然是**每目标一份 + 锚施法者 + stretchTo 到各自目标**，
  // 与 arrow 分属两条不同规则，这条守卫要验的性质一个不少。
  for (const [id, ruleId] of [["spell.storm.arrow", "spell.gesture.arrow"],
                              ["flashOfSteel", "strike.thrown"]]) {
    const s = byId(id);
    const cues = travelCues(s);
    assert.equal(cues.length, s.targets.length,
      `${id} 有 ${s.targets.length} 个目标就该有 ${s.targets.length} 份飞行段，实际 ${cues.length}`);
    assert.equal(cues[0].rule, ruleId);
    assert.deepEqual(cues.map(c => c.forTarget), s.targets.map(t => t.tokenId),
      "每目标规则的 cue 必须逐一对应各自的目标");
    // 飞行段的锚点在施法者、拉伸终点才是各自的目标：at 与 stretchTo 若是同一个坐标，
    // Sequencer 的 stretchTo 就是一条零长射线（sequencer.js:16248-16252 弹红色报错、
    // 16966-16985 把 spriteScale 算成 0 → sprite.scale.set(0,0)），箭直接看不见。
    for (const [i, c] of cues.entries()) {
      assert.equal(c.at.ref, "origin", `${id} 第 ${i} 条飞行段没有锚在施法者`);
      assert.equal(c.at.tokenId, s.origin.tokenId, `${id} 第 ${i} 条飞行段的锚点不是施法者`);
      assert.deepEqual({x: c.stretchTo.x, y: c.stretchTo.y},
                       {x: s.targets[i].x, y: s.targets[i].y},
                       `${id} 第 ${i} 条飞行段没有拉到各自的目标`);
      assert.ok(Math.hypot(c.stretchTo.x - c.at.x, c.stretchTo.y - c.at.y) > 1,
        `${id} 第 ${i} 条飞行段的起点与终点重合，是一条零长射线`);
    }
  }
});

/**
 * surge 的落点从「施法者脚下」搬到**线模板中点**（施工清单 §0.11）。
 *
 * 旧断言是「必须锚在施法者」。那条守的是**错几何**：surge 的模板是一条 15 尺 × 10 尺的
 * 直线区域（`TARGET_TYPES.ray`，shape:"line" + `shape.width = size * d`），而规则连 at
 * 都没写、走 once 的默认施法者锚点，画面是脚下一团径向爆闪——上线以来没有一次落点是对的。
 * 新判据更强：不是「随便锚哪」，而是锚点必须**跟着 region 走**（换一份 region 就得跟着换），
 * 且必须用 sizePx 而不是 objectScale 表达大小。
 */
test("自身爆发锚在线模板中点、按模板出尺寸，且用实测过的时序", () => {
  const s = byId("spell.death.surge");
  const c = travelCues(s)[0];
  assert.equal(c.rule, "spell.gesture.surge");
  assert.equal(c.forTarget, null, "once 规则的 cue 不属于任何单个目标");
  assert.equal(c.aim, null,
    "素材是 center/one_shot 的径向爆闪，没有朝向可言；再 aim 回自己还会退化成 atan2(0,0)");
  assert.equal(c.stretchTo, null, "保守版不拉伸（激进版才走 templateAnchor + stretchTo）");

  // 锚点＝线段中点。region.x/y 是**起点**不是中心，直接拿它会把爆闪摆在杠子的一端。
  assert.equal(c.at.ref, "point", "冻结坐标而不是「施法者」这个身份");
  assert.deepEqual([c.at.x, c.at.y],
    [s.region.x + (s.region.length / 2), s.region.y],
    "rotation=0 时中点在起点正东 length/2 处");
  assert.notDeepEqual([c.at.x, c.at.y], [s.origin.x, s.origin.y],
    "锚点必须真的离开施法者中心，否则等于没改");

  // 尺寸跟模板走：裸点上的 scaleToObject 恒等于「一格」，表达不了 340×200 的区域。
  assert.deepEqual(c.sizePx, {width: s.region.length, height: s.region.width},
    "sizePx 必须是 region 的长 × 宽");
  assert.equal(c.objectScale, 1, "裸点锚上不许再下发 objectScale（播放层会丢弃并 warn）");
  assert.equal(c.mask, "region", "溢出模板的部分要裁掉");
  // ⚠ **反号**：Sequencer 的 `.rotate()` 是 `spriteContainer.rotation =
  // -normalizeRadians(toRadians(angle))`（sequencer.js:16346），传进去的角度被反着用。
  // 旧断言写的是 `c.angle === region.rotation`——那守的是**错的**：贴图会往模板的反方向转。
  // 0/90/180/270 看不出来（矩形足迹在 ±rot 下相同），45/135/225/315 会让贴图长轴与
  // 遮罩长杠交叉，爆闪被裁成中间一小块菱形。所以必须用一个**非直角**的旋转来验。
  assert.equal(c.angle, -(s.region.rotation ?? 0) + 0, "画面朝向必须是模板 rotation 的反号");
  const diag = travelCues(withRegion("spell.death.surge", {rotation: 45}))[0];
  assert.equal(diag.angle, -45,
    "对角线方向才分得出正反号——这条红了说明取反被人改回去了");

  // 锚点跟着 region 走：换一份旋转过的 region，中点必须跟着转（写死坐标会红）
  const turned = withRegion("spell.death.surge", {rotation: 90});
  const t = travelCues(turned)[0];
  assert.deepEqual([t.at.x, t.at.y],
    [turned.region.x, turned.region.y + (turned.region.length / 2)],
    "rotation=90° 时中点应落在起点正南 length/2 处");

  assert.equal(c.startTime, 125, "f0-3 是空帧，必须跳过");
  assert.equal(c.duration, 1125);
  assert.equal(c.selfFlash?.anchor, "origin",
    "line 模板 anchor:\"self\"，线首就在施法者脚下，这团爆闪照样罩着他");
  assert.ok(filesOf("eskie.casting.physical.01.center.one_shot.purple").includes(c.file),
    "death 符文应落到紫色分支");
});

test("自身爆发在没有 region 时退回施法者锚点，而不是掉进蓝箭兜底", () => {
  // ⚠ 实测把 surge 的 region 置 null，本规则今天照样命中；若把 region?.type === "line"
  // 写进 when，它会掉进 pri 10 的 generic.travel，变成每个目标一支蓝箭。
  const s = {...byId("spell.death.surge"), region: null};
  const cues = travelCues(s);
  assert.equal(cues.length, 1, "缺模板也只该出一份（once），不是每目标一支箭");
  const c = cues[0];
  assert.equal(c.rule, "spell.gesture.surge", "缺 region 不许掉进 generic.travel 兜底");
  assert.equal(c.at.ref, "origin", "兜底分支锚回施法者");
  assert.equal(c.sizePx, null, "兜底分支没有模板尺寸可用");
  assert.equal(c.mask, null, "没有 region 就没有遮罩");
  assert.equal(c.objectScale, 1, "兜底分支回到按体型缩放的老写法");
});

test("区域与自身姿态在零目标动作上照样出内容", () => {
  for (const [id, ruleId] of ONCE_CASES) {
    const cues = travelCues({...byId(id), targets: []});
    assert.equal(cues.length, 1,
      `${id} 零目标时仍应出 1 条 travel cue：区域法术没罩住人、自身特效本就没有目标，画面都还在`);
    assert.equal(cues[0].rule, ruleId);
    // ray/cone 的锚点是**冻结的模板坐标**（travel.mjs 的 templateAnchor），用 ref:"point"
    // 保证播放层永不把它升格成施法者 token 的中心；其余 once 规则锚在施法者本人。
    assert.equal(cues[0].at.ref, TEMPLATE_ANCHORED.has(ruleId) ? "point" : "origin");
  }
});

/**
 * 会分层的规则**必须在这里报备层数**。
 *
 * 上限从「每目标 1 条」放宽到「每目标 N 条」时不能含糊——那正是这条守卫要防的
 * 失控生成。报备制的意思是：分层是一个被审过的事实，而不是把上限调松。
 *
 * `strike.melee` 2 层：`empowered`（强力打击）在挥击之上再叠一道逐帧对齐的彩色拖尾。
 * 普通打击仍然只出 1 条，所以这是上限不是常量。
 */
const LAYERED = new Map([
  // 2 层画面（挥击 + empowered 拖尾）+ 2 条音效（风声 + 命中/落空）
  ["strike.melee", 4]
]);

/**
 * `once` 规则的**拼接片数**，同样走报备制。
 *
 * `once` 的语义是「整个动作只出一份画面」，不是「只出一条 cue」——一份画面可以由几片
 * 拼成。放宽这条上限时必须点名到规则并写清**为什么非拼不可**，否则「once 只出一条」
 * 这个不变式就等于被关掉了。
 *
 * · `spell.gesture.fan` 3 片：Crucible 的 fan 张角是 **210°**（`TARGET_TYPES.fan.region.angle`），
 *   而 jb2a 的锥形贴图是 53.13° 的 5e 锥，`coneYScale` 的纵向拉伸上限是 4——
 *   撑到 179° 就已经到顶，210° 无论如何拉不出来（拉伸倍率 `tan(A/2)/0.5` 在 A≥180° 处
 *   发散甚至转负）。所以改用三片各转 ±70° 的锥拼满整个扇面，而不是把一张贴图抻成面条。
 *   三片同素材同时刻，观感上仍是**一份**画面。
 */
const ONCE_PIECES = new Map([
  ["spell.gesture.fan", 3]
]);

test("全量扫描：once 规则不超报备片数，其余规则不超「目标数 × 报备层数」", () => {
  const onceIds = new Set(travel.filter(r => r.once === true).map(r => r.id));
  assert.ok(onceIds.size >= 4, `声明 once 的规则只有 ${onceIds.size} 条，少于区域/自身姿态的条数`);
  // 报备表不许提前透支：登记了却没真的拼那么多片，说明表过期了（或者一开始就写宽了）。
  for (const [rule, pieces] of ONCE_PIECES) {
    assert.ok(onceIds.has(rule), `${rule} 报备了 ${pieces} 片，但它并不是 once 规则`);
    const most = Math.max(0, ...actions.map(s =>
      travelCues(s).filter(c => c.rule === rule).length));
    assert.equal(most, pieces,
      `${rule} 报备 ${pieces} 片，实测最多 ${most} 片——报备制的意思是「分片是被审过的事实」，`
      + "不是把上限调松。数字要贴着实测走。");
  }
  const bad = [];
  for (const s of actions) {
    const n = new Map();
    for (const c of travelCues(s)) n.set(c.rule, (n.get(c.rule) ?? 0) + 1);
    for (const [rule, count] of n) {
      const cap = onceIds.has(rule)
        ? (ONCE_PIECES.get(rule) ?? 1)
        : Math.max(s.targets.length, 1) * (LAYERED.get(rule) ?? 1);
      if (count > cap) bad.push(`${s.id} / ${rule}：${count} 条 > 上限 ${cap}`);
    }
  }
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} 个动作的 travel cue 数超出上限`);
});

/* ---- 二、模板几何：端点朝向与张角 ----------------------------------------
 * 这一组一律**就地合成快照**，不往 test/fixtures/actions.json 里加东西。理由：
 * region.rotation / region.angle 是放置时才定下的运行期数据（Crucible 的
 * dice/action-use-dialog.mjs 按鼠标位置现算再按 directionDelta 吸附），
 * 不是 compendium 里的动作属性；tools/dump-fixtures.mjs 的 TARGET_REGION 因此只能
 * 给每种 target.type 一个规范摆位，434 个 fixture 的 rotation 才会全是 0。往语料里灌
 * 旋转副本既撑大 fixture，又会让 coverage.test.mjs 里按动作数取平均的降级率断言跟着漂；
 * 而这里要验的恰恰是「同一个动作换个摆位」，就地改 region 是最小且最贴题的做法。
 * -------------------------------------------------------------------------- */

/**
 * 模板的**尺寸**（radius / length）从语料现取，不写死。
 *
 * ⚠ 这里从前把 radius 写死成 300、length 写死成 400。那不是在守「端点 = 锥尖 + 方向×半径」
 * 这条几何关系，而是在守「语料恰好是这个数」——`tools/dump-fixtures.mjs` 的 `TARGET_REGION`
 * 一改成按 gesture 复算（radius 650 / length 650），三条断言就整片红，而规则一行没错。
 * 断言该锁的是**关系**，尺寸是输入不是结论。
 */
const regionOf = id => byId(id).region;

test("锥形端点跟着 region.rotation 转", () => {
  // rotation 是度，0=正东，正角度朝 +y；画布 y 向下，所以 90° 指向屏幕下方（正南）。
  // 依据：action-use-dialog.mjs 用 atan2(dy,dx) 写入，vfx/spells.mjs 用 {cos,sin} 消费。
  const {x: ox, y: oy, radius} = regionOf("spell.flame.cone");
  const at = deg => {
    const rad = (deg * Math.PI) / 180;
    const r6 = v => Math.round(v * 1e6) / 1e6;   // 与 travel.mjs 的 r6 同口径
    return {x: r6(ox + (radius * Math.cos(rad))), y: r6(oy + (radius * Math.sin(rad)))};
  };
  for (const rotation of [0, 90, 180, -90, 270, 45]) {
    const c = onlyCue(withRegion("spell.flame.cone", {rotation}));
    assert.deepEqual(c.stretchTo, at(rotation), `rotation=${rotation} 的端点错了`);
  }
  // 四个正交方向必须真的互不相同，否则上面那圈可能在守一个退化成常数的实现
  const ends = [0, 90, 180, 270].map(d => JSON.stringify(at(d)));
  assert.equal(new Set(ends).size, 4, "四个正交方向的端点必须互不相同");
});

test("锥形端点在整圈上都等于 origin + dir(rotation)*radius", () => {
  const {x: ox, y: oy, radius} = regionOf("spell.flame.cone");
  assert.ok(radius > 0, `锥形半径必须为正，实得 ${radius}`);
  let checked = 0;
  for (let deg = 0; deg < 360; deg += 15) {
    const c = onlyCue(withRegion("spell.flame.cone", {rotation: deg}));
    const rad = (deg * Math.PI) / 180;
    assert.ok(Math.abs(c.stretchTo.x - (ox + (radius * Math.cos(rad)))) < 1e-6, `x@${deg}`);
    assert.ok(Math.abs(c.stretchTo.y - (oy + (radius * Math.sin(rad)))) < 1e-6, `y@${deg}`);
    checked++;
  }
  assert.equal(checked, 24, `整圈应核 24 个角度，实核 ${checked}`);
});

test("锥形张角按半宽之比撑 scale.y（60°/120° 在贴图可撑范围内，不触发截断告警）", () => {
  // 贴图是 53.13° 的 5e 锥（600x600 画幅 / _template=[100,0,0] / 抽帧实测斜率 0.49-0.53）。
  // 倍率 = tan(区域半角) / tan(26.565°) = tan(A/2) / 0.5。
  const p60 = planOf(withRegion("spell.flame.cone", {angle: 60}));
  const c60 = p60.cues.filter(x => x.slot === "travel" && x.kind !== "sound")[0];
  assert.equal(c60.scale.x, 1, "scale.x 必须留 1：Sequencer 会拿它去除距离");
  assert.equal(c60.scale.y, 1.154701, "60° 模板要把 53.13° 的贴图撑宽 15%");
  assert.deepEqual(p60.warnings, [], "60° 在贴图可撑范围内，不该有截断告警");

  const p120 = planOf(withRegion("spell.flame.cone", {angle: 120}));
  const c120 = p120.cues.filter(x => x.slot === "travel" && x.kind !== "sound")[0];
  assert.equal(c120.scale.y, 3.464102, "120° 要 tan60/0.5=3.46，角度比 120/60=2 只能撑到 90°");
  assert.deepEqual(p120.warnings, [], "120° 仍在 CONE_YSCALE_MAX=4 以内，不该有截断告警");

  // 贴图自身张角 2·atan(0.5) = 53.130102°，写字面量 53.13 会差到 0.999998，直接算给它
  const cNative = onlyCue(withRegion("spell.flame.cone", {angle: (2 * Math.atan(0.5) * 180) / Math.PI}));
  assert.equal(cNative.scale.y, 1, "正好等于贴图自身张角时不该拉伸");
});

/**
 * ≥180° 防护五点行为锁。tan(A/2) 在 A=180° 处发散为 Infinity、A>180° 时 A/2>90° 使 tan
 * 转负——两者都不能流进 scale.y（Sequencer 拿负/无穷缩放会把贴图翻转或直接崩）。
 * coneYScale 把参与三角函数运算的角度先钳制到 [1°,179°]（179° 是浮点安全上界），
 * 再交给 CONE_YSCALE_MAX=4 的硬上限接管，所以 180°/210°（Crucible 的 fan 张角，见
 * const/action.mjs 的 TARGET_TYPES.fan.region.angle）/360° 都截到同一个安全值 4 并
 * ctx.warn 留痕——180° 起就不再是几何意义上的锥形（半张角达到或超过 90°），钳制上界
 * 是在诚实表达"这份素材只能撑到 179°"，不是伪造一个更宽的画面。
 */
test("张角 60/120/180/210/360 五点锁：scale.y 恒为有限正数，≥180° 截断留痕", () => {
  const cases = [
    {angle: 60, y: 1.154701, warns: false},
    {angle: 120, y: 3.464102, warns: false},
    {angle: 180, y: 4, warns: true},
    {angle: 210, y: 4, warns: true},  // Crucible 的 fan 张角
    {angle: 360, y: 4, warns: true}
  ];
  for (const {angle, y, warns} of cases) {
    const plan = planOf(withRegion("spell.flame.cone", {angle}));
    const c = plan.cues.filter(x => x.slot === "travel" && x.kind !== "sound")[0];
    assert.equal(c.scale.x, 1, `angle=${angle} scale.x 必须为 1`);
    assert.ok(Number.isFinite(c.scale.y), `angle=${angle} scale.y 不能是 NaN/Infinity，实际 ${c.scale.y}`);
    assert.ok(c.scale.y > 0, `angle=${angle} scale.y 不能是负数或 0，实际 ${c.scale.y}`);
    assert.equal(c.scale.y, y, `angle=${angle} scale.y 应为 ${y}`);
    const hasWarn = plan.warnings.some(w => w.includes(String(angle)));
    assert.equal(hasWarn, warns, `angle=${angle} 告警状态应为 ${warns}：${JSON.stringify(plan.warnings)}`);
  }
});

test("张角输入非有限数字（NaN/Infinity/坏字符串）时退回默认 60°，不产生 NaN", () => {
  for (const bad of [NaN, Infinity, -Infinity, "not-a-number"]) {
    const plan = planOf(withRegion("spell.flame.cone", {angle: bad}));
    const c = plan.cues.filter(x => x.slot === "travel" && x.kind !== "sound")[0];
    assert.ok(Number.isFinite(c.scale.y), `angle=${bad} scale.y 不能是 NaN/Infinity，实际 ${c.scale.y}`);
    assert.equal(c.scale.y, 1.154701, `angle=${bad} 应退回默认 60° 的倍率`);
  }
});

test("射线拉到模板端点而不是目标身上", () => {
  // 端点 = 线首 + 方向(rotation) × length。长度从语料现取（理由见 regionOf 的说明）。
  const s = byId("spell.frost.ray");
  const {x: ox, y: oy, length} = s.region;
  assert.ok(length > 0, `射线长度必须为正，实得 ${length}`);
  const r6 = v => Math.round(v * 1e6) / 1e6;
  const at = deg => {
    const rad = (deg * Math.PI) / 180;
    return {x: r6(ox + (length * Math.cos(rad))), y: r6(oy + (length * Math.sin(rad)))};
  };
  const c = onlyCue(s);
  assert.deepEqual(c.stretchTo, at(s.region.rotation ?? 0));
  assert.notDeepEqual(c.stretchTo, {x: s.targets[0].x, y: s.targets[0].y},
    "取目标坐标时光束只拉到模板一半长");
  assert.equal(c.mask, "region", "射线必须用模板遮罩，否则会溢出");
  assert.deepEqual(onlyCue(withRegion("spell.frost.ray", {rotation: 90})).stretchTo, at(90));
  assert.deepEqual(onlyCue(withRegion("spell.frost.ray", {rotation: 135})).stretchTo, at(135));
  assert.deepEqual(onlyCue(withRegion("spell.frost.ray", {length: 700})).stretchTo, {x: 1200, y: 500});
});

test("模板类特效锚在模板起点而不是某个目标身上", () => {
  // 光束/锥形的起点若仍钉在 targets[0]（600,500），端点算对了起点也还在半路上。
  // 规则自带 at 覆盖 resolve.mjs 给 once 规则的默认施法者锚点，把模板坐标一起带上，
  // 并用 ref:"point" 声明「这是冻结坐标，不是施法者这个身份」。
  for (const id of ["spell.frost.ray", "spell.flame.cone"]) {
    const s = byId(id);
    const c = onlyCue(s);
    assert.equal(c.at.ref, "point", id);
    assert.deepEqual({x: c.at.x, y: c.at.y}, {x: s.region.x, y: s.region.y}, id);
    assert.notEqual(c.at.x, s.targets[0].x, "不能锚在第一个目标上");
  }
});

/* ---- 三、原本一条行为测试都没有的六条规则 -------------------------------- */

test("脉冲跟符文色、抹掉硬起手、裁掉空转尾，且随体型放大", () => {
  const s = byId("spell.flame.pulse");
  const c = travelCues(s)[0];
  assert.equal(c?.rule, "spell.gesture.pulse");
  assert.ok(filesOf("eskie.pulse.energy.01.orange").includes(c.file), "flame 应落到橙色分支");
  assert.equal(c.stretchTo, null, "脉冲是原地扩散的环，不能被当成飞行物拉长");
  assert.equal(c.aim, null, "环形径向对称、锚点已在施法者，不该再 rotateTowards 某个目标");
  assert.equal(c.fadeIn, 100, "帧 0 已是完整环，必须用短 fadeIn 抹掉硬弹出");
  assert.equal(c.duration, 634, "f20-22 空转必须裁掉");
  const big = travelCues({...s, origin: {...s.origin, width: 3}})[0];
  assert.ok(big.objectScale > c.objectScale, "大体型施法者的脉冲要放大");
  // 该特效没有 blueyellow 分支：必须取最近色并用 hue 补足，而不是静默丢色
  const storm = travelCues(byId("spell.storm.pulse"))[0];
  assert.ok(filesOf("eskie.pulse.energy.01.blue").includes(storm.file), "storm 应落到最近的蓝色分支");
  assert.equal(storm.filter?.data?.hue, 20, "最近色差必须由 ColorMatrix 补偿");
});

test("法术飞弹用自己的投射物素材，不是远程兜底那一枚", () => {
  const s = oneTarget(byId("spell.storm.arrow"));
  const c = travelCues(s)[0];
  assert.equal(c?.rule, "spell.gesture.arrow");
  assert.ok(filesOf("jb2a.ranged.01.projectile.01.dark_purple.30ft").includes(c.file));
  assert.ok(!filesOf("eskie.attack.ranged.arrow.ray.physical.blue.30ft").includes(c.file),
            "法术飞弹与远程兜底不能是同一枚素材，否则专属规则等于没写");
  assert.equal(c.duration, 1667, "f51-54 空 alpha 必须裁掉");
  assert.equal(c.waitUntilFinished, -1200, "要让下一段紧跟 f14 的自带爆闪");
  assert.equal(c.elevation, s.targets[0].elevation, "飞弹要跟目标的高度");
});

test("拳击三项几何修正齐全，且颜色锁死在 29 帧的安全分支", () => {
  const base = unarmed();
  const c = travelCues(base)[0];
  assert.equal(c?.rule, "strike.unarmed");
  // 素材改了：这条规则现在按**部位**选（见 armory/weapon-shapes.mjs 的 pickFor）——
  // 咬→獠牙大口、爪→抓痕、拳/指虎→拳影弧。改造前 14 个动作共用一支蓝色拳影，
  // `necroticBite`（腐蚀咬击）播的也是它。这里的合成快照是 unarmed 分类无 identifier，
  // 走「拳」那一支。
  assert.ok(filesOf("jb2a.melee_generic.creature_attack.fist.001.red").includes(c.file),
    "徒手默认走拳影弧；换成别的说明部位路由被绕过了");
  // 几何与另外三条近战规则共用 meleeGeom()：锚源、模板握把、scale=中心距、偏移归零。
  // 旧断言（gridUnits / 大体型前移更多 / 目标在左侧要镜像）守的是改造前那套错几何，
  // 已随 offset 与 onLeft 一起退休，详见「挥击尺寸随中心距连续变化」那两条。
  assert.equal(c.at.ref, "origin", "拳击也必须锚在施法者，否则一次都不转向");
  assert.deepEqual(c.offset, {x: 0, y: 0}, "偏移整族归零");
  assert.ok(c.template, "「锚点＝拳锋起点」靠素材模板表达");
  assert.equal(c.scale, 0.5, "贴身一格：1 × 100 / 授权网格 200");
  assert.equal(travelCues(one(base, {onLeft: true, x: 300}))[0].mirrorY, c.mirrorY,
    "镜像不许再随 onLeft 翻");
  // no_hit 只有 blue/yellow 两支，yellow 是 51 帧（1.76 倍）——跟伤害色会把时序表整体拉长
  const radiant = {...base, usage: {...base.usage, damageType: "radiant"}};
  assert.equal(travelCues(radiant)[0].file, c.file, "拳击不跟伤害色，否则 0.97s 的时序会变成 1.70s");
});

test("投掷物靠 stretchTo 自己转向、跳过收势、未命中透传", () => {
  const base = byId("flashOfSteel");
  const right = travelCues(one(base, {onLeft: false, x: 700}))[0];
  const left = travelCues(one(base, {onLeft: true, x: 300}))[0];
  assert.equal(right?.rule, "strike.thrown");
  assert.ok(filesOf("blfx.weapon.range.dagger1.throw1.color1.30ft").includes(right.file));
  // 旧断言是「向左投掷必须镜像」。带 stretchTo 的 cue 由 _applyDistanceScaling
  // （sequencer.js:16992-16994）按 source→target 的射线**自己转向**，朝向从来不需要靠
  // 镜像去凑；mirrorY 翻的是 y 轴，向左投时它把匕首上下颠倒了一次。新判据更强：
  // 两个方向的拉伸终点必须各自落在自己的目标上，且都不许再带镜像。
  for (const [name, c, s] of [["左", left, one(base, {onLeft: true, x: 300})],
                              ["右", right, one(base, {onLeft: false, x: 700})]]) {
    assert.equal(c.mirrorY, false, `${name}：投掷物不许靠镜像表达方向`);
    assert.equal(c.at.ref, "origin", `${name}：起点在投掷者`);
    assert.deepEqual([c.stretchTo.x, c.stretchTo.y], [s.targets[0].x, s.targets[0].y],
      `${name}：终点必须落在自己的目标上`);
  }
  assert.ok(right.template, "blfx ranged 模板 [200,200,200]，首尾各 12.5%·d 的留白要补");
  assert.equal(right.startTime, 533, "f0-16 是向后收势，必须跳过");
  assert.equal(right.duration, 1167, "f51 起归零，必须裁掉");
  const missed = travelCues(one(base, {results: [{result: 1, critical: false}]}))[0];
  assert.equal(missed.aim?.missed, true, "投掷未命中要走 missed 轨迹");
});

test("真实形态的投掷攻击不被近战挥击抢走", () => {
  const s = thrownReal();
  const c = travelCues(s)[0];
  assert.equal(c?.rule, "strike.thrown",
    "带武器 category 的投掷仍须走投掷物；被 strike.melee 抢走就会渲染成挥击弧线");
  assert.ok(filesOf("blfx.weapon.range.dagger1.throw1.color1.30ft").includes(c.file));
  // 同一把匕首不带 thrown 标签时仍应是近战挥击——排除条款不能宽到误伤普通近战
  const swing = travelCues({...s, tags: ["melee", "strike"]})[0];
  assert.equal(swing?.rule, "strike.melee");
});

/**
 * 兜底的真实触发面在本轮变窄了：带武器分类的远程攻击现在归 `strike.ranged.weapon`
 * （弓射箭、弩射弩矢、枪射弹丸），兜底只剩「远程但没有武器」——远程技能、天赋直接
 * 造成的远程效果之类。这条用 `strikes: []` 打的正是那个面。
 */
test("远程兜底给中性箭形，近战兜底不出内容", () => {
  const bow = one({
    ...byId("strike"), tags: ["ranged", "strike"],
    strikes: [],
    usage: {...byId("strike").usage, isAttack: true, isRanged: true}
  });
  const c = travelCues(bow)[0];
  assert.equal(c?.rule, "generic.travel");
  assert.ok(filesOf("eskie.attack.ranged.arrow.ray.physical.blue.30ft").includes(c.file),
            "兜底应是中性箭形，不能回到法术味的 magic_missile");
  assert.equal(c.duration, 800, "f8 起碎裂淡出必须裁掉");
  assert.ok(c.stretchTo, "兜底飞行物要拉到目标");
  assert.equal(c.aim?.missed, false);
  assert.deepEqual(travelCues(byId("alchemicalResolve")), [],
                   "非远程动作不该凭空多出一枚飞行物，近战由 impact 承担");
});

/**
 * 弓 / 弩 / 枪各射各的。改造前 8 件远程武器全掉到 `generic.travel` 上共用同一支蓝箭。
 */
test("带武器的远程攻击按弓/弩/枪分飞行物，且打偏要偏得出来", () => {
  const rng = (identifier, category) => one({
    ...byId("strike"), tags: ["ranged", "strike"],
    strikes: [{identifier, category, damageType: "piercing", properties: []}],
    usage: {...byId("strike").usage, isAttack: true, isRanged: true}
  });
  const bow = travelCues(rng("longbow", "projectile2"))[0];
  const bolt = travelCues(rng("heavyCrossbow", "mechanical2"))[0];
  const gun = travelCues(rng("pistol", "mechanical1"))[0];
  assert.equal(bow?.rule, "strike.ranged.weapon");
  assert.ok(filesOf("jb2a.arrow.physical.orange.30ft").includes(bow.file), "长弓要射箭");
  assert.ok(filesOf("jb2a.bolt.physical.white.30ft").includes(bolt.file), "重弩要射弩矢");
  assert.ok(filesOf("jb2a.bullet.01.orange.30ft").includes(gun.file), "手枪要射弹丸");
  assert.equal(new Set([bow.file, bolt.file, gun.file]).size, 3,
              "三类远程武器不能共用同一支飞行物——那正是本轮要修的");
  // stretchTo 而不是 rotateTowards：.missed() 的偏移只在没有 data.target 时才加得上
  assert.ok(bow.stretchTo, "飞行物要拉到目标，否则 .missed() 是空转");
});
