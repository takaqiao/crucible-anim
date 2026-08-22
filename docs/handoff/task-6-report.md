# Task 6 报告：ActionSnapshot 快照层

## 文件

- 新建 `scripts/trigger/snapshot.mjs`
- 新建 `test/snapshot.test.mjs`

## 导出与作用

- `edgesIntersect(a, b): boolean` — 两个像素矩形（`{x, y, w, h}`，中心坐标+宽高）是否边缘相接或重叠（含斜相邻，容忍 1px 浮点误差）。用于判定「贴身 vs 隔格」，按边缘而非中心比较，正确处理大体型（3x3 等）token。
- `isOnLeft(a, b): boolean` — `b` 的中心 x 是否小于 `a` 的中心 x。用于决定武器挥击特效是否需要 `mirrorY`。
- `hashSeed(s: string): number` — 标准 FNV-1a 32 位哈希，确定性、非负、`< 2**32`。与 `tools/dump-fixtures.mjs` 中同名（模块私有，未导出）函数逐字节相同实现。
- `tokenGeom(token, gridSize)`（模块内部，未导出）— 从 Crucible Token 对象只读提取几何：`{tokenId, uuid, x, y, elevation, width, height, w, h, radiusPx}`。
- `snapshotAction(action, env): ActionSnapshot` — 把活的 `CrucibleAction` 压成纯数据快照：id/name/actorType/tags/target/range/cost/spell/region/strikes/origin/targets/usage/seed。对 `action.targets`（`Map<Actor, {token}>`）与 `action.eventsByTarget`（`Map<Actor, ActorEventGroup>`）只读遍历，不触碰 `game`/`canvas` 等全局；坐标在此固化为原始数值，方便 JSON 往返广播进聊天卡 flag。
- `snapshotEffect(effect, token, env): EffectSnapshot` — 把 `ActiveEffect` 压成 `{statusId, effectUuid, target, seed}`，驱动 persist 槽。

## npm test 完整输出（46/46 通过，新增 8 个属于本任务）

```
> crucible-anim@0.1.0 test
> node --test test/

TAP version 13
# Subtest: 七个素材命名空间齐备
ok 1 - 七个素材命名空间齐备
...（前 36 个测试为 Task 1-5 遗留，全部 ok，省略中间输出，完整 log 见下方尾部）...
# Subtest: edgesIntersect 认定相邻格为贴身、隔格为非贴身
ok 37 - edgesIntersect 认定相邻格为贴身、隔格为非贴身
# Subtest: 大体型 token 的贴身判定按边缘而非中心
ok 38 - 大体型 token 的贴身判定按边缘而非中心
# Subtest: isOnLeft 按中心 x 比较
ok 39 - isOnLeft 按中心 x 比较
# Subtest: hashSeed 确定、稳定、非负 32 位
ok 40 - hashSeed 确定、稳定、非负 32 位
# Subtest: snapshotAction 提取全部必填字段并固化坐标
ok 41 - snapshotAction 提取全部必填字段并固化坐标
# Subtest: targets[].damage/healed 从 event.resources 数组提取（真实事件结构，非 ev.resource.health）
ok 42 - targets[].damage/healed 从 event.resources 数组提取（真实事件结构，非 ev.resource.health）
# Subtest: 快照是纯数据，JSON 往返后完全相等
ok 43 - 快照是纯数据，JSON 往返后完全相等
# Subtest: 合成法术会带上 rune/gesture/inflection
ok 44 - 合成法术会带上 rune/gesture/inflection
# Subtest: GESTURE_TARGET 与 spellcraft.mjs 源码的 GESTURES.*.target.type 逐项一致
ok 45 - GESTURE_TARGET 与 spellcraft.mjs 源码的 GESTURES.*.target.type 逐项一致
# Subtest: STATUSES 与 statuses.mjs 源码的 statusEffects 键集合一致（46 个，不含 flanked）
ok 46 - STATUSES 与 statuses.mjs 源码的 statusEffects 键集合一致（46 个，不含 flanked）

1..46
# tests 46
# suites 0
# pass 46
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 465.743877
```

（`node --test test/snapshot.test.mjs` 单独跑也是 8/8 pass。）

## hashSeed 一致性校验

按简报 Step 5 原样运行内联对照脚本：

```
$ node -e '
import("./scripts/trigger/snapshot.mjs").then(m => {
  const local = s => { let h=2166136261; for(let i=0;i<s.length;i++){h^=s.charCodeAt(i);h=Math.imul(h,16777619);} return h>>>0; };
  for (const s of ["abc", "reactiveStrike", "spell.storm.arrow", ""])
    if (m.hashSeed(s) !== local(s)) { console.error("不一致:", s); process.exit(1); }
  console.log("hashSeed 与 fixture 生成器一致");
})'
hashSeed 与 fixture 生成器一致
```

