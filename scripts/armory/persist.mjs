/**
 * S5 persist：状态效果的持续特效。由 ActiveEffect 增删驱动，不属于任何动作。
 *
 * 每个 cue 必须同时带 `persist:true` 与 `tieTo:effectUuid`——Sequencer 靠这两个字段
 * 在效果被移除时自动清理动画，漏了会导致光效永久残留在 token 上。这条不变量由
 * resolver/resolve.mjs 的 keepTied() 在槽的出口统一兜住：`e.effectUuid` 为空时本文件
 * 的规则照样返回 cue，但会在那里被丢弃并留一条 warning，绝不会有一枚绑不上任何
 * document 的持久化特效流到播放层。规则自己不重复这项检查，免得每条各写一遍还漏掉
 * 将来新增的那一条。resolveEffect() 对本槽只调一次 build（见 resolver/resolve.mjs），
 * 不像 travel/impact 那样有 once/非-once 的区别：一个状态就是一份持续特效。
 *
 * **多客户端契约（不要在本文件里改 local / worldPersist）**：persist 是五个槽里唯一
 * 会触发 Sequencer 落盘的槽。本模组的传输模型是各客户端本地播同一份 plan，所以
 * N 个在线客户端会把同一个状态写成 N 条世界记录，GM 重载后光环叠 N 层。完整的源码
 * 依据、为什么 `.locally()` 拦不住、以及为什么修法是 `.temporary(true)` 而不是改
 * `local`，全部写在 resolver/resolve.mjs 的 `CUE_DEFAULTS.worldPersist` 注释里。
 * 这两个字段是**槽级契约、不是规则参数**：值由 CUE_DEFAULTS 统一给，本文件的 build()
 * 一律不得声明它们（test/armory-persist.test.mjs 有一条断言守着）。
 *
 * Crucible 目前有 46 个可绑定的状态（见 test/fixtures/effects.json）——`flanked` 在
 * Crucible 源码里是 derivedConditions 里单独导出的派生状态，注释明写「cannot be
 * assigned」，永远不会作为 ActiveEffect 出现，因此不进 STATUS_GROUP。46 个状态归并成
 * 12 组，避免逐个选材；其中 `dead` 刻意不产特效，见 NO_PERSIST。
 *
 * 【运行时 statusId 与本表的键】本表的键抄自 `CONFIG.statusEffects`，但真正决定
 * snapshotEffect 取到什么 statusId 的是各状态的 generator：
 *   · `entropy` 的 generator 产出 `statuses:["frightened"]`，它自己这个 id 永远不会
 *     出现在落地的 ActiveEffect 上，见 UNREACHABLE_STATUSES；
 *   · corroding / decaying / irradiated / mending / inspired 五个 generator 干脆不写
 *     statuses，战斗直调路径上 statusId 会退化成 16 位补零 _id，由 trigger/snapshot.mjs
 *     的 GENERATED_EFFECT_STATUS 翻译回来，本表这 5 个键因此仍然有效。
 * 两侧都由 test/source-tables.test.mjs 解析 Crucible 源码守着。
 *
 * 12 组素材全部取自 docs/ASSET-NOTES.md 的 persist 表（18 行）：其中 12 行直接标了
 * 「XXX（中文名）组」，与下面 GROUP_FX 的 12 个键一一对应；3 行标「备选」
 * （eskie.buff.loop.simple.blue / jb2a.extras.tmfx.inflow.circle.01 /
 * jb2a.aura_themed.01.inward.loop.metal.01.grey）与 2 行没打组标签
 * （jb2a.static_electricity.01.blue / eskie.poison.01.green，读备注更像是给伤害类型
 * 准备的持续层而非状态标记）留在表里没有采用；inflow.circle.01 改用作本文件末尾的
 * 中性兜底（见其注释）。energy_field 那一族现在有 blue（备选）与 green（buff 组）
 * 两行，buff 用 green，理由见该条注释。
 *
 * 【区分度】12 组是一套**颜色索引**：同一个 token 上可以同时挂好几条状态，玩家靠颜色
 * 反查是哪一组，颜色一撞索引就断。ASSET-NOTES 两次实测过形状在这个尺寸上帮不上忙
 * （skull 行「把两者都缩到 100px 的 1 格 token 尺寸并排看，两圈完全糊成同一种斑点环，
 * 形状提供的区分度是零」、stun 行「实渲 60px 对比……要到 240px 才分得出」），所以
 * 12 组两两的屏幕残留色必须拉开 CIEDE2000 >= 11.5，由 test/armory-persist-distinct.test.mjs
 * 全量 66 对钉死。出厂配置踩了三对（decay/fear 3.1、stun/buff 10.2、hidden/slow 10.4），
 * 修法见下面三条 GROUP_FX 注释；修完最小 12.2（poison/buff），余量 0.7。
 *
 * 【tint】`tint` 是 resolver/resolve.mjs 的 CUE_DEFAULTS 一等字段（乘法染色，交给
 * Sequencer 的 `.tint()`）。本槽只在两条素材上用它，且都是「同族没有第二个颜色分支
 * 可换」时的唯一出路，不是随手调色：markers.skull 的四个分支里 dark_green 撞 poison、
 * dark_orange 撞 burning、dark_red 撞 bleed（实测 ΔE00 分别 13.6/10.3/7.7，后两个直接
 * 低于阈值），smoke.ring.loop 的其余分支同理。tint 值一改就必须重量残留色，回归由
 * 那条守卫的 PALETTE 对齐断言逼出来。
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

/**
 * 不可达状态：id 存在于 `CONFIG.statusEffects`，但它带 generator，而 generator 产出的
 * `statuses` 数组里不含自身 id——落地的 ActiveEffect 因此永远不带这个状态，
 * `snapshotEffect` 也就永远取不到它。
 *
 * `entropy`：`crucible/module/const/effects.mjs` 的 `entropy()` 返回
 * `statuses: ["frightened"]`。走 HUD/toggle 时 core 先写 `statuses:["entropy"]`，随即被
 * Crucible 的 `_fromStatusEffect` 里 `mergeObject(effectData, generated, {overwrite:true})`
 * 整个数组替换掉（数组在 mergeObject 里按值覆盖）；走战斗直调（oblivion 符文暴击 →
 * `SYSTEM.EFFECTS.entropy()`）时压根没有 core 那一步。两条路的结果都是
 * statusId === "frightened"，走 fear 组。
 *
 * 这类键**不删**：STATUS_GROUP 的键集合要与 `CONFIG.statusEffects` 的键集合保持一一
 * 对应（tools/dump-fixtures.mjs 的 STATUSES 与 test/fixtures/effects.json 的 46 条都
 * 建立在这个不变量上）。改的是它指向的组——必须与它真身所在的组相同，这样表既完整
 * 又不说谎。由 test/source-tables.test.mjs 解析 Crucible 源码守卫。
 */
