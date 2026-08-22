import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {createContext} from "../scripts/resolver/context.mjs";
import {resolve, resolveEffect} from "../scripts/resolver/resolve.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const actions = JSON.parse(readFileSync(join(ROOT, "test/fixtures/actions.json"), "utf8"));
const mkAssets = () => createAssets(offlineBackend(index));
const strike = actions.find(a => a.tags.includes("strike") && a.targets.length);

test("rng 由 seed 决定，同 seed 同序列", () => {
  const a = createContext({assets: mkAssets(), snapshot: {seed: 42}, seed: 42});
  const b = createContext({assets: mkAssets(), snapshot: {seed: 42}, seed: 42});
  const sa = [a.rng(), a.rng(), a.rng()];
  const sb = [b.rng(), b.rng(), b.rng()];
  assert.deepEqual(sa, sb);
  assert.ok(sa.every(v => v >= 0 && v < 1));
  const c = createContext({assets: mkAssets(), snapshot: {seed: 43}, seed: 43});
  assert.notDeepEqual(sa, [c.rng(), c.rng(), c.rng()]);
});

test("geom.sizeScale 对大体型 token 放大 1.4 倍", () => {
  const small = createContext({assets: mkAssets(), snapshot: {seed: 1, origin: {width: 1}}, seed: 1});
  const big = createContext({assets: mkAssets(), snapshot: {seed: 1, origin: {width: 3}}, seed: 1});
  assert.equal(small.geom.sizeScale(), 1);
  assert.equal(big.geom.sizeScale(), 1.4);
});

test("geom.offsetFor 贴身不折半、隔格折半", () => {
  const ctx = createContext({assets: mkAssets(), snapshot: {seed: 1, origin: {width: 3}}, seed: 1});
  assert.equal(ctx.geom.offsetFor({adjacent: true}, 0.5), 3 * 0.5);
  assert.equal(ctx.geom.offsetFor({adjacent: false}, 0.5), (3 * 0.5) / 2);
});

test("解析产出带版本号与 cues 的计划", () => {
  const plan = resolve(strike, {assets: mkAssets(), armory: ARMORY});
  assert.ok(plan, "应产出计划");
  assert.equal(plan.v, 1);
  assert.ok(Array.isArray(plan.cues) && plan.cues.length > 0);
  for (const c of plan.cues) {
    assert.ok(["cast", "travel", "impact", "aftermath", "persist"].includes(c.slot));
    assert.ok(["effect", "sound", "shake"].includes(c.kind));
  }
});

test("解析确定：同快照两次结果完全相同", () => {
  const a = resolve(strike, {assets: mkAssets(), armory: ARMORY});
  const b = resolve(strike, {assets: mkAssets(), armory: ARMORY});
  assert.deepEqual(a, b);
});

test("高优先级规则截胡低优先级", () => {
  const probe = {
    ...strike,
    id: "__probe__",
    tags: ["__probe_tag__"]
  };
  const armory = {
    ...ARMORY,
    cast: [
      {id: "低", pri: 10, when: () => true, build: () => ({kind: "effect", file: "低"})},
      {id: "高", pri: 900, when: s => s.tags.includes("__probe_tag__"),
       build: () => ({kind: "effect", file: "高"})}
    ]
  };
  const plan = resolve(probe, {assets: mkAssets(), armory});
  const cast = plan.cues.find(c => c.slot === "cast");
  assert.equal(cast.rule, "高");
  assert.equal(cast.file, "高");
});

test("build 返回 null 时该槽静默跳过，不产生空 cue", () => {
  const armory = {...ARMORY, cast: [{id: "空", pri: 900, when: () => true, build: () => null}]};
  const plan = resolve(strike, {assets: mkAssets(), armory});
  assert.equal(plan.cues.some(c => c.slot === "cast"), false);
});

test("每个 cue 的数值字段无 NaN / undefined / 负时长", () => {
  // CUE_DEFAULTS 里所有数值字段。waitUntilFinished 允许为负（与下一段重叠是有意的时序手法），
  // elevation 默认 null、允许为数字但不作正负约束；zIndex 额外要求非负整数。
  const NUMERIC_FIELDS = [
    "delay", "duration", "fadeIn", "fadeOut", "opacity", "objectScale",
    "zIndex", "playbackRate", "startTime", "waitUntilFinished",
    "extraEndDuration", "volume", "elevation"
  ];
  const NO_SIGN_CHECK = new Set(["waitUntilFinished", "elevation"]);
  for (const s of actions.slice(0, 120)) {
    const plan = resolve(s, {assets: mkAssets(), armory: ARMORY});
    if (!plan) continue;
    for (const c of plan.cues) {
      for (const k of NUMERIC_FIELDS) {
        const v = c[k];
        if (v === undefined || v === null) continue;
        assert.ok(Number.isFinite(v), `${s.id}.${c.rule}.${k} = ${v}`);
        if (k === "zIndex") {
          assert.ok(Number.isInteger(v) && v >= 0, `${s.id}.${c.rule}.zIndex 应为非负整数，实际 ${v}`);
        } else if (!NO_SIGN_CHECK.has(k)) {
          assert.ok(v >= 0, `${s.id}.${c.rule}.${k} 为负`);
        }
      }
    }
  }
});

