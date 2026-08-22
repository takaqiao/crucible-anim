# crucible-anim — Crucible 系统动画补齐模组 设计文档

- 日期：2026-08-19
- 目标世界：`ember`（Ember 二团 / Ember ABANDON），系统 `crucible` 0.10.2，Foundry VTT v14.366
- 形态：自用模组，硬绑本机已装素材
- 状态：设计已定稿，待转实现计划

---

## 1. 背景与问题

Crucible 0.10.2 自带一套基于 FVTT v14 核心 `foundry.canvas.vfx` 的原生 VFX 框架
（`systems/crucible/module/canvas/vfx/`，约 6200 行）。框架本身完整：有粒子图集、
性能分级、光敏模式、聊天卡序列化重放、`crucibleProjectile / Blast / Fan / Ray / Touch /
ForcedMovement` 六个自定义组件。

问题不在框架，在**内容覆盖率**：

| 维度 | 已实现 | 缺失 |
| --- | --- | --- |
| 法术姿态 gesture | 6 / 17：arrow, blast, fan, influence, ray, touch | **11**：aspect, aura, cone, conjure, create, pulse, sense, step, strike, surge, ward |
| 符文 rune | 4 / 12：flame, frost, life, death | **8**：control, earth, illumination, illusion, kinesis, oblivion, soul, storm |
| 符文音效（RUNE_SOUNDS） | 同上 4 个 | 同上 8 个 |
| 武器攻击 | 仅 `projectile1/2`（弓弩） | **全部近战**：unarmed / light1 / simple1 / balanced1 / heavy1 / simple2 / balanced2 / heavy2 / talisman / mechanical / shieldLight / shieldHeavy |
| 默认动作（13 个） | 0 | move, defend, escape, recover, reload, rest, reactiveStrike, delay, fall, throwWeapon, investiture, cast, strike |
| 天赋动作 | 0 | 系统 talent 131 + adversary-talents 46 + iconic spell 15 + ember 26 ≈ **218** |
| 变格 inflection | 0 | 全部 10 个 |
| 状态效果持续特效 | 0 | 全部 |

粒子图集 `CrucibleVFX0.json` 里**只有 death / life / frost / flame 四个符文的美术资源**
（分别 34 / 33 / 28 / 27 帧），另外 8 个符文一张贴图都没有。缺失部分因此只能靠外部素材。

本机可用素材：JB2A Patreon 9.7G（18542 文件）、JB2A 免费版 1.6G、jb2a-extras 105M、
eskie-effects 1.3G、blfx 1.4G、boss-loot 免费+付费、animated-spell-effects-cartoon 234M；
音效 psfx-patreon 1199 文件、soundfxlibrary 167 文件。Sequencer 4.2.3 已装且 v14 verified。

## 2. 目标与非目标

### V1 目标

补齐**空缺**，做一个**标签驱动的通用兵库**：不逐条手写 218 个天赋动作，而是按 crucible
已有的标签体系（50 个 action tag + 12 符文 + 17 姿态 + 12 伤害类型 + 16 武器类别 +
8 攻击结果 + 12 目标形态）组装动画，一套规则覆盖全部动作。

动画尺度取「克制」：向 crucible 原生风格看齐，只给有攻击 / 法术 / 资源变化的动作上动画，
移动、延迟这类只给音效或不给。

### V1 非目标

- 不替换 crucible 原生已实现的 24 个法术组合和弓弩射击
- 不做 GM 可视化编辑器（节点图 / autorec 式菜单）——留 V2/V3
- 不做电影化演出（eskie showcase 那种多段位移编排）——留 V2
- 不做「饱满」尺度（每个动作都有反馈）——设置项预留 `density: full`，V1 不填内容

## 3. 参考系统的调研结论

调研了四套成熟的 Foundry 动画系统，结论如下。

### 3.1 Boss Loot FX（`boss-loot-assets-premium` 3.0.1）

结构：`ANIMATION_MAP[system][itemType][actionType][baseItem|name][trigger] = {macro, defaultParams}`。
**模板宏 + 参数表**分离：`WeaponMacros.meleeAttackV3` 是可复用模板，`defaultParams` 是参数。

模板宏内部是**三槽编号**结构：

- 槽 1 `ON SOURCE TOKEN`
- 槽 2 `FROM SOURCE TO TARGET`
- 槽 3 `ON TARGET`

每槽有平行的动画轨和声音轨：`ANIMATION{n} / SCALE{n} / OFFSET{n} / ENABLED{n} /
WAIT_UNTIL_FINISHED{n}` 与 `SOUND{n} / DELAY_SOUND{n} / START_TIME_SOUND{n} /
SOUND_ENABLED{n}`。

触发时机词汇（8 个）：`afterItemUse / afterAttack / afterDamage / afterActiveEffects /
deleteActiveEffects / afterThrown / afterSummon / afterRollFormula`。

采纳：三槽模型、`playIf()` 声明式条件、声音作平行轨道、贴身/隔格换素材、大体型补偿、
镜像朝向、复制 sprite 抖动、并发信号量。
不采纳：每道具一条目的映射粒度。

### 3.2 Trigger Animations Trove（`pf2e-trigger-animations-trove` 0.10.2）

节点图模型，223 个动画定义，50 种节点类型。分类：Attacks 76 / Spells 56 / Conditions 32 /
Feats 30 / Equipment 10 / Class Features 8 / Handlers 6 / Basic Actions 3 / Creature Actions 2。

从 1.8MB 的 `animations.json` 里统计出的字段级 schema（括号内为使用次数）：

