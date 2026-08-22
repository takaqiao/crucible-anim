# Task 10 修复落地报告

四组并行设计规格（`once-mechanism` / `geometry` / `double-flash` / `test-harden`）的合并落地。
基线 HEAD `a981f2c`、92/92；落地后 **122/122 全绿**，覆盖率与降级率零退化。

规格里的所有数字都**重新独立复算过**，素材类结论一律自己抽帧重测（见「素材实测复核」），
与规格不符的地方以本报告为准。

---

## 一、四组各落地了什么

### 1. once-mechanism —— 解析器级 `once: true`

`scripts/resolver/resolve.mjs`：

- S2–S4 的双层循环从「目标为外层 / 槽为内层」翻成「槽为外层 / 目标为内层」，
  `firstMatch` 提到循环外，每槽只选一次规则。顺带修掉 `when()` 告警按目标数重复 N 遍的老毛病。
- 新增 `rule.once === true` 分支：整个动作只调一次 `build`，默认锚点 `{ref: "origin"}`，
  代表目标 `targets[0] ?? null`，**不看 `targets` 是否为空**——区域法术没罩住人、
  自身增益本来就没有目标，画面都仍然该有。
- 新增 `runBuild()`：给 `build()` 套 try/catch，抛异常时降级成一条 warning 而不是把整个
  `resolve()` 带崩。这是 `once` 的配套加固——`once` 把 `build` 的输入域扩大到「代表目标可能是
  null」，正是最容易踩空的新路径。配套断言见第四节（没有断言的加固是净负收益）。
- `CUE_DEFAULTS` 增加 `selfFlash: null`（double-flash 用）。

`scripts/armory/travel.mjs`：`ray` / `cone` / `pulse` / `surge` / `blast` 五条置 `once: true`；
`arrow` / `melee` / `unarmed` / `thrown` / `generic.travel` 保持每目标一份。
`pulse` 与 `surge` 删掉解引用目标的 `aim`（surge 那条自指 `aim.towards = s.origin` 在锚点变成
施法者之后就是 `atan2(0,0)` 的退化旋转），两条规则头上与现实相反的注释块一并改写。

`generic.travel` **明确不加 once**，判据连同数字写进注释：它命中的 96 个动作里 46 个每目标一发
是对的（45 个 `target.type === "single"` + fanOfArrows 箭雨），50 个混了区域语义
（aura 24 / fan 12 / step 12 / penetratingShot 1 / steamVent 1）。给终极兜底翻旗标会把 46 个
正确用例一起打坏——那 50 个要的是补几条自带 `once` 的区域规则挡在兜底之前。

`docs/DESIGN.md` §6.4 的规则契约行同步：`{id, pri, once?, when(s), build(s, ctx, target, built)}`。

### 2. geometry —— 模板端点、张角与偏移折半

`scripts/armory/travel.mjs` 顶部新增四个有名字、有依据、可单测的助手：
`DEG` / `r6()` / `templateEnd()` / `CONE_SPRITE_HALF_TAN` / `CONE_YSCALE_MAX` / `coneYScale()` /
`templateAnchor()`。

- **端点按 rotation 算**：`cone` 从前写死 `{x: region.x + radius, y: region.y}`，等价于把
  rotation 当成恒 0。fixture 的 rotation 全是 0 所以测试照样全绿，实战里玩家每次放置都由鼠标
  定向（`directionDelta = 15°`，24 个朝向里只有 1 个是对的）。
- **ray 拉到模板末端而不是 `targets[0]`**：fixture 里模板 400px、第一个目标在 100px 处，
  旧代码把光束截成 1/4，`mask: "region"` 形同虚设。
- **张角按半宽之比而非角度之比**：`(angle ?? 60) / 60` 有两处错，详见下节实测。
  60° → `1.154701`，120° → `3.464102`，正好等于贴图自身张角时 → `1`。
  超过 `CONE_YSCALE_MAX = 4` 截断并 `ctx.warn` 留痕。
- **锚点摆回模板起点**：`at: templateAnchor(s)` = `{ref: "origin", x: region.x, y: region.y}`。

`test/armory-travel.test.mjs` 的「大体型施法者的挥击放大且偏移折半」重写成四点具体数值
（`bigNear 1.5` / `bigFar 0.75` / `small 0.5` / `objectScale 1.4`）加 `gridUnits` 断言——
原来的单调比较 `bc.offset.x > sc.offset.x` 分不出「折半」和「不折半」。

