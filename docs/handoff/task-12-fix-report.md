# Task 12 修复落地报告：persist 槽

基线 `f591c15`（170/170）→ 落地后 **201/201**。仓库改动 12 个文件（源码 5、测试 6 新增/修改、
工具 2、文档 3）。全部数字均在本轮**重新实测**，未沿用设计阶段的任何数值。

---

## 0. 一句话结论

五组规格全部落地，其中 **3 条整体拒绝、4 条局部拒绝或改法**。核心交付：

1. **归并表对齐真实运行时**——`entropy` 的死映射修掉，5 个战斗直调 DoT 不再掉进白泡兜底；
2. **12 组颜色索引重新拉开**——三对撞色（3.1 / 10.2 / 10.4）全部修完，最小 12.2；
3. **分层从「两套」收敛成一条规则**——最坏叠加遮挡 40.8% → 17.1%（结构性上限）；
4. **持久化闸门**——`persist && !tieTo` 在槽出口丢弃并留痕，`resolveEffect` 不再对残缺输入外抛；
5. **`worldPersist` 契约**——安全默认 + 一条「play.mjs 一出现就上膛」的守卫。

---

## 1. 五组各落地了什么

### 1.1 grouping-accuracy（P1 全采纳，P2 部分采纳）

**源码核实**（`/root/fvtt14-data/Data/systems/crucible`，逐条自己解析，不是转述）：

```
effects.mjs 的 18 个 export function：
  entropy      id=Entropy      statuses="frightened"     ← 首元素 ≠ 自身 id
  corroding    id=Corroding    statuses=(无该字段)
  decay        id=Decaying     statuses=(无该字段)
  irradiated   id=Irradiated   statuses=(无该字段)
  mending      id=Mending      statuses=(无该字段)
  inspired     id=Inspired     statuses=(无该字段)
  freezing     …               statuses="freezing","slowed"
  confused     …               statuses="confused","disoriented"
  suffocating  …               statuses="suffocating","silenced"
```

落地：
- `scripts/trigger/snapshot.mjs` 新增 `GENERATED_EFFECT_STATUS`（5 条 16 位补零 `_id` → 规范状态 id）
  与 `statusIdOf()`；`snapshotEffect` 与 `snapshotAction` 两个现场都改走它。
- `STATUS_GROUP.entropy` 从 `decay` 改到 `fear`（与它真正赋予的 `frightened` 同组），并登记
  `UNREACHABLE_STATUSES`。**键不删**——`STATUS_GROUP` 键集合必须等于 `CONFIG.statusEffects`
  键集合，`tools/dump-fixtures.mjs` 的 STATUSES 与 46 条 fixture 都建立在这条不变量上。
- `test/source-tables.test.mjs` 新增一条守卫：解析 `const/effects.mjs` 的 generator 产出
  （含复刻 `generateId` 算 `_id`），三类情形分别断言。`test/snapshot.test.mjs` 补 7 条单测
  （该函数此前零覆盖）。

**P2 归并语义**：采纳 3 条，拒绝 1 条（见 §3）。
- `dead` → `NO_PERSIST`（一条 pri 900 的 `status.silent` 规则返回 null）。
- `enraged` buff → debuff（`hooks/talent.mjs`：`statuses.has("enraged")` 时
  `defenseTotals.parry = defenseTotals.block = 0`——挂「受保护」的壳读反了）。
- `unaware` hidden → debuff（`hooks/talent.mjs`：`["exposed","unaware"].some(...)` 同档 +2
  伤害加值，与 exposed 同族；留在 hidden 会与 invisible 共用一圈烟弧，而两者该做的决策相反）。

改后分布（45 有声 + 1 静默 = 46）：debuff 9 / fear 7 / slow 6 / stun 5 · buff 5 / haste 4 /
poison 3 / decay 2 / burning · freezing · bleed · hidden 各 1。

### 1.2 color-separation（采纳，撤销机制除外）

- `tools/element-residual-colour.mjs`：加 `--min-alpha/--min-chroma/--over/--opacity/--tint/--weight`
  六个旗标与 `--persist` 预设；`residual()` 改选项对象；`export decode/toLab/ciede2000/residual/PERSIST_RECIPE`；
  CLI 套 `isMain`（与 `extract-db.mjs:174`、`dump-fixtures.mjs:200` 同一约定）。
  **impact 默认行为逐字不变**，见 §4 的向后兼容实测。
- `test/armory-element-distinct.test.mjs`：删掉内联的 CIEDE2000（已用括号配对提取后逐字符 diff
  确认与工具里那份完全相同，1433 字节），改为 `import`。全仓只此一份实现。
- `scripts/armory/persist.mjs`：buff `energy_field.01.blue` → `.green`；decay 加
  `tint: "#e0a060"`；hidden 加 `tint: "#a0a0ff"`；`groupRule` 透传 `cfg.tint ?? null`。
