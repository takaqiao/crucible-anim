import {PLAN_VERSION, SLOTS} from "../const.mjs";
import {createContext} from "./context.mjs";

/** 每个 cue 的默认值，兵库规则只需写它关心的字段。 */
const CUE_DEFAULTS = {
  kind: "effect", playIf: "always",
  attachTo: false, bindScale: false, local: true,
  aim: null, stretchTo: null, offset: {x: 0, y: 0}, gridUnits: false,
  objectScale: 1, scale: null, mirrorY: false, randomizeMirrorY: false, randomRotation: false,
  angle: 0,
  filter: null, tint: null, opacity: 1,
  fadeIn: 200, fadeOut: 300, fadeInEase: "easeOutQuad", fadeOutEase: "easeInQuad",
  belowTokens: false, zIndex: 50, elevation: null, mask: null,
  delay: 0, playbackRate: 1, waitUntilFinished: null,
  /**
   * 播放窗口，单位 ms，两个数都相对**素材自身的第 0 帧**：
   *   startTime = 从素材的第几毫秒开始播（默认 0 = 从头）
   *   duration  = 从 startTime 起**还要播多久**（默认 null = 一直播到素材自然结束）
   *
   * 「还要播多久」而不是「绝对终点」是本仓库的选择，改之前先读完这三条：
   *   1. 兵库里 20+ 处数值、`trimFlash()`（armory/flash.mjs 的 `duration <= from`）、
   *      以及 armory-impact.test.mjs 的 fade 预算（`life = duration ?? (assetMs - startTime)`）
   *      全按这个口径算；
   *   2. Sequencer 自己的 SoundSection 就是这个口径——`duration = data.duration === false ?
   *      endTime - startTime : data.duration`（sequencer.js:10387），换成绝对终点会让同一个
   *      字段在 effect 与 sound 上含义相反；
   *   3. 与 `duration: null` 的含义连续：把 duration 补到 `assetMs - startTime` 与省略它等价
   *      （8 支 eskie 正是这么写的：234+266=500、267+233=500，素材 501ms）。
   *
   * 代价是它与 Sequencer `EffectSection.duration()` 的表面行为**相反**：那边
   * `.startTime(s)` + `.duration(d)` 实际只播 `clamp(d - s, 0, d)`（sequencer.js:16052 →
   * 16097 → 16106），d ≤ s 时归零。换算集中在 player/play.mjs 的 applyTimeWindow() 一处，
   * 由 test/play-contract.test.mjs 逐条钉住。
   *
   * 硬约束：**startTime + duration ≤ 素材总长**。超了只可能是有人按绝对终点填了表
   * （每条都会正好多出一个 startTime），armory-impact.test.mjs 的「fade 预算」用例里有守卫。
   */
  duration: null, startTime: 0,
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
   * 后果：世界文档的 `flags.sequencer.effects` 无界堆进 N 条记录，其中只有本人那条能被
   * 本人清掉——别人那 N-1 条谁也清不动，只剩 GM 手动 `endAllEffects()`；反过来中途进场
   * 的玩家一条属于自己的记录都没有，一个光环都看不到。
   * 注意它**不会**表现成「GM 重载后叠 N 层」：`get shouldPlay()` 的第三个子句
   * `(!data.local || data.creatorUserId === game.user.id)`（sequencer.js:15145）在
   * local:true 时把回放限回自己那一条。别拿「上机看了没叠层」当契约可以放松的证据——
   * 损害是世界存档脏数据与他人不可见，不是叠层。
   * **这类问题离线测试测不出，只有多客户端上机才暴露。**
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

/**
 * 规则可以返回单个 cue、cue 数组或 null；统一成数组并补默认值。
 *
 * `forTarget` 与 slot/rule 一样是**注入字段**（不进 CUE_DEFAULTS，规则不许自己写）：
 * 这条 cue 是「关于哪个目标」的，null = 不属于任何单个目标（cast 槽与 once 规则）。
 * 从前这条信息只能从 `at.tokenId` 反推——那是把「锚点摆在哪」当成「讲的是谁」，两者
 * 只是碰巧一致：飞行物锚在施法者、近战挥击带 offset、震屏另挑锚点，任何一个锚点搬家
 * 都会让反推失效（test/armory-flash.test.mjs 的 byTarget 正是这么反推的）。
 *
 * 写在 `...c` **之前**：默认值由槽装配给（每目标规则 = 当前目标，cast/once = null），
 * 但 once 规则内部自己按目标铺开时（impact.layered）必须能逐条盖掉这个 null。
 */
function normalize(out, slot, ruleId, at, forTarget, ctx) {
  if (!out) return [];
  const arr = Array.isArray(out) ? out : [out];
  return arr.filter(Boolean)
    .map(c => freezeRandom({...CUE_DEFAULTS, forTarget, ...c, slot, rule: ruleId, at: c.at ?? at}, ctx));
}

/**
 * 把两个「Sequencer 交给每个客户端各自摇」的随机项在出手端摇定，写成具体数值进 FXPlan。
 *
 * 这是 DESIGN §5.4「随机选材在出手端固化进 FXPlan」的最后一个缺口：本模组的传输模型是
 * 每客户端各自本地播同一份 plan，而这两项的求值都发生在**播放端**——
 *   · randomRotation：CanvasEffect 用自己的 mersenne twister（sequencer.js:15694），种子是
 *     `creationTimestamp: Date.now()`（sequencer.js:25244），逐机不同；
 *   · randomizeMirrorY：`_initialize()` 里的裸 `Math.random() < 0.5`（sequencer.js:25045），
 *     连 twister 都不走。
 * 结果是同一次命中的血溅在每台机器上朝向/镜像都不同。这不影响玩法，但会让 Task 16 第 20 项
 * 「两个客户端画面一致」把一个正常差异当成 bug 追。
 *
 * 固化后 `randomRotation` / `randomizeMirrorY` 恒为 false 下发给播放层，兵库规则的写法不变。
 */
function freezeRandom(cue, ctx) {
  if (cue.randomRotation) {
    cue.angle = (cue.angle ?? 0) + Math.round(ctx.rngAux() * 720) - 360;
    cue.randomRotation = false;
  }
  if (cue.randomizeMirrorY) {
    cue.mirrorY = cue.mirrorY || (ctx.rngAux() < 0.5);
    cue.randomizeMirrorY = false;
  }
  return cue;
}

/**
 * 调用规则的 build() 并归一化产出。build() 抛异常时只丢掉这一次产出并留痕——
 * 从前 build 没有 try/catch，一个残缺目标（或 once 规则误收到 null 代表目标）
 * 抛出的 TypeError 会顺着调用栈把整个 resolve() 带崩，该动作五个槽的 cue 全没了。
 * 正常代码路径上一条 warning 都不该有，test/coverage.test.mjs 用全量 fixture 守着。
 */
function runBuild(rule, snapshot, ctx, target, built, slot, at, forTarget = null) {
  let out = null;
  try {
    out = rule.build(snapshot, ctx, target, built);
  } catch (err) {
    ctx.warn(`[${slot}] 规则 "${rule.id}" 的 build() 抛出异常：${err?.message ?? err}`);
    return [];
  }
  return normalize(out, slot, rule.id, at, forTarget, ctx);
}

/**
 * 多目标：把「靠 waitUntilFinished 逐条交棒」改写成「每个目标各一条并行的绝对时间轴」。
 *
 * ## 这是在修一个实战 bug，不是优化
 *
 * `Sequence.play()`（sequencer.js:27772-27776）是**一条线性队列**：
 * `if (section.shouldWaitUntilFinished) promises.push(await section._execute())`——
 * 带交棒点的一段会卡住整个 for 循环。而每目标规则是**每个目标各出一条 cue**，
 * 于是两个目标的挥击不是同时挥，而是排队：
 *
 *   travel(A) dur=933 wuf=-400   → 队列在 t=533 放行
 *   travel(B) dur=767 wuf=-400   → B 的挥击从 t=533 才开始，队列在 t=900 放行
 *   impact(A) delay=0            → **A 的血溅打在 t=900**
 *
 * A 的交棒点本该是 t=533（挥击 933ms、提前 400ms 出血），实际晚了 367ms——
 * 那时 A 的挥击（t=933 结束）几乎已经收招。全量语料实测 177 个动作中招，
 * 首目标迟到中位 503ms、最大 636ms；其中 fan/aura/pulse/cone/blast/ray 这些
 * **系统里真的会打到多个目标**的类型占 53 个。`fanOfArrows` 现在是一支箭飞完再射下一支。
 *
 * ## 为什么改成绝对 delay 是安全的
 *
 * `waitUntilFinished` 的好处是**不需要提前知道时长**——播放端等素材自己播完。换成绝对
 * delay 就必须在出手端算出时长。全量语料实测：354 条每目标阻塞 cue **全部带显式
 * `duration`**，无一条 persist、无一条 sound。前提成立才敢改。
 *
 * 等待量取 `delay + duration + wuf`：`Section._execute()`（21506-21538）把整段包在
 * `setTimeout(..., this._basicDelay)` 里，所以 delay 计入；`EffectSection.run()`
 * （25008-25014）是 `totalDuration = _currentWaitTime + await duration` 再 setTimeout，
 * 而那个 duration 是 `_totalDuration`（16112），**不含 delay**。
 *
 * ## 只在 ≥2 目标时改写
 *
 * 单目标下线性队列与并行时间轴**本来就等价**，改写只会白白丢掉「不知道时长也能交棒」
 * 这个好处。所以单目标计划逐字节不变，既有基线与测试全部照旧。
 *
 * ## 交棒锚点：为什么末尾那条要留一个 waitUntilFinished
 *
 * 非阻塞段的 promise **不覆盖播放时长**：`_execute()`（21526）对非 async 段是裸
 * `this.run()` 不 await，`play()` 末尾的 `Promise.allSettled` 于是可能在画面还在播时就
 * 兑现，信号量（player/semaphore.mjs）会提前放行、让下一个动作叠上来。Sequencer 自己靠
 * `_waitAnyway`（21247）给**最后一段**兜了这个底，这里把它显式写进计划，免得依赖一个
 * 看不见的实现细节。
 *
 * ⚠ 与单目标时一样，这个覆盖是**近似**的：末尾那条不一定是最后结束的那条（分支长短
 * 不一，A 的挥击 933ms、B 的 767ms）。这不是本次改写引入的，今天的单目标计划同样如此。
 *
 * ## 一致性优先于「能省则省」
 *
 * 初版对「阻塞 cue 不足 2 条」的计划提前返回——反正不会互相顶，何必改写。结果是同一批
 * 多目标计划里两种表示法并存，任何守卫都得先分辨「这份改写了没有」，而那个判据只能从
 * 改写留下的痕迹反推，是循环论证。现在一律改写：**≥2 目标的计划恒为绝对式、恒有且只有
 * 一条带交棒点、且它就是起播最晚的那条**，不变式没有特例。
 *
 * @param {object[]} cues  原地改写（会重排：交棒锚点被挪到队尾）
 * @param {number} targetCount
 * @param {object} [ctx]  只用来发告警
 */
function parallelizeTargets(cues, targetCount, ctx) {
  if (targetCount < 2) return;

  // 每个目标一条独立时间轴。forTarget == null 的是共享内容（cast 槽、once 规则），
  // 它对所有分支都可见：分支要等共享前奏跑完，共享内容也要等所有分支跑完。
  const branch = new Map();
  let shared = 0;
  const startAt = new Map();

  for (const c of cues) {
    const key = c.forTarget;
    if (key == null) {
      // 共享 cue 排在所有已开分支之后（STS 形状：cast → 每目标 travel → 共享 impact）
      for (const t of branch.values()) shared = Math.max(shared, t);
    } else if (!branch.has(key)) {
      branch.set(key, shared);            // 分支从共享前奏结束处起跑
    }
    const cur = key == null ? shared : branch.get(key);
    const start = cur + (c.delay ?? 0);
    startAt.set(c, start);
    if (c.waitUntilFinished === null) continue;
    // 这里是唯一一处「本来不必知道时长、现在必须知道」的地方。全量语料实测多目标计划里
    // 每一条带交棒点的 cue 都有显式 duration，所以下面这条告警今天一次都不会响——
    // 但**不能静默按 0 算**：真有规则漏写时长时，交棒点会悄悄塌到 0，画面错得无人知晓。
    if (c.duration == null) {
      ctx?.warn?.(`[${c.slot}] 规则 "${c.rule}" 在多目标计划里带交棒点却没有显式 duration，`
                + `时长按 0 计——多目标下交棒点要在出手端算成绝对时刻，算不出来。`);
    }
    const end = start + (c.duration ?? 0) + c.waitUntilFinished;
    if (key == null) shared = end; else branch.set(key, end);
  }

  for (const c of cues) {
    c.delay = Math.max(0, Math.round(startAt.get(c)));
    c.waitUntilFinished = null;
  }

  // 交棒锚点：挑**起播最晚**的那条，挪到队尾，给它一个交棒点。
  //
  // 挑最晚而不是就用队尾那条：分支长短不一（A 的挥击 933ms、B 的 767ms），发出顺序的
  // 最后一条是 B 分支的尾巴，比 A 分支的尾巴早收工——实测 strike 差 166ms。
  // 挪到队尾是因为带交棒点的一段会卡住队列，排在它后面的 cue 会被整体推迟；
  // 此时所有 delay 都已是绝对时刻，谁排在前面都无所谓，只有它必须最后。
  let anchor = 0;
  for (let i = 1; i < cues.length; i++) if (cues[i].delay >= cues[anchor].delay) anchor = i;
  const [a] = cues.splice(anchor, 1);
  a.waitUntilFinished = 0;
  cues.push(a);
}

/**
 * 施法者锚点。带上 tokenId/uuid/x/y 而不是只写 `{ref:"origin"}`——裸 ref 里既没有身份
 * 也没有坐标，播放层的 resolveRef（Task 14 的 resolveRefIn）除了返回 null 无事可做，
 * 整槽 cue 会被 play.mjs 的 `if (!target) continue` 静默吞掉。`ref` 仍留着，它决定的是
 * 「允不允许把这个锚点升格成一个真的 placeable」（见 docs/DESIGN.md §6.2 的 at 词表）：
 * origin/target 优先解析成 token，"point" 是冻结坐标、永不升格。
 */
const originAnchor = s => ({ref: "origin", tokenId: s?.origin?.tokenId ?? null,
                            uuid: s?.origin?.uuid ?? null,
                            x: s?.origin?.x, y: s?.origin?.y});

/**
 * 动作四槽装配（cast/travel/impact/aftermath）。由 ActiveEffect 驱动的 persist / death
 * 两槽不在这里，见下面的 resolveEffect()。
 * @param {ActionSnapshot} snapshot
 * @param {{assets: object, armory: object}} deps
 * @returns {FXPlan|null}
 */
export function resolve(snapshot, {assets, armory, onWarn}) {
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
    cues.push(...runBuild(castRule, snapshot, ctx, null, viewFor(0), "cast", originAnchor(snapshot)));
  }

  // S2–S4：选规则只看 snapshot，与具体目标无关，所以每槽只选一次——从前 firstMatch 写在
  // 目标循环里，when() 抛异常的告警会按目标数重复 N 遍。选中的规则自己声明出内容的粒度：
  //
  //  · 默认（rule.once 未置位）：每个目标各调一次 build，锚在该目标。投射物、近战挥击、
  //    投掷都属这类——两个目标就是两支箭、两记刀光。
  //  · rule.once === true：整个动作只调一次 build，默认锚在施法者（originAnchor）。
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
      const out = runBuild(rule, snapshot, ctx, targets[0] ?? null, viewFor(0), slot,
                           originAnchor(snapshot));
      shared[slot].push(...out);
      cues.push(...out);
      continue;
    }
    for (let i = 0; i < targets.length; i++) {
      const target = targets[i];
      const at = {ref: "target", tokenId: target.tokenId, uuid: target.uuid,
                  x: target.x, y: target.y};
      const out = runBuild(rule, snapshot, ctx, target, viewFor(i), slot, at, target.tokenId);
      perTarget[i][slot].push(...out);
      cues.push(...out);
    }
  }

  if (!cues.length) return drainWarnings(ctx, onWarn);
  parallelizeTargets(cues, targets.length, ctx);
  return {
    v: PLAN_VERSION, seed: snapshot.seed, source: snapshot.id, region: snapshot.region ?? null,
    cues, warnings: ctx.warnings
  };
}

