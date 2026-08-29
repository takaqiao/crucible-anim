/**
 * 播放层的行为契约：用记录型 Sequencer 桩驱动**真实的** `playPlan()`，断言「play.mjs
 * 对 Sequencer 说了什么」。
 *
 * 为什么是行为断言而不是源码正则：本轮修掉的四类缺陷（stretchTo 与 scaleToObject 同用、
 * startTime+duration 被当成绝对终点、退化的 rotateTowards 挪走半个身位、零长拉伸）
 * 全都是**对 cue 数据敏感的路径属性**——正则只看得见文本，一次「统一缩放入口」的重构
 * 就能在保留原句的同时把 bug 整个装回去（实测过：把正确的 `else if (!cue.stretchTo)`
 * 原样留着、在稍后处再加一句 `if (!cue.scale) e.scaleToObject(...)`，正则守卫全绿，
 * 本文件第一条用例立刻变红）。
 *
 * 判据全部来自 Sequencer 4.2.3 源码（/root/fvtt14-data/Data/modules/sequencer/dist/
 * sequencer.js，行号写在各断言的失败信息里）；判据本身还在不在，由
 * test/sequencer-contract.test.mjs 负责钉住。
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

import {installFakeSequencer, EFFECT_METHODS, SOUND_METHODS} from "../tools/fake-sequencer.mjs";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {resolve, resolveEffect} from "../scripts/resolver/resolve.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import {PLAN_VERSION, RESULT} from "../scripts/const.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const actions = JSON.parse(readFileSync(join(ROOT, "test/fixtures/actions.json"), "utf8"));
const effects = JSON.parse(readFileSync(join(ROOT, "test/fixtures/effects.json"), "utf8"));
const mk = () => createAssets(offlineBackend(index));

/* ---- resolveRef 替身 ----------------------------------------------------- */

/**
 * 这就是 Task 14 `resolveRefIn()` 必须满足的契约，三条优先级缺一不可：
 *   1. `ref:"point"` —— 冻结坐标，**永远**原样返回，绝不升格成 placeable
 *      （模板锚点的 stretchTo 终点与 mask 都取自 region 坐标，一旦升格成 token 中心，
 *       起点/终点/遮罩就来自两套原点）；
 *   2. 带 uuid 或 tokenId —— 身份锚点，优先解析成真 placeable（attachTo / copySprite
 *      必须拿到 placeable）；
 *   3. 只剩坐标 —— 退化成裸点。
 *
 * placeable 的 `x/y` 刻意给成**左上角**（与 Foundry 的 Token 一致）、`center` 才是中心：
 * play.mjs 的 pointOf() 若不优先取 center，每条命中 cue 都会被误判成「瞄准点与锚点不同」
 * 而把 rotateTowards 装回去。
 */
function makeResolveRef(snapshot) {
  const byId = new Map();
  const put = g => {
    if (!g?.tokenId) return;
    byId.set(g.tokenId, {
      document: {uuid: g.uuid ?? `Scene.s.Token.${g.tokenId}`},
      id: g.tokenId,
      x: g.x - (g.w ?? 100) / 2, y: g.y - (g.h ?? 100) / 2,
      center: {x: g.x, y: g.y}, w: g.w ?? 100, h: g.h ?? 100
    });
  };
  put(snapshot.origin);
  put(snapshot.target);
  for (const t of snapshot.targets ?? []) put(t);
  return at => {
    if (!at) return null;
    if (at.ref === "point") return Number.isFinite(at.x) ? {x: at.x, y: at.y} : null;
    if (at.tokenId && byId.has(at.tokenId)) return byId.get(at.tokenId);
    if (Number.isFinite(at.x) && Number.isFinite(at.y)) return {x: at.x, y: at.y};
    return null;
  };
}

const pt = o => { const p = o?.center ?? o; return {x: p?.x, y: p?.y}; };
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/* ---- 全量语料 ------------------------------------------------------------ */

/**
 * 每个动作按 8 种攻击结果各跑一遍。fixture 自己只带 HIT（result 7），而 ARMOR / BLOCK /
 * MISS 这些在实战里极常见的结果层恰恰是受时间窗口缺陷伤得最重的几条（ARMOR 的
 * 467+266 修前会被 clamp 到 0ms、完全不可见），missed 偏移这条支路也只有在 MISS/DODGE
 * 下才会被行使到。
 */
function corpus() {
  const out = [];
  for (const a of actions) {
    for (const result of Object.values(RESULT)) {
      const s = {...a, targets: (a.targets ?? []).map(t => ({
        ...t, results: (t.results ?? []).map(r => ({...r, result}))
      }))};
      out.push(s);
    }
  }
  return out;
}

/** 跑一遍全量语料，返回桩记录 + 期望值统计。 */
async function runAll({faultOn = null, snapshots = null} = {}) {
  const fake = installFakeSequencer({faultOn});
  const warns = [];
  const realWarn = console.warn;
  console.warn = (...a) => warns.push(a.map(String).join(" "));
  const {playPlan} = await import("../scripts/player/play.mjs");   // 文件没了就硬失败，绝不 skip
  try {
    const plans = [];
    for (const s of snapshots ?? corpus()) {
      const p = resolve(s, {assets: mk(), armory: ARMORY});
      if (p) plans.push([p, makeResolveRef(s)]);
    }
    if (!snapshots) {
      for (const e of effects) {
        const p = resolveEffect(e, {assets: mk(), armory: ARMORY});
        if (p) plans.push([p, makeResolveRef(e)]);
      }
    }
    let cues = 0;
    for (const [plan, resolveRef] of plans) {
      cues += plan.cues.length;
      await playPlan(plan, {volume: 1, shake: true, resolveRef});
    }
    return {fake, records: fake.records, sequences: fake.sequences,
            plans: plans.map(p => p[0]), planCount: plans.length, cues, warns};
  } finally { fake.restore(); console.warn = realWarn; }
}

const R = await runAll();
/** 全量语料里的 cue，与 R.records 一一对应（play.mjs 对每条画得出的 cue 恰好建一个 section）。 */
const ALL_CUES = R.plans.flatMap(p => p.cues);

/**
 * 一条带 `mask:"region"` 的 cue，它的模板是什么形状。
 *
 * 遮罩形状由 `regionMaskShape`（play.mjs:172-）按 `region.type` 分派，不是恒为多边形：
 * circle → `PIXI.Circle`，cone / line → 多边形。批次 C 给 blast 补出 travel cue 之后，
 * 圆形模板的遮罩第一次真的被下发，两条写死 "polygon" 的断言因此整片红。
 */
const maskKind = (cue, plans) => plans.find(p => p.cues.includes(cue))?.region?.type ?? "(无)";
/** 模板形状 → 期望的遮罩几何。 */
const MASK_SHAPE = Object.freeze({circle: "circle", cone: "polygon", line: "polygon"});

/* ---- 〇、语料自查：断言不能是空转 ---------------------------------------- */

