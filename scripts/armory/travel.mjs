/**
 * S2 travel：施法者 → 目标 / 模板。
 *
 * DESIGN.md §8.2 的三条几何修正**2026-08-29（批次 B 第 5 步）重排过**，别再按旧描述
 * （「三条全部集中在 strike.melee 一条规则里」）找它们。现在的分布是：
 *  1. **贴身/隔格换素材** —— 仍在 `strike.melee` 里（`ctx.geom.adjacent`），但它今天只决定
 *     **画面像不像**，不再决定「够不够得到」。射程由 `swingScale()` 承担：握把→刀锋的
 *     画布跨距恒等于中心距，与画幅、与素材无关（推翻的原结论见 ASSET-NOTES 的
 *     「射程口径」一节）。
 *  2. **大体型补偿** —— 近战整族**退出**。中心距本来就把体型算进去了（3×3 的施法者中心
 *     离贴身目标中心就是 2 格而不是 1 格），再乘 `sizeScale()` 只会让刀锋越过目标 40%。
 *     `ctx.geom.sizeScale()` 今天只剩本文件里那几条**非拉伸、非近战**的 cue 在用。
 *  3. **镜像朝向** —— **已翻案**。`mirrorY` 翻的是 y 轴（Sequencer 的 `flipY` 只进
 *     `scale.y`），物理上表达不了「目标在左边」；改造前 8 个罗盘方向朝向恒 0°，只有
 *     SW/W/NW 靠它翻一下冒充。朝向改由 `at`(施法者) → `aim`(目标) 的真旋转承担，
 *     `mirrorY` 退成「同一把武器连打不至于逐帧重合」的变体多样性。
 * 四条近战规则的几何因此收敛进共用工厂 `meleeGeom()`，说理与源码依据都写在那个函数上。
 *
 * 出内容的粒度由规则自己声明（见 resolver/resolve.mjs 的 `rule.once`）：区域与自身
 * 特效置 `once: true`，一次动作只出一份并锚在施法者/模板；投射物、近战、投掷不置位，
 * 每个目标各出一份并锚在该目标。
 * ⚠ `once` 管的是「**与目标数无关**」，不是「只准一条 cue」：`spell.gesture.fan` 是
 * 目前唯一的例外，它把 210° 的扇形切成 3 片各 70° 的锥（说理见 FAN_TILE_ANGLE），
 * 打中 1 个人还是 5 个人都恒定是这 3 条。判据要按「cue 数不随 targets.length 变」写，
 * 按「≤1 条」写会把拼接误判成失控生成。
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
 *
 * ⚠ **2026-08-29 补一条上面漏掉的事实：把 ft 写死曾经是必要但不充分的。**
 * 上面那段只查了「不写 ft 会怎样」，没查「写了 ft 运行时认不认」。实测运行时**不认**：
 * `sequencer.js:20` 的 `FEET_REGEX` 模式是「`\.` + `[0-9]+` + `ft` + `\.` + `*` 量词」、
 * 带 `g` 标志（这里拆开写是因为它的字面量含有会提前闭合本块注释的字符对）——
 * 关键在那个 **前导点**：`:6753` 拿到的是
 * `".30ft"`，而素材模组 json 里的键是 `"30ft"` → `:6768` 的 `entry.file?.[ft]` 恒
 * undefined → `?? foundFile` **原样返回整个 RangeFind 条目** → `flattenEntry` 摊出全部
 * 5 档 → `ctx.pick` 随机取一支，**命中写死那一档的概率只有 1/5**。各档贴图宽
 * 600/1000/1600/2800/4000，抽错档不只是时序漂移，连 stretchTo 的留白比例都跟着变
 * （05ft 档是 33.3%·d 而不是 30ft 档的 12.5%·d）。
 * 离线后端不这样——`offlineBackend` 沿树走到 `.30ft` 叶子恒是单文件，所以这条**离线全绿、
 * 只在上机时走样**，是本仓库最典型的一类漏网。
 * 修法在 `scripts/resolver/assets.mjs` 的 `bandOf()`（批次 B 第 2 步）：运行时后端自己
 * 按路径里的 `.30ft` 取无点段挑档，查不到就 warn 留痕而不是静默回退整族。实测
 * `jb2a.arrow.physical.orange.30ft` 从 5 个文件收敛到 1 个、
 * `psfx.ranged-weapons.longbow.v1.30ft` 从 25 个收敛到 5 个。
 * 所以上面「一律把 ft 与颜色一起写死」这条纪律继续照办——**现在它才真的生效**。
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
 * 【2026-08-29 · 批次 C 结账】原注释这里写着「若未来要给 fan 专属规则用这份贴图，
 * 截断后的画面会比模板窄，这条 warn 就是留给那条新规则的信号」。那条规则已经写了
 * （`spell.gesture.fan`），但**它一次都不会触发这条 warn**：210° 不是拿一张贴图硬撑的，
 * 而是切成 `ceil(210/70)=3` 片各 70°（见 FAN_TILE_ANGLE 的三条理由），单片算出来的
 * `raw ≈ 1.05`，离上限还差 3.8 倍。所以这条 warn 今天仍然是"没人该踩到的信号"，
 * 谁踩响了就是又有人试图用一张贴图去铺一个钝角锥。
 * 输入本身也做了有限性防护：`angleDeg` 若不是有限数字（`null`/`undefined`/`NaN`/坏字符串），
 * 一律退回默认 60°，不让 `NaN` 顺着 `tan()` 一路流到 `scale.y`。
 */
function coneYScale(angleDeg, ctx, halfTan = CONE_SPRITE_HALF_TAN) {
  const parsed = Number(angleDeg ?? 60);
  const safeDeg = Number.isFinite(parsed) ? parsed : 60;
  const a = Math.min(Math.max(safeDeg, 1), 179);
  const raw = Math.tan((a / 2) * DEG) / (halfTan > 0 ? halfTan : CONE_SPRITE_HALF_TAN);
  if (raw > CONE_YSCALE_MAX) {
    const note = safeDeg >= 180 ? "（≥180° 已超出锥形的几何定义，钳制到 179° 处理）" : "";
    ctx.warn(`[travel] 区域张角 ${angleDeg}° 超出单张锥形贴图的拉伸上限${note}，scale.y 截到 ${CONE_YSCALE_MAX}`);
    return CONE_YSCALE_MAX;
  }
  return r6(raw);
}

/**
 * 这一张锥形贴图**在目标平面上**的半宽比，即 `coneYScale` 的分母。
 *
 * ## 为什么不能继续用 CONE_SPRITE_HALF_TAN 这个常数
 *
 * 0.5 是 `jb2a.breath_weapons.*.cone` 那一族的数（600×600 画幅、模板 `[100,0,0]`），
 * 批次 C+D 之后本槽同时在用另外两族**画幅与留白都不一样**的锥：
 *   · `jb2a.template_cone_PF2e.lightning.01` —— 800×1000、模板 `[100,100,100]`
 *   · `jb2a.breath_weapons02.burst.cone.*`   —— 800×800、模板 `[100,50,150]`
 * 拿 0.5 去撑它们，闪电锥会被多撑 1.67 倍、breath02 会被多撑 1.33 倍——`mask:"region"`
 * 会把撑过头的部分裁掉，画面上看不出"撑错了"，只看得出锥的边缘被切得生硬。
 *
 * ## 换算式与它的两条独立佐证
 *
 * `stretchTo` 把「贴图宽 − startPoint − endPoint」这一段映射成 source→target 的距离 d
 * （`_getDistanceScaling`，sequencer.js:16966-16984）。所以贴图局部横坐标
 * `startPoint + span` 处正是目标平面，那里贴图能提供的最大半宽就是**画幅高的一半**
 * （再宽也已经被画布切掉了）。于是
 *
 *     halfTan = (画幅高 / 2) / (画幅宽 − startPoint − endPoint)
 *
 * 两条独立佐证说明这式子不是现推的：
 *  1. 代进 breath_weapons 火锥：300 / (600−0−0) = **0.5**，与 CONE_SPRITE_HALF_TAN 那条
 *     注释里逐帧抽样测出的 0.489-0.533 完全吻合（那是三条 alpha 阈值的最小二乘斜率）。
 *  2. 代进 breath_weapons02：400 / (800−50−150) = **0.667**（半角 33.7°）。ASSET-NOTES
 *     读图记的「视觉半张角 45-50°」比它大，正说明火焰在到达目标平面**之前**就已经顶到
 *     画幅上下边被切掉了——被切掉之后能用的仍然只有 0.667，两个数不矛盾。
 *
 * 画幅尺寸从文件名末尾的 `<宽>x<高>` 取（jb2a / eskie 两家全库通用的命名），取不到就退回
 * 常数——**退回不是静默降级**：退回值恰好是本槽历史上唯一在用的那一族的真值，行为与
 * 改造前逐字相同。
 *
 * @param {{file?: string, template?: number[]|null}|null} fx ctx.pick() 的结果
 * @returns {number}
 */
function spriteHalfTan(fx) {
  const m = /(\d+)x(\d+)\.[a-z0-9]+$/i.exec(fx?.file ?? "");
  const t = Array.isArray(fx?.template) ? fx.template : null;
  if (!m || !t) return CONE_SPRITE_HALF_TAN;
  const span = Number(m[1]) - (Number(t[1]) || 0) - (Number(t[2]) || 0);
  const h = Number(m[2]);
  if (!(span > 0) || !(h > 0)) return CONE_SPRITE_HALF_TAN;
  return r6((h / 2) / span);
}

/**
 * 12 个符文各自打的是什么伤害——**从 `const/spellcraft.mjs` 的 `RUNES` 逐条抄下来的**
 * （control:17 / death:28 / earth:39 / flame:50 / frost:61 / illumination:72 /
 * illusion:83 / kinesis:94 / life:106 / oblivion:117 / soul:129 / storm:140，
 * 每个符文对象里那个 `damageType` 字段）。
 *
 * ## 为什么必须有这张静态表，不能只读 `usage.damageType`
 *
 * `impact.mjs` 的 `elementFor()` 走的是「目标身上结算出来的伤害类型 → 动作的
 * usage.damageType → 主手武器」三级链，那条链在 impact 槽成立，是因为 impact 永远
 * 有一个目标。**travel 槽这几条区域规则是 `once`，零目标时 `target` 就是 null**
 * （resolve.mjs 的槽装配），而全语料 204 条法术的 `usage.damageType` 实测**全是空串**
 * （伤害类型写在符文上、结算时才落到 `target.damage.type`）。只读 usage 的话，
 * cone 的元素分派在**每一条**法术上都会落进默认支——正是要修的那个"12 个符文都在喷火"。
 *
 * 所以取值顺序是：先问已结算的目标（最准，也兼容"同一符文被屈折改了伤害类型"），
 * 再问动作，最后落到符文这张静态表（零目标也答得出）。
 */
const RUNE_DAMAGE = Object.freeze({
  control: "psychic", death: "corruption", earth: "acid", flame: "fire",
  frost: "cold", illumination: "radiant", illusion: "psychic", kinesis: "physical",
  life: "poison", oblivion: "void", soul: "psychic", storm: "electricity"
});

/**
 * 这个动作打的是什么元素。三级回退，理由见 RUNE_DAMAGE。
 * @param {object} s 动作快照
 * @param {object|null} target 代表目标（once 规则零目标时为 null）
 * @returns {string|null}
 */
function elementOf(s, target) {
  return target?.damage?.type || s?.usage?.damageType
      || RUNE_DAMAGE[s?.spell?.rune] || null;
}

/**
 * 锥形区域按元素分派（施工清单 D5）。
 *
 * ## 冲的是什么
 *
 * 改造前 `spell.gesture.cone` 写死 `jb2a.breath_weapons.fire.cone` 只换色：**12 个符文
 * 都在喷火**，霜冻锥是"蓝色的火"、剧毒锥是"紫色的火"。这张表把它拆成七族。
 *
 * ## 表里每个字段的来源（⚠ 逐族重测，一个常数都不许跨族抄）
 *
 * `frames/fps/lead/peak` 四列全部来自 `data/asset-profiles.json` 的全库量测（与
 * `armory/clip-table.mjs` 同源；那张表由 `tools/gen-clip-table.mjs` 生成、只覆盖
 * 兵库既有路径，本轮新增的这几族还不在里面，所以在这里显式登记并把推导写清楚）。
 * 三族的帧率不同（30 / 30 / 24）、空头差 8 倍（2 帧 vs 17 帧）、峰值差 2.6 倍
 * （f67 vs f174）——`startTime/duration` 照抄火锥那两个常数会让霜冻锥前 570ms 全空、
 * 让闪电锥在峰值之前就被 duration 砍掉。
 *
 * `startTime/duration` 的推导对每一族是同一条式子，只有火锥例外：
 *
 *     startTime = max(空头, 峰值 − 3366)      duration = 峰值 − startTime + 300
 *
 * 读法是「**把素材的亮度峰值对齐到交棒点**，窗口不超过 3666ms」：3666 与 300 这两个数
 * 不是新编的，它们是火锥那条规则手调出来的既有节拍（`startTime:3167, duration:3666,
 * waitUntilFinished:-300`，交棒点 3366ms），本表只是把"峰值落在交棒点上"这条隐含判据
 * 显式化，再对其余六族复算一遍。火锥自己保留手调值不动：它的切点 f95 是逐帧读出来的
 * "火头真正喷出"那一帧，比公式给的 f97 更有依据，也免得动到既有基线。
 *
 * `color: true` 表示这一族有可跟随符文色的分支（只有火锥有，其余六族都是单文件或
 * 单色支——⚠ `breath_weapons02.burst.cone.ice` **没有颜色这一级**，写 `.ice.blue`
 * 会被静默降级，见 ASSET-NOTES 本轮订正第 3 条）。
 *
 * ## 为什么默认支是 arcana 而不是继续用火锥
 *
 * corruption / void / physical / psychic 四种伤害类型没有对口的元素锥。给它们配一支
 * "染了色的火"是**错配**（死亡符文喷紫火），而 `breath_weapons02.burst.cone.arcana`
 * 是本组唯一带符文与三角标记的一支，ASSET-NOTES 读图结论原话是「读作『法术能量』
 * 而不是『元素喷吐』，给 psychic 或无属性法术锥」——它是这四种的**兜底**，不是凑合。
 */
