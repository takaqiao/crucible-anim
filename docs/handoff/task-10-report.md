# Task 10 报告：兵库 S2 travel 槽

## 结论

`scripts/armory/travel.mjs` 新增 9 条规则（`spell.gesture.ray` / `.cone` / `.pulse` /
`.surge` / `.arrow`、`strike.melee` / `.unarmed` / `.thrown`、`target.blast`），并把既有的
`generic.travel` 兜底规则从 `jb2a.magic_missile` 迁移到 ASSET-NOTES 认可的路径。
`test/armory-travel.test.mjs` 按简报 Step 1 逐字写入、TDD 全程确认先红后绿。
`npm test`：**92/92 全绿**（原 83 + 本轮新增 9）。覆盖率 100%（434/434 动作至少一个
cue），降级率 **0.00%**（0/434 触发 bestFit 降级，远低于 15% 阈值）。

## 9 条规则的选材与理由

### spell.gesture.ray（pri 780）

`jb2a.ranged.beam.001.01.blue.30ft`（ASSET-NOTES 第 79 行：travel / 聚拢-爆发 /
91 帧 / stretchTo=是 / 自带闪爆=是）。选它而不是 eskie 的 arrow.ray 是因为后者带明确
箭头形（留给了 `spell.gesture.arrow`），beam 才是真正首尾连通的连续光束，适合
`stretchTo` 贴合 line 模板。记录实测：f0-9 全空（333ms）→ `startTime:333`；两端在
f36-73（1200-2433ms）真正连通，f74 起 17 帧死尾（567ms）→ `duration:2100`（跳过死尾）。
`template=[200,200,200]` 非空，确认可 stretchTo。**自带蓝白星爆命中在 f37，落在目标
端** —— 与 impact 层命中闪光会双闪，已列入下方"转交 Task 11"清单。

ft 处理：颜色+ft 写死为 `blue.30ft`，未使用 `{color:runeColor()}`——见下方"ft 档位"一节。

### spell.gesture.cone（pri 780）

`jb2a.breath_weapons.fire.cone` + `{color: ctx.runeColor()}`（ASSET-NOTES 第 83 行：
travel / intro-loop-outro / 254 帧 / stretchTo=是 / 自带闪爆=否）。实测颜色分支
（blue/green/orange/purple/yellow）**不在**文末"同族分支帧数不一致"清单里，且 `01`/`02`
两个变体号经查证是同一条 30ft 时间轴的两版画法（Fire01/Fire02），不是隐藏的 ft 分支——
所以敢用 `{color}` 动态染色。记录实测：f0-89 只有零星预热火星、f90-94 纯空，火头
f95 才真正喷出（3167ms）→ `startTime:3167`；平台段 f120-204 亮度稳定 90%+，
`duration:3666`（裁到约 f205）。`yScale=(region.angle??60)/60`，fixture 里 `region.angle=60`
故当前恒为 1，公式对非 60° 张角同样成立。`mask:"region"`。

### spell.gesture.pulse（pri 770）

`eskie.pulse.energy.01` + `{color: ctx.runeColor()}`（ASSET-NOTES 第 116 行：impact /
扩散 / 23 帧 / 自带闪爆=否）。颜色分支（blue/green/orange/purple/red/yellow）同样不在
帧数不一致清单里。记录该行虽标注槽位为 impact，但其几何本质（同心圆自中心向外扩散）
与 travel 规则表要求的"从施法者向外扩散的环"完全一致——ASSET-NOTES 本身就确认过
"同一条路径可以出现两次…因为同一素材在两个槽里的用法与坑点不一样"这种跨槽复用模式
（如 `jb2a.markers.fear.dark_purple.01` 在 aftermath/persist 两行）。23 帧 @29.97fps=767ms：
f0 已是完整环、无 alpha 淡入（"起手很硬"）→ 补 `fadeIn:100` 抹平；f14 起碎裂消散，
f20-22 空转 → `duration:634`。