test("桩确实跑通了：全量语料构造出成千条 section，且覆盖到各条支路", () => {
  assert.ok(R.planCount > 3000, `只解析出 ${R.planCount} 条计划，语料缩水了`);
  assert.ok(R.cues > 12000, `只有 ${R.cues} 条 cue，语料或 resolver 出问题了，本文件会变成空跑`);
  assert.equal(R.records.length, R.cues,
    "section 数与 cue 数对不上：有 cue 被静默吞掉，或者一条 cue 建了多个 section");
  const n = m => R.records.filter(r => r.has(m)).length;
  // 2026-08-29 批次 C：1500 → 1100（实测 1128）。批次 C 给 fan / blast / contact / step /
  // aura / create 六个手势补了专属规则，其中区域类置 once —— 一个动作出 1 条 cue 而不是每目标
  // 各一条。于是 84 条法术从 generic.travel（每目标一条 stretchTo 飞行物）挪走，实例数整体下降。
  // ⚠ 下调前查过「字段是不是丢了」：全语料 141 条带 stretchTo 的画面 cue，**没带 template 的 0 条**。
  assert.ok(n("stretchTo") > 900, `带 stretchTo 的 section 只有 ${n("stretchTo")} 条，相关断言会空转`);
  // 2026-08-29 批次 B 第 6 步：1000 → 500（实测 606）。impact 主规则整槽退出了 missed
  // ——它的 MISS/DODGE 两行改用确定性几何（施工清单 §0.7 的 .missed() 翻案：
  // calculate_missed_position 的 !target 分支是逐客户端随机的，而本模组每台机器本地播
  // 同一份 plan）。剩下的 606 条是飞行物落空（generic.travel 336 / spell.gesture.arrow 48 /
  // strike.ranged.weapon 36 / strike.thrown 12 / strike.shape.charge 10 /
  // strike.shape.area 8）与 generic.impact 的落空两档 156——那几支都**不转向**，
  // .missed() 在它们身上是原设计的用法。下限跟着实测走，不是放水。
  // 2026-08-29 批次 C：500 → 300（实测 318）。降的 288 条**全部**是 generic.travel 的：
  // 它服务的法术从 84 条掉到 12 条（−72 个动作 × 每动作 4 条 = −288），与实测差额逐条对上。
  // 区域姿态锚在模板上、不锚在某个目标身上，.missed() 对它们本来就没有意义。
  // 三次下调：1000 → 500（批次 B）→ 300（批次 C）→ **260**（2026-08-30 施工清单 §0.10 收尾，
  // 实测 270）。这次降的是 `spell.*.strike` 那 12 条：`strike` 手势拿到专属规则之后
  // 画的是一记附魔剑挥砍（近战，不 stretchTo、不 missed），不再是 generic.travel 的飞行物。
  // ⚠ 至此 `generic.travel` **一条「每目标一份的飞行段」都不再产出**——原先落在它那儿的
  // 84 条法术已全部被专属规则接管，这正是 §0.10 要的结果。
  assert.ok(n("missed") > 260, `带 missed 的 section 只有 ${n("missed")} 条，相关断言会空转`);
  assert.ok(n("timeRange") > 1500, `带 timeRange 的 section 只有 ${n("timeRange")} 条，相关断言会空转`);
  assert.ok(n("mask") > 100, `带 mask 的 section 只有 ${n("mask")} 条`);
  assert.ok(n("persist") > 40, `带 persist 的 section 只有 ${n("persist")} 条`);
  assert.ok(n("attachTo") > 100, `带 attachTo 的 section 只有 ${n("attachTo")} 条`);
});

/* ---- 一、Sequencer 明令互斥的组合一条都不许出现 -------------------------- */

test("stretchTo 与 scaleToObject 绝不出现在同一条 cue 上", () => {
  const stretched = R.records.filter(r => r.has("stretchTo"));
  const bad = stretched.filter(r => r.has("scaleToObject"));
  assert.equal(bad.length, 0,
    `${bad.length} 条 cue 同时调用了 .stretchTo() 与 .scaleToObject()。Sequencer 4.2.3 在 `
    + "_expressWarnings()（sequencer.js:24917-24923）对这个组合直接 throw，抛点在 "
    + "EffectSection.run()（25003）里、位于 Section._execute() 的 "
    + "`new Promise(async resolve => setTimeout(...))` executor 内（21511-21536）——resolve() "
    + "永不被调用；而 _waitAnyway（21247-21249）让最后一条 section 无论如何都被 await"
    + "（27772），Sequence.play() 末尾的 Promise.allSettled（27782）因此永不返回，"
    + "playPlan() 整条挂死，后面的 cue 一条都播不到");
});

test("stretchTo 不与 Sequencer 明令互斥的其余选项同用", () => {
  for (const [m, line] of [["randomRotation", "24924-24930"], ["moveTowards", "24931-24937"]]) {
    const bad = R.records.filter(r => r.has("stretchTo") && r.has(m));
    assert.equal(bad.length, 0,
      `${bad.length} 条 cue 同时用了 stretchTo 与 ${m}（sequencer.js:${line} 直接 throw，同样挂死整条序列）`);
  }
});

test("每条 effect section 都说得出自己在哪播", () => {
  const bad = R.records.filter(r => r.kind === "effect"
    && !r.has("atLocation") && !r.has("attachTo") && !r.has("copySprite"));
  assert.equal(bad.length, 0,
    '既无 atLocation 也无 attachTo/copySprite 的 section 会让 _expressWarnings（24957）抛 '
    + '"Could not determine where to play the effect!"，走的是同一条挂死路径');
});

test("scaleToObject 拿到的一定是有限数", () => {
  const bad = R.records.filter(r => r.get("scaleToObject")
    .some(c => typeof c.args[0] !== "number" || !Number.isFinite(c.args[0])));
  assert.equal(bad.length, 0, "scaleToObject 对非 is_real_number 入参直接 throw");
});

/* ---- 二、瞄准与锚点 ------------------------------------------------------ */

test("带 stretchTo 的 cue 一律不叠 rotateTowards", () => {
  const bad = R.records.filter(r => r.has("stretchTo") && r.has("rotateTowards"));
  assert.equal(bad.length, 0,
    `${bad.length} 条 cue 同时调了 stretchTo 与 rotateTowards。拉伸自己就会转向`
    + "（_transformSprite 17080-17083 → _applyDistanceScaling 16992-16994 的 _rotateTowards(ray)），"
    + "而 EffectSection 的 _target 取值器（23184-23186）把 stretchTo 排在 rotateTowards 之前，"
    + "后者给的位置根本进不了 data.target；它剩下的唯一作用是 _setAnchors（17026-17028）把 "
    + "spriteContainer.pivot 覆盖成 (sprite.width*-0.5, 0)——拉伸后 sprite.width ≈ 射线长度，"
    + "整条光束因此沿射线前移半个自身长度");
});

test("瞄准点与锚点重合时不调 rotateTowards（否则 sprite 白挪半个身位）", () => {
  const bad = [];
  for (const r of R.records) {
    if (!r.has("rotateTowards")) continue;
    const loc = r.argOf("atLocation") ?? r.argOf("attachTo");
    assert.ok(loc, "调了 rotateTowards 却没有 atLocation/attachTo，无从判断是否退化");
    const d = dist(pt(loc[0]), pt(r.argOf("rotateTowards")[0]));
    if (d <= 1) bad.push(`两点相距 ${d.toFixed(2)}px，file=${r.argOf("file")?.[0]}`);
  }
  assert.deepEqual(bad.slice(0, 5), [],
    `${bad.length} 条 cue 对着自己的锚点 rotateTowards。Ray(p,p).angle = atan2(0,0) = 0，`
    + "转向是纯 no-op，唯一净效果是 _setAnchors（17026-17028）那句 pivot.set(width*-0.5, 0)"
    + "——整张贴图沿 +x 平移半个身位，scaleToObject 到格宽的命中闪光会落在目标身侧而不是身上；"
    + "同一条 pivot 还会让 randomRotation 从原地自转变成绕半个身位公转");
});

