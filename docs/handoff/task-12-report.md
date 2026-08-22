# Task 12 报告：兵库 S4 aftermath 与 S5 persist

分支 `v1-implementation`，起点 `1b825f7`（163/163）。改动：
- `scripts/armory/persist.mjs`（重写：`STATUS_GROUP` 46 状态 → 12 组 + `GROUP_FX` + 兜底）
- `scripts/armory/aftermath.mjs`（重写：新增 4 条规则，旧兜底改为恒 `null`）
- `test/armory-persist.test.mjs`（新增，简报 Step 1 基础上把「47」订正为「46」，并加一条
  「46 个状态全部归组、无一落在兜底」的回归钉子）
- `test/armory-assets.test.mjs`（`LEGACY_UNVERIFIED` 白名单清空：2→0）

先修正简报里两个过时数字（按交接说明执行）：状态数按 **46**（不含 `flanked`，它是
Crucible 源码里的 `derivedConditions`，永远不会作为 ActiveEffect 出现）；aftermath 兜底
弃用 `jb2a.healing_generic.burst`（配色是复合词，不在 `COLOR_HUE` 里，`pickColor` 会
静默过滤掉、固定出蓝白色），改用 `jb2a.healing_generic.400px.green`。

## 1. persist：12 组素材

12 组与 ASSET-NOTES persist 表（17 行）里直接标了「XXX（中文名）组」的 12 行**一一
对应**，不用取舍；3 行标「备选」、2 行未打组标签的（更像是给伤害类型准备的持续层）
留在表里未采用。不传 `{color}`——12 条路径全部是已写死颜色的完整叶子，实测
`colorsUnder(path)` 恒为 `[]`，`{color}` 选项在这类路径上是静默 no-op。

| 组 | 路径 | ASSET-NOTES 记录要点 | 呈现参数 | 归组状态 |
| --- | --- | --- | --- | --- |
| burning | `eskie.burn.embers.orange` | 180f@29.97fps=6.006s 无缝循环；「密度极低…亮度很淡，几乎看不见」 | scale 0.55（800x800→400 基准），opacity 1（不再压淡），fade 500/500 | burning |
| freezing | `jb2a.markers.snowflake.blue.01` | 144f@24fps=6.00s，首尾差 5.57≈相邻帧 4.97；f0 已有 p90=195 的不透明团块 | scale 1，opacity 0.85，fade 500/500 | freezing |
| poison | `jb2a.markers.poison.dark_green.01` | 145f@24fps=6.04s，首尾差 2.86<相邻帧 5.92；「密度偏高…会压到 token 边缘轮廓」 | scale 1，opacity 0.75，fade 500/500 | poisoned, diseased, corroding |
| decay | `jb2a.markers.skull.purple.01`（persist 行） | 145f@24fps=6.04s，首尾差 1.30；无自带闪爆 | scale 1，opacity 0.8，fade 500/500 | decaying, entropy, irradiated |
| bleed | `jb2a.markers.drop.red.01` | 145f@24fps=6.04s，首尾差 1.36；「叠在浅色 token 上是相当实的红环，要留意压色」 | scale 1，opacity 0.75，fade 500/500 | bleeding |
| stun | `jb2a.markers.stun.dark_teal.01` | 145f@24fps=6.04s，首尾差 1.47；「青绿环实际比紫环显眼约 57%」 | scale 1，opacity 0.85，fade 500/500 | stunned, staggered, paralyzed, incapacitated, asleep, dead |
| fear | `jb2a.markers.fear.dark_purple.01`（persist 行） | 145f@24fps=6.04s，首尾差 1.20；密度中等偏低 | scale 1，opacity 0.85，fade 500/500 | frightened, broken, insane, confused, dominated, disoriented |
| hidden | `jb2a.markers.smoke.ring.loop.bluepurple` | 152f@30fps=5.07s；「想长期挂着先压 opacity 或缩小，别当透空贴纸用」（原话明确指示） | scale 1，opacity 0.55，fade 600/600 | invisible, unaware |
| haste | `jb2a.markers.light.loop.yellow` | 121f@24fps=5.04s；「不需要 belowTokens，尤其别再压 opacity 到 0.5…方向是加发光或放大，而不是减淡」 | scale **1.15**，opacity **1**（不下调），fade 500/500 | hastened, limitless, inspired, resolute |
| slow | `jb2a.markers.chain.standard.loop.01.grey` | 150f@30fps=5.00s；四角自带深色烟雾压暗、俯视压扁椭圆只适合俯视图 token（已知限制） | scale 1，opacity 0.8，fade 500/500 | slowed, restrained, prone, overrun, exhausted, suffocating |
| buff | `jb2a.energy_field.01.blue` | 121f@24fps=5.04s；「很亮很饱和…挂两个以上增益会糊…放大到 1.2 倍盖住格子更自然」 | scale **1.2**，opacity 0.65，fade 500/500 | guarded, invulnerable, mending, enraged, flying, burrowing |
| debuff | `jb2a.markers.runes.dark_black.01` | 145f@24fps=6.04s；「几乎不发光…完全不抢视线，不会和其它 11 组彩色撞车」 | scale 1，opacity **1**（不下调，已经很暗），fade 500/500 | weakened, exposed, blinded, deafened, silenced, shocked, falling |

