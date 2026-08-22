# Task 14 修复落地报告

四组设计规格（token-geometry / persist-queue / dispatch-lifecycle / residual）统一落地。
基线 `e6c5b1b` 277/277 → **324/324 全绿**，0 skipped，全量 10.2s。

---

## 0. 一句话结论

四组共 27 条评审发现里，本轮**落地 20 条、驳回 3 条、登记不做 4 条**。全部涉及
Foundry / Crucible / Sequencer API 的判据我都自己 `sed -n` 打开源码复核过；复核
**推翻了规格里的 3 处细节**（见 §5），另外发现规格自己没提的 2 个坑（helper 放
`test/` 会污染测试计数、`freezeRandom` 有一个规格没给测试的存活变异体）。

---

## 1. 各组落地了什么

### 1.1 token-geometry（Critical-1，全部落地）

| 文件 | 改动 |
| --- | --- |
| `scripts/trigger/snapshot.mjs` | `tokenGeom()` 重写：`token?.document ?? token` 归一化两种形状，之后只读文档 API（`getCenterPoint()` / `getSize()` / `width` / `height` / `elevation` / `id` / `uuid`），保留 `gridSize` 手算兜底 |
| `tools/token-mocks.mjs`（新） | `tokenDoc()` / `tokenPlaceable()` 两个工厂，每个字段标注 foundry 源码行号 |
| `test/snapshot.test.mjs` | 13 处手搓 token 字面量 → 工厂（坐标数字一个没改）；`TOKEN()` 改 `tokenPlaceable`（状态路径确实是 placeable）；动作路径那条改 `tokenDoc`；追加 4 条回归 |
| `test/wrap.test.mjs` | `mockAction` 改 TokenDocument 形状 + `targetCenter` 参数；追加 1 条端到端回归 |
| `test/effects-trigger.test.mjs` | `token()` 改 `tokenPlaceable`；追加 1 条对照组 |

**48 格环形扫描复算**（origin 固定 (500,500)，7×7 去心方阵）：

```
修复前：adjacent 真 48 / 假 0    ；onLeft 真 0  / 假 48
修复后：adjacent 真 8  / 假 40   ；onLeft 真 21 / 假 27（左 21、右 21、同列 6 判假）
```

**偏离规格一处**：helper 放 `tools/token-mocks.mjs` 而不是规格写的
`test/helpers/tokens.mjs`。规格自己在 risks 第 1 条承认那会多出一条「幽灵测试」；
我实测确认（`test/helpers/h.mjs` 让 1 条变 2 条），而仓库已有明确先例——
`tools/fake-sequencer.mjs` 的文件头就写着「放 tools/ 而不是 test/：`node --test test/`
会把 test/ 下所有 .mjs 当测试文件跑」。基线计数因此是干净的 324，不是 325。

### 1.2 persist-queue（Critical-2 + 顺序倒置，全部落地）

| 文件 | 改动 |
| --- | --- |
| `scripts/player/play.mjs` | 含 persist cue 的计划不再 `await seq.play()`，接住 rejection 后立即返回；JSDoc 写明返回时机 |
| `scripts/player/semaphore.mjs` | 新增 `whenIdle()` / `whenBusy()` 两个**不占队列**的原语 + `arrivals` 通知；`run()` / `TIMED_OUT` 语义一字未动 |
| `scripts/const.mjs` | 新增 `PERSIST_LEAD_MS = 500`，取值理由与失败方向写在常量旁 |
| `scripts/trigger/dispatch.mjs` | 新增 `runPersistAnimation()` 专用通道与只读 `queueDepth()` |
| `scripts/trigger/effects.mjs` | `createActiveEffect` 改走 persist 通道；播出前加 `fromUuidSync(effect.uuid)` 存活闸；把原来那段「共用队列才能防重叠」的错误注释整段改写 |
| `tools/fake-sequencer.mjs` | 补上 Sequencer 对持久特效的真实等待语义：`sectionBlocks()` 判据、`play()` 的悬挂/兑现、`holdPlay` 选项、`unsettled` / `finishAll()` |
| `test/persist-lane.test.mjs`（新） | 14 条用例（规格给的是 13 条骨架，我拆开写成 14 条） |
| `test/sequencer-contract.test.mjs` | +1 条源码钉：把「持久序列永不 settle」锁回 Sequencer 原文 |
| `docs/DESIGN.md` §8.3 | 补写 persist 不进队列的例外与两段让路 |