**锚点缺口**（已写入代码注释）：`resolve.mjs` 对 travel 槽统一把 `at.ref` 记为
`"target"`（S2-S4 按目标循环，resolve.mjs:65-67），没有 `at.ref==="origin"` 的选项——
只有 cast 槽有。本规则语义上"从施法者发出"，但当前基础设施下只能落在每个目标位置，
读作"脉冲波及到这个目标时的涟漪"。要做到真正的施法者锚点需要给 `resolve.mjs`
（不在本任务允许修改的文件范围内）加 `at.ref==="origin"` 的 travel 支持。

### spell.gesture.surge（pri 770）

`eskie.casting.physical.01.center.one_shot` + `{color: ctx.runeColor()}`（ASSET-NOTES
第 70 行：cast / 聚拢-爆发 / 30 帧 / 自带闪爆=是）。颜色分支（blue/green/orange/purple/
red/yellow/white，共 7 支）未被列入帧数不一致清单，可安全动态染色。同样是跨槽复用
（该行原始记录槽位是 cast，未被 cast.mjs 使用过）。记录实测：f0-3 空（125ms）→
`startTime:125`；出手节拍点在 f18 爆闪（原始 750ms，裁后约 625ms）→ 不再另加 duration
裁剪（30 帧总长本就短）。

这条把 `aim.towards` 指向 `s.origin`（施法者自己）而不是目标——是本文件唯一这样做的
规则，用于向未来播放层（Task 13）表达"自身效果"意图。但由于上述同一个 `at.ref`
基础设施缺口，**这条规则的双闪风险是有条件的**：若播放层真按 `aim.towards` 渲染在
施法者身上则不会撞见 impact 层的目标闪光；若播放层退回到 `at.ref==="target"`，
自带爆闪就会落在目标、与 impact 层撞车。已按"有条件风险"列入下方转交清单，不敢断言
绝对安全。

### spell.gesture.arrow（pri 760）

`jb2a.ranged.01.projectile.01.dark_purple.30ft`（ASSET-NOTES 第 78 行：travel / 单段 /
55 帧 / stretchTo=是 / 自带闪爆=是）。只有 dark_green/dark_orange/dark_purple 三个颜色
分支，且带 ft 结构，颜色+ft 一起写死（理由见"ft 档位"一节）。记录实测：f0 即有内容
不必 startTime；自带箭形命中爆闪在 f14-15（约 467ms），落在目标端 → 与 impact 层双闪，
转交 Task 11。f51-54 空 alpha → `duration:1667`（裁掉）。`waitUntilFinished:-1200`
让下一段紧跟命中闪光。实现了 `aim.missed` 逻辑（`test/armory-travel.test.mjs` 的
"未命中时投射物走 missed" 用例覆盖，取自 `spell.storm.arrow` fixture）。

### strike.melee（pri 620）—— 本槽核心，三处几何修正

- **贴身/隔格换素材**：`ctx.geom.adjacent(target)` 为真时用
  `jb2a.melee_attack.01.shortsword.01`（第 84 行，_template 跨距正好 1 格 5 尺），
  否则用 `jb2a.melee_attack.05.nodachi.01`（第 85 行，唯一真正够得到隔一格的
  melee_attack 素材——`jb2a.melee_attack.05.scythe.01` 与 `.03.greatsword.01`
  都已被 ASSET-NOTES 否决清单第 174/175 行明确否掉：两者画幅仍是 800x600，
  实测只多出 0.24-0.37 格，做不出"隔一格"的长度差）。
- **大体型补偿**：`objectScale: 1 * ctx.geom.sizeScale()`，`offset.x: ctx.geom.offsetFor(target, 0.5)`。
- **镜像朝向**：`mirrorY: ctx.geom.onLeft(target)`（两条素材都是从左下抡向右上的
  明确手性，ASSET-NOTES 原文实测确认）。

两条素材 `colorsUnder` 均为空（无颜色分支），不传 `{color}`。`duration` 按各自记录的
死尾裁剪：shortsword 命中峰 f16（533ms），f29-45 占 37% 全空 → `duration:933`；
nodachi 命中峰 f12（400ms），f24-41 占 43% 全空 → `duration:767`。两者自带闪爆均为
"否"，无需转交 Task 11。**已知未解决的限制**：两个叶子都是 4 文件的 variant 数组，
`ctx.pick` 按 seed 每次重掷，帧长在 1.30-1.53s（shortsword）/1.40-1.47s（nodachi）间
波动，命中帧号也随 variant 漂移——这是 `ctx.pick` 本身的机制（多文件数组的确定性
随机选取），不是规则层面能修的，需要 ctx 增加"锁定 variant"的能力才能根治，本任务
范围内只做记录。

