# Task 11 修复报告：impact 槽的双闪、掠过缩放与元素区分度

分支 `v1-implementation`，起点 `7b71fa7`（133/133）。五组设计规格合并落地为一次提交。
最终 **163/163 通过**（133 原有 + 30 新增），全量语料 `plan.warnings` 恒为空、降级率 0%。

本报告的所有数字都是**在本仓库现场复算/复测**得到的，没有直接采信规格里的数值；与规格
不符的地方逐条在下文标出。

---

## 0. 合并后的最终形态（一页速览）

`scripts/armory/impact.mjs`：

| 结果 | 素材 | canvas | weight | 下发 objectScale | startTime/duration | fadeIn/fadeOut | flash 窗口(相对素材 f0) |
|---|---|---|---|---|---|---|---|
| HIT | jb2a.impact.005.white | 1 | 1.0 | **1** | 0 / 550 | 0 / 100 | [0, 200) at 33 |
| GLANCE | blfx.spell.impact.flash.color1 | 0.35 | 0.6 | **0.21**（旧 0.25） | 0 / null | 0 / 67 | [100, 233) at 200 |
| ARMOR | jb2a.impact.011.yellow | 1 | 0.8 | 0.8 | 467 / 266 | 0 / 67 | [0,133) → 被 startTime 裁光 |
| BLOCK | jb2a.shield.02.outro_explode.blue | 1 | 0.9 | 0.9 | 267 / 1233 | 150 / 200 | null |
| PARRY | blfx…blades_clash1.color1 | 1/3 | 0.9 | 0.3 | 0 / 1700 | 0 / 300 | [267, 2867] sustained |
| RESIST | jb2a.extras.tmfx.inpulse.circle.02.normal | 1.4 | 1.0 | 1.4 | rate 2 | 0 / 150 | null |
| DODGE | jb2a.teleport.01.white | 0.8 | 0.8 | **0.64**（旧 0.65） | 0 / 333 | 0 / 67 | null |
| MISS | jb2a.ui.miss.white | 2 | 0.7 | 1.4 | 0 / 1467 | 0 / 100 | null |

元素层（`scale × weight × sizeScale()`，zIndex 55，`delay = 结果层 selfFlash.to`）：

| 伤害类型 | 素材 | scale | startTime/duration | fadeIn/fadeOut |
|---|---|---|---|---|
| bludgeoning/piercing/slashing | jb2a.liquid.splash.red | 0.9 | – / null | 0 / 300 |
| fire / cold / acid / **poison(purple)** / radiant / psychic / corruption | eskie.damage.\*.01.\* | 0.45 | 234 / 266 | 60 / 0 |
| electricity | eskie.damage.electricity.01.blue | 0.45 | **267** / 233 | 60 / 0 |
| void | **jb2a.impact.012.dark_purple** | 0.9 | 0 / 533 | 0 / 67 |

---

## 1. 五组各落地了什么

### 1.1 glance-scaling —— 全部采纳
- `RESULT_LAYER.scale` 拆成 `RESULT_WEIGHT`（8 种结果的语义权重，两层共用）+ `canvas`
  （画布归一化）。新增 `r6`、`weightOf`。
- 结果层 `objectScale = r6(weight × canvas × sizeScale())`；元素层
  `objectScale = r6(el.scale × weight × sizeScale())`。
- `generic.impact` 里第三份 `0.6` 字面量改用同一张权重表。
- **复算结果**（实跑 HEAD vs 新版逐条对照）：结果层 8 种结果只有 GLANCE `0.25→0.21`、
  DODGE `0.65→0.64` 变化，其余 6 条逐字不变；元素层 GLANCE 从「与 HIT 相等」变成
  HIT 的 0.600（12 种伤害类型逐一验过，全部恰为 0.600）。

### 1.2 double-flash —— 采纳方案 B（裁掉元素层自带白闪）+ 派生式交棒 + zIndex，D 作失效保护
- `flash.mjs` 新增 `trimFlash()`；两张表新增 `flash` 字段（ASSET-NOTES 第 8 列的机器
  可读版）；两张表改为具名导出。