`tools/dump-fixtures.mjs` 的 `TARGET_REGION` 加一段盲区注释（不改数据、不重跑抽取）。

### 3. double-flash —— 自带闪爆的交接协议

- 新建 `scripts/armory/flash.mjs`：`FLASH_ANCHORS` 与 `coveringFlash(built, anchor)`，
  把 ASSET-NOTES 的「凡标『是』的，S3 再叠通用闪光层就是双闪，两者必须二选一」这条散文
  变成机器能查的东西。
- `resolve.mjs` 把「同一目标可见的前序槽 cue」作为第 4 个形参 `built` 交给后面槽的 `build()`。
  `once` 规则的产出不属于任何单个目标、对每个目标都可见（`shared`），每目标规则的产出只对
  该目标可见（`perTarget[i]`）——与测试里的 `byTarget()` 同构。
- `impact.mjs` 的 `generic.impact`：命中类结果（HIT/GLANCE）且同锚点已有自带闪爆时返回 null。
  **只让命中类**——防御/落空类结果要表达的是「挡下了/闪开了」，素材自带的爆闪表达的是
  「打中了」，替代不了。
- 四条规则挂上实测的 `selfFlash`：`ray`（region 锚点、sustained）、`surge`（origin 锚点）、
  `arrow`、`thrown`。
- `strike.unarmed` 换素材 `physical.01.blue` → `no_hit.01.blue`，并显式 `duration: 900` /
  `waitUntilFinished: -267` 让交棒点与换素材前逐毫秒相同（633ms）。
- `strike.thrown` 的交棒点 `-500` → `-750`（667ms → 417ms）：原值正好压在自带光环熄灭那一帧上。
- `docs/ASSET-NOTES.md` 新增 `jb2a.unarmed_strike.no_hit.01.blue` 一行（九列齐全、
  自带闪爆＝否）。主表 93 → 94 行。

### 4. test-harden —— 补测试与 `strike.melee` 的 `when` 修正

- `strike.melee` 的 `when` 加 `!s.tags?.includes("thrown")`（不动 pri）。
  已从 Crucible 源码确证这是实战 bug 而非理论风险：thrown 标签 propagate 到 melee、melee 再
  propagate 到 strike，`strike.prepare()` 把手上那把匕首塞进 `usage.strikes`，所以真实投掷快照
  带 `light1`；又因为匕首不是 ranged 类别，`usage.isRanged` 还是 false，`generic.travel` 也兜不住。
  现有 fixture 的 `strikes` 恒为 `[]` 正好掩盖了它。
- 6 条原本一条行为测试都没有的规则各补一条：`pulse` / `surge` / `arrow`（正向）/ `unarmed` /
  `thrown` / `generic.travel`（正反两面）。
- 「未命中时投射物走 missed」补 `c.rule` 断言——原用例只断 `aim.missed`，而 `generic.travel`
  兜底提供同样的字段，单独关掉 arrow 时它照常绿。
- 新增「真实形态的投掷攻击不被近战挥击抢走」：在测试里就地合成真实形态快照（`thrownReal()`），
  正反两半（带 thrown 走投掷物 / 摘掉 thrown 回到近战）把修正的边界钉死。

---

## 二、冲突如何取舍

四组是并行设计的，`travel.mjs` 的 ray/cone 被三组同时触及。逐条裁决：