| 节点 | 字段 |
| --- | --- |
| `location` (335) | location, **attachTo(230)**, local(133), gridUnits(93), bindScale(71), offset(42), cacheLocation(26), bindRotation, edge, align, bindVisibility, bindAlpha |
| `aim` (140) | towards, **missed(88)**, attachTo(50), offset(35), rotationOffset, cacheLocation, randomOffset |
| `scale` (250) | **objectScale(215)**, width(17), gridUnits(17), height(15), scaleInDuration(14), scaleInScale(12), scaleInEase(12), considerTokenScale(10), uniform, scaleOut* |
| `visibility` (83) | fadeOutDuration(61), fadeInDuration(55), fadeOutEase(50), fadeInEase(43), opacity(24), masks(9), maskToSource(9) |
| `persist` (62) | persist(56), tieToDocs(56), tieTo(48), persistTokenPrototype(43), extraEndDuration(42), loops, endOnLastLoop |
| `style` (118) | **filterType(111) / filterData(111)**, blendMode(14), tint(11) |
| `sprite` (44) | anchor(40), randomizeMirrorY(30), anchorX(19), spriteAnchorX(17) |
| `rotation` (39) | randomRotation(33), rotate, spriteRotation |
| `timing` (32) | duration(21), playbackRate(13), startTime(5) |
| `layer` (19) | belowTokens(19), belowTiles(6), zIndex(4) |
| `play` (220) | **local(209)**, preload(135) |
| `massloop` (85) | sources, targets |

三个关键读数：

1. `play.local` 出现在 220 次中的 209 次 —— trove 的动画绝大多数是**各客户端本地播放**，
   不靠 socket 广播。独立印证了本设计的传输方案。
2. `aim.missed` 出现在 140 次瞄准中的 88 次 —— 未命中处理是常态，且应使用 Sequencer 的
   `.missed()` 而非自行计算偏移。
3. `style.filterType` 111 次 vs `style.tint` 11 次 —— 换色的主力手段是滤镜而非 tint。

采纳：完整字段 schema 作为 FXPlan 的字段清单、`.missed()`、本地播放。
不采纳：节点图编辑器。

### 3.3 Eskie Macros（`eskie-macros` 1.2.11）

`lib/filemanager.js` 的 `closest(path)` / `bestFit(prefix, ...categories)`：沿 Sequencer
数据库路径逐级下行，某一级不匹配就取该级第一个可用项并记 warning，继续往下走。**从构造上
不可能产出不存在的路径**。同时处理 Patreon / Free 版前缀切换与冲突警告。

原子特效模式：每个特效一个 `DEFAULT_CONFIG = {id, animations: {phase: {file, until}}, sound, ...}`，
`settingsOverride(config)` 允许用户覆盖，`foundry.utils.mergeObject` 合并。

时序技巧：`.waitUntilFinished(-2000)` 用**负值重叠**串接段落，这是流畅感的来源。

采纳：`bestFit()` 降级算法、配置对象 + 覆盖模式、负值重叠。
不采纳：showcase 的电影化编排。

### 3.4 PF2e Animation Macros（`pf2e-jb2a-macros` 2.21.0）

`autorec.json` 7 个分类：melee(221) / range(162) / ontoken(461) / templatefx(197) /
preset(1) / aura(0) / aefx(165)。`aefx` = 状态效果的持续特效，共 165 条——这提示了一个
独立于「动作」的触发链。

宏中的换色技巧：

```js
.filter("ColorMatrix", {hue: 50}, "light")
.loopProperty("effectFilters.light", "hue", {from: 0, to: 360, duration: 1500})
```

色相旋转解除了「符文颜色受限于素材实际有几个颜色变体」的约束。

63 个真实宏的 Sequencer API 使用频次（作为释放手法的基准）：

```
effect 298 | file 285 | atLocation 186 | scaleToObject 149 | fadeIn 141 | attachTo 137
fadeOut 136 | name 106 | origin 101 | filter 89 | tieToDocuments 89 | waitUntilFinished 83
persist 81 | play 74 | opacity 65 | stretchTo 52 | duration 45 | size 44 | scale 40
mask 38 | rotate 35 | belowTokens 35 | wait 34 | loopProperty 25 | tint 25 | zIndex 23
rotateTowards 22 | animateProperty 18 | repeats 14 | thenDo 12 | randomizeMirrorY 12
```

采纳：ColorMatrix 色相旋转、`softFail`、API 频次作为释放手法基准。
不采纳：AA 运行时（见 3.5）。

### 3.5 Automated Animations 为何不可用

`autoanimations` 7.0.22 的系统适配层只认 `pf2e / dnd5e / pf1 / sw5e / swade / a5e`，
代码中无任何 crucible 分支。其 AutoRec 自动识别与道具使用钩子对 crucible 全部失效，
仅剩手动逐条打 flag，而那条路同样依赖它没有的系统钩子。另有已知性能开销。
结论：AA 只作设计模板参考，不作运行时。

### 3.6 收敛性观察

blfx 的三槽（ON SOURCE / SOURCE→TARGET / ON TARGET）、trove 的 location + aim 分离、
crucible 原生的 S1–S4 声音分类法（charge / passive / damage / impact），三套独立系统
收敛到同一个「阶段化槽位」模型。本设计沿用该模型并补充两个不挂在动作上的槽（见 §6.3）。

## 4. 渲染层选型

