# Task 15 报告：状态触发收尾、预览宏与聊天卡重放菜单

基线 `20c9b2b`（324/324）→ **349/349 全绿**，0 fail，0 skip。净增 25 条测试
（`test/effects-resync.test.mjs` 8 条 + `test/preview.test.mjs` 17 条）。

---

## 1. 预览宏：能力与使用方式（给 Task 16）

`game.modules.get("crucible-anim").api.preview(opts)` 与聊天框 `/canim-preview
[参数]` 是同一个调用点（`installPreview` 里聊天命令走
`mod.api.preview(opts)`，不是各自闭包一份，避免两条入口漂移）。

**用法**：GM 选中一个 token 作为施法者（必需），可选再 target 一个 token 作为
目标（不给就把施法者自己当目标）。然后：

```js
game.modules.get("crucible-anim").api.preview()                    // 全部五槽、全部规则
game.modules.get("crucible-anim").api.preview({slot: "impact"})    // 只放 impact 槽
game.modules.get("crucible-anim").api.preview({filter: "burning"}) // rule id 含 "burning" 的
game.modules.get("crucible-anim").api.preview({gap: 500})          // 每条间隔 500ms（默认 1200）
```

聊天框等价写法（`slot:impact filter:melee gap:800` 这种空格分隔
`key:value`，`:`/`=` 都认，见 `parsePreviewArgs`，`scripts/player/preview.mjs`）：

```
/canim-preview slot:persist gap:600
```

没有选中 token 会弹 `CANIM.Preview.NoToken` 警告；模组/世界任一动画开关被关掉会弹
`CANIM.Preview.Disabled`（新键，见 §4）。每条规则播放前先弹一条
`{slot} / {rule.id}` 通知，全部播完弹一条汇总（播放数 + 跳过数）。

**核心机制**（与简报参考实现的一处重要出入，见下）：对每一条被预览的规则，
`previewActionPlan`/`previewEffectPlan`（`scripts/player/preview.mjs`）把该槽的
兵库临时替换成只含这一条规则，**并把它的 `when()` 强制改写成 `() => true`**。
简报参考实现只做了"收窄成一条"，没有强制 `when()`：

- **persist 槽必挂**——12 个状态分组的 `when` 是精确 `STATUS_GROUP[statusId] ===
  group` 判等，预览用的合成 statusId 是 `"__preview__.<rule.id>"`，永远不可能等于
  任何真实状态名。不强制的话 12 个分组的 `firstMatch` 全部返回 null（这正是移交
  约束 (5) 点名的症状）。
- **action 侧同样会踩坑**，只是不那么明显：`resolve()` 一次跑完 cast/travel/
  impact/aftermath 四槽，只收窄其中一槽的 armory，不代表其它三槽会安静——它们仍会
  用完整表按合成快照正常选规则、正常产出 cue。结果是当被预览规则的 `when()` 因为
  快照缺字段（比如没设 `spell`）判负时，`plan` 依然非空（其它槽照常出内容），
  通知上写着这条规则的 id，画面播的却是别的东西——比"什么都不播"更容易骗过人工
  验收。`test/preview.test.mjs` 里"回归：不强制 when、只收窄 armory 数组"那条用例
  钉死了这个对照组（`tag.healing` 在朴素写法下 `naive` 非空但不含它自己的 cue）。

强制 `when()` 之后还有一道收尾：`plan.cues.some(c => c.rule === rule.id)`——
`build()` 仍可能因为读不到快照没有的字段（`s.spell`/`s.region` 等，典型例子是
`spell.gesture.ray`/`cone`/`pulse`/`surge`/`arrow` 这五条需要真实模板几何的姿态
规则）而抛错，被 `resolve.mjs` 的 `runBuild` 接住降级成 0 条 cue。这种情况下
`previewActionPlan`/`previewEffectPlan` 诚实返回 `null`，由 `runPreview` 记进
`skipped` 列表（`debug()` 打印到控制台，不刷屏聊天），交给 Task 16 用真实施法
上下文核对。**这不是覆盖率缺口，是预览宏这种"通用合成快照"手段的结构性边界**：
姿态/模板类规则天生需要真实的 `spell`/`region` 数据才谈得上"预览"。

## 2. 五条交接约束的落实位置

