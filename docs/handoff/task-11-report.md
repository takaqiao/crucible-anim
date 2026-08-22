# Task 11 报告：兵库 S3 impact 槽

分支 `v1-implementation`，起点 `1300d65`（124/124）。改动：
- `scripts/armory/impact.mjs`（重写）
- `test/armory-impact.test.mjs`（新增，简报 Step 1 原样落地）
- `test/armory-assets.test.mjs`（LEGACY_UNVERIFIED 白名单删除 `jb2a.impact.004`，条目数 3→2）
- `test/armory-flash.test.mjs`（T1 / T1d 适配「结果层+元素层」两层结构）

## 1. RESULT_LAYER（8 条，结果层，与伤害元素无关）

不经 `{color}` 动态染色。理由：ASSET-NOTES 文末 A 节记录同族颜色分支间帧数可差
1.83 倍（如 `jb2a.impact.007` 的 white 对其余色），结果层承担「发生了什么」这个
结构性判断，不能让 `pickColor` 在运行时静默换到一个时序没验证过的兄弟分支；
「什么属性」这件事交给元素层。全部 8 条在 ASSET-NOTES 主表 89-96 行都被明确标注
「对应 X」，是本任务专门侦察出的 1:1 对应，无需另找素材。

| 结果 | 路径 | ASSET-NOTES 记录要点 | 本任务取用的时序/scale |
| --- | --- | --- | --- |
| HIT | `jb2a.impact.005.white` | 25f@30fps=833ms，自带闪爆＝是；「真正的星形爆闪在 f4」，f17-24 只剩暗火星，建议 endTime≈550ms | duration 550，scale 1.0（400x400 基准） |
| GLANCE | `blfx.spell.impact.flash.color1` | 15f@30fps=500ms，1200x1200；三拍闪烁（f5-6/f8-9/f11-12），「必须显式压到 ~0.35 才和 HIT 同量级」 | 不裁剪（保留三拍层次），scale 0.25（0.35 同量级基线上再打折，体现「比 HIT 更轻」） |
| ARMOR | `jb2a.impact.011.yellow` | 33f@30fps=1100ms；f0-3 自带白爆闪，f4-13 金色电弧丝，f23-31 会闪三下的孤立亮弧尾巴；「要纯刮擦火花感必须掐两头：startTime≈f14（467ms）、endTime≈f22（733ms）」 | startTime 467，duration 266（733-467），scale 0.8 |
| BLOCK | `jb2a.shield.02.outro_explode.blue` | 45f@30fps=1500ms；「只想省掉最暗的起头裁到 ~f8 就够」 | startTime 267（~f8），duration 1233（全长播完），scale 0.9 |
| PARRY | `blfx.misc.enchantment.1.blades_clash1.color1` | 90f@30fps=3000ms，1200x1200；「endTime≈1000ms 是有害建议…要留住爆发至少给到 f50（约 1700ms）」 | duration 1700，scale 0.3（0.9 语义权重按 1/3 画布比换算） |
| RESIST | `jb2a.extras.tmfx.inpulse.circle.02.normal` | 54f@30fps=1800ms，500x500；「对一次命中结算偏慢，建议 timeScale 加速或直接换…02.fast」；「想做出『从体外收进来』的层次应放大到 ~1.4」 | playbackRate 2（压到 ~900ms，未采用未经资产守卫验证的 `.fast` 路径），scale 1.4 |
| DODGE | `jb2a.teleport.01.white` | 27f@30fps=900ms，500x300；「endTime 掐在 f10 就够，本体只有 f1-f4 约 0.13s」 | duration 333（f10），missed:true，scale 0.65 |
| MISS | `jb2a.ui.miss.white` | 84f@30fps=2800ms，200x200；「空帧从 f44 起…endTime≈1467ms」 | duration 1467，missed:true，scale 1.4（画布减半，放大补偿） |

scale 字段同时揉合了 DESIGN.md §6.5 的语义权重与各素材相对 JB2A 400x400 基准画布
的尺寸差（blfx 1200x1200 是 3 倍，jb2a.teleport 500x300、jb2a.ui.miss 200x200 各不
相同）——ASSET-NOTES 反复强调「画幅尺寸不统一…混排时应改用 `.size()` 定尺寸」，
本实现选择在 `objectScale` 里显式换算而不是引入新的尺寸系统。

## 2. ELEMENT_LAYER（12 条，元素层，仅 HIT/GLANCE 叠加）

路径全部取自 ASSET-NOTES 主表 97-106 行，每行备注直接标了「伤害类型：X」，同样
不经 `{color}` 动态染色。

