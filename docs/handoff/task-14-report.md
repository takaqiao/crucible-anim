# Task 14 报告：触发层与传输通道

## 产出

- `scripts/trigger/wrap.mjs`（新增）——包装 `configureVFXEffect`，只在原生链最终返回
  `null` 时接管，产出的 `FXPlan` 写进 `action.metadata.cav`。
- `scripts/trigger/dispatch.mjs`（新增）——监听 `updateChatMessage`，在 `confirmed`
  由假翻真时本地播放；顺带导出 `resolveRefIn`/`animationsEnabled`/`runAnimation`
  给 `trigger/effects.mjs` 复用。
- `scripts/trigger/effects.mjs`（新增，**超出简报范围**，见下方"与简报的偏离"）——
  监听 `createActiveEffect`/`deleteActiveEffect`，驱动 persist 槽。
- `scripts/main.mjs`（修改）——`ready` 回调改 `async`，自检通过后挂载三者。
- `test/wrap.test.mjs`（新增，简报原文 + 修复 + 3 条补充用例，共 7 条）
- `test/dispatch.test.mjs`（新增，9 条）
- `test/effects-trigger.test.mjs`（新增，6 条）

`npm test`：**277/277 pass**（任务开始前 255/255，新增 22 条，0 fail/skip）。

## 与简报的偏离：`effects.mjs` 提前到本任务

`task-14-brief.md` 只写了 `wrap.mjs`/`dispatch.mjs`；`effects.mjs` 原本是
`task-15-brief.md` 的 Step 3。但本次派发的任务描述明确把"三件事"里的第三件定成
`effects.mjs`（监听 ActiveEffect 增删），并且给了两条只有 `effects.mjs` 才用得上的
具体决策点（`createActiveEffect` 时 `statuses` 是否已填好、`deleteActiveEffect`
兜底清理的 `endEffects({origin}, false)` 契约）。按派发指令的字面范围实现，未等
Task 15 重新分配。`preview.mjs`、重放菜单、`installReplayMenu` **不在本次范围内**，
留给 Task 15。

导出的纯逻辑函数名沿用了 `task-15-brief.md` 草稿里的 `planForEffect(effect, token,
env, deps)`，方便 Task 15 直接复用而不必改签名。

## 三个文件的职责与关键实现

### `wrap.mjs`

- `buildPlanFor(action, env, deps, {nativeConfig})`：纯逻辑，脱离 Foundry 可测。
  `nativeConfig` 真值直接让位返回 `null`；否则 `snapshotAction` → `resolve()`，
  整个包在 try/catch 里，任何异常降级为 `null` 并用 `error()` 留痕。
- `installWrap(deps)`：包装 `crucible.api.models.CrucibleAction.prototype
  .configureVFXEffect`。原生调用与本模组逻辑各自独立 try/catch（原生抛错不影响本模组
  判断，本模组抛错不影响原生返回值），最终**始终**返回 `nativeConfig`，绝不改变
  Crucible 自己看到的返回值。
- 接管时写 `this.metadata[META_KEY] = plan`，**不做** `this.metadata ??= {}`：核对
  `action.mjs:1003-1017`，`CrucibleAction#_configure` 用
  `Object.defineProperty(this, {metadata: {value: metadata, writable: false, …}})`
  定义这个字段——重新赋值会抛 TypeError（这个字段不可写，只有它指向的对象可变），
  而 `_configure` 的解构默认参数 `metadata={}` 保证它永远至少是 `{}`，不会是
  `null`/`undefined`，所以直接写键是唯一安全且够用的写法。

### `dispatch.mjs`

- `animationsEnabled()`：Crucible 的 `enableVFX` 与本模组的 `ENABLED` 设置都为真
  才播，任一读取抛错保守按关闭处理。
- `resolveRefIn(scene)`：见下一节，与 `makeResolveRef` 逐条对齐。
- `runAnimation(label, fn)`：把一次播放交给共享信号量，统一吸收"拒绝"（`playPlan`
  抛错，`warn()` 后吞掉）与"超时放行"（`semaphore.run()` 现在会 resolve 成 `TIMED_OUT`
  哨兵值而不是简单 reject，见下方专节）两种非正常结局，供 `playFromMessage` 与
  `effects.mjs` 共用同一条队列。