test("firstMatch 捕获 when() 抛出的异常并记录带规则 id 的警告，不静默吞掉", () => {
  const armory = {
    ...ARMORY,
    cast: [
      {id: "低.兜底", pri: 10, when: () => true, build: () => ({kind: "effect", file: "兜底"})},
      {
        id: "高.抛错", pri: 900,
        when: () => { throw new Error("模拟规则内部编程错误，如访问 s.spell.rune 而 s.spell 为 null"); },
        build: () => ({kind: "effect", file: "高"})
      }
    ]
  };
  const plan = resolve(strike, {assets: mkAssets(), armory});
  const cast = plan.cues.find(c => c.slot === "cast");
  assert.equal(cast.rule, "低.兜底", "抛异常的规则应被当作不适用，降级到下一条");
  assert.ok(Array.isArray(plan.warnings), "解析结果应带 warnings 数组");
  assert.ok(plan.warnings.length >= 1, "应至少记录一条警告");
  assert.ok(
    plan.warnings.some(w => String(w).includes("高.抛错")),
    `警告内容应包含出错规则的 id "高.抛错"，实际：${JSON.stringify(plan.warnings)}`
  );
  assert.ok(
    plan.warnings.some(w => String(w).includes("cast")),
    `警告内容应包含槽位名 "cast"，实际：${JSON.stringify(plan.warnings)}`
  );
});

/* ---- rule.once：解析器级别的机制测试，不依赖兵库里具体有哪几条区域规则 ---- */

/** 造一条只有单条规则的 travel 槽，用来观察 resolve 怎么调它的 build。 */
const probeArmory = (rule, calls) => ({
  ...ARMORY,
  travel: [{
    pri: 900, when: () => true,
    build: (s, ctx, target) => { calls.push(target); return {kind: "effect", file: "探针"}; },
    ...rule
  }]
});

test("rule.once 让 build 每动作只调一次，并默认锚在施法者", () => {
  assert.ok(strike.targets.length > 1, "探针动作必须多目标，否则测不出每目标与每动作的差别");
  const calls = [];
  const plan = resolve(strike, {assets: mkAssets(), armory: probeArmory({id: "一次", once: true}, calls)});
  const cues = plan.cues.filter(c => c.slot === "travel");
  assert.equal(calls.length, 1, `once 规则的 build 每动作只该调 1 次，实际 ${calls.length} 次`);
  assert.equal(cues.length, 1);
  assert.equal(calls[0], strike.targets[0], "once 规则应收到 targets[0] 作代表目标");
  assert.deepEqual(cues[0].at,
    {ref: "origin", tokenId: strike.origin.tokenId, uuid: strike.origin.uuid ?? null,
     x: strike.origin.x, y: strike.origin.y},
    "once 规则默认锚在施法者，且锚点必须自带身份与坐标——裸 {ref:\"origin\"} 在播放层解不出"
    + "任何位置，整槽 cue 会被 play.mjs 的 `if (!target) continue` 静默吞掉");
  assert.equal(cues[0].forTarget, null, "once 规则的 cue 不属于任何单个目标");
});

test("rule.once 在零目标动作上仍出内容，代表目标为 null", () => {
  const calls = [];
  const plan = resolve({...strike, targets: []},
                       {assets: mkAssets(), armory: probeArmory({id: "一次", once: true}, calls)});
  assert.equal(plan.cues.filter(c => c.slot === "travel").length, 1,
    "区域/自身特效在没有目标时也该出内容");
  assert.deepEqual(calls, [null], "零目标时代表目标是 null，once 规则不得当它必然存在");
});

test("不带 once 的规则仍是每目标一次并锚在各自目标", () => {
  const calls = [];
  const plan = resolve(strike, {assets: mkAssets(), armory: probeArmory({id: "每目标"}, calls)});
  const cues = plan.cues.filter(c => c.slot === "travel");
  assert.equal(calls.length, strike.targets.length);
  assert.equal(cues.length, strike.targets.length);
  assert.deepEqual(cues.map(c => c.at.tokenId), strike.targets.map(t => t.tokenId));
  // forTarget 是「这条 cue 讲的是谁」，与「画在哪」解耦：锚点将来搬家（飞行物锚回
  // 施法者就是一例）时，按 at.tokenId 反推目标归属会静默失效。
  assert.deepEqual(cues.map(c => c.forTarget), strike.targets.map(t => t.tokenId));
});

test("once 规则自带的 at 覆盖默认的施法者锚点", () => {
  const armory = {...ARMORY, travel: [{
    id: "自带at", pri: 900, once: true, when: () => true,
    build: () => ({kind: "effect", file: "x", at: {ref: "region"}})
  }]};
  const plan = resolve(strike, {assets: mkAssets(), armory});
  assert.deepEqual(plan.cues.find(c => c.slot === "travel").at, {ref: "region"});
});