| | v14 原生 VFX | Sequencer 4.2.3 | AA 7.0.22 |
| --- | --- | --- | --- |
| 视频精灵（.webm） | 无此组件 | 原生，每实例独立 video | 依赖 Sequencer |
| 同一 webm 并发播放 | `getTexture` 返回共享 BaseTexture，播放头冲突 | 已解决 | — |
| stretchTo / attachTo / rotateTowards / 遮罩 / persist | 需自行实现 | 内置 | 内置 |
| crucible 集成 | 白拿 | 需自接 | 不支持 crucible |
| JB2A/eskie/blfx 素材 | 需转图集 | DB 命名空间已注册 | 同 Sequencer |

**选型：Sequencer 作渲染器，crucible 的 action 生命周期作触发与传输通道。**

## 5. 架构

```
crucible-anim/
├── module.json                    无编译步骤，纯 ESM
├── scripts/
│   ├── main.mjs                   init / setup / ready 挂载与自检
│   ├── settings.mjs
│   ├── trigger/                   ← 懂 crucible，不懂 Sequencer
│   │   ├── wrap.mjs               CrucibleAction#configureVFXEffect 原型包装
│   │   ├── snapshot.mjs           CrucibleAction → ActionSnapshot
│   │   ├── effects.mjs            ActiveEffect 创建/删除 → persist 槽 / death 槽
│   │   └── dispatch.mjs           updateChatMessage → 播放
│   ├── resolver/                  ← 纯函数，可在 Node 中直接测试
│   │   ├── resolve.mjs            槽装配 + 优先级
│   │   ├── palette.mjs            符文/伤害类型 → 颜色 + 色相补偿
│   │   └── assets.mjs             bestFit 降级解析（离线索引 / 运行时 DB 双后端）
│   ├── armory/                    ← 纯数据 + 构建函数
│   │   ├── cast.mjs  travel.mjs  impact.mjs  aftermath.mjs  persist.mjs  death.mjs
│   └── player/
│       ├── play.mjs               FXPlan → Sequencer
│       └── semaphore.mjs          并发序列化
├── data/asset-index.json          离线提取产出
├── tools/
│   ├── extract-db.mjs             素材模组 DB 脚本 → asset-index.json
│   ├── dump-fixtures.mjs          leveldb → 测试 fixture
│   └── contact-sheet.sh           webm → 抽帧拼图（识图用）
├── test/
└── lang/{zh-CN,en}.json
```

依赖方向单向：`trigger → resolver → armory`、`player → resolver`。
`resolver` 与 `armory` 不 import 任何 Foundry / Sequencer 全局，因此可在 Node 中直测。

### 5.1 数据流

```
出手客户端                                     全体客户端
──────────────────────────────────────        ─────────────────────────────
CrucibleAction#configureVFXEffect()  ←wrap
  │
  ├─ 调用原生链 → vfxConfig
  │
  ├─ vfxConfig !== null → 原样返回，不插手 ┈┈▶ crucible 播放自己的原生 VFX
  │
  └─ vfxConfig === null
       ├─ snapshot(action)          纯数据快照
       ├─ resolve(snapshot)         → FXPlan（随机选材在此固化一次）
       └─ action.metadata.cav = FXPlan      // cav = crucible-anim vfx
                  │
                  ▼  _prepareMessage 将 metadata 序列化进 flags.crucible.metadata
             聊天卡广播
                  │                           Hooks.on("updateChatMessage")
                  └───────────────────────────▶ ├ flags.crucible.action ?
                                                 ├ data.flags.crucible.confirmed === true ?
                                                 ├ settings("crucible", "enableVFX") ?
                                                 ├ settings("crucible-anim", "enabled") ?
                                                 └ play(FXPlan) → Sequencer（本地）
```

### 5.2 为何包装原型而非注册 per-action hook

Crucible 提供两个扩展点：

- `crucible.api.hooks.action[actionId].configureVFX`
- `crucible.api.hooks.spellcraft[runeId|gestureId|inflectionId].configureVFX`

`CrucibleAction.#prepareHooks(actionId)` 在 Action 构造时读取前者并 `Object.freeze`，
按 action id 索引。要覆盖 218 个动作需先枚举全部 id，且动态合成的法术 id 不稳定。

原型包装只有一个切点，天然覆盖全部动作，且**运行在整条原生链之后**——这是能观察到
「原生最终返回 null」这一信号的唯一位置。

### 5.3 「只补空缺」的判定

Crucible 全部 gesture configurator 都以 `return null` 优雅退出：

- `configureArrowVFXEffect`：`target.type !== "single"` 或 `ARROW_VFX_PROPS[rune]` 不存在 → null
- `configureRay/Blast/FanVFXEffect`：模板形状不符或 rune 无配置 → null
- `configureContactVFXEffect`：同上
- `configureStrikeVFXEffect`：无 `projectile1/2` 武器致 timeline 为空 → null
- `configureSpellVFXEffect`：`hooks.configure === undefined`（11 个未实现姿态）→ 透传入参

因此 **「原生链最终返回 null」⟺「crucible 对此动作无动画」**。判定压缩为一个条件，
不需维护任何白名单，也不会随系统升级而失效（新增覆盖会自动让位）。

这条判定的源码依据（3 个 configureVFX 出口、三个 configurator 的全部 return 表达式、
7 个 configurator 的 early-return / continue 条件、17 个姿态里 0 个 `configure: null`、
五张 runes 表叉乘出的 24 个原生组合）由 `test/native-boundary.test.mjs` 逐项钉在
Crucible 源码上，上游漂移会先让测试变红。判据用**真值**而不是 `=== null`：第三方钩子
可能返回 `0`/`""`/`false`，而原生 `CrucibleChatMessage#_onUpdate` 的播放闸门同样是
`flags.vfxConfig` 真值判断，两边对「有没有动画」的结论因此恒等。唯一有意为之的例外是
**原生链抛异常**：包装体吞掉异常并照常接管（见 `trigger/wrap.mjs` 文件头）。

