/**
 * 非武器非法术动作的形制表 —— 「这不是打人，那是在干什么」。
 *
 * ## 这一块是最大的空白
 *
 * 全量语料 434 个动作里，武器 69 条、法术 204 条，剩下 **161 条「其它动作」**——
 * 其中 **104 条只播通用兜底**。按条数它比法术与状态加起来还多。
 *
 * 它们不是没有判别信息：这 104 条在快照原始字段上能区分出 **77 种**。形状高度集中：
 *
 * | target.type | 条数 | 是什么 |
 * | --- | --- | --- |
 * | `self` | 51 | 架势、自身增益、变形、系统默认动作 |
 * | `single` | 21 | 反应类（格挡 / 拦截 / 抢位） |
 * | `pulse` | 12 | 以自己为中心的爆发 |
 * | `summon` | 8 | 召唤 |
 * | `aura` | 7 | 吟唱光环 |
 * | `movement` / `none` / `blast` | 5 | 位移与其它 |
 *
 * 本文件只管前四类里判据最硬的几簇；剩下的仍走兜底，**不硬凑**。
 */
import {DAMAGE_COLOR} from "../resolver/palette.mjs";

/**
 * 四大元素架势。
 *
 * 按**动作 id** 派发。这与武器按 `system.identifier` 派发是同一件事：Crucible 的动作 id
 * 是物品 slug，稳定且翻译不动它（Babele 译的是 `name`）。这四条动作既没有 `damageType`
 * 也没有元素标签，id 是唯一的判据。
 */
export const STANCE_COLOR = Object.freeze({
  stormStance:  "blueyellow",   // 雷
  cinderStance: "orange",       // 火
  waterStance:  "blue",         // 水
  stoneStance:  "dark_green"    // 土
});

/** 架势的光环素材。9 色、55 帧 @30fps，**中心 55 帧全透明**，不挡 token 的脸。 */
export const STANCE_RING = "jb2a.on_token_buff.002.001";

/**
 * 英雄气概类动作：`adrenalineSurge` / `decisiveAction` / `gambitAllIn` / `coldFocus` /
 * `flashBrilliance` / `unshakeablePoise` 等，判据是 `cost.heroism > 0`——花英雄点是
 * Crucible 里最重的一类决定，画面上该看得出来。
 *
 * 素材是升腾的剑形符号（`eskie.buff.one_shot.attack` 的峰值帧上确实是一排剑）。
 */
export const HEROISM_SURGE = "eskie.buff.one_shot.attack";

/** 通用自身增益：升腾的光条，最克制的一支。 */
export const SELF_BUFF = "eskie.buff.one_shot.simple";

/**
 * 吟唱光环：`songOf*` 三首增益、`dirgeOf*` 三首减益，外加 `terrifyingPresence`。
 * 判据是 `vocal` 标签 + aura/pulse 形状。
 *
 * 素材是锯齿状的音波环（`jb2a.soundwave.02`，8 色、62 帧 @24fps）。
 * **⚠ 24fps 不是 30**——按 30 算会短算 20%。
 */
export const VOCAL_WAVE = "jb2a.soundwave.02";

/**
 * 召唤法阵：`jb2a.magic_signs.circle.02.conjuration.intro`（12 色、85 帧 @24fps）。
 * 取 `intro`（法阵浮现）而不是 `complete`（265 帧 = 11 秒的持续版）——召唤是一次动作，
 * 不是一个持续状态。
 */
export const SUMMON_CIRCLE = "jb2a.magic_signs.circle.02.conjuration.intro";

