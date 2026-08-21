import {PLAN_VERSION, SLOTS} from "../const.mjs";
import {createContext} from "./context.mjs";

/** 每个 cue 的默认值，兵库规则只需写它关心的字段。 */
const CUE_DEFAULTS = {
  kind: "effect", playIf: "always",
  attachTo: false, bindScale: false, local: true,
  aim: null, stretchTo: null, offset: {x: 0, y: 0}, gridUnits: false,
  objectScale: 1, scale: null, mirrorY: false, randomizeMirrorY: false, randomRotation: false,
  filter: null, tint: null, opacity: 1,
  fadeIn: 200, fadeOut: 300, fadeInEase: "easeOutQuad", fadeOutEase: "easeInQuad",
  belowTokens: false, zIndex: 50, elevation: null, mask: null,
  delay: 0, duration: null, playbackRate: 1, startTime: 0, waitUntilFinished: null,
  persist: false, tieTo: null, extraEndDuration: 0, volume: 1,
  /**
   * 素材自带的命中闪爆，见 armory/flash.mjs 与 ASSET-NOTES 的「自带闪爆」列。
   * null = 这条素材不自带闪爆（表里标「否」）。非 null 时后续槽必须在同一个锚点上让位，
   * 否则同一处会闪两下。
   */
  selfFlash: null
};

/**
 * 槽内按 pri 降序取第一个 when 为真的规则。
 * when() 抛异常时视作不适用、降到下一条——但要经 ctx.warn 留痕（带规则 id、槽位名、
 * 错误信息），否则编程错误与「规则本来就不适用」在表现上完全无法区分。
 */
function firstMatch(rules, s, ctx, slot) {
  const sorted = [...rules].sort((a, b) => b.pri - a.pri);
  for (const r of sorted) {
    let ok = false;
    try {
      ok = r.when(s, ctx);
    } catch (err) {
      ctx.warn(`[${slot}] 规则 "${r.id}" 的 when() 抛出异常：${err?.message ?? err}`);
      ok = false;
    }
    if (ok) return r;
  }
  return null;
}

/** 规则可以返回单个 cue、cue 数组或 null；统一成数组并补默认值。 */
function normalize(out, slot, ruleId, at) {
  if (!out) return [];
  const arr = Array.isArray(out) ? out : [out];
  return arr.filter(Boolean).map(c => ({...CUE_DEFAULTS, ...c, slot, rule: ruleId, at: c.at ?? at}));
}

/**
 * 调用规则的 build() 并归一化产出。build() 抛异常时只丢掉这一次产出并留痕——
 * 从前 build 没有 try/catch，一个残缺目标（或 once 规则误收到 null 代表目标）
 * 抛出的 TypeError 会顺着调用栈把整个 resolve() 带崩，该动作五个槽的 cue 全没了。
 * 正常代码路径上一条 warning 都不该有，test/coverage.test.mjs 用全量 fixture 守着。
 */
function runBuild(rule, snapshot, ctx, target, built, slot, at) {
  let out = null;
  try {
    out = rule.build(snapshot, ctx, target, built);
  } catch (err) {
    ctx.warn(`[${slot}] 规则 "${rule.id}" 的 build() 抛出异常：${err?.message ?? err}`);
    return [];
  }
  return normalize(out, slot, rule.id, at);
}

/**
 * 五槽装配。
 * @param {ActionSnapshot} snapshot
 * @param {{assets: object, armory: object}} deps
 * @returns {FXPlan|null}
 */
