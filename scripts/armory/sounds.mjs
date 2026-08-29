import {RESULT} from "../const.mjs";
import {shapeFor} from "./weapon-shapes.mjs";
import {soundAt, gainFor, poolFor, contentEndOf} from "./sound-table.mjs";

/**
 * 音效表 —— 「这一下该听见什么」。
 *
 * ## 现状
 *
 * 改造前 434 个动作里**只有 11 个有声音**（远程拉弓那一条）。刀砍上去没有声音，
 * 砍空了也没有声音。这一层补的就是这个。
 *
 * ## 三个时刻
 *
 * | 时刻 | 听见什么 | 由谁发 |
 * | --- | --- | --- |
 * | 挥出去 | 风声（按武器轻重） | travel 槽的挥击规则 |
 * | 打中 | 命中音（按伤害类型） | impact 槽的结果层 |
 * | 打空 | 落空音 | impact 槽的结果层 |
 *
 * ## 排音效的口径是「什么时候听见」，不是「什么时候开始播」
 *
 * 全库音频量测里 psfx 家族的起音中位数是 **200ms**，`psfx.impacts.bludgeoning.v1`
 * 更是 **210-240ms** 才有声。按命中时刻直接排下去，玩家会在刀已经收招之后四分之一秒
 * 才听见那一声。所以一律走 `soundAt(file, atMs)`（见 `armory/sound-table.mjs`），
 * 它把**响度峰值**对齐到指定时刻。
 *
 * ## 每条 cue 都要报自己的角色（`soundRole`），volume 由角色算出来
 *
 * volume 从前是这里逐条手挑的常数（0.6 / 0.8 / 0.55 / 0.7），**与实测响度完全无关**：
 * 有效峰值 `peakDb + 20·log10(volume)` 跨度 21.3 dB，235 个双段动作里 153 个
 * 「命中音比它前面的风声还轻」——该最响的那一下排第三。现在四处一律写成
 * `gainFor(file, role) ?? <原来的常数>`（`armory/sound-table.mjs`），由量测反算。
 *
 * ⚠ **角色只能由规则显式声明，绝不能从素材猜。** 峰均比（`peakDb − rmsDb`）看着能把
 * 施法床垫与瞬态分开，但那个分离是**单向**的：cast 全在 10.4 dB 线下，线下却另有 6 条
 * 非 cast（4 条斩击/腐蚀命中 + 2 条重挥风声）。猜错的代价是把一记命中压进床垫档。
 * 所以每条 sound cue 都带 `soundRole`，守卫也按 `soundRole` 分组
 * （**不能按 volume 数值分**：归一化之前 0.8 同时覆盖 impact 与 draw 两个角色）。
 *
 * ⚠ **这一层不许加淡入淡出。** Sequencer 4.2.3 的 `fadeInAudio/fadeOutAudio` 会在
 * 播出窗两端各削一段，而本仓库的音效窗本来就贴着「有声内容」裁（见 `soundAt`），
 * 削掉的正是被对齐到命中点的那一团——归一化会被整个作废。
 *
 * ## 为什么全是字面量路径
 *
 * DB 路径不能由插值拼出来——静态扫描还原不了，「必须有 ASSET-NOTES 依据」「不在否决
 * 清单」「不引用死链」三条守卫会对它整体失效（`test/armory-assets.test.mjs` 有专门一条
 * 禁令）。MGS 的命名是 `<元素>_<武器类>_whoosh` / `<武器类>_<元素>_hit`，很想拼，不许拼。
 *
 * ## 取一条音效一律走 `pick()`，不直接调 `ctx.sound`
 *
 * `assets.resolve` 对**分支节点**只取其下第一个叶子作代表，而 ggg-sfx 全库都是并列的
 * 编号子枝（`….05.01` / `….05.02` / …）——直接 `ctx.sound(分支路径)` 恒定拿到 `01`，
 * 「同一件武器连挥三次是三次一模一样的声音」。`sound-table.mjs` 的 `poolFor()` 把这类
 * 路径展开成整池（生成器机械展开，见那边的注释），交给 `ctx.soundFrom` 摇。
 *
 * ⚠ **摇的必须是 `rngSfx` 这条流**（`ctx.sound` / `ctx.soundFrom` 都用它）。用 `ctx.pick`
 * 那条流会让「给音效加一个池」这件事本身改掉后面每一次视觉选材——音效 cue 排在画面之前，
 * 抽取次数从 0 变 1 就一路传染（`resolver/context.mjs` 的 rngSfx 注释、
 * `test/rng-streams.test.mjs`）。
 */

/**
 * 取一条音效：**分支路径先展开成整池**，再交给 `ctx.soundFrom` 摇。
 *
 * `poolFor(path)` 表里没有这条路径时返回 `[path]`，`soundFrom` 逐条 `assets.resolve`，
 * 于是与从前的 `ctx.sound(path)` 逐字节等价（同一条 rngSfx、同一个池、同一次抽取）。
 * `soundFrom` 全查不到时返回 null，这里再退回 `ctx.sound` 走 bestFit 的降级解析——
 * **这一层绝不静默无声**。
 *
 * @param {object} ctx
 * @param {string|null|undefined} path
 * @returns {{file: string}|null}
 */