/**
 * 「一条 cue 都没产出」时把诊断交出去，然后返回 null。
 *
 * 成功路径的 warning 挂在 plan.warnings 上、由触发层转发；空计划路径下 plan 是 null，
 * warning 会随 ctx 一起被丢掉——persist 槽尤其致命：每条 persist 规则只产 1 个 cue，
 * 唯一那个 cue 被 keepTied 丢掉后 cues 必为空，于是 keepTied 那条「宁可这次没有状态标记
 * 也要留痕」的诊断**永远不可能被任何人看到**（现象：状态图标有、光效没有、控制台零日志）。
 * onWarn 只在这条路径上调用，成功路径仍走 plan.warnings，不会重复报。
 */
function drainWarnings(ctx, onWarn) {
  if (onWarn) for (const msg of ctx.warnings) onWarn(msg);
  return null;
}

/**
 * persist / death 两槽的 build() 收不到前序槽视图——它们不属于任何动作的时间轴，
 * 没有「前面已经画过什么」可查。给一份冻结的空视图而不是 null，是为了让将来某条规则
 * 误写 `built.impact` 时拿到空数组而不是 TypeError。
 */
const NO_PRIOR_SLOTS = Object.freeze({
  travel: Object.freeze([]), impact: Object.freeze([]), aftermath: Object.freeze([])
});

