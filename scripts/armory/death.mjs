/**
 * S6 death：击杀那一刻的**一次性**爆发。
 *
 * 【为什么它不在 aftermath 槽里】原来的 `aftermath.kill` 判据是
 * `target.effects.includes("dead")`，在实战中永远为假，两条独立的理由：
 *  1. 数据来源不对——`trigger/snapshot.mjs` 的 `target.effects` 来自 `ev.effects`
 *     （动作自带的效果载荷），而 `dead` 不走这条路：Crucible 在资源结算之后单独调
 *     `toggleStatusEffect("dead", {active: this.system.isDead})`
 *     （crucible/module/documents/actor.mjs:2926 的 #applyResourceStatuses）。
 *  2. 时序更没救——`configureVFXEffect()` 是在 `_prepareMessage()` 里被调用的
 *     （crucible/module/models/action.mjs:3286），那是**渲染聊天卡**的时刻，远早于
 *     `confirm()` 里的 `await this.#applyEvents({reverse})`（:2670）。建计划那一刻
 *     伤害还没结算，改读 `system.isDead` 同样是假。
 * 预测法也不可行：`isDead` 分两支——`usesReserveResources` 为真时是
 * `resources.wounds.value === resources.wounds.max`（models/actor-base.mjs:222），
 * 否则是 `resources.health.value === 0`（:223）；敌人还有一条覆写，
 * `abilities.toughness.value` 为 0 时**永不死**（models/actor-adversary.mjs:76-79）。
 * 在建卡时刻预测等于重新实现 Crucible 的伤害管线。
 *
 * 【改成事件驱动】`dead` 本身就是一枚真实的 ActiveEffect（上面那个 toggleStatusEffect
 * → `ActiveEffect.create`，foundry client/documents/actor.mjs:578），落地时会触发
 * `createActiveEffect`——本槽由那个钩子驱动（trigger/effects.mjs 的 playDeath），
 * 「什么算死」交给 Crucible 自己判，本模组不预测。同一个 `toggleStatusEffect` 在效果
 * 已经存在时走 `if (existing.length) { if (active) return true; … }`
 * （actor.mjs:567-568），不会重复创建，所以一次死亡**只发一次**。
 *
 * 【为什么单独一个槽，而不是塞进 persist】
 *  · `dead` 仍然留在 armory/persist.mjs 的 NO_PERSIST 里（Foundry 自带 dead overlay，
 *    不需要再画一圈光环）——本槽产出的是一次性 cue，`persist:false`、没有 tieTo；
 *  · 它没有「结束」语义：不需要 endEffect、不进 inFlight、也不该被 `resyncPersist` /
 *    `createToken` 补播（那意味着每次切场景、每具尸体都重放一遍爆发）。
 *    这条约束的落点在触发层：**只有** createActiveEffect 这一个入口会调本槽，
 *    test/effects-death.test.mjs 有专门的用例守着。
 *
 * 【规则形状】与 persist 槽相同的 `(e, ctx)` 签名，吃的是 `EffectSnapshot`
 * （trigger/snapshot.mjs 的 snapshotEffect），由 resolver/resolve.mjs 的
 * `resolveEffect(snapshot, deps, "death")` 装配。用真实快照而不是在触发层现编一份
 * ActionSnapshot：seed 由 `statusId + effectUuid` 决定，各客户端本地解析出的选材因此
 * 必然一致（本模组不广播这条计划，见 DESIGN §5.4）。
 */

import {poolFor, soundAt, gainFor} from "./sound-table.mjs";

/**
 * 与 `sounds.mjs:76` 的同名私有函数同式：显式池优先（ggg 那类并列编号子枝 `resolve`
 * 只拿得到第一个叶子），表里没有就退回单条路径。这里刻意抄一份而不是把那边的导出，
 * 是因为 `sounds.mjs` 整份都是**动作槽**的派发逻辑（吃 ActionSnapshot），
 * death 槽吃的是 EffectSnapshot，两边没有别的可共用的东西。
 */
function pickSound(ctx, path) {
  if (!path) return null;
  return ctx.soundFrom?.(poolFor(path)) ?? ctx.sound(path);
}