function pick(ctx, path) {
  if (!path) return null;
  return ctx.soundFrom?.(poolFor(path)) ?? ctx.sound(path);
}

/**
 * 命中音，按**伤害类型**。
 *
 * 物理三种走 `psfx.impacts.*`（psfx 没有 piercing，用 slashing——都是利器入肉，
 * 而 bludgeoning 的闷响差得远，不能拿它顶）；元素走 `magicaleffects` 的对应支。
 *
 * `magicaleffects` 只有 fire / cold / necrotic / psychic / lightning / generic 六支，
 * 所以 acid / poison / radiant 落到 generic。**这是缺口不是选择**——MGS 那边有
 * `hammer_acid_hit` / `hammer_poison_hit` / `hammer_holy_hit`，但它们自带锤子的钝响，
 * 拿来配剑会怪；等哪天找到武器中性的元素命中音再换。
 */
export const HIT_SOUND = Object.freeze({
  slashing:    "psfx.impacts.slashing.v1",
  // **穿刺不再借斩击音。** psfx.impacts 整支至今没有 piercing 叶子，从前 24/92 件穿刺
  // 武器（26%）与 17 件斩击武器共用同一条 `slashing.v1`。换成 MGS 的
  // `piercing_damage_spell`：**3 文件真池**、零新依赖、与 slashing/bludgeoning 同族同长
  //（总长 1099ms、起音 0、峰值 30-100ms），池内 peakDb −16.8..−16.3（Δ0.5，全表最齐之一）。
  // ⚠ 它比 psfx slashing 轻 1-3 dB 且顶上钳 volume=1 仍到不了 −12 的 impact 目标
  //（欠 4.3-4.8 dB）——这是**素材缺口不是配置**，`test/sound-gain.test.mjs` 的欠额棘轮量得到。
  // 否掉的另一条候选 `ggg-sfx.melee.polearm.hit.02`：单文件、起音 150ms/峰值 670ms，
  // 是全部命中候选里最慢的一支，等于把「只有一个采样」的老毛病原样搬过来（已进否决清单）。
  piercing:    "canim.mgs.basic.spells.piercing_damage_spell",
  bludgeoning: "psfx.impacts.bludgeoning.v1",
  fire:        "psfx.impacts.magicaleffects.fire",
  cold:        "psfx.impacts.magicaleffects.cold",
  corruption:  "psfx.impacts.magicaleffects.necrotic",
  void:        "psfx.impacts.magicaleffects.necrotic",
  psychic:     "psfx.impacts.magicaleffects.psychic",
  // 这四支走 MGS，不走 psfx，两个原因都是量出来的：
  //  · `psfx.impacts.magicaleffects.lightning` **在否决清单里**——频谱是三次放电
  //    （0.25 / 0.55 / 1.00s）加持续噼啪，响度峰值在 1020ms，挂到单次命中上会听成打了三下；
  //  · `psfx.impacts.magicaleffects.generic` 峰值 470-950ms，对不上单次命中的节拍。
  // MGS 的 `slingshot_<元素>_hit` 是同一族的完整元素集（酸/电/火/圣/冰/腐/毒/心灵/雷），
  // 峰值一致落在 350ms、有效声长 1.0-1.4s，是这批里唯一齐全且节拍对得上的一套。
  electricity: "canim.mgs.basic.weapons.slingshot_electrical_hit",
  acid:        "canim.mgs.basic.weapons.slingshot_acid_hit",
  poison:      "canim.mgs.basic.weapons.slingshot_poison_hit",
  radiant:     "canim.mgs.basic.weapons.slingshot_holy_hit"
});

/** 认不出伤害类型时的命中音。挥击落在肉上，斩击是最中性的一支。 */
export const HIT_DEFAULT = "psfx.impacts.slashing.v1";

/**
 * 落空音（RESULT.MISS，攻击掷骰本身没够着）。
 *
 * `canim.sfxlib.combat.single.melee_miss`：起音 0 / 峰值 30 / 总长 **260** / 有效声长 220,
 * peakDb −9.4 —— **全库 7935 条里最紧的一条**，落空本来就该是「呼」的一下。
 * 零新依赖（sfxlib 早在索引里，整支此前 0 引用）。
 *
 * 换掉的是 `canim.mgs.basic.weapons.sword_miss`（总长 2070 / 有效声长 1000 的一记剑鸣）：
 * 那是**一柄剑**划空，而 MISS 覆盖近战 / 徒手 / 远程 / 投掷 / 法术全部，拿剑鸣配法术落空
 * 是错配；而且 1 秒的尾巴会盖住后面的动作。
 *
 * ⚠ 顺带订正一条文档事实：`docs/ASSET-NOTES.md` 与本文件旧注释都写「MGS 只有四条 miss」。
 * 按 `/miss/` 枚举 canim 树实为 **5 条**——漏掉的正是 sfxlib 这一条（它在 Combat 目录、
 * 不在 MGS 的 Weapons 目录下）。ASSET-NOTES 归选材阶段独占，那句话由那一侧改。
 */
