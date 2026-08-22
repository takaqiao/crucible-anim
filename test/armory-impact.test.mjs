import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {resolve} from "../scripts/resolver/resolve.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import {RESULT} from "../scripts/const.mjs";
import {ELEMENT_LAYER, DAMAGE_ALIAS, elementFor} from "../scripts/armory/impact.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const actions = JSON.parse(readFileSync(join(ROOT, "test/fixtures/actions.json"), "utf8"));
const mk = () => createAssets(offlineBackend(index));
const base = actions.find(a => a.tags.includes("strike") && a.targets.length);

/**
 * 任意动作 + 指定攻击结果 / 伤害类型，取该动作 impact 槽的全部 cue。
 *
 * 原来这个辅助写死在 base（一个 strike 动作）上，而「结果层被 travel 自带闪爆抑制」
 * 那一档只在 arrow 系法术上出现——那正是掠过与命中最容易变得无法区分的一档，却因为
 * 辅助函数够不着而从未被测过。
 */
function impactOf(action, result, {critical = false, damageType = "slashing"} = {}) {
  const s = {
    ...action, usage: {...action.usage, damageType},
    targets: (action.targets ?? []).map(t => ({
      ...t, results: [{result, critical}],
      damage: {total: 8, type: damageType, resource: "health"}
    }))
  };
  return resolve(s, {assets: mk(), armory: ARMORY}).cues.filter(c => c.slot === "impact");
}

function impactCues(result, {critical = false, damageType = "slashing"} = {}) {
  const s = {
    ...base, usage: {...base.usage, damageType},
    targets: [{...base.targets[0], results: [{result, critical}],
               damage: {total: 8, type: damageType, resource: "health"}}]
  };
  return resolve(s, {assets: mk(), armory: ARMORY}).cues.filter(c => c.slot === "impact");
}

const DAMAGE_TYPES = ["bludgeoning", "corruption", "piercing", "slashing", "poison", "acid",
                      "fire", "cold", "electricity", "psychic", "radiant", "void"];

const r6 = v => Math.round(v * 1e6) / 1e6;

/** DESIGN.md §6.5 表 GLANCE 行：「同上 scale ×0.6」。结果层与元素层共用的语义权重。 */
const GLANCE_WEIGHT = 0.6;

/**
 * ASSET-NOTES 给 blfx.spell.impact.flash.color1 的画布归一化系数：源 1200x1200、HIT 那条
 * jb2a impact 是 400x400，「必须显式压到 ~0.35 才和 HIT 同量级」。结果层这两条素材画布
 * 不同，必须先除掉它才谈得上比较语义权重（元素层两个结果共用同一条素材，不需要）。
 *
 * 刻意不从 impact.mjs 导入这个常量：那样就变成「代码说什么测试就信什么」，钉不住任何
 * 东西。代价是改画布系数要同改两处，失败信息会直接点出来。
 */
const GLANCE_CANVAS_NORM = 0.35;

/**
 * 真正改变**画面内容**的字段。「掠过必须与命中不同」只有落在这些字段上才算数——两条 cue
 * 只差一个 playIf（或只差某个记账字段）意味着玩家看到的是同一段动画。这里刻意不写死
 * 「必须差 objectScale」：换成压 opacity、换素材、改时长都是合法的区分手段，本用例守的
 * 是「有区别」，具体机制由前面两条用例钉死。
 *
 * 名单里刻意**不含 delay**：元素层的入场时刻是从结果层自带闪爆窗口派生的（见 impact.mjs
 * 的 build），HIT 与 GLANCE 因此天然差 33ms——那是同一段画面晚播了一帧，不是「这一下更
 * 轻」的表达。把它算进区分手段，等于让一个与攻击结果强弱无关的副产品替真正的区分背书：
 * 实测把元素层的语义权重拿掉之后，结果层被 travel 抑制的那 12 个 arrow 动作就只剩这 33ms
 * 的差别，而本用例的全部价值正在于抓住那一档。
 */
const VISUAL_KEYS = ["file", "objectScale", "scale", "opacity", "tint", "filter",
                     "duration", "playbackRate", "startTime", "zIndex", "aim"];