const CONE_ELEMENT = Object.freeze({
  // 254f@30、空头 3；startTime/duration 是火锥原有的手调值（f95 火头喷出 → f205）
  fire: {path: "jb2a.breath_weapons.fire.cone", color: true,
         startTime: 3167, duration: 3666},
  // 270f@30、空头 17（567ms）、峰值 f174（5800ms）→ 5800−3366=2434
  cold: {path: "jb2a.breath_weapons.cold.cone.blue", startTime: 2434, duration: 3666},
  // 278f@30、空头 12（400ms）、峰值 f160（5333ms）→ 5333−3366=1967
  acid: {path: "jb2a.breath_weapons.poison.cone.green", startTime: 1967, duration: 3666},
  // 与 green 支逐帧同时序（ASSET-NOTES：纯换色），常数因此相同——不是抄的，是量出来相同
  poison: {path: "jb2a.breath_weapons.poison.cone.purple", startTime: 1967, duration: 3666},
  // 234f@30、空头 2（67ms）、峰值 f67（2233ms）——峰值比雾锥早一倍以上，
  // 公式给的 startTime 为负、被空头接住，整段只播 2466ms
  electricity: {path: "jb2a.template_cone_PF2e.lightning.01", startTime: 67, duration: 2466},
  // 175f@**24**、空头 2（83ms）、峰值 f76（3167ms）
  radiant: {path: "jb2a.breath_weapons02.burst.cone.holy.yellow.01", startTime: 83, duration: 3384},
  // 175f@**24**、空头 2（83ms）、峰值 f71（2958ms）
  psychic: {path: "jb2a.breath_weapons02.burst.cone.arcana.purple.01", startTime: 83, duration: 3175}
});

/** 查不到对口元素锥时的默认支（说理见 CONE_ELEMENT 的注释末段）。 */
const CONE_DEFAULT = "psychic";

/**
 * 扇形（fan）的贴图族——与 cone **有意用两族不同的素材**。
 *
 * 判据是 core 自己的锥底分类（`client/data/shapes.mjs`，play.mjs 的 regionMaskShape
 * 抄了同一套）：Crucible 的 60° cone 是 `curvature:"flat"`（底是一条直线），210° 的 fan
 * 是 `"round"`（底是一段圆弧）。`jb2a.breath_weapons.*.cone` 的远端是切平的三角，
 * `jb2a.breath_weapons02.burst.cone.*` 的远端**外缘是圆的**（ASSET-NOTES 读图结论）——
 * 两族刚好对上两种底，不是为了拆桶硬分的。
 *
 * 元素只分四支（这一族只有 arcana / fire / holy / ice 四种，ASSET-NOTES 订正：
 * 施工清单写的"36 文件"是错的，`burst.cone` 实测只有 12 个文件）。
 */
const FAN_ELEMENT = Object.freeze({
  fire: {path: "jb2a.breath_weapons02.burst.cone.fire.orange.01", startTime: 83, duration: 3009},
  cold: {path: "jb2a.breath_weapons02.burst.cone.ice.01", startTime: 83, duration: 3384},
  radiant: {path: "jb2a.breath_weapons02.burst.cone.holy.yellow.01", startTime: 83, duration: 3384},
  arcana: {path: "jb2a.breath_weapons02.burst.cone.arcana.purple.01", startTime: 83, duration: 3175}
});

/** fan 的默认支：非火/非冰/非光的一律走"法术能量"那一支，理由同 CONE_DEFAULT。 */
const FAN_DEFAULT = "arcana";

/**
 * 单张锥形贴图愿意承担的最大张角（度）。
 *
 * 210° 的 fan **一张贴图铺不满**：`CONE_YSCALE_MAX = 4` 最多表达 126.87°
 * （`atan(0.5×4)×2`），而且把一支火焰纵向抻 4 倍本身就已经不像火了。施工清单 §0.13
 * 给的两条路里，"换宽扫族"被选材实测否掉了（`breath_weapons02` 的视觉半张角只有
 * 45-50°，解决的是圆边不是宽度），剩下的是**多张拼接**——那一条同时给了具体参数：
 * 「3 份 rotation ±70°、各 `scale.y = tan(35°)/0.5 = 1.400`」，本常数就是那个 70。
 *
 * 选拼接而不是"声明已知截断 + 给 warn 豁免"，理由有三条，都不是风格问题：
 *  1. **豁免会把守卫弄瞎。** `coverage.test.mjs` 守的是「plan.warnings 恒为空」，
 *     给 fan 开一个点名豁免，等于在这条全局不变式上开一个长期缺口，而它正是本轮
 *     另外几条几何改动的兜底报警器。
 *  2. **截断不是"小一点"，是漏画 41.565°/侧。** 210° 截到 126.87° 之后，模板两侧各留
 *     一个 41.6° 的空楔——`mask:"region"` 只能裁掉多出来的，补不出缺的那块。
 *  3. **拼接的代价是可算的**：3 条 cue、逐条 `scale.y = tan(35°)/halfTan ≈ 1.05`
 *     （breath_weapons02 的 halfTan 是 0.667），离 CONE_YSCALE_MAX 还有 3.8 倍余量，
 *     不触发任何 warn；三张同素材同时序，接缝处的重叠由 ADD 式的火焰自己糊掉。
 */
const FAN_TILE_ANGLE = 70;

/**
 * 在一个**给定的颜色白名单**里取最接近目标色的一支。
 *
 * 与 `resolver/palette.mjs` 的 `pickColor` 的分工：那一个问的是「素材树底下有哪些颜色」，
 * 这一个问的是「这些颜色里哪几支**在观感上可用**」。两者不能合并——素材树答不出
 * 「同族里有一支是离群值」这种事，而那正是本轮两处必须避开的坑：
 *   · `jb2a.explosion.02.green` 闪爆比 73.86，其余四支 8.73-11.65，**差 7 倍**；
 *   · `jb2a.magic_signs.circle.02.conjuration.loop` 的 6 个 `dark_*` 支在暗底上糊没。
 * 这两条都在 ASSET-NOTES 的备注里，且都**故意没进否决清单**——否决是双向传染的，
 * 否掉一个颜色支会连带否掉规则真正要 pick 的那个父节点。
 *
 * @param {string|null} want 期望色（一般是 ctx.runeColor()）
 * @param {string[]} allowed 白名单，按可用性排序，第一个是取不到色时的安全档
 * @returns {string}
 */
/**
 * 爆裂可用的色支。`jb2a.explosion.02` 底下有 blue/green/orange/purple/yellow 五支，**全部可用**。
 *
 * 【2026-08-29 翻案：green 放回来】原本以 `flashRatio` 73.86（其余四支 8.73-11.65，差 7 倍）
 * 为由排除 green，理由写的是「同一条规则里混用会一支比一支白得多」。**读图后判定这条理由
 * 方向反了。**
 *
 * `flashRatio = 峰值亮度 ÷ 非空帧亮度中位数`（`tools/profile-family.mjs:109-114`），
 * 它答的是「最亮那帧比常态亮多少倍」，**不是「有多亮」**。五支是同一段动画的五个配色
 *（同 41 帧、同峰值帧 f8、同内容占比 0.94），拼族图逐帧看：
 *   · **峰值帧 f8**：五支结构完全一致，一圈亮环包深色花形，**green 并不比其余四支白**；
 *   · **残留段 f16-18**：蓝/橙/紫/黄是密集明亮的粒子喷射，而 **green 的余烬明显稀疏**，只剩几道细线。
 * 也就是说 73.86 是**分母小**造成的（green 常态暗），不是分子大。
 *
 * 排除它的代价是确定的：`RUNE_COLOR.earth`/`life` 都走绿系，排掉 green 之后
 * **酸与毒的爆裂在画面上是黄的**——拿一个「余烬淡一点」的观感顾虑，换一个「颜色明确不对」
 * 的语义错误，按仓库纪律（兜底 > 错配）是亏的。owner 也定过：`darkLuma`/`flashRatio`
 * 这类**审美向**指标降级为参考、不作否决线，有疑问就拼族图看一眼。这次看了。
 *
 * 首位 blue 兼作取不到符文色时的安全档。
 */
const BLAST_COLORS = Object.freeze(["blue", "green", "orange", "purple", "yellow"]);

/**
 * 召唤法阵可用的色支。`magic_signs.circle.02.conjuration.loop` 有 12 支
 * （6 regular + 6 `dark_*`），**12 支全部可用**。
 *
 * 【2026-08-29 翻案：6 个 dark 支放回来】原本以「在暗底上糊没」为由只留 regular，
 * 依据是 darkLuma 38.4-72.4 vs regular 的 118.9-164.6。**拼族图看过，这条不成立**：
 * 12 支同为 121 帧、flashRatio 1.00-1.03 的无缝循环，dark 支线更细更暗，
 * **但法阵的内外环、五芒星、六个符号位全部清晰可读**——是更含蓄的一版，不是看不见。
 *
 * 这是与上面 `BLAST_COLORS` 完全同型的一次错误：把一个**审美向**量测
 *（darkLuma = 合成到深色底后的平均亮度）当成了**功能性判定**（「可见/不可见」），
 * 中间那一步「真的去看一眼」被跳过了。owner 的原则：
 * **合适 / 更好比数字重要，「它再闪又如何」——反过来「它再暗又如何」同样成立。**
 * 量测数字可以用来排序、用来提示，但不该单独否掉一条素材。
 *
 * 放回来的直接收益：色轴从 6 支翻倍到 12 支，而 Crucible 正好有 12 个符文——
 * 召唤法阵因此可以做到逐符文不撞色（owner 的 KPI：尽量不复用）。
 */
const CIRCLE_COLORS = Object.freeze([
  "blue", "green", "pink", "purple", "red", "yellow",
  "dark_blue", "dark_green", "dark_pink", "dark_purple", "dark_red", "dark_yellow"
]);

