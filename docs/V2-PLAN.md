# V2 计划：每个动作都有自己的动画

> 前置阅读：[`LOCAL-STATUS.md`](LOCAL-STATUS.md)（本地环境实测）、[`DESIGN.md`](DESIGN.md) §6（六槽语义）、
> [`V2-ASSET-SURVEY.md`](V2-ASSET-SURVEY.md)（在 VPS 上做的素材侦察，**装机集合与本地不同，别照搬**）。
>
> **V1 的架构与定位都不改。** 「只补空缺」（原生链返回 null 才接管）、六个槽位、
> 出手端摇定写成具体数值、播放层零随机——四条全部保留。**不覆盖原生已实现的部分。**
>
> V2 只做一件事：**把「一个动作配一条通用规则」改成「一个动作配它自己的动画和音效」。**

---

## 0. 基线：19 条规则撑着 434 个动作

全部数字由 `resolve()` 对全量语料实跑得来，不是估计。

| | 实测 |
| --- | --- |
| 语料动作 | **434**（230 个具名动作 + 204 个符文×姿态组合，12×17 正好铺满） |
| 产出 cue | **1818**，平均 4.19 条/动作 |
| **兵库规则总数** | **19** |
| **全部 cue 都来自兜底的动作** | **180 条，41.5%** |
| 至少一条 cue 来自兜底的动作 | 270 条，62.2% |
| 兜底 cue 占比 | `generic.impact` 240 + `generic.travel` 192 + `generic.cast` 184 = **616 / 1818（33.9%）** |
| 零 cue 的动作 | 0 |

规则使用频次的头部：

```
impact.layered   764     ← 8 结果层 × 12 伤害类型的分层系统，这套是对的
generic.impact   240 ←兜底
generic.travel   192 ←兜底
generic.cast     184 ←兜底
spell.composed   168     ← 所有法术的通用兜底
aftermath.morale 104
spell.gesture.*   12 × 7 ← 只有 7 个姿态有专属规则
```

**素材侧完全不缺**：本地 19,124 条可寻址条目（死链 5 条），兵库只引用了 **53 条路径 / 143 个文件**。
jb2a 209 个顶级 key 用了 19 个，eskie 28 个类目用了 7 个。

---

## 1. 目标与判据

**目标：573 个派发目标，每个都有为它选的素材。**

| 派发目标 | 数量 | 现状 |
| --- | --- | --- |
| 具名动作（天赋 + 默认动作） | **230** | 180 个全靠兜底 |
| 符文 × 姿态组合 | **204**（12 × 17） | 7 个姿态有专属规则，其余走 `spell.composed`；其中 24 组由原生接手，不归我们 |
| 武器 | **92**（53 装备 + 39 天生） | 0 |
| 状态效果 | **46** | 0 |
| 变格 inflection | **10** | 0 |

**判据**（都可测，都写成守卫）：

- **J1 无兜底** —— 语料里任何一个动作，`generic.*` 规则命中数为 0。
  兜底规则**保留**，但只作为将来新增内容（自制天赋、系统升级）的安全网，
  对当前 434 条语料一次都不该触发。守卫：跑全量语料，命中 `generic.*` 即红。
- **J2 判别度** —— 沿用 `armory-element-distinct` 的三层判定法（结构层 / 选材层 / 感知层），
  但**判别范围要收敛**，见 D3。
- **J3 层次** —— 每个动作的 cue 数与它的分量相称，不是一刀切。见 D2。

**明确不是判据的**：用掉多少文件。堆素材会直接违反 `DESIGN.md` 定的「克制」基调。

---

## 2. 七个必须先定的架构决策

### D1 · 三条派发键，全部是「翻译不动」的稳定 id

`crucible-cn` 把动作名与装备名译成了 `中文 English` 双语格式——**任何按 `name` 派发的方案
都会被汉化模块打断**。但三类目标都有语义化的稳定 id：

| 目标 | 键 | 取自 | 样本 |
| --- | --- | --- | --- |
| 动作 | `snapshot.id` | `trigger/snapshot.mjs:234` 的 `id: action.id` | `vaultingSweep` `armorCrusher` `backstab` `cleave` `whirlwind` `executionersStrike` `fanOfArrows` `estocade` |
| 武器 | `weapon._stats.compendiumSource` | Foundry 核心字段（`common/data/fields.mjs:4039`，`DocumentUUIDField`） | `bastardSword0000` `giantJaws0000000` `burningBite00000` |
| 状态 | `effect.id` / `statusId` | `trigger/snapshot.mjs:92` | — |

