/**
 * S5 persist：状态效果的持续特效。由 ActiveEffect 增删驱动，不属于任何动作。
 *
 * 每个 cue 必须同时带 `persist:true` 与 `tieTo:effectUuid`——Sequencer 靠这两个字段
 * 在效果被移除时自动清理动画，漏了会导致光效永久残留在 token 上。resolveEffect()
 * 对本槽只调一次 build（见 resolver/resolve.mjs），不像 travel/impact 那样有
 * once/非-once 的区别：一个状态就是一份持续特效。
 *
 * Crucible 目前有 46 个可绑定的状态（见 test/fixtures/effects.json 与
 * task-12-brief.md 的交接说明）——`flanked` 在 Crucible 源码里是 derivedConditions
 * 里单独导出的派生状态，注释明写「cannot be assigned」，永远不会作为 ActiveEffect
 * 出现，因此不进 STATUS_GROUP。46 个状态归并成 12 组，避免逐个选材。
 *
 * 12 组素材全部取自 docs/ASSET-NOTES.md 的 persist 表（17 行）：其中恰好 12 行
 * 直接标了「XXX（中文名）组」，与下面 GROUP_FX 的 12 个键一一对应，不用取舍；
 * 3 行标「备选」（eskie.buff.loop.simple.blue / jb2a.extras.tmfx.inflow.circle.01 /
 * jb2a.aura_themed.01.inward.loop.metal.01.grey）与 2 行没打组标签
 * （jb2a.static_electricity.01.blue / eskie.poison.01.green，读备注更像是给伤害类型
 * 准备的持续层而非状态标记）留在表里没有采用；inflow.circle.01 改用作本文件末尾的
 * 中性兜底（见其注释）。
 *
 * 不传 `{color}`：12 条路径全部是写死颜色的完整叶子。用 offlineBackend 逐条验证过
 * `colorsUnder(path)` 恒为 `[]`（这些节点在 data/asset-index.json 里已经是字符串
 * 叶子，不是还带子节点的中间目录），ctx.pick 的 `{color}` 选项在这种路径上是静默
 * no-op（pickColor 找不到可用分支就返回 `{color:null}`，dbPath 原样送去 resolve）。
 * 与其让代码看起来在做动态染色而实际什么也没发生，不如干脆不传，也就不需要
 * `fx.hue` → `filter` 那一段管线。
 *
 * fadeIn/fadeOut：12 支全是数秒级的无缝循环（145 帧 @24fps≈6.0s 的占大多数，
 * 见 ASSET-NOTES 文末 C 节逐条帧率），不存在 impact/travel 那种「素材总长只有
 * 几百毫秒」的预算问题，因此不套用那两槽「素材自带渐强就 fadeIn:0」的判据——这里
 * 的淡入淡出对应的是「状态刚附上 / 刚移除」这个语义事件本身，与素材内部相位无关，
 * 统一给一个数秒循环配得起的柔和过渡（默认 500ms）。个别条目因为 ASSET-NOTES 给出
 * 明确的密度/可读性提示而单独调整 opacity 或 objectScale，见 GROUP_FX 逐条注释。
 *
 * 不设 mirrorY / randomizeMirrorY：ASSET-NOTES 的 hidden 行明确警告过——多支素材
 * （fear/bleed/poison/decay/hidden 等）本体在缓慢旋转，`mirrorY` 会把旋转方向整个
 * 翻成反向，「同场挂多个标记要统一转向就别混用镜像」。按状态分组、每组固定同一份
 * 素材已经保证了同状态的转向一致，不需要再引入随机镜像。
 */

const STATUS_GROUP = {
  burning: "burning",
  freezing: "freezing",
  poisoned: "poison", diseased: "poison", corroding: "poison",
  decaying: "decay", entropy: "decay", irradiated: "decay",
  bleeding: "bleed",
  stunned: "stun", staggered: "stun", paralyzed: "stun",
  incapacitated: "stun", asleep: "stun", dead: "stun",
  frightened: "fear", broken: "fear", insane: "fear",
  confused: "fear", dominated: "fear", disoriented: "fear",
  invisible: "hidden", unaware: "hidden",
  hastened: "haste", limitless: "haste", inspired: "haste", resolute: "haste",
  slowed: "slow", restrained: "slow", prone: "slow",
  overrun: "slow", exhausted: "slow", suffocating: "slow",
  guarded: "buff", invulnerable: "buff", mending: "buff",
  enraged: "buff", flying: "buff", burrowing: "buff",
  weakened: "debuff", exposed: "debuff", blinded: "debuff", deafened: "debuff",
  silenced: "debuff", shocked: "debuff", falling: "debuff"
};

/**
 * 每组的素材与呈现参数，路径与依据全部取自 docs/ASSET-NOTES.md persist 表。
 * `scale` = objectScale（画布/密度归一化，不含语义权重——persist 没有 impact 那种
 * 「结果轻重」概念）；`opacity` 默认 1，仅在 ASSET-NOTES 明确给出密度/可读性提示时
 * 下调；`fadeIn`/`fadeOut` 默认 500，个别条目单独调整并在注释里写明原因。
 */
