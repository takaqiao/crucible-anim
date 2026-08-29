import {poolFor, contentEndOf} from "./sound-table.mjs";
import {NO_PERSIST, STATUS_GROUP, statusGain} from "./persist.mjs";

/**
 * S7 persistOff：状态**摘下**那一刻的一次性提示音。
 *
 * 【为什么需要第七个槽】改造前 `trigger/effects.mjs` 的 `endPersist()` 整个函数体只有
 * 一句 `Sequencer.EffectManager.endEffects({origin}, false)`——它不调 `snapshotEffect`、
 * 不调 `resolveEffect`、不构造 plan。也就是说「状态没了」这件事在本模组里**结构上就
 * 没有发声的位置**：光环无声地消失，玩家只能靠盯着状态图标发现。
 *
 * 让 `endPersist` 兼管发声是错的：清理与发声的失败模式完全不同。清理失败 = 一枚永远
 * 清不掉的光（必须无条件、必须极简、必须连 Sequencer 全局都不存在时也不抛）；发声失败
 * = 少响一声（可以有兵库、有随机池、有降级）。两件事挤在一个函数里，任何一侧的新逻辑
 * 都可能把另一侧拖垮。所以 `endPersist` 保持原样只管清理，发声走本槽。
 *
 * 【与 death 槽同构，但让路策略相反】
 *  · 同：都吃 `EffectSnapshot`（`trigger/snapshot.mjs` 的 `snapshotEffect`）、都由
 *    `resolveEffect(snapshot, deps, slot)` 装配、cue 都是 `persist:false` + 无 `tieTo`
 *    的一次性 cue（没有「结束」语义，不进 inFlight、不需要 endEffect）；resolver 骨架
 *    一行都不用动——`resolveEffect` 与 `planForEffect` 早就带 slot 参数。
 *  · **异**：`death` 走 `runPersistAnimation`（先让路），本槽**不让路、立刻播**。
 *    理由是时序方向正好相反：击杀爆发比造成它的那一击**更早**到达（Crucible 先落地
 *    ActiveEffect、后翻聊天卡 confirmed，见 const.mjs 的 PERSIST_LEAD_MS），不让路就是
 *    「先见血、后见挥剑」；而摘下音对应的画面（光环消失）是 `endPersist` 在**同一帧**
 *    做掉的，晚 500ms 再响一声，听起来与画面无关。落点在 `trigger/effects.mjs` 的
 *    `playPersistOff`。
 *
 * 【只由 deleteActiveEffect 驱动】
 *  · `resyncPersist` / `createToken` 是「把该有的稳态补齐」，接上一次性提示音 = 每次
 *    切场景都把全场状态摘一遍（同 death 槽的硬约束 1）；
 *  · `updateActiveEffect` 的 disable 分支**刻意不接**：在角色卡上停用一条效果，效果本身
 *    还挂在角色身上（`disabled` 翻转，随时能翻回来），那不是「摘下」而是「暂停」。
 *    真正的摘下只有一种——文档被删除。
 * 这条约束的落点同样在触发层，由 test/effects-persist-off.test.mjs 守着。
 *
 * 【三档，不是十二档】上身音按 12 组分（`armory/persist.mjs` 的 GROUP_SOUND），摘下音
 * 只分三档：**烧灭 / 增益消散 / 负面解除**。这不是偷懒，是「摘下」这件事本身能承载的
 * 信息量就这么多——玩家需要听出的是「那个红圈没了是好事还是坏事」，而不是「没了的是
 * 中毒还是流血」（那个信息在同一帧消失的光环颜色里）。素材侧也对得上：ASSET-NOTES
 * 带 `【E·摘下】` 前缀的登记正好是这三行。
 */

/**
 * 三档摘下音。`capMs` = 硬切点（null = 整池天然够短，不切）。
 *
 * 切点全部实测过包络（ffmpeg 单声道 22050Hz、10ms 窗 RMS、50ms 平滑，报切点相对本条
 * 峰值的百分比）——**引擎 fade 被规格 §3.3 禁用**（Sequencer 4.2.3 的 `fadeOutAudio`
 * 的 `to:1` 是字面量、不读 `data.volume`，一加就把归一化好的音量跳回 1.0），硬切听不听
 * 得出只取决于切点落得准不准：
 *
 * | 档 | capMs | 切点处剩余包络（逐文件） | 备注 |
 * | --- | --- | --- | --- |
 * | extinguish | 1800 | 0.2 / 1.0 % | Fire Impact C/D **有烘焙进来的第二、三团**（余烬噼啪 700-810ms），@1200 反而剩 10.3/24.3%——「扑灭」本来就是「噗一下再滋滋两声」，切在它们**后面**才干净 |
 * | dispel | 2200 | 3.0 / 2.6 / 5.6 / 2.4 % | ASSET-NOTES 记的 @1400 是 13.1-20.7%（那一句「1370-1400 处剩 14.5-22.8%」复算属实），偏高；同一段衰减往后走到 2200 才落进个位数 |
 * | clear | — | 不切 | 有声内容 1160/1270ms，天然最短 |
 *
 * 这三档因此都比上身音长（上身判据是严格 <1500ms）。**这是有意的**：上身音要给紧随
 * 其后的下一个动作让出耳朵，而摘下发生在一段效果结束时，后面通常没有紧跟的动作。
 * 守卫按 `PERSIST_OFF_MAX_MS` 单独钉，不套用状态层那条 1500。
 */
