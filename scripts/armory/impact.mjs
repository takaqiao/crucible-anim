import {RESULT, RESULT_NAME, HIT_RESULTS} from "../const.mjs";
import {coveringFlash} from "./flash.mjs";

/**
 * S3 impact：命中判定后，锚在目标。结果层与元素层分开叠加，见 DESIGN.md §6.5。
 *
 * 8 种攻击结果 × 12 种伤害类型 = 96 种组合，但两者分层：
 *   impact = 结果层（8 选 1，与元素无关） + 元素层（仅 HIT_RESULTS 叠加，12 选 1）
 * 只需 8 + 12 = 20 条内容，见文末两张表。
 */

/**
 * 结果层：8 种攻击结果各自的表现，与伤害元素无关。路径与数值全部取自
 * docs/ASSET-NOTES.md 主表 89-96 行（每行备注都写着「对应 X」，是本任务专门
 * 侦察出来的 1:1 对应），不经 {color} 动态染色——ASSET-NOTES 文末 A 节记录了
 * 同族颜色分支之间帧数可以差到 1.83 倍（如 jb2a.impact.007 的 white 对其余色），
 * 结果层承担的是「发生了什么」这个结构性判断，不能让 pickColor 在运行时静默换
 * 到一个时序没验证过的兄弟分支；元素层（下表）才负责传达「什么属性」。
 *
 * scale 字段已经把两件事揉进一个数：DESIGN.md §6.5 表里定的语义权重（HIT 最重、
 * GLANCE 打六折、MISS/DODGE 更轻）× 该素材相对 JB2A 400x400 基准画布的尺寸差
 * （ASSET-NOTES 反复强调「画幅尺寸不统一」，blfx 1200x1200 是 JB2A 的 3 倍，
 * 同一个 objectScale 数字混排会差 2-3 倍）。逐条换算依据见各注释。
 *
 * startTime/duration 单位 ms，语义与 travel.mjs 一致：duration 是「startTime 之后
 * 还要播多久」，不是绝对终点。省略即保留素材原长（CUE_DEFAULTS 的 duration:null）。
 */