- `playFromMessage(message)`：从 `message.flags.crucible.metadata[META_KEY]` 取
  `plan`，`animationsEnabled()` 与场景 `isView` 校验后经 `runAnimation` 播放。
- `installDispatch()`：监听 `updateChatMessage`，`flags.crucible.action` 存在且
  `changed` 里的 `flags.crucible.confirmed` 翻真才处理；把播放 promise 挂到
  `message._vfxPlayback`（**没有**另起模组私有字段——理由见下方"Crucible 钩子实际行为
  核实"一节，这是本次读源码找到的、简报草稿没有的一处集成点）。

### `effects.mjs`

- `planForEffect(effect, token, env, deps)`：纯逻辑。用 `snapshot?.statusId`（可选
  链）而不是简报草案的 `snapshot.statusId`——`snapshotEffect` 在没有 token 时直接
  返回 `null`，裸访问会在完全正常的路径上抛 TypeError，被 catch 接住后错误地记成
  "构造失败"，把一次静默降级变成一次误报。已修。
- `installEffectTriggers(deps)`：
  - `createActiveEffect`：`effect.parent instanceof Actor` 且
    `animationsEnabled()` 为真时，对 `actor.getActiveTokens()`（已经把范围限定在
    `canvas.scene`，离场/跨场景角色天然拿到空数组）逐个 token 调
    `planForEffect`，产出的 plan 经 `dispatch.mjs` 的共享队列播放。
  - `deleteActiveEffect`：兜底 `Sequencer.EffectManager.endEffects({origin:
    effect.uuid}, false)`，第二个参数显式 `false`（见下方专节）。

## `resolveRefIn` 与 `makeResolveRef` 的行为一致性验证

`makeResolveRef`（`test/play-contract.test.mjs:49-70`）是这份契约的参考实现，三条
优先级：

1. `ref:"point"` 永远原样返回冻结坐标，**不管它是否也带着 tokenId/uuid**——不短路会
   让 ray/cone 的模板锚点被 token 中心顶掉，而 `stretchTo`/`mask` 仍锚在 region 坐标，
   起点/终点/遮罩来自两套原点。
2. 带身份（`tokenId`，真实环境里还有 `uuid`）——优先解析成真 placeable。
3. 都解析不到——退化成裸 `{x,y}`；再解析不到返回 `null`。

`dispatch.mjs` 的 `resolveRefIn` 实现同一个优先级：`ref==="point"` 第一行就短路
返回/拒绝；其后先试 `fromUuidSync(at.uuid)?.object`，拿不到再退回
`scene.tokens.get(at.tokenId)?.object`；都拿不到再退回坐标点。与 `makeResolveRef`
唯一的差别是身份解析的**机制**：`makeResolveRef` 跑在纯数据测试环境里，只能靠一个
按 tokenId 建的本地 Map 模拟；真实环境有 `fromUuidSync` 这个更稳的入口（跨
compendium/跨场景都能查，Sequencer 自己的 `attachTo`/`copySprite` 也要求真
placeable），所以多做了 uuid 优先这一步，但**优先级顺序本身**（point 短路 → 身份 →
坐标）完全一致。

`test/dispatch.test.mjs` 用一个"同一个 tokenId 在 uuid 路径与 tokenId 路径给出不同
placeable"的桩，逐条钉住：point 短路（即使 tokenId/uuid 同时存在）、非法坐标返回
`null`、uuid 优先命中、uuid 未命中退回 tokenId、两者都未命中退化坐标、全部失败返回
`null`。6 条全绿。

