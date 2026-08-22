# Task 9 报告：兵库 S1 cast 槽

## 状态

DONE

## 概览

按简报 Step 1→5 做 TDD：先写 `test/armory-cast.test.mjs`（简报给的原样内容）确认在只有兜底规则的
`cast.mjs` 下 5/7 用例失败，再往 `scripts/armory/cast.mjs` 填入 8 条规则（`pri` 780/780/770/700/
640/620/420/380），全部落在 300–899 区间。`npm test` 全绿（76/76），降级率实测 **0.00%**。

## 8 条规则的选材与理由

| id | pri | 路径 | 依据（ASSET-NOTES 行） |
| --- | --- | --- | --- |
| `spell.gesture.ward` | 780 | `jb2a.magic_signs.circle.02.abjuration.complete`（+`ctx.runeColor()`） | 【防护法阵 ward】行：闭合圆环内嵌六芒星、地面层、12 色分支齐全。实测 f9 起笔、f61 爆闪、f71 起进入非无缝的「稳态」（相邻帧差 0.99-2.33，接缝差 9.95），完整 265 帧 @24fps=11.04s「比任何 PF2E 回合都长」——按笔记建议只播「起笔+爆闪」，加 `duration: 2900` 截在 f71 收尾处，不进入不可循环又冗长的尾巴。 |
| `spell.gesture.conjure` | 780 | `jb2a.magic_signs.circle.02.conjuration.complete`（+`ctx.runeColor()`） | 【召唤法阵 conjure】行：五芒星+符文外环，与 abjuration.complete 共用同一条时间轴（f9/f61/f71 三个节点逐帧核对一致），同理 `duration: 2900`。笔记明确「外环符文密度极高，缩到 1 格 token 尺寸糊成毛边带，召唤法阵至少铺 2 格才立得住」，故 `objectScale: 2`（ward 用 1.1）。 |
| `spell.gesture.aspect` | 770 | `jb2a.on_token_buff.001.001`（+`ctx.runeColor()`） | 【自身增益辉光 aspect】行：居中同心环+星形碎片，钉在施法者身上。笔记两个坑：(1) f1 直接硬弹到近峰值、无天然淡入——`fadeIn: 150` 只抹掉这一下弹出；(2) f46 起 9 帧空转（约 0.3s）——`waitUntilFinished: -300` 跳过尾部空转，不必再叠 `duration`。 |
| `spell.composed` | 700 | `jb2a.magic_signs.circle.02.evocation.loop`（+`ctx.runeColor()`） | 【通用施法圈·12色主力】行：逐帧 alpha 恒定 54.5，121 帧一个数不变、首尾无渐变，确认是真无缝 loop——可以在任意一点截断不露接缝，`duration: 1500` 给起手一个合理长度而不必播满 121 帧@24fps=5.04s。这是任何法术（`spell !== null`）的默认兜底。 |
| `strike.ranged.draw` | 640 | `psfx.ranged-weapons.longbow.v1.30ft`（sound，无视觉） | sound 槽行：3.5s 烘焙音频，拉弓 0.05-0.35s → 放弦 0.62-0.80s → 箭到 0.80-1.05s，其后 2.45s 静音填充。按简报模板只挂 sound 轨；视觉刻意留空——ASSET-NOTES 里唯一能当远程蓄力视觉的 `jb2a.cast_generic.02` 只有 4 个颜色分支、配不满符文色，且语义是法术蓄力而非弓弩拉弦，硬凑不相干会文不对题，留给 travel/impact 承担。 |
| `strike.melee.heavy` | 620 | 无（`build: () => null`） | 简报模板原样：重武器起手不出内容，蓄力感交给 travel 段的挥击弧线。 |
| `tag.healing` | 420 | `jb2a.healing_generic.200px`（固定 `color: "green"`） | 【治疗起手·手部】行：ASSET-NOTES 里唯一原生 200x200、小到能钉在手上而不糊住整个 token 的治疗素材（其它治疗分支都是 400px 起）。固定 green（与既有 S4 `generic.aftermath` 治疗规则同色约定），因为治疗本身是语义色不该被符文色带偏。有效内容约 1.35s（51 帧@30fps=1.7s，末 10 帧全空），`duration: 1350` 避免空等。 |
| `tag.skill` | 380 | `blfx.spell.cast.light_flare.1.center.color3`（固定色，不走 `{color}` 最近色匹配） | 【技能检定轻量闪光】行：color1 是彩虹色散版跟不了任何单色，color2-color7 才是单色；但这 7 个分支名是 `colorN` 不是色名，若走 `ctx.pick(path, {color: ...})` 会被 `pickColor` 的 `COLOR_HUE` 过滤器全部滤掉、悄悄降级回 color1（彩虹）。因此直接锁定 ASSET-NOTES 里已实测验证过的 `color3`。有效内容到约 f38（60 帧@30fps 里的 1.27s），`duration: 1300`；源画幅 1200x1200、能量集中在中心一半区域，按 token 尺寸直接贴显小，`objectScale: 1.4` 放大。 |

## 路径验证输出

用简报给的验证脚本对全部 8 条规则实际引用的路径（含 `strike.ranged.draw` 的 sound 路径与
`tag.skill` 的固定 colorN 路径）逐一核验，均 `diverged === false` 且 `r.path === p`：