| 冲突点 | 两种写法 | 采纳 | 理由 |
| --- | --- | --- | --- |
| **重复 cue 怎么去掉** | once-mechanism 的解析器级 `rule.once` vs geometry 的规则级 `isExtraTarget(s, target)`（靠 `s.targets.indexOf(target) > 0` 丢弃第 2 个起的目标） | **`rule.once`**，`isExtraTarget` 整条不落地 | 两者都能把 cue 从 2 条压到 1 条，但 `isExtraTarget` 只在「至少有一个目标」时成立：零目标动作根本进不了 targets 循环，区域法术没罩住人就一条 cue 都不出。而且它要求 build 仍然每目标被调一次再丢弃产出，`once` 是真的只调一次。geometry 自己的 risks 也写明「若另一组也在处理 travel 的重复 cue，请让他们统一」。 |
| **ray 的 `stretchTo`** | once-mechanism 在 build 内联算 `region.x + cos(rot)*len` vs geometry 的 `templateEnd(region)` 助手 | **`templateEnd()`** | 同一份几何 cone 与 ray 都要用，抽成助手才不会两条规则各写一遍再各错一遍；助手还处理了 cone/line 的字段差异与 `r6()` 浮点尘埃。once-mechanism 的规格里也明说「若几何视角的 agent 已经提交了等价的模板终点写法，以他们的为准」。 |
| **once 规则的锚点形状** | once-mechanism 要 `{ref: "origin"}` 裸对象（不给播放层引入第二种 origin 锚点形状）vs geometry 要 `templateAnchor(s)`（带模板起点坐标） | **两者并存**：解析器的默认锚点是裸 `{ref: "origin"}`（surge/pulse 用），模板类规则用自带 `at` 覆盖成 `{ref: "origin", x, y}` | 这不是二选一——`normalize()` 的 `at: c.at ?? at` 本来就支持规则自带 at，once-mechanism 的规格自己把「规则仍可自带 at 覆盖」列为契约并给了测试。裸对象与带坐标的对象 `ref` 相同，播放层仍然只按 `ref` 分支；坐标是**补充信息**而不是第二种形状。模板起点在语义上确实可能不等于 token 中心（region 定义几何，token 不定义），所以模板类规则值得带上。geometry 版的 `tokenId`/`uuid` 两个字段我**删掉了**：`ref === "origin"` 已经指明是施法者，重复带 token 只是徒增形状差异。 |
| **cone 的 `build` 签名** | once-mechanism 去掉 target 形参 vs geometry 保留 `(s, ctx, target)` 给 `isExtraTarget` 用 | **去掉 target** | `isExtraTarget` 不落地，cone 的几何全部取自 `s.region`，留着形参只会诱使后人重新解引用它（once 规则解引用代表目标 = 零目标动作崩溃）。 |
| **ray 的 `selfFlash` 锚点** | double-flash 写的是默认 `"target"`（沿途每个目标都让位） | 改成 **`"region"`**（新增的锚点取值），并加一条专门的断言（T1d）锁住 | 这是三组合并后才出现的新事实：double-flash 是在「ray 每目标各一条光束、锚在目标」的世界里判的；合并 geometry 之后光束拉的是 line 模板全长、星爆烧在**模板末端**，不在沿途每个目标脚下。仍按 `"target"` 记会让站在光束中段的目标连自己的命中闪光一起被抑制——用「消除双闪」换掉了命中反馈，得不偿失。残留风险（站在模板末端的那个目标仍可能同时看到星爆与命中闪光）写进了测试注释，属于「宁可多闪一下也不要中段目标彻底没反馈」的取舍。 |
| **`built` 的组装方式** | double-flash 依赖「目标外层 / 槽内层」的循环结构（`const built = {}` 在目标循环里累积） | 改写成 `shared` + `perTarget[i]` 两份、`viewFor(i)` 现场合并 | once-mechanism 把循环翻成了槽外层，double-flash 那份写法直接失效。新写法在槽外层的结构下等价，而且额外解决了 double-flash 没遇到的问题：once 规则的产出该被之后所有目标看见。 |
| **melee 大体型测试** | geometry 与 test-harden 各写了一版重写 | **geometry 版**（四点具体数值），test-harden 想加的 `gridUnits` 断言已经包含在里面 | geometry 版覆盖 test-harden 版的全部断言且更严（`bigNear`/`bigFar` 两个点才能区分「折半」与「不折半」）。 |
| **surge / pulse 的行为断言** | test-harden 写的是 `aim.towards` 指向 origin、`at.ref === "target"` | 改写成 `at.ref === "origin"`、`aim === null` | test-harden 是在 once 落地之前写的，它断言的正是本次要修掉的「用 aim 当暗号表达自身效果」那套装法。test-harden 自己标注的「故意的未来红灯」（`at.ref === "target"` 那一行）在本轮就到期了，直接改成新契约。 |
| **unarmed 的素材断言** | test-harden 断 `physical.01.blue`、double-flash 要换成 `no_hit.01.blue` | **`no_hit.01.blue`** | 换素材是 double-flash 的核心产出且实测证明零成本（见下节）；test-harden 的其余断言（三项几何修正、颜色锁死）原样保留，只把「颜色跟伤害色」的变异体从 `void` 换成 `radiant`——`no_hit` 只有 blue/yellow 两支，`DAMAGE_COLOR.void = dark_purple` 的最近色仍是 blue，用它做变异体抓不住；`radiant = yellow` 精确命中 51 帧那一支，才真的能红。 |

---

## 三、未采纳的规格条目

