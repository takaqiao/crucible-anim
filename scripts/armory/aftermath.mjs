/** S4 aftermath：结算后，锚在目标或地面。 */
export default [
  // ---- 高优先级规则加在这里（Task 12） ----

  /** 兜底：有治疗量时给一层治疗辉光，否则不出内容。 */
  {
    id: "generic.aftermath", pri: 10,
    when: () => true,
    build: (s, ctx, target) => {
      if (!(target.healed > 0)) return null;
      const fx = ctx.pick("jb2a.healing_generic.burst", {color: "green"});
      if (!fx) return null;
      return {file: fx.file, objectScale: 1, attachTo: true, delay: 200, zIndex: 70};
    }
  }
];