/**
 * 击杀的两层音。**这一槽改造前一条 sound 都没有**（`resolveEffect(46 条, "death")`
 * = plans 1 / cues 1 / sound 0）：死亡是战斗里最该有反馈的一刻，画面有一摊血泊，
 * 声音一片空白。
 *
 * ## 分两层的判据是频谱，不是「多放一条」
 *
 * 两层要能被耳朵分开，就得占不同的频段。逐文件复算 `data/audio-profiles.json` 的
 * `centroidHz`：
 *
 * | 层 | 素材 | 变体 | centroid | eff | peakDb |
 * | --- | --- | --- | --- | --- | --- |
 * | 倒地 | `psfx.impacts.bludgeoning.v1` | 4 | **824 / 1592 / 1862 / 2186** | 320-370 | −6.1..−6.2 |
 * | 血溅 | `psfx.impacts.slashing.v1` | 4 | **6674 / 6809 / 7264 / 8481** | 440-580 | −13.9..−15.8 |
 *
 * 两族质心比 **3.05×（最近的一对）到 10.3×（最远的一对）**，中位 7134/1727 = 4.1×——
 * 一个是低频闷响、一个是高频湿响，同刻叠加也各自听得见。
 *
 * ## 为什么是这两支（以及它们不是第一顺位）
 *
 * 语义上都对得上：`impacts.bludgeoning` 是**钝物砸在身体上**的闷响——尸体落地就是这件事；
 * `impacts.slashing` 是**刃入肉**的湿响，与画面那摊 `Blood_1_Splatter` 同源。
 *
 * ⚠ 但它们**不是选材阶段点名的那一对**。规格 §4.3 点的是
 * `ggg-sfx.impact.fall.general.01`（3 变体，eff 720/580/390，centroid 2237-3324）与
 * `ggg-sfx.impact.blood.02`（8 变体，centroid 12314-19910）——真·倒地音 + 真·血溅音，
 * 变体也深得多（3+8 对 4+4）。**那两条至今没有进 `docs/ASSET-NOTES.md` 主表**
 * （本轮选材的 66 行没覆盖 death 槽），`test/armory-assets.test.mjs` 会机械拦下，
 * 而那张表不归本批次改。所以本轮取「已登记、且已在 `SFX` 表里」的最接近的一对；
 * 那两条一旦登记，换过来只要改两个字符串常量——**已写进交付的 blockers**。
 *
 * ⚠ 代价是**复用**：这两支同时是 `sounds.mjs` 的 `HIT_SOUND.bludgeoning` /
 * `HIT_SOUND.slashing`。一记钝器击杀会先听到命中音、再听到同族的倒地音（不同变体，
 * death 槽用的是 EffectSnapshot 自己的种子，与动作那条 rngSfx 无关）。这是明账，
 * 不是没看见——owner 的口径是「需要复用直接用即可」，而 death 槽只有这一条规则。
 *
 * ## 两声的时刻：各自取「让全部变体同刻响」的那个值
 *
 * `soundAt(file, atMs)` 只能延迟、不能提前，实际响点是 `max(atMs, peakMs − onsetMs)`：
 *   · 倒地四支的 `peak − onset` 是 10/10/40/10 ⇒ **atMs 取 40**，四支一齐响在 40ms；
 *   · 血溅四支是 170/170/230/240 ⇒ **atMs 取 240**，四支一齐响在 240ms。
 * 于是两声间隔**恒为 200ms**，不随变体抖动——比「写 0 和 120 然后间隔在 130-230 之间乱跳」
 * 好，也仍在规格给的 100-200ms 区间上沿（同 §1.7「留给耳朵分辨两个瞬态」的 150ms 尺子
 * 是同一件事，这里因为素材起振晚而落在 200）。
 *
 * 播出窗不会超过画面：血溅最晚在 240 + 610 = **850ms** 收，画面血泊 1167ms。
 * 规格提的「血溅 duration 裁到 1000ms」在这一对上用不着——最长的 `playFor` 才 610。
 *
 * 响度走 `gainFor(file, "impact")`：倒地 −6.1 dB × 0.507 = **−12.0**（正好是 impact 档目标），
 * 血溅 −14.4 dB 顶上钳 volume 1.0 实得 **−14.4**（够不到 −12 是素材天花板，不假装）。
 * 倒地因此比血溅响 2.4 dB——主声在前、副声在后，层次是对的。
 * `?? 0.8` 是表里查不到时的退路，**不许静默按 1**（见 `gainFor` 的注释）。
 *
 * 【不会被 resync 重放】本槽只由 `createActiveEffect` 驱动（见文件头 §「改成事件驱动」，
 * 纪律落在 `trigger/effects.mjs:477-484`），新加的两条 sound 自动继承——不需要再加闸。
 */