```
OK   jb2a.magic_signs.circle.02.evocation.loop.blue -> jb2a.magic_signs.circle.02.evocation.loop.blue
OK   jb2a.magic_signs.circle.02.abjuration.complete.blue -> jb2a.magic_signs.circle.02.abjuration.complete.blue
OK   jb2a.magic_signs.circle.02.conjuration.complete.green -> jb2a.magic_signs.circle.02.conjuration.complete.green
OK   jb2a.on_token_buff.001.001.blue -> jb2a.on_token_buff.001.001.blue
OK   jb2a.healing_generic.200px.blue -> jb2a.healing_generic.200px.blue
OK   jb2a.healing_generic.200px.green -> jb2a.healing_generic.200px.green
OK   blfx.spell.cast.light_flare.1.center.color3 -> blfx.spell.cast.light_flare.1.center.color3
OK   psfx.ranged-weapons.longbow.v1.30ft -> psfx.ranged-weapons.longbow.v1.30ft
```

对 4 条走 `ctx.pick(basePath, {color: ctx.runeColor()})` 的规则，还额外核对了 base path（不含
颜色段）的 `colorsUnder()` 结果，确认 `pickColor` 在运行时会落到列表内的真实分支、不会降级：

```
jb2a.magic_signs.circle.02.evocation.loop colorsUnder: [dark_blue, dark_green, dark_pink, dark_purple,
  dark_red, dark_yellow, blue, green, pink, purple, red, yellow]  # 12 色齐全
jb2a.magic_signs.circle.02.abjuration.complete colorsUnder: 同上 12 色 + _markers（被 COLOR_HUE 过滤掉）
jb2a.magic_signs.circle.02.conjuration.complete colorsUnder: 同上
jb2a.on_token_buff.001.001 colorsUnder: [blue, bluepurple, blueteal, greenpurple, greenyellow,
  orangeyellow, pinkyellow, purplered, white]  # COLOR_HUE 命中 4 个：blue/bluepurple/greenyellow/white
jb2a.healing_generic.200px colorsUnder: [blue, green, purple, red, yellow, yellow02]
```

用 `pickColor` 实跑 12 个符文对 `jb2a.magic_signs.circle.02.evocation.loop` 取色，确认无一降级、
11/12 产出不同 `(color, hue)` 组合（kinesis 与 soul 都映射到 `teal`，取到同一近似色属预期）：

```
control  want=bluepurple    -> dark_blue  hue=25
death    want=purple        -> purple     hue=0
earth    want=dark_green    -> dark_green hue=0
flame    want=orange        -> yellow     hue=-25
frost    want=blue          -> blue       hue=0
illumination want=yellow    -> yellow     hue=0
illusion want=pink          -> pink       hue=0
kinesis  want=teal          -> dark_green hue=35
life     want=green         -> green      hue=0
oblivion want=dark_purple   -> dark_purple hue=0
soul     want=teal          -> dark_green hue=35
storm    want=blueyellow    -> dark_blue  hue=10
distinct combos: 11
```

## `npm test` 结果

全量 76 个测试（含新增 `test/armory-cast.test.mjs` 的 7 个）全部通过：

