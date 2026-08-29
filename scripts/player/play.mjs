import {PLAN_VERSION} from "../const.mjs";
import {debug, warn} from "../log.mjs";

const DEG = Math.PI / 180;

/**
 * playIf 的完整词汇表："always" + 8 种攻击结果（与 RESULT_NAME 一一对应）。
 * 见 resolver/resolve.mjs 的 CUE_DEFAULTS 与 docs/DESIGN.md §6.2。
 *
 * 这里**没有**聚合值（"critical" / "hitOrGlance" / "defended"）。它们从前在词表里，
 * 但 shouldPlay() 只做集合成员校验、命中即 return true——一条 playIf:"hitOrGlance"
 * 的 cue 在 miss/dodge/parry 下会照播不误且不留任何痕迹，白名单反而制造了
 * 「这三个值被支持」的假象，恰恰对最容易写错的三个值只校验不解释。它们在本架构下
 * 也是结构性多余的：cue 在 resolve() 阶段已经是针对**已发生的真实结果**构造出来的
 * （impact.mjs 的 playIf 直接取自 `RESULT_NAME[hit.result]`，与该 cue 的 file/at/aim
 * 出自同一次判定），没有任何东西可以聚合。删掉之后它们落进下面的 warn + 不播放分支，
 * 从「静默错播」变成「大声拒播」。
 *
 * 保留 playIf 字段本身的两个用途不变：
 *   1. 保持"序列结构恒定"（brief 的设计意图）：始终构造同一套 Sequencer 调用链，只是
 *      用 .playIf() 给一个布尔量，而不是用 if/continue 在 JS 里改变链的形状，方便在
 *      Sequencer Manager UI 里逐条比对。
 *   2. 数据完整性校验：cue.playIf 不在这张词表里，说明规则表写错了字（或者未来一个
 *      新增取值没有同步更新这里），此时保守地按"不播放"处理并留痕，而不是让 Sequencer
 *      对一个陌生字符串做未定义行为。
 */
const PLAY_IF_VALUES = new Set([
  "always", "hit", "glance", "armor", "block", "parry", "resist", "dodge", "miss"
]);

function shouldPlay(cue) {
  if (!PLAY_IF_VALUES.has(cue.playIf)) {
    warn(`未知的 playIf 取值 "${cue.playIf}"（规则 "${cue.rule}"，槽 "${cue.slot}"），按不播放处理`);
    return false;
  }
  return true;
}

/** resolveRef 可能退化返回一个裸 {x,y} 点（token 已从画面消失）。区分它与真正的 placeable。 */
function isPlaceable(ref) {
  return !!ref && typeof ref === "object" && "document" in ref;
}

/**
 * 把 resolveRef 的返回值折算成一个画布坐标点，只用来回答一个问题：「瞄准点是不是就是
 * 锚点本身」。placeable 取 center（Sequencer 的 atLocation 对 Token/Tile 同样落在中心，
 * 见 get_object_position），裸点取自身；两者都取不到有限坐标时返回 null，由调用方按
 * 「判不出来」处理，而不是当成「不同点」蒙混过去。
 *
 * 必须优先取 center：Foundry 的 Token.x/y 是**左上角**，拿它跟 aim.towards（中心坐标）
 * 比，每条命中 cue 都会被误判成「两点不同」，下面那条退化判据就整个失效。
 */
function pointOf(ref) {
  const p = ref?.center ?? ref;
  return Number.isFinite(p?.x) && Number.isFinite(p?.y) ? {x: p.x, y: p.y} : null;
}

/**
 * 1px 容差。真实的瞄准至少隔一格（默认 100px/格），1px 以内只可能是同一点经过 center
 * 换算 / 序列化往返之后的舍入噪声，不可能是一次有意义的转向。
 */
function samePoint(a, b) {
  return !!a && !!b && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1;
}

/**
 * 把 cue 的「素材内播放窗口」翻译成 Sequencer 的时间调用。这条语义只在这里换算一次。
 *
 * 兵库侧的约定（权威定义见 resolver/resolve.mjs 的 CUE_DEFAULTS.duration）：
 *   startTime = 从素材的第几毫秒开始播；duration = 从那一刻起**还要播多久**。
 *
 * Sequencer 侧不是这么解释的。`CanvasEffect._calculateDuration()`（sequencer.js:16049-16106）：
 *   16052  _animationDuration = data.duration || mediaDurationMs
 *   16092  data.time.start   → _startTime，并把媒体 seek 到该处
 *   16097  _endTime = _animationDuration              ← 没有 time.end 时
 *   16106  _animationDuration = clamp(endTimeMs - startTimeMs, 0, _animationDuration)
 * 也就是说 `.startTime(s)` 与 `.duration(d)` 同时出现时，d 被当成**相对素材 0 点的绝对
 * 终点**，实际只播 d - s；d ≤ s 时 clamp 到 0，那条 cue 一帧都不出。同一件事在
 * `loopHandler`（17748-17760：`if (this.mediaCurrentTime < endTime) return;` 否则
 * pauseMedia + endEffect）上独立地再发生一次，两条通路结论一致。
 *
 * 表达「绝对终点」的唯一入口是 `.timeRange(start, end)`：只有它把 `_isRange` 置真
 * （22490-22506；startTime/startTimePerc/endTime/endTimePerc 四个方法都显式置 false），
 * 16102 因此走 `_endTime = end.value` 这一支。`.endTime(n)` 帮不上忙——它的语义是
 * 「从末尾裁掉 n 毫秒」（22550-22560 与 16102 的 else 支）。
 *
 * 所以两者同时存在时下发 timeRange(s, s+d)，并**保留** `.duration(d)`：timeRange 定住
 * 窗口两端，duration 把 16106 的 clamp 上限钉在 d，于是播出时长只取决于兵库写的这两个
 * 数，不取决于素材当场报出来的 mediaDurationMs（静态图走 16060-16087 的 fade 派生分支、
 * spritesheet、加载竞态都不会让窗口塌成 0）。二者共同得到 clamp((s+d) - s, 0, d) = d。
 *
 * 只给其中一个时保持原样：
 *   · 只有 startTime → data.duration 为 false，16052 取素材长度，16106 得 media - s，
 *     正是「从 s 播到素材自然结束」；
 *   · 只有 duration  → s = 0，clamp(d, 0, d) = d；
 *   · 两个都没有     → `_startTime || _endTime` 为假，25334 把 time 整个置 false。
 *
 * SoundSection 不吃这一套：它自己算 `duration = data.duration === false ?
 * endTime - startTime : data.duration`（sequencer.js:10387），data.duration 本来就是
 * 「播多久」。timeRange 对它同样成立（endTime - startTime = d），traits.time 与 duration
 * 都在它的 mixin 列表里（25934-25945 / 基类 21449），两条分支因此共用本函数。
 *
 * shake 分支**不能**用它：那是 copySprite 的无 file 特效，mediaDurationMs 为 0，一旦
 * 少了 data.duration，16052 的 `|| mediaDurationMs` 会把 clamp 上限变成 0。
 */
