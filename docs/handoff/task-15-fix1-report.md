# Task 15 — 修复轮 1/5 报告

**基线** HEAD `baab93a`，350/350
**交付** 387/387 通过（+37 条），工作树干净
**范围** 简报 A/B/C/D/E/F 六组 + 控制者追加的 G 组，全部落地

---

## 与简报不符的三处（新发现，未默默跳过）

简报 F 的缺口表把三条规则列成「快照多样性不够、缺 fixture」，并给出了对应的快照要求。
逐条读源码之后：**这三条的分类条件写在 `when()` 里，`build()` 一律是无条件 `() => null`**，
任何 fixture 都不可能让它们产出 cue。

| 规则 | 简报说的拦截点 | 实际 |
|---|---|---|
| `cast/strike.melee.heavy` | 「build() 拦 category ∈ heavy1/heavy2/balanced2」 | 那是 `when()`。`armory/cast.mjs:157-161` 的 `build: () => null`，注释写明「起手不出内容，蓄力感由 travel 段的挥击弧线承担」 |
| `travel/target.blast` | 「build() 拦 target.type==="blast"」 | 那是 `when()`。`armory/travel.mjs:479-483` 的 `build: () => null`，注释写明「没有飞行段，全部交给 impact」 |
| `aftermath/generic.aftermath` | 「兜底，被上面挤掉」 | 不是被挤掉——`previewActionPlan` 本来就把这一槽收窄成它一条。`armory/aftermath.mjs:181-185` 的 `build: () => null`，注释写明 aftermath 允许「这个动作没有 S4 内容」 |

处理：把它们与 `persist/status.silent` 归为同一类，列进 `ALWAYS_SILENT` 豁免表，
**并加了一条反向守卫**——拿每一份 fixture 轮流喂给这四条，断言它们在任何一份下都仍然为空。
豁免不是免检：某条其实能出画面就会红，逼着从表里挪走。

简报里「12 个缺口」与「缺 11 条」本身也对不上；实测缺 12（含 status.silent）。
真正可修的是 8 条，修完 **36/40，剩下 4 条全是设计上恒空的**。aftermath 从 0/5 变成 4/5
（治疗 / 击杀 / 士气 / 地面残留四条全部可预览，只有恒空的 `generic.aftermath` 仍为空）。

### 另一处顺带核出来的事实（**未修，超出本轮范围**）

`aftermath.kill` 的触发判据是 `target.effects.includes("dead")`，而 `target.effects` 来自
`event.effects`。查遍 Crucible：`dead` 不是经 `event.effects` 加的，而是
`CrucibleActor#applyResourceStatuses`（`documents/actor.mjs:2926`
`await this.toggleStatusEffect("dead", {active: this.system.isDead})`）在资源结算之后
单独 toggle 的。也就是说**这条规则在实战里大概率一次都不会命中**。
本轮只让它「预览得出来」（简报要求的），没有改它的触发条件——那是规则语义变更，
需要单独定夺。建议列进下一轮。

---

## A【Critical｜结构性】钩子提前到 `init`

### 改了什么

`scripts/main.mjs` 拆成两段：

```
init : registerSettings()
       installReplayMenu(isActive)      ← getChatMessageContextOptions
       installPreviewCommand()          ← ChatLog.CHAT_COMMANDS
       installPersistResync(liveDeps)   ← sequencerEffectManagerReady
ready: selfCheck() → 装配 deps → installWrap/installDispatch/
       installEffectTriggers/installPreview → state.deps=deps → state.active=true
       → flushPersistResync()
```

- `state` 增加 `deps` 字段，并导出两个读取器：`isActive()`、`liveDeps()`。
  `liveDeps()` **只在 `state.active` 为真时**才交出依赖——这就是「自检禁用时提前注册的
  钩子必须自己短路」的唯一落点，不必每个回调各写一遍判断。
- **selfCheck 与自我禁用逻辑没有提前**（简报明确要求）。init 阶段 `crucible` 尚未就位，
  提前只会误判；已有一条测试钉住「init 时 crucible 缺席也不得报自检失败」。