- `docs/ASSET-NOTES.md`：新增 `jb2a.energy_field.01.green` 主表行（本轮亲自侦察，见 §2.3）、
  blue 行降级为「备选」、skull.purple 与 smoke.ring 两行补记本轮落地、否决清单里 skull.dark_red
  的矛盾修掉（见 §3）。
- `test/armory-persist-distinct.test.mjs`（新建，6 条）：PALETTE 覆盖全部分组 / 12 个互不相同的
  文件 / PALETTE 与实现逐条对齐且无降级 / 66 对 ΔE00 ≥ 11.5 / 不设豁免的反向锁 / NO_PERSIST 不占色槽。

### 1.3 scale-layering（采纳；impact 两处只记录不改）

- burning：`scale 0.55 → 1`、`opacity 1 → 0.9`。前提已在 Sequencer 源码核实（见 §2.1）。
- 新增 `ABOVE_TOKENS = {burning, haste, buff}` 与 `LAYER = {above:{false,40}, below:{true,25}}`；
  `groupRule` 与 `generic.persist` 都只从 LAYER 取值，兜底不再是「唯一一条 belowTokens:true」的例外。
- 新增 `tools/persist-occlusion.mjs`（流式逐帧解码，输出可直接粘回测试表）。
- 新增 `test/armory-persist-occlusion.test.mjs`（9 条）：OCCLUSION 表对齐 / 分层只有一套 /
  分层与 ABOVE_TOKENS 一致 / **分层依据本身可查** / 单组遮挡 ≤10% / 峰值 ≤25% / 上层不打黑洞 /
  叠加 ≤20% / objectScale ∈ [0.9,1.25] 且 opacity ∈ [0.5,1.0]。整套 <100ms，不读任何 webm。

### 1.4 persist-integrity（采纳）

- `scripts/resolver/resolve.mjs`：新增 `NO_PRIOR_SLOTS`（冻结空视图）与 `keepTied()`；
  `resolveEffect` 加残缺目标防护、改走 `runBuild` 复用 try/catch。
- `scripts/trigger/snapshot.mjs`：`snapshotEffect` 无 token 返回 null（**不是**照搬
  `snapshotAction` 的 (0,0) 兜底——cue 带 `attachTo:true`，原点兜底会在地图左上角挂一枚
  附着不到任何东西的光环，比不画更糟）。
- 测试：`armory-persist.test.mjs` 修同义反复（`assert.equal(null, null)` 恒真）+ 缺 uuid 三形态用例；
  `resolve.test.mjs` 加 4 条解析器级测试；`coverage.test.mjs` 的「warnings 恒为空」补上 effects 侧遍历。
- `docs/IMPLEMENTATION-PLAN.md`：Task 15 的 `planForEffect` 兼容 null 快照并对缺 uuid 记日志；
  `previewEffectPlan` 显式降级（否则加闸后预览会 12 条全 `plan=null`，人工验收途径静默失效）；
  Task 13 播放层补 `e.origin()`（原草案的 `endEffects({name, origin})` 是 AND 关系而播放层从没设过
  name，那张兜底网是死的）。

### 1.5 local-flag（采纳）

- `CUE_DEFAULTS.worldPersist = false`（安全默认：漏填 = 不写盘）。
- `persist.mjs` 文件头写明这是**槽级契约、不是规则参数**。
- 三条断言：cue 恒 `worldPersist:false` 且 `local:true`；规则不得自行声明这两个字段
  （绕过 normalize 直接调 `rule.build()` 再 `Object.hasOwn`）；**play.mjs 一出现就上膛的 grep 守卫**
  （现在 skip，Task 13 一提交就生效）。
- `docs/DESIGN.md` 新增 §6.7 + §6.2 字段 + §5.4 那一行的补注。
- `docs/IMPLEMENTATION-PLAN.md`：Task 13 的 `.temporary(cue.worldPersist !== true)` 与
  `seq.play({local:true, preload:true})`；Task 15 的重建钩子（挂 `sequencerEffectManagerReady`
  而非 `canvasReady`）；Task 16 新增 13 项多客户端验收。

---

## 2. 前提核实（读源码 / 实测，不是引用规格）

### 2.1 objectScale 走 scaleToObject，源画幅像素不参与定尺寸

`/root/fvtt14-data/Data/modules/sequencer/dist/sequencer.js:17189`

```js
this.sprite.width = width * (this.data.scaleToObject?.scale ?? 1) * baseScaleX;
```