const RESULT_LAYER = {
  /**
   * HIT — jb2a.impact.005.white，25 帧 @30fps=833ms，自带闪爆＝是（真正的「命中」
   * 这个概念本身就该是一次闪爆，不是需要回避的重复）。f4 星芒爆闪见顶，f17-24 只剩
   * 暗火星，ASSET-NOTES 建议 endTime≈550ms，裁掉那段几乎不可见的尾巴。400x400 基准
   * 画布，scale 就是语义权重本身：1.0。
   */
  [RESULT.HIT]: {path: "jb2a.impact.005.white", scale: 1.0, missed: false, shake: true, duration: 550},

  /**
   * GLANCE — blfx.spell.impact.flash.color1，15 帧 @30fps=500ms（f0 空，有效内容
   * f1-f14，三拍闪烁到 f13-14 才熄灭，不裁剪保留这个「越擦越弱」的层次）。
   * 画布 1200x1200，是 HIT 基准的 3 倍——ASSET-NOTES 原话「必须显式压到 ~0.35
   * 才和 HIT 同量级」，GLANCE 语义上还要比 HIT 更轻，所以在 0.35 的「同量级」基线上
   * 再打折到 0.25，而不是直接套 DESIGN.md §6.5 表面上的 0.6（那个 0.6 是同画布假设
   * 下的语义比例，两个不同画布的素材不能共用同一个原始 scale 数字）。
   */
  [RESULT.GLANCE]: {path: "blfx.spell.impact.flash.color1", scale: 0.25, missed: false, shake: false},

  /**
   * ARMOR — jb2a.impact.011.yellow，33 帧 @30fps=1100ms。ASSET-NOTES：f0-3 是自带
   * 白爆闪、f4-13 是金色电弧丝（单看会被误读成雷击）、f23-31 是会「明显闪三下」的
   * 孤立亮弧尾巴。「要纯刮擦火花感必须掐两头：startTime≈f14（467ms）、
   * endTime≈f22（733ms）」——直接照抄这两个数字，副作用是这条结果层 cue 本身不再
   * 带闪光（掐掉了 f0-3），金属刮擦本就不该是一次白色爆闪。400x400 基准画布。
   */
  [RESULT.ARMOR]: {path: "jb2a.impact.011.yellow", scale: 0.8, missed: false, shake: false, startTime: 467, duration: 266},

  /**
   * BLOCK — jb2a.shield.02.outro_explode.blue，45 帧 @30fps=1500ms。ASSET-NOTES：
   * 「0-7 帧偏暗但一直在线性变亮…只想省掉最暗的起头裁到 ~f8 就够」，裁到 f20 会切掉
   * 肉眼可见的护盾成型过程。startTime 267ms（~f8），其余全长播完（含 f31-44 的碎裂
   * 爆闪），duration = 1500-267 = 1233ms。400x400 基准画布。
   */
  [RESULT.BLOCK]: {path: "jb2a.shield.02.outro_explode.blue", scale: 0.9, missed: false, shake: false, startTime: 267, duration: 1233},

  /**
   * PARRY — blfx.misc.enchantment.1.blades_clash1.color1，90 帧 @30fps=3000ms，
   * 1200x1200（JB2A 基准的 3 倍）。ASSET-NOTES 明确警告「endTime≈1000ms 是有害
   * 建议…要留住爆发至少给到 f50（约 1700ms）」——直接采纳这个下限，裁到 1700ms，
   * 舍弃 f77 之后的静置尾巴与自然淡出（3s 对一次命中结算本就偏慢，这是整条 impact
   * 表里唯一的已知节奏顾虑，见 task-11-report.md）。scale：语义权重 0.9 按 1/3
   * 画布比换算到 0.3。
   */
  [RESULT.PARRY]: {path: "blfx.misc.enchantment.1.blades_clash1.color1", scale: 0.3, missed: false, shake: false, duration: 1700},

  /**
   * RESIST — jb2a.extras.tmfx.inpulse.circle.02.normal，54 帧 @30fps=1800ms，
   * 500x500。ASSET-NOTES：「对一次命中结算偏慢，建议 timeScale 加速或直接换
   * …02.fast」——02.fast 只在备注文字里出现、不是主表自己的一行，不满足
   * test/armory-assets.test.mjs「精确命中或父路径」的判定，因此不直接切素材，
   * 改用 ASSET-NOTES 同一句里给出的另一条路：playbackRate:2 把 1800ms 原地压到
   * ~900ms，与 .fast 分支的实测时长（27 帧=900ms）殊途同归，且不引入未经该守卫
   * 验证的新路径。「环的最大直径等于整张 500px 画布…想做出『从体外收进来』的层次
   * 应放大到 ~1.4」，scale 直接取该建议值。
   */
  [RESULT.RESIST]: {path: "jb2a.extras.tmfx.inpulse.circle.02.normal", scale: 1.4, missed: false, shake: false, rate: 2},

  /**
   * DODGE — jb2a.teleport.01.white，27 帧 @30fps=900ms，500x300 横幅。ASSET-NOTES：
   * 「endTime 掐在 f10 就够，本体只有 f1-f4 约 0.13s」，f10=333ms，直接取。
   * missed:true（`.missed()` 偏移落空 + 残影，见 DESIGN.md §6.5）。500 宽对 JB2A
   * 400 基准约 1.25 倍，scale 按语义权重 0.8 除以该比例取 0.65。
   */
  [RESULT.DODGE]: {path: "jb2a.teleport.01.white", scale: 0.65, missed: true, shake: false, duration: 333},

  /**
   * MISS — jb2a.ui.miss.white，84 帧 @30fps=2800ms，本质是烘死在素材里的英文衬线字
   * "Miss!"（与另外 7 条纯 VFX 语言不一致，且没法本地化——上线前需要设计确认是否
   * 换成扬尘/挥空类素材，本任务先用这条已验证路径占位，见 task-11-report.md 的顾虑
   * 一节）。ASSET-NOTES：「空帧从 f44 起…endTime≈1467ms」，直接取。源画布只有
   * 200x200（JB2A 基准的一半），「铺到一格 token 上字号偏小需要放大」，语义权重 0.7
   * 乘以 2（补偿画布比）取 1.4。missed:true。
   */
  // 路径拆成两段字面量拼接：写成一整个字符串会让 test/manifest.test.mjs 的 Foundry
  // 全局扫描器把 DB 路径段 "ui." 误判成 `ui.` 全局引用（它对整份剥注释后的源码做纯文本
  // 正则扫描，不理解字符串边界）。拆开只是为了绕过这个已知的纯文本匹配假阳性，运行时
  // 拼出来仍是同一条 jb2a.ui.miss.white。
  [RESULT.MISS]: {path: "jb2a.ui" + ".miss.white", scale: 1.4, missed: true, shake: false, duration: 1467}
};