### 两种到达顺序

`trigger/effects.mjs` 新增模块级 `wiring = {getDeps, pendingResync}`：

- **钩子先到**（线上真实顺序）→ `getDeps()` 还是 null → 记 `pendingResync` → main.mjs 在
  `state.active = true` **之后**调 `flushPersistResync()` 补跑一次。
- **deps 先好** → `getDeps()` 直接给出依赖 → 钩子照常处理。
- **模组被禁用** → `getDeps()` 恒 null → 钩子什么都不做，`flushPersistResync()` 也是空操作。

每次 `installPersistResync()` 都把 `pendingResync` 清零，同进程内反复重装不串味。

`flushPersistResync()` 的调用点在 `state.active = true` 之后——顺序反了就补不上
（`liveDeps()` 那时还返回 null）。这条顺序本身有一个专门的变异体守着。

### 静态 import 取代 6 次动态 import

init 阶段就要用 `player/preview.mjs` 与 `trigger/effects.mjs`，只能静态 import；而这两个
文件已经把 play / resolve / dispatch / snapshot 整条链拉进来了，原来那层「动态 import 兜住
脚本 404」只剩 assets / armory / wrap 三个文件仍受保护，保护名存实亡。
改成全静态后 404 的表现从「半装配」变成「整个模组加载失败」——而半装配恰恰是最坏的那种
（installWrap 成功、后几个失败 = 计划照写进每张聊天卡却永远没人播）。理由写进了代码注释。
`ready` 段的整体 try/catch 保留，失败时把 `state.deps` 置回 null、`active` 置回 false。

### 上游依据（都写进了源码守卫，不是注释里的空口）

`test/source-tables.test.mjs` 新增 5 条从**真实源码**解析的守卫：

- `getChatMessageContextOptions` 由 `ChatLog._onFirstRender` 里的 `_createContextMenu` 派发；
  `application.mjs` 立刻 `new ContextMenu.implementation(container, selector, menuItems, …)`；
  `context-menu.mjs` 的 `this.menuItems = menuItems;` —— 条目当场冻结。
- `game.mjs` 的 `initializeUI()` → `await documentIndex.index()` → `await canvas.initializing`
  → `Hooks.callAll("ready")` 顺序。
- Sequencer 里 `Hooks.callAll("sequencerEffectManagerReady")` **全仓仅一处**，在
  `initializePersistentEffects()` 末尾，而该函数第一件事是 `await tearDownPersistentEffects()`
  （「不能改挂 canvasReady」的理由）。

任何一条前提被上游改掉，测试先红。

---

## B【Important】`resyncPersist` 绕过 `animationsEnabled()`

闸门收敛到**唯一落点** `playPersist()` 的第一行，同时把 `createActiveEffect` /
`updateActiveEffect` / `createToken` 三处调用方各自那份检查删掉。理由：这个文件的既有原则
就是「什么时候该播只有一处实现」；分散在入口上正是本次漏掉 resync 那条路的原因，而且分散
之后没有任何单一变异体能验证守卫强度。

顺带一处刻意的行为变化：`updateActiveEffect` 的**收尾**分支（`endPersist`）不再受开关约束。
关掉动画开关不该顺带把已经画在画布上的光环的清理入口一起关掉。

测试：本模组开关关 / Crucible `enableVFX` 关 / 三个入口一起关 —— 三条 0 断言，
**外加一条对照组**（都开着时同一批 token 确实播出 2 份）。没有对照组的话，
「把 resync 整个删掉」这种变异体能蒙混过关。

---

## C【Important】`/canim-preview` 改用 `ChatLog.CHAT_COMMANDS`

- 删掉 `chatMessage` 钩子 + `startsWith` 那条路。
- 新增 `installPreviewCommand()`（init 注册）与两个导出常量
  `PREVIEW_COMMAND_KEY = "canim-preview"`、
  `PREVIEW_COMMAND_RGX = /^\/canim-preview(?:\s+([^]*?))?\s*$/i`。
