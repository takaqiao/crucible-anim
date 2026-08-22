# Task 13 修复落地报告：播放层 stretchTo 冲突、时间窗语义与瞄准锚点

基线 `31ab52c`（206/206）→ 本次提交。`npm test` **255 pass / 0 fail / 0 skipped**（4.7s）。

---

## 0. 一句话结论

四组规格全部落地，其中 **anchor-aim 组的核心前提被我的实测推翻并修正**（见 §4.1），
**time-semantics 选 (A)**（不动兵库常量），**residual 的 3 条被驳回或降级**（见 §5）。
另外我在四组之外**补了一条 Critical**：`resolve.mjs` 的施法者默认锚点从裸 `{ref:"origin"}`
改成自带 tokenId/uuid/x/y（§3.5）——四组规格里三组都在 risks 里指着它说「归别人管」，
而合起来看没有人管，不修则 434 条 cast cue 在 Task 14 落地当天会被整槽静默吞掉。

---

## 1. 合并顺序与冲突取舍

四组同时改 `play.mjs` 里挨在一起的三段链式调用。我没有按组分四次改，而是**一次重写整个
`playPlan` 循环体**，逐段裁决：

| 代码段 | 争用的组 | 取舍 |
| --- | --- | --- |
| `if (cue.aim) { … }` | sequence-hang（只排除 stretchTo）/ anchor-aim（排除 stretchTo **且**排除退化同点，另配 `anchor`） | **取 anchor-aim**：它的判据严格包含 sequence-hang 的。sequence-hang 版会放过 1008 条「瞄准点就是锚点本身」的命中反馈，那批 cue 的 `pivot.set(-w/2,0)` 位移与光束那条是同一个 bug、同一处代码 |
| `if (cue.scale) … else …` | sequence-hang | 取 sequence-hang 的 `else if (!cue.stretchTo)`。与 aim 段无冲突（一个改 aim 块、一个改 scale 块） |
| `.startTime()` / `.duration()` | time-semantics | 抽成 `applyTimeWindow()`，effect 与 sound 共用，shake 分支**刻意不用**（copySprite 无 media，`mediaDurationMs` 为 0，走 timeRange 会把 clamp 上限变成 0） |
| `try/catch` 的 section 引用 | sequence-hang（`dropSection`）/ residual（sound 提到 resolveRef 之前） | 两条都要，且互相牵制：sound 提前之后 `section` 变量必须在**三个分支之前**声明。另外我把 `attachTo`/`shake` 的 `!isPlaceable → continue` **提到 `seq.effect()` 之前**——原写法建完 section 再 continue，那是 `dropSection` 管不到的第二条泄漏路径，三组规格都没提到 |
| `aim.fromAnchor` 新字段 | anchor-aim | **不采纳**，见 §5.2 |

组间还有一处**数据层**冲突，四组各说了一半：

- anchor-aim 要把飞行物 `at` 搬到施法者（`ref:"origin"` + tokenId）；
- residual 要把模板/区域锚点改成 `ref:"point"`（防止将来「裸 origin → 施法者 token」的兜底
  把冻结坐标一起换掉）；
- 我补的 `resolve.mjs` 默认锚点自带身份，恰好就是 residual 担心的那个兜底。

三者必须同批：只落 anchor-aim 会打断三处「按 `at.tokenId` 反推目标归属」的测试；只落
`ref:"point"` 没有意义；只落默认锚点会让 ray/cone/groundResidue 的起点、`stretchTo` 终点、
`mask` 来自两套原点。落地顺序在同一次提交里，靠 `forTarget` 注入字段把「讲的是谁」与
「画在哪」彻底解耦。

---

## 2. 我自己去 Sequencer 源码复核的结论

全部对 `/root/fvtt14-data/Data/modules/sequencer/dist/sequencer.js`（4.2.3，30999 行）
逐段 `sed -n` 打开确认，不靠转述。**规格里被我验伪或修正的有 4 条**（★）。

### 2.1 验证成立的判据