`width` 来自 `getSourceData()`（被附着对象的尺寸）；源文件像素只经
`heightWidthRatio/widthHeightRatio` 参与宽高比。播放层是
`if (cue.scale) e.scale(cue.scale); else e.scaleToObject(cue.objectScale)`
（IMPLEMENTATION-PLAN:3616），而 `grep -rn "scale: \[" scripts/armory/*.mjs` 无命中
（`CUE_DEFAULTS.scale` 恒 null）——**永远走 scaleToObject**。

### 2.2 落盘判据没有 `!data.local` 子句

`sequencer.js:11819`

```js
if (data.persist && setFlags && effect2.context && effect2.owner
    && !effect2.isSourceTemporary && !data.temporary && !data.remote) {
  flagManager.addFlags(effect2.context.uuid, { effects: effect2.data });
}
```

`belowTokens(b)` → `sortLayer(b ? 600 : 800)`（`:24310`）；
`shouldPlay` 的用户过滤以 `game.user.isGM ||` 开头（`:15146`）；
`.temporary()` 的文档原话是「will not be stored in the flags of any object, even if
.persist() is called」（`:23242`）；`data.temporary && effect.owner` 会挂逐帧位置广播 ticker
（`:11836`，这是本方案唯一的实打实代价，已写进 Task 16 第 31 项）。

### 2.3 impact 取样配方量不出 persist（本轮实测）

```
IMPACT 配方（--from 0 --min-alpha 64 --min-chroma 20）：
  jb2a.markers.runes.dark_black.01           NULL（全片没有非灰像素）
  jb2a.markers.chain.standard.loop.01.grey   rgb=[31.5,30.9,50.2]   ← 只剩零星蓝噪点
```

屏幕配方（`--persist`，opacity 0.8）下同一支 chain 是 `lab=[35.8,1.5,-2.1]`（银灰链环）。
所以 persist 必须用另一套取样规则，而不是「另写一套算法」——同一支工具加旗标。

### 2.4 energy_field green 与 blue 是同一次渲染的换色版（本轮亲自量）

| 指标 | blue | green |
| --- | --- | --- |
| 画幅 / 帧数 / 帧率 | 600x600 / 121 / 24fps | 同 |
| 全画幅 alpha 均值 f0/f60/f120 | 66.38 / 66.53 / 66.38 | 66.37 / 66.53 / 66.39 |
| 首尾接缝 · 相邻帧（逐像素 alpha 平均绝对差） | 1.35 · 1.88 | 1.35 · 1.91 |
| 中心 150x150 alpha（六次取样均值/最大） | 0 / 0 | 0 / 0 |
| 中心 300x300 均值范围 | 19.9-32.0 | 19.9-32.0 |
| alpha>200 占比 | 8.84% | 8.83% |
| 四边最外 1px alpha 最大值 | 3 | 3 |
| alpha>=100 处 meanRGB | 66,204,208 | **111,232,130** |

结论：blue 行记的全部几何/密度/循环结论逐条继承，**唯一的差别是颜色**。

---

## 3. 冲突取舍与未采纳条目

### 3.1 跨组冲突（本轮实际发生的三处）

| 冲突 | 处理 |
| --- | --- |
| **burning 的 opacity 两组给了不同值**：color-separation 的矩阵按 opacity 1.0 量，scale-layering 要求压到 0.9 | 以 **0.9** 为准并**重量**残留色。因此本报告的 burning 行与两组规格给的数都不同：burning/bleed 21.7（规格 22.7）、burning/haste 15.5（规格 16.1）。这正是「不许沿用设计阶段数字」要抓的东西 |
| **debuff 的方向相反**：scale-layering 要 belowTokens、另一条 finding 要 tint 提亮 | 只做 belowTokens（黑洞打在地面上，遮挡结构上为 0），opacity 保持 1.0。「中深灰地砖上糊没」需要 tint/contrast，与本轮方向相反，注释里写明「若哪天移回 token 之上，opacity 必须 ≤0.6」，由暗洞守卫看着 |
| **grouping P2 把 debuff 推到 9 个成员**，而它是最暗的素材 | 接受。理由是同一轮里 debuff 已被压到 token 之下，「太黑压脸」这条已消失；剩下的「地面上太暗」是既有问题、不因成员变多而恶化 |

`grouping-accuracy` 的 risks 提醒「修好 entropy 会让 decay/fear 撞色从纸面变成真实」——本轮同批
落地了 decay 的 tint，两者不会脱节。

### 3.2 未采纳（附理由）