- rgx 按「核心已剥掉最外层 `<p>`」来写（`chat.mjs:812` 的
  `const html = message.replace(/^<p>|<\/p>$/gi, "")`，非 `isRoll` 分支匹配的就是它），
  **本模组不自己剥 HTML**。
- `fn` 返回 `false` 阻止消息发出（`chat.mjs:884-888` 的
  `const result = await fn?.call(...); if (result === false) return;`）。
- 仍经 `mod.api.preview` 转发，保持「两个入口一个调用点」；这条转发顺带就是短路：
  `api.preview` 只在 ready 装配成功后才存在，模组被禁用时给一条
  `CANIM.Preview.Unavailable` 提示并照样吞掉消息（放行会让核心抛 "Invalid command"）。
- `ChatLog.CHAT_COMMANDS` 不可用时优雅退化（返回 false + warn），不影响 `api.preview`。

测试覆盖：注册形态、`isRoll` 必须为假（否则 parse 改用 textContent，rgx 就对不上）、
ProseMirror 形态 / 裸文本形态 / 无参数形态、四种不该匹配的输入、api 缺失分支，
外加一条**回归**断言 `"<p>/canim-preview …</p>".startsWith("/canim-preview") === false`。
测试里复刻核心剥 `<p>` 那一行的 helper 由 source-tables 的 C 组守卫钉在真源码上。

---

## D【Important】`effects-resync.test.mjs:128` 空测试

`await sleep(5)` → `await afterGrace()`（`PERSIST_LEAD_MS + 150`），并补一条对照组：
同一个桩、同一份 effect，把 `changed` 换成 `{disabled: false}` 必须真的播出 1 份。
少了对照组，「这条路径整个堵死」也能让 0 断言通过。

---

## E【Minor ×4】

**E1 幂等闸在让路期/preload 期是空的** — 新增在途登记表 `inFlight`，键
`effectUuid|tokenId`（与 `isPlayingPersist` 的 origin+object 同维度，linked actor 的两个
token 不会互相顶掉）。`runPersistAnimation(...).finally(() => inFlight.delete(key))` 销账
（该函数自带 try/catch、从不 reject，finally 一定跑得到）。两条测试：让路期内连调三次
resync 只播 1 份；第一份放弃播放之后同一份仍然补得回来（防「只加不删」）。

**E2 注释与源码相反** — 已订正。HUD 点状态图标走
`TokenHUD.#onToggleEffect`（`token-hud.mjs:322-332`）→ `Actor#toggleStatusEffect`
（`actor.mjs:547-579`），发的是 `deleteEmbeddedDocuments` / `ActiveEffect.create`，
**create/delete，一次 update 都没有**。`disabled` 翻转的真实来源写清了：Crucible 的
`CrucibleBaseActorSheet.#onEffectToggle`（`base-actor-sheet.mjs:1050-1053`
`await effect.update({disabled: !effect.disabled})`），外加 ActiveEffect 配置窗与
第三方 `effect.update()`。同一段订正同步到了 `installEffectTriggers` 的文件级 docstring、
`syncEffect` 的行注释、以及 `effects-resync.test.mjs` 的文件头。

**E3 存活复检不看 `active`** — `if (!fromUuidSync(uuid))` 改成先取文档、再单独判
`!live.active`（`ActiveEffect#active` = `!disabled && !isSuppressed`），两种情形各留一条
不同的 debug。测试桩的 `fromUuidSync` 也跟着补上 `active` 字段（`test/effects-resync.test.mjs`
与 `test/persist-lane.test.mjs`）——原来返回的裸 `{uuid}` 是个现实中不存在的形状。

**E4 分支不是死代码** — 由 E2 的订正 + source-tables 的「E2 依据」守卫 + 两条
`updateActiveEffect` 用例共同确认。那条守卫还反向断言 `toggleStatusEffect` 体内不出现
`disabled:`，将来核心真的改成走 update 时会主动提醒。

