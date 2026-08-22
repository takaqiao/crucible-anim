/**
 * 「自带闪爆」交接协议。
 *
 * ASSET-NOTES 主表有一列「自带闪爆」，标「是」的素材自己某几帧就会炸出一次白闪 /
 * 星芒爆闪 / 亮核爆出 / 命中光环。该表的通则原文：**凡标「是」的，S3 再叠通用 impact
 * 闪光层就是双闪，两者必须二选一**。这个模块把那句话从散文变成机器能查的东西。
 *
 * 约定：travel 规则选中标「是」的素材时，在自己的 cue 上挂一条 `selfFlash` 记录；
 * 后面的槽用 `coveringFlash()` 查「我要叠的这一层闪光，是不是已经有人在同一个锚点上
 * 闪过了」。所有数值都来自逐帧实测（ffmpeg 解 alpha 后逐帧统计），与 ASSET-NOTES 同源。
 *
 * `selfFlash` 字段（时间一律以**本 cue 的播放起点**为零点，即已经扣掉 startTime）：
 *   from       起亮时刻（ms）
 *   at         峰值时刻（ms）
 *   to         熄灭时刻（ms）
 *   anchor     闪爆落在哪里，取值见 FLASH_ANCHORS，默认 "target"
 *   sustained  true = 不是一次性爆闪，而是打通后一直亮着（射线的模板末端就是这样）
 *
 * 为什么记区间而不是只记一个布尔：
 *   1. 交棒点（duration + waitUntilFinished）应当落在这段区间里，否则下一槽会踩在
 *      闪爆之外——strike.thrown 交棒晚 250ms 正是这么来的。测试据此自查，用的是
 *      cue 自己带的数字，不需要在测试里硬编码任何素材常量。
 *   2. anchor 让「爆闪不在目标身上」的情况不会误伤目标身上的命中闪光：
 *      spell.gesture.surge 的爆闪跟着施法者（origin），spell.gesture.ray 的星爆落在
 *      line 模板的末端（region）——两者都不占目标那一层的位置。
 */

/** 本协议认可的锚点取值。 */
export const FLASH_ANCHORS = Object.freeze(["origin", "target", "region"]);

/**
 * 前序槽里、落在指定锚点上、已经替本槽闪过一次的那条记录。
 * @param {Record<string, object[]>} built  同一目标可见的前序槽 cue，按槽名索引
 * @param {"origin"|"target"|"region"} [anchor]  本槽准备叠闪光的锚点
 * @returns {{from:number, at:number, to:number, anchor:string, sustained?:boolean,
 *            slot:string, rule:string}|null}
 */
export function coveringFlash(built, anchor = "target") {
  for (const slot of ["travel"]) {
    for (const c of built?.[slot] ?? []) {
      const f = c.selfFlash;
      if (f && (f.anchor ?? "target") === anchor) {
        return {...f, anchor: f.anchor ?? "target", slot, rule: c.rule};
      }
    }
  }
  return null;
}

/**
 * 把素材自带的闪爆窗口按本条 cue 实际播出的片段裁剪一遍。
 *
 * 规则表里的 `flash` 毫秒数一律相对**素材自身第 0 帧**（逐帧实测的原始坐标，与这条 cue
 * 怎么播无关）；cue 上申报的 `selfFlash` 则相对**本 cue 的播放起点**（已扣掉 startTime，
 * 见本文件顶部的字段说明）。两者的换算只此一处，规则表里不许再手写第二份数字——
 * 于是「用 startTime 把自带闪爆裁掉」这件事有了唯一、机器可查的表达：裁干净了就返回
 * null，cue 不再申报闪爆；有人删掉 startTime，闪爆立刻重新申报出来，双闪守卫随之变红。
 *
 * @param {{from:number, at:number, to:number, sustained?:boolean}|null} flash
 *        素材自带闪爆的原始窗口，null = 该素材不自带闪爆（ASSET-NOTES 标「否」）
 * @param {{startTime?:number, duration?:number|null, anchor?:string}} [play]
 * @returns {{from:number, at:number, to:number, anchor:string, sustained?:boolean}|null}
 */
export function trimFlash(flash, {startTime = 0, duration = null, anchor = "target"} = {}) {
  if (!flash) return null;
  if (startTime >= flash.to) return null;                 // 闪爆整段落在起点之前，被裁掉了
  const from = Math.max(0, flash.from - startTime);
  if (duration !== null && duration <= from) return null; // 还没闪到这条 cue 就收了
  const out = {from, at: Math.max(0, flash.at - startTime), to: flash.to - startTime, anchor};
  if (flash.sustained) out.sustained = true;
  return out;
}
