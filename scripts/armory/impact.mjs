import {RESULT, RESULT_NAME, HIT_RESULTS} from "../const.mjs";
import {coveringFlash} from "./flash.mjs";

/** S3 impact：命中判定后，锚在目标。结果层与元素层分开叠加，见 DESIGN.md §6.5。 */
export default [
  // ---- 高优先级规则加在这里（Task 11） ----

  /** 兜底：按攻击结果给一层通用冲击，未命中走 .missed()。 */
  {
    id: "generic.impact", pri: 10,
    when: () => true,
    build: (s, ctx, target, built) => {
      const res = target.results[0]?.result ?? RESULT.HIT;
      const missed = res === RESULT.MISS || res === RESULT.DODGE;
      // ASSET-NOTES 的「二选一」通则：travel 选中的素材如果自己就在目标身上炸过一次
      // （自带闪爆＝是），本层的通用冲击就是那一次闪光的重复，叠上去必然双闪，让位给
      // 素材自带的那一次。只让命中类结果——防御/落空类结果要表达的是「挡下了/闪开了」，
      // 素材自带的爆闪表达的是「打中了」，替代不了，这一层必须照常出。
      // 锚点必须相同：spell.gesture.surge 的爆闪跟着施法者（anchor "origin"）、
      // spell.gesture.ray 的星爆落在模板末端（anchor "region"），都不占目标这一层。
      if (HIT_RESULTS.includes(res) && coveringFlash(built, "target")) return null;
      const fx = ctx.pick("jb2a.impact.004", {color: ctx.damageColor() ?? "white"});
      if (!fx) return null;
      return {
        file: fx.file, playIf: RESULT_NAME[res] ?? "always",
        objectScale: res === RESULT.GLANCE ? 0.6 : 1,
        aim: {towards: {tokenId: target.tokenId, x: target.x, y: target.y}, missed},
        delay: 0, zIndex: 60,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null
      };
    }
  }
];
