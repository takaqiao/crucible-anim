# Task 13 报告：播放层

## 产出

- `scripts/player/semaphore.mjs`（新增）
- `scripts/player/play.mjs`（新增）
- `test/semaphore.test.mjs`（新增，简报 Step 1 原文）

`test/armory-persist.test.mjs` 未改动——它在 Task 12 就写好了，`play.mjs` 落地后那条
`skip` 守卫自动转为普通测试执行。

## 与简报的偏离

简报 `task-13-brief.md` 的 Step 4 代码只是脚手架，**不能直接照抄**：对照 Sequencer
4.2.3 的 vendored 源码（`/root/fvtt14-data/Data/modules/sequencer/dist/sequencer.js`，
版本号与 changelog 逐字核对过就是 4.2.3）逐个方法验证后，发现以下几处必须改写，
否则要么落不了地、要么落地是错的：

1. **`.temporary()` 整句缺失**——简报 Step 4 的 persist 分支只写了 `persist()` /
   `name()` / `tieToDocuments()` / `extraEndDuration()`，根本没有 `.temporary()` 这一
   句。这是 Task 12 留的 skip 守卫要抓的核心契约，照抄简报会让守卫从 skip 直接变 **红**，
   不是绿。已在 `play.mjs:216` 补上 `e.temporary(cue.worldPersist !== true)`。
2. **`e.name()` → `e.origin()`**——任务说明里已经点出这一条，我用
   `sequencer.js:11694` 的 `_filterEffects` 源码核实：`name` 与 `origin` 是 **AND**
   关系（`(!inFilter.name || ...) && (!inFilter.origin || inFilter.origin === effect.data.origin)`），
   而 `_origin` 字段初值为 `null`、只能靠显式调用 `.origin()` 设置（`sequencer.js:22925`），
   不会从 `attachTo`/`tieToDocuments` 等调用里自动带出来。Task 14 草稿的兜底清理
   `Sequencer.EffectManager.endEffects({origin: effectUuid}, false)` 只按 `origin`
   过滤，如果播放层从不调 `.origin()`，`effect.data.origin` 永远是 `null`，那张兜底网
   一条都撒不中。已在 `play.mjs:217-225` 改为 `e.tieToDocuments([cue.tieTo]); e.origin(cue.tieTo);`，不再调用 `.name()`。
3. **震屏漏了 `gridUnits: true`**——`cue.intensity`（默认 `0.08`）是"格宽的分数"（与
   `objectScale` 同一套语言）。`sequencer.js` 的 `_playAnimations`（约 17282 行起）
   逐字确认：只有 `inPropertyName` 是 `position.x`/`position.y`/`scale.x`/`scale.y`/
   `width`/`height` 且显式 `gridUnits:true` 时，循环动画的 `from`/`to` 才会乘以
   `canvas.grid.size`。简报的 `loopProperty` 调用没写这一项，`intensity:0.08` 会被
   当成 0.08 **像素**用——肉眼不可见的抖动，而且这个 bug 离线测试测不出来（没有渲染
   环境可断言"看得见"）。已在 `play.mjs:151-154` 补上 `gridUnits: true`。