| 条目 | 出处 | 为什么不做 |
| --- | --- | --- |
| `isExtraTarget()` 助手 | geometry | 被 `rule.once` 完全取代，见上表第一行。留着是两套互相打架的去重机制。 |
| `templateAnchor` 里的 `tokenId` / `uuid` 两个字段 | geometry | `ref === "origin"` 已经指明是施法者，重复带 token 只增加锚点形状的方差，不增加信息。 |
| `export function templateEnd` 的 `export` | geometry | 没有测试从外部导入它，`travel.mjs` 的模块表面只该有默认导出的规则表。改成模块内私有。 |
| 保守版张角基准 `CONE_SPRITE_HALF_TAN = tan(30°)`（60° 得 1、现役画面零变化） | geometry 的 risks 备选 | 我自己抽帧复测了斜率（0.489 / 0.518 / 0.533，三档阈值都收敛到 0.5），贴图确实是 53.13° 的 5e 锥。保守版是明知贴图张角不对还假装它对，两侧各留一个 3.4° 的空楔——`mask: "region"` 只能裁多余、补不了缺口。既然要改这条公式，就按实测值改。**代价交底：现役 60° 锥的画面会比现在纵向宽 15%**，这正是原先漏画的那部分。 |
| ray 的 `selfFlash.anchor` 用默认 `"target"` | double-flash | 见上表倒数第四行，改成新增的 `"region"`。 |
| ASSET-NOTES 新行里我没有亲自复现的逐帧数字 | double-flash | 规格给的行文里有若干我复测不出完全相同数值的细节（例如亮核质心 f13-f19 的具体坐标，我测到的与规格差 ~18px，方向与结论一致但数值不同）。这份表的全部价值在于「每条记录都对应一个实际看过图的真实文件」，**照抄别人的测量写成自己的记录是这份文档最不该出现的事**。落地的那一行只写我自己跑出来的数（质心 f15-f19、帧均 alpha、亮核像素数、饱和度、四边 alpha、codec、colorsUnder、三条路径坑），结论与规格一致。 |
| 订正 ASSET-NOTES 里 beam 那一行的正文（f37 → f39、一次性 → 持续） | double-flash 的 risks 第 8 条 | 我复测确认了这条订正是对的（f37 的白核包围盒 64x88 是光束圆头，f39 才成形为 121x215，且一直烧到 f73-f77），但**改的是别人已经写下的记录**，不属于本次修复范围；订正内容已完整写进 `travel.mjs` 里 ray 的注释，建议下一轮素材侦察统一回写主表。 |
| 修 `tools/dump-fixtures.mjs` 的 ActionTags 传播 | test-harden 的 risks（该组自己也建议不做） | 实测影响面 81 条 fixture、其中 80 条解析结果会变（66 条丢 cast cue、63 条凭空长出 travel cue），会把 Task 11/12 正在写的断言全部掀翻；而 `actions.json` 只能靠 leveldb 重新生成、不是从仓库可复现的。本轮只在测试里就地合成真实形态快照（`thrownReal()` / `unarmed()`），成本一行、爆炸半径为零。建议在所有槽位任务收口之后单开一个任务一次性吃掉。 |

**采纳了但规格自己标为「可选」的两条**：`target.blast` 的 `once: true`（零观测差异的语义标注，
build 恒返回 null）与 `runBuild()` 加固。后者连同配套断言一起收——单独加 try/catch 会让错误
变安静（实测：误标 `once` 的破坏实验从 11 条红降到 1 条），补上「全量 fixture 的 plan.warnings
恒为空」之后回到 2 条红，而且报错直接点名是哪条规则的 build 抛了什么。

---

## 四、回归复算（全部自己跑，未采信规格里的数字）

### 覆盖率与降级率

| 指标 | HEAD `a981f2c` | 落地后 |
| --- | --- | --- |
| 动作覆盖率 | 434 / 434 | **434 / 434** |
| 状态覆盖率 | 46 / 46 | **46 / 46** |
| 零目标攻击动作有 cast cue | 53 / 53 | **53 / 53** |
| 降级率（`assets.warnings` / 动作数） | 0.00%（0 次） | **0.00%（0 次）** |
| `plan.warnings` 总数 | 0 | **0** |
| 8 种攻击结果全部可解析 | 是 | 是 |
| 路径存在性（cue 引用的文件在磁盘上） | 全部存在 | 全部存在 |

### 每动作 cue 数（travel 槽）