function nearestAllowed(want, allowed) {
  if (!want) return allowed[0];
  if (allowed.includes(want)) return want;
  let best = allowed[0];
  let bestDist = Infinity;
  for (const c of allowed) {
    const d = Math.abs(hueDelta(c, want));
    if (d < bestDist) { bestDist = d; best = c; }
  }
  return best;
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

/**
 * 线状模板的**中点**锚。锥形/射线用 `templateAnchor`（起点＝锥尖/线首）就够了，因为它们
 * 还要 `stretchTo` 到远端；而 surge 用的是一支径向爆闪素材，没有「从这里长到那里」这回事，
 * 只能把画面摆在线段中央再按 `sizePx` 撑到模板大小。ref 同样用 "point"（理由见
 * templateAnchor 那段：这是一个冻结坐标，不是「施法者」这个身份）。
 */
const lineMidAnchor = region => {
  const rot = (region.rotation ?? 0) * DEG;
  const half = region.length / 2;
  return {ref: "point",
          x: r6(region.x + (Math.cos(rot) * half)),
          y: r6(region.y + (Math.sin(rot) * half))};
};

/**
 * 区域中心的冻结坐标锚。`ref` 用 `"point"` 的理由与 `templateAnchor` 那段一字不差
 * （这是一个坐标、不是"施法者"这个身份），不再重复；这里只补一条**必须配 sizePx**：
 * 播放层对裸点 cue 硬性禁用 `scaleToObject`（`play.mjs` 的"尺寸的三条互斥路"，
 * 施工清单 §0.12），既不给 `sizePx` 也不给 `scale` 的裸点 cue 会被丢掉缩放并 warn。
 */
const pointAnchor = (x, y) => ({ref: "point", x: r6(x), y: r6(y)});

/**
 * 矩形模板（summon：create / conjure 两个手势）的中心。
 *
 * `anchorX/anchorY` 是「x,y 落在矩形的哪个分数位置」，**summon 与其它矩形不一样**：
 * `dice/action-use-dialog.mjs:556-568` 的 rectangle 分支写死 `anchorX = anchorY = 0.5`
 * （x,y 是中心），而 `:576-581` 的 `case "summon"` 紧接着把它**改写成 0**
 * （x,y 是角点）并把宽高一起改成 `size * d`。所以这里不能假设某一种，按 anchor 现算：
 * 中心 = x + (0.5 − anchorX) · width。缺字段时按 core 的默认 0.5 处理（即 x,y 已是中心）。
 */
const rectCenter = region => ({
  x: region.x + ((0.5 - (region.anchorX ?? 0.5)) * (region.width ?? 0)),
  y: region.y + ((0.5 - (region.anchorY ?? 0.5)) * (region.height ?? 0))
});

/**
 * Sequencer 在模板缺 `gridSize` 时用的默认授权网格。
 *
 * `EffectSection.gridSizeDifference`（sequencer.js:15113-15118）是
 * `canvas.grid.size / (this.template?.gridSize ?? this.defaultGridSize)`，
 * 而 `defaultGridSize` 恒为 100（15116-15118）。非拉伸分支的最终缩放就是
 * `sprite.scale.set(baseScaleX * gridSizeDifference)`（17145-17148）。
 *
 * **播放层永不下发 gridSize**（player/play.mjs 的模板补偿块，理由写在那里：模板落到
 * 不消费它的 cue 上时，缺了 gridSize 才会 `?? 100` 落回默认、体积不变），且这条被
 * `test/play-contract.test.mjs` 的「不许下发 gridSize」钉死。于是挥击那一路的
 * `gridSizeDifference` 恒等于 `canvas.grid.size / 100`，素材自己那个 200px 的授权网格
 * 必须由本文件在 `scale` 里换算回来——见 swingScale()。
 * ⚠ 哪天播放层改成下发 gridSize，那条契约断言会先红；红了就必须回来把这里的换算撤掉，
 * 否则挥击长度会整族腰斩。
 */
const SEQ_DEFAULT_GRID = 100;

/**
 * 近战素材模板的跨距，**格**：`(贴图宽 − startPoint − endPoint) / gridSize`。
 *
 * 施工清单 §0.3 对整个 `jb2a.melee_attack` + `jb2a.unarmed_strike`（482 个叶文件）逐文件
 * 展开：478 个 800×600 `[200,300,300]`、4 个 1000×800 `[200,400,400]`，两种取值算出来的
 * 跨距**都是 1.00 格，零例外**。本仓兵库实际会选到的 156 个叶文件复核同样恒为 1.000。
 * 所以「握把→刀锋」在 scale=1 时正好一格，`swingScale` 才能直接拿中心距当倍率。
 * 将来若引进跨距不是 1 格的挥击素材，刀锋会按同比例过/欠伸，那时这个常数要改成
 * 逐素材查表（需要贴图宽，得先把画幅带进 asset-index）。
 */
const MELEE_TEMPLATE_REACH = 1;

/**
 * 一格是多少像素。
 *
 * 快照里**没有** gridSize 字段（`snapshotAction` 只把 env.gridSize 用掉、不转写），但每个
 * token 几何同时带了「格数」`width` 与「像素」`w`——`tokenGeom`（trigger/snapshot.mjs）
 * 的构造式就是 `w = width * gridSize`（拿不到 `getSize()` 时的手算分支写得最直白），
 * 相除即得。施法者与目标算出来必然相同，先问目标只是因为这几条都是**每目标**规则、
 * 目标一定在场；两边都缺才退回 Foundry 的默认格宽 100。
 */
function gridPxOf(s, target) {
  const of = g => (Number.isFinite(g?.w) && Number.isFinite(g?.width) && g.width > 0
    ? g.w / g.width : null);
  return of(target) ?? of(s?.origin) ?? SEQ_DEFAULT_GRID;
}

/**
 * 挥击的绝对缩放：让「握把→刀锋」这一段正好等于施法者中心到目标中心的距离。
 *
 * ## 为什么是绝对 scale 而不是 scaleToObject
 *
 * `_applyScaleToObject`（sequencer.js:17171-17190）按 `getSourceData()` 的宽度缩放，
 * 而 getSourceData 取的是 **atLocation 那个对象**。改造前 at 是目标 token，于是中体型下
 * 贴图被压成 100px 宽，握把 0.375、刀锋 0.625，跨距只有 25px = **0.25 格**（施工清单
 * §0.3）；本轮 at 改成施法者之后，那个参照物会跟着变成「施法者那么宽」，大体型施法者的
 * 挥击贴图会从 140px 跳到 280px——两种都不是「够到目标」这个语义。所以整条改用绝对
 * 缩放，`objectScale` 在这四条规则上退休（播放层的三条互斥路 scale > sizePx >
 * scaleToObject 会让它变成死字段，不留）。
 *
 * ## 代数
 *
 * 非拉伸分支：`sprite.width = 贴图宽 × scale × gridSizeDifference`（17145-17148 +
 * 15113-15118），`gridSizeDifference = G / 100`（G = canvas.grid.size，播放层不下发
 * gridSize，见 SEQ_DEFAULT_GRID）。贴图里握把→刀锋占的比例是
 * `(贴图宽 − sp − ep) / 贴图宽`，而 `贴图宽 − sp − ep = 跨距(格) × gridSize`。两式相乘：
 *
 *     握把→刀锋(px) = 跨距(格) × gridSize × scale × G / 100
 *
 * 要它等于 `d × G`（d = 中心距，格），解得
 *
 *     scale = d × 100 / (gridSize × 跨距)
 *
 * 与画幅无关、与格像素数 G 无关——两者都被约掉了。跨距恒 1 格（MELEE_TEMPLATE_REACH），
 * 所以中体型贴身、gridSize=200 的素材 scale = 0.5：贴图 800px 宽画成 400px，中间那 25%
 * 正好铺满一格。
 *
 * ## 体型
 *
 * 不再乘 `ctx.geom.sizeScale()`。大体型施法者的中心距本来就更大（3×3 的中心到贴身目标
 * 中心是 2 格而不是 1 格），d 已经把体型算进去了；再乘 1.4 只会让刀锋越过目标 40%。
 *
 * @param {object} s 动作快照
 * @param {object} target 这一击的目标
 * @param {number[]|{gridSize:number}|null} template ctx.pick() 带下来的素材模板
 */
function swingScale(s, target, template) {
  const gridPx = gridPxOf(s, target);
  const raw = Math.hypot((target?.x ?? 0) - (s.origin?.x ?? 0),
                         (target?.y ?? 0) - (s.origin?.y ?? 0)) / gridPx;
  // 施法者与目标中心重合（自伤/自身近战）时 d=0 会把贴图缩成 0 而整条看不见；
  // 这种快照本来就没有攻击轴（play.mjs 的 rotates 判据也会跳过转向），退回素材的
  // 自然跨距 1 格，画一记原地挥击，比画一个不可见的点诚实。
  const d = raw > 1e-6 ? raw : 1;
  const gs = Number(Array.isArray(template) ? template[0] : template?.gridSize);
  const authored = Number.isFinite(gs) && gs > 0 ? gs : SEQ_DEFAULT_GRID;
  return r6((d * SEQ_DEFAULT_GRID) / (authored * MELEE_TEMPLATE_REACH));
}

/**
 * 近战/法器挥击的共用几何。`strike.melee` / `strike.melee.combo` / `strike.talisman` /
 * `strike.unarmed` 四条规则此前**逐字抄了同一段错的几何**，这里收敛成一处。
 *
 * 改前每条都是：
 *   `at`（默认）= 这个目标 + `aim.towards` = 同一个目标 + `offset:{x:0.5,y:0}格`
 *   + `mirrorY: onLeft(target)`
 * 三处连锁的后果（施工清单 §0.2）：`play.mjs` 的
 * `rotates = !stretchTo && at≠aim` 恒 false ⟹ **一次都不 rotateTowards**；而 spriteOffset
 * 写的是 `sprite.position`（sequencer.js:16323），sprite 挂在 rotationContainer(15673) →
 * pluginContainer(15675) → spriteContainer(15676) 之下，三层都没转过 ⟹ 那 0.5 格偏移恒沿
 * **屏幕 +x**。探针实测 8 个罗盘方向朝向恒 0°，只有 SW/W/NW 三向靠 mirrorY 翻一下——
 * owner 那句「A 打 B，动画在 B 的其他方向受到击打，而且击打方向也不对」的机制层根因。
 *
 * 现在的四件事，缺一不可：
 *
 *  1. **`at` 改施法者**（`originAnchor`）。这样 at≠aim，`rotates` 才为真，整张贴图才会
 *     绕锚点转到攻击轴上。四家成品配方一致「锚源、朝目标」：AA `autoanimations.js:17141
 *     atLocation(sourceToken) / :17145 rotateTowards(currentTarget.token)`；trove 的 Katana
 *     图 `location ← outputs:source`、`aim.towards ← outputs:target`；blfx
 *     `weaponMacros.js:126-137 .atLocation(sourceToken).rotateTowards(targetToken)`；
 *     eskie `divine-strike.js:275-280 .atLocation(token).rotateTowards(targetSquare)`。
 *     ⚠ **不要**改成「at=目标 + aim=施法者 + rotationOffset:180」那一版：朝向算出来一样，
 *     但 `play.mjs` 会给非模板转向补一句 `e.anchor({x:0.5,y:0.5})`，把**贴图中心**摁在
 *     目标身上，且刀锋朝着攻击者。
 *  2. **带上 `template`**。锚点从此由素材自己标定的握把点决定：`_setAnchors`
 *     （sequencer.js:17022-17025）在 `rotateTowards.template` 为真时把
 *     `anchor.x = startPoint / 贴图宽`（本族 300/800 = 0.375，正是握把）。
 *     没有它，`play.mjs` 会走回历史的 pivot=-w/2 语义，贴图中心压在施法者身上——
 *     **template 与 at 是一套，不能只改一个**。
 *  3. **`offset` 归零**（整个字段不写）。它存在的唯一理由是「把贴图往目标那边推一点」，
 *     而那是锚点没定对时的补偿；锚点定对之后再推就是纯粹的错位。
 *  4. **`scale` = 中心距**（swingScale），让刀锋正好落在目标中心，见该函数注释。
 *
 * `mirrorY` 不再跟 `onLeft`：有了真旋转之后，左右翻转不该再承担「方向」这个职责
 * （它翻的是 y 轴，本来也表达不了「目标在左边」）。jb2a 同形制的 4 个变体本身就是四种
 * 挥击走向，这里再随机翻一次纯粹是让同一把武器连打不至于逐帧重合。
 *
 * ⚠ **这一枚硬币在兵库里就摇，不写 `randomizeMirrorY: true` 让 `freezeRandom()` 去摇**：
 * `freezeRandom`（resolve.mjs）是**逐 cue** 摇的，而 `strike.melee` 的 empowered 分支会
 * 用同一个几何再发一条彩色拖尾——两条 cue 各摇一次就有一半概率翻向相反，而拖尾与挥击是
 * **逐帧对齐**的（Group01 的 trail 46/40/39/41 与 shortsword.01 逐位相同），翻反等于画出
 * 两道交叉的弧。同一处的变体对齐在本规则里已有先例（拖尾按挥击文件的下标取同位变体），
 * 镜像用同一个办法。`ctx.rngAux()` 正是 `freezeRandom` 用的那条辅助随机流（与 `ctx.rng`
 * 的选材流分开，见 resolver/context.mjs），种子仍是 `snapshot.seed` 的纯函数——全场一致、
 * 可复现这两条性质一点没变，只是摇的地方从播放前挪到了出手端的兵库里。
 *
 * `missed` 恒 false 是有意的：这条 cue 用 `aim.towards` 而不是 `stretchTo`，而
 * `_getOffset`（sequencer.js:15360）的判据是 `missed && (!source || !data.target)`——
 * rotateTowards 会给特效装上 `data.target`，missed 偏移根本加不上去，写 true 只会换来
 * 播放层一条告警。近战打偏由 impact 的 MISS 层表达。
 *
 * @param {object} s 动作快照
 * @param {object} ctx 能力袋（只用 rngAux）
 * @param {object} target 这一击的目标
 * @param {{template: number[]|null}|null} fx ctx.pick() 的结果
 */
function meleeGeom(s, ctx, target, fx) {
  return {
    at: originAnchor(s),
    template: fx?.template ?? null,
    scale: swingScale(s, target, fx?.template),
    mirrorY: ctx.rngAux() < 0.5,
    aim: {towards: {tokenId: target.tokenId, x: target.x, y: target.y}, missed: false}
  };
}

import {clipOf, leastDeadAir} from "./clip-table.mjs";
import {strikeSounds, spellImpactSound} from "./sounds.mjs";
// 只用 hueDelta 这一个纯函数（给 nearestAllowed 算色距）；配色表本身仍由 ctx 那一路取，
// 兵库不直接读 RUNE_COLOR/DAMAGE_COLOR——那两张表的读取口径在 resolver/context.mjs 上。
import {hueDelta} from "../resolver/palette.mjs";
// 自带闪爆的窗口换算只此一处：规则表里写素材自身时间轴上的三个毫秒数，trimFlash 按
// startTime/duration 裁成"相对本 cue 播放起点"的申报值（见 armory/flash.mjs 的说明）。
import {trimFlash} from "./flash.mjs";

/**
 * 这个动作是不是「打好几下」。
 *
 * 三条判据都来自动作自己写的东西，不猜：
*   · `mainhand` + `offhand` 同时出现 = 双手各打一次（Crucible 的双持连打就是这么标的）
 *   · `dualwield`
 *   · 单体目标且 `cost.action >= 2`
 *
 * 最后一条限定「单体目标」是因为多动作点的区域动作（cleave / tailSweep / lightningBurst）
 * 花的是范围而不是次数，它们归 `strike.shape.area`。
 */
const isMultiHit = s => {
  const t = new Set(s.tags ?? []);
  return (t.has("mainhand") && t.has("offhand")) || t.has("dualwield") ||
         (s.target?.type === "single" && (s.cost?.action ?? 0) >= 2);
};
import {shapeOfAction, CONE_VOLLEY, RAY_GENERIC, PULSE_BURST,
        SWEEP_RING, MOVE_TRAIL} from "./action-shapes.mjs";
import {pickFor, comboFor, trailFor, trailColorFor, ammoFor, TALISMAN_SHAPE, talismanColorFor,
        RANGED_SHAPE, RANGED_CATEGORY} from "./weapon-shapes.mjs";
// 命名空间形态**只给 reachFor 一个人用**，理由写在 strike.melee 的隔格分支上：
// 那个导出由形制表 agent 同批新增，具名 import 一个还不存在的绑定会让整个模块加载失败。
import * as WEAPON_SHAPES from "./weapon-shapes.mjs";

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
    build: (s, ctx, target) => {
      const end = templateEnd(s.region);
      if (!end) return null;
      const fx = ctx.pick("jb2a.ranged.beam.001.01.blue.30ft");
      if (!fx) return null;
      const rayCue = {
        file: fx.file,
        at: templateAnchor(s),
        stretchTo: end,
        /*
         * 【素材两端留白】施工清单 §0.4。本槽 8 条出 stretchTo 的规则各带一行同样的
         * `template: fx.template`，这里写一次总账，其余各处只留指针。
         *
         * 射线类贴图两端都留着一段透明画布（起手的蓄力段、落点的溅射段），素材包因此随
         * 文件发布一组 `[gridSize, startPoint, endPoint]`。cue 下发的是**裸文件路径**
         * （选材已在出手端摇定），Sequencer 于是造出一个没有 template 的
         * `SequencerFilePlain`（sequencer.js:16221/6364），`_getDistanceScaling`
         * （16966-16984）的 startPoint/endPoint 双双 `?? 0`，**整张画布连同留白被压进
         * source→target 的射线长度**——光束首尾各缩一截。实测 265 条 stretchTo cue 里
         * 248 条中招，最轻 6.25%·d（eskie ray [200,0,100]），最重 30%·d
         * （jb2a line200B [200,0,300]，4 格距离下尾端差 120px = 1.2 格）。
         *
         * `ctx.pick()` 返回的 `template` **已经是解析好的数值三元组**（assets.mjs 的
         * `templateOfEntry()` 做了祖先继承 + 查表还原），不是名字，直接透传即可。
         * 数值本身一个都不许抄进兵库：它随素材包发布，升级就会变，必须沿解析链搬运
         * （见 resolver/resolve.mjs 的 CUE_DEFAULTS.template 注释）。
         *
         * 播放层负责两道防线（player/play.mjs 的模板补偿块）：`startPoint` 为 0 会被
         * `EffectSection.template()` 的 `if (x)` 静默丢掉、进而算出 NaN 锚点让整条特效
         * 不可见，所以它补成 1px；两端全 0 的模板整条跳过。**别在兵库里把 0 改成别的数**。
         */
        template: fx.template,
        mask: "region",
        objectScale: 1, zIndex: 90,
        startTime: 333, duration: 2100,
        selfFlash: {from: 967, at: 967, to: 2100, anchor: "region", sustained: true},
        waitUntilFinished: -300
      };
      // 命中音：交棒点就是画面上「打中」的时刻（duration + waitUntilFinished）
      return [...spellImpactSound(s, ctx, target, 1800), rayCue];
    }
  },

  /**
   * 锥形：stretchTo 定长度与朝向，scale.y 撑张角，同样要遮罩。
   *
   * 【2026-08-29 · D5 按元素分派】素材不再写死火锥，改查 `CONE_ELEMENT`（那张表上
   * 记着七族各自的路径与逐族重测出来的 startTime/duration，以及"为什么默认支是 arcana
   * 而不是染了色的火"）。火锥那一支的说明留在这里，因为它的两个常数是手调的：
   * jb2a.breath_weapons.fire.cone 的颜色分支（blue/green/orange/purple/yellow）
   * 未被 ASSET-NOTES 文末列为帧数不一致的家族，且 01/02 两个变体号实测都是同一条
   * 30ft 时间轴（用 Fire01/Fire02 两版画法而非不同 ft），可以放心跟 {color:runeColor()}。
   * 254 帧 @30fps=8467ms：f0-89 只有零星预热火星、f90-94 纯空，火头 f95 才真正喷出
   * （3167ms）——startTime 跳过这段死等；平台段 f120-204 亮度稳定在 90% 以上，
   * duration 裁到 f205（6833ms）为止，即 startTime 之后播 3666ms。
   * **只有火锥跟符文色**（`color: true`）：其余六族要么是单文件、要么颜色本身就是元素
   * 语义（毒的绿与紫分别是 acid 与 poison），再叠一次 hue 旋转只会把元素色转没。
   *
   * 一次动作只有一个锥形模板（once: true）：从前每个目标各画一份，实测除 at 外逐字段
   * 完全相同，是纯粹的字面重叠，还会把单份 3366ms 的推进按目标数叠成十几秒。
   * 端点按 region.rotation 算（templateEnd），不是写死正东——fixture 的 rotation 全是 0，
   * 写死时测试照样全绿，实战里旋转过的锥会指错方向再被 mask 切成残片。
   * 张角修正见 coneYScale；分母改成**逐素材现算**的 spriteHalfTan（见该函数）——
   * 七族里有两族的画幅与留白与火锥不同，继续用 0.5 会把闪电锥多撑 1.67 倍。
   */
  {
    id: "spell.gesture.cone", pri: 780, once: true,
    when: s => s.spell?.gesture === "cone" && s.region?.type === "cone",
    build: (s, ctx, target) => {
      const end = templateEnd(s.region);
      if (!end) return null;
      const spec = CONE_ELEMENT[elementOf(s, target)] ?? CONE_ELEMENT[CONE_DEFAULT];
      const fx = ctx.pick(spec.path, spec.color ? {color: ctx.runeColor()} : {});
      if (!fx) return null;
      const coneCue = {
        file: fx.file,
        at: templateAnchor(s),
        stretchTo: end,
        // 素材两端留白的补偿，总账见 spell.gesture.ray 那条规则上的注释（施工清单 §0.4）
        template: fx.template,
        scale: {x: 1, y: coneYScale(s.region.angle, ctx, spriteHalfTan(fx))},
        mask: "region", zIndex: 90,
        startTime: spec.startTime, duration: spec.duration,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null,
        waitUntilFinished: -300
      };
      // 命中音：交棒点就是画面上「打中」的时刻（duration + waitUntilFinished）
      return [...spellImpactSound(s, ctx, target, spec.duration - 300), coneCue];
    }
  },

  /**
   * 扇形：210° 的宽扫，**三张锥拼出来**。施工清单 §0.13 的第二半。
   *
   * ## 改造前
   *
   * `spell.gesture.cone` 的 when 写的是 `gesture === "cone"`——**拿姿态 id 当形状的
   * 代名词**。fan 的 region 明明也是 cone（210°、curvature round），却因为姿态 id 不叫
   * cone 而掉进 pri 10 的 `generic.travel`：探针 8 个方向全部输出
   * `travel generic.travel`，画面是**每个目标各一支蓝色物理箭**（连 once 都没有）。
   *
   * ## 三件事，缺一不可
   *
   *  1. **判据改成形状**（`region.type === "cone"`），不再问姿态叫什么。
   *  2. **拼接**：210° 一张贴图铺不满，按 FAN_TILE_ANGLE 切成 `ceil(210/70)=3` 份，
   *     每份 70°、各自 stretchTo 到自己那条轴线的远端。中心角依次是
   *     `rot − 105 + 35 + 70·i` = rot−70 / rot / rot+70，与施工清单给的参数一致。
   *     单份的 `scale.y = tan(35°)/halfTan ≈ 1.05`（breath_weapons02 的 halfTan 是
   *     0.667），离 CONE_YSCALE_MAX 还差 3.8 倍——**一条 warn 都不会响**，
   *     `coverage.test.mjs` 的「plan.warnings 恒为空」不必开豁免（说理见 FAN_TILE_ANGLE）。
   *  3. **素材换族**：用远端外缘是圆的 `breath_weapons02`，对上 core 的 `round` 底
   *     （见 FAN_ELEMENT）。这一族解决的是"圆边"这个形状语义，不是宽度——宽度由拼接解决，
   *     两件事别混（ASSET-NOTES 本轮订正第 2 条把"换宽扫族就能解决 210°"证伪了）。
   *
   * ## 交棒与遮罩
   *
   * 三条 cue 里**只有中间那条带交棒点**：三张同素材同时序，让三条都挂 waitUntilFinished
   * 会让 impact 等三次（同一个道理见 strike.melee 的拖尾层「叠加层不再交棒」）。
   * `mask:"region"` 三条都要：拼接是按 flat 三角铺的，每片在 ±35° 方向会伸到
   * `radius/cos(35°) = 1.22×radius`，越出圆弧底的部分靠遮罩裁掉。
   *
   * ## region 缺失的兜底分支
   *
   * 与 `spell.gesture.surge` 同样的写法：**when 只看姿态**，几何分支写在 build 里。
   * 若把 `region?.type === "cone"` 写进 when，缺 region 的 fan 会掉回 generic.travel
   * 变成每目标一支蓝箭——那正是本条要消灭的东西，不能在兜底路径上又长回来。
   * 没有模板时退回一张锚在施法者、朝代表目标转的单片扇形（无遮罩、按体型缩放）。
   */
  {
    id: "spell.gesture.fan", pri: 780, once: true,
    when: s => s.spell?.gesture === "fan",
    build: (s, ctx, target) => {
      const el = elementOf(s, target);
      const spec = FAN_ELEMENT[el] ?? FAN_ELEMENT[FAN_DEFAULT];
      const fx = ctx.pick(spec.path);
      if (!fx) return null;
      const contact = spec.duration - 300;
      const snd = spellImpactSound(s, ctx, target, contact);
      const base = {
        file: fx.file,
        // 素材两端留白的补偿，总账见 spell.gesture.ray 那条规则上的注释（施工清单 §0.4）
        template: fx.template,
        zIndex: 90,
        startTime: spec.startTime, duration: spec.duration
      };

      const region = s.region?.type === "cone" && Number.isFinite(s.region.radius)
                     && Number.isFinite(s.region.x) && Number.isFinite(s.region.y)
        ? s.region : null;
      if (!region) {
        // 兜底：没有模板就画一片，锚在施法者、朝代表目标转（没有目标时连朝向也没有）
        return [...snd, {
          ...base,
          objectScale: 1 * ctx.geom.sizeScale(),
          aim: target
            ? {towards: {tokenId: target.tokenId, x: target.x, y: target.y}, missed: false}
            : null,
          waitUntilFinished: -300
        }];
      }

      const angle = Number(region.angle ?? 60) || 60;
      const tiles = Math.max(1, Math.ceil(angle / FAN_TILE_ANGLE));
      const tileAngle = angle / tiles;
      const scaleY = coneYScale(tileAngle, ctx, spriteHalfTan(fx));
      const rot = (region.rotation ?? 0) * DEG;
      const half = (angle / 2) * DEG;
      const step = tileAngle * DEG;
      // 中间那一片带交棒点：奇数片取正中间，偶数片取靠中间的那一片（下标向下取整）
      const carrier = Math.floor((tiles - 1) / 2);
      const cues = [];
      for (let i = 0; i < tiles; i++) {
        const a = rot - half + (step * (i + 0.5));
        cues.push({
          ...base,
          at: templateAnchor(s),
          stretchTo: {x: r6(region.x + (Math.cos(a) * region.radius)),
                      y: r6(region.y + (Math.sin(a) * region.radius))},
          scale: {x: 1, y: scaleY},
          mask: "region",
          waitUntilFinished: i === carrier ? -300 : null
        });
      }
      // 命中音：交棒点就是画面上「打中」的时刻（duration + waitUntilFinished）
      return [...snd, ...cues];
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
    build: (s, ctx, target) => {
      const fx = ctx.pick("eskie.pulse.energy.01", {color: ctx.runeColor()});
      if (!fx) return null;
      const pulseCue = {
        file: fx.file,
        objectScale: 1.2 * ctx.geom.sizeScale(),
        fadeIn: 100, fadeOut: 200, zIndex: 85,
        duration: 634,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null,
        waitUntilFinished: -200
      };
      // 命中音：交棒点就是画面上「打中」的时刻（duration + waitUntilFinished）
      return [...spellImpactSound(s, ctx, target, 434), pulseCue];
    }
  },

  /**
   * 自身爆发：施法者原地炸开，不飞向目标。
   *
   * eskie.casting.physical.01.center.one_shot 的 7 个颜色分支（blue/green/
   * orange/purple/red/yellow/white）同样不在帧数不一致清单里，跟 {color:runeColor()}
   * 安全。30 帧 @24fps=1250ms：f0-3 空（125ms）——startTime 跳过。
   *
   * 锚点：**落在模板上，不是落在施法者脚下**（施工清单 §0.11）。
   *
   * surge 的模板不是一圈光环，是一条 15 尺长、10 尺宽的**直线区域**：
   * `const/spellcraft.mjs` 的 surge = `range.maximum:15, target:{type:"ray", size:10}`
   * → `TARGET_TYPES.ray`（`const/action.mjs:139-150`：`shape:"line", width:1,
   * anchor:"self", addSize:true`）→ `action-use-dialog.mjs:546-555` 的 line 分支
   * + `:582-583` 的 `case "ray": if (target.size) shape.width = target.size * d`，
   * d=20px/ft 时是 **340×200px 的一条横杠**（⚠ `d` 是 `canvas.dimensions.distancePixels`
   * 即「一尺多少像素」，**不是格宽**；Crucible 的 `grid.distance = 5 ft`，所以格宽是
   * 5×20 = 100px。play.mjs 的裸点缩放那一段曾把这两者混为一谈，已订正）。
   * 而本规则改造前只写了一个 objectScale、
   * 连 at 都没有（走 once 默认的施法者锚点），画面是施法者**脚下**一团径向爆闪——
   * 探针 8 方向逐字相同 `at=origin off=(0,0)px rot=否 朝向= 0°`，**这条规则上线以来
   * 没有一次落点是对的**。
   *
   * 现在（保守版，不换素材）：
   *   · `at` = 线段**中点**（`lineMidAnchor`）。线的 x/y 是**起点**不是中心，
   *     直接拿 region.x/y 会把爆闪摆在杠子的一端。
   *   · `sizePx` = `{width: region.length, height: region.width}`。
   *     ⚠ 裸点锚上**绝对不能**再用 objectScale：`scaleToObject` 对一个 `{x,y}` 会一路
   *     `??` 落到 `canvas.grid.size`（sequencer.js:18166），恒等于「一格」，表达不了
   *     区域大小；播放层为此有一条硬规则会把它丢掉并 warn（施工清单 §0.12）。
   *   · `angle` = `region.rotation`，`mask: "region"` 把溢出裁掉。
   *
   * ⚠ **region 缺失时必须保留兜底分支**：实测把 surge 的 region 置 null，本规则今天
   * 照样命中；若把 `&& s.region?.type === "line"` 写进 when，它会掉进 pri 10 的
   * `generic.travel`，变成每个目标一支蓝箭。所以 when 一个字不改，分支写在 build 里。
   *
   * 素材是 center/one_shot 的径向爆闪，没有朝向可言，因此不设 aim（源点与朝向点重合
   * 还会让 rotateTowards 退化成 atan2(0,0)）。
   *
   * 【自带闪爆】逐帧实测（24fps，帧均 alpha）：f16 之前是向内收拢的火星环（5.6），
   * f17 起炸开放射火花（18.1）、f18-f19 达峰（28.0 / 29.1）、f20 直接塌回 7.95。
   * 扣掉 startTime 125 之后 = 起亮 583ms、峰值 667ms、熄灭 708ms。
   * **anchor 仍记成 "origin"**：surge 的 line 模板 `anchor:"self"`，线首就在施法者脚下，
   * 这团覆盖整条杠子的爆闪照样罩着施法者，且不占目标身上那一层命中闪光的位置，
   * 所以 impact 层照常出（见 armory/flash.mjs）。改成 "region" 属施工清单 §0.11 的
   * 激进版（连带换成 templateAnchor + stretchTo 并重测这三组时序数），不在本轮。
   *
   * 【2026-08-29 · 批次 C 结账：§0.11 到此为止，激进版**主动不做**】
   * 保守版四件事（at 改线段中点 / sizePx / angle 取反 / mask:"region"）批次 B 已全部落地，
   * 探针复核过：`at=(675,500)` 正是 `(500,500)+340/2` 的线段中点、`sizePx=350×200`
   * 逐字等于 `region.length × region.width`、`mask` 拿到 line 分支的四点矩形。
   * 激进版（templateAnchor + templateEnd + stretchTo）**在这支素材上是倒退**，不是"还没做"：
   *   · `eskie.casting.physical.01.center.one_shot` 是 center/one_shot 的**径向**爆闪，
   *     没有"从这里长到那里"这回事；
   *   · `stretchTo` 默认 `onlyX:false`（sequencer.js:16976 的 scaleY 跟着 spriteScale 走），
   *     贴图会被**等比**撑成 340×340 的方形，再被 200px 高的遮罩切掉上下各 70px；
   *     而现在的 `sizePx` 能直接给出 350×200 的**各向异性**矩形，与模板逐字相符。
   * 换句话说：激进版的前提是"先换一支有朝向的素材"，那是选材阶段的活，不是几何的活。
   * 真要做，条件写在这里：一支带明确推进方向、模板非空、可 stretchTo 的直线区域素材，
   * 外加重测 `startTime/duration` 与 selfFlash 三个数，并把 anchor 改成 "region"。
   */
  {
    id: "spell.gesture.surge", pri: 770, once: true,
    when: s => s.spell?.gesture === "surge",
    build: (s, ctx, target) => {
      const fx = ctx.pick("eskie.casting.physical.01.center.one_shot", {color: ctx.runeColor()});
      if (!fx) return null;
      // 只认真正量得出长度的 line 模板；缺 region / 换了形状都走兜底（见上方注释）
      const region = s.region?.type === "line" && Number.isFinite(s.region.length)
                     && Number.isFinite(s.region.x) && Number.isFinite(s.region.y)
        ? s.region : null;
      const onTemplate = region
        ? {at: lineMidAnchor(region),
           sizePx: {width: region.length, height: region.width ?? region.length},
           // ⚠ **取反**：Sequencer 的 `.rotate()` 是 `spriteContainer.rotation =
           // -normalizeRadians(toRadians(angle))`（sequencer.js:16346），传进去的角度会被
           // 反着用。impact.mjs 的元素层（`angle: r6(-jitter)`）早就取了反，这里漏了。
           //
           // 漏掉的后果不是「素材是径向爆闪、没朝向所以无所谓」：这条 cue 同时给了
           // `sizePx` = region.length × region.width 的**长条**，贴图被摆成各向异性矩形；
           // 而遮罩 `regionMaskShape` 的 line 分支与锚点 `lineMidAnchor` 都按 **+rotation** 建。
           // 于是 0/90/180/270 看不出问题（矩形足迹在 ±rot 下相同），而 45/135/225/315
           // 会让**贴图长轴与遮罩长杠交叉**，爆闪被裁成中间一小块菱形。
           // 桩只记 `rotate(45)` 与 `mask(<Polygon>)`，这个交叉**离线永远算不出来**。
           // `+ 0` 把 `-0` 归一成 `0`：rotation 为 0 时取反得到的是 `-0`，而计划要
           // JSON 化进聊天卡 flag 广播，`JSON.stringify(-0)` 出来是 `"0"` ——
           // 不归一的话「出手端的 -0」与「接收端的 0」在断言里是两个值（IEEE754 里
           // `Object.is(-0, 0)` 为假），往返一趟就对不上了。
           angle: r6(-(region.rotation ?? 0)) + 0,
           mask: "region"}
        // 兜底：没有模板就退回改造前的样子——锚在施法者（once 的默认锚点）、按体型放大。
        : {objectScale: 1 * ctx.geom.sizeScale()};
      const surgeCue = {
        file: fx.file,
        ...onTemplate,
        zIndex: 85,
        startTime: 125, duration: 1125,
        selfFlash: {from: 583, at: 667, to: 708, anchor: "origin"},
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null,
        waitUntilFinished: -300
      };
      // 命中音：交棒点就是画面上「打中」的时刻（duration + waitUntilFinished）
      return [...spellImpactSound(s, ctx, target, 825), surgeCue];
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
      const arrowCue = {
        file: fx.file,
        at: originAnchor(s),
        stretchTo: {x: target.x, y: target.y},
        // 素材两端留白的补偿，总账见 spell.gesture.ray 那条规则上的注释（施工清单 §0.4）
        template: fx.template,
        objectScale: 1 * ctx.geom.sizeScale(),
        aim: {towards: {tokenId: target.tokenId, x: target.x, y: target.y},
              missed: target.results.some(r => r.result === 0 || r.result === 1)},
        zIndex: 100, elevation: target.elevation,
        duration: 1667,
        selfFlash: {from: 467, at: 467, to: 633},
        waitUntilFinished: -1200
      };
      // 命中音：交棒点就是画面上「打中」的时刻（duration + waitUntilFinished）
      return [...spellImpactSound(s, ctx, target, 467), arrowCue];
    }
  },

  /**
   * 爆裂：在区域中心炸开一发。施工清单 §0.13 的第一半。
   *
   * ## 改造前：**一条 travel 都不出**
   *
   * 老 `target.blast`（pri 200）的 `build` 恒返回 null，注释给的理由是「施法者原地起爆，
   * 没有『到达』这个概念」——**这个前提被语料自己证伪**：`spell.storm.blast` 的
   * `origin=(500,500)` 而 `region=(900,500)`，爆心离施法者 400px = 4 格；
   * `const/spellcraft.mjs` 的 blast 写着 `range.maximum: 60`。5 个动作点的大招现在
   * 只剩一个音效加一片 26px 的地裂，玩家心理预期最高的那个手势画面最空。
   *
   * ## 几何
   *
   * `at` = 圆心的**冻结坐标**（`pointAnchor`，不是施法者）；`sizePx` = 直径，让贴图
   * 真的铺满模板（`objectScale` 在裸点上恒等于"一格"，播放层会丢弃并 warn，
   * 施工清单 §0.12）；`mask:"region"` 把溢出圆外的火星裁掉。
   * 素材内容占比 0.945——ASSET-NOTES 原话「真的铺满，sizePx 给多大就多大」。
   *
   * ## 时序与自带爆闪
   *
   * 41 帧 @30fps=1367ms（blue/orange/purple/yellow 四支逐帧同规格，实测同为
   * `41f@30 lead3 peak8`）：f0-2 空 → startTime 100；f33 起是空尾 → duration 1000。
   * 自带爆闪＝**是**（闪爆比 8.73-11.65）：f3 起亮、f8 是铺满画幅的亮盘（峰值）、
   * f20 塌成向上飞散的火星——`selfFlash` 就按这三帧申报，`trimFlash` 扣掉 startTime
   * 之后是 0/167/567。anchor 取 **"target"**：ASSET-NOTES 的通则原话是「自带爆闪，
   * 不要再叠通用闪光层」，而 blast 的亮盘罩住整个圆、每个目标都在里面，
   * 所以它替的就是目标身上那一层命中闪光（与 ray 的星爆落在模板末端、anchor 记 region
   * 的情形相反）。
   *
   * ## 颜色白名单
   *
   * 同族 **green 支是离群值**：闪爆比 73.86，其余四支 8.73-11.65，差 7 倍；混用会一支
   * 比一支白得多。`nearestAllowed` 在 blue/orange/purple/yellow 四支里取最近符文色，
   * 于是 green 永远选不中，而 `ctx.pick` 拿到的又是它自己树上真实存在的分支、
   * `pickColor` 直接命中不做 hue 旋转（见 nearestAllowed 的注释）。
   *
   * ## when 只看姿态
   *
   * 与 `spell.gesture.surge` 同一个写法：region 判据写在 build 里，不写进 when。
   * 写进 when 的话，缺 region 的 blast 会掉到 pri 200 的 `target.blast` 上变回零画面——
   * 那正是本条要修的。没有模板时退回锚在施法者的一发（按体型缩放，无遮罩）。
   * 零目标照样出内容：`once` 规则的 `target` 允许是 null，本条除交给 `spellImpactSound`
   * （它自己判 null）之外不解引用它。
   */
  {
    id: "spell.gesture.blast", pri: 775, once: true,
    when: s => s.spell?.gesture === "blast",
    build: (s, ctx, target) => {
      const fx = ctx.pick("jb2a.explosion.02",
                          {color: nearestAllowed(ctx.runeColor(), BLAST_COLORS)});
      if (!fx) return null;
      const region = s.region?.type === "circle" && Number.isFinite(s.region.radius)
                     && Number.isFinite(s.region.x) && Number.isFinite(s.region.y)
        ? s.region : null;
      const onTemplate = region
        ? {at: pointAnchor(region.x, region.y),
           sizePx: {width: 2 * region.radius, height: 2 * region.radius},
           mask: "region"}
        // 兜底：没有模板就退回锚在施法者（once 的默认锚点）、按体型放大
        : {objectScale: 1 * ctx.geom.sizeScale()};
      const blastCue = {
        ...onTemplate,
        file: fx.file,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null,
        zIndex: 95,
        startTime: 100, duration: 1000,
        // f3 起亮 / f8 亮盘峰值 / f20 塌成火星（毫秒相对素材第 0 帧，trimFlash 负责扣 startTime）
        selfFlash: trimFlash({from: 100, at: 267, to: 667},
                             {startTime: 100, duration: 1000, anchor: "target"}),
        // 素材自己有 3 帧的起亮段，再叠 fadeIn 等于对同一件事做两遍；末端是天然熄灭，
        // fadeOut 只作最后两三帧的保险（判据同 impact.mjs 表头那三条通则）
        fadeIn: 0, fadeOut: 100,
        waitUntilFinished: -833
      };
      // 命中音：交棒点就是画面上「打中」的时刻（duration + waitUntilFinished = 167ms，
      // 正是亮盘峰值那一帧）
      return [...spellImpactSound(s, ctx, target, 167), blastCue];
    }
  },

  /**
   * 接触：touch 与 influence 两个手势，**同一支素材靠时序分**。
   *
   * ## 改造前
   *
   * 两个手势都掉在 pri 10 的 `generic.travel` 上，播的是
   * `eskie.attack.ranged.arrow.ray.physical.blue.30ft`——一支带明确箭头形的**物理箭**。
   * touch 的 `range.maximum` 是 **1 尺**（`const/spellcraft.mjs`），influence 是引导：
   * 一尺之内的接触和持续引导都射出一支飞了 30 尺的物理箭，语义全错。
   * 施工清单 §0.10 的账：84 条法术共用这一支箭，其中 touch 8 + influence 8 归本条。
   *
   * ## 为什么两个手势共用一支素材是**对的**
   *
   * 原生就是这么分的：`canvas/vfx/spells.mjs:2359` 与 `:2369` 两行——influence 与 touch
   * 指向**同一个** `configureContactVFXEffect` + **同一张** `TOUCH_VFX_PROPS`，
   * 差别只在 influence 多挂了一个 `channel` 描述符
   * （`chargeDuration:550, deliveryDuration:1800, lingerDuration:900`），而 touch 走的是
   * `runeProps.chargeDuration ?? 450` + `deliveryDuration ?? 100`（`:628-631`）。
   * 换算成"接触发生在第几毫秒"：touch = 450+100 = **550ms**，influence = 550+1800 = **2350ms**。
   * 所以这里也只用一支手掌素材，用 `playbackRate` 把它拉成两种节奏。
   *
   * ## 素材与时序
   *
   * `eskie.attack.touch.generic.01`：一只发光的张开手掌带彗尾从左向右推出，掌心朝前。
   * ⚠ **60fps**（ASSET-NOTES 本轮订正第 1 条作废了"eskie.poison.01 是全表唯一 60fps"
   * 那句）：60 帧 = **1000ms**，按 frames/30 换算会得到 2000ms、整整长一倍。
   * 空头 1 帧、空尾 1 帧、峰值 f36-f40（逐色差 4 帧，取中位 f38 = 633ms）。
   *   · touch：`startTime 17`（跳过空头）、`duration 967`、交棒点 616ms（峰值）。
   *   · influence：`playbackRate 0.5` 把整支拉成 2000ms 墙钟，交棒点 1266ms。
   *     ⚠ 这一支**不设 startTime**：`play.mjs` 的 `applyTimeWindow` 在
   *     `startTime>0 && duration!==null` 时走的是 `timeRange(start, start+dur)`，
   *     那两个数一个是源片时刻、一个是墙钟时长，rate≠1 时混在一起会算错；
   *     startTime 为 0 时它退成单独一句 `.duration()`（墙钟量，见
   *     `test/armory-impact.test.mjs` 的 `natural = src / playbackRate` 口径），
   *     省掉的那 17ms 空头肉眼不可见，比冒这个险划算。
   * 交棒点比原生早一点（616 vs 550 / 1266 vs 2350）是素材本身决定的，没有第二支可选；
   * 两者的**相对**关系（引导比接触慢一倍）保住了，那才是这两个手势的区分点。
   *
   * ## 几何
   *
   * 锚在施法者、`aim.towards` 转向目标——手掌是从施法者推出去的，起点必须是施法者
   * （与近战四条同一个道理，见 meleeGeom）。`missed` 恒 false：`aim.towards` 会给特效
   * 装上 `data.target`，`.missed()` 的偏移根本加不上去（sequencer.js:15360），
   * 打偏由 impact 的 MISS 层表达。
   * 素材没有 template（eskie 的 `_templates` 里没登记这一支），所以不走 stretchTo：
   * 没有握把点的拉伸会把手掌抻成一条，1 尺的接触也没有"飞行段"可言。
   *
   * ## 颜色
   *
   * 八色手形逐色完全一致，跟符文色。⚠ `black` 支暗底亮度 **28.8**，深色战场上基本看不见；
   * 它不在 `COLOR_HUE` 里，`pickColor` 的 `filter(c => c in COLOR_HUE)` 会把它挡在候选集
   * 之外——**这不是巧合，是那张表的既有性质**，所以这里不必再写一层白名单
   * （与 blast 的 green 不同：green 在表里，必须显式排除）。
   */
  /**
   * **`strike` 手势 —— 借手上的武器施法，不是发一个飞行物。**
   *
   * ## 语义（读源码定的，不是猜的）
   *
   * `const/spellcraft.mjs:393-411` 的 `strike` 手势：
   * `cost: {action: 0, focus: 1, **weapon: true**}` / `range: {**weapon: true**}` /
   * `hands: 0` / `scaling: "strength"` / `target.type: "single"`。
   * 也就是「这一发法术**顺着你这一记武器攻击**打出去」——射程与动作点都来自武器本身。
   *
   * 改造前这 12 条（12 符文各一）落在 `generic.travel` 上，播的是那支**蓝色物理箭**
   * ——一记力量加值的近战附魔挥砍，画面上飞出去一支箭。这是施工清单 §0.10 的后半段
   * （前半段 84 → 12 已由批次 C 的六条手势规则解决）。
   *
   * ## 为什么不按武器身份选形制
   *
   * **快照里够不着那把武器。** `models/spell-action.mjs:283-285` 的 `cost.weapon` 只做一件事
   * ——把 `actor.equipment.weapons.mainhand` 的**动作点**加进 cost；它**不往 `usage.strikes`
   * 里塞武器**（`usage.strikes` 由 strike TAG 维护，而 composed 法术没有那个标签）。
   * 所以语料里这 12 条 `strikes: []` 是**如实的**，不是坏语料——运行时同样取不到。
   *
   * 于是这里用**附魔剑**这一族的通用挥击：它本来就是「一把发着光的剑」，
   * 与「武器被符文附魔了」这层语义正对得上，且带 5 个色支可以跟着符文走。
   * ⚠ 想按真实武器形制画，需要先让 `snapshotAction` 为 `cost.weapon` 的手势捕获主手武器
   * ——那是快照层的改动，留作后续。
   *
   * ## 几何
   *
   * 直接复用 `meleeGeom()`：握把锚施法者、刀锋锚目标、长度由 `scale` = 中心距表达
   *（施工清单 §0.2/§0.3，批次 B 落地）。近战附魔挥砍与普通挥砍在几何上没有区别，
   * 差的只是颜色。
   */
  {
    id: "spell.gesture.strike", pri: 766,
    when: s => s.spell?.gesture === "strike",
    build: (s, ctx, target) => {
      const fx = ctx.pick("jb2a.melee_attack.01.magic_sword", {color: ctx.runeColor()});
      if (!fx) return null;
      const clip = clipOf(fx.file);
      return [...spellImpactSound(s, ctx, target, clip?.contactMs ?? 500), {
        file: fx.file,
        ...meleeGeom(s, ctx, target, fx),
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null,
        // 时序逐文件取，与其余近战规则同源（见 armory/clip-table.mjs）；
        // 表里没有就退回与 strike.melee 相同的那对常数，不静默按 0 算。
        duration: clip?.durationMs ?? 933,
        waitUntilFinished: clip ? clip.contactMs - clip.durationMs : -400,
        zIndex: 100,
        elevation: target.elevation
      }];
    }
  },

  {
    id: "spell.gesture.contact", pri: 765,
    when: s => s.spell?.gesture === "touch" || s.spell?.gesture === "influence",
    build: (s, ctx, target) => {
      const fx = ctx.pick("eskie.attack.touch.generic.01", {color: ctx.runeColor()});
      if (!fx) return null;
      const channel = s.spell.gesture === "influence";
      // 引导：整支拉成半速（墙钟 2000ms），峰值 633ms 随之落到 1266ms
      const timing = channel
        ? {playbackRate: 0.5, startTime: 0, duration: 2000, contact: 1266,
           fadeIn: 200, fadeOut: 300}
        : {playbackRate: 1, startTime: 17, duration: 967, contact: 616,
           fadeIn: 100, fadeOut: 150};
      const cue = {
        file: fx.file,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null,
        at: originAnchor(s),
        aim: {towards: {tokenId: target.tokenId, x: target.x, y: target.y}, missed: false},
        objectScale: 1.5 * ctx.geom.sizeScale(),
        zIndex: 100, elevation: target.elevation,
        playbackRate: timing.playbackRate,
        startTime: timing.startTime, duration: timing.duration,
        fadeIn: timing.fadeIn, fadeOut: timing.fadeOut,
        waitUntilFinished: timing.contact - timing.duration
      };
      // 命中音：交棒点就是画面上「打中」的时刻（duration + waitUntilFinished）
      return [...spellImpactSound(s, ctx, target, timing.contact), cue];
    }
  },

  /**
   * 位移：一团翻滚的烟云。
   *
   * 改造前同样掉在 `generic.travel` 上——**闪现播的是一支飞向敌人的物理箭**
   * （12 条，施工清单 §0.10）。`step` 的 `target.type` 是 `movement`，
   * `const/spellcraft.mjs` 给的 `range.maximum: 20`：这是"从这里挪到那里"，不是"射一发"。
   *
   * `jb2a.misty_step.01`：一整团方形轮廓的翻滚烟云，边缘由密集小烟球堆成。
   * **颜色分支恰好 12 个**，一符文一色（ASSET-NOTES 读图结论），色相不必再过 hue 滤镜。
   * ⚠ 必须写到 `.01` 这一级：同族 `.02` 是 146 帧（4.87s）、闪爆比 6.3-17.2 的加长加亮版，
   * 时序完全不同，停在父节点会让 `ctx.pick` 随机取到它。
   * 90 帧 @30fps=3000ms、空头 3、空尾 3 → `startTime 100`、`duration 2800`；
   * 峰值 f28-f36（逐色差 8 帧，取实测中位 f32=1067ms）→ 交棒点 967ms。
   *
   * ## 锚点：只画"离开"，不画"到达"
   *
   * `once: true` + 默认锚点（施法者）。**快照里没有位移终点**——`step` 的 targets 是
   * 被这一步打到的人（gesture 自带 `damage.base: 2`），不是落点；拿 targets[0] 当落点
   * 是把"打到谁"当成"去了哪"，隔一格的敌人会让烟云凭空偏出半个身位。所以这一版只在
   * 出发格画一团烟（内容占比 0.81-0.90，正好罩住 token，对"闪现"是对的读法）。
   * 要画"到达"得等快照带上 `usage.movement` 的终点坐标，那是 trigger/snapshot.mjs 的事。
   */
  {
    id: "spell.gesture.step", pri: 765, once: true,
    when: s => s.spell?.gesture === "step",
    build: (s, ctx, target) => {
      const fx = ctx.pick("jb2a.misty_step.01", {color: ctx.runeColor()});
      if (!fx) return null;
      const stepCue = {
        file: fx.file,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null,
        objectScale: 1.5 * ctx.geom.sizeScale(),
        zIndex: 95,
        startTime: 100, duration: 2800,
        // 素材自带 3 帧起手、末尾自然消散，两头都不必再叠淡入淡出
        fadeIn: 0, fadeOut: 150,
        waitUntilFinished: -1833
      };
      // 命中音：交棒点就是画面上「打中」的时刻（duration + waitUntilFinished）
      return [...spellImpactSound(s, ctx, target, 967), stepCue];
    }
  },

  /**
   * 光环 / 感知：施法者脚下的一组虚线同心环，**外扩** = aura，**内收** = sense。
   *
   * 改造前两者都掉在 `generic.travel` 上（各 12 条，施工清单 §0.10）：20 尺光环与
   * 30 尺感知播的都是一支飞向每个目标的蓝色物理箭。两个手势的 `target.type` 都是
   * `aura`（`const/spellcraft.mjs`：aura `size: 20`、sense `size: 30`），落地区域是
   * **emanation**——以施法者为心的一个圆，本来就不该有"飞过去"这回事。
   *
   * ## 为什么两支素材而不是一支换方向
   *
   * `jb2a.zoning.outward.circle.once` 与 `…inward…` 是同一套虚线环的两个走向：
   * 外扩读作"把范围铺出去"（aura），内收读作"把周围的信息收回来"（sense）。
   * 两支的时序**不一样**，不许共用常数（ASSET-NOTES 点名）：
   *   · outward 66f@24、空头 2、空尾 5、峰值 f24  → startTime 83、duration 2459、交棒 917
   *   · inward  66f@24、空头 1、空尾 **12**、峰值 **f13** → startTime 42、duration 2208、交棒 500
   *
   * ## 尺寸走 region，不走 objectScale
   *
   * emanation 带 `radius`（aura 400px = 20 尺、sense 600px = 30 尺，按 20px/尺换算），
   * `sizePx` 直接给直径。**不设 `mask:"region"`**：`play.mjs` 的 `regionMaskShape`
   * 只认 circle / cone / line 三种，emanation 会返回 null 并 warn 一条——而
   * `coverage.test.mjs` 守着「plan.warnings 恒为空」。环形本来就是圆的、`sizePx` 已经把它
   * 定在模板大小上，没有遮罩也不会溢出。（emanation 的规范化在施工清单里挂在
   * `trigger/snapshot.mjs` 名下，不属本文件；等它落地后这里可以改成 `mask:"region"`。）
   * `belowTokens: true`：这是画在地上的范围指示，中心完全空、不遮 token。
   *
   * ## 颜色轴今天还给不了
   *
   * 这一族只有 `bluegreen` / `redyellow` 两个**双色词**分支，两者都不在
   * `resolver/palette.mjs` 的 `COLOR_HUE` 里 —— `pickColor` 的
   * `filter(c => c in COLOR_HUE)` 会把候选集清空、直接返回 `{color: null}`。
   * 所以这里连 `{color}` 都不传（传了等于没传，还让人以为跟着符文色走），
   * 12 符文的色轴要等 D6 给 COLOR_HUE 补上这两个色名之后再靠 hue 滤镜给。
   */
  {
    id: "spell.gesture.aura", pri: 765, once: true,
    when: s => s.spell?.gesture === "aura" || s.spell?.gesture === "sense",
    build: (s, ctx, target) => {
      const outward = s.spell.gesture === "aura";
      const fx = outward
        ? ctx.pick("jb2a.zoning.outward.circle.once.bluegreen")
        : ctx.pick("jb2a.zoning.inward.circle.once.bluegreen");
      if (!fx) return null;
      const timing = outward
        ? {startTime: 83, duration: 2459, contact: 917}
        : {startTime: 42, duration: 2208, contact: 500};
      const radius = Number(s.region?.radius);
      const onTemplate = Number.isFinite(radius) && radius > 0
                         && Number.isFinite(s.region.x) && Number.isFinite(s.region.y)
        ? {at: pointAnchor(s.region.x, s.region.y),
           sizePx: {width: 2 * radius, height: 2 * radius}}
        // 兜底：没有模板就退回锚在施法者（once 的默认锚点）、按体型放大
        : {objectScale: 1 * ctx.geom.sizeScale()};
      const ringCue = {
        ...onTemplate,
        file: fx.file,
        belowTokens: true, zIndex: 40,
        startTime: timing.startTime, duration: timing.duration,
        // 环组自己从无到有长出来，不必再叠淡入；末端被 duration 切在空尾之前，留一点淡出
        fadeIn: 0, fadeOut: 150,
        waitUntilFinished: timing.contact - timing.duration
      };
      // 命中音：交棒点就是画面上「打中」的时刻（duration + waitUntilFinished）
      return [...spellImpactSound(s, ctx, target, timing.contact), ringCue];
    }
  },

  /**
   * 造物 / 召唤：落点上浮起一张召唤法阵。
   *
   * `create` 与 `conjure` 两个手势的 `target.type` 都是 `summon`
   * （`const/spellcraft.mjs`:262 / :245），落地区域是一块 `rectangle`。两条**必须一起收**：
   * 它们的 region 非 null 而 targets 恒为空（`models/action.mjs` 按设计零目标），
   * 于是每目标规则一次都不会被调用——**改造前这 24 条动作 travel 槽一条 cue 都没有**，
   * 连兜底的蓝箭都没有（兜底是每目标规则，零目标时不出内容）。
   * 施工清单只点了 `create`，`conjure` 是同一形状同一空白，一并接管。
   *
   * ## 素材
   *
   * `jb2a.magic_signs.circle.02.conjuration.loop`：五芒星 + 中心一个大空心圆（召唤口），
   * 四个方位各一个圆章符号。中心那个空洞是八个学派里最大的，压在被召唤物上露脸最多。
   * ⚠ **不取 `.complete`**：那是 265 帧 = 11 秒的持续版，召唤是一次动作不是持续状态；
   * 也不停在 `circle.02.conjuration` 这一级——父节点的帧数离散度 0.68
   * （intro/loop/outro/complete 长度差 3 倍），`ctx.pick` 会随机取到 11 秒那支。
   * `.loop` 是 121 帧 @24fps 的**无缝循环**（12 色齐一、离散度 0.000），
   * 没有起手也没有收尾——所以这条 cue 的淡入淡出要自己给足（400/500），
   * 直接硬切会看见法阵凭空出现又凭空消失。取 3000ms（整支 5042ms 的一段）。
   *
   * 颜色只在 6 个 regular 支里挑：同族 6 个 `dark_*` 支在暗底上糊没（选材读图结论），
   * 判据与 blast 的 green 一样，走 `nearestAllowed` 的白名单（见该函数注释）。
   *
   * ## 几何
   *
   * `at` = 矩形中心（`rectCenter`——summon 的 `anchorX/anchorY` 被系统改写成 0，
   * x,y 是**角点**不是中心，见该函数）。`sizePx` 取「模板边长」与「2 格」的较大者：
   * ASSET-NOTES 实测这张图的外环符文密度极高，缩到 1 格 token 尺寸会糊成一条毛边带、
   * 完全认不出是符文，**召唤法阵至少铺 2 格才立得住**。格宽用 `gridPxOf`（从 token 几何
   * 的 `w/width` 相除得到，快照里没有 gridSize 字段）。
   * 不设 `mask:"region"`：`regionMaskShape` 不认 rectangle，会 warn（同 aura 那条的说明）。
   * `belowTokens: true`：法阵画在地上，被召唤物站在它上面。
   */
  {
    id: "spell.gesture.create", pri: 780, once: true,
    when: s => s.spell?.gesture === "create" || s.spell?.gesture === "conjure",
    build: (s, ctx, target) => {
      const fx = ctx.pick("jb2a.magic_signs.circle.02.conjuration.loop",
                          {color: nearestAllowed(ctx.runeColor(), CIRCLE_COLORS)});
      if (!fx) return null;
      const region = s.region?.type === "rectangle"
                     && Number.isFinite(s.region.x) && Number.isFinite(s.region.y)
        ? s.region : null;
      const gridPx = gridPxOf(s, target);
      const onTemplate = region
        ? (() => {
            const c = rectCenter(region);
            const side = Math.max(Number(region.width) || 0, Number(region.height) || 0,
                                  2 * gridPx);
            return {at: pointAnchor(c.x, c.y), sizePx: {width: side, height: side}};
          })()
        // 兜底：没有模板就退回锚在施法者（once 的默认锚点）、按体型放大
        : {objectScale: 2 * ctx.geom.sizeScale()};
      const circleCue = {
        ...onTemplate,
        file: fx.file,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null,
        belowTokens: true, zIndex: 40,
        // 无缝 loop：没有起手也没有收尾，淡入淡出必须自己给（900/3000 = 30%）
        duration: 3000, fadeIn: 400, fadeOut: 500,
        waitUntilFinished: -1800
      };
      // 交棒点 1200ms：法阵完全浮起来的时刻（loop 无相位可言，取淡入完成后一拍）
      return [...spellImpactSound(s, ctx, target, 1200), circleCue];
    }
  },

  /**
   * 近战挥击。两件事：
   *  1. **选材**：贴身与隔格换素材，理由是**画面**，不是长度。
   *     ⚠ 原注释写的是「否则要么够不着要么穿模——nodachi 是唯一真正够得到隔一格的
   *     melee_attack 素材」，那句**已作废**（2026-08-29，ASSET-NOTES 的「射程口径」一节）：
   *     它比较的是**贴图内部像素**（野太刀最远 x=758 vs 短剑 x=531），而改造前
   *     `scaleToObject` 把画幅差归一化掉、净增益只有 9.4 画布 px = 0.094 格；改造后更彻底，
   *     射程由 `swingScale()` 定成中心距的函数，**两支素材的授权跨距都恰好 1 格**
   *     （shortsword `[200,300,300]`：800−300−300=200px÷200；nodachi `[200,400,400]`：
   *     1000−400−400=200px÷200），刀锋落点逐字相同。
   *     今天换素材换的是观感：1000×800 的大幅过顶下劈比 800×600 的短剑更像「够远的一记」。
   *     （scythe/greatsword 曾被 ASSET-NOTES 以「够不到隔格」否掉，那半条判据同批作废，
   *     但它们各自的时序/亮度判据仍然成立，见文末被否清单。）
   *  2. **几何**：全部交给 `meleeGeom()`（锚源 / 模板握把 / scale=中心距 / 随机镜像），
   *     四条近战规则共用同一份，改动理由与源码依据都写在那个函数上。
   *     从前这里写的是「大体型放大 1.4 倍、偏移折半、目标在左侧时镜像」三条——
   *     那三条都建立在「贴图中心压在目标身上」这个错锚点之上，随锚点一起退休了
   *     （施工清单 §0.2 / §0.3）。
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
  /**
   * 法器挥击。**改造前这 9 件武器一条 travel cue 都不出**——`strike.melee` 的 when 只认
   * light1/simple/balanced/heavy 七个近战分类，talisman1/talisman2 不在里面，于是
   * arcaneOrb / grimoire / holySymbol / lyre / primordialSeed / skullFetish /
   * ceremonialDagger / flameStaff / iceStaff 全程静音。
   *
   * 法器是施法媒介不是刀剑，用附魔剑 / 附魔巨剑那两支带辉光的形制，颜色跟武器自己的
   * 伤害类型走（`ctx.pickColor` 会做最近色路由 + hue 补偿，与其余元素通路同一套）。
   *
   * ⚠ 这两族的暗底亮度跨度 37.9-128.5，**dark_green 与 dark_purple 两支在深色地图上
   * 接近隐形**（族级记录里记着）。取不到色时退回 blue 这个亮度安全档，不硬配暗色。
   *
   * pri 630 高于 strike.melee 的 620：法器分类不与近战分类重叠，这里排前面只是让
   * 「专属规则先于通用规则」的读法成立，两条实际上互斥。
   */
  /**
   * 远程武器的飞行物。**改造前 8 件远程武器共用同一支蓝箭**——它们全都掉到 pri 10 的
   * `generic.travel` 兜底上（`eskie.attack.ranged.arrow.ray.physical.blue.30ft`），
   * 手弩、手枪、重弩、吹箭枪、箭刺、投石索、长弓、短弓，八件一个样。
   *
   * 现在按武器分三类：弓射箭（`jb2a.arrow`）、弩射弩矢（`jb2a.bolt`，更短、橙色箭头）、
   * 枪与投石索射弹丸（`jb2a.bullet`，19 帧的快速轨迹）。
   *
   * ## 为什么必须用 stretchTo 而不是 aim.towards
   *
   * 打偏要看得出来。`.missed()` 的偏移只在特效**没有** `data.target` 时才加得上去
   * （sequencer.js:15360 的判据 `missed && (!source || !data.target)`），而 `aim.towards`
   * 会走 `rotateTowards` 给特效装上 `data.target`——那时 `.missed()` 只打歪朝向、
   * 特效仍然正落在目标身上，画面上读起来还是命中（play.mjs 会为此发告警）。
   * `stretchTo` 不调 rotateTowards，偏移才真的加在源点上，落成「绕目标撒出 1.5-2.5
   * 个半身位」——这就是「射歪了」。近战三条规则写 `missed: false` 是同一个道理的另一面：
   * 它们用 aim.towards，写 true 也只会换来一条告警，打偏由 impact 的 MISS 层去表达。
   */
  /**
   * 区域形状的武器动作：锥形喷吐 / 直线贯穿 / 自身一圈。**这是「动作轴」的第一条规则**——
   * 前面所有规则问的都是「拿的什么武器」，这一条问「做的什么动作」。
   *
   * 判据是 Crucible 动作自己的 `target.type`。改造前这 11 条动作全部落到按武器选的单体
   * 挥击上，而且**每个目标各挥一次**：
   *
   *   tailSweep（尾巴横扫一圈）  → 一记拳击 ×2
   *   acidSpray（喷一口酸）      → 一记拳击 ×2
   *   penetratingShot（贯穿射击）→ 一发普通子弹 ×2
   *   fanOfArrows（扇形箭雨）    → 一支普通箭 ×2
   *
   * `once: true`：区域动作一次只该出一份画面，锥形打中 5 个人不该叠 5 份锥形。
   *
   * ## 不依赖模板几何
   *
   * 这些动作的快照 `region` 是 null（Crucible 的武器区域动作不走 MeasuredTemplate），
   * 所以锚在施法者、朝代表目标定向，不像 `spell.gesture.cone` 那样吃模板起点。
   * 直线用 `stretchTo` 拉到目标（顺带让 `.missed()` 生效），锥形与脉冲用 `aim.towards`
   * 转向——脉冲其实不需要朝向，但给了也无害，且保留了「朝主要威胁转身」的读法。
   *
   * ## 颜色走动作而不是武器
   *
   * `ctx.damageColor()` 读的正是 `usage.damageType`——喷酸的酸来自动作，不是牙。
   * 物理伤害在 DAMAGE_COLOR 里是 null，退回各族中性色（见 action-shapes.mjs 的 NEUTRAL）。
   */
  {
    id: "strike.shape.area", pri: 670, once: true,
    // **不限武器动作**：`corruptingDeathBurst` / `radiantDeathBurst` / `horrificCritical`
    // 这类非武器脉冲同样是「以自己为中心炸开」，形状判据一模一样，此前全落在兜底上。
    when: s => !s.spell && !!shapeOfAction(s),
    build: (s, ctx, target) => {
      const shape = shapeOfAction(s);
      const color = ctx.damageColor() ?? shape.neutral;
      const picked = ctx.pick(shape.path, color ? {color} : {});
      if (!picked) return null;
      // 横扫那一族把 84 帧（前 733ms 全空）与 24 帧两条混在同一个叶子数组里，
      // ctx.pick 均匀随机取——一半概率白等 0.73 秒。挑空头最少的那条。
      const file = shape.path === SWEEP_RING ? leastDeadAir(picked.files) : picked.file;
      const fx = {...picked, file};
      const clip = clipOf(fx.file);
      const isRay = shape.path === RAY_GENERIC;
      // 各族实测长度：箭雨 92-120 帧、锥形 69 帧、火花环 64 帧、贯穿线 15 帧（@30fps）。
      // 除贯穿线外都远长于一次攻击该占的时间，统一裁到 1200ms。
      // 时长优先按实测（裁掉空尾），没量到才退回手裁的节奏
      const duration = clip?.durationMs ?? (shape.path === RAY_GENERIC ? 500
                     : shape.path === CONE_VOLLEY ? 1500 : 1200);
      const area = {
        file: fx.file,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null,
        objectScale: 1 * ctx.geom.sizeScale(),
        at: originAnchor(s),
        // 只有贯穿线那一支拉伸，模板也只跟着它走：锥形/脉冲那两支不拉伸，
        // 模板落到它们身上唯一还能碰到的是 gridSizeDifference，会改掉体积（§0.4）。
        ...(isRay && target
          ? {stretchTo: {x: target.x, y: target.y}, template: fx.template}
          : {}),
        aim: target
          ? {towards: {tokenId: target.tokenId, x: target.x, y: target.y},
             missed: isRay && target.results.some(r => r.result === 0 || r.result === 1)}
          : null,
        duration,
        // duration 是手裁的节奏（区域特效整段 2-4 秒，太长），但交棒点仍按实测的
        // 命中时刻算——wuf 是相对**实际播放时长**的偏移，两者可以分开定。
        waitUntilFinished: clip ? clip.contactMs - duration : -300, zIndex: 100
      };
      // 音效排在画面之前（见 strike.melee 里对 parallelizeTargets 顺序的说明）
      return [...strikeSounds(s, ctx, target, clip?.contactMs ?? duration / 2, s.strikes?.[0]), area];
    }
  },
  /**
   * 连段：**同一件武器打好几下**。
   *
   * 这是动作轴的第二条规则。判据是动作自己说的「这一下是几下」：
   *   · 同时带 `mainhand` 与 `offhand`（双手各打一次）——`flurry` 双持连打、`doublePunch` 双拳
   *   · 带 `dualwield`
   *   · 单体目标且花 2 个以上动作点——`ricochet` / `abyssalWhip` / `frenziedClaws`
   * 区域形状的多动作点动作不走这里，它们归 pri 670 的 `strike.shape.area`。
   *
   * 素材是 `jb2a.<武器>.melee.*`，与挥击族并列的另一族，差别在长度：挥击 39-51 帧、
   * 连段 66-86 帧（2.2-2.9s，画的就是 2-3 下）。这一族是照 pf2e-trigger-animations-trove
   * 的成品配方翻出来的，本仓库此前整族没发现。
   *
   * pri 650 高于单击的 620，低于远程的 640——远程武器不在连段表里，两条不会打架。
   */
  /**
   * 冲扑 / 冲锋：**从这里冲到那里**。
   *
   * 动作轴的第三条规则。`target.type === "movement"` 的武器动作有 5 条——`ferociousLeap`
   * 凶猛扑跃、`flyingKick` 飞踢、`ruthlessMomentum` 无情冲势、`shieldCharge` 盾牌冲锋、
   * `tuskCharge` 獠牙冲撞。它们此前播的是**原地挥击**：角色明明冲过去了，画面上完全
   * 看不出移动。
   *
   * 用一条 1200×200 的尘团横条 stretchTo 从施法者铺到目标。它自己会从左走到右
   *（逐帧 alpha 重心 0.135 → 0.822），挂的是 jb2a `ray` 模板 [100,0,0]，startPoint/
   * endPoint 都是 0，不吃「stretchTo 首尾各缩进 12.5%·d」那个坑。
   *
   * ⚠ 时长必须自己裁：profile 记的 lead 0 / tail 0 是被极淡的横线撑住的假象，
   * 主体只有 f1-f19 = 633ms。这里用实测 durationMs 会长到 1000ms，所以显式写 650ms。
   *
   * `once: true`：一次冲锋只该有一道轨迹，打中几个人不该叠几道。
   * pri 680 高于区域形状的 670——movement 与 cone/ray/pulse 互斥，排前面只是让
   *「更具体的形状先匹配」这个读法成立。
   */
  {
    id: "strike.shape.charge", pri: 680, once: true,
    when: s => s.cost?.weapon === true && !s.spell && s.target?.type === "movement",
    build: (s, ctx, target) => {
      const fx = ctx.pick(MOVE_TRAIL);
      if (!fx || !target) return null;
      const trail = {
        file: fx.file,
        objectScale: 1 * ctx.geom.sizeScale(),
        at: originAnchor(s),
        stretchTo: {x: target.x, y: target.y},
        // 素材两端留白的补偿，总账见 spell.gesture.ray 那条规则上的注释（施工清单 §0.4）
        template: fx.template,
        aim: {towards: {tokenId: target.tokenId, x: target.x, y: target.y},
              missed: target.results.some(r => r.result === 0 || r.result === 1)},
        // 650ms 是实测的主体段（f1-f19 @30fps）。整段量测是 1000ms，那 350ms 是
        // 肉眼几乎看不见的残絮，用 waitUntilFinished 等它等于白等。
        duration: 650,
        fadeIn: 100, fadeOut: 200,
        waitUntilFinished: -200, zIndex: 90,
        belowTokens: true
      };
      // 冲锋的「打中」是撞上的那一刻，即轨迹铺到目标的时候
      return [...strikeSounds(s, ctx, target, 650, s.strikes?.[0]), trail];
    }
  },
  {
    id: "strike.melee.combo", pri: 650,
    when: s => s.cost?.weapon === true && !s.spell && !s.tags?.includes("thrown") &&
               isMultiHit(s) && s.strikes.some(w => comboFor(w)),
    build: (s, ctx, target) => {
      const w = s.strikes.find(x => comboFor(x));
      const combo = comboFor(w);
      const fx = ctx.pick(combo.path, {color: combo.color});
      if (!fx) return null;
      const clip = clipOf(fx.file);
      const snd = strikeSounds(s, ctx, target, clip?.contactMs ?? 800, w);
      return [...snd, {
        file: fx.file,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null,
        ...meleeGeom(s, ctx, target, fx),
        // 连段整段 2.2-2.9s，全播完；交棒点按实测的亮度峰值（连段里最亮的一下）
        duration: clip?.durationMs ?? 2200,
        zIndex: 100,
        elevation: target.elevation,
        waitUntilFinished: clip ? clip.contactMs - clip.durationMs : -800
      }];
    }
  },
  {
    id: "strike.ranged.weapon", pri: 640,
    when: s => !s.tags?.includes("thrown") &&
               s.strikes.some(w => RANGED_SHAPE[w.identifier] || RANGED_CATEGORY[w.category]),
    build: (s, ctx, target) => {
      const w = s.strikes.find(x => RANGED_SHAPE[x.identifier] || RANGED_CATEGORY[x.category]);
      // 弹药跟着**动作**的元素走：flamingArrow 的火来自动作，弓仍是弓。
      const path = ammoFor(w, s.usage?.damageType);
      const fx = path && ctx.pick(path);
      if (!fx) return null;
      const clip = clipOf(fx.file);
      const shot = {
        file: fx.file, objectScale: 1 * ctx.geom.sizeScale(),
        at: originAnchor(s),
        stretchTo: {x: target.x, y: target.y},
        // 素材两端留白的补偿，总账见 spell.gesture.ray 那条规则上的注释（施工清单 §0.4）
        template: fx.template,
        aim: {towards: {tokenId: target.tokenId, x: target.x, y: target.y},
              missed: target.results.some(r => r.result === 0 || r.result === 1)},
        // 飞行时间逐文件取：ft 档位定的是飞行距离，19 帧的弹丸与 43 帧的弩矢不该
        // 用同一个 800ms。命中时刻取亮度峰值——对飞行物那正是箭到目标炸开的那一帧。
        duration: clip?.durationMs ?? 800,
        waitUntilFinished: clip ? clip.contactMs - clip.durationMs : -300, zIndex: 100,
        elevation: target.elevation
      };
      // 飞行物的「打中」是箭到的那一刻（亮度峰值就是命中炸开那一帧）
      return [...strikeSounds(s, ctx, target, clip?.contactMs ?? 500, w), shot];
    }
  },
  {
    id: "strike.talisman", pri: 630,
    when: s => !s.tags?.includes("thrown") &&
               s.strikes.some(w => TALISMAN_SHAPE[w.category]),
    build: (s, ctx, target) => {
      const w = s.strikes.find(x => TALISMAN_SHAPE[x.category]);
      const family = TALISMAN_SHAPE[w.category];
      // ctx.pick 的 {color} 走 pickColor：颜色分支不存在时取最近色并用 hue 补偿，
      // 与其余元素通路同一套（见 resolver/context.mjs 的 pick）。
      const fx = ctx.pick(family, {color: talismanColorFor(w)});
      if (!fx) return null;
      const clip = clipOf(fx.file);
      const cue = {
        file: fx.file,
        ...meleeGeom(s, ctx, target, fx),
        // 与 strike.melee 同口径：时序逐文件取（见 armory/clip-table.mjs）
        duration: clip?.durationMs ?? 933,
        zIndex: 100,
        elevation: target.elevation,
        waitUntilFinished: clip ? clip.contactMs - (clip.durationMs ?? 933) : -400
      };
      return [...strikeSounds(s, ctx, target, clip?.contactMs ?? 533, w), cue];
    }
  },
  {
    id: "strike.melee", pri: 620,
    when: s => !s.tags?.includes("thrown") && s.strikes.some(w =>
      ["light1", "simple1", "balanced1", "heavy1", "simple2", "balanced2", "heavy2",
       // 盾：改造前 5 面盾一条 cue 都不出，就是因为这里没有它们两个分类
       "shieldLight", "shieldHeavy"]
        .includes(w.category)),
    build: (s, ctx, target) => {
      const adjacent = ctx.geom.adjacent(target);
      /*
       * 【D3 · 隔格不再一律野太刀】施工清单 §0.14。
       *
       * 改造前这里是 `adjacent ? ctx.pick(形制) : ctx.pick(nodachi)`——隔格分支**不看
       * 武器身份**。`tools/_wx/far.mjs` 实测「隔格 adjacent=false：12 种路径，最大桶 71」，
       * 按 `const/weapon.mjs` 的 CATEGORIES 滤掉 range=1 的（unarmed / light1 / simple1 /
       * 全部 5 面盾）之后，真能走到隔格的 **48 件武器**（其中 **28 件是天生武器**）
       * 的 identifier 逐个都在野太刀那一桶里：一记咬击、一次盾撞、一根触手，
       * 隔一格打出来全是同一段金属野太刀过顶下劈。
       *
       * 现在的三层，与选材阶段的逐条读图结论一致（ASSET-NOTES「D3 隔格」一节）：
       *  1. `reachFor()` —— 长柄/长兵若在 `REACH_SHAPE` 表里有专属的够远形制，用它。
       *     那张表在 `armory/weapon-shapes.mjs`（不属本文件）。
       *  2. 查不到就**退回这件武器贴身时的同一支形制**（`pickFor`）。这不是将就：
       *     `jb2a.melee_attack` 全族 482 个叶文件的模板只有 `[200,300,300]` 与
       *     `[200,400,400]` 两种、**握把跨距恒 1 格**，而射程由 `swingScale()` 定成
       *     中心距的函数——够不够得到与选哪支素材**无关**（「射程口径」一节已证伪
       *     「野太刀是全族唯一够得到隔一格的一支」）。天生武器因此自动保住 bite/claws
       *     本族，不会再被换成金属刀光，正是 §0.14 第 ② 层要的效果。
       *  3. 两层都查不到（突刺类武器整族没有对应素材）才落到兜底：贴身退短剑、
       *     隔格退野太刀（保留 §0.14 明说要留的那一条），与改造前一致。
       *
       * ⚠ 隔格与贴身的**观感差别不在这里表达**：`meleeGeom()` 用绝对 `scale`
       * （swingScale），`objectScale` 在四条近战规则上是死字段，播放层的三条互斥路
       * `scale > sizePx > scaleToObject` 会先吃掉它。距离带来的放大由 swingScale 自动给。
       *
       * ⚠ 接口约定：`reachFor(w)` 与 `pickFor(w)` 同形，返回 `{path, color}` 或 null。
       * 这里用**命名空间调用 + 可选链**（`WEAPON_SHAPES.reachFor?.(w)`）而不是具名 import：
       * 那张表由形制表 agent 同批新增，具名 import 一个尚不存在的导出会让**整个模块**
       * 加载失败（ESM 的具名绑定在链接期校验），而本文件是 travel 槽的全部内容——
       * 一条不存在的导出会让 434 个动作一条 travel cue 都没有。可选链让"表还没到"
       * 退化成第 2 层，而不是全塌。
       */
      const weapon = s.strikes?.[0];
      const shape = (adjacent ? null : WEAPON_SHAPES.reachFor?.(weapon)) ?? pickFor(weapon);
      // 天生武器的形状带颜色（獠牙大口 / 抓痕，7-8 色，元素变体落在颜色轴上），
      // 制式武器不带色（纯几何叶子）。pick 的 {color} 走最近色路由 + hue 补偿。
      const fx = shape
        ? ctx.pick(shape.path, shape.color ? {color: shape.color} : {})
        : ctx.pick(adjacent ? "jb2a.melee_attack.01.shortsword.01"
                            : "jb2a.melee_attack.05.nodachi.01");
      const clip = clipOf(fx?.file);
      if (!fx) return null;
      const swing = {
        file: fx.file,
        ...meleeGeom(s, ctx, target, fx),
        // 时序**逐文件**取，不再是常数：一条规则现在服务 20 多种形制，命中时刻从
        // 咬击 167ms 到巨剑 633ms；连同一形制的四个变体峰值也差 233ms（短剑是
        // f16/f10/f9/f11），而 ctx.pick 是随机取一个。见 armory/clip-table.mjs。
        // 表里没有这个文件时退回旧常数，不静默按 0 算。
        duration: clip?.durationMs ?? (adjacent ? 933 : 767),
        zIndex: 100,
        elevation: target.elevation,
        waitUntilFinished: clip ? clip.contactMs - clip.durationMs : -400
      };

      // 强度层：`empowered`（强力打击）在同一记挥击上再叠一道彩色拖尾。
      // trail 与挥击**逐帧对齐**（Group01 的 trail 46/40/39/41 与 shortsword.01 逐位相同），
      // 所以只多一道颜色、不改画面也不改节拍。改造前 7 条 empowered 动作与普通打击
      // 的画面完全一样。
      // 音效：风声 + 命中/落空。命中时刻用这一支素材自己的（见 clip-table）。
      // 音效：风声 + 命中/落空。命中时刻用这一支素材自己的（见 clip-table）。
      // **音效 cue 必须排在挥击之前**：`parallelizeTargets` 按数组顺序推进分支游标，
      // 挥击带交棒点会把游标推到命中时刻，排在它后面的音效会被整体推迟一个交棒量
      // （实测风声被推到 556ms，而它该在 23ms 起播）。音效不带交棒点，排在前面
      // 不影响挥击的起播时刻。
      const snd = strikeSounds(s, ctx, target, clip?.contactMs ?? 500, s.strikes?.[0]);

      if (!s.tags?.includes("empowered")) return [...snd, swing];
      const trailPath = trailFor(shape?.path);
      if (!trailPath) return [...snd, swing];
      const tr = ctx.pick(trailPath, {color: trailColorFor(s.usage?.damageType)});
      if (!tr) return [...snd, swing];
      // 变体对齐：拖尾的 4 个文件与挥击的 4 个变体逐位对应，两边各摇一次会画出
      // 两道不同的弧。按挥击文件在自己数组里的下标取。
      const vi = fx.files?.indexOf(fx.file) ?? -1;
      const trFile = (vi >= 0 && tr.files?.[vi]) || tr.file;
      const trClip = clipOf(trFile);
      // 拖尾也必须排在挥击**之前**，理由与音效相同：挥击带交棒点会把分支游标推到
      // 命中时刻，排在它后面的拖尾会整体晚 533ms 起播——而拖尾是逐帧与挥击对齐的，
      // 晚半秒等于两道弧完全错开。zIndex 101 > 100 保证它仍画在挥击之上。
      return [...snd, {
        ...swing,
        file: trFile,
        filter: tr.hue ? {type: "ColorMatrix", data: {hue: tr.hue}} : null,
        // 拖尾自己那支素材的模板与缩放：实测 trail 与挥击同族同模板（两边都是
        // [200,300,300]），照理 `...swing` 继承过来就对；但「照理相同」不是契约，
        // 拖尾哪天换族就会连锚点带长度一起错位。显式按 tr 自己的模板重算一次，
        // 让「握把→刀锋 = 中心距」这条不变式对两层各自独立成立。
        template: tr.template ?? swing.template,
        scale: swingScale(s, target, tr.template ?? fx.template),
        duration: trClip?.durationMs ?? swing.duration,
        // 叠加层不再交棒：交棒点由下面那记挥击定，两条都挂会让 impact 等两次
        waitUntilFinished: null,
        zIndex: 101
      }, swing];
    }
  },

  /**
   * 拳击轨迹。PF2E 里 unarmed 永远是贴身武器，没有隔格变体可选，因此不做
   * shortsword/nodachi 那样的分支——几何与另外三条近战规则共用 `meleeGeom()`。
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
      // **按部位选，不再是一支拳影包打天下。** 改造前这条规则服务 14 个动作、全部
      // 共用 `jb2a.unarmed_strike.no_hit.01.blue`——`necroticBite`（腐蚀咬击）播的是
      // 一记蓝色拳影。现在 `pickFor` 对 unarmed 分类也走部位路由：咬→獠牙大口、
      // 爪→抓痕、拳/指虎→拳影弧，颜色跟伤害类型。
      const shape = pickFor(s.strikes?.find(w => w.category === "unarmed") ?? s.strikes?.[0]);
      const fx = shape
        ? ctx.pick(shape.path, shape.color ? {color: shape.color} : {})
        : ctx.pick("jb2a.unarmed_strike.no_hit.01.blue");
      if (!fx) return null;
      const clip = clipOf(fx.file);
      const snd = strikeSounds(s, ctx, target, clip?.contactMs ?? 500, s.strikes?.[0]);
      return [...snd, {
        file: fx.file,
        filter: fx.hue ? {type: "ColorMatrix", data: {hue: fx.hue}} : null,
        ...meleeGeom(s, ctx, target, fx),
        zIndex: 100,
        elevation: target.elevation,
        // 逐文件取时序；退回的 900/-267 是原来那支 no_hit.01.blue 手调过的值
        duration: clip?.durationMs ?? 900,
        waitUntilFinished: clip ? clip.contactMs - clip.durationMs : -267
      }];
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
   * duration 裁到 1167ms（收势后）。朝向由 stretchTo 自己转，不再靠 mirrorY（见 cue 上的注释）。
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
      const cue = {
        file: fx.file,
        at: originAnchor(s),
        stretchTo: {x: target.x, y: target.y},
        // 素材两端留白的补偿，总账见 spell.gesture.ray 那条规则上的注释（施工清单 §0.4）
        template: fx.template,
        objectScale: 1 * ctx.geom.sizeScale(),
        // ⚠ `mirrorY: onLeft(target)` 已删。带 stretchTo 的 cue 由
        // `_applyDistanceScaling`（sequencer.js:16992-16994）按 source→target 的射线
        // **自己转向**，朝向从来就不需要靠镜像去凑；而 mirrorY 翻的是 y 轴（flipY），
        // 向左投掷时它把匕首上下颠倒了一次，与「倒着飞」正好相反。这一行是
        // 「不转向的近战靠镜像表达左右」那套错几何留下的尾巴（施工清单 §0.2），
        // 随那四条规则一起退休。
        aim: {towards: {tokenId: target.tokenId, x: target.x, y: target.y},
              missed: target.results.some(r => r.result === 0 || r.result === 1)},
        zIndex: 100, elevation: target.elevation,
        startTime: 533, duration: 1167,
        selfFlash: {from: 367, at: 500, to: 667},
        waitUntilFinished: -750
      };
      // 交棒点就是画面上「打中」的时刻（duration + waitUntilFinished）
      return [...strikeSounds(s, ctx, target, 417, s.strikes?.[0]), cue];
    }
  },

  /**
   * 爆发（**非法术**的那一路）：没有飞行段，全部交给 impact。
   *
   * ⚠ 2026-08-29：法术的 blast 手势已经由 pri 775 的 `spell.gesture.blast` 接管，
   * 原注释「施法者原地起爆，没有『到达』这个概念」**是错的**，说理见那条规则。
   * 这一条今天只剩下「`target.type === "blast"` 但不是法术手势」这个面——
   * 语料里为空，但它是判据独立的一条：将来若有武器/天赋类的 blast 动作出现，
   * 它们没有符文色也没有 region，落在这里比落进 pri 10 的每目标蓝箭兜底正确。
   * `once: true` 是语义标注：blast 是区域形状，将来若把 null 换成实际内容，
   * 也必须是每动作一份而不是每目标一份。
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
   * （aura 24 = aura+sense，region **emanation**；fan 12，region cone **angle=210**；
   * step 12 是位移/闪现；penetratingShot 贯穿线 1；steamVent 脉冲 1），
   * 但那不是本条规则该背的锅：它是 when: () => true 的终极兜底，给它翻上 once
   * 会把 46 个正确用例一起打坏（箭雨只剩一支箭），而且实测会让 24 个零目标动作的
   * build 读到 null 代表目标（本条 build 解引用 target.x）。那 50 个区域动作要的是
   * 补几条自带 once 的区域规则挡在兜底之前，属规则覆盖面的问题，不属 once 机制。
   *
   * 【2026-08-29 · 批次 C 结账】上一段说的那几条规则已经补上了：`spell.gesture.fan`
   * (780) / `spell.gesture.create`(780，含 conjure) / `spell.gesture.blast`(775) /
   * `spell.gesture.contact`(765，touch+influence) / `spell.gesture.step`(765) /
   * `spell.gesture.aura`(765，aura+sense)。**两处旧数字同批订正**：
   *   · fan 的 region 张角是 **210**（`TARGET_TYPES.fan.region.angle`）不是 120；
   *   · aura/sense 的 region 类型是 **emanation** 不是 circle
   *     （`action-use-dialog.mjs` 的 aura 分支造的是 `{type:"emanation", radius, base}`）。
   * 这两个数写错会直接误导下一个实现者：120° 只需一张贴图，210° 必须拼接；
   * emanation 在 `play.mjs` 的 `regionMaskShape` 里**没有分支**，按 circle 写会 warn。
   */
  {
    id: "generic.travel", pri: 10,
    when: () => true,
    build: (s, ctx, target) => {
      if (!s.usage.isRanged) return null;
      const fx = ctx.pick("eskie.attack.ranged.arrow.ray.physical.blue.30ft");
      if (!fx) return null;
      const shot = {
        file: fx.file, objectScale: 1 * ctx.geom.sizeScale(),
        at: originAnchor(s),
        stretchTo: {x: target.x, y: target.y},
        // 素材两端留白的补偿，总账见 spell.gesture.ray 那条规则上的注释（施工清单 §0.4）
        template: fx.template,
        aim: {towards: {tokenId: target.tokenId, x: target.x, y: target.y},
              missed: target.results.some(r => r.result === 0 || r.result === 1)},
        duration: 800,
        waitUntilFinished: -300, zIndex: 100
      };
      // 这条兜底也服务 84 条法术（无手势专属规则的那些），给它们补上命中音。
      // 非法术走这里的是「远程但没有武器」的技能类动作，`spellImpactSound` 自己会返回空。
      return [...spellImpactSound(s, ctx, target, 500), shot];
    }
  }
];