export const UNREACHABLE_STATUSES = ["entropy"];

/**
 * 明确不产持续特效的状态。归组不是「每个状态都得有一圈光」——有一类状态挂环只会减少
 * 信息量：
 *
 * `dead`：由 `actor.mjs` 的 `#applyResourceStatuses` 在每一次 health/wounds 变化时
 * 自动增删（`toggleStatusEffect("dead", {active: this.system.isDead})`），死后长期
 * 保留。Foundry 自己已经在 token 上盖了 dead overlay 图标，而本模组的 aftermath 槽
 * 也已经为「击杀」这一刻单独出了一次性特效（armory/aftermath.mjs 的 kill 规则）；
 * 再在尸体上永久挂一圈与 stunned/staggered 一模一样的青绿环，等于把「死透了」和
 * 「被震晕」这条战场上最需要一眼分清的信息抹平，还让每具尸体永远跑一个循环动画。
 *
 * 实现方式是一条高优先级规则返回 null（见 status.silent），而不是把键从 STATUS_GROUP
 * 里删掉：删了会让它掉进 generic.persist 的白泡兜底，比现状更糟，而且会破坏
 * 「键集合 == CONFIG.statusEffects 键集合」这条不变量。
 */
export const NO_PERSIST = ["dead"];

export const STATUS_GROUP = {
  burning: "burning",
  freezing: "freezing",
  poisoned: "poison", diseased: "poison", corroding: "poison",
  decaying: "decay", irradiated: "decay",
  bleeding: "bleed",
  stunned: "stun", staggered: "stun", paralyzed: "stun",
  incapacitated: "stun", asleep: "stun", dead: "stun",
  frightened: "fear", broken: "fear", insane: "fear",
  // entropy 的 generator 实际赋予 frightened，见上方 UNREACHABLE_STATUSES
  entropy: "fear",
  confused: "fear", dominated: "fear", disoriented: "fear",
  invisible: "hidden",
  hastened: "haste", limitless: "haste", inspired: "haste", resolute: "haste",
  slowed: "slow", restrained: "slow", prone: "slow",
  overrun: "slow", exhausted: "slow", suffocating: "slow",
  guarded: "buff", invulnerable: "buff", mending: "buff",
  flying: "buff", burrowing: "buff",
  weakened: "debuff", exposed: "debuff", blinded: "debuff", deafened: "debuff",
  silenced: "debuff", shocked: "debuff", falling: "debuff",
  // enraged 把招架与格挡直接归零（crucible/module/hooks/talent.mjs：
  // `if (this.statuses.has("enraged")) defenseTotals.parry = defenseTotals.block = 0`），
  // 是全场最好打的目标；套一层「受保护」的能量壳读反了，归 debuff。
  enraged: "debuff",
  // unaware 与 exposed 在 Crucible 里是同一档防御破绽（talent.mjs：
  // `if (rollData.flanked || ["exposed","unaware"].some(s => target.statuses.has(s)))
  // rollData.damageBonus += 2`）。放在 hidden 组会与 invisible 共用同一圈烟弧，而
  // 「我藏起来了」（优势）与「我被偷袭了」（劣势）该做的决策正好相反。
  unaware: "debuff"
};

