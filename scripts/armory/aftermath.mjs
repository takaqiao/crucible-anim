/**
 * S4 aftermath：结算后，锚在目标或地面。规则选择是**整个动作一次**（与 travel/impact
 * 一样，见 resolver/resolve.mjs 的 firstMatch），选中的规则再对每个目标各调一次
 * build（除非 once:true）——因此 when() 判的是「这个动作要不要走这条规则」，
 * build() 里仍要对每个目标单独判「这个目标要不要出内容」，返回 null 即可跳过。
 */

/** 与 travel.mjs / impact.mjs 的 r6 同源：抹掉浮点尘埃，保持 cue 里的数字干净。 */
const r6 = v => Math.round(v * 1e6) / 1e6;

/**
 * 区域残留的落点：cone 取轴线中点（覆盖锥形footprint 的中段），circle（blast）取
 * 区域圆心本身。与 travel.mjs 的 templateAnchor/templateEnd 同一套坐标约定
 * （region.rotation 度，从 +x 正东起、朝 +y 为正）。
 *
 * ref 用 "point"（理由与 travel.mjs 的 templateAnchor 完全相同）：这是一个冻结的区域
 * 坐标，不是「施法者」这个身份，播放层不得把它升格成施法者 token 的中心。
 */
function residueAnchor(s) {
  const r = s.region;
  if (!r) return null;
  if (r.type === "circle" && Number.isFinite(r.x) && Number.isFinite(r.y)) {
    return {ref: "point", x: r.x, y: r.y};
  }
  if (r.type === "cone" && Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.radius)) {
    const rot = (r.rotation ?? 0) * (Math.PI / 180);
    const mid = r.radius / 2;
    return {ref: "point", x: r6(r.x + Math.cos(rot) * mid), y: r6(r.y + Math.sin(rot) * mid)};
  }
  return null;
}