- 8 支 eskie 用 `startTime` 裁掉 f0-f6（通用切点 f7=234ms，electricity 例外 f8=267ms）。
- 元素层 `delay` 从写死的 60 改为 `resultFlash?.to ?? 0`（HIT 200 / GLANCE 233）；
  `zIndex` 65 → 55。
- void 换 `jb2a.impact.012.dark_purple`，`duration: 533` 砍掉 f23-f31 的三下孤立亮弧。
- `armory-flash.test.mjs` 新增 T4/T5/T6。

### 1.3 fade-timing —— 采纳判据与 21 条显式 fade，但 8 支 eskie 的数值按裁剪后重算
- 结果层 8 条 + generic 兜底的 fadeIn/fadeOut 逐条落地（数值与规格一致，见上表）。
- `armory-impact.test.mjs` 新增 `ASSET_MS` 时长表（两道交叉校验）、`MAX_FADE_RATIO=0.30`
  预算断言、「被截断的 cue 必须有 fadeOut」、「eskie 元素层的 fade 形态」。

### 1.4 element-distinctness —— 采纳换色与三层守卫，阈值按本仓库实测重定
- `poison` 由 `eskie.damage.poison.01.green` 改为同支 `purple`；ASSET-NOTES 补一整行
  九列记录（主表 94 → 95 行）。
- 新增 `test/armory-element-distinct.test.mjs`（9 条）与 `tools/element-residual-colour.mjs`。
- `armory-impact.test.mjs` 里 `assert.ok(seen.size >= 5)` 收紧为 `assert.equal(seen.size, 10)`。
- **不采纳** 给 psychic 加 opacity/objectScale 补偿（见 §3.3）。

### 1.5 fixture-coverage —— 采纳回退链修复与法术/reactiveStrike 语料，删掉了两处冗余
- `impact.mjs`：新增 `DAMAGE_ALIAS`、纯函数 `elementFor()`（按「查不查得到」而不是
  「是不是空」逐级回退）、`ctx.warn` 留痕、cue 上新增 `element` 标注字段。
- `tools/dump-fixtures.mjs`：新增 `RUNE_DAMAGE` / `RUNE_RESOURCE` / `DEFAULT_STRIKES`，
  `baseSnapshot` 接受 `dealt`；法术按符文写 `targets[].damage`、reactiveStrike 按源码
  补回单体目标与武器。
- `coverage.test.mjs` 新增 12/12 元素覆盖 + element 标注一致性；`source-tables.test.mjs`
  新增符文表与 `ELEMENT_LAYER ↔ DAMAGE_TYPES` 两条源码锁定。
- `docs/DESIGN.md` §6.2 cue 字段清单补 `layer` / `element`。

---

## 2. 组间冲突与取舍

### 2.1 double-flash × fade-timing：eskie 的 fade（**最主要的冲突**）
fade-timing 在 risks 里断言「对 501ms 的素材做 startTime 裁剪，与『有任何 fade』不可
兼得」，并给出 8 支 eskie 的 `fadeIn:0 / fadeOut:67-100`（那是**未裁剪**前提下的数值）。

复算后这个断言不成立：裁到 f7 后有效时长 266ms、30% 预算 79.8ms，double-flash 给的
`fadeIn:60 / fadeOut:0` 只占 60ms，绰绰有余。fade-timing 之所以算出 117ms > 90ms，是因为
它同时要求一个 67ms 的 fadeOut——而 `duration` 已经补到素材自然收尾（234+266=500 ≈ 全长
501），末尾不是硬切，`fadeOut` 在这里是二次衰减。**采纳 double-flash 的裁剪 + 60/0**，
并把 fade-timing 的「被 duration 截断的 cue 必须有 fadeOut」写成断言（它对 void/HIT/
ARMOR/PARRY/DODGE/MISS 生效，对裁到自然收尾的 eskie 恰好不生效——这正是它的设计意图）。