export const MISS_SOUND = "canim.sfxlib.combat.single.melee_miss";

/**
 * 八档攻击结果各自的声音 —— **画面早就分了 8 档，声音一直只有 2 档。**
 *
 * ## 改造前
 *
 * `strikeSounds` / `spellImpactSound` 各做一次二分
 * （`results.some(r => r.result === 0 || r.result === 1)`），于是
 * **PARRY / BLOCK / ARMOR / RESIST / GLANCE 五档全部走 `hitSoundFor(dmg)`，与干净命中同一条音**。
 * 实测把全语料的 result 逐一改写成 0–7 各跑一遍，result 2/3/4/5/6/7 的输出**逐字节相同**。
 * 对照画面侧：`impact.mjs` 的 `RESULT_LAYER` 给 8 个结果各配了专属素材。
 * 实机表现就是：盾牌硬吃一记大剑，画面是盾爆闪，声音是刀切进肉里。
 *
 * ## 分档的依据是「这一下**打在什么上**」，不是「打没打中」
 *
 * | 结果 | 打在什么上 | 素材 |
 * | --- | --- | --- |
 * | HIT | 肉 | —— 走伤害类型表（见下） |
 * | GLANCE | 擦着刃过去 | 细刃格挡（Block Blade Thin，有效声长 130-220ms，全表最短） |
 * | RESIST | 被法术抗性吃掉 | 泛用法术命中（Spell Impact，池内 Δ0.6 全表最齐） |
 * | ARMOR | 甲片 | 重钝格挡（Block Blunt Large） |
 * | BLOCK | 盾面 | 金属盾格挡（Metal Shield Block） |
 * | PARRY | 兵刃对撞 | 刃招架（Parry Blade） |
 * | DODGE | 什么都没打着（人闪开了） | 拳风扫空（Beefy Miss） |
 * | MISS | 什么都没打着（骰子没够着） | `MISS_SOUND` |
 *
 * **HIT 显式写成 null 而不是从表里删掉**：删掉与「登记为无声」在代码上看不出区别，
 * 而这两件事的语义相反。null 的含义是「这一档不由结果决定，交给伤害类型表」——
 * 火焰法术命中该有火声，把 HIT 钉死成肉体命中会把 `HIT_SOUND` 那 12 档元素全废掉。
 *
 * ⚠ **只借 Crucible 原生 `configureImpact()` 的分档结构，不借它的素材**：原生那五档全是
 * `getRandomSound("projectile", …)` 的**箭矢音**，挂到近战格挡上是换一种错配。
 * ⚠ 三条被量测否掉的候选：`canim.sfxlib.combat.single.shield_hit`（11f 但池内跨 15.3 dB
 * 且 shield-hit-1/4 是单声道，整池随机会自造响度跳变）、`…single.spell_impact`
 * （6 条时长 1010-4410ms，抽中一条就是 4.3 秒尾巴挂在一次抗性减免上）、
 * `ggg-sfx.impact.arrow.blocked.01`（−19.3..−18.0，全库最轻一档）。
 */
export const RESULT_SOUND = Object.freeze({
  [RESULT.HIT]:    null,
  [RESULT.GLANCE]: "ggg-sfx.melee.blade.block.rapier.01",
  [RESULT.RESIST]: "ggg-sfx.impact.general.01",
  [RESULT.ARMOR]:  "ggg-sfx.melee.bludgeoning.block.two-hand.01",
  [RESULT.BLOCK]:  "ggg-sfx.equipment.armor.shield.impact.02",
  // ⚠ 这一池的峰值在 210-270ms，与其余七档（0-90ms）不是一个数量级。**不要把它写进
  // 「lateBy 恒 0」那一档守卫**：交棒点早于 270ms 的法术规则（`travel.mjs` 有 167ms 的）
  // 补偿不过来，一上就红。听感上没问题——`soundAt` 会把峰值对齐到命中点，
  // 对不齐的那部分是物理上避不开的（`test/sound-layer.test.mjs` 有独立判据）。
  [RESULT.PARRY]:  "ggg-sfx.melee.blade.parry.01",
  [RESULT.DODGE]:  "ggg-sfx.melee.unarmed.fist.miss.01",
  [RESULT.MISS]:   MISS_SOUND
});

/**
 * 挥击风声，按**武器轻重**。
 *
 * `psfx.weapon-swooshes.{light,heavy}.v1.group01` 各 4 条，`ctx.sound` 会在其中按种子取一。
 * 元素武器另有 MGS 的 `<元素>_<武器类>_whoosh` 46 条，那是下一轮的事——先让每一次挥击
 * 都有声音，再谈按元素分。
 */