Babele 改 `name`，永远不动这三个。`snapshot.seed` 本身就是从 `action.id` 算的
（`snapshot.mjs:253`），所以 id 在链路上一定可用。

**级联三级**，任何一级失配都往下掉，绝不会出现「没动画」：

```
1. id 命中专属规则         ← 这是 V2 要建的，573 个目标
2. 标签 / 伤害类型 / 分类    ← 现有的 impact.layered、tag.* 一类
3. generic.*               ← 安全网，语料上一次都不该触发（J1）
```

武器的第 2 级尤其干净——Crucible 的字段与 eskie 的素材轴**精确同构，不需要任何主观映射**：

| Crucible | 取值 | eskie 轴 |
| --- | --- | --- |
| `damageType` | bludgeoning / piercing / slashing | `{bludgeoning\|piercing\|slashing}` |
| `WEAPON.CATEGORIES[cat].damage` | 2–3 / 4–5 / 6–8 | `{light\|medium\|heavy}` |
| `WEAPON.CATEGORIES[cat].actionCost` | 2 / 3 | `{fast\|slow}` |

（16 个分类的 `damage` 实测：unarmed 3、light1 3、simple1 4、balanced1 5、heavy1 6、simple2 6、
balanced2 7、heavy2 8、projectile1 4、talisman1 2、mechanical1 4、projectile2 6、talisman2 3、
mechanical2 6、shieldLight 2、shieldHeavy 3。）
`eskie.attack.melee.generic.01.<伤害类型>.<重量>.<8色>.<速度>.<01-03>` = **1250 个文件，V1 一个没用**。

#### D1 订正（2026-08-23，owner 指出）：武器不带动作，动作由天赋给

初版把武器派发写成「按 `snapshot.id` 命中专属规则」。**那是错的**，两处：

**(1) Crucible 里所有武器攻击都走同一个 `strike` 动作**（`const/action.mjs:680`），
所以 `snapshot.id` 永远是 `"strike"`，按动作 id 根本区分不了武器。

**(2) 而且不止 `strike`。** 实测语料里 `cost.weapon === true` 的动作有 **69 个**——
`heavyStrike`（强力打击）、`cleave`、`executionersStrike`、`backstab`、`flurry`、
`whirlwind`、`ferociousLeap`… 全都绑武器。武器本身没有动作，动作是天赋给的。

于是派发空间是 **69 个动作 × 92 件武器 = 6,348 种组合**，枚举不可能。

#### 拆解：武器给「挥的是什么」，动作给「怎么挥」

标签已经把这件事说清楚了：

| 动作 | 标签 | 动作贡献的 |
| --- | --- | --- |
| `cleave` | melee, **twohand** | 大范围横扫 |
| `executionersStrike` | melee, twohand, **deadly** | 过顶终结 |
| `backstab` | **finesse, flanking**, deadly | 从背后、贴身 |
| `flurry` | **dualwield**, mainhand, offhand | 多次快击 |
| `heavyStrike` | melee, mainhand, **empowered** | 单次重击 |
| `flyingKick` | unarmed, **movement, jump** | 跃起 |

所以 **92 件武器素材 + 69 条动作修饰 = 161 份要写的东西**，不是 6,348 份。

#### 可行性已经验过，不是设想

**(a) cue 结构现成支持全部修饰，不用改 schema**（`resolver/resolve.mjs` 的 `CUE_DEFAULTS`）：

| 动作要表达的 | 现成字段 |
| --- | --- |
| 挥砍方向（过顶/横扫） | `angle` / `aim` |
| 主手 / 副手、左右 | `mirrorY` / `randomizeMirrorY` |
| 力度（`empowered`） | `objectScale` |
| 方位（`flanking` 背刺、贴身） | `offset` + `gridUnits` |
| 快慢（`flurry` vs 重击） | `playbackRate` |
| 多次连击 | 多条 cue + `delay` |
| 附魔 / 元素叠色 | `tint` / `filter` |

