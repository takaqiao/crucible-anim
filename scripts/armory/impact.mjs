import {RESULT, RESULT_NAME, HIT_RESULTS} from "../const.mjs";
import {coveringFlash, trimFlash} from "./flash.mjs";

/**
 * S3 impact：命中判定后，锚在目标。结果层与元素层分开叠加，见 DESIGN.md §6.5。
 *
 * 8 种攻击结果 × 12 种伤害类型 = 96 种组合，但两者分层：
 *   impact = 结果层（8 选 1，与元素无关） + 元素层（仅 HIT_RESULTS 叠加，12 选 1）
 * 只需 8 + 12 = 20 条内容，见文末两张表。
 *
 * 第三层是 **治疗汇聚层**（RESTORATION_LAYER，施工清单 §0.8）：真的治到人时它**取代**
 * 结果层，元素层则由 isBenign() 关掉——「打中了什么属性」这句话在治疗上没有意义，
 * 而结果层那记命中火光打在被治疗者身上会被读成「他挨了一下」。三层互斥关系写在 build()。
 */

/** 与 travel.mjs 的 r6 同源：cue 计划要 JSON 化广播，抹掉 0.8*0.8=0.6400000000000001 这类浮点尘埃。 */
const r6 = v => Math.round(v * 1e6) / 1e6;

/**
 * 语义权重：DESIGN.md §6.5 那一列「这一下有多重」（HIT 最重、GLANCE 打六折、
 * MISS/DODGE 更轻）。**与素材、与画布无关**，所以单独成表，由结果层与元素层共用
 * 同一个数——这是「掠过比命中轻」在本槽里唯一的来源。
 *
 * 从前它被乘进 RESULT_LAYER 的 scale 里（语义权重 × 画布归一化揉成一个数），于是
 * 元素层用不上它：元素层素材是 eskie 800x800 / jb2a 400x400，跟结果层那条素材的画布
 * 毫无关系，直接乘上含 blfx 1200x1200 归一化的 0.25 是错的，而不乘就等于元素层完全
 * 不受攻击结果影响——旧实现选了后者，后果是 12 种伤害类型下 HIT 与 GLANCE 的元素层
 * objectScale 全部相等；再叠上 travel 自带闪爆抑制结果层的那一档，两者的 impact cue
 * 逐字段只差一个 playIf，掠过在画面上字面等于命中。拆开之后两层各乘各的画布系数、
 * 共用同一个权重，这一档不可能再单边漏掉。
 */
const RESULT_WEIGHT = Object.freeze({
  [RESULT.HIT]: 1.0,
  [RESULT.GLANCE]: 0.6,   // §6.5 表 GLANCE 行原文：「同上 scale ×0.6」
  [RESULT.ARMOR]: 0.8,
  [RESULT.BLOCK]: 0.9,
  [RESULT.PARRY]: 0.9,
  [RESULT.RESIST]: 1.0,
  [RESULT.DODGE]: 0.8,
  [RESULT.MISS]: 0.7
});

/**
 * 未知 / 越界结果码退回 HIT 的权重，与下面 `RESULT_LAYER[...] ?? RESULT_LAYER[RESULT.HIT]`
 * 的回退方向保持一致——两处不一致会渲出一个权重与素材对不上的东西。
 */
const weightOf = result => RESULT_WEIGHT[result] ?? RESULT_WEIGHT[RESULT.HIT];

/**
 * 结果层：8 种攻击结果各自的表现，与伤害元素无关。路径与数值全部取自
 * docs/ASSET-NOTES.md 主表 89-96 行（每行备注都写着「对应 X」，是本任务专门
 * 侦察出来的 1:1 对应），不经 {color} 动态染色——ASSET-NOTES 文末 A 节记录了
 * 同族颜色分支之间帧数可以差到 1.83 倍（如 jb2a.impact.007 的 white 对其余色），
 * 结果层承担的是「发生了什么」这个结构性判断，不能让 pickColor 在运行时静默换
 * 到一个时序没验证过的兄弟分支；元素层（下表）才负责传达「什么属性」。
 *
 * canvas 字段只含**画布归一化**：该素材相对 JB2A 400x400 基准画布的尺寸差
 * （ASSET-NOTES 反复强调「画幅尺寸不统一」，blfx 1200x1200 是 JB2A 的 3 倍，
 * 同一个 objectScale 数字混排会差 2-3 倍）。语义权重不在这里，在上面的
 * RESULT_WEIGHT；下发的 objectScale = weight × canvas × sizeScale()。
 *
 * ⚠ **这个前提在 Task 12 被推翻，本槽尚未跟进（已知欠账，不属于本轮范围）。**
 * 播放层走 `e.scaleToObject(cue.objectScale)`（IMPLEMENTATION-PLAN Task 13），而
 * Sequencer 4.2.3 的 `_applyScaleToObject` 是 `sprite.width = 目标宽 × scale × baseScale`
 * ——「目标宽」来自被附着对象的尺寸，源文件的像素尺寸只经宽高比参与，**不参与定尺寸**。
 * 全兵库没有任何一条 cue 设过绝对 `scale`（CUE_DEFAULTS.scale 恒 null），所以画布归一化
 * 在本仓库是一个死系数：真正决定观感尺寸的是「内容占画幅比 × objectScale」，而内容占比
 * 与画布像素毫无关系（下面元素层那一行有逐条实测）。修它要连 element-distinct 与
 * MAX_FADE_RATIO 两套守卫、以及上一次提交的「掠过缩放」定义一起重新推导，须由 impact
 * 槽负责人在同一轮里做。persist 槽已按新语义改过，见 armory/persist.mjs 的 burning 条。
 *
 * startTime/duration 单位 ms，两个数都相对素材自身第 0 帧，语义与 travel.mjs 一致：
 * duration 是「startTime 之后还要播多久」，不是绝对终点。省略即保留素材原长
 * （口径的完整说明见 resolver/resolve.mjs 的 CUE_DEFAULTS.duration）。
 *
 * ⚠ 这与 Sequencer `EffectSection.duration()` 的表面行为**相反**：那边
 * `.startTime(s)+.duration(d)` 实际只播 clamp(d-s, 0, d)（sequencer.js:16106），d ≤ s
 * 时一帧都不出。播放层因此用 `.timeRange(s, s+d)` 换算，见 player/play.mjs 的
 * applyTimeWindow()——**照抄本表的数字直接调 Sequencer 的 .duration() 会静默削掉一截**。
 * 硬约束 startTime + duration ≤ 素材总长：本表最紧的三条是 ARMOR 467+266=733≤1100、
 * BLOCK 267+1233=1500≤1500、8 支 eskie 一律正好补到 500≤501，下方「fade 预算」用例有守卫。
 *
 * fadeIn/fadeOut 两列必填、一条都不许省。CUE_DEFAULTS 给的 200/300 合计 500ms 是按
 * 「1-2 秒的施法/持续类素材」定的，套到 impact 槽上是灾难：本表 8 条结果层里有 3 条的
 * 有效时长本身就 ≤500ms（GLANCE 500、DODGE 333、ARMOR 266），元素层 8 支 eskie 裁完
 * 只剩 233-266ms——继承默认值的结果不是「淡入淡出稍长」，而是 cue 从头到尾都到不了满
 * 不透明度。逐条依据（ffprobe 实测总长 / 逐帧 alpha 加权亮度剖面定位主体 / 由此推出的
 * 预算）写在各自注释里，由 test/armory-impact.test.mjs 的「fade 预算不超过 cue 有效
 * 时长的三成」守着。三条通用判据：
 *   1. 素材自己有起手渐强段（f0 空、前几帧由弱到强）就写 fadeIn:0——再叠一层淡入是对
 *      同一件事做两遍，且必然压在主体峰值上。只有「f0 已经是完整画面」或「用 startTime
 *      从中途切入」的才需要 fadeIn，与 travel.mjs:206 / cast.mjs:70 的判据一致。
 *   2. 素材自己会熄灭到 0 的，fadeOut 只作末两三帧的保险；被 duration 硬切、或末帧还
 *      亮着的才需要真正吃时间的 fadeOut。
 *   3. playbackRate 会缩短墙钟时长，算预算时分母是 (总长-startTime)/rate。
 *
 * flash 字段：ASSET-NOTES「自带闪爆」列的机器可读版，窗口毫秒数相对**素材自身第 0 帧**
 * （与 startTime 无关），来自逐帧实测（解 alpha 后每帧算归一出光量 Σ(alpha×luma)/画幅
 * 与「低饱和·高亮·不透明像素占比」两条曲线）。标「否」的写 flash: null。cue 上申报的
 * selfFlash 由 flash.mjs 的 trimFlash() 按 startTime/duration 现算，不是手写的第二份
 * 常量——任何人删掉 startTime，闪爆就会重新申报出来，双闪守卫立刻变红。
 */
