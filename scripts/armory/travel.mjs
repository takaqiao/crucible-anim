/**
 * S2 travel：施法者 → 目标。承载 §8.2 的三条几何修正——贴身/隔格换素材、
 * 大体型补偿、镜像朝向——全部集中在 strike.melee 一条规则里。
 *
 * ft 档位说明（移交自 Task 9，见 task-10-brief.md）：本槽用到的 ranged/thrown/
 * spell-arrow 素材在 ASSET-NOTES 里都带 `.<color>.<ft>` 结构（jb2a.ranged.beam.001.01、
 * jb2a.ranged.01.projectile.01、eskie.attack.ranged.arrow.ray、blfx…dagger1.throw1），
 * 且每一家都只有单一 ft 层被实际抽帧看过（多为 30ft，个别 05ft）——data/asset-index.json
 * 里同一家其余 ft 分支（05/15/60/90ft）确实存在，但从未验证过时序。ctx.pick() 的
 * {color} 只能把颜色段拼在 dbPath 末尾，没法再在颜色之后追加一层 ft；实测过
 * （见 task-10-report.md）如果只传颜色段而不带 ft，bestFit 会静默落到该颜色下
 * 字典序最先的那个 ft（往往是 05ft/15ft），既不是 30ft，也不会置位 diverged——
 * 正是 ASSET-NOTES 反复强调的“ft 用错就没有命中音/时序错位”那个坑的视觉版本。
 * 因此这几条规则一律把 ft 与颜色一起写死成 ASSET-NOTES 实测过的那一支（放弃跟随
 * 符文色），用精确路径而不是 {color} 动态拼接，防止的问题比因此损失的染色能力更大。
 * 真正按 `s.target.distance` 做多档 ft 选择，需要先把 05/15/60/90ft 逐档抽帧核实
 * 时序（新一轮素材侦察），不在本任务范围内。
 */