/**
 * 系统默认动作里**不该出「自身形制」画面**的三条（D7）。
 *
 * 这三条不是「暂时没选到素材」，而是**给了就是错的**，理由各不相同，逐条记：
 *
 * - **`fall`（坠落）——原生已经覆盖，我们再叠一层就是双份。**
 *   `systems/crucible/module/hooks/action.mjs:758` 在 `usage.fall.distance > 0` 时把这条
 *   动作交给 `canvas/vfx/landing.mjs`，那边按落差生成 2500–10000 粒尘埃。本模组的
 *   `trigger/wrap.mjs` 只在原生返回空时接管，但 cast 槽不走那条通路——`self.shape` 会在
 *   坠落者身上叠一圈升腾光条，读作「他获得了某种增益」，与「摔在地上」正好相反。
 *   `distance === 0` 时原生返 null、什么都不播，那也正是「什么都没发生」的正确表现。
 *   **两种情况下我们都不该出画面**，所以是无条件排除，不是「等原生失败再补」。
 *
 * - **`delay`（推迟行动）——源码里它什么都没做。**
 *   `const/action.mjs:1467-1475` 的定义只有 id/name/img/target，**没有 cost、没有
 *   effects、没有 tags**。它改的是先攻顺序这一层账，角色身上一个字段都没动。
 *
 * - **`move`（移动）——Foundry 自己已经在动 token 了。**
 *   `const/action.mjs:1419-1428`：`target.type === "none"`、`tags: ["movement"]`，
 *   动作本身的全部效果就是位移，而位移的动画由 Foundry 的 token 移动承担。
 *   再在起点叠一圈光条，等于给「走了两步」配一段施法特效。
 *
 * ⚠ **进了这张表 ≠ 静默，本轮只做到「不出自身形制」这一半。** `cast` 槽 pri 10 的兜底
 * `generic.cast` 的 `when` 恒真，这三条落到它手里仍会播一圈**通用脉冲**——比升腾光条
 * 中性得多（读作「动作开始了」而不是「他获得了增益」），但仍不是零。
 *
 * 补上另一半（`generic.cast` 里 `return null`）只要一行，卡住它的是三条**跨文件**的
 * 下限守卫，都不在本轮改动范围内，数字已量好交进 blockers：
 *   · `test/coverage.test.mjs:20`「每个动作都解析出至少一个 cue」——这是仓库级不变式，
 *     让三个动作零 cue 等于改这条不变式本身；
 *   · `test/geom-guard.test.mjs` 的 `zeroTargetPlans` 下限 428 与 §3.1 用的同一个数
 *     ——静默后实测掉到 425，两条 ∀ 断言的「前提集合塌了」守卫会立刻报警。
 * 见 `armory/cast.mjs` 的 `generic.cast`，两处必须一起看。
 */
export const SYSTEM_NO_SELF_SHAPE = Object.freeze(new Set(["move", "fall", "delay"]));

/**
 * 系统默认动作专属画面表（D7）。
 *
 * 冲的是「28 条共用同一支蓝色升腾光条，其中 11 条是系统默认动作」。这 11 条来自
 * `systems/crucible/module/const/action.mjs:1402` 的 `DEFAULT_ACTIONS`——**一个封闭且
 * 稳定的集合**，按 id 派发与 `STANCE_COLOR` 是同一个手法（id 是物品 slug，Babele 译的是
 * `name`，翻译不动它）。
 *
 * 只登记「素材能对上语义」的那几条，其余留在通用光条上——**兜底好过错配**：
 *
 * | id | 源码依据 | 给什么 | 为什么 |
 * | --- | --- | --- | --- |
 * | `cast` | `:1405` 通用施法动作，img 是 air-smoke-casting | 奥术符文环 | 它就是「起手施法」本身，符文环张开正是这个语义 |
 * | `recover` | `:1548` 回 health/morale/focus 三池 | 医疗十字上升 | 素材峰值帧是四枚医疗十字自下升起，与「回资源」逐字对上 |
 * | `rest` | `:1580` 长休回满 | 同上 | 与 recover 同语义，共用一支不算复用过头（两条动作一支素材） |
 *
 * **没有登记的四条与原因**（都记进了交接的 blockers，不是遗漏）：
 * `defend`（`:1445` 挂 `guarded` 状态）要的是盾形，`eskie.buff.one_shot.defense` 正是盾，
 * 但**选材阶段没有登记它**；`reload` / `investiture` 同理缺对口素材；`escape`
 * （`:1479` tags 含 `skill`/`athletics`）本该让位给 pri 380 的 `tag.skill`，但那要动
 * `self.shape` 与 `tag.skill` 的优先级关系，不在 D7 范围内。
 *
 * ⚠ **语料与源码对不上，别拿语料当依据**：`test/fixtures/actions.json` 里这 11 条的
 * tags 一律被合成成 `["generic"]`、cost.action 一律 1、target 一律 self，而源码里
 * `recover`/`rest`/`investiture` 是 `noncombat` + 0 AP、`throwWeapon` 是 `cost.weapon`。
 * 因此本表的查表**放在 noncombat / 0 AP 那些闸门之前**：按真实快照，recover/rest 会被
 * `noncombat` 挡掉，那正是它们最需要这个画面的时候（战后恢复）。
 *
 * @type {Readonly<Record<string, {path: string, color: string|null, objectScale?: number,
 *   belowTokens?: boolean, waitUntilFinished?: number}>>}
 */
