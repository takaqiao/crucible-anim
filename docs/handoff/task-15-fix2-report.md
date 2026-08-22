# Task 15 修复轮 2 + Task 15b —— 实现报告

- 分支 `v1-implementation`，基线 `7084947`（387/387）
- 提交 `aaf6069`「修复轮2：在途登记挂到特效可被观察为止，击杀爆发改走 dead 驱动的 death 槽」
- **401/401 通过**（+3 E1、+11 Task 15b，原 387 条全部保持绿），`npm test` 36.5s
- 工作树干净（根目录 `durs.txt` 是本轮之前就存在的未跟踪文件，未纳入提交）

---

## 第一件：E1 —— `inFlight` 的空窗没有覆盖 preload 期

### 改了什么

销账不再挂在 `runPersistAnimation(...)` 的 promise 上，而是挂在一个新的
`awaitPersistVisible()` 上：**一直轮询到该特效能被 `isPlayingPersist` 观察到，或到
有界超时为止，二者先到为准**。

`scripts/trigger/effects.mjs`：

```js
inFlight.add(key);
let dispatched = false;                 // 到底有没有真的交给 Sequencer
runPersistAnimation(label, () => { …存活复检…; dispatched = true; return playPlan(…); })
  .then(() => (dispatched ? awaitPersistVisible(effect.uuid, token) : undefined))
  .catch(err => warn(…))                // 必须排在 finally 之前
  .finally(() => inFlight.delete(key));
```

```js
export async function awaitPersistVisible(effectUuid, token,
    {timeoutMs = PERSIST_VISIBLE_TIMEOUT_MS, pollMs = VISIBLE_POLL_MS} = {}) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (isPlayingPersist(effectUuid, token)) return true;
    const left = deadline - Date.now();
    if (left <= 0) return false;
    await idleSleep(Math.min(pollMs, left));
  }
}
```

四个设计选择及理由：

1. **`playPlan()` 仍然不 await persist 的 `seq.play()`** —— Task 14 的 Critical 一个字
   没动（`play.mjs:481-486` 未被本轮修改，git diff 里没有这个文件）。等待发生在触发层，
   靠**观察 Sequencer 的 VisibleEffects**，不是靠 await 那枚永不 resolve 的 promise。
2. **`dispatched` 分岔**：让路期内被移除/停用而**没有**送出的那一份立刻销账。否则
   「第一份放弃播放之后同一份仍然补得回来」（修复轮 1 的既有用例）会退化成「白等一个
   超时」。
3. **超时 `PERSIST_VISIBLE_TIMEOUT_MS = 15000`**（新增在 `const.mjs`，紧挨
   `PERSIST_LEAD_MS`）：与 `player/semaphore.mjs` 的默认超时同源，都是按「冷缓存下
   `Preloader.preload` 走网络」这个最慢环节定的。取大几乎无代价——等得久只推迟「上一次
   没播成的那份何时允许重试」；播成了的那份由 `isPlayingPersist` 挡重复，与本常量无关。
4. **轮询定时器 `unref()`**（`idleSleep`）：纯后台轮询不该成为「进程还有事要做」的理由。
   浏览器里 `setTimeout` 返回数字，`t?.unref?.()` 是空操作，Foundry 运行时行为不变；
   Node 下不加它，每一条播出过持久特效的用例都会把测试进程多挂 15 秒（已实测：留一枚
   3 秒 ref 定时器，`node --test` 就整整多等 3 秒）。理由与 `semaphore.mjs` 里那句
   「clearTimeout 不可省……在 Node 里它直接吊住事件循环」同源。

### 连带的必要改动：`resetPersistInFlight()`

在途登记现在会跨用例存活（同一进程、同样的 `t1` + 同名状态 ⇒ 键完全相同）。
**不清零会同时制造假绿和假红**，实测：加完 E1 修复后 `effects-resync` 有 7 条既有用例
变红，而 `persist-lane` 的「状态已被移除时不播」反而变成一条什么都没验证的假绿
（它断言 0 条序列，而那 0 条其实是被上一条用例留下的登记挡掉的）。

因此导出一个**只服务测试隔离**的 `resetPersistInFlight()`，在三个测试文件的桩函数
开头调用（`effects-resync` / `persist-lane` 的 `stubFoundry`、`main-wiring` 的
`reset`）。函数文档写明生产侧不得调用，理由与 `installPersistResync()` 每次都把
`pendingResync` 清零完全一样。

