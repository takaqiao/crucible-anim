import {actionSoundFor, selfShapeFor} from "./self-shapes.mjs";
import {spellCastSound} from "./sounds.mjs";
import {SFX, contentEndOf, gainFor, poolFor} from "./sound-table.mjs";

/**
 * 非法术动作的**起手音** cue（批次 E · §4.1）。
 *
 * ## 为什么每条规则都调它，而不是各写各的
 *
 * 改造前 cast 槽有 6 条规则从来不发声（`self.shape` 57 条 / `generic.cast` 22 /
 * `tag.skill` 20 / `cast.target.single` 18 / `cast.spell.iconic` 14 / `tag.healing` 7），
 * 另有 12 条无符文戏法**连 cast cue 都没有**。分档表在 `self-shapes.mjs` 的
 * `actionSoundFor`——**刻意与规则表脱钩**（理由写在那边），所以这里是一个统一的构造器，
 * 六条规则各自把它的产出摊在自己的 cue 前面。
 *
 * ## 三件必须照抄 `spellCastSound` 的事
 *
 * 1. **`soundRole: "cast"`**。这是 `gainFor` 的角色档（RMS 目标 −30 dBFS），
 *    起手音与 12 支符文施法音是同一件事：一段渐强的床垫，按 RMS 归一化而不是按峰值
 *    ——用峰值对齐会被段内单个爆点带偏。`test/sound-gain.test.mjs` 有一条
 *    「音效 cue 必须报 soundRole」的守卫，漏了会直接红。
 * 2. **`volume` 必须走 `gainFor(file, role) ?? 常数`**，不许静默按 1：查不到表的素材
 *    按 1 会比全场响 3-8 dB，比不归一化更糟。
 * 3. **不许走引擎 fade**。Sequencer 4.2.3 的 `fadeInAudio/fadeOutAudio` 的 `from:1/to:1`
 *    是字面量、不读 `data.volume`，加上去会把归一化到 0.2-0.4 的床垫整个弹回 1.0
 *    ——整层禁用（声效层重做方案 §3.3）。⚠ cue 上那个 `fadeIn: 200` 是
 *    `resolve.mjs:48` 的 CUE_DEFAULTS 给**所有** cue 填的默认值，而 `play.mjs` 只在画面
 *    section 上读它，sound 那一支从来不读——所以它无害，真正要防的是有人在 sound 分支上
 *    补一句 `.fadeInAudio(...)`（守卫在 `test/action-sound.test.mjs`，查的是源码）。
 *
 * ## 一件与 `spellCastSound` **不同**的事：`startTime` 跳掉起振前的静音
 *
 * 床垫不做峰值对齐（`delay` 恒 0），所以素材开头那段静音是纯粹的空转。这里统一取
 * `startTime = onsetMs`、`duration = 有声内容结束 − onsetMs`——两者**必须成对**：
 * `duration` 的口径是「从 `startTime` 起还播多久」，只改一个会让播出窗整整偏一个
 * `onsetMs`（`sounds.mjs` 的 `spellCastSound` 上一轮正是栽在这里，31 条 cue 被从尾巴
 * 削掉一截）。本表里 `ggg-sfx.abilities.misc.whip.01` 的起音有 230ms，不跳掉的话
 * 「架起防御」那一声会比画面晚将近四分之一秒。
 *
 * 窗口右端恰好落在有声内容结束处，所以**不裁掉任何有声内容**，不需要 `trimIntent`
 *（`test/sound-layer.test.mjs` 的「裁掉有声内容必须显式声明 trimIntent」量的就是这个）。
 *
 * ## 取素材一律走 `poolFor` + `ctx.soundFrom`
 *
 * ggg-sfx 全库把「同一种声音的几个变体」拆成并列的编号子枝（`….02.01` / `….02.02` / …），
 * 而 `assets.resolve` 对分支节点只取第一个叶子——直接 `ctx.sound(分支路径)` 会恒定拿到
 * `01`，「同一个动作连做三次是三次一模一样的声音」。`poolFor()` 把这类路径展开成整池
 *（生成器机械展开，见 `sound-table.mjs`），交给 `ctx.soundFrom` 摇。
 * ⚠ 摇的是 **rngSfx** 这条流（`ctx.sound` / `ctx.soundFrom` 都用它），**不是 `ctx.pick`**：
 * 音效 cue 排在画面之前，用 `ctx.pick` 会让「给音效加一个池」这件事本身改掉后面每一次
 * 视觉选材（`resolver/context.mjs` 的 rngSfx 注释、`test/rng-streams.test.mjs`）。
 *
 * @param {object} s 动作快照
 * @param {object} ctx
 * @returns {object[]} 0-1 条 sound cue
 */
