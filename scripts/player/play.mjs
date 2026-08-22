import {PLAN_VERSION} from "../const.mjs";
import {debug, warn} from "../log.mjs";

const DEG = Math.PI / 180;

/**
 * playIf 的完整词汇表：8 种攻击结果（与 RESULT_NAME 一一对应）+ "critical" + 两个聚合值
 * （"hitOrGlance"、"defended"）+ "always"。见 resolver/resolve.mjs 的 CUE_DEFAULTS 与
 * docs/DESIGN.md §6.2。
 *
 * V1 的兵库规则只产出 "always" 与 8 种结果名两类（逐条 grep 过 scripts/armory/*.mjs
 * 确认），"critical"/"hitOrGlance"/"defended" 目前没有任何规则使用——但 cue 在 resolve()
 * 阶段已经是针对**已发生的真实结果**构造出来的（impact.mjs 的 playIf 直接取自
 * `RESULT_NAME[hit.result]`，与该 cue 的 file/at/aim 出自同一次判定），所以这里不需要、
 * 也没有材料去反过来验证"这个结果是不是真的发生了"——真正的核验发生在 resolve()，
 * 播放层拿到的 cue 本身就是判定结果。playIf 字段真正的用途是：
 *   1. 保持"序列结构恒定"（brief 的设计意图）：始终构造同一套 Sequencer 调用链，只是
 *      用 .playIf() 给一个布尔量，而不是用 if/continue 在 JS 里改变链的形状，方便在
 *      Sequencer Manager UI 里逐条比对。
 *   2. 数据完整性校验：cue.playIf 不在这张词表里，说明规则表写错了字（或者未来一个
 *      新增取值没有同步更新这里），此时保守地按"不播放"处理并留痕，而不是让 Sequencer
 *      对一个陌生字符串做未定义行为。
 */
const PLAY_IF_VALUES = new Set([
  "always", "hit", "glance", "armor", "block", "parry", "resist", "dodge", "miss",
  "critical", "hitOrGlance", "defended"
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
 * 这不是错误，触发层已经在自己那一侧记过日志（trigger/*.mjs 拿到 null 的时候比播放层
 * 更清楚"为什么没有内容"——是没匹配到规则、没有目标、还是 effectUuid 缺失被 keepTied
 * 拦下——播放层这里只知道"我收到了 null"，重复记一遍等于噪音不等于信息。真正需要在
 * 这一层补一行日志的，是版本不符（下面那条 warn）：那是播放层独有的判断，trigger 层
 * 看不到 PLAN_VERSION 对不对。
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
    try {
      const target = resolveRef(cue.at);
      if (!target) continue;

      if (cue.kind === "sound") {
        const s = seq.sound()
          .playIf(shouldPlay(cue))
          .file(cue.file)
          .volume((cue.volume ?? 1) * volume)
          .delay(cue.delay)
          .startTime(cue.startTime)
          .locally(cue.local);
        // duration/waitUntilFinished 是 Section 基类共有的方法，Sound 与 Effect 一样
        // 支持——strike.ranged.draw 那条起手音效就靠 duration:800 把烘焙在音频里的
        // "箭到"尾音截掉（见 armory/travel.mjs 的注释）。
        if (cue.duration !== null) s.duration(cue.duration);
        if (cue.waitUntilFinished !== null) s.waitUntilFinished(cue.waitUntilFinished);
        continue;
      }

      if (cue.kind === "shake") {
        // 只抖目标 sprite 的副本（copySprite），不震全屏——全屏震动会让其他玩家不适。
        // copySprite 要求一个真正的 Token/Tile placeable；resolveRef 在目标 token 已经
        // 从画面消失时会退化成裸 {x,y}（见 resolver/resolve.mjs 关于 uuid 锚点路径从未
        // 被测试行使过的说明），那种情况下没有 sprite 可复制，只能跳过这条 cue。
        if (!isPlaceable(target)) continue;
        seq.effect()
          .playIf(shake && shouldPlay(cue))
          .copySprite(target)
          .zIndex(0)
          .delay(cue.delay)
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

      const e = seq.effect()
        .playIf(shouldPlay(cue))
        .file(cue.file)
        .opacity(cue.opacity)
        .fadeIn(cue.fadeIn, {ease: cue.fadeInEase})
        .fadeOut(cue.fadeOut, {ease: cue.fadeOutEase})
        .zIndex(cue.zIndex)
        .delay(cue.delay)
        .startTime(cue.startTime)
        .playbackRate(cue.playbackRate)
        .belowTokens(cue.belowTokens)
        .locally(cue.local);

      if (cue.attachTo) {
        // attachTo 需要一个真正可跟随的 placeable；同上，resolveRef 的裸点兜底路径下
        // 没有可附着的对象，与其让 Sequencer 在构造期对一个 {x,y} 抛错炸掉本条 cue 之后
        // 的整条链，不如直接跳过这一条、留其余 cue 继续播。
        if (!isPlaceable(target)) continue;
        e.attachTo(target, {bindScale: cue.bindScale});
      } else {
        e.atLocation(target, {gridUnits: cue.gridUnits});
      }

      if (cue.aim) {
        const towards = resolveRef({ref: "point", ...cue.aim.towards}) ?? cue.aim.towards;
        e.rotateTowards(towards, {
          rotationOffset: cue.aim.rotationOffset ?? 0,
          offset: cue.aim.offset
        });
        if (cue.aim.missed) e.missed(true);
      }
      if (cue.stretchTo) e.stretchTo(cue.stretchTo);

      // scaleToObject 是主流缩放方式；只有显式给了 scale 才用绝对缩放（锥形撑张角等）
      if (cue.scale) e.scale(cue.scale);
      else e.scaleToObject(cue.objectScale);

      if (cue.offset && (cue.offset.x || cue.offset.y)) {
        e.spriteOffset({x: cue.offset.x, y: cue.offset.y}, {gridUnits: cue.gridUnits});
      }
      if (cue.mirrorY) e.mirrorY(true);
      if (cue.randomizeMirrorY) e.randomizeMirrorY();
      if (cue.randomRotation) e.randomRotation();
      if (cue.elevation !== null) e.elevation(cue.elevation, {absolute: true});
      if (cue.duration !== null) e.duration(cue.duration);
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
          // _filterEffects 的 name 与 origin 是 AND 关系——如果这里只设 name 不设
          // origin，effect.data.origin 永远是 null，那条按 origin 过滤的兜底清理
          // 一条都匹配不到。origin() 是 Sequencer 里专门承载"这个特效的来源标识"的
          // 字段，tieTo（即 effectUuid）就是这个标识本身。
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
      // 这一条，不带崩整条流水线。
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