fade 依据：12 支全是数秒级无缝循环，不套用 impact/travel「素材总长仅几百毫秒」那套
「自带渐强就 fadeIn:0」判据——这里的淡入淡出对应「状态刚附上/刚移除」这个语义事件
本身，统一给循环配得起的柔和过渡（默认 500ms，hidden 因 ASSET-NOTES 明确要求压
opacity 而拉长到 600ms 配合更「渐隐」的观感）。未设 `mirrorY`/`randomizeMirrorY`：
ASSET-NOTES 明确警告多支素材（fear/bleed/poison/decay/hidden 等）本体在缓慢旋转，
镜像会把转向整个反过来，「同场挂多个标记要统一转向就别混用镜像」。

**已知限制（未阻塞，记录在案）**：
- decay（`skull.purple.01`）与 fear（`fear.dark_purple.01`）色相只差 1°（276° vs
  277°），两状态同挂一个 token 基本分不出来。ASSET-NOTES 建议的两个替代分支
  （`skull.dark_orange.01`、`skull.dark_red.01`）均在否决清单里（前者过饱和撞
  burning、后者透明区红噪淹没轮廓），没有已验证的可换分支，保留现状。
- slow（`chain.standard.loop.01.grey`）是俯视压扁椭圆，只适合俯视图 token；备选
  `aura_themed.01.inward.loop.metal.01.grey` 问题更重（画幅溢出格子、中心螺旋盖脸），
  未采纳。

## 2. persist：兜底规则

`generic.persist`（pri 10）改用 `jb2a.extras.tmfx.inflow.circle.01`（ASSET-NOTES
persist 表「debuff/slow 组备选」，180f@30fps=6.00s，首尾差 1.83≈相邻帧 1.77，
「RGB 恒为 (255,255,255)，所有明暗由 alpha 承担」——天然的中性 tint 底，适合给
Crucible 未来新增、STATUS_GROUP 尚未覆盖的状态兜底）。取代原先未经 ASSET-NOTES
验证的 `jb2a.extras.tmfx.outflow.circle.01`。当前 46 个状态全部归组，实测该兜底
从未被真实语料命中（见第 5 节回归测试）。

## 3. aftermath：4 条新规则

aftermath 选规则是**整个动作一次**（与 travel/impact 同构），因此 `when()` 判「这个
动作要不要走这条规则」，`build()` 仍对每个目标单独判「这个目标要不要出内容」。