function actionSound(s, ctx) {
  const want = actionSoundFor(s);
  if (!want) return [];
  const fx = ctx.soundFrom?.(poolFor(want.path)) ?? ctx.sound(want.path);
  if (!fx) return [];
  // SFX 表查不到时退回「从 0 播到自然结束」——这一层绝不静默无声。表是 `npm run sounds`
  // 从 `data/audio-profiles.json` 生成的，兵库新加了路径却没重跑就会走到这一支。
  const meta = SFX[fx.file];
  const startTime = meta ? meta[1] : 0;                  // 第 2 列 onsetMs
  const end = contentEndOf(fx.file);
  return [{
    kind: "sound", file: fx.file, soundRole: "cast",
    volume: gainFor(fx.file, "cast") ?? 0.55,
    delay: 0, startTime,
    duration: end == null ? null : Math.max(0, end - startTime)
  }];
}

/**
 * 八个学派法阵的 loop 段路径。
 *
 * `jb2a.magic_signs.circle.02.<学派>.loop` 八支**逐帧同规格**（选材阶段实测：800x800、
 * 121 帧 @24fps、12 色轴、无缝 loop 的首尾离散度 0.000），因此 `spell.composed` 那条
 * 「duration 停在 1500ms 不播完 5.04s」的论证对八支一体适用，不必逐支重算时序。
 *
 * `abjuration` 与 `conjuration` **刻意不进 RUNE_SCHOOL**：它们各自被 `spell.gesture.ward`
 * （pri 780）与 `spell.gesture.conjure`（780）用 `.complete` 段占着。两条规则的优先级
 * 高于 `spell.composed`（700），所以文件层面撞不上；但把「六芒星 = 防护姿态」「五芒星 =
 * 召唤姿态」这两个读法留成稳定的，比多两个学派可选更值钱——否则一个 frost 符文配上
 * arrow 手势也会在地上浮起防护法阵。
 */
const SCHOOL_CIRCLE = Object.freeze({
  divination:    "jb2a.magic_signs.circle.02.divination.loop",
  enchantment:   "jb2a.magic_signs.circle.02.enchantment.loop",
  evocation:     "jb2a.magic_signs.circle.02.evocation.loop",
  illusion:      "jb2a.magic_signs.circle.02.illusion.loop",
  necromancy:    "jb2a.magic_signs.circle.02.necromancy.loop",
  transmutation: "jb2a.magic_signs.circle.02.transmutation.loop"
});