const GROUP_FX = {
  /**
   * burning — eskie.burn.embers.orange，180 帧 @29.97fps=6.006s，无 intro/outro
   * 可无限循环（首尾差 20.2dB 与相邻帧同量级）。「密度极低，只有十几粒橙色余烬缓缓
   * 上浮，完全不遮 token…亮度很淡，白天亮底图上几乎看不见」——本来就偏淡，不能再压
   * opacity，改放大画布补足存在感（eskie 800x800 是 JB2A 400x400 基准的 2 倍，
   * 0.55 略高于纯几何归一化的 0.5，多留一点余量）。
   */
  burning: {path: "eskie.burn.embers.orange", scale: 0.55, opacity: 1, fadeIn: 500, fadeOut: 500},

  /**
   * freezing — jb2a.markers.snowflake.blue.01，144 帧 @24fps=6.00s，首尾差 5.57
   * 与相邻帧 4.97 同量级，可直接循环。f0 就有实打实的不透明团块（p90=195/255），
   * 中心镂空不挡脸；密度中高，长期挂着压一档 opacity 更耐看。
   */
  freezing: {path: "jb2a.markers.snowflake.blue.01", scale: 1, opacity: 0.85, fadeIn: 500, fadeOut: 500},

  /**
   * poison — jb2a.markers.poison.dark_green.01，145 帧 @24fps=6.04s，首尾差 2.86
   * 小于相邻帧 5.92，可直接循环。「整帧 alpha 均值 41.6-43.5…会压到 token 边缘轮廓」，
   * 密度是本表里点名偏高的一支，opacity 压到 0.75。
   */
  poison: {path: "jb2a.markers.poison.dark_green.01", scale: 1, opacity: 0.75, fadeIn: 500, fadeOut: 500},

  /**
   * decay — jb2a.markers.skull.purple.01（persist 行），145 帧 @24fps=6.04s，
   * 首尾差 1.30 远小于相邻帧 4.8，无自带闪爆。**已知限制**：ASSET-NOTES 实测这一支
   * 与 fear 组用的 markers.fear.dark_purple.01 色相只差 1°（276° vs 277°），两个
   * 状态同挂一个 token 上基本分不出来；文中建议的两个替代分支
   * `jb2a.markers.skull.dark_orange.01` / `dark_red.01` 均在 ASSET-NOTES 否决清单里
   * （橙红过饱和且与 burning 撞色 / 透明区红噪淹没轮廓），没有可换的验证过的分支，
   * 保留 purple 并在此记录该限制。
   */
  decay: {path: "jb2a.markers.skull.purple.01", scale: 1, opacity: 0.8, fadeIn: 500, fadeOut: 500},

  /**
   * bleed — jb2a.markers.drop.red.01，145 帧 @24fps=6.04s，首尾差 1.36 小于相邻帧
   * 典型 3.0-3.3。「饱和亮红…叠在浅色 token 上是一圈相当实的红环，不是稀疏血滴，
   * 当 persist 长挂要留意压色」——opacity 压到 0.75。
   */
  bleed: {path: "jb2a.markers.drop.red.01", scale: 1, opacity: 0.75, fadeIn: 500, fadeOut: 500},

  /**
   * stun — jb2a.markers.stun.dark_teal.01，145 帧 @24fps=6.04s，首尾差 1.47 小于
   * 相邻帧 5.00。「密度确实略低…但亮度是反的，青绿环实际比紫环显眼约 57%」，
   * 中等下调即可。
   */
  stun: {path: "jb2a.markers.stun.dark_teal.01", scale: 1, opacity: 0.85, fadeIn: 500, fadeOut: 500},

  /**
   * fear — jb2a.markers.fear.dark_purple.01（persist 行），145 帧 @24fps=6.04s，
   * 首尾差 1.20 远小于相邻帧 2.9-4.1。「密度属实中等偏低，环带内只有 25-29% 的像素
   * 超过 128」，轻度下调。
   */
  fear: {path: "jb2a.markers.fear.dark_purple.01", scale: 1, opacity: 0.85, fadeIn: 500, fadeOut: 500},

  /**
   * hidden — jb2a.markers.smoke.ring.loop.bluepurple，152 帧 @30fps=5.07s，
   * 首尾差 1.174 小于相邻帧差的两倍。「弧带里 11.53% 的像素 alpha>200…想长期挂着
   * 先压 opacity 或缩小，别当透空贴纸用」——原文明确指示，opacity 压到 0.55；隐匿
   * 本身也该是最不张扬的一组，fadeIn/fadeOut 拉长到 600ms 配一个更「渐隐」的观感。
   */
  hidden: {path: "jb2a.markers.smoke.ring.loop.bluepurple", scale: 1, opacity: 0.55, fadeIn: 600, fadeOut: 600},

  /**
   * haste — jb2a.markers.light.loop.yellow，121 帧 @24fps=5.04s，首尾 PSNR 17.66dB
   * 与相邻帧 17.46dB 同量级。ASSET-NOTES 原备注的密度判断整条被订正推翻：
   * 「不需要 belowTokens，尤其别再压 opacity 到 0.5，压了直接看不见…是本次复核 8 支
   * 里最稀薄的之一…真要它在深色地图上够显眼，方向是加发光或放大，而不是减淡」——
   * 因此不下调 opacity，改用 1.15 的 objectScale 补足存在感。
   */
  haste: {path: "jb2a.markers.light.loop.yellow", scale: 1.15, opacity: 1, fadeIn: 500, fadeOut: 500},

  /**
   * slow — jb2a.markers.chain.standard.loop.01.grey，150 帧 @30fps=5.00s，循环
   * 干净。**已知限制**：「素材四角自带四团深色烟雾，会把 token 所在格子的四个角
   * 压暗…链环本身是俯视压扁的椭圆，贴在正面视角（侧视）的 token 上会有透视违和，
   * 只适合俯视图 token」——本模组按俯视桌面地图假设，记录该限制但不改选材（备选
   * `aura_themed.01.inward.loop.metal.01.grey` 是 700x700 法术模板尺寸、碎片会
   * 散出格子外、中心螺旋盖脸，问题比链环更重，不采纳）。四角压暗，opacity 降一档。
   */
  slow: {path: "jb2a.markers.chain.standard.loop.01.grey", scale: 1, opacity: 0.8, fadeIn: 500, fadeOut: 500},

  /**
   * buff — jb2a.energy_field.01.blue，121 帧 @24fps=5.04s（文末 C 节记的 24fps 组），
   * 首尾逐像素平均差 2.29 与相邻帧 2.09-2.62 同量级。「很亮很饱和的一支，挂两个以上
   * 增益会糊…中央 300x300 的 alpha 已到 28.6，壳的内缘还是会啃到脸的外圈…放大到 1.2
   * 倍盖住格子更自然」——采纳放大建议，同时把 opacity 压到 0.65 抵消「很亮很饱和」。
   */
  buff: {path: "jb2a.energy_field.01.blue", scale: 1.2, opacity: 0.65, fadeIn: 500, fadeOut: 500},

  /**
   * debuff — jb2a.markers.runes.dark_black.01，145 帧 @24fps=6.04s，首尾差 1.42
   * 小于相邻帧 4.0。「几乎不发光…长期挂着完全不抢视线，也不会和其它 11 组的彩色
   * 撞车」——本来就暗，不下调 opacity（再压就真的看不见了，ASSET-NOTES 记的中灰底
   * 可读性下限已经很窄）。
   */
  debuff: {path: "jb2a.markers.runes.dark_black.01", scale: 1, opacity: 1, fadeIn: 500, fadeOut: 500}
};