export const RESULT_LAYER = {
  /**
   * HIT — jb2a.impact.005.white，25 帧 @30fps=833ms，自带闪爆＝是（真正的「命中」
   * 这个概念本身就该是一次闪爆，不是需要回避的重复）。f17-24 只剩暗火星，
   * ASSET-NOTES 建议 endTime≈550ms，裁掉那段几乎不可见的尾巴。400x400 基准画布，
   * canvas=1，语义权重由 RESULT_WEIGHT 的 1.0 承担。
   *
   * 【本轮补测】白光段是 f0-f6 整段（0-200ms），不止 ASSET-NOTES 记的 f4：归一出光量
   * f0=f1=18.0（本片最高）、f2=1.9、f3=4.5、f4=5.0、f5=4.3、f6=3.3，f7 起 ≤3.2 单调
   * 衰减。也就是说 f0-f1 那团柔光白球本身就是这条素材最亮的一次爆闪，f4 星芒只有它的
   * 28%——命中该有的硬起就在 t=0，默认 fadeIn:200 会把爆闪本体压成 0→25%，等于把这条
   * cue 最贵的两帧删了，所以 fadeIn:0。550ms 截在 f16.5（只剩 2%），fadeOut:100
   * （从 450ms=f13.5 起，覆盖的三帧都 ≤8%）纯粹是防硬切的保险。预算 100/550=18%。
   */
  [RESULT.HIT]: {path: "jb2a.impact.005.white", canvas: 1, shake: true,
                 duration: 550, fadeIn: 0, fadeOut: 100, flash: {from: 0, at: 33, to: 200}},

  /**
   * GLANCE — blfx.spell.impact.flash.color1，15 帧 @30fps=500ms（f0 空，有效内容
   * f1-f14，三拍闪烁到 f13-14 才熄灭，不裁剪保留这个「越擦越弱」的层次）。
   *
   * canvas 0.35：画布 1200x1200 是 HIT 基准的 3 倍，取 ASSET-NOTES 原话「必须显式压到
   * ~0.35 才和 HIT 同量级」。语义那一档由 RESULT_WEIGHT 的 0.6 承担，下发
   * 0.6 × 0.35 = 0.21。从前写的是揉成一个数的 0.25，相对 0.35 这条「同量级」基线是
   * 0.714，既不是 §6.5 的 0.6 也没有别的依据。
   *
   * fade：ffprobe 500ms，不裁剪。逐帧 f0 空、f1-f5 由弱爬到 94%、f6 峰值，之后是注释里
   * 那个三拍闪烁（f7 塌、f8-f9 回涨、f10 再塌、f11-f12 二次回涨、f13-f14 熄灭）。默认
   * fadeOut:300 从 200ms 起算正压在 f6 峰值上，会把三拍抹平成一次单调淡出。素材自带 5 帧
   * 渐强所以 fadeIn:0；fadeOut 只给 67（两帧，从 433ms=f13 起，那时已只剩 12%）。
   * 预算 67/500=13%。
   *
   * 主爆闪 f3-f6（归一出光量 8.8/11.5/16.5/17.6）。flash 窗口只记主爆闪：f8-f9 与
   * f11-f12 那两拍余震是同一条素材自己的节奏，不构成「两层各闪一次」。
   */
  [RESULT.GLANCE]: {path: "blfx.spell.impact.flash.color1", canvas: 0.35, shake: false, fadeIn: 0, fadeOut: 67, flash: {from: 100, at: 200, to: 233}},

  /**
   * ARMOR — jb2a.impact.011.yellow，33 帧 @30fps=1100ms。ASSET-NOTES：f0-3 是自带
   * 白爆闪、f4-13 是金色电弧丝（单看会被误读成雷击）、f23-31 是会「明显闪三下」的
   * 孤立亮弧尾巴。「要纯刮擦火花感必须掐两头：startTime≈f14（467ms）、
   * endTime≈f22（733ms）」——直接照抄这两个数字。400x400 基准画布，canvas=1。
   *
   * 白闪实测覆盖 f0-f3（低饱和高亮不透明像素占比 6.4/10.4/6.9/5.1%，f4 起 ≤2.6%），
   * 故 flash 窗口 [0,133)。startTime:467 已经整段越过它，trimFlash 因此返回 null——
   * 这条结果层本来就不带闪光，用代码复述了上面那句「掐掉 f0-3」。
   *
   * fade：有效时长只有 **266ms**，比 CUE_DEFAULTS 的 500ms 预算还短——默认值下这条 cue
   * 数学上不可能到达满不透明度。窗口内 f14-f21 是单调衰减的火星（相对全片峰值 9%→1%），
   * 首帧就是窗口里最亮的一帧、切入点前一帧的绝对亮度也只有 alpha 均值 8/255，不存在硬
   * 弹出，所以 fadeIn:0；末尾只剩 1%，fadeOut 给 67（两帧）收尾。预算 67/266=25%，
   * 是全表最紧的一条。
   */
  [RESULT.ARMOR]: {path: "jb2a.impact.011.yellow", canvas: 1, shake: false, startTime: 467, duration: 266, fadeIn: 0, fadeOut: 67,
                   flash: {from: 0, at: 33, to: 133}},

  /**
   * BLOCK — jb2a.shield.02.outro_explode.blue，45 帧 @30fps=1500ms。ASSET-NOTES：
   * 「0-7 帧偏暗但一直在线性变亮…只想省掉最暗的起头裁到 ~f8 就够」，裁到 f20 会切掉
   * 肉眼可见的护盾成型过程。startTime 267ms（~f8），其余全长播完（含 f31-44 的碎裂
   * 爆闪），duration = 1500-267 = 1233ms。400x400 基准画布，canvas=1。
   *
   * fade：全表唯一一条真正需要 fadeIn 的结果层——切入点 f8 已经是覆盖 44% 画幅的一整块
   * 护盾圆盘（相对峰值 28%），是货真价实的中途切入硬弹出；f9-f15 继续线性变亮，f32 碎裂
   * 爆闪 100%，f39 起全空。fadeIn 取 150 让淡入骑在素材自己的线性变亮段上（与 cast.mjs:70
   * 「压到 150ms 只抹掉那一下瞬间起跳」同一判据），写 300 会把整段成型过程压平；fadeOut
   * 取 200，起点落在 f39（素材已空），完整保住 f33-f38 的爆闪衰减。预算 350/1233=28%。
   */
  [RESULT.BLOCK]: {path: "jb2a.shield.02.outro_explode.blue", canvas: 1, shake: false, startTime: 267, duration: 1233, fadeIn: 150, fadeOut: 200,
                   flash: null},

  /**
   * PARRY — blfx.misc.enchantment.1.blades_clash1.color1，90 帧 @30fps=3000ms，
   * 1200x1200（JB2A 基准的 3 倍，canvas=1/3）。ASSET-NOTES 明确警告「endTime≈1000ms
   * 是有害建议…要留住爆发至少给到 f50（约 1700ms）」——直接采纳这个下限，舍弃 f77 之后
   * 的静置尾巴。语义权重 0.9 由 RESULT_WEIGHT 承担，下发 0.9 × 1/3 = 0.3。
   *
   * 自带闪爆实测是**缓升型持续辉光**而不是一次爆闪：归一出光量从 f8 的 2.6 一路爬到
   * f40-f44 的 7.7 峰值再缓降，白度峰在 f34 附近。按 sustained 记。
   *
   * fade：f0-f5 基本全空（前 200ms 空转，淡入会在空帧上空转，cast.mjs:12 记过这个坑），
   * 素材自带 1.3s 渐强，故 fadeIn:0；裁点 f51 处素材还有约 66%，是全表唯一一条在近峰值
   * 硬切的 cue，fadeOut 在这里不是保险而是必需品，取 300（从 1400ms=f42 起，easeInQuad
   * 头 100ms 只掉 11%，高潮仍落在 f40-f45）。预算 300/1700=18%。
   */
  [RESULT.PARRY]: {path: "blfx.misc.enchantment.1.blades_clash1.color1", canvas: 1 / 3, shake: false,
                   duration: 1700, fadeIn: 0, fadeOut: 300,
                   flash: {from: 267, at: 1367, to: 2867, sustained: true}},

  /**
   * RESIST — jb2a.extras.tmfx.inpulse.circle.02.normal，54 帧 @30fps=1800ms，
   * 500x500。ASSET-NOTES：「对一次命中结算偏慢，建议 timeScale 加速或直接换
   * …02.fast」——02.fast 只在备注文字里出现、不是主表自己的一行，不满足
   * test/armory-assets.test.mjs「精确命中或父路径」的判定，因此不直接切素材，
   * 改用 ASSET-NOTES 同一句里给出的另一条路：playbackRate:2 把 1800ms 原地压到
   * ~900ms。「环的最大直径等于整张 500px 画布…想做出『从体外收进来』的层次应放大到
   * ~1.4」，canvas 直接取该建议值。
   *
   * fade：duration 为 null 但 playbackRate:2 把墙钟时长压到 **900ms**——算 fade 预算时
   * 分母必须是 1800/2，这是全表唯一一条 rate≠1 的 cue。素材 f0-f5 空、f22-f26 峰值
   * （墙钟 367-433ms）、f43 起彻底归零（717ms），尾部还有 183ms 空帧。自带 300ms 渐强
   * 故 fadeIn:0；fadeOut 取 150，整段落在那段空尾里，不碰任何内容。预算 150/900=17%。
   */
  [RESULT.RESIST]: {path: "jb2a.extras.tmfx.inpulse.circle.02.normal", canvas: 1.4, shake: false, rate: 2, fadeIn: 0, fadeOut: 150,
                    flash: null},

  /**
   * DODGE — jb2a.teleport.01.white，27 帧 @30fps=900ms，500x300 横幅。ASSET-NOTES：
   * 「endTime 掐在 f10 就够，本体只有 f1-f4 约 0.13s」，f10=333ms，直接取。
   * ⚠ 从前这里写 `missed:true`（「`.missed()` 偏移落空 + 残影」，DESIGN.md §6.5 的旧结论）。
   * 2026-08-29 已按施工清单 §0.7 翻案：这一行现在**转向**，而 rotateTowards 会填上
   * data.target，`missed && !data.target` 恒假——`.missed()` 在它身上本来就不生效了。
   * 翻案的完整说理见下面 RESULT_GEOM 上方那段「`.missed()` 的翻案」。500 宽对 JB2A 400
   * 基准约 1.25 倍，canvas 取 0.8（=1/1.25），语义权重 0.8 由 RESULT_WEIGHT 承担，
   * 下发 0.64。旧值 0.65 是「0.8 ÷ 1.25」的手工取整，拆表后按公式落到 0.64。
   *
   * fade：全部内容在 f1-f4（33-167ms），峰值 f2=67ms。默认 fadeIn:200 的 easeOutQuad
   * 在峰值只走到 55%、在 f1 只有 31%——整条 cue 都在淡入期内，是本表被默认值伤得最狠的
   * 一条，必须 fadeIn:0。fadeOut 取 67，起点 267ms 时素材早已归零，纯保险。预算 20%。
   */
  [RESULT.DODGE]: {path: "jb2a.teleport.01.white", canvas: 0.8, shake: false,
                   duration: 333, fadeIn: 0, fadeOut: 67, flash: null},

  /**
   * MISS — jb2a.ui.miss.white，84 帧 @30fps=2800ms，本质是烘死在素材里的英文衬线字
   * "Miss!"（与另外 7 条纯 VFX 语言不一致，且没法本地化——上线前需要设计确认是否
   * 换成扬尘/挥空类素材，本任务先用这条已验证路径占位，见 task-11-report.md 的顾虑
   * 一节）。ASSET-NOTES：「空帧从 f44 起…endTime≈1467ms」，直接取。源画布只有
   * 200x200（JB2A 基准的一半），「铺到一格 token 上字号偏小需要放大」，canvas 取 2，
   * 语义权重 0.7 由 RESULT_WEIGHT 承担，下发 1.4。
   * ⚠ 同样按 §0.7 翻案去掉了 `missed:true`：这条 cue 要补的是**构图居中**（静止段文字
   * 重心压在画幅 73% 处，见本行素材备注末段），不是「打偏了落在旁边」；整圈随机偏移会
   * 把它推到不可预期的地方，而且逐客户端不同。改由 RESULT_GEOM 的 selfY 给出。
   *
   * fade：f0-f3 是素材自己的 100ms 弹入、f6-f40 是一段逐帧数值完全不变的静止文字平台、
   * f41-f43 是自带收尾，f44 起全空——1467ms 这个裁点正落在素材自然结束处。既有自带弹入
   * 又有自带收尾，fadeIn:0；fadeOut 只给 100 骑在自带收尾上，作用是万一将来有人重调
   * duration 不至于变成一刀切。预算 7%。
   */
  // test/manifest.test.mjs 的 Foundry 全局扫描器原先用 \b 判定边界，会把这条路径里
  // "ui" 前面那个点误判成 `ui.` 全局引用，逼得上一版把字符串拆成两段字面量拼接来绕开
  // 假阳性——但这既没修真正的误报，又让 test/armory-assets.test.mjs 的路径扫描器看
  // 不到完整路径（见该文件「DB 路径不得以字符串拼接的形式出现」断言）。现在扫描器已改
  // 用 (?<![\w.]) 收紧边界判定，不再需要这种绕法，直接写完整字面量。
  [RESULT.MISS]: {path: "jb2a.ui.miss.white", canvas: 2, shake: false,
                  duration: 1467, fadeIn: 0, fadeOut: 100, flash: null}
};

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 逐结果几何裁定表（施工清单 §0.7）
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * ## 它修的是什么
 *
 * 从前 impact 槽每条 cue 都带 `aim: {towards: 目标本身, missed}`，而 `at` 也是同一个
 * 目标。play.mjs 的退化判据（`!samePoint(aimPoint, atPoint)`）因此一次都不进
 * rotateTowards——`Ray(p,p).angle` 是 `atan2(0,0)=0`，转向是 no-op。这个 aim 除了驮着
 * `missed` 之外**没有任何效果**：探针实测 8 个罗盘方向逐字相同，1164 条 cue
 * （impact.layered 1074 + generic.impact 90，占全语料 434 个动作的 74%）朝向恒为 0°。
 * 这就是 owner 原话「击打方向也不对」的后半句。
 *
 * ## 为什么不是「一刀切补一个真 aim」
 *
 * 纪律 4：没量过方向的素材不许转。八条结果层素材里 ASSET-NOTES 只对三条给出了方向性
 * 实测，其余五条要么给的是**重力方向**，要么通篇没有一个字支持旋转。逐条依据：
 *
 * | 结果   | 转？ | 依据（ASSET-NOTES 主表对应行） |
 * |--------|------|--------------------------------|
 * | HIT    | 转   | 量到质心从 f0 (199.5,199.5) 漂到 f16 (285,294)，漂移方向 atan2(94.5,85.5)=47.86°——**是右下不是 +x**。所以贴图对齐攻击轴之后还要再退 47.86°，那团灰烟火星才真的顺着这一击的去势散 |
 * | GLANCE | 转   | 实测 color1..4「只换色相不换形」的四芒星闪，构图各向同性，转它不会转坏任何东西；转它换来的是落点能沿攻击轴前移（擦过就该擦在边上） |
 * | DODGE  | 转   | 逐字指令：「拖影只沿水平展开，闪避方向是上下时必须按走位方向 rotate 而不是 mirror」 |
 * | ARMOR  | 不转 | 给的是「四散飘落的小颗粒火星」＝**重力方向**，与攻击轴无关；而且那个窗口（f14-f22）没做过质心量测 |
 * | PARRY  | 不转 | 通篇只有「锚点仍建议放攻防双方中点」一句，没有一个字支持旋转。它 f8-f14 的 Λ 构图在朝西的攻击里会被转成 V，且本槽没给它 startTime，那 200ms 会照播 |
 * | BLOCK  | 不转 | 盾光环是同心圆，转它是恒等变换 |
 * | RESIST | 不转 | 向内收束的圆环，同上各向同性 |
 * | MISS   | 不转 | 「镜像会把文字整个反过来直接穿帮」——旋转同理，烘死在素材里的英文衬线字一转就废 |
 *
 * ⚠ **两侧都要钉死**。「不转」这一半和「转」那一半同样是产品决定：test/geom-guard.test.mjs
 * 有一条守卫要求 ARMOR/PARRY/BLOCK/RESIST/MISS 的世界朝向在 8 个方向上恒为 1 种，
 * 专门防止后来者「顺手补全方向」。要改这五行必须先补上对应的质心量测。
 *
 * ## 位移的两套坐标系（**别混**）
 *
 * · `along` / `lateral` —— **攻击轴坐标系**，单位是目标格宽（`t.width` 格）。
 *   语义是「这一下打在目标身上的哪个位置」，所以随**目标**体型线性放大、与施法者体型
 *   无关。这正是不许复用已退休的 `ctx.geom.offsetFor` 的原因：那个乘的是**施法者**宽，
 *   而这些 cue 锚在目标身上（3×3 的施法者会把偏移推到 150px，整个飞出目标之外）。
 * · `selfX` / `selfY` —— **贴图自身坐标系**，单位是这条 cue 渲染出来的身位
 *   （`objectScale × t.width` 格）。它补的是素材构图偏心（文字不居中、亮带偏左），
 *   与打哪儿无关，所以必须跟着贴图一起缩放，而不是跟着目标缩放。
 *
 * 两者怎么合成一条 cue.offset，见 impactOffset()。
 */