export const SWING_LIGHT = "psfx.weapon-swooshes.light.v1.group01";
export const SWING_HEAVY = "psfx.weapon-swooshes.heavy.v1.group01";

/**
 * 天生武器 / 徒手的挥击风声 —— **獠牙不该发出金属兵刃的风声。**
 *
 * ## 改造前
 *
 * `swingSoundFor` 的元素分支已经写着「爪牙不是刀剑，让獠牙发出『火剑挥击』的金属风声
 * 是错的」，可那一句只挡住元素矩阵，掉下来立刻落到按轻重分的 psfx 刀剑风声：
 * 42 件 natural/unarmed 的产出集合 `{light.group01, heavy.group01}` 与 50 件兵器的集合
 * **完全重合**。分类里连区分的余地都没有——匕首、短剑、獠牙、毒刺同一条 light 池。
 *
 * ## 按**部位**分，而且部位判据不另发明
 *
 * 键取 `weapon-shapes.mjs` 的 `shapeFor(w)`，也就是画面那一侧已经算好的部位形制。
 * 咬（`jb2a.bite.400px`）/ 抓（`jb2a.claws.400px`）/ 拳（`creature_attack.fist`）/
 * 骨刃（獠牙犄角）/ 钝（尾、蹄、触手、伪足，退回骨棒那几支）——**同一套 BITE/CLAW/FIST
 * 正则算一次，画面与声音必然同源**。那三条正则在 `weapon-shapes.mjs` 里是模块私有的，
 * 在这里照抄一份等于把「哪个 identifier 算咬」这件事分叉成两处判据，迟早对不上。
 *
 * ## 素材
 *
 * - 抓 / 骨刃 → `claws.strike.slash.01`（Whoosh Metal Claws，7 变体，峰值 90-270ms）
 * - 咬 → `claws.strike.stab.01`（Stab Metal Claws，**19 变体**，本轮最深的一池）
 * - 拳 / 钝 / 认不出部位 → `unarmed.fist.miss.01`（Beefy Miss，一记拳头扫空的体腔风声）
 *
 * **兜底是 Beefy Miss 而不是金属爪**：认不出部位时，一记「身体扫过去」的风声对尾巴、
 * 蹄子、触手都不算错；金属爪对它们全是错的。宁可钝，不要错配。
 *
 * ## 两条量测订正（规格 §2.2 写于响度归一化落地之前，已不成立）
 *
 * 1. 「爪牙风声比现用轻 9 dB，换上去会听不见」——那是 vol 手挑 0.6 时代的算法。
 *    归一化之后 `claws.strike.slash` 池内 peakDb −19.6..−17.1，swing 目标 −18：
 *    最轻一条顶上钳 volume=1 实得 −19.6、最响一条 volume 0.90 实得 −18.0，
 *    **池内实际跨度只有 1.6 dB**，比它替掉的 psfx light 组（池内 9.6 dB）齐得多。
 * 2. 「挥出去就响」是这一批真正的收益：psfx light 的峰值在 360-610ms、heavy 390-620ms，
 *    而爪牙 90-270ms、Beefy Miss 50-90ms。风声要排在命中前 150ms，排不进去
 *    `strikeSounds` 会整条丢掉——改造前 118 个出攻击音的目标组里 **35 组只剩命中音**，
 *    其中 33 组正是 `strike.unarmed`。
 */
const NATURAL_WHOOSH_DEFAULT = "ggg-sfx.melee.unarmed.fist.miss.01";
const NATURAL_WHOOSH = Object.freeze({
  "jb2a.claws.400px": "ggg-sfx.melee.claws.strike.slash.01",
  "jb2a.melee_attack.01.bonesword.01": "ggg-sfx.melee.claws.strike.slash.01",
  // 【2026-08-30 订正】咬击原本指向 `ggg-sfx.melee.claws.strike.stab.01`，**两处同时错**：
  //
  //  1. **材质**：那条素材 `ASSET-NOTES` 的登记原话是「厂商名字里的 Claws 会误导：
  //     听感与频谱（质心 4488-7917Hz、**无肉声低频**）都是**金属尖端扎进去**，
  //     配匕首/长矛/刺剑对得上，**配爪牙反而不对**」——登记时就点名排除了爪牙。
  //     owner 报的「天生武器发金属兵刃风声」在这 6 件咬击上只是换了一种金属。
  //  2. **事件类别**：它是**命中**音（stab 瞬态，峰值 120-360ms），被当成**挥击风声**用。
  //     风声要排在命中前 150ms，于是一次咬会听成「连着扎两下」。
  //
  // 改用与爪/骨刃同一条：`slash.01` 的登记原话就是「天生武器（爪 / **牙** / 触须）的
  // 挥击风声」，7 个变体、峰值 90-270ms，本来就是为这一类签的。
  "jb2a.bite.400px": "ggg-sfx.melee.claws.strike.slash.01"
});