残留代价（记在 §4）：cold 的末帧 alpha 均值 12.7/255（峰值的 19%），poison.purple 7.6，
其余 ≤4.0。fade-timing 原方案想给 cold/poison 100ms 的 fadeOut 收尾，裁剪后的预算给不起
（60+100=160 > 79.8），我选择保持八支统一的 60/0 并把这一处记为待上机复检项，而不是为
一条素材破例把 `MAX_FADE_RATIO` 提到 0.35。

### 2.2 double-flash × fade-timing：void 的 fadeIn
fade-timing 给 void `fadeIn: 67`，理由是「011 是唯一一支 f0 就是完整画面的元素素材」。
double-flash 把 void 换成 012 之后这个理由消失：实测 012 的 f0 全画幅 alpha 均值只有
**6.1**（011 是 41.4），本体峰值在 f3=32.4——它自带起手渐强。所以最终 void 是
`fadeIn: 0`。同时 `duration` 取 **533**（f16，alpha 均值 2.8）而不是 double-flash 提的
500：500ms 落在 f15，而 fadeOut 起点会压到 f12/f13 两个亮帧（27.9/28.0）；533 + fadeOut 67
让淡出骑在 f14→f16 的 7.1→6.7→2.8 自然衰减上。预算 12.6%。

### 2.3 double-flash × element-distinctness：都改素材，但改的不是同一条
double-flash 改 void（011→012），element-distinctness 改 poison（green→purple）。互不重叠，
两条都采纳。两者反而互相加强：裁掉 f0-f6 之后元素层**只播残留段**，而残留段的颜色正是
element-distinctness 的判据——所以我把残留取样窗口从规格的 f6-f14 改成 **f7-f14**（与
实际播出的片段逐帧对齐），并据此重测了全部 lab 常量。

### 2.4 element-distinctness × 阈值：`MIN_DELTA_E` 从 12 改为 11.5
规格给的三个锚点（9.5 / 11.2 / 13.7）在本仓库复测得到的是 **9.7 / 14.3 / 12.4**——
cold/electricity 实测 14.3 而不是 11.2，poison.purple/psychic 实测 12.4 而不是 13.7，
两者的大小关系甚至反了。按规格的 12 会让「豁免条目被删掉时应变红」这条推理落空，也几乎
没有余量。我改用自己的三个锚点重新夹阈值：
- 9.7 acid.green / poison.green（要修掉的那一对）
- 10.8 poison.green / radiant.yellow（同一次修复顺带解掉的第二紧一对）
- 12.4 poison.purple / psychic.pink（修完后同族最紧）

阈值必须落在 (10.8, 12.4]，取 **11.5**，两边各留 0.7-0.9。破坏实验证实：把 poison 改回
green，这条断言报出 `acid 对 poison：ΔE00 = 9.7 < 11.5` 与 `poison 对 radiant：10.8 < 11.5`。

### 2.5 glance-scaling × double-flash：全量用例的判据要收紧
glance-scaling 的「全量攻击动作：掠过与命中绝不只差一个 playIf」在合并后被 double-flash
的派生式 delay **意外救活**了：HIT 的 `delay=200`、GLANCE 的 `delay=233`（派生自各自的
闪爆窗口），于是即使把元素层的语义权重整个拿掉，两组 cue 仍然「有差异」。实测确认：
按规格原样写，M1（元素层丢权重）只红 3 条而不是 4 条。

修正：把 `delay` 从 `VISUAL_KEYS` 白名单里剔除并写明理由——同一段画面晚播 33ms 不是
「这一下更轻」的表达。剔除后 M1 报
`spell.control.arrow/fire：掠过与命中只差 delay，没有一项会改变画面`，那一档重新守住。

### 2.6 fixture-coverage × 其余四组：先做，作为其它组的语料底座
按建议顺序先落地。它把语料的元素层覆盖从 3/12 提到 12/12，是 double-flash 的 eskie 裁剪
与 element-distinctness 的换色在**全量语料**上第一次被真正跑到的前提——否则语料里
380/392 条元素 cue 都是血溅，那两组的改动在 coverage/flash 断言里几乎不可见。

