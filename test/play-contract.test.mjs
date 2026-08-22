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

/* ---- 〇、语料自查：断言不能是空转 ---------------------------------------- */

test("桩确实跑通了：全量语料构造出成千条 section，且覆盖到各条支路", () => {
  assert.ok(R.planCount > 3000, `只解析出 ${R.planCount} 条计划，语料缩水了`);
  assert.ok(R.cues > 12000, `只有 ${R.cues} 条 cue，语料或 resolver 出问题了，本文件会变成空跑`);
  assert.equal(R.records.length, R.cues,
    "section 数与 cue 数对不上：有 cue 被静默吞掉，或者一条 cue 建了多个 section");
  const n = m => R.records.filter(r => r.has(m)).length;
  assert.ok(n("stretchTo") > 1500, `带 stretchTo 的 section 只有 ${n("stretchTo")} 条，相关断言会空转`);
  assert.ok(n("missed") > 1000, `带 missed 的 section 只有 ${n("missed")} 条，相关断言会空转`);
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
  for (const r of R.records) {
    if (!r.has("rotateTowards")) continue;
    const a = r.argOf("anchor");
    assert.ok(a, "调了 rotateTowards 却没有 anchor：_setAnchors 17026 的判据是 "
      + "`rotateTowards && !rotateTowards.template && !data.anchor`，缺 anchor 就走 -w/2 分支");
    assert.deepEqual(a[0], {x: 0.5, y: 0.5},
      "anchor 必须是 {x:0.5,y:0.5}：17029-17041 的 interpolate(-w/2, w/2, 0.5) = 0，"
      + "pivot 才回到中心。注意 anchor.x 给 0 会落回同一个 -w/2");
  }
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
  assert.ok(expected > 1000, `语料里只有 ${expected} 条 missed cue，这条断言测不出东西`);
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
      assert.equal(shape.__shape, "polygon", "line/cone 模板的遮罩是多边形");
    } else {
      assert.equal(r.count("mask"), 0, `${c.rule}: 没声明 mask 却下发了遮罩`);
    }
  }
  assert.ok(tinted > 0 && masked > 100, `tint ${tinted} 条、mask ${masked} 条，覆盖不足`);
});

test("mask 形状的锥尖/线首落在 plan.region 上", () => {
  for (const p of R.plans) {
    if (!p.cues.some(c => c.mask === "region")) continue;
    assert.ok(p.region, "声明了 mask:region 的计划必须带 region");
  }
  const i = ALL_CUES.findIndex(c => c.mask === "region");
  const shape = R.records[i].argOf("mask")[0];
  const plan = R.plans.find(p => p.cues.includes(ALL_CUES[i]));
  assert.deepEqual([shape.points[0], shape.points[1]], [plan.region.x, plan.region.y],
    "遮罩多边形的第一个顶点必须是模板起点");
});

test("play.mjs 只调用 Sequencer 上真实存在的方法", () => {
  const allowed = new Set([...EFFECT_METHODS, ...SOUND_METHODS]);
  const used = new Set();
  for (const r of R.records) for (const c of r.calls) used.add(c.m);
  for (const m of used) assert.ok(allowed.has(m), `用到了白名单外的方法 .${m}()`);
  assert.ok(used.size > 20, `只用到 ${used.size} 个方法，桩没跑通`);
});

test("全量语料跑完 playPlan 一条 warn 都不出", () => {
  assert.deepEqual(R.warns.slice(0, 5), [], `${R.warns.length} 条播放层告警`);
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
