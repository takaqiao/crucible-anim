/** S2 travel：施法者 → 目标。 */
export default [
  // ---- 高优先级规则加在这里（Task 10） ----

  /** 兜底：远程动作给一枚中性投射物；近战不出内容，由 impact 承担。 */
  {
    id: "generic.travel", pri: 10,
    when: () => true,
    build: (s, ctx, target) => {
      if (!s.usage.isRanged) return null;
      const fx = ctx.pick("jb2a.magic_missile", {color: ctx.damageColor() ?? ctx.runeColor() ?? "blue"});
      if (!fx) return null;
      return {
        file: fx.file, objectScale: 1 * ctx.geom.sizeScale(),
        aim: {towards: {tokenId: target.tokenId, x: target.x, y: target.y},
              missed: target.results.some(r => r.result === 0 || r.result === 1)},
        waitUntilFinished: -300, zIndex: 100,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null
      };
    }
  }
];