| 伤害类型 | 路径 | ASSET-NOTES 记录要点 |
| --- | --- | --- |
| bludgeoning / piercing / slashing | `jb2a.liquid.splash.red` | 「物理三系共用血溅」，85f@24fps=3542ms，9 色分支存在但本任务固定 red，未做裁剪（ASSET-NOTES 给的两个合法选项之一：「要么留满到 f63-f65 真正淡完，要么自己配 fadeOut」，取前者） |
| fire | `eskie.damage.fire.01.orange` | 15f@29.97fps=0.5s，自带闪爆＝是（模板 f5-6 白爆闪），800x800 |
| cold | `eskie.damage.cold.01.blue` | 同模板；白分支「整段就是一团白、和模板自带的白闪撞死，冷伤绝不能选 white」，故取 blue |
| electricity | `eskie.damage.electricity.01.blue` | 同模板，专属残留蓝白电弧 |
| acid | `eskie.damage.acid.01.green` | 同模板，专属残留亮绿光环＋黄绿裂纹 |
| poison | `eskie.damage.poison.01.green` | 同模板；「整体偏黄绿，压在绿色 token 上会糊」是备选提醒，主选仍取 green（与 ASSET-NOTES 记录一致） |
| radiant | `eskie.damage.radiant.01.yellow` | 同模板，金色扇形光刃；randomRotation 用于打散「固定角度重复」的坑 |
| psychic | `eskie.damage.psychic.01.pink` | 同模板，粉紫触须；备注提醒该分支「盖脸」较重，见下文顾虑 |
| corruption | `eskie.damage.necrotic.01.teal` | 借用 necrotic 一支，必须用 teal（black 分支已被否决，全黑烟在暗图上不可见） |
| void | `jb2a.impact.011.dark_purple` | 33f@30fps=1100ms，400x400，10 色分支帧数一致（同族最省心）；黑芯为实心不透明像素 |

eskie 系（8 支）画布 800x800，是 jb2a 系（4 支）400x400 基准的 2 倍，scale 因此
分两档：eskie 0.45、jb2a 0.9。

自带闪爆说明（判断依据见 impact.mjs 内 ELEMENT_LAYER 上方注释）：这 9 支素材
「自带闪爆＝是」，但**不经 `coveringFlash` 抑制**——双闪协议原文「必须二选一」
针对的是「通用兜底闪光」与「素材自带闪爆」表达同一件事的情形；元素层与结果层
刻意做成不同时机（`delay:60ms`）、不同构图（一个是中性冲击、一个是伤害类型
专属残留），是设计要求的分层叠加，不是同一件事的重复。

## 3. 路径验证

对全部 20 组映射（18 条不同路径，物理三型共用一条）逐条跑
`assets.resolve(path)`，全部 `diverged===false` 且 `r.path===p`：

```
--- RESULT_LAYER ---
HIT jb2a.impact.005.white -> path=jb2a.impact.005.white diverged=false
GLANCE blfx.spell.impact.flash.color1 -> path=blfx.spell.impact.flash.color1 diverged=false
ARMOR jb2a.impact.011.yellow -> path=jb2a.impact.011.yellow diverged=false
BLOCK jb2a.shield.02.outro_explode.blue -> path=jb2a.shield.02.outro_explode.blue diverged=false
PARRY blfx.misc.enchantment.1.blades_clash1.color1 -> path=... diverged=false
RESIST jb2a.extras.tmfx.inpulse.circle.02.normal -> path=... diverged=false
DODGE jb2a.teleport.01.white -> path=jb2a.teleport.01.white diverged=false
MISS jb2a.ui.miss.white -> path=jb2a.ui.miss.white diverged=false
--- ELEMENT_LAYER ---
bludgeoning/piercing/slashing jb2a.liquid.splash.red -> diverged=false
fire eskie.damage.fire.01.orange -> diverged=false
cold eskie.damage.cold.01.blue -> diverged=false
electricity eskie.damage.electricity.01.blue -> diverged=false
acid eskie.damage.acid.01.green -> diverged=false
poison eskie.damage.poison.01.green -> diverged=false
radiant eskie.damage.radiant.01.yellow -> diverged=false
psychic eskie.damage.psychic.01.pink -> diverged=false
corruption eskie.damage.necrotic.01.teal -> diverged=false
void jb2a.impact.011.dark_purple -> diverged=false
```

同时确认全部 18 个对应的 `.webm` 文件在 `/root/fvtt14-data/Data` 下真实存在
（对应 `test/coverage.test.mjs` 的路径存在性测试）。