/**
 * 每组的素材与呈现参数，路径与依据全部取自 docs/ASSET-NOTES.md persist 表。
 * `scale` = objectScale，走 Sequencer 的 `scaleToObject`，语义是「铺满 token 宽度的
 * 百分之几」，**不是**画布像素归一化系数（见 burning 条）；`opacity` 默认 1，仅在
 * ASSET-NOTES 给出密度/可读性提示或遮挡预算要求时下调；`tint` 默认无，只在同族换不
 * 动分支时用（见文件头）；`fadeIn`/`fadeOut` 默认 500。
 */
export const GROUP_FX = {
  /**
   * burning — eskie.burn.embers.orange，180 帧 @29.97fps=6.006s，无 intro/outro
   * 可无限循环（首尾差 20.2dB 与相邻帧同量级）。「密度极低，只有十几粒橙色余烬缓缓
   * 上浮，完全不遮 token…亮度很淡，白天亮底图上几乎看不见」——本来就偏淡，靠铺满整格
   * 补足存在感。
   *
   * **scale 1（原 0.55）：objectScale 不是画布归一化系数。** 播放层走
   * `e.scaleToObject(cue.objectScale)`；Sequencer 4.2.3 的 `_applyScaleToObject` 是
   * `sprite.width = 目标宽 × scaleToObject.scale × baseScale`，其中「目标宽」来自
   * `getSourceData()`（被附着对象的尺寸），源文件的像素尺寸只经
   * heightWidthRatio/widthHeightRatio 参与**宽高比**、不参与定尺寸。旧值 0.55 按
   * 「eskie 800x800 是 JB2A 400x400 的 2 倍」除出来，真实含义却是「只铺满 token 宽度
   * 的 55%」，与注释想表达的「放大补足存在感」正好相反。而这支的余烬密度是**中心最高**
   * （逐帧实测中心 20% 方框 alpha 均值 33.2，整幅只有 8.2，且随窗口单调递减），缩小
   * 之后余烬全糊在脸中央：整格有效遮挡只剩 2.5/255（12 组最低），中心 40% 反而有
   * 15.0/255。scale 1 下正好铺满一格。
   *
   * **opacity 0.9（原 1.0）**：scale 1 之后中心 40% 的常驻遮挡是 25.5/255，正好顶在
   * 10% 的单组预算线上，压一档留余量（22.9/255 = 9.0%）。这不违背 ASSET-NOTES 的
   * 「不能再压 opacity」——那句针对的是「又缩小又减淡」，而整格出光量 scale²×opacity
   * 从 0.55²×1.0 = 0.30 变成 1²×0.9 = 0.90，是原来的 2.98 倍。
   *
   * **已知限制**：循环接缝是 13 支里最大的一处（ASSET-NOTES：f0 与 f179 的 PSNR
   * 20.2dB 对相邻帧 23.8dB），稀疏粒子在 wrap 处有可辨位移。原话是「讲究的话补一段短
   * crossfade」，当前 cue schema 没有 crossfade 字段，记录在案。
   */
  burning: {path: "eskie.burn.embers.orange", scale: 1, opacity: 0.9, fadeIn: 500, fadeOut: 500},

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
   *
   * 它是修完之后全表最紧的一对（对 buff 的翠绿能量壳 ΔE00 12.2，余量 0.7）。要拉开
   * 只能给 poison 重新选材，而 markers.poison 只有 dark_green 与 purple 两支、purple
   * 撞 fear，属于表外任务，本轮不做。
   */
  poison: {path: "jb2a.markers.poison.dark_green.01", scale: 1, opacity: 0.75, fadeIn: 500, fadeOut: 500},

  /**
   * decay — jb2a.markers.skull.purple.01（persist 行），145 帧 @24fps=6.04s，
   * 首尾差 1.30 远小于相邻帧 4.8，无自带闪爆。
   *
   * **撞色与修法**：素材本身与 fear 组的 markers.fear.dark_purple.01 是同一种紫
   * （ASSET-NOTES：色相 276° 对 277°），屏幕残留色 CIEDE2000 只有 3.1，是全表最紧的
   * 一对。换分支这条路走不通——skull 只有四色，dark_green 撞 poison（13.6，且
   * ASSET-NOTES 已因「完全同一种黄绿色调」把它记进否决清单）、dark_orange 撞 burning
   * （10.3，同样在否决清单里）、dark_red 撞 bleed（7.7）。所以走 ASSET-NOTES 第一顺位
   * 的建议：tint。`#e0a060` 是在 8x8x8 的 tint 网格上按「对其余 11 组的最小 ΔE00
   * 最大化」挑出来的（网格最优 22.0，本值 20.5，差别在噪声量级内而暖琥珀滤色保住了
   * 「腐朽」的读法），把紫骷髅环压成酒红／绛紫：实测 rgb(119,31,77)，最近三对是
   * bleed 20.9 / fear 20.7 / hidden 21.9，邻域很平，不是踩在悬崖边上。
   */
  decay: {path: "jb2a.markers.skull.purple.01", scale: 1, opacity: 0.8, tint: "#e0a060",
          fadeIn: 500, fadeOut: 500},

  /**
   * bleed — jb2a.markers.drop.red.01，145 帧 @24fps=6.04s，首尾差 1.36 小于相邻帧
   * 典型 3.0-3.3。「饱和亮红…叠在浅色 token 上是一圈相当实的红环，不是稀疏血滴，
   * 当 persist 长挂要留意压色」——opacity 压到 0.75。
   */
  bleed: {path: "jb2a.markers.drop.red.01", scale: 1, opacity: 0.75, fadeIn: 500, fadeOut: 500},

  /**
   * stun — jb2a.markers.stun.dark_teal.01，145 帧 @24fps=6.04s，首尾差 1.47 小于
   * 相邻帧 5.00。「密度确实略低…但亮度是反的，青绿环实际比紫环显眼约 57%」，
   * 中等下调即可。MarkerStun_01 只有 dark_teal 与 purple 两支，purple 撞 fear/decay
   * （实测对 decay 2.9）且已进否决清单，所以这一组换不动——出厂的 stun/buff 撞色
   * （10.2）只能从 buff 那边解，见 buff 条。
   */
  stun: {path: "jb2a.markers.stun.dark_teal.01", scale: 1, opacity: 0.85, fadeIn: 500, fadeOut: 500},

  /**
   * fear — jb2a.markers.fear.dark_purple.01（persist 行），145 帧 @24fps=6.04s，
   * 首尾差 1.20 远小于相邻帧 2.9-4.1。「密度属实中等偏低，环带内只有 25-29% 的像素
   * 超过 128」，轻度下调。与 decay 的撞色由 decay 那边的 tint 解决（fear 是 3 个
   * 常见状态 + entropy 的落点，动它波及面更大）。
   */
  fear: {path: "jb2a.markers.fear.dark_purple.01", scale: 1, opacity: 0.85, fadeIn: 500, fadeOut: 500},

  /**
   * hidden — jb2a.markers.smoke.ring.loop.bluepurple，152 帧 @30fps=5.07s，
   * 首尾差 1.174 小于相邻帧差的两倍。「弧带里 11.53% 的像素 alpha>200…想长期挂着
   * 先压 opacity 或缩小，别当透空贴纸用」——原文明确指示，opacity 压到 0.55；隐匿
   * 本身也该是最不张扬的一组，fadeIn/fadeOut 拉长到 600ms 配一个更「渐隐」的观感。
   *
   * **撞色与修法**：压到 0.55 之后这支就成了一圈淡灰蓝弧，与 slow 的灰链只差
   * ΔE00 10.4——两支都掉进无彩区，正是 ASSET-NOTES 那句「debuff 不会和其它 11 组的
   * 彩色撞车」默认 debuff 是唯一无彩组、而这个前提在本次选材里不成立的地方。
   * 不动 opacity（ASSET-NOTES 明确要求压）、不换分支（smoke.ring.loop 的 purple 已因
   * 撞 fear 进否决清单，green 撞 poison 7.4、yellow 撞 haste 1.7、greenorange 撞
   * haste 5.4），改用 tint `#a0a0ff` 把它往蓝里推、离开无彩轴：实测 rgb(67,68,116)，
   * 对 slow 17.3、对 fear 17.8。顺带把 ASSET-NOTES 点名的「亮头是一条不透明白蓝亮带」
   * 压下去，与「别当透空贴纸用」的原意同向。
   */
  hidden: {path: "jb2a.markers.smoke.ring.loop.bluepurple", scale: 1, opacity: 0.55, tint: "#a0a0ff",
           fadeIn: 600, fadeOut: 600},

  /**
   * haste — jb2a.markers.light.loop.yellow，121 帧 @24fps=5.04s，首尾 PSNR 17.66dB
   * 与相邻帧 17.46dB 同量级。ASSET-NOTES 原备注的密度判断整条被订正推翻：
   * 「不需要 belowTokens，尤其别再压 opacity 到 0.5，压了直接看不见…是本次复核 8 支
   * 里最稀薄的之一…真要它在深色地图上够显眼，方向是加发光或放大，而不是减淡」——
   * 因此不下调 opacity，改用 1.15 的 objectScale 补足存在感。
   *
   * 它是三支留在 token 之上的素材里唯一一处妥协：中心 40% 常驻遮挡 8.8%、峰值 22.0%
   * （每 5.04s 两次金色光条穿过脸），都在预算内但确实是全表峰值最高的一支。压到
   * token 之下不是出路——只有 35.3% 的能量落在 r>0.6 之外，压下去等于取消这个标记。
   */
  haste: {path: "jb2a.markers.light.loop.yellow", scale: 1.15, opacity: 1, fadeIn: 500, fadeOut: 500},

  /**
   * slow — jb2a.markers.chain.standard.loop.01.grey，150 帧 @30fps=5.00s，循环
   * 干净。**已知限制**：「素材四角自带四团深色烟雾，会把 token 所在格子的四个角
   * 压暗…链环本身是俯视压扁的椭圆，贴在正面视角（侧视）的 token 上会有透视违和，
   * 只适合俯视图 token」——本模组按俯视桌面地图假设，记录该限制但不改选材（备选
   * `aura_themed.01.inward.loop.metal.01.grey` 是 700x700 法术模板尺寸、碎片会
   * 散出格子外、中心螺旋盖脸，问题比链环更重，不采纳）。四角压暗，opacity 降一档。
   *
   * 它对 debuff 的 ΔE00 是 13.6——全表第二紧，但这不是撞车：银亮链环 L*35.8 对近黑
   * 符文 L*17.8，是一条**刻意**的亮度阶梯，联系表上一眼分得开。区分度阈值（11.5）
   * 的上界就卡在这一对上，见 test/armory-persist-distinct.test.mjs。
   */
  slow: {path: "jb2a.markers.chain.standard.loop.01.grey", scale: 1, opacity: 0.8, fadeIn: 500, fadeOut: 500},

  /**
   * buff — jb2a.energy_field.01.green，121 帧 @24fps=5.04s，600x600。
   * 「很亮很饱和的一支，挂两个以上增益会糊…中央 300x300 的 alpha 已到 28.6，壳的内缘
   * 还是会啃到脸的外圈…放大到 1.2 倍盖住格子更自然」——采纳放大建议，同时把 opacity
   * 压到 0.65 抵消「很亮很饱和」。
   *
   * **撞色与修法**：出厂选的 blue 分支实际是青绿色（ASSET-NOTES：alpha>=100 处
   * meanRGB 66,204,208），与 stun 组的青绿环屏幕残留色只差 ΔE00 10.2，而两组语义正好
   * 相反——buff 是 guarded/invulnerable（受保护，其中 guarded 来自人人每回合可用的
   * 防御动作），stun 是 stunned/staggered（丧失行动，最常见的控制状态）。stun 那一支
   * 没得换（见其注释），所以必须动 buff。energy_field.01 的四个分支里 yellow 撞
   * haste（6.2）、multicolored 是彩虹版（数值最好但配不上单一状态语义），green 是
   * 唯一既过阈值又读得通的：实测 rgb(82,131,89)，最小 ΔE00 12.2（对 poison 的黄绿
   * 环）——这是修完之后全表最紧的一对，余量 0.7，与 impact 层同档。
   * green 与 blue 是同一次渲染的换色版（alpha 平面逐项统计完全一致，见 ASSET-NOTES
   * 新增的 green 行），blue 行记的全部几何/密度结论逐条继承，只有颜色变。
   */
  buff: {path: "jb2a.energy_field.01.green", scale: 1.2, opacity: 0.65, fadeIn: 500, fadeOut: 500},

  /**
   * debuff — jb2a.markers.runes.dark_black.01，145 帧 @24fps=6.04s，首尾差 1.42
   * 小于相邻帧 4.0。「几乎不发光…长期挂着完全不抢视线，也不会和其它 11 组的彩色
   * 撞车」——本来就暗，不下调 opacity（再压就真的看不见了，ASSET-NOTES 记的中灰底
   * 可读性下限已经很窄）。
   *
   * 它覆盖 9 个状态、是命中率最高的一组，同时也是 12 组里最暗的素材（高 alpha 区
   * RGB 50,45,45，含 alpha=255 的纯黑核）。实测中心 40% 内有 3.33% 的像素 alpha>=200
   * 且亮度 <96——这不是「蒙一层膜」而是**在脸上打黑洞**。它之所以还能保持 opacity 1，
   * 正是因为下面的分层规则把它划在 token **之下**：黑洞打在地面而不是脸上，遮挡
   * 结构上为 0。如果哪天把它移到 token 之上，opacity 必须降到 0.6 及以下（此时
   * alpha×opacity 数学上到不了 0.75、不可能再打洞），由
   * test/armory-persist-occlusion.test.mjs 的暗洞守卫看着。
   * ASSET-NOTES 点名的另一半（0x2a-0x38 中深灰地砖上整圈糊没）要靠 tint/contrast
   * 提亮，不是 opacity 能解决的，属另一条 finding，本轮未做。
   */
  debuff: {path: "jb2a.markers.runes.dark_black.01", scale: 1, opacity: 1, fadeIn: 500, fadeOut: 500}
};