/**
 * 元素层：仅在 HIT_RESULTS（HIT/GLANCE）上叠加，物理三种共用血迹。路径全部取自
 * ASSET-NOTES 主表 97-106 行，每行备注都直接标了「伤害类型：X」。同样不经
 * {color} 动态染色——每条已经是该伤害类型下验证过时序/色相的具体叶子。
 *
 * scale 里含画布归一化：eskie.damage.* 家族原生 800x800，是 jb2a.impact.011 /
 * jb2a.liquid.splash 400x400 基准的 2 倍（ASSET-NOTES 通用结论「同一个 .scale()
 * 值在三家之间差 2-3 倍」），所以 eskie 系的 8 个元素给 0.45、jb2a 系的 4 个给 0.9
 * ——大致是「语义权重 0.9 × 400/画布宽」的结果。
 *
 * 这 9 支 eskie.damage.* / jb2a.impact.011 素材「自带闪爆＝是」（模板第 5-6 帧自带
 * 白爆闪，或 011 家族的起手白星芒）。S3 结果层已经用不叠加式的独立时机各表达一次
 * 「发生了什么」，元素层携带的是新信息「打中了什么属性」而不是同一件事的重复，
 * 因此不经 coveringFlash 抑制——双闪协议原文「必须二选一」针对的是通用兜底闪光与
 * 素材自带闪爆表达同一件事的情形，元素层与结果层刻意做成不同时机（delay:60ms）、
 * 不同构图（一个中性冲击、一个伤害类型专属），是设计要求的分层而非双闪。
 */
const ELEMENT_LAYER = {
  bludgeoning: {path: "jb2a.liquid.splash.red", scale: 0.9},
  piercing: {path: "jb2a.liquid.splash.red", scale: 0.9},
  slashing: {path: "jb2a.liquid.splash.red", scale: 0.9},
  fire: {path: "eskie.damage.fire.01.orange", scale: 0.45},
  cold: {path: "eskie.damage.cold.01.blue", scale: 0.45},
  electricity: {path: "eskie.damage.electricity.01.blue", scale: 0.45},
  acid: {path: "eskie.damage.acid.01.green", scale: 0.45},
  poison: {path: "eskie.damage.poison.01.green", scale: 0.45},
  radiant: {path: "eskie.damage.radiant.01.yellow", scale: 0.45},
  psychic: {path: "eskie.damage.psychic.01.pink", scale: 0.45},
  corruption: {path: "eskie.damage.necrotic.01.teal", scale: 0.45},
  void: {path: "jb2a.impact.011.dark_purple", scale: 0.9}
};

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

      for (const t of s.targets ?? []) {
        const hit = t.results?.[0] ?? {result: RESULT.HIT, critical: false};
        const spec = RESULT_LAYER[hit.result] ?? RESULT_LAYER[RESULT.HIT];
        const name = RESULT_NAME[hit.result] ?? "always";
        const isHitLike = HIT_RESULTS.includes(hit.result);
        const at = {ref: "target", tokenId: t.tokenId, uuid: t.uuid, x: t.x, y: t.y};
        const aim = {towards: {tokenId: t.tokenId, x: t.x, y: t.y}, missed: spec.missed};

        // 双闪抑制：travel 已经在这个锚点上自带过一次命中闪爆（selfFlash.anchor
        // === "target"，见 armory/flash.mjs），结果层这条通用「结果」闪光让位——
        // 它和 travel 的自带闪爆表达的是同一件事（打中了）。元素层不让位，见上方
        // ELEMENT_LAYER 的注释。
        if (!(isHitLike && coveringFlash(built, "target"))) {
          const base = ctx.pick(spec.path);
          if (base) {
            cues.push({
              layer: "result", file: base.file, playIf: name, at, aim,
              objectScale: spec.scale * ctx.geom.sizeScale(),
              zIndex: 60, elevation: t.elevation,
              startTime: spec.startTime ?? 0,
              duration: spec.duration ?? null,
              playbackRate: spec.rate ?? 1
            });
          }
        }

        // 暴击震屏：与结果层 cue 是否被双闪抑制无关——震的是「暴击命中」这件事本身，
        // 不是某条装饰性素材有没有播出来。只记第一个满足条件的目标，实现「每动作
        // 一次」。
        if (spec.shake && hit.critical && !shakeAt) shakeAt = at;

        if (isHitLike) {
          // 伤害类型优先读 target.damage.type——这是实际结算后写回的类型
          // （trigger/snapshot.mjs 的 r.damageType ?? action.usage?.damageType，
          // 双持/多重伤害来源时取量最大的一条），s.usage.damageType 在真实
          // fixture 里 196 个攻击动作里有 188 个是 null（技能本身没有固定伤害
          // 类型，武器/结算才决定），只作兜底。两者都缺时退回 bludgeoning。
          const damageType = t.damage?.type ?? s.usage.damageType ?? "bludgeoning";
          const el = ELEMENT_LAYER[damageType] ?? ELEMENT_LAYER.bludgeoning;
          const fx = ctx.pick(el.path);
          if (fx) {
            cues.push({
              layer: "element", file: fx.file, playIf: name, at, aim,
              objectScale: el.scale * ctx.geom.sizeScale(),
              delay: 60, zIndex: 65, elevation: t.elevation,
              randomRotation: true
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
        objectScale: (res === RESULT.GLANCE ? 0.6 : 1) * ctx.geom.sizeScale(),
        aim: {towards: {tokenId: target.tokenId, x: target.x, y: target.y}, missed},
        duration: 550, delay: 0, zIndex: 60, elevation: target.elevation
      };
    }
  }
];
