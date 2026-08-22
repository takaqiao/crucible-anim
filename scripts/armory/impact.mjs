import {RESULT, RESULT_NAME, HIT_RESULTS} from "../const.mjs";
import {coveringFlash, trimFlash} from "./flash.mjs";

/**
 * S3 impact：命中判定后，锚在目标。结果层与元素层分开叠加，见 DESIGN.md §6.5。
 *
 * 8 种攻击结果 × 12 种伤害类型 = 96 种组合，但两者分层：
 *   impact = 结果层（8 选 1，与元素无关） + 元素层（仅 HIT_RESULTS 叠加，12 选 1）
 * 只需 8 + 12 = 20 条内容，见文末两张表。
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
 * startTime/duration 单位 ms，语义与 travel.mjs 一致：duration 是「startTime 之后
 * 还要播多久」，不是绝对终点。省略即保留素材原长（CUE_DEFAULTS 的 duration:null）。
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
  [RESULT.HIT]: {path: "jb2a.impact.005.white", canvas: 1, missed: false, shake: true,
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
  [RESULT.GLANCE]: {path: "blfx.spell.impact.flash.color1", canvas: 0.35, missed: false,
                    shake: false, fadeIn: 0, fadeOut: 67, flash: {from: 100, at: 200, to: 233}},

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
  [RESULT.ARMOR]: {path: "jb2a.impact.011.yellow", canvas: 1, missed: false, shake: false,
                   startTime: 467, duration: 266, fadeIn: 0, fadeOut: 67,
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
  [RESULT.BLOCK]: {path: "jb2a.shield.02.outro_explode.blue", canvas: 1, missed: false,
                   shake: false, startTime: 267, duration: 1233, fadeIn: 150, fadeOut: 200,
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
  [RESULT.PARRY]: {path: "blfx.misc.enchantment.1.blades_clash1.color1", canvas: 1 / 3,
                   missed: false, shake: false, duration: 1700, fadeIn: 0, fadeOut: 300,
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
  [RESULT.RESIST]: {path: "jb2a.extras.tmfx.inpulse.circle.02.normal", canvas: 1.4,
                    missed: false, shake: false, rate: 2, fadeIn: 0, fadeOut: 150,
                    flash: null},

  /**
   * DODGE — jb2a.teleport.01.white，27 帧 @30fps=900ms，500x300 横幅。ASSET-NOTES：
   * 「endTime 掐在 f10 就够，本体只有 f1-f4 约 0.13s」，f10=333ms，直接取。
   * missed:true（`.missed()` 偏移落空 + 残影，见 DESIGN.md §6.5）。500 宽对 JB2A 400
   * 基准约 1.25 倍，canvas 取 0.8（=1/1.25），语义权重 0.8 由 RESULT_WEIGHT 承担，
   * 下发 0.64。旧值 0.65 是「0.8 ÷ 1.25」的手工取整，拆表后按公式落到 0.64。
   *
   * fade：全部内容在 f1-f4（33-167ms），峰值 f2=67ms。默认 fadeIn:200 的 easeOutQuad
   * 在峰值只走到 55%、在 f1 只有 31%——整条 cue 都在淡入期内，是本表被默认值伤得最狠的
   * 一条，必须 fadeIn:0。fadeOut 取 67，起点 267ms 时素材早已归零，纯保险。预算 20%。
   */
  [RESULT.DODGE]: {path: "jb2a.teleport.01.white", canvas: 0.8, missed: true, shake: false,
                   duration: 333, fadeIn: 0, fadeOut: 67, flash: null},

  /**
   * MISS — jb2a.ui.miss.white，84 帧 @30fps=2800ms，本质是烘死在素材里的英文衬线字
   * "Miss!"（与另外 7 条纯 VFX 语言不一致，且没法本地化——上线前需要设计确认是否
   * 换成扬尘/挥空类素材，本任务先用这条已验证路径占位，见 task-11-report.md 的顾虑
   * 一节）。ASSET-NOTES：「空帧从 f44 起…endTime≈1467ms」，直接取。源画布只有
   * 200x200（JB2A 基准的一半），「铺到一格 token 上字号偏小需要放大」，canvas 取 2，
   * 语义权重 0.7 由 RESULT_WEIGHT 承担，下发 1.4。missed:true。
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
  [RESULT.MISS]: {path: "jb2a.ui.miss.white", canvas: 2, missed: true, shake: false,
                  duration: 1467, fadeIn: 0, fadeOut: 100, flash: null}
};

/**
 * 8 支 eskie.damage.* 共用同一套模板动作，自带白爆闪落在同一处：f5（167ms）整帧变纯白，
 * f6 半退，f7 起才是类型专属残留。逐支实测「低饱和(<25%)·高亮(luma>200)·不透明(alpha>150)」
 * 像素占比，峰值全部在 f5：fire 25.1% / cold 20.0% / electricity 24.8% / acid 21.7% /
 * poison 19.6% / radiant 28.4% / psychic 28.3% / necrotic 24.1%；f6 降到 4.3-22.7%，
 * f7 全部 ≤5.2%。29.97fps 下 f5=167ms、f7=234ms。
 */
const ESKIE_FLASH = Object.freeze({from: 167, at: 167, to: 234});