### 注释订正

`effects.mjs:271-278` 那句「加上 `Sequence.play()` 内部的 preload……已被覆盖」当时不成立，
现在成立了；同时把它重写成「两段空窗」的完整说明，并点明销账挂在哪。

### 新增用例（`test/effects-resync.test.mjs`）

| 用例 | 行使的是 |
|---|---|
| 让路期结束、特效尚未登记进 Sequencer 的那段窗口里，第二个入口不会叠出第二份 | 简报点名要求的那段。用一个「`play()` 之后 400ms 才把特效登记进 `getEffects`」的 Sequencer 桩（`registerAfter`），在 T≈650ms（已 `play()`、未登记，用例里对这两件事各有一条前提断言）打第二个入口 |
| 特效一登记进 Sequencer 就销账，不是死等超时 | 「二者先到为准」的前一半：登记后清掉 `playing`（模拟光环被结束但状态还在），下一次 resync 必须补得回来 |
| 特效始终没登记时，在途登记在有界超时后放行 | 「二者先到为准」的后一半。直接单测 `awaitPersistVisible({timeoutMs:250, pollMs:50})`，断言返回 false 且耗时落在 `[240, 1500)`。用例自己拿一枚 ref 定时器撑住事件循环（轮询是 unref 的，否则 `node --test` 会判定无事可做提前退出、用例被 cancel——已实测） |

### 变异验证（E1）

| 变异 | 改法 | 结果 |
|---|---|---|
| M1 | `.then(() => (dispatched ? awaitPersistVisible(…) : undefined))` → `.then(() => undefined)`（即回到「送出即销账」） | **只有**「空窗里不叠第二份」变红（2 !== 1），其余 21 条全绿 |
| M2 | 删掉轮询里的 `if (isPlayingPersist(...)) return true;`（一律等满超时） | **只有**「一登记就销账」变红 |
| M3 | `deadline = Date.now() + timeoutMs * 20`（超时形同虚设） | **只有**「有界超时后放行」变红（等了 5000ms，越过 1500ms 上界） |

三个变异体各杀一条、互不重叠，说明三条用例各自钉的是不同的性质。

---

## 第二件：Task 15b —— `aftermath.kill` 在实战中永不命中

### 采取的方案：新开一个由 `dead` 落地驱动的 `death` 槽

规则**整条迁出** aftermath 槽（不是留在原地加豁免名单），迁到新文件
`scripts/armory/death.mjs`，id 由 `aftermath.kill` 改为 `death.kill`，选材、
duration/fadeIn/fadeOut/zIndex/belowTokens 全部沿用原值（只有 `objectScale` 重新推导，
见下）。这样兵库里不再有任何「看起来正常却永不命中」的规则，而 aftermath 槽原地留一段
注释说明它去哪了、以及**不要再往 S4 里加按「目标死没死」判断的规则**。

**规则形状改吃 `EffectSnapshot`**（与 persist 槽同签名 `(e, ctx)`，`when: e => e.statusId === "dead"`），
由 `resolveEffect(snapshot, deps, slot)` 装配——`resolve.mjs` 的 `resolveEffect` 加了一个
`slot` 参数（默认 `"persist"`，所有既有调用点行为不变），另加一道「兵库没有这个槽就直接
返回 null」的防护。用真实的 `snapshotEffect()` 而不是在触发层现编一份 ActionSnapshot：
seed 由 `statusId + effectUuid` 决定，各客户端本地解析出的选材必然一致，也不违反
「不许伪造快照」那条（`preview.mjs` 里写死的原则）。

触发层 `playDeath()` 挂在 **`createActiveEffect` 这一个钩子**上，与 `playPersist` 并列。

### 逐条对硬约束

1. **只在真实状态转变时放**：`playDeath` 只被 `createActiveEffect` 的回调调用，
   `syncToken` / `syncEffect`（也就是 `resyncPersist` 与 `createToken` 的落点）一个字都
   没碰。两条专门的用例守着（见下表），并且各带一条对照组（同一个 token 身上的 burning
   光环**必须**被补上），杜绝「把 resync 删光」蒙混过关。
   顺带核实：`Actor#toggleStatusEffect` 在效果已存在时走 `if (active) return true`
   （foundry `client/documents/actor.mjs:567-568`），不会重复创建，所以一次死亡只发一次
   `createActiveEffect`。