/** 为一个分组生成规则。12 组结构相同，只有素材与呈现参数不同。 */
function groupRule(group, pri) {
  const cfg = GROUP_FX[group];
  return {
    id: `status.${group}`, pri,
    when: e => STATUS_GROUP[e.statusId] === group,
    build: (e, ctx) => {
      const fx = ctx.pick(cfg.path);
      if (!fx) return null;
      return {
        file: fx.file,
        objectScale: cfg.scale, attachTo: true, bindScale: true,
        belowTokens: false, opacity: cfg.opacity, zIndex: 40,
        persist: true, tieTo: e.effectUuid, extraEndDuration: cfg.fadeOut,
        fadeIn: cfg.fadeIn, fadeOut: cfg.fadeOut
      };
    }
  };
}

export default [
  ...Object.keys(GROUP_FX).map((g, i) => groupRule(g, 500 - i)),

  /**
   * 兜底：STATUS_GROUP 之外的状态（当前 46 个已全部归组，这条只为将来 Crucible
   * 新增状态兜底）挂一层中性光环，保证无一黑屏。
   *
   * jb2a.extras.tmfx.inflow.circle.01——ASSET-NOTES persist 表标注「debuff/slow 组
   * 备选」，180 帧 @30fps=6.00s，首尾差 1.83 与相邻帧 1.77 同量级，干净可循环。
   * 「RGB 平面全部恰好是 (255,255,255)，所有明暗都由 alpha 承担」——本来就是给
   * tint 用的中性素材，天然适合当「不知道该配什么颜色」的最终兜底；「能量全在外圈，
   * 中心 100x100 的 alpha 只有 4.7/255」，不挡脸。取代原先未经 ASSET-NOTES 验证的
   * `jb2a.extras.tmfx.outflow.circle.01`（见 test/armory-assets.test.mjs 的
   * LEGACY_UNVERIFIED，本次任务后应已清空）。
   */
  {
    id: "generic.persist", pri: 10,
    when: () => true,
    build: (e, ctx) => {
      const fx = ctx.pick("jb2a.extras.tmfx.inflow.circle.01");
      if (!fx) return null;
      return {
        file: fx.file, objectScale: 1, attachTo: true, bindScale: true, belowTokens: true,
        persist: true, tieTo: e.effectUuid, extraEndDuration: 400,
        opacity: 0.5, zIndex: 10, fadeIn: 400, fadeOut: 400
      };
    }
  }
];