| # | 规格条目 | 决定 | 理由 |
| --- | --- | --- | --- |
| 1 | color-separation：否决清单的**「已撤销」机制**（`rejectedEntries()` + `RETRACTED_MARK` + `RETRACTED_KNOWN` + 3 条守卫） | **整体拒绝** | 规格自己承认「最终 decay 走 tint，不依赖该机制」。它唯一的作用是修文档矛盾，而修矛盾**不需要**这套机器：`skull.dark_red` 本来就该继续被否决——我实测它对 bleed 只有 **ΔE00 7.7**，另外只有 144 帧（purple 145）、全片 alpha 均值 44.7 对 67.8。所以改成**就地更正否决理由**：原正文一字不动，追加「否决理由已订正，条目继续有效」+ 主表推翻旧理由的原话 + 两条站得住的新理由。收益相同，且不引入一条会削弱否决清单的新逃生舱（有效否决条目数不变） |
| 2 | grouping-accuracy P2：`falling` 静默 | **拒绝** | 「生命周期短于 fadeIn+fadeOut 各 500ms」这条我无法从源码证实。`models/action.mjs#settleMovement` 只在**坠落对话框被取消**时清除 falling，对话框可以一直开着；正常路径由 `fall` 动作自己收尾，时长不确定。留在 debuff 组无害，静默它反而可能丢信息 |
| 3 | scale-layering：改 `impact.mjs:53` / `:241` 的 canvas 归一化系数 | **拒绝改值，只加注** | 规格自己也说「修改权在 impact 槽负责人」。改这两处会牵动 element-distinct 的 PALETTE、MAX_FADE_RATIO、以及上一次提交 `1b825f7` 的「掠过缩放」定义，超出 Task 12 范围。但**留下互相矛盾的文档是真实缺陷**（persist.mjs 现在明写「objectScale 不是画布归一化系数」），所以在 impact.mjs 两处与 aftermath.mjs 一处加了「⚠ 前提在 Task 12 被推翻，本槽尚未跟进」的注记，附本轮实测：<br>`内容占画幅比`（alpha≥25 的 bbox，按各自 startTime 起算）800x800 的 eskie 系 0.741-0.910、400x400 的 jb2a 系 0.718-0.930——**与画布像素无相关性**；0.45/0.9 二分导致实际观感尺寸 eskie 0.334-0.410 格宽、jb2a 0.646-0.837 格宽，与「调到同一量级」正好相反 |
| 4 | grouping-accuracy：`overrun` slow→debuff / `shocked` 独立成第 13 组 / `corroding` 从 poison 拆出 / `dominated` 从 fear 拆出 | **拒绝**（规格自己也标了驳回/延后） | shocked 的候选素材 ASSET-NOTES 实测 59 帧里 22 帧整帧 alpha 均值 <2.2/255 且亮帧电弧横穿 token 正中；其余三条要么收益小、要么没有验证过的备选素材。另外新增第 13/14 个颜色槽会让 11.5 阈值需要重新验证——本轮未做，已在 §6 记为遗留 |
| 5 | scale-layering：把 `hidden`/`bleed` 等的「压到 token 下还看不看得见」做成断言 | **拒绝写死阈值** | 阈值定不下来（hidden 压下去剩 15.5/255 是刻意的最不张扬，haste 剩 10.3 是不可接受的，两者只差 2.4）。改为断言**分层依据**：上层必须满足「outerFrac < 0.5（压下去就没了）」或「脸部遮挡 < 1%（留上面零成本）」二选一，下层必须 outerFrac > 0.5 |
| 6 | persist-integrity：`resolveEffect` 对 `statusId === null` 也返回 null | **拒绝**（规格自己列为「可选、建议与 Task 15 一起决策」） | 属行为变更（现在会出兜底 cue），且 Task 15 的 `planForEffect` 已在上游拦住这种输入 |
| 7 | color-separation：decay tint 用网格最优值 | **改用 `#e0a060`** | 我复跑了 8×8×8 网格，最优是 `#b60049`（min 22.0）而不是规格给的值；`#e0a060` 实测 min 20.5，差别在噪声量级内，但暖琥珀滤色把紫骷髅压成酒红/绛紫、保住了「腐朽」的读法，而 `#b60049` 是深绛红、更接近 bleed 的语义。同理 hidden 网格最优 `#00db92`（青绿，会与 stun 撞语义），改用 `#a0a0ff`（min 17.3，靛蓝烟弧，与「阴影/隐匿」同向） |

另外：`buff` 的 `multicolored` 分支数值最好（min **13.4** > green 的 12.2），但它是彩虹版，
配不上单一状态语义，且不在 ASSET-NOTES 主表。选 green 是「数值过关 + 读得通」的折中，记录在案。

---

## 4. 重算后的最终数据

### 4.1 12 组两两 ΔE00（屏幕残留色，全帧解码，合成到 0x303030）

**数据源是 `test/armory-persist-distinct.test.mjs` 里那张 PALETTE 本身**（下表由脚本从该文件
解析后现算，不是手抄）。