function applyTimeWindow(section, cue) {
  const start = cue.startTime ?? 0;
  const dur = cue.duration;
  if (start > 0 && dur !== null) { section.timeRange(start, start + dur).duration(dur); return; }
  if (start > 0) section.startTime(start);
  if (dur !== null) section.duration(dur);
}

/**
 * 把一条构造到一半的 section 从 Sequence 里撤下来。
 *
 * 为什么非撤不可：`seq.effect()` / `seq.sound()` 在**返回之前**就把 section push 进
 * `this.sections`（sequencer.js:27890-27894 / 27901-27905），链式配置抛错只是中断配置，
 * 那条已 push、配置到一半的 section 仍会照播：
 *   · `e.mask()` 抛错 → 不带遮罩的光束/锥形溢出模板边界，正是 travel.mjs 明说要靠
 *     mask 兜住的 bug；
 *   · `e.tieToDocuments([uuid])` 对失效 uuid 抛错（24700-24712）→ 一枚没绑文档、清不掉
 *     的持久光效，resolve.mjs 的 keepTied 花 20 行防的就是它；
 *   · 抛点早于 atLocation → section 连 _source 都没有，_expressWarnings（24957）抛
 *     "Could not determine where to play the effect!"，而那条 throw 在 run() 里、位于
 *     Section._execute() 的 `new Promise(async resolve => setTimeout(async …))` executor
 *     内层（21511-21536）——async 回调 reject 不会 reject 外层 Promise，resolve() 永不
 *     执行。最后一条 section 的 `_waitAnyway`（21247-21249）恒为真、必被 await
 *     （Sequence.play() 27772），于是 `Promise.allSettled`（27782）永不返回，
 *     playPlan() 整个挂死。
 *
 * 为什么用 lastIndexOf+splice 而不是 pop()：pop() 在「seq.effect() 之前就抛错、根本没
 * push」或将来循环里多推一条 section 时会误删无辜的那条。身份比较是可靠的——
 * section_proxy_wrap（547-557）只有 get 陷阱，链式方法 `return this` 时 this 是 receiver
 * 即 Proxy 本身，所以链尾拿到的引用与数组里的元素 ===。
 *
 * `seq.sections` 穿得过 Sequence 的代理：sequence_proxy_wrap（528-546）的 get 陷阱对
 * `objHasProperty(target, "sections")` 为假的属性会先看最后一条 section 的原型有没有同名
 * 成员（EffectSection 及其 traits 都没有 `sections`），再 `Reflect.get(target, prop)` 返回
 * 真正的那个数组，splice 因此改的是真数组。
 *
 * playIf(false) 只做兜底：它撤不干净（那条 section 仍会被 27754 的 _initialize 与 27757
 * 的 preload 碰到），但它绝不会二次抛错（playIf 无任何入参校验），且 _execute()
 * （21506-21510）在 _shouldPlay() 为假时立刻 return，run()/_expressWarnings() 都不会跑。
 */
function dropSection(seq, section) {
  if (!section) return;
  const i = seq.sections.lastIndexOf(section);
  if (i !== -1) seq.sections.splice(i, 1);
  else { try { section.playIf(false); } catch { /* 兜底路径本身不许再抛 */ } }
}

/**
 * 把 `plan.region`（resolver 产出的纯几何数据：circle/cone/line）转成 Sequencer
 * `.mask()` 能直接吃的原始 PIXI 形状。
 *
 * 不走 Foundry 的 `MeasuredTemplate.getConeShape`/`getRayShape`：那两个静态方法在 v14
 * 已标记 deprecated（since 14 until 16，调用即打一条 compatibility warning），且入参是
 * 网格单位、要求 `canvas.grid`/`canvas.dimensions` 现场换算；而 `plan.region` 里的
 * x/y/radius/length/width 在 resolver 产出时就已经是像素（见 trigger/snapshot.mjs 与
 * armory/travel.mjs 的 templateEnd/DEG 换算，同一份约定这里原样复用），直接在像素空间
 * 构造形状既不必依赖 deprecated API，也让这段几何可以脱离一个真正放置过的模板文档
 * 独立复算——这正是 Sequencer mask() 文档允许的用法："Raw shapes (PIXI.Polygon,
 * PIXI.Circle, PIXI.Rectangle) are masked in scene coordinates"。
 *
 * 锥形**分两种底**，判据取自 core 自己的 `client/data/shapes.mjs`（逐条依据写在下面
 * 那段函数体注释里）：Crucible 的 60° cone 是"扁三角"（`curvature:"flat"`），与
 * travel.mjs 的 templateEnd()/coneYScale() 同一个换算，两处必须保持一致；而 fan 的
 * 210° 是圆扇形（`curvature:"round"`），边就是半径、底是圆弧。从前这里对**所有** cone
 * 按扁三角建模，钝角上会把远端顶点甩到 114 倍半径之外（施工清单 §0.13）。
 */