const RESULT_GEOM = Object.freeze({
  // 转，且转完再退 47.86°（上表 HIT 行）。along 0.10：火花团沿攻击轴略微越过目标中心，
  // 接上 travel 那一刀的去势；再多就飘到目标身后了（0.10 格 = 10px @ 100px 格）。
  [RESULT.HIT]:    {rotate: true, rotationOffset: -47.86, along: 0.10},
  // 擦过：沿攻击轴前移 0.35 格（一格目标的外沿），再往一侧偏 0.20 格。侧向的正负没有
  // 任何素材依据可言——crucible 的结算里根本没有「擦的是哪一边」这个量——由 sideOf()
  // 从快照里已有的稳定字段派生一个确定性的 ±1（见该函数）。
  [RESULT.GLANCE]: {rotate: true, rotationOffset: 0, along: 0.35, lateral: 0.20},
  // 按走位方向转。走位方向取「背对攻击者」：ASSET-NOTES 量到亮带偏左（f1 的 bbox 中心
  // x202、画幅中心 x250），即拖影在后、身位在前；贴图 +x 指向「躲开的方向」时，拖影正好
  // 甩回攻击者那一侧，读起来才是「从这一击底下闪开」。
  // selfX = (250-202)/500 = 0.096，把偏左的亮带推回锚点上。
  [RESULT.DODGE]:  {rotate: true, rotationOffset: 0, selfX: 0.096},
  // 不转（文字），但要补构图：ASSET-NOTES 量到静止段文字重心在 y=146/200 = 画幅 73% 处
  // 而不是正中，原话「做居中排版时要自己补偏移」。0.73 - 0.50 = 0.23，沿贴图自身 -y
  // 推回去。这条 cue 不转向、cue.angle 也是 0，所以此刻贴图坐标系就是屏幕坐标系——
  // 这是全表唯一一条**故意**落在屏幕坐标系里的位移（那行字必须保持水平）。
  [RESULT.MISS]:   {rotate: false, selfY: -0.23},
  [RESULT.ARMOR]:  {rotate: false},
  [RESULT.PARRY]:  {rotate: false},
  [RESULT.BLOCK]:  {rotate: false},
  [RESULT.RESIST]: {rotate: false}
});

/**
 * 元素层的确定性抖动幅度（度）。
 *
 * 从前元素层写 `randomRotation: true`，由 resolve.mjs 的 freezeRandom() 摇成 ±360° 的
 * 冻定随机角——与攻击方向**毫无关系**。geom-guard §3.3 曾经因此拿到一条假绿：旧判据只问
 * 「两个目标的朝向是否不同」，而随机角逐目标不同，于是「不同」成立、方向感知却仍然是零。
 * 现在改成「攻击轴 + 抖动」：轴由 aim 给（真的跟着目标转），抖动只负责让同一场战斗里的
 * 溅射不要一模一样。
 *
 * ±25° 的依据：ASSET-NOTES 的血溅行量到质心从 f1 的 x=51.3% 漂到 f63 的 x=64.1%，
 * 「方向性很弱但不是零」——弱方向性的素材经得起小幅抖动，但转半圈就会把那点方向感整个
 * 抹掉，所以抖动幅度必须远小于 180°。
 */
const ELEMENT_JITTER_DEG = 25;

/** 度 → 弧度。 */
const DEG = Math.PI / 180;

/**
 * 32 位 FNV-1a → [0, 1)。
 *
 * 用途：从**快照里已有的稳定字段**派生「每个目标各不相同、但每台客户端完全一致」的小
 * 随机量（元素层抖动角、擦过的侧向正负）。
 *
 * 为什么不用 ctx.rng：那条流承担的是**选材**（`pick()` 的变体取一）。在这里多摇一次会让
 * 同一份快照后续所有 pick 的取数位置整体平移，全兵库既有计划的素材选择凭空改变——
 * resolver/context.mjs 为 freezeRandom 单开一条 rngAux 正是为了避免这件事。
 * 为什么也不用 ctx.rngAux：那条流按 cue 顺序取数，「第几条 cue」是个会随规则增删漂移的
 * 量；而这里要的是「这个目标的抖动」，用目标身份直接算出来更稳，也让守卫能在不跑 resolve
 * 的情况下复算同一个数。
 */
function hash01(str) {
  const v = String(str);
  let h = 0x811c9dc5;
  for (let i = 0; i < v.length; i++) {
    h ^= v.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0) / 4294967296;
}

/**
 * 攻击轴：施法者 → 目标。返回一个**越过目标、再走同样一段**的点，给 aim.towards 用。
 *
 * 为什么不是直接瞄目标本身：`at` 就是目标，瞄自己就是 §0.7 那 1164 条死 aim
 * （`Ray(p,p).angle = atan2(0,0) = 0`，play.mjs 会整条跳过 rotateTowards）。
 * 越过目标的那个点方位角与「施法者→目标」逐字相同（同一条射线上），而它到锚点的距离
 * 等于两者间距——贴身也有一格 100px，不可能再退化成同点。
 *
 * 施法者坐标缺失、或与目标几乎重合（自伤 / 自我增益）时返回 null：那时**没有**攻击轴
 * 可言，上表的 rotate 与 along/lateral 一律作废（纪律 4：没有方向就不许编一个）。
 * 阈值取 2px 而不是 0：play-contract 的「瞄准点与锚点重合时不调 rotateTowards」用的是
 * `d <= 1` 判退化，这里留一倍余量。
 */
function attackAxis(origin, t) {
  const ox = origin?.x, oy = origin?.y;
  if (!Number.isFinite(ox) || !Number.isFinite(oy)) return null;
  if (!Number.isFinite(t?.x) || !Number.isFinite(t?.y)) return null;
  const dx = t.x - ox, dy = t.y - oy;
  if (!(Math.hypot(dx, dy) > 2)) return null;
  return {towards: {x: r6(t.x + dx), y: r6(t.y + dy)}};
}

/**
 * 擦过往哪一侧偏（±1）。
 *
 * crucible 的结算里没有「擦哪边」这个量（attack-roll 只给 result 与 damage），所以这是
 * 一个**没有依据可查**的自由度。用目标身份 + 本次动作的种子派生：
 *   · 同一份快照在每台客户端上算出同一个值（seed 随 plan 一起广播）；
 *   · 同一次攻击的多个目标各偏各的，不会整齐划一地往同一边歪；
 *   · 同一个目标在不同的攻击里不同（seed 变了），不至于每次都往同一边擦。
 */
function sideOf(s, t) {
  return hash01(`${t?.tokenId ?? "?"}|${s?.seed ?? 0}|side`) < 0.5 ? -1 : 1;
}

/**
 * 元素层的确定性抖动角（度）。派生方式与 sideOf 同源同理由。
 * ⚠ 写进 `cue.angle` 之前要**取反**：`spriteContainer.rotation = -toRadians(cue.angle)`
 * （sequencer.js:16346），世界朝向是**减去** angle。见调用点。
 */
function elementJitter(s, t) {
  return r6((hash01(`${t?.tokenId ?? "?"}|${s?.seed ?? 0}|spin`) * 2 - 1) * ELEMENT_JITTER_DEG);
}