```
          burnin freezi poison  decay  bleed   stun   fear hidden  haste   slow   buff debuff
burning        -   40.4   27.9   36.4   21.7   37.7   50.6   39.2   15.5   23.0   30.2   27.4
freezing    40.4      -   46.1   47.1   49.0   20.2   33.7   25.5   30.2   25.3   34.5   34.3
poison      27.9   46.1      -   60.9   52.0   26.8   77.6   45.8   19.2   27.3   12.2   32.1
decay       36.4   47.1   60.9      -   20.9   54.4   20.7   21.9   35.7   23.4   57.7   24.1
bleed       21.7   49.0   52.0   20.9      -   54.8   37.1   33.7   29.4   25.6   51.8   26.2
stun        37.7   20.2   26.8   54.4   54.8      -   43.2   36.6   24.8   31.8   15.9   39.4
fear        50.6   33.7   77.6   20.7   37.1   43.2      -   17.8   45.1   28.1   48.2   31.8
hidden      39.2   25.5   45.8   21.9   33.7   36.6   17.8      -   33.5   17.3   40.2   21.0
haste       15.5   30.2   19.2   35.7   29.4   24.8   45.1   33.5      -   15.6   18.2   24.8
slow        23.0   25.3   27.3   23.4   25.6   31.8   28.1   17.3   15.6      -   27.4   13.6
buff        30.2   34.5   12.2   57.7   51.8   15.9   48.2   40.2   18.2   27.4      -   35.7
debuff      27.4   34.3   32.1   24.1   26.2   39.4   31.8   21.0   24.8   13.6   35.7      -
```

66 对全部 ≥ 11.5；最紧 6 对：**poison/buff 12.2** | slow/debuff 13.6 | burning/haste 15.5 |
haste/slow 15.6 | stun/buff 15.9 | hidden/slow 17.3。

**修复前（f591c15，同一配方复现）**：decay/fear **3.1**、stun/buff **10.2**、hidden/slow **10.4**、
slow/debuff 13.6、haste/slow 15.6。三对低于 11.5，第四紧 13.6 —— 阈值必须落在 (10.4, 13.6]，
取 11.5 与 impact 的 `MIN_DELTA_E` 同值（余量 1.1 / 2.1）。

各组最终屏幕残留色：

| 组 | 素材 | opacity | tint | rgb | lab |
| --- | --- | --- | --- | --- | --- |
| burning | eskie.burn.embers.orange | 0.9 | – | 131.9, 90.7, 40.7 | 42.0, 11.7, 34.8 |
| freezing | markers.snowflake.blue.01 | 0.85 | – | 48.4, 127.7, 172.4 | 50.7, -9.0, -30.7 |
| poison | markers.poison.dark_green.01 | 0.75 | – | 66.2, 110.6, 28.0 | 42.1, -30.1, 39.1 |
| decay | markers.skull.purple.01 | 0.8 | `#e0a060` | 119.3, 31.4, 76.9 | 28.1, 42.0, -6.2 |
| bleed | markers.drop.red.01 | 0.75 | – | 141.3, 34.7, 26.9 | 31.7, 44.0, 31.8 |
| stun | markers.stun.dark_teal.01 | 0.85 | – | 35.1, 144.4, 138.6 | 54.3, -30.7, -5.6 |
| fear | markers.fear.dark_purple.01 | 0.85 | – | 120.1, 21.9, 181.0 | 33.8, 63.7, -62.5 |
| hidden | markers.smoke.ring.loop.bluepurple | 0.55 | `#a0a0ff` | 67.0, 67.8, 116.0 | 30.8, 13.0, -27.9 |
| haste | markers.light.loop.yellow | 1 | – | 116.1, 110.3, 91.1 | 46.6, -1.2, 11.5 |
| slow | markers.chain.standard.loop.01.grey | 0.8 | – | 85.2, 83.6, 87.5 | 35.8, 1.5, -2.1 |
| buff | energy_field.01.green | 0.65 | – | 82.2, 130.8, 88.6 | 50.3, -25.9, 17.8 |
| debuff | markers.runes.dark_black.01 | 1 | – | 45.8, 43.0, 43.1 | 17.8, 1.3, 0.4 |

### 4.2 遮挡度（`tools/persist-occlusion.mjs`，13 支全帧解码）

窗口 = token 中心 40%，对应源画幅 `rel = 0.4/objectScale`；数值 = 逐帧窗口 alpha 均值的时间均值
× opacity（单位 /255）。「层」列是本轮的分层结果。