### strike.unarmed（pri 610）

`jb2a.unarmed_strike.physical.01.blue`（ASSET-NOTES 第 86 行：31 帧 / 自带闪爆=是）。
**没有走 `{color: ctx.damageColor()}`**：ASSET-NOTES 文末"A. 颜色分支之间帧数不一致"
明确点名这一家——blue/green/orange/pinkpurple/yellow 是 31 帧(1.033s)，但
dark_purple/dark_red 是 51 帧(1.700s，1.65 倍)；而 `DAMAGE_COLOR.void` 与
`RUNE_COLOR.oblivion` 恰好都是 `dark_purple`，`pickColor` 的最近色计算还会把
`purple` 也路由到 `dark_purple`——三条路都可能在毫无征兆的情况下把 1.03s 的时序表
换成 1.70s。unarmed 攻击的伤害类型在 PF2E 里几乎总是 bludgeoning
（`DAMAGE_COLOR.bludgeoning === null`），动态染色本就用不上，因此直接锁定安全分支。
自带闪爆="是"（f19 起黄白命中爆闪，落在目标端）→ 转交 Task 11。`waitUntilFinished:-400`
使下一段紧跟命中闪光（f19≈633ms，总长1033ms）。PF2E 里 unarmed 永远是贴身武器，
没有"隔格"变体可选，因此不像 strike.melee 那样做分支。

### strike.thrown（pri 600）

`blfx.weapon.range.dagger1.throw1.color1.30ft`（ASSET-NOTES 第 87 行：travel / 单段 /
54 帧 / stretchTo=是 / 自带闪爆=是）。`colorsUnder` 只有字面量 `"color1"` 这一个键，
根本不在 `COLOR_HUE` 表里——传 `{color}` 会被 `pickColor` 判定为无可用分支而静默
退回不染色（等价于没传），所以直接写死完整路径。记录实测：f0-16 是向后收势的蓄力
（"先退后再甩出"，533ms）→ `startTime:533`；真正飞行是 f16-27（收势后 0-367ms）；
自带金色命中光环 f27-36（收势后 367-667ms），落在目标端 → 转交 Task 11；f51 起彻底
归零 → `duration:1167`（收势后）。`mirrorY: ctx.geom.onLeft(target)`（向左投掷需要
镜像）。实现了 `aim.missed`。

### target.blast（pri 200）

`build: () => null`，与简报 Step 3 给出的示例逐字一致——爆发姿态没有飞行段，全部
交给 impact。`test/armory-travel.test.mjs` 的"爆发姿态没有飞行段"用例确认
`spell.death.blast` 在 travel 槽产出 0 条 cue。

### generic.travel 兜底（pri 10，既有规则，本次迁移）

原路径 `jb2a.magic_missile`（Task 7 遗留、ASSET-NOTES 建立之前的历史欠账）已替换为
`eskie.attack.ranged.arrow.ray.physical.blue.30ft`（ASSET-NOTES 第 80 行：travel /
单段 / 24 帧 / 自带闪爆=否）。选它的理由：前端带明确箭头形，语义上比法术味的
magic_missile 更贴合"普通远程武器攻击（弓弩）"这个兜底场景——真正的法术定向投射物
已经由专属的 `spell.gesture.arrow` 规则（`jb2a.ranged.01.projectile`，发光弹体）承担，
两者语义上不再撞车。同样带 ft 结构，写死 `.blue.30ft`。记录实测：24 帧 @24fps=1.000s，
没有真正的"射出"过程（第 2 帧已整条拉满），f8 起碎裂淡出 → `duration:800` 跳过淡出尾段。
自带闪爆="否"，无需转交 Task 11。补加了 `stretchTo`（原规则没有）：`_template=[200,0,100]`
非空，且这是一个跨任意格距的普通武器攻击，stretchTo 能让素材宽度自适应实际距离，
比原来只用 `aim` 更正确。

## magic_missile 迁移与白名单条目删除