**(b) jb2a 的具名武器素材朝向一致。** 12 种武器的峰值帧拼图实测：
全部左→右挥、武器头在前缘，差别只在弧形（短剑/锤是浅平扫、武士刀/弯刀是深 C 弧、
战斧/镰刀是带钩陡弧）。**朝向一致才谈得上「按动作加 angle」——不一致的话没有共同基准。**

#### 现状：一条规则扛了 25 种武器 × 69 个动作

`armory/travel.mjs` 的 `strike.melee` 现在只按「贴身 / 隔格」在两个写死的素材间二选一
（`shortsword.01` / `nodachi.01`）。这一条就是 A1 要拆开的地方。

#### A1 的任务顺序（选材排在最后）

1. **快照带上武器身份** —— 现在 `snapshot.mjs:241` 只留了 `category` 与 `damageType`，
   没有 id。而 `usage.strikes` 里装的是**真实的武器 Item 文档**（源码在用 `w.config.category`），
   所以 `w._stats.compendiumSource` 拿得到。**这一步不做，后面全白做。**
2. **武器素材级联**：`compendiumSource` → `damageType × 重量 × 速度`（eskie 正交矩阵）→ 兜底
3. **动作修饰表**：69 条，键是 `snapshot.id`，值是上表那些字段的修饰量
4. **组合**：一条 travel 规则服务全部 69 × 92

#### 还没想清楚的

- **不是「挥」的绑武器动作**：`ferociousLeap`（跃踢）、`interruptingThrow`（反应投掷）
  需要的不是修饰而是别的槽位组合，得单独看
- **`natural` 标签 23 条**：敌人的天生武器（bite/claw/tail），走 39 件 adversary-equipment，
  jb2a 的具名武器族对不上，要另找素材

### D2 · 「多重」按分量分档，不是一刀切

现在平均 4.19 cue/动作。V2 按动作分量分三档：

| 档 | cue 数 | 适用 | 例 |
| --- | --- | --- | --- |
| 轻 | 2–3 | 反应、移动、无目标的自身增益 | `artfulParry` `defensiveRoll` `shadowGait` |
| 中 | 4–6 | 普通攻击、单目标法术 | `backstab` `berserkStrike` |
| 重 | 7–10 | 招牌天赋、AoE、终结技、暴击 | `executionersStrike` `whirlwind` `fanOfArrows` |

**这一档必须上机定。** 一场 6 人混战里同时在播的 Sequencer 特效数量，离线推不出来——
`DESIGN.md` 没有性能预算，本项目也从没量过。**上机第一件事就是拉满档位跑一场，看掉不掉帧**，
再回来定这三个数。写规则时把档位做成常量，方便整体调。

### D3 · 判别度的范围必须收敛，否则组合爆炸

`armory-element-distinct` 现在对 12 种伤害类型做两两比对。573 个目标两两比对是
573² / 2 ≈ 16 万次，既跑不动也没意义——`backstab`（背刺）和 `fanOfArrows`（箭雨）
本来就不可能被认错。

**改成按「可混淆组」判别**：只有玩家可能在同一回合、同一场景下连着看到的动作才互相要求可分。

初步分组（实现时按标签自动切分，不手写名单）：

- 同一武器的近战天赋（`melee` + 同 `mainhand/offhand/twohand`）
- 同一符文的不同姿态（12 组）
- 同一姿态的不同符文（17 组）
- 反应类（`reaction`）
- 同一伤害类型的元素层（现有的 12 类，保持不变）

组内两两要求 `file` + `hue` 组合不重复 + 残留主色 CIEDE2000 ≥ 阈值；**跨组不比**。

### D4 · ASSET-NOTES 的记录方式必须改，否则这是唯一会卡死 V2 的地方

`test/armory-assets.test.mjs` 要求兵库里每一条 DB 路径都在 `docs/ASSET-NOTES.md` 主表里。
主表现在 **96 条**，每条都是 `tools/contact-sheet.sh` 抽帧后**人实际读图**的产物。

V2 要引入的素材是 **600–1000 条量级**。按现在的做法逐条读图，那是 600–1000 张联系表。

**分两级，并新增一个工具：**

