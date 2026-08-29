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
import {DIRS, placeAt, pointResolver, rotates, heading, bearing} from "../tools/geom-probe.mjs";
import {RESULT_NAME} from "../scripts/const.mjs";

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

// 2026-08-29 批次 B 第 6 步：本用例整条翻案（施工清单 §0.7）。
//
// 旧判据是「未命中与闪避走 missed，其余不走」。翻案的依据不是观感而是两条源码事实：
//   1. `_getOffset`（sequencer.js:15360）的 `missed && (!source || !data.target)` 在
//      非拉伸 cue 上走 `calculate_missed_position` 的 `!target` 分支（17976-17985）——
//      `twister.random() * 2π` 的整圈随机，而 twister 的种子是 `creationTimestamp`，
//      **逐客户端不同**。本模组每台机器本地播同一份 plan，这是最后一个漏网的随机项。
//   2. DODGE 现在要按走位方向转（ASSET-NOTES 的逐字指令），而 rotateTowards 会填上
//      data.target，判据里的 `!data.target` 恒假——`.missed()` 在它身上根本不生效，
//      只会让 test/play-contract.test.mjs 的「落空的非拉伸反馈不带 data.target」转红。
// 所以 impact 主规则整槽退出 missed，位移改由 RESULT_GEOM 的确定性几何给出。
test("impact 主规则整槽不再申报 missed，落空改用确定性几何", () => {
  const r6 = v => Math.round(v * 1e6) / 1e6;
  const tw = base.targets[0].width ?? 1;

  for (const [name, code] of Object.entries(RESULT)) {
    for (const c of impactCues(code)) {
      assert.notEqual(c.aim?.missed, true,
        `结果 ${name} 的 ${c.layer} 层还在申报 missed——那是逐客户端随机的落点，`
        + "同一次落空每个玩家看到的方向都不一样");
    }
  }

  // MISS：不转（烘死的英文字一转就废），但要把构图推回中心。
  const miss = impactCues(RESULT.MISS).find(c => c.layer === "result");
  assert.ok(miss, "MISS 的结果层应当出得来");
  assert.equal(miss.aim, null, "MISS 不该有 aim：它不转向，也不需要 missed 载体了");
  assert.equal(miss.gridUnits, true, "构图补偿的单位是格，必须显式声明 gridUnits");
  assert.equal(miss.offset.x, 0, "MISS 只沿贴图自身 -y 推，横向不动");
  // 数值钉死：ASSET-NOTES 量到静止段文字重心在画幅 73% 处，0.73-0.50 = 0.23 个**身位**，
  // 而身位 = objectScale × 目标格宽（scaleToObject 的定义）。
  assert.equal(miss.offset.y, r6(-0.23 * miss.objectScale * tw),
    "MISS 的构图补偿不等于 -0.23 × objectScale × 目标格宽");

  // DODGE：转，且转的是「背对攻击者」那一侧；同样带构图补偿（亮带偏左 (250-202)/500）。
  const dodge = impactCues(RESULT.DODGE).find(c => c.layer === "result");
  assert.ok(dodge?.aim, "DODGE 应当带 aim（按走位方向 rotate，不是 mirror）");
  assert.equal(dodge.aim.missed, false);
  assert.equal(dodge.offset.y, 0, "DODGE 的补偿只沿拖影展开的方向（贴图自身 +x）");
  assert.equal(dodge.offset.x, r6(0.096 * dodge.objectScale * tw));

  // generic.impact（非攻击动作的兜底）**保留** missed：那一支不转向、也没有构图补偿，
  // .missed() 在它身上是原设计的用法。这条同时防止有人把翻案顺手扩大到整个仓库。
  const nonAttack = actions.find(a => a.usage?.isAttack !== true && a.targets?.length);
  assert.ok(nonAttack, "语料里没有带目标的非攻击动作，generic.impact 那一支测不到");
  const generic = impactOf(nonAttack, RESULT.MISS).find(c => c.rule === "generic.impact");
  assert.ok(generic, "非攻击动作应当走 generic.impact");
  assert.equal(generic.aim?.missed, true,
    "generic.impact 的落空两档仍应走 .missed()：它不转向，随机偏移在这里是原设计");
  // 构图补偿必须**不**跟过来：selfX/selfY 补的是结果层那八条素材各自的偏心，而本规则恒用
  // jb2a.impact.005.white（ASSET-NOTES 实测内容正居中）。套别人的补偿就是纯错位。
  assert.deepEqual(generic.offset, {x: 0, y: 0},
    "generic.impact 不该带构图补偿：它的素材是居中的 jb2a.impact.005.white，"
    + "MISS 那条 -0.23 补的是「Miss!」那行字压在画幅 73% 处，与本规则无关");
  // 反向：非落空档照吃攻击轴位移（那是结果语义，与素材无关），否则「同型」就成了空话。
  const genericHit = impactOf(nonAttack, RESULT.HIT).find(c => c.rule === "generic.impact");
  assert.ok(genericHit?.offset.x || genericHit?.offset.y,
    "generic.impact 的命中档应当照吃 RESULT_GEOM 的沿攻击轴位移");
});

