/**
 * S4 aftermath：结算后，锚在目标或地面。规则选择是**整个动作一次**（与 travel/impact
 * 一样，见 resolver/resolve.mjs 的 firstMatch），选中的规则再对每个目标各调一次
 * build（除非 once:true）——因此 when() 判的是「这个动作要不要走这条规则」，
 * build() 里仍要对每个目标单独判「这个目标要不要出内容」，返回 null 即可跳过。
 */

// 只取 hueDelta 这一个纯函数（给下面的符文分支算色相补偿量）。配色表本身仍由 ctx 那一路
// 取——兵库不直接读 RUNE_COLOR/DAMAGE_COLOR，那两张表的读取口径在 resolver/context.mjs 上
// （与 travel.mjs 的同一条纪律）。
import {hueDelta} from "../resolver/palette.mjs";

/** 与 travel.mjs / impact.mjs 的 r6 同源：抹掉浮点尘埃，保持 cue 里的数字干净。 */
const r6 = v => Math.round(v * 1e6) / 1e6;

/**
 * 士气冲击环的符文分支表。
 *
 * ## 为什么要显式写死，而不是交给 `pickColor` 的最近色
 *
 * 与 `impact.mjs` 结果层同一条纪律：**这一层承担的是结构性判断**（「哪个符文打的士气」），
 * 不能让最近色在运行时静默把两个符文并到同一支上。实测四个打士气的符文在
 * `eskie.pulse.energy.01` 的 6 支（blue 215 / green 120 / orange 30 / purple 275 /
 * red 0 / yellow 55）上跑 `pickColor`：
 *
 *   · control  `bluepurple` 250 → purple Δ25（blue Δ35）
 *   · oblivion `dark_purple` 285 → purple Δ10
 *   · illusion `pink` 320 → red Δ40（purple Δ45）
 *   · soul     `teal` 165 → green Δ45（blue Δ50）
 *
 * **control 与 oblivion 会撞在同一支 purple 上**（52 个动作里 26 个共用一个文件）。
 * 撞车时按「主张强弱」判：`dark_purple` 距 purple 只有 10°，`bluepurple` 距 purple 25°、
 * 距 blue 35°——purple 归主张更强的 oblivion，control 退回它自己名字里的**另一半** blue。
 * 这不是随手挑一个颜色，是「双色名符文让出被人独占的那一半」这条可复述的判据。
 *
 * 让出之后仍然不丢符文身份：下面用 `hueDelta(分支, 符文色)` 把差额补进 ColorMatrix，
 * control 的蓝环会被旋 +35° 回到蓝紫。四个符文因此是**四个不同文件 + 四个正确色相**。
 *
 * ⚠ 表里只有这四个键，因为 Crucible 打士气的符文只有这四个
 * （`usage.resource === "morale"`，全语料 68 条全部落在 control/illusion/oblivion/soul）。
 * 非法术的士气动作（快照里 `spell === null`）查不到键，走下面的 `?? want ?? 兜底`，
 * 由 `pickColor` 按伤害类型色取最近支——那条路不需要正交性，只需要不出错。
 */
const MORALE_PULSE = "eskie.pulse.energy.01";
const MORALE_BRANCH = Object.freeze({
  control: "blue",
  illusion: "red",
  oblivion: "purple",
  soul: "green"
});
/**
 * 既没有符文也没有伤害类型时的落点。取 purple 而不是素材树的第一支（blue）：
 * 紫是这一层被改造前唯一的颜色（`MarkerFear_01_Dark_Purple`），无依据时保持旧观感，
 * 而不是让 `getPathsUnder` 的 key 序替我们挑一个。
 */
const MORALE_FALLBACK = "purple";

/**
 * 区域残留的落点：cone 取轴线中点（覆盖锥形footprint 的中段），circle（blast）取
 * 区域圆心本身。与 travel.mjs 的 templateAnchor/templateEnd 同一套坐标约定
 * （region.rotation 度，从 +x 正东起、朝 +y 为正）。
 *
 * ref 用 "point"（理由与 travel.mjs 的 templateAnchor 完全相同）：这是一个冻结的区域
 * 坐标，不是「施法者」这个身份，播放层不得把它升格成施法者 token 的中心。
 */