2. **受 `animationsEnabled()` 约束**：闸只在 `playDeath` 函数体第一行这一处，钩子入口
   不重复设（与 B 组一致）。
3. **`dead` 留在 `NO_PERSIST`**，走独立一次性通道：cue 是 `persist:false`、无 `tieTo`、
   不进 `inFlight`、不查 `isPlayingPersist`、不需要 `endEffect`。三条断言分别钉住
   「death 槽出一条非 persist 的 cue」「persist 槽对 dead 仍然返回 null」「NO_PERSIST 仍含 dead」。
4. **不留永不命中的规则**：规则已整条迁走；另加一条结构守卫——剥掉注释后，
   `cast/travel/impact/aftermath` 四个动作槽的代码里不得出现 `"dead"` 字面量。

### 让路时序（一个需要复审确认的判断）

`playDeath` 走 `runPersistAnimation` 而**不是** `runAnimation`。理由：击杀爆发的触发时机
与状态光环完全一样——Crucible 先落地 ActiveEffect（`confirm()` 里的
`await this.#applyEvents({reverse})`，`models/action.mjs:2670`），后翻聊天卡的 confirmed
（:2680），所以血泊天然比造成它的那记攻击**更早**；直接播就是「先见血、后见挥剑」。
`runPersistAnimation` 的两段让路（等动作动画入队 → 等它播完）正是为这个顺序倒置准备的。
它同样不入共享队列：多个目标同时死就该同时炸，也不该占住队列。

副作用：函数名叫 `runPersistAnimation` 但现在也服务一次性 cue。没有改名（避免夹带无关
重构），在两处注释里写明了它是「由 ActiveEffect 驱动的两条通道共用的让路入口」。

另外补了一条与 `playPersist` 同判据的存活复检：让路期内这条 `dead` 被撤销
（GM 撤销那一击 → 资源回滚 → `toggleStatusEffect("dead", {active:false})` 删掉效果）
时放弃播放。后果比 persist 轻得多（照播只是画面撒谎，不会留下清不掉的东西），但代价为零。

### objectScale：按 Task 12 的口径重新推导，1/3 → 1.38

Task 12 的结论（`armory/impact.mjs` 结果层 canvas 一段）：`scaleToObject` 下
`sprite.width = 目标宽 × scale × baseScale`（已核对 `sequencer.js:17189`），源文件像素
尺寸只经宽高比参与、**不参与定尺寸**；真正决定观感的是「内容占画幅比 × objectScale」。

用 `tools/persist-occlusion.mjs` 的 `eachFrame` 逐帧实测（判据 alpha≥26 的包围盒，
取内容峰值帧）：

| 素材 | 用在哪 | objectScale | 内容占画幅（峰值帧） | 可见跨度（格宽） |
|---|---|---|---|---|
| `blfx…blood1.splatter.red` | 击杀（旧值） | 1/3 | 0.837（f27） | **0.279** |
| `jb2a.impact.ground_crack.still_frame.01` | `aftermath.groundResidue` | 1.3 | 0.887（f0，单帧） | 1.153 |
| `jb2a.healing_generic.400px.green` | `aftermath.healing` | 1.0 | 0.757（f17） | 0.757 |
| `jb2a.markers.fear.dark_purple.01` | `aftermath.morale` | 1.0 | 0.785（f41） | 0.785 |

第一行复现了原注释「实际只画到约 0.28 个格宽」这个数字，说明测法与当初记录那句话的人
一致。取与**同为地面层**的 `aftermath.groundResidue` 等可见跨度：
`1.153 / 0.837 = 1.378` ⇒ **1.38**。（顺带核实 groundResidue 那 1.3 确实有效：它锚在
裸坐标点上，`get_object_dimensions` 的兜底链末尾是 `canvas.grid.size`，所以「目标宽」
就是一格。）

**离线定不下来的那半明说了**：「1.153 格这个目标本身合不合适」——血泊该从尸体底下往外
溢出多少、`belowTokens` 之后还剩多少看得见——属于上机肉眼裁定，已写进
`task-16-carried-items.md` 第一节的 **C19**（连同看法与「两条地面层要一起看，
groundResidue 的 1.3 同样从没上机看过」）。同时在第二节加了 **C20**（击杀爆发只放一次：
切场景/拖尸体/F5 都不该重放）。

### 新增用例（`test/effects-death.test.mjs`，11 条）