**语料不变式实测**（作为提前返回那条过近似判据的依据，已写成测试）：
434 条动作计划里 persist cue **0 条**；46 条状态 fixture → 45 条计划，**全部** 1 cue /
`persist:true`。

### 1.3 dispatch-lifecycle（全部落地）

| 文件 | 改动 |
| --- | --- |
| `scripts/trigger/dispatch.mjs` | 新增导出 `planOf` / `sceneForMessage` / `onMessageConfirmed`；闸门判据从「字段还空着」(`??`) 换成「本模组确实有 plan」，并加 `if (flags.vfxConfig) return`；`sceneForMessage` 两条分支同宽严 + `{strict:false}`；`playFromMessage` 整体 try/catch；`installDispatch` 退化成一行注册 |
| `scripts/trigger/effects.mjs` | `deleteActiveEffect` 的同步 `try/catch` → `Promise.resolve().then().catch()` |
| `test/dispatch-lifecycle.test.mjs`（新） | 10 条 |
| `test/effects-lifecycle.test.mjs`（新） | 4 条 |
| `docs/DESIGN.md` | 新增「FXPlan 的落库体积」实测记录（不做处理 + 重访触发条件） |
| `.superpowers/.../task-15-brief.md` + `docs/IMPLEMENTATION-PLAN.md` | 重放菜单 condition 改用共享的 `planOf` |

### 1.4 residual（落地 9 项、驳回 3 项、登记不做 4 项）

**落地**：

- **6-0**（Important）`statusIdOf` 表外 `_id` 返回 `null` 而不是原样放行。
- **6-2**（Important）补 2 条杀死存活变异体的用例（`snapshot?.statusId` 的降级不留 error；persist 侧 warning 转发）。
- **6-5**（Minor）`resolve.mjs` 新增 `drainWarnings(ctx, onWarn)`，空计划路径也把诊断交出去；`wrap.mjs` / `effects.mjs` 注入 `onWarn`。
- **7-1**（Important）`wrap.mjs` 文件头把「抛错也接管」写成显式、有文档的选择，日志措辞升级为「本模组将接管，画风会与原生不同」。
- **7-2**（Important）新增 `test/native-boundary.test.mjs`，8 条断言把「只补空缺」这条边界钉在 Crucible 源码上。
- **2-2**（Minor）`wrap.mjs` 读世界总开关 `SETTINGS.ENABLED`（只读 world scope，fail-open），关掉时连计划都不产。
- **7-4**（Minor）不接管时 `delete this.metadata[META_KEY]`。
- **6-4 / 6-7**（Minor）`main.mjs` 挂载整体 try/catch，`state.active` 移到挂载成功之后。
- **2-4**（Minor）`freezeRandom()`：`randomRotation` / `randomizeMirrorY` 在出手端摇定成 `angle` / `mirrorY`，走**独立随机流** `ctx.rngAux`；`play.mjs` 改 `e.rotate(cue.angle)`；桩白名单补 `rotate`。
- **7-5**（Minor，部分）`cast.mjs` 的 `strike.ranged.draw` 补文档（不删规则）。
- 我自己发现的两条简报缺失：`task-16-brief.md` 补回丢失的验收 #23-35 整组 + 新增 #36-38；`task-15-brief.md` Step 3 改写成「还差什么」并补回 `resyncPersist` 五钩子生命周期。

---

## 2. 组间冲突与取舍