export const SYSTEM_DEFAULT = Object.freeze({
  // 800x800、36 帧 @24fps = 1.5s。ASSET-NOTES：f8-f19 符文环张开旋绕稳在 alpha 57.6，
  // f20 中心一次四角星芒爆闪。`cast` 的 target.type 是 none（`:1411`），不会有 impact
  // 槽的闪光跟它撞，所以这条**保留自带爆闪**，不像 cast.spell.iconic 那样要错开。
  // 质心恒在正中、最外圈 alpha ≤1 不切边，压在 token 下方当地面法阵。
  cast: {path: "eskie.casting.arcane.01.center.one_shot", color: "blue",
         objectScale: 1.4, belowTokens: true},
  // 600x600、45 帧 @29.97fps = 1502ms，空头 2 / 空尾 10。ASSET-NOTES 读图：四枚医疗
  // 十字加两条竖光条自下往上升，中心不占位、不糊脸。固定 green——「恢复」是语义色，
  // 与 S4 aftermath 的治疗规则同色，不该被别的东西带偏。
  recover: {path: "eskie.buff.one_shot.health", color: "green"},
  rest:    {path: "eskie.buff.one_shot.health", color: "green"}
});

/**
 * 这个非武器非法术动作该出什么自身画面。
 *
 * @param {object} s 动作快照
 * @returns {{path: string, color: string|null, objectScale?: number, belowTokens?: boolean,
 *   waitUntilFinished?: number}|null} null = 不归本表管，走兜底
 */
export function selfShapeFor(s) {
  if (s?.spell || s?.cost?.weapon === true) return null;

  // 最先判：这三条是「给了就是错的」，任何下游分支都不该再把它们捡回去。
  if (SYSTEM_NO_SELF_SHAPE.has(s?.id)) return null;

  const stance = STANCE_COLOR[s?.id];
  if (stance) return {path: STANCE_RING, color: stance};

  // 系统默认动作查表。**刻意排在 noncombat / 0 AP 闸门之前**：源码里 recover/rest 是
  // noncombat + 0 AP（见 SYSTEM_DEFAULT 的表头注释），按闸门顺序写会被自己挡掉。
  const sys = SYSTEM_DEFAULT[s?.id];
  if (sys) return sys;

  const t = new Set(s?.tags ?? []);
  const shape = s?.target?.type;

  // 吟唱：vocal + 光环/脉冲。增益与减益靠颜色分开——songOf* 走蓝、dirgeOf* 走红。
  // 这里用 id 前缀而不是标签，是因为 Crucible 没有把「这是增益还是减益」写进快照。
  if (t.has("vocal") && (shape === "aura" || shape === "pulse")) {
    const dirge = String(s.id ?? "").startsWith("dirge");
    return {path: VOCAL_WAVE, color: dirge ? "red" : "blue"};
  }

  if (shape === "summon") return {path: SUMMON_CIRCLE, color: null};

  if ((s?.cost?.heroism ?? 0) > 0) return {path: HEROISM_SURGE, color: null};

  // 自身增益：排除掉本就不该有画面的（noncombat / rest 是纯账面动作，静默集见上）。
  //
  // 【D7 闸门放宽】原判据是单一的 `cost.action > 0`，它**按动作点收费与否**来判断
  // 「有没有真的做了什么」——这在 Crucible 里不成立：`const/action.mjs` 里反应类动作的
  // `cost.action` 是 0 甚至负数（反应是用「反应位」而不是动作点付账的），自由动作同样
  // 0 AP。实测语料里这一条把 8 条 0 AP 的反应/自由动作整片扫进了通用兜底，其中
  // `bodyBlock` / `defensiveRoll` / `shadowGait` 都是明明白白「对自己做了点什么」。
  //
  // 改成两条通路取并集，两条都直接读 Crucible 自己的字段，不猜：
  //   (a) **付了任何一种代价**：action / focus / health 三池任一 > 0（heroism 更上面
  //       已经单独接管了，走的是 HEROISM_SURGE 那支剑）；
  //   (b) **带 reaction / movement / spell 三个标签之一**——这三个标签的共同点是
  //       「代价不记在动作点上，但确实改变了角色的状态」：reaction 花的是反应位、
  //       movement 花的是移动、spell 花的是法术资源。
  //
  // 仍然**不放行**「三池全 0 且不带这三个标签」的那一类（`refocus` / `regurgitate`）：
  // 快照上一个可算的判据都没有，配什么都是猜——留给兜底。
  const spent = (s?.cost?.action ?? 0) > 0 || (s?.cost?.focus ?? 0) > 0 || (s?.cost?.health ?? 0) > 0;
  const stateful = t.has("reaction") || t.has("movement") || t.has("spell");
  if (shape === "self" && !t.has("noncombat") && !t.has("rest") && (spent || stateful)) {
    return {path: SELF_BUFF, color: DAMAGE_COLOR[s?.usage?.damageType] ?? null};
  }
  return null;
}

/* ==========================================================================
 * 动作声音分档表（批次 E · §4.1「128 条动作全程无声」）
 * ========================================================================== */