test("真要转向时必须同时给出 anchor，抵消 rotateTowards 的边缘 pivot", () => {
  let plain = 0, templated = 0;
  for (const r of R.records) {
    if (!r.has("rotateTowards")) continue;
    const a = r.argOf("anchor");
    // ⚠ **模板锚点分支正好相反：那一支必须不调 anchor()。** 17026 的判据是
    // `rotateTowards && !rotateTowards.template && !data.anchor`——template 为真时
    // `!template` 已经为假，pivot 本来就走 17029 的 interpolate 中心分支，不需要 anchor
    // 来纠正；而 `data.anchor` 一旦存在，17023 那句 `startPoint / 贴图宽`（＝素材标定的
    // 握把点）就只影响 sprite.anchor，pivot 会按写死的 0.5 再偏一次，「锚点＝握把」当场作废。
    // 语料里这一支自 2026-08-29 批次 B 第 5 步起真的存在（travel.mjs 四条近战规则），
    // 所以这条断言必须分叉；下面的计数保证两支都不是空真。
    if (r.argOf("rotateTowards")?.[1]?.template === true) {
      templated++;
      assert.equal(a, undefined,
        "模板锚点的转向不许调 anchor()：调了 pivot 会把握把点推回贴图中心");
      continue;
    }
    plain++;
    assert.ok(a, "调了 rotateTowards 却没有 anchor：_setAnchors 17026 的判据是 "
      + "`rotateTowards && !rotateTowards.template && !data.anchor`，缺 anchor 就走 -w/2 分支");
    assert.deepEqual(a[0], {x: 0.5, y: 0.5},
      "anchor 必须是 {x:0.5,y:0.5}：17029-17041 的 interpolate(-w/2, w/2, 0.5) = 0，"
      + "pivot 才回到中心。注意 anchor.x 给 0 会落回同一个 -w/2");
  }
  // 两支都得有样本，否则上面任何一半都可能是空真通过的。
  assert.ok(templated > 0, "语料里一条模板锚点的转向都没有——近战四条规则的 template 是不是掉了？");
  assert.ok(plain > 0, "语料里一条不带模板的转向都没有，历史语义那一支已经测不到了");
});

test("带 stretchTo 时绝不调 anchor", () => {
  const bad = R.records.filter(r => r.has("stretchTo") && r.has("anchor"));
  assert.equal(bad.length, 0,
    "_expressWarnings（24909-24916）对 `_stretchTo && _anchor?.x` 走 _showWarning(notify=true)，"
    + "每条光束弹一次 ui 通知；而 anchor.x 给 0 来绕过这条判据又正好回到 -w/2，等于没修");
});

test("aim.missed 的 cue 一律调 .missed(true)，与调不调 rotateTowards 无关", () => {
  const expected = ALL_CUES.filter(c => c.aim?.missed).length;
  const actual = R.records.filter(r => r.argOf("missed")?.[0] === true).length;
  // 下限两次下调：1000 → 500（批次 B，impact 主规则按 §0.7 的翻案整槽退出 missed，实测 606）
  // → 300（批次 C，实测 318）。第二次降的 288 条**全部**是 generic.travel 的：它服务的法术
  // 从 84 条掉到 12 条（−72 个动作 × 每动作 4 条 = −288），与实测差额逐条对上。
  // 区域姿态锚在模板上、不锚在某个目标身上，`.missed()` 对它们本来就没有意义。
  assert.ok(expected > 260, `语料里只有 ${expected} 条 missed cue，这条断言测不出东西`);
  assert.equal(actual, expected,
    `${expected} 条 cue 声明了 aim.missed，播放层只调出 ${actual} 次 .missed(true)`);
});

test("落空的非拉伸反馈不带 data.target，missed 偏移才会真的挪动特效", () => {
  // _getOffset（sequencer.js:15349-15365）源点那一侧的判据是
  //   `this.data.missed && (!source || !this.data.target)`
  // 而 rotateTowards / stretchTo 任何一个都会经 EffectSection._target（23184-23186）把
  // data.target 填上。拉伸类的偏移作用在终点上是对的（光束扫到旁边）；非拉伸的命中反馈
  // 一旦装上 rotateTowards，特效仍然正落在锚点、只有转向被打歪，画面读起来还是命中。
  const bad = R.records.filter(r =>
    r.has("missed") && !r.has("stretchTo") && r.has("rotateTowards"));
  assert.equal(bad.length, 0,
    `${bad.length} 条非拉伸的 missed cue 同时装了 rotateTowards，`
    + "calculate_missed_position 的 !target 分支进不去，落点不会偏");
});

test("每条 stretchTo 的起点与终点都真的隔开", () => {
  const bad = [];
  for (const r of R.records) {
    if (!r.has("stretchTo")) continue;
    const loc = r.argOf("atLocation") ?? r.argOf("attachTo");
    const d = dist(pt(loc[0]), r.argOf("stretchTo")[0]);
    if (d <= 1) bad.push(`${d.toFixed(2)}px, file=${r.argOf("file")?.[0]}`);
  }
  assert.deepEqual(bad.slice(0, 5), [],
    `${bad.length} 条零长拉伸。_updateCurrentFilePath（sequencer.js:16235-16255，`
    + "由 _initialize 15629 以 showDistanceWarning=true 调用）会对 distance===0 弹一条红色 "
    + "ui.notifications.error；_getDistanceScaling（16966-16985）把 spriteScale 算成 0，"
    + "_applyDistanceScaling（17014-17017）于是 sprite.scale.set(0,0)——飞行物整个不可见");
});

/* ---- 三、时间窗口 -------------------------------------------------------- */

/**
 * 复算 Sequencer 4.2.3 `CanvasEffect._calculateDuration()`（16049-16106）里与时间窗口
 * 有关的几行，用来把「调用链」翻译成「实际播出多少毫秒」——失败信息因此能直接说出
 * 「会播 N 毫秒」而不只是「调用形状不对」。
 *   16052  _animationDuration = data.duration || mediaDurationMs
 *   16092  data.time.start  → _startTime
 *   16097  _endTime = _animationDuration                       ← 没有 time.end 时
 *   16102  _endTime = time.isRange ? end.value : _animationDuration - end.value
 *   16106  _animationDuration = clamp(endTimeMs - startTimeMs, 0, _animationDuration)
 */
function sequencerWindow({duration = false, time = false, mediaMs}) {
  let anim = duration || mediaMs;
  let start = 0;
  if (time && time.start) start = time.start.isPerc ? anim * time.start.value : time.start.value;
  let end = anim;
  if (time && time.end) {
    end = time.end.isPerc ? anim - anim * time.end.value
        : (time.isRange ? time.end.value : anim - time.end.value);
  }
  return {start, end, animMs: Math.min(Math.max(end - start, 0), anim)};
}

/** 把调用链还原成 Sequencer 会看到的 data.duration / data.time（_sanitizeEffectData 25329-25344）。 */
function timeDataOf(rec) {
  let dur = false, s = null, e = null, sPerc = false, ePerc = false, isRange = false;
  for (const {m, args} of rec.calls) {
    if (m === "duration") dur = args[0];
    else if (m === "startTime") { s = args[0]; sPerc = false; isRange = false; }
    else if (m === "endTime") { e = args[0]; ePerc = false; isRange = false; }
    else if (m === "timeRange") { s = args[0]; e = args[1]; isRange = true; }
  }
  const num = v => typeof v === "number" && Number.isFinite(v);
  return {
    duration: dur,
    time: (s || e) ? {start: num(s) ? {value: s, isPerc: sPerc} : false,
                      end: num(e) ? {value: e, isPerc: ePerc} : false, isRange} : false
  };
}