| 冲突点 | 处理 |
| --- | --- |
| `scripts/trigger/dispatch.mjs`：persist-queue 加 `runPersistAnimation`/`queueDepth`，dispatch-lifecycle 重写 85 行到末尾 | **一次写成**：imports 加 `PERSIST_LEAD_MS`；`semaphore` 后加 `queueDepth`；`runAnimation` 后加 `runPersistAnimation`；再接 dispatch-lifecycle 的 `planOf` / `sceneForMessage` / `playFromMessage` / `onMessageConfirmed` / `installDispatch`。两组互不覆盖 |
| `scripts/trigger/effects.mjs`：persist-queue 改 `createActiveEffect`，dispatch-lifecycle 改 `deleteActiveEffect`，residual 改 `planForEffect` | 三处不同 hunk，逐个 targeted patch，不整文件复制 |
| `scripts/trigger/snapshot.mjs`：token-geometry 改 `tokenGeom`，residual 改 `statusIdOf` | 先后两次 targeted patch |
| `scripts/player/play.mjs`：persist-queue 改末尾 `seq.play`，residual 改 `randomRotation` 那一行 | 不同 hunk |
| `test/snapshot.test.mjs` / `test/effects-trigger.test.mjs`：token-geometry 与 residual 都要改 | 按 token-geometry → residual 的顺序 targeted patch；residual 预写的整文件版本**没有采用**（它基于未改 token mock 的旧版） |
| dispatch-lifecycle 与 persist-queue 都主张改 `deleteActiveEffect` 的 `.catch()` | 按 dispatch-lifecycle 的版本落地一次，persist-queue 的 Task 15 草案里那份只作参考 |
| residual 的 Task 15 `playPersist` 用裸 `await playPlan(...)`，与 persist-queue 冲突 | **以 persist-queue 为准**：写进 task-15-brief 的是「必须继续走 `runPersistAnimation()`，不要退回 `runAnimation()` 或裸 `await playPlan(...)`」，并解释了为什么 |

---

## 3. 未采纳条目及理由

| # | 条目 | 处置 | 理由 |
| --- | --- | --- | --- |
| 6-6 | `endEffects` 被 sceneId 隐式限定在当前场景，应显式传 sceneId | **驳回**（我自己复核确认） | `_filterEffects`（sequencer.js:11694-11703）的过滤谓词只有 `effects / name / source / target / origin` 五项，**没有 sceneId 子句**；`_validateFilters` 写进去的 sceneId 只喂给 `_validateObject`。真正的范围限制来自 `SequencerEffectManager.effects ≡ SequenceManager.VisibleEffects`（11538-11540）。加 sceneId 是空操作。理由已写进 `effects.mjs` 的注释 |
| 7-5 | `strike.ranged.draw` 是死规则，应删或标注 | **部分驳回** | 它不是零覆盖（`test/armory-cast.test.mjs` 用合成快照专测），且是 7-1 那条降级路径的接盘者。只补文档，不删。顺带记下我复核时发现的、**今天就可达**的主副手分歧（我们判 `s.strikes.some(...)`，Crucible 判逐 roll 的 `usage.strikes[roll.data.strike].category`），根治要改快照结构，归 Task 10 |
| 7-1 | 「抛错时不接管」这一选项 | **不采纳该选项**，采纳「写成显式选择」 | `configureVFXEffect()` 的 for 循环确实没有 try/catch（我打开 models/action.mjs:3037-3044 确认），抛错时原生的 `vfxConfig` 局部变量整个丢掉，「没有动画」是客观结果。不接管只会让玩家在系统 bug 上再多吃一次黑屏 |
| 4-6 / 6-8 | FXPlan 体积（加体积上限 / 清理旧卡工具） | **不做，只记录** | 加上限会恰好砍掉最壮观的几条法术；清理工具与 Task 15 重放菜单直接冲突（plan 是它唯一的数据源）。已在 DESIGN 里写下实测数值、真要做时的第一步（剥默认值，实测 31.1%）与重访触发条件 |
| 7-3 | `configure: null` 显式禁画通道无从区分 | **不改代码**，用测试兜住 | 0.10.2 里 17 个姿态无一使用；`native-boundary.test.mjs` 第 5 条断言是它启用那天的第一声警报 |
| 7-0 | `!result` continue + `MISS = 0` 的潜伏塌陷 | **不改代码**，用测试兜住 | 今天 `testDefense` 不产出 MISS；守卫清单冻结在 `native-boundary.test.mjs` 第 4 条，启用当天会先红 |
| 2-1 | persist 生命周期只落地 2/5 个钩子 | **移交 Task 15**（不在本轮实现） | 它是 Task 15 的实现范围，本轮只把缺失补进简报并加上与 persist 通道的合并约束。本轮实现会与 Task 15 的 `syncToken`/`syncEffect`/`isPlayingPersist` 重复设计 |
| — | fixture 语料补 projectile / 非 HIT | **登记不做** | 434 条里只有 2 条带 `strikes`（category 只有 `balanced1`/`light1`）、`result` 只出现过 `7`。补语料要改 `tools/dump-fixtures.mjs`，超出本轮改动面 |