---

## 3. 未采纳的规格条目及理由

### 3.1 fade-timing：8 支 eskie 的 `fadeIn:0 / fadeOut:67-100`（未裁剪版）
见 §2.1。它与 double-flash 的裁剪互斥，且其「不可兼得」的论证在复算下不成立。

### 3.2 fade-timing risks 里提的 `jb2a.liquid.splash.red` 加 `duration: 2700`
不做。它写在 risks 而不是 changes 里，属于「顺手量出来的、不归 fade 管」的时长问题，改它
会牵动物理三系（语料里占比最大的一支）的整体节奏，应当单独一次提交并配目视复核。

### 3.3 element-distinctness：给 psychic 压 opacity / objectScale
不做，并按规格的建议**订正了 ASSET-NOTES 的处方**。理由复测确认：所谓「盖脸」是整个
eskie.damage 模板 f1-f6 的家族属性（八支 f5 峰值全帧 alpha 均值 65-80/255，psychic 的
77.9 只是中上），不是 psychic 专属；而本轮的 `startTime: 234` 已经把 f0-f6 整段裁掉，
遮挡最重的几帧根本不播。单压 psychic 还会削掉刚拉开的色差。

### 3.4 fixture-coverage：给 strike / reactiveStrike 写 `dealt`
不做。规格让默认挥击动作也写 `targets[].damage`，但那样 `elementFor` 的第 1 级就会抢先，
新加的第 3 级（主手武器）在真实语料上永远跑不到。保持 `damage: null`，让 slashing /
piercing 两支正好由第 3 级回退产出——这既是更小的语料改动，也让新代码路径有语料覆盖。
（破坏实验 M15 证实：把 `elementFor` 退回 `??` 链，覆盖断言立刻报
`2 种伤害类型的元素层从未被语料跑到：piercing、slashing`。）

### 3.5 fixture-coverage：按 restoration 建模 life/soul，以及修 `usage.isAttack` 判据
两条都不做，理由与规格一致并已写进 `tools/dump-fixtures.mjs` 的注释：单做 restoration 会
让 poison 失去语料里唯一的攻击侧来源（12/12 掉到 11/12）；修 isAttack 判据影响 275/432
条 plan、涉及整槽换规则，属于「重新定义语料语义」，应当独立评审。`source-tables.test.mjs`
新增的断言会在源码 restoration 集合变化时先红，逼着复核这段简化。

### 3.6 glance-scaling：GLANCE canvas 改成实测的 0.28
不做（与规格的建议一致）。0.35 是 ASSET-NOTES 记录的值，改它属于推翻该行记录，按本仓库
纪律应当先订正记录再改代码，单独一次提交。当前 `0.6 × 0.35 = 0.21` 是拆表后自动落出来
的，不是又一个手调常量。

### 3.7 双闪相关：`generic.impact` 让位让过头（4 条投掷类非攻击动作 impact 为空）
复算发现 `flashOfSteel` / `interruptingThrow` / `ricochet` / `penetratingThrow` 四条
（`isAttack=false` + `strike.thrown` 自带闪爆）解析出 **0 条 impact cue**。这是 HEAD 就
存在的行为、且逻辑上说得通（travel 已经在目标身上闪过），不在本轮五组规格的 changes 里，
故不改。新加的全量用例只覆盖 `isAttack === true` 的动作，不会误伤它；但它是一条值得单独
处理的遗留（见 §6）。

---

## 4. 回归复算（全部现场重跑，不采信规格数字）