function residueAnchor(s) {
  const r = s.region;
  if (!r) return null;
  if (r.type === "circle" && Number.isFinite(r.x) && Number.isFinite(r.y)) {
    return {ref: "point", x: r.x, y: r.y};
  }
  if (r.type === "cone" && Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.radius)) {
    const rot = (r.rotation ?? 0) * (Math.PI / 180);
    const mid = r.radius / 2;
    return {ref: "point", x: r6(r.x + Math.cos(rot) * mid), y: r6(r.y + Math.sin(rot) * mid)};
  }
  return null;
}

export default [
  // ---- 高优先级规则加在这里（Task 12） ----

  /**
   * 治疗辉光——每个被治疗的目标各来一份，pri 420。
   *
   * jb2a.healing_generic.400px.green：Task 7 用过的 `...burst` 配色是失效的
   * （burst/loop 两支的颜色词是 bluewhite/greenorange 这类复合词，不在 COLOR_HUE 表里，
   * pickColor 会把它们过滤掉，固定出蓝白色兜底——见 test/armory-assets.test.mjs 的
   * LEGACY_UNVERIFIED）。400px 与 200px 两支才是纯单色词 blue/green/purple/red/yellow，
   * ASSET-NOTES 已验证：51 帧 @30fps=1700ms，f0 空，内容是十字星花粒子簇 + 一圈细光环
   * （不是原备注说的实心块），空尾从 f40 起，建议 endTime 截到约 1333ms。中心 100x100
   * 在 f10/f20 的 alpha 均值 216/174，「需要时压 opacity 到 0.6-0.7」——取 0.7。
   * fadeIn:0：素材自己从空到峰值天然渐强（f0 空、f10 才到 216/255），再叠一层淡入是
   * 重复处理同一件事；fadeOut:200 只在裁点前收个尾（f32 已只剩 11/255，纯保险）。
   */
  {
    id: "aftermath.healing", pri: 420,
    when: s => (s.targets ?? []).some(t => t.healed > 0),
    build: (s, ctx, target) => {
      if (!(target?.healed > 0)) return null;
      const fx = ctx.pick("jb2a.healing_generic.400px.green");
      if (!fx) return null;
      return {
        file: fx.file, objectScale: 1, attachTo: true, bindScale: true,
        opacity: 0.7, zIndex: 70, elevation: target.elevation,
        duration: 1333, fadeIn: 0, fadeOut: 200
      };
    }
  },

  /**
   * 【击杀规则已迁出本槽，见 armory/death.mjs 的 `death.kill`（Task 15b）】
   *
   * 原来这里有一条 `aftermath.kill`，判据是 `target.effects.includes("dead")`——它在
   * 实战中**永远不命中**：`target.effects` 来自动作自带的 `ev.effects`，而 `dead` 是
   * Crucible 在资源结算后单独 `toggleStatusEffect("dead", …)` 打上的
   * （documents/actor.mjs:2926）；何况 `configureVFXEffect()` 是在 `_prepareMessage()`
   * 里跑的（models/action.mjs:3286），比 `confirm()` 的 `#applyEvents()`（:2670）早得多，
   * 建计划那一刻伤害根本还没结算。完整依据与新通道写在 armory/death.mjs 的文件头。
   *
   * **不要在本槽里重新加任何按「目标死没死」判断的规则**：S4 是动作时间轴上的一段，
   * 拿到的快照冻结于建卡时刻，那一刻的死亡信息不存在。
   */

  /**
   * 士气变化——`usage.resource === "morale"` 的动作，pri 380（低于治疗：一个同时打
   * 士气又救人的动作，应该优先读出「谁被救了」而不是士气本身；「谁死了」不在本槽，
   * 见上面那条迁出说明）。
   * 落到这条规则的实际是纯粹的士气打击（rally 类回复士气的动作会先被 pri 420 的
   * 治疗规则接管，这里只服务「士气被削」那一半），逐目标看 `target.damage` 是否
   * 非空来判断这个目标是否真的挨了这一下（多目标动作里有人没中就不该出特效）。
   *
   * ## 【批次 E】从「一张紫脸管 52 个动作」拆成两档 × 四色
   *
   * 改造前这条规则对**全部 52 个动作、104 个目标**恒定产出同一个文件
   * `MarkerFear_01_Dark_Purple`——全仓「一层一素材」里仅次于 impact 结果层的第二个大桶。
   * 拆的依据是快照里真实存在、且真会变的两件事：
   *
   *   · **符文**（`s.spell.rune`，四选一）——「谁打的这一下」，见 MORALE_BRANCH；
   *   · **暴不暴击**（`target.results[0].critical`）——「打到什么程度」，档次差本身。
   *
   * 伤害量与结果码**没有**参与：本语料 104 个目标的 `damage.total` 恒为 8、`result` 恒为 7，
   * 按它们分档在实机上分不出任何东西，属于「为了填满而乱配」。暴击这一档在 actions.json
   * 里同样一次都不触发（全语料零暴击），但它在 edge-cases.json 里有真语料
   * （`edge.crit.HIT.*`），且判据与画面侧 `impact.mjs:907` 的 `t.results?.[0]` 同源——
   * 不是我在这里现编一个信号。
   *
   * ## 常规档：符文色的一次性冲击环
   *
   * `eskie.pulse.energy.01.<符文支>`：ASSET-NOTES 记「减益上身的一次性同心冲击环」，
   * 23 帧 @29.97fps = 767ms。**它天生就是一次性素材**，这正是换掉 marker 的第一个理由：
   * marker 那一族是 145 帧无 intro/outro 的**循环**贴图（同一条记录原话「当一次性余波闪光
   * 用会啪地出现再啪地消失，必须自己给 fadeIn/fadeOut」）——把循环素材当闪光用，
   * 300/500ms 的淡变有一半是在给素材擦屁股。
   *
   * 逐项对上量测（`data/asset-profiles.json` + `clip-table` 的 `[23,29.97,11..12,3,0]`）：
   *   · `tailEmpty: 3` ⇒ 有内容的是 f0-f19 ⇒ **duration 667**（20÷29.97）。播满 767 是白等 3 帧。
   *   · `leadEmpty: 0` + 记录里「帧 0 就已经有一圈可见的环（aMax 255），没有淡入，起手很硬」
   *     ⇒ **fadeIn 100**（约 3 帧），只抹掉那一下硬弹出，不动 f11/f12 的峰。
   *   · 记录里「帧 14-19 碎成弧段消散」⇒ 尾巴素材自己会散，**fadeOut 150** 只防 667 那一刀硬切，
   *     不需要 marker 那种 500ms 的长尾。
   *   · `contentRatio` 0.935（marker 是 0.83）⇒ 同为 objectScale 1 时可见跨度从 0.83 格涨到
   *     0.935 格，**+13%**。这是有意的：一记「炸开」本就该比一枚「标记」铺得开一点；
   *     记录里也写明「800x800 画幅四周留边 17-20px、始终是完整闭合圆」，放到一格不会被切平。
   * opacity 0.85 与 zIndex 65 原样保留——换素材这一件事不顺便改观感权重。
   *
   * ## 暴击档：**加**一枚恐惧烙印，而不是换一个素材
   *
   * 暴击时在冲击环之后 200ms 补一条 `jb2a.markers.fear.dark_purple.01`，参数
   * （1000/300/500、opacity 0.85）**逐字保留**改造前那条 cue——那组数是按 marker 的
   * 循环特性调过的，不重新拍。语义上正好各归其位：冲击环读「这一下打中了」，
   * 恐惧标记读「意志被打崩之后留下的印子」，而 ASSET-NOTES 给这个文件的原话就是
   * 「士气下降/恐惧标记…适合 Crucible 那 4 个打士气的符文」。档次差因此是**叠加**：
   * 暴击严格比普通命中多一层，不是换一张图。
   *
   * ⚠ **烙印这一层刻意不加色轴。** 它读的是「结果」（意志崩了）不是「谁打的」——符文身份
   * 已经由同一刻的冲击环给出了。技术上的理由更硬：`jb2a.markers.fear` 的 5 支是
   * dark_purple + 4 支暖色（dark_orange 25 / orange 30 / red 0 / dark_red 355，**色相总跨度
   * 只有 35°**），拿它做四符文正交只会得到「四个文件长得一模一样」；而给它套 hue 旋转
   * 会把紫环转成青环，撞上 persist 槽的 `stun.dark_teal`。ASSET-NOTES 的 marker 撞色那一节
   * （persist 12 组里紫只留 fear 一个、skull 靠 tint 才拉开 3.1 的 ΔE00）说明这一族的
   * 配色余量已经被 persist 用尽——本槽不再往里挤。保持 dark_purple 原样，就不新增撞色。
   */
  {
    id: "aftermath.morale", pri: 380,
    when: s => s.usage?.resource === "morale",
    build: (s, ctx, target) => {
      if (!target?.damage) return null;

      // 想要的符文色（`ctx.runeColor()`）与实际要写进路径的分支（MORALE_BRANCH）是两件事：
      // 前者决定色相补偿量，后者决定拿哪个文件。四个打士气的符文查得到分支，走显式表；
      // 非法术的士气动作退回伤害类型色、再退回 purple，由 pickColor 取最近支。
      const want = ctx.runeColor() ?? ctx.damageColor() ?? null;
      const branch = MORALE_BRANCH[s.spell?.rune] ?? null;
      const fx = ctx.pick(MORALE_PULSE, {color: branch ?? want ?? MORALE_FALLBACK});
      if (!fx) return null;
      // 走显式分支时 pickColor 是精确命中（fx.hue 恒 0），补偿量得自己算；
      // 走兜底时 fx.hue 已经是 pickColor 算好的最近色差额，直接用。
      const hue = branch && want ? hueDelta(branch, want) : fx.hue;
      const out = [{
        file: fx.file, objectScale: 1, attachTo: true, bindScale: true,
        opacity: 0.85, zIndex: 65, elevation: target.elevation,
        filter: hue ? {type: "ColorMatrix", data: {hue}} : null,
        duration: 667, fadeIn: 100, fadeOut: 150
      }];

      // 与 impact.mjs:907 同源的取法：只看第一掷，缺则按「命中且非暴击」处理。
      const hit = target.results?.[0] ?? {critical: false};
      if (hit.critical === true) {
        const mark = ctx.pick("jb2a.markers.fear.dark_purple.01");
        // 烙印取不到不影响冲击环——少一层比整条哑掉好。
        if (mark) out.push({
          file: mark.file, objectScale: 1, attachTo: true, bindScale: true,
          opacity: 0.85, zIndex: 66, elevation: target.elevation,
          // 200ms：让两层读成「炸开——然后留下印子」而不是同帧糊成一团。取值与冲击环的
          // 峰值帧对齐（f11/f12 ≈ 380ms 之前落下，仍在环还亮着的时候压上去）。
          delay: 200, duration: 1000, fadeIn: 300, fadeOut: 500
        });
      }
      return out;
    }
  },

  /**
   * 地面残留——法术 blast/cone 命中后留下的地裂痕迹，pri 300，once:true（一片区域
   * 一份焦痕，不是每个目标脚下各来一块；见 task-12-brief.md 的交接说明）。触发条件
   * 用真实几何而非笼统的 target.type：fixture 里 `target.type==="blast"` 同时有
   * `region.type==="circle"`（真正的圆形爆发范围）与 `region:null`（近战多目标群击，
   * 没有落地范围可言）两种，只有前者该出地裂；cone 一律有 `region.type==="cone"`。
   * aura/pulse 即便也带 circle 区域，语义是持续光环/扩散波而非一次性爆发，不在
   * 「blast/cone 后的焦痕」范围内，故意不收。
   *
   * jb2a.impact.ground_crack.still_frame.01：ASSET-NOTES 明确推荐「天然适合当
   * persist 的地裂残留贴图（blast/cone 之后铺地）」——1 帧 .webp 静帧，600x600，
   * 放射状裂纹，中心在锚点。「透明区 RGB 也是 (0,0,0)（不是查看器让人以为的白块），
   * 贴在深色地板上几乎看不见，必须配浅色地面或叠亮色」——已知限制，本轮没有可以
   * 变亮的手段（ColorMatrix 的 hue 旋转对纯黑没有效果），记录在案；objectScale 放大
   * 到 1.3 至少扩大可见面积。单帧「没有任何淡入淡出，必须靠 fadeIn/fadeOut 参数
   * 托住」——fadeIn:200 软出场，duration:3000 让裂纹留存几秒（一次战斗回合的量级），
   * fadeOut:800 长尾淡出。belowTokens:true：地面痕迹压在 token 之下。
   *
   * 曾考虑 `blfx.spell.template.circle.explosion1.fireball1.ground.burn.orange`
   * （名字更贴合「焦痕」），但 ASSET-NOTES 订正后明确否掉了它当残留用：前 40+ 帧是
   * 铺满画幅的卡通爆炸本体（会和 impact 层双爆，需要 startTime 跳过一半时长），跳过
   * 之后剩下的「焦痕」段实测是「一坨近黑的放射状烟渣…光靠 persist 冻帧只会留一坨
   * 黑斑」，不比 ground_crack 更可靠，故未采用。
   */
  {
    id: "aftermath.groundResidue", pri: 300, once: true,
    when: s => s.region?.type === "cone"
      || (s.target?.type === "blast" && s.region?.type === "circle"),
    build: (s, ctx) => {
      const at = residueAnchor(s);
      if (!at) return null;
      const fx = ctx.pick("jb2a.impact.ground_crack.still_frame.01");
      if (!fx) return null;
      // 尺寸按**模板半径**给像素，不能走 objectScale。
      //
      // 这条 cue 锚在裸 {x,y}（residueAnchor 的 `ref: "point"`），而 `scaleToObject` 在裸点上
      // 恒等于「一格」（`_applyScaleToObject` → `get_object_dimensions` 的 `?? canvas.grid.size`
      // 兜底，sequencer.js:18166），跟区域多大完全无关——播放层已经把这条路硬性拦掉了。
      //
      // ⚠ 拦掉之后**必须自己给尺寸**，否则落到「素材原生像素」那一档
      // （`sprite.scale.set(baseScale × gridSizeDifference)`，17143）：本素材 600×600，
      // 而 blast 区域直径只有 2·radius = 240px（半径 120），会画成 2.5 倍大。
      // 那比原来的「恒等于一格」错得更远——原来是偏小 1.85 倍，改完变成偏大 2.5 倍。
      //
      // 残留要盖住的是**受影响的地面**：圆形取直径，锥形取半径（锚点已经挪到轴线中点，
      // 铺满整个锥长会溢出到锥外）。1.3 这个老系数的意图（「比区域略大一圈」）保留成 1.15，
      // 但现在乘的是区域尺寸而不是一格。
      const r = s.region;
      const span = r?.type === "circle" ? r.radius * 2
                 : r?.type === "cone" ? r.radius
                 : null;
      const size = Number.isFinite(span) && span > 0 ? Math.round(span * 1.15) : null;
      return {
        file: fx.file, at, belowTokens: true, zIndex: 5,
        ...(size ? {sizePx: {width: size, height: size}} : {objectScale: 1.3}),
        duration: 3000, fadeIn: 200, fadeOut: 800
      };
    }
  },

  /**
   * 终极兜底：pri 10、when 恒真，架构上与其它槽保持同一层级结构（见
   * DESIGN.md §6.4「0-99 终极兜底」），但 aftermath 本身允许「这个动作没有 S4 内容」
   * 这个合法结果（不像 cast/travel/impact 需要保证 100% 覆盖率，见
   * test/coverage.test.mjs 里没有逐动作强制 aftermath 出内容的断言）。上面三条 pri
   * 420/380/300 的规则已经覆盖了当前设计要处理的全部 S4 场景（治疗/士气/地面残留；
   * 击杀走 armory/death.mjs 的一次性通道），因此这里恒返回 null，不再引用任何素材
   * 路径——原先占位用的 `jb2a.healing_generic.burst`（ASSET-NOTES 验证失效，见
   * test/armory-assets.test.mjs 的 LEGACY_UNVERIFIED）已随之整条移除。
   */
  {
    id: "generic.aftermath", pri: 10,
    when: () => true,
    build: () => null
  }
];
