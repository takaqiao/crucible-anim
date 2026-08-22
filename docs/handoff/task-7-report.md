# Task 7 报告：解析器骨架、ctx 能力袋与五槽兜底兵库

**状态：完成，`npm test` 62/62 全绿，已提交。**

覆盖率断言首次转绿：434 个动作 fixture 全部解析出非空动画计划，46 个状态 fixture 全部解析出
持续特效，降级率 0.00%（阈值 15%）。中途发现一类结构性零 cue 动作，暂停上报，按裁决修正后
补了一条专门锁住该机制的回归测试，红/绿验证通过。

## 已创建的 8 个文件

| 文件 | 作用 |
|---|---|
| `scripts/resolver/context.mjs` | `createContext({assets, snapshot, seed})` 构造注入兵库 `build()` 的能力袋：mulberry32 确定性 `rng()`/`pickOne()`；`pick(dbPath, {color})` 解析素材路径（可选在颜色分支里取最近色，返回 `{file, files, hue, template, path}`）；`sound(dbPath)`；`runeColor()`/`damageColor()` 读快照的符文/伤害类型映射颜色；`geom.{sizeScale, offsetFor, adjacent, onLeft}` 几何辅助；`warn(msg)` 记警告。逐字照抄简报 Step 3，未改动。 |
| `scripts/resolver/resolve.mjs` | 五槽装配器。`resolve(snapshot, {assets, armory})`：cast 槽解析一次（锚 origin），travel/impact/aftermath 槽对每个 target 各解析一次；`firstMatch` 按 `pri` 降序取第一个 `when` 为真的规则；`normalize` 把规则返回值（单个 cue / 数组 / null）统一成补好 `CUE_DEFAULTS` 的数组。`resolveEffect(effectSnapshot, {assets, armory})` 走 persist 槽，由状态效果而非动作驱动。**按用户裁决 (1)，`resolve()` 返回的计划里加了 `region: snapshot.region ?? null` 字段**（简报原文没有；这是为 Task 13 的 `.mask()` 遮罩预留，字段名故意不叫 `regionShape`）。已核实实现见下方「`region` 字段确认」一节。`resolveEffect()` 按裁决不带 `region`。 |
| `scripts/armory/index.mjs` | `export const ARMORY = Object.freeze({cast, travel, impact, aftermath, persist})`，汇总五个槽的规则数组。 |
| `scripts/armory/cast.mjs` | S1 cast 槽兜底规则 `generic.cast`（pri 10）。**路径已按真实索引修正**为 `jb2a.cast_generic.03`。**条件已按裁决修正**：从「`isAttack` 就跳过」改为「`isAttack` 且 `targets.length > 0` 才跳过」，见下方「裁决落地」一节。 |
| `scripts/armory/travel.mjs` | S2 travel 槽兜底规则 `generic.travel`（pri 10）：远程动作给一枚中性投射物瞄向目标，近战返回 null（交给 impact）。 |
| `scripts/armory/impact.mjs` | S3 impact 槽兜底规则 `generic.impact`（pri 10）：按目标的攻击结果给通用冲击特效，`playIf` 按 `RESULT_NAME` 设置，未命中/闪避走 `.missed()`。 |
| `scripts/armory/aftermath.mjs` | S4 aftermath 槽兜底规则 `generic.aftermath`（pri 10）：仅在 `target.healed > 0` 时给治疗辉光，否则返回 null。 |
| `scripts/armory/persist.mjs` | S5 persist 槽兜底规则 `generic.persist`（pri 10）：任何状态都挂一层中性光环，`persist: true` + `tieTo: effectUuid`，保证状态移除时 Sequencer 自动清理。 |
| `test/resolve.test.mjs` | 8 个单元测试：rng 确定性、`geom.sizeScale`/`geom.offsetFor`、计划结构（`v`/`cues`）、解析确定性（同快照两次结果 `deepEqual`）、高优先级截胡低优先级、`build` 返回 null 时静默跳过槽、数值字段无 NaN/负值。逐字照抄简报。 |
| `test/coverage.test.mjs` | 6 个覆盖率断言（简报原 5 条 + 新增 1 条回归测试，见下）。**按裁决 (2)** 把简报原文的「47 个状态」改成实际的「46 个状态」（措辞与断言本身都对，因为断言遍历整个 `effects` 数组，本来就不受硬编码数字影响，只改了测试名字符串）。 |

## 裁决落地：`generic.cast` 的零目标缺口