**FXPlan 的落库体积（Task 14 实测记录，V1 不做处理）**

用仓库全量 fixture（434 条计划）实测：均值 4048 字节、中位 2888、p90 7605、
最大 8656（`spell.control.fan`，9 cue）。也就是说带上 plan 大致把一张动作卡**翻一倍**。

三点让它停在「记录」而不是「处理」：

1. 不是正确性问题。序列化路径成立（`_prepareMessage` 的 `isEmpty(this.metadata)` 守卫在
   写了 `cav` 之后必然为假），与 Crucible 自用的 metadata 键无冲突，体积也远在 Foundry
   socket 上限之下。
2. 不存在「每次 update 重传」：`message.update()` 发的是差异不是整档，plan 只在建卡那一次
   过线。
3. plan 在动画播完后**并非无用**——它是 Task 15 重放菜单的唯一数据源。任何「播完就删」
   「定期清旧卡」的方案都是在删重放能力。

真要动的那天，第一步不是加体积上限（那会恰好砍掉最壮观的那几条法术），而是**剥默认值**：
值为 `null`/`false` 的键占了 cue 总字节的 **31.1%**，写入时剥掉、播放时按 `CUE_DEFAULTS`
回填即可白拿三成。唯一的坑：`play.mjs` 的 `cue.waitUntilFinished !== null` 与
`cue.elevation !== null` 是仅有的两处 null 敏感读取，`undefined !== null` 成立，必须走
回填而不是裸读。

重访触发条件：单条 plan 超过 20 KB，或世界 messages 库中 `cav` 占比超过 40%。

### 5.4 白拿的能力

| 能力 | 来源 |
| --- | --- |
| 撤销动作不播动画 | 闸门是 `confirmed` 翻 true，撤销走另一条路径 |
| 3D 骰子播完才播动画 | crucible 已在 `#autoConfirmMessage` 中 await 过 DSN |
| 关闭动画总开关 | 直接读取 `crucible / enableVFX` |
| 全场画面一致、不双播 | 随机选材、`randomRotation` 的角度、`randomizeMirrorY` 的镜像，全部在出手端摇定并写成具体数值进 FXPlan（`resolver/resolve.mjs` 的 `freezeRandom()`，走独立随机流 `ctx.rngAux`）；播放层不做任何随机，Sequencer 侧的 `.randomRotation()` 与 `.randomizeMirrorY()` 一律不用——它们分别用 CanvasEffect 的 twister（种子是 `creationTimestamp`，逐机不同）与裸 `Math.random()`，都在播放端求值。不使用 Sequencer socket。persist 槽同样本地播，但必须额外禁止 Sequencer 落盘，否则 N 个客户端写 N 条记录——见 §6.7 |
| 目标、结果、伤害数据 | crucible 的 `eventsByTarget` 事件流 |

## 6. 解析层

### 6.1 ActionSnapshot

`trigger/snapshot.mjs` 从 `CrucibleAction` 抽取纯数据。所有坐标在此固化为原始数值
（参考 eskie 的做法：不保留 `token.center` 的活引用）。

```js
{
  id, name, actorType,
  tags: [...],                              // 50 种，含伤害类型 / 技能 / 属性 / 移动
  target: {type, number, distance, scope},  // 12 种 TARGET_TYPES
  range: {minimum, maximum},
  cost:  {action, focus, heroism, health},
  spell: null | {rune, gesture, inflection},
  strikes: [{category, damageType}],        // 16 种 CATEGORIES
  region:  null | {type: "circle"|"cone"|"line", x, y, radius, angle, rotation, length, width},
  origin:  {tokenId, x, y, elevation, width, height, radiusPx},
  targets: [{
    tokenId, x, y, elevation, width, height, radiusPx,
    adjacent,                               // edgesIntersect(origin, target)
    onLeft,                                 // isTokenOnLeft(origin, target)
    results: [{result, critical}],          // 8 种 RESULT_TYPES
    damage:  {total, type, resource} | null,
    healed:  number,
    effects: [statusId, ...]
  }],
  usage: {damageType, isAttack, isRanged, skillId, resource},
  seed                                       // 固化随机数种子
}
```

### 6.2 FXPlan

字段清单对齐 trove 的节点 schema（§3.2），只保留 V1 需要的：