export const OFF_SOUND = Object.freeze({
  extinguish: Object.freeze({path: "ggg-sfx.magic.fire.impact.extinguish.01", capMs: 1800}),
  dispel:     Object.freeze({path: "ggg-sfx.magic.counter.dispel.01", capMs: 2200}),
  clear:      Object.freeze({path: "ggg-sfx.magic.divine.cast.dispel.general.01", capMs: null})
});

/** 摘下音的时长硬上限（ms），含端点。见 OFF_SOUND 表下那段。 */
export const PERSIST_OFF_MAX_MS = 2200;

/**
 * 「消散」那一档覆盖的状态组：这三组是**增益**（隐身 / 加速 / 护体），它们没了是坏消息。
 * 其余九组是负面状态，没了是好消息，走 `clear`。burning 另有专属的「扑灭」。
 *
 * 判据取自 `armory/persist.mjs` 的分组语义，不另立一套：`hidden` = invisible，
 * `haste` = hastened/limitless/inspired/resolute，`buff` = guarded/invulnerable/mending/
 * flying/burrowing。三组同时也是 persist 槽 `ABOVE_TOKENS` 里 burning 之外的那两组
 * （能量壳与放射光条都画在生物**身上**）——正负分野在两处是同一条线，不是巧合。
 */
export const BOON_GROUPS = Object.freeze(["hidden", "haste", "buff"]);

/**
 * 池取材与 `armory/persist.mjs` 的 `pickSound` 同源：ggg-sfx 全库是并列编号子枝，
 * `assets.resolve` 对分支只取第一个叶子，整池要由 `POOL` 展开（叶子路径写不进兵库，
 * `armory-assets` 那道闸只认登记的那一级或它的父路径）。
 */
function pickSound(ctx, path) {
  if (!path) return null;
  return ctx.soundFrom?.(poolFor(path)) ?? ctx.sound(path);
}

/**
 * 一条摘下音 cue，或 null（素材包没装 → 静默，不硬凑）。
 *
 * `volume` 走 `armory/persist.mjs` 的 `statusGain`：与上身音同一个目标档（−18 dBFS
 * 峰值）、同一副钳位、同一个公式。上身与摘下同档是刻意的——同一件事的两端，一端响
 * 一端轻会让玩家以为漏听了。`soundRole` 仍然分开报（`statusOff`），守卫要能分组量。
 *
 * `duration` 取 `min(capMs, 有声内容结束时刻)`；不写 `startTime`、不走 `soundAt`：
 * 摘下音不跟任何一帧画面对拍（光环是被 `endPersist` 一次性收掉的），从第 0 毫秒起播。
 */
function offSoundCue(key, ctx) {
  const cfg = OFF_SOUND[key];
  const fx = cfg && pickSound(ctx, cfg.path);
  if (!fx?.file) return null;
  const ends = [cfg.capMs, contentEndOf(fx.file)].filter(v => typeof v === "number" && v > 0);
  return {
    kind: "sound", file: fx.file, soundRole: "statusOff",
    volume: statusGain(fx.file) ?? 0.4,
    delay: 0, duration: ends.length ? Math.min(...ends) : null
  };
}

/** 三档共用的规则形状：`key` 同时是 OFF_SOUND 的键与规则 id 的后缀。 */
function offRule(key, pri, when) {
  return {
    id: `statusOff.${key}`, pri, when,
    // 判据用闭包里的 `key` 而不是从 e.statusId 现查：预览宏把 when 强制成 `() => true`
    // 再逐条喂一个合成 statusId（player/preview.mjs 的 previewEffectPlan），现查会让
    // 三条规则在预览里全部落空——那正是 test/preview.test.mjs 的 F 组守卫要抓的
    // 「规则在实战中永不命中」的同一类症状。与 persist 槽的 groupRule 同一手法。
    build: (e, ctx) => offSoundCue(key, ctx)
  };
}

export default [
  /**
   * 静默：`dead` 被移除意味着**复活**——那是一件该由别的东西宣告的事，不该复用
   * 「负面状态解除」这一声。更要紧的是结构：`STATUS_GROUP` 把 `dead` 归在 `stun` 组
   * （规格 §4.2 闸 c），本槽若只照抄那张表，每一次复活/GM 撤销那一击都会播一声
   * 「解除」。与 persist 槽同一手法：一条 pri 900 的规则返回 null，而不是把键从
   * STATUS_GROUP 里删掉。
   *
   * 名单直接复用 persist 槽的 `NO_PERSIST`：那份名单锁由 test/armory-persist.test.mjs
   * 的 deepEqual 守着，两个槽共用一份就不会漂移成「上身静默、摘下却响」。
   */
  {
    id: "statusOff.silent", pri: 900,
    when: e => NO_PERSIST.includes(e.statusId),
    build: () => null
  },

  /** 烧灭：burning 组专属。素材本身就是「噗一下再滋滋两声」，只对得上灭火这一件事。 */
  offRule("extinguish", 600, e => STATUS_GROUP[e.statusId] === "burning"),

  /** 增益消散：三个增益组。 */
  offRule("dispel", 500, e => BOON_GROUPS.includes(STATUS_GROUP[e.statusId])),

  /**
   * 负面解除：其余九组，**以及表外的未知状态**（when 恒真，排在最低 pri）。
   *
   * 兜底落在「解除」而不是「消散」这一侧是有依据的：Crucible 的 46 个状态里负面占
   * 大多数，将来新增的状态与天赋自定义效果按同一分布，猜错的代价也不对称——把一个
   * 负面状态的解除播成「增益没了」是读反了信息，反过来只是少了一点情绪。
   */
  offRule("clear", 400, () => true)
];