/**
 * **有意静音的五条**。
 *
 * 声效层重做方案 §4.1 把这五条显式登记成「不该发声」，理由逐条不同，都不是「暂时没选到
 * 素材」：
 *
 * - **`fall`（坠落）** —— 原生独占。`systems/crucible/module/hooks/action.mjs:758` 在
 *   `usage.fall.distance > 0` 时把这条动作交给 `canvas/vfx/landing.mjs`（按落差生成
 *   2500-10000 粒尘埃）。本模组在它身上**不出手**，画面如此（见上面 `SYSTEM_NO_SELF_SHAPE`），
 *   声音同理：叠一声起手音只会和原生的落地效果抢同一个时刻。
 * - **`move`（移动）** —— 位移的全部效果由 Foundry 的 token 移动承担，没有一个「开始移动」
 *   的时刻可以挂声音；挂上去等于给「走了两步」配一段施法音。
 * - **`delay`（推迟行动）** —— `const/action.mjs:1467-1475` 的定义没有 cost、没有 effects、
 *   没有 tags，它改的是先攻顺序这一层账，角色身上一个字段都没动。
 * - **`cast`（通用施法动作）** —— 它是系统的**占位**动作（`:1405`）。真正的法术各自带着
 *   12 支符文施法音（`sounds.mjs` 的 `CAST_SOUND`），再给占位动作配一支通用施法音，
 *   等于在每一次施法上多压一层。
 * - **`rest`（长休）** —— `:1580` 的长休是纯账面动作（noncombat + 0 AP），发生在战斗之外。
 *
 * ⚠ **与 `SYSTEM_NO_SELF_SHAPE` 不是同一张表，不要合并**：那张表管的是「不该出**自身形制
 * 画面**」（move/fall/delay），而 `recover`/`rest`/`cast` 在画面上是**有**内容的。
 * 两张表交出三条重合、各有两条不重合，正说明「该不该出画面」与「该不该出声」是两个
 * 独立判断。
 */
export const SILENT_ACTION = Object.freeze(new Set(["move", "fall", "delay", "cast", "rest"]));

/**
 * 架势 / 武器灌注的元素分档。
 *
 * 素材是 ggg 的 Weapon Power Up 五条（无元素 / Fire / Ice / Lightning / Poison）——
 * ASSET-NOTES:333 明写「这一支下面的五个叶子是**按元素路由的真分档，不是随机池**，
 * 所以每档只有一个文件是设计而不是缺陷」。所以这里按**动作 id** 逐条指派、不走随机池：
 * storm 该恒定是雷、cinder 该恒定是火，摇出来的架势音才是错的。
 *
 * 与 `STANCE_COLOR` 同源同轴（四条架势按 id 派发，理由见那边的注释），另加 `poisonBlades`
 * ——它不是架势，但它是语料里唯一一条「给武器附上一种元素」的动作，毒档正好空着，
 * 而这一族素材的厂商原名就是 Weapon Power Up。
 *
 * ⚠ 四档架势的响度是**齐的**（peakDb −10.9 / −11.3 / −9.9 / −9.4，归一化到 cast 目标后
 * 有效峰值 −19.8 / −20.9 / −19.5 / −18.4）。规格 §5.2 说「storm 架势注定最轻」指的是
 * 另一支（`ggg-sfx.magic.electricity.zap.01.01`，−18.0），选材阶段已复算推翻，
 * 见 ASSET-NOTES:335。
 */
export const STANCE_SOUND = Object.freeze({
  cinderStance: "ggg-sfx.abilities.buff.01.fire",
  waterStance:  "ggg-sfx.abilities.buff.01.ice",
  stormStance:  "ggg-sfx.abilities.buff.01.electricity",
  stoneStance:  "ggg-sfx.abilities.buff.01.misc",
  poisonBlades: "ggg-sfx.abilities.buff.01.poison"
});

/**
 * 动作起手音的**素材表**（档名 → DB 路径）。判据写在下面的 `actionSoundFor` 里，
 * 逐档的理由写在各自那一行的注释上；派发顺序即优先级，见 `actionSoundFor` 的表头。
 *
 * ## 为什么把路径抽成一张可枚举的表，而不是直接写在 if 链里
 *
 * 下游守卫要**从兵库现取**而不是手抄一份：`test/sound-result.test.mjs` 的
 * 「瞬态用的池，池内 peakMs 极差 ≤250ms」按构造理由豁免全部**床垫**类素材
 *（床垫走 `delay: 0` 起播、不做峰值对齐，池内峰值散到哪里都不改变「什么时候开始听见」），
 * 它的豁免名单是 `Object.values(CAST_SOUND) ∪ Object.values(GROUP_SOUND) ∪ …` 这样取的。
 * 本表也是床垫（`cast.mjs` 的 `actionSound` 同样是 `delay: 0` + 不经 `soundAt`），
 * 必须以同样的方式可枚举，换素材时守卫自动跟着走。
 *
 * ⚠ **每一条都必须在 `docs/ASSET-NOTES.md` 登记过**，且**必须写登记的那一级或它的父路径**
 *（`test/armory-assets.test.mjs` 机械拦截，写更深的单个叶子过不去）。
 */
