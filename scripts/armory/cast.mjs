import {selfShapeFor} from "./self-shapes.mjs";
import {spellCastSound} from "./sounds.mjs";

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
      const fx0 = {
        file: fx.file,
        objectScale: 1.1 * ctx.geom.sizeScale(),
        belowTokens: true, fadeIn: 300, fadeOut: 500, zIndex: 20,
        startTime: 375, duration: 2583,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null,
        waitUntilFinished: -400
      };
      return [...spellCastSound(s, ctx), fx0];
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
      const fx0 = {
        file: fx.file,
        objectScale: 2 * ctx.geom.sizeScale(),
        belowTokens: true, fadeIn: 300, fadeOut: 500, zIndex: 20,
        startTime: 375, duration: 2875,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null,
        waitUntilFinished: -400
      };
      return [...spellCastSound(s, ctx), fx0];
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
      const fx0 = {
        file: fx.file,
        objectScale: 1 * ctx.geom.sizeScale(),
        attachTo: true, fadeIn: 150, fadeOut: 300, zIndex: 30,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null,
        waitUntilFinished: -300
      };
      return [...spellCastSound(s, ctx), fx0];
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
      const fx0 = {
        file: fx.file,
        objectScale: 1 * ctx.geom.sizeScale(),
        belowTokens: true, fadeIn: 300, fadeOut: 500, zIndex: 20,
        duration: 1500,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null,
        waitUntilFinished: -300
      };
      return [...spellCastSound(s, ctx), fx0];
    }
  },

  /**
   * 弓弩起手：拉弓动作 + 弓弦音，两条平行轨。
   *
   * **这条规则在原生正常工作时到不了**：它的 when 与 configureStrikeVFXEffect 产出非空
   * 配置的条件（canvas/vfx/strikes.mjs 的
   * `continue ⇐ !["projectile1", "projectile2"].includes(weapon?.category)`）基本同构，
   * 弓弩射击归原生独占（README 的「不替换弓弩射击」）。留着它是为了两条降级路径：
   * (a) 原生 configureStrikeVFXEffect 抛错时（见 trigger/wrap.mjs 文件头那条有意为之的
   * 例外）整条动作会掉到我们手里；(b) 目标 actor 在当前场景没有 token 时原生 continue
   * 到底、timeline 为空、返回 null。删掉它等于让这两种情况下的弓箭射击彻底静音；
   * test/armory-cast.test.mjs 的「弓弩起手带音效轨」用合成快照专门覆盖它，不是死代码。
   *
   * 一处**今天就可达**的分歧，改 when 之前先想清楚：我们判的是
   * `s.strikes.some(w => 是投射物)`（整条动作的武器集合里有没有弓），而 Crucible 判的是
   * 逐 roll 的 `usage.strikes[roll.data.strike].category`。主手弓、副手近战（mainhand 与
   * offhand 两个 tag 都 propagate 到 strike，const/action.mjs:850-891，两者各往
   * usage.strikes push 一件）时用近战那只手出手：Crucible 逐条 continue → 返回 null →
   * 我们接管 → 一次挥剑配上弓弦音。要根治得把判据改成逐 roll 的武器，那需要快照里带上
   * 每条 roll 对应的 weapon index，属于 Task 10 的范围。
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
  /**
   * 非武器非法术动作的自身画面 —— **本仓库最大的一块空白**。
   *
   * 全量语料 434 个动作里，武器 69 条、法术 204 条，剩下 161 条「其它动作」中
   * **104 条只播通用兜底**。按条数它比法术与状态加起来还多。
   *
   * 它们不是没有判别信息：这 104 条在快照原始字段上能区分出 77 种。本规则按
   * `armory/self-shapes.mjs` 的表分四簇——元素架势（按动作 id）、英雄气概（按
   * `cost.heroism`）、吟唱光环（`vocal` + aura/pulse）、召唤（`target.type`），
   * 其余自身增益走一支克制的升腾光条。**表里没有的仍然走兜底，不硬凑。**
   *
   * pri 400 夹在 `tag.healing`（420）与 `tag.skill`（380）之间：治疗有自己的语义，
   * 优先级更高；技能检定比「对自己做了什么」更泛，让位。
   */
  {
    id: "self.shape", pri: 400,
    when: s => !!selfShapeFor(s),
    build: (s, ctx) => {
      const shape = selfShapeFor(s);
      const fx = ctx.pick(shape.path, shape.color ? {color: shape.color} : {});
      if (!fx) return null;
      return {
        file: fx.file,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null,
        objectScale: 1.1 * ctx.geom.sizeScale(),
        fadeIn: 150, fadeOut: 300,
        zIndex: 40
      };
    }
  },
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
   * 兜底：任何非攻击动作给一个中性起手感；有目标的攻击动作起手交给 travel/impact 段。
   *
   * 但 travel/impact 都是按 snapshot.targets 循环触发的——零目标时它们根本不会执行。
   * Crucible 的 composed 标签动作（见 action.mjs 的 initialize()）无条件把 isAttack
   * 设为 true，不看目标类型，所以自我增益/召唤类法术（aspect/ward/conjure/create 等
   * gesture）也是 isAttack === true 但 targets 为空。这类动作必须靠 cast 段自己扛，
   * 否则整条链断掉、零 cue。因此这里判断的是「攻击且有目标」才让路，不是单看 isAttack。
   *
   * 素材（第二次订正）：第一次订正把旧用的 jb2a.cast_generic.03（否决清单第一条，命中/
   * 爆炸素材）换成了 jb2a.magic_signs.circle.02.evocation.loop——但那是符文法阵，和
   * spell.composed 用的是同一条素材。这条规则实测覆盖 434 个 fixture 里的 185 个
   * （全部是 spell===null：战士的防御/恢复、各类武技天赋、技能检定、社交动作），给这些
   * 非法术动作脚下点一圈塑能符文阵语义是错的——桌上看会是「战士摆防御姿态，地上浮起法阵」，
   * 且它与 spell.composed 撞素材，二者仅靠「spell===null 时 runeColor()??"blue" 恒为
   * 蓝」这一点弱化学区分，视觉上等于没有区分度。
   *
   * 改用 jb2a.cast_generic.01：ASSET-NOTES 标注为 [近战/远程蓄力备选]，不是法阵/符文，
   * 是一圈从中心快速外扩又收回的抽象能量脉冲（"先炸开再收回"，帧 2-8 外扩、第 8 帧 alpha
   * 峰值 112、之后收回消失），没有任何具象的施法/武器/社交道具意象——足够抽象，能同时
   * 罩住武技、恢复、技能检定这些差异很大的动作，不会把非法术动作误读成"正在施法"。自带
   * 闪爆列是「否」（与 jb2a.cast_generic.02 一样全程无爆发闪光），不需要为避免与 travel/
   * impact 的闪光层双闪做任何额外处理——这也是没选同样中性的 blfx.spell.cast.light_flare
   * （tag.skill 已用，且自带闪爆="是"）或 eskie.casting.physical.01（自带闪爆="是"，且
   * "近战起手/蓄力"的火花环对技能检定/社交类动作偏"用力"）的原因之一。
   *
   * 参数：21 帧 @30fps=700ms，前 2 帧（f0-1，约 67ms）是空帧——但短于 fadeIn:200，我们
   * 自己的淡入还在爬升阶段时素材内容就已经出现，会被自然揉进去，不需要额外 startTime
   * 跳过。备注没有标出「长空尾」一类的坑（"之后收回消失"暗示内容持续到收尾），故不加
   * duration 截断，让 21 帧自然播完。不再是地面俯视圆阵，而是罩在施法者身上的一圈脉冲，
   * 去掉 belowTokens（不再需要压在 token 下方）。只有 4 个颜色分支（实测
   * dark_purple/dark_red/blue/yellow，与同族 02 的 4 分支不完全相同——02 是
   * dark_purple/dark_red/blue/green），配不满 12 符文色，但这条规则命中的 185 个
   * fixture 里 spell 全为 null，实际总落到 "blue"；保留 {color} 接口只是防御性地兼容
   * spell.composed 的 build() 意外失败而回落到这里的边界情况。
   */
  {
    id: "generic.cast", pri: 10,
    when: () => true,
    build: (s, ctx) => {
      if (s.usage.isAttack && s.targets.length) return null;
      const fx = ctx.pick("jb2a.cast_generic.01", {color: ctx.runeColor() ?? "blue"});
      if (!fx) return null;
      return {
        file: fx.file, objectScale: 0.9 * ctx.geom.sizeScale(),
        fadeIn: 200, fadeOut: 400,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null
      };
    }
  }
];