/**
 * 逐 cue 逐字段比对两组 cue，返回有差异的字段名。条数不同直接算一种差异——
 * 「两个结果在画面上到底有没有区别」只能这样问，单看某一个字段（例如只看结果层的
 * objectScale）会漏掉「结果层根本没出」的那一档。
 */
function differingKeys(a, b) {
  if (a.length !== b.length) return new Set(["<cue 条数>"]);
  const diff = new Set();
  for (let i = 0; i < a.length; i++) {
    for (const k of new Set([...Object.keys(a[i]), ...Object.keys(b[i])])) {
      if (JSON.stringify(a[i][k]) !== JSON.stringify(b[i][k])) diff.add(k);
    }
  }
  return diff;
}

test("8 种结果各自都产出 impact 内容", () => {
  for (const [name, code] of Object.entries(RESULT)) {
    const cues = impactCues(code);
    assert.ok(cues.length > 0, `结果 ${name} 无 impact`);
  }
});

test("命中与掠过叠加元素层，防御类不叠", () => {
  const layers = r => impactCues(r, {damageType: "fire"}).filter(c => c.layer === "element").length;
  assert.ok(layers(RESULT.HIT) >= 1, "命中应有元素层");
  assert.ok(layers(RESULT.GLANCE) >= 1, "掠过应有元素层");
  for (const r of [RESULT.ARMOR, RESULT.BLOCK, RESULT.PARRY, RESULT.RESIST,
                   RESULT.DODGE, RESULT.MISS]) {
    assert.equal(layers(r), 0, `结果 ${r} 不应有元素层`);
  }
});

test("掠过是命中的六成，且结果层与元素层用的是同一个权重", () => {
  const rHit = impactCues(RESULT.HIT).find(c => c.layer === "result");
  const rGlance = impactCues(RESULT.GLANCE).find(c => c.layer === "result");
  assert.ok(rGlance.objectScale < rHit.objectScale);
  // 结果层：先除掉 blfx→jb2a 的画布归一化，剩下的必须正好是 §6.5 的语义权重。
  const resultRatio = r6(rGlance.objectScale / GLANCE_CANVAS_NORM / rHit.objectScale);
  assert.equal(resultRatio, GLANCE_WEIGHT,
    `结果层归一化后掠过是命中的 ${resultRatio}，§6.5 要求 ${GLANCE_WEIGHT}`);
  // 元素层：两个结果共用同一条素材，比值直接就是语义权重，且必须与结果层同一个数。
  const eHit = impactCues(RESULT.HIT, {damageType: "fire"}).find(c => c.layer === "element");
  const eGlance = impactCues(RESULT.GLANCE, {damageType: "fire"}).find(c => c.layer === "element");
  assert.equal(r6(eGlance.objectScale / eHit.objectScale), resultRatio,
    "结果层与元素层必须共用一个语义权重，不能各写各的（元素层丢掉这一项就是掠过=命中）");
  assert.equal(impactCues(RESULT.GLANCE).some(c => c.kind === "shake"), false);
});

test("元素层也跟着攻击结果变轻：12 种伤害类型逐一比对", () => {
  for (const d of DAMAGE_TYPES) {
    const hit = impactCues(RESULT.HIT, {damageType: d}).find(c => c.layer === "element");
    const glance = impactCues(RESULT.GLANCE, {damageType: d}).find(c => c.layer === "element");
    assert.ok(hit && glance, `伤害类型 ${d} 缺元素层`);
    assert.equal(hit.file, glance.file, `伤害类型 ${d} 的两个结果应当共用同一条元素素材`);
    assert.ok(glance.objectScale < hit.objectScale,
      `伤害类型 ${d}：掠过元素层 ${glance.objectScale} 没有小于命中 ${hit.objectScale}`);
    assert.equal(r6(glance.objectScale / hit.objectScale), GLANCE_WEIGHT,
      `伤害类型 ${d}：元素层掠过/命中 = ${r6(glance.objectScale / hit.objectScale)}，应为 ${GLANCE_WEIGHT}`);
  }
});

