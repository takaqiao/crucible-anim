import {RESULT, RESULT_NAME} from "../const.mjs";

/** S3 impact：命中判定后，锚在目标。结果层与元素层分开叠加，见 DESIGN.md §6.5。 */
export default [
  // ---- 高优先级规则加在这里（Task 11） ----

  /** 兜底：按攻击结果给一层通用冲击，未命中走 .missed()。 */
  {
    id: "generic.impact", pri: 10,
    when: () => true,
    build: (s, ctx, target) => {
      const res = target.results[0]?.result ?? RESULT.HIT;
      const missed = res === RESULT.MISS || res === RESULT.DODGE;
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