export const ACTION_SOUND = Object.freeze({
  healing:   "psfx.1st-level-spells.cure-wounds.v1.001",
  summon:    "ggg-sfx.magic.primal.cast.animate_tree.01",
  vocal:     "psfx.casting.sound",
  mind:      "psfx.cantrips.mind-sliver.v1",
  heroism:   "ggg-sfx.abilities.fighter.flurry.01",
  athletics: "ggg-sfx.abilities.monk.qi_blast.01",
  skill:     "ggg-sfx.magic.arcane.cast.general.02",
  guard:     "ggg-sfx.abilities.misc.whip.01",
  dash:      "ggg-sfx.actions.movement.dash.02",
  curse:     "psfx.incantations.masculine.001.reverb.harm.001",
  iconic:    "psfx.casting.on-token.001",
  cantrip:   "psfx.casting.fire",
  burst:     "psfx.3rd-level-spells.fireball.v1.001.explosion",
  prep:      "psfx.casting.water",
  mark:      "psfx.impacts.magicaleffects.generic.002.001",
  selfBuff:  "psfx.casting.earth",
  neutral:   "psfx.casting.generic-v2.001.01"
});

/**
 * 动作声音的**分档表**。
 *
 * ## 冲的是什么
 *
 * 改造前 434 个动作里 **128 条全程无声**（29.5%），且全部落在 8 条「从来不发声」的规则上。
 * 其中归本文件与 `cast.mjs` 管的是 6 条：`self.shape`(57) / `generic.cast`(22) /
 * `tag.skill`(20) / `cast.target.single`(18) / `cast.spell.iconic`(14) / `tag.healing`(7)，
 * 外加 12 条**连 cast cue 都没有**的无符文戏法（`tags` 含 `spell` 但 `s.spell === null`，
 * `generic.cast` 的 `isAttack && targets.length` 判据主动让路，pri 更低的规则又永远够不到
 * ——`resolve.mjs:130` 的 `firstMatch` 只看 `when`，build 返回 null **不会**继续往下找）。
 *
 * ## 为什么是一张独立的分档表，而不是「一条规则配一条音」
 *
 * KPI 是**最大复用桶**，不是「加了几条规则」。一条规则配一条音会立刻造出一个 57 的桶
 * ——那正是本轮要拆掉的东西（改造前 `cast-generic-03.ogg` 一支管 136 个动作）。所以派发轴
 * **刻意与 cast 槽的规则表脱钩**：`artfulParry`（单体反应）与 `bodyBlock`（自身反应）
 * 落在两条不同的规则上，但它们是同一件事（架起防御），该听见同一层护罩；
 * 反过来 `laughingMatter` 与 `oozeMagneticDisarm` 同为 `tag.skill`，一个是精神嘲弄、
 * 一个是角力卸械，不该共用一条音。
 *
 * ## 判据全部读 Crucible 自己的字段，不猜
 *
 * `usage.damageType` / `usage.skillId` / `cost.heroism` / `target.type` / `tags`
 * ——与 `selfShapeFor` 用的是同一批字段，所以「画面分到哪一簇」与「声音分到哪一档」
 * 在同一份快照上可复算，不会各说各话。
 *
 * ## 顺序即优先级，写死在下面的 if 链上
 *
 * | # | 判据 | 素材（DB 路径） | 变体 | 本语料条数 |
 * | --- | --- | --- | --- | --- |
 * | 0 | `SILENT_ACTION` | —— | | 5（有意静音） |
 * | 1 | `STANCE_SOUND[id]` | `ggg…abilities.buff.01.{fire,ice,electricity,misc,poison}` | 5×1 | 5 |
 * | 2 | `tags.healing` | `psfx.1st-level-spells.cure-wounds.v1.001` | 1 | 7 |
 * | 3 | `target.type === "summon"` | `ggg…magic.primal.cast.animate_tree.01` | 4 | 8 |
 * | 4 | `tags.vocal` | `psfx.casting.sound` | 5 | 10 |
 * | 5 | 精神/威慑 | `psfx.cantrips.mind-sliver.v1` | 1 | 8 |
 * | 6 | `cost.heroism > 0` | `ggg…abilities.fighter.flurry.01` | 1 | 9 |
 * | 7 | 体术检定 | `ggg…abilities.monk.qi_blast.01` | 1 | 6 |
 * | 8 | `tags.skill` | `ggg…magic.arcane.cast.general.02` | 4 | 7 |
 * | 9 | `tags.reaction` | `ggg…abilities.misc.whip.01`（厂商名 Ability Shield） | 1 | 11 |
 * | 10 | `tags.movement` | `ggg…actions.movement.dash.02` | 4 | 6 |
 * | 11 | 具名诅咒 | `psfx.incantations.masculine.001.reverb.harm.001` | 1 | 6 |
 * | 12 | `tags.iconicSpell` | `psfx.casting.on-token.001` | 1 | 8 |
 * | 13 | 无符文戏法 | `psfx.casting.fire` | 5 | 12 |
 * | 14 | 区域爆发且带伤害类型 | `psfx.3rd-level-spells.fireball.v1.001.explosion` | 1 | 4 |
 * | 15 | `tags.noncombat` / `tags.rest` | `psfx.casting.water` | 5 | 5 |
 * | 16 | `target.type === "single"` | `psfx.impacts.magicaleffects.generic.002.001` | 1 | 9 |
 * | 17 | `target.type === "self"` | `psfx.casting.earth` | 5 | 19 |
 * | 18 | 其余 | `psfx.casting.generic-v2.001.01` | 1 | 5 |
 *
 * ## 三条选材硬约束，动表之前必须一起读
 *
 * 1. **每条路径都要在 `docs/ASSET-NOTES.md` 登记过**（`test/armory-assets.test.mjs` 机械拦截）。
 *    上表 22 条路径全部已登记：ggg 那 11 条是本批选材阶段新签的【E·其它】行，
 *    psfx 那 11 条是早前批次就签在主表里、**至今一次都没被引用**的（本轮第一次开采）。
 * 2. **每条素材归一化后的有效峰值必须落在 cast 角色现有的窗口内** `[−24.0, −16.8] dBFS`，
 *    且**峰均比 ≤13.5**。这不是口味：`test/sound-gain.test.mjs` 的「角色内跨度 ≤7.2」与
 *    「施法床垫峰均比 ≤13.5」是两条**零余量**的棘轮，越窗即红。本轮因此**否掉了四条
 *    语义更对的候选**，逐条记账：
 *    · `canim.mgs.basic.items.healing_potion`（选材总表给治疗档的首选）——峰均比 **15.0**、
 *      有效峰值 −15.0，两项都越线；改用同样登记过的 `cure-wounds`（峰均比 6.3、−23.7）。
 *    · `ggg-sfx.tasks.crafting.whetstone.sharpen.02`（磨刃，本该给「备战」档）——有效峰值
 *      **−25.7..−23.4**，比窗口下沿还轻 1.7 dB，进来会把 cast 跨度顶到 8.9。
 *    · `ggg-sfx.abilities.rogue.sneak_attack.01`（伏击）——峰均比 14.5 / 有效峰值 −15.5。
 *    · `psfx.weapon-swooshes.psychic.v1.group01`（精神风声）——4 条里 2 条 rmsDb **低于 −30**，
 *      在 cast 的 RMS 目标下 volume 顶上钳仍够不到，会给「欠额棘轮」再添两条（现值 17／上限 17）。
 * 3. **一个档只写「登记过的那一级或它的父路径」**，不写更深的单个叶子——ASSET-NOTES 闸
 *    只认那一级。
 *
 * ## 为什么整段回避 F 块（余波士气 6 档）与 D 块（状态层 12 组）的素材
 *
 * 那两块分别归 `aftermath.mjs` 与 `persist.mjs` 的规则。`terrifyingPresence` 用
 * `ggg-sfx.magic.occult.cast.fear.01`、`getBehindMe` 用 `ggg-sfx.abilities.commander.war_horn.01`
 * 在语义上都更对，但同一个动作会同时出 cast 与 aftermath 两槽——**同一支素材在一次动作里
 * 响两遍**比「配得不够贴」更糟。所以本表宁可退到中性档。
 *
 * @param {object} s 动作快照
 * @returns {{path: string}|null} null = 这条动作不发声（有意静音，或不归本表管）
 */