/**
 * 施工清单 §0.7 的守卫 (a) + (b)，**两侧同时钉死**。
 *
 * (a) 该转的（HIT / GLANCE / DODGE 与元素层）：8 个罗盘方向必须给出 8 种世界朝向，
 *     且每一种都等于该方向的攻击轴（扣掉本条 cue 自己声明的 rotationOffset 与 angle）。
 * (b) 不该转的（ARMOR / PARRY / BLOCK / RESIST / MISS）：`rotates()` 恒 false，
 *     世界朝向在 8 个方向上恒为 1 种。
 *
 * 为什么 (b) 也要断言：那五条是**产品决定**而不是「还没做」——ASSET-NOTES 对它们要么
 * 给的是重力方向、要么一个字都没写（PARRY 的 Λ 构图转过头会变 V）。没有这一条，后来者
 * 「顺手补全方向」不会有任何阻力。要改它必须先补上对应的质心量测。
 *
 * 几何公式一律 import tools/geom-probe.mjs 的 heading/rotates/bearing，不在这里重写
 * （那两条公式与 sequencer.js:17070 / 16346 逐条对过，重写一份必然漂）。
 */
/**
 * 位移必须真的落在**攻击轴**上，不是落在贴图的 +x 上。
 *
 * 这两件事只有在 `rotationOffset` 非零时才分得开，而全表只有 HIT 那一行是非零的
 * （-47.86°，因为 ASSET-NOTES 量到那团灰烟火星的漂移方向是右下 47.86° 而不是 +x）。
 * `spriteOffset` 写的是 sprite.position，它挂在
 *   rotationContainer（rotation = 瞄准角 + rotationOffset，sequencer.js:17070）
 *     └ spriteContainer（rotation = -toRadians(cue.angle)，sequencer.js:16346）
 * 之下——**两层**旋转。impact.mjs 的 impactOffset() 因此要先把 (along, lateral) 反向转
 * 掉 rotationOffset - angle；漏掉这一步，HIT 那句「沿攻击轴前移 0.1 格」就会变成
 * 「朝攻击轴右下 47.86° 前移 0.1 格」，而上面那条朝向断言**看不出来**（它只看朝向）。
 *
 * 判据：把 cue.offset 按这条 cue 的世界朝向转到世界坐标系，再投影回攻击轴，
 * 沿轴分量必须等于表里的 along、垂直分量的绝对值必须等于表里的 lateral。
 */