同时确认了 Task 13 报告里记录的那个历史风险（`armory/travel.mjs` 的
`templateAnchor` 若仍用 `ref:"origin"` 会被这条优先级坑到）已经不存在——当前源码里
`templateAnchor`/`aftermath.mjs` 的 `residueAnchor` 都已经是 `ref:"point"`
（`scripts/armory/travel.mjs:123`、`scripts/armory/aftermath.mjs:19-31`），点位锚点
从不携带 tokenId，即使误用"先查身份再回退坐标"的实现也不会撞上这个坑；但契约本身
仍按"point 必须最先短路"实现，不依赖上游"点位锚点恰好从不带 tokenId"这个偶然事实。

## Crucible 钩子实际行为核实

读的是 `/root/fvtt14-data/Data/systems/crucible/module/models/action.mjs` 与
`module/documents/chat-message.mjs`（版本号在 changelog 里核对为 4.2.3 对应的系统
版本，`module.json` 声明的 `verified: 14.366`）。

### `metadata` 的序列化路径

`CrucibleAction#_prepareMessage`（action.mjs:3271-3288）：

```js
actionData.vfxConfig = this.configureVFXEffect();
if (!foundry.utils.isEmpty(this.metadata)) actionData.metadata = this.metadata;
```

`toMessage()` 随后 `ChatMessage.create({flags: {crucible: actionData}, …})`
（action.mjs:3353）。路径确认为 `message.flags.crucible.metadata`（不是
`flags.crucible.action.metadata`），与简报草案一致。`configureVFXEffect()` 在
`actionData.metadata` 赋值**之前**同步执行，`wrap.mjs` 写进 `this.metadata` 的键
能被这一行捕获。

### `confirmed` 的翻转时机

`CrucibleAction#confirm()`（action.mjs:2680）：`await this.message?.update({flags:
{crucible: {confirmed: !reverse}}})`。这是**唯一**翻这个标记的地方，`reverse` 时
翻回 `false`——`updateChatMessage` 收到的 `changed` 里 `confirmed` 是 `false` 而不是
"缺失"，`dispatch.mjs` 的 `!== true` 判据正确地把撤销挡在外面。

3D 骰子的等待发生在**更早**：`CrucibleChatMessage#autoConfirmMessage()`
（chat-message.mjs:94-103）在调用 `confirmMessage` 之前
`await game.dice3d.waitFor3DAnimationByMessageID(this.id)`，因此我们的
`updateChatMessage` 钩子（只在 confirmed 翻真之后触发）天然排在骰子动画完成之后，
简报"白拿"清单里的这条成立。

### 一处简报没有、但源码里现成的集成点：`message._vfxPlayback`

这是本次核实里发现的、**必须**改的地方。`CrucibleChatMessage` 有一个公开（虽标
`@internal`但无访问限制）字段：

```js
/** Awaited by {@link CrucibleAction#confirm} to defer postConfirm hooks until
 *  animation playback concludes. */
_vfxPlayback;
```

`CrucibleAction#confirm()`（action.mjs:2682-2686）：

```js
if (!reverse && this.message?._vfxPlayback) {
  const maxWait = new Promise(resolve => setTimeout(resolve, 3000));
  await Promise.race([this.message._vfxPlayback.catch(() => {}), maxWait]);
}
```

——confirm 流程会等这个字段代表的 promise 完成（封顶 3 秒），**之后**才跑
`postConfirm` 钩子（连锁动作、英雄气概触发的后续流程都在这一步之后）。但原生只在
`flags.action && flags.vfxConfig && confirmed===true`
（`CrucibleChatMessage#_onUpdate`，chat-message.mjs:39-46）时才写这个字段——也就是
**只在原生自己接管了动画时**才设置。简报草案让 `dispatch.mjs` 把播放 promise 存进
一个模组私有字段 `message._canimPlayback`，Crucible 自己完全不知道这个字段的存在，
`confirm()` 不会等它——本模组接管的动作（也就是"只补空缺"要覆盖的绝大多数场景）
播放到一半，连锁动作/英雄气概后续流程就已经开始，画面会被自己的下一步打断。