/**
 * 分层：整个 persist 槽只有**一条**规则——这一层画的东西在不在生物身上。
 *
 *   - 画在生物身上/周围的（火星裹着身体、光条从身体射出、能量壳把生物罩住）→ token 之上；
 *   - 俯视的地面环（JB2A `markers.*` 家族的 9 支，以及兜底那圈 tmfx inflow）→ token 之下。
 *
 * 从前 12 组一律 `belowTokens:false`、兜底却是 `belowTokens:true`，同一个槽两套分层
 * 且没有依据；IMPLEMENTATION-PLAN 的 Task 12 设计表原本给 bleed/haste/slow/buff/debuff
 * 五组 `below:true`，实现里也全丢了。现在两个分层各只有一组取值（见 LAYER），兜底与
 * 地面环走同一套。
 *
 * 为什么这条规则同时也是遮挡预算的解法：persist 是常驻图层，唯一能真正降低遮挡的手段
 * 只有 belowTokens——zIndex 改的是**同层内的先后**，而 N 层半透明叠加的合成不透明度
 * 1−∏(1−aᵢ) 与顺序无关，槽内 12 条 zIndex 全排一遍也不会少挡一个像素。实测（中心 40%
 * 方框、按各自 scale 换算窗口、乘 opacity 的时间均值，单位 /255，出厂配置）：
 *
 *   decay 23.8 · haste 22.3 · debuff 21.2 · slow 17.8 · burning 15.0 · freezing 10.2
 *   poison 9.9 · stun 5.8 · fear 1.2 · bleed 0.8 · hidden 0.5 · buff 0.3
 *
 * 单组都在 10% 线下，但常见的 debuff+decay+slow 同挂合成 22.7%，12 组理论上限 40.8%；
 * 换成生物身体所在的中心 70% 窗口，debuff+decay+slow 是 68.5%。按上面这条规则分层
 * 之后，能压在 token 之上的只剩 burning/haste/buff 三组，任意组合的上限是 17.1%
 * （中心 40%），而且是**结构性**上限——不是恰好凑出来的数字。
 *
 * 三组留在上面各有实测依据：burning 的余烬中心最密（只有 22.9% 的能量在 r>0.6 之外）、
 * haste 是从中心放射的光条（35.3%，压到 token 下面三分之二的光直接没了，与
 * ASSET-NOTES haste 行「不需要 belowTokens」一致），两者压下去等于取消这个标记；
 * buff 是罩住生物的能量壳，中心 40% 遮挡只有 0.3/255，压在上面零成本，压下去反而丢掉
 * 「罩着」这层语义。9 支地面环则相反：59-87% 的能量落在 r>0.6 之外，压到 token 下面
 * 仍有可观的亮度留在生物轮廓外。
 */