test("大体型补偿不吃掉语义权重", () => {
  const big = {...base, origin: {...base.origin, width: 2}};
  const hit = impactOf(big, RESULT.HIT, {damageType: "fire"}).find(c => c.layer === "element");
  const glance = impactOf(big, RESULT.GLANCE, {damageType: "fire"}).find(c => c.layer === "element");
  const small = impactCues(RESULT.HIT, {damageType: "fire"}).find(c => c.layer === "element");
  assert.equal(r6(hit.objectScale / small.objectScale), 1.4, "大体型应乘 geom.sizeScale() 的 1.4");
  assert.equal(r6(glance.objectScale / hit.objectScale), GLANCE_WEIGHT,
    "大体型补偿之后掠过与命中的比例仍须是语义权重");
});

test("全量攻击动作：掠过与命中的 impact 绝不只差一个 playIf", () => {
  const attacks = actions.filter(a => a.usage?.isAttack === true && a.targets?.length);
  assert.ok(attacks.length >= 100, `语料里的攻击动作只剩 ${attacks.length} 个，本用例失去意义`);
  let suppressed = 0;
  for (const a of attacks) {
    for (const d of ["fire", "slashing", "void"]) {
      const hit = impactOf(a, RESULT.HIT, {damageType: d});
      const glance = impactOf(a, RESULT.GLANCE, {damageType: d});
      assert.ok(hit.length > 0 && glance.length > 0, `${a.id}/${d}：有目标的攻击不该 0 条 impact`);
      // travel 在目标身上自带闪爆时结果层让位，impact 槽只剩元素层——最严的一档。
      if (!hit.some(c => c.layer === "result")) suppressed++;
      const diff = differingKeys(hit, glance);
      diff.delete("playIf");
      assert.ok(diff.size > 0,
        `${a.id}/${d}：掠过与命中的 impact cue 逐字段只差一个 playIf，画面上等同`);
      assert.ok(VISUAL_KEYS.some(k => diff.has(k)),
        `${a.id}/${d}：掠过与命中只差 ${[...diff].join("/")}，没有一项会改变画面`);
    }
  }
  assert.ok(suppressed > 0,
    "语料里已经没有 travel 自带目标闪爆、结果层因此让位的动作了；" +
    "本用例最关键的那一档（impact 只剩元素层）随之失守，需要补一个这样的夹具");
});

test("未命中与闪避走 missed，其余不走", () => {
  for (const r of [RESULT.MISS, RESULT.DODGE]) {
    const c = impactCues(r).find(x => x.kind === "effect");
    assert.equal(c.aim?.missed, true, `结果 ${r} 应 missed`);
  }
  const hit = impactCues(RESULT.HIT).find(x => x.kind === "effect");
  assert.equal(hit.aim?.missed, false);
});

test("暴击追加抖动轨且抖动只作用于目标 sprite", () => {
  const cues = impactCues(RESULT.HIT, {critical: true});
  const shake = cues.find(c => c.kind === "shake");
  assert.ok(shake, "暴击应有抖动");
  assert.equal(shake.at.ref, "target", "抖动必须锚在目标，不能是全屏");
  assert.ok(shake.intensity > 0 && shake.duration > 0);
});

test("12 种伤害类型的元素层各自可解析", () => {
  const seen = new Set();
  for (const d of DAMAGE_TYPES) {
    const cues = impactCues(RESULT.HIT, {damageType: d});
    const el = cues.find(c => c.layer === "element");
    assert.ok(el?.file, `伤害类型 ${d} 无元素层素材`);
    seen.add(el.file);
  }
  // 只钉「条数」：12 种类型 = 物理三系共用的 1 条血迹 + eskie.damage 八支 + void 的
  // jb2a.impact.012，正好 10 条素材。真正的区分度判定（file+hue 不重复、同模板家族内
  // 颜色分支不复用、残留主色 CIEDE2000 达标）在 test/armory-element-distinct.test.mjs——
  // 原先这里写的是 `seen.size >= 5`，而 acid 与 poison 是两个不同的文件，撞车的时候
  // 它照样数成两种，拦不住 ASSET-NOTES 明确点名的那一类问题。
  assert.equal(seen.size, 10,
    `12 种伤害类型应解析出 10 条素材（物理三系共用一条血迹），实际 ${seen.size} 条`);
});