/**
 * 把裁定表里的四个位移量合成一条 `cue.offset`（格单位，配 `gridUnits: true`）。
 *
 * ## 为什么要做一次坐标换算
 *
 * `spriteOffset` 写的是 `sprite.position`，而 sprite 挂在
 *   rotationContainer（rotation = 瞄准角 + rotationOffset，sequencer.js:17070）
 *     └ spriteContainer（rotation = -toRadians(cue.angle)，sequencer.js:16346）
 * 之下。所以写在 cue 上的向量 v 落到世界里是 `R(瞄准角 + rotationOffset - angle) · v`
 * ——**两层**旋转，不是一层。要让位移真的落在**攻击轴**上（即 `R(瞄准角)` 方向），必须
 * 先把后两项反向转掉：`v = R(angle - rotationOffset) · (along, lateral)`。
 * 不换算的话，HIT 那句「沿攻击轴前移 0.1 格」会变成「朝攻击轴右下 47.86° 前移 0.1 格」
 * ——正是它自己的 rotationOffset 把它拐走的。
 *
 * selfX / selfY 本来就写在贴图自己的坐标系里（补的是素材构图偏心），不参与这次换算。
 *
 * 不转向时（`rotating` 为假）攻击轴坐标系根本不存在，along/lateral 一律丢弃：那时贴图
 * 没有被转到轴上，硬把偏移推出去只会得到一个「恒沿屏幕 +x」的错位——
 * test/geom-guard.test.mjs §1.5 守的就是这条。
 *
 * @param {object} g                RESULT_GEOM 的一行
 * @param {boolean} opts.rotating   这条 cue 到底会不会 rotateTowards
 * @param {number} opts.tw          目标格宽（格）
 * @param {number} opts.spriteSpan  这条 cue 渲染出来的身位（格）= objectScale × tw
 * @param {number} opts.side        擦过的侧向正负（±1）
 * @param {number} opts.angle       这条 cue 的 cue.angle（结果层恒 0）
 * @returns {{offset?: {x: number, y: number}, gridUnits?: boolean}} 直接展开进 cue；
 *          全零时返回空对象，让 cue 保持 CUE_DEFAULTS 的 `{x:0,y:0}` 与 `gridUnits:false`
 */
function impactOffset(g, {rotating, tw, spriteSpan, side = 1, angle = 0}) {
  const along = rotating ? (g.along ?? 0) * tw : 0;
  const lateral = rotating ? (g.lateral ?? 0) * side * tw : 0;
  const th = (angle - (rotating ? (g.rotationOffset ?? 0) : 0)) * DEG;
  const cos = Math.cos(th), sin = Math.sin(th);
  const x = r6(along * cos - lateral * sin + (g.selfX ?? 0) * spriteSpan);
  const y = r6(along * sin + lateral * cos + (g.selfY ?? 0) * spriteSpan);
  return (x || y) ? {offset: {x, y}, gridUnits: true} : {};
}

/**
 * `.missed()` 的翻案（施工清单 §0.7；同批推翻 DESIGN.md §3.2「未命中用 .missed()、
 * 不自行计算偏移」那条旧结论）。
 *
 * 从前 MISS 与 DODGE 两行写 `missed: true`，播放层据此调 `e.missed(true)`。
 * `_getOffset`（sequencer.js:15360）的判据是 `data.missed && (!source || !data.target)`，
 * 非拉伸的命中反馈没有 data.target，于是走 `calculate_missed_position` 的 `!target`
 * 分支（sequencer.js:17976-17985）——`twister.random() * 2π` 的**整圈随机**方向、
 * 1.5~2.5 个身位的随机距离。而那个 twister 的种子是 `creationTimestamp: Date.now()`
 * （25244），**逐客户端不同**。本模组的传输模型是「出手端广播一份 plan、各客户端本地
 * 播」，随机选材早已由 freezeRandom 在出手端固化，`.missed()` 是最后一个漏网的逐客户端
 * 随机项：同一次落空，每个玩家看到的偏移方向都不一样。
 *
 * 两条硬约束把它彻底堵死：
 *   1. DODGE 现在要转向（RESULT_GEOM），而 rotateTowards 会经 `EffectSection._target`
 *      （23184-23186）把 data.target 填上，`missed && !data.target` 于是恒假——偏移根本
 *      不会发生，只剩转向被打歪，画面读起来还是命中。test/play-contract.test.mjs 的
 *      「落空的非拉伸反馈不带 data.target」是一条常绿断言，这个组合当场转红。
 *   2. MISS 要补的那个位移是**构图居中**（RESULT_GEOM 的 selfY），不是「打偏了落在
 *      旁边」；整圈随机偏移会把那行字推到不可预期的地方。
 *
 * 所以 `impact.layered` 整条规则不再申报 missed，位移改由裁定表的确定性几何给出。
 * `generic.impact`（非攻击动作的兜底）仍保留 missed：那一支不转向、也没有构图补偿，
 * `.missed()` 在它身上是原设计的用法，且它服务的正是「没有攻击轴可言」的场景。
 */

/**
 * eskie.damage.* 共用同一套模板动作，自带白爆闪落在同一处：f5（167ms）整帧变纯白，
 * f6 半退，f7 起才是类型专属残留。逐支实测「低饱和(<25%)·高亮(luma>200)·不透明(alpha>150)」
 * 像素占比，峰值全部在 f5：fire 25.1% / cold 20.0% / electricity 24.8% / acid 21.7% /
 * poison 19.6% / radiant 28.4% / psychic 28.3% / necrotic 24.1%；f6 降到 4.3-22.7%，
 * f7 全部 ≤5.2%。29.97fps 下 f5=167ms、f7=234ms。
 *
 * 批次 D1 补测的物理三支同族同位：f5 峰值 slashing 21.1% / piercing 20.5% /
 * bludgeoning 24.2%，f6 降到 4.5/0.9/7.1%，f7 ≤1.6%——所以它们共用同一个 ESKIE_FLASH
 * 与同一个 startTime，不需要（也不许）单独编一套数。
 */
const ESKIE_FLASH = Object.freeze({from: 167, at: 167, to: 234});

/**
 * 元素层 = **残留层**：仅在 HIT_RESULTS（HIT/GLANCE）上叠加。12 键各有各的素材，
 * 物理三系从前共用一支血溅，批次 D1 已按施工清单 §0.15 拆开（见下面三行的说理）。
 * 路径取自 ASSET-NOTES 主表，每行备注都直接标了「伤害类型：X」。不经 {color} 动态
 * 染色——每条已经是该伤害类型下验证过时序/色相的具体叶子。
 *
 * scale 里只含画布归一化：eskie.damage.* 家族原生 800x800，是 jb2a 400x400 基准的
 * 2 倍（ASSET-NOTES 通用结论「同一个 .scale() 值在三家之间差 2-3 倍」），所以 eskie 系
 * 给 0.45、jb2a 系给 0.9（D1 之后 ELEMENT_LAYER 里只剩 void 一条走 jb2a）。语义权重与
 * 结果层共用 RESULT_WEIGHT，在 build() 里相乘。
 *
 * ⚠ 同上（见结果层 canvas 一段）：objectScale 走 scaleToObject，画布像素不参与定尺寸。
 * Task 12 逐条量了各支「内容占画幅比」（alpha>=25 的 bbox，按各自 startTime 之后的帧段）：
 * 800x800 的 eskie 系是 0.741-0.910，400x400 的 jb2a 系是 0.718-0.930——两家的填充率
 * 根本没有 2 倍关系。0.45/0.9 这个二分因此把 eskie 系整整砍半：实际观感尺寸
 * eskie 0.334-0.410 个格宽，jb2a 0.646-0.837 个格宽，与「把两家调到同一量级」的设计目标
 * 正好相反。修正方向是按内容占比逐条给（基线取 physical 那条），但会改动本槽全部元素层
 * 的尺寸，须由 impact 槽负责人连守卫一起过，本轮只记录不改。
 *
 * **这一层不许贡献爆闪。** 它存在的全部理由是回答「打中了什么属性」，而那条信息在自带
 * 白闪**之后**的残留段（翻滚火球 / 冰晶簇 / 蓝白电弧 / 腐蚀裂纹 / 粉紫触须）。f5 那一帧
 * 饱和度只有 1%、八支几乎逐像素重合（ASSET-NOTES acid 行实测：acid.green 对 poison.green
 * 唯一重合的就是 f5 那帧纯白），**一比特类型信息都不携带**；留着它就是 ASSET-NOTES 第 27
 * 行禁止的双闪——旧实现的 delay:60 把元素层自带的 f5 推到 227ms、结果层星芒在 133ms，两次
 * 白闪相距 94ms，且实测第二次比第一次亮 3.8 倍，等于结果层白出。所以用 startTime 把 f0-f6
 * 整段裁掉，通用切点 f7=234ms。
 *
 * 唯一例外 electricity：f7 正是 ASSET-NOTES 备注里那一帧「电弧层整帧消失、只剩一圈干净蓝环」
 * 的模板错位帧（原文「这一帧不能拿来当 startTime/endTime 的切点」），切点后挪一帧到 f8=267ms。
 *
 * fade：裁完只剩 233-266ms（30% 预算只有 70-80ms），绝不能背 CUE_DEFAULTS 的 200/300
 * （ASSET-NOTES fire 行坑二「再配 fadeOut/fadeIn 会把主体吃掉」）。f7 是一张已成形的满幅图，
 * 硬切入需要一点淡入遮丑，故 fadeIn:60；duration 补到素材自然收尾（501ms 全长）、残留段
 * 自己就衰减到 0，再叠 fadeOut 是二次衰减，故 fadeOut:0。
 */