/** 这件武器是不是天生武器 / 徒手。判据与 `weapon-shapes.mjs` 的部位路由同源。 */
const isNatural = w => w?.properties?.includes("natural") === true || w?.category === "unarmed";

/**
 * 元素挥击风声：**火焰武器挥起来该有火声**。
 *
 * MGS 有一个 4 元素 × 6 武器类的完整矩阵（`<元素>_<武器类>_whoosh`，24 条），
 * 响度峰值一致落在 180-260ms，节拍很齐。元素取**动作**的伤害类型
 * ——`flamingArrow` 的火来自动作，不是弓自带的。
 *
 * 只有这四个元素（flaming / icy / electrical / acid）。腐蚀 / 虚空 / 心灵 / 光耀 /
 * 毒没有对应的风声，退回按轻重分的 psfx 物理风声——**这是缺口不是选择**。
 */
const ELEMENTAL_WHOOSH = Object.freeze({
  flaming: Object.freeze({
    sword: "canim.mgs.basic.weapons.flaming_sword_whoosh", two_handed_sword: "canim.mgs.basic.weapons.flaming_two_handed_sword_whoosh", axe: "canim.mgs.basic.weapons.flaming_axe_whoosh",
    dagger: "canim.mgs.basic.weapons.flaming_dagger_whoosh", hammer: "canim.mgs.basic.weapons.flaming_hammer_whoosh", staff: "canim.mgs.basic.weapons.flaming_staff_whoosh"
  }),
  icy: Object.freeze({
    sword: "canim.mgs.basic.weapons.icy_sword_whoosh", two_handed_sword: "canim.mgs.basic.weapons.icy_two_handed_sword_whoosh", axe: "canim.mgs.basic.weapons.icy_axe_whoosh",
    dagger: "canim.mgs.basic.weapons.icy_dagger_whoosh", hammer: "canim.mgs.basic.weapons.icy_hammer_whoosh", staff: "canim.mgs.basic.weapons.icy_staff_whoosh"
  }),
  electrical: Object.freeze({
    sword: "canim.mgs.basic.weapons.electrical_sword_whoosh", two_handed_sword: "canim.mgs.basic.weapons.electrical_two_handed_sword_whoosh", axe: "canim.mgs.basic.weapons.electrical_axe_whoosh",
    dagger: "canim.mgs.basic.weapons.electrical_dagger_whoosh", hammer: "canim.mgs.basic.weapons.electrical_hammer_whoosh", staff: "canim.mgs.basic.weapons.electrical_staff_whoosh"
  }),
  acid: Object.freeze({
    sword: "canim.mgs.basic.weapons.acid_sword_whoosh", two_handed_sword: "canim.mgs.basic.weapons.acid_two_handed_sword_whoosh", axe: "canim.mgs.basic.weapons.acid_axe_whoosh",
    dagger: "canim.mgs.basic.weapons.acid_dagger_whoosh", hammer: "canim.mgs.basic.weapons.acid_hammer_whoosh", staff: "canim.mgs.basic.weapons.acid_staff_whoosh"
  })
});

/** Crucible 武器 → MGS 的武器类。先按具名武器，再按分类。 */
const MGS_CLASS_BY_ID = Object.freeze({
  shortsword: "sword", longsword: "sword", scimitar: "sword", katana: "sword",
  falchion: "sword", bastardSword: "sword",
  rapier: "dagger", sai: "dagger", stiletto: "dagger", dagger: "dagger", katar: "dagger",
  handAxe: "axe", battleAxe: "axe", greataxe: "axe", pickaxe: "axe",
  warhammer: "hammer", mace: "hammer", club: "hammer", clawHammer: "hammer",
  greathammer: "hammer", greatclub: "hammer", spikedGreatclub: "hammer",
  greatsword: "two_handed_sword",
  boStaff: "staff", quarterstaff: "staff", glaive: "staff", halberd: "staff",
  spear: "staff", javelin: "staff", warlance: "staff"
});

const MGS_CLASS_BY_CATEGORY = Object.freeze({
  light1: "dagger", balanced1: "sword", balanced2: "staff",
  simple1: "hammer", simple2: "hammer", heavy1: "axe", heavy2: "two_handed_sword",
  // 法器是杖形，flameStaff / iceStaff 挥起来该有火声冰声
  talisman1: "staff", talisman2: "staff"
});

/** 走重档风声的武器分类：双手与重型。其余走轻档。 */
const HEAVY_CATEGORIES = new Set(["heavy1", "heavy2", "balanced2", "simple2",
                                  "shieldHeavy", "projectile2", "mechanical2", "talisman2"]);

/**
 * 这件武器挥出去该是什么风声。
 * @param {{category: string|null}|null|undefined} w
 * @returns {string}
 */
/**
 * 这件武器挥出去该是什么风声。
 *
 * 元素武器优先走 MGS 的元素风声（火剑有火声、冰斧有冰声）；对不上就退回按轻重分的
 * psfx 物理风声。
 *
 * @param {{category: string|null, identifier: string|null}|null|undefined} w
 * @param {string|null} [damageType] 伤害类型（动作的，没有则武器的）
 * @returns {string}
 */