**根因确认**：`/root/fvtt14-data/Data/systems/crucible/module/const/action.mjs` 第 563 行，`composed`
标签动作的 `initialize()` 无条件把 `usage.isAttack = true`，不看目标类型，紧接着下一行才按目标区分
`isRanged`。所以自我增益/召唤类法术（`aspect`/`ward`/`conjure`/`create` 四种 gesture，`GESTURE_TARGET`
表里分别是 `"self"`/`"self"`/`"summon"`/`"summon"`）虽然 `isAttack === true`，但从不产生 `targets` 条目。
**Fixture 是忠实的，缺陷在 `generic.cast` 自己的条件里**——它假设「攻击动作必有目标，travel/impact 会
接手」，但 travel/impact 都是按 `snapshot.targets` 循环触发的，零目标时整段循环体不会执行，cast 让路后
链路彻底断掉。

**修法**：`scripts/armory/cast.mjs` 里 `generic.cast` 的跳过条件由

```js
if (s.usage.isAttack) return null;
```

改为

```js
// 攻击动作的起手交给 travel/impact 段——但那两段都按目标循环，
// 零目标时（自我增益、召唤类法术）它们不会执行，cast 段必须自己扛。
if (s.usage.isAttack && s.targets.length) return null;
```

并在规则上方补了一段完整注释，说明 Crucible 侧 `isAttack` 判定不看目标类型的原因，避免以后有人
「优化」掉这个 `&& s.targets.length`。

## 新增回归测试

`test/coverage.test.mjs` 新增「零目标的攻击类动作必须解析出 cast cue」：从 fixture 筛出
`usage.isAttack === true && !targets.length` 的条目（实测 53 个），断言每一个的计划里都存在
`slot === "cast"` 的 cue。这条测试比笼统的「至少一个 cue」更精确——它锁的是「这类动作的 cue
具体来自 cast 段」这个机制，不是随便哪个槽出内容就算过。

### 红/绿验证（临时把条件改回 `if (s.usage.isAttack) return null;` 后的实测输出）

```
TAP version 13
# Subtest: 覆盖率：每个动作都解析出至少一个 cue
not ok 1 - 覆盖率：每个动作都解析出至少一个 cue
  ---
  error: |-
    53 个动作没有动画
    + [
    +   'evoke', 'bindArmament', 'conjureArmament', 'invisibility', 'protectiveMirage',
    +   'spell.control.aspect', 'spell.control.conjure', 'spell.control.create', 'spell.control.ward',
    +   'spell.death.aspect', ... (共 53 条)
    + ]
    - []
  ...
# Subtest: 零目标的攻击类动作必须解析出 cast cue
not ok 2 - 零目标的攻击类动作必须解析出 cast cue
  ---
  error: |-
    53 个零目标攻击动作没有 cast cue
    + [ 'evoke', 'bindArmament', 'conjureArmament', 'invisibility', 'protectiveMirage', ... ]
  ...
# pass 4
# fail 2
```

两条断言同时变红，命中同一批 53 个 id，证明这条新测试确实锁住了目标机制。改回
`if (s.usage.isAttack && s.targets.length) return null;` 后，`npm test` 62/62 全绿（详见下方最终输出）。

## 五个兜底路径的核实过程（保留完整记录，供 Task 9-12 选材参考）

按简报 Step 6 的命令核对 `data/asset-index.json` 真实结构：

```bash
node -e '
const i = JSON.parse(require("fs").readFileSync("data/asset-index.json","utf8"));
const at = p => p.split(".").reduce((o,k)=>o?.[k], i.tree);
for (const p of ["jb2a.cast_generic","jb2a.magic_missile","jb2a.impact",
                 "jb2a.healing_generic","jb2a-extras"]) {
  const n = at(p);
  console.log(p, "=>", n ? Object.keys(n).filter(k=>!k.startsWith("_")).slice(0,12) : "不存在");
}'
```

逐条核实结果：