| 规则 | HEAD 动作数 / cue 数 / 每动作 | 落地后 动作数 / cue 数 / 每动作 |
| --- | --- | --- |
| **spell.gesture.ray** | 12 / 24 / `{2: 12}` | 12 / **12** / **`{1: 12}`** |
| **spell.gesture.cone** | 12 / 24 / `{2: 12}` | 12 / **12** / **`{1: 12}`** |
| **spell.gesture.pulse** | 12 / 24 / `{2: 12}` | 12 / **12** / **`{1: 12}`** |
| **spell.gesture.surge** | 12 / 24 / `{2: 12}` | 12 / **12** / **`{1: 12}`** |
| generic.travel | 96 / 192 / `{2: 96}` | 96 / 192 / `{2: 96}`（未变） |
| spell.gesture.arrow | 12 / 24 / `{2: 12}` | 12 / 24 / `{2: 12}`（未变） |
| strike.thrown | 4 / 8 / `{2: 4}` | 4 / 8 / `{2: 4}`（未变） |
| strike.melee | 1 / 2 / `{2: 1}` | 1 / 2 / `{2: 1}`（未变） |
| strike.unarmed / target.blast | 0 / 0 | 0 / 0（fixture 里没有徒手动作；blast 恒 null） |

### 计划总量

| 槽 | HEAD | 落地后 | 差 |
| --- | --- | --- | --- |
| cast | 411 | 411 | 0 |
| travel | 322 | **274** | −48 = 4 条 once 规则 × 12 个动作 × 1 份重复 |
| impact | 640 | **608** | −32 = 16 个动作 × 2 目标（arrow 12 + thrown 4 的命中类让位） |
| **合计** | 1373 | **1293** | −80 |

### 逐条比对（434 个 fixture，按 JSON 排序后集合比较，忽略新增的 `selfFlash` 字段）

**368 / 432 个动作的 cue 逐字节完全相同**。变化的 64 个动作全部可解释：

- `spell.gesture.{ray,cone,pulse,surge}`：各 12 个动作，2 条 → 1 条；
- `generic.impact`：16 个动作（arrow 12 + thrown 4），命中类结果让位给自带闪爆；
- `strike.thrown`：4 个动作，`waitUntilFinished` −500 → −750。

`cast` / `generic.travel` / `strike.melee` 全部零变化——证明这次改动只删重复、没有顺带改坏
任何每目标规则的产出。

### 测试

`npm test`：**92 → 122，全部通过，0 失败**。新增 30 条：

- `test/armory-travel.test.mjs` +19（once 回归 5、模板几何 6、原本无测试的规则 8），重写 1（不计数）
- `test/resolve.test.mjs` +6（5 条 once 机制 + 1 条 build 异常降级）
- `test/armory-flash.test.mjs` +6（新文件：T1 / T1b / T1c / T1d / T2 / T3）
- `test/coverage.test.mjs` +1（全量 fixture 的 `plan.warnings` 恒为空）

---

## 五、素材实测复核（不采信规格的测量，全部自己抽帧重跑）

工具：`ffprobe` 数帧 + `ffmpeg -c:v libvpx/libvpx-vp9 -pix_fmt rgba` 解出 alpha 平面后逐帧统计
（帧均 alpha / 亮核像素数（alpha>200 且亮度>200）/ 亮核质心与包围盒 / alpha 加权 RGB 与饱和度）。