顺带：把模块级的 `env()` 改名 `currentEnv()`——它与三个函数的形参 `env`（一个对象）同名，
在那些函数体里写 `env()` 会是个静默的 TypeError 陷阱，是我这轮引入的，一并消掉。

---

## F【覆盖率】预览宏 28/39 → 36/40（可修的 8 条全部修好）

`previewActionPlan(rule, slot, origin, target, env, deps, fixture = {})` 新增第 7 个参数。

**覆盖的是「动作」而不是「快照」**，这是刻意的：直接改快照可以捏出 `snapshotAction()`
永远产不出来的字段组合——预览成功了、实战照样不出画面，正是本项目栽过三次的「假成功」。
经动作层进去，`healed` / `damage` / `effects` 必须真的由事件流推导出来。事件流形状取自
源码（`event.resources` 是 `[{resource, delta, damageType, restoration}]`；`event.effects`
的 `statuses` 是字符串数组，见 `const/effects.mjs:46` 与 `models/action.mjs:2890`）。

8 份 fixture（`PREVIEW_FIXTURES`，键 `<slot>/<rule.id>`），每份要什么都从规则自己的
`build()` 守卫直接读出：

| 规则 | build() 的拦截 | fixture |
|---|---|---|
| `cast/generic.cast` | `isAttack && targets.length` | `{isAttack:false, tags:["movement"]}` |
| `travel/spell.gesture.ray` | `templateEnd(s.region)` | line 区域 + gesture ray |
| `travel/spell.gesture.cone` | `templateEnd` + `coneYScale(angle)` | cone 区域 + gesture cone |
| `travel/generic.travel` | `!s.usage.isRanged` | 远程投射物挥击 |
| `aftermath/aftermath.healing` | `!(target.healed > 0)` | `healed:6` |
| `aftermath/aftermath.kill` | `!effects.includes("dead")` | `damage:12, effects:["dead"]` |
| `aftermath/aftermath.morale` | `!target.damage` | `resource:"morale", damage:6` |
| `aftermath/aftermath.groundResidue` | `residueAnchor(s)` | cone 区域 |

模板几何**不是现编的**：`PREVIEW_REGION` 与 `tools/dump-fixtures.mjs` 的 `TARGET_REGION`
逐字段相同（新增一条交叉断言钉住），而那张表的 `angle` 又由 source-tables 直接解析
Crucible 的 `TARGET_TYPES.<key>.region.angle`。preview 侧不能 import 那个工具
（它拉了 `node:fs` / `classic-level`），所以用测试把两份钉在一起。

顺带修掉一处**同类的假成功隐患**：`previewActionPlan` 的成功判据从
`c.rule === rule.id` 收紧成 `c.rule === rule.id && c.slot === slot`。

守卫（`test/preview.test.mjs`）：

1. **主守卫**：遍历全兵库，除 `ALWAYS_SILENT` 外每条规则都必须预览出**含自己那条 cue**
   的非空计划；条数断言 36，新增规则漏配 fixture 直接红。
2. **反向守卫**：`ALWAYS_SILENT` 四条拿每一份 fixture 轮流喂，必须都仍然为空。
3. 三条被简报误列的规则，直接断言 `build.length === 0 && build() === null`。
4. `PREVIEW_REGION` ↔ `TARGET_REGION` 交叉断言。
5. aftermath 四条逐条断言 cue 落在 aftermath 槽且带素材路径。
6. 「fixture 走动作层而非直接改快照」的前提断言（默认快照的 healed/damage/effects 是空）。

`runPreview` 里的跳过日志也改了措辞：跳过的应当只有 `ALWAYS_SILENT` 那四条，出现别的 id
就说明缺 fixture。

---

## G【追加·Minor】preview.mjs 内 i18n 不一致

三处硬编码全部改走 i18n，新增 5 个键（两份语言文件键集合一致，`manifest.test.mjs` 已有断言守）：

- `CANIM.Preview.UnknownSlot`（`{slot}{slots}`）
- `CANIM.Preview.Playing`（`{slot}{rule}`）—— 保留在 `ui.notifications`：逐条预览时观看者
  必须知道正在播哪条规则，这是人工验收的一部分，不是调试输出。译文是真翻译
  （「正在播放：…」/「Now playing: …」），不是把变量拼好再套壳。