export const ELEMENT_LAYER = {
  /**
   * ── 物理三系（施工清单 §0.15 / 批次 D1）────────────────────────────────────
   *
   * 【改了什么】三键从前一律指向 `jb2a.liquid.splash.red`（同素材、同 scale 0.9、同
   * fadeOut 300），实测本地基线 `画面/impact/element` 是 245 动作 / 10 素材 / 最大桶 82
   * ——那个 82 就是这三键叠出来的一支血溅，等于「66/92 件武器的命中层逐字相同」
   * （weapons.json 数：piercing 24 + bludgeoning 25 + slashing 17 = 66）。巨剑劈中与
   * 匕首刺中在这一层上一个像素都不差。现在换成 eskie 三支，一支桶拆成三支。
   *
   * 【为什么是 eskie.damage.{slashing,piercing,bludgeoning}.01.red】它们与已在用的八支
   * 元素层是**同一套模板动作**：ffprobe + 逐帧实测 800x800 / 15 帧 @29.97 / VP9+alpha，
   * 自带白爆闪的峰值帧同为 f5（「低饱和·高亮·不透明」像素占比 slashing 21.1% /
   * piercing 20.5% / bludgeoning 24.2%，与八支的 19.6-28.4% 同量级、同位置）。所以这三行
   * 必须**逐字照抄八支的那套参数**：flash: ESKIE_FLASH、startTime: 234（f7，把 f0-f6 连同
   * 白爆闪整段裁掉）、fadeIn: 60、fadeOut: 0、scale: 0.45。少写一个 startTime 就会立刻踩
   * ASSET-NOTES 第 27 行禁止的双闪——那不是风格问题，是同一次命中白闪两遍。
   *
   * 【duration 取 266 而不是 ASSET-NOTES 建议的 200】斩击的残留段确实最薄（f7-f14 的全帧
   * alpha 均值 35.6/18.6/9.2/4.7/2.4/1.1/0.6/0.1，f5 峰值 66.1），但把 duration 收到 200
   * 会在 f12 处**硬切**一条还没自然结束的素材，而本仓库的 fade 守卫对硬切有两条互相打架的
   * 要求：`test/armory-impact.test.mjs` 一边要求「被 duration 截断的 cue 必须有 fadeOut」，
   * 一边把 fade 预算压在有效时长的 30%（200ms × 0.30 = 60ms，已经被 fadeIn: 60 占满，
   * fadeOut 再要一毫秒都超）。两害相权：f12-f14 的残留只有峰值的 1.7%/0.9%/0.2%，播完与
   * 切掉在屏幕上分不出来，而硬切没有收尾是看得见的。所以三支一律播到素材自然收尾。
   *
   * 【三支靠形状分，不靠颜色——这条必须显式登记】读图（各自 f8 残留帧、0x303030 底，
   * ASSET-NOTES 主表 225-227 行）：斩击是**一道长斜划线**横穿柔红光晕、笔画最少最细；
   * 穿刺是**一圈朝外的短箭状尖刺**围成环、环心几笔朝内收的碎针；钝击是**一团四芒星火花
   * 绕成螺旋**、笔画最粗最亮。三支同为 red 是有意的（物理伤害共用血色语义），代价是
   * 残留主色的 CIEDE2000 实测只有 4.0（斩/刺）、5.3（刺/钝）、9.0（斩/钝），全部落在
   * `test/armory-element-distinct.test.mjs` 的 MIN_DELTA_E = 11.5 之下。所以那条守卫对
   * 这三键**改用形状判据**（alpha 掩膜 IoU + 径向质量分布 L1），并保留一条正向断言「三键
   * 必须解析到三条不同素材」——既不默认继承颜色阈值，也不是一条什么都不拦的豁免。
   * 三支对九种元素的 ΔE00 最小值是 30.6（钝击/psychic），跨组仍然由颜色管着。
   */
  bludgeoning: {path: "eskie.damage.bludgeoning.01.red", scale: 0.45, flash: ESKIE_FLASH,
                startTime: 234, duration: 266, fadeIn: 60, fadeOut: 0},
  piercing:    {path: "eskie.damage.piercing.01.red", scale: 0.45, flash: ESKIE_FLASH,
                startTime: 234, duration: 266, fadeIn: 60, fadeOut: 0},
  slashing:    {path: "eskie.damage.slashing.01.red", scale: 0.45, flash: ESKIE_FLASH,
                startTime: 234, duration: 266, fadeIn: 60, fadeOut: 0},
  fire:        {path: "eskie.damage.fire.01.orange", scale: 0.45, flash: ESKIE_FLASH,
                startTime: 234, duration: 266, fadeIn: 60, fadeOut: 0},
  cold:        {path: "eskie.damage.cold.01.blue", scale: 0.45, flash: ESKIE_FLASH,
                startTime: 234, duration: 266, fadeIn: 60, fadeOut: 0},
  // f7 是电弧层单帧消失的模板错位帧（ASSET-NOTES 明令不可作切点），切点后挪一帧到 f8。
  electricity: {path: "eskie.damage.electricity.01.blue", scale: 0.45, flash: ESKIE_FLASH,
                startTime: 267, duration: 233, fadeIn: 60, fadeOut: 0},
  acid:        {path: "eskie.damage.acid.01.green", scale: 0.45, flash: ESKIE_FLASH,
                startTime: 234, duration: 266, fadeIn: 60, fadeOut: 0},
  /**
   * poison 走同支 purple 而不是 green。ASSET-NOTES 的 acid 行给的是一条针对本组合的
   * 直接指令——「0.5 秒里两者的观感差别基本只剩色相，同场景同时出酸伤和毒伤必须靠颜色
   * 拉开（酸用 green/teal、毒用 yellow/purple）」——四种排列里只有 acid=green +
   * poison=purple 真的成立。残留段（本轮裁剪后实际播出的 f7-f14）alpha 加权主色转
   * CIELAB 后的 CIEDE2000 实测（tools/element-residual-colour.mjs）：
   *   acid.green    / poison.green    9.7  ← 改之前，eskie.damage 八支两两之间最小的一对
   *   acid.teal     / necrotic.teal   7.9  ← 「酸改 teal」会撞 corruption，比原问题更糟
   *   poison.yellow / radiant.yellow  6.9  ← 「毒改 yellow」会撞 radiant，等于平移问题
   *   acid.green    / poison.purple 102.8  ← 唯一真正拉开的一种
   * teal 与 yellow 之所以是死路：corruption 借用的 necrotic 只有 black/teal 两支、black
   * 在否决清单里，radiant 只有 yellow/rainbow 两支、rainbow 是彩虹渐变做不了单色区分
   * ——这两支都锁死了，让不出坑位。
   * 代价（已写进 ASSET-NOTES 新增行）：purple 是 green 的纯换色，时序逐帧不变，但残留
   * 主色 Lab 亮度从 94.8 掉到 48.7，暗底上暗一档；仍远在 necrotic.black 那条「深色战场
   * 上完全看不见」的否决线之上。顺带解掉 green 行自己那条坑一「压在绿色 token 或草地上
   * 会糊成一片」。
   */
  poison:      {path: "eskie.damage.poison.01.purple", scale: 0.45, flash: ESKIE_FLASH,
                startTime: 234, duration: 266, fadeIn: 60, fadeOut: 0},
  radiant:     {path: "eskie.damage.radiant.01.yellow", scale: 0.45, flash: ESKIE_FLASH,
                startTime: 234, duration: 266, fadeIn: 60, fadeOut: 0},
  // 顺带修掉 ASSET-NOTES psychic 行记的「前 8 帧基本把 token 脸盖住」：裁掉 f0-f6 之后
  // 遮挡最重的那几帧根本不播了。（该行原本把「盖脸」记成 psychic 专属坑，本轮实测其实是
  // 整个 eskie.damage 模板的家族属性，psychic 在八支里只排倒数第三，见 ASSET-NOTES 订正。）
  psychic:     {path: "eskie.damage.psychic.01.pink", scale: 0.45, flash: ESKIE_FLASH,
                startTime: 234, duration: 266, fadeIn: 60, fadeOut: 0},
  corruption:  {path: "eskie.damage.necrotic.01.teal", scale: 0.45, flash: ESKIE_FLASH,
                startTime: 234, duration: 266, fadeIn: 60, fadeOut: 0},
  /**
   * void — 从 jb2a.impact.011.dark_purple 换到 012（ASSET-NOTES 主表里点名的「无起手闪
   * 版」）。换的理由要说准：**011 这一支根本不出白光**（33 帧「低饱和·高亮·不透明」像素
   * 占比恒为 0.00%，alpha 加权 RGB 是纯紫），它与结果层的冲突是「两次爆发」与「黑芯挖洞」，
   * 不是「两次白闪」；而且换 012 也治不了黑芯（012 的 f1-f5 同样是一团实心黑加一圈细紫边）。
   * 黑芯靠 zIndex（元素层画到结果层之下）＋ delay（错开时序）解决，见 build()。
   * 换 012 的真正收益是**失效保护**：ASSET-NOTES 标它「自带闪爆＝否」（归一出光量峰只有
   * 1.9 对 011 的 4.2，f0 是个小暗环而不是大紫星），万一以后有人把时序改回去，炸出来的也
   * 只是个小暗环。两支从 f7 起逐帧 alpha 均值绝对差 ≤2.2，画面上没有区别。
   * duration:533 砍到 f16（alpha 均值 2.8，本体已尽），顺带切掉 f23-f31 那三下孤立亮弧
   * （f24/f26/f29 实测 alpha 均值 20.8/19.8/5.7，现状会在命中后 800/867/967ms 再闪三次，
   * 被读成「打了好几下」）。被硬切所以必须自己收尾，fadeOut:67 从 466ms=f14 起，骑在
   * 7.1→6.7→2.8 的自然衰减上；f0 只有 6.1 是天然的起手渐强，故 fadeIn:0。
   */
  void:        {path: "jb2a.impact.012.dark_purple", scale: 0.9, flash: null,
                duration: 533, fadeIn: 0, fadeOut: 67}
};

/**
 * 治疗汇聚层（施工清单 §0.8 / 批次 D2）。**刻意不叫 ELEMENT_LAYER.restoration**：
 * `test/source-tables.test.mjs:220` 断言 `Object.keys(ELEMENT_LAYER)` 逐项等于 crucible
 * `const/attributes.mjs` 的 DAMAGE_TYPES（原话「多一个键是死代码」），而 restoration 不是
 * 伤害类型，塞进去会把那条「表与系统同步」的守卫拆掉。所以另起一张表。
 *
 * ## 它补的是哪一半
 *
 * `isBenign()`（下面）已经做了「不出错的那一半」——治疗不再在被治疗者身上炸血溅。但那之后
 * impact 槽剩下的只有结果层那记白爆闪（jb2a.impact.005.white，一团命中火光），打在被治疗者
 * 身上仍然读作「他挨了一下」。本表补的是「他被治好了」这半句：真的发生了治疗时，**结果层
 * 让位、由本层出场**（§0.8 原话「跳过结果层与元素层，换一条治疗专用汇聚层」）。
 *
 * ## 按 usage.resource 分键，而不是按符文
 *
 * crucible 的 restoration 打两种资源：life 符文回 health、soul 符文回 morale
 * （`const/spellcraft.mjs`；快照的 `usage.resource` 就是这个值，trigger/snapshot.mjs 按它
 * 过滤 `ev.resources`）。两者语义不同——一个是治伤，一个是安抚士气——所以分键。
 * ⚠ **morale 这一键现在是空的**，不是漏写：选材阶段只登记了 `eskie.buff.one_shot.health.green`
 * 这一支（四枚医疗十字自下升起），把医疗十字扣到「士气恢复」上是错配；而错配比走兜底更糟
 * （本轮硬约束第 5 条）。查不到键 → `restorationFor()` 返回 null → 结果层照原样出，
 * 与 D2 之前的行为逐字相同。要补 morale 得先走一遍选材/读图流程再往这张表里加一行。
 *
 * ## 参数依据（全部实测，data/asset-profiles.json + 逐帧 alpha 剖面）
 *
 * `eskie.buff.one_shot.health.green`：600x600 / 45 帧 @29.97 = 1502ms / VP9+alpha /
 * 空头 2 / 空尾 10 / 峰值帧 f12 / 闪爆比 2.04（**不自带爆闪**，所以 flash: null，
 * 也因此不参与双闪抑制那套逻辑）。逐帧全帧 alpha 均值 f0-f1 = 0.0（真空帧）、f2 起
 * 1.4→12.7 缓升到 f12、f34 只剩 1.0、f35 之后 45 帧到底恒 0。
 *   · startTime 67 = f2：跳过两帧真空，让「被治好」这件事和结算同时发生，不是晚 67ms。
 *   · duration 1101 = f2-f34 共 33 帧：正好停在素材自己烧完的地方，不多播那 10 帧空尾
 *     （空尾会把 cue 的墙钟时长白拖 334ms，后面的槽跟着等）。
 *   · fadeIn 0：f2-f12 本身就是一段 1.4→12.7 的自然渐强，再叠淡入是对同一件事做两遍
 *     （与结果层通用判据 1 同源）。
 *   · fadeOut 100（三帧，起点 f31 附近，那时 alpha 只剩 3.8→1.0）：duration 停在自然
 *     收尾**之前一点**，纯粹是防硬切的保险。
 *   · scale 0.60：画幅 600x600 夹在 jb2a 的 400（系数 0.9）与 eskie.damage 的 800
 *     （系数 0.45）之间，按同一把画布归一化尺子折算就是 0.60——**不能照抄元素层的 0.45**。
 *   · 不转向、不偏移：ASSET-NOTES 对同族 one_shot 的实测结论是「粒子自下而上升」，
 *     有明确的「上」方向，「绝不能 rotate 或上下镜像，翻了读作减益」。纪律 4：没有
 *     依据支持转的，一律不转。
 *
 * 与 `aftermath.healing`（jb2a.healing_generic.400px.green，绿光球 + 十字星花簇）同屏
 * 不重复：一个是 impact 槽的即时汇聚、一个是 S4 余波的持续辉光，选材阶段已按「画面不同」
 * 逐帧核过。
 */