| 级别 | 适用 | 记录内容 |
| --- | --- | --- |
| 结构性选材 | 每个槽位的骨干素材、每条轴的代表 | 现有主表格式，人读图，不变 |
| 族级选材 | 正交矩阵（eskie 1250 近战、jb2a arrow/bolt/template_*） | 族的命名规则 + **全族机器量测表** + 抽样读图确认族内一致 |

**机器能测的坑比想象中多**，这些全部不依赖人的判断，可以对上千个文件跑：
帧数、帧率、分辨率、`alpha_mode`、首/末空帧数、内容包围盒占画幅比、峰值帧位置、
自带闪爆（逐帧亮度峰值检测）、可循环区间（首末帧相似度）、暗地图可读性（对 0x303030 底的平均亮度与对比度）。

**机器测不了的只有一件：这个素材配不配这个动作。** 而那正是「specific」的核心，躲不掉。

所以新增 **`tools/family-sheet.mjs`**（`.mjs` 而不是 `.sh`：要读量测 JSON、按 DB 前缀取族）：
把 N 个候选素材各自的代表帧拼成一张图。一张图看 12 个候选，600 个素材约 50 张图就能选完——
而不是 600 张。逐帧时序仍由 `contact-sheet.sh` 对最终选中的那条单独出图确认。

> **实测踩出来的一条**：代表帧**不能取亮度峰值**。第一版取峰值，`eskie.damage` 一族拼出来
> 前九格（bludgeoning/piercing/slashing × red/yellow/white）长得一模一样——那一族的峰值帧
> 正是素材自带的白色闪爆，颜色被冲干净了，而选材恰恰要看颜色。
> 现在按量测出的 `flashRatio`（峰值亮度 ÷ 非空帧亮度中位数）自动判断：≥2 取闪爆之后的
> 残留段。这也正是游戏里实际看到的——兵库对这一族用 `startTime: 234ms`（29.97fps 的第 7 帧）
> 就是在跳过闪爆。

守卫改成两条通路：命中主表 **或** 命中某个已登记族的量测表且该族有抽样记录。

> 工具链本地已可用（`LOCAL-STATUS.md` §3.5）：本机无 ffprobe，`tools/media.mjs` 用 `ffmpeg -i` 顶替。
> alpha 判据是容器 tag `alpha_mode=1`，**不是 `pix_fmt`**（主力库一律报 `yuv420p`，用它判全假阴性）。

### D5 · 选材原则：每个位置取最优，不为「与原生一致」让步

owner 裁定：**只选最优**。

不覆盖原生，所以原生那 24 组（6 个姿态 × 4 个有美术的符文）由它自己播；
我们负责的是其余部分，那里没有「要不要跟原生统一画风」的问题——**取当前能拿到的最好的**。

素材源按「对这个位置好不好用」现场判断，不设全局优先级。手上有的：

| 视觉 | 规模 | 强项 |
| --- | --- | --- |
| `jb2a` | 11701 webm | 广度第一。209 个顶级 key，`template_circle` 1101 / `ranged_missile` 378（**带 cast/hit/missile_only 三段拆分，与三个槽天然对齐**）/ `spiritual_weapon` 255（25 武器 × 6 主题）/ `condition` 216 |
| `eskie` | 3242 webm | 正交矩阵。近战 1250（伤害类型 × 重量 × 速度）、`Crosshair` 196、`Slice`+`Wounds`+`Texture_Mask` 持续伤口层、`UI.ability_check.d20` 判定面 |
| `blfx` | 1257 webm | `misc.enchantment.1-22` 附魔叠加层 jb2a 没有；1120/1124 严格 30fps，时序标注成本最低 |
| `jaamod` | 520 webm | **34 个具名状态的 token 循环**——状态层（46 个）的现成素材。⚠ `condition.rings` 整支死链 |
| `jb2a-extras` | 135 webm | `magic_signs.rune.03` 128 条（8 图案 × 8 色 × complete/loop），持久符文标记 |