function regionMaskShape(region) {
  if (!region) return null;
  if (region.type === "circle" && Number.isFinite(region.radius)) {
    return new PIXI.Circle(region.x, region.y, region.radius);
  }
  if (region.type === "cone" && Number.isFinite(region.radius)) {
    const rot = (region.rotation ?? 0) * DEG;
    const rawAngle = Number(region.angle ?? 60) || 60;
    /*
     * 【圆底锥】core 的锥形有两种底，**不是同一个形状**，判据在
     * `client/data/shapes.mjs:1310-1350` 的 `_getRays()` 与 `:1382-1406` 的
     * `_createClipperPolyTree()`：
     *
     *   · `curvature === "flat"`（Crucible 的 60° cone）：两条边射线长
     *     `radius / cos(halfAngle)`，底是一条直线 —— 与下面那段扁三角逐字同式，
     *     也与 armory/travel.mjs 的 templateEnd()/coneYScale() 同一套换算。
     *   · 其余（fan 的 210° 走 `"round"`）：`grid.getCone(origin, radius, rotation, angle)`
     *     的**圆扇形**（common/grid/base.mjs:596-631），文档明写「the first point of the
     *     polygon is the origin」，两条边就是半径本身、底是一段圆弧。
     *
     * 为什么必须分开：扁三角那条式子在钝角上会炸。fan 的 210° 半角 105°，
     * `cos(105°)` 为负；就算像原来那样把角度钳到 179°，`reach = radius/cos(89.5°)`
     * = **114.59 × radius**，两个远端顶点会被甩到 114 倍半径之外——遮罩不是「差一点」，
     * 是整个画面被一块巨大的三角形罩住。原注释没写错，只是 round 分支当时不存在，
     * 于是所有 cone 都被按 flat 处理（施工清单 §0.13 的第一条硬前置）。
     *
     * 判据优先取 `region.curvature`（snapshot 从模板文档带下来的原值）；缺字段时按
     * core 自己的默认换算回退 —— `action-use-dialog.mjs:528` 写死
     * `curvature: angle <= 90 ? "flat" : "round"`。
     */
    const round = (region.curvature ?? (rawAngle <= 90 ? "flat" : "round")) !== "flat";
    if (round) {
      const angle = Math.min(Math.max(rawAngle, 1), 360);
      const half = (angle / 2) * DEG;
      const r = region.radius;
      /*
       * 圆弧离散化：core 的 gridless getCircle 承诺「偏差小于 0.25 像素」，这里用同一个
       * 口径反算步长——弦高（sagitta）`r·(1−cos(step/2)) ≤ 0.25` ⟹
       * `step ≤ 2·acos(1 − 0.25/r)`。半径越大分段越多，遮罩边缘在任何缩放下都读不出折线。
       * 上下限只是防御：r 极小时 acos 的入参会掉出 [-1,1]，r 极大时段数不必无限涨。
       */
      const maxStep = 2 * Math.acos(Math.max(-1, Math.min(1, 1 - 0.25 / Math.max(r, 1))));
      const n = Math.min(720, Math.max(8, Math.ceil((angle * DEG) / Math.max(maxStep, 1e-3))));
      // 第一个点必须是锥尖：core 的 getCone 是这么排的，且 test/play-contract.test.mjs
      // 的「遮罩多边形的第一个顶点必须是模板起点」按这条断言。
      const pts = [region.x, region.y];
      for (let i = 0; i <= n; i++) {
        const a = rot - half + (angle * DEG) * (i / n);
        pts.push(region.x + Math.cos(a) * r, region.y + Math.sin(a) * r);
      }
      return new PIXI.Polygon(pts);
    }
    // 扁底锥（Crucible 的 60° cone）：射线在 ±angle/2 方向、reach = radius / cos(angle/2)，
    // 底边中点正好落在距锥尖 radius 处、半宽 radius·tan(angle/2)。
    // 角度钳到 [1°,89°]：flat 的定义域上界就是 90°（shapes.mjs:1456 的 maxAngle），
    // 越界的只会是「curvature 字段说 flat 但角度不是 flat」的脏数据，钳住防 tan(90°) 炸。
    const angle = Math.min(Math.max(rawAngle, 1), 89);
    const half = (angle / 2) * DEG;
    const reach = region.radius / Math.cos(half);
    const a1 = rot - half, a2 = rot + half;
    return new PIXI.Polygon([
      region.x, region.y,
      region.x + Math.cos(a1) * reach, region.y + Math.sin(a1) * reach,
      region.x + Math.cos(a2) * reach, region.y + Math.sin(a2) * reach
    ]);
  }
  if (region.type === "line" && Number.isFinite(region.length)) {
    const rot = (region.rotation ?? 0) * DEG;
    const hw = (region.width ?? 0) / 2;
    const nx = Math.cos(rot + Math.PI / 2), ny = Math.sin(rot + Math.PI / 2);
    const ex = region.x + Math.cos(rot) * region.length, ey = region.y + Math.sin(rot) * region.length;
    return new PIXI.Polygon([
      region.x + nx * hw, region.y + ny * hw,
      ex + nx * hw, ey + ny * hw,
      ex - nx * hw, ey - ny * hw,
      region.x - nx * hw, region.y - ny * hw
    ]);
  }
  return null;
}

/**
 * 把一条 FXPlan 交给 Sequencer 播放。
 *
 * `plan` 为 null（resolve()/resolveEffect() 判定这次没有任何内容可画）时静默返回：
 * 这不是错误，诊断归触发层——trigger/*.mjs **应当**在自己那一侧记录（截至 Task 13
 * 三个调用点草案都还没记，Task 14/15 的 checklist 要补上；`plan.warnings` 同样还没有
 * 任何运行时消费者，非空时值得在触发层 warn 一条）。之所以不在这里补：trigger 拿到
 * null 时比播放层更清楚"为什么没有内容"——是没匹配到规则、没有目标、还是 effectUuid
 * 缺失被 keepTied 拦下——播放层这里只知道"我收到了 null"，重复记一遍等于噪音不等于
 * 信息。真正需要在这一层补一行日志的，是版本不符（下面那条 warn）：那是播放层独有的
 * 判断，trigger 层看不到 PLAN_VERSION 对不对。
 *
 * **返回时机**：普通计划 await 到整条序列播完；带 persist cue 的计划只 await 到序列被
 * 交给 Sequencer 为止——持久特效在 Sequencer 里没有"播完"这个时刻，理由与源码依据见
 * 函数末尾。调用方据此知道：persist 计划的这个 promise **不能**用来判断画面结束。
 *
 * @param {FXPlan|null} plan
 * @param {{volume: number, shake: boolean, resolveRef: (at: object) => any}} opts
 * @returns {Promise<void>}
 */