```
1..76
# tests 76
# suites 0
# pass 76
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

Step 2（先跑失败）时的记录：`node --test test/armory-cast.test.mjs` 在只有兜底规则时 7 个用例
5 fail / 2 pass（规模/pri 区间与「重武器不出内容」「不引用绝对路径」这三条本就该过的先过）。
填入 8 条规则后同一文件转为 7/7 全绿。

## 降级率实测

对 `test/fixtures/actions.json` 434 个动作快照逐一 `resolve()`，累加每次 `assets.warnings.length`：

```
diverged 0 total 434 rate 0.00%
```

`test/coverage.test.mjs` 的降级率断言（< 15%）以极大余量通过；同时确认全程零 `ctx.warn`（无规则
`when()` 抛异常），零禁用全局引用（`game/canvas/Hooks/Sequencer/ui/CONFIG`），零 `modules/` 绝对
路径，`cast.mjs` 内无 `Math.random`。

## 对简报的修正

1. **ward / conjure 增加了 `duration` 截断**：简报 Step 3 给的 ward 完整模板本身没有 `duration`
   字段，会导致播放完整 265 帧 @24fps=11.04s 的素材。ASSET-NOTES 对这条素材的订正备注明确指出
   「稳态段画面仍在缓慢变化、不能截成无缝循环」且「整条播 11 秒比任何 PF2E 回合都长」，因此我在
   两条法阵规则里都加了 `duration: 2900`，截在 f61 爆闪收尾（f71/24fps≈2.96s）处，只保留有明确
   起止的「起笔+爆闪」段。这是对模板字段集合的扩展，不是替换——其余字段与模板给定的完全一致。
2. **`strike.ranged.draw` 未叠加视觉层**：简报表格里该规则的表现描述是「拉弓起手 + 弓弦音」，
   字面上暗示应有视觉；但逐条核对 ASSET-NOTES 后，唯一名义贴切的远程蓄力视觉
   `jb2a.cast_generic.02` 只有 4 个颜色分支（配不满 12 符文色）且语义是法术蓄力而非弓弦拉弦，
   若硬套会文不对题。简报模板本身给的 `strike.ranged.draw` 完整实现也只挂了 sound 轨、没有视觉
   cue，因此我按模板原样只做 sound，未额外新增视觉层，并在代码注释里记下了不这样做的理由。
3. **`tag.skill` 未使用 `{color}` 最近色匹配**：`blfx.spell.cast.light_flare.1.center` 的颜色
   分支名是 `color1`..`color7`（不是色名），若沿用其余规则「`ctx.pick(base, {color: ...})`」的
   写法，`pickColor` 的 `COLOR_HUE` 过滤会把这 7 个分支全部滤空，安静地降级回 `color1`（彩虹色散
   版，ASSET-NOTES 明确标注「跟不了符文色」）。为避免这种静默错配，改为直接引用 ASSET-NOTES 里
   已验证过的具体路径 `blfx.spell.cast.light_flare.1.center.color3`，不做染色。

## 顾虑

- `spell.gesture.ward`/`spell.gesture.conjure` 的 `duration: 2900` 截断点是按 ASSET-NOTES 的帧号
  笔记折算出的近似值，笔记本身也说明「以上机验收为准」——建议这条在真实 Foundry 环境里过一遍，
  确认 2.9s 的起手时长在实际战斗节奏里不显冗长。
- `jb2a.magic_signs.circle.02.evocation.loop` 的 6 个 `dark_*` 分支据 ASSET-NOTES 是「低亮度描边
  版，贴在暗色地图上几乎糊没」；`oblivion` 等符文的 `runeColor()` 精确命中 `dark_purple`，在暗色
  场景里可能读不清。这条规则本身按简报字段集合实现完整，但暗色分支的可读性补偿（额外 opacity/
  发光）超出本任务范围，留给后续任务或美术验收决定是否要处理。

---

# 修复轮 1/5（评审回来后）

四个视角并行评审抓到 1 条 Critical、3 条 Important、3 条 Minor。以下逐条修复，均带红/绿验证证据。

## Critical：`generic.cast` 用的是 ASSET-NOTES 明确否掉的素材

`jb2a.cast_generic.03` 在 `docs/ASSET-NOTES.md`「被否掉的候选 · cast 槽」第一条被明确否决——
它是一发命中/爆炸素材（第 15 帧变纯白过曝球、第 20 帧碎裂甩出放射线），语义上是「打中了」而
不是「起手」，且 9 个颜色分支在过曝下分不出差别、配不满 12 符文色。这条规则实测覆盖 434 个
fixture 里的 **185 个（42.6%）**，是 cast 槽命中率最高的规则，其中包含全部 63 个零目标攻击类
动作里落到这条兜底的那部分——这是 cast 槽唯一表现，选错了素材代价最大。

**替换方案**：改用 `jb2a.magic_signs.circle.02.evocation.loop`。

- 在 ASSET-NOTES 主表第一行（cast 槽），标注「【通用施法圈·12色主力】…确认是真无缝 loop」，
  逐帧 alpha 恒定 54.5、121 帧一个数不变、首尾无渐变——因此可以在任意一点截断都不会露接缝，
  不像大多数候选那样要顾虑空头/空尾/自带闪爆的裁切点。
- 12 色分支（6 dark_ + 6 regular）齐全，是本轮所有 cast 候选里色支最多的之一；虽然实测这条
  规则命中的 185 个 fixture 的 `s.spell` 全部是 `null`（见下方命中分布复算），`ctx.runeColor()`
  恒为 `null`，实际总是落到 `?? "blue"` 的中性蓝，但保留 `{color}` 接口是为了防御性地兼容
  「`spell.composed` 的 `build()` 意外返回 `null` 从而回落到这里」这种边界情况。
- 语义准确：这是与 `spell.composed`（pri 700）同一条素材的「起手圈」定位，不是命中/爆炸。
- `duration` 截到 700ms（比 `spell.composed` 的 1500ms 更短）——它是全局命中率最高的默认兜底，
  覆盖大量零目标/无目标的普通近战挥砍前置动画，不宜像专门的法术起手那样长。

替换后的规则、路径验证：

```
$ node -e '...a.resolve("jb2a.magic_signs.circle.02.evocation.loop.blue")...'
OK   jb2a.magic_signs.circle.02.evocation.loop.blue -> jb2a.magic_signs.circle.02.evocation.loop.blue diverged=false
```

## 结构性守卫：新增 `test/armory-assets.test.mjs`（兵库 → ASSET-NOTES 反向校验）

原有 `test/asset-notes.test.mjs` 只查「表 → 索引」，没有任何测试查「兵库 → 表」，所以兵库引用
一条被否决的素材，76/76 照样全绿。新测试扫描 `scripts/armory/**/*.mjs` 里所有
`ctx.pick()`/`ctx.sound()` 调用的路径字面量，断言每条都 **(a)** 精确命中主表某行或是某行的
父路径，**且 (b)** 不在文末否决清单里（含父/子路径两个方向）。

实现里发现一个需要显式裁决的问题：`travel.mjs`/`impact.mjs`/`aftermath.mjs`/`persist.mjs`
各自唯一的 `pri:10` 兜底规则（`jb2a.magic_missile`、`jb2a.impact.004`、
`jb2a.healing_generic.burst`、`jb2a.extras.tmfx.outflow.circle.01`）都写于 ASSET-NOTES 存在
之前，既不在主表也不在否决清单里——与本轮修的 `cast_generic.03` 同源问题，但分属 Task 10/11/12
尚未开始的迁移范围。若不处理，扫描整个 `scripts/armory/` 目录会让这条新守卫立刻变红，但那不是
本轮该修的东西。处理方式：在测试里显式列了一个只含这 4 条路径的 `LEGACY_UNVERIFIED` 白名单，
逐条注明「待 Task N 迁移」，并注明"这几个文件里任何其它新路径仍会被正常拦截"——这样守卫依然
扫描全目录（保护 Task 10/11/12 新增的规则），但不会因为不在本轮范围内的历史技术债务而假红。
已在报告里记录，供协调者审阅这个裁决是否需要调整。

**红/绿验证（三组，均已验证后把工作区还原到修复后的干净状态）：**

1）保持 `jb2a.cast_generic.03` 不变 → 红（这正是它该抓的东西）：

```
not ok 1 - 兵库规则引用的每条 DB 路径都能在 ASSET-NOTES 主表里查到依据，且不在否决清单里
  error: |-
    1 条兵库路径没有 ASSET-NOTES 依据或已被否决：
    /root/crucible-anim/scripts/armory/cast.mjs: "jb2a.cast_generic.03" — 在否决清单里