额外做了一次更强的实证校验：直接用 `snapshot.mjs` 的 `hashSeed(id)` 重算 `test/fixtures/actions.json` 里全部 434 条 fixture 的 `seed` 字段（该字段是 `tools/dump-fixtures.mjs` 用它自己的 `hashSeed(id)` 生成的），逐条比对：

```
fixture id: reactiveStrike fixture.seed: 784530752 hashSeed(id): 784530752 match: true
total actions: 434 mismatches: 0
```

434/434 全部吻合，证明两处 `hashSeed` 实现字节级一致（`tools/dump-fixtures.mjs` 里的 `hashSeed` 是模块私有函数，未 export，故用重算 434 个真实输出值而非直接 import 来做端到端校验，比简报给的内联脚本更严格）。

按简报要求，`snapshotAction` 内部对 `hashSeed` 的调用入参有意与 fixture 不同（`` `${id}:${x},${y}:${n}` `` vs fixture 的 `id`），这是设计上的差异，未做"统一"。

## tokenGeom 与 fixture makeToken 的字段集合对比

`scripts/trigger/snapshot.mjs` 的 `tokenGeom()`：

```
elevation, h, height, radiusPx, tokenId, uuid, w, width, x, y
```

`tools/dump-fixtures.mjs` 的 `makeToken()`（对 `test/fixtures/actions.json` 里的 `origin` 字段实测）：

```
elevation, h, height, radiusPx, tokenId, w, width, x, y
```

两者字段集合完全一致，唯一差异是 `tokenGeom` 多出的 `uuid`（运行时才有，fixture 无对应活文档故不产出），符合简报预期。

## Crucible 事件流真实结构核实（重点：`ev.resource.health` 路径修正）

阅读了 `/root/fvtt14-data/Data/systems/crucible/module/models/action.mjs`（`CrucibleActionEvent` 类定义、`recordEvent`、`eventsByActor`/`eventsByTarget` getter、`_resolveEventStream` 方法）与 `dice/attack-roll.mjs`。核实结果：

**`eventsByTarget` / `eventsByActor` 的分组结构**：简报的假设是对的——`Map<CrucibleActor, ActorEventGroup>`，`ActorEventGroup` 含 `all`（该 actor 涉及的全部事件，按时间顺序）、`roll`（含骰子的事件子集）、`activation`/`actorUpdate`/`movement`（单例）、以及若干布尔汇总位。这部分简报代码未改。

**`ev.roll.data.result` / `ev.roll.data.strike` / `ev.roll.isCriticalSuccess`**：均核实为真实字段。`isCriticalSuccess` 是 `StandardCheck`/`AttackRoll` 类上的 getter（`dice/standard-check.mjs:144`），`result` 是 `AttackRollData` 字段，`strike` 是武器攻击 tag 处理器手动写入的索引（`const/action.mjs`：`roll.data.strike = i`，`i` 为该动作 `usage.strikes` 数组下标，用于区分双持/连击的第几次挥击）。这部分简报代码正确，未改。

**`ev.resource.health` —— 确认为错误路径，已修正**：

真实结构里，事件上根本没有单数的 `resource` 字段。`CrucibleActionEvent` 的资源变化字段叫 `resources`（复数），恒为**数组**：

```js
/**
 * @typedef ActionResourceDelta
 * @property {string} resource          资源标识，如 "health"/"morale"
 * @property {number} delta             带符号变化量（负=伤害/消耗，正=恢复/收益）
 * @property {boolean} [restoration]    是否为恢复性变化
 * @property {string} [damageType]      伤害类型（若有）
 */
```

且这不是原始 roll 数据的直接映射：`CrucibleAction#_resolveEventStream()`（action.mjs ~2036-2096）在角色克隆体上模拟应用每个事件的意图增量（`event.roll?.data.damage` 或已有的 `event.resources`），结算溢出/上限/约束后，把**最终实际生效的**增量写回 `event.resources`。也就是说，到聊天卡/action 可读阶段，唯一可靠的伤害/治疗来源就是 `ev.resources` 数组，按 `resource === "health"` 过滤，`delta < 0` 为伤害（`total = -delta`）、`delta > 0` 为治疗，`damageType` 直接来自该条目而非只能退回 `action.usage.damageType`。

修正后的提取逻辑（`scripts/trigger/snapshot.mjs`）：