### 4.1 覆盖率与总量
| 指标 | HEAD `7b71fa7` | 本次 | 判定 |
|---|---|---|---|
| 动作 fixture 数 | 434 | 434 | ✅ 434/434 全部解析出 ≥1 cue（empty=0） |
| 状态 fixture | 46 | 46 | ✅ 46/46 全部解析出持续特效 |
| 零目标攻击动作 | 53 | 53 | ✅ 53/53 全部有 cast cue |
| cue 总数 | 1685 | **1690** | +5（见 4.3） |
| 降级次数 / 降级率 | 0 / **0.00%** | 0 / **0.00%** | ✅ 远低于 15% 阈值，未放宽 |
| `plan.warnings` 总数 | 0 | **0** | ✅ 新增的 warn 通道在正常语料上不响 |
| travel `ray/cone/pulse/surge` 每动作 cue 数 | 各 1 | **各 1** | ✅ Task 10 的修复未被弄坏 |
| impact 每动作 cue 数分布 | {0:118, 2:132, 4:184} | **{0:117, 2:132, 4:185}** | reactiveStrike 从 0 变 4 |
| 元素层覆盖（按 `cue.element`） | **3/12** | **12/12** | 见 4.2 |

### 4.2 元素层覆盖（全量语料，按 `cue.element` 计数）
- HEAD：`{bludgeoning:380, psychic:6, void:6}` = **3/12**
- 本次：`{bludgeoning:92, psychic:84, void:32, corruption:26, acid:26, fire:26, cold:26,
  radiant:26, poison:26, electricity:26, piercing:2, slashing:2}` = **12/12**

### 4.3 HEAD vs 本次的逐 cue 差异（按 slot/rule/layer/目标/kind 配对）
- 316 / 432 条非空 plan 有变化。
- 结构变化只有 reactiveStrike 一条动作：`-1 cast/generic.cast`、`+2 travel/strike.melee`、
  `+2 impact/impact.layered/result`、`+2 impact/impact.layered/element` = 净 +5 cue。
  （cast 那条消失是既有逻辑：`generic.cast` 对「isAttack 且有目标」返回 null。）
- 逐字段差异计数：`fadeIn` 998、`fadeOut` 904、`zIndex` 392、`delay` 392、
  `element` 392（新字段）、`duration` 298、`file` 292、`startTime` 266、`objectScale` 260。
- 其余四槽（cast/travel/aftermath/persist）对 reactiveStrike 以外的所有动作**零变化**。

### 4.4 结果层 objectScale 逐条对照（HEAD → 本次）
`MISS 1.4→1.4`、`DODGE 0.65→0.64`、`PARRY 0.3→0.3`、`BLOCK 0.9→0.9`、`ARMOR 0.8→0.8`、
`RESIST 1.4→1.4`、`GLANCE 0.25→0.21`、`HIT 1→1`。
元素层（fire）：`HIT 0.45→0.45`、`GLANCE 0.45→0.27`。
**只有 GLANCE 与 DODGE 变化，结果层没被弄坏。**

### 4.5 双闪：全量语料每目标的自带闪爆条数
1284 个命中类（HIT/GLANCE）目标 × 锚点：**恰好一条 1284 / 零条 0 / 两条及以上 0**。
来源分布 `impact/impact.layered/result` 740 + `impact/generic.impact` 480 + `travel` 64。

### 4.6 12 种伤害类型两两可区分性
- **结构层**：9 种元素类型的 `file|hue` 两两不重复（hue 全为 null，元素层不经动态染色）；
  物理三系正向断言「必须完全相同」。
- **同模板家族（eskie.damage 八支）残留主色 CIEDE2000**（f7-f14，`tools/element-residual-colour.mjs`
  现场实测，升序）：
  `12.4 poison/psychic`、`14.3 cold/electricity`、`17.7 acid/corruption`、`18.2 acid/radiant`、
  `21.0 fire/radiant`、`25.5 radiant/corruption`、`26.8 cold/corruption`、`36.4 cold/psychic`
  …… 最大 102.8。**全部 ≥ 11.5 阈值。**
  修复前最紧的三对是 `9.7 acid/poison`、`10.8 poison/radiant`、`12.4 fire/…`——前两对已消除。