| 组 | 层 | scale | op | 脸(/255) | % | 峰值% | 暗洞率 | 外圈 r>0.6 | **实际遮挡** |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| burning | 上 | 1 | 0.9 | 22.9 | 9.0 | 14.3 | 0.05% | 22.9% | **9.0%** |
| haste | 上 | 1.15 | 1 | 22.3 | 8.8 | 22.0 | 0.00% | 35.3% | **8.8%** |
| buff | 上 | 1.2 | 0.65 | 0.3 | 0.1 | 0.2 | 0.00% | 86.3% | **0.1%** |
| decay | 下 | 1 | 0.8 | 23.8 | 9.3 | 13.2 | **7.71%** | 63.8% | 0（结构性） |
| debuff | 下 | 1 | 1 | 21.2 | 8.3 | 12.9 | **3.33%** | 66.2% | 0 |
| slow | 下 | 1 | 0.8 | 17.8 | 7.0 | 8.5 | **4.98%** | 66.0% | 0 |
| freezing | 下 | 1 | 0.85 | 10.2 | 4.0 | 6.0 | 0.00% | 68.3% | 0 |
| poison | 下 | 1 | 0.75 | 9.9 | 3.9 | 6.1 | 0.27% | 59.2% | 0 |
| generic | 下 | 1 | 0.5 | 7.4 | 2.9 | 3.9 | 0.00% | 85.3% | 0 |
| stun | 下 | 1 | 0.85 | 5.8 | 2.3 | 4.3 | 0.00% | 68.0% | 0 |
| fear | 下 | 1 | 0.85 | 1.2 | 0.5 | 1.3 | 0.18% | 81.1% | 0 |
| bleed | 下 | 1 | 0.75 | 0.8 | 0.3 | 0.7 | 0.10% | 83.6% | 0 |
| hidden | 下 | 1 | 0.55 | 0.5 | 0.2 | 0.3 | 0.00% | 87.2% | 0 |

**叠加合成遮挡 1−∏(1−aᵢ)**（中心 40%）：

| 组合 | 修复前 | 修复后 |
| --- | --- | --- |
| debuff + decay + slow（虚弱+辐射+倒地，最常见的三联） | 22.7% | **0%** |
| stun + bleed + decay + debuff + slow（死亡…五连） | 24.7% | **0%** |
| 全 12 组理论上限 | **40.8%** | **17.1%**（= burning+haste+buff，结构性上限） |

burning 的 scale 修正对照：`scale 0.55` 时整格有效遮挡只有 **2.5/255**（12 组最低，比倒数第二的
hidden 还低 5 倍），而中心 40% 有 15.0/255 —— 缩小不是「整体变小」而是「把最密的部分怼到脸中央」
（该素材 alpha 剖面随窗口**单调递减**：中心 20% 是 33.2，整幅只有 8.2）。
改到 `scale 1 / opacity 0.9` 后整格出光量 `scale²×opacity` 从 0.30 变成 0.90，是原来的 **2.98 倍**。

### 4.3 全量回归复算（自己跑，不采信规格）

```
动作覆盖 434/434   plan.warnings 合计=0   降级次数=0   降级率=0.00%
零目标攻击 cast 覆盖 53/53
状态覆盖 45/45（另有 1/1 条刻意静默 dead）= 46/46
travel ray/cone/pulse/surge 超 1 份的动作：无
impact 元素层：12 个 element 键 / 10 种视觉素材
元素层 objectScale HIT=0.45 GLANCE=0.27 比值=0.6000
ASSET-NOTES 主表 96 行（persist 槽 18 行），MIN_ROWS=93 仍满足
LEGACY_UNVERIFIED = 0 条（保持清空）
```

工具向后兼容（impact 路径一个数都不许变）：

```
$ node tools/element-residual-colour.mjs --from 7 --delta <acid.green> <poison.purple>
acid    rgb=[152.2,255,80]     lab=[91.1,-57.7,70.7]
poison  rgb=[169.3,48.3,247.7] lab=[48.7,77.3,-76.2]
CIEDE2000: 102.8
```
与 `armory-element-distinct.test.mjs` 的 PALETTE 逐字一致。
（唯一副作用：CLI 的 rgb 输出从整数变成一位小数，lab 不变。）

---

## 5. 破坏实验（14 项，全部变红且报错可操作）