§1 规则层：death 槽对 dead 出一条一次性血泊 cue（含 `persist:false`/`tieTo:null`/
`belowTokens`）；其余 45 个状态一条都不出；`dead` 仍在 NO_PERSIST 且 persist 槽返回 null；
动作四槽代码里不得出现 `"dead"`。

§2 触发层：dead 落地放一次；非 dead 不放（对照组：burning 的光环照播）；
**resyncPersist 不放**（对照组：burning 照补）；**createToken 不放**（对照组同上）；
动画开关关闭时不放；让路期内被撤销时不放；同一具 token 再死一次要再炸一次（不去重）。

### 变异验证（Task 15b）

| 变异 | 改法 | 结果 |
|---|---|---|
| D1 | 在 `syncToken` 里也调 `playDeath`（即接上 resync / createToken） | 「resyncPersist 不重放」「createToken 不重放」两条同时变红，其余 9 条全绿 |
| D2 | 删掉 `playDeath` 的 `if (!animationsEnabled()) return;` | 只有「动画开关关闭时不放」变红 |
| D3 | 删掉让路后的 `fromUuidSync(...)?.active` 复检 | 只有「让路期内被撤销时放弃播放」变红 |
| D4 | `death.kill` 的 `when` 改成恒真 | 「45 个状态一条都不出」「非 dead 不放」两条变红 |
| D5 | 往 `aftermath.mjs` 加一条读 `t.effects?.includes("dead")` 的代码 | 只有「动作四槽里不得出现 dead」变红 |

---

## 与简报事实的偏差（新发现，一处）

- 简报第二件写 `confirm()` 的 `#applyEvents()` 在 **`action.mjs:2671`**，实际调用在
  **2670**（`await this.#applyEvents({reverse})`；2704 是它的定义处）。`const.mjs` 里
  既有的注释写的就是 2670，两处原本不一致。已按 2670 统一（`armory/death.mjs`、
  `armory/aftermath.mjs` 的迁出说明）。
- 简报其余引用逐条复核**全部属实**：`snapshot.mjs:221` 的 `effects` 来自 `ev.effects`；
  `crucible/module/documents/actor.mjs:2926` 的 `toggleStatusEffect("dead", {active: this.system.isDead})`；
  `models/action.mjs:3286` 的 `actionData.vfxConfig = this.configureVFXEffect()` 位于
  `_prepareMessage()`（:3271）；`actor-base.mjs:221-223` 的 isDead 两分支；
  `actor-adversary.mjs:76-79` 的 toughness 覆写；`persist.mjs:101-112` 的 NO_PERSIST 用意；
  Sequencer `Sequence.play()` 的 `初始化 → preload → RunningSequences.add → _execute`
  顺序，以及 `_playEffect` 里 `VisibleEffects.add`（11826）紧跟 `effect.play()`。
  - 措辞上收紧了两处：`isDead` 的分支判据是 `usesReserveResources` 而不是「PC / 敌人」；
    敌人的覆写读的是 `abilities.toughness.value`。注释按源码原样写。

## 顺带修的「与代码不符的说明」

- `resolve.mjs` 的 `resolve()` 原写「五槽装配」，它实际只装配 cast/travel/impact/aftermath。
- `armory/index.mjs`、`const.mjs` 的 SLOTS、`DESIGN.md` §3.6/§6.3/§6.7/§5 目录树、
  `preview.mjs` 的 slot 列表：五槽 → 六槽，并在 §6.3 补了 S6 行与「S5/S6 都不挂在动作上、
  但 S6 只由 create 驱动」的说明。
- `docs/ASSET-NOTES.md` 血泊那一行的备注追加一句：Task 15b 起改由 death 槽使用、
  objectScale 重推为 1.38；**槽位列保留侦察时的归类**（那是侦察记录，不改写历史）。
  主表/否决表的既有守卫仍然全绿。
- `docs/IMPLEMENTATION-PLAN.md` 是历史计划文档（里面抄着当初计划的源码），**没有动**。

---

## 顾虑 / 留给复审的判断点

1. **`PERSIST_VISIBLE_TIMEOUT_MS = 15000` 的取值**。它的失败方式不对称：取大只会推迟
   「播放失败过的那一份何时允许重试」，取小才会让空窗重新出现。我按最慢环节（冷缓存
   preload）定，与信号量默认值同源。如果复审认为「播放失败后 15 秒内补不回来」不可接受，
   降到 5000 也仍然盖得住绝大多数 preload。
