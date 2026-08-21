/**
 * S1 cast：动作开始，锚在施法者。
 * 规则按 pri 降序匹配，取第一个命中者。高优先级规则加在数组前部。
 */
export default [
  // ---- 高优先级规则加在这里（Task 9） ----

  /**
   * 防护姿态：闭合的六芒星法阵，地面层，符文色。
   *
   * 素材 jb2a.magic_signs.circle.02.abjuration.complete 全长 265 帧 @24fps=11.04s。
   * ASSET-NOTES 实测 f0-8 是纯空帧（9 帧@24fps=375ms，直接叠 fadeIn:300 会在空帧上
   * 空转、之后满不透明度硬弹出来，正是 fadeIn 想避免的效果）——startTime:375 跳过
   * 这段。f9 起逐笔画出、f61 一次爆闪、f71 起进入「稳态」，但稳态段画面仍在缓慢变化
   * （相邻帧差 0.99-2.33，接缝差 9.95），截不出无缝循环段；播完整段又比任何 PF2E
   * 回合都长。duration 按「从 startTime 起算的播放时长」重算：目标停在 f71（原始时间
   * 轴 71/24s≈2958ms），2958-375=2583，只播「起笔+爆闪」这段有明确开始与高潮的部分，
   * 不进入那段既非循环、又长到没意义的尾巴。
   */
  {
    id: "spell.gesture.ward", pri: 780,
    when: s => s.spell?.gesture === "ward",
    build: (s, ctx) => {
      const fx = ctx.pick("jb2a.magic_signs.circle.02.abjuration.complete", {color: ctx.runeColor()});
      if (!fx) return null;
      return {
        file: fx.file,
        objectScale: 1.1 * ctx.geom.sizeScale(),
        belowTokens: true, fadeIn: 300, fadeOut: 500, zIndex: 20,
        startTime: 375, duration: 2583,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null,
        waitUntilFinished: -400
      };
    }
  },

  /**
   * 召唤姿态：五芒星召唤法阵，地面层，符文色。
   *
   * 与 abjuration.complete 共用同一条时间轴的起手段（ASSET-NOTES【订正】：空帧同样是
   * f0-8 而非 f0-9、爆闪峰值在 f61 而非 f60），同样 startTime:375 跳过 375ms 空帧。
   * 但这条素材自己的稳态起点是 f78 而不是 abjuration 的 f71（两者时间轴在爆闪之后仍
   * 分叉几帧）——duration 按 conjuration 自己的数重算：78/24s≈3250ms，3250-375=2875。
   * 外环符文密度极高，ASSET-NOTES 实测钉到 1 格 token 尺寸会糊成毛边带，至少要铺 2 格
   * 才立得住，故 objectScale 明显大于 ward。
   */
  {
    id: "spell.gesture.conjure", pri: 780,
    when: s => s.spell?.gesture === "conjure",
    build: (s, ctx) => {
      const fx = ctx.pick("jb2a.magic_signs.circle.02.conjuration.complete", {color: ctx.runeColor()});
      if (!fx) return null;
      return {
        file: fx.file,
        objectScale: 2 * ctx.geom.sizeScale(),
        belowTokens: true, fadeIn: 300, fadeOut: 500, zIndex: 20,
        startTime: 375, duration: 2875,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null,
        waitUntilFinished: -400
      };
    }
  },

  /**
   * 自身增益：居中同心环辉光，钉在施法者身上，符文色。
   *
   * jb2a.on_token_buff.001.001 全长 55 帧 @30fps=1.833s。ASSET-NOTES 实测「起手硬弹」
   * 是指 f0 全空、f1 直接跳到 alpha 均值 15.3（无 alpha 淡入的瞬间起跳），但那只是峰值
   * 73.0（f20）的约 21%——不是一跳就到近峰值，之后还要 19 帧（约 0.63s）才慢慢涨满。
   * fadeIn 压到 150ms 只抹掉 f1 那一下瞬间起跳，不吃掉后续的涨幅；f46 起 9 帧空转，
   * waitUntilFinished 给 -300 跳过尾部空转，不必再靠 duration 硬切。
   */
  {
    id: "spell.gesture.aspect", pri: 770,
    when: s => s.spell?.gesture === "aspect",
    build: (s, ctx) => {
      const fx = ctx.pick("jb2a.on_token_buff.001.001", {color: ctx.runeColor()});
      if (!fx) return null;
      return {
        file: fx.file,
        objectScale: 1 * ctx.geom.sizeScale(),
        attachTo: true, fadeIn: 150, fadeOut: 300, zIndex: 30,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null,
        waitUntilFinished: -300
      };
    }
  },

  /**
   * 通用施法圈：任何法术的默认起手，符文色。
   *
   * jb2a.magic_signs.circle.02.evocation.loop 逐帧 alpha 恒定 54.5、首尾无渐变，
   * ASSET-NOTES 确认是真无缝 loop，因此可以在任意一点截断而不会露接缝，
   * duration 定在 1500ms 是给起手一个合理长度，不必播完 121 帧 @24fps=5.04s 的全程。
   */
  {
    id: "spell.composed", pri: 700,
    when: s => s.spell !== null,
    build: (s, ctx) => {
      const fx = ctx.pick("jb2a.magic_signs.circle.02.evocation.loop", {color: ctx.runeColor()});
      if (!fx) return null;
      return {
        file: fx.file,
        objectScale: 1 * ctx.geom.sizeScale(),
        belowTokens: true, fadeIn: 300, fadeOut: 500, zIndex: 20,
        duration: 1500,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null,
        waitUntilFinished: -300
      };
    }
  },

  /**
   * 弓弩起手：拉弓动作 + 弓弦音，两条平行轨。
   *
   * psfx.ranged-weapons.longbow.v1.30ft 是一个 3.5s 的烘焙音频（拉弓 0.05-0.35s →
   * 放弦 0.62-0.80s → 箭到 0.80-1.05s，其后 2.45s 是静音填充），只有 sound 轨，起手
   * 段暂不挂视觉——ASSET-NOTES 里能当远程蓄力视觉的 jb2a.cast_generic.02 全程只有
   * 4 个颜色分支、配不满符文色，且语义是法术蓄力而非弓弩，硬凑会文不对题，留给
   * travel/impact 段承担视觉即可。
   *
   * duration 截在 800ms（放弦 0.80s 结束、箭到之前）：cast 槽只负责「拉弓+放弦」，
   * 不播音频里烘焙的「箭到」那一团——它与 travel/impact 的真实飞行时序无关，播出来
   * 只会在动作开始后固定 0.8s 响一声跟画面对不上。ft 档位写死为 30ft、不按实际格距
   * 换档的问题不在本轮范围，已移交 Task 10（travel 槽才是投射物时序的归属地）。
   */
  {
    id: "strike.ranged.draw", pri: 640,
    when: s => s.strikes.some(w => ["projectile1", "projectile2"].includes(w.category)),
    build: (s, ctx) => {
      const snd = ctx.sound("psfx.ranged-weapons.longbow.v1.30ft");
      const cues = [];
      if (snd) cues.push({kind: "sound", file: snd.file, volume: 0.8, duration: 800});
      return cues.length ? cues : null;
    }
  },

  /** 重武器：起手不出内容，蓄力感由 travel 段的挥击弧线承担。 */
  {
    id: "strike.melee.heavy", pri: 620,
    when: s => s.strikes.some(w => ["heavy1", "heavy2", "balanced2"].includes(w.category)),
    build: () => null
  },

  /**
   * 治疗标签：施法者手部绿光。
   *
   * jb2a.healing_generic.200px 是 ASSET-NOTES 里唯一原生 200x200、小到能钉在手上而
   * 不糊住整个 token 的治疗素材（其余治疗分支都是 400px 起）。固定用 green（与
   * S4 aftermath 的治疗规则同色，不跟随符文色），因为「治疗」本身就是语义色，不该
   * 被施法者的符文颜色带偏。实际有效内容只到约 1.35s（51 帧 @30fps=1.7s，最后 10
   * 帧全空），duration 截在 1350ms 避免空等。
   */
  {
    id: "tag.healing", pri: 420,
    when: s => s.tags?.includes("healing"),
    build: (s, ctx) => {
      const fx = ctx.pick("jb2a.healing_generic.200px", {color: "green"});
      if (!fx) return null;
      return {
        file: fx.file,
        objectScale: 0.6 * ctx.geom.sizeScale(),
        attachTo: true, fadeIn: 150, fadeOut: 300, zIndex: 65,
        duration: 1350,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null,
        waitUntilFinished: -250
      };
    }
  },

  /**
   * 技能标签：轻量闪光，不跟随符文色。
   *
   * blfx.spell.cast.light_flare.1.center 的 7 个同级分支里 color1 是彩虹色散版、
   * 跟不了任何单一目标色，其余 color2-color7 才是单色——不能走 ctx.pick 的
   * {color} 最近色匹配（分支名是 colorN 不是色名，全部会被 pickColor 的
   * COLOR_HUE 过滤掉，导致悄悄降级到 color1）。因此这里直接锁定 ASSET-NOTES 里
   * 已验证过的 color3（红偏粉），不做符文色染色。有效内容到约 f38（60 帧
   * @30fps 里的 1.27s），duration 截在 1300ms；源画幅 1200x1200 且能量集中在
   * 中心一半区域，按 token 尺寸直接贴显小，故放大 objectScale。
   */
  {
    id: "tag.skill", pri: 380,
    when: s => s.tags?.includes("skill"),
    build: (s, ctx) => {
      const fx = ctx.pick("blfx.spell.cast.light_flare.1.center.color3");
      if (!fx) return null;
      return {
        file: fx.file,
        objectScale: 1.4 * ctx.geom.sizeScale(),
        fadeIn: 150, fadeOut: 250, zIndex: 55,
        duration: 1300,
        waitUntilFinished: -200
      };
    }
  },

  /**
   * 兜底：任何非攻击动作给一个中性施法圈；有目标的攻击动作起手交给 travel/impact 段。
   *
   * 但 travel/impact 都是按 snapshot.targets 循环触发的——零目标时它们根本不会执行。
   * Crucible 的 composed 标签动作（见 action.mjs 的 initialize()）无条件把 isAttack
   * 设为 true，不看目标类型，所以自我增益/召唤类法术（aspect/ward/conjure/create 等
   * gesture）也是 isAttack === true 但 targets 为空。这类动作必须靠 cast 段自己扛，
   * 否则整条链断掉、零 cue。因此这里判断的是「攻击且有目标」才让路，不是单看 isAttack。
   *
   * 素材：ASSET-NOTES 的「被否掉的候选 · cast 槽」明确否掉了旧用的 jb2a.cast_generic.03——
   * 那是一发命中/爆炸素材（第 15 帧整幅画面变成纯白过曝球、第 20 帧碎裂甩出放射线），
   * 放在 cast 槽会让观众以为技能已经打中了，且 9 个颜色分支在过曝下分不出差别、配不满
   * 12 符文色。这条规则实测覆盖 434 个 fixture 里的 185 个（全部是 spell===null 的
   * 普通武器动作/零目标动作），是 cast 槽命中率最高的规则，选材必须认真对待。改用
   * jb2a.magic_signs.circle.02.evocation.loop——与 spell.composed 同一条素材，逐帧
   * alpha 恒定 54.5、真无缝 loop，可以在任意一点截断不露接缝，12 色分支齐全（虽然
   * 这条规则命中的 185 个 fixture 里 s.spell 全为 null，实际总是落到 "blue"，但保留
   * {color} 接口以防万一 spell.composed 的 build() 意外失败而回落到这里）。duration
   * 截在 700ms，比 spell.composed 的 1500ms 更短——它是覆盖率最高的默认兜底，包含大量
   * 普通近战挥砍前的零目标/无目标动作，不宜像专门的法术起手那样长。
   */
  {
    id: "generic.cast", pri: 10,
    when: () => true,
    build: (s, ctx) => {
      if (s.usage.isAttack && s.targets.length) return null;
      const fx = ctx.pick("jb2a.magic_signs.circle.02.evocation.loop", {color: ctx.runeColor() ?? "blue"});
      if (!fx) return null;
      return {
        file: fx.file, objectScale: 0.9 * ctx.geom.sizeScale(),
        belowTokens: true, fadeIn: 200, fadeOut: 400, duration: 700,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null
      };
    }
  }
];