test("每个 cue 的 playIf 与实际结果一致", () => {
  const cues = impactCues(RESULT.BLOCK);
  for (const c of cues) {
    assert.ok(["always", "block", "defended"].includes(c.playIf),
      `格挡场景下出现了 playIf=${c.playIf}`);
  }
});

/* ------------------------------------------------------------------ *
 *  分层时序：元素层画在结果层之下，且落在结果层自带闪爆熄灭之后
 * ------------------------------------------------------------------ */

test("元素层画在结果层之下，且落在结果层自带闪爆熄灭之后", () => {
  // 两条性质都只用两条 cue 自己申报的数字比大小，测试里不出现任何毫秒常量或 zIndex 常量。
  //  · zIndex：元素层里唯一带**不透明**像素的是 jb2a.impact.01x 的 dark_ 黑芯
  //    （ASSET-NOTES 实测中心 alpha 恒 255、亮度 0.6-9.6）。压在结果层白闪上会在白光
  //    正中挖出一块黑，画到结果层之下则无论素材怎么换都不可能挖洞。
  //  · delay：结果层的闪爆熄灭之前元素层不许入场，否则两层在同一瞬间各自炸一次
  //    ——这正是 delay:60 时的老毛病（结果层星芒 133ms、元素层自带白闪 227ms）。
  for (const d of DAMAGE_TYPES) {
    for (const r of [RESULT.HIT, RESULT.GLANCE]) {
      const cues = impactCues(r, {damageType: d});
      const res = cues.find(c => c.layer === "result");
      const el = cues.find(c => c.layer === "element");
      assert.ok(res && el, `${d}/${r} 少了一层`);
      assert.ok(el.zIndex < res.zIndex,
        `${d}/${r}：元素层 zIndex ${el.zIndex} 不在结果层 ${res.zIndex} 之下`);
      assert.ok(el.delay >= res.delay + (res.selfFlash?.to ?? 0),
        `${d}/${r}：元素层 delay ${el.delay} 早于结果层自带闪爆的熄灭时刻 `
        + `${res.delay + (res.selfFlash?.to ?? 0)}`);
    }
  }
});

/* ------------------------------------------------------------------ *
 *  元素层的伤害类型回退链
 * ------------------------------------------------------------------ */

/**
 * 造一个只改伤害来源的攻击快照，用来单独考察元素层的三级回退。
 * targetType 传 undefined 表示 target.damage 整个为 null（真实语料里最常见的形态）。
 */
function elementCue({targetType, usageType = null, strikeType = null} = {}) {
  const s = {
    ...base,
    usage: {...base.usage, damageType: usageType},
    strikes: strikeType ? [{category: "balanced1", damageType: strikeType}] : [],
    targets: [{...base.targets[0], results: [{result: RESULT.HIT, critical: false}],
               damage: targetType === undefined
                 ? null : {total: 8, type: targetType, resource: "health"}}]
  };
  const plan = resolve(s, {assets: mk(), armory: ARMORY});
  return {cue: plan.cues.find(c => c.slot === "impact" && c.layer === "element"),
          warnings: plan.warnings};
}

test("元素层三级回退：target.damage.type → usage.damageType → 主手武器", () => {
  // 顺序与 crucible 自己取伤害类型的顺序同构（documents/actor.mjs 的 strikeWeapon：
  // options.damageType || action.usage.damageType || weapon.system.damageType）。
  assert.equal(elementCue({targetType: "fire", usageType: "cold", strikeType: "piercing"}).cue.element,
    "fire", "结算后写回的类型优先级最高");
  assert.equal(elementCue({usageType: "cold", strikeType: "piercing"}).cue.element,
    "cold", "没有结算结果时用动作层面的固定伤害类型");
  assert.equal(elementCue({strikeType: "piercing"}).cue.element,
    "piercing", "两者都缺时用主手武器的伤害类型");
  assert.equal(elementCue({}).cue.element, "bludgeoning", "三级都缺时兜底血溅");
});

