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
const travelCues = s => resolve(s, {assets: mk(), armory: ARMORY})?.cues.filter(c => c.slot === "travel") ?? [];

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

test("近战贴身与隔格用不同素材", () => {
  const base = melee();
  const near = {...base, targets: [base.targets.find(t => t.adjacent)]};
  const far = {...base, targets: [base.targets.find(t => !t.adjacent)]};
  const a = travelCues(near)[0];
  const b = travelCues(far)[0];
  assert.ok(a && b);
  assert.notEqual(a.file, b.file, "贴身与隔格应换素材，否则长度对不上");
});

test("目标在左侧时挥击镜像", () => {
  const base = melee();
  const left = {...base, targets: [{...base.targets[0], onLeft: true, x: 300}]};
  const right = {...base, targets: [{...base.targets[0], onLeft: false, x: 700}]};
  assert.equal(travelCues(left)[0].mirrorY, true);
  assert.equal(travelCues(right)[0].mirrorY, false);
});

test("大体型施法者的挥击放大且偏移折半", () => {
  // 单调比较（bc.offset.x > sc.offset.x）分不出「折半」和「不折半」：把 offsetFor(t, 0.5)
  // 换成 (s.origin?.width ?? 1) * 0.5 得到 1.5 vs 0.5，照样满足 >。所以这里一律断具体值，
  // 并且同时取「大体型贴身」和「大体型隔格」两个点——折半只发生在隔格分支上。
  const base = melee();
  const at = (t, patch) => ({...base, ...patch, targets: [{...base.targets[0], ...t}]});
  const bigFar = travelCues(at({adjacent: false}, {origin: {...base.origin, width: 3}}))[0];
  const bigNear = travelCues(at({adjacent: true}, {origin: {...base.origin, width: 3}}))[0];
  const smallFar = travelCues(at({adjacent: false}, {}))[0];
  const smallNear = travelCues(at({adjacent: true}, {}))[0];
  assert.equal(bigFar.objectScale, 1.4, "大体型放大 1.4（geom.sizeScale）");
  assert.equal(smallFar.objectScale, 1, "小体型不放大");
  assert.equal(smallFar.offset.x, 0.5, "小体型：width*base = 1*0.5");
  assert.equal(smallNear.offset.x, 0.5, "小体型不分贴身隔格");
  assert.equal(bigFar.offset.x, 0.75, "大体型隔格折半：(3*0.5)/2");
  assert.equal(bigNear.offset.x, 1.5, "大体型贴身不折半：3*0.5");
  assert.equal(bigFar.offset.y, 0);
  for (const c of [bigFar, bigNear, smallFar, smallNear]) {
    assert.equal(c.gridUnits, true, "offset 以格为单位；丢了 gridUnits 会被当像素解释，1 格=100px");
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

test("爆发姿态没有飞行段", () => {
  const cues = travelCues(byId("spell.death.blast"));
  assert.equal(cues.length, 0, "blast 不应有 travel 内容");
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
  for (const [id, ruleId] of [["spell.storm.arrow", "spell.gesture.arrow"],
                              ["spell.flame.strike", "generic.travel"]]) {
    const s = byId(id);
    const cues = travelCues(s);
    assert.equal(cues.length, s.targets.length,
      `${id} 有 ${s.targets.length} 个目标就该有 ${s.targets.length} 份飞行段，实际 ${cues.length}`);
    assert.equal(cues[0].rule, ruleId);
    assert.deepEqual(cues.map(c => c.at.tokenId), s.targets.map(t => t.tokenId),
      "每目标规则的 cue 必须逐一锚在各自的目标上");
  }
});

test("自身爆发锚在施法者、不锚任何目标，且用实测过的时序", () => {
  const s = byId("spell.death.surge");
  const c = travelCues(s)[0];
  assert.equal(c.rule, "spell.gesture.surge");
  assert.equal(c.at?.ref, "origin", "自身爆发必须锚在施法者，不能锚在某个目标格");
  assert.equal(c.at.tokenId, undefined, "施法者锚点不该带目标 token");
  assert.equal(c.aim, null,
    "锚点已在施法者，再 aim 回施法者就是 atan2(0,0) 的退化旋转，应彻底不设 aim");
  assert.equal(c.stretchTo, null, "自身爆发不飞向目标");
  assert.equal(c.startTime, 125, "f0-3 是空帧，必须跳过");
  assert.equal(c.duration, 1125);
  assert.ok(filesOf("eskie.casting.physical.01.center.one_shot.purple").includes(c.file),
    "death 符文应落到紫色分支");
});

test("区域与自身姿态在零目标动作上照样出内容", () => {
  for (const [id, ruleId] of ONCE_CASES) {
    const cues = travelCues({...byId(id), targets: []});
    assert.equal(cues.length, 1,
      `${id} 零目标时仍应出 1 条 travel cue：区域法术没罩住人、自身特效本就没有目标，画面都还在`);
    assert.equal(cues[0].rule, ruleId);
    assert.equal(cues[0].at.ref, "origin");
  }
});

test("全量扫描：once 规则任何动作都不超 1 条，其余规则不超目标数", () => {
  const onceIds = new Set(travel.filter(r => r.once === true).map(r => r.id));
  assert.ok(onceIds.size >= 4, `声明 once 的规则只有 ${onceIds.size} 条，少于区域/自身姿态的条数`);
  const bad = [];
  for (const s of actions) {
    const n = new Map();
    for (const c of travelCues(s)) n.set(c.rule, (n.get(c.rule) ?? 0) + 1);
    for (const [rule, count] of n) {
      const cap = onceIds.has(rule) ? 1 : Math.max(s.targets.length, 1);
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

test("锥形端点跟着 region.rotation 转", () => {
  // rotation 是度，0=正东，正角度朝 +y；画布 y 向下，所以 90° 指向屏幕下方（正南）。
  // 依据：action-use-dialog.mjs 用 atan2(dy,dx) 写入，vfx/spells.mjs 用 {cos,sin} 消费。
  // 锥尖 (500,500)、radius 300。
  for (const [rotation, end] of [[0, {x: 800, y: 500}], [90, {x: 500, y: 800}],
                                 [180, {x: 200, y: 500}], [-90, {x: 500, y: 200}],
                                 [270, {x: 500, y: 200}], [45, {x: 712.132034, y: 712.132034}]]) {
    const c = onlyCue(withRegion("spell.flame.cone", {rotation}));
    assert.deepEqual(c.stretchTo, end, `rotation=${rotation} 的端点错了`);
  }
});

test("锥形端点在整圈上都等于 origin + dir(rotation)*radius", () => {
  for (let deg = 0; deg < 360; deg += 15) {
    const c = onlyCue(withRegion("spell.flame.cone", {rotation: deg}));
    const rad = (deg * Math.PI) / 180;
    assert.ok(Math.abs(c.stretchTo.x - (500 + (300 * Math.cos(rad)))) < 1e-6, `x@${deg}`);
    assert.ok(Math.abs(c.stretchTo.y - (500 + (300 * Math.sin(rad)))) < 1e-6, `y@${deg}`);
  }
});

test("锥形张角按半宽之比撑 scale.y", () => {
  // 贴图是 53.13° 的 5e 锥（600x600 画幅 / _template=[100,0,0] / 抽帧实测斜率 0.49-0.53）。
  // 倍率 = tan(区域半角) / tan(26.565°) = tan(A/2) / 0.5。
  const c60 = onlyCue(withRegion("spell.flame.cone", {angle: 60}));
  assert.equal(c60.scale.x, 1, "scale.x 必须留 1：Sequencer 会拿它去除距离");
  assert.equal(c60.scale.y, 1.154701, "60° 模板要把 53.13° 的贴图撑宽 15%");
  const c120 = onlyCue(withRegion("spell.flame.cone", {angle: 120}));
  assert.equal(c120.scale.y, 3.464102, "120° 要 tan60/0.5=3.46，角度比 120/60=2 只能撑到 90°");
  // 贴图自身张角 2·atan(0.5) = 53.130102°，写字面量 53.13 会差到 0.999998，直接算给它
  const cNative = onlyCue(withRegion("spell.flame.cone", {angle: (2 * Math.atan(0.5) * 180) / Math.PI}));
  assert.equal(cNative.scale.y, 1, "正好等于贴图自身张角时不该拉伸");
});

test("张角超出单张贴图能撑的范围时截断并留痕", () => {
  const plan = planOf(withRegion("spell.flame.cone", {angle: 210}));  // Crucible 的 fan 张角
  const c = plan.cues.filter(x => x.slot === "travel")[0];
  assert.equal(c.scale.y, 4);
  assert.ok(plan.warnings.some(w => w.includes("210")), `截断必须留痕：${JSON.stringify(plan.warnings)}`);
});

test("射线拉到模板端点而不是目标身上", () => {
  // 模板 (500,500) 长 400 rot 0 → 端点 (900,500)；两个目标在 (600,500) 与 (900,500)。
  const s = byId("spell.frost.ray");
  const c = onlyCue(s);
  assert.deepEqual(c.stretchTo, {x: 900, y: 500});
  assert.notDeepEqual(c.stretchTo, {x: s.targets[0].x, y: s.targets[0].y},
    "取目标坐标时光束只拉到模板一半长");
  assert.equal(c.mask, "region", "射线必须用模板遮罩，否则会溢出");
  assert.deepEqual(onlyCue(withRegion("spell.frost.ray", {rotation: 90})).stretchTo, {x: 500, y: 900});
  assert.deepEqual(onlyCue(withRegion("spell.frost.ray", {rotation: 135})).stretchTo,
    {x: 217.157288, y: 782.842712});
  assert.deepEqual(onlyCue(withRegion("spell.frost.ray", {length: 700})).stretchTo, {x: 1200, y: 500});
});

test("模板类特效锚在模板起点而不是某个目标身上", () => {
  // 光束/锥形的起点若仍钉在 targets[0]（600,500），端点算对了起点也还在半路上。
  // 规则自带 at 覆盖 resolve.mjs 给 once 规则的默认 {ref:"origin"}，把坐标一起带上。
  for (const id of ["spell.frost.ray", "spell.flame.cone"]) {
    const s = byId(id);
    const c = onlyCue(s);
    assert.equal(c.at.ref, "origin", id);
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
  const s = byId("spell.storm.arrow");
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
  assert.ok(filesOf("jb2a.unarmed_strike.no_hit.01.blue").includes(c.file),
    "拳击必须用不自带命中爆闪的 no_hit 分支，命中闪光交给 impact 层");
  assert.equal(c.gridUnits, true, "offset 是格数不是像素");
  const big = travelCues({...base, origin: {...base.origin, width: 3}})[0];
  assert.ok(big.objectScale > c.objectScale, "大体型应放大");
  assert.ok(big.offset.x > c.offset.x, "大体型应前移更多");
  assert.equal(c.mirrorY, false);
  assert.equal(travelCues(one(base, {onLeft: true, x: 300}))[0].mirrorY, true, "目标在左侧要镜像");
  // no_hit 只有 blue/yellow 两支，yellow 是 51 帧（1.76 倍）——跟伤害色会把时序表整体拉长
  const radiant = {...base, usage: {...base.usage, damageType: "radiant"}};
  assert.equal(travelCues(radiant)[0].file, c.file, "拳击不跟伤害色，否则 0.97s 的时序会变成 1.70s");
});

test("投掷物镜像跟朝向、跳过收势、未命中透传", () => {
  const base = byId("flashOfSteel");
  const right = travelCues(one(base, {onLeft: false, x: 700}))[0];
  const left = travelCues(one(base, {onLeft: true, x: 300}))[0];
  assert.equal(right?.rule, "strike.thrown");
  assert.ok(filesOf("blfx.weapon.range.dagger1.throw1.color1.30ft").includes(right.file));
  assert.equal(left.mirrorY, true, "向左投掷必须镜像，否则匕首倒着飞");
  assert.equal(right.mirrorY, false);
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

test("远程兜底给中性箭形，近战兜底不出内容", () => {
  const bow = one({
    ...byId("strike"), tags: ["ranged", "strike"],
    strikes: [{category: "projectile2", damageType: "piercing"}],
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
