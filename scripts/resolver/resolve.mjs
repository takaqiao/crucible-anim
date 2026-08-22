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
   * 允许 Sequencer 把这条 cue 写进世界存档吗？默认 **false**，V1 没有任何一条 cue
   * 该置 true。默认值取安全侧是有意的：漏填 = 不写盘，不会造成脏数据；要写盘必须
   * 显式 opt-in。
   *
   * 为什么非拦不可——`persist` 是唯一会触发 Sequencer 落盘的开关，而本模组的传输模型
   * 是「每个客户端各自本地播放同一份 plan」（DESIGN §5.1 / §5.4）。两者相乘 = N 个
   * 在线客户端把同一个状态写成 N 条记录。Sequencer 4.2.3 的落盘判据是
   *
   *     if (data.persist && setFlags && effect.context && effect.owner
   *         && !effect.isSourceTemporary && !data.temporary && !data.remote) {
   *       flagManager.addFlags(effect.context.uuid, {effects: effect.data});
   *     }
   *
   * 这一行**没有 `!data.local` 子句**——`.locally()` 只把 `_users` 置成 `[me]` 从而让
   * push 为 false，拦得住 socket，拦不住写盘；`effect.owner` 判的是
   * `data.creatorUserId === game.user.id`，各客户端都是自己那份的 creator，于是人人
   * 写一条，经 `flagManager.addFlags` → `executeAsMainUser` 由 GM 落进隐藏
   * JournalEntry `sequencerDatabase` 的 `flags.sequencer.effects`；去重键 `_id` 是
   * randomID，不会合并。
   *
   * 后果：场景重载时 `initializePersistentEffects()` 回放全部记录，而 `shouldPlay`
   * 的用户过滤第一项就是 `game.user.isGM ||`——GM 绕过过滤，N 份全播，光环层层叠加、
   * opacity 复合越叠越亮；反过来中途进场的玩家一条属于自己的记录都没有，一个光环都
   * 看不到。**这类问题离线测试测不出，只有多客户端上机才暴露。**
   *
   * 播放层据此调 `.temporary(cue.worldPersist !== true)`。Sequencer 对 `.temporary()`
   * 的文档原话是「will not be stored in the flags of any object, even if .persist()
   * is called」；`.persist()` 的无限循环与 `tieToDocuments` 的自动清理都不受影响。
   * 代价是重载/入场时的重建改由本模组自己做，见 docs/DESIGN.md §6.7。
   *
   * `worldPersist:false` 与 `local:true` 必须同进同退，不许只改一个：
   * `getSourceData()` 对 `data.temporary && !this.owner` 的效果改从
   * `TemporaryPositionsContainer` 取位置，一条 temporary 的 cue 一旦被推给别人，那些
   * 客户端会拿不到位置。
   */
  worldPersist: false,
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
 * persist 槽的 build() 收不到前序槽视图——它不属于任何动作的时间轴，没有「前面已经
 * 画过什么」可查。给一份冻结的空视图而不是 null，是为了让将来某条 persist 规则误写
 * `built.impact` 时拿到空数组而不是 TypeError。
 */
const NO_PRIOR_SLOTS = Object.freeze({
  travel: Object.freeze([]), impact: Object.freeze([]), aftermath: Object.freeze([])
});

/**
 * persist 槽的最后一道闸：`persist:true` 但 `tieTo` 为空的 cue 一律丢弃并留痕。
 *
 * Sequencer 4.2.3 清理持久化特效只有两条链路，两条都要求 tiedDocuments 能解析：
 * (a) CanvasEffect 初始化时对 `data.tiedDocuments` 逐条 `fromUuidSync`，解析得到才
 *     注册对应文档的 delete 钩子；(b) 场景重载时 `_validateEffect` 按 tiedDocuments
 *     是否还存在剔除失效特效。tieTo 为空时两条都不生效，而 `persist:true` 又让
 *     Sequencer 把这枚特效持久化下来——结果是光效永久残留在 token 上、重载世界后照样
 *     回来，只能由 GM 手动 `Sequencer.EffectManager.endAllEffects()` 收拾。
 *
 * 因此宁可这一次没有状态标记（玩家仍能从 token 的状态图标看到状态本身），也不能放行
 * 一枚清不掉的光。上游 `snapshotEffect` 写 `effect.uuid ?? null` 本身就承认 uuid 可能
 * 缺失，这里补上对应的防线。
 *
 * 只在 persist 槽施加：动作槽将来若要做「留在地上直到战斗结束的焦痕」，那种 persist
 * 特效本就没有可绑定的 document，靠 `endEffects({name})` 按名收尾。
 */
function keepTied(cue, ctx, ruleId) {
  if (!cue.persist || cue.tieTo) return true;
  ctx.warn(`[persist] 规则 "${ruleId}" 产出了 persist cue 但 tieTo 为空，已丢弃：`
    + "Sequencer 只能靠 tiedDocuments 清理持久化特效，放行会让光效永久残留在 token 上。");
  return false;
}

/**
 * persist 槽：由 ActiveEffect 增删驱动，不经过动作。
 *
 * 与 resolve() 一样，本函数对任何输入都不得外抛——它挂在 createActiveEffect 钩子上，
 * 一个未捕获异常会连带打断状态上身的整条处理。三层防护：
 *  1. 残缺目标：没有 target 就没有可挂载的锚点，直接 null。ActiveEffect 挂在当前场景
 *     没有 token 的 actor 上（离场角色、跨场景、未链接 token 尚未渲染）是完全正常的
 *     情形，不是错误，所以不留 warning，静默不画。
 *  2. 规则 when()/build() 抛异常：分别由 firstMatch 与 runBuild 降级成一条 warning。
 *  3. persist 但无 tieTo：由 keepTied 丢弃并留痕，见其注释。
 *
 * @param {EffectSnapshot|null} effectSnapshot
 * @param {{assets: object, armory: object}} deps
 * @returns {FXPlan|null}
 */
export function resolveEffect(effectSnapshot, {assets, armory}) {
  const target = effectSnapshot?.target;
  if (!target) return null;
  const ctx = createContext({assets, snapshot: effectSnapshot, seed: effectSnapshot.seed});
  const rule = firstMatch(armory.persist, effectSnapshot, ctx, "persist");
  if (!rule) return null;
  const at = {ref: "target", tokenId: target.tokenId, uuid: target.uuid, x: target.x, y: target.y};
  // 第三个入参与 cast 槽一致传 null：persist 规则的签名是 (e, ctx)，目标几何已经在
  // e.target 里，不再另给一份免得两处不同步。
  const cues = runBuild(rule, effectSnapshot, ctx, null, NO_PRIOR_SLOTS, "persist", at)
    .filter(c => keepTied(c, ctx, rule.id));
  if (!cues.length) return null;
  return {
    v: PLAN_VERSION, seed: effectSnapshot.seed, source: effectSnapshot.statusId,
    cues, warnings: ctx.warnings
  };
}

export {SLOTS};
