/**
 * S5 persist：状态效果的持续特效。由 ActiveEffect 增删驱动，不属于任何动作。
 * 必须带 persist + tieTo，效果移除时 Sequencer 自动清理。
 */
export default [
  // ---- 高优先级规则加在这里（Task 12） ----

  /** 兜底：任何状态都挂一层中性光环，保证 46 个状态无一黑屏。 */
  {
    id: "generic.persist", pri: 10,
    when: () => true,
    build: (e, ctx) => {
      const fx = ctx.pick("jb2a.extras.tmfx.outflow.circle.01");
      if (!fx) return null;
      return {
        file: fx.file, objectScale: 1, attachTo: true, belowTokens: true,
        persist: true, tieTo: e.effectUuid, extraEndDuration: 300,
        opacity: 0.6, zIndex: 10
      };
    }
  }
];