test("查不到元素的伤害类型不得遮蔽后面有效的一级", () => {
  // 从前写的是 `t.damage?.type ?? s.usage.damageType ?? "bludgeoning"`——`??` 判的是
  // 空值而不是「查不查得到元素」，一个 ELEMENT_LAYER 里没有的非空 target.damage.type
  // 会把后面那级有效的 usage.damageType 整个吃掉，直接掉进血溅。
  const r = elementCue({targetType: "quantum", usageType: "fire"});
  assert.equal(r.cue.element, "fire", "未知类型应当被跳过，而不是遮蔽掉后面有效的一级");
  assert.equal(r.warnings.length, 1, "跳过未知伤害类型必须留痕");
  assert.match(r.warnings[0], /quantum/);
});

test("查不到元素时必须 ctx.warn 留痕，而不是静默退回血溅", () => {
  const r = elementCue({targetType: "quantum"});
  assert.equal(r.cue.element, "bludgeoning");
  assert.equal(r.warnings.length, 1, `静默降级：${JSON.stringify(r.warnings)}`);
  assert.match(r.warnings[0], /ELEMENT_LAYER/);
  // 伤害「类别」也一样：elemental / spiritual 是 DAMAGE_CATEGORIES 的键、不是伤害类型，
  // 没进 DAMAGE_ALIAS 就该报出来而不是当成 physical 那样默默别名掉。
  assert.equal(elementCue({targetType: "elemental"}).warnings.length, 1);
});

test('kinesis 符文的 "physical" 走别名到血溅，且不算降级', () => {
  // spellcraft.mjs 的 RUNES.kinesis.damageType 是 "physical"——DAMAGE_CATEGORIES 的顶层
  // 类别，不在 DAMAGE_TYPES 的 12 键里。spell-action.mjs 的 #prepareDamage
  // （`type: this.damageType ?? this.rune.damageType`）在玩家没经对话框选类型时会把它
  // 原样写进 damage.type，所以这是真实可达的输入，不是假想输入。
  assert.equal(DAMAGE_ALIAS.physical, "bludgeoning");
  const r = elementCue({targetType: "physical"});
  assert.equal(r.cue.element, "bludgeoning", "physical 应落到血溅（与对话框的三选一等价）");
  assert.deepEqual(r.warnings, [], "已登记的类别别名是正常路径，不该留降级痕迹");
  // 而且它是走别名落地的，不是被兜底吞掉的：语料里 spell.kinesis.* 全系都靠这条。
  const kinesis = actions.filter(a => a.spell?.rune === "kinesis" && a.targets.length);
  assert.ok(kinesis.length > 0, "语料里应存在 kinesis 法术");
  for (const s of kinesis) {
    const plan = resolve(s, {assets: mk(), armory: ARMORY});
    assert.deepEqual(plan.warnings, [], `${s.id} 不该产生降级告警`);
  }
});

test("elementFor 是纯函数，不需要 ctx 也能问出结论", () => {
  // 覆盖断言与将来的调试面板都要能在不跑 resolve 的情况下问「这次该出什么元素」。
  assert.deepEqual(elementFor({usage: {damageType: null}, strikes: []}, {damage: {type: "cold"}}),
    {key: "cold", spec: ELEMENT_LAYER.cold, unknown: []});
  const r = elementFor({usage: {damageType: "fire"}, strikes: []}, {damage: {type: "physical"}});
  assert.equal(r.key, "bludgeoning");
  assert.deepEqual(r.unknown, []);
});

/* ------------------------------------------------------------------ *
 *  fade 预算守卫
 * ------------------------------------------------------------------ */