export const ABOVE_TOKENS = new Set(["burning", "haste", "buff"]);

/**
 * 两个分层各自的 (belowTokens, zIndex)，本槽只有这两种取值。
 * zIndex 沿用仓库既有的分带：token 之下 5-25（aftermath 地面痕迹 5 / 击杀血泊 15 /
 * cast 法阵 20），token 之上 30-100（cast 附着 30 / impact 元素 55 / 结果 60 /
 * travel 85-100）。状态标记是常驻的、信息密度最高的一层，在各自分带里取最高的一档：
 * 地面环 25（压在法阵与血泊之上），身上层 40（仍低于 impact/travel 的一次性特效）。
 */
export const LAYER = Object.freeze({
  above: Object.freeze({belowTokens: false, zIndex: 40}),
  below: Object.freeze({belowTokens: true, zIndex: 25})
});

/** 为一个分组生成规则。12 组结构相同，只有素材与呈现参数不同。 */
function groupRule(group, pri) {
  const cfg = GROUP_FX[group];
  const layer = ABOVE_TOKENS.has(group) ? LAYER.above : LAYER.below;
  return {
    id: `status.${group}`, pri,
    when: e => STATUS_GROUP[e.statusId] === group,
    build: (e, ctx) => {
      const fx = ctx.pick(cfg.path);
      if (!fx) return null;
      return {
        file: fx.file,
        objectScale: cfg.scale, attachTo: true, bindScale: true,
        belowTokens: layer.belowTokens, zIndex: layer.zIndex,
        opacity: cfg.opacity, tint: cfg.tint ?? null,
        persist: true, tieTo: e.effectUuid, extraEndDuration: cfg.fadeOut,
        fadeIn: cfg.fadeIn, fadeOut: cfg.fadeOut
      };
    }
  };
}