**已知的自动化守卫盲区**：`test/armory-assets.test.mjs` 的 `pickedPaths()` 只扫描
`ctx.pick("字面量")` 这种参数紧跟字符串字面量的写法；本实现按简报要求把 20 条路径
放进 `RESULT_LAYER` / `ELEMENT_LAYER` 两张表、经变量 `spec.path` / `el.path` 传给
`ctx.pick()`，不会被该正则捕获（与 `travel.mjs` 里 `strike.melee` 用 `branch` 变量
传参是同一种既有写法，同样不被该扫描器覆盖）。已用上表的 `resolve()` 直接验证替代
自动扫描，但这是本任务遗留给后续 review 的已知盲区，如需堵上需要扩展该测试的正则
或改成 AST 解析，超出本任务范围。

## 4. `jb2a.impact.004` 迁移

- `impact.mjs` 的非攻击兜底规则 `generic.impact` 原来用 `ctx.pick("jb2a.impact.004", {color: ctx.damageColor() ?? "white"})`（Task 7 遗留、未经 ASSET-NOTES 验证）。已改为 `ctx.pick("jb2a.impact.005.white")`——复用结果层 HIT 那条已验证路径，不再做动态染色（ASSET-NOTES 只验证过该素材的 white 分支）。
- `test/armory-assets.test.mjs` 的 `LEGACY_UNVERIFIED` 集合删除 `"jb2a.impact.004"` 条目，白名单从 3 条收缩到 2 条（`jb2a.healing_generic.burst` 待 Task 12、`jb2a.extras.tmfx.outflow.circle.01` 待 Task 12），同步更新了两条相关断言的期望值与提示文案。
- 「自动失效」测试（白名单每条都必须仍被引用）在删除后保持通过，因为剩下 2 条仍分别被 `aftermath.mjs`/`persist.mjs` 引用；不会出现僵尸条目。
- 全仓库 grep 确认 `jb2a.impact.004` 不再出现在任何实际代码路径里（仅剩 `travel.mjs` 一处历史注释提及它作为 Task 10 决策背景，属实历史记录，未改动）。

## 5. 双闪抑制与防御类结果处理

**机制**：沿用 Task 10 已经搭好的 `armory/flash.mjs` 协议（`selfFlash` + `coveringFlash`），
未新增机制。`impact.layered` 规则里，仅当 `HIT_RESULTS.includes(hit.result)` 且
`coveringFlash(built, "target")` 命中时，跳过**结果层**这一条 cue（travel 已经在
目标身上自带过一次「打中了」的闪爆，结果层的通用闪光是同一件事的重复）。目前
travel 槽里只有 `spell.gesture.arrow` 与 `strike.thrown` 两条规则的 `selfFlash`
锚点是默认值 `"target"`；`spell.gesture.ray`（anchor:"region"）与
`spell.gesture.surge`（anchor:"origin"）不占目标这一层，不会触发抑制；
`strike.melee` / `strike.unarmed` / `spell.gesture.cone` / `spell.gesture.pulse`
在 Task 10 阶段就已经换成不带 `selfFlash` 的素材（如 `unarmed_strike.no_hit.01`），
双闪问题在 travel 侧已经解决，无需 impact 层介入。

**元素层不参与抑制**（见上文「自带闪爆说明」）：这是与 Task 10 遗留问题描述不同的
判断——顾虑清单里说的「双闪」，实测后确认是「travel 自带闪爆」与「impact 结果层
通用闪光」表达同一件事的重复，而元素层传达的是新信息（打中了什么属性），且与
结果层本身也刻意错开了 60ms 与构图，不构成重复。

**防御类结果（格挡/招架/抗性等）不让位**：这条不是本任务新增的判断，是 Task 10
已经做出的、并写进 `test/armory-flash.test.mjs` T1c 的既有设计——`coveringFlash`
的抑制条件里显式限定了 `isHitLike &&`，防御类结果从不满足这个条件，因此从不被
抑制，本任务原样沿用。之所以这样设计：travel 素材自带的命中闪爆表达的是「打中了」，
防御类结果表达的是「没打中/被挡下了」，两者语义相反，travel 的闪爆不能替代防御类
结果自己的反馈——如果不发生这一层，会出现「明明没打中却因为 travel 闪了一下」的
错觉。任务简报里提到的「travel cue 目前没有 playIf，防御类结果下 travel 段自带的
命中闪爆照样播」是 travel 槽自身的问题（travel 是否该按结果条件播放，与 travel
在几何/命中判定之前就已经飞行完毕这件事相关），不属于 impact 槽能解决的范围——
impact 层能做的只是不在防御结果下额外叠加自己的闪光，这一点已经满足。是否要给
travel 加 `playIf` 是 travel.mjs 的改动，建议留给下一轮 travel 复查或作为独立顾虑
上报，本任务未改动 travel.mjs。

## 6. 暴击震屏