| 判据 | 位置 | 结论 |
| --- | --- | --- |
| `stretchTo + scaleToObject` 直接 throw | `_expressWarnings` 24917-24923 | ✅ 原文 "while scaling to fit another??? Make up your mind!" |
| 抛点在 `run()` 内、`_execute()` 的 `new Promise(async r => setTimeout(async …))` executor 里 | 25003 / 21506-21538 | ✅ resolve() 在 `await this.run()` 之后，rejection 不会 reject 外层 Promise |
| `stretchTo` 下 `scaleToObject` 是死代码 | `_transformSprite` 17080-17085，唯一消费点 `_transformNoStretchSprite`→`_applyScaleToObject` 17114/17171 | ✅ 删它零损失 |
| `_applyDistanceScaling` 自己就 `_rotateTowards(ray)` | 16992-16994 | ✅ |
| `_target` 取值器把 stretchTo 排在 rotateTowards 前 | 23184-23186 | ✅ rotateTowards 给的位置进不了 `data.target` |
| `_setAnchors` 的 `pivot.set(width*-0.5, 0)` 与 `!data.anchor` 判据 | 17020-17041 | ✅ `interpolate(-w/2, w/2, 0.5)=0`（`interpolate` 定义 328-331） |
| `_getOffset` 的 `missed && (!source2 \|\| !data.target)` | 15360 | ✅ 所以 rotateTowards + missed 会让偏移失效 |
| 时间窗口：`_animationDuration = data.duration \|\| mediaDurationMs` → `clamp(endTimeMs-startTimeMs, 0, _animationDuration)` | 16052 / 16097 / 16102 / 16106 | ✅ `.startTime(234).duration(266)` 实播 32ms |
| `timeRange` 是唯一置 `_isRange = true` 的入口，其余四个方法都显式置 false | 22490-22578 | ✅ |
| SoundSection 的 `duration = data.duration === false ? endTime-startTime : data.duration` | 10387 | ✅ 与 EffectSection **相反**，是选 (A) 的硬理由 |
| 零长拉伸：`_updateCurrentFilePath` 报红 + `spriteScale = 0/W = 0` → `sprite.scale.set(0,0)` | 16235-16255（由 `_initialize` 15629 以 `showDistanceWarning=true` 调用）/ 16966-16985 / 17014-17017 | ✅ |
| 裸文件路径走 `SequencerFilePlain`，仍 `instanceof SequencerFileBase` | 6363-6399 | ✅ 距离缩放照常生效，只是 padding 按 0 算 |
| `Sequence.effect()/sound()` 先 push 再 return；`sections` 是普通数组 | 27890-27905 / 27726 | ✅ `dropSection` 的前提成立 |
| `atLocation` 的 `gridUnits` 只在 `if (inOptions.offset)` 里转交 | 22787-22845 | ✅ 空转，已删 |
| `_filterEffects` 的 name 与 origin 是 AND；`endEffects(f, push=true)` 默认走 socket | 11694-11703 / 11626-11639 | ✅ |
| `CanvasEffect.shouldPlay` 第三子句 `(!data.local \|\| creatorUserId === game.user.id)` | 15145 | ✅ 「GM 重载叠 N 层」的说法确实不成立 |

### 2.2 ★ 规格本身的错误 / 需要修正的表述

1. **★「不带 waitUntilFinished 也一样挂死」是过强的**（sequence-hang §1）。
   `_shouldAsync = _async \|\| _waitAnyway`（21235-21249）：一条**既不是最后一条、也没有
   waitUntilFinished** 的 section，`run()` 是 `this.run()` 而不是 `await this.run()`，
   rejection 变成 unhandled rejection，`resolve()` 照样执行、`_execute()` 正常 settle。
   真正必然挂死的是两类：(a) 带 `waitUntilFinished` 的 section（`Sequence.play()` 27772
   `promises.push(await section._execute())`）；(b) **最后一条 section**——`_waitAnyway`
   含 `_isLastRepetition && _isLastSection`，恒为真。
   **结论不变**（V1 的 travel cue 全都带 `waitUntilFinished: -300/-750/-1200`，且
   `Promise.allSettled` 对不 settle 的 promise 同样永不返回），但注释与测试失败信息我按
   这条更准确的论证重写了，没有照抄「不带 waitUntilFinished 也一样」。