2. **`resetPersistInFlight()` 是一个测试专用导出**。生产代码不调用。替代方案是让每条
   用例用互不相同的 tokenId/状态名（要改十几处），或者把 inFlight 改成惰性过期（那样
   「观察到就提前放行」这条要求只能做到一半）。我选了显式归零点，函数文档写明了边界。
3. **`unref()`**。生产环境（浏览器）里是死代码。留着是因为不加它，测试进程会被后台轮询
   吊住 15 秒/条；已在文档里写明它只对 Node 宿主有意义。
4. **一次性爆发走 `runPersistAnimation`**。名字与用途现在有一点错位（它服务的是「由
   ActiveEffect 驱动、需要给动作动画让路」这个共性，不是「持久」）。没有改名以免夹带
   重构；如果复审希望改成中性名（如 `runDeferredAnimation`），那是一次纯改名。
5. **`death` 进了 `SLOTS`**。这让预览宏自动覆盖到它（`/canim-preview slot:death`），
   F 组覆盖率守卫也自动把它算进去（36 条规则总数不变，只是从 aftermath 挪到 death）。
   代价是 `SLOTS` 不再等同于「动作时间轴上的阶段」——注释里写清了后两个槽是事件驱动的。
6. **边界问题：本模组在原生 `configureVFXEffect` 返回非 null 的动作上也会放击杀爆发。**
   我判断这不违反「只补空缺」：那条约束约束的是**动作动画**，而击杀爆发与状态光环一样
   是由 ActiveEffect 驱动的、独立于动作的画面，原生 `configureVFXEffect` 从不产出这类
   内容，不存在双份。但这是一个判断，不是源码事实，列在这里请复审确认。
7. **一个本轮没修的既有窄竞态（与 E1 同族，但不在本轮范围）**：`playPersist` 的存活复检
   通过、`seq.play()` 已发出，而状态在 **preload 期间**被移除——`deleteActiveEffect` 的
   `endPersist` 此刻扫不到还没登记的特效，随后 CanvasEffect 初始化时
   `fromUuidSync(tieTo)` 又解析不到、不注册 tie 钩子，于是留下一枚清不掉的光环。这在本轮
   之前就存在，我的改动既没有制造也没有消除它。现在有了「知道特效何时登记完成」这个
   观察点，修法很直接（`awaitPersistVisible` 返回 true 之后再复检一次存活，不在了就
   `endPersist`），但那是第三件事，没有擅自加。
8. **新用例的时间余量**：两条整合用例依赖真实定时器（第二个入口打在 T≈650ms，特效
   T≈900ms 才登记，余量 250ms / 350ms）。与本仓库既有 persist 用例同一量级，但在负载很高
   的机器上仍有理论上的抖动风险。

---

# 追加一节：顾虑 7 的修复（控制者裁定后补做）

- 提交 `6562554`「补齐 E1 的镜像：特效登记完成时复检存活，收掉 preload 期被移除留下的光环」
- **404/404 通过**（上一节 401 条 + 本节 3 条），基线 387 与本轮此前新增的 14 条全部保持绿

## 缺陷复述（已复核 Sequencer 源码）

`endEffects` 只按调用那一刻的画面扫一次、扫空就直接返回：

```js
static async endEffects(inFilter = {}, push2 = true) {
  …
  const effectsToEnd = this._getEffectsByFilter(inFilter);
  if (!effectsToEnd.length) return;          // sequencer.js:11633-11634
```

于是「状态在**已 `seq.play()`、特效尚未进 VisibleEffects**」这段被移除」时：
`deleteActiveEffect` → `endPersist` 扫的是空气；等特效登记完成，再没有人来收。
Sequencer 自己的 tiedDocuments 兜底在这条路径上同样失效——CanvasEffect 初始化时
`for (let uuid of this.data?.tiedDocuments ?? []) { const tiedDocument = fromUuidSync(uuid);
if (tiedDocument) { …addHook… } }`（sequencer.js:16932-16943，已逐字核对），而文档此刻
已经没了，delete 钩子根本不注册。结果是一枚只能靠 `endAllEffects()` 或重载才消得掉的光环。

## 修法：复用 E1 那一套等待，不加第二套机械

控制者说「能收敛成同一个机制更好」——可以，而且不用硬凑：E1 已经有了「特效何时可被
观察到」这个点，镜像缺的正是在那一刻**回头看一眼状态还在不在**。所以改动只发生在
`playPersist` 已有的那条链上，`endPersist` 本身一行未动（只补了说明它为什么不该在自己
体内加等待）：