- **cold / electricity 共用 blue 分支**：记名豁免。实据是残留形状差异足够大（f7-f14 的
  alpha 平面 PSNR 只有 **12.3 dB**，八支两两之间最低；被判为真撞车的 acid/poison.green
  反而是 14.5 dB），且色差 14.3 本来就在阈值之上——豁免只解除「同色分支不许复用」这条
  结构规则。四条替代路全部实测堵死：`electricity.purple` 对 psychic.pink 只有 5.3、
  `electricity.yellow` 对 radiant.yellow 只有 3.4、`cold.white` 被 ASSET-NOTES 明文否掉、
  `cold.darkpurple` 裁掉 f0-f6 后在暗底上「亮度抬升 ≥40 的像素占比」f7-f14 **恒为 0.0%**
  （与已否决的 `necrotic.black` 同类）。
- **跨家族**（血溅 / eskie 爆环 / jb2a.impact.012 暗环）不做色差判定：形状本身已经分开。

### 4.7 测试
`npm test`：**163 pass / 0 fail**，耗时 2.48s（基线 133 pass / 1.85s）。
中间态实测：**只打代码补丁、不动测试，仍然 133/133 全绿**——现有套件对本轮五个缺陷零守护。

---

## 5. 破坏实验（每条都实跑，括号内是实际输出）

在 `mktemp -d` 出来的仓库副本上逐条改回去（`node_modules` 软链回真仓库）。

| # | 变异 | 变红的用例 | 实际失败信息 |
|---|---|---|---|
| M1 | 元素层丢掉语义权重（`el.scale * sizeScale()`） | 4 条 | `spell.control.arrow/fire：掠过与命中只差 delay，没有一项会改变画面` |
| M2 | GLANCE `canvas` 调回旧下发值 0.25（0.416667） | 1 条 | `结果层归一化后掠过是命中的 0.714286，§6.5 要求 0.6` |
| M3 | fire 元素层删掉 `startTime`（自带白闪回来） | T5 + T6 | `只有 7 条元素层素材被裁过`；`52 处双闪`：`spell.flame.arrow …2 层同时在目标身上闪——travel/spell.gesture.arrow/- + impact/impact.layered/element` |
| M4 | void 退回 011 且不申报 flash | 3 条 | `impact 槽用到 Impact_11_Dark_Purple_400x400.webm（规则 impact.layered/element）但时长表里没量过它`；T4 与 PALETTE 对齐同时红 |
| M5 | 结果层不申报 `selfFlash` | T6 | `740 个命中类目标一次都不闪，命中反馈丢了`（下界断言生效；只用上界会漏） |
| M6 | 元素层 `zIndex` 改回 65 | 1 条 | `bludgeoning/7：元素层 zIndex 65 不在结果层 60 之下` |
| M7 | 元素层 `delay` 改回写死的 60 | 1 条 | `bludgeoning/7：元素层 delay 60 早于结果层自带闪爆的熄灭时刻 200` |
| M8a | poison 退回 green（PALETTE 不动） | 2 条 | `poison: ELEMENT_LAYER 换了素材，但本文件的 PALETTE 没跟着改…` |
| M8b | poison 与 PALETTE 一起退回 green | 3 条 | `acid 对 poison：ΔE00 = 9.7 < 11.5`；`poison 对 radiant：ΔE00 = 10.8 < 11.5`；同色分支复用同时红 |
| M9 | 语料退回 HEAD | 1 条 | `8 种伤害类型的元素层从未被语料跑到：acid、cold、corruption、electricity、fire、piercing、poison、radiant` |
| M10 | `RESULT_WEIGHT[GLANCE]` 改成 1.0 | 4 条 | `结果层归一化后掠过是命中的 1，§6.5 要求 0.6` |
| M11 | eskie 元素层删掉 fadeIn/fadeOut 两列 | 2 条 | `fadeIn/fadeOut 必须是数字——兵库表里漏写会让 undefined 覆盖掉 CUE_DEFAULTS` |
| M12 | 元素层背回 `CUE_DEFAULTS` 的 200/300 | 2 条 | `fade 预算 200+300=500ms 超过有效时长 266ms 的 30%——主体会被吃掉` |
| M13 | `generic.impact` 退回硬编码三元 `0.6` | 1 条 | `MISS 的语义权重应当比 DODGE 更轻（§6.5：0.7 vs 0.8）` |
| M14 | 元素 cue 去掉 `element` 标注 | 6 条 | 回退链四条 + 覆盖断言 + 标注一致性 |
| M15 | `elementFor` 退回 `??` 判空链 | 4 条 | `未知类型应当被跳过，而不是遮蔽掉后面有效的一级`；`2 种伤害类型的元素层从未被语料跑到：piercing、slashing` |