1. **`playPlan()` 对 persist 计划的返回契约**——已在 Task 14 修好
   （`scripts/player/play.mjs` 末尾，带 persist cue 的计划只 await 到序列交给
   Sequencer 为止）。预览宏因此**不会**因为直接 `await playPlan(persistPlan)`
   而挂住，但仍然不走这条捷径——见约束 (2)。
2. **新增播放点走 `runPersistAnimation`**——`scripts/player/preview.mjs` 的
   `runPreview()` 对 `s === "persist"` 分支用
   `await runPersistAnimation(标签, () => playPlan(...))`，非 persist 分支才直接
   `await playPlan(...)`。`scripts/trigger/effects.mjs` 新增的三个入口
   （`updateActiveEffect`/`sequencerEffectManagerReady`→`resyncPersist`/
   `createToken`）全部收敛到同一个 `playPersist()` 内部函数，那里面唯一的播放调用
   就是 `runPersistAnimation(...)`——没有第二处裸 `playPlan`/`runAnimation`。
3. **重建挂 `sequencerEffectManagerReady`，不是 `canvasReady`**——
   `scripts/trigger/effects.mjs:116`：`Hooks.on("sequencerEffectManagerReady", ()
   => { void resyncPersist(deps, env()); });`，注释原样保留了简报给出的源码依据
   （`sequencer.js:30881-30886` 的 `canvasReady` 会在 `initializePersistentEffects`
   里先 `tearDownPersistentEffects()` 销毁掉我们抢先播的效果，必须等它跑完再挂）。
4. **重放菜单用导出的 `planOf`，不写 `_vfxPlayback`**——
   `scripts/player/preview.mjs` 的 `installReplayMenu()`：`condition: li =>
   !!planOf(game.messages.get(li.dataset.messageId))`，直接复用
   `scripts/trigger/dispatch.mjs` 导出的 `planOf`（Task 14 已导出，两处判据同源）；
   `callback` 只 `await playFromMessage(msg)`，全文件搜索确认没有任何一行给
   `message._vfxPlayback` 赋值。`test/preview.test.mjs` 有一条用例调用真实
   `callback` 后断言该字段仍是 `undefined`。
5. **两处小修**：
   - `snapshot.statusId` 的可选链——**Task 14 已经修完**
     （`scripts/trigger/effects.mjs:27` `if (!snapshot?.statusId) return null;`），
     本任务只是确认它还在，没有回退。
   - `previewEffectPlan` 的显式降级——见上面 §1 的详细说明，落在
     `scripts/player/preview.mjs` 的 `previewEffectPlan()`：`effectUuid` 钉在
     `target.document.uuid`（而不是简报字面写的 `null`——`null` 会让
     `resolveEffect()` 的 `keepTied()` 把 `persist:true` 但 `tieTo` 为空的 cue
     整条丢弃，12 组预览全部落空，`test/preview.test.mjs` 的"回归：effectUuid
     不给真实值"一条钉死了这个对照）+ `when: () => true` 强制。用目标 token 自己
     的 uuid 作 `tieTo` 是唯一在预览语境下现成、Sequencer 能 `fromUuidSync`
     解析出来的候选，`tieToDocuments` 因此能正常注册 delete 钩子；`runPreview`
     额外在每条 persist 预览播完 `gap` 之后主动
     `Sequencer.EffectManager.endEffects({origin: tieTo}, false)`
     （`cleanupPersistPreview`），否则一次跑完 12 组会在目标身上叠 12 圈永久光环。

## 3. Task 15 新增的 persist 生命周期钩子

`scripts/trigger/effects.mjs` 在 Task 14 已有的 `createActiveEffect`/
`deleteActiveEffect` 基础上，补齐简报点名的三个入口，全部收敛到共用的
`playPersist`/`endPersist`/`syncToken`/`syncEffect`/`isPlayingPersist`：

- `updateActiveEffect`：只关心 `changed` 里出现 `disabled` 字段（GM 在 token HUD
  上 toggle 状态）。`effect.active` 翻假 → `endPersist(effect.uuid)`；翻真 →
  `syncEffect()` 给挂着这份效果的每个 token 补播。
- `sequencerEffectManagerReady` → `resyncPersist(deps, env)`（导出，供测试与
  未来复用）：`canvas.ready` 为假直接跳过；否则遍历
  `canvas.tokens.placeables`，每个 token 上全部生效中的效果各补一遍。