- `test/armory-assets.test.mjs` 的 `LEGACY_UNVERIFIED` 白名单里删除了
  `"jb2a.magic_missile", // travel.mjs generic.travel，待 Task 10 迁移` 这一条。
- 同步更新"不许新增"测试：`KNOWN` 数组从 4 条改为 3 条
  （`jb2a.extras.tmfx.outflow.circle.01` / `jb2a.healing_generic.burst` /
  `jb2a.impact.004`），标题文案同步改成"锁死为当前已知的 3 条"。
- 验证过"自动失效"机制确实会触发：在改 `travel.mjs`（把 `jb2a.magic_missile` 换成
  新路径）之后、修改 `armory-assets.test.mjs` 之前跑过一次 `armory-assets.test.mjs`——
  "LEGACY_UNVERIFIED 白名单里每一条都仍被某个兵库文件实际引用"这条测试如预期打红：
  `travel.mjs` 已经不再引用 `"jb2a.magic_missile"` 字符串，白名单里那一条就成了
  `allPickedPaths()` 里找不到的僵尸条目。按测试报错信息的指示，从 `LEGACY_UNVERIFIED`
  里删掉这一条，并同步把"不许新增"测试的 `KNOWN` 数组从 4 条改成 3 条（否则
  `deepEqual([...LEGACY_UNVERIFIED].sort(), KNOWN)` 会因为长度不一致而失败）。
  两处改完后 `node --test test/armory-assets.test.mjs` 3/3 全绿。

## ft 档位问题：处理方式（未做真正的按格距分级）

Task 9 把 `strike.ranged.draw`（cast 槽长弓音效）写死 `.30ft` 的问题移交给本任务。
调查结论：**本槽用到的全部 ranged/thrown/spell-arrow 素材在 `data/asset-index.json`
里都确实存在 `05ft/15ft/30ft/60ft/90ft` 五档同级分支**（逐一用
`offlineBackend`/`createAssets` 验证过，见下方"路径验证输出"），但 **ASSET-NOTES
对每一家都只抽帧验证过其中一档**（多为 30ft，eskie 的 arrow 家族是 05ft/15ft 起，
本表选的仍是 30ft 那行）。

关键的 API 约束：`ctx.pick(dbPath, {color})` 只能把颜色段拼在 `dbPath` **末尾**，
没有机制在颜色之后再追加一层 ft。而这几家素材的路径结构是 `<...>.<color>.<ft>`
（ft 在颜色之后），所以：

- 若只传 `{color}` 不带 ft（如 `ctx.pick("jb2a.ranged.beam.001.01", {color:"blue"})`），
  `bestFit` 会在颜色分支下继续往下走、遇到 `05ft/15ft/30ft/60ft/90ft` 这个新的分支层，
  取该层字典序/插入序第一个（实测是 `05ft`）——**静默**发生，`diverged` 不会置位
  （这是 `assets.mjs` 里 `getEntry()` 对中间节点"取第一个叶子代表"的既有行为，不是
  `bestFit` 那条会记录 `diverged` 的降级路径）。也就是说，光靠 `{color}` 拿到的
  ft 几乎必然不是 ASSET-NOTES 实测过的那一档，而是一个从未验证过时序的档位——
  与 Task 9 报告里 longbow 05ft/30ft 声音坑完全同源，只是换成了视觉版本。
- 因此本任务对所有带 ft 结构的素材（ray/arrow/thrown/generic.travel 兜底 共 4 条
  规则）一律**写死颜色+ft**成 ASSET-NOTES 实测过的那一支，放弃了跟随
  `runeColor()`/`damageColor()` 动态染色的能力。

**没有实现"按 `s.target.distance` 挑 ft 档"**，理由：

1. 每家素材目前只有一档被验证过时序（意味着即使实现了按距离选档的分支逻辑，
   05ft/15ft/60ft/90ft 那几档的实际时长、空头空尾、命中闪光帧号全部未知——写出来的
   代码会通过 `armory-assets.test.mjs` 的文本前缀检查（因为它只查字符串是否是表内
   某行的前缀，不检查具体解析到哪个文件），但完全没有 ASSET-NOTES 意义上的选材依据，
   等同于"按文件名猜"——正是 ASSET-NOTES 开篇就点名要杜绝的做法。