const DEATH_FALL = "psfx.impacts.bludgeoning.v1";
const DEATH_BLOOD = "psfx.impacts.slashing.v1";
/** 让四个变体同刻响的最小 atMs，来自各族 `peak − onset` 的最大值（见上表推导）。 */
const FALL_AT = 40;
const BLOOD_AT = 240;

/**
 * 一条击杀音 cue。`soundAt` 查不到（素材没进 SFX 表）时退回 `delay: atMs`——
 * 不静默按 0，也不因此整条不出声。
 */
function killSound(ctx, path, atMs) {
  const s = pickSound(ctx, path);
  if (!s) return null;
  const t = soundAt(s.file, atMs);
  return {
    kind: "sound", file: s.file, soundRole: "impact",
    volume: gainFor(s.file, "impact") ?? 0.8,
    delay: t?.delay ?? atMs, startTime: t?.startTime ?? 0,
    duration: t?.playFor ?? null
  };
}

export default [
  /**
   * 击杀——在死者脚下铺一摊血泊，配倒地与血溅两层音。
   *
   * blfx.spell.template.circle.wave2.blood1.splatter.red：56 帧 @30fps=1867ms，
   * 1200x1200。ASSET-NOTES 最大的坑：「结尾不是淡出而是整摊血向中心收缩回去，帧 44→48
   * 迅速缩成一点」——不能播完整段，必须在收缩开始前用 duration 硬切再靠 fadeOut 收尾
   * （与 impact.mjs RESULT_LAYER.ARMOR 同一手法）。裁到 1167ms（约 f35，仍在「约帧 24
   * 达到满幅」之后的平台段，早于 f44 的收缩起点），fadeOut 给足 700ms 让血泊看起来是
   * 自然消退而不是被吸回去。fadeIn:0：素材本来就是从中心向外炸开的过程，天然渐显。
   * belowTokens:true——地面血泊应压在 token 之下。
   *
   * 【objectScale 1.38，原 1/3】旧值按「blfx 1200x1200 是 JB2A 400x400 的 3 倍」除出来，
   * 而那个前提在 Task 12 被推翻（见 armory/impact.mjs 结果层 canvas 一段）：播放层走
   * `e.scaleToObject(cue.objectScale)`，Sequencer 的 `_applyScaleToObject` 是
   * `sprite.width = 目标宽 × scale × baseScale`（sequencer.js:17189），源文件的像素尺寸
   * 只经宽高比参与、**不参与定尺寸**。objectScale 的真实含义是「画幅铺满 token 宽度的
   * 百分之几」，真正决定观感的是「内容占画幅比 × objectScale」。
   *
   * 按同一口径重新推导（逐帧实测，判据 alpha>=26 的包围盒，取内容峰值帧）：
   *   · 本素材 f27 的内容占画幅 0.837，旧值 1/3 ⇒ 可见跨度只有 0.28 个格宽——一具尸体
   *     底下四分之一格的暗红斑点，等于没有；
   *   · 同为地面层的 `aftermath.groundResidue`（jb2a.impact.ground_crack.still_frame.01，
   *     内容占画幅 0.887 × objectScale 1.3）可见跨度 1.153 个格宽。
   * 两条地面痕迹取等可见跨度：1.153 / 0.837 = 1.378 ⇒ **1.38**。attachTo + bindScale 让
   * 它随体型放大，大型怪的血泊按体型成比例铺开。
   *
   * 「1.153 格这个目标本身合不合适」（血泊该往尸体外溢出多少）是要上机肉眼裁定的，
   * 已记进 .superpowers/sdd/IMPLEMENTATION-PLAN/task-16-carried-items.md：本轮能离线
   * 定死的是「旧值错了、错在哪、按什么口径换算」，定不死的是审美目标。
   */
  {
    id: "death.kill", pri: 500,
    when: e => e.statusId === "dead",
    build: (e, ctx) => {
      const fx = ctx.pick("blfx.spell.template.circle.wave2.blood1.splatter.red");
      if (!fx) return null;
      // 音效排在画面之前：与全仓一致的 cue 次序（取画面要过滤 kind !== "sound"）。
      // 两层音各自可能取不到（素材包没装），取不到就少一层，不拖累其它两条。
      return [
        killSound(ctx, DEATH_FALL, FALL_AT),
        killSound(ctx, DEATH_BLOOD, BLOOD_AT),
        {
          file: fx.file, objectScale: 1.38, attachTo: true, bindScale: true,
          belowTokens: true, zIndex: 15, elevation: e.target?.elevation ?? null,
          duration: 1167, fadeIn: 0, fadeOut: 700
        }
      ].filter(Boolean);
    }
  }
];