export function resolve(snapshot, {assets, armory}) {
  const ctx = createContext({assets, snapshot, seed: snapshot.seed});
  const cues = [];
  const targets = snapshot.targets ?? [];

  /**
   * 已经装配好的前序槽 cue，供后面的槽查询「我要叠的这一层，前面是不是已经有人画过了」
   * （见 armory/flash.mjs 的自带闪爆交接）。分两份：
   *  · shared —— once 规则的产出，不属于任何单个目标，对每个目标都可见；
   *  · perTarget[i] —— 每目标规则给第 i 个目标的产出，只对该目标可见。
   */
  const shared = {travel: [], impact: [], aftermath: []};
  const perTarget = targets.map(() => ({travel: [], impact: [], aftermath: []}));
  const viewFor = i => ({
    travel: [...shared.travel, ...(perTarget[i]?.travel ?? [])],
    impact: [...shared.impact, ...(perTarget[i]?.impact ?? [])],
    aftermath: [...shared.aftermath, ...(perTarget[i]?.aftermath ?? [])]
  });

  // S1 cast：整个动作一次，锚在施法者
  const castRule = firstMatch(armory.cast, snapshot, ctx, "cast");
  if (castRule) {
    cues.push(...runBuild(castRule, snapshot, ctx, null, viewFor(0), "cast", {ref: "origin"}));
  }

  // S2–S4：选规则只看 snapshot，与具体目标无关，所以每槽只选一次——从前 firstMatch 写在
  // 目标循环里，when() 抛异常的告警会按目标数重复 N 遍。选中的规则自己声明出内容的粒度：
  //
  //  · 默认（rule.once 未置位）：每个目标各调一次 build，锚在该目标。投射物、近战挥击、
  //    投掷都属这类——两个目标就是两支箭、两记刀光。
  //  · rule.once === true：整个动作只调一次 build，默认锚在施法者（{ref:"origin"}）。
  //    区域与自身特效属这类——锥形、射线、脉冲、自身爆发一次动作只该有一份，
  //    锥形打中 5 个人不该叠 5 份各带 stretchTo 与模板遮罩的锥形。规则仍可自带 at
  //    覆盖这个默认锚点（normalize 的 `at: c.at ?? at`），模板类特效就靠这一条把锚点
  //    摆回模板起点。build 仍收到 targets[0] ?? null 作「代表目标」，只供取朝向之类的
  //    参考；**once 规则不得把它当必然存在**——零目标时它就是 null，而 once 规则在零目标
  //    动作上照样出内容：区域法术没罩住任何人、自身增益本来就没有目标，画面都仍然该有。
  for (const slot of ["travel", "impact", "aftermath"]) {
    const rule = firstMatch(armory[slot], snapshot, ctx, slot);
    if (!rule) continue;
    if (rule.once === true) {
      const out = runBuild(rule, snapshot, ctx, targets[0] ?? null, viewFor(0), slot, {ref: "origin"});
      shared[slot].push(...out);
      cues.push(...out);
      continue;
    }
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const at = {ref: "target", tokenId: target.tokenId, uuid: target.uuid,
                  x: target.x, y: target.y};
      const out = runBuild(rule, snapshot, ctx, target, viewFor(i), slot, at);
      perTarget[i][slot].push(...out);
      cues.push(...out);
    }
  }

  if (!cues.length) return null;
  return {
    v: PLAN_VERSION, seed: snapshot.seed, source: snapshot.id, region: snapshot.region ?? null,
    cues, warnings: ctx.warnings
  };
}

/**
 * persist 槽：由 ActiveEffect 增删驱动，不经过动作。
 * @param {EffectSnapshot} effectSnapshot
 * @param {{assets: object, armory: object}} deps
 * @returns {FXPlan|null}
 */
export function resolveEffect(effectSnapshot, {assets, armory}) {
  const ctx = createContext({assets, snapshot: effectSnapshot, seed: effectSnapshot.seed});
  const rule = firstMatch(armory.persist, effectSnapshot, ctx, "persist");
  if (!rule) return null;
  const at = {ref: "target", tokenId: effectSnapshot.target.tokenId,
              uuid: effectSnapshot.target.uuid,
              x: effectSnapshot.target.x, y: effectSnapshot.target.y};
  const cues = normalize(rule.build(effectSnapshot, ctx), "persist", rule.id, at);
  if (!cues.length) return null;
  return {
    v: PLAN_VERSION, seed: effectSnapshot.seed, source: effectSnapshot.statusId,
    cues, warnings: ctx.warnings
  };
}

export {SLOTS};