---

## 4. 回归复算数值（自己跑的，不是抄的）

| 项 | 数值 |
| --- | --- |
| 动作覆盖 | **434 / 434**（全部产出计划） |
| 状态覆盖 | **45 / 46**（第 46 条是 `dead`，`NO_PERSIST` 刻意静默） |
| 零目标攻击 | **53 / 53** |
| 降级次数 / 降级率 | **0 / 434 = 0.0%**（阈值 < 15%） |
| `plan.warnings` 总数（动作+状态全量） | **0** |
| travel 区域/自身姿态（cone / pulse / ray）每动作 cue 份数 | 每动作恰 1 份，>1 的有 **0** 个 |
| impact 元素层 | 12 种伤害类型 → **10 种不同视觉**（三种物理共用血溅、两种共用 jb2a.impact.012） |
| GLANCE = HIT × 0.6 | ok（`掠过是命中的六成，且结果层与元素层用的是同一个权重`） |
| persist 12 组 ΔE00 | 全部 ≥ **11.5**（`本槽不设豁免：任何一对都必须真过阈值` 同时通过） |
| stretchTo × scaleToObject 同用 | **0** 条 |
| **新增**：TokenDocument 上 48 格扫描 | `adjacent` 真 8 / 假 40；`onLeft` 真 21 / 假 27（修复前 48/0 与 0/48） |
| freezeRandom 对既有选材的影响 | 全量 1863 条 cue 的 `[动作id, rule, file]` 签名与基线 `e6c5b1b` **逐行相同，diff = 0 行**；394 条 cue 固化出具体 `angle`，残留 `randomRotation:true` / `randomizeMirrorY:true` **各 0 条** |
| FXPlan 体积（434 条） | 均值 4048 B、中位 2888、p90 7605、最大 8656（`spell.control.fan`，9 cue）；`null`/`false` 值占 cue 字节 **31.1%** |

### 4.1 变异矩阵（19 个变异体，全部被杀，无存活）

```
M1  playPlan 恢复无条件 await            → persist-lane 1, 7
M2  effects 改回 runAnimation            → persist-lane 13
M3  去掉两段让路                          → persist-lane 6, 7, 13
M4  whenBusy 去掉 pending 快路径          → persist-lane 11
M5  whenIdle 去掉超时                     → persist-lane 10
M6  whenIdle 改成占队列的 run()           → persist-lane 5, 6, 7, 8
M7  桩不再模拟 persist 悬着（Task 13 旧桩）→ persist-lane 1, 13
M8  只等 whenIdle、不等 whenBusy          → persist-lane 6, 7, 13
M9  去掉 fromUuidSync 存活闸              → persist-lane 14
M10 闸门恢复 `??`                         → dispatch-lifecycle 1
M11 闸门改无条件赋值（去守卫）             → dispatch-lifecycle 2
M12 sceneForMessage 恢复原三元            → dispatch-lifecycle 6, 7
M13 endEffects 改回同步 try/catch         → effects-lifecycle 1
M14 statusIdOf 退回 `?? id`               → snapshot 20, 21
M15 planForEffect 不注入 onWarn           → effects-trigger 5
M16 去掉 drainWarnings                    → effects-trigger 5
M17 planForEffect 裸访问 snapshot.statusId→ effects-trigger 4
M18 freezeRandom 变成恒等                 → play-contract 33
M19 play.mjs 改回 .randomRotation()       → play-contract 33
（另：tokenGeom 只认 placeable → 6 条红；tokenGeom 只认 TokenDocument → 3 条红）
```

**M18 / M19 最初是存活变异体**（规格没给 `freezeRandom` 任何测试）。我为此在
`test/play-contract.test.mjs` 追加了一条全量语料用例：断言播放层一次都不调
`.randomRotation()` / `.randomizeMirrorY()`、`.rotate()` 被调 300+ 次且实参落在
`[-360, 360]` 且非 0、同一快照重跑角度相同。加上之后两个都被杀。