| 音效 | 规模 | 强项 |
| --- | --- | --- |
| `blfx.sound` | **503** | 与已用动画**同命名空间**，冲击点天然对齐，省掉整轮 timing 调试；48k、中位 1.64s、**≥10s 零条** |
| MGS `ogg/SFX` | 2263 | 唯一按伤害类型字面命名的矩阵；`Weapons` 195 条是 `{元素} × {武器} × {Draw\|Whoosh\|Hit}`，**与 Crucible「符文附在武器上」同构** |
| `ggg` | 3049 | 语义分层最贴 cue 模型（strike/block/parry/miss/impact/cast/buff/curse/surge）。⚠ `magic.mental` 是空分支 |
| `psfx` | 1135 | 距离档 ft 与 jb2a 逐帧同构，一套选档代码同时选画面和音效。⚠ 时长含尾部静音 padding |
| Crucible 自带 | 53 | frost/flame/life/death 四符文的 charge/passive/damage/impact/miss 全套，**为这四个符文专门做的**——配这四个符文时它就是最优解 |
| `soundfxlibrary` | 167 | `Melee Miss` / `Shield Hit` 别处找不到。⚠ 注册失败，只能裸路径 |

**⚠ 三件事必须先处理**（详见 `LOCAL-STATUS.md`）：

1. **禁用免费版 `psfx`** —— 它和付费版都注册 `psfx`、都挂 `sequencer.ready`、都没有让位守卫，
   Sequencer 走 `mergeObject`（`sequencer.js:6636`）**后注册的覆盖先注册的**。
   两版文件名交集 393，免费版独有仅 26，而 V1 唯一那条音效路径正好落在冲突区。
2. **`ggg` 加进 `extract-db.mjs` 的 `TARGETS`** —— 它已注册 `ggg-sfx`，只差一个字符串。
3. **MGS / soundfxlibrary / jaamod 建离线索引** —— 前两个是裸路径，第三个已注册但不在索引里。

### D6 · 随机池：机制已有，但只能在「时序兼容」的成员之间建立

owner 裁定：**有余力就做，没余力放 V3。** 排在所有 specific 选材之后。

机制已经存在：`resolver/context.mjs` 的 `ctx.pick()` 在解析结果是数组时就用 seeded mulberry32
随机取一（出手端摇定，全场一致，测试可复现）。psfx / ggg 的 DB 末两级本来就是数组，
**音效层的池开箱即用**。

两个坑：

**(a) 视觉侧的变体是兄弟键不是数组。** `resolver/assets.mjs` 的 `getEntry` 对中间节点
**只取其下第一个叶子**。所以 `jb2a.impact.011` 这种父路径不会成池。需要新增「收集子树全部叶子」的能力。

**(b) 不能无脑按子树池化。** `ASSET-NOTES` 记着：同族分支帧数能差 **1.83 倍**，帧率有
24/25/29.97/30/60 **五种**（71 条视觉记录里 54% 不是整 30fps），自带闪爆的 29 条。
而兵库的 `startTime`/`duration`/`fadeIn`/`fadeOut` 全是逐条实测值——池里塞进帧数不同的兄弟，
这些数字会静默作废。

**池必须显式声明成员，成员时序参数经过实测。** 守卫检查：同池成员帧数差 ≤ 阈值、帧率相同、闪爆标记一致。

### D7 · 未接的输出通道：Sequencer 六个 section 只用了两个

`player/play.mjs` 全文只有 `seq.sound()`（:245）与 `seq.effect()`（:272, :302）。
`animation` / `scrollingText` / `canvasPan` / `crosshair` 四个未用。

零素材成本的四条通道，其中两条对「specific」直接有用：

- **`crosshair`** 配 `eskie.Crosshair` 196 条（Circle/Cone/Line × 多色 × 10/20/30/60ft 档）
  = AoE 预告层的完整答案
- **`scrollingText`** 做判定结果文字，配 `eskie.ui.ability_check.d20` 的
  `Fortitude` / `Reflex` / `Will` / `Pass` / `Fail` 面——**Crucible 的三道防御恰好就是
  fortitude / reflex / willpower**，逐字对齐

> 与既有决策的边界：`play.mjs:266-267` 明确否决过**全屏震动**。那条只针对震屏，
> 不等于否决整个屏幕层——`eskie.screen_overlay` 24 条配 `.screenSpace()` 是非震动手段。

---

## 3. 工作线

### 线 0 —— 地基（无前置，先做）