```js
for (const ev of (group?.all ?? [])) {
  for (const r of (ev?.resources ?? [])) {
    if (r.resource !== "health") continue;
    if (r.delta < 0) {
      damage = {total: -r.delta, type: r.damageType ?? action.usage?.damageType ?? null, resource: "health"};
    } else if (r.delta > 0) {
      healed += r.delta;
    }
  }
}
```

原简报的 `const d = ev?.resource?.health ?? null;`（单数、当作对象取属性）在真实游戏环境里永远读不到值（`ev.resource` 是 `undefined`），会导致 aftermath 槽的治疗辉光永远不触发——这正是任务说明里提醒的风险，已确认命中并修正。

**mock 测试同步修正**：`test/snapshot.test.mjs` 里原本 Step1 给的 mock（`eventsByTarget` 的 `all: []`，只有 `roll` 数组、且不带 `resources`）完全没有练到伤害/治疗这条路径，是"自欺欺人"的空测试。已改为：

1. 把主测试（`snapshotAction 提取全部必填字段并固化坐标`）的 `roll` 事件对象补上真实结构的 `resources: [{resource: "health", delta: -8, damageType: "slashing"}]`，并让它同时出现在 `all` 与 `roll` 数组里（与真实 `eventsByActor` getter 的构造方式一致：同一事件对象既进 `all` 也进 `roll`），新增断言 `s.targets[0].damage` 等于 `{total: 8, type: "slashing", resource: "health"}`。
2. 新增一个专门测试 `targets[].damage/healed 从 event.resources 数组提取（真实事件结构，非 ev.resource.health）`，构造一个纯伤害目标（`delta: -6`）和一个纯治疗目标（`delta: 4, restoration: true`），分别断言 `damage`/`healed` 字段。

## 顺带发现并修正的一处测试数据 bug（超出任务要求范围，一并汇报）

简报 Step1 里"大体型 token 的贴身判定按边缘而非中心"测试用的坐标 `{x: 800, ...}` 与简报自己 Step3 给出的 `edgesIntersect` 公式矛盾：3x3 token（`w=300`）中心在 `x=500`，半宽 150，右边缘在 `x=650`；紧贴的 1x1 邻居（半宽 50）中心应在 `x=700`（650+50），而不是简报写的 `x=800`（650 到 750 之间还空一整格，按边缘公式必然判 `false`）。

用 Step3 给出的实现代码逐字实测，`assert.equal(edgesIntersect(big, {x:800,...}), true)` 确实失败（`false !== true`），证实这不是我的实现问题，是简报测试数据本身的笔误——它偏偏还违背了该测试标题自证的意图（"按边缘而非中心"：`x=700` 时中心距 200 > gridSize=100，若误用「中心距 ≤ gridSize」的简化判断会错判为不贴身，只有真正按边缘计算才能正确判定为贴身；这正是该用例想验证的东西）。已将测试坐标改为 `x: 700` 并在注释里写明推导，`scripts/trigger/snapshot.mjs` 的 `edgesIntersect` 实现本身未作任何改动（原样照抄简报 Step3）。

## 提交

```
git commit -m "ActionSnapshot 与 EffectSnapshot 快照层"
```

---

# 修复轮 1/5（复审 Important 1 & 2）

复审结论：规范符合性通过，事件流结构核实（`resources` 恒为数组、按 `delta` 符号而非 `restoration`
标注判定伤害/治疗）经复审独立回源码验证属实，贴身坐标 700 的笔误修正也确认无误。以下两条
Important 是从原始计划继承下来的真实缺陷，本轮修掉；均为继承缺陷，非本轮引入的回归。

## Important 1 — `damage` 覆盖而非累加（双持场景）

`scripts/trigger/snapshot.mjs` 里 `targets[].damage` 原来是 `=` 直接赋值，同一目标身上第二条负
`delta`（如双持角色的副手攻击）会把第一条（主手）覆盖掉，而 `healed` 却是 `+=` 累加，两者不对称。

复审指出 `crucible/module/const/action.mjs` 的 `strike` 标签 `roll(target)` 遍历
`usage.strikes.entries()`，双持角色对同一目标必然产生两个 `strike` 事件，各自带一条
`resource:"health"` 的 `delta`，因此这不是罕见边角。

**修法**：`damage.total` 改为逐条累加所有负 `delta` 的绝对值，与 `healed` 对称。`damage.type` 取
**伤害量最大的一条**决定（视觉上应由主要伤害来源决定元素层），量相同取**先出现的一条**——用严格
大于比较实现（后来者不会覆盖已记录的同量者），已在代码注释里写明这个选择及理由。

### 新测试：`双持攻击同一目标时伤害应累加，type 取伤害量最大的一条`

