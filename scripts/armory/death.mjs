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

export default [
  /**
   * 击杀——在死者脚下铺一摊血泊。
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
      return {
        file: fx.file, objectScale: 1.38, attachTo: true, bindScale: true,
        belowTokens: true, zIndex: 15, elevation: e.target?.elevation ?? null,
        duration: 1167, fadeIn: 0, fadeOut: 700
      };
    }
  }
];