| 结论 | 实测 |
| --- | --- |
| 锥形贴图是 53.13° 的 5e 锥，不是 60° | `BreathWeapon_Fire01_Regular_Orange_30ft_Cone_Burst_600x600.webm` 254 帧 600x600，`_template = [100,0,0]`。取平台段 f120-f204 每 6 帧共 15 帧做时间并集，逐列 alpha 包络对锥尖最小二乘：阈值 8 → 斜率 **0.533**、阈值 32 → **0.518**、阈值 128 → **0.489**，收敛到 tan(半角)=0.5 |
| `no_hit.01.blue` 自带闪爆＝否，且与 `physical.01.blue` 逐帧同源 | no_hit 29 帧 **VP8**、physical 31 帧 **VP9**（同族 codec 不一致，这一条只有真去抽帧才会撞上）。亮核质心 f15-f19：no_hit (277,356)/(319,363)/(390,359)/(444,324)/(448,326)，physical (286,363)/(345,373)/(402,356)/(456,314)/(461,313)——接触时刻同为 f18-f19。physical 从 f20 起帧均 alpha 2.05→6.41→8.61→**18.34**→10.97、亮核 1428→3684→4258→**16469**→4898、质心停在 x≈475-501 原地放射、饱和度塌到 11%/23%；no_hit 同段亮核**仍在平移**且像素数崩塌 9623→6000→2304→1282→119→0，全片饱和度从不低于 49%。四边 alpha 29 帧全为 0（无画幅切边） |
| beam 的星爆是**持续**的，且 f39 才成形 | 右侧 200px 的亮核：f37 = 3148（包围盒 64x88，是光束圆头）、f38 = 0、**f39 = 10762（121x215）**，之后在 1800–17000 之间脉动一直到 f73（光束断开），f74-f77 仍有残影。→ `{from: 967, at: 967, to: 2100, sustained: true}` |
| arrow 的爆闪在 f14-f19 | 右侧 16% 亮核：f11 = 1580（光束头抵达）→ f13 = 471 → **f14 = 3440**（帧均 alpha 24.0）→ f15 = 2031 → f19 = 176 → f23 = 0。→ `{from: 467, at: 467, to: 633}` |
| thrown 的金色光环在 f27-f36、峰值 f31-f32 | 右侧 25% 帧均 alpha：f26 = 1.02 → f27 = **11.28** → f31 = 23.89 / f32 = 24.15（亮核过万）→ f34 = 15.94 → f36 = 6.63。扣掉 startTime 533 → `{from: 367, at: 500, to: 667}`。**规格写的 at = 517 是 f31/f32 的中值，我按 f31 取 500** |
| surge 的爆闪在 f17-f19（24fps） | 帧均 alpha：f16 = 5.57 → f17 = **18.10** → f18 = 28.00 → f19 = **29.10** → f20 = 7.95。扣掉 startTime 125 → `{from: 583, at: 667, to: 708}` |
| rotation 约定 | Crucible 源码两处互证：`dice/action-use-dialog.mjs` 用 `Math.toDegrees(Math.atan2(position.y - origin.y, position.x - origin.x))` 写入；`canvas/vfx/spells.mjs` 用 `Math.toRadians(rotation)` 与 `{x + cos*d, y + sin*d}` 消费。**度、0° = 正东、正角度朝 +y（画布 y 向下 = 屏幕顺时针）** |
| 路径坑 | `jb2a.unarmed_strike.no_hit`、`jb2a.unarmed_strike.no_hit.01`、`jb2a.unarmed_strike.no_hit.01.blue.0` 三条都能解析、都静默落到 blue 文件、`diverged` 全是 `false`、不留 warning。`colorsUnder("jb2a.unarmed_strike.no_hit.01")` 实测只有 `["blue","yellow"]` |

---

## 六、破坏实验（27 个变异体，每个独立复制一份仓库、只改一处、跑全量）

变异用 `shutil.copytree` 出一份干净副本再改，避免互相污染。**27 / 27 全部被捕获**，无一漏网。

### once 机制

| # | 变异 | 结果 |
| --- | --- | --- |
| A | 删掉 `resolve.mjs` 的整个 `once` 分支 | **11 红**（110 pass）：区域每动作一条 / 自身爆发锚点 / 零目标出内容 / 全量扫描 / 锥形端点 ×2 / 锥形张角 / 射线端点 / 模板锚点 / `rule.once` 只调一次 / `rule.once` 零目标 |
| B | 只把 cone 的 `once: true` 拿掉 | **6 红**（115 pass） |
| C | 给 `generic.travel` 误加 `once: true` | **2 红**：投射物与近战仍然每个目标一份 / plan.warnings 恒为空（后者直接点出是哪条规则的 build 抛了什么） |
| D | 把 surge 那条自指 `aim` 装回去 | **1 红**：自身爆发锚在施法者 |
| E | `once` 分支加 `if (!targets.length) continue;` | **2 红**：零目标出内容 ×2 |
| F | `once` 分支的 `at` 落回 `targets[0]` 目标锚点 | **2 红**：自身爆发锚点 / `rule.once` 默认锚在施法者 |

### 几何