| 兜底路径（简报原文） | 核实结果 | 采用路径 |
|---|---|---|
| `jb2a.cast_generic.abjuration` | **不存在。** `jb2a.cast_generic` 下只有 `01/02/03/dark/earth/fire/ice/sound/water`，没有 `abjuration` 子节点。全文搜索发现 `abjuration` 语义资源实际藏在 `jb2a.extras.tmfx.runes.circle.simple.abjuration`，但那是单文件叶子（无颜色分支），不适合按符文/伤害配色。改用 `jb2a.cast_generic.03`，其下有 9 个颜色分支（`blue/bluepurple/blueteal/greenpurple/greenyellow/orangeyellow/pinkyellow/purplered/white`），与 `palette.mjs` 的 `COLOR_HUE` 重合度最高，且带中性 `white`。 | **`jb2a.cast_generic.03`** |
| `jb2a.magic_missile` | 存在，直接是颜色分支节点（`blue/dark_red/green/grey/orange/purple/yellow`）。`ctx.pick` 选完颜色后 `assets.resolve("jb2a.magic_missile.<color>")` 能精确命中，色下还有按距离分的子节点（如 `05ft`），由 `assets.mjs` 的 `getEntry` 递归取代表叶子，不计入降级。 | 不改，原路径正确 |
| `jb2a.impact.004` | 存在，颜色分支为 `blue/dark_red/dark_purple/green/orange/pinkpurple/yellow`（无 `white`，但 `damageColor()` 常见返回 `null` 时兜底色 `"white"` 是灰阶语义，`pickColor` 对灰阶目标直接取 `available[0]`，不触发 bestFit 降级）。 | 不改，原路径正确 |
| `jb2a.healing_generic.burst` | 存在，颜色分支为 `bluewhite/greenorange/purplepink/tealyellow/yellowwhite`（复合色名，均不在 `COLOR_HUE` 表内）。规则里写的 `color: "green"` 在 `pickColor` 里因 `available` 过滤后为空而返回 `{color: null}`，`ctx.pick` 因此不追加颜色段，直接 `resolve("jb2a.healing_generic.burst")`，由 `getEntry` 递归取首个叶子，同样不触发 bestFit 降级。 | 不改，原路径正确（配色未生效但不算路径错误，留给 Task 12 精修） |
| `jb2a.extras.tmfx.outflow.circle.01` | 存在，是单文件叶子。`jb2a.extras` 是 `jb2a` 树下的**内部**命名空间（`tmfx/...`），与顶层模块键 `jb2a-extras`（连字符）是两个不同的东西，核对时不要混淆。 | 不改，原路径正确 |

**结论：五个兜底路径中只有 `cast.mjs` 一个写错了**（`abjuration` 分支从未存在），已修正为 `jb2a.cast_generic.03`。

## 降级率与覆盖率最终实测值

```
actions total: 434 empty: 0
divergence rate: 0.00% 0/434
effects total: 46 empty: 0
zero-target attack actions: 53   (全部有 cast cue)
```

- 修正前（`cast_generic.abjuration` 写错时）：降级率 42.6%（每个非攻击动作都立即降级）。
- 修正后：降级率 **0.00%**，远低于 15% 阈值。
- 覆盖率：434/434 动作、46/46 状态全部解析出非空计划，无一为零 cue。

## `region` 字段确认

`scripts/resolver/resolve.mjs` 第 63 行：

```js
return {v: PLAN_VERSION, seed: snapshot.seed, source: snapshot.id, region: snapshot.region ?? null, cues};
```

已实现，字段名是 `region`（不是 `regionShape`），值来自 `snapshot.region ?? null`——`snapshotAction`
（`scripts/trigger/snapshot.mjs`）已经在快照里带上了 `region: action.region?.shapes?.[0] ? ... : null`，
这里原样透传。`resolveEffect()` 按裁决不带这个字段，未加。当前没有任何测试会因为它缺失而红（正如
你提醒的那样），是纯人工核实确认，供 Task 13 使用。

## `npm test` 完整输出（最终，修复后）

```
$ npm test
...
1..62
# tests 62
# suites 0
# pass 62
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 799.850358
```

`test/resolve.test.mjs` 8 个全部通过；`test/coverage.test.mjs` 6 个全部通过（简报原 5 条 + 本次新增
的零目标 cast 回归测试）；其余既有测试文件（asset-index/assets/fixtures/manifest/palette/snapshot/
source-tables）48 个全部保持通过，无回归。

## 对简报的修正汇总

- 按用户裁决 (1)：`resolve()` 返回值加 `region: snapshot.region ?? null`；`resolveEffect()` 不加。已确认实现（见上）。
- 按用户裁决 (2)：`test/coverage.test.mjs` 里状态覆盖率测试的描述文本从「47 个状态」改成「46 个状态」（`test/fixtures/effects.json` 实际是 46 条）；未在任何地方硬编码 434/435 这两个数字（断言本身遍历整个数组，不受影响）。
- 按用户裁决 (3)：`cast.mjs` 的 `jb2a.cast_generic.abjuration` 改为 `jb2a.cast_generic.03`（核实过程见上）；其余四个路径核实后确认原文正确，未改动。
- 按协调者本轮裁决：`generic.cast` 的跳过条件从「`isAttack` 就跳过」改为「`isAttack` 且有目标才跳过」，并补充了详细注释与专门的回归测试（`test/coverage.test.mjs` 新增第 6 条）。