```js
.then(async () => {
  if (!dispatched) return;
  if (!await awaitPersistVisible(effect.uuid, token)) return;   // E1 的等待，原样复用
  const live = fromUuidSync(effect.uuid);
  if (live?.active) return;
  debug(`状态 ${plan.source} 在登记完成前就没了，补收一次（否则这枚光环只能靠重载消掉）`);
  endPersist(effect.uuid);                                       // 收尾也是原来那个出口
})
```

四条要求逐条对上：

- **不 await persist 的 play promise**：`play.mjs` 本轮两次提交都没被碰过；等待仍然是
  「轮询 Sequencer 的 VisibleEffects」。
- **有界**：`awaitPersistVisible` 自带 `PERSIST_VISIBLE_TIMEOUT_MS`；超时返回 false 时
  直接放弃补收（那种情形下特效本来就不可观察，`endEffects` 也匹配不到任何东西）。
- **判据与播出前的存活复检逐字相同**（`!live?.active`），所以「被删掉」与「被停用」
  两条路径一起覆盖——后者（角色卡效果页 toggle）连 Sequencer 的 tie 兜底都指望不上，
  因为那条只认 delete。
- **只在 dispatched 的那一份上跑**：没送出就没有可收的东西，不会给每一次无关的
  ActiveEffect 删除都挂一条 15 秒后台轮询。

### 顺带（控制者点名）

`dispatch.mjs` 的 `runPersistAnimation` 文档头补了一段「名字与用途」：它服务的共性是
「由 ActiveEffect 驱动、天然早于造成它的那个动作，需要让路」，不是「持久」——所以
一次性的击杀爆发也走它，名字保留只是为了不夹带重构。

## 测试

测试桩先做了一处必要升级：`stubFoundry` 的 `endEffects` 从空实现改成**真的把匹配到的
那几条从 `playing` 里摘掉**（真环境里它就是「按当下画面扫一次、扫到就结束」）。
不摘的话，「这枚光环到底收掉没有」没有观测点，只能退回去断言「endEffects 被调用过」
——而那条断言在 bug 状态下同样成立。`registerAfter` 也加了 `registered` 计数，
用来排除「压根没登记，所以下面那条断言恒真」。

| 用例 | 行使的是 |
|---|---|
| 让路期之后、登记之前被**移除**时，登记完成后要补收一次 | T≈650ms（已 `play()`、`registered === 0`，两条前提断言各钉一半）触发 `deleteActiveEffect`，断言那一次扫描确实发生（`endCalls.length === 1`）且什么都没扫到；再等到登记完成，断言 `playing` 为空且 `endCalls.length === 2` |
| 让路期之后、登记之前被**停用**时同样补收 | 同上，但走 `updateActiveEffect` 的 disabled 翻转：文档还在，tiedDocuments 更不会触发 |
| **对照组**：登记时状态仍在，不得顺手把刚播出的光环收掉 | 反向守卫。少了它，「补收」写成无条件收尾照样全绿——那等于每一枚光环刚画上就被自己收掉 |

（两条正向用例里 `world.fire(...)` 之后各加了一个 10ms 的等待：`endPersist` 把
`endEffects` 包在 `Promise.resolve().then()` 里，那次调用要过一个微任务才发出去。
第一次写的时候正是在这里假红了一次。）

## 变异验证

| 变异 | 改法 | 结果 |
|---|---|---|
| M4 | 删掉登记之后的复检与补收（回到只在 `endPersist` 里扫一次） | 「被移除」「被停用」两条镜像用例变红，对照组仍绿 |
| M5 | 补收改成无条件（不看 `live?.active`） | 对照组变红（刚播出的光环被自己收掉）；连带 E1 的两条也红——无条件收尾把「已登记」这个状态也一起抹了，正说明对照组守的东西是真的 |

## 本节遗留

- 若特效在 `PERSIST_VISIBLE_TIMEOUT_MS`（15s）之后才登记，补收同样赶不上。这是「有界」
  这条硬要求的必然代价，与 E1 那半同一个取舍。
- 工作树里另有两个**不是本轮产出**的未跟踪文件：`durs.txt`（本轮之前就在）与
  `README.md`（本轮进行中由别的进程写出，内容已按六槽描述、与本轮改动一致）。两者都
  没有纳入我的任何一次提交。