export function actionSoundFor(s) {
  // 符文合成法术已经各自带着 12 支施法音（`sounds.mjs` 的 `CAST_SOUND` / `spellCastSound`）。
  // 这里再出一条就是在同一时刻叠两层床垫。**判据用 `s.spell` 而不是 `tags.spell`**：
  // 后者还罩着 28 条「有法术标签但没有符文」的动作，那 28 条正是本表第 11-13 档要接的。
  if (!s || s.spell) return null;
  if (SILENT_ACTION.has(s.id)) return null;

  const stance = STANCE_SOUND[s.id];
  if (stance) return {path: stance};

  const t = new Set(s.tags ?? []);
  const shape = s.target?.type;
  const dmg = s.usage?.damageType ?? null;

  // 治疗排在最前（与 cast 槽让 `tag.healing`(420) 压过 `self.shape`(400) 同一个理由）：
  // 「这是在治疗」比后面任何一条判据都具体。素材是 psfx 的 cure-wounds，起音 150ms、
  // 峰值 260ms、有效内容到 3120ms —— 本表里唯一一条与用途逐字对上的（厂商就叫治疗术）。
  if (t.has("healing")) return {path: ACTION_SOUND.healing};

  // 召唤：`target.type === "summon"` 是硬字段，8 条召唤动作全在这里。
  // Animate Tree 001-004 是 4 变体真池（有效声长 1110-2440ms、peakDb Δ3.0）；
  // 刻意不用同层 Dark Conjure（Δ7.2、2270-4810ms，两项都不齐，见 ASSET-NOTES:346）。
  if (shape === "summon") return {path: ACTION_SOUND.summon};

  // 吟唱：`vocal` 是 Crucible 自己标的「这条动作要出声」。10 条（songOf* 三首、
  // dirgeOf* 三首、extollDeeds / dyingCall / maddeningShriek / challenge）共用
  // `psfx.casting.sound` —— psfx 施法族里的**声音系**那一支：5 变体、有效内容 2560-2640ms
  //（与 `VOCAL_WAVE` 的 62 帧 @24fps = 2583ms 几乎等长，这是选它而不是 fire/earth 的主要
  // 理由）、池内 peakDb Δ0.9 是四支 psfx.casting 里最齐的。
  // **不再按增益/减益切两档**：那要靠 id 前缀猜（songOf* vs dirgeOf*），而 5 个变体已经
  // 让同一位吟游诗人连唱三轮不重样，再切一刀只会让每档退回单文件。
  if (t.has("vocal")) return {path: ACTION_SOUND.vocal};

  // 精神冲击 / 威慑。判据是**伤害类型**这个硬字段（psychic / void 是 Crucible 仅有的两种
  // 精神伤害），外加 `presence`（气场）标签接住 `terrifyingPresence` / `bewilderingGaze`
  // 这类不造成伤害的威慑。排在 `tags.skill` 之前是有意的：`intimidate` / `scathingMockery` /
  // `laughingMatter` 都同时带 `skill`，但「这是一次精神攻击」比「这是一次技能检定」具体。
  if (dmg === "psychic" || dmg === "void" || t.has("presence")) {
    return {path: ACTION_SOUND.mind};
  }

  // 英雄气概：`cost.heroism > 0` 是 Crucible 里最重的一类决定 —— 与 `HEROISM_SURGE` 那支
  // 升腾的剑**同判据同源**，画面与声音不会各说各话。厂商名 1000 Sword Jutsu，一串快速
  // 刃鸣，起音 0ms、峰值 140ms，是本表里起得最快的一支。
  if ((s.cost?.heroism ?? 0) > 0) return {path: ACTION_SOUND.heroism};

  if (t.has("skill")) {
    // 体术检定单独一档：`skillId === "athletics"` 的 6 条（bullrush / grapple / overrun /
    // throw / tumble / oozeMagneticDisarm）是**用身体发力**，与「掐指一算」不是一回事。
    // 厂商名 Blast 的气劲掌击：有效声长 1180ms、起音 20ms、峰值 100ms。
    if (s.usage?.skillId === "athletics") return {path: ACTION_SOUND.athletics};
    // 其余技能检定：Abstract Reward 001-004，4 变体且**四条的团区间几乎逐帧一致**
    //（120-480 / 120-500 / 130-510 / 120-500ms），正合「同一个动作反复检定」的场景。
    return {path: ACTION_SOUND.skill};
  }

  // 防御反应：`reaction` 标签。路径写着 whip、厂商文件名却是 **Ability Shield**
  //（ggg 归错档，ASSET-NOTES:342 逐条记了），听感是一层护罩张开——正是格挡/拦截/抢位
  // 这 11 条要的那一下。⚠ 起音 230ms 是本轮登记里最晚的之一，所以 cue 构造一律用
  // `startTime = onsetMs` 跳掉起振前的静音（见 `cast.mjs` 的 `actionSound`）。
  if (t.has("reaction")) return {path: ACTION_SOUND.guard};

  // 位移：`movement` 标签。Abstract Dash 001-004，4 变体、起音 10-20ms、峰值 70-130ms
  // ——「一下就走」。刻意不用同层 `.03`（Abstract Move，池更齐但峰值 460-580ms 慢一拍）。
  if (t.has("movement")) return {path: ACTION_SOUND.dash};

  if (t.has("iconicSpell")) {
    // 六条具名诅咒（curseAtrophy / Delusion / Dullness / Exhaustion / Lethargy / Scorn）：
    // psfx 的 incantation 人声，分支名就是 **harm**（恶意咒语），本表语义最贴的一条。
    // 按 id 前缀派发与 `STANCE_SOUND` 同一个手法（id 是物品 slug，Babele 译的是 name）。
    if (String(s.id ?? "").startsWith("curse")) {
      return {path: ACTION_SOUND.curse};
    }
    // 其余具名法术：施法者身上的施法音（厂商路径就叫 on-token）。
    return {path: ACTION_SOUND.iconic};
  }

  // 无符文戏法：`tags` 含 spell 但 `s.spell === null` 的 12 条（motivate / ennervate /
  // mould / enkindle / condense / reveal / seeming / propel / bloom / erase / energize /
  // evoke）。它们**结构上不可能走 `spellCastSound`**（那条 `if (!s?.spell) return []`），
  // 是 128 条哑动作里唯一一批「连 cast cue 都没有」的。
  // 给 psfx 施法族的火档：5 变体、有效内容 1690-1750ms（四支 psfx.casting 里最短），
  // 戏法本来就该是短促的一下；`enkindle`（点燃）与它逐字对上，其余读作通用施法感。
  if (t.has("spell")) return {path: ACTION_SOUND.cantrip};

  // 区域爆发且带伤害类型：abyssalRemains / corruptingDeathBurst / radiantDeathBurst /
  // crushingLeap。四条的共同点是「一团东西在一片区域上炸开」，而 fireball 那一支
  // 起音 0ms、峰值 10ms（本表最早），爆点正好压在动作起手那一帧上。
  if ((shape === "pulse" || shape === "blast") && dmg) {
    return {path: ACTION_SOUND.burst};
  }

  // 非战斗准备：`noncombat` / `rest` 标签的 5 条（imbueAffix / amplifyAffix / fieldStudy /
  // wildspeak / webSpinner）。`psfx.casting.water` 5 变体、有效内容 4120-4160ms
  // ——**这一档正是「长」不算缺点的地方**：它们发生在战斗之外，没有别的东西在等着响。
  if (t.has("noncombat") || t.has("rest")) return {path: ACTION_SOUND.prep};

  // 指向某个人的非攻击：markForDeath / vowOfAnimus / tacticalPlan / getBehindMe /
  // assessStrength / intuitWeakness / ensnare / searingStare / sentinelKick。
  // 素材是 psfx 登记的**通用法术效果**音（不是武器命中）：起音 90ms、峰值 950ms，
  // 是一团缓起的「效果落定」而不是一记打击瞬态，而这 9 条的共同点正是「把一个不造成伤害的
  // 效果扣在某个人身上」。⚠ 它出身 impacts 目录，是本表里语义把握**最弱**的一档；
  // §2.3 收口重听时第一个该换的就是它（`psfx.conditions.boon.001.01` /
  // `psfx.conditions.generic-layer.001` 语义正对，但有效峰值 −16.7 / −16.6，
  // 分别只差 0.1 / 0.2 dB 就能进 cast 窗口，越窗即把角色内跨度顶到 7.4）。
  if (shape === "single") return {path: ACTION_SOUND.mark};

  // 自身增益兜底：`target.type === "self"` 的 19 条（变形 / 恢复 / 装填 / 持械 / 自我强化）。
  // 它们在画面上共用 `SELF_BUFF` 那一支克制的升腾光条，声音上同样走一支中性档
  // ——`psfx.casting.earth` 是四支 psfx.casting 里最「凝聚、低沉、不带元素画面感」的一支
  //（5 变体、有效内容 1670-1740ms、池内 peakDb Δ1.6）。
  // ⚠ **这一档是兜底不是选择**：真正对得上的是「增益上身」类素材，而唯一登记过的那一支
  //（`ggg-sfx.magic.arcane.buff.general.02`）归状态层 buff 组，同一个动作可能同时上一个
  // 增益状态，撞在一起会响两遍。等状态层落地后再重估。
  if (shape === "self") return {path: ACTION_SOUND.selfBuff};

  // 最后一档：既不指向人、也不作用于自己的那几条（abjure / directTheBrood /
  // inspireHeroism / servitorSending 等 pulse / none 形状）。`psfx.casting.generic-v2`
  // 是 psfx 施法族里最中性的一支，起音 20ms、峰值 210ms。
  return {path: ACTION_SOUND.neutral};
}