/**
 * 由 ActiveEffect 驱动的两个槽的最后一道闸：`persist:true` 但 `tieTo` 为空的 cue
 * 一律丢弃并留痕。death 槽的 cue 不带 persist，这道闸对它是空过（留着不做例外，
 * 免得将来往 death 槽里加持久 cue 时绕开了唯一的防线）。
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
 * 由 ActiveEffect 驱动的槽：不经过动作，吃 EffectSnapshot。
 *
 * 两个槽共用本函数，靠 `slot` 参数选兵库（两者的规则签名与快照形状完全相同）：
 *  · `persist`（默认）—— 状态的持续光环，由创建/删除成对驱动；
 *  · `death`         —— 击杀那一刻的一次性爆发，只由 `dead` 落地驱动（见
 *                       armory/death.mjs 的文件头）。
 *
 * 与 resolve() 一样，本函数对任何输入都不得外抛——它挂在 createActiveEffect 钩子上，
 * 一个未捕获异常会连带打断状态上身的整条处理。四层防护：
 *  1. 残缺目标：没有 target 就没有可挂载的锚点，直接 null。ActiveEffect 挂在当前场景
 *     没有 token 的 actor 上（离场角色、跨场景、未链接 token 尚未渲染）是完全正常的
 *     情形，不是错误，所以不留 warning，静默不画。
 *  2. 槽名写错/兵库没有这个槽：直接 null，不让 firstMatch 去展开 undefined。
 *  3. 规则 when()/build() 抛异常：分别由 firstMatch 与 runBuild 降级成一条 warning。
 *  4. persist 但无 tieTo：由 keepTied 丢弃并留痕，见其注释。
 *
 * @param {EffectSnapshot|null} effectSnapshot
 * @param {{assets: object, armory: object}} deps
 * @param {"persist"|"death"} [slot]
 * @returns {FXPlan|null}
 */
export function resolveEffect(effectSnapshot, {assets, armory, onWarn}, slot = "persist") {
  const target = effectSnapshot?.target;
  if (!target) return null;
  const rules = armory?.[slot];
  if (!rules?.length) return null;
  const ctx = createContext({assets, snapshot: effectSnapshot, seed: effectSnapshot.seed});
  const rule = firstMatch(rules, effectSnapshot, ctx, slot);
  if (!rule) return null;
  const at = {ref: "target", tokenId: target.tokenId, uuid: target.uuid, x: target.x, y: target.y};
  // 第三个入参与 cast 槽一致传 null：这两个槽的规则签名是 (e, ctx)，目标几何已经在
  // e.target 里，不再另给一份免得两处不同步。
  const cues = runBuild(rule, effectSnapshot, ctx, null, NO_PRIOR_SLOTS, slot, at,
                        target.tokenId)
    .filter(c => keepTied(c, ctx, rule.id));
  if (!cues.length) return drainWarnings(ctx, onWarn);
  return {
    v: PLAN_VERSION, seed: effectSnapshot.seed, source: effectSnapshot.statusId,
    cues, warnings: ctx.warnings
  };
}

export {SLOTS};
