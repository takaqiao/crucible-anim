/**
 * S1 cast：动作开始，锚在施法者。
 * 规则按 pri 降序匹配，取第一个命中者。高优先级规则加在数组前部。
 */
export default [
  // ---- 高优先级规则加在这里（Task 9） ----

  /**
   * 防护姿态：闭合的六芒星法阵，地面层，符文色。
   *
   * 素材 jb2a.magic_signs.circle.02.abjuration.complete 全长 265 帧 @24fps=11.04s，
   * f9 起笔、f61 一次爆闪、f71 起进入「稳态」——但 ASSET-NOTES 实测稳态段画面仍在
   * 缓慢变化（相邻帧差 0.99-2.33，接缝差 9.95），不能截出无缝循环段；播完整段又比任何
   * PF2E 回合都长。取 duration=2900ms，正好停在 f71 爆闪收尾处，只播「起笔+爆闪」这段
   * 有明确开始与高潮的部分，不进入那段既非循环、又长到没意义的尾巴。
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
        duration: 2900,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null,
        waitUntilFinished: -400
      };
    }
  },

  /**
   * 召唤姿态：五芒星召唤法阵，地面层，符文色。
   *
   * 与 abjuration.complete 共用同一条时间轴（f9 起笔、f61 爆闪、f71 起稳态），同样的
   * 理由把 duration 截在 2900ms。外环符文密度极高，ASSET-NOTES 实测钉到 1 格 token
   * 尺寸会糊成毛边带，至少要铺 2 格才立得住，故 objectScale 明显大于 ward。
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
        duration: 2900,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null,
        waitUntilFinished: -400
      };
    }
  },

  /**
   * 自身增益：居中同心环辉光，钉在施法者身上，符文色。
   *
   * jb2a.on_token_buff.001.001 全长 55 帧 @30fps=1.833s，f1 就硬弹到近峰值（无天然
   * 淡入）、f46 起 9 帧空转。fadeIn 压到 150ms 只抹掉那一下硬弹、不吃掉后续 19 帧的
   * 涨幅；waitUntilFinished 给 -300 跳过尾部空转，不必再靠 duration 硬切。
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
   */
  {
    id: "strike.ranged.draw", pri: 640,
    when: s => s.strikes.some(w => ["projectile1", "projectile2"].includes(w.category)),
    build: (s, ctx) => {
      const snd = ctx.sound("psfx.ranged-weapons.longbow.v1.30ft");
      const cues = [];
      if (snd) cues.push({kind: "sound", file: snd.file, volume: 0.8});
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
   */
  {
    id: "generic.cast", pri: 10,
    when: () => true,
    build: (s, ctx) => {
      if (s.usage.isAttack && s.targets.length) return null;
      const fx = ctx.pick("jb2a.cast_generic.03", {color: ctx.runeColor() ?? "blue"});
      if (!fx) return null;
      return {
        file: fx.file, objectScale: 0.9 * ctx.geom.sizeScale(),
        belowTokens: true, fadeIn: 200, fadeOut: 400,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null
      };
    }
  }
];