export function swingSoundFor(w, damageType) {
  // **天生武器先分流**，在元素矩阵之前：MGS 的元素风声矩阵是刀剑斧锤杖鞭六类，
  // 让獠牙发出金属火剑的风声是错的（旧实现把这条原则写在元素分支里，掉下来又落回
  // psfx 的刀剑风声，等于只贯彻了一半）。爪牙没有元素风声，这是缺口不是选择。
  if (isNatural(w)) return NATURAL_WHOOSH[shapeFor(w)] ?? NATURAL_WHOOSH_DEFAULT;

  const el = ELEMENTAL_WHOOSH[
    damageType === "fire" ? "flaming" : damageType === "cold" ? "icy"
    : damageType === "electricity" ? "electrical" : damageType === "acid" ? "acid" : ""];
  if (el) {
    const cls = MGS_CLASS_BY_ID[w?.identifier] ?? MGS_CLASS_BY_CATEGORY[w?.category];
    if (cls && el[cls]) return el[cls];
  }
  return HEAVY_CATEGORIES.has(w?.category) ? SWING_HEAVY : SWING_LIGHT;
}

/**
 * 这一下打中该听见什么。
 *
 * 伤害类型的取法与 impact 的元素层同源：先看结算写回目标的伤害类型，再看动作自己的，
 * 最后才是武器的（`impact.mjs` 的 `chain`）。这里只收口到「给一个伤害类型，给一条路径」。
 *
 * @param {string|null|undefined} damageType
 * @returns {string}
 */
export const hitSoundFor = damageType => HIT_SOUND[damageType] ?? HIT_DEFAULT;

/**
 * 这个**攻击结果**该听见什么。
 *
 * `RESULT_SOUND` 里显式登记为 null 的那一档（HIT）与表里根本没有的键（越界结果码）
 * 走同一条退路 `hitSoundFor(damageType)`——两者的含义都是「这一档不由结果决定」。
 *
 * @param {number|null|undefined} result  `const.mjs` 的 RESULT 枚举值
 * @param {string|null|undefined} damageType
 * @returns {string}
 */
export const resultSoundFor = (result, damageType) =>
  RESULT_SOUND[result] ?? hitSoundFor(damageType);

/**
 * 一个目标这一下的结果码。
 *
 * ⚠ **这是一处显式的语义变更。** 旧实现是 `results.some(r => r.result === 0 || r.result === 1)`
 * ——「任一掷骰落空即整体算划空」。多掷骰（双持、连击）时一中一空会被判成划空，
 * 而**画面那一侧从来不是这么取的**：`impact.mjs` 逐目标取 `results[0]` 挂 `playIf`。
 * 两侧口径不一致时，画面演的是第一掷、声音演的是「有没有任何一掷空了」，
 * 一中一空的目标会看见血花、听见划空。这里改成与画面同源的 `results[0]`。
 * `test/sound-result.test.mjs` 对一条「一中一空」的目标显式断言产出的 file。
 */
const resultOf = target => target?.results?.[0]?.result;

/**
 * 一次挥击该出的音效 cue。
 *
 * ## 为什么由 travel 槽发而不是 impact 槽
 *
 * 排音效要知道**命中时刻**（`contactMs`，见 `armory/clip-table.mjs`），而那个数只有
 * travel 槽手里有——impact 槽的 cue 本身就起于命中时刻，要让声音在那一刻**响**
 * 就得往前挪，而 cue 的 delay 不能是负数。放在 travel 槽里一切都是正数。
 *
 * travel 槽同样拿得到命中/落空：`target.results` 就在快照的目标上，`aim.missed`
 * 用的也是它。
 *
 * ## 两声的先后
 *
 * 风声的**响度峰值**排在命中前 150ms，命中音排在命中时刻。这样听起来是「唰——铛」
 * 而不是两声叠在一起。150 是留给耳朵分辨两个瞬态的间隔，不是量出来的常数。
 *
 * @param {object} s        动作快照
 * @param {object} ctx
 * @param {object} target
 * @param {number} contactMs 画面上「打中」的时刻（clipOf(...).contactMs）
 * @param {object|null} weapon
 * @returns {object[]} 0-2 条 sound cue
 */