/**
 * CUE_DEFAULTS 给的是 fadeIn:200 / fadeOut:300，共 500ms。impact 槽有大量素材本身就比
 * 500ms 还短（eskie.damage.* 全家 501ms、裁完只剩 233-266ms，DODGE 窗口 333ms、ARMOR
 * 窗口 266ms），继承默认值的后果不是「淡入淡出稍微多了点」，而是主体从头到尾都到不了
 * 满不透明度、甚至整段被吃掉。所以这一组断言锁的是**比例**而不是某个具体数字：兵库随时
 * 可以为了观感重调 startTime/duration/playbackRate，但重调之后 fade 必须跟着重算。
 *
 * 判据 = fadeIn + fadeOut ≤ 有效时长 × MAX_FADE_RATIO。
 *
 * 「有效时长」不能直接读 cue.duration——它允许是 null（表示播完素材剩下的全部），血溅
 * 与 GLANCE/RESIST 都是这么写的。null 时必须从素材实际长度推：
 *     src     = 素材总长 − startTime          （startTime 之后还剩多少源片）
 *     natural = src / playbackRate            （不裁剪时的墙钟时长；RESIST rate:2）
 *     life    = duration ?? natural           （.duration() 传给 Sequencer 的是墙钟量）
 *
 * 素材总长哪来？asset-index.json 只有路径没有时长，ASSET-NOTES 只有帧数没有帧率，而本表
 * 的帧率是混的（24 / 29.97 / 30 三种，ASSET-NOTES 通用结论明确警告过不要按统一帧率换算）。
 * 所以时长表在这里手写一份，并用两道交叉校验防它变陈旧：
 *   1. ms × fps 必须等于 ASSET-NOTES 主表「帧数」列——两份手写数据互为对照；
 *   2. 表里的 DB 路径必须能覆盖 impact 槽实际用到的每个文件——兵库换素材、或者 index 里
 *      文件改名，都会在这里失败而不是悄悄放过一条没量过的新素材。
 * 复现命令（Foundry 数据根下）：
 *   ffprobe -v error -select_streams v:0 -show_entries format=duration -of csv=p=0 <file>
 */
const ASSET_MS = {
  // 结果层 8 条（generic.impact 与 HIT 同素材）
  "jb2a.impact.005.white":                        {ms: 833,  fps: 30},
  "blfx.spell.impact.flash.color1":               {ms: 500,  fps: 30},
  "jb2a.impact.011.yellow":                       {ms: 1100, fps: 30},
  "jb2a.shield.02.outro_explode.blue":            {ms: 1500, fps: 30},
  "blfx.misc.enchantment.1.blades_clash1.color1": {ms: 3000, fps: 30},
  "jb2a.extras.tmfx.inpulse.circle.02.normal":    {ms: 1800, fps: 30},
  "jb2a.teleport.01.white":                       {ms: 900,  fps: 30},
  "jb2a.ui.miss.white":                           {ms: 2800, fps: 30},
  // 元素层 12 条去重后 10 个文件（物理三系共用血溅）
  "jb2a.liquid.splash.red":                       {ms: 3542, fps: 24},
  "eskie.damage.fire.01.orange":                  {ms: 501,  fps: 30000 / 1001},
  "eskie.damage.cold.01.blue":                    {ms: 501,  fps: 30000 / 1001},
  "eskie.damage.electricity.01.blue":             {ms: 501,  fps: 30000 / 1001},
  "eskie.damage.acid.01.green":                   {ms: 501,  fps: 30000 / 1001},
  "eskie.damage.poison.01.purple":                {ms: 501,  fps: 30000 / 1001},
  "eskie.damage.radiant.01.yellow":               {ms: 501,  fps: 30000 / 1001},
  "eskie.damage.psychic.01.pink":                 {ms: 501,  fps: 30000 / 1001},
  "eskie.damage.necrotic.01.teal":                {ms: 501,  fps: 30000 / 1001},
  "jb2a.impact.012.dark_purple":                  {ms: 1100, fps: 30}
};

/**
 * 上限取 0.30：500ms 以下的素材留给主体的时间本来就不多，超过三成就意味着「淡入淡出」
 * 和「内容」在抢同一段时间。已知最紧的三条是 BLOCK（350/1233=28.4%，fadeIn 落在护盾
 * 自己的线性变亮段上）、ARMOR（67/266=25.2%，窗口本身只有 266ms）、以及裁剪后的 8 支
 * eskie（60/233-266 = 22.6-25.8%）。
 */