test("每槽只选一次规则：when() 异常的告警不按目标数重复", () => {
  assert.ok(strike.targets.length > 1);
  const armory = {...ARMORY, travel: [
    {id: "低.兜底", pri: 10, when: () => true, build: () => null},
    {id: "高.抛错", pri: 900, when: () => { throw new Error("模拟规则内部编程错误"); }, build: () => null}
  ]};
  const plan = resolve(strike, {assets: mkAssets(), armory});
  const hits = plan.warnings.filter(w => String(w).includes("高.抛错"));
  assert.equal(hits.length, 1,
    `firstMatch 每槽只该跑一次、只告警一次，实际 ${hits.length} 次（按目标数重复）`);
});

test("build() 抛异常时降级成一条 warning，不带崩整个 resolve", () => {
  // once 把 build 的输入域扩大了：零目标动作从此也会调 build、代表目标可能是 null，
  // 这正是最容易踩空的新路径。没有这层 try/catch 时，一个 TypeError 会顺着调用栈把
  // 整个 resolve() 带崩，该动作五个槽的 cue 全部消失。
  const armory = {...ARMORY, travel: [{
    id: "会抛的", pri: 900, when: () => true,
    build: () => { throw new TypeError("Cannot read properties of null (reading 'x')"); }
  }]};
  const plan = resolve(strike, {assets: mkAssets(), armory});
  assert.ok(plan, "整个 resolve 不该被一条规则带崩");
  assert.equal(plan.cues.some(c => c.slot === "travel"), false, "抛异常的那次产出应被丢掉");
  assert.ok(plan.cues.some(c => c.slot === "impact"), "其余槽必须照常装配");
  assert.ok(plan.warnings.some(w => String(w).includes("会抛的") && String(w).includes("travel")),
    `降级必须留痕并点名规则与槽位：${JSON.stringify(plan.warnings)}`);
});

/* ---- resolveEffect：persist 槽的入口加固 ---- */

const effects = JSON.parse(readFileSync(join(ROOT, "test/fixtures/effects.json"), "utf8"));
const burning = effects.find(e => e.statusId === "burning");

test("resolveEffect 对残缺目标返回 null 而不外抛", () => {
  // ActiveEffect 挂在当前场景没有 token 的 actor 上（离场角色、跨场景、未链接 token
  // 尚未渲染）是完全正常的情形。resolveEffect 挂在 createActiveEffect 钩子上，一个
  // TypeError 会连带打断整条状态上身处理，而不只是少一枚标记。
  for (const bad of [null, undefined]) {
    for (const snap of [bad, {...burning, target: bad}]) {
      let plan;
      assert.doesNotThrow(() => { plan = resolveEffect(snap, {assets: mkAssets(), armory: ARMORY}); },
        `残缺输入 ${JSON.stringify(snap)} 不该抛出`);
      assert.equal(plan, null);
    }
  }
});

test("persist 且 tieTo 为空的 cue 一律丢弃并留痕", () => {
  const armory = {...ARMORY, persist: [{
    id: "探针.持久", pri: 950, when: () => true,
    build: () => [
      {file: "无绑定", persist: true, tieTo: null},
      {file: "有绑定", persist: true, tieTo: "Scene.s.Token.t1.ActiveEffect.x"},
      {file: "非持久", persist: false}
    ]
  }]};
  const plan = resolveEffect({...burning, effectUuid: null}, {assets: mkAssets(), armory});
  assert.deepEqual(plan.cues.map(c => c.file), ["有绑定", "非持久"],
    "只有 persist 而无 tieTo 的那条该被丢掉，其余不受影响");
  assert.ok(plan.warnings.some(w => String(w).includes("探针.持久") && String(w).includes("tieTo")),
    `丢弃必须留痕并点名规则：${JSON.stringify(plan.warnings)}`);
});

test("persist 规则 build() 抛异常时降级成 warning，不带崩 resolveEffect", () => {
  const armory = {...ARMORY, persist: [{
    id: "会抛的.持久", pri: 950, when: () => true,
    build: () => { throw new TypeError("Cannot read properties of null (reading 'x')"); }
  }]};
  let plan;
  assert.doesNotThrow(() => { plan = resolveEffect(burning, {assets: mkAssets(), armory}); });
  assert.equal(plan, null, "没有可播的 cue 时返回 null");
});

test("persist 规则拿到的前序槽视图是冻结的空视图，不是 undefined", () => {
  // persist 不属于任何动作的时间轴，没有前序槽可查。给空数组而不是 null，是为了让将来
  // 某条规则误写 built.impact 时拿到 []，而不是一个 TypeError。
  let seen = null;
  const armory = {...ARMORY, persist: [{
    id: "探针.视图", pri: 950, when: () => true,
    build: (e, ctx, target, built) => {
      seen = {target, built};
      return {file: "x", persist: true, tieTo: e.effectUuid};
    }
  }]};
  resolveEffect(burning, {assets: mkAssets(), armory});
  assert.equal(seen.target, null, "persist 规则的第三个入参与 cast 槽一致，恒为 null");
  assert.deepEqual(seen.built, {travel: [], impact: [], aftermath: []});
});