| # | 变异 | 结果 |
| --- | --- | --- |
| G | cone 端点写死正东 | **3 红**：端点跟 rotation 转 / 整圈端点 / 射线端点 |
| H | y 用 `-sin`（逆时针） | **3 红**（同上） |
| I | rotation 当弧度用 | **3 红**（同上） |
| J | `scale.y` 写死 1 | **2 红**：半宽比 / 张角截断 |
| K | 整个 `scale` 字段删掉 | **2 红**（同上） |
| L | 换回 `angle / 60` 的角度比 | **2 红**（同上） |
| M | 去掉张角上限截断 | **1 红**：截断并留痕 |
| N | ray 改回目标坐标 | **2 红**：零目标出内容（`targets[0]` 读 undefined）/ 射线拉到模板端点 |
| O | 去掉 ray 的 `at: templateAnchor` | **1 红**：模板类特效锚在模板起点 |
| P | `offsetFor` → `(width ?? 1) * 0.5` | **1 红**：大体型挥击放大且偏移折半 |
| Q | melee 丢掉 `gridUnits` | **1 红**（同上；HEAD 上这个变异是**全绿**的，本次补上） |

### 双闪

| # | 变异 | 结果 |
| --- | --- | --- |
| R | 删掉 impact 的让位判断（重现双闪） | **1 红**：T1 |
| S | unarmed 换回 `physical.01.blue`（忘了打标记） | **2 红**：T2 / 拳击颜色锁死 |
| T | thrown 交棒点改回 `-500` | **1 红**：T3 |
| U | 给无闪的 `generic.travel` 误打 `selfFlash` | **2 红**：T2 / T3 |
| V | 把 ASSET-NOTES 新行的「自带闪爆」改成「是」 | **1 红**：T2 |
| W | impact 改成命中类无条件 `return null`（想用删光闪光骗绿 T1） | **5 红**：T1b + 两条覆盖率 + 两条解析器测试 |
| X | ray 的 `selfFlash.anchor` 改成 `target` | **1 红**：T1d（这一条最初是全绿的漏网之鱼，为它补了 T1d） |
| X2 | ray 的 `selfFlash` 整条删掉 | **2 红**：T1d / T2 |
| X3 | surge 的 `selfFlash` 整条删掉 | **1 红**：T2 |
| X4 | arrow 的 `selfFlash` 整条删掉 | **1 红**：T2 |
| X5 | ray 交棒点提前到星爆之前（`-1400`） | **1 红**：T3 |

### 规则覆盖面

| # | 变异 | 结果 |
| --- | --- | --- |
| Y | 撤销 `strike.melee` 的 thrown 排除（回到 HEAD） | **1 红**：真实形态的投掷攻击不被近战挥击抢走（有且仅有这一条） |
| Z | `generic.travel` 退回 `jb2a.magic_missile` | **3 红**：ASSET-NOTES 依据 / T2 / 远程兜底给中性箭形 |
| AA | `generic.travel` 删掉 `isRanged` 守卫 | **1 红**：近战兜底不出内容 |
| AB | unarmed 改成跟伤害色 | **1 红**：拳击颜色锁死 |
| AC | pulse 删掉 `fadeIn`/`fadeOut` | **1 红**：脉冲 |
| AD | pulse 去掉 `{color: runeColor()}` | **1 红**：脉冲 |
| AE | thrown `mirrorY` 写死 `false` | **1 红**：投掷物镜像（HEAD 上这个变异是**全绿**的） |
| AF | unarmed 三项几何修正整体删掉 | **1 红**：拳击（HEAD 上这个变异是**全绿**的） |
| AG | arrow 换成兜底那枚 eskie 箭形 | **2 红**：T2 / 法术飞弹用自己的投射物素材 |

---

## 七、遗留问题与交底

1. **cue 数组顺序从「目标为主序」变成「槽为主序」。** 新顺序更贴合 plan 作为时间轴的语义
   （cast → travel → impact → aftermath），没有任何测试依赖旧顺序。但 **rng 消费顺序随之改变**：
   目前 impact/aftermath 用的都是单文件叶子（`ctx.pick` 只在多 variant 时才消费 rng），实测选中的
   文件与改前逐条相同；一旦 Task 11 给 impact 换上多 variant 素材，travel 与 impact 的 rng 交错
   顺序变化就会改变选中的文件——仍然确定、仍然可复现，但与改前不是同一个画面。
   另：Task 13 的播放层必须按 `slot` 字段分组，不能靠数组下标分段。

2. **`once` 规则不得解引用代表目标——这是新增的、编译器不管的约定。** 三道防线都是软的：
   DESIGN.md 契约行、`resolve.mjs` 注释里的粗体点名、`runBuild()` 把崩溃降级成告警
   （配 plan.warnings 恒空的断言）。破坏实验 C 和 N 各自演示了踩空之后会发生什么。