test("同时有 startTime 与 duration 的 cue 必须用 timeRange 下发，实际播出时长等于兵库 duration", () => {
  const pairs = R.records.map((r, i) => ({r, c: ALL_CUES[i]}))
    .filter(({c}) => (c.startTime ?? 0) > 0 && c.duration !== null);
  assert.ok(pairs.length > 1500,
    `受此语义支配的 cue 只有 ${pairs.length} 条，语料或兵库缩水了，这条守卫会形同虚设`);

  for (const {r, c} of pairs) {
    const tag = `${c.slot}/${c.rule}/${c.layer ?? "-"}`;
    const start = c.startTime, dur = c.duration;
    assert.equal(r.count("startTime"), 0,
      `${tag}: 不许调 .startTime()——它与 .duration() 同时出现时，Sequencer 把 duration 当成`
      + `"相对素材 0 点的绝对终点"（sequencer.js:16097 + 16106 的 clamp），实际只播 `
      + `max(0, ${dur}-${start}) = ${Math.max(0, dur - start)}ms，而不是 ${dur}ms`);
    assert.equal(r.count("timeRange"), 1, `${tag}: 应当恰好调一次 .timeRange()`);
    assert.deepEqual(r.argOf("timeRange"), [start, start + dur],
      `${tag}: timeRange 实参应为 [startTime, startTime+duration]`);
    assert.equal(r.count("duration"), 1,
      `${tag}: timeRange 之外仍要留 .duration(${dur})——它把 16106 的 clamp 上限钉在 ${dur}，`
      + "让播出时长只取决于兵库写的这两个数，不取决于素材当场报出来的 mediaDurationMs");
    assert.deepEqual(r.argOf("duration"), [dur], `${tag}: duration 实参不对`);

    const w = sequencerWindow({...timeDataOf(r), mediaMs: 1e6});
    assert.deepEqual([w.start, w.end], [start, start + dur], `${tag}: 复算出的媒体窗口不对`);
    assert.equal(w.animMs, dur, `${tag}: 复算出实际播出 ${w.animMs}ms，兵库要的是 ${dur}ms`);
  }
});

test("只给 startTime / 只给 duration 的 cue 保持原样下发", () => {
  for (const [i, r] of R.records.entries()) {
    const c = ALL_CUES[i];
    const start = c.startTime ?? 0, dur = c.duration;
    const tag = `${c.slot}/${c.rule}/${c.layer ?? "-"}`;
    if (start > 0 && dur !== null) continue;              // 上一条用例管
    if (c.kind === "shake") continue;                     // shake 分支自带 400ms 兜底
    assert.equal(r.count("timeRange"), 0, `${tag}: 没有完整窗口就不该用 timeRange`);
    if (start > 0) {
      assert.deepEqual(r.argOf("startTime"), [start], `${tag}: 应当调一次 .startTime(${start})`);
    } else {
      assert.equal(r.count("startTime"), 0, `${tag}: startTime 为 0 时不必下发`);
    }
    if (dur !== null) {
      assert.deepEqual(r.argOf("duration"), [dur], `${tag}: 应当调一次 .duration(${dur})`);
    } else {
      assert.equal(r.count("duration"), 0, `${tag}: duration 为 null 时不许下发`);
    }
  }
});

test("全量语料没有任何一个 section 同时调用 .startTime() 与 .duration()", () => {
  const bad = R.records.map((r, i) => ({r, c: ALL_CUES[i]}))
    .filter(({r, c}) => c.kind !== "shake" && r.count("startTime") > 0 && r.count("duration") > 0)
    .map(({c}) => `${c.slot}/${c.rule}/${c.layer ?? "-"}`);
  assert.deepEqual([...new Set(bad)], [],
    "这个组合会触发 sequencer.js:16106 的 clamp(endTimeMs - startTimeMs, 0, duration)，"
    + "把 duration 当成绝对终点；表达「从 s 播到 s+d」的唯一入口是 .timeRange(s, s+d)");
});

/* ---- 四、槽级契约与字段透传 ---------------------------------------------- */

test("seq 构造与 play 的四个开关", () => {
  assert.ok(R.sequences.length > 3000);
  for (const s of R.sequences) {
    assert.equal(s.options?.softFail, true,
      "缺 softFail 时每个缺失素材都会弹一次 ui.notifications.error");
    assert.equal(s.options?.moduleName, "crucible-anim");
    assert.equal(s.played?.local, true,
      "缺 local:true 会让 preload 走 preloadForClients 向全场广播并等所有客户端应答");
    assert.equal(s.played?.preload, true);
    assert.equal("remote" in (s.played ?? {}), false, "本模组不使用 Sequencer 的跨客户端通路");
  }
});

test("persist 契约落到实处：persist + temporary + tieToDocuments + origin", () => {
  const pers = R.records.map((r, i) => ({r, c: ALL_CUES[i]})).filter(({c}) => c.persist);
  assert.ok(pers.length > 40, `只有 ${pers.length} 条 persist cue，这条断言会空转`);
  for (const {r, c} of pers) {
    assert.deepEqual(r.argOf("persist"), [true, {persistTokenPrototype: false}]);
    assert.deepEqual(r.argOf("temporary"), [true],
      "worldPersist 恒 false ⇒ temporary(true)：Sequencer 的落盘判据（11819）里没有 "
      + "!data.local 子句，.locally() 拦不住写盘");
    assert.deepEqual(r.argOf("tieToDocuments"), [[c.tieTo]]);
    assert.deepEqual(r.argOf("origin"), [c.tieTo],
      "兜底清理按 origin 过滤，而 _filterEffects（11694-11703）的 name 与 origin 是 AND");
    assert.equal(r.has("name"), false, "只设 origin 不设 name，理由同上");
  }
});

test("worldPersist 字段缺失时 temporary 仍为 true（用 !== true 而不是 === false）", async () => {
  const base = R.plans.find(p => p.cues.some(c => c.persist));
  const cue = {...base.cues.find(c => c.persist)};
  delete cue.worldPersist;
  const fake = installFakeSequencer();
  try {
    const {playPlan} = await import("../scripts/player/play.mjs");
    await playPlan({...base, cues: [cue]}, {volume: 1, shake: true,
      resolveRef: at => ({document: {uuid: "u"}, x: at.x ?? 0, y: at.y ?? 0,
                          center: {x: at.x ?? 0, y: at.y ?? 0}})});
    assert.deepEqual(fake.records[0].argOf("temporary"), [true]);
  } finally { fake.restore(); }
});

test("tint / filter / mask 只在 cue 真声明了才下发", () => {
  let tinted = 0, masked = 0;
  for (const [i, r] of R.records.entries()) {
    const c = ALL_CUES[i];
    assert.equal(r.has("tint"), !!c.tint, `${c.rule}: tint 下发与 cue 声明不一致`);
    if (c.tint) { tinted++; assert.deepEqual(r.argOf("tint"), [c.tint]); }
    if (c.mask === "region") {
      masked++;
      assert.equal(r.count("mask"), 1, `${c.rule}: mask:"region" 必须真的下发一个形状`);
      const shape = r.argOf("mask")[0];
      // 遮罩形状**跟着模板形状走**，不是恒为多边形：`regionMaskShape`（play.mjs:172-176）
      // 对 circle 返回 `PIXI.Circle`，对 cone/line 才返回多边形。
      // ⚠ 这条断言原本写死 `"polygon"`——批次 C 给 blast 补出 travel cue 之后，
      // 圆形模板的遮罩第一次真的被下发，它就整片红了。守的东西没变，口径漏了一种形状。
      assert.equal(shape.__shape, MASK_SHAPE[maskKind(c, R.plans)] ?? "polygon",
        `${c.rule}: ${maskKind(c, R.plans)} 模板的遮罩形状不对`);
    } else {
      assert.equal(r.count("mask"), 0, `${c.rule}: 没声明 mask 却下发了遮罩`);
    }
  }
  assert.ok(tinted > 0 && masked > 100, `tint ${tinted} 条、mask ${masked} 条，覆盖不足`);
});