export function strikeSounds(s, ctx, target, contactMs, weapon) {
  const out = [];

  // 命中音先算：风声要排在它之前，排不进去就不出——「铛——唰」比没有风声更糟。
  const dmg = target?.damage?.type ?? s?.usage?.damageType ?? weapon?.damageType ?? null;
  const impact = pick(ctx, resultSoundFor(resultOf(target), dmg));
  const impactAt = impact && soundAt(impact.file, contactMs);
  const impactHeard = impactAt ? contactMs + impactAt.lateBy : contactMs;

  // 元素既可能来自动作（flamingArrow 的火），也可能来自武器本身（flameStaff 的火）。
  // 取法与命中音的伤害链同源：动作优先，武器兜底。
  const swing = pick(ctx, swingSoundFor(weapon, s?.usage?.damageType ?? weapon?.damageType));
  if (swing) {
    const t = soundAt(swing.file, Math.max(0, contactMs - 150));
    const heard = t ? Math.max(0, contactMs - 150) + t.lateBy : 0;
    // 风声挤不到命中音前面就整条丢掉：这一记挥击太短，塞进去只会听成「铛——唰」
    if (t && heard < impactHeard) {
      // 挥击风声压到 −18 dB peak：它是**衬底**，不该盖过它后面 150ms 的那一下命中。
      // `?? 0.6` 是查不到时的退路（表里没有这个文件），不许静默按 1。
      out.push({kind: "sound", file: swing.file, soundRole: "swing",
                volume: gainFor(swing.file, "swing") ?? 0.6,
                delay: t.delay, startTime: t.startTime,
                duration: t.playFor});
    }
  }

  // 打偏了就该是划空声。MISS 结果层此前完全没有声音。
  // 伤害类型的取法与 impact 的元素层同源：结算写回目标的 → 动作自己的 → 武器的
  if (impact) {
    // 命中音是全场该最响的一下，目标 −12 dB peak。**够不到的不补**——volume 只能衰减
    // （Sequencer 的 clamp 到 1），19 个命中素材里 12 个连 −12 都到不了，那是素材缺口，
    // 归一化后它们照原样播，不假装。
    out.push({kind: "sound", file: impact.file, soundRole: "impact",
              volume: gainFor(impact.file, "impact") ?? 0.8,
              delay: impactAt?.delay ?? contactMs, startTime: impactAt?.startTime ?? 0,
              duration: impactAt?.playFor ?? null});
  }
  return out;
}

/**
 * 施法音，按**符文** —— 全仓最大的一个复用桶就在这里。
 *
 * ## 改造前：204 条法术里八分之六听起来是同一个施法声
 *
 * `psfx.casting` 只有 fire / earth / water / sound / generic 五支，于是只接了
 * flame / earth / storm / frost 四个符文，**其余八个（life / death / soul / oblivion /
 * control / illusion / kinesis / illumination）全部走 generic**。更糟的是 generic 那条
 * 路径 `resolve` 只解得出**一个文件**（`cast-generic-03.ogg`，上游 psfx 在 `generic/001`
 * 底下 5 个文件只注册了 1 个）——实测它一支独占全语料 550 条音效 cue 里的 **136 条 = 25%**,
 * 占 204 条吟唱的 66.7%。第二名才 32 条。
 *
 * ## 现在：12 个符文各有各的一池
 *
 * 六个元素符文取 KhronStudio「Elemental Spell Vol 1」的 `_Spell` 三连
 * （Dark / Wind / Rocks / Lighting / Fire / Ice，**同一场录音的八元素正交族**）：
 * 换符文只换音色不换气口，这正是「12 个符文听起来是一套」的物质基础，而不是
 * 十二条各录各的拼盘。其余六个符文各取语义对得上的一族。
 *
 * | 符文 | 素材 | 变体 |
 * | --- | --- | --- |
 * | flame | Fire_Spell | 3 |
 * | frost | Ice_spell | 3 |
 * | storm | Lighting_Spell | 3 |
 * | earth | Rocks_Spell | 3 |
 * | death | Dark_Spell | 3 |
 * | kinesis | Wind_Spell | 3 |
 * | soul | Ghost Breath | 5 |
 * | oblivion | Oblivion Strike（厂商原名，正好是这个符文） | 7 |
 * | illusion | Arcane Ripple | 7 |
 * | illumination | Celestial Choir | 5 |
 * | control | Ailments Hypnotize | 4 |
 * | life | Goodberry Heal | 2 |
 *
 * ⚠ **全部是 ggg 的编号子枝，必须走 `pick()`／`poolFor()`**：直接 `ctx.sound` 每条只拿得到
 * `01`，桶从 136 掉到 12×17=17 一档就停住，「太单调」只修好了十二分之一。
 * ⚠ 这一批的**有效声长比 psfx generic 长得多**（generic 620ms，这里 850-4750ms）：
 * §2.3「声音不许比画面活得久超过 800ms」的溢出会跟着涨。那一条与 §1.6（cone 的静音空洞
 * 靠这几秒填）**明确互斥**，规格要求两条一起决——所以本轮**不单独封顶**，留给那一批。
 * ⚠ `CAST_DEFAULT` 至此在本语料上一次也点不着（12 个符文全覆盖）；它仍然留着，
 * 是给「将来加了第 13 个符文」的兜底，不是死代码。
 */