- `createToken`：`doc.parent.isView && doc.object` 才处理（`isView` 过滤跨场景/
  未查看场景；`doc.object` 为空是"刚创建尚未渲染"的正常瞬态，静默跳过，交给
  下一次 `sequencerEffectManagerReady` 补上）。
- `isPlayingPersist(effectUuid, token)`：`Sequencer.EffectManager.getEffects({
  origin, object: token})`，`origin` 与 `object` 必须一起过滤（linked actor 的
  两个 token 共用同一个 effect uuid，只按 origin 判会让第二个 token 永远补不上
  光环）。`playPersist()` 用它做幂等闸——`resyncPersist` 因此可以随便多调用，
  不会给已经在播的状态叠一层。

## 4. 新增的 i18n 键

`lang/zh-CN.json` / `lang/en.json` 在 Task 1 已建的 5 个设置项 + `SelfCheckFailed`
+ `Replay` + `Preview.Title`/`Preview.NoToken` 之外，本任务只新增一个键：

| 键 | zh-CN | en |
| --- | --- | --- |
| `CANIM.Preview.Disabled` | 动画已被设置关闭，预览宏不会播放任何内容。 | Animations are turned off in settings; the preview macro will not play anything. |

没有复用 `CANIM.SelfCheckFailed`（虽然文案risk一开始想偷懒这么干）——那个键的
语义是"模组自检失败、已自我禁用"，语气与"设置项正常关闭动画"不同，混用会让
GM 把一次正常的设置行为误读成模组坏了。

`test/manifest.test.mjs` 的"两份语言文件键集合完全一致"断言已验证过（新键在
两份文件里同步添加，flat key 集合逐一对应）。

## 5. 重放菜单：触发条件与 `_vfxPlayback`

`installReplayMenu()`（`scripts/player/preview.mjs`）挂 Foundry 的
`getChatMessageContextOptions` 钩子，往聊天卡右键菜单里加一条"重放动画"
（`CANIM.Replay`）：

- **触发条件**：`condition: li => !!planOf(game.messages.get(li.dataset.messageId))`。
  `planOf` 是 `dispatch.mjs` 导出的共享判据——`message?.flags?.crucible?.
  metadata?.cav ?? null`——与播放闸门（`onMessageConfirmed`）、`playFromMessage`
  自己的守卫是同一个函数，三处不会漂移。只有本模组真的给这条聊天卡产出过计划
  （`flags.crucible.metadata.cav` 非空）才会出现菜单项；Crucible 原生接管的动作
  （`flags.vfxConfig` 非空、`metadata.cav` 因此在 `wrap.mjs` 里被 `delete`
  掉）不会出现。
- **与 `_vfxPlayback` 的关系**：`callback` 只 `await playFromMessage(msg)`，
  **不**给 `message._vfxPlayback` 赋值。那个字段是 `onMessageConfirmed()` 专用的
  记忆位，唯一读它的是 Crucible 的 `CrucibleAction#confirm()`
  （`Promise.race([...,message._vfxPlayback])`，推迟 postConfirm 连锁动作）。
  重放发生在 confirm 早已结束之后，没有任何东西在等这个字段；如果重放恰好夹在
  两次确认之间去写它，会让当时正在 `await` 它的另一个 `confirm()` 提前以为动画
  播完，是纯粹的负作用没有任何收益。`playFromMessage` 本身保持无状态、可重复
  调用（Task 14 的设计不变式），重放直接复用它即可。

## 6. 无法 headless 测试的部分，交给 Task 16 怎么验

- **预览宏的实际视觉效果**：`previewActionPlan`/`previewEffectPlan` 只测到"构造
  出了正确的 FXPlan、含被预览规则自己的 cue"，画面对不对（颜色、时序、锚点）
  仍要靠人眼。Task 16 建议：`preview({slot:"persist"})` 一次过一遍 12 组状态
  颜色区分度；`preview({slot:"impact", filter:"melee"})` 核对元素分层；每个槽
  跑一遍，重点看 §1 提到的 `skipped` 控制台输出——那些是"合成快照给不出真实
  数据、必须真实施法验证"的规则（法术姿态 ray/cone/pulse/surge/arrow、
  target.blast 等），预览宏本身对它们无能为力。