test("mask 形状的锚点落在 plan.region 上", () => {
  for (const p of R.plans) {
    if (!p.cues.some(c => c.mask === "region")) continue;
    assert.ok(p.region, "声明了 mask:region 的计划必须带 region");
  }
  // ⚠ 逐条核**全部**带遮罩的 cue，不是只核第一条。
  // 原来只取 `findIndex` 的那一条，于是「第一条恰好是多边形」时整条断言就绿了——
  // 批次 C 给 blast 补出圆形遮罩后第一条变成圆，`shape.points[0]` 直接 TypeError。
  // 只核一条既漏得多、又让失败信息取决于遍历顺序。
  const kinds = new Map();
  for (let i = 0; i < ALL_CUES.length; i++) {
    const c = ALL_CUES[i];
    if (c.mask !== "region") continue;
    const plan = R.plans.find(p => p.cues.includes(c));
    const shape = R.records[i].argOf("mask")[0];
    const kind = maskKind(c, R.plans);
    kinds.set(kind, (kinds.get(kind) ?? 0) + 1);
    if (shape.__shape === "polygon" && kind === "cone") {
      // 锥形：`grid.getCone` 的文档原话是「the first point of the polygon is the origin」，
      // flat 分支的扁三角也是从锥尖起笔——两支都能用「首顶点 == 锥尖」验。
      assert.deepEqual([shape.points[0], shape.points[1]], [plan.region.x, plan.region.y],
        `${c.rule}: 锥形遮罩的第一个顶点必须是锥尖`);
    } else if (shape.__shape === "polygon") {
      // 线形：遮罩是**绕线轴的矩形**（play.mjs 的 line 分支，4 个角各沿法线偏半个线宽），
      // 所以首顶点是「线首 + 半宽」，**不是**线首本身。
      // ⚠ 这条断言原本一律按锥形的「首顶点 == 起点」验，`spell.gesture.ray` 实测
      // 首顶点 (500,510)、线首 (500,500)，差的正好是 width 20 的一半。
      // 正确的不变式是：**首边的中点**（顶点 0 与顶点 3）落在线首上。
      const midX = (shape.points[0] + shape.points[6]) / 2;
      const midY = (shape.points[1] + shape.points[7]) / 2;
      assert.ok(Math.abs(midX - plan.region.x) < 1e-6 && Math.abs(midY - plan.region.y) < 1e-6,
        `${c.rule}: 线形遮罩首边的中点必须是线首，实得 (${midX},${midY}) 期望 (${plan.region.x},${plan.region.y})`);
    } else {
      assert.deepEqual([shape.x, shape.y], [plan.region.x, plan.region.y],
        `${c.rule}: 圆形遮罩的圆心必须是模板中心`);
      assert.equal(shape.radius, plan.region.radius,
        `${c.rule}: 圆形遮罩的半径必须等于模板半径`);
    }
  }
  // 样本量下限：两种形状都必须真的被行使到，否则上面那两支里有一支是空真。
  assert.ok((kinds.get("cone") ?? 0) + (kinds.get("line") ?? 0) > 100,
    `多边形遮罩只核到 ${JSON.stringify([...kinds])} 条`);
  assert.ok((kinds.get("circle") ?? 0) > 0,
    "一条圆形遮罩都没核到——blast 那一支要么没出 cue，要么没声明 mask");
});

test("play.mjs 只调用 Sequencer 上真实存在的方法", () => {
  const allowed = new Set([...EFFECT_METHODS, ...SOUND_METHODS]);
  const used = new Set();
  for (const r of R.records) for (const c of r.calls) used.add(c.m);
  for (const m of used) assert.ok(allowed.has(m), `用到了白名单外的方法 .${m}()`);
  assert.ok(used.size > 20, `只用到 ${used.size} 个方法，桩没跑通`);
});

/**
 * 已知待修、暂时豁免的播放层告警。
 *
 * 规矩与 fallback-ratchet 一样：**豁免必须点名到规则、必须带贴着实测的条数上限**，
 * 修完就删。豁免一个「凡是……都放过」的模式等于把这条守卫关掉。
 *
 * 【2026-08-29 清空】原本这里豁免着 `aftermath.groundResidue` 的 192 条告警
 *（它 `at: {ref:"point"}` 锚在爆心却用 `objectScale:1.3` 表达大小，而 scaleToObject
 * 在裸点上恒等于「一格」）。批次 B 收口时已经在 `armory/aftermath.mjs` 那侧按 region
 * 半径补上了 `sizePx`，24 条 cue 全部改完、告警归零，**豁免连同数字一起删掉**。
 *
 * ⚠ 顺带订正当时写在这里的一个数：原注释说「Crucible 微网格 = 20px → 26×26px，
 * 小 9.2 倍」——那个 20 是 `canvas.dimensions.distancePixels`（px/ft），不是格宽。
 * Crucible 的 `grid.distance = 5 ft`，格宽是 100px，真实倍率是 130px vs 240px、
 * **偏小 1.85 倍**。结构性结论不变，数字当时错了一个量级。
 *
 * 空表不是「这条守卫没用了」：它现在是纯粹的零容忍——任何新的播放层告警都会让它红。
 */
const WARN_EXEMPT = [];

test("全量语料跑完 playPlan 一条 warn 都不出", () => {
  const rest = [];
  const hits = new Map(WARN_EXEMPT.map(x => [x.needle, 0]));
  for (const w of R.warns) {
    const ex = WARN_EXEMPT.find(x => w.includes(x.needle) && w.includes(x.rule));
    if (ex) hits.set(ex.needle, hits.get(ex.needle) + 1);
    else rest.push(w);
  }
  assert.deepEqual(rest.slice(0, 5), [], `${rest.length} 条豁免之外的播放层告警`);
  // 双向钉死：多了说明缺陷扩散，少了说明已经修完、豁免该删。
  for (const ex of WARN_EXEMPT) {
    const n = hits.get(ex.needle);
    assert.ok(n <= ex.max, `"${ex.rule}" 的已知告警从 ${ex.max} 涨到 ${n} 条——缺陷扩散了`);
    assert.ok(n > 0,
      `"${ex.rule}" 的已知告警一条都不出了：要么已经给它补上 sizePx（那就把这条豁免删掉），`
      + "要么播放层那条「裸点禁 objectScale」的硬规则被谁绕过去了");
  }
});

/* ---- 五、fixture 覆盖不到的支路：合成计划直接喂 playPlan ------------------ */

const CUE_STUB = {
  kind: "effect", playIf: "always", file: "x.webm", slot: "travel", rule: "synthetic",
  attachTo: false, bindScale: false, local: true, opacity: 1, fadeIn: 0, fadeOut: 0,
  fadeInEase: "linear", fadeOutEase: "linear", zIndex: 50, delay: 0, startTime: 0,
  playbackRate: 1, belowTokens: false, gridUnits: false, objectScale: 1, scale: null,
  offset: {x: 0, y: 0}, mirrorY: false, randomizeMirrorY: false, randomRotation: false,
  elevation: null, duration: null, tint: null, filter: null, mask: null, volume: 1,
  persist: false, waitUntilFinished: null, stretchTo: null, aim: null,
  at: {ref: "point", x: 500, y: 500}
};

const TOKEN = {document: {uuid: "Scene.s.Token.t"}, id: "t",
               x: 450, y: 450, center: {x: 500, y: 500}, w: 100, h: 100};

/** 直接喂一条合成计划，返回 {records, warns}。 */
async function playCues(cues, {region = null} = {}) {
  const fake = installFakeSequencer();
  const warns = [];
  const realWarn = console.warn;
  console.warn = (...a) => warns.push(a.map(String).join(" "));
  try {
    const {playPlan} = await import("../scripts/player/play.mjs");
    const plan = {v: PLAN_VERSION, seed: 1, source: "synthetic", region, warnings: [],
                  cues: cues.map(c => ({...CUE_STUB, ...c}))};
    await playPlan(plan, {volume: 0.5, shake: true, resolveRef: at => {
      if (!at) return null;
      if (at.ref === "point") return Number.isFinite(at.x) ? {x: at.x, y: at.y} : null;
      if (at.tokenId) return TOKEN;
      return Number.isFinite(at.x) ? {x: at.x, y: at.y} : null;
    }});
    return {records: fake.records, warns, seq: fake.sequences[0]};
  } finally { fake.restore(); console.warn = realWarn; }
}