| # | 内容 | 状态 |
| --- | --- | --- |
| 0.1 | `ggg` + `jaamod` 加进 `extract-db.mjs` 的 `TARGETS`；提取器自扫死链记进 `index.deadLinks`；加死链守卫 | ✅ 索引 22,705 条，死链 46 条（eskie 2 / cartoon 3 / ggg-vfx 3 / jaamod 38），三条变异验过 |
| 0.2 | `data/sfx-index.json`：MGS 2263 + soundfxlibrary 167 建离线索引，运行时注册成 Sequencer 的 `canim` 命名空间 | ✅ 树内 2025 + 排除 405 = 2430 精确对账；12 种伤害类型全成 3 元素随机池；7 条守卫 + 4 条变异 |
| 0.3 | `tools/profile-family.mjs`：批量机器量测 | ✅ 实测复现了 ASSET-NOTES 的人工结论（eskie.damage 全族 29.97fps / peak f5 / leadEmpty 1） |
| 0.4 | `tools/family-sheet.mjs`：一张图看一族 | ✅ 56 个素材一张图，`--at auto` 按 flashRatio 避开闪爆帧 |
| 0.5 | `ASSET-NOTES` 新增「族级选材」章节 + `armory-assets.test.mjs` 改双通路 + `test/asset-families.test.mjs` | ✅ 已登记首个族，四条变异验过（抽样漏形态／成员数漂移／抽样不属于本族／量测不全，各自变红） |
| 0.6 | 兜底棘轮 `test/fallback-ratchet.test.mjs` | ✅ 改成棘轮而非常红（见下） |

> **0.1 里原计划的「禁用免费版 `psfx`」owner 决定不处理。** 影响仅限运行时：
> 两版 393 个同名文件解析到哪一版由加载顺序定，而它们是同一批音源、听感一致。
> 免费版独有的 26 条（10 条耳语吟唱 + 5 条 `energy_strands` 的完整 ft 档位）
> 按**裸路径**引用，绕开命名空间冲突——已核实 Foundry 的 `express.static(paths.data)`
> 无条件服务整个 Data 目录，与模组启没启用无关。

#### 线 0 收工时改掉的两个判据（都是实测逼出来的）

**(1) J1 守卫不做成「一开始就红」，做成棘轮。**
计划初稿写的是「先写成红的当进度表」。那会让 `npm test` 的红绿长期失去意义，
下一条真的坏了也没人看。改成钉住基线（180 / 270 / 616）**只许降不许升**：今天是绿的，
红了一定是真出事；每完成一批选材就下调基线，数字本身就是进度。
另配一条「基线必须贴着实测值（不得高出 5%）」的反向守卫——没有它，上面三条能被
「把基线调大」轻易绕过，那才是最坏的用法。

**(2) 族内均匀性不看「内容占比离散度」，改看「抽样是否覆盖每一种形态」。**

初稿定的是离散度 ≤ 0.20。实测 `eskie.attack.melee.generic.01.slashing.light`：
全族 81 条，帧数 30 / 帧率 29.97 / 1000×1000 / 带 alpha **完全一致，帧数离散度 0.000**，
但内容占比 0.46–0.98、离散度 0.29 —— 按初稿判据会被判不均匀。

拆开看，决定它的是**变体号**：`_01` 竖向长弧 0.73、`_02` 扁平横扫 0.52、`_03` 低角度宽弧 0.65，
而同一变体内跨 9 色 × 3 速度只差 0.006–0.026。**三种挥砍形状占画幅不同是设计，不是缺陷。**
而且变体在 DB 树里是最后一级（`…<色>.<速度>.<01|02|03>`），规则写到 `<速度>` 这一层时
`resolve()` 对中间节点只取第一个叶子——**变体今天根本不会被池化**。

所以「族内数字必须一致」是错的判据。对的是：**族内有几种形态，抽样就必须看过几种**。
族级记录的承诺是「看过的能代表没看过的」，不是「族内长得都一样」。
守卫改成按内容占比聚类（相对容差 0.10），要求抽样命中每一簇。

> 顺带量出一条 C1 类问题：这一族的暗底亮度跨 41–175，`purpleblack` / `redblack`
> 两色在深色地图上接近隐形。已记进族的备注列。

### 线 A —— 573 个目标的专属选材（主体）

按玩家可见频次分批：