| 规则 | pri | once | 路径 | ASSET-NOTES 记录要点 | 关键参数 |
| --- | --- | --- | --- | --- | --- |
| `aftermath.healing` | 420 | 否 | `jb2a.healing_generic.400px.green` | 51f@30fps=1700ms；f0 空，内容是十字星花+细光环（非实心块）；空尾从 f40 起；中心 alpha 均值 216/174，「需要时压 opacity 到 0.6-0.7」 | duration 1333，fadeIn 0（素材自身渐强），fadeOut 200，opacity 0.7 |
| `aftermath.kill` | 430 | 否 | `blfx.spell.template.circle.wave2.blood1.splatter.red` | 56f@30fps=1867ms，1200x1200；「结尾不是淡出而是向中心收缩回去，帧44→48」——必须在收缩前截断 | objectScale 1/3，duration 1167（截在收缩前），fadeIn 0，fadeOut 700（长尾模拟自然消退），belowTokens:true |
| `aftermath.morale` | 380 | 否 | `jb2a.markers.fear.dark_purple.01`（aftermath 行） | 「士气下降/恐惧标记…适合 Crucible 那 4 个打士气的符文」（原话即为此场景写的）；145f@24fps 满不透明起手，须自补 fade | 只取前 1000ms 当一次脉冲反馈，fadeIn 300，fadeOut 500 |
| `aftermath.groundResidue` | 300 | **是** | `jb2a.impact.ground_crack.still_frame.01` | 1 帧 .webp 静帧，「天然适合当 persist 的地裂残留贴图（blast/cone 之后铺地）」；透明区也是纯黑，暗地图上难辨（已知限制） | objectScale 1.3，duration 3000，fadeIn 200，fadeOut 800，belowTokens:true，once:true（一片区域一份残留） |

**触发条件的选择**：
- `aftermath.kill` 用 `target.effects?.includes("dead")` 而非「`damage.total` 使其
  归零」——快照（`trigger/snapshot.mjs`）没有绝对 HP 值，只有伤害增量；`dead` 是
  HP 归零时系统写回的状态 id，是快照里唯一能确认「真的打死了」的信号。
- `aftermath.groundResidue` 用真实几何 `s.region?.type==="cone"` 或
  `(s.target?.type==="blast" && s.region?.type==="circle")`，不用笼统的
  `target.type==="blast"`——fixture 里 `blast` 同时存在 `region:null`（近战多目标
  群击，无落地范围）与 `region.type==="circle"`（真正的圆形爆发）两种，只有后者
  该出残留；`fan` 目标类型也带 `region.type==="cone"`，一并覆盖。aura/pulse 即便
  也用 circle 区域，语义是持续光环/扩散波而非一次性爆发，未纳入。
- 优先级 `kill(430) > healing(420) > morale(380) > groundResidue(300)`：按简报给定
  的数字，语义上「死了」盖过「被治疗了」盖过「士气被打」盖过「地面焦痕」。

**曾考虑但未采纳**：`blfx.spell.template.circle.explosion1.fireball1.ground.burn.orange`
（GroundBurn，名字更贴合"焦痕"）。ASSET-NOTES 订正后明确否掉了它当残留用：前
40+ 帧是铺满画幅的卡通爆炸本体（会与 impact 层双爆），跳过之后剩下的段实测是「一坨
近黑的放射状烟渣…光靠 persist 冻帧只会留一坨黑斑」，可靠性不如 `ground_crack`。

旧的 `generic.aftermath`（pri 10）改为 `when:()=>true, build:()=>null`：上面 4 条
规则已覆盖当前设计要处理的全部 S4 场景，原先占位的 `jb2a.healing_generic.burst`
（已失效配色）整条移除，规则 id 保留只为与其它四槽的「0-99 终极兜底」层级结构
对齐，`aftermath` 允许「这个动作没有 S4 内容」这一合法结果（不像 cast/travel/impact
需要 100% 覆盖率）。

## 4. 路径验证

全部 16 条（12 persist + 1 persist 兜底 + 4 aftermath 中的 3 条新路径，`fear.dark_purple.01`
在 persist 与 aftermath 两处复用同一字符串）逐条跑 `assets.resolve(path)`，全部
`diverged===false` 且 `r.path===p`：

```
eskie.burn.embers.orange                                       diverged=false path===true
jb2a.markers.snowflake.blue.01                                  diverged=false path===true
jb2a.markers.poison.dark_green.01                                diverged=false path===true
jb2a.markers.skull.purple.01                                     diverged=false path===true
jb2a.markers.drop.red.01                                         diverged=false path===true
jb2a.markers.stun.dark_teal.01                                   diverged=false path===true
jb2a.markers.fear.dark_purple.01                                 diverged=false path===true
jb2a.markers.smoke.ring.loop.bluepurple                          diverged=false path===true
jb2a.markers.light.loop.yellow                                   diverged=false path===true
jb2a.markers.chain.standard.loop.01.grey                         diverged=false path===true
jb2a.energy_field.01.blue                                        diverged=false path===true
jb2a.markers.runes.dark_black.01                                 diverged=false path===true
jb2a.extras.tmfx.inflow.circle.01                                 diverged=false path===true
jb2a.healing_generic.400px.green                                 diverged=false path===true
blfx.spell.template.circle.wave2.blood1.splatter.red             diverged=false path===true
jb2a.impact.ground_crack.still_frame.01                          diverged=false path===true
```