4. **`plan.regionShape` 不存在**——简报写的是 `if (cue.mask === "region" && plan.regionShape) e.mask(plan.regionShape)`，但 `resolve()`（`scripts/resolver/resolve.mjs`
   末尾）实际产出的字段名是 `plan.region`，而且它是**纯几何数据**
   （`{type, x, y, radius/length, angle, rotation, width}`，见
   `trigger/snapshot.mjs` 的 `region = {...action.region.shapes[0].toObject?.() ?? ...}`），
   不是一个现成的 Foundry 模板文档或 PIXI 形状，`plan.regionShape` 从来没被任何代码
   赋过值。我改为在 `play.mjs` 里写 `regionMaskShape()`，直接用 `PIXI.Circle`/
   `PIXI.Polygon` 在场景坐标里现算——Sequencer 的 `.mask()` 文档原话支持这种用法
   ("Raw shapes (PIXI.Polygon, PIXI.Circle, PIXI.Rectangle) are masked in scene
   coordinates")。锥形沿用 `armory/travel.mjs` 的"扁三角"模型（`reach = radius /
   cos(angle/2)`），与 `templateEnd()`/`coneYScale()` 用同一套换算，两处必须保持
   一致——我核对过：这样算出的底边中点恰好落在距锥尖 `radius` 处、半宽
   `radius·tan(angle/2)`，与 `travel.mjs` 自己的推导吻合。没有用 Foundry 核心的
   `MeasuredTemplate.getConeShape`/`getRayShape`：这两个静态方法在 v14 已标记
   deprecated（since 14 until 16），且入参是网格单位，要求现查 `canvas.grid`；
   `plan.region` 里的数值已经是像素，直接在像素空间算更省一次依赖也不吃 deprecation
   warning。
5. **`shouldPlay()` 的桩函数名不副实**——简报写的 `return cue.playIf !== "never"`，
   文档注释却说"cue 自带的结果名与实际结果比对"——但函数体完全没有比对任何东西，
   "never" 也根本不在 12 词的 playIf 词表里。我改成对着完整词表（8 结果 + always +
   critical + hitOrGlance + defended）做校验，非法值按不播放处理并 `warn()`
   留痕；理由见下面"playIf 处理逻辑"一节。
6. **未捕获的构造期异常会带崩整条计划**——简报的 `for` 循环没有 try/catch。
   `softFail:true` 只覆盖 Sequencer 自己在 `_execute`/`_initialize` 阶段的
   "文件找不到"类失败（`sequencer.js` 多处 `if (this.sequence.softFail) {...}`），
   不覆盖构造链上同步抛出的参数校验错误（比如 `mask()`/`copySprite()` 对参数类型的
   `throw`）。一条 cue 出错就会把 `for` 循环、进而整条 `plan.cues` 后面的 persist/
   aftermath cue 全部带崩。已给每条 cue 的构造包一层 try/catch，呼应
   `resolver/resolve.mjs` 里 `runBuild`/`firstMatch`"单条规则出错只丢这一条"的
   哲学。
7. **`kind:"sound"` 漏了 `.duration()` 与 `.locally()`**——`strike.ranged.draw`
   那条起手音效带 `duration:800`（专门截掉音频里烘焙的"箭到"尾音，见
   `armory/travel.mjs` 该规则注释），简报的 sound 分支从未调用 `.duration()`，这个
   字段被静默丢弃。`.duration()`/`.locally()` 都定义在 Sequencer 的 `Section` 基类 /
   `traits.users`，Sound 与 Effect 两种 Section 都支持（我在源码里核实过），已补上。
8. **`copySprite()`/`attachTo()` 缺少 placeable 校验**——`resolveRef` 在目标 token
   已经从画面上消失时会退化返回一个裸 `{x, y}`（Task 14 草稿 `resolveRefIn` 的兜底
   分支）；而 `copySprite()` 要求真实的 `Token`/`Tile`（`instanceof` 检查会直接
   throw），`attachTo()` 语义上也要求一个可跟随的对象。补了 `isPlaceable()` 守卫，
   命中兜底点位时直接跳过这条 cue（配合第 6 条的 try/catch，这本来也不会崩，但显式
   跳过比走异常路径更清楚）。

## CUE_DEFAULTS 字段 → Sequencer API 对照表

| 字段 | 映射 |
| --- | --- |
| `kind` | 分支选择器：`"sound"→seq.sound()`，`"shake"→seq.effect()+copySprite()`，`"effect"→seq.effect()+file()` |
| `playIf` | `.playIf(shouldPlay(cue))`（Sound/Effect 通用），词表校验见下节 |
| `attachTo` | 为真走 `e.attachTo(target,{bindScale})`，否则 `e.atLocation(target,{gridUnits})` |
| `bindScale` | `attachTo(target, {bindScale: cue.bindScale})` 的选项 |
| `local` | `.locally(cue.local)`（Effect 与 Sound 都调用） |
| `aim.towards` | `resolveRef({ref:"point",...towards})` 解出点，喂给 `.rotateTowards()` |
| `aim.missed` | 为真时 `.missed(true)` |
| `aim.rotationOffset` | `rotateTowards(..., {rotationOffset})` |
| `aim.offset` | `rotateTowards(..., {offset})`——V1 无任何规则填过这个子字段，透传但目前恒为 `undefined`，见下节 |
| `stretchTo` | `.stretchTo(cue.stretchTo)` |
| `offset` / `gridUnits` | 非零时 `.spriteOffset({x,y}, {gridUnits})`；`gridUnits` 同时也喂给 `atLocation` |
| `objectScale` | 无 `cue.scale` 时 `.scaleToObject(cue.objectScale)` |
| `scale` | 有值时 `.scale(cue.scale)`（覆盖 objectScale，锥形撑张角用） |
| `mirrorY` / `randomizeMirrorY` / `randomRotation` | 各自对应同名方法 |
| `filter` | `.filter(cue.filter.type, cue.filter.data)` |
| `tint` | `.tint(cue.tint)`——persist 的 decay/hidden 两组靠它拉开颜色区分度，已确认接上 |
| `opacity` | `.opacity(cue.opacity)` |
| `fadeIn`/`fadeInEase`，`fadeOut`/`fadeOutEase` | `.fadeIn(v,{ease})` / `.fadeOut(v,{ease})` |
| `belowTokens` | `.belowTokens(cue.belowTokens)` |
| `zIndex` | `.zIndex(cue.zIndex)`（effect）；shake 硬编码 `0`（DESIGN §8.2 "zIndex 分层 100/50/0"），sound 无此概念 |
| `elevation` | 非 null 时 `.elevation(v, {absolute:true})` |
| `mask` | `"region"` 时用 `regionMaskShape(plan.region)` 现算 PIXI 形状喂给 `.mask()` |
| `delay` | `.delay(cue.delay)`（effect/sound/shake 都用） |
| `duration` | 非 null 时 `.duration(cue.duration)`（effect/sound）；shake 用 `cue.duration ?? 400` 直接传（抖动循环本身无限，靠 duration 收尾） |
| `playbackRate` | `.playbackRate(cue.playbackRate)`——仅 effect；Sound 没有这个方法（定义在 EffectSection 类体内，不是共享 trait），也没有任何规则给 sound cue 填过它 |
| `startTime` | `.startTime(cue.startTime)`（effect/sound） |
| `waitUntilFinished` | 非 null 时 `.waitUntilFinished(v)`（effect/sound） |
| `persist` | `.persist(true, {persistTokenPrototype:false})` |
| `tieTo` | `.tieToDocuments([tieTo])` **且** `.origin(tieTo)`（不用 `.name()`，理由见上） |
| `extraEndDuration` | 真值时 `.extraEndDuration(v)` |
| `volume` | `(cue.volume ?? 1) * volume` 喂给 `.volume()`（sound） |
| `worldPersist` | `.temporary(cue.worldPersist !== true)`（persist 分支内，强制契约 1） |
| `selfFlash` | **不消费**，见下 |
| `at`（normalize 注入） | `resolveRef(cue.at)` 解出目标，贯穿全函数 |
| `rule`/`slot`（normalize 注入） | 仅用于 `warn()` 诊断信息，不进入任何 Sequencer 调用 |

### 没有消费的字段

- **`selfFlash`**：这是 `armory/flash.mjs` 的双闪抑制记账（"这条 travel cue 自带的
  闪爆窗口，后面的 impact 层要不要让位"），normalize() 会把它原样留在最终 cue 上
  （因为是超集展开），但它在 **resolve 阶段就已经被消费完**——impact.mjs 用
  `coveringFlash(built,...)` 查过、决定要不要让位之后，这个字段对播放层没有任何
  意义：它不对应 Sequencer 的任何一个 API，纯粹是规则之间协调用的内部账本。播放层
  如果去读它，等于在做一件 resolve 阶段已经做完的事。
- **`aim.offset`**：DESIGN.md 的 schema 里声明了这个子字段，但我逐条 grep 过
  `scripts/armory/*.mjs`，V1 没有任何一条规则真的填过它。我选择把它透传给
  `rotateTowards(...,{offset: cue.aim.offset})` 而不是完全忽略——`undefined` 时
  `mergeObject` 后面 `if (inOptions.offset)` 判断是假值，等价于没传，所以现在是
  安全的无操作；好处是将来哪条规则开始填 `aim.offset`，不需要再改 `play.mjs`。

## 三条强制契约的落实位置

1. **`.temporary(cue.worldPersist !== true)`**——`scripts/player/play.mjs:216`，
   persist 分支内。
2. **`await seq.play({local: true, preload: true})`**——`scripts/player/play.mjs`
   末尾（函数最后一行）。
3. **不出现 `executeForOthers` / `remote: true`**——全文件 `grep -n
   "executeForOthers\|remote:"` 零命中（写注释时特意避免连成这个字面量本身，否则
   `test/armory-persist.test.mjs` 的 `doesNotMatch` 会连注释一起抓，头一版就因为这个
   在评注里踩了这个坑，改写措辞后过了）。

### 守卫从 skip 转为 pass 的证据

```
$ node --test test/armory-persist.test.mjs
# Subtest: 播放层把持久化契约落到实处（play.mjs 一出现就生效）
ok 10 - 播放层把持久化契约落到实处（play.mjs 一出现就生效）
```

`npm test` 总数从任务开始前的 202（201 pass + 1 skip）变成 206（206 pass + 0
skip + 0 fail）：+4 是新增的 `test/semaphore.test.mjs`，那 1 条 skip 转正是这条
守卫。

## `kind` 三种与 `playIf` 处理逻辑

- **`"effect"`**（默认，无 `kind` 字段时的 CUE_DEFAULTS 取值）：`seq.effect()` 走完整
  的定位/外观/时序/持久化管线（见上表）。
- **`"sound"`**：`seq.sound()`，只处理声音相关字段（file/volume/delay/startTime/
  duration/waitUntilFinished/local/playIf），不涉及任何视觉字段——`CUE_DEFAULTS`
  在 DESIGN.md §6.2 里也明确标注 `volume` 是"声音专用"，其余视觉字段（scale/tint/
  filter/attachTo…）对 sound cue 从未被规则填过有意义的值。
- **`"shake"`**：`seq.effect().copySprite(target)`——复制目标 token 的 sprite、
  用 `loopProperty` 左右摆动这个副本，不产生新素材文件，因此 `cue.file` 对 shake
  无意义（也确实没有规则给 shake cue 填过 file）。

`playIf` 有 12 个合法取值（8 种攻击结果 + `"always"` + `"critical"` + 两个聚合值
`"hitOrGlance"`/`"defended"`，任务说明里的"11 种"指的是除 `"always"` 外需要判定的
那 11 个）。我逐条 grep 过 `scripts/armory/*.mjs`：**V1 的规则只产出 `"always"` 与
8 种结果名两类**，`"critical"`/`"hitOrGlance"`/`"defended"` 目前没有任何一条规则
使用。这不是我漏做——而是因为 `resolve()` 的整个设计就是"cue 在构造时已经针对
**已经发生的真实结果**生成"（`impact.mjs` 的 `playIf: name` 直接来自
`RESULT_NAME[hit.result]`，与同一个 cue 的 `file`/`at`/`aim` 出自同一次判定，不是
分开算的），所以不存在"构造好一个通用 cue，运行时再拿真实结果去比对 playIf"这种
场景——真正的判定已经在 resolve 阶段完成，播放层拿到的 cue 本身就是判定的结果。
`playIf` 字段在播放层的价值因此是两点，而不是"重新判定"：

1. **保持序列结构恒定**（简报的设计初衷）：无论 `playIf` 是什么，都走同一条
   `seq.effect()...playIf(bool)` 调用链，不用 `if` 改变链的形状，方便在 Sequencer
   Manager UI 里逐条比对不同战斗结果下的序列。
2. **数据完整性校验**：`shouldPlay()` 校验 `cue.playIf` 是否在 12 词词表内，不是就
   `warn()` 并按不播放处理——这样规则表手滑写错词、或者未来新增一个没同步更新词表的
   取值，会在控制台留一条可查的痕迹，而不是让 Sequencer 对一个陌生字符串做未定义
   行为。

## 震屏实现

`kind:"shake"` 用 `copySprite(target)` 复制目标 token 的 sprite 作为一个独立的
Sequencer 特效，再用 `loopProperty("sprite", "position.x", {from:-i, to:i,
duration:60, pingPong:true, gridUnits:true})` 左右来回摆动这个副本——**只抖这一个
复制出来的 sprite，不影响 TokenLayer 上真正的 token，也不震动整个画布**，因此不会
让屏幕外或没有关注这个 token 的其他玩家跟着难受。`gridUnits:true`
是我在简报基础上修的一处真实 bug（见"与简报的偏离"第 3 条）。`zIndex(0)`、
`duration(cue.duration ?? 400)` 给动画一个明确终点（`loopProperty` 本身是无限
pingPong，靠外层 duration 收尾）。播放前用 `isPlaceable()` 校验 `resolveRef`
真的返回了一个 Token/Tile 对象，不是兜底的裸坐标点。

## `plan` 为 null 时谁负责记日志

**判断：播放层不补日志，维持现状由 trigger 层负责。**

理由：`playPlan(null, ...)` 目前静默 return。`resolve()`/`resolveEffect()` 返回
`null` 的原因有好几种（没有规则命中、零目标、`effectUuid` 缺失被 `keepTied`
拦下……），而**只有 trigger 层同时握着"发生了什么""为什么会走到这一步"两份上下文**
——比如 `resolveEffect` 返回 null 是因为 `effectUuid` 缺失，`trigger/persist.mjs`
的草稿（`docs/IMPLEMENTATION-PLAN.md` 里的 `planForEffect`）在拿到这个 null 之前
就已经能判断"是不是因为 uuid 缺失"并给出对应的 warning；到了播放层，这些上下文全部
丢失了，`playPlan` 只知道"我收到了一个 null"，再补一行日志只会是同一件事的第二份、
信息量更低的拷贝（连规则名、动作 id 都给不出来）。

播放层**唯一**独有、trigger 层看不到的判断是版本不符（`plan.v !== PLAN_VERSION`）
——这是播放层自己的校验逻辑，不属于 resolve 的输出内容，所以这一条我保留了
`warn()`。如果未来 trigger 层因为某种重构不再兜底记录 null 的原因，那时候应该回来
补的位置也是 trigger 层（它离"为什么是 null"这个问题最近），而不是把这个职责挪到
播放层——播放层应该保持"拿到什么就播什么，拿不到就安静退出"的单一职责，不越权诊断
上游为什么没给内容。

## 一个不在本任务范围内、但建议 Task 14 关注的点

`docs/IMPLEMENTATION-PLAN.md` 里 Task 14 的 `resolveRefIn` 草稿：

```js
if (at.ref === "origin" || at.ref === "target") {
  const tok = at.uuid ? fromUuidSync(at.uuid)?.object : null;
  if (tok) return tok;
  const byId = scene?.tokens?.get?.(at.tokenId)?.object;
  if (byId) return byId;
}
if (Number.isFinite(at.x) && Number.isFinite(at.y)) return {x: at.x, y: at.y};
```

对 `ref === "origin"` 一律优先查 token、查到就返回 token 对象，**忽略 cue 自带的
x/y**。但 `armory/travel.mjs` 的 `spell.gesture.ray`/`spell.gesture.cone` 两条
`once:true` 规则用的 `templateAnchor(s) = {ref:"origin", x: s.region.x, y:
s.region.y}`，其注释原文明确写着"起点在模板本身（锥尖/线首）……**也不一定精确等于
施法者 token 的中心**"——如果 `resolveRefIn` 按上面的逻辑落地，只要施法者 token
还在场上（几乎总是），这两条 cue 的 `atLocation` 就会静默拿到"施法者 token 现在的
位置"而不是"模板固化下来的精确起点"，与 `stretchTo`/`mask` 用的坐标（都来自
`plan.region`，不受这个问题影响）不再是同一个原点。播放层这边我对 `aim.towards`
特意用了 `{ref:"point", ...}` 绕开这个分支（点也带 tokenId，但 `resolveRefIn` 对
`"point"` 直接走 x/y 分支），`armory/travel.mjs` 的 `templateAnchor` 如果也改用
`"point"`（或者 Task 14 的 `resolveRefIn` 对 `"origin"` 加一条"cue 自带 x/y 时优先
信 x/y"的判断），这个问题就不存在。这不影响 Task 13 的完成度（`play.mjs` 严格按
"resolveRef 返回什么就用什么"的契约实现，问题出在 resolveRef 的具体实现，不是它的
调用方），但既然是我在核对 resolveRef 契约时读出来的，按惯例上报。

## `npm test` 完整输出（尾部）

```
1..206
# tests 206
# suites 0
# pass 206
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 5009.308155
```

（202 条既有测试的 1 条 skip 转正 + 新增 4 条 `semaphore.test.mjs` = 206，全绿。）