```js
{
  v: 1,
  seed,
  cues: [{
    slot: "cast" | "travel" | "impact" | "aftermath" | "persist",
    kind: "effect" | "sound" | "shake",
    layer?: "result" | "element" | "shake",  // impact 槽的分层标记，见 §6.5
    element?: string,                        // layer === "element" 时选中的伤害类型键（12 选 1）
    playIf: "always" | "hit" | "glance" | "armor" | "block" | "parry"
        | "resist" | "dodge" | "miss",
        // 与 AttackRoll.RESULT_TYPES 一一对应；见 §6.5。
        // **没有**聚合值（critical / hitOrGlance / defended）：cue 是针对**已发生的真实
        // 结果**构造出来的，没有东西可以聚合；播放层对词表外的取值一律 warn + 不播放。
    forTarget: tokenId|null,                // 注入字段：这条 cue「讲的是谁」（null = 不属于
                                            // 任何单个目标）。与 at 解耦——at 是「画在哪」
    file,                                   // 已经 bestFit 解析过的 DB 路径或绝对路径
    // 定位
    // ref 决定播放层的 resolveRef 允不允许把这个锚点换成一个真的 placeable：
    //   "origin" / "target" —— **身份**锚点。优先解析成 token（attachTo / copySprite
    //       必须拿到真 placeable），解析不到才退回 x/y 裸点。锚点必须自带
    //       tokenId/uuid/x/y，裸 {ref:"origin"} 在播放层解不出任何位置。
    //   "point" —— **冻结坐标**。永远原样返回 {x,y}，绝不升格成 placeable。
    //       模板类锚点（travel 的 ray/cone 锥尖、aftermath 的区域残留）必须用它：
    //       这些 cue 的 stretchTo 终点与 mask 都取自 plan.region，起点一旦被换成
    //       施法者 token 中心，起点/终点/遮罩就来自两套原点，几何自相矛盾。
    at: {ref: "origin"|"target"|"point", tokenId?, uuid?, x?, y?},
    attachTo: bool, bindScale: bool, local: bool,
    aim: null | {towards: {...}, missed: bool, offset?, rotationOffset?},
    stretchTo: null | {...},
    offset: {x, y}, gridUnits: bool,
    // 外观
    objectScale: number, scale: number|{x,y},
    mirrorY: bool, randomizeMirrorY: bool, randomRotation: bool,
    filter: null | {type: "ColorMatrix", data: {hue, saturate, contrast}},
    tint: null,
    opacity, fadeIn, fadeOut, fadeInEase, fadeOutEase,
    belowTokens: bool, zIndex: number, elevation: number|null,
    mask: null | "region",
    // 时序
    // startTime / duration 都相对**素材自身第 0 帧**，duration 是「startTime 之后**还要
    // 播多久**」而不是绝对终点（权威定义见 resolver/resolve.mjs 的 CUE_DEFAULTS.duration）。
    // 这与 Sequencer EffectSection.duration() 的表面行为相反，换算集中在
    // player/play.mjs 的 applyTimeWindow()（下发 .timeRange(s, s+d) + .duration(d)）。
    delay, duration, playbackRate, startTime,
    waitUntilFinished: number|null,         // 负值 = 重叠
    // 持久化（仅 persist 槽）
    persist: bool, tieTo: uuid|null, extraEndDuration: number,
    worldPersist: false,                    // 恒为 false，见 §6.7
    // 声音专用
    volume: number
  }]
}
```

### 6.3 六槽

| 槽 | 时刻 | 锚点 | 主决定维度 | 对应 |
| --- | --- | --- | --- | --- |
| **S1 `cast`** | t = 0 | 施法者 | 动作性质（标签类别） | blfx 槽 1 / crucible S1 charge |
| **S2 `travel`** | cast 末 | 施法者 → 目标 / 模板 | `target.type` | blfx 槽 2 / crucible S2 |
| **S3 `impact`** | travel 末，每目标一次 | 目标 | 攻击结果 + 伤害类型 | blfx 槽 3 / crucible S4 impact |
| **S4 `aftermath`** | impact 后 | 目标 / 地面 | 效果与资源变化 | — |
| **S5 `persist`** | ActiveEffect 创建 → 删除 | 目标 | 状态 id | AA `aefx` / trove Conditions |
| **S6 `death`** | `dead` 落地那一次 | 目标脚下 | 有没有死 | — |

**S5 / S6 都不挂在动作上**，由 ActiveEffect 的钩子独立驱动，共用同一份
`EffectSnapshot`（`resolveEffect(snapshot, deps, slot)`）：

* S5 由 `createActiveEffect` / `deleteActiveEffect` 成对驱动，cue 用
  `.persist().tieToDocuments(effect)`，效果移除时动画自动清理；
* S6 **只**由 `createActiveEffect` 驱动，产出一次性 cue（不 persist、无 tieTo、
  没有「结束」语义），并且绝不能接到 `resyncPersist` / `createToken` 上——那两条是
  「把该有的稳态补齐」，接上去等于每次切场景、每具尸体都重放一遍击杀爆发。
  它之所以不能留在 S4：S4 的快照冻结于**建卡时刻**（`configureVFXEffect()` 在
  `_prepareMessage()` 里跑），那一刻伤害还没结算，死亡信息不存在；`dead` 是 Crucible
  在资源结算之后单独 `toggleStatusEffect("dead", …)` 打上的。完整依据见
  `scripts/armory/death.mjs` 的文件头。

每槽独立解析一次，各约 10 条规则。40–50 条规则组合出的空间足以覆盖全部动作，
这是「一套规则盖住 218 个动作」的机制。

### 6.4 六级优先级

规则形如 `{id, pri, once?, when(s), build(s, ctx, target, built)}`，槽内按 `pri` 降序取第一个 `when` 为真者；
`once: true` 表示这条规则每个动作只调一次 `build`（默认锚在施法者，代表目标为 `targets[0] ?? null`，
零目标时照样出内容），不置位则每个目标各调一次并锚在该目标。区域与自身特效用前者，投射物与近战用后者；
两种都可以在返回的 cue 里自带 `at` 覆盖默认锚点（模板类特效就靠这一条把锚点摆回模板起点）。
第四个形参 `built` 是同一目标可见的前序槽 cue（按槽名索引），用于「素材自带闪爆时后面的槽让位」
这类交接，见 `scripts/armory/flash.mjs`。