export default [
  /**
   * 静默：NO_PERSIST 里的状态直接返回 null，normalize() 收到 null 产 0 条 cue，
   * resolveEffect() 因此整体返回 null。排在所有分组之前，pri 取 900。
   */
  {
    id: "status.silent", pri: 900,
    when: e => NO_PERSIST.includes(e.statusId),
    build: () => null
  },

  ...Object.keys(GROUP_FX).map((g, i) => groupRule(g, 500 - i)),

  /**
   * 兜底：STATUS_GROUP 之外的状态（当前 46 个已全部归组，这条只为将来 Crucible
   * 新增状态、以及天赋自定义效果兜底）挂一层中性光环，保证无一黑屏。
   *
   * jb2a.extras.tmfx.inflow.circle.01——ASSET-NOTES persist 表标注「debuff/slow 组
   * 备选」，180 帧 @30fps=6.00s，首尾差 1.83 与相邻帧 1.77 同量级，干净可循环。
   * 「RGB 平面全部恰好是 (255,255,255)，所有明暗都由 alpha 承担」——本来就是给
   * tint 用的中性素材，天然适合当「不知道该配什么颜色」的最终兜底；「能量全在外圈，
   * 中心 100x100 的 alpha 只有 4.7/255」，不挡脸。取代原先未经 ASSET-NOTES 验证的
   * `jb2a.extras.tmfx.outflow.circle.01`（见 test/armory-assets.test.mjs 的
   * LEGACY_UNVERIFIED，现已清空）。
   *
   * 分层与 9 支地面环同走 LAYER.below：它同样是一圈俯视环（85.3% 的能量落在 r>0.6
   * 之外）。从前它是槽里唯一一条 belowTokens:true，现在是这条规则的一个普通实例，
   * 不再是例外。
   */
  {
    id: "generic.persist", pri: 10,
    when: () => true,
    build: (e, ctx) => {
      const fx = ctx.pick("jb2a.extras.tmfx.inflow.circle.01");
      if (!fx) return null;
      return {
        file: fx.file, objectScale: 1, attachTo: true, bindScale: true,
        belowTokens: LAYER.below.belowTokens, zIndex: LAYER.below.zIndex,
        persist: true, tieTo: e.effectUuid, extraEndDuration: 400,
        opacity: 0.5, fadeIn: 400, fadeOut: 400
      };
    }
  }
];