场景：同一目标身上两条事件，主手 `delta: -6, damageType: "slashing"`，副手
`delta: -4, damageType: "piercing"`。断言 `damage` 等于 `{total: 10, type: "slashing", resource: "health"}`。

**红态实际输出**（改实现前，`total` 被后一条覆盖成 4，`type` 也被覆盖成副手的 `piercing`）：

```
not ok 7 - 双持攻击同一目标时伤害应累加，type 取伤害量最大的一条
  ---
  error: |-
    Expected values to be strictly deep-equal:
    + actual - expected

      {
        resource: 'health',
    +   total: 4,
    +   type: 'piercing'
    -   total: 10,
    -   type: 'slashing'
      }
  expected:
    total: 10
    type: 'slashing'
    resource: 'health'
  actual:
    total: 4
    type: 'piercing'
    resource: 'health'
  operator: 'deepStrictEqual'
```

**绿态**：`ok 7 - 双持攻击同一目标时伤害应累加，type 取伤害量最大的一条`（见下方完整绿态输出）。

## Important 2 — 硬编码只认 `health`，忽略 `morale`

原实现里过滤条件写死 `r.resource !== "health"`，而 Crucible 12 个符文里 `control`/`illusion`/
`oblivion`/`soul` 四个默认打 `morale`（复审查 `const/spellcraft.mjs` 确认），这些动作的
`targets[].damage` 会永远是 `null`、`healed` 永远是 0。快照本身已经导出 `usage.resource`
字段（`action.usage?.resource ?? "health"`）却没有拿来用。

**修法**：在 `snapshotAction` 顶部算出一次
`const resourceName = action.usage?.resource ?? "health";`，下面提取伤害/治疗时按
`r.resource !== resourceName` 过滤（不重复兜底 `"health"`，兜底只在这一处做）。`damage.resource`
字段也从硬编码 `"health"` 改为实际的 `resourceName`。`healed` 按裁决保持裸数字结构不变（Task 12
的 aftermath 规则按 `target.healed > 0` 判断，不能连累它）。

### 新测试：`morale 资源动作（control/illusion/oblivion/soul 系）按 usage.resource 提取伤害，不硬编码 health`

场景：`usage.resource === "morale"`，目标事件带 `resources: [{resource: "morale", delta: -5, damageType: "psychic"}]`。
断言 `damage` 等于 `{total: 5, type: "psychic", resource: "morale"}`，且 `s.usage.resource === "morale"`。

**红态实际输出**（改实现前，硬编码只认 `health`，`damage` 永远是 `null`）：

```
not ok 8 - morale 资源动作（control/illusion/oblivion/soul 系）按 usage.resource 提取伤害，不硬编码 health
  ---
  error: |-
    Expected values to be strictly deep-equal:
    + actual - expected

    + null
    - {
    -   resource: 'morale',
    -   total: 5,
    -   type: 'psychic'
    - }
  expected:
    total: 5
    type: 'psychic'
    resource: 'morale'
  actual: ~
  operator: 'deepStrictEqual'
```

**绿态**：`ok 8 - morale 资源动作（control/illusion/oblivion/soul 系）按 usage.resource 提取伤害，不硬编码 health`。

## `damage.type` 取值策略总结

同一目标身上可能有多条命中（双持、AOE 里对同一目标叠加多次判定等），每条都带自己的
`damageType`。当前策略：**累加全部伤害量为 `total`；`type` 取造成伤害量最大的那一条对应的
`damageType`（同量取先出现的一条）**。理由：aftermath 槽的元素辉光在视觉上应该由主要伤害来源
决定，而不是简单取最后一条或第一条。实现上用严格大于比较自然达成"同量取先"（后续同量条目不会
触发覆盖）。若单条事件缺少 `damageType`，回退到 `action.usage?.damageType`，兜底逻辑与之前一致，
未改动。

## 改后 `npm test` 完整输出（48/48 通过，含本轮新增 2 个）

```
1..48
# tests 48
# suites 0
# pass 48
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 454.953943
```

（`node --test test/snapshot.test.mjs` 单独跑 10/10 全部 `ok`。）

hashSeed 一致性复测（用 434 条 fixture 重算，未受本轮改动影响）：

```
total actions: 434 mismatches: 0
```

## 本轮改动文件

- `scripts/trigger/snapshot.mjs`（`snapshotAction` 内伤害/治疗提取逻辑）
- `test/snapshot.test.mjs`（新增两条测试）

两条 Minor（`hashSeed` 未固化跨文件断言进 `npm test`；`snapshotEffect` 只取首个 status）按复审
裁决保持原状，未改动。