| pri | 层级 | 例 |
| --- | --- | --- |
| 900+ | 单动作专属覆盖 | `action:sunder`、`spell:death.arrow` |
| 700–899 | 法术 gesture | `gesture:cone`、`gesture:ward`、`gesture:conjure` |
| 500–699 | 武器类别（16 种） | `strike:heavy2`、`strike:unarmed`、`strike:shieldHeavy` |
| 300–499 | 语义标签 | `tag:healing`、`tag:rallying`、`tag:movement`、`tag:skill` |
| 100–299 | 形状兜底（12 种） | `target:blast`、`target:ray`、`target:aura` |
| 0–99 | **终极兜底** | `generic.cast` / `generic.impact` |

最低档必须存在且必然命中。这是覆盖率 100% 的保证，也是测试的第一条断言。
`build()` 返回 `null` 表示该槽此次不出内容（合法，例如重武器不需要 cast 段）。

`ctx` 是注入 `build()` 的能力袋，由 `resolver` 构造，不含任何 Foundry 全局：

| 成员 | 作用 |
| --- | --- |
| `ctx.pick(dbPath, {color, variant, size})` | 经 §7.2 的 bestFit 解析出可用 DB 路径；目标色不可得时返回最近色并附带需要的色相偏移量 |
| `ctx.runeColor(s)` / `ctx.damageColor(s)` | 查 §6.6 的两张色表 |
| `ctx.sound(type, key)` | 同 `pick`，走音效命名空间 |
| `ctx.rng()` | 由 `snapshot.seed` 驱动的确定性随机，保证全场一致与测试可复现 |
| `ctx.geom` | §8.2 的几何修正（贴身判定、大体型补偿、镜像朝向） |

### 6.5 impact 是叠加的，不是穷举的

8 种攻击结果 × 12 种伤害类型 = 96 组合，但两者分层叠加，不需 96 条规则：

```
impact = 结果层（8 选 1，与元素无关） + 元素层（仅命中类叠加，12 选 1）
```

| result | 结果层 | 叠元素层 |
| --- | --- | --- |
| `HIT` (7) | 完整冲击 | 是 |
| `GLANCE` (6) | 同上 scale ×0.6，不震屏 | 是 |
| `ARMOR` (4) | 金属刮擦火花 | 否 |
| `BLOCK` (3) | 盾牌闪光 + 冲击环 | 否 |
| `PARRY` (2) | 兵器交击火花 | 否 |
| `RESIST` (5) | 抗性辉光，特效被吞 | 否 |
| `DODGE` (1) | `.missed()` 偏移落空 + 残影 | 否 |
| `MISS` (0) | `.missed()` 落空，无 impact | 否 |
| `critical` | 追加一层 + 抖动 + 加重音效 | — |

条件以 `playIf` 声明式字段承载（学自 blfx），动画 / 声音 / 抖动各有各的条件，
播放层始终构造完整序列，只是各 cue 条件播放。

### 6.6 调色

两张色表 `RUNE_COLOR`（12 符文）与 `DAMAGE_COLOR`（12 伤害类型）映射到颜色名。
取素材时经 `bestFit` 降级；若目标色不在该特效的可用色中，取最近色并附加
ColorMatrix 色相旋转补足差值（学自 pf2e-jb2a-macros）。

物理伤害（bludgeoning / piercing / slashing）不走颜色，走血迹 / 火花素材。

### 6.7 persist 为何不落 Sequencer 的盘

`persist` 是全部槽里唯一会让 Sequencer 往世界写数据的开关，而本模组的传输模型是
「各客户端本地播同一份 plan」（§5.1 / §5.4）。两者相乘的后果是 N 个在线客户端把同一个
状态写成 N 条记录：Sequencer 4.2.3 的落盘判据

```js
if (data.persist && setFlags && effect.context && effect.owner
    && !effect.isSourceTemporary && !data.temporary && !data.remote) {
  flagManager.addFlags(effect.context.uuid, {effects: effect.data});
}
```

**没有 `!data.local` 子句**——`.locally()` 只把 `_users` 置成 `[me]` 从而让 push 为 false，
拦得住 socket，拦不住写盘；`effect.owner` 判的是 `creatorUserId === game.user.id`，各客户端
都是自己那份的 creator；去重键 `_id` 是 `randomID()`，不会合并。记录经
`executeAsMainUser` 由 GM 落进隐藏 JournalEntry `sequencerDatabase` 的
`flags.sequencer.effects`（**不在 token 的 flag 上**，验收时别找错地方）。重载时
`initializePersistentEffects()` 回放全部记录，而 `shouldPlay` 的用户过滤以
`game.user.isGM ||` 开头——GM 绕过过滤，N 份全播，光环层层叠加；反过来中途进场的玩家
一条属于自己的记录都没有，一个光环都看不到。

因此 FXPlan 的 `worldPersist` 恒为 `false`，播放层据此调 `.temporary(true)`（Sequencer 文档：
「will not be stored in the flags of any object, even if .persist() is called」）。
`.persist()` 的无限循环与 `tieToDocuments` 的自动清理都不受影响。

对价是重载/入场时的重建改由本模组承担（Task 15 的 `resyncPersist`）。这不只是补偿，
反而更强：真相是 ActiveEffect 文档本身，从它重新推导就不存在「flag 日志与文档不同步」，
也不需要任何 GM 在线，中途进场的玩家照样能补齐全场光环——靠 Sequencer 的 flag 回放
做不到这一条，因为记录全都属于别人。

已知代价：`data.temporary && effect.owner` 会让 Sequencer 挂一个逐帧 ticker 广播 source
位置，各客户端都是自己那份的 owner，于是 token 移动时有 N 倍冗余的
`UPDATE_EFFECT_POSITION`。必须在 Task 16 实测其开销。

## 7. 素材层

### 7.1 离线索引