```

2）换成 `jb2a.magic_signs.circle.02.evocation.loop`（当前状态）→ 绿：

```
ok 1 - 兵库规则引用的每条 DB 路径都能在 ASSET-NOTES 主表里查到依据，且不在否决清单里
```

3）把 `tag.skill` 的合规路径临时改成否决清单里的另一条（`jb2a.glint.blue.few`）→ 又变红：

```
not ok 1 - 兵库规则引用的每条 DB 路径都能在 ASSET-NOTES 主表里查到依据，且不在否决清单里
  error: |-
    1 条兵库路径没有 ASSET-NOTES 依据或已被否决：
    /root/crucible-anim/scripts/armory/cast.mjs: "jb2a.glint.blue.few" — 在否决清单里
```

（额外验证：改成一个主表里完全查不到的虚构路径 `jb2a.totally.made.up.path.xyz` 同样正确变红，
错误信息是「主表里查不到依据」而不是「在否决清单里」，说明两条判据分支都在正常工作。）

## Important 1：4 条规则补上行为测试，逐条破坏验证

`test/armory-cast.test.mjs` 新增 4 条：`spell.gesture.conjure`（用 fixture
`spell.control.conjure`）、`spell.gesture.aspect`（`spell.control.aspect`）、`tag.healing`
（`medicinalCompound`，该 fixture 同时带 `healing`/`skill` 两个标签，用来顺带验证 pri 420 >
380 的优先级生效）、`tag.skill`（`alchemicalResolve`，只带 `skill` 不带 `healing`，避免被
`tag.healing` 抢先命中）。

逐条把对应规则的 `when` 改成 `() => false`，确认只有对应那一条行为测试变红、其余不受影响，
再还原：

```
--- disable spell.gesture.conjure's when ---
ok 1..4
not ok 5 - conjure 姿态命中专属的召唤法阵规则
ok 6..11

--- disable spell.gesture.aspect's when ---
ok 1..5
not ok 6 - aspect 姿态命中专属的自身增益规则
ok 7..11

--- disable tag.healing's when ---
ok 1..6
not ok 7 - healing 标签命中手部绿光规则
ok 8..11

--- disable tag.skill's when ---
ok 1..7
not ok 8 - skill 标签（不带 healing）命中轻量闪光规则
ok 9..11