| # | 破坏动作 | 结果 |
| --- | --- | --- |
| E1 | buff 改回 `.blue`，PALETTE 不动 | `not ok 3` PALETTE 对齐 + `not ok 7` OCCLUSION 表对齐 |
| E1b | buff 改回 `.blue` **且** PALETTE 同步（模拟老实重量） | `stun 对 buff：ΔE00 = 10.2 < 11.5` ← **Critical 1 复现** |
| E2 | decay 去掉 tint（PALETTE 同步） | `decay 对 fear：ΔE00 = 3.1 < 11.5` ← **Critical 2 复现** |
| E3 | hidden 去掉 tint（PALETTE 同步） | `hidden 对 slow：ΔE00 = 10.4 < 11.5` ← 第三对复现 |
| E4 | 只把 hidden 的 opacity 从 0.55 调到 0.75 | `hidden: persist.mjs 把 opacity 改成了 0.75——…请用 node tools/element-residual-colour.mjs --persist … 重算` |
| E5 | `MIN_DELTA_E` 抬到 13 | `poison 对 buff：ΔE00 = 12.2 < 13` ← 阈值上界确实卡在 12.2 |
| E6 | burning 退回 `scale 0.55 / opacity 1` | OCCLUSION 表对齐 + objectScale 区间 两条红 |
| E7 | debuff 移进 ABOVE_TOKENS | 分层依据 + 暗洞(3.33%) + 叠加 三条红 |
| E8 | 兜底改回 `belowTokens:true, zIndex:10`（复现「两套分层」） | `generic.persist 的分层 {"belowTokens":true,"zIndex":10} 不是 LAYER 里的任何一种` |
| E9 | 去掉 `keepTied` 过滤 | 缺 uuid 用例 + 「丢弃并留痕」两条红 |
| E10 | 去掉残缺目标防护 | 「resolveEffect 对残缺目标返回 null 而不外抛」红 |
| E11 | `statusIdOf` 的别名查表改回裸 `return id` | 3 条 snapshot 测试红 |
| E12 | `snapshotEffect` 去掉 token 防护 | 「没有 token 时返回 null」红 |
| E13 | `dead` 从 NO_PERSIST 拿掉 | `NO_PERSIST 变了：静默一个状态 / 取消静默都必须走评审并同步这条名单锁` |
| E14 | 写一个违约的 `scripts/player/play.mjs`（只 `.persist()` + `play({preload:true})`） | 自动上膛的 grep 守卫红：`persist 分支必须写成 .temporary(cue.worldPersist !== true)`；换成合规版本后 12/12 绿 |

`test/source-tables.test.mjs` 的新守卫另做 4 项变异（全部变红，报错精准）：
entropy 改回 decay / `UNREACHABLE_STATUSES` 清空 / 别名表删一条 / STATUS_GROUP 删掉 `slowed`。

每项还原后立即复跑全绿。

---

## 6. 给 Task 13 的 local / flag 契约移交说明

**必须照做的三条**（`test/armory-persist.test.mjs` 的最后一条 grep 守卫现在是 skip，
`scripts/player/play.mjs` 一提交就自动上膛并检查这三条）：

1. **`e.temporary(cue.worldPersist !== true)`** —— 写在 `if (cue.persist)` 分支里。
   必须是 `!== true` 而不是 `=== false`：字段缺失（旧 plan、将来重构漏了默认值）时才落在
   「不写盘」的安全侧。**不加这一行，N 个在线客户端会把同一个状态写成 N 条世界记录，
   GM 重载后光环叠 N 层，且中途进场的玩家一个光环都看不到。** `.locally()` 拦不住——
   落盘判据里没有 `!data.local` 子句（`sequencer.js:11819`）。

2. **`await seq.play({local: true, preload: true})`** —— 这是**全槽**的，不只 persist。
   少了 `local:true`，`preload` 会走 `Sequencer.Preloader.preloadForClients`：向全场广播预载
   请求并阻塞等所有客户端逐个应答。本模组每个客户端各播一份，于是每个动画都变成 N 次全场
   往返 + 等最慢的机器；`role=PLAYER` 还没有 `permissions-preload` 权限（默认 1），会刷降级警告。

3. **不得出现 `executeForOthers` / `remote: true`** —— 本模组没有 socket 通路（DESIGN §5.4）。

**顺带三条（不在 grep 守卫里，但计划稿已改好）**：

4. `e.origin(cue.tieTo)` 与 `e.tieToDocuments([cue.tieTo])` 成对写，**不要设 `e.name()`**。
   设 name 会额外挂一个逐帧 ticker 往 PositionContainer 写坐标（persist 用不到），而且原草案的
   `crucible-anim:${plan.source}:${cue.rule}` 里 `plan.source` 是 statusId，两个 token 同挂
   burning 会撞名。Task 15 的 `deleteActiveEffect` 兜底必须按 **origin** 过滤——
   `_filterEffects` 里 name 与 origin 是 **AND** 关系，原草案 `{name:"crucible-anim:*", origin}`
   匹配 0 条，那张网是死的。

5. `worldPersist:false` 与 `local:true` **同进同退**。`getSourceData()` 对
   `data.temporary && !this.owner` 的效果改从 `TemporaryPositionsContainer` 取位置——一条
   temporary 的 cue 一旦被推给别人，那些客户端会拿不到位置、渲染错位。

6. **`.tint()` 必须真的接上。** decay 与 hidden 两组的正确颜色完全依赖它，而测试量的是
   「按这个 tint 算出来的颜色」，不是「屏幕上真的是这个颜色」。PIXI 的 tint 是乘法；
   如果播放端没接或当成加法，decay 会退回紫色、与 fear 撞成 ΔE00 3.1，**而测试全绿**。
   这是本轮唯一测试兜不住的缺口，已列为 Task 16 第 33 项。