/**
 * 12 个符文 → 施法法阵的学派（D4）。
 *
 * ## 冲的是什么
 *
 * 改造前 14/17 个手势共用 `evocation.loop` 一支素材，12 个符文只靠颜色区分、且因为
 * `pickColor` 取最近色，12 个符文塌成 **8 个文件**、最大一支 42 个动作（三个符文的
 * RUNE_COLOR 都落到 dark_green）。**「学派」这一层此前完全没有参与派发。**
 *
 * ## 表是怎么定的：先枚举 Crucible 自己的分类字段，不凭印象
 *
 * `systems/crucible/module/models/spellcraft-rune.mjs` 的 schema 给出符文的全部可分类
 * 属性：`resource` / `damageType` / `restoration` / `defense` / `scaling` / `opposed`。
 * `const/spellcraft.mjs:11-142` 的实际取值（逐条抄自源码，不是记忆）：
 *
 * | 符文 | resource | damageType | restoration | defense | opposed |
 * | --- | --- | --- | --- | --- | --- |
 * | control | morale | psychic | | willpower | kinesis |
 * | illusion | morale | psychic | | willpower | illumination |
 * | oblivion | morale | void | | willpower | soul |
 * | soul | morale | psychic | **✓** | willpower | oblivion |
 * | death | health | corruption | | fortitude | life |
 * | life | health | poison | **✓** | fortitude | death |
 * | frost | health | cold | | fortitude | flame |
 * | flame | health | fire | | reflex | frost |
 * | storm | health | electricity | | reflex | earth |
 * | earth | health | acid | | reflex | storm |
 * | illumination | health | radiant | | reflex | illusion |
 * | kinesis | health | **physical** | | **physical** | control |
 *
 * 逐条的判据（每一条都落在上表的某一列上，没有一条是「感觉像」）：
 *
 * - **control → enchantment**：morale 池 + psychic 伤害 + willpower 防御 + `opposed:
 *   kinesis`（心智对动能）。它是 12 个里唯一以「支配意志」为轴的，enchantment 同义。
 * - **illusion → illusion**：同名，且 `opposed: illumination`（幻象对照明）与 jb2a 的
 *   illusion 法阵读法一致。
 * - **death / oblivion → necromancy**：这两条的 `opposed` 分别正是 `life` 与 `soul`
 *   ——Crucible 自己把它们钉成「生」与「魂」的反面，corruption/void 两种伤害也都是
 *   「使之不存在」这一路。
 * - **illumination / soul → divination**：`illumination.opposed === "illusion"`（照破
 *   幻象）是揭示；`soul` 是 morale 池上唯一的 `restoration`（灵视/安魂）。两条都属
 *   「看见与知晓」而不是「打出去」。
 * - **kinesis / earth → transmutation**：kinesis 是 12 个里**唯一 damageType 与 defense
 *   同为 physical** 的——它作用在物质本身而不是元素能量上；earth 是土石。
 * - **flame / frost / storm / life → evocation**：四条纯元素放射（fire/cold/electricity/
 *   poison）。`life` 带 restoration，但它的伤害面是 poison、`opposed` 是 death，仍是
 *   「自然之力放出来」这一路；它没有独占一个学派是因为 conjuration 留给了召唤姿态。
 *
 * ## 收益（实测，单目标口径）
 *
 * 168 条走 `spell.composed` 的动作从 **8 个文件 / 最大桶 42** 摊到 **12 个文件 /
 * 最大桶 14**——12 个符文一符文一支，桶大小正好等于「每个符文的手势数」，这一层
 * **不可能再拆得更细了**。
 *
 * ⚠ 这个 12 是与 D6 合力的结果，不是 D4 单独做到的：学派把 12 个符文分成 6 组，组内
 * 仍靠 `RUNE_COLOR` 的最近色分开，而同批 D6 把 `RUNE_COLOR.kinesis` 从 teal 改成了
 * white（它与 soul 原本同为 teal），kinesis 与 earth 才没有在 transmutation 里撞成
 * 一支 28 的桶。**只做 D4 不做 D6 是 11 个文件 / 最大桶 28。**本轮不为了拆桶去动学派
 * 归属：配一个语义错的学派比留一个大桶更糟。
 *
 * 另一件本轮不碰、留给 D6 的事：12 支里有 4 支落在 dark_* 分支上（实测 darkLuma
 * necromancy.dark_purple **37.2** / transmutation.dark_blue 57.7 / dark_green 63.8 /
 * divination.dark_green 64.1，而 regular 支是 123-167）。这是**颜色轴**的问题不是学派
 * 轴的——改造前 `evocation.loop` 一支上同样有三支 dark，本条没有让它变坏。
 * 顺带记一条对下游有用的实测：八个学派的 loop 段 `flashRatio` 全是 1.00-1.01，
 * **不自带爆闪**，所以 cast→impact 不存在双闪，不必像 `cast.spell.iconic` 那样错峰。
 */