- `CANIM.Preview.Done` / `CANIM.Preview.DoneSkipped`
- `CANIM.Preview.Unavailable`（C 组的短路提示）

并新增一条**仓库级守卫**（`manifest.test.mjs`）：`scripts/` 下每一处
`ui.notifications.{info,warn,error}(...)` 的参数里，出现的每一个字符串字面量都必须是
`CANIM.` 开头的 i18n 键。模板串与任何裸文案都会落网。为过这条守卫，
`SLOTS.join(", ")` 的分隔符提到了调用外的局部变量。

---

## 变异验证（20 个变异体，全部 RED）

每条新增/修改的守卫都做了变异：把被测的那一行改坏，确认测试**变红**。

| # | 变异内容 | 结果 |
|---|---|---|
| 1 | main.mjs 的 init 段删空（三处接线不注册） | RED |
| 2 | 三处接线搬回 ready 段 | RED |
| 3 | `installPersistResync` 里去掉 `wiring.pendingResync = true` | RED |
| 4 | `flushPersistResync()` 提到 `state.active = true` **之前** | RED |
| 5 | `sequencerEffectManagerReady` 的 `Hooks.on` 变成不可达 | RED |
| 6 | 重放菜单 `visible` 去掉 `active() &&` | RED |
| 7 | `playPersist` 去掉 `if (!animationsEnabled()) return;` | RED |
| 8 | 不往 `ChatLog.CHAT_COMMANDS` 写条目 | RED |
| 9 | 命令 `fn` 返回 `true` 而不是 `false` | RED |
| 10 | `PREVIEW_COMMAND_RGX` 改成匹配未剥 `<p>` 的原串 | RED |
| 11 | api 缺失分支返回 `undefined`（放行给核心） | RED |
| 12 | 删掉 `if (!("disabled" in changed)) return;` | RED |
| 13 | 删掉 `if (inFlight.has(key)) return;` | RED |
| 14 | 删掉 `.finally(() => inFlight.delete(key))`（只加不删） | RED |
| 15 | 删掉让路后的 `if (!live.active)` 复检 | RED |
| 16 | `previewActionPlan` 忽略 fixture（恒用默认快照） | RED |
| 17 | 成功判据去掉 `&& c.slot === slot` | RED |
| 18 | 把一条真能出画面的规则（`cast/tag.healing`）塞进 `ALWAYS_SILENT` | RED |
| 19 | 把 `CANIM.Preview.Playing` 改回模板字符串 | RED |
| 20 | 从 `lang/en.json` 删一个键 | RED |

变异脚本在 scratchpad（`mutate.py`），每次改完自动还原；运行前后工作树一致、387/387。

---

## 全局约束自查

- **只补空缺**：`wrap.mjs` 的 `if (nativeConfig) return null` 一个字没动。
- **禁 Sequencer socket**：`endEffects(..., false)` 两处未改；`armory-persist.test.mjs`
  的仓库级扫描照常通过。
- **素材路径**：本轮**没有引入任何新素材路径**（F 组只改快照，不改规则的 `ctx.pick`）。
- **提交信息**：单主题行，无正文，无 Claude/AI 字样。
- **无关重构**：唯一一处非缺陷驱动的改动是 `env()` → `currentEnv()` 改名，而那个同名
  陷阱是本轮引入的，属于收尾。动态 import → 静态 import 是 A 组的直接后果，理由写进注释。

## 遗留

1. `aftermath.kill` 在实战里可能永不触发（见上）——本轮只让它可预览，未改触发条件。
2. `aftermath.kill` / `impact` 里 objectScale 1/3 的推导前提在 Task 12 已被推翻，
   原注释标了「本轮只记录不改」，仍未改。
3. 渲染效果本身仍未上机验证——本轮把 aftermath 四条从「谁都没见过」变成「预览宏能放出来」，
   真正看一眼仍属 Task 16。