已改为 `message._vfxPlayback = message._vfxPlayback ?? playFromMessage(message);`：
`??=` 是双保险而非会真正触发的分支——原生写这个字段的条件（`flags.vfxConfig` 真）
与我们产出 plan 的条件（`nativeConfig` 为 null）互斥，且 `doc._onUpdate()` 严格先于
`Hooks.callAll('updateX', …)` 执行（核对了
`/root/foundryvtt/client/data/client-backend.mjs:336-337`），所以我们的钩子跑到时
原生要么已经写好了这个字段（我们不碰），要么这个字段还是 `undefined`（我们写）。
`action.message` 与触发 `updateChatMessage` 的 `message` 是同一个文档实例（核对了
`CrucibleAction.fromChatMessage`，action.mjs:3575 把入参 `message` 原样放进
`actionContext`），不管是走自动确认还是 GM 手动点"确认"按钮，这条集成都成立。

（顺带一提：`confirm()` 源码注释写"封顶 4 秒"，实际 `setTimeout(resolve, 3000)` 是
3 秒——Crucible 自己的文档与实现不一致，不是我们这边的问题，无需处理。）

## `plan.warnings` 与 `plan === null` 的处理

`resolve()`/`resolveEffect()` 在规则 `when()`/`build()` 抛异常、或 persist cue 缺
`tieTo` 被 `keepTied` 丢弃时，把消息记进 `plan.warnings`（字符串数组）；`play.mjs`
的文档明确说这一层不消费它，理由是"trigger 层同时握着 plan 与上下文，播放层只知道
收到了什么"。落实为：

- **`plan` 非空且 `plan.warnings` 非空**：`buildPlanFor`/`planForEffect` 都会遍历
  `warn(`[action-id 或 statusId] ${msg}`)`。用不受 debug 开关影响的 `warn()`
  而不是 `debug()`——这类消息代表兵库规则表本身写错了（`when()`/`build()` 抛异常，
  或漏填 `tieTo`），与 `play.mjs` 里同类"契约被违反"的诊断（未知 `playIf`、`mask`
  转换失败）保持同一严重度；`test/coverage.test.mjs` 已经在全量语料上钉死"正常路径
  一条 warning 都不该有"，所以这条路径在生产环境理论上应该永远沉默，一旦响了就是
  真的该被看见的信号，不该被 debug 开关吞掉。
- **`plan === null`**：两处都用 `debug()`（受 debug 设置项控制）记一条"没有接管/
  没有产出计划"，因为这经常是完全正常的（原生已处理、动作压根不该有动画、状态没有
  对应的兵库规则），只有主动排查"为什么没播"时才需要看见，不该在正常游玩时刷屏。
- `test/wrap.test.mjs` 里"plan.warnings 非空时会经 warn() 冒出来"一条用伪造的
  `when()` 必抛异常规则验证了这个转发；`buildPlanFor`/`planForEffect` 各自的
  "没有匹配规则"/"没有 token" 用例验证了 `plan===null` 分支不抛错。

## 信号量超时值的判断

**判断：不传 `timeoutMs`，让 `dispatch.mjs`/`effects.mjs` 共用的信号量吃
`createSemaphore()` 自己的默认值（当前是 15000）。**

简报草案 `const semaphore = createSemaphore({timeoutMs: 8000});` 会把 Task 13 刚调
高的默认值原样覆盖回去。`semaphore.mjs` 的文档写明了调参理由：仓库全部 434 条计划
按 Sequencer 的等待语义模拟，最长落在 7-8 秒量级；更吃预算的是 `preload`——
`Sequence.play()` 先 `await Promise.allSettled(section._initialize())` 再
`await Sequencer.Preloader.preload(...)`，两者都发生在任何一段播放**之前**，冷缓存
首次加载 jb2a webm 走网络、秒级很常见，而这正是每条法术**第一次**施放时的常态。
8000ms 对最长的那几条只剩个位数百分比余量，超时会精准打在画面最长、最该被保护的
那几条上。改为不传参数（而不是显式 `{timeoutMs: 15000}`）是为了让这条调参结论以后
再变也自动跟上，不用指望每个调用点都记得手动同步。