素材模组的 Sequencer 数据库定义在各自的注册脚本里，可在 Node 中直接提取
（已验证）：

```js
const mod = await import("modules/jb2a_patreon/scripts/jb2a_sequencer.js");
await mod.jb2aPatreonDatabase("modules");
// mod.patreonDatabase → 209 顶级命名空间 / 4117 中间节点 / 10038 叶子条目 / 12105 个文件引用
```

产出的是 Sequencer 在游戏内构建的同一棵树，不是文件名猜测。索引条目记录：

- DB 路径 → 文件路径（9061 个单文件叶子）或变体数组（977 个，内含 3044 个文件，Sequencer 随机取一）
- `_template` 引用（144 处，如 `melee: [200, 300, 300]` = 授权网格 200px、
  前导 300px、拖尾 300px），这是 `stretchTo` 的锚点元数据
- 从文件名解析的尺寸（`_800x600`）、色调（`Regular` / `Dark`）、颜色、变体序号
- `_metadata.name`

同法处理 `eskie-effects`、`blfx-assets-pack01`、`boss-loot-assets-*`、`psfx-patreon`、
`soundfxlibrary`、`animated-spell-effects-cartoon`。

### 7.2 bestFit 降级解析

`resolver/assets.mjs` 实现与 eskie `filemanager.js` 相同的逐级降级算法，
支持两个后端：

- **离线后端**：读 `data/asset-index.json`，供 Node 测试使用
- **运行时后端**：查 `Sequencer.Database.getPathsUnder()`，供游戏内使用

同一份算法 + 同源数据，测试与运行时因此天然一致。降级时记 warning。

### 7.3 识图

`_metadata` 只携带 `name`，不含锚点、方向、时长、相位结构。文件名同样不足以判断：
`Club01_01_Regular_Blue_800x600.webm` 实测为「起手 → 挥砍弧光 → 命中闪爆 → 收招」
的完整 66 帧序列，锚点在攻击者、朝向目标——这些只能看出来。

因此实现阶段需对**每个进入兵库的候选素材**做一次抽帧拼图并人工（模型）读图，记录：

- 相位结构（单段 / intro-loop-outro / 起手-挥击-收招）
- 锚点位置与朝向
- 帧数与时长（30fps）
- 是否需要 `stretchTo` / `mirrorY` / `randomRotation`

工具：`tools/contact-sheet.sh <webm> <out.png> [cols] [rows]`，用 ffmpeg 均匀抽帧后
`tile` 拼图（默认解码器输出黑底，JB2A 亮色特效在黑底上可读性良好）。

预算：候选素材约 60–120 个，逐个读图。这是 V1 实现中不可省略也不可自动化的一步。

### 7.4 素材路径策略

自用形态，硬绑本机已装素材：`jb2a.*`、`eskie.*`、`blfx.*`、`psfx.*`。
兵库规则中**不出现绝对路径**，全部经 `ctx.pick()` 走 bestFit。
`main.mjs` 在 ready 时检测各素材模组是否激活，缺失则记 warning（不阻断）。

## 8. 渲染层

### 8.1 释放手法规范

以 63 个真实宏的使用频次（§3.4）为基准，规定 player 层的默认行为：

| 规范 | 依据 |
| --- | --- |
| 缩放一律用 `scaleToObject()`，不用绝对 `scale()` | 149 次 vs 40 次 |
| 每个 effect 默认带 `fadeIn` / `fadeOut` | 141 / 136 次，避免硬切 |
| 需跟随目标时用 `attachTo()` | 137 次；trove 中 230/335 的定位节点使用 |
| 换色用 `filter("ColorMatrix")`，不用 `tint` | trove 111 次 vs 11 次 |
| 段落串接用 `waitUntilFinished(负值)` 重叠 | eskie / blfx 一致做法 |
| 线 / 锥贴合模板用 `stretchTo()` + `mask(region)` | 52 / 38 次 |
| 地面层特效 `belowTokens()` | 35 次 |
| 重复播放加 `randomizeMirrorY()` / `randomRotation` | 12 / 33 次 |
| 未命中用 `.missed()`，不自行计算偏移 | trove 88/140 |
| 整条序列用 `new Sequence({moduleName: "crucible-anim", softFail: true})` | 素材缺失时静默跳过 |
| 条件用 `.playIf()`，不在 JS 中分支 | blfx；序列结构保持稳定可预测 |

### 8.2 从 blfx 学到的几何修正

1. **贴身 vs 隔格**：`snapshot.targets[].adjacent`（源自 `edgesIntersect`）为真时用近距素材，
   否则用远距变体。近战特效长度必须匹配实际距离。
2. **大体型补偿**：`origin.width > 1` 时 scale ×1.4；offset 按 `width` 折半
   （非贴身时 `width * OFFSET / 2`，贴身时 `width * OFFSET`）。
3. **镜像朝向**：`mirrorY(target.onLeft)`，否则武器反手挥。
4. **抖动**：`copySprite(targetToken)` + `loopProperty('sprite', 'position.x',
   {from: -i, to: i, duration: 60, pingPong: true})`，只抖目标 sprite，不抖全屏。
5. **高程**：`elevation(target.elevation, {absolute: true})`；zIndex 分层 100 / 50 / 0。

### 8.3 并发控制

`player/semaphore.mjs`：多个**动作**接连确认时（例如连续反击、多目标群体动作），
以信号量串行化播放，避免动画叠乱。学自 blfx 的 `getSemaphore / waitForSemaphore /
cleanupSemaphore`。超时上限保证不会因异常而永久阻塞。