export default [
  // ---- 高优先级规则加在这里（Task 10） ----

  /**
   * 射线：连续光束贴合 line 模板，必须用模板遮罩防止溢出墙外。
   *
   * jb2a.ranged.beam.001.01.blue.30ft 91 帧 @30fps=3033ms。ASSET-NOTES 实测
   * f0-9 全空（333ms）——startTime 跳过；两端真正连通是 f36-73（1200-2433ms），
   * f74 起立刻断开进入 17 帧死尾（567ms），duration 按 startTime 之后的播放时长
   * 算：2433-333=2100，裁掉死尾。自带蓝白星爆命中在 f37（连通后 1 帧），落在
   * 目标端——与 impact 层再叠命中闪光会双闪，已记入报告转交 Task 11。
   * template=[200,200,200] 非空，确认可 stretchTo。
   */
  {
    id: "spell.gesture.ray", pri: 780,
    when: s => s.spell?.gesture === "ray" && s.region?.type === "line",
    build: (s, ctx, target) => {
      const fx = ctx.pick("jb2a.ranged.beam.001.01.blue.30ft");
      if (!fx) return null;
      return {
        file: fx.file,
        stretchTo: {x: target.x, y: target.y},
        mask: "region",
        objectScale: 1, zIndex: 90,
        startTime: 333, duration: 2100,
        waitUntilFinished: -300
      };
    }
  },

  /**
   * 锥形：stretchTo 定长度，scale.y 撑张角，同样要遮罩。
   *
   * jb2a.breath_weapons.fire.cone 的颜色分支（blue/green/orange/purple/yellow）
   * 未被 ASSET-NOTES 文末列为帧数不一致的家族，且 01/02 两个变体号实测都是同一条
   * 30ft 时间轴（用 Fire01/Fire02 两版画法而非不同 ft），可以放心跟 {color:runeColor()}。
   * 254 帧 @30fps=8467ms：f0-89 只有零星预热火星、f90-94 纯空，火头 f95 才真正喷出
   * （3167ms）——startTime 跳过这段死等；平台段 f120-204 亮度稳定在 90% 以上，
   * duration 裁到 f205（6833ms）为止，即 startTime 之后播 3666ms。
   * yScale 用 60°基准换算——JB2A 的锥形素材按 60° 授权（fixture 里 region.angle
   * 恰好也是 60，故当前测试下 yScale===1，但公式对非 60° 张角同样成立）。
   */
  {
    id: "spell.gesture.cone", pri: 780,
    when: s => s.spell?.gesture === "cone" && s.region?.type === "cone",
    build: (s, ctx, target) => {
      const fx = ctx.pick("jb2a.breath_weapons.fire.cone", {color: ctx.runeColor()});
      if (!fx) return null;
      const yScale = (s.region.angle ?? 60) / 60;
      return {
        file: fx.file,
        stretchTo: {x: s.region.x + s.region.radius, y: s.region.y},
        scale: {x: 1, y: yScale},
        mask: "region", zIndex: 90,
        startTime: 3167, duration: 3666,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null,
        waitUntilFinished: -300
      };
    }
  },

  /**
   * 环形脉冲：从施法者向外扩散的一圈冲击波，AOE 命中每个目标。
   *
   * eskie.pulse.energy.01 颜色分支（blue/green/orange/purple/red/yellow）同样
   * 不在 ASSET-NOTES 文末的帧数不一致清单里，可以跟 {color:runeColor()}。
   * 23 帧 @29.97fps=767ms：帧 0 已是完整环、没有 alpha 淡入（"起手很硬"），
   * 补一个很短的 fadeIn 抹掉那一下硬弹出；f14 起碎成弧段消散，f20-22 空转，
   * duration 裁到约 f19（634ms）。
   *
   * 锚点说明：resolve.mjs 目前对 travel 槽统一把 `at.ref` 记成 "target"（S2-S4
   * 按目标循环解析，见 resolve.mjs:65-67），没有 "origin" 选项——cast 槽才有。
   * 本规则语义上是"从施法者发出"，但在当前基础设施下只能落在每个目标位置上
   * （读作"脉冲波及到这个目标时的涟漪"），不是真的从施法者格子画出去。要做到
   * 真正的施法者锚点需要 resolve.mjs 增加 at.ref==="origin" 的 travel 支持，
   * 这超出本任务允许修改的文件范围（只能改 travel.mjs），已记入报告作为待办。
   */
  {
    id: "spell.gesture.pulse", pri: 770,
    when: s => s.spell?.gesture === "pulse",
    build: (s, ctx, target) => {
      const fx = ctx.pick("eskie.pulse.energy.01", {color: ctx.runeColor()});
      if (!fx) return null;
      return {
        file: fx.file,
        objectScale: 1.2 * ctx.geom.sizeScale(),
        aim: {towards: {tokenId: target.tokenId, x: target.x, y: target.y}, missed: false},
        fadeIn: 100, fadeOut: 200, zIndex: 85,
        duration: 634,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null,
        waitUntilFinished: -200
      };
    }
  },

  /**
   * 自身爆发：施法者原地炸开，不飞向目标。
   *
   * eskie.casting.physical.01.center.one_shot 的 7 个颜色分支（blue/green/
   * orange/purple/red/yellow/white）同样不在帧数不一致清单里，跟 {color:runeColor()}
   * 安全。30 帧 @24fps=1250ms：f0-3 空（125ms）——startTime 跳过；出手节拍点在
   * f18（爆闪，750ms 原始时间轴，裁掉起始空帧后约 625ms）。
   *
   * aim 指向施法者自己而不是目标——这是本文件里唯一一条把 aim.towards 设成
   * origin 的规则，用来向未来的播放层（Task 13）表达"这是自身效果"的最强信号；
   * 与 spell.gesture.pulse 面临同一个 resolve.mjs 没有 at.ref==="origin" 的
   * 基础设施缺口，见上条注释。**这里的双闪判断是有条件的**：如果 Task 13 的
   * 播放层真的按 aim.towards 把它锚在施法者身上，自带爆闪就落在施法者，不会
   * 撞见 impact 层的目标命中闪光；但如果播放层落回 resolve.mjs 给的
   * at.ref==="target"（当前唯一有基础设施支持的锚点），这条自带爆闪就会跟
   * impact 层撞在同一个目标身上——已在报告里把这条按「有条件双闪风险」转交
   * Task 11，不敢断言绝对安全。
   */
  {
    id: "spell.gesture.surge", pri: 770,
    when: s => s.spell?.gesture === "surge",
    build: (s, ctx, target) => {
      const fx = ctx.pick("eskie.casting.physical.01.center.one_shot", {color: ctx.runeColor()});
      if (!fx) return null;
      return {
        file: fx.file,
        objectScale: 1 * ctx.geom.sizeScale(),
        aim: {towards: {tokenId: s.origin.tokenId, x: s.origin.x, y: s.origin.y}, missed: false},
        zIndex: 85,
        startTime: 125, duration: 1125,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null,
        waitUntilFinished: -300
      };
    }
  },

  /**
   * 定向投射物：法术射出的实体飞弹（如 magic missile 类的 storm.arrow）。
   *
   * jb2a.ranged.01.projectile.01.dark_purple.30ft——只有 dark_green/dark_orange/
   * dark_purple 三个颜色分支，且同样带 ft 结构（见文件头注释），写死颜色+ft、
   * 不跟随符文色。55 帧 @30fps=1833ms：f0 即有内容不必 startTime；自带的箭形
   * 命中爆闪在 f14-15（约 467ms），落在目标端，与 impact 层命中闪光双闪，记入
   * Task 11 转交清单。f51-54 是不超过 9 的空 alpha，duration 裁到 1667ms 跳过。
   * waitUntilFinished 给 -1200，让下一段几乎紧跟命中闪光触发。
   */
  {
    id: "spell.gesture.arrow", pri: 760,
    when: s => s.spell?.gesture === "arrow",
    build: (s, ctx, target) => {
      const fx = ctx.pick("jb2a.ranged.01.projectile.01.dark_purple.30ft");
      if (!fx) return null;
      return {
        file: fx.file,
        stretchTo: {x: target.x, y: target.y},
        objectScale: 1 * ctx.geom.sizeScale(),
        aim: {towards: {tokenId: target.tokenId, x: target.x, y: target.y},
              missed: target.results.some(r => r.result === 0 || r.result === 1)},
        zIndex: 100, elevation: target.elevation,
        duration: 1667,
        waitUntilFinished: -1200
      };
    }
  },

  /**
   * 近战挥击。三处几何修正缺一不可：
   *  1. 贴身与隔格用不同长度的素材，否则要么够不着要么穿模——shortsword 的
   *     _template 跨距正好 1 格 5 尺，nodachi 是唯一真正够得到隔一格的
   *     melee_attack 素材（scythe/greatsword 都已被 ASSET-NOTES 否掉，见文末
   *     被否清单）。
   *  2. 大体型施法者放大 1.4 倍、偏移折半（ctx.geom.sizeScale / offsetFor）。
   *  3. 目标在左侧时镜像，否则武器反手挥（两条素材都是从左下抡向右上的明确手性）。
   *
   * 两条素材都是无颜色分支的纯几何叶子（colorsUnder 为空），不传 {color}。
   * duration 裁掉各自记录的长空尾：shortsword 命中峰在 f16（533ms），f29-45
   * 共 37% 全空，裁到约 f28（933ms）；nodachi 命中峰在 f12（400ms），f24-41
   * 共 43% 全空，裁到约 f23（767ms）。两者都自带闪爆="否"，无需转交 Task 11。
   * 叶子各是 4 文件的 variant 数组，ctx.pick 每次按 seed 重掷一个，帧数在
   * 1.30-1.53s（shortsword）/ 1.40-1.47s（nodachi）间波动——ASSET-NOTES 记为
   * 已知限制，不在本规则可控范围内（需要 ctx 增加锁定 variant 的能力）。
   */
  {
    id: "strike.melee", pri: 620,
    when: s => s.strikes.some(w =>
      ["light1", "simple1", "balanced1", "heavy1", "simple2", "balanced2", "heavy2"]
        .includes(w.category)),
    build: (s, ctx, target) => {
      const adjacent = ctx.geom.adjacent(target);
      const branch = adjacent ? "jb2a.melee_attack.01.shortsword.01" : "jb2a.melee_attack.05.nodachi.01";
      const fx = ctx.pick(branch);
      if (!fx) return null;
      return {
        file: fx.file,
        objectScale: 1 * ctx.geom.sizeScale(),
        offset: {x: ctx.geom.offsetFor(target, 0.5), y: 0}, gridUnits: true,
        mirrorY: ctx.geom.onLeft(target),
        aim: {towards: {tokenId: target.tokenId, x: target.x, y: target.y}, missed: false},
        duration: adjacent ? 933 : 767,
        zIndex: 100,
        elevation: target.elevation,
        waitUntilFinished: -400
      };
    }
  },

  /**
   * 拳击轨迹。PF2E 里 unarmed 永远是贴身武器，没有隔格变体可选，因此不做
   * shortsword/nodachi 那样的分支——只有几何缩放/偏移/镜像三项修正。
   *
   * 颜色写死为 blue，不跟 {color:damageColor()}：ASSET-NOTES 文末「同族分支
   * 帧数不一致」明确点名这一家——blue/green/orange/pinkpurple/yellow 是 31 帧
   * (1.033s)，但 dark_purple/dark_red 是 51 帧 (1.700s，1.65 倍)，而
   * DAMAGE_COLOR.void 与 RUNE_COLOR.oblivion 恰好都是 dark_purple，pickColor
   * 的最近色计算还会把 purple 也路由到 dark_purple——三条路都可能在毫无征兆的
   * 情况下把 1.03s 的时序表变成 1.70s。unarmed 的伤害类型现实中几乎总是
   * bludgeoning（DAMAGE_COLOR 为 null），动态染色本就用不上，锁定安全分支
   * 收益大于损失。自带闪爆="是"（f19 起黄白命中爆闪，落在目标端），与 impact
   * 层命中闪光双闪，记入 Task 11 转交清单。f19≈633ms，duration 不裁剪
   * （31 帧总长仅 1.033s，未见长空尾记录），waitUntilFinished 给 -400 使下一
   * 段紧跟命中闪光。
   */
  {
    id: "strike.unarmed", pri: 610,
    when: s => s.strikes.some(w => w.category === "unarmed"),
    build: (s, ctx, target) => {
      const fx = ctx.pick("jb2a.unarmed_strike.physical.01.blue");
      if (!fx) return null;
      return {
        file: fx.file,
        objectScale: 1 * ctx.geom.sizeScale(),
        offset: {x: ctx.geom.offsetFor(target, 0.5), y: 0}, gridUnits: true,
        mirrorY: ctx.geom.onLeft(target),
        aim: {towards: {tokenId: target.tokenId, x: target.x, y: target.y}, missed: false},
        zIndex: 100,
        elevation: target.elevation,
        waitUntilFinished: -400
      };
    }
  },

  /**
   * 投掷物飞行。blfx.weapon.range.dagger1.throw1.color1.30ft——colorsUnder 只有
   * 字面量 "color1" 这一个键，根本不在 COLOR_HUE 表里，传 {color} 会被
   * pickColor 判定为无可用分支而静默退回不染色（等价于没传），因此直接写死
   * 完整路径，与 ft 说明（见文件头）一致不做动态染色。
   *
   * 54 帧 @30fps=1800ms：f0-16 是向后收势的蓄力（"先退后再甩出"，533ms）——
   * startTime 跳过；真正的飞行是 f16-27（收势后 0-367ms）；自带金色命中光环
   * f27-36（收势后 367-667ms），落在目标端，与 impact 层双闪，记入 Task 11
   * 转交清单；f51 起彻底归零，duration 裁到 1167ms（收势后）。镜像同其它
   * 投射几何：向左投掷需要 mirrorY。template=[200,200,200] 非空，可 stretchTo。
   */
  {
    id: "strike.thrown", pri: 600,
    when: s => s.tags?.includes("thrown"),
    build: (s, ctx, target) => {
      const fx = ctx.pick("blfx.weapon.range.dagger1.throw1.color1.30ft");
      if (!fx) return null;
      return {
        file: fx.file,
        stretchTo: {x: target.x, y: target.y},
        objectScale: 1 * ctx.geom.sizeScale(),
        mirrorY: ctx.geom.onLeft(target),
        aim: {towards: {tokenId: target.tokenId, x: target.x, y: target.y},
              missed: target.results.some(r => r.result === 0 || r.result === 1)},
        zIndex: 100, elevation: target.elevation,
        startTime: 533, duration: 1167,
        waitUntilFinished: -500
      };
    }
  },

  /** 爆发：没有飞行段，全部交给 impact——施法者原地起爆，没有"到达"这个概念。 */
  {
    id: "target.blast", pri: 200,
    when: s => s.target?.type === "blast",
    build: () => null
  },

  /**
   * 兜底：远程攻击（含普通弓弩/未细分的 gesture）给一枚中性箭形飞行物；近战不出
   * 内容，由 impact 承担。
   *
   * 原用 jb2a.magic_missile，是 ASSET-NOTES 建立之前的历史欠账（Task 9 review
   * 同源问题），现迁移到 ASSET-NOTES 实测过的 eskie.attack.ranged.arrow.ray——
   * 前端带明确箭头形，语义上比法术味的 magic_missile 更贴合"普通远程武器攻击"
   * 这个兜底场景。同样带 ft 结构（05/15/30/60/90ft 同级），写死
   * ".blue.30ft"，理由见文件头注释。24 帧 @24fps=1.000s，没有真正的"射出"过程
   * （第 2 帧已整条拉满），f8 起碎裂淡出——duration 裁到 800ms 跳过淡出尾段。
   * 自带闪爆="否"，无需转交 Task 11。
   */
  {
    id: "generic.travel", pri: 10,
    when: () => true,
    build: (s, ctx, target) => {
      if (!s.usage.isRanged) return null;
      const fx = ctx.pick("eskie.attack.ranged.arrow.ray.physical.blue.30ft");
      if (!fx) return null;
      return {
        file: fx.file, objectScale: 1 * ctx.geom.sizeScale(),
        stretchTo: {x: target.x, y: target.y},
        aim: {towards: {tokenId: target.tokenId, x: target.x, y: target.y},
              missed: target.results.some(r => r.result === 0 || r.result === 1)},
        duration: 800,
        waitUntilFinished: -300, zIndex: 100
      };
    }
  }
];