---

# Task 7 修复轮报告

**状态：完成，`npm test` 63/63 全绿，已提交（`b115f85`）。**

前一位实现者的评审修复因外部限额中断，工作树干净、没有留下任何改动。本轮从评审意见的两条问题
（一条 Important、一条 Minor）重新开始，另外核实了移交给 Task 12 的一条颜色配置问题。

## Important：`firstMatch` 静默吞掉规则 `when()` 异常

### 问题

`scripts/resolver/resolve.mjs` 的 `firstMatch` 捕获 `r.when(s, ctx)` 抛出的异常后直接吞掉，不留任何
痕迹。降级到下一优先级规则的行为本身是对的，但当规则里有编程错误时（例如访问 `s.spell.rune` 而
`s.spell` 为 `null`），其表现与「这条规则本来就不适用」完全无法区分——动画静默退化成兜底效果，且
没有任何线索指向出错的规则 id。Task 9-12 即将往兵库里写 40 多条规则，这个问题会变得很棘手。

### TDD 过程

先在 `test/resolve.test.mjs` 追加一条测试（第 111 行起）：构造一个 `cast` 槽的自建 armory，
高优先级（`pri: 900`）规则 `"高.抛错"` 的 `when()` 直接 `throw`，低优先级（`pri: 10`）规则
`"低.兜底"` 的 `when()` 恒真；断言：
1. 解析结果里 `cast` 槽命中的仍是 `"低.兜底"`（降级行为不变，评审已验证过这点不崩）；
2. `plan.warnings` 是数组且至少有一条；
3. 该条警告的文本包含出错规则的 id `"高.抛错"`；
4. 该条警告的文本包含槽位名 `"cast"`。

跑 `node --test test/resolve.test.mjs`，第 9 个测试（新增的这条）实际红态输出：

```
# Subtest: firstMatch 捕获 when() 抛出的异常并记录带规则 id 的警告，不静默吞掉
not ok 9 - firstMatch 捕获 when() 抛出的异常并记录带规则 id 的警告，不静默吞掉
  ---
  duration_ms: 0.734433
  location: '/root/crucible-anim/test/resolve.test.mjs:111:1'
  failureType: 'testCodeFailure'
  error: '解析结果应带 warnings 数组'
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
  expected: true
  actual: false
  operator: '=='
  ...
1..9
# tests 9
# suites 0
# pass 8
# fail 1
```

（其余 8 条既有测试，包括扩容后的数值卫生测试，本来就全绿——说明数值卫生那条的字段扩容纯粹是
测试自身的修正，不涉及实现改动，见下节。）

### 实现修复

`scripts/resolver/resolve.mjs`：

1. `firstMatch` 签名加了第四个参数 `slot`，`catch` 块里改为
   `ctx.warn(\`[${slot}] 规则 "${r.id}" 的 when() 抛出异常：${err?.message ?? err}\`)`，带上槽位名、
   规则 id、错误信息三项。
2. 三处调用点（cast 一处、travel/impact/aftermath 循环一处、persist 一处）都补上了槽位名实参。
3. `resolve()` 返回对象加 `warnings: ctx.warnings`；`resolveEffect()` 同样加。

跑 `npm test`：63/63 全绿（62 条既有 + 1 条新增）。

## Minor：数值卫生测试字段列表不全 + 一处死代码

`test/resolve.test.mjs` 原「每个 cue 的数值字段无 NaN / undefined / 负时长」测试只遍历
`["delay", "duration", "fadeIn", "fadeOut", "opacity", "objectScale"]`，漏了 `CUE_DEFAULTS` 里其余
数值字段：`zIndex`、`playbackRate`、`startTime`、`waitUntilFinished`、`extraEndDuration`、`volume`。
且 `if (k !== "waitUntilFinished")` 是死代码——该字段根本不在被遍历的列表里，条件永远为真。

修法：把字段列表扩到 `NUMERIC_FIELDS = ["delay","duration","fadeIn","fadeOut","opacity",
"objectScale","zIndex","playbackRate","startTime","waitUntilFinished","extraEndDuration","volume",
"elevation"]`（额外补了 `elevation`，虽然简报没点名，但它是 `CUE_DEFAULTS` 里默认 `null` 的数值型
字段，属于同一类漏检）。断言按字段语义分三档：
- `zIndex`：`Number.isInteger(v) && v >= 0`（非负整数）；
- `waitUntilFinished` / `elevation`：只断言 `Number.isFinite(v)`，不断言非负（前者负值表示与下一段
  重叠是有意的时序手法——`scripts/armory/travel.mjs` 的兜底规则里就写了 `waitUntilFinished: -300`；
  后者是海拔，语义上没有非负约束）；