**persist 槽不进这条队列**，走 `trigger/dispatch.mjs` 的 `runPersistAnimation()`：

1. 持久光环在 Sequencer 里没有「播完」这个时刻——`EffectSection.run()` 对 `_persist`
   等的是只有 `endEffect()` 才兑现的 finishPromise，塞进串行队列会把队列顶死到
   超时（15 秒）为止。`playPlan()` 因此对带 persist cue 的计划**提前返回**：它的
   promise 只代表「序列已交给 Sequencer」，不代表画面结束。
2. 光环是稳态标记，多个状态同时上身本就该同时出现，串行是错的；Sequencer 自己
   对并发持久特效毫无串行化。

反过来，Crucible 的 `confirm()` 先落地 ActiveEffect、后翻 confirmed，状态动画的触发
天然早于造成它的动作动画。所以 persist 通道在播出前做两段**有界**等待：
`whenBusy(PERSIST_LEAD_MS)` 等那条动作动画入队，`whenIdle()` 等它播完；两段都超时
就直接播出（最坏退回「光环略早于挥剑」，即修复前的表现）。播出前另有一道
`fromUuidSync(effect.uuid)` 存活闸——让路期间状态若已被移除，此刻再播出的持久特效
两条清理链路都失效，会永久残留。

## 9. 设置项

world scope，仅 GM 可改：

| key | 默认 | 作用 |
| --- | --- | --- |
| `enabled` | true | 本模组总开关；另外**始终**尊重 `crucible / enableVFX` |
| `density` | `standard` | `minimal` / `standard` / `full`。V1 只实现 `standard`（克制尺度） |
| `volume` | 0.7 | 本模组音效独立音量 |
| `shake` | true | 是否启用目标抖动 |
| `debug` | false | 控制台打印 ActionSnapshot 与 FXPlan，并输出 bestFit 降级 warning |

另加聊天卡右键**重放**菜单项：crucible 自带那个的出现条件是 `flags.vfxConfig`，
本模组的动作无此 flag，需自行注册一条（条件为 `flags.crucible.metadata.cav`）。

本地化：`lang/zh-CN.json`（主）与 `lang/en.json`。

## 10. 测试与验证

### 10.1 headless 可测部分（解析层）

`tools/dump-fixtures.mjs` 用 `classic-level` 直读 leveldb（已验证可行），
从真实内容生成 fixture：

```
crucible/packs/talent              131 个动作
crucible/packs/adversary-talents    46
crucible/packs/spell                15
ember/packs/crucible-adversary      26
DEFAULT_ACTIONS                     13
合成法术 12 符文 × 17 姿态         204
                                  ─────
                                   435 个基础 fixture
        × 8 种攻击结果参数化     ≈ 1500+ 断言样本
```

断言：

| 断言 | 防范 |
| --- | --- |
| **覆盖率**：每个 fixture 至少解析出 1 个非空 cue | 黑屏动作 |
| **路径存在性**：每个 `file` 能在 asset-index 中查到，且磁盘文件真实存在 | 拼错路径 |
| **优先级**：指定 fixture 命中指定 rule id | 通用规则截胡专属规则 |
| **确定性**：同 snapshot + 同 seed → 同 FXPlan | 全场画面不一致 |
| **数值卫生**：坐标 / 缩放 / 时长非 NaN、非 undefined、非负 | 运行时崩溃 |
| **降级可见**：bestFit 降级次数不超过阈值 | 悄悄退化成错误素材 |

### 10.2 需人工验收部分（渲染层）

`/canim-preview` 宏：对选中 token 依次播放 N 个 FXPlan，无需真实战斗即可过一遍全部配方。
这是 Foundry 侧唯一必须人工观看的环节。

### 10.3 识图验收

每个进入兵库的素材需有对应的抽帧拼图记录（§7.3），确认相位结构与锚点判断正确。

## 11. 风险与降级

| 风险 | 处理 |
| --- | --- |
| crucible 0.10.2 迭代快，`configureVFXEffect` 签名或 `metadata` 序列化行为可能变 | 包装体整体 try/catch，出错静默走原生路径，绝不阻断出手；`main.mjs` 启动时检测 `crucible.api.models.CrucibleAction.prototype.configureVFXEffect` 存在性，缺失则 UI 报警并自我禁用 |
| `action.metadata` 是系统自由字段（`amplifyAffix` 已在用 `metadata.amplify`），存在撞名可能 | 命名空间收敛到 `metadata.cav` 单键；撞名风险实际接近零。备选方案：`preCreateChatMessage` + `CrucibleAction.fromChatMessage` 重建（更解耦，但需多一次反序列化且拿不到活的 `eventsByTarget`） |
| 素材模组更名 / 未装 / 路径变动 | `softFail: true` + bestFit 降级 + ready 时依赖检测 warning |
| 大量目标时动画风暴 | 并发信号量串行化；`density` 设置项；`massloop` 上限 |
| 上游后续补齐了某个姿态 / 符文的原生 VFX | 「原生返回 null」判定自动让位，无需改代码 |

## 12. V1 交付定义

1. 模组可加载，自检通过，不影响任何现有功能（关闭时零副作用）
2. `tools/extract-db.mjs` 产出 `data/asset-index.json`
3. 分槽兵库，40–50 条规则，覆盖：11 个缺失姿态、8 个缺失符文、全部近战武器类别、
   13 个默认动作中有动画价值的部分、状态效果持续特效
4. headless 测试全绿，1500+ 断言样本
5. `/canim-preview` 宏可用
6. 中英双语
7. 每个兵库素材有识图记录