const MAX_FADE_RATIO = 0.30;

/** ASSET-NOTES 主表：DB 路径 -> 帧数列。 */
function notesFrames() {
  const md = readFileSync(join(ROOT, "docs/ASSET-NOTES.md"), "utf8");
  const out = {};
  for (const line of md.split("\n")) {
    const cols = line.split("|").map(c => c.trim());
    if (cols.length < 11) continue;
    const m = /^`([\w.-]+)`$/.exec(cols[1]);
    if (m && /^\d+$/.test(cols[5])) out[m[1]] = Number(cols[5]);
  }
  return out;
}

/** impact 槽的全部 effect cue（8 结果 × 12 伤害类型 + 非攻击兜底），按规则/层/文件去重。 */
function allImpactEffects() {
  const seen = new Map();
  for (const code of Object.values(RESULT)) {
    for (const d of DAMAGE_TYPES) {
      for (const c of impactCues(code, {damageType: d})) {
        if (c.kind !== "effect") continue;
        seen.set(`${c.rule}|${c.playIf}|${c.layer}|${c.file}`, c);
      }
    }
  }
  const plain = {
    ...base, usage: {...base.usage, isAttack: false},
    targets: [{...base.targets[0], results: [{result: RESULT.HIT, critical: false}]}]
  };
  for (const c of resolve(plain, {assets: mk(), armory: ARMORY}).cues) {
    if (c.slot === "impact" && c.kind === "effect") seen.set(`fallback|${c.file}`, c);
  }
  return [...seen.values()];
}

test("时长表与 ASSET-NOTES 的帧数列一致（防手写时长变陈旧）", () => {
  const frames = notesFrames();
  for (const [path, {ms, fps}] of Object.entries(ASSET_MS)) {
    assert.ok(frames[path] !== undefined, `ASSET-NOTES 里没有 ${path} 这一行`);
    assert.equal(Math.round(ms * fps / 1000), frames[path],
      `${path}: ${ms}ms × ${fps.toFixed(3)}fps 推不出 ASSET-NOTES 记的 ${frames[path]} 帧`);
  }
});

test("时长表覆盖 impact 槽用到的每个文件，且路径解析一致", () => {
  const assets = mk();
  const byFile = new Map();
  for (const path of Object.keys(ASSET_MS)) {
    const r = assets.resolve(path);
    assert.ok(r?.file, `${path} 解析不出文件`);
    byFile.set(r.file, path);
  }
  for (const c of allImpactEffects()) {
    assert.ok(byFile.has(c.file),
      `impact 槽用到 ${c.file}（规则 ${c.rule}/${c.layer}）但时长表里没量过它`);
  }
});

test("fade 预算不超过 cue 有效时长的三成", () => {
  const assets = mk();
  const msByFile = new Map();
  for (const [path, v] of Object.entries(ASSET_MS)) msByFile.set(assets.resolve(path).file, v.ms);

  for (const c of allImpactEffects()) {
    const assetMs = msByFile.get(c.file);
    const natural = (assetMs - c.startTime) / c.playbackRate;
    const life = c.duration ?? natural;
    const tag = `${c.rule}/${c.layer ?? "-"}/${c.playIf}/${c.file.split("/").pop()}`;

    assert.ok(Number.isFinite(c.fadeIn) && Number.isFinite(c.fadeOut),
      `${tag}: fadeIn/fadeOut 必须是数字——兵库表里漏写会让 undefined 覆盖掉 CUE_DEFAULTS`);
    assert.ok(life > 0, `${tag}: 有效时长算出来是 ${life}`);
    assert.ok(c.fadeIn + c.fadeOut <= life * MAX_FADE_RATIO + 0.5,
      `${tag}: fade 预算 ${c.fadeIn}+${c.fadeOut}=${c.fadeIn + c.fadeOut}ms 超过有效时长 ` +
      `${Math.round(life)}ms 的 ${Math.round(MAX_FADE_RATIO * 100)}%——主体会被吃掉`);
    assert.ok(c.fadeIn <= life / 2,
      `${tag}: 单是 fadeIn ${c.fadeIn}ms 就吃掉了 ${Math.round(life)}ms 里的一半以上`);
    // 在素材自然结束之前硬切的 cue，必须自己收尾，否则末帧是一刀切
    if (c.duration !== null && c.duration + 1 < natural) {
      assert.ok(c.fadeOut > 0, `${tag}: duration ${c.duration}ms 把 ${Math.round(natural)}ms 的素材` +
        `截断了，必须给 fadeOut 收尾`);
    }
  }
});

