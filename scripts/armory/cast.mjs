/**
 * S1 cast：动作开始，锚在施法者。
 * 规则按 pri 降序匹配，取第一个命中者。高优先级规则加在数组前部。
 */
export default [
  // ---- 高优先级规则加在这里（Task 9） ----

  /**
   * 兜底：任何非攻击动作给一个中性施法圈；有目标的攻击动作起手交给 travel/impact 段。
   *
   * 但 travel/impact 都是按 snapshot.targets 循环触发的——零目标时它们根本不会执行。
   * Crucible 的 composed 标签动作（见 action.mjs 的 initialize()）无条件把 isAttack
   * 设为 true，不看目标类型，所以自我增益/召唤类法术（aspect/ward/conjure/create 等
   * gesture）也是 isAttack === true 但 targets 为空。这类动作必须靠 cast 段自己扛，
   * 否则整条链断掉、零 cue。因此这里判断的是「攻击且有目标」才让路，不是单看 isAttack。
   */
  {
    id: "generic.cast", pri: 10,
    when: () => true,
    build: (s, ctx) => {
      if (s.usage.isAttack && s.targets.length) return null;
      const fx = ctx.pick("jb2a.cast_generic.03", {color: ctx.runeColor() ?? "blue"});
      if (!fx) return null;
      return {
        file: fx.file, objectScale: 0.9 * ctx.geom.sizeScale(),
        belowTokens: true, fadeIn: 200, fadeOut: 400,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null
      };
    }
  }
];