---

## 5. 我自己去源码复核的结论

**逐条 `sed -n` 打开确认、与规格一致的判据**（不是抄行号）：

- `crucible/module/models/action.mjs:1541-1545` `if (token instanceof foundry.canvas.placeables.Token) token = token.document`；1719 行注释原文 `token` is a placeable from game.user.targets while this.token is a TokenDocument ✓
- `foundry/common/documents/token.mjs:480-494` `getSize()`（六边形折算 `0.75*floor + 0.5*(n%1) + 0.25`）、`505-528` `getCenterPoint()` 返回 `{x, y, elevation}` ✓
- `foundry/client/canvas/placeables/token.mjs` `get w()/get h()` 转调 `document.getSize()`、`get center()` 转调 `document.getCenterPoint()` ✓
- `foundry/client/documents/actor.mjs:286-296` `getActiveTokens` 在 `document` 为假时 `tokens.push(t.object)`，且带 `if (!t.rendered) continue` ✓
- `foundry/client/documents/token.mjs:105-107` `TokenDocument#scene` 是 `parent` 的别名（**两种对象都有 `.scene`，不能拿它当形状判据**——规格自己也纠正了这一点，我确认无误）✓
- `sequencer.js:25008-25013` `if (this._persist) totalDuration += await canvasEffectData.promise;` ✓
- `sequencer.js:15463-15476` finishPromise / `15479-15485` `endEffect()` 里 `this._resolve?.(this.data)` ✓
- `sequencer.js:15159-15161` `CanvasEffect.make` → `!inData.persist ? new CanvasEffect : new PersistentCanvasEffect` ✓
- `sequencer.js:17784` `class PersistentCanvasEffect`、`17801-17808` 覆写的 `_setEndTimeout()` **只暂停媒体不 resolve**（基类 17669-17673 会 `this._resolve(this.data); this.endEffect();`）✓
- `sequencer.js:21247-21249` `_waitAnyway`、`27769-27786` `promises.push(await section._execute())` + `Promise.allSettled` ✓
- `sequencer.js:21506-21510` `_execute()` 在 `!_shouldPlay()` 时 SKIPPED 返回 ✓
- `sequencer.js:16932-16943` tie 钩子 `const tiedDocument = fromUuidSync(uuid); if (tiedDocument)` ✓
- `sequencer.js:11626` `static async endEffects` / `11694-11703` `_filterEffects` / `11538-11540` `effects ≡ VisibleEffects` / `11817-11826` `_playEffect` ✓
- `sequencer.js:16335-16337` `this._customAngle = this.data.angle ?? 0; if (this.data.randomRotation) …twister` 与 `25044-25045` 裸 `Math.random() < 0.5` ✓；`22213` `rotate(inRotation)` 确实存在 ✓
- `crucible/documents/chat-message.mjs:42-44` `_onUpdate` 里 `flags.action && flags.vfxConfig && confirmed===true` 时**无条件**写 `_vfxPlayback` ✓
- `crucible/models/action.mjs:2670` `#applyEvents` **在前**、`2680` `message.update({confirmed:!reverse})` **在后**、`2683-2686` `Promise.race([_vfxPlayback…])` ✓
- `crucible/models/action.mjs:3495` 双重确认守卫只看 `confirmed` flag（撤销后可重新确认）✓
- `crucible/models/action.mjs:3282/3286` token uuid 与 `vfxConfig = this.configureVFXEffect()` ✓
- `crucible/models/action.mjs:3037-3044` 聚合器 `let vfxConfig = null` + `?? vfxConfig`，**确无 try/catch** ✓
- `crucible/models/action.mjs:3575-3578` `fromChatMessage` 把 `metadata` 放进 `actionContext` 后 `clone` 带进去 ✓（residual 的这条自查成立，7-4 比「纯理论」更近一步）
- `foundry/client/utils/helpers.mjs:188-198` `fromUuidSync` 对 compendium 内嵌 uuid 在 `strict` 时**同步抛错**，`strict:false` 返回 null ✓
- 无 statuses 的记账型 ActiveEffect 确实存在：`hooks/action.mjs:112` Amplify Affix、`hooks/spellcraft.mjs:45` aspect 抗性、`hooks/talent.mjs:376` Dominance、`models/action.mjs:1916` gesture 通用效果 ✓（6-0 的正当性成立）
- 全系统 `configureVFX` 实现恰好 3 处（`const/action.mjs:566`、`:794`、`hooks/action.mjs:758`），`const/system.mjs:181` 只是签名声明 ✓