**M13 与 M1 是两次自我修正的产物**：初版规格照抄下来时这两条变异都不会变红
（M13 根本没有用例覆盖 `generic.impact` 的权重；M1 被派生 delay 救活）。补了
「非攻击兜底与结果层共用同一张权重表」一条用例、并把 `delay` 移出 `VISUAL_KEYS` 之后才捕获。

---

## 6. 现场实测数据（本轮自测，不是抄规格）

解码一律 `ffmpeg -c:v libvpx / libvpx-vp9`（默认解码器不解 WebM 的 alpha 平面）。
指标：`aMean` = 全画幅 alpha 均值；`L%` = 归一出光量 Σ(alpha×luma)/(255²·px)；
`W%` = 低饱和(<25%)·高亮(luma>200)·不透明(alpha>150) 像素占比。

- **`jb2a.impact.005.white`（HIT，25f@30fps/833ms）**：`L%` f0=f1=**18.0**、f2=1.9、f3=4.5、
  f4=5.0、f5=4.3、f6=3.3，f7 起 ≤3.2 单调衰减；`W%` f0=f1=**14.9**、f4 只有 3.0。
  ⇒ ASSET-NOTES 记的「真正的星形爆闪在 f4」是低估，白光段是 f0-f6 整段；`fadeIn` 必须为 0。
- **8 支 eskie.damage（15f@29.97fps/501ms/800x800）**：`W%` 峰值全部在 **f5**
  （fire 25.1 / cold 20.0 / electricity 24.8 / acid 21.7 / poison green 19.5 · purple 19.6 /
  radiant 28.4 / psychic 28.3 / necrotic 24.1），f6 降到 4.3-22.7，**f7 全部 ≤5.2**
  （cold 的 5.2-9.3 是冰晶自身白高光，持续到 f12，不是模板白闪的尖峰）。⇒ 通用切点 f7=234ms。
- **`jb2a.impact.011.dark_purple`（33f）**：`W%` **33 帧恒为 0.00** —— 它根本不出白光，
  `L%` 峰只有 f2=4.2。规格「011 与结果层是两次爆发/黑芯挖洞而不是两次白闪」经证实。
- **`jb2a.impact.012.dark_purple`**：f0 `aMean` 6.1（011 是 41.4），峰值 f3=32.4；
  f7 起两支逐帧 `aMean` 绝对差 ≤2.2；f24/f26/f29 = 20.8/19.8/5.7（三下孤立亮弧，
  被 `duration:533` 切掉）。
- **`blfx.spell.impact.flash.color1`（GLANCE，15f）**：主爆闪 f3-f6（`L%` 8.8/11.5/16.5/17.6），
  f8-f9 与 f11-f12 两拍余震。⇒ flash 窗口 [100, 233)。
- **`jb2a.impact.011.yellow`（ARMOR）**：白闪 f0-f3（`W%` 6.4/10.4/6.9/5.1），f4 起 ≤2.6。
  ⇒ flash [0,133)，被 `startTime:467` 整段裁掉。
- **`blfx…blades_clash1.color1`（PARRY）**：`L%` 从 f8 的 2.6 缓升到 f40-f44 的 7.7 再缓降，
  是持续辉光而非一次爆闪 ⇒ 按 `sustained` 记。
- **全部 18 条素材的 ffprobe 时长/帧数/帧率**逐条复核，与 `ASSET_MS` 表和 ASSET-NOTES
  的帧数列三方一致（帧率实测确为 24 / 29.97 / 30 三种混用）。
