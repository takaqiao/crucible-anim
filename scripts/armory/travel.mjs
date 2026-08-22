/**
 * S2 travel：施法者 → 目标 / 模板。承载 §8.2 的三条几何修正——贴身/隔格换素材、
 * 大体型补偿、镜像朝向——全部集中在 strike.melee 一条规则里。
 *
 * 出内容的粒度由规则自己声明（见 resolver/resolve.mjs 的 `rule.once`）：区域与自身
 * 特效置 `once: true`，一次动作只出一份并锚在施法者/模板；投射物、近战、投掷不置位，
 * 每个目标各出一份并锚在该目标。
 *
 * ft 档位说明（移交自 Task 9，见 task-10-brief.md）：本槽用到的 ranged/thrown/
 * spell-arrow 素材在 ASSET-NOTES 里都带 `.<color>.<ft>` 结构（jb2a.ranged.beam.001.01、
 * jb2a.ranged.01.projectile.01、eskie.attack.ranged.arrow.ray、blfx…dagger1.throw1），
 * 且每一家都只有单一 ft 层被实际抽帧看过（多为 30ft，个别 05ft）——data/asset-index.json
 * 里同一家其余 ft 分支（05/15/60/90ft）确实存在，但从未验证过时序。ctx.pick() 的
 * {color} 只能把颜色段拼在 dbPath 末尾，没法再在颜色之后追加一层 ft；实测过
 * （见 task-10-report.md）如果只传颜色段而不带 ft，bestFit 会静默落到该颜色下
 * 字典序最先的那个 ft（往往是 05ft/15ft），既不是 30ft，也不会置位 diverged——
 * 正是 ASSET-NOTES 反复强调的“ft 用错就没有命中音/时序错位”那个坑的视觉版本。
 * 因此这几条规则一律把 ft 与颜色一起写死成 ASSET-NOTES 实测过的那一支（放弃跟随
 * 符文色），用精确路径而不是 {color} 动态拼接，防止的问题比因此损失的染色能力更大。
 * 真正按 `s.target.distance` 做多档 ft 选择，需要先把 05/15/60/90ft 逐档抽帧核实
 * 时序（新一轮素材侦察），不在本任务范围内。
 */

/**
 * 模板几何。region.rotation 的约定（**度**，从 +x 正东起算、朝 +y 为正；画布 y 向下，
 * 因此正角度 = 屏幕上顺时针）已在 Crucible 源码里三处互相印证，不是猜的：
 *  1. 写入端 dice/action-use-dialog.mjs:396-399——放置时
 *     `Math.toDegrees(Math.atan2(position.y - origin.y, position.x - origin.x))`
 *     再 `.toNearest(regionConfig.directionDelta)` 吸附后 `shape.updateSource({rotation})`。
 *  2. 消费端 canvas/vfx/spells.mjs:536+（ray）与 425-428（fan/cone）——
 *     `const rotRad = Math.toRadians(rotation)`，推进点写作
 *     `{x: x + Math.cos(rotRad)*d, y: y + Math.sin(rotRad)*d}`。
 * 形状字段同样取自 action-use-dialog.mjs 的 #getRegionData：
 * cone = {x, y, radius, angle, rotation, curvature}，line = {x, y, length, width, rotation}，
 * 两者的 x/y 都是**起点**（锥尖 / 线首），不是中心。
 */
const DEG = Math.PI / 180;

/** 计划要 JSON 化进聊天卡 flag 广播，抹掉 cos/sin 的 1e-14 浮点尘埃，保持可比可读。 */
const r6 = v => Math.round(v * 1e6) / 1e6;

/**
 * 模板远端端点：锥形取轴线上距锥尖 radius 处，line 取起点沿 rotation 走 length。
 * @param {{type: string, x: number, y: number, radius?: number, length?: number, rotation?: number}} region
 * @returns {{x: number, y: number}|null}
 */
function templateEnd(region) {
  if (!region) return null;
  const reach = region.type === "cone" ? region.radius : region.length;
  if (!Number.isFinite(reach) || !Number.isFinite(region.x) || !Number.isFinite(region.y)) return null;
  const rot = (region.rotation ?? 0) * DEG;
  return {x: r6(region.x + (Math.cos(rot) * reach)), y: r6(region.y + (Math.sin(rot) * reach))};
}