3. **60° 锥的画面会比现在纵向宽 15%。** 这是修好张角公式的直接后果（多出来的部分被
   `mask: "region"` 裁掉，缺的那部分才是原先的漏画）。上机时会看得出来，属预期变化。

4. **`angle ≠ 60` 目前在生产中不可达。** Crucible 的 cone 目标恒 60°，120/210 只来自 `fan`，
   而 `spell.gesture.cone` 的 `when` 要求 `gesture === "cone"`，fan 走不到这条规则
   （fixture 里 12 个 fan 动作的 travel 目前落到兜底）。`coneYScale` 的非 60 分支与截断分支
   只有合成快照能覆盖——这是有意的前置准备，但别误以为修完 fan 就能自动出画：210° 只能截到 4
   （约 127°），真要正确表现得换素材或多张拼接。

5. **`scale.y` 的语义押在 Task 13 播放层身上。** 结论建立在 Sequencer 的 `stretchTo` 默认
   `onlyX: false`（scaleY = scaleX）且 `.scale()` 在其之上相乘。若播放层给 `stretchTo` 传
   `{onlyX: true}`，整套倍率作废；`scale.x` 一旦不为 1，Sequencer 会先拿它去除 `ray.distance`，
   连带改掉按距离挑 ft 分支的判定。测试里已断言 `scale.x === 1`，播放层那侧请一并守住。

6. **射线末端的目标仍可能同时看到星爆与命中闪光。** 这是 `selfFlash.anchor = "region"` 的有意
   残留（理由见第二节）。真正的解法是让 impact 规则按「这个目标是不是站在模板末端」判断，
   但那要引入距离阈值——留给 Task 11 连同结果层表达一起定。

7. **travel cue 没有 `playIf`，自带闪爆会在防御类结果上照播。** 不是本次引入的，但与本议题同源：
   投掷匕首被格挡时，那圈金色「命中光环」照样会播（`aim.missed` 只处理 MISS/DODGE 的偏移落空，
   处理不了 BLOCK/PARRY/ARMOR/RESIST），于是防御类结果现在是「金色命中光环 + 通用冲击层」两层
   都出。真正的解法是给这些 travel cue 加 `playIf`（或用 `endTime` 裁掉闪爆段），需要 Task 11
   定下结果层的表达之后再做。

8. **thrown 的交棒点提前了 250ms**，是一处可感知的节奏变更，超出了「消除双闪」的最小范围。
   理由是原值正好压在自带光环熄灭那一帧上（既造成双闪，也让防御类反馈晚 300ms），但它确实会让
   整段动作快 250ms，上机时留意。

9. **零目标 `once` 语义在真实数据上仍是纸面推演。** fixture 里 114 个零目标动作没有一个是
   ray/cone/pulse/surge，零目标断言全部建立在合成快照（`{...byId(id), targets: []}`）上。
   合成快照保留了原动作的 `region`，所以 cone/ray 能正常取到模板——但真实战斗里「锥形没罩住
   任何人」时 `snapshot.region` 是否一定非空没有验证过（`when` 卡了 `region?.type`，规则不会误
   命中，最坏是不出内容而不是崩）。要真正确认需要在 Foundry 里放一次没打中人的锥形法术看 snapshot。

10. **`fixture` 的 ActionTags 盲区仍在。** 434 条里只有 1 条带 `strike` 标签、1 条 `strikes` 非空，
    所以 `strike.melee` 在全语料上只命中 1 个动作、`strike.unarmed` 命中 0 个。同一个盲区大概率
    也在坑 Task 11/12（impact/aftermath 若按 `s.strikes` 或 `usage.isAttack` 分流，在现有语料上
    同样测不到近战/徒手分支）。建议把 `thrownReal()` / `unarmed()` 这种「真实形态快照工厂」的做法
    同步给那两个任务，或在生成器修好前提取成 `test/helpers/` 共用。

11. **全量扫描断言只抓「多了」，抓不到「少了」。** `count > cap` 检查的是上限；once 规则漏出
    0 条 cue（比如素材路径写错导致 `ctx.pick` 返回 null）它一句话都不会说。这个缺口部分由四条
    `ONCE_CASES` 的数量断言兜着（每种姿态锁住一个代表动作），其余 11 个同姿态动作没锁。

12. **`docs/ASSET-NOTES.md` 里 beam 那一行的正文尚未订正**（f37 → f39、一次性 → 持续），
    订正内容目前只写在 `travel.mjs` 的注释里，主表与代码注释会短暂不一致。建议下一轮素材侦察
    或 Task 11 一并回写。