- **poison green vs purple**：alpha 平面 PSNR 全片 **45.6 dB**、残留段 44.4 dB（纯换色）；
  残留主色 `green (219,255,78) L=94.8` → `purple (169,48,248) L=48.7`；
  暗底可见度（合成到 0x1a1a1a、亮度抬升 ≥40 的像素占比）f7-f11 `green 30.8→16.0` 对
  `purple 7.4-9.5`，f5 白闪帧两者同为 40.5%。

---

## 7. 遗留问题与风险

1. **未上机实测。** `scripts/player/` 仍是空的（Task 13/15），全部结论都是离线逐帧推演。
   尤其是 Sequencer 在 `duration:null + playbackRate:2` 时是否真把墙钟时长算成 900ms
   （RESIST 的 fade 预算分母依赖这个假设）。
2. **poison.purple 在暗底上比 green 暗一档。** 这是本轮唯一的实质观感代价，数据已完整写进
   ASSET-NOTES 新增行。它没有掉进 `necrotic.black` 那条否决线，但暗色地牢图上的第一印象
   会比绿版弱，须上机复核。
3. **8 支 eskie 统一 `fadeOut: 0`。** cold 的末帧仍有峰值 19% 的亮度（`aMean` 12.7/255），
   poison.purple 11.6%，其余 ≤5%。裁剪后的 79.8ms 预算给不起一个像样的 fadeOut，暂记为
   待上机复检项；若上机确认 cold 收得生硬，正解是把 cold 的 `duration` 往前收一帧并配
   30-40ms 的 fadeOut（此时它变成「被截断」，测试会强制要求 fadeOut > 0）。
4. **`MIN_DELTA_E = 11.5` 是刻意的脆性**，两边余量只有 0.7-0.9。往后任何一次元素层换色都
   可能触到它——那正是它存在的意义（换色必须重新量残留主色）。注释里写死了三个锚点，
   改阈值的人会先读到理由。
5. **`PALETTE.lab` 是测量常量**，若上游更新了 webm 内容而 DB 路径不变，它会静默过期。
   第 2 层对齐测试只校验 `file` 一致，抓不到「同一个文件内容变了」。缓解手段是
   `tools/element-residual-colour.mjs` 可随时重算，但没有自动化（素材不在仓库里）。
6. **4 条投掷类非攻击动作（`flashOfSteel` / `interruptingThrow` / `ricochet` /
   `penetratingThrow`）解析出 0 条 impact cue**，是 HEAD 就有的行为（`generic.impact`
   给 travel 的自带闪爆让位、让过头）。本轮不改；若判定需要保留一层命中反馈，正解是让
   `generic.impact` 在让位时改出一层不带闪爆的素材，而不是取消让位。
7. **reactiveStrike 的语料语义变了**（从 target:self 变成 single + 带武器）。有源码依据
   （`const/action.mjs:1496` 的 `target: {type:"single", number:1, scope:3}` 与
   `models/actor-base.mjs` 的 `#prepareDefaultActions` 补 melee/ranged 标签），但它是本轮
   唯一一处「改变了某条 fixture 是什么」的改动，且顺带让该动作失去 cast cue。
8. **`element` 是 cue 上的新字段**，会进入广播到各客户端的聊天卡 flag。当前无消费方
   （`scripts/player/` 为空），体积增量可忽略（每条元素 cue 一个短字符串）。
9. **元素层三级回退的第 3 级只看主手**（`strikes[0]`），与 `snapshot.mjs`「取伤害量最大的
   一条」不同口径。实战里第 1 级总会先命中，这一级只在「快照早于结算」或「该动作没产生
   伤害事件」时才生效，此时也确实没有「量最大」可言。已写进注释。
10. **两处规格提到、本轮明确留给后续的独立任务**：`usage.isAttack` 判据漏了 crucible 的
    标签传播（`melee/natural → strike → isAttack`，影响 275/432 条 plan）；`life/soul`
    符文的 restoration 建模。两者必须一起做，单做后者会让元素层覆盖从 12/12 倒退到 11/12。
