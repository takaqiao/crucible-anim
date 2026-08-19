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
  persist: false, tieTo: null, extraEndDuration: 0, volume: 1
};

/** 槽内按 pri 降序取第一个 when 为真的规则。 */
function firstMatch(rules, s, ctx) {
  const sorted = [...rules].sort((a, b) => b.pri - a.pri);
  for (const r of sorted) {
    let ok = false;
    try { ok = r.when(s, ctx); } catch { ok = false; }
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
 * 五槽装配。
 * @param {ActionSnapshot} snapshot
 * @param {{assets: object, armory: object}} deps
 * @returns {FXPlan|null}
 */
export function resolve(snapshot, {assets, armory}) {
  const ctx = createContext({assets, snapshot, seed: snapshot.seed});
  const cues = [];

  // S1 cast：整个动作一次，锚在施法者
  const castRule = firstMatch(armory.cast, snapshot, ctx);
  if (castRule) {
    cues.push(...normalize(castRule.build(snapshot, ctx), "cast", castRule.id, {ref: "origin"}));
  }

  // S2–S4：每个目标各解析一次
  for (const target of snapshot.targets) {
    for (const slot of ["travel", "impact", "aftermath"]) {
      const rule = firstMatch(armory[slot], snapshot, ctx);
      if (!rule) continue;
      const at = {ref: "target", tokenId: target.tokenId, uuid: target.uuid,
                  x: target.x, y: target.y};
      cues.push(...normalize(rule.build(snapshot, ctx, target), slot, rule.id, at));
    }
  }

  if (!cues.length) return null;
  return {v: PLAN_VERSION, seed: snapshot.seed, source: snapshot.id, region: snapshot.region ?? null, cues};
}

/**
 * persist 槽：由 ActiveEffect 增删驱动，不经过动作。
 * @param {EffectSnapshot} effectSnapshot
 * @param {{assets: object, armory: object}} deps
 * @returns {FXPlan|null}
 */
export function resolveEffect(effectSnapshot, {assets, armory}) {
  const ctx = createContext({assets, snapshot: effectSnapshot, seed: effectSnapshot.seed});
  const rule = firstMatch(armory.persist, effectSnapshot, ctx);
  if (!rule) return null;
  const at = {ref: "target", tokenId: effectSnapshot.target.tokenId,
              uuid: effectSnapshot.target.uuid,
              x: effectSnapshot.target.x, y: effectSnapshot.target.y};
  const cues = normalize(rule.build(effectSnapshot, ctx), "persist", rule.id, at);
  if (!cues.length) return null;
  return {v: PLAN_VERSION, seed: effectSnapshot.seed, source: effectSnapshot.statusId, cues};
}

export {SLOTS};