export const RESTORATION_LAYER = {
  health: {path: "eskie.buff.one_shot.health.green", scale: 0.60, flash: null,
           startTime: 67, duration: 1101, fadeIn: 0, fadeOut: 100}
};

/**
 * 伤害「类别」→ 代表性伤害类型的别名表。
 *
 * crucible 的符文伤害类型字段并不局限于 DAMAGE_TYPES 的 12 个键：
 * models/spellcraft-rune.mjs 的 schema 写的是
 * `choices: ["physical"].concat(Object.keys(SYSTEM.DAMAGE_TYPES))`，而 const/spellcraft.mjs
 * 里 kinesis 符文的 damageType 取的正是这个额外值 "physical"——它是 DAMAGE_CATEGORIES 的
 * 顶层**类别**（physical/elemental/spiritual），不是类型。
 *
 * 语义：动力符文的伤害由施法者在三种物理伤害里现选。dice/spell-cast-dialog.mjs 的
 * `chooseDamageType: spell.rune.damageType === "physical"` 只在这一种情况下开出选择框，
 * 候选恰好是 {bludgeoning, piercing, slashing} 三项——**不含 poison**，尽管 attributes.mjs
 * 里 poison 的 type 同样是 physical，可见这里的 physical 指的是三种武器物理伤害而不是那个
 * 四成员的类别。
 *
 * 但走对话框只是其中一条路径：models/spell-action.mjs 的 #prepareDamage 是
 * `type: this.damageType ?? this.rune.damageType`，而动作自身的 damageType 字段
 * `initial: undefined`——宏调用、dialog:false、敌方自动化这些不开对话框的用法会把
 * "physical" 原样写进 damage.type，一路经 resolveDamage → event.resources[].damageType
 * 落进 trigger/snapshot.mjs 的 target.damage.type。系统自己也不纠正它
 * （actor.getResistance 走 `this.resistances["physical"]?.total ?? 0`，静默取 0）。
 * 所以这是真实可达的取值，不是假想输入。
 *
 * 落到 bludgeoning：它是对话框候选列表的第一项，也是 item-weapon.mjs damageType 字段的
 * initial 值——「没选就是它」这件事在 crucible 自己那边已经这么定了。
 * ⚠ 批次 D1 之前这里还有第二条理由「三种物理伤害共用同一条血溅、落到哪一个视觉完全等价」，
 * 现在**不成立了**：三键各有各的素材（斩=斜划线 / 刺=尖刺环 / 钝=火花螺旋）。也就是说
 * 走这条别名的 kinesis 法术会稳定显示成钝击。这是**兜底而不是错配**——动力符文的伤害本来
 * 就由施法者现选，快照里没有那次选择的痕迹（见上一段），编一个反而更糟；真要修得从
 * models/spell-action.mjs 那条 `damageType ?? rune.damageType` 的上游把选择带进快照。
 *
 * 登记成别名而不是让兜底吞掉，是为了让下面那条 warn 保持信噪比：不登记的话
 * spell.kinesis.* 全系每次都报降级，test/coverage.test.mjs 的「warnings 恒为空」
 * 会逼人去关告警而不是修问题。
 */
export const DAMAGE_ALIAS = Object.freeze({physical: "bludgeoning"});

/**
 * 元素层选取：按「这一级的取值能不能在 ELEMENT_LAYER 里查到」逐级回退，
 * 而不是按「这一级的取值是不是空」逐级回退。
 *
 * 从前写的是 `t.damage?.type ?? s.usage.damageType ?? "bludgeoning"`，再对结果做
 * `ELEMENT_LAYER[x] ?? ELEMENT_LAYER.bludgeoning`。`??` 只判空，于是一个查不到元素的
 * 非空 target.damage.type（"physical" 就是现成的例子）会把后面那级**有效**的
 * s.usage.damageType 整个遮蔽掉，直接掉进血溅兜底，且不留任何痕迹。
 *
 * 三级候选的顺序与 crucible 自己的取值顺序同构——documents/actor.mjs 的 strikeWeapon 走的是
 * `options.damageType || action.usage.damageType || weapon.system.damageType`：
 *   1. t.damage?.type            结算后写回目标身上的实际类型（snapshot.mjs 取量最大的一条）
 *   2. s.usage.damageType        动作层面的固定伤害类型（TAGS[<damageType>].initialize 写的那个）
 *   3. s.strikes?.[0]?.damageType 主手武器的伤害类型；快照在结算前生成、或该动作压根没产生
 *      伤害事件时，这是最后一份真实信息（双持时取主手，与 snapshot.mjs「量最大的一条」在
 *      结算后会被第 1 级覆盖，不冲突）
 * 三级都拿不到 → bludgeoning 血溅兜底（不是错误，纯粹是这个动作没有伤害类型可言）。
 *
 * 非空但查不到的取值必须留痕：这类值意味着「crucible 出现了 ELEMENT_LAYER 没覆盖的
 * 伤害类型/类别」，静默退回血溅会让 kinesis 系法术这种整整一支符文的元素层长期缺席而
 * 无人察觉。test/coverage.test.mjs 的「plan.warnings 恒为空」在全量语料上守着这条。
 *
 * 保持纯函数（warn 留在调用点）：覆盖率断言与将来的调试面板都要能在不跑 resolve 的
 * 情况下问「这次该出什么元素」。
 *
 * @param {object} s  ActionSnapshot
 * @param {object} t  目标快照
 * @returns {{key: string, spec: object, unknown: string[]}}
 */
export function elementFor(s, t) {
  const chain = [t?.damage?.type, s?.usage?.damageType, s?.strikes?.[0]?.damageType];
  const unknown = [];
  let key = null;
  for (const raw of chain) {
    if (!raw) continue;                                   // 这一级没有信息，静默下探
    const candidate = DAMAGE_ALIAS[raw] ?? raw;
    if (ELEMENT_LAYER[candidate]) { key = candidate; break; }
    unknown.push(raw);                                    // 非空却查不到，记下来再下探
  }
  key ??= "bludgeoning";
  return {key, spec: ELEMENT_LAYER[key], unknown};
}

/**
 * 这一下该不该在目标身上炸血溅（施工清单 §0.8 / §0.9）。
 *
 * ## 病灶
 *
 * 元素层的闸门从前只有 `if (isHitLike)`——只问「打中没有」，不问「有没有造成伤害」。
 * 而 `elementFor()` 的三级取值链全空时兜底到 `bludgeoning`，也就是
 * `jb2a.liquid.splash.red`。于是：
 *   · life / soul 符文（两者的 rune 表里都写着 `restoration: true`）在**被治疗者**身上
 *     炸一团血；
 *   · 带 harmless / healing / rallying 标签的动作同样（其它动作块实测 28 条）。
 * 这是实机一眼可见的错，不是观感取舍。
 *
 * ## 判据只用快照上真实存在的字段
 *
 * 1. `tags` 含 harmless —— crucible `const/action.mjs:1113-1125` 的 harmless 标签在
 *    postActivate 里把 `damage.base = damage.total = 0` 并置 `damage.harmless = true`，
 *    而 `dice/attack-roll.mjs:104-106` 的 `hasDamage` 是
 *    `(result >= GLANCE) && !damage.harmless`——harmless 时恒假。**结算上就没有伤害**。
 * 2. `tags` 含 healing / rallying —— 同文件 :1202 与 :1215 两个标签的 prepare() 都写
 *    `this.usage.restoration = true`（一个走 health、一个走 morale）。快照带的是 tags
 *    原样（trigger/snapshot.mjs:236 `tags: [...(action.tags ?? [])]`），restoration 这个
 *    派生字段没进快照，所以判 tags 而不是判 restoration——**不猜快照上没有的字段**。
 * 3. `t.healed > 0` 且这一路没造成伤害 —— trigger/snapshot.mjs:207-213 是
 *    `if (r.delta < 0) {…damage…} else if (r.delta > 0) healed += r.delta`，两者互斥累加。
 *    这一条覆盖「符文本身是 restoration、但动作没打任何标签」的整条 life/soul 支路。
 *
 * ⚠ 为什么不直接判 `spell.rune === "life" | "soul"`：那是**静态**判据，会在结算之前就
 * 把整支符文的元素层关掉；而 crucible 允许 inflection 改写伤害/治疗
 * （`models/action.mjs:2061` 的 `restoration = !!(damage.restoration ?? this.damage.restoration)`）。
 * 第 3 条判的是**结算之后真的发生了什么**，够用且不会误伤。
 *
 * ⚠ 语料盲区（如实记账）：`test/fixtures/actions.json` 里 642 个 healed 字段取值全是 0
 * （dump-fixtures 的注释自陈这条路径跑不到），所以第 3 条在主语料上一条都不命中。
 * 它由批次 A 新增的 `test/fixtures/edge-cases.json` 行使——那份语料里
 * `edge.heal.{life,soul}.*` 共 34 条带 `healed: 8 / damage: null`。守卫见
 * test/impact-harmless.test.mjs。
 *
 * ## 不在本函数职责内的部分
 *
 * 治疗命中音（`ggg-sfx.magic.divine.healing` 一路）归 armory/sounds.mjs，不在本文件。
 * 「治疗该出什么画面」已由批次 D2 补上，见下面的 `restorationFor()` 与 RESTORATION_LAYER：
 * 真的治到人时结果层让位、换治疗汇聚层；只带 harmless 标签、没治到任何人的那一半（反制、
 * 擒抱、脏招…）仍然只出结果层白闪——它表达的是「这一下结算成功了」，与伤害属性无关。
 *
 * @param {object} s  ActionSnapshot
 * @param {object} t  目标快照
 * @returns {boolean} 真 = 这一下不该有元素层（血溅 / 元素残留）
 */