export const RUNE_SCHOOL = Object.freeze({
  control:      "enchantment",
  illusion:     "illusion",
  death:        "necromancy",
  oblivion:     "necromancy",
  illumination: "divination",
  soul:         "divination",
  kinesis:      "transmutation",
  earth:        "transmutation",
  flame:        "evocation",
  frost:        "evocation",
  storm:        "evocation",
  life:         "evocation"
});

/**
 * 标志性法术（`iconicSpell` 标签）的色轴（D8）。
 *
 * `iconicSpell` 覆盖 15 条动作、**在本轮之前零规则读取**（施工清单 §4.4「44 种标签未读」
 * 里条数第四多的一个）。它们是**具名法术**而不是符文合成法术：`s.spell` 为 null，因此
 * `spell.composed`（pri 700，`when: s => s.spell !== null`）够不着；又因为 `isAttack`
 * 为真且有目标，pri 10 的 `generic.cast` 也主动让路——**15 条里 11 条施法者身上一片空白**。
 *
 * 素材固定一支奥术符文环，色轴按动作 id 分——与 `self-shapes.mjs` 的 `STANCE_COLOR`
 * 同一个手法（id 是 Crucible 的物品 slug，稳定且翻译不动它）。**只写读得出理由的那几条**，
 * 表里没有的落到 build 里显式写死的 blue（不是留空——留空会去解析父节点取字母序第一个
 * 叶子，那是巧合不是选择），不硬凑：
 *
 * - `curse*` 六条（Atrophy/Delusion/Dullness/Exhaustion/Lethargy/Scorn）：id 前缀成族，
 *   与本文件外 `dirge*` 的前缀判据同型。诅咒走紫。
 * - `engulfingDarkness`：同样走紫——七支可用色（blue/green/orange/purple/red/yellow/
 *   white）里 purple 是唯一偏暗的一支，「吞噬黑暗」没有更近的选项。
 * - `dawnBeacon` → yellow（曙光）、`lifebloom` → green（生机绽放）：这两条正是施工清单
 *   §3.3「12 条无伤害类型的区域动作共用黄火花环」里点名的两个，语义色直接可读。
 * - `invisibility` / `protectiveMirage` → white：两条都是「让人看不见/看错」，白是这一族
 *   唯一的无彩色分支（`COLOR_HUE.white = -1`，灰阶语义，不参与最近色计算）。
 * - `bindArmament` / `conjureArmament` → orange：给武器灌注/召出武装，取锻火色。
 */