export async function playPlan(plan, {volume = 1, shake = true, resolveRef}) {
  if (!plan) return;
  if (plan.v !== PLAN_VERSION) {
    warn(`跳过版本不符的动画计划：v${plan.v}，当前 v${PLAN_VERSION}`);
    return;
  }
  debug("播放计划", plan);

  const seq = new Sequence({moduleName: "crucible-anim", softFail: true});

  for (const cue of plan.cues) {
    // section 的引用必须提到 try 外面：catch 要靠它把构造到一半的 section 撤下来
    // （见 dropSection）。声明在 try 体内的 const 在 catch 里够不着。
    let section = null;
    try {
      // sound 先分派、再解析锚点：这条 cue 是全局音效，从头到尾不碰 target
      // （不 atLocation、不 attachTo）。放在 resolveRef 之后就等于给声音套上一个
      // "施法者/目标 token 此刻还在画布上"的前置条件——目标已经倒地移除时，
      // 命中音会连带被吞掉。
      if (cue.kind === "sound") {
        const s = seq.sound();
        section = s;
        s.playIf(shouldPlay(cue))
          .file(cue.file)
          .volume((cue.volume ?? 1) * volume)
          .delay(cue.delay)
          .locally(cue.local);
        // 时间窗口统一走 applyTimeWindow：SoundSection 的 traits 里同样有 time
        // （sequencer.js:25934-25945）与 duration（Section 基类 21449），但它对
        // data.duration 的解释与 EffectSection 相反（10387 直接把它当播放时长用），
        // 换算细节见该函数注释。strike.ranged.draw 那条起手音效就靠 duration:800 把
        // 烘焙在音频里的"箭到"尾音截掉——规则在 armory/cast.mjs 的 strike.ranged.draw
        // （cast 槽 pri 640），不在 travel.mjs。
        applyTimeWindow(s, cue);
        if (cue.waitUntilFinished !== null) s.waitUntilFinished(cue.waitUntilFinished);
        continue;
      }

      const target = resolveRef(cue.at);
      if (!target) continue;

      if (cue.kind === "shake") {
        // 只抖目标 sprite 的副本（copySprite），不震全屏——全屏震动会让其他玩家不适。
        // copySprite 要求一个真正的 Token/Tile placeable；resolveRef 在目标 token 已经
        // 从画面消失时会退化成裸 {x,y}，那种情况下没有 sprite 可复制，只能跳过这条 cue。
        // 判在建 section 之前：建完再 continue 会把一条空壳留在 seq.sections 里。
        if (!isPlaceable(target)) continue;
        const sh = seq.effect();
        section = sh;
        sh.playIf(shake && shouldPlay(cue))
          .copySprite(target)
          // zIndex 读 cue 而不是硬编码 0：cue 上白纸黑字写着这个字段（impact.mjs 的
          // 震屏 cue 显式声明 zIndex: 0），播放层再自己拍一个数，数据契约与播放层
          // 公开的行为就对不上，将来谁调它都会被静默丢弃且没有测试能抓。
          .zIndex(cue.zIndex)
          .locally(cue.local)
          .delay(cue.delay)
          // shake 分支不走 applyTimeWindow：copySprite 没有 media，mediaDurationMs 为 0，
          // 一旦少了 data.duration，16052 的 `|| mediaDurationMs` 会把 clamp 上限变成 0。
          .duration(cue.duration ?? 400)
          // gridUnits:true 不可省：intensity 是"格子宽度的分数"（0.08 格 ≈ 8px@100px
          // 格），Sequencer 只有在 gridUnits:true 时才会把 loopProperty 的 from/to 乘上
          // canvas.grid.size（sequencer.js 的 _playAnimations 逐字核对过）；漏了这一项
          // 数值原样当像素用，0.08px 的抖动在屏幕上完全不可见——测试全绿也测不出来，
          // 因为没有渲染环境可断言"看得见"。
          .loopProperty("sprite", "position.x", {
            from: -(cue.intensity ?? 0.08), to: (cue.intensity ?? 0.08),
            duration: 60, pingPong: true, gridUnits: true
          });
        continue;
      }

      // attachTo 需要一个真正可跟随的 placeable；同上，resolveRef 的裸点兜底路径下没有
      // 可附着的对象，与其让 Sequencer 在构造期对一个 {x,y} 抛错，不如直接跳过这一条。
      // 同样判在建 section 之前。
      if (cue.attachTo && !isPlaceable(target)) continue;

      const e = seq.effect();
      section = e;
      e.playIf(shouldPlay(cue))
        .file(cue.file)
        .opacity(cue.opacity)
        .fadeIn(cue.fadeIn, {ease: cue.fadeInEase})
        .fadeOut(cue.fadeOut, {ease: cue.fadeOutEase})
        .zIndex(cue.zIndex)
        .delay(cue.delay)
        .playbackRate(cue.playbackRate)
        .belowTokens(cue.belowTokens)
        .locally(cue.local);

      if (cue.attachTo) e.attachTo(target, {bindScale: cue.bindScale});
      // atLocation 不传 gridUnits：它只在 `if (inOptions.offset)` 分支里才把 gridUnits
      // 转交给 _validateOffset（sequencer.js:22829-22837），而本文件从不给 atLocation
      // 传 offset，那个选项永远不生效。真正的格单位换算全由下面的 spriteOffset
      // （22852-22896）承担。
      else e.atLocation(target);

      // 这条 cue 最终是不是走了「锚点交给模板」的那条 rotateTowards？下面的模板下发块
      // 要用它来判断这条 cue 会不会真的消费 template（见该处注释）。声明在 if (cue.aim)
      // 之外：块级作用域里的 const 出了块就够不着，而模板下发块在 stretchTo 之后。
      let rotatesWithTemplate = false;

      if (cue.aim) {
        const towards = resolveRef({ref: "point", ...cue.aim.towards}) ?? cue.aim.towards;
        const atPoint = pointOf(target);
        const aimPoint = pointOf(towards);
        if (!atPoint || !aimPoint) {
          warn(`cue 的锚点或瞄准点解析不出坐标（规则 "${cue.rule}"，槽 "${cue.slot}"），`
            + "无法判断这次转向是否退化，保守地不调 rotateTowards");
        }
        // .rotateTowards() 只在它真的有事可做时才调，两条排除各有独立的源码依据：
        //
        //  1. 带 stretchTo 的 cue 一律不调。拉伸自己就会转向——_transformSprite()
        //     （sequencer.js:17080-17085）对 stretchTo 走 _applyDistanceScaling()，
        //     后者第一件事就是 `this._rotateTowards(ray)`（16992-16994），ray 正是
        //     源点→拉伸终点。而 EffectSection 的 _target 取值器（23184-23186
        //     `this._stretchTo || this._rotateTowards || this._moveTowards`）把
        //     stretchTo 排在前面，rotateTowards 给的那个位置根本进不了 data.target。
        //     于是它唯一的净效果是下面那条 pivot 副作用：_setAnchors（17022-17025）
        //     已按 stretchTo 把贴图 anchor 摆到起点，17027 再把容器 pivot 挪走 -w/2，
        //     而拉伸后 sprite.width ≈ 射线长度，整条光束因此沿射线前移半个自身长度。
        //  2. 瞄准点与锚点重合时不调。Ray(p, p) 的 angle 是 atan2(0,0)=0，转向本身
        //     是 no-op，剩下的仍然只有那半个身位的 pivot 位移。这条判据不是新发明：
        //     test/armory-travel.test.mjs 早就为 surge 写死了同一句话（"锚点已在
        //     施法者，再 aim 回施法者就是 atan2(0,0) 的退化旋转"），那条规则靠作者
        //     手动不写 aim 来规避；这里把它变成播放层的机制，不再依赖每条规则的
        //     作者都想起这件事。
        const rotates = !cue.stretchTo && !!atPoint && !!aimPoint && !samePoint(aimPoint, atPoint);
        if (rotates) {
          /*
           * 【模板锚点】`{template: true}` 把锚点的决定权交回给素材自己。
           *
           * `_setAnchors()`（sequencer.js:17021-17045）按 `rotateTowards.template` 分成
           * 两套完全不同的语义：
           *
           *   · **不带 template**（历史行为）：17022 的第一个 if 不进，贴图 anchor 留在
           *     (0.5,0.5)；17026 的 `rotateTowards && !template && !data.anchor` 把
           *     spriteContainer.pivot 摁到 (-w/2, 0)，语义是「特效从锚点朝目标方向长出去」。
           *     所以我们必须补一个显式 anchor(0.5,0.5) 走 17029 的 interpolate 分支
           *     （见下面那段），把 pivot 拉回中心——**整张贴图以自身中心绕锚点转**。
           *     近战挥砍在这套语义下，贴图中心压在锚点上，握把与刀锋落在哪全凭贴图内部
           *     构图，armory 只能靠 spriteOffset 去猜，而那个猜测是「格数 × 目标宽」，
           *     与素材的真实握把位置无关（施工清单 §0.3：刀锋恒落目标中心 +62.5px）。
           *
           *   · **带 template**（这里新开的分支）：17023-17025 把贴图 anchor.x 设成
           *     `template.startPoint / 贴图宽`——素材作者标定的**握把点**。于是「锚点」
           *     的含义从「贴图中心」变成「握把」，`atLocation(施法者)` 就真的是「刀握在
           *     施法者手里」，刀锋落在哪由 `endPoint` 与缩放决定，armory 里一个 0.375
           *     都不用写死（那类数字随素材包升级会变，本仓库禁止写进兵库）。
           *     且 17026 的 `!rotateTowards.template` 为假 → 走 else 的 interpolate 分支，
           *     pivot 由 `data.anchor?.x ?? 0.5` 决定 —— **默认就是中心**，所以这条分支
           *     必须**不调** e.anchor()：调了会把 y 一起摁死，且再也读不到 startPoint。
           *
           * gate 写成 `!!cue.template` 而不是无条件 true：模板是随素材包发布的元数据，
           * 拿不到（素材没标定、或走的是裸文件路径）时必须退回历史语义，否则 17024 的
           * `this.template.startPoint / textureWidth` 会在 this.template 为 null 时算出
           * undefined，anchor.x 落回 0 = 贴图左缘贴在锚点上，比历史行为更错。
           */
          const templateAnchored = !!cue.template;
          e.rotateTowards(towards, {
            rotationOffset: cue.aim.rotationOffset ?? 0,
            offset: cue.aim.offset,
            template: templateAnchored
          });
          rotatesWithTemplate = templateAnchored;
          // 转向必配 anchor：_setAnchors()（sequencer.js:17026-17028）在
          // `rotateTowards && !rotateTowards.template && !data.anchor` 时把
          // spriteContainer.pivot 设成 (-w/2, 0)，语义变成"特效从锚点朝目标方向长
          // 出去"。给一个显式的 {x:0.5,y:0.5} 就走 17029-17041 的 interpolate 分支
          // （interpolate(-w/2, w/2, 0.5) = 0），pivot 回到中心，特效以自身中心为轴
          // 转向。等价于 Sequencer 自己的 .center()（24217-24228，就是 anchor(0.5)），
          // 其文档原话即 "will override the anchor set by Aim Towards"。
          // 注意 anchor.x 给 0 会落回同一个 -w/2，不能用它来"抵消"。
          // 将来若真有一条 cue 要"从锚点长出去"那种语义，请显式加一个 opt-in 字段，
          // 不要靠删掉这一行。
          //
          // ⚠ **模板锚点分支下这一行必须不调**（判据同上，17026 的 `!template` 已为假、
          // pivot 本来就走 interpolate 的中心分支，不需要这一行来纠正）；调了反而有害：
          // `data.anchor` 一旦存在，17023 那句算出来的 `startPoint/贴图宽` 只影响
          // sprite.anchor，而 pivot 会按我们写死的 0.5 再偏一次，握把点被推回中心，
          // 整条「锚点=握把」的语义当场作废。
          if (!templateAnchored) e.anchor({x: 0.5, y: 0.5});
          if (cue.aim.missed) {
            warn(`cue 同时要求 rotateTowards 与 missed（规则 "${cue.rule}"，槽 "${cue.slot}"）：`
              + "rotateTowards 会给这条特效装上 data.target，_getOffset（sequencer.js:15360）"
              + "的判据 `missed && (!source || !data.target)` 于是不再把 missed 偏移加到"
              + "源点上，特效仍然正落在锚点、只有转向被打歪——画面上读起来还是命中");
          }
        } else if (cue.stretchTo && (cue.aim.rotationOffset ?? 0) !== 0) {
          warn(`cue 同时带 stretchTo 与非零 aim.rotationOffset（规则 "${cue.rule}"，`
            + `槽 "${cue.slot}"）：rotationOffset 只能经 rotateTowards 传给 Sequencer，`
            + "而带 stretchTo 时调 rotateTowards 会破坏拉伸锚点，这个偏移被丢弃");
        }
        // .missed() 与 rotateTowards 无关，任何情形下都单独调。没有 data.target 时
        // _getOffset（sequencer.js:15349-15365）的 `!source || !this.data.target` 让偏移
        // 直接加在源点上，calculate_missed_position 的 !target 分支正是"绕 token 随机
        // 方向撒出 1.5-2.5 个半身位"——这就是 DESIGN §3.2 要的"打偏了落在旁边"。
        if (cue.aim.missed) e.missed(true);
      }
      if (cue.stretchTo) e.stretchTo(cue.stretchTo);

      /*
       * 【素材两端留白的补偿】施工清单 §0.4 / §0.5。
       *
       * ## 病灶
       *
       * jb2a/eskie/blfx 的射线类贴图两端都留着一段透明画布（起手的蓄力段、落点的溅射
       * 段），素材包因此随文件发布一组 `[gridSize, startPoint, endPoint]`，Sequencer 用
       * 它把「贴图宽」折算成「有效射线宽」。本模组的 cue 下发的是**裸文件路径**（选材已
       * 在出手端摇定，见 CUE_DEFAULTS.template 注释），于是 Sequencer 走
       * `SequencerFileBase.make()`（sequencer.js:16221）造出一个没有 template 字段的
       * `SequencerFilePlain`，16224 的 `if (file.template)` 不进，`this._template` 停在
       * `data.template`（我们不给就是 null）。后果在 `_getDistanceScaling`
       * （16966-16984）：`startPoint/endPoint` 双双 `?? 0`，`widthWithPadding` 等于贴图
       * 全宽，**整张画布（含两端留白）被压进 source→target 的射线长度**——光束首尾各缩
       * 一截。实测 265 条 stretchTo cue 里 248 条中招，最轻 6.25%·d（eskie ray），
       * 最重 30%·d（jb2a line200B：4 格距离下尾端差 120px = 1.2 格）。
       *
       * ## 为什么 gate 在「这条 cue 真的会消费 template」上
       *
       * 模板只在两个地方被读：`_getDistanceScaling`（仅 stretchTo 分支，17081）与
       * `_setAnchors` 的 `rotateTowards.template` 分支（17022-17025）。落到既不拉伸、
       * 也不走模板锚点的 cue 上，它唯一还能碰到的是 `gridSizeDifference`
       * （15113-15115 `canvas.grid.size / (template?.gridSize ?? 100)`），那条路进
       * `_transformNoStretchSprite` 的最后一档 `sprite.scale.set(base * gridSizeDifference)`
       * ——**gridSize=200 的素材体积当场腰斩**。下面的 `.template()` 因此**不传 gridSize**
       * （双保险：即使 gate 判错，缺了 gridSize 也会 `?? 100` 落回默认、体积不变），
       * 同时仍然显式 gate，绝不把一个不消费它的字段递下去。
       *
       * ## ⚠ startPoint 的 0 会变成 NaN 锚点，整条特效不可见
       *
       * `EffectSection.template()`（24079-24108）三条赋值全是 `if (x) this._template[k] = x`
       * （24105-24107）——**0 被静默丢掉**。丢掉之后 `_setAnchors:17024` 的
       * `this.template.startPoint / textureWidth` **没有 `?? 0` 兜底**（同一个字段在
       * 16971 处有），算出 `undefined / 1000 = NaN` → `sprite.anchor.set(NaN, 0.5)`。
       * PIXI 7.4.3 的 `ObservablePoint.set(x2 = 0, y2 = x2)` 只兜 undefined、不兜 NaN，
       * NaN 锚点进 `Sprite.calculateVertices` 后 8 个 vertexData 全 NaN，**整条特效
       * 一个像素都不画**。今天不传 template 反而是安全的（this.template 为 null →
       * `void 0` → 默认参数兜成 0），**打了补丁才炸**——本仓库语料里 172 条 cue
       * （generic.travel 168 + strike.shape.area 4，占待修 248 条的 69.4%）的 startPoint
       * 正是 0。
       *
       * 两道防线：
       *   1. `Math.max(startPoint, 1)` —— 1px 的假前导留白。代价上界是本仓最小的
       *      widthWithPadding（line200B 的 1000−1−300 = 699）→ **0.143%·d**，eskie ray
       *      是 0.067%·d，像素上读不出来；
       *   2. **两端全 0 的模板整条跳过** —— cone [100,0,0] / gust_of_wind 这类素材本来
       *      就没有留白要补，给它们调 `.template()` 只有风险没有收益（还会撞上 24098
       *      那条「三项全空就 throw」）。
       *
       * ## 副作用（不是 bug，别退回不补偿）
       *
       * `scaleY` 默认跟着 `spriteScale` 走（16976），补偿后光束在变长的同时也变粗
       * `W/(W−s−e)`（ranged ×1.333、line200B ×1.431）。这正是 jb2a 自己的渲染结果。
       * 若实机觉得太粗，加 `scale: {x:1, y:(W−s−e)/W}` 只修长度，**不要**退回不补偿。
       */
      if (cue.template && (cue.stretchTo || rotatesWithTemplate)) {
        // 兵库两种写法都收：数组三元组（assets.mjs 从素材索引原样带下来的形态）
        // 与具名对象（手写覆盖时更可读）。geom-guard §1.6 的判据也是这两种。
        const t = Array.isArray(cue.template)
          ? {gridSize: cue.template[0], startPoint: cue.template[1], endPoint: cue.template[2]}
          : cue.template;
        const sp = Number(t?.startPoint);
        const ep = Number(t?.endPoint);
        if (!Number.isFinite(sp) || !Number.isFinite(ep)) {
          // 非数字会让 Sequencer 的 is_real_number 校验当场 throw（24086-24102），
          // 那条 throw 是构造期同步抛，会被下面的 catch 连整条 cue 一起丢掉。
          warn(`cue 的 template 不是可用的数值三元组（规则 "${cue.rule}"，槽 "${cue.slot}"）：`
            + `${JSON.stringify(cue.template)}；这条特效不做留白补偿，首尾会各缩一截`);
        } else if (sp > 0 || ep > 0) {
          e.template({startPoint: Math.max(sp, 1), endPoint: ep});
        }
      }

      // scaleToObject 是主流缩放方式；只有显式给了 scale 才用绝对缩放（锥形撑张角等）。
      //
      // stretchTo 下**必须**跳过 scaleToObject，这不是"绕开报错"而是删死代码：
      //   1. Sequencer 对这个组合直接 throw（sequencer.js:24917-24923 _expressWarnings），
      //      而抛点在 EffectSection.run()（25003）里，位于 Section._execute() 的
      //      `new Promise(async resolve => setTimeout(async …))`（21511-21536）executor
      //      内层——async 回调 reject 不会 reject 外层 Promise，resolve() 永不执行、
      //      Promise 永不 settle。Sequence.play() 对 shouldWaitUntilFinished 的 section
      //      是 `await section._execute()`（27772），而 `_waitAnyway`（21247-21249）让
      //      **最后一条 section 无论如何都会被 await**；末尾又是
      //      `Promise.allSettled(promises)`（27782）——整条计划后面的 cue 一条都播不到，
      //      playPlan() 永不返回，那条序列还永久留在 SequenceManager.RunningSequences 里。
      //   2. 即使没有那条 throw 也一样跳过：_transformSprite（17080-17085）是
      //      `if (stretchTo) _applyDistanceScaling(); if (!stretchTo) _transformNoStretchSprite();`,
      //      而 scaleToObject 只在 _transformNoStretchSprite → _applyScaleToObject
      //      （17114/17171）里被读，stretchTo 分支下它一行都不生效。
      // stretchTo 的尺寸改由距离缩放决定：长度恒等于 source→target 射线长
      //（scaleX = distance/widthWithPadding 再乘回 scale.x，16974/17014，scale.x 正好
      // 抵消），scale.y 只改粗细——锥形的 coneYScale 正是靠这条。
      /*
       * 【尺寸的三条互斥路】优先级 scale > sizePx > scaleToObject，理由各自独立：
       *
       *  · `cue.scale`（绝对缩放）是作者显式接管，最高。
       *
       *  · `cue.sizePx`（像素尺寸）走 `EffectSection.size()`（sequencer.js:23971，
       *    文档原话 "this size is set before any scaling"）。它是**区域类 cue 唯一
       *    正确的尺寸来源**：模板的大小写在 `plan.region` 上（半径/长度/宽度都是像素），
       *    与画布上任何一个 token 都没有关系，只有直接给像素才能跟着模板走。
       *    必须排在 scaleToObject 前面：`_transformNoStretchSprite`（17104-17148）是
       *    `if (scaleToObject) {…} else if (size) {…}`，两者同时下发时 size 是死代码。
       *
       *  · `scaleToObject`（按锚定对象的宽度缩放）留给「贴在某个 token 上」的 cue。
       *
       * ## ⚠ 裸点上禁用 scaleToObject（施工清单 §0.12）
       *
       * `_applyScaleToObject`（17171）读 `getSourceData()`（15245）→
       * `get_object_dimensions(positionSource)`（18122）。传进去的若是一个裸 `{x,y}`
       * （`cue.at.ref === "point"`，dispatch.mjs 原样返回坐标对象），18166-18167 那串
       * `??` 会一路落空到最后一档 **`canvas.grid.size`**——于是「按对象缩放」在裸点上
       * **恒等于「一格」**，与作者写的 objectScale 之外的一切都无关。
       *
       * 【2026-08-29 订正】这一段原先写的是「Crucible 用微网格 grid.size = 20px，
       * groundResidue 画成 26×26px，比 blast 区域直径 240px **小 9.2 倍**」——**单位串了一层**。
       * 20 是 `canvas.dimensions.distancePixels`（px/ft），不是 `canvas.grid.size`。
       * Crucible 的 `system.json` 是 `grid.distance = 5 ft`，所以 `grid.size = 5 × 20 = 100px`
       * （语料里 `origin.w / origin.width = 100/1` 也是这个数）。真实倍率是
       * **1.3×100 = 130px vs 240px，偏小 1.85 倍**，不是 9.2 倍。
       *
       * 结构性结论不受影响：这条路在裸点上**根本表达不了尺寸**，所以在播放层硬性拦掉——
       * 裸点 cue 要么给 sizePx、要么给 scale，不许再走 scaleToObject。
       *
       * ⚠ 但**拦掉之后不能不管**：丢弃缩放会落到「素材原生像素」那一档
       * （17143 的 `scale.set(baseScale × gridSizeDifference)`），groundResidue 的素材是
       * 600×600 ⇒ `600·G/100 = 6G`，而 blast 区域直径 2.4G ⇒ **偏大 2.5 倍**。
       * 那比原来的「恒等于一格」错得更远（1.85 倍 → 2.5 倍，而且方向更刺眼：
       * belowTokens、3 秒、每个 AoE 法术必出）。所以每一条被拦下的 cue 都必须在兵库侧
       * 补上 sizePx —— `aftermath.groundResidue` 已按 region 半径补好，见那条规则的注释。
       * 下面那条 warn 就是用来把「拦了但没补」当场喊出来的。
       */
      const bareAnchor = cue.at?.ref === "point";
      if (cue.scale) e.scale(cue.scale);
      else if (cue.sizePx) e.size({width: cue.sizePx.width, height: cue.sizePx.height});
      else if (!cue.stretchTo && !bareAnchor) e.scaleToObject(cue.objectScale);
      else if (!cue.stretchTo && bareAnchor && cue.objectScale !== 1) {
        warn(`cue 锚在裸点上却声明了 objectScale=${cue.objectScale}（规则 "${cue.rule}"，`
          + `槽 "${cue.slot}"）：scaleToObject 在裸 {x,y} 上恒等于"一格"`
          + `（sequencer.js:18166 的 ?? canvas.grid.size 兜底），表达不了区域大小。`
          + "这条缩放被丢弃，请改用 sizePx（按 region 半径/长度算像素）或 scale。");
      }

      if (cue.offset && (cue.offset.x || cue.offset.y)) {
        e.spriteOffset({x: cue.offset.x, y: cue.offset.y}, {gridUnits: cue.gridUnits});
      }
      if (cue.mirrorY) e.mirrorY(true);
      if (cue.randomizeMirrorY) e.randomizeMirrorY();
      // angle 是 resolve.mjs 的 freezeRandom() 在出手端摇定的固定角度（见其注释）——
      // 不用 .randomRotation()，那会让每个客户端各摇一次。
      if (cue.angle) e.rotate(cue.angle);
      if (cue.elevation !== null) e.elevation(cue.elevation, {absolute: true});
      applyTimeWindow(e, cue);
      if (cue.tint) e.tint(cue.tint);
      if (cue.filter) e.filter(cue.filter.type, cue.filter.data);
      if (cue.mask === "region") {
        const shape = regionMaskShape(plan.region);
        if (shape) e.mask(shape);
        else warn(`cue 声明 mask:"region" 但 plan.region 无法转换成有效形状（规则 "${cue.rule}"），`
          + "这条特效会不带遮罩播出，锥形/射线可能溢出模板边界");
      }

      if (cue.persist) {
        e.persist(true, {persistTokenPrototype: false});
        // 唯一会落盘的槽：cue.worldPersist 恒为 false（CUE_DEFAULTS 的槽级契约），
        // .temporary() 让 Sequencer 一条 flag 记录都不写，见 resolver/resolve.mjs 的
        // CUE_DEFAULTS.worldPersist 注释与 sequencer.js:11819 的落盘判据
        // （没有 !data.local 子句，.locally() 拦不住这个）。
        e.temporary(cue.worldPersist !== true);
        if (cue.tieTo) {
          e.tieToDocuments([cue.tieTo]);
          // 不用 e.name()：trigger/persist.mjs 的兜底清理按 origin 过滤
          // （Sequencer.EffectManager.endEffects({origin: effectUuid})），而
          // _filterEffects（11694-11703）的 name 与 origin 是 AND 关系——如果这里只设
          // name 不设 origin，effect.data.name 与 filter 的 origin 对不上，那条按 origin
          // 过滤的兜底清理一条都匹配不到。origin() 是 Sequencer 里专门承载"这个特效的
          // 来源标识"的字段，tieTo（即 effectUuid）就是这个标识本身。
          e.origin(cue.tieTo);
        }
        if (cue.extraEndDuration) e.extraEndDuration(cue.extraEndDuration);
      }
      if (cue.waitUntilFinished !== null) e.waitUntilFinished(cue.waitUntilFinished);
    } catch (err) {
      // 一条 cue 的构造期异常（例如某个字段组合触发了 Sequencer 的入参校验）不该
      // 拖垮整条计划——softFail:true 只覆盖 Sequencer 自己在 _execute/_initialize
      // 阶段的"文件找不到"类失败，不覆盖这里同步抛出的构造期错误。呼应
      // resolver/resolve.mjs 里 runBuild/firstMatch 的同一个哲学：单条规则出错只丢
      // 这一条，不带崩整条流水线。但"丢这一条"必须真的丢干净：section 在 seq.effect()
      // 返回之前就已经进了 seq.sections，光打日志不撤销那条半成品照播，见 dropSection。
      dropSection(seq, section);
      warn(`播放 cue 失败（规则 "${cue.rule}"，槽 "${cue.slot}"）`, err);
    }
  }

  // local:true 全槽通用（见 CUE_DEFAULTS.worldPersist 注释）：缺了它，preload:true 会走
  // Sequencer.Preloader.preloadForClients，本客户端向全场广播预载请求并阻塞等所有客户端
  // 应答（sequencer.js 的 Sequence.play() 逐字确认）。本模组的传输设计是"聊天卡广播计划 +
  // 各客户端本地播放"（随机选材已在出手端固化），从不把这条 Sequence 交给 Sequencer 自己
  // 的跨客户端 socket 通路去广播执行——那条通路需要的两个开关本文件都不出现。
  const playing = seq.play({local: true, preload: true});

  // 带 persist cue 的计划**永远不会**"播完"，所以绝不能 await 它（Critical-2）：
  //   · `EffectSection.run()`（sequencer.js:25008-25013）对 `this._persist` 走
  //     `totalDuration += await canvasEffectData.promise`（非持久走 `.duration`）；
  //   · 那个 promise 是 `CanvasEffect.play()` 的 finishPromise（15463-15476），只有
  //     `endEffect()` 里的 `this._resolve?.(this.data)`（15479-15485）能兑现它，而
  //     `PersistentCanvasEffect`（17784）把 `_setEndTimeout()`（17801-17808）换成了"只暂停
  //     媒体、不 resolve"（基类 17669-17673 会 resolve）——持久特效不存在自然结束，
  //     只有状态被移除才结束；
  //   · `Sequence.play()` 末尾是 `Promise.allSettled(promises)`（27782），promises 里
  //     含**每一条** section 的 `_execute()`，所以持久 section 排第几都一样挂；本仓库
  //     45 条 persist 计划又恰好各只有 1 条 cue，`_waitAnyway`（21247-21249）让它作为
  //     最后一条 section 被 `promises.push(await section._execute())`（27771-27772）
  //     直接 await，连后面的 cue 都轮不到。
  // 于是 `await seq.play()` 会一直挂到状态消失（实测：15 秒信号量超时每次必响，整条
  // 动画队列被顶死）。判据用静态的 `cue.persist` 而不是"实际建成的 section"：这是一个
  // **过近似**——playIf 为假、或构造期异常被 dropSection 撤下的 persist cue 其实不会挂，
  // 但那时提前返回也只是少等一条零长序列，没有任何代价；反方向的误判（该等的没等）
  // 则不可能发生。
  if (plan.cues.some(cue => cue.persist === true)) {
    // 不 await，但必须接住 rejection：preload 失败 / 构造期抛错在这条路径上没有别的
    // 接管者，漏了就是每个客户端一条无来源的 unhandled rejection。
    playing.catch(err => warn(`持久特效序列失败（计划 "${plan.source}"）`, err));
    return;
  }
  await playing;
}