test("合成 cue：非拉伸 + 瞄准点确实不同 ⇒ rotateTowards 与 anchor 成对出现", async () => {
  // V1 的兵库目前产不出这种 cue（飞行物全带 stretchTo，命中反馈的瞄准点就是锚点本身），
  // 上面那几条全量断言因此是空转的守门员、不是行使者——删掉 e.anchor() 它们仍会全绿。
  const {records} = await playCues([{aim: {towards: {x: 800, y: 500}, missed: false}}]);
  const r = records[0];
  assert.ok(r.has("rotateTowards"), "真需要转向的 cue 必须调 rotateTowards");
  assert.deepEqual(r.argOf("anchor"), [{x: 0.5, y: 0.5}],
    "调了 rotateTowards 就必须配 anchor，否则 _setAnchors 17026 把 pivot 挪到 -w/2");
  assert.ok(r.indexOf("anchor") === r.indexOf("rotateTowards") + 1,
    "anchor 应紧跟 rotateTowards，别被后来的编辑拆散");
});

test("合成 cue：真转向 + missed 会留痕，因为 Sequencer 在这个组合下不挪落点", async () => {
  const {records, warns} = await playCues([{aim: {towards: {x: 800, y: 500}, missed: true}}]);
  assert.ok(records[0].has("missed"), ".missed(true) 任何情形下都要调");
  assert.equal(warns.length, 1, "rotateTowards + missed 这个组合必须留一条 warn");
  assert.match(warns[0], /15360|data\.target/,
    "warn 要指出源码判据，不然读日志的人不知道为什么这条不算数");
});

test("合成 cue：带 stretchTo 时不转向、不 anchor，但 missed 照调", async () => {
  const {records, warns} = await playCues([{
    stretchTo: {x: 800, y: 500}, scale: {x: 1, y: 1},
    aim: {towards: {x: 800, y: 500}, missed: true}
  }]);
  const r = records[0];
  assert.equal(r.has("rotateTowards"), false, "拉伸自己会转向，再调就是那条 pivot 副作用");
  assert.equal(r.has("anchor"), false, "带 stretchTo 时调 anchor 会触发 24909-24916 的 ui 通知");
  assert.ok(r.has("missed"));
  assert.deepEqual(warns, []);
});

test("合成 cue：stretchTo + 非零 rotationOffset 会留痕（那个偏移无处可去）", async () => {
  const {warns} = await playCues([{
    stretchTo: {x: 800, y: 500}, scale: {x: 1, y: 1},
    aim: {towards: {x: 800, y: 500}, missed: false, rotationOffset: 30}
  }]);
  assert.equal(warns.length, 1);
  assert.match(warns[0], /rotationOffset/);
});

test("合成 cue：kind:\"sound\" 不依赖 target，且音量与全局音量相乘", async () => {
  // 语料里 0 条 sound cue（V1 唯一的 strike.ranged.draw 落在 cast 槽、fixture 打不到），
  // 这条分支只能靠合成计划行使。它必须在 resolveRef 之前分派：声音是全局的，不该被
  // 「目标 token 此刻还在不在画布上」拦下。
  const {records, seq} = await playCues([
    {kind: "sound", file: "s.ogg", volume: 0.8, startTime: 200, duration: 800,
     at: {ref: "target", tokenId: "gone-from-canvas"}},
    {kind: "sound", file: "t.ogg", at: {ref: "nowhere"}}
  ]);
  assert.equal(seq.sections.length, 2, "sound cue 被 target 守卫吞掉了");
  assert.equal(records[0].kind, "sound");
  assert.deepEqual(records[0].argOf("volume"), [0.4]);
  assert.deepEqual(records[0].argOf("timeRange"), [200, 1000]);
  assert.deepEqual(records[0].argOf("duration"), [800]);
  assert.equal(records[0].count("startTime"), 0);
  assert.equal(records[1].count("timeRange"), 0);
  assert.equal(records[1].count("duration"), 0);
});

test("合成 cue：kind:\"shake\" 用 cue 的 zIndex、带 locally、抖动走格单位", async () => {
  const {records} = await playCues([
    {kind: "shake", zIndex: 0, intensity: 0.08, duration: 400, delay: 40,
     at: {ref: "target", tokenId: "t"}}
  ]);
  const r = records[0];
  assert.deepEqual(r.argOf("copySprite"), [TOKEN]);
  assert.deepEqual(r.argOf("zIndex"), [0], "zIndex 必须读 cue，不能在播放层硬编码");
  assert.deepEqual(r.argOf("locally"), [true]);
  assert.deepEqual(r.argOf("duration"), [400]);
  assert.equal(r.count("timeRange"), 0, "shake 没有 media，走 timeRange 会把 clamp 上限变成 0");
  const [prop, path, opts] = r.argOf("loopProperty");
  assert.deepEqual([prop, path], ["sprite", "position.x"]);
  assert.equal(opts.gridUnits, true,
    "intensity 是格宽的分数，漏了 gridUnits 就是 0.08px 的抖动，屏幕上完全不可见");
});

test("合成 cue：shake 拿不到 placeable 时整条跳过，不留空壳 section", async () => {
  const {seq} = await playCues([{kind: "shake", at: {ref: "point", x: 1, y: 1}}]);
  assert.equal(seq.sections.length, 0, "裸点没有 sprite 可复制，也不该留下半条 section");
});

test("合成 cue：attachTo 拿不到 placeable 时整条跳过，不留空壳 section", async () => {
  const {seq} = await playCues([{attachTo: true, at: {ref: "point", x: 1, y: 1}}]);
  assert.equal(seq.sections.length, 0);
});

test("合成 cue：词表外的 playIf 大声拒播", async () => {
  const {records, warns} = await playCues([{playIf: "hitOrGlance"}]);
  assert.deepEqual(records[0].argOf("playIf"), [false],
    "词表外的取值必须落在不播放侧，而不是被白名单默认放行");
  assert.equal(warns.length, 1);
  assert.match(warns[0], /playIf/);
});

/* ---- 六、构造期异常必须把半成品 section 撤下来 --------------------------- */

test("cue 构造期抛错时，半成品 section 不留在序列里", async () => {
  // 在链条不同位置注入异常：真 Sequencer 的 mask()/tieToDocuments()/atLocation() 都会
  // 在这些位置 throw。半成品 section 照播的后果分别是：mask 抛错=光束不带遮罩溢出模板、
  // tieToDocuments 抛错=清不掉的持久光效、atLocation 之前抛错=整条序列挂死。
  const sample = actions.slice(0, 20);
  for (const faultOn of ["zIndex", "atLocation", "scaleToObject", "stretchTo"]) {
    const {records, sequences, cues} = await runAll({faultOn, snapshots: sample});
    assert.ok(cues > 50 && sequences.length > 0, "桩没被调用，测试空跑了");
    const halfBuilt = records.filter(r => r.last() === faultOn);
    assert.equal(halfBuilt.length, 0,
      `注入 .${faultOn}() 异常后仍有 ${halfBuilt.length} 条配置到一半的 section 留在 `
      + "seq.sections 里。seq.effect()/seq.sound() 在返回之前就 push"
      + "（sequencer.js:27890-27894 / 27901-27905），catch 里只打日志不撤销，那条 section 照播");
  }
});

/**
 * 出手端固化：`randomRotation` / `randomizeMirrorY` 的求值都发生在**播放端**——前者用
 * CanvasEffect 自己的 twister（种子是 `creationTimestamp`，逐机不同），后者是
 * `_initialize()` 里的裸 `Math.random() < 0.5`（sequencer.js:25044-25045）。两者都会让
 * 同一条 plan 在每台客户端上呈现不同朝向/镜像，与 DESIGN §5.4「全场画面一致」相悖，
 * 也会让 Task 16 第 20 项把一个正常差异当成 bug 追。
 *
 * resolve.mjs 的 freezeRandom() 在出手端把它们摇定成具体的 `angle` / `mirrorY`，
 * 于是播放层这两个方法一次都不该被调用。
 */