| 批 | 目标 | 数量 |
| --- | --- | --- |
| A1 | 武器（含 39 件天生武器） | 92 |
| A2 | 具名动作 —— 近战/攻击类 | ~120 |
| A3 | 符文 × 姿态 | 180（除去原生 24 组） |
| A4 | 具名动作 —— 反应/移动/增益类 | ~110 |
| A5 | 状态效果（persist 槽） | 46 |
| A6 | 变格 inflection | 10 |

### 线 B —— 音效层（与线 A 同步，同一条规则同时定画面与声音）

音效槽与视觉六槽同构 + 判定结果层：
`swing` / `travel` / `hit` / `miss` / `block` / `crit` / `cast` / `persist` / `vocal`，三层可叠加。

空间音频参数：`.syncGroup()`（**必须**——psfx 有 padding 静音尾、视觉素材 54% 非整 30fps）、
`.audioChannel()`（与 BGM 分离）、`.radius()` + `.constrainedByWalls()` + `.distanceEasing()`、
`.playIf()`（让 vocal 层不必每次都响）。

### 线 C —— 新输出通道（D7）

`crosshair` AoE 预告 + `scrollingText` 判定结果。排在线 A 主体之后。

### 线 D —— 随机池（D6）

有余力则做，否则 V3。

---

## 4. 顺序与上机点

```
线 0 地基 ─┬─→ A1 武器 ──┐
           ├─→ A2 近战  ─┤
           ├─→ A3 法术  ─┼─→ J1/J2 守卫转绿 ─→ 线 C ─→ 线 D
           ├─→ A4 其余  ─┤
           ├─→ A5 状态  ─┤
           └─→ A6 变格  ─┘
                 ↕ 线 B 音效全程同步
```

**三个必须上机的卡点**（离线证不了，`HANDOFF.md` §4 第 6 类失败模式）：

1. **线 0 结束后**：跑 `/canim-preview`，确认新索引与工具链在游戏内一致；
   顺手跑 ggg 192kHz 那一行（`LOCAL-STATUS.md` §5），定性内存风险
2. **A1 或 A2 做完第一批后**：拉满 D2 的「重」档跑一场 6 人混战，**看掉不掉帧**，回来定档位常量
3. **每条线收尾**：`/canim-preview` 过一遍该线的全部规则

**58 项旧验收清单**并入 V2，随对应线走；其中第 12 项（确认原生 24 组本模组全程不介入）
在 A3 之前先验——那条塌了 A3 的定位就错了。

---

## 5. 已知问题与风险

| # | 问题 | 对策 |
| --- | --- | --- |
| 1 | **ASSET-NOTES 是唯一会卡死 V2 的地方**。600–1000 条素材按现在的做法要 600–1000 张联系表 | D4 分级 + `family-sheet.sh`（一张看 12 个），降到约 50 张 |
| 2 | **判别度组合爆炸**。573² / 2 ≈ 16 万次比对 | D3 按「可混淆组」收敛，跨组不比 |
| 3 | **性能没量过**。「多重」拉满后一场混战同时在播多少特效，`DESIGN.md` 没有预算，项目从没测过 | D2 的档位做成常量；线 0 后第一个上机点专门测这个 |
| 4 | **近义天赋的取舍**。`counterEvade` / `counterRiposte` / `counterStrike` 是同一族反应 | owner 已裁定「如果复用更好复用也可以」——同族共用骨架 + 每条一处专属差异（角度/颜色/附加层），不为区分而区分 |
| 5 | **`PALETTE.lab` 是测量常量**，当前 MIN_DELTA_E 余量只有 **0.7–0.9**，几乎贴着阈值 | 每次改素材重跑 `element-residual-colour.mjs`；余量过小优先换素材而不是调阈值 |
| 6 | **兜底率降到 0 后，`HANDOFF.md` §2 的裁剪名单判据失效** | 裁剪推迟到线 A 完成之后重算 |
| 7 | **语料 `actorType` 全是 hero**。怪物专属动作（bite/claw/breath）的覆盖靠 39 件天生武器间接达成 | A1 里单独确认这 39 件；若不足，上机遇到再补 |
| 8 | **我的装机扫描曾漏掉 6 个模组** | 已改为枚举全部 276 个目录。**任何「本机有什么」的结论必须来自枚举，不能来自清单** |
| 9 | `Sequencer` 的 `compatibility.maximum: 14`，v15 会判不兼容 | 无对策，记录待观察 |