export function isBenign(s, t) {
  const tags = s?.tags ?? [];
  if (tags.includes("harmless") || tags.includes("healing") || tags.includes("rallying")) return true;
  return (t?.healed > 0) && !(t?.damage?.total > 0);
}

/**
 * 这一下要不要出治疗汇聚层（施工清单 §0.8 / 批次 D2）。
 *
 * ## 判据只用快照上真实存在的字段，且只判「结算之后真的发生了什么」
 *
 * 1. `t.healed > 0` —— trigger/snapshot.mjs:207-213 按 `r.delta` 的符号把同一目标的资源
 *    增量拆成 damage / healed 两个累加器，healed 是「这次真的回了多少」，不是意图。
 * 2. `!(t.damage?.total > 0)` —— 又治又打（吸血、反伤一类）时这一下**确实打了人**，
 *    该走正常的结果层 + 元素层；只有纯治疗才换层。与 `isBenign()` 的第 3 条同源同写法，
 *    两处必须一致，否则会出现「元素层关了、治疗层也没出」的空档。
 * 3. `s.usage.resource` —— 决定用哪一行。这个字段快照里恒有（health / morale，
 *    实测主语料 366/68、edge 语料 76/24），不是猜的派生字段。
 *
 * ⚠ 不判 `spell.rune === "life" | "soul"`：那是**静态**判据，会在结算之前就替整支符文下
 * 结论，而 crucible 允许 inflection 改写伤害/治疗（models/action.mjs:2061）。
 * ⚠ 也不判 tags 里的 healing/rallying：带那两个标签的动作**不一定真的治到了人**（打空、
 * 目标满血），而本层出的是「他被治好了」这句具体的话。tags 那一支归 isBenign 管——
 * 它只负责「别喷血」，判得宽一点没有代价。
 *
 * 查不到对应资源的行（现在就是 morale）时返回 null：调用点据此**保持结果层原样**，
 * 而不是编一个画面。兜底 > 错配。
 *
 * @param {object} s  ActionSnapshot
 * @param {object} t  目标快照
 * @returns {{key: string, spec: object}|null} null = 这一下不走治疗层
 */
export function restorationFor(s, t) {
  if (!(t?.healed > 0) || (t?.damage?.total > 0)) return null;
  const key = s?.usage?.resource;
  const spec = key ? RESTORATION_LAYER[key] : null;
  return spec ? {key, spec} : null;
}

/**
 * 把 `restorationFor()` 的裁定变成一条 cue。两条规则共用：`impact.layered`（攻击型治疗，
 * life/soul 那 26 条）与 `generic.impact`（**非攻击**型治疗——复活、医疗合剂、
 * `edge.heal.action.{healing,harmless}` 那一支 `usage.isAttack !== true`，一样会在
 * 被治疗者身上炸命中火光）。两处同源，改一次两处一起对。
 *
 * 返回 null 有两种情况，调用点都按「结果层照原样出」处理：
 *   · 这一下压根不是治疗（restorationFor 说了不算数）；
 *   · 素材解析不出来（用户没装 eskie-effects）——那时必须把结果层还回来，否则这一下在
 *     画面上彻底消失。
 *
 * @param {object} s        ActionSnapshot
 * @param {object} t        目标快照
 * @param {object} ctx      resolver 上下文（要 pick 与 geom）
 * @param {number} weight   语义权重（与结果层共用 RESULT_WEIGHT）
 * @param {object} at       锚点（本槽恒为目标）
 * @param {string} playIf   与同槽其它 cue 一致的播放条件
 */
function restorationCue(s, t, ctx, {weight, at, playIf}) {
  const rest = restorationFor(s, t);
  if (!rest) return null;
  const fx = ctx.pick(rest.spec.path);
  if (!fx) return null;
  const el = rest.spec;
  const start = el.startTime ?? 0;
  const dur = el.duration ?? null;
  return {
    // layer 用 "restoration"：与 result / element 并列的第三种命中层。resource 字段的用途
    // 同元素层的 element 字段——覆盖率与守卫要问「选中了哪一行」，不能靠猜 file。
    layer: "restoration", resource: rest.key, file: fx.file,
    playIf, at, forTarget: t.tokenId,
    // 不转向、不偏移：粒子自下而上升，方向是烧死在素材里的（见 RESTORATION_LAYER 注释
    // 末段）。这里连 aim 都不申报，让 CUE_DEFAULTS 的 aim:null 生效。
    aim: null,
    objectScale: r6(el.scale * weight * ctx.geom.sizeScale()),
    // zIndex 60 = 结果层的位置：它现在就是这一下的主层。
    zIndex: 60, elevation: t.elevation,
    startTime: start, duration: dur,
    fadeIn: el.fadeIn, fadeOut: el.fadeOut,
    selfFlash: trimFlash(el.flash, {startTime: start, duration: dur})
  };
}