/**
 * 元素层 = **残留层**：仅在 HIT_RESULTS（HIT/GLANCE）上叠加，物理三种共用血迹。
 * 路径取自 ASSET-NOTES 主表，每行备注都直接标了「伤害类型：X」。不经 {color} 动态
 * 染色——每条已经是该伤害类型下验证过时序/色相的具体叶子。
 *
 * scale 里只含画布归一化：eskie.damage.* 家族原生 800x800，是 jb2a 400x400 基准的
 * 2 倍（ASSET-NOTES 通用结论「同一个 .scale() 值在三家之间差 2-3 倍」），所以 eskie 系
 * 给 0.45、jb2a 系给 0.9。语义权重与结果层共用 RESULT_WEIGHT，在 build() 里相乘。
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
  bludgeoning: {path: "jb2a.liquid.splash.red", scale: 0.9, flash: null, fadeIn: 0, fadeOut: 300},
  piercing:    {path: "jb2a.liquid.splash.red", scale: 0.9, flash: null, fadeIn: 0, fadeOut: 300},
  slashing:    {path: "jb2a.liquid.splash.red", scale: 0.9, flash: null, fadeIn: 0, fadeOut: 300},
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
 * 落到 bludgeoning：三种物理伤害在 ELEMENT_LAYER 里本来就共用同一条血溅素材、同 scale，
 * 落到三者中的哪一个视觉完全等价；bludgeoning 同时也是对话框列表第一项与
 * item-weapon.mjs damageType 字段的 initial 值。
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
        const aim = {towards: {tokenId: t.tokenId, x: t.x, y: t.y}, missed: spec.missed};
        // 语义权重：结果层与元素层共用同一个数，各自再乘自己素材的画布系数。
        const weight = weightOf(hit.result);
        // 结果层这一段实际播出来的自带闪爆窗口。元素层的交棒时机直接由它派生，不再写死
        // 一个 delay 常量——「元素层必须等结果层闪完」这句话因此有了唯一出处。
        const resultFlash = trimFlash(spec.flash,
          {startTime: spec.startTime ?? 0, duration: spec.duration ?? null});

        // 双闪抑制：travel 已经在这个锚点上自带过一次命中闪爆（selfFlash.anchor
        // === "target"，见 armory/flash.mjs），结果层这条通用「结果」闪光让位——
        // 它和 travel 的自带闪爆表达的是同一件事（打中了）。元素层不让位：它已经
        // 被 startTime 裁成不带闪爆的纯残留层，携带的是「打中了什么属性」这条新信息。
        if (!(isHitLike && coveringFlash(built, "target"))) {
          const base = ctx.pick(spec.path);
          if (base) {
            cues.push({
              layer: "result", file: base.file, playIf: name, at, aim,
              objectScale: r6(weight * spec.canvas * ctx.geom.sizeScale()),
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
        if (spec.shake && hit.critical && !shakeAt) shakeAt = at;

        if (isHitLike) {
          // 伤害类型的三级回退与「查不到就留痕」都在 elementFor 里，见其注释。
          const {key, spec: el, unknown} = elementFor(s, t);
          for (const u of unknown) unknownTypes.add(`${JSON.stringify(u)} → "${key}"`);
          const fx = ctx.pick(el.path);
          if (fx) {
            const start = el.startTime ?? 0;
            const dur = el.duration ?? null;
            cues.push({
              // element 字段是这条 cue 选中的 ELEMENT_LAYER 键。bludgeoning/piercing/
              // slashing 三键共用同一条血溅素材，光看 file 分不出走了哪一支，
              // test/coverage.test.mjs 的 12 键覆盖断言要靠这个字段才量得到。
              layer: "element", element: key, file: fx.file, playIf: name, at, aim,
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
              randomRotation: true,
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
          kind: "shake", layer: "shake", playIf: "always", at: shakeAt,
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
   * 只保留「missed 偏移」与「travel 自带闪爆让位」两条跨槽约定，与本槽主规则一致。
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
      if (HIT_RESULTS.includes(res) && coveringFlash(built, "target")) return null;
      const fx = ctx.pick("jb2a.impact.005.white");
      if (!fx) return null;
      return {
        file: fx.file, playIf: RESULT_NAME[res] ?? "always",
        // 这里从前是 `res === RESULT.GLANCE ? 0.6 : 1`——0.6 这个数字的第三份拷贝，
        // 也是唯一一处「GLANCE 打六折」写对了的地方。改用同一张权重表：本规则的素材恒为
        // jb2a.impact.005.white（400x400，画布系数 1），weightOf(res) 就是完整系数；
        // 语义上也更对（非攻击动作出现 block/armor 时给 0.9/0.8 比一律 1.0 合理）。
        objectScale: r6(weightOf(res) * ctx.geom.sizeScale()),
        aim: {towards: {tokenId: target.tokenId, x: target.x, y: target.y}, missed},
        // fade 与结果层 HIT 那条逐字一致：同一个素材、同一个 550ms 窗口，两条路径给出
        // 不同观感只会让人以为是 bug。依据见 RESULT_LAYER[HIT] 注释。
        duration: 550, delay: 0, zIndex: 60, elevation: target.elevation,
        fadeIn: 0, fadeOut: 100,
        selfFlash: trimFlash(RESULT_LAYER[RESULT.HIT].flash, {duration: 550})
      };
    }
  }
];