2. **★ anchor-aim 组的核心前提「不存在 towards 与 at 不同点的 cue」在修好锚点之后就不成立了。**
   实测（全量 fixture）：修锚点**前** aim cue 1232 条、同点 1232、异点 0；修锚点**后**
   同点 1008、**异点 224**（正是三条飞行物规则）。也就是说「按同点 / 异点二选一」这个判据
   单独用会在锚点修好的同一刻失效——必须**两条排除并列**（带 stretchTo 一律不调 + 同点不调），
   缺任何一条都会有 cue 漏网。这一点规格给对了做法、给错了理由，我按实测重写了注释。

3. **★ residual r2#6「`.temporary()` 必须排在 `.tieToDocuments()` 之前」不成立。**
   `temporary(inBool)` 是 `this._temporaryEffect = inBool || this._temporaryEffect`（23255，
   sticky-OR），`tieToDocuments`（24689-24723）根本不碰 `_temporaryEffect`，两者顺序无关。
   现有代码本来就是这个顺序，我**没有**按规格加那条顺序断言——那会写下一条假契约。

4. **★ residual 引用的 `_playEffect 11819 落盘判据「无 !data.local 子句」** 我逐字核对过，
   成立；但同一段里 residual 说「r3#7 plan.warnings 全仓库零消费者」不准确这一点我采纳了，
   注释改成「零**运行时**消费者」。

另外顺手核实了一条三组都没提、但会影响 `dropSection` 正确性的细节：
`sequence_proxy_wrap`（528-546）的 get 陷阱对 `sections`（实例属性、不在原型上）会先探最后
一条 section 的原型、再 `Reflect.get(target, "sections")` 返回真数组——`splice` 改的是真数组。
`EffectSection` 及其 traits 都没有 `sections` 成员（已 grep 确认）。这条写进了注释。

---

## 3. 四组各落地了什么

### 3.1 sequence-hang
- `play.mjs`：`if (cue.scale) e.scale(...) else if (!cue.stretchTo) e.scaleToObject(...)`。
- `play.mjs`：新增 `dropSection(seq, section)`，`catch` 里把半成品 section
  `lastIndexOf`+`splice` 撤下来，撤不掉时 `playIf(false)` 兜底。
- `play.mjs`：`section` 引用提到 `try` 之外；`attachTo`/`shake` 的 placeable 判断提到
  `seq.effect()` **之前**（规格没提的第二条泄漏路径）。
- 「rotateTowards 与 Critical-1 同批」的要求由 anchor-aim 的版本满足。
- **未采纳**：`.template()` 补 padding（§5.1）。

### 3.2 time-semantics
- **选 (A)**：兵库语义不动一个数字，换算集中在 `play.mjs` 的 `applyTimeWindow()`：
  `startTime>0 && duration!==null` → `.timeRange(s, s+d).duration(d)`；只给一个时保持原样。
- 保留 `.duration(d)`（规格在评审建议之外加的一笔，我采纳）：它把 16106 的 clamp 上限钉死，
  播出时长不依赖 `mediaDurationMs`。代价是 `s+d > 素材总长` 时从「截到素材末尾」变成
  「定格末帧硬撑」——由新增的兵库守卫（§3.6）防这个笔误。
- 注释：`CUE_DEFAULTS.duration` 成为唯一权威定义，`impact.mjs` / `travel.mjs`(ray) /
  `DESIGN.md` 三处改成引用它并写明「与 Sequencer 表面行为相反」。
- **未采纳方案 (B)**（改兵库为绝对终点）：会让同一字段在 effect 与 sound 上含义相反
  （sequencer.js:10387），并要重算 impact 10 处 / travel 4 处 / cast 2 处常量、同步改
  `flash.mjs` 的 `trimFlash` 与 `armory-impact.test.mjs` 的 fade 预算。ASSET-NOTES 对 ARMOR
  原文写的 `endTime≈f22（733ms）` 恰好 = 467+266，与 (A) 口径逐字吻合。

### 3.3 anchor-aim
- `play.mjs`：新增 `pointOf()`（**优先取 `center`**）/ `samePoint()`（1px 容差）；
  `rotates = !stretchTo && atPoint && aimPoint && !samePoint(...)`；真转向时配
  `e.anchor({x:0.5,y:0.5})`；转向 + missed 留 warn；stretchTo + 非零 rotationOffset 留 warn；
  `.missed()` 任何情形下都单独调。
- `travel.mjs`：新增 `originAnchor(s)`，给 `spell.gesture.arrow` / `strike.thrown` /
  `generic.travel` 三条飞行物规则加 `at:`——**修掉零长拉伸这条新 Critical**。
- `resolve.mjs` + `impact.mjs`：注入字段 `forTarget`（"讲的是谁"），与 `at`（"画在哪"）解耦。
  `impact.layered` 是 `once` 规则却自己按目标铺开，三处 push 各补 `forTarget`。
- 三处按 `at.tokenId` 反推目标归属的测试改读 `forTarget`。

### 3.4 residual-findings
- `play.mjs`：`kind:"sound"` 分支提到 `resolveRef` 之前（声音不该被"目标还在不在画布上"拦下）；
  shake 分支 `.zIndex(cue.zIndex)` + `.locally(cue.local)`；`atLocation` 去掉空转的
  `{gridUnits}`；`PLAY_IF_VALUES` 删掉三个聚合值；`plan===null` 那段注释把「触发层已记」
  改回「应当记」。
- `impact.mjs`：shake cue 显式 `zIndex: 0`（渲染逐像素不变）。
- `semaphore.mjs`：`TIMED_OUT` 哨兵 + 超时 warn + `clearTimeout` + 默认 8000→15000。
- `resolve.mjs`：`worldPersist` 注释纠偏（损害是世界存档脏数据与他人不可见，**不是**叠 N 层）。
- `travel.mjs` `templateAnchor` / `aftermath.mjs` `residueAnchor` → `ref:"point"`。
- `armory-persist.test.mjs`：删掉 `existsSync` 自我 skip（改成硬失败）；新增仓库级 socket
  政策扫描（含 `end(All)Effects` 必须显式 `push=false` 的行扫描）；target.uuid 对称自检。
- `tools/dump-fixtures.mjs` + 两份 fixture：token 几何补 `uuid`（1122 处）。
- `task-15-brief.md`：兜底清理改成 `endEffects({origin: effect.uuid}, false)`。
- `DESIGN.md` §6.2：playIf 词表、`at.ref` 词表（origin/target/**point**）+ uuid 字段、
  `forTarget`、时间窗口口径。

### 3.5 四组之外我补的一条（Critical）
`resolve.mjs` 新增 `originAnchor(snapshot)`，cast 槽与 once 规则的默认锚点从裸
`{ref:"origin"}` 改成 `{ref:"origin", tokenId, uuid, x, y}`。

理由：`IMPLEMENTATION-PLAN.md:3868` 的 `resolveRefIn` 草案对裸 ref 三个分支全部落空、返回
`null`，`play.mjs:120` 的 `if (!target) continue` 会把整槽吞掉（434 条 cast cue + 48 条
once 规则 cue）。四组规格里 sequence-hang / anchor-aim / residual 都在 risks 里点了这条并
把它推给别人；合起来看没有人接。锚点自带身份+坐标是最小且不依赖 Task 14 实现细节的修法，
而且与 anchor-aim 的 `originAnchor` 形状一致。配套：`ref:"point"` 让冻结坐标结构性免疫。

### 3.6 测试与守卫（+49 用例，全部做过变异杀死实验）
- `tools/fake-sequencer.mjs`（103 行）：**统一成一份**记录型桩。四组各自提了一版
  （`fake-sequencer.mjs` / 内联于 `player-time-window` / 内联于 `play-aim` / 内联于 `play`），
  接口形状基本一致，我取 sequence-hang 那版的「白名单 + faultOn + 独立 helper」结构，
  把另外三版的断言全部并进一个测试文件。
- `test/play-contract.test.mjs`（597 行 / 32 用例）：用真实 `playPlan()` 跑
  **434 动作 × 8 结果 + 46 状态 = 3517 计划 / 12417 cue**，全程 ~1.0s。
- `test/sequencer-contract.test.mjs`（156 行 / 13 用例）：静态断言，锁的是**判据来源**
  （Sequencer 源码本身），不是我们的代码。最后一条把桩的 45 个方法名钉死在真源码上。
- `test/armory-impact.test.mjs`：新增 `startTime + duration ≤ 素材总长` 兵库守卫。
- `test/semaphore.test.mjs`：`pending` 精确值、两个数量级的 `timeoutMs` 采样、活定时器检查。
- `test/fixtures.test.mjs`：token 几何必须带 uuid。

---

## 4. 回归复算（全部自己跑，不复用规格里的数字）

### 4.1 覆盖率与阈值
```
动作覆盖 434/434   零目标攻击 cast 覆盖 53/53   状态覆盖 45/45（+1 刻意静默 = 46/46）
降级率 0.00%（0/434）   plan.warnings 总数 0   cue 总数 1818（+45 persist = 1863）
travel once 规则每动作条数上限：ray 1 / cone 1 / pulse 1 / surge 1（各 12 个动作）
元素层键 12/12，不同素材文件（视觉）10 种
HIT 元素层 objectScale 0.45 → GLANCE 0.27，比值恰为 0.6
12 组 persist 两两 ΔE00 ≥ 11.5：armory-persist-distinct.test.mjs 全绿
LEGACY_UNVERIFIED：仍为空（armory-assets.test.mjs 两条守卫全绿）
persist 三条 grep 契约（temporary / local:true / 无跨客户端开关）：**保持 pass**
```

### 4.2 新增的两条硬指标
```
「同时带 stretchTo 与 scaleToObject」的 cue：           0   （8 结果矩阵 12417 条 cue 全扫）
零长拉伸（at 与 stretchTo 同点）：      修前 224 → 修后 0
播放层实际调用 rotateTowards 的次数：   修前 1232 → 修后 0
```
`stretchTo` 且未显式 `scale` 的 cue 仍有 1888 条（矩阵口径）——它们**在数据层就该这样**，
守的是「播放层一条都不许对它们调 `scaleToObject`」，由契约测试断言为 0。

### 4.3 受 duration 语义影响的 cue：修前 / 修后逐行

fixture 语料（全 HIT）合计 **334 条**，与规格一致：

| 条数 | 槽/规则/层 | startTime | duration | 修前实播 | 修后实播 |
| ---: | --- | ---: | ---: | ---: | ---: |
| 240 | impact/impact.layered/element | 234 | 266 | **32ms** | 266ms |
| 26 | impact/impact.layered/element（electricity） | 267 | 233 | **0ms** | 233ms |
| 12 | travel/spell.gesture.cone | 3167 | 3666 | 499ms | 3666ms |
| 12 | cast/spell.gesture.conjure | 375 | 2875 | 2500ms | 2875ms |
| 12 | travel/spell.gesture.ray | 333 | 2100 | 1767ms | 2100ms |
| 12 | travel/spell.gesture.surge | 125 | 1125 | 1000ms | 1125ms |
| 12 | cast/spell.gesture.ward | 375 | 2583 | 2208ms | 2583ms |
| 8 | travel/strike.thrown | 533 | 1167 | 634ms | 1167ms |

8 结果矩阵下 **1864 条**，多出规格提到的两条结果层（fixture 打不到）：

| 条数 | 层 | st | du | 修前 | 修后 |
| ---: | --- | ---: | ---: | ---: | ---: |
| 394 | result / BLOCK | 267 | 1233 | 966ms | 1233ms |
| 394 | result / ARMOR | 467 | 266 | **0ms（彻底不可见）** | 266ms |

「修后实播 = 兵库 duration」不是我手算的：`test/play-contract.test.mjs` 用一段镜像
`_calculateDuration`（16052/16092/16097/16102/16106，逐行标行号）的复算函数，对**每一条**
带完整窗口的 cue 断言 `animMs === cue.duration`，1864/1864 通过。

### 4.4 变异杀死实验（12 组，每组只改一处、跑完立即还原）

| 变异 | 新契约测试 | 旧正则守卫 |
| --- | ---: | ---: |
| M1 `else e.scaleToObject(...)`（去掉 stretchTo 排除） | **1 红** | — |
| M9 **保留正确写法**、在稍后处再加 `if (!cue.scale) e.scaleToObject(...)` | **1 红** | **0 红（漏网）** |
| M2 `rotates = true`（无条件转向） | **7 红** | — |
| M3 注释掉 `e.anchor({x:.5,y:.5})` | **1 红** | — |
| M4 `applyTimeWindow` 去掉 timeRange 分支 | **4 红** | — |
| M5 travel 去掉 `at: originAnchor(s)`（零长拉伸复发） | **1 红** | armory-travel 亦 1 红 |
| M6 catch 里不调 `dropSection` | **1 红** | — |
| M7 shake 硬编码 `.zIndex(0)` | **1 红** | — |
| M8 `pointOf` 不优先取 `center` | **3 红** | — |
| M10a semaphore 硬编码 `setTimeout(…, 50)` | **1 红** | — |
| M10b 去掉 `clearTimeout` | **1 红** | — |

M9 是本轮最重要的一条：它证明「凡 cue 带 stretchTo，代码路径不得调用 scaleToObject」
是一条**对数据敏感的路径属性**，正则守卫表达不了；而记录型桩 50ms 就能表达。

---

## 5. 未采纳 / 降级的条目

### 5.1 `.template()` 补两端 padding（sequence-hang「建议」级）
**不做。** 论证成立（44 条 `[200,200,200]` 素材首尾各缩进 12.5%·d、192 条 eskie 末端短
6.25%），但：(a) 三个魔数取自**别人模组**的 `_templates` 表，跟着素材模组升级会变，
`asset-index.json` 里没有这项元数据，落地即三个会静默过期的常量；(b) 它是**观感精度**问题，
不是可见/不可见问题，与本轮四条「离线全绿、上机全毁」的性质不同；(c) 规格自己也列为
「建议而非必须」，并给了替代方案。**已按规格要求在 `docs/ASSET-NOTES.md` 末尾新增一节「已知未补偿：`stretchTo` 素材两端的透明留白」**，含逐条误差表、修法与不做的理由。

### 5.2 `aim.fromAnchor` 逃生舱（anchor-aim）
**不做。** V1 零消费者，也没有任何真实素材验证过「从锚点长出去」的观感。加一个只有合成
测试行使的分支，等于凭空造一条要维护的 API。`e.anchor({x:0.5,y:0.5})` 现在是硬策略，
注释里写明「将来真要那种语义请显式加 opt-in 字段，不要靠删掉这一行」。

### 5.3 `temporary` 必须排在 `tieToDocuments` 之前的断言（residual r2#6）
**驳回，理由是源码：** `_temporaryEffect` 是 sticky-OR（23255），`tieToDocuments` 不碰它，
顺序无关。加这条断言是写下一条假契约，将来会阻止无害的重排。

### 5.4 删掉 `armory-persist.test.mjs` 的三条正则守卫（residual r2#0）
**降级为「保留 + 加强」。** 任务的全局约束写明「Task 12 埋的 persist 契约 grep 守卫必须
保持 pass」，删掉就谈不上 pass。做法：三条正则原样保留、**去掉 `existsSync` 自我 skip**
（这才是那条 finding 的真问题：重构即豁免的后门），另外把契约 3 从「扫一个文件」扩成
「扫整个 `scripts/`（剥注释后）+ `end(All)Effects` 行扫描」，并在
`test/play-contract.test.mjs` 里补上真正承重的行为断言。三条契约现在有两层防线。

### 5.5 `regionMaskShape` 不覆盖 emanation / rectangle / `curvature:"round"`（residual r1#9）
**延后**（与规格同意见）。当前不可达（只有 ray/cone 设 `mask:"region"`，`when` 已限定
`region.type`），且 `coneYScale` 的 126.9° 上限与 mask 侧 179° 钳制不是同一截断点——
修它是一次锥形几何设计变更，不该混进缺陷修复。

### 5.6 `task-13-report.md` 的行号漂移（residual r0#5 / r1#10）
**不改历史报告**，只把其中真会误导人的一条（「规则在 travel.mjs」实为 `cast.mjs` 的
`strike.ranged.draw`）修进 `play.mjs` 的代码注释——那才是下一个人会读的地方。

### 5.7 超时时中止序列（residual r3#2 建议 3）
**不采纳**（与规格同意见）。Sequencer 只有私有 `_abort()`，信号量拿不到序列句柄，硬做要
翻掉 `playPlan` 的返回契约。改成「给足预算（15s）+ 超时留痕 + 可辨认哨兵」。

---

## 6. 行为变化面（上机时值得盯的）

1. **`createSemaphore` 默认 8000 → 15000**：单条动画真卡死时，后续动画多等 7 秒。
   超时本来就不中止原任务，提前放行换来的是画面叠加而不是流畅。
2. **`run()` 超时返回值从 `undefined` 变成 `TIMED_OUT` Symbol**：目前无调用方，
   Task 14 的 `dispatch.mjs` 落地时要意识到。草案里那句
   `createSemaphore({timeoutMs: 8000})` 会覆盖新默认值，请一并改掉或删掉显式参数。
3. **shake 的 `.zIndex(cue.zIndex)` + `impact.mjs` 的 `zIndex: 0`**：设计上零画面变化，
   但这是本轮**唯一一处逐像素结论只来自代码推理、没有渲染验证**的改动（shake 分支需要
   `hit.critical === true`，全量语料一次都不产出）。Task 16 请专门看一次暴击震屏。
4. **`PLAY_IF_VALUES` 删三个值**：今天零产出（12417 条 cue 核实过），但手搓 plan 或复用
   旧 plan 带这三个词时，会从「静默照播」变成「warn + 不播」。这是有意的方向选择。
5. **fixture 的 uuid**：`actions.json` / `effects.json` 是生成物。我改了生成器
   `tools/dump-fixtures.mjs`，同时用等价迁移脚本就地补齐两份 JSON（1122 处）——重跑生成器
   需要 leveldb + FVTT 数据目录，且会引入无关漂移。下次重跑结果一致。
6. **`ref:"point"`**：`aftermath.groundResidue` 与 travel 的 ray/cone 现在声明的是冻结坐标。
   Task 14 的 `resolveRefIn` **必须**为它加一条「`ref === "point"` 直接返回 `{x,y}`」的
   前置分支，否则那 48 条会走到 tokenId/uuid 分支之外的 x/y 兜底（今天等价，将来不一定）。

---

## 7. 给 Task 14 / 15 / 16 的移交要点

**Task 14（`dispatch.mjs` / `resolveRefIn`）**
- `resolveRefIn` 的三条优先级已经被 `test/play-contract.test.mjs` 的 `makeResolveRef()`
  写成可执行契约，照它实现即可：
  1. `at.ref === "point"` → **永远**返回 `{x,y}`，绝不升格成 placeable；
  2. `at.uuid` / `at.tokenId` → 优先解析成真 placeable（`attachTo`/`copySprite` 依赖它）；
  3. 只剩坐标 → 裸点。
  **不要**按 `task-13-report.md` 的建议改成「cue 自带 x/y 时优先信 x/y」——那会让 1381 条
  `ref:"target"` 的 cue 全部退化成裸点，打掉 attachTo 与 copySprite。
- 裸 `{ref:"origin"}` 已经在 `resolve.mjs` 侧消失（锚点自带 tokenId/uuid/x/y），但
  `resolveRefIn` 仍应对解析不到的情形返回 `null` 而不是抛错。
- `plan === null` 与 `plan.warnings` 非空都还**没有任何运行时消费者**，三个调用点草案一个
  都没记日志。play.mjs 的注释已改成「应当在触发层记」，请在 Task 14 的 checklist 里补上。
- `createSemaphore({timeoutMs: 8000})` 那句显式参数会覆盖新的 15000 默认值。
- `semaphore.run()` 可能兑现成 `TIMED_OUT`。

**Task 15（`effects.mjs` / `preview.mjs`）**
- `task-15-brief.md:119` 已改成 `endEffects({origin: effect.uuid}, false)`。两处都是硬要求：
  带 `name` 子句会因为 `_filterEffects` 的 AND 而匹配 0 条；漏掉 `push=false` 会走跨客户端
  通路、违反 DESIGN §5.4 契约 3——后者现在由 `armory-persist.test.mjs` 的行扫描在落地当天抓住。
- persist cue 的构造链契约（`persist(true,{persistTokenPrototype:false})` / `temporary(true)` /
  `tieToDocuments([tieTo])` / `origin(tieTo)` / 不设 `name`）已有行为断言，改 play.mjs 会变红。

**Task 16（上机验收）**
- **先看飞行物**：`generic.travel` / `spell.gesture.arrow` / `strike.thrown` 三条从前是
  「零长射线 + 每射一箭一条红色 ui 报错 + sprite 缩放为 0」。现在应当从施法者拉到目标。
- **参照系**：`spell.gesture.cone` 是修复前唯一能播出来的 stretch cue（带显式 `scale` 躲过
  throw），它的几何我复核过是对的。cone 位置对而 beam 位置不对 ⇒ 回头看 aim 那一段。
- **时长**：8 支 eskie 元素层的窗口只有 233-266ms，seek 到 f7 的落点若不准（webm 关键帧间隔），
  观感仍可能比预期短一两帧——这是我在无渲染环境下推不到的最后一步。
- **暴击震屏**：见 §6.3。
- **两端 padding**：44 条 `[200,200,200]` 素材（arrow/ray/thrown）的光束首尾各缩进 12.5%·d，
  4 格距离下两端各空 50px（半个 token），素材烘焙在末端的命中星爆也随之落在目标前方；
  192 条 eskie 只在末端短 6.25%。**这是已知的、有意未修的**（§5.1），不要当成坐标算错。

---

## 8. 遗留问题

1. **两端 padding 未补偿**（§5.1）。要修的正确做法是让 `tools/extract-db.mjs` 把各素材模组
   的 `_templates` 抽进 `asset-index.json`，而不是在兵库里写三个魔数。
2. **`regionMaskShape` 的 emanation / rectangle / `curvature:"round"`** 未覆盖（§5.5）。
3. **`aim.rotationOffset` / `aim.offset` 在 V1 全语料 0 次使用**。本轮给 rotationOffset 加了
   一条「与 stretchTo 同用会被丢弃」的 warn，是目前唯一会提示它的地方。
4. **挂死残留的可观测性**：修好之前，挂死的 Sequence 永远留在
   `SequenceManager.RunningSequences`（27764）里不出队。这对本仓库另一条线（内存泄漏排查）
   是个可测现象——上机时如果 `Sequencer.RunningSequences` 的条数只增不减，说明还有别的
   构造期 throw 没被 `dropSection` 兜住。
5. **`test/play-contract.test.mjs` 是纯 Node 守卫**，按设计只覆盖构造链。「好不好看、
   对不对得上格子」仍然只能靠 Task 16 上机。
6. **`sequencer-contract.test.mjs` 依赖 `/root/fvtt14-data`**（与 `source-tables.test.mjs` /
   `coverage.test.mjs` / `asset-index.test.mjs` 同一约定）。换机器跑测试要先有这个目录。