test("全量语料：两个随机项已在出手端固化，播放层一次都不摇", async () => {
  const {records, plans} = await runAll();
  const rot = records.filter(r => r.has("randomRotation"));
  const mir = records.filter(r => r.has("randomizeMirrorY"));
  assert.equal(rot.length, 0,
    `${rot.length} 条 section 调了 .randomRotation()——那是每客户端各摇一次的，`
    + "角度必须由 resolve.mjs 的 freezeRandom() 在出手端摇定后写进 cue.angle");
  assert.equal(mir.length, 0,
    `${mir.length} 条 section 调了 .randomizeMirrorY()——它连 twister 都不走，是裸 Math.random()`);

  // 正向：固化的角度真的**传给了** Sequencer。少了这一条，把 play.mjs 改回
  // `if (cue.randomRotation) e.randomRotation()` 照样全绿——freezeRandom 之后
  // randomRotation 恒为 false，那一行永远不执行，固化好的角度被静默丢掉。
  const rotated = records.filter(r => r.has("rotate"));
  assert.ok(rotated.length > 300,
    `只有 ${rotated.length} 条 section 调了 .rotate()——固化好的角度没有传给 Sequencer`);
  for (const r of rotated) {
    const a = r.argOf("rotate")[0];
    assert.ok(Number.isFinite(a) && a !== 0 && a >= -360 && a <= 360,
      `.rotate(${a}) 的实参不是一个有效的固化角度`);
  }

  // 反向：固化真的发生了（否则上面两条会因为「兵库根本没用过随机」而空转通过）。
  const cues = plans.flatMap(p => p.cues);
  const angled = cues.filter(c => c.angle);
  assert.ok(angled.length > 300,
    `只有 ${angled.length} 条 cue 带固化角度，freezeRandom 可能没跑（兵库里有 390+ 条随机旋转）`);
  assert.equal(cues.filter(c => c.randomRotation === true).length, 0);
  assert.equal(cues.filter(c => c.randomizeMirrorY === true).length, 0);

  // 固化后的角度必须落在 Sequencer 那条 `random_float_between(-360, 360, twister)`
  // 的等价区间里（sequencer.js:16336-16337，它是加在 data.angle 上的）。
  for (const c of angled) {
    assert.ok(Number.isFinite(c.angle) && c.angle >= -360 && c.angle <= 360,
      `规则 "${c.rule}" 的固化角度 ${c.angle} 超出 [-360, 360]`);
  }

  // 同一份快照重跑必须得到同一个角度：freezeRandom 走的是 seed 派生的 ctx.rngAux，
  // 不是 Math.random（manifest.test.mjs 的仓库级扫描只管 resolver/armory 的源码文本，
  // 管不住"确定性"本身）。
  const again = resolve(corpus()[0], {assets: mk(), armory: ARMORY});
  const first = resolve(corpus()[0], {assets: mk(), armory: ARMORY});
  assert.deepEqual(again.cues.map(c => c.angle), first.cues.map(c => c.angle));
});

/* ---- 六、素材两端留白的补偿（施工清单 §0.4 / §0.5） ---------------------- */

/**
 * ⚠ 这一节**必须**靠合成 cue 行使。
 *
 * 兵库今天一条 `template` 都不传（批次 B 第 5 步才给 travel.mjs 那 8 条 stretchTo 规则
 * 加上），全量语料驱动的断言在这里全是空转的守门员——删掉播放层整段补偿块它们照样全绿。
 * 这正是施工清单 §0.1 点名的「∀ 守卫的前提消失后静默通过」那类失效，所以每一条都用
 * playCues() 直接喂一条构造好的 cue。
 */

/** 从记录里取 `.template()` 的实参（没调过则 undefined）。 */
const tplArg = r => r.argOf("template")?.[0];

test("模板补偿：带 stretchTo 且模板有留白 ⇒ 恰调一次 template()，且不传 gridSize", async () => {
  // jb2a `ranged` 的实测模板：[200, 200, 200]，贴图宽 1600 ⇒ 首尾各 12.5%·d。
  const {records, warns} = await playCues([{
    stretchTo: {x: 900, y: 500}, scale: {x: 1, y: 1}, template: [200, 200, 200]
  }]);
  const r = records[0];
  assert.equal(r.count("template"), 1, "带留白的拉伸 cue 必须恰好下发一次模板");
  assert.deepEqual(tplArg(r), {startPoint: 200, endPoint: 200});
  assert.equal("gridSize" in tplArg(r), false,
    "不许传 gridSize：它会经 gridSizeDifference（sequencer.js:15113-15115）"
    + "改掉非拉伸分支的体积，gridSize=200 就是腰斩；缺了它才会 ?? 100 落回默认");
  assert.deepEqual(warns, []);
});

test("模板补偿：startPoint 为 0 必须补成 ≥1，否则 _setAnchors 算出 NaN 锚点、整条特效不可见",
  async () => {
  // 本仓 172 条 cue（generic.travel 168 + strike.shape.area 4）正是这个形态：
  // eskie ray = [200, 0, 100]、jb2a line200B = [200, 0, 300]。
  // EffectSection.template()（sequencer.js:24105-24107）三条赋值都是 `if (x)`，0 被丢掉；
  // 丢掉后 _setAnchors:17024 的 `template.startPoint / textureWidth` 没有 ?? 0 兜底
  // （同一字段在 16971 有），算出 undefined/W = NaN → sprite.anchor.set(NaN, .5) → 全屏不见。
  for (const tpl of [[200, 0, 100], [200, 0, 300], {gridSize: 200, startPoint: 0, endPoint: 300}]) {
    const {records} = await playCues([{
      stretchTo: {x: 900, y: 500}, scale: {x: 1, y: 1}, template: tpl
    }]);
    const a = tplArg(records[0]);
    assert.ok(a, `模板 ${JSON.stringify(tpl)} 应当下发`);
    assert.ok(Number.isFinite(a.startPoint) && a.startPoint > 0,
      `startPoint=${a.startPoint} 会被 template() 的 if(x) 丢掉，`
      + "换来一个 NaN 锚点和一条彻底看不见的特效");
  }
  // 代价上界：本仓最小 widthWithPadding 是 line200B 的 1000−1−300=699 ⇒ 0.143%·d，
  // 像素上读不出来。这个 1 不许涨成「随手取个大点的数」。
  const {records} = await playCues([{
    stretchTo: {x: 900, y: 500}, scale: {x: 1, y: 1}, template: [200, 0, 300]
  }]);
  assert.equal(tplArg(records[0]).startPoint, 1, "补偿值应恰为 1px，别自己加码");
});

test("模板补偿：两端留白全为 0 的模板整条跳过（cone 本来没留白要补）", async () => {
  // jb2a cone = [100, 0, 0]、gust_of_wind 同型。给它们调 template() 只有风险没有收益：
  // 三项都空还会撞上 sequencer.js:24098 那条「You need to define at least one parameter」的 throw。
  const {records, warns} = await playCues([{
    stretchTo: {x: 900, y: 500}, scale: {x: 1, y: 1}, template: [100, 0, 0]
  }]);
  assert.equal(records[0].has("template"), false, "没有留白就不该调 template()");
  assert.deepEqual(warns, []);
});

test("模板补偿：既不拉伸、也不走模板锚点的 cue 一次都不许调 template()", async () => {
  // 判据：模板只在 _getDistanceScaling（仅 stretchTo 分支）与 _setAnchors 的
  // rotateTowards.template 分支被读。落到别处它唯一还能碰到的是 gridSizeDifference，
  // 那条路会改体积。这条断言在现有语料上恒空转，必须用合成 cue 行使。
  const {records} = await playCues([{template: [200, 200, 200]}]);
  assert.equal(records[0].has("template"), false,
    "不消费模板的 cue 收到 template() 只会经 gridSizeDifference 改掉体积");

  // 退化 aim（瞄准点=锚点）同样不走模板锚点分支 ⇒ 也不许调。
  const {records: r2} = await playCues([{
    template: [200, 200, 200], aim: {towards: {x: 500, y: 500}, missed: false}
  }]);
  assert.equal(r2[0].has("template"), false, "退化的 aim 不会 rotateTowards，模板无处可用");
});