export const ICONIC_COLOR = Object.freeze({
  curseAtrophy: "purple", curseDelusion: "purple", curseDullness: "purple",
  curseExhaustion: "purple", curseLethargy: "purple", curseScorn: "purple",
  engulfingDarkness: "purple",
  dawnBeacon: "yellow",
  lifebloom: "green",
  invisibility: "white", protectiveMirage: "white",
  bindArmament: "orange", conjureArmament: "orange"
});

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
   * 通用施法圈：任何法术的默认起手，**学派选形、符文色选色**。
   *
   * jb2a.magic_signs.circle.02.<学派>.loop 逐帧 alpha 恒定 54.5、首尾无渐变，
   * ASSET-NOTES 确认是真无缝 loop，因此可以在任意一点截断而不会露接缝，
   * duration 定在 1500ms 是给起手一个合理长度，不必播完 121 帧 @24fps=5.04s 的全程。
   * 选材阶段实测八个学派同规格（121f@24fps、离散度 0.000），这段时序论证对八支通用。
   *
   * 【D4】学派这一层此前完全没有参与派发（14/17 个手势共用 evocation 一支）。
   * 表与逐条判据见文件头的 `RUNE_SCHOOL`。兜底到 evocation 而不是抛错：将来 Crucible
   * 加了新符文时，新符文会拿到「元素放射」这个最中性的学派，而不是整条 cue 消失。
   */
  {
    id: "spell.composed", pri: 700,
    when: s => s.spell !== null,
    build: (s, ctx) => {
      const school = RUNE_SCHOOL[s.spell?.rune] ?? "evocation";
      const fx = ctx.pick(SCHOOL_CIRCLE[school], {color: ctx.runeColor()});
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
      return [...actionSound(s, ctx), {
        file: fx.file,
        objectScale: 0.6 * ctx.geom.sizeScale(),
        attachTo: true, fadeIn: 150, fadeOut: 300, zIndex: 65,
        duration: 1350,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null,
        waitUntilFinished: -250
      }];
    }
  },

  /**
   * 标志性法术：施法者身上的奥术符文环（D8）。
   *
   * ## 冲的是什么
   *
   * `iconicSpell` 标签覆盖 15 条动作，本轮之前**零规则读取**。这些是具名法术而不是
   * 符文合成法术，`s.spell` 为 null，`spell.composed` 的 `when` 够不着；而它们
   * `usage.isAttack === true` 且有目标，`generic.cast` 的守卫又主动让路——实测 15 条里
   * 只有 `revive`（带 healing 标签）拿得到画面，**另外 11 条施法者身上一片空白**
   * （其中 6 条命名诅咒只剩目标身上的 impact 层）。
   *
   * ## pri 410 的位置
   *
   * 夹在 `tag.healing`(420) 与 `self.shape`(400) 之间，两侧都是有意的：
   * - 让 420 在上——`revive` 同时带 `healing` 与 `iconicSpell`，「这是在治疗」比
   *   「这是个具名法术」更具体，手部绿光该赢。
   * - 让 400 在下——`invisibility` / `protectiveMirage` / `bindArmament` /
   *   `conjureArmament` 四条 self 目标的具名法术此前落在通用升腾光条上，
   *   「具名法术」比「对自己做了点什么」更具体，符文环该赢。
   *
   * ## 素材与时序
   *
   * `eskie.casting.arcane.01.center.one_shot`：800x800、36 帧 @24fps = 1.5s、7 个纯色
   * 分支。ASSET-NOTES 读图：f8-f19 符文环张开旋绕（全画布 alpha 稳在 57.6），f20 中心
   * 一次四角星芒爆闪再向外散开；质心恒在正中，最外圈 alpha ≤1，不切边。选 `.center`
   * 而不是 `.side`——记录里那条坑写得很清楚：`.side` 才是竖立窄椭圆，`.center` 才是
   * 正圆，「压扁 = 俯视」的直觉在这一族是反的。
   *
   * ⚠ **双闪**：ASSET-NOTES 坑一「素材自带 f20 中心爆闪，cast 之后紧接 impact 闪光会
   * 双闪，要么错开 0.3s 要么砍掉其中一个」。这 15 条里 11 条有目标、会出 impact 闪光，
   * 所以走「错开」而不是「砍掉」——爆闪落在 833ms（f20 @24fps），
   * `waitUntilFinished: -300` 让下一段在 1500−300 = 1200ms 起，两次闪光相隔 367ms，
   * 越过 0.3s 那条线。**改 duration 之前先重算这个差**：砍短素材会把爆闪连同间隔一起
   * 砍掉，反而更容易撞上。
   *
   * 色轴见文件头的 `ICONIC_COLOR`。
   */
  {
    id: "cast.spell.iconic", pri: 410,
    when: s => s.tags?.includes("iconicSpell"),
    build: (s, ctx) => {
      // 兜底色显式写 blue 而不是留空：`ctx.pick` 不带 color 时解析的是父节点，取的是
      // 「第一个叶子」——那是字母序的偶然结果，不是选择。blue 是七支里 darkLuma 141.6
      // 的中性一支（purple/red 只有 82，暗底上糊）。
      const fx = ctx.pick("eskie.casting.arcane.01.center.one_shot",
                          {color: ICONIC_COLOR[s.id] ?? "blue"});
      if (!fx) return null;
      return [...actionSound(s, ctx), {
        file: fx.file,
        objectScale: 1.3 * ctx.geom.sizeScale(),
        belowTokens: true, fadeIn: 200, fadeOut: 400, zIndex: 20,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null,
        // 36 帧 @24fps、空尾 2 → 裁掉空尾是 (36−2)/24 = 1417ms。**必须显式给 duration**：
        // 带 waitUntilFinished 的 cue 在多目标计划里要把交棒点算成绝对时刻，没有 duration
        // 时长按 0 计，resolve 会留告警（coverage.test.mjs「plan.warnings 恒为空」会红）。
        duration: 1417,
        // 爆闪在 f20 = 833ms；交棒点 1417−250 = 1167ms，与爆闪相隔 334ms，越过
        // ASSET-NOTES 坑一要求的 0.3s。**动这两个数中的任何一个都要重算这个差。**
        waitUntilFinished: -250
      }];
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
      // 【D7】表项可以带三个可选覆盖：`objectScale`（不同族画幅差到 400 与 800，1.1 这个
      // 默认值是按 eskie.buff 那族的画幅定的，法阵族要更大才立得住）、`belowTokens`
      // （地面法阵要压在 token 下方，随之把 zIndex 落到与其它地面圈同层的 20）、
      // `waitUntilFinished`（自带爆闪的素材要给下一段留错峰）。**没写的仍走原来的默认值**，
      // 所以这次扩展对已有的四簇（架势/英雄气概/吟唱/召唤/通用光条）逐字节不变。
      const below = shape.belowTokens === true;
      const cue = {
        file: fx.file,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null,
        objectScale: (shape.objectScale ?? 1.1) * ctx.geom.sizeScale(),
        fadeIn: 150, fadeOut: 300,
        belowTokens: below,
        zIndex: below ? 20 : 40
      };
      if (Number.isFinite(shape.waitUntilFinished)) cue.waitUntilFinished = shape.waitUntilFinished;
      // 【批 E】起手音摊在画面之前。声音的分档表**不与本规则同轴**（见 self-shapes.mjs 的
      // `actionSoundFor`）：这一条规则接住的 57 个动作在声音上被拆成 12 档，
      // 「架势」听雷/火/冰/土，「召唤」听林木苏醒，「吟唱」听人声，其余才走中性档。
      return [...actionSound(s, ctx), cue];
    }
  },

  /**
   * 无符文法术的**兜底音轨**（批 E · §4.1）—— 只出声，不出画面。
   *
   * ## 冲的是什么
   *
   * 语料里 `tags` 含 `spell` 但 `s.spell === null` 的动作有 28 条，其中 12 条
   *（motivate / ennervate / mould / enkindle / condense / reveal / seeming / propel /
   * bloom / erase / energize + 反应类的 counterspell）**一条 cast cue 都拿不到**：
   * 它们的 `usage.isAttack` 恒为 true 且有目标，pri 10 的 `generic.cast` 主动让路
   * （`if (s.usage.isAttack && s.targets.length) return null`），而
   * `resolve.mjs:130` 的 `firstMatch` **只看 `when`**——build 返回 null 不会继续往下找，
   * 所以在 `generic.cast` 之下再挂一条低 pri 兜底是**够不到的**，必须挂在它上面。
   *
   * ## pri 395 的位置
   *
   * 夹在 `self.shape`(400) 与 `cast.target.single`(390) 之间，两侧都是有意的：
   * - 让 400 在上——`evoke` 同时是 self 目标的 spell 标签动作，它该继续走自身形制画面
   *   （那条规则同样会给它配起手音，走的是同一张分档表）。
   * - 让 390 在下——这 12 条全是 `isAttack === true`，`cast.target.single` 的 when
   *   本来就排掉了它们；写在上面只是让「谁接住谁」在优先级上一眼可读，不靠隐式保证。
   *
   * ## 为什么只出声不出画面
   *
   * 这 12 条**画面上并不缺**：它们有目标，impact 槽的 `impact.layered` / `generic.impact`
   * 会在目标身上出内容。缺的只有「施法者这边什么都没发生」这一半。再给一层 cast 画面会
   * 直接抬高 `test/fallback-ratchet.test.mjs` 的兜底 cue 计数（那条棘轮只数画面 cue），
   * 而画面派发质量并没有变好——本轮不越这个界。
   */
  {
    id: "spell.wordless", pri: 395,
    when: s => !s.spell && !!s.tags?.includes("spell"),
    build: (s, ctx) => {
      const cues = actionSound(s, ctx);
      return cues.length ? cues : null;
    }
  },

  /**
   * 指向某个目标的**非攻击**动作：施法者身上的向心蓄力（D8）。
   *
   * ## 冲的是什么
   *
   * 施工清单 §3.3：`single` 目标的非攻击动作 **21 条无规则接管，占 38 条全兜底的 55%**
   * ——这是「其它动作」块里最大的一片空白。实测语料 18 条落在 `generic.cast` 上：
   * 格挡/拦截/抢位一类反应（`artfulParry` / `intercept` / `interpose` /
   * `conserveMomentum` / `slipperyEscape` / `sacrificeSelf` / `eruptiveRecall`）、
   * 指名类（`markForDeath` / `challenge` / `vowOfAnimus` / `tacticalPlan` /
   * `getBehindMe`）、观察类（`assessStrength` / `intuitWeakness`）与几条带伤害类型的
   * 单体动作（`ensnare` / `bewilderingGaze` / `searingStare` / `sentinelKick`）。
   *
   * ## 判据
   *
   * `target.type === "single"` **且** `usage.isAttack === false`。后半条是硬要的：
   * 语料里 20 条带 `skill` 标签的单体动作 `isAttack` 全为真，不排掉就会把 pri 380 的
   * `tag.skill` 整片抢过来（那 20 条本来有自己的规则，抢过来是纯倒退）。武器攻击同理。
   * 再加 `!s.spell`——符文合成法术归 `spell.composed`(700)，那条 pri 更高本来也轮不到
   * 这里，写出来是为了让判据自己读得懂，而不是靠优先级隐式保证。
   *
   * ## 为什么不排「不该被察觉」的那三条
   *
   * `markForDeath` / `assessStrength` / `intuitWeakness` 带 `undetectable`，HANDOFF:65-71
   * 把「给不该被察觉的动作播命中特效」定性为规则层面的错。那条禁的是**目标身上**的
   * 命中特效——cast 槽按定义锚在施法者自己身上（见文件头），播的是「他在盯着谁」而不是
   * 「谁被标记了」，正落在那条判据的「只在施法者身上出」这一支里。真要排掉也没有意义：
   * 排掉只会掉回 `generic.cast`，那同样是一圈画在施法者身上的脉冲。
   *
   * ## 素材与时序
   *
   * `jb2a.cast_generic.02`：400x400、21 帧 @30fps = 700ms、4 色（dark_purple / dark_red /
   * blue / green）。选它而不是同族 `.01`（`generic.cast` 在用）有两个实测理由：
   * 1. **方向相反**：`.02` 是向心收拢（alpha 加权半径 f1 的 43.3 收到 f8 的 22.1），
   *    `.01` 是先炸开再收回。「聚神对准某个人」是收，不是炸。两条规则因此在同族里也
   *    看得出区别，不是换个颜色糊弄。
   * 2. **不自带爆闪**：ASSET-NOTES 坑二明确「全程无爆发闪光，预乘亮度平顶缓降、无单帧
   *    尖峰」。这 18 条**全部**会出 `generic.impact` 的白闪，选一支自带爆闪的素材
   *    （如 `eskie.casting.physical.01`，它 f18 那一下正是为「出手」设计的）就会双闪。
   *
   * 不掐 ASSET-NOTES 建议的 endTime f8（约 270ms）：那条建议是给「只要收拢不要外抛」的
   * 用法的，而这里 f9-f10 那一圈外抛粒子（半径回弹到 27.5、全片 alpha 峰值 51.1）正好
   * 读作「话/意图递出去了」，是想要的那一下；`waitUntilFinished: -350` 让 impact 压在
   * 塌缩段（f11-f18）上。
   *
   * 色轴走伤害类型（`ctx.damageColor()`），没有伤害类型的走素材第一支——不按动作 id 编
   * 色表：这 18 条里 14 条 `damageType` 为 null，编出来的只能是 14 条各不相同的主观色。
   */
  {
    id: "cast.target.single", pri: 390,
    when: s => s.target?.type === "single" && !s.usage?.isAttack && !s.spell,
    build: (s, ctx) => {
      // 无伤害类型时显式落 blue，理由同 cast.spell.iconic：不带 color 会解析父节点取
      // 第一个叶子，这一族的第一个叶子恰是 dark_purple（darkLuma 47.9，四支里最暗的
      // 一支，blue 是 86.7）——把 14 条无伤害类型的动作扔给最暗的那支不是选择，是巧合。
      const fx = ctx.pick("jb2a.cast_generic.02", {color: ctx.damageColor() ?? "blue"});
      if (!fx) return null;
      return [...actionSound(s, ctx), {
        file: fx.file,
        objectScale: 1.0 * ctx.geom.sizeScale(),
        fadeIn: 120, fadeOut: 250, zIndex: 45,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null,
        // 21 帧 @30fps、空尾 1 → 裁掉空尾 (21−1)/30 = 667ms。显式 duration 的必要性
        // 同 cast.spell.iconic（多目标交棒点要算绝对时刻）。
        duration: 667,
        // 交棒点 667−250 = 417ms，落在 f12-13 的塌缩段起点：f9-f10 那一圈外抛粒子
        // （全片 alpha 峰值 51.1）已经放完，impact 压在「收回去」这一段上。
        waitUntilFinished: -250
      }];
    }
  },

  {
    id: "tag.skill", pri: 380,
    when: s => s.tags?.includes("skill"),
    build: (s, ctx) => {
      const fx = ctx.pick("blfx.spell.cast.light_flare.1.center.color3");
      if (!fx) return null;
      return [...actionSound(s, ctx), {
        file: fx.file,
        objectScale: 1.4 * ctx.geom.sizeScale(),
        fadeIn: 150, fadeOut: 250, zIndex: 55,
        duration: 1300,
        waitUntilFinished: -200
      }];
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
      // 【D7 未完的一半，别当成漏写】`self-shapes.mjs` 的 `SYSTEM_NO_SELF_SHAPE` 把
      // move / fall / delay 三条从自身形制表里摘了出去（理由逐条写在那边），但**摘出去
      // 只是让它们从「升腾光条」换成这里的中性脉冲，不等于静默**——本条 pri 10、
      // `when` 恒真。
      //
      // 真正的静默（`if (SYSTEM_NO_SELF_SHAPE.has(s.id)) return null`）写在这里只有一行，
      // 但它会同时弄红三条**跨文件的**下限守卫，那三条都不在本轮的改动范围内：
      //   · `test/coverage.test.mjs:20`「每个动作都解析出至少一个 cue」——这是仓库级
      //     不变式，让三个动作零 cue 等于改这条不变式本身，得先有人拍板；
      //   · `test/geom-guard.test.mjs` 的 `zeroTargetPlans` 下限 428 与 §3.1 的同一个数
      //     ——静默会让它掉到 425，那两条 ∀ 断言的前提集合守卫立刻报「塌了」。
      // 三处数字都已量好交进 blockers，等一起改。**在那之前这里保持出内容**，
      // 让 fall/delay/move 落在最抽象的一支上，而不是读作「他获得了增益」。
      const fx = ctx.pick("jb2a.cast_generic.01", {color: ctx.runeColor() ?? "blue"});
      if (!fx) return null;
      // 【批 E】起手音摊在画面之前，而且**必须写在上面那条早返回之后**：早返回挡住的是
      // 「有目标的攻击动作」（武器挥击、法术命中），它们的声音归 travel/impact 两槽
      // （风声 + 命中音）。在这里给它们再加一层 cast 床垫，等于每一次挥刀前先响一段施法音。
      return [...actionSound(s, ctx), {
        file: fx.file, objectScale: 0.9 * ctx.geom.sizeScale(),
        fadeIn: 200, fadeOut: 400,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null
      }];
    }
  }
];