2. `ctx.pick` 的 API 现状（颜色只能拼在末尾）决定了"动态染色"与"精确锁定 ft"这两
   件事在当前基础设施下互斥，二选一。

**建议**（供后续裁决）：如果确实需要按实际格距选择 ft 档，需要先对每家素材的
05/15/60/90ft 逐档抽帧核实时序（新一轮 `tools/contact-sheet.sh` 侦察，补进
ASSET-NOTES），再考虑给 `ctx.pick` 加一个"末尾再拼一段"的能力（例如
`pick(dbPath, {color, suffix})`）。这两件事都超出本任务允许修改的范围
（只允许改 `scripts/armory/travel.mjs` 与其测试），故未实现，按简报授权的
"据理提出"选项处理。

## 自带闪爆：转交 Task 11 的清单

以下素材在 travel 段落已经自带命中闪光，Task 11 的 impact 层如果再叠一次通用命中
闪光就会双闪，两者需要二选一或者错开时间：

| 规则 | 素材 | 自带闪爆帧号（原始时间轴） | 备注 |
| --- | --- | --- | --- |
| `spell.gesture.ray` | `jb2a.ranged.beam.001.01.blue.30ft` | f37（连通后 1 帧，约 1233ms） | 蓝白星爆，落在目标端 |
| `spell.gesture.arrow` | `jb2a.ranged.01.projectile.01.dark_purple.30ft` | f14-15（约 467-500ms） | 箭形爆闪，落在目标端 |
| `strike.unarmed` | `jb2a.unarmed_strike.physical.01.blue` | f19 起（约 633ms） | 黄白星形，落在目标端 |
| `strike.thrown` | `blfx.weapon.range.dagger1.throw1.color1.30ft` | f27-36（约 900-1200ms） | 金色光环，落在目标端 |
| `spell.gesture.surge`（**有条件**） | `eskie.casting.physical.01.center.one_shot.<color>` | f18（约 750ms） | 落在施法者而非目标——但 `resolve.mjs` 当前对 travel 槽统一 `at.ref="target"`，若 Task 13 播放层不遵循本规则的 `aim.towards=origin` 信号而是退回 `at.ref`，这条爆闪实际上会渲染在目标身上，产生与 impact 层的双闪 |

无自带闪爆、Task 11 不需要处理的：`spell.gesture.cone`
(`jb2a.breath_weapons.fire.cone`)、`spell.gesture.pulse` (`eskie.pulse.energy.01`)、
`strike.melee` 两条 (`jb2a.melee_attack.01.shortsword.01` /
`jb2a.melee_attack.05.nodachi.01`)、`generic.travel` 兜底
(`eskie.attack.ranged.arrow.ray.physical.blue.30ft`)。

## 锚点基础设施缺口（备忘，非阻塞）

`spell.gesture.pulse`（从施法者向外扩散）与 `spell.gesture.surge`（自身爆发）在语义上
都应该锚在施法者身上，但 `resolve.mjs`（S2-S4 循环，resolve.mjs:60-69）目前对
travel/impact/aftermath 三个槽统一把 `at.ref` 记为 `"target"`，没有 `"origin"` 选项
（只有 cast 槽的 `at:{ref:"origin"}` 有）。这两条规则用 `aim.towards` 分别指向目标
（pulse，读作"波及到这个目标的涟漪"）与施法者自己（surge，读作"自身效果"）作为对
未来播放层（Task 13）的最强信号，但 `resolve.mjs` 本身不支持真正的
`at.ref==="origin"` travel cue。若需要精确解决，需要在 `resolve.mjs`（不在本任务
允许修改的文件范围）里给 travel 槽增加 origin 锚点支持。已在代码注释与本报告中
记录，供 Task 13 或后续基础设施任务参考。

## 路径验证输出（node -e 直接查询 offlineBackend）