同时用真实 fixture 验证三条条件类规则确实可达（不是死代码）：
- `aftermath.groundResidue`：`s.region?.type==="cone"` 或 `blast+circle` 的 fixture
  动作共 36 条，其中 24 条非 morale 资源的（`spell.death/earth/flame/frost/
  illumination/kinesis/life/storm` 的 blast/cone/fan）实测都产出了带正确锚点坐标的
  cue（如 `spell.death.blast` → `at:{ref:"origin",x:900,y:500}`）；另外 12 条是
  `control`/`illusion` 等打 morale 资源的法术，被更高优先级的 `aftermath.morale`
  截胡，属设计内的优先级排序，非 bug。
- `aftermath.morale` / `aftermath.kill`：用真实 fixture 动作叠加 `damage`/`effects:
  ["dead"]` 字段验证，均正确产出对应规则的 cue。

## 5. `npm test` 结果

```
# tests 170
# suites 0
# pass 170
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

170 = 起点 163 + 本任务新增 `test/armory-persist.test.mjs` 的 7 条测试。全绿，无
skip、无 cancel。

**覆盖率复算**：
```
actions: 434, diverged warnings: 0, rate: 0.00%
effects: 46, diverged warnings: 0, rate: 0.00%
```
降级率 0.00%（actions 与 effects 两个语料都是），远低于 15% 阈值，未触及也未松动
断言。46 个状态实测全部归组，无一落在 `generic.persist` 兜底（见新增测试「全部 46
个状态都归了组」）。

## 6. LEGACY_UNVERIFIED 白名单迁移

- `jb2a.healing_generic.burst`（aftermath.mjs `generic.aftermath`）→ 该规则改为
  恒 `null`，路径整条移除；治疗辉光改由新规则 `aftermath.healing` 用
  `jb2a.healing_generic.400px.green` 承担。
- `jb2a.extras.tmfx.outflow.circle.01`（persist.mjs `generic.persist`）→ 迁移到
  ASSET-NOTES 已验证的 `jb2a.extras.tmfx.inflow.circle.01`。
- `test/armory-assets.test.mjs` 的 `LEGACY_UNVERIFIED` 从 2 条清空为 `new Set([])`，
  「不许新增」测试改为断言 `size===0`，「自动失效」测试对空集合平凡通过。**白名单
  已清空**——四个兵库任务（Task 9-12）至此收尾。

## 7. 顾虑（上报，非阻塞）

1. **decay/fear 色相几乎无法区分**（见第 1 节已知限制）：两状态叠加时视觉上基本是
   同一种紫色环，ASSET-NOTES 给出的两个替代分支都在否决清单里，需要新一轮素材侦察
   才能解决，不在本任务范围。
2. **slow 组素材只适合俯视图 token**：`chain.standard.loop.01.grey` 是俯视压扁椭圆，
   贴在侧视 token 上会有透视违和；本模组按俯视桌面地图假设，若未来支持侧视 token
   预设需要重新选材。
3. **地面残留素材在暗色地图上可读性差**：`ground_crack.still_frame.01` 的裂纹线是
   纯黑，ColorMatrix 的 hue 旋转对纯黑无效，无法用现有 filter 机制提亮；ASSET-NOTES
   原话「必须配浅色地面或叠亮色」，本任务只能放大 `objectScale` 扩大可见面积，未
   引入新的 tint 机制（超出本任务范围）。
4. **buff/haste 两组的 objectScale 略微偏离 1**（buff 1.2、haste 1.15）：均有
   ASSET-NOTES 原话直接支持（分别是「放大到 1.2 倍盖住格子更自然」与「方向是加发光
   或放大，而不是减淡」），但两个数字本身（1.2 与 1.15）是在原话给出的方向上取的
   经验值，未经进一步实渲复核。

## 状态

DONE_WITH_CONCERNS