## `semaphore.run()` 的 `TIMED_OUT` 契约与处理

核对 `scripts/player/semaphore.mjs`：`run()` 不再是简单的 resolve/reject——单条任务
超过 `timeoutMs` 仍未完成时，`run()` 用 `TIMED_OUT`（一个具名 `Symbol`）**resolve**
（不是 reject），队列继续放行后面排队的任务，而超时的那条任务本身仍在后台跑完（信号量
本身没有能力中止一条正在播放的 Sequencer 序列）。`semaphore.mjs` 自己已经在超时那一刻
打过一条 `warn()`。

`dispatch.mjs` 的 `runAnimation()`：`.catch()` 只处理任务真正 reject 的情形（记一条
`warn` 并吞掉，避免未处理 rejection）；额外检查 `result === TIMED_OUT`，命中时补一条
`debug()`（带上 label，方便定位是哪条聊天卡/哪个状态把队列顶住了）——不重复打
warning（`semaphore.mjs` 已经打过一条更通用的），只是补充可用于排查的上下文。

`test/dispatch.test.mjs` 验证了"成功"与"拒绝"两种结局（拒绝时确认 `warn()` 收到了
label 与错误信息，且 `runAnimation` 本身绝不 reject）。`TIMED_OUT` 分支没有在这里
用真实 15 秒去触发——`test/semaphore.test.mjs` 已经用可控的短 `timeoutMs` 把这个
契约钉死（"timeoutMs 真的按入参生效，且超时兑现成可辨认的哨兵值"），`dispatch.mjs`
这边只是消费同一个从 `semaphore.mjs` 导出的 `TIMED_OUT` Symbol，不存在拼写或引用
不一致的空间，重新烧 15 秒去跑一遍纯属重复覆盖。

## 一处需要判断的事：`createActiveEffect` 时 `effect.statuses` 是否已填好

**结论：一定已经填好，不是风险。**

`statuses` 是 `ActiveEffectData` 的 schema 字段（`common/documents/active-effect.mjs`
的 `new fields.SetField(...)`），意味着它随文档构造从 `_source` 数据里同步派生，
不是任何异步或延迟计算的产物。核对了 Crucible 自己的
`CrucibleActiveEffect#_preCreate`（`module/documents/active-effect.mjs`）：

```js
async _preCreate(data, options, user) {
  …
  for (const statusId of this.statuses) { … }   // 同步遍历，_preCreate 阶段已可读
```

`_preCreate` 严格早于 `createActiveEffect` 钩子（后者是 `_onCreate` 之后才触发的
全局钩子）。两条产出 `statuses` 的路径——状态生成器/`_fromStatusEffect`
在 `_preCreate` 之前就把 `statuses` 写进 `effectData`，或者战斗直调的
`event.effects.push(SYSTEM.EFFECTS.corroding(...))` 原样带着——都在文档真正落地
之前就确定了这个字段。`createActiveEffect` 触发时读 `effect.statuses` 不存在"字段
还没来得及填"的竞态，`snapshotEffect`→`statusIdOf` 的 `Set` 首个兜底逻辑（Task 13
已裁决可接受）不需要额外的钩子选择或重试逻辑。因此监听 `createActiveEffect`
（而不是更早的 `preCreateActiveEffect`）是正确、足够的选择。

## `npm test` 完整输出（尾部）

```
1..277
# tests 277
# suites 0
# pass 277
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 4941.3499
```

新增的三个测试文件（`wrap.test.mjs` 7 条、`dispatch.test.mjs` 9 条、
`effects-trigger.test.mjs` 6 条，共 22 条）全部在这 277 条里，任务开始前是
255/255，净增 22、0 fail、0 skip。Task 12 的三条 persist 守卫（
`test/armory-persist.test.mjs` 的落盘判据/仓库级 socket 扫描/`endEffects` push 值
扫描）与 `test/sequencer-contract.test.mjs` 全部继续 pass——新写的
`endEffects({origin: effect.uuid}, false)` 单行写法过了仓库级行扫描守卫。