```
jb2a.ranged.beam.001.01.blue.30ft
  -> Beam001_01_Regular_Blue_30ft_600x400.webm, template=[200,200,200], diverged=false
jb2a.breath_weapons.fire.cone.orange (color 动态)
  -> BreathWeapon_Fire01_Regular_Orange_30ft_Cone_Burst_600x600.webm, template=[100,0,0]
eskie.pulse.energy.01.<color> (动态)
  -> Energy_Pulse_01_<Color>.webm, template=null（不需要 stretchTo）
eskie.casting.physical.01.center.one_shot.<color> (动态)
  -> Casting_Physical_01_Center_OneShot_<Color>.webm, template=null
jb2a.ranged.01.projectile.01.dark_purple.30ft
  -> RangedInstant01_01_Dark_Purple_30ft_600x400.webm, template=[200,200,200]
jb2a.melee_attack.01.shortsword.01
  -> MeleeAttack01_ShortSword01_01_800x600.webm (4-file variant array), template=[200,300,300]
jb2a.melee_attack.05.nodachi.01
  -> MeleeAttack05_Nodachi01_01_1000x800.webm (4-file variant array), template=[200,400,400]
jb2a.unarmed_strike.physical.01.blue
  -> UnarmedStrike_01_Regular_Blue_Physical01_800x600.webm, template=[200,300,300]
blfx.weapon.range.dagger1.throw1.color1.30ft
  -> Dagger_1_Throw_1_COLOR_1_30ft_600x400.webm, template=[200,200,200]
eskie.attack.ranged.arrow.ray.physical.blue.30ft
  -> Attack_Ranged_Arrow_Ray_Physical_Blue_30ft.webm, template=[200,0,100]
```

全部 `diverged=false`（无 bestFit 降级），全部 `template` 非空（除 pulse/surge 两条
非 stretchTo 用途、`template=null` 也不影响使用）。

## npm test 完整结果

```
node --test test/
...
1..92
# tests 92
# suites 0
# pass 92
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

92/92 全绿（原 83 + 本次新增的 `test/armory-travel.test.mjs` 9 条）。子集验证：

- `node --test test/armory-travel.test.mjs` → 9/9（含"规则表规模与 id 唯一"
  `travel.length >= 10` 断言：9 条新规则 + 既有 `generic.travel` 兜底 = 10 条，
  与断言的下限精确吻合）
- `node --test test/armory-assets.test.mjs` → 3/3（含白名单"不许新增"改后的 3 条
  版本、"自动失效"验证）
- `node --test test/asset-notes.test.mjs` → 6/6（未改动 ASSET-NOTES.md 本身，
  本次没有新增记录，因为 9 条规则全部复用了已有的 93 行记录，包括两条跨槽复用
  的 pulse/surge）
- `node --test test/coverage.test.mjs` → 6/6

## 覆盖率与降级率复算

对全部 434 个 fixture 动作重新跑 `resolve()`：

- **覆盖率**：434/434 至少产出一个 cue（0 个空动作），100%。
- **降级率**：0/434 触发 `assets.warnings`（bestFit 降级），**0.00%**，远低于
  `test/coverage.test.mjs` 断言的 15% 阈值。
- travel 槽本身按规则命中次数统计（434 个 fixture 里）：
  `generic.travel` 192、`spell.gesture.arrow`/`.cone`/`.pulse`/`.ray`/`.surge`
  各 24（12 符文 × 2 目标）、`strike.thrown` 8（4 个 thrown fixture × 2 目标）、
  `strike.melee` 2（唯一一个非空 `strikes` 的 fixture × 2 目标）。`strike.unarmed`
  与 `target.blast` 在当前 434 个 fixture 里均为 0 次命中——`strikes` 里没有
  `category==="unarmed"` 的 fixture（用 `melee()` 测试 helper 在
  `armory-travel.test.mjs` 里手工构造覆盖），`target.blast` 按设计 `build()` 返回
  `null` 不产生 cue（"爆发姿态没有飞行段"用例已覆盖该行为）。

## 文件清单

- 修改：`/root/crucible-anim/scripts/armory/travel.mjs`（新增 9 条规则 + 迁移
  `generic.travel` 兜底素材）
- 新增：`/root/crucible-anim/test/armory-travel.test.mjs`（简报 Step 1 原文）
- 修改：`/root/crucible-anim/test/armory-assets.test.mjs`（`LEGACY_UNVERIFIED`
  删除 `jb2a.magic_missile`，"不许新增"测试的 `KNOWN` 数组同步改为 3 条）