- **`/canim-preview` 聊天命令的端到端行为**：`installPreview` 的 `Hooks.on
  ("chatMessage", ...)` 拦截逻辑测了（返回值、参数解析转发），但"输入命令后
  聊天框真的没有多出一条消息、且触发了正确的预览"要在真实 Foundry 聊天框里敲
  一次确认。
- **重放菜单的 DOM 接线**：`li.dataset.messageId` 这个访问方式抄自简报（V14
  AppV2 风格的裸 HTMLElement，非 jQuery），仓库里没有任何一个此前任务验证过
  `getChatMessageContextOptions` 回调收到的 `li` 到底是什么形状——这是本任务
  唯一一处没有源码交叉核对、纯粹沿用参考实现的假设。Task 16 必须先在真实
  Foundry 里对一张带动画的聊天卡右键，确认菜单项出现、点击后动画重放、`li`
  的形状与假设一致；如果不一致，症状会是"菜单要么不出现、要么点了报
  `Cannot read properties of undefined (reading 'messageId')`"。
- **`resyncPersist` 的三个真实触发时机**（F5 重载、切场景往返、中途进场）：
  `test/effects-resync.test.mjs` 用桩验证了钩子接线与 `isPlayingPersist` 的
  幂等闸，但"重载后光环真的原样出现在正确的 token 上、不多不少"仍是 Task 14
  移交时点名的验收项 #24/#25/#26/#28/#29，只能上机验证。
- **持久特效清理的 Sequencer 真实交互**：`isPlayingPersist`/`endPersist`/
  `cleanupPersistPreview` 都调了真实 `Sequencer.EffectManager` 的方法名，但
  headless 测试只桩了接口形状（`getEffects`/`endEffects` 的调用参数），不模拟
  Sequencer 内部真实的 `VisibleEffects` 状态机——多次 `resyncPersist()` 之间
  "本地已经在播的不叠层"这条在**真实 Sequencer** 里成不成立，测试桩证明不了，
  只证明了"我们查询的过滤条件是对的"。

## 7. `npm test` 完整输出（尾部）

```
1..349
# tests 349
# suites 0
# pass 349
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 15419.124967
```

新增 25 条（`test/effects-resync.test.mjs` 8 条：`updateActiveEffect` 2 条、
`createToken` 3 条、`sequencerEffectManagerReady`/`resyncPersist` 3 条；
`test/preview.test.mjs` 17 条：`previewActionPlan` 4 条、`previewEffectPlan`
3 条、`parsePreviewArgs` 4 条、`installReplayMenu` 2 条、`installPreview` 3 条，
另 1 条为回归对照组），任务开始前 324/324，净增 25、0 fail、0 skip。

回归确认（全部包含在上面的 349 条里，逐一单独重跑过一次交叉验证）：
- `test/manifest.test.mjs`（含"两份语言文件键集合完全一致"）：5/5
- `test/armory-persist.test.mjs`（Task 12 三条 persist 落盘/socket/push 守卫）：
  全 pass
- `test/play-contract.test.mjs`（32 例）+ `test/sequencer-contract.test.mjs`
  （13 例）：全 pass
- `test/native-boundary.test.mjs`（Task 14 边界断言）：全 pass
- `test/coverage.test.mjs`（降级率 < 15% 阈值）：pass

## 8. 改动文件清单

- `scripts/trigger/effects.mjs`（修改）——补齐 `updateActiveEffect`/
  `sequencerEffectManagerReady`/`createToken` 三个钩子，新增导出
  `resyncPersist`，`createActiveEffect`/`deleteActiveEffect` 原有逻辑重构成共用
  的 `playPersist`/`endPersist`/`syncToken`/`syncEffect`/`isPlayingPersist`
- `scripts/player/preview.mjs`（新建）——`installPreview`/`installReplayMenu`/
  `previewActionPlan`/`previewEffectPlan`/`parsePreviewArgs`
- `scripts/main.mjs`（修改）——`ready` 钩子里新增
  `installPreview(deps)`/`installReplayMenu()` 两行挂载
- `lang/zh-CN.json` / `lang/en.json`（修改）——新增 `CANIM.Preview.Disabled` 一键
- `test/effects-resync.test.mjs`（新建）——8 条
- `test/preview.test.mjs`（新建）——17 条