--- restore ---
diff: 无输出（文件与修复后状态逐字节相同）
ok 1..11（全绿）
```

## Important 2：ward / conjure 补 `startTime`，`duration` 按各自素材重算

ASSET-NOTES 对两条素材都实测 f0-8 是纯空帧（9 帧@24fps=375ms）。原实现的 `fadeIn:300` 整段
落在这 375ms 空帧上，实际观感是空等 375ms 后满不透明度硬弹出来——正是 `fadeIn` 想避免的效果。
两条规则都加了 `startTime: 375`。

同时订正了一处被 Minor 3 一并抓到的错误：`duration` 不能对两条素材用同一个数字——abjuration
（ward 用）自己的稳态起点是 f71，conjuration（conjure 用）是 f78，两者在爆闪之后仍分叉几帧。
`duration` 语义按 Sequencer 的「从 startTime 起算的播放时长」理解，重算：

- ward：目标停在 f71，原始时间轴 71/24s≈2958ms，`duration = 2958 - 375 = 2583`
- conjure：目标停在 f78，原始时间轴 78/24s≈3250ms，`duration = 3250 - 375 = 2875`

（原来两条都用 `duration: 2900` 且没有 `startTime`，是把 abjuration 的稳态起点数字错抄给了
conjuration，且没扣掉空头——Minor 3 与 Important 2 实际上是同一处代码错误的两个症状，一并改掉。）

## Important 3：`strike.ranged.draw` 音频截断在放弦之后、箭到之前

`psfx.ranged-weapons.longbow.v1.30ft` 三段烘焙：拉弓 0.05-0.35s → 放弦 0.62-0.80s → 箭到
0.80-1.05s。sound cue 加了 `duration: 800`，cast 槽只负责「拉弓+放弦」，不播与 travel/impact
真实时序无关的「箭到」那一团。

**ft 档位不在本轮范围**：`.30ft` 写死、应按实际格距选档的问题已按协调者裁决移交 Task 10
（travel 槽才是投射物时序的归属地），代码注释里已记一句交接说明。

## Minor 1：`Math.random()` 加入 banned 正则

`test/manifest.test.mjs` 的 `banned` 正则从只查 Foundry 全局扩展为
`/\b(game|canvas|Hooks|Sequencer|ui|CONFIG)\s*\.|Math\.random\s*\(/`，测试名与断言消息同步改为
「不得引用 Foundry 全局或 Math.random」。

红/绿验证：往 `cast.mjs` 里临时插入 `const __evil = Math.random();` → 该测试从 `ok` 变
`not ok`（`error: '.../cast.mjs 引用了 Foundry 全局或 Math.random'`），还原后复测变回 `ok`。

## Minor 2：12 符文测试阈值收紧 + 单独断言色相补偿

阈值从 `files.size >= 6` 提到 `>= 10`，并新增 `withHue >= 5`（断言至少 5 个符文带非零
`filter.data.hue`，对应实测 kinesis/soul/storm/control/flame 的 hue 分别是 35/35/10/25/-25）。

红/绿验证：把 `spell.composed` 的 `filter` 临时硬改成恒 `null`（模拟色相补偿被整体丢弃）：

```
not ok 4 - 12 个符文的通用施法圈都能解析、颜色各异，且色相补偿确实生效
  error: '12 个符文只产出 8 种视觉，配色没起作用'
```

（12 个符文本身仍落到 8 个不同 `file`，旧阈值 `>= 6` 会放过这个回归；新阈值 `>= 10` 正确拦截。
`withHue` 断言在这个场景里根本不会被走到，因为 `files.size` 这一关已经先红了——但如果换一种只
丢部分 hue 而不是全丢的回归，`withHue >= 5` 是补的第二道线。）还原后复测变回 `ok`。

## Minor 3：两处帧号注释订正

- `cast.mjs` 里 `spell.gesture.conjure` 的注释：不再照抄 abjuration 的「f71 起稳态」，改为
  conjuration 自己实测的「f78 起进稳态」（ASSET-NOTES 表内该行【订正】明确写的是 f78，f71 是
  abjuration 那一行的数）。这处订正与 Important 2 的 `duration` 重算是同一次编辑完成的——
  数字错了，注释自然也要跟着改对，不是只改文字掩盖数字仍然错误。
- `cast.mjs` 里 `spell.gesture.aspect` 的注释：不再说「f1 就硬弹到近峰值」，改为准确描述
  ASSET-NOTES 的实测——f1 从 0 瞬间跳到 alpha 均值 15.3（这一下瞬间起跳、无渐变是真的），但
  那只是峰值 73.0（f20）的约 21%，之后还要 19 帧才慢慢涨满，不是「一跳就到近峰值」。

## 复算结果（修复后）

```
覆盖率(动作至少1cue): 434/434
状态持续特效: 46/46
零目标攻击动作 cast cue 覆盖: 53/53
降级率: 0/434 = 0.00%
8种结果解析(抽样40动作x8结果): 320/320

cast 槽命中分布（434 个 fixture）：
  generic.cast          185   （全部 spell===null 的普通武器/无目标动作）
  spell.composed         168
  tag.skill               15
  spell.gesture.aspect    12
  spell.gesture.conjure   12
  spell.gesture.ward      12
  tag.healing              7
  (none，重武器起手不出内容)  23
```

命中分布与修复前一致（修复只改了各规则 `build()` 里的素材/时序参数，没有动任何 `when()`
条件，因此匹配结果不受影响，只有 Minor 2/Important 1 新增的测试断言更严格）。

## `npm test` 结果

```
1..81
# tests 81
# suites 0
# pass 81
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

81 = 修复前 76 + 新增结构性守卫 1（`armory-assets.test.mjs`）+ 新增行为测试 4（conjure/aspect/
healing/skill）。全绿。

## 对本轮裁决的记录

- `LEGACY_UNVERIFIED` 白名单（`jb2a.magic_missile` / `jb2a.impact.004` /
  `jb2a.healing_generic.burst` / `jb2a.extras.tmfx.outflow.circle.01`）是我在实现新守卫时
  发现的、协调者消息里没有直接提到的问题：把守卫写成扫描全 `scripts/armory/` 目录会让这 4 条
  Task 10/11/12 尚未迁移的历史路径把新测试变红。已按"守卫应该保护未来新增、不该追溯性地卡住
  不在本轮范围内的技术债务"的原则加了白名单并写清注释，但这是我的裁决，不是协调者原文要求，
  提请复核是否需要调整（例如改成在 Task 10/11/12 各自完成时逐条移除白名单项）。
- ward/conjure 的 `duration` 精确值（2583ms / 2875ms）是按「Sequencer 的 `duration` 是从
  `startTime` 起算的播放时长」这一假设推算的；仓库里没有可运行的 Sequencer 环境验证这个语义，
  两个数字本身来自 ASSET-NOTES 的实测帧号换算，但换算公式依赖的这条 API 语义假设建议上机时
  一并确认。
- `strike.ranged.draw` 视觉层缺失、`dark_*` 分支可读性补偿两项延后事项与轮 0 报告一致，未变。

---

# 修复轮 2/5

只有一件事：把轮 1 的顾虑 1（`LEGACY_UNVERIFIED` 白名单是个没有约束的逃生舱）钉死。顾虑 2
（`duration` 的 Sequencer 语义假设）协调者已经去读了本机 `/root/fvtt14-data/Data/modules/
sequencer/dist/sequencer.js` 源码确认——`duration = this.data.duration === false ? this.endTime
- this.startTime : this.data.duration`，显式设置的 `duration` 会被原样采用，2583/2875 这两个
数按原算法成立，无需改动，本轮不涉及。

## 白名单加了两条断言，只能变小不能变大

`test/armory-assets.test.mjs` 新增两条测试：

1. **不许新增**——`LEGACY_UNVERIFIED.size <= 4` 且 `[...LEGACY_UNVERIFIED].sort()` 与已知的
   4 条路径逐字相等（`deepEqual`）。想加第 5 条，这条测试立刻红。
2. **自动失效**——白名单里每一条都必须仍被某个兵库文件的 `ctx.pick()`/`ctx.sound()` 实际引用
   （复用已有的 `armoryFiles()` + `pickedPaths()` 汇总成一个「全部被引用路径」集合，逐条比对）。
   一旦某条路径在对应任务完成迁移后不再被任何兵库文件引用，这条测试会红，错误信息精确是
   `白名单条目 "<path>" 已无人引用，说明对应任务已完成迁移，请从 LEGACY_UNVERIFIED 中删除`。
   白名单因此会在对应任务完成的那一刻自我清算，不需要谁记得回来打扫。

## 红/绿验证

**场景 1：往白名单里临时加一条 `"jb2a.fake.path"`**（模拟有人想加第 5 条）——断言 (1) 与 (2)
都正确变红：

```
ok 1 - 兵库规则引用的每条 DB 路径都能在 ASSET-NOTES 主表里查到依据，且不在否决清单里
not ok 2 - LEGACY_UNVERIFIED 白名单不许新增：条目数与内容锁死为当前已知的 4 条
  error: 'LEGACY_UNVERIFIED 有 5 条，超过已知的 4 条——新增白名单项需要走评审，不能随手加'
not ok 3 - LEGACY_UNVERIFIED 白名单里每一条都仍被某个兵库文件实际引用（否则应删除）
  error: |-
    白名单条目 "jb2a.fake.path" 已无人引用，说明对应任务已完成迁移，请从 LEGACY_UNVERIFIED 中删除
    + actual - expected
    + [ 'jb2a.fake.path' ]
    - []
```

（新增的假条目自身既超出了数量上限，又天然无人引用，所以两条断言同时红——符合预期：假条目
不可能同时合法又被使用。还原后复测三条全绿。）

**场景 2：把 `travel.mjs` 里的 `jb2a.magic_missile` 临时改成一条 ASSET-NOTES 主表认可的合法
路径**（`jb2a.ranged.01.projectile.01`，模拟 Task 10 完成迁移）——只有断言 (2) 变红，断言 (1)
仍然绿（白名单内容本身没变，只是其中一条不再被引用）：

```
ok 1 - 兵库规则引用的每条 DB 路径都能在 ASSET-NOTES 主表里查到依据，且不在否决清单里
ok 2 - LEGACY_UNVERIFIED 白名单不许新增：条目数与内容锁死为当前已知的 4 条
not ok 3 - LEGACY_UNVERIFIED 白名单里每一条都仍被某个兵库文件实际引用（否则应删除）
  error: |-
    白名单条目 "jb2a.magic_missile" 已无人引用，说明对应任务已完成迁移，请从 LEGACY_UNVERIFIED 中删除
    + actual - expected
    + [ 'jb2a.magic_missile' ]
    - []
```

这正是设计目标：断言 (2) 单独触发，精确指出「哪一条」该删，而不需要断言 (1) 同时报警——(1) 只
负责拦「新增未评审的条目」，(2) 只负责拦「该删而没删的旧条目」，两者互不干扰。还原
`travel.mjs` 后复测三条全绿。

## 交接说明

白名单的 4 条按迁移责任归属：

| 路径 | 所在文件/规则 | 归属任务 |
| --- | --- | --- |
| `jb2a.magic_missile` | `travel.mjs` 的 `generic.travel` | Task 10 |
| `jb2a.impact.004` | `impact.mjs` 的 `generic.impact` | Task 11 |
| `jb2a.healing_generic.burst` | `aftermath.mjs` 的 `generic.aftermath` | Task 12 |
| `jb2a.extras.tmfx.outflow.circle.01` | `persist.mjs` 的 `generic.persist` | Task 12 |

各任务把对应兜底规则的路径迁移到 ASSET-NOTES 认可的路径后，**不需要手动记得回来清理白名单**——
`test/armory-assets.test.mjs` 的「自动失效」断言会在那条路径不再被引用的瞬间变红，报错信息
直接点名该删哪一条，把清理动作变成任务收尾时 `npm test` 自然暴露出来的强制步骤。

## `npm test` 结果

```
1..83
# tests 83
# suites 0
# pass 83
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

83 = 轮 1 的 81 + 本轮新增的 2 条白名单约束测试。全绿。

---

# 修复轮 3/5

协调者独立复验了前两轮（被否素材已移除、新守卫能抓住否决路径、Math.random 守卫生效、白名单
两条约束到位、83/83），本轮只有一个语义问题：`generic.cast` 和 `spell.composed` 用了同一条
素材 `jb2a.magic_signs.circle.02.evocation.loop`。`spell.composed` 用它是对的（是法术），但
`generic.cast` 承担的 185/434（42.6%）里全部是 `spell===null` 的非法术动作（战士防御/恢复、
武技天赋、技能检定、社交动作）——给这些动作脚下点一圈塑能符文阵，语义是错的，而且两条规则
色彩都区分不开（`spell.composed` 走 12 色 `runeColor()`，`generic.cast` 非法术恒为蓝）。

## 选材过程

重新过了一遍 ASSET-NOTES 的 cast 槽候选（14 行主表 + 相关脚注），按协调者给的优先级筛：
不能是法阵/符文（排除 magic_signs 全家族、on_token_buff、swirling_sparkles）；要能同时罩住
武技/恢复/技能检定这些差异很大的动作，宁可抽象也不要具象。

协调者点出的两条重点候选，逐条核对表内数据后都有取舍：

- `eskie.casting.physical.01.center.one_shot.orange`——[近战起手/蓄力]，方向对（武技而非
  法术），但**自带闪爆列是「是」**（第 18-19 帧自带一次带放射线的花瓣爆闪，备注明确写
  「那一下爆闪就是『出手』的节拍点……同理别再往这一帧叠 impact 闪光」），需要额外处理双闪
  风险；而且火星环视觉对技能检定/社交类动作偏「用力」，协调者自己也提了这层顾虑。
- `blfx.spell.cast.light_flare.1.center.color3`——够抽象够中性，但 (a) `tag.skill` 已经在用
  它，(b) **自带闪爆列同样是「是」**（60 帧那条，f0-f14 有效内容自带一次中心亮核爆出）。

两条重点候选都有「自带闪爆=是」这个共同问题，于是把筛选范围扩大到同一 cast_generic 家族里
备注明确写「自带闪爆=否」的另外两条——这两条此前没被协调者点名，但表里数据显示它们完全符合
「抽象、无爆闪」的要求：

| DB 路径 | 语义标注 | 自带闪爆 | 帧数 |
| --- | --- | --- | --- |
| `jb2a.cast_generic.02.blue` | [远程拉弓起手/蓄力] | 否 | 21 帧@30fps=0.7s |
| `jb2a.cast_generic.01.blue` | [近战/远程蓄力备选] | 否 | 21 帧@30fps=0.7s |

`.02` 的语义标注偏窄（明确是「拉弓」），且这个语义已经被 `strike.ranged.draw` 占用（虽然
`.02` 目前没被用作视觉层，但语义上留给弓弩类更合适）。`.01` 标注为「近战/远程蓄力**备选**」——
本身就是作为通用蓄力效果收录的，视觉是「一圈从中心快速外扩又收回的抽象能量脉冲」（帧 2-8 环
快速外扩，第 8 帧 alpha 峰值 112，之后收回消失），没有法阵/符文/弓箭/武器的具象元素，只是一
下「蓄力感」的光晕脉冲——这正是协调者要的「一点光晕/蓄力感，而不是具象」。

**最终选择：`jb2a.cast_generic.01`。**

## ASSET-NOTES 对它的记录、以及我如何据此设参数

原文（docs/ASSET-NOTES.md 第 73 行）：

> `jb2a.cast_generic.01.blue` | cast | 扩散 | 中心 | 21 | 否 | 否 | 否 | [近战/远程蓄力备选]
> 同为 0.7s，但走的是「先炸开再收回」：帧 2-8 环快速外扩，第 8 帧 alpha 峰值 112（对比 02
> 只有 53），之后收回消失。【订正】原记录写「第 7-8 帧能量超出 400x400 画布、左右被画幅切平、
> 只能小尺寸用」——复核不成立：逐帧测四条边，f2-f9 的最左列/最右列/最上行/最下行 alpha 最大值
> 全部 ≤5/255（左列恒为 0），f7/f8 的 bbox 是 x[5-394] / x[6-392]，四周留边 5-8px，环始终是
> 完整圆形、没有平口，放大到 2 格以上照样能用。那两个「平口」是旧联系表丢 alpha 的近白底渲染
> 造成的误读。前 2 帧（0-1）是空帧。同样只有 4 色。

对应参数决定：

- **不设 `startTime`**：前 2 帧（约 67ms）是空帧，但比 `fadeIn:200` 短——我们自己的淡入还在
  爬升阶段（0→200ms 线性提亮）时素材内容就已经在 67ms 出现，会被淡入曲线自然揉进去，不会像
  ward/conjure 那样在空帧上硬弹出来（那两条的空帧是 375ms，比它们的 fadeIn 都长）。这里没有
  同样的坑，所以没有同样的修法。
- **不设 `duration`**：备注写「之后收回消失」，暗示内容持续到收尾（不像其它候选被明确记录
  「末 N 帧全空」的死尾巴），没有证据支持要截断，所以不加。
- **去掉 `belowTokens`**：旧素材（magic_signs 家族）是地面俯视圆阵，语义上要压在 token 下方；
  新素材锚点是「中心」、视觉是罩在施法者身上的一圈脉冲而不是地面贴花，不再需要压在 token 下方，
  改用默认 zIndex（50，覆盖层）。
- **对 `objectScale`/`fadeIn`/`fadeOut` 不变**：0.9 * sizeScale() / 200 / 400，ASSET-NOTES
  确认「放大到 2 格以上照样能用」（没有小尺寸限制的坑），沿用第一轮定的默认参数没有问题。
- **颜色**：`colorsUnder("jb2a.cast_generic.01")` 实测是 `dark_purple / dark_red / blue /
  yellow`——这里要订正一处：ASSET-NOTES 原文只写「同样只有 4 色」（隐含承接同族 `.02` 的
  `dark_purple/dark_red/blue/green` 4 色），但实测 `.01` 的第 4 色是 **yellow 不是 green**。
  这个偏差不影响功能（`ctx.pick` 走 `{color: ctx.runeColor() ?? "blue"}`，`pickColor` 在
  实际可用分支里取最近色，4 个里选哪个都能正常解析），但既然是我自己验证时发现的，记在这里
  供后续核对 ASSET-NOTES 时参考。

## 为什么它比塑能符文阵更合适

- **不是法阵/符文**：视觉是抽象的能量脉冲环，没有六芒星/符文/魔法圈这类具象的施法意象，
  战士摆防御姿态时看到的是一下光晕蓄力，不会被读成「正在施法」。
- **足够抽象、能罩住异质动作**：武技（vaultingSweep 这类零目标/非攻击动作，实测样例见下）、
  恢复、技能检定、社交动作共用同一种「蓄力光晕」语言，不需要为每种语义单独选材——这与
  `spell.composed`（专属法术，12 色符文语义）、`tag.healing`（专属绿光）、`tag.skill`
  （专属闪光）等专用规则形成清晰对比：专用规则语义明确、兜底规则语义空白，不再和
  `spell.composed` 撞素材，视觉上也终于能和「这是一次法术」的画面区分开来。
- **无需处理双闪**：`自带闪爆` 列是「否」，全程无爆发闪光（对比同族 02 的备注「确实全程无
  爆发闪光，预乘亮度能量……无任何单帧尖峰」，01 的收尾同样是「收回消失」而非爆闪）。cast 段
  播完之后紧接 travel/impact 的闪光层完全不会撞车，本轮不需要对 travel.mjs/impact.mjs 做
  任何改动——这是我优先选它而不是两条自带闪爆="是"候选的直接原因。

## 现有行为约束保持不变

- 跳过条件仍是 `s.usage.isAttack && s.targets.length`，未改动——零目标的 53 个动作仍然
  靠这条兜底（下方复算的 53/53 与轮 1 一致）。
- 仍然经 `ctx.runeColor() ?? "blue"` 配色，保留 `{color}` 接口作为 `spell.composed` 意外
  失败时的防御性回落（虽然实测这条规则命中的 185 个 fixture 全部 `spell===null`，颜色恒为
  "blue"，`filter` 恒为 `null`——样例见下方 `vaultingSweep` 的实际 cue 输出）。

## 复算结果（确认没有退化）

```
覆盖率(动作至少1cue): 434/434
状态持续特效: 46/46
零目标攻击动作 cast cue 覆盖: 53/53
降级率: 0/434 = 0.00%

cast 槽命中分布（434 个 fixture，与轮 1 完全一致——本轮只改 build() 里的素材/字段，
没有动任何 when() 条件）：
  generic.cast          185
  spell.composed         168
  tag.skill               15
  spell.gesture.aspect    12
  spell.gesture.conjure   12
  spell.gesture.ward      12
  tag.healing              7
  (none，重武器起手不出内容)  23
```

`generic.cast` 命中样例（`vaultingSweep`，`spell===null`、`targets.length===2` 但
`usage.isAttack===false` 故未被让路条件挡住）实际产出的 cue：

```json
{
  "file": "modules/jb2a_patreon/Library/Generic/Cast/GenericCast01_01_Regular_Blue_400x400.webm",
  "objectScale": 0.9, "belowTokens": false, "zIndex": 50,
  "fadeIn": 200, "fadeOut": 400, "duration": null, "startTime": 0,
  "filter": null, "rule": "generic.cast", "slot": "cast"
}
```

## `npm test` 结果

```
1..83
# tests 83
# suites 0
# pass 83
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

83/83 全绿，测试数量与轮 2 相同（本轮没有新增测试，只是把 `generic.cast` 的 `build()` 换了
素材与字段；既有的行为测试——规则表规模、ward/composed 分流、12 符文覆盖、重武器无内容、
弓弩音效轨、无绝对路径、结构性守卫、白名单两条约束——全部沿用且继续通过，说明这次改动没有
破坏任何既有断言）。