/**
 * JB2A 锥形贴图的实际半角正切 —— 0.5，即半角 26.565°/全张角 53.13°（5e 的「宽=长」锥），
 * **不是 60°**（本文件原注释写错了）。三条互相独立的依据：
 *  1. 文件名与画幅：BreathWeapon_Fire01_Regular_<color>_30ft_Cone_Burst_600x600.webm，
 *     30ft = 6 格 = 600px 长，画幅高也是 600px → 端口半宽 300/长 600 = 0.5。
 *  2. sequencer-database 的 _template = [100, 0, 0]：100px/格、两端 padding 为 0，
 *     所以贴图整幅宽度就是模板长度，没有额外留白吃掉张角。
 *  3. 抽帧实测：取平台段 f120-f204 每 6 帧共 15 帧做时间并集，逐列取 alpha 包络对锥尖
 *     做过原点最小二乘 —— alpha>=8 斜率 0.533、alpha>=32 斜率 0.518、alpha>=128 斜率
 *     0.489，都收敛到 0.5（半角 26.6°±0.9°）。
 */
const CONE_SPRITE_HALF_TAN = 0.5;

/** 单张锥形贴图的纵向拉伸上限。再宽就该换素材或多张拼接，而不是把火焰抻成面条。 */
const CONE_YSCALE_MAX = 4;

/**
 * 把 53.13° 的锥形贴图撑到区域张角。
 *
 * 为什么是半宽之比而不是角度之比：Sequencer 的 stretchTo 默认 onlyX:false，
 * scaleY 与 scaleX 同为 distance/widthWithPadding，贴图张角与距离无关；scale 又是在
 * stretch 之后相乘的，所以 scale.y 就是「相对贴图自身张角的纵向倍率」。贴图在距离 d 处
 * 半宽 0.5d，区域要求 tan(A/2)·d，故倍率 = tan(A/2)/0.5。角度比 A/60 是错的：120° 用 2
 * 只能撑出 2·atan(2·0.5)=90°，模板两侧各留一个空楔（有 mask:"region" 兜着，撑过头会被
 * 裁掉，撑不够却是实打实的漏画）。
 * scale.x 必须保持 1：Sequencer 会先用 scale.x 去除 ray.distance，非 1 会连带改掉
 * 按距离挑 ft 分支的判定。
 *
 * **≥180° 防护**（Crucible 的 fan target type 张角 210°，见 TARGET_TYPES.fan.region.angle）：
 * `tan(A/2)` 在 A=180° 处是 `tan(90°)` = Infinity，A>180° 时 `A/2>90°` 使 tan 转负——
 * 两者都不能流进 `scale.y`（Sequencer 拿负/无穷缩放会把贴图翻转或直接崩）。此处先把参与
 * 三角函数运算的角度钳制到 `[1°,179°]`（179° 是浮点安全上界，91.5° 半角的 tan≈114.6 是有限
 * 大数，不是无穷），再让 `CONE_YSCALE_MAX` 的硬上限接管——所以 179° 和 210°/360° 算出的
 * `raw` 都远超 4，最终都截到同一个安全值 4 并 `ctx.warn`。这不是"凑巧没崩"：180° 本来就已经
 * 不是几何意义上的锥形（半张角达到或超过 90°，两条边不再收敛于锥尖），钳制上界本质上是在说
 * "这份素材只能诚实地表达到 179° 的锥，再宽的张角只能截断+留痕，不伪造一个更宽的画面"。
 * 若未来要给 fan 专属规则用这份贴图（当前 fan 还落在 generic.travel 兜底，见文件头），
 * 截断后的画面会比模板窄，这条 warn 就是留给那条新规则的信号，不是本函数该解决的。
 * 输入本身也做了有限性防护：`angleDeg` 若不是有限数字（`null`/`undefined`/`NaN`/坏字符串），
 * 一律退回默认 60°，不让 `NaN` 顺着 `tan()` 一路流到 `scale.y`。
 */
function coneYScale(angleDeg, ctx) {
  const parsed = Number(angleDeg ?? 60);
  const safeDeg = Number.isFinite(parsed) ? parsed : 60;
  const a = Math.min(Math.max(safeDeg, 1), 179);
  const raw = Math.tan((a / 2) * DEG) / CONE_SPRITE_HALF_TAN;
  if (raw > CONE_YSCALE_MAX) {
    const note = safeDeg >= 180 ? "（≥180° 已超出锥形的几何定义，钳制到 179° 处理）" : "";
    ctx.warn(`[travel] 区域张角 ${angleDeg}° 超出单张锥形贴图的拉伸上限${note}，scale.y 截到 ${CONE_YSCALE_MAX}`);
    return CONE_YSCALE_MAX;
  }
  return r6(raw);
}