- 其余字段：`Number.isFinite(v) && v >= 0`。

这样 `waitUntilFinished` 真正被纳入遍历后，原来的死代码条件 `if (k !== "waitUntilFinished")` 才会
第一次真正生效（现在改写成了 `NO_SIGN_CHECK` 集合判断，语义等价但不再是死代码）。

这条修法在跑测试前后都是绿的（第 8 条测试全程 `ok`，见上面红态输出片段）——说明当前兵库里的兜底
规则本来就没有违反扩容后的断言，纯粹是测试自身在补漏洞，不涉及实现改动。

## 一件不用改、只查清：`aftermath.mjs` 的 `color: "green"` 从未生效

用 `node` 直接跑通 `ctx.pick("jb2a.healing_generic.burst", {color: "green"})` 的完整链路核实：

```
pickColor -> { color: null, hue: 0 }
resolve -> {
  path: 'jb2a.healing_generic.burst',
  file: 'modules/jb2a_patreon/Library/Generic/Healing/HealingAbility_02_Regular_BlueWhite_Burst_600x600.webm',
  files: [ 'modules/jb2a_patreon/Library/Generic/Healing/HealingAbility_02_Regular_BlueWhite_Burst_600x600.webm' ],
  template: null,
  diverged: false
}
assets.warnings -> []
```

**根因确认**：`jb2a.healing_generic.burst` 下的颜色分支键是
`["bluewhite", "greenorange", "purplepink", "tealyellow", "yellowwhite"]`——全部是复合色名，没有一个
在 `scripts/resolver/palette.mjs` 的 `COLOR_HUE` 表里（该表只收录单一色名如 `green`/`blue`）。
`pickColor` 先用 `c in COLOR_HUE` 过滤 `available`，过滤后为空数组，直接返回 `{color: null, hue: 0}`。
`ctx.pick` 里 `chosen.color` 为 `null`，`if (color) {...}` 分支的赋值语句不执行，`path` 保持原始的
`dbPath`（不追加颜色段），`hue` 保持初值 `0`（不是 `chosen.hue`）。

随后 `assets.resolve("jb2a.healing_generic.burst")` 解析到的是一个**中间节点**（其下还有 5 个颜色
子节点），`bestFit` 本身不发散（`diverged: false`，因为请求路径本就在树里存在，没有走到必须猜测
的一步），`getEntry` 对中间节点按 `Object.keys(n)` 的字面顺序取第一个非 meta 键递归取代表叶子——
对象键序里 `"bluewhite"` 排第一，于是稳定落在
`modules/jb2a_patreon/Library/Generic/Healing/HealingAbility_02_Regular_BlueWhite_Burst_600x600.webm`。

**结论**：当前 aftermath 兜底规则实际播放的治疗特效固定是 **HealingAbility_02_Regular_BlueWhite_Burst
（蓝白色）**，走的是「颜色过滤后为空 → 不追加颜色段 → 中间节点取字面序第一个子节点」这条路径，
不发散、不计入降级率，`color: "green"` 参数被彻底忽略但没有任何警告或错误提示。按要求本轮不修，
已移交 Task 12（届时应在 `COLOR_HUE` 里补上复合色名的映射，或改用 `pickColor` 之外的专门逻辑处理
这类复合色分支）。

## 变更文件

- `scripts/resolver/resolve.mjs`：`firstMatch` 加 `slot` 参数并在捕获异常时 `ctx.warn`；`resolve()`/
  `resolveEffect()` 返回值加 `warnings` 字段。
- `test/resolve.test.mjs`：数值卫生测试字段列表补全、死代码修正；新增一条 `firstMatch` 异常留痕的
  回归测试。

约束核查：改动只涉及 `scripts/resolver/resolve.mjs` 与 `test/resolve.test.mjs`，未引用
`game`/`canvas`/`Hooks`/`Sequencer`/`ui`/`CONFIG` 等 Foundry 全局，未 import `scripts/trigger/**`
或 `scripts/player/**`，未使用 `Math.random()`。

## `npm test` 最终输出

```
1..63
# tests 63
# suites 0
# pass 63
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 786.163569
```

## 提交

```
b115f85 firstMatch 异常留痕并补全数值卫生测试字段
```

`git status --porcelain` 输出为空，工作树干净。