export default [
  /**
   * 结果层 + 元素层叠加，一条主规则返回 Cue[]，避免两层在槽内争抢 pri
   * （见 task-11-brief.md「为什么是一条主规则而不是 8 条」）。
   *
   * 声明 once:true 但内部自己遍历 s.targets——不是把「每动作一份」的语义套在
   * 逐目标的命中反馈上，而是刻意换取两样东西：
   *   1. 暴击震屏只能有一份：resolve.mjs 的 once 分支把 build() 只调一次，
   *      本规则据此把「找不找得到该震的目标」这件事收在一次 build 里自己判断，
   *      从根源上杜绝「多目标暴击各来一次 shake、叠加成灾难」（非 once 时每个
   *      目标各调一次 build，谁都不知道别的目标是否也在震，没有天然的去重点）。
   *   2. coveringFlash 的正确性不受影响：resolve.mjs 对同一个 slot 只选一条规则
   *      （槽内只取第一个命中者），travel 槽同理，一次动作里所有目标的 travel
   *      cue 都出自同一条被选中的 travel 规则——selfFlash 是规则/素材的属性，
   *      不是逐目标变化的量，因此用 built（对应 targets[0] 的前序槽视图）判定
   *      「travel 有没有在目标身上自带闪爆」，对本动作的其余目标同样成立。
   * s.targets 为空（零目标攻击）时循环体不产出任何东西，返回 null，与非 once
   * 写法下「每个目标各调一次」在零目标时同样不产出的效果一致。
   */
  {
    id: "impact.layered", pri: 500, once: true,
    when: s => s.usage?.isAttack === true,
    build: (s, ctx, _rep, built) => {
      const cues = [];
      let shakeAt = null;
      const unknownTypes = new Set();   // 查不到元素的伤害类型，每动作只报一次

      for (const t of s.targets ?? []) {
        const hit = t.results?.[0] ?? {result: RESULT.HIT, critical: false};
        const spec = RESULT_LAYER[hit.result] ?? RESULT_LAYER[RESULT.HIT];
        const name = RESULT_NAME[hit.result] ?? "always";
        const isHitLike = HIT_RESULTS.includes(hit.result);
        const at = {ref: "target", tokenId: t.tokenId, uuid: t.uuid, x: t.x, y: t.y};
        // 语义权重：结果层与元素层共用同一个数，各自再乘自己素材的画布系数。
        const weight = weightOf(hit.result);
        // 【几何】这四行取代了从前那句写死的
        //   aim: {towards: 目标本身, missed: spec.missed}
        // ——at 与 aim 同点、rotates() 恒 false 的 §0.7 死 aim。轴由 attackAxis() 给，
        // 转不转 / 挪多少由 RESULT_GEOM 逐结果裁定，两者都在本文件上方连依据一起写着。
        const axis = attackAxis(s.origin, t);
        const geom = RESULT_GEOM[hit.result] ?? RESULT_GEOM[RESULT.HIT];
        const rotating = geom.rotate === true && !!axis;
        const tw = t.width ?? 1;
        // 这一下该不该出血：治疗与 harmless 类动作走这条闸，见 isBenign()。
        const benign = isBenign(s, t);
        // 结果层这一段实际播出来的自带闪爆窗口。元素层的交棒时机直接由它派生，不再写死
        // 一个 delay 常量——「元素层必须等结果层闪完」这句话因此有了唯一出处。
        const resultFlash = trimFlash(spec.flash,
          {startTime: spec.startTime ?? 0, duration: spec.duration ?? null});

        // 治疗汇聚层（§0.8）：结果层那记命中火光在被治疗者身上读作「他挨了一下」，所以由
        // 本层**取代**它而不是叠在它上面——两层同时出就是自相矛盾的一句话。元素层在下面
        // 由 isBenign 关掉（治疗没有伤害属性可言）。
        // 用「产出了没有」而不是「该不该产出」去决定结果层让不让位，理由见 restorationCue()。
        const restCue = restorationCue(s, t, ctx, {weight, at, playIf: name});
        const restored = !!restCue;
        if (restCue) cues.push(restCue);

        // 双闪抑制：travel 已经在这个锚点上自带过一次命中闪爆（selfFlash.anchor
        // === "target"，见 armory/flash.mjs），结果层这条通用「结果」闪光让位——
        // 它和 travel 的自带闪爆表达的是同一件事（打中了）。元素层不让位：它已经
        // 被 startTime 裁成不带闪爆的纯残留层，携带的是「打中了什么属性」这条新信息。
        // `!restored`：真的治到人时结果层由治疗汇聚层顶替（§0.8），不再出这一记白闪。
        if (!restored && !(isHitLike && coveringFlash(built, "target"))) {
          const base = ctx.pick(spec.path);
          if (base) {
            // 先算尺寸再算偏移：RESULT_GEOM 的 selfX/selfY 是「贴图自己身位的百分之几」，
            // 分母正是这个 objectScale（scaleToObject 让贴图宽 = 目标宽 × objectScale）。
            const objectScale = r6(weight * spec.canvas * ctx.geom.sizeScale());
            cues.push({
              layer: "result", file: base.file, playIf: name, at, forTarget: t.tokenId,
              // 只有裁定表说「转」且真的存在攻击轴时才申报 aim；其余结果一个字段都不写，
              // 让 CUE_DEFAULTS 的 aim:null 生效（§0.7：删掉死字段，别补一个假的）。
              aim: rotating
                ? {towards: axis.towards, rotationOffset: geom.rotationOffset ?? 0, missed: false}
                : null,
              ...impactOffset(geom, {rotating, tw, spriteSpan: objectScale * tw,
                                     side: sideOf(s, t)}),
              objectScale,
              zIndex: 60, elevation: t.elevation,
              startTime: spec.startTime ?? 0,
              duration: spec.duration ?? null,
              playbackRate: spec.rate ?? 1,
              // 不写 `?? CUE_DEFAULTS`：表里漏填时宁可让 fadeIn 变成 undefined 被
              // test/armory-impact.test.mjs 的 Number.isFinite 断言当场抓住，也不要
              // 静默退回那个对本槽有害的 200/300。
              fadeIn: spec.fadeIn, fadeOut: spec.fadeOut,
              selfFlash: resultFlash
            });
          }
        }

        // 暴击震屏：与结果层 cue 是否被双闪抑制无关——震的是「暴击命中」这件事本身，
        // 不是某条装饰性素材有没有播出来。只记第一个满足条件的目标，实现「每动作
        // 一次」。
        // `!restored` 是例外：一次暴击治疗不是「暴击命中」，把被治疗者的贴图抖一下读作
        // 挨了重击，与 §0.8 要修的是同一类错。震屏跟着结果层走，结果层让位它也让位。
        if (spec.shake && hit.critical && !shakeAt && !restored) shakeAt = {at, forTarget: t.tokenId};

        // 元素层 = 残留层，回答「打中了什么属性」。良性动作（治疗 / harmless）整层不出：
        // 它没有属性可言，而兜底键是血溅——在被治疗者身上炸一团血是实机一眼可见的错
        // （施工清单 §0.8 / §0.9）。结果层的白闪照出，那一层表达的是「这一下结算成功了」。
        if (isHitLike && !benign) {
          // 伤害类型的三级回退与「查不到就留痕」都在 elementFor 里，见其注释。
          const {key, spec: el, unknown} = elementFor(s, t);
          for (const u of unknown) unknownTypes.add(`${JSON.stringify(u)} → "${key}"`);
          const fx = ctx.pick(el.path);
          if (fx) {
            const start = el.startTime ?? 0;
            const dur = el.duration ?? null;
            // 元素层的朝向 = 攻击轴 + 确定性抖动。轴走 aim（真的跟着目标转），抖动走
            // cue.angle。⚠ 取反：spriteContainer.rotation = -toRadians(cue.angle)
            // （sequencer.js:16346），世界朝向是**减去** angle，所以要 +jitter 就得写 -jitter。
            // 抖动放在 angle 而不是 rotationOffset，是因为这样它仍然走播放层
            // `if (cue.angle) e.rotate(cue.angle)` 那条通路——freezeRandom 固化下来的角度
            // 到底有没有被下发，全仓库只有这一处在行使，挪走会让那条契约变成空转。
            const jitter = elementJitter(s, t);
            cues.push({
              // element 字段是这条 cue 选中的 ELEMENT_LAYER 键。批次 D1 之前物理三键共用
              // 同一条血溅、光看 file 分不出走了哪一支，这个字段是 test/coverage.test.mjs
              // 12 键覆盖断言唯一的量法；拆开之后 file 也能分了，但字段留着——覆盖率问的是
              // 「选中了哪个键」，不该依赖「两个键碰巧没撞素材」这个偶然事实。
              layer: "element", element: key, file: fx.file, playIf: name, at,
              forTarget: t.tokenId,
              // 元素层恒转（残留有弱方向性，见 ELEMENT_JITTER_DEG 注释），没有攻击轴时
              // 只剩抖动——那是「不知道往哪」时最保守的表现，不是编一个方向。
              aim: axis ? {towards: axis.towards, rotationOffset: 0, missed: false} : null,
              angle: r6(-jitter),
              objectScale: r6(el.scale * weight * ctx.geom.sizeScale()),
              // delay：落在结果层自带闪爆熄灭之后（HIT→200ms，GLANCE→233ms）。旧值是
              // 写死的 60ms，恰好把元素层自带的 f5 白闪推到 227ms、结果层星芒在 133ms，
              // 两次白闪相距 94ms——正是 ASSET-NOTES 第 27 行禁止的双闪。结果层被
              // travel 抑制时仍按同一个数交棒：travel 的自带闪爆同样落在这个锚点上，
              // 让元素层晚入场只会更安全。
              // zIndex 55（低于结果层 60）：元素表里唯一带**不透明**像素的是
              // jb2a.impact.01x 的 dark_ 黑芯（ASSET-NOTES 实测中心 alpha 恒 255、亮度
              // 0.6-9.6，011/012 都有），压在白闪之上会在白光正中挖出一块黑。画到结果层
              // 之下是结构性保证，不依赖任何一条素材的实测数字；代价是结果层 f7-f14 的
              // 灰烟火星（alpha 均值 9.4→3.6，覆盖约 1%）会盖住一点残留，可忽略。
              delay: resultFlash?.to ?? 0, zIndex: 55, elevation: t.elevation,
              startTime: start, duration: dur,
              fadeIn: el.fadeIn, fadeOut: el.fadeOut,
              selfFlash: trimFlash(el.flash, {startTime: start, duration: dur})
            });
          }
        }
      }

      if (shakeAt) {
        // 只抖目标 sprite 的副本（scripts/player/play.mjs 的 kind:"shake" 分支用
        // copySprite，不震全屏），锚点必须是目标而不是 origin——once 规则的默认锚点
        // 是 {ref:"origin"}，这里显式覆盖成命中的那个目标。
        cues.push({
          kind: "shake", layer: "shake", playIf: "always",
          at: shakeAt.at, forTarget: shakeAt.forTarget,
          // zIndex 显式写 0：播放层从前在 shake 分支里硬编码 .zIndex(0)，cue 上的字段
          // 因此被静默丢弃。数值一字未变（渲染结果逐像素相同），只是把这个决定搬回
          // 规则层，让 cue 说的话与画面真正发生的事一致。
          zIndex: 0,
          intensity: 0.08, duration: 400, delay: 40
        });
      }

      if (unknownTypes.size) {
        ctx.warn(`[impact] 规则 "impact.layered"：伤害类型 ${[...unknownTypes].join("、")} `
          + `不在 ELEMENT_LAYER 的 12 键里（键集取自 crucible const/attributes.mjs 的 `
          + `DAMAGE_TYPES，伤害类别的别名见 DAMAGE_ALIAS）；箭头右侧是元素层实际改用的键，`
          + `由后续候选或 bludgeoning 兜底得出`);
      }

      return cues.length ? cues : null;
    }
  },

  /**
   * 兜底：非攻击动作（isAttack !== true）若有目标，给一层轻量中性反馈。isAttack
   * 为 true 的动作全部被上面 pri 500 的规则接管，本规则实际只服务于自我增益/治疗/
   * 技能检定这类没有攻击结果可言的场景，因此不分层、不区分 8 种结果的具体素材，
   * 只保留「travel 自带闪爆让位」这条跨槽约定，与本槽主规则一致。
   * 几何上同样吃 RESULT_GEOM（§0.7 把本规则与主规则点名为「同型」），两处差别写在
   * build() 里：落空两档保留 `.missed()`、构图补偿项 selfX/selfY 一律剥掉。
   *
   * 素材沿用结果层 HIT 那条已验证路径（jb2a.impact.005.white），不再引用未经
   * ASSET-NOTES 记录的 jb2a.impact.004（Task 7 遗留、Task 11 迁移，见
   * test/armory-assets.test.mjs 的 LEGACY_UNVERIFIED 白名单已同步删除该条目）。
   * 不做动态染色：ASSET-NOTES 只验证过这条素材的 white 分支，其余颜色分支的
   * 帧数/时序没有实测依据。
   */
  {
    id: "generic.impact", pri: 10,
    when: () => true,
    build: (s, ctx, target, built) => {
      const res = target.results?.[0]?.result ?? RESULT.HIT;
      const missed = res === RESULT.MISS || res === RESULT.DODGE;
      // 治疗汇聚层（§0.8）同样要接在这条兜底上：非攻击的治疗动作（复活、医疗合剂，语料里
      // 是 edge.heal.action.{healing,harmless}）`usage.isAttack !== true`，够不着 pri 500
      // 那条主规则，从前一样在被治疗者身上炸这记命中火光。判据与主规则同一个函数。
      // 位置在最前面：这一支不吃下面的攻击轴/几何裁定（治疗层不转向、不偏移）。
      const restCue = restorationCue(s, target, ctx, {
        weight: weightOf(res),
        at: {ref: "target", tokenId: target.tokenId, uuid: target.uuid, x: target.x, y: target.y},
        playIf: RESULT_NAME[res] ?? "always"
      });
      if (restCue) return restCue;
      // 与主规则同一张裁定表、同一个攻击轴（§0.7 把本规则点名为「同型」）。差别只有一处：
      // 落空的两档仍然留着 missed。本规则服务的是非攻击动作，那两档既不转向、素材也没有
      // 构图补偿要做，`.missed()` 在它身上是原设计的用法（说理见上方「.missed() 的翻案」）。
      // ⚠ selfX / selfY 必须剥掉：那两项补的是**结果层那八条素材各自的**构图偏心
      // （MISS 那行字压在画幅 73% 处、DODGE 的亮带偏左 (250-202)/500），而本规则恒用
      // jb2a.impact.005.white —— ASSET-NOTES 实测它的内容正居中（f0 质心 (199.5,199.5)
      // 对 400×400 画幅）。把别人的构图补偿套到它头上就是纯错位。
      // along / lateral 则照吃：那两项是「这一下打在目标身上的哪个位置」，是结果语义，
      // 与素材无关；rotationOffset 也照吃——HIT 那 -47.86° 量的正是这条素材自己的漂移。
      const axis = attackAxis(s.origin, target);
      const {selfX: _sx, selfY: _sy, ...geom} = RESULT_GEOM[res] ?? RESULT_GEOM[RESULT.HIT];
      const rotating = geom.rotate === true && !!axis && !missed;
      const tw = target.width ?? 1;
      if (HIT_RESULTS.includes(res) && coveringFlash(built, "target")) return null;
      const fx = ctx.pick("jb2a.impact.005.white");
      if (!fx) return null;
      const objectScale = r6(weightOf(res) * ctx.geom.sizeScale());
      return {
        file: fx.file, playIf: RESULT_NAME[res] ?? "always",
        // 这里从前是 `res === RESULT.GLANCE ? 0.6 : 1`——0.6 这个数字的第三份拷贝，
        // 也是唯一一处「GLANCE 打六折」写对了的地方。改用同一张权重表：本规则的素材恒为
        // jb2a.impact.005.white（400x400，画布系数 1），weightOf(res) 就是完整系数；
        // 语义上也更对（非攻击动作出现 block/armor 时给 0.9/0.8 比一律 1.0 合理）。
        objectScale,
        // 转的那一档瞄「越过目标」的点；落空的两档保留退化 aim——它是 missed 的唯一载体
        // （play.mjs:379 的 e.missed(true) 落在 if(rotates) 之外），不是死字段。
        // 其余结果一个 aim 都不写：那才是 §0.7 要删的东西。
        aim: rotating
          ? {towards: axis.towards, rotationOffset: geom.rotationOffset ?? 0, missed: false}
          : (missed ? {towards: {tokenId: target.tokenId, x: target.x, y: target.y}, missed} : null),
        ...impactOffset(geom, {rotating, tw, spriteSpan: objectScale * tw,
                               side: sideOf(s, target)}),
        // fade 与结果层 HIT 那条逐字一致：同一个素材、同一个 550ms 窗口，两条路径给出
        // 不同观感只会让人以为是 bug。依据见 RESULT_LAYER[HIT] 注释。
        duration: 550, delay: 0, zIndex: 60, elevation: target.elevation,
        fadeIn: 0, fadeOut: 100,
        selfFlash: trimFlash(RESULT_LAYER[RESULT.HIT].flash, {duration: 550})
      };
    }
  }
];