**复核推翻 / 修正的 3 处**：

1. **6-6 的结论是错的**（前半句对、结论错）：`_filterEffects` 根本没有 sceneId 子句，
   显式传 sceneId 是空操作。已驳回并把理由写进代码注释。
2. **规格给的行号有小幅漂移**（不影响结论，我按实测行号写进注释）：finishPromise 是
   15463-15476 不是 15466-15476；`_validateFilters` 的 custom_error 在 11748-11761；
   `chat-message.mjs` 的 `_onUpdate` 判据在 42-44 不是 43-45；`fromUuidSync` 的 strict
   分支在 188-198 不是 194-197。
3. **persist-queue 规格里「`playIf(false)` 的 persist cue 不会挂」这条**我确认成立
   （`_execute()` 21506-21510 SKIPPED 返回），但顺带发现桩的 `sectionBlocks()` 判据里
   `argOf("persist")?.[0] === false` 这一支在本仓库永不触发（`play.mjs` 只在
   `cue.persist` 为真时调 `e.persist(true, …)`）——留着无害，是防御性的，未改。

**规格没提、我自己踩到的 2 个坑**：

1. `test/helpers/*.mjs` 会被 `node --test test/` 当测试文件跑（实测 1 条变 2 条）。
   helper 改放 `tools/`，基线计数保持干净。
2. persist 计划带 `attachTo:true`，`resolveRef` 若退化成裸坐标，`play.mjs` 会把整条
   cue 丢掉、**一条 section 都不建**。写 persist-lane 接线用例时最初被这个"通过得
   莫名其妙"骗过一次——`fromUuidSync` 桩必须为 token uuid 返回带 `.object` 的对象，
   用例里已写明这个陷阱。

---

## 6. 给 Task 15 / 16 的移交要点

### Task 15

1. **`playPlan()` 的返回契约变了，是语义 breaking change。** 对 persist 计划它的
   promise 只代表「序列已交给 Sequencer」，**不代表画面结束**。
2. **`resyncPersist` 与另外三个钩子仍然缺席**，`task-15-brief.md` Step 3 已重写成
   「还差什么」并补回参考实现（`updateActiveEffect(disabled)` /
   `sequencerEffectManagerReady` / `createToken` / `resyncPersist` / `isPlayingPersist`）。
   **新增的每一个播放点都必须走 `runPersistAnimation()`**，不要退回 `runAnimation()`
   或裸 `await playPlan(...)`——那会把 Critical-2 原样装回去。
3. **重建必须挂 `sequencerEffectManagerReady` 而不是 `canvasReady`**（sequencer.js:
   30881-30886 的 `setTimeout(setupModule, …)` → `initializePersistentEffects()` 第一件事
   就是 `tearDownPersistentEffects()`，会 destroy 掉我们抢先播的）。
4. **重放菜单**：`condition` 用已导出的 `planOf(msg)`（简报与 IMPLEMENTATION-PLAN 都已改）；
   **不要**在重放里写 `message._vfxPlayback`——那个字段只服务于 `confirm()` 的
   `Promise.race`，写进去会污染下一次「撤销 → 重新确认」的判断。
5. `playFromMessage` 必须保持**无状态、可重复调用**：「播过没有」的记忆只能留在
   `onMessageConfirmed` 里。
6. `test/persist-lane.test.mjs` 里的 token mock 已全部用 `tools/token-mocks.mjs`，
   新写用例请沿用，不要手搓字面量。

### Task 16

1. `task-16-brief.md` 此前**只有 22 项，丢了 #23-35 整组**（persist 多客户端契约与遮挡，
   含 #23 零落盘、#25 中途进场、#33 tint 真的生效）。已原样搬回，另加 #36-38。