/**
 * 模板类特效（ray/cone）的锚点：起点在模板本身（锥尖 / 线首），不在某个目标身上，
 * 也不一定精确等于施法者 token 的中心。这两条规则都声明了 once: true，resolve.mjs
 * 因此把默认锚点给成施法者；这里再把模板起点的坐标显式带上，让 stretchTo 的终点与
 * 起点出自同一套几何——normalize() 写的是 `at: c.at ?? at`，规则自带 at 直接生效。
 *
 * **ref 用 "point" 而不是 "origin"**：这是一个冻结坐标，不是「施法者」这个身份。
 * 播放层的 resolveRef 对 "origin"/"target" 会优先解析成真实 placeable（attachTo /
 * copySprite 必须拿到 placeable），只有 "point" 保证原样返回 {x,y}。写成 "origin"
 * 的话，resolve.mjs 的 originAnchor 一旦带上施法者的 tokenId，这两条 cue 的锚点就会
 * 被换成 token 中心——而它们的 stretchTo 终点（templateEnd）与 mask
 * （play.mjs 的 regionMaskShape(plan.region)）仍然取自 region 坐标：起点、终点、遮罩
 * 会来自两套原点，不是「差一点」而是几何自相矛盾，且一条 warning 都不会有。
 */
const templateAnchor = s => ({ref: "point", x: s.region.x, y: s.region.y});

/**
 * 投射物的锚点：起点在**施法者**，不在目标身上。
 *
 * 每目标规则的默认锚点是目标格（resolve.mjs 的槽装配），飞行物必须显式盖掉它——否则
 * `at` 与 `stretchTo` 是同一个坐标，Sequencer 拿到的是一条零长射线：
 *   · `_updateCurrentFilePath`（sequencer.js:16235-16255）在 `_initialize` 里以
 *     showDistanceWarning=true 调用（15629），distance===0 时弹一条红色
 *     ui.notifications.error（"You are stretching over a distance of 0…"）——每射一箭一条；
 *   · `_getDistanceScaling`（16966-16985）算出 spriteScale = 0/textureWidth = 0，
 *     `_applyDistanceScaling`（17014-17017）于是 `sprite.scale.set(0, 0)`，飞行物整个不可见。
 * 两条都只在真渲染时才发生，headless 测试看不见——所以另有 test/play-contract.test.mjs
 * 的「零长拉伸」用例把它变成 commit 前就红。
 *
 * 与 templateAnchor 相反，这里要的是**施法者这个身份**而不是一个冻结坐标：ref 用
 * "origin" 并带上 tokenId/uuid，让施法者 token 的中心与体型参与 Sequencer 的源点换算。
 */
const originAnchor = s => ({ref: "origin", tokenId: s.origin?.tokenId ?? null,
                            uuid: s.origin?.uuid ?? null,
                            x: s.origin?.x, y: s.origin?.y});

