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
 * 锥形用 armory/travel.mjs 的同一套模型：Crucible 的 cone 是"扁三角"（flat cone，非
 * round fan）——射线在 ±angle/2 方向、reach = radius / cos(angle/2)，这样两条边的连线
 * （底边）中点正好落在距锥尖 `radius` 处、半宽 `radius * tan(angle/2)`，与
 * travel.mjs 的 templateEnd()/coneYScale() 用的是同一个换算，两处必须保持一致。
 * 角度钳制到 [1°,179°] 防止 tan(90°) 炸出 Infinity（与 coneYScale 同一防线，这里独立
 * 复算一次，因为 mask 用的是原始 region.angle，不是贴图拉伸后的 scale.y）。
 */
function regionMaskShape(region) {
  if (!region) return null;
  if (region.type === "circle" && Number.isFinite(region.radius)) {
    return new PIXI.Circle(region.x, region.y, region.radius);
  }
  if (region.type === "cone" && Number.isFinite(region.radius)) {
    const rot = (region.rotation ?? 0) * DEG;
    const angle = Math.min(Math.max(Number(region.angle ?? 60) || 60, 1), 179);
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
 * @param {FXPlan|null} plan
 * @param {{volume: number, shake: boolean, resolveRef: (at: object) => any}} opts
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
          e.rotateTowards(towards, {
            rotationOffset: cue.aim.rotationOffset ?? 0,
            offset: cue.aim.offset
          });
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
          e.anchor({x: 0.5, y: 0.5});
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
      if (cue.scale) e.scale(cue.scale);
      else if (!cue.stretchTo) e.scaleToObject(cue.objectScale);

      if (cue.offset && (cue.offset.x || cue.offset.y)) {
        e.spriteOffset({x: cue.offset.x, y: cue.offset.y}, {gridUnits: cue.gridUnits});
      }
      if (cue.mirrorY) e.mirrorY(true);
      if (cue.randomizeMirrorY) e.randomizeMirrorY();
      if (cue.randomRotation) e.randomRotation();
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
  await seq.play({local: true, preload: true});
}