2. **新增 #36-38 专项复验**：撤销后重新确认必须重播；postConfirm 推迟仍然生效；
   `一条动画超过 15000ms 仍未播完` 这条 warn 必须彻底消失、观感是「挥剑 → 光环」、
   AoE 多人上状态时几圈光环**同时**出现。
3. 第 12 项（「只补空缺」）的离线部分已由 `test/native-boundary.test.mjs` 的 8 条断言覆盖，
   上机只剩「原生配置非空 ⟹ 屏幕上真的有画面」，做法（`CONFIG.debug.vfx = true`）写进简报了。
4. **量一下让路窗口**：简报里贴了 `effect→confirm gap` 的探针，GM 端与玩家端各测一次
   （两者走的是不同路径：本地 await 链 vs 两条 socket 广播）。p99 逼近 500ms 就调大
   `PERSIST_LEAD_MS`（调大零代价）。
5. **六边形网格是唯一会让本轮几何改动产生数值变化的场景**：`getSize()` 对 >1 格的 token
   会把宽（或高）折算成 `0.75*floor(n)+0.5*(n%1)+0.25`，`w/h/radiusPx` 会变小。这是向
   正确方向的变化（与 placeable 的 `.w/.h` 一致），但本仓库测试与语料全是方格，抓不到。
   若目标世界是六边形，上机要肉眼确认一次大体型 token 的特效尺寸。

---

## 7. 遗留问题（本轮未处理，登记备查）

1. **fixture 语料的武器/结果覆盖近乎为零**：434 条里只有 2 条带 `strikes`
   （category 只有 `balanced1`/`light1`），`result` 只出现过 `7`（HIT）。`MISS` 塌陷与
   `strike.ranged.draw` 的主副手分歧都因此在全量覆盖测试里看不见。建议 Task 15/16 前
   给 `tools/dump-fixtures.mjs` 补 projectile 与非 HIT 语料。
2. **`strike.ranged.draw` 的主副手分歧今天就可达**（主手弓 + 副手近战、用近战出手时
   Crucible 返回 null、我们接管、一次挥剑配上弓弦音）。根治要让快照带上每条 roll 对应的
   weapon index，归 Task 10。
3. **`.temporary(true)` 的位置 ticker 广播**：`_playEffect`（11838-11875）给每枚持久特效挂
   一个 ticker 向其他客户端广播 `UPDATE_EFFECT_POSITION`，N 个客户端各播各的、各自广播，
   是一份可观的 socket 冗余。已是 Task 16 验收 #31 的内容，但值得单开一条 Minor。
4. **六边形网格下的等价变体抓不住**：若将来有人保留 `token.document ?? token` 归一化、
   却把中心改回 `doc.x + doc.width*gridSize/2` 手算，新增用例在方格网格下不会变红。
   要连这个也钉死得再加一条 `grid.isHexagonal: true` 的 mock 用例，本轮没做。
5. **`angle` 是 CUE_DEFAULTS 的新字段**，每条 cue 多约 10 字节跨网络（均值从 4003 → 4048），
   与「plan 体积」那条 Minor 方向相反，量级可忽略但登记一下。固化后
   `randomRotation` / `randomizeMirrorY` 恒为 false 却仍在下发，是留给「绕过 resolve()
   直接构造 plan」路径的兜底，严格说是冗余字段。
6. **`native-boundary.test.mjs` 把测试与 Crucible 0.10.2 的源码文本硬绑**。这是有意的
   （就是要让上游漂移变红），代价是每次升级 Crucible 必然有几条红，需要人工判读再更新
   常量表。每条断言的失败信息里都写了「先确认新出口在无动画时返回什么，再更新这张表
   ——不要直接把实测值抄进来」，但这条纪律靠的是人，不是机制。
7. **`_filterEffects` 的谓词字段集没有被钉住**。我驳回 6-6 依据的正是它当前的实现；
   若 Sequencer 将来补上 sceneId 子句，那条担心就会成立。`sequencer-contract.test.mjs`
   已有钉 Sequencer 判据的先例，值得顺手加一条——本轮没加。
8. **所有结论仍来自源码行号与离线 mock**，没有在活的 Foundry v14 + Crucible 0.10.2 里
   跑过一次真实出手。Task 16 的 #36-38 是本轮修复的直接验收。