test("模板锚点：带 template 的真转向走 {template:true} 且**不**调 anchor()", async () => {
  // 施工清单 §0.3：锚点的含义从「贴图中心」变成素材标定的握把点
  // （_setAnchors:17023-17025 把 anchor.x 设成 startPoint/贴图宽）。
  const {records, warns} = await playCues([{
    template: [200, 300, 300], aim: {towards: {x: 800, y: 500}, missed: false}
  }]);
  const r = records[0];
  assert.equal(r.argOf("rotateTowards")?.[1]?.template, true,
    "带 template 的转向必须把 template:true 递给 rotateTowards，否则 17022 的第一个 if 不进");
  assert.equal(r.has("anchor"), false,
    "模板锚点分支下调 anchor 会让 pivot 按写死的 0.5 再偏一次，握把点被推回中心");
  assert.equal(r.count("template"), 1, "模板锚点分支也必须真的把模板下发下去");
  assert.deepEqual(tplArg(r), {startPoint: 300, endPoint: 300});
  assert.deepEqual(warns, []);

  // 反向：没有 template 的转向必须保持历史行为（不带 template + 显式 anchor 居中）。
  const {records: r2} = await playCues([{aim: {towards: {x: 800, y: 500}, missed: false}}]);
  assert.notEqual(r2[0].argOf("rotateTowards")?.[1]?.template, true);
  assert.deepEqual(r2[0].argOf("anchor"), [{x: 0.5, y: 0.5}]);
});

test("模板补偿：坏模板不下发，且留一条 warn（Sequencer 的 is_real_number 会当场 throw）", async () => {
  const {records, warns} = await playCues([{
    stretchTo: {x: 900, y: 500}, scale: {x: 1, y: 1}, template: [200, "两百", 200]
  }]);
  assert.equal(records[0].has("template"), false);
  assert.equal(warns.length, 1);
  assert.match(warns[0], /template/);
});

test("全量语料：凡是下发出去的 template，startPoint 必须有限且 > 0", () => {
  // 兵库今天一条 template 都不传，所以这条现在只保证「不会有人在语料里悄悄塞进坏模板」；
  // 批次 B 第 5 步给 travel.mjs 加上 template 之后，它才开始真正行使。
  for (const r of R.records) {
    for (const c of r.calls.filter(x => x.m === "template")) {
      const a = c.args[0];
      assert.ok(Number.isFinite(a.startPoint) && a.startPoint > 0,
        `下发了 startPoint=${a.startPoint} 的模板：0 会被 template() 的 if(x) 丢掉，`
        + "换来 NaN 锚点和一条不可见的特效");
      assert.equal("gridSize" in a, false, "不许下发 gridSize");
    }
  }
});

/* ---- 七、区域尺寸：sizePx 与「裸点禁 objectScale」（施工清单 §0.12） ------- */

test("裸点锚的 cue 一律不得下发 scaleToObject", async () => {
  // _applyScaleToObject(17171) → getSourceData(15245) → get_object_dimensions(18122)
  // 对裸 {x,y} 一路 ?? 落到最后一档 canvas.grid.size ⇒ 恒等于「一格」。
  const {records} = await playCues([{at: {ref: "point", x: 500, y: 500}, objectScale: 1}]);
  assert.equal(records[0].has("scaleToObject"), false,
    "裸点上的 scaleToObject 恒等于一格，表达不了任何尺寸");

  // 反向：锚在真 placeable 上时这条路照旧。
  const {records: r2} = await playCues([{at: {tokenId: "t"}, objectScale: 1.2}]);
  assert.deepEqual(r2[0].argOf("scaleToObject"), [1.2]);

  // 全量语料同样不许有例外。
  for (let i = 0; i < ALL_CUES.length; i++) {
    if (ALL_CUES[i].at?.ref !== "point") continue;
    assert.equal(R.records[i].has("scaleToObject"), false,
      `规则 "${ALL_CUES[i].rule}" 在裸点上下发了 scaleToObject`);
  }
});

test("sizePx 映射成 e.size()，并压过 scaleToObject", async () => {
  const {records} = await playCues([{
    at: {tokenId: "t"}, sizePx: {width: 240, height: 240}, objectScale: 1.3
  }]);
  const r = records[0];
  assert.deepEqual(r.argOf("size"), [{width: 240, height: 240}]);
  assert.equal(r.has("scaleToObject"), false,
    "_transformNoStretchSprite 是 `if (scaleToObject) … else if (size) …`，"
    + "两者同时下发时 size 是死代码");
});

/* ---- 八、圆底锥的遮罩（施工清单 §0.13 的硬前置） ------------------------- */

test("mask：flat 与 round 两种锥底是两个形状，round 不许走扁三角那条式子", async () => {
  const flat = {type: "cone", x: 500, y: 500, radius: 300, angle: 60, rotation: 0,
                curvature: "flat"};
  const round = {type: "cone", x: 500, y: 500, radius: 300, angle: 210, rotation: 0,
                 curvature: "round"};

  const {records: rf} = await playCues([{mask: "region"}], {region: flat});
  const pf = rf[0].argOf("mask")[0].points;
  assert.equal(pf.length, 6, "flat 锥是三点扁三角（锥尖 + 两个远端顶点）");
  assert.ok(Math.abs(Math.hypot(pf[2] - 500, pf[3] - 500) - 300 / Math.cos(30 * Math.PI / 180)) < 0.5,
    "flat 的边长必须是 radius/cos(halfAngle)，与 travel.mjs 的 templateEnd 同式");

  const {records: rr} = await playCues([{mask: "region"}], {region: round});
  const pr = rr[0].argOf("mask")[0].points;
  assert.deepEqual([pr[0], pr[1]], [500, 500],
    "core 的 getCone 第一个点就是锥尖（common/grid/base.mjs:608）");
  assert.ok(pr.length > 20, `圆底锥要用圆弧离散，只有 ${pr.length / 2} 个点`);
  // 每一个弧上的点都恰好落在半径上——扁三角那条式子会把它们甩到 114 倍半径之外。
  for (let i = 2; i < pr.length; i += 2) {
    const d = Math.hypot(pr[i] - 500, pr[i + 1] - 500);
    assert.ok(Math.abs(d - 300) < 0.01,
      `圆弧上的点离锥尖 ${d.toFixed(1)}px，应恒为 radius=300`);
  }
  // 张角覆盖到位：首尾两点的夹角就是 210°。
  const a0 = Math.atan2(pr[3] - 500, pr[2] - 500);
  const a1 = Math.atan2(pr[pr.length - 1] - 500, pr[pr.length - 2] - 500);
  const span = ((a1 - a0) * 180 / Math.PI + 720) % 360;
  assert.ok(Math.abs(span - 210) < 0.5, `圆底锥张角 ${span.toFixed(1)}°，应为 210°`);
});

test("mask：缺 curvature 字段时按 core 的默认换算回退（≤90° flat，>90° round）", async () => {
  // 判据：action-use-dialog.mjs:528 写死 `curvature: angle <= 90 ? "flat" : "round"`。
  const {records: a} = await playCues([{mask: "region"}],
    {region: {type: "cone", x: 500, y: 500, radius: 300, angle: 60, rotation: 0}});
  assert.equal(a[0].argOf("mask")[0].points.length, 6, "60° 无 curvature 应按 flat");

  const {records: b} = await playCues([{mask: "region"}],
    {region: {type: "cone", x: 500, y: 500, radius: 300, angle: 210, rotation: 0}});
  assert.ok(b[0].argOf("mask")[0].points.length > 20, "210° 无 curvature 应按 round");
});