用了 `once: true`，但不是简报字面意义上的「整条规则退化成一次性效果」，而是让
`impact.layered` 内部自己遍历 `s.targets` 并在一次 `build()` 里同时产出所有目标的
结果层/元素层 cue（各自带显式 `at` 覆盖 once 默认的 `{ref:"origin"}`）与至多一条
`shake` cue。理由：

1. **震屏必须是「每动作一次」**：`resolve.mjs` 的 once 分支保证 `build()` 只调一次；
   若不用 once（默认每目标调一次 `build`），每次调用互不知情，没有天然的去重点，
   多目标暴击会各自产出一条 shake cue，在 `scripts/player/play.mjs`（IMPLEMENTATION-PLAN
   草案）里是用 `copySprite` 叠加的循环位移动画，多份叠加会互相干扰、观感是「画面
   一直在抖」而不是「震一下」，正是简报里说的「灾难」。用 once 之后在一次 build
   里维护一个 `shakeAt` 变量，只记第一个满足 `spec.shake && hit.critical` 的目标，
   结构上就不可能出现第二条。
2. **对 `coveringFlash` 的正确性没有副作用**：验证过 `resolve.mjs` 对同一个槽只选
   一条规则（`firstMatch`），一次动作里所有目标的 travel cue 都出自同一条被选中的
   travel 规则；`selfFlash` 是规则/素材层面的属性，不随目标变化，因此 once 模式下
   只能拿到 `built = viewFor(0)`（对应 `targets[0]` 的前序槽视图）不会造成误判——
   对本动作其余目标同样成立。已用 fixture 验证：`arrow`（spell.gesture.arrow）手势
   的动作在 fixture 里 12/12 条都是多目标（见下文覆盖率复算脚本输出），而
   `strike` 标签的多目标动作仅 1 条，进一步确认这条判断在真实数据分布下站得住。

## 7. `npm test` 结果

```
# tests 131
# suites 0
# pass 131
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

131 = 起点 124 + 本任务新增 `test/armory-impact.test.mjs` 的 7 条测试。全绿，
无 skip、无 cancel。

**覆盖率复算**（对全部 434 个 fixture 动作 + 46 个状态重新跑 `resolve`/`resolveEffect`）：

```
actions: 434, diverged warnings: 0, rate: 0.00%
actions with zero cues: 0 / 434
effects with zero cues: 0 / 46
actions producing impact cues: 316 / 434, total impact cues: 1000
```

**降级率**：0.00%（0/434），远低于 15% 阈值，未触及也未松动断言。

## 8. 顾虑（上报，非阻塞）

1. **MISS 素材是英文文字贴图**：`jb2a.ui.miss.white` 本质是烘死在素材里的英文衬线字
   "Miss!"，与另外 7 条纯 VFX 视觉语言不一致，也没法本地化。ASSET-NOTES 已经记录
   这个问题并给出备选（`jb2a.ui.critical_miss.red`，仅用于大失败），但 MISS 本身
   在主表里只有这一条已验证路径。建议上线前找设计确认是否需要专门抽帧验证一个
   扬尘/挥空类素材替换。
2. **PARRY 素材节奏偏软**：`blfx.misc.enchantment.1.blades_clash1.color1` 是缓涨型
   白光（ASSET-NOTES 原话「拿它当命中那一下的节奏点会觉得发软」），已裁到 1700ms
   （原长 3000ms）仍是全表最长的结果层素材。ASSET-NOTES 里没有另一条已验证的
   「兵器交击」候选，本任务未强行更换，暂以此顾虑记录。
3. **psychic 元素层「盖脸」风险**：ASSET-NOTES 原话「厚——前 8 帧基本把 token 脸
   盖住」，当前 scale 0.45 与其余 eskie 素材一致处理，未针对 psychic 单独再收紧，
   可能比其余元素层视觉更遮挡。
4. **`test/armory-assets.test.mjs` 的自动扫描盲区**（见第 3 节）：`RESULT_LAYER` /
   `ELEMENT_LAYER` 表里的路径不会被 `pickedPaths()` 的正则自动捕获，已用一次性脚本
   人工核验替代，但后续若有人往这两张表加新路径，不会有自动化测试拦截笔误——
   与 `travel.mjs` 的 `strike.melee` 分支变量是同一类已知盲区，不是本任务引入的
   新问题，一并记录。
5. **RESIST 用 `playbackRate` 而非切换素材**：ASSET-NOTES 提到的 `...02.fast` 分支
   没有单独成表格行，不满足资产守卫的「精确命中或父路径」判定，因此改用
   `playbackRate:2` 压缩节奏，效果上与切到 `.fast` 相近但不是同一素材本身的验证
   数据，如果将来要切实使用 `.fast` 需要先给它单独补一行记录。

## 状态

DONE_WITH_CONCERNS