test("eskie 元素层不做淡出、也不许大淡入：裁完只剩 233-266ms", () => {
  // 8 支 eskie 用 startTime 裁掉自带白爆闪之后有效时长只剩 233-266ms，30% 预算就是
  // 70-80ms。f7 是一张已成形的满幅图，硬切入需要一点淡入遮丑（60ms 约两帧），
  // 而残留段素材自己就衰减到 0、duration 又补到素材自然收尾，再叠 fadeOut 是二次衰减。
  for (const d of ["fire", "cold", "electricity", "acid", "poison", "radiant", "psychic", "corruption"]) {
    const el = impactCues(RESULT.HIT, {damageType: d}).find(c => c.layer === "element");
    assert.ok(el.fadeIn > 0 && el.fadeIn <= 80,
      `${d} 元素层 fadeIn 应在 (0,80]，实际 ${el.fadeIn}——startTime 从半空中切入需要遮丑，` +
      `但 233-266ms 的窗口给不起更多`);
    assert.equal(el.fadeOut, 0,
      `${d} 元素层 fadeOut 必须是 0：duration 已经补到素材自然收尾，再叠一层是二次衰减`);
  }
});

test("非攻击兜底 generic.impact 与结果层共用同一张语义权重表", () => {
  // 0.6 这个数字从前在本槽里有三份拷贝：RESULT_LAYER[GLANCE].scale 里揉着的那一份、
  // ELEMENT_LAYER 本该有却漏掉的那一份、以及这条兜底规则里写死的三元表达式
  // `res === RESULT.GLANCE ? 0.6 : 1`——那是唯一一处写对了的地方，留着它下次调
  // §6.5 的权重照样会漏改。它用的素材恒为 jb2a.impact.005.white（400x400，画布系数 1），
  // 所以 objectScale 就是完整的语义权重，可以直接按比例反查。
  const plain = {
    ...base, usage: {...base.usage, isAttack: false},
    targets: [{...base.targets[0], results: [{result: RESULT.HIT, critical: false}]}]
  };
  const scaleOf = result => {
    const s = {...plain, targets: plain.targets.map(t => ({...t, results: [{result, critical: false}]}))};
    const c = resolve(s, {assets: mk(), armory: ARMORY}).cues
      .find(x => x.slot === "impact" && x.rule === "generic.impact");
    assert.ok(c, `结果 ${result} 下 generic.impact 没有产出`);
    return c.objectScale;
  };
  const hit = scaleOf(RESULT.HIT);
  assert.equal(r6(scaleOf(RESULT.GLANCE) / hit), GLANCE_WEIGHT,
    "兜底规则的掠过折扣必须与结果层同源，不能自己写死一个 0.6");
  // 防御类不再一律 1.0：权重表说 MISS 0.7 / DODGE 0.8 / BLOCK 0.9，兜底也该跟着走。
  assert.ok(scaleOf(RESULT.MISS) < scaleOf(RESULT.DODGE),
    "MISS 的语义权重应当比 DODGE 更轻（§6.5：0.7 vs 0.8）");
  assert.ok(scaleOf(RESULT.DODGE) < scaleOf(RESULT.BLOCK),
    "DODGE 的语义权重应当比 BLOCK 更轻（§6.5：0.8 vs 0.9）");
  assert.ok(scaleOf(RESULT.BLOCK) < hit, "BLOCK 的语义权重应当比 HIT 更轻（§6.5：0.9 vs 1.0）");
});