test("轴向位移落在攻击轴上，不落在贴图 +x 上", () => {
  // 与 RESULT_GEOM 的 along / lateral 同一组数，手抄（理由同上一条：import 过来就是自证）。
  const AXIAL = {HIT: {along: 0.10, lateral: 0}, GLANCE: {along: 0.35, lateral: 0.20}};
  const tw = base.targets[0].width ?? 1;
  const bad = [];
  for (const [name, want] of Object.entries(AXIAL)) {
    for (const d of DIRS) {
      const snap = placeAt({
        ...base,
        targets: [{...base.targets[0], results: [{result: RESULT[name], critical: false}],
                   damage: {total: 8, type: "slashing", resource: "health"}}]
      }, d, 1);
      const plan = resolve(snap, {assets: mk(), armory: ARMORY});
      const pt = pointResolver(snap);
      const c = (plan?.cues ?? []).find(x => x.slot === "impact" && x.layer === "result");
      assert.ok(c?.offset, `结果 ${name} / 方向 ${d.name.trim()} 没有结果层或没有偏移`);
      // 世界坐标系里的偏移向量：绕这条 cue 的世界朝向转（heading 已经把两层旋转合起来了）
      const h = heading(c, pt) * Math.PI / 180;
      const wx = c.offset.x * Math.cos(h) - c.offset.y * Math.sin(h);
      const wy = c.offset.x * Math.sin(h) + c.offset.y * Math.cos(h);
      // 投影回攻击轴
      const a = bearing({x: snap.origin.x, y: snap.origin.y}, snap.targets[0]) * Math.PI / 180;
      const along = wx * Math.cos(a) + wy * Math.sin(a);
      const lateral = -wx * Math.sin(a) + wy * Math.cos(a);
      if (Math.abs(along - want.along * tw) > 1e-3) {
        bad.push(`${name}/${d.name.trim()}：沿攻击轴 ${along.toFixed(4)} 格，应为 ${want.along * tw}`);
      }
      if (Math.abs(Math.abs(lateral) - want.lateral * tw) > 1e-3) {
        bad.push(`${name}/${d.name.trim()}：垂直攻击轴 ${Math.abs(lateral).toFixed(4)} 格，`
          + `应为 ${want.lateral * tw}`);
      }
    }
  }
  assert.deepEqual(bad.slice(0, 6), [],
    `${bad.length} 处位移没落在攻击轴上——多半是 impactOffset() 里那次 `
    + "R(angle - rotationOffset) 反向换算被省掉了");
});