export const CAST_SOUND = Object.freeze({
  flame:        "ggg-sfx.magic.fire.cast.general.05",
  frost:        "ggg-sfx.magic.ice.cast.general.01",
  storm:        "ggg-sfx.magic.electricity.cast.general.01",
  earth:        "ggg-sfx.magic.earth.cast.general.01",
  death:        "ggg-sfx.magic.occult.cast.general.06",
  kinesis:      "ggg-sfx.magic.air.cast.general.05",
  soul:         "ggg-sfx.magic.occult.cast.ghostly.02",
  oblivion:     "ggg-sfx.magic.occult.cast.blast.01",
  illusion:     "ggg-sfx.magic.arcane.cast.ripple.01",
  // Celestial Choir 有人声。备选 `ggg-sfx.magic.divine.cast.shimmer.01` 无人声、池更齐
  //（Δ1.5），但有效声长 3760-4320ms 比合唱的 2170-2360ms 长一倍，溢出更狠。
  // 取合唱：「光耀」这一支的听感辨识度是十二支里最高的，而溢出是可以被 §2.3 统一收的。
  illumination: "ggg-sfx.magic.divine.cast.general.01",
  control:      "ggg-sfx.magic.occult.curse.hypnotize.01",
  life:         "ggg-sfx.magic.primal.healing.02"
});

/**
 * 认不出元素的符文用它。`psfx.casting.generic` 在索引里其实有 4 个文件（`.001` 与
 * `.002.{001,002,003}`，**跨两层**），`resolve` 只解得出第一个；`poolFor()` 会把整池展开，
 * 所以这条兜底本身也不再是「恒定同一个采样」。
 */
export const CAST_DEFAULT = "psfx.casting.generic";

/**
 * 一次施法该出的音效 cue。
 *
 * 只出一条：施法音本身是个渐强的过程，**不按「让峰值落在某一刻」排**——那是给
 * 「打中」这种瞬态用的口径。这里 delay 0 起播，时长裁到有效声长（psfx.casting.water
 * 整段 4.1 秒，不裁会盖住后面的命中音）。
 *
 * @param {object} s 动作快照
 * @param {object} ctx
 * @returns {object[]} 0-1 条 sound cue
 */
export function spellCastSound(s, ctx) {
  if (!s?.spell) return [];
  const fx = pick(ctx, CAST_SOUND[s.spell.rune] ?? CAST_DEFAULT);
  if (!fx) return [];
  // 施法音是**床垫**，目标按 RMS 定而不是按峰值：它是一整段渐强，用峰值对齐会被段内
  // 单个爆点带偏（`Ice_spell 3` 的峰值落在 2000ms，同池另两条在 560/730ms）。
  //
  // ⚠ duration 走 `contentEndOf` 而**不是** `soundAt(f, 0).playFor`：这条 cue 从素材第 0
  // 毫秒起播（delay 0、不写 startTime），而 `soundAt` 在「目标时刻早于峰值」时返回的
  // playFor 是配套它自己那个 `startTime = onsetMs` 的。只取 playFor 不取 startTime，
  // 播出窗就短一个 onsetMs，从**尾巴**上削掉同样长的有声内容。psfx 施法族起音 0-30ms，
  // 正好躲过守卫的 30ms 容差；换成起音 0-130ms 的 ggg 施法族后一次露出 31 条。
  return [{kind: "sound", file: fx.file, soundRole: "cast",
           volume: gainFor(fx.file, "cast") ?? 0.55,
           delay: 0, duration: contentEndOf(fx.file)}];
}

/**
 * 法术打中 / 打空的音效 cue。
 *
 * 与 `strikeSounds` 的区别只有一条：**不出挥击风声**——法术没有挥击。命中音走同一张
 * `HIT_SOUND` 表（按伤害类型），落空走同一条划空声。
 *
 * 法术的伤害类型在**目标身上**：`usage.damageType` 对法术恒为 undefined（Crucible 的
 * models/spell-action.mjs 不写它），结算把符文的伤害类型写进 `target.damage.type`。
 *
 * @param {object} s 动作快照
 * @param {object} ctx
 * @param {object|null} target
 * @param {number} contactMs 画面上「打中」的时刻（= 该规则的 duration + waitUntilFinished）
 * @returns {object[]} 0-1 条 sound cue
 */
export function spellImpactSound(s, ctx, target, contactMs) {
  if (!s?.spell || !target) return [];
  const dmg = target.damage?.type ?? s.usage?.damageType ?? null;
  const fx = pick(ctx, resultSoundFor(resultOf(target), dmg));
  if (!fx) return [];
  const t = soundAt(fx.file, contactMs);
  // 与 `strikeSounds` 的命中音同一个角色、同一个目标档：法术打中和刀砍中都是「打中」，
  // 从前这里是 0.7、那边是 0.8，同一件事在两条规则上差 1.2 dB 纯属手挑常数的偶然。
  return [{kind: "sound", file: fx.file, soundRole: "impact",
           volume: gainFor(fx.file, "impact") ?? 0.7,
           delay: t?.delay ?? contactMs, startTime: t?.startTime ?? 0,
           duration: t?.playFor ?? null}];
}