export default [
  // ---- 高优先级规则加在这里（Task 12） ----

  /**
   * 治疗辉光——每个被治疗的目标各来一份，pri 420。
   *
   * jb2a.healing_generic.400px.green：Task 7 用过的 `...burst` 配色是失效的
   * （burst/loop 两支的颜色词是 bluewhite/greenorange 这类复合词，不在 COLOR_HUE 表里，
   * pickColor 会把它们过滤掉，固定出蓝白色兜底——见 test/armory-assets.test.mjs 的
   * LEGACY_UNVERIFIED）。400px 与 200px 两支才是纯单色词 blue/green/purple/red/yellow，
   * ASSET-NOTES 已验证：51 帧 @30fps=1700ms，f0 空，内容是十字星花粒子簇 + 一圈细光环
   * （不是原备注说的实心块），空尾从 f40 起，建议 endTime 截到约 1333ms。中心 100x100
   * 在 f10/f20 的 alpha 均值 216/174，「需要时压 opacity 到 0.6-0.7」——取 0.7。
   * fadeIn:0：素材自己从空到峰值天然渐强（f0 空、f10 才到 216/255），再叠一层淡入是
   * 重复处理同一件事；fadeOut:200 只在裁点前收个尾（f32 已只剩 11/255，纯保险）。
   */
  {
    id: "aftermath.healing", pri: 420,
    when: s => (s.targets ?? []).some(t => t.healed > 0),
    build: (s, ctx, target) => {
      if (!(target?.healed > 0)) return null;
      const fx = ctx.pick("jb2a.healing_generic.400px.green");
      if (!fx) return null;
      return {
        file: fx.file, objectScale: 1, attachTo: true, bindScale: true,
        opacity: 0.7, zIndex: 70, elevation: target.elevation,
        duration: 1333, fadeIn: 0, fadeOut: 200
      };
    }
  },

  /**
   * 【击杀规则已迁出本槽，见 armory/death.mjs 的 `death.kill`（Task 15b）】
   *
   * 原来这里有一条 `aftermath.kill`，判据是 `target.effects.includes("dead")`——它在
   * 实战中**永远不命中**：`target.effects` 来自动作自带的 `ev.effects`，而 `dead` 是
   * Crucible 在资源结算后单独 `toggleStatusEffect("dead", …)` 打上的
   * （documents/actor.mjs:2926）；何况 `configureVFXEffect()` 是在 `_prepareMessage()`
   * 里跑的（models/action.mjs:3286），比 `confirm()` 的 `#applyEvents()`（:2670）早得多，
   * 建计划那一刻伤害根本还没结算。完整依据与新通道写在 armory/death.mjs 的文件头。
   *
   * **不要在本槽里重新加任何按「目标死没死」判断的规则**：S4 是动作时间轴上的一段，
   * 拿到的快照冻结于建卡时刻，那一刻的死亡信息不存在。
   */

  /**
   * 士气变化——`usage.resource === "morale"` 的动作，pri 380（低于治疗：一个同时打
   * 士气又救人的动作，应该优先读出「谁被救了」而不是士气本身；「谁死了」不在本槽，
   * 见上面那条迁出说明）。
   * 落到这条规则的实际是纯粹的士气打击（rally 类回复士气的动作会先被 pri 420 的
   * 治疗规则接管，这里只服务「士气被削」那一半），逐目标看 `target.damage` 是否
   * 非空来判断这个目标是否真的挨了这一下（多目标动作里有人没中就不该出特效）。
   *
   * jb2a.markers.fear.dark_purple.01（aftermath 行）：ASSET-NOTES 原话「士气下降/
   * 恐惧标记…适合 Crucible 那 4 个打士气的符文」，就是为这个场景准备的记录。145 帧
   * @24fps=6.04s 是一圈无 intro/outro 的纯循环、帧 0 已满不透明，「当一次性余波闪光
   * 用会啪地出现再啪地消失，必须自己给 fadeIn/fadeOut」——所以不裁成一次完整循环，
   * 只取前 1000ms 当一次「士气被打」的脉冲反馈，fadeIn:300 抹掉硬弹出，fadeOut:500
   * 让它软收尾而不是硬切。中心镂空不挡脸，是俯视环，贴 token 顶层。
   */
  {
    id: "aftermath.morale", pri: 380,
    when: s => s.usage?.resource === "morale",
    build: (s, ctx, target) => {
      if (!target?.damage) return null;
      const fx = ctx.pick("jb2a.markers.fear.dark_purple.01");
      if (!fx) return null;
      return {
        file: fx.file, objectScale: 1, attachTo: true, bindScale: true,
        opacity: 0.85, zIndex: 65, elevation: target.elevation,
        duration: 1000, fadeIn: 300, fadeOut: 500
      };
    }
  },

  /**
   * 地面残留——法术 blast/cone 命中后留下的地裂痕迹，pri 300，once:true（一片区域
   * 一份焦痕，不是每个目标脚下各来一块；见 task-12-brief.md 的交接说明）。触发条件
   * 用真实几何而非笼统的 target.type：fixture 里 `target.type==="blast"` 同时有
   * `region.type==="circle"`（真正的圆形爆发范围）与 `region:null`（近战多目标群击，
   * 没有落地范围可言）两种，只有前者该出地裂；cone 一律有 `region.type==="cone"`。
   * aura/pulse 即便也带 circle 区域，语义是持续光环/扩散波而非一次性爆发，不在
   * 「blast/cone 后的焦痕」范围内，故意不收。
   *
   * jb2a.impact.ground_crack.still_frame.01：ASSET-NOTES 明确推荐「天然适合当
   * persist 的地裂残留贴图（blast/cone 之后铺地）」——1 帧 .webp 静帧，600x600，
   * 放射状裂纹，中心在锚点。「透明区 RGB 也是 (0,0,0)（不是查看器让人以为的白块），
   * 贴在深色地板上几乎看不见，必须配浅色地面或叠亮色」——已知限制，本轮没有可以
   * 变亮的手段（ColorMatrix 的 hue 旋转对纯黑没有效果），记录在案；objectScale 放大
   * 到 1.3 至少扩大可见面积。单帧「没有任何淡入淡出，必须靠 fadeIn/fadeOut 参数
   * 托住」——fadeIn:200 软出场，duration:3000 让裂纹留存几秒（一次战斗回合的量级），
   * fadeOut:800 长尾淡出。belowTokens:true：地面痕迹压在 token 之下。
   *
   * 曾考虑 `blfx.spell.template.circle.explosion1.fireball1.ground.burn.orange`
   * （名字更贴合「焦痕」），但 ASSET-NOTES 订正后明确否掉了它当残留用：前 40+ 帧是
   * 铺满画幅的卡通爆炸本体（会和 impact 层双爆，需要 startTime 跳过一半时长），跳过
   * 之后剩下的「焦痕」段实测是「一坨近黑的放射状烟渣…光靠 persist 冻帧只会留一坨
   * 黑斑」，不比 ground_crack 更可靠，故未采用。
   */
  {
    id: "aftermath.groundResidue", pri: 300, once: true,
    when: s => s.region?.type === "cone"
      || (s.target?.type === "blast" && s.region?.type === "circle"),
    build: (s, ctx) => {
      const at = residueAnchor(s);
      if (!at) return null;
      const fx = ctx.pick("jb2a.impact.ground_crack.still_frame.01");
      if (!fx) return null;
      return {
        file: fx.file, at, objectScale: 1.3, belowTokens: true, zIndex: 5,
        duration: 3000, fadeIn: 200, fadeOut: 800
      };
    }
  },

  /**
   * 终极兜底：pri 10、when 恒真，架构上与其它槽保持同一层级结构（见
   * DESIGN.md §6.4「0-99 终极兜底」），但 aftermath 本身允许「这个动作没有 S4 内容」
   * 这个合法结果（不像 cast/travel/impact 需要保证 100% 覆盖率，见
   * test/coverage.test.mjs 里没有逐动作强制 aftermath 出内容的断言）。上面三条 pri
   * 420/380/300 的规则已经覆盖了当前设计要处理的全部 S4 场景（治疗/士气/地面残留；
   * 击杀走 armory/death.mjs 的一次性通道），因此这里恒返回 null，不再引用任何素材
   * 路径——原先占位用的 `jb2a.healing_generic.burst`（ASSET-NOTES 验证失效，见
   * test/armory-assets.test.mjs 的 LEGACY_UNVERIFIED）已随之整条移除。
   */
  {
    id: "generic.aftermath", pri: 10,
    when: () => true,
    build: () => null
  }
];