export default [
  // ---- 高优先级规则加在这里（Task 10） ----

  /**
   * 射线：连续光束贴合 line 模板，必须用模板遮罩防止溢出墙外。
   *
   * jb2a.ranged.beam.001.01.blue.30ft 91 帧 @30fps=3033ms。ASSET-NOTES 实测
   * f0-9 全空（333ms）——startTime 跳过；两端真正连通是 f36-73（1200-2433ms），
   * f74 起立刻断开进入 17 帧死尾（567ms），duration 按「startTime 之后还播多久」
   * 算：2433-333=2100，裁掉死尾（口径见 resolver/resolve.mjs 的 CUE_DEFAULTS.duration）。
   * 注意 2433 这个绝对终点才是 Sequencer 认的数——播放层把这两个字段换算成
   * `.timeRange(333, 2433)` 下发（player/play.mjs 的 applyTimeWindow）；直接
   * `.startTime(333).duration(2100)` 只会播 1767ms，把 f36-73 的连通段砍掉三分之一。
   * template=[200,200,200] 非空，确认可 stretchTo。
   *
   * 一次动作只有一条光束（once: true）：模板只有一条，罩住几个人跟画几条光束无关。
   * stretchTo 打的是 line 模板末端（x+cos(rot)*length, y+sin(rot)*length）而不是某个
   * 目标——模板只有一条，光束就只有一条，长度也才铺得满 mask:"region" 的遮罩；从前
   * 取 targets[0] 时，贴身目标只把光束铺到模板 1/4 处，遮罩形同虚设。
   *
   * 【自带闪爆·实测订正】ASSET-NOTES 记的「命中起于 f37」是光束头到达右端那一帧
   * （白核包围盒只有 64x88、还是光束的圆头）；真正的放射星爆 f39 才成形（包围盒
   * 121x215），而且**不是一次性爆闪**：目标端的星爆一直烧到 f73 光束断开为止，
   * 逐帧白核像素在 1800-17000 之间脉动但从不熄灭，故记成 sustained。换算到本 cue 的
   * 播放时间轴（扣掉 startTime 333）：f39=967ms 起亮，到播放结束 2100ms。
   * anchor 记成 "region"：修好几何之后这一下星爆落在**模板末端**，不在任何一个目标
   * 身上（模板中段的目标脚下什么都没有），所以它不替 impact 层的逐目标命中闪光让位，
   * 见 armory/flash.mjs。
   */
  {
    id: "spell.gesture.ray", pri: 780, once: true,
    when: s => s.spell?.gesture === "ray" && s.region?.type === "line",
    build: (s, ctx) => {
      const end = templateEnd(s.region);
      if (!end) return null;
      const fx = ctx.pick("jb2a.ranged.beam.001.01.blue.30ft");
      if (!fx) return null;
      return {
        file: fx.file,
        at: templateAnchor(s),
        stretchTo: end,
        mask: "region",
        objectScale: 1, zIndex: 90,
        startTime: 333, duration: 2100,
        selfFlash: {from: 967, at: 967, to: 2100, anchor: "region", sustained: true},
        waitUntilFinished: -300
      };
    }
  },

  /**
   * 锥形：stretchTo 定长度与朝向，scale.y 撑张角，同样要遮罩。
   *
   * jb2a.breath_weapons.fire.cone 的颜色分支（blue/green/orange/purple/yellow）
   * 未被 ASSET-NOTES 文末列为帧数不一致的家族，且 01/02 两个变体号实测都是同一条
   * 30ft 时间轴（用 Fire01/Fire02 两版画法而非不同 ft），可以放心跟 {color:runeColor()}。
   * 254 帧 @30fps=8467ms：f0-89 只有零星预热火星、f90-94 纯空，火头 f95 才真正喷出
   * （3167ms）——startTime 跳过这段死等；平台段 f120-204 亮度稳定在 90% 以上，
   * duration 裁到 f205（6833ms）为止，即 startTime 之后播 3666ms。
   *
   * 一次动作只有一个锥形模板（once: true）：从前每个目标各画一份，实测除 at 外逐字段
   * 完全相同，是纯粹的字面重叠，还会把单份 3366ms 的推进按目标数叠成十几秒。
   * 端点按 region.rotation 算（templateEnd），不是写死正东——fixture 的 rotation 全是 0，
   * 写死时测试照样全绿，实战里旋转过的锥会指错方向再被 mask 切成残片。
   * 张角修正见 coneYScale：贴图实测是 53.13° 的 5e 锥，倍率按半宽之比而非角度之比。
   */
  {
    id: "spell.gesture.cone", pri: 780, once: true,
    when: s => s.spell?.gesture === "cone" && s.region?.type === "cone",
    build: (s, ctx) => {
      const end = templateEnd(s.region);
      if (!end) return null;
      const fx = ctx.pick("jb2a.breath_weapons.fire.cone", {color: ctx.runeColor()});
      if (!fx) return null;
      return {
        file: fx.file,
        at: templateAnchor(s),
        stretchTo: end,
        scale: {x: 1, y: coneYScale(s.region.angle, ctx)},
        mask: "region", zIndex: 90,
        startTime: 3167, duration: 3666,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null,
        waitUntilFinished: -300
      };
    }
  },

  /**
   * 环形脉冲：从施法者向外扩散的一圈冲击波，AOE 命中每个目标。
   *
   * eskie.pulse.energy.01 颜色分支（blue/green/orange/purple/red/yellow）同样
   * 不在 ASSET-NOTES 文末的帧数不一致清单里，可以跟 {color:runeColor()}。
   * 23 帧 @29.97fps=767ms：帧 0 已是完整环、没有 alpha 淡入（"起手很硬"），
   * 补一个很短的 fadeIn 抹掉那一下硬弹出；f14 起碎成弧段消散，f20-22 空转，
   * duration 裁到约 f19（634ms）。自带闪爆＝否，impact 层照常出。
   *
   * 锚点：本规则声明 once: true，resolve.mjs 因此每动作只调一次 build，并把 at 记成
   * {ref:"origin"}——真的从施法者格子向外扩散一圈，不再是"每个目标脚下各来一圈涟漪"。
   * 也不设 aim：锚点已在施法者、环形本身径向对称，再 rotateTowards 某个目标既没有意义，
   * 又会在源点与朝向点重合时退化成 atan2(0,0)。
   */
  {
    id: "spell.gesture.pulse", pri: 770, once: true,
    when: s => s.spell?.gesture === "pulse",
    build: (s, ctx) => {
      const fx = ctx.pick("eskie.pulse.energy.01", {color: ctx.runeColor()});
      if (!fx) return null;
      return {
        file: fx.file,
        objectScale: 1.2 * ctx.geom.sizeScale(),
        fadeIn: 100, fadeOut: 200, zIndex: 85,
        duration: 634,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null,
        waitUntilFinished: -200
      };
    }
  },

  /**
   * 自身爆发：施法者原地炸开，不飞向目标。
   *
   * eskie.casting.physical.01.center.one_shot 的 7 个颜色分支（blue/green/
   * orange/purple/red/yellow/white）同样不在帧数不一致清单里，跟 {color:runeColor()}
   * 安全。30 帧 @24fps=1250ms：f0-3 空（125ms）——startTime 跳过。
   *
   * 锚点：本规则声明 once: true——自身爆发一次动作只该有一份，且锚在施法者。
   * resolve.mjs 的 once 分支把 at 记成 {ref:"origin"}，不再出现"at 记在目标格、
   * aim.towards 指回施法者"那种靠暗号表达自身效果的装法（源点与朝向点重合会让
   * rotateTowards 退化成 atan2(0,0)）。既然锚点就是施法者，aim 直接不设：素材是
   * center/one_shot 的径向爆闪，没有朝向可言。
   *
   * 【自带闪爆】逐帧实测（24fps，帧均 alpha）：f16 之前是向内收拢的火星环（5.6），
   * f17 起炸开放射火花（18.1）、f18-f19 达峰（28.0 / 29.1）、f20 直接塌回 7.95。
   * 扣掉 startTime 125 之后 = 起亮 583ms、峰值 667ms、熄灭 708ms。
   * **anchor 记成 "origin"**：这一下爆闪落在施法者身上，不占目标身上那一层命中闪光的
   * 位置，所以 impact 层照常出（见 armory/flash.mjs）。由此原先按「有条件双闪风险」
   * 转交 Task 11 的那一条，在锚点确定之后即告解除。
   */
  {
    id: "spell.gesture.surge", pri: 770, once: true,
    when: s => s.spell?.gesture === "surge",
    build: (s, ctx) => {
      const fx = ctx.pick("eskie.casting.physical.01.center.one_shot", {color: ctx.runeColor()});
      if (!fx) return null;
      return {
        file: fx.file,
        objectScale: 1 * ctx.geom.sizeScale(),
        zIndex: 85,
        startTime: 125, duration: 1125,
        selfFlash: {from: 583, at: 667, to: 708, anchor: "origin"},
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null,
        waitUntilFinished: -300
      };
    }
  },

  /**
   * 定向投射物：法术射出的实体飞弹（如 magic missile 类的 storm.arrow）。
   *
   * jb2a.ranged.01.projectile.01.dark_purple.30ft——只有 dark_green/dark_orange/
   * dark_purple 三个颜色分支，且同样带 ft 结构（见文件头注释），写死颜色+ft、
   * 不跟随符文色。55 帧 @30fps=1833ms：f0 即有内容不必 startTime；f51-54 是不超过 9
   * 的空 alpha，duration 裁到 1667ms 跳过。waitUntilFinished 给 -1200，让下一段
   * 几乎紧跟命中闪光触发。
   *
   * 【自带闪爆】把画幅右侧 16% 里「alpha>200 且亮度>200」的白核单独数出来：
   * f11=1580（光束头抵达）→ f13=471 → f14=3440（原地放射的白色星爆，帧均 alpha 24.0）
   * → f15=2031 → f19=176 → f23 归零。区间 f14-f19 = 467-633ms（startTime 为 0，
   * 播放时间轴即源时间轴），落在目标端 —— impact 层的通用冲击必须让位。
   */
  {
    id: "spell.gesture.arrow", pri: 760,
    when: s => s.spell?.gesture === "arrow",
    build: (s, ctx, target) => {
      const fx = ctx.pick("jb2a.ranged.01.projectile.01.dark_purple.30ft");
      if (!fx) return null;
      return {
        file: fx.file,
        at: originAnchor(s),
        stretchTo: {x: target.x, y: target.y},
        objectScale: 1 * ctx.geom.sizeScale(),
        aim: {towards: {tokenId: target.tokenId, x: target.x, y: target.y},
              missed: target.results.some(r => r.result === 0 || r.result === 1)},
        zIndex: 100, elevation: target.elevation,
        duration: 1667,
        selfFlash: {from: 467, at: 467, to: 633},
        waitUntilFinished: -1200
      };
    }
  },

  /**
   * 近战挥击。三处几何修正缺一不可：
   *  1. 贴身与隔格用不同长度的素材，否则要么够不着要么穿模——shortsword 的
   *     _template 跨距正好 1 格 5 尺，nodachi 是唯一真正够得到隔一格的
   *     melee_attack 素材（scythe/greatsword 都已被 ASSET-NOTES 否掉，见文末
   *     被否清单）。
   *  2. 大体型施法者放大 1.4 倍、偏移折半（ctx.geom.sizeScale / offsetFor）。
   *  3. 目标在左侧时镜像，否则武器反手挥（两条素材都是从左下抡向右上的明确手性）。
   *
   * when 里排除 thrown：Crucible 的 ActionTags 把 thrown 传播到 melee、melee 再传播到
   * strike，strike.prepare() 又会在 usage.strikes 为空时把手上那把武器塞进去
   * （const/action.mjs:899/800 与 strike 的 prepare()），所以真实的投掷动作快照带着
   * light1 之类的近战 category、且因为匕首不是 ranged 类别 usage.isRanged 还是 false。
   * 不排除的话 pri 620 的本规则会把投掷抢成近战挥击弧线，pri 600 的 strike.thrown
   * 永远不可达——现有 fixture 的 strikes 恒为 [] 正好掩盖了这个实战 bug。
   * 排除条款只认 thrown 标签本身，摘掉 thrown 的同一把匕首仍然走本规则。
   *
   * 两条素材都是无颜色分支的纯几何叶子（colorsUnder 为空），不传 {color}。
   * duration 裁掉各自记录的长空尾：shortsword 命中峰在 f16（533ms），f29-45
   * 共 37% 全空，裁到约 f28（933ms）；nodachi 命中峰在 f12（400ms），f24-41
   * 共 43% 全空，裁到约 f23（767ms）。两者都自带闪爆="否"，impact 层照常出。
   * 叶子各是 4 文件的 variant 数组，ctx.pick 每次按 seed 重掷一个，帧数在
   * 1.30-1.53s（shortsword）/ 1.40-1.47s（nodachi）间波动——ASSET-NOTES 记为
   * 已知限制，不在本规则可控范围内（需要 ctx 增加锁定 variant 的能力）。
   */
  {
    id: "strike.melee", pri: 620,
    when: s => !s.tags?.includes("thrown") && s.strikes.some(w =>
      ["light1", "simple1", "balanced1", "heavy1", "simple2", "balanced2", "heavy2"]
        .includes(w.category)),
    build: (s, ctx, target) => {
      const adjacent = ctx.geom.adjacent(target);
      const branch = adjacent ? "jb2a.melee_attack.01.shortsword.01" : "jb2a.melee_attack.05.nodachi.01";
      const fx = ctx.pick(branch);
      if (!fx) return null;
      return {
        file: fx.file,
        objectScale: 1 * ctx.geom.sizeScale(),
        offset: {x: ctx.geom.offsetFor(target, 0.5), y: 0}, gridUnits: true,
        mirrorY: ctx.geom.onLeft(target),
        aim: {towards: {tokenId: target.tokenId, x: target.x, y: target.y}, missed: false},
        duration: adjacent ? 933 : 767,
        zIndex: 100,
        elevation: target.elevation,
        waitUntilFinished: -400
      };
    }
  },

  /**
   * 拳击轨迹。PF2E 里 unarmed 永远是贴身武器，没有隔格变体可选，因此不做
   * shortsword/nodachi 那样的分支——只有几何缩放/偏移/镜像三项修正。
   *
   * 【换素材：physical.01 → no_hit.01】原来用的 jb2a.unarmed_strike.physical.01.blue
   * 自带闪爆＝是（f20 起在目标锚点原地炸出白黄放射爆闪、f22 达峰），按 ASSET-NOTES
   * 的「二选一」通则不能再叠 impact 闪光层。这一支是全组唯一能零成本换掉的：
   * no_hit.01.blue 与 physical.01.blue 逐帧同源——亮核（alpha>200 且亮度>200）质心
   * f15-f19 实测 no_hit (277,356)/(319,363)/(390,359)/(444,324)/(448,326) 对
   * physical (286,363)/(345,373)/(402,356)/(456,314)/(461,313)，最大偏差不到 0.2 格，
   * **拳锋接触时刻一样落在 f18-f19（600-633ms）**；两者唯一的区别就是 physical 在 f20
   * 之后追加了那一次爆闪（帧均 alpha 2.05→6.41→8.61→18.34，亮核 1428→16469，
   * 质心停在 x≈475-501 原地放射，饱和度塌到 11%/23% 的白黄脱色），而 no_hit 的亮核
   * 仍在平移（444→448→452→458）、像素数直接崩掉（9623→6000→2304→1282→119→0），
   * 全片饱和度从不低于 49%、RGB 恒在纯蓝区间，没有任何一帧脱色。
   * 所以换过来不必重排节拍：duration 显式写成 900ms（29 帧 0.967s，f23 起亮核归零、
   * f27-f28 是空尾），waitUntilFinished 配 -267，交棒点 900-267=633ms，与换素材之前
   * （31 帧 1033ms 不裁剪、wUF -400）逐毫秒相同。
   *
   * 颜色仍然写死 blue：no_hit.01 只有 blue/yellow 两支，yellow 实测 51 帧
   * (1.700s)、是 blue 的 1.76 倍（ASSET-NOTES 文末「同族分支帧数不一致」已记）；
   * 而 DAMAGE_COLOR.radiant 就是 yellow、void/psychic 也会被最近色路由过去，
   * 一旦改成动态染色，1.76 倍的时序漂移不会有任何征兆。unarmed 的伤害类型现实中
   * 几乎总是 bludgeoning（DAMAGE_COLOR 为 null），动态染色本就用不上。
   */
  {
    id: "strike.unarmed", pri: 610,
    when: s => s.strikes.some(w => w.category === "unarmed"),
    build: (s, ctx, target) => {
      const fx = ctx.pick("jb2a.unarmed_strike.no_hit.01.blue");
      if (!fx) return null;
      return {
        file: fx.file,
        objectScale: 1 * ctx.geom.sizeScale(),
        offset: {x: ctx.geom.offsetFor(target, 0.5), y: 0}, gridUnits: true,
        mirrorY: ctx.geom.onLeft(target),
        aim: {towards: {tokenId: target.tokenId, x: target.x, y: target.y}, missed: false},
        zIndex: 100,
        elevation: target.elevation,
        duration: 900,
        waitUntilFinished: -267
      };
    }
  },

  /**
   * 投掷物飞行。blfx.weapon.range.dagger1.throw1.color1.30ft——colorsUnder 只有
   * 字面量 "color1" 这一个键，根本不在 COLOR_HUE 表里，传 {color} 会被
   * pickColor 判定为无可用分支而静默退回不染色（等价于没传），因此直接写死
   * 完整路径，与 ft 说明（见文件头）一致不做动态染色。
   *
   * 54 帧 @30fps=1800ms：f0-16 是向后收势的蓄力（"先退后再甩出"，533ms）——
   * startTime 跳过；真正的飞行是 f16-27（收势后 0-367ms）；f51 起彻底归零，
   * duration 裁到 1167ms（收势后）。镜像同其它投射几何：向左投掷需要 mirrorY。
   * template=[200,200,200] 非空，可 stretchTo。
   *
   * 【自带闪爆＋交棒点订正】画幅右侧 25% 的逐帧实测（帧均 alpha / 白核像素）：
   * f26 只有匕首本体（1.02 / 142），f27 光环起亮（11.28 / 1805），f31-f32 达峰
   * （23.89 / 24.15，白核过万），f34 塌到 15.94、f36 只剩 6.63。扣掉 startTime 533
   * 之后 = 起亮 367ms、峰值 500ms、熄灭 667ms。原来的 waitUntilFinished -500 把交棒点
   * 定在 1167-500=667ms，正好是光环熄灭那一刻——通用 impact 闪光（jb2a.impact.004
   * 起手即亮、约 100ms 达峰）于是在光环之外再闪一次，是本组里肉眼真能数出「两下」的
   * 一条。现在改成 -750：交棒点 417ms，紧跟匕首落点（f27=367ms）而不是等光环烧完；
   * 命中类结果的通用闪光让位给自带光环，防御/落空类结果的反馈也因此落在命中那一拍上。
   */
  {
    id: "strike.thrown", pri: 600,
    when: s => s.tags?.includes("thrown"),
    build: (s, ctx, target) => {
      const fx = ctx.pick("blfx.weapon.range.dagger1.throw1.color1.30ft");
      if (!fx) return null;
      return {
        file: fx.file,
        at: originAnchor(s),
        stretchTo: {x: target.x, y: target.y},
        objectScale: 1 * ctx.geom.sizeScale(),
        mirrorY: ctx.geom.onLeft(target),
        aim: {towards: {tokenId: target.tokenId, x: target.x, y: target.y},
              missed: target.results.some(r => r.result === 0 || r.result === 1)},
        zIndex: 100, elevation: target.elevation,
        startTime: 533, duration: 1167,
        selfFlash: {from: 367, at: 500, to: 667},
        waitUntilFinished: -750
      };
    }
  },

  /**
   * 爆发：没有飞行段，全部交给 impact——施法者原地起爆，没有"到达"这个概念。
   * once: true 是语义标注：blast 是以施法者为中心的区域形状，将来若把 null 换成
   * 实际内容，也必须是每动作一份而不是每目标一份。现在 build 恒返回 null，
   * 加不加旗标产出完全一样（16 个 blast 动作改前改后都是 0 条 cue）。
   */
  {
    id: "target.blast", pri: 200, once: true,
    when: s => s.target?.type === "blast",
    build: () => null
  },

  /**
   * 兜底：远程攻击（含普通弓弩/未细分的 gesture）给一枚中性箭形飞行物；近战不出
   * 内容，由 impact 承担。
   *
   * 原用 jb2a.magic_missile，是 ASSET-NOTES 建立之前的历史欠账（Task 9 review
   * 同源问题），现迁移到 ASSET-NOTES 实测过的 eskie.attack.ranged.arrow.ray——
   * 前端带明确箭头形，语义上比法术味的 magic_missile 更贴合"普通远程武器攻击"
   * 这个兜底场景。同样带 ft 结构（05/15/30/60/90ft 同级），写死
   * ".blue.30ft"，理由见文件头注释。24 帧 @24fps=1.000s，没有真正的"射出"过程
   * （第 2 帧已整条拉满），f8 起碎裂淡出——duration 裁到 800ms 跳过淡出尾段。
   * 自带闪爆="否"，impact 层照常出。
   *
   * **不加 once**：抽查它命中的 96 个动作，46 个每目标一发是对的（45 个 target.type
   * === "single"：influence 12 / strike 12 / touch 12 / 9 个普通远程动作，外加
   * fanOfArrows 这个本来就是一轮箭雨的 cone）。剩下 50 个确实混了区域语义
   * （aura 24 = aura+sense，region circle；fan 12，region cone angle=120；
   * step 12 是位移/闪现；penetratingShot 贯穿线 1；steamVent 脉冲 1），
   * 但那不是本条规则该背的锅：它是 when: () => true 的终极兜底，给它翻上 once
   * 会把 46 个正确用例一起打坏（箭雨只剩一支箭），而且实测会让 24 个零目标动作的
   * build 读到 null 代表目标（本条 build 解引用 target.x）。那 50 个区域动作要的是
   * 补几条自带 once 的区域规则挡在兜底之前（形状线索现成：s.region.type ===
   * "cone"/"circle"、gesture === "step"），属规则覆盖面的问题，不属 once 机制。
   */
  {
    id: "generic.travel", pri: 10,
    when: () => true,
    build: (s, ctx, target) => {
      if (!s.usage.isRanged) return null;
      const fx = ctx.pick("eskie.attack.ranged.arrow.ray.physical.blue.30ft");
      if (!fx) return null;
      return {
        file: fx.file, objectScale: 1 * ctx.geom.sizeScale(),
        at: originAnchor(s),
        stretchTo: {x: target.x, y: target.y},
        aim: {towards: {tokenId: target.tokenId, x: target.x, y: target.y},
              missed: target.results.some(r => r.result === 0 || r.result === 1)},
        duration: 800,
        waitUntilFinished: -300, zIndex: 100
      };
    }
  }
];