**Task 15 的两处强制跟进**（不改就会出事，计划稿已写好）：
- `snapshotEffect` 现在可能返回 `null`，`planForEffect` 里的 `snapshot.statusId` 必须改成 `?.`，
  否则落地当天就是一个 TypeError；
- `previewEffectPlan` 原本传 `effectUuid: null`，加闸后会让 12 条 persist 规则全部 `plan=null`，
  预览这条唯一的人工验收途径静默失效。改法：借 token 文档当 tie 让计划成形，再把 `persist`
  摘掉并给 3000ms 有限时长。

---

## 7. 遗留问题

1. **`poison/buff` 12.2，余量只有 0.7**（与 impact 的 0.7-0.9 同档，是刻意的脆性）。
   往后动 poison 或 buff 的任何一项都很可能触红。要拉开只能给 poison 重新选材，而
   `markers.poison` 只有 dark_green 与 purple（purple 撞 fear），等于没得换——属独立任务。
2. **ΔE00 挡不住「靠调暗蒙混过关」**：把 buff 的 opacity 压到 0.55，stun/buff 就从 10.2 变成
   14.1 过关，但两者仍是同一种青绿。现在靠两件事兜：PALETTE 把 opacity/tint 一起钉住（改了必然
   触发重量），以及 persist.mjs 头注释写明「12 组各占一个色相」。**已知的、有意接受的缺口。**
3. **九支地面环压到 token 之下会变淡，没有自动守卫**（阈值定不下来，见 §3.2 第 5 条）。
   Task 16 第 32 项目视，特别是 hidden（外圈 87.2% 但基数最低）。
4. **haste 留在 token 之上是唯一的妥协**：峰值 22.0% 卡在 25% 线内、暗洞 0%（亮金色），但每
   5.04s 有两次约 540ms 的金条穿过脸。压下去只剩 35.3% 的能量，等于取消标记。上机觉得刺眼只能换素材。
5. **`temporary` 的逐帧位置广播**是本方案唯一的实打实代价（N 倍冗余 `UPDATE_EFFECT_POSITION`）。
   Task 16 第 31 项实测；不可接受时的退路是在 `preCreateSequencerEffect` 钩子里置 `data.remote`
   （同样短路落盘且不挂 ticker），但那是改内部字段的 hack，不该作为首选。
6. **`warning` 在「全部 cue 被丢弃」时会随 null 一起丢失**：persist 计划只有一条 cue，被
   `keepTied` 丢掉后 `cues.length === 0` ⇒ 返回 null ⇒ `ctx.warnings` 无处可去。生产环境的
   可观测性靠 Task 15 在 trigger 层补的 `warn(...)`（计划稿已写）。没有改 `resolveEffect` 的
   返回契约——所有调用方都写的是 `if (!plan) continue`，波及面远大于收益。
7. **fixture 的 `target.uuid` 恒为 undefined**（`tools/dump-fixtures.mjs` 的 `makeToken()` 不产出
   该字段），所以 `assert.notEqual(c.tieTo, e.target.uuid)` 目前是空转的保险；更要紧的是
   **每一条 cue 的 `at.uuid` 在测试里都是 undefined**，播放层按 uuid 解析锚点的那条路径从未被
   任何测试行使过。属既存语料缺陷（补上要重新生成 2.2MB + 380KB 两个 fixture），建议单独立项。
8. **`generic.persist` 的白泡**：`tmfx.inflow.circle.01` 的 RGB 平面恒为 (255,255,255)，不 tint
   就是一颗无差别白泡。天赋自定义效果（`berserkerRage` 等十余处 `getEffectId` 调用）会经常触发
   它。建议另开一条：要么给兜底加 tint，要么在 persist 触发器里跳过「不带任何 status 且不在别名
   表里」的效果。
9. **复合效果的第二个状态永远不出现**：`statusIdOf` 只取 `statuses[0]`，所以 freezing 附带的
   slowed、confused 附带的 disoriented、suffocating 附带的 silenced 在画面上没有标记。这是既有
   设计（一个 ActiveEffect 一份特效），本轮没改，但守卫已断言这三个附带状态必须在 STATUS_GROUP 里。
10. **`shocked` 独立成第 13 组 / `dominated` 从 fear 拆出**：新增第 13/14 个颜色槽后
    11.5 这个阈值我**没有验证过还有没有解**。做那两条之前必须先跑一遍本轮的候选枚举。
11. **impact.mjs / aftermath.mjs 的画布归一化系数仍是错的**（只加了注记，见 §3.2 第 3 条）。