test("逐结果裁定：该转的 8 方向 8 种朝向，不该转的恒 1 种", () => {
  // 与 scripts/armory/impact.mjs 的 RESULT_GEOM 同一张表。刻意手抄一份而不是 import：
  // 守卫要能在「有人把表改了」的时候转红，import 过来就变成自证。
  const SHOULD_ROTATE = {HIT: true, GLANCE: true, DODGE: true,
                         ARMOR: false, PARRY: false, BLOCK: false, RESIST: false, MISS: false};
  const withResult = code => ({
    ...base,
    targets: [{...base.targets[0], results: [{result: code, critical: false}],
               damage: {total: 8, type: "slashing", resource: "health"}}]
  });

  for (const [name, code] of Object.entries(RESULT)) {
    const byLayer = new Map();          // layer -> {headings: Set, rots: Set, worst: string}
    for (const d of DIRS) {
      const snap = placeAt(withResult(code), d, 1);
      const plan = resolve(snap, {assets: mk(), armory: ARMORY});
      const pt = pointResolver(snap);
      const want = bearing({x: snap.origin.x, y: snap.origin.y}, snap.targets[0]);
      for (const c of (plan?.cues ?? [])) {
        if (c.slot !== "impact" || c.kind !== "effect") continue;
        const e = byLayer.get(c.layer) ?? {headings: new Set(), rots: new Set(), bad: []};
        byLayer.set(c.layer, e);
        const h = heading(c, pt);
        e.headings.add(h == null ? "?" : h.toFixed(3));
        e.rots.add(rotates(c, pt));
        // 转的那些还要真的落在攻击轴上（扣掉自己声明的常量偏置）
        if (rotates(c, pt)) {
          const axis = want + (c.aim?.rotationOffset ?? 0) - (c.angle ?? 0);
          const err = Math.abs(((h - axis) % 360 + 540) % 360 - 180);
          if (err > 1) e.bad.push(`${d.name.trim()} 差 ${err.toFixed(1)}°`);
        }
      }
    }
    assert.ok(byLayer.size > 0, `结果 ${name} 一条 impact effect 都没有，本用例在空转`);
    for (const [layer, e] of byLayer) {
      // 元素层只在 HIT/GLANCE 上出现，它恒转（残留有弱方向性）。
      const shouldRotate = layer === "element" ? true : SHOULD_ROTATE[name];
      assert.deepEqual([...e.rots], [shouldRotate],
        `结果 ${name} 的 ${layer} 层：rotates() 应当恒为 ${shouldRotate}，实测 ${[...e.rots]}`);
      assert.deepEqual(e.bad, [],
        `结果 ${name} 的 ${layer} 层转了，却没转到攻击轴上：${e.bad.join("、")}`);
      assert.equal(e.headings.size, shouldRotate ? DIRS.length : 1,
        shouldRotate
          ? `结果 ${name} 的 ${layer} 层：8 个方向只给出 ${e.headings.size} 种朝向`
            + "（该转的必须逐方向不同，否则「击打方向不对」原样复发）"
          : `结果 ${name} 的 ${layer} 层：8 个方向给出了 ${e.headings.size} 种朝向。`
            + "这五档是**故意**不转的（ASSET-NOTES 要么给的是重力方向、要么一个字都没写），"
            + "要改必须先补上质心量测，不能顺手补全方向");
    }
  }
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
  // 只钉「条数」：12 种类型 = eskie.damage 十一支（八种元素 + 批次 D1 拆开的物理三系）
  // + void 的 jb2a.impact.012，正好 12 条素材，**一个键一条**。
  // 这个数字从 10 变成 12 就是本轮 KPI 本身：D1 之前物理三系共用一条 jb2a.liquid.splash.red，
  // impact/element 那个最大桶（本地基线 82 个动作）整个压在那一条上。
  // 真正的区分度判定（file+hue 不重复、同模板家族内颜色分支不复用、残留主色 CIEDE2000
  // 达标、物理三系的形状判据）在 test/armory-element-distinct.test.mjs——原先这里写的是
  // `seen.size >= 5`，而 acid 与 poison 是两个不同的文件，撞车的时候它照样数成两种，
  // 拦不住 ASSET-NOTES 明确点名的那一类问题。
  assert.equal(seen.size, DAMAGE_TYPES.length,
    `12 种伤害类型应当一个键一条素材，实际 ${seen.size} 条`);
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

test('kinesis 符文的 "physical" 走别名到钝击，且不算降级', () => {
  // spellcraft.mjs 的 RUNES.kinesis.damageType 是 "physical"——DAMAGE_CATEGORIES 的顶层
  // 类别，不在 DAMAGE_TYPES 的 12 键里。spell-action.mjs 的 #prepareDamage
  // （`type: this.damageType ?? this.rune.damageType`）在玩家没经对话框选类型时会把它
  // 原样写进 damage.type，所以这是真实可达的输入，不是假想输入。
  assert.equal(DAMAGE_ALIAS.physical, "bludgeoning");
  const r = elementCue({targetType: "physical"});
  // ⚠ 批次 D1 之后落到 bludgeoning 不再「视觉等价于落到另外两个」：三键各有各的素材，
  // 走这条别名的 kinesis 法术会稳定显示成钝击的火花螺旋。仍然是兜底而不是错配，
  // 说理见 impact.mjs 的 DAMAGE_ALIAS 注释。
  assert.equal(r.cue.element, "bludgeoning", "physical 应落到钝击（对话框候选列表的第一项）");
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
  // 元素层 12 条 = 12 个文件（批次 D1 之前物理三系共用一条 jb2a.liquid.splash.red，
  // 施工清单 §0.15 已把那条「66/92 件武器命中层逐字相同」的合并翻案）
  "eskie.damage.slashing.01.red":                 {ms: 501,  fps: 30000 / 1001},
  "eskie.damage.piercing.01.red":                 {ms: 501,  fps: 30000 / 1001},
  "eskie.damage.bludgeoning.01.red":              {ms: 501,  fps: 30000 / 1001},
  "eskie.damage.fire.01.orange":                  {ms: 501,  fps: 30000 / 1001},
  "eskie.damage.cold.01.blue":                    {ms: 501,  fps: 30000 / 1001},
  "eskie.damage.electricity.01.blue":             {ms: 501,  fps: 30000 / 1001},
  "eskie.damage.acid.01.green":                   {ms: 501,  fps: 30000 / 1001},
  "eskie.damage.poison.01.purple":                {ms: 501,  fps: 30000 / 1001},
  "eskie.damage.radiant.01.yellow":               {ms: 501,  fps: 30000 / 1001},
  "eskie.damage.psychic.01.pink":                 {ms: 501,  fps: 30000 / 1001},
  "eskie.damage.necrotic.01.teal":                {ms: 501,  fps: 30000 / 1001},
  "jb2a.impact.012.dark_purple":                  {ms: 1100, fps: 30},
  // 治疗汇聚层（批次 D2，RESTORATION_LAYER）——真的治到人时它取代结果层
  "eskie.buff.one_shot.health.green":             {ms: 1502, fps: 30000 / 1001}
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
  // 治疗汇聚层（批次 D2）：主语料的 healed 恒为 0（dump-fixtures 自陈那条路径跑不到），
  // 所以这一层必须用合成快照才够得着——否则它会绕开下面全部 fade / 时长守卫。
  const healing = {
    ...base, usage: {...base.usage, resource: "health"},
    targets: [{...base.targets[0], results: [{result: RESULT.HIT, critical: false}],
               damage: null, healed: 8}]
  };
  for (const c of resolve(healing, {assets: mk(), armory: ARMORY}).cues) {
    if (c.slot === "impact" && c.kind === "effect") seen.set(`restoration|${c.file}`, c);
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
    // duration 的语义是「startTime 之后还要播多久」，不是「相对素材 0 点的绝对终点」
    // ——见 resolver/resolve.mjs 的 CUE_DEFAULTS.duration 与 player/play.mjs 的
    // applyTimeWindow()。两者相加超过素材总长，只可能是有人照着 Sequencer `.duration()`
    // 的表面行为把这张表改成了绝对终点：那样每一条的和都会正好多出一个 startTime。
    if (c.duration !== null && c.startTime > 0) {
      assert.ok(c.startTime + c.duration <= assetMs + 1,
        `${tag}: startTime ${c.startTime} + duration ${c.duration} = ${c.startTime + c.duration}ms ` +
        `超过素材总长 ${assetMs}ms——duration 是「startTime 之后还播多久」，不是绝对终点`);
    }
    // 在素材自然结束之前硬切的 cue，必须自己收尾，否则末帧是一刀切
    if (c.duration !== null && c.duration + 1 < natural) {
      assert.ok(c.fadeOut > 0, `${tag}: duration ${c.duration}ms 把 ${Math.round(natural)}ms 的素材` +
        `截断了，必须给 fadeOut 收尾`);
    }
  }
});

test("eskie 元素层不做淡出、也不许大淡入：裁完只剩 233-266ms", () => {
  // 11 支 eskie（批次 D1 之后物理三系也在其中）用 startTime 裁掉自带白爆闪之后有效时长
  // 只剩 233-266ms，30% 预算就是 70-80ms。f7 是一张已成形的满幅图，硬切入需要一点淡入
  // 遮丑（60ms 约两帧），而残留段素材自己就衰减到 0、duration 又补到素材自然收尾，
  // 再叠 fadeOut 是二次衰减。
  for (const d of ["fire", "cold", "electricity", "acid", "poison", "radiant", "psychic", "corruption",
                   "slashing", "piercing", "bludgeoning"]) {
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
