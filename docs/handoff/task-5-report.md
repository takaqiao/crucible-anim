# Task 5 报告：测试 fixture 生成器

## 状态（修复轮 1 后）
DONE。评审指出的三处数据问题（`GESTURE_TARGET` 三项姿态映射错误、去重误判两个撞 id、`flanked` 误列为可赋予状态）均已核实修复，并各配一条从 Crucible 源码直接解析比对的守卫测试防回归。`npm test` 38/38 通过。首轮的 DONE_WITH_CONCERNS 已被修复轮 1 取代，详见下方"修复轮 1"一节。

## 提交
- commit `71b4128` — "测试 fixture 生成器与 432 个动作快照"（首轮，Step 1-6）
- commit `86c4bd9` — "修正法术姿态目标表与状态列表，去重改按内容签名"（修复轮 1，最终状态）

文件：
- `/root/crucible-anim/tools/dump-fixtures.mjs`
- `/root/crucible-anim/test/fixtures.test.mjs`
- `/root/crucible-anim/test/source-tables.test.mjs`（修复轮 1 新增，源码比对守卫测试）
- `/root/crucible-anim/test/fixtures/actions.json`（生成物，已入库，434 条）
- `/root/crucible-anim/test/fixtures/effects.json`（生成物，已入库，46 条）

## 执行流程（严格按简报 Step 1→6）

### Step 1-2：写失败测试并确认失败
`test/fixtures.test.mjs` 按简报原文照抄。首次运行：

```
$ node --test test/fixtures.test.mjs
...
Error: ENOENT: no such file or directory, open '/root/crucible-anim/test/fixtures/actions.json'
...
not ok 1 - /root/crucible-anim/test/fixtures.test.mjs
# pass 0
# fail 1
```
按预期失败（fixture 文件不存在）。

### Step 3：写 `tools/dump-fixtures.mjs`
按简报原文照抄，唯一改动是裁决要求的 `makeToken()` 补字段：

```js
function makeToken(pos, {width = 1} = {}) {
  return {
    tokenId: `tok-${pos.x}-${pos.y}`, x: pos.x, y: pos.y, elevation: 0,
    width, height: width, radiusPx: (width * GRID) / 2,
    w: width * GRID, h: width * GRID
  };
}
```
`w`/`h` 与 Task 6 `snapshotAction()` 的几何形状对齐（`w = width * GRID`，`h` 按裁决取 `width`（非 `height`）× `GRID`）。当前 `resolve()` 不读这两个字段，不影响任何测试通过。

### Step 4：生成 fixture 与数量核对

```
$ npm run fixtures
> node tools/dump-fixtures.mjs
actions.json: 432 个快照
effects.json: 47 个状态
```

432 < 简报预期的 435，按简报指示用给定的 node 命令核对了四个来源包的**实际动作数**（脚本口径与 `dump-fixtures.mjs` 一致：只统计 `!items!`/`!actors!` 前缀键的 `system.actions`）：

| 来源包 | 简报预期 | 实测原始动作数 | 一致？ |
| --- | --- | --- | --- |
| `systems/crucible/packs/talent` | 131 | 131 | 是 |
| `systems/crucible/packs/adversary-talents` | 46 | 46 | 是 |
| `systems/crucible/packs/spell` | 15 | 15 | 是 |
| `modules/ember/packs/crucible-adversary` | 26 | 26 | 是 |

四包原始动作数与简报表格**完全一致**（131+46+15+26=218），问题不出在抽取环节。

进一步用带追踪的独立脚本（未提交，仅用于诊断）逐条比对 `seen` 集合命中情况，定位到 **3 个真实存在的重复 `action.id`**：

| 重复 id | 首次出现 | 再次出现 |
| --- | --- | --- |
| `steamVent` | adversary-talents `!items!burnout000000000` | adversary-talents `!items!steamVent0000000`（同包内重复） |
| `invisibility` | adversary-talents `!items!naturalInvisibil` | spell `!items!invisibility0000`（跨包重复） |
| `graveMark` | adversary-talents `!items!graveMark0000000` | ember `crucible-adversary` `!items!graveMark0000000`（同一怪物在 Crucible 核心与 Ember 模组间被复用/移植，动作 id 未改名） |

去重路径：
- 打包阶段合计去重后 = 131 + 45(adversary-talents 少 1) + 14(spell 少 1) + 25(ember 少 1) = 215
- `DEFAULT_ACTIONS` 13 个 id 与包内 id 无冲突，全部计入 → 215 + 13 = 228
- 合成法术矩阵 12×17 = 204（与包无 id 冲突可能，因其 id 形如 `spell.<rune>.<gesture>`）→ 228 + 204 = **432**

这正是简报本身预告过的"同一个 action id 在不同道具上可能重复出现……属正常"的情况，只是实测重复数（3）比简报隐含假设（0）多，导致最终总数比理论上限 435 少 3。抽取逻辑、`seen` 去重逻辑均按简报原样实现，未做任何为凑数而做的修改。

**据实调整**：将 `test/fixtures.test.mjs` 中"动作 fixture 数量达到预期规模"测试的阈值从 `>= 435` 下调为 `>= 432`，并在测试代码中加注释说明上述根因（四包原始数精确匹配简报表格 + 3 个真实重复 id 的来源），阈值仍然是紧的（等于当前 fixture 生成结果的下界），不存在"放宽到无意义程度"的问题。

effects.json 按预期生成 47 个状态，与 `STATUSES` 数组长度一致，无需调整。

### Step 5：确认测试通过

```
$ node --test test/fixtures.test.mjs
ok 1 - 动作 fixture 数量达到预期规模
ok 2 - 合成法术矩阵 12 × 17 完整
ok 3 - 每个 fixture 的必填字段齐全
ok 4 - 同时覆盖贴身与隔格两种几何
ok 5 - 状态 fixture 覆盖全部 47 个状态
# tests 5
# pass 5
# fail 0
```

补充核对（未写进测试，人工验证）：
- `targets[].onLeft` 在全部 432 个 fixture 中恒为 `false`（`Set { false }`），与已裁决保留的已知情况一致，未擅自改动 `ADJACENT`/`DISTANT` 坐标或 `onLeft` 逻辑。
- `origin`/`target`/`effects[].target` 均含 `w:100, h:100`（`width:1` × `GRID:100`），与裁决的补字段要求一致。

### 完整 `npm test` 输出（36 个测试全部通过：31 个既有 + 5 个新增）

```
> crucible-anim@0.1.0 test
> node --test test/

TAP version 13
ok 1 - 七个素材命名空间齐备
ok 2 - jb2a 叶子数达到 Patreon 版实测量级
ok 3 - _template 根表存在且字符串引用能解析到锚点
ok 4 - 抽样 200 个条目的文件在磁盘上真实存在
ok 5 - 提取失败的模组被显式记录而非静默丢弃
ok 6 - extract() 对未安装的模组返回 error 而非抛出或静默通过
ok 7 - 精确路径直接命中，不降级
ok 8 - 不存在的分支降级到同级第一个可用项并记录位置
ok 9 - resolve 返回真实文件路径
ok 10 - _template 元数据随解析结果一并返回
ok 11 - 含斜杠的输入按直接文件路径原样返回
ok 12 - colorsUnder 列出某特效实际可用的颜色
ok 13 - 降级会累积进 warnings
ok 14 - 解析不出任何东西时返回 null 而不抛错
ok 15 - runtime: 精确命中返回单个对象
ok 16 - runtime: 前缀匹配多条返回数组（关键修复 C1）
ok 17 - runtime: getPathsUnder 返回 false 时处理（关键修复 I1）
ok 18 - runtime: getEntry softFail 返回 false 时处理
ok 19 - runtime 与 offline 返回值形状一致
ok 20 - 动作 fixture 数量达到预期规模
ok 21 - 合成法术矩阵 12 × 17 完整
ok 22 - 每个 fixture 的必填字段齐全
ok 23 - 同时覆盖贴身与隔格两种几何
ok 24 - 状态 fixture 覆盖全部 47 个状态
ok 25 - module.json 字段完整且与常量一致
ok 26 - 清单引用的每个文件都存在
ok 27 - 两份语言文件键集合完全一致
ok 28 - 常量自洽
ok 29 - resolver 与 armory 不得引用 Foundry 全局
ok 30 - 12 个符文全部有配色
ok 31 - 12 个伤害类型全部有条目，物理三种为 null
ok 32 - hueDelta 走最短弧且带符号
ok 33 - pickColor 在实际可用颜色中取最近色并给出补偿量
ok 34 - 特效没有任何颜色分支时返回空颜色且不补偿
ok 35 - 映射值可达性：12个符文+9个伤害类型的配色都能精确命中至少一条路径
ok 36 - COLOR_HUE键的可达性：每个键至少在某个colorsUnder结果里出现
1..36
# tests 36
# suites 0
# pass 36
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

### Step 6：提交

```
$ git add -A
$ git commit -m "测试 fixture 生成器与 432 个动作快照"
[v1-implementation 71b4128] 测试 fixture 生成器与 432 个动作快照
 4 files changed, 226 insertions(+)
```

`npm run fixtures` 重跑后与已提交的 `actions.json`/`effects.json` 逐字节一致（`git status` 为 clean），确认生成过程确定性（`hashSeed` 无随机性依赖）。

## 数据汇总

| 项 | 数值 |
| --- | --- |
| talent 原始动作数 | 131 |
| adversary-talents 原始动作数 | 46 |
| spell 原始动作数 | 15 |
| ember crucible-adversary 原始动作数 | 26 |
| 四包原始动作数合计 | 218 |
| 四包去重后（3 个重复 id 被吸收） | 215 |
| DEFAULT_ACTIONS | 13（与包无冲突，全计入） |
| 合成法术矩阵 12×17 | 204 |
| **actions.json 最终总数** | **432** |
| effects.json 状态数 | 47（符合预期） |

## 顾虑（首轮报告，已被修复轮 1 部分修正——见下方"修复轮 1"）
- 首轮把 `actions.json` 432 个（非 435）的根因笼统定性为"三个撞 id 都是简报预告过的正常去重"，评审指出这个结论**没有逐字段核实就下了**，实际只有 `graveMark` 真的等价，`steamVent`/`invisibility` 是内容不同的两个动作，被误吞了。已在修复轮 1 改正。
- 未做修改（按裁决保留，修复轮后依然成立）：`ADJACENT`/`DISTANT` 均在原点右侧，导致 `onLeft` 恒为 `false`，留给 Task 10 镜像测试处理。

---

## 修复轮 1

评审对首轮做了逐字段抽样核实，指出三处问题，全部是简报/首轮里的手填数据错误，非实现流程偏差：

1. **Critical** — `GESTURE_TARGET` 表 17 项里 `create`/`sense`/`surge` 与 `spellcraft.mjs` 源码不符（应为 `summon`/`aura`/`ray`，误填成 `single`/`self`/`self`），导致 36 个法术 fixture（12 符文 × 3 姿态）的 `target.type`/`region`/`targets` 全部错误。
2. **Important** — 去重判据「同 id ⇒ 同动作」被证伪：`steamVent`（"Burnout" vs "Steam Vent"）、`invisibility`（"Natural Invisibility" vs 法术 "Invisibility"）逐字段核对后是**两个不同动作**共享同一 id，旧的按 id 去重把其中一个整个吞掉了；只有 `graveMark` 两处内容真正相等。
3. **Important** — `flanked` 不是可赋予状态：`statuses.mjs` 里它属于 `derivedConditions`（"cannot be assigned"），不在 `statusEffects` 里，不该出现在状态 fixture 中，实际只有 46 个。

### 逐项核实与修复

#### 1. GESTURE_TARGET 表修正

用括号配对解析器直接读取 `/root/fvtt14-data/Data/systems/crucible/module/const/spellcraft.mjs`，逐个 `GESTURES.<gesture>.target.type` 取值，人工核对 17 项全部与源码一致后确认修法：

```js
// 改前
create: "single", sense: "self", surge: "self"
// 改后（源码实值）
create: "summon", sense: "aura", surge: "ray"
```

`TARGET_REGION` 表未动——`aura`/`ray` 两个区域定义本来就在表里，改完 `sense`/`surge` 后即可命中。

**新增守卫测试**（`test/source-tables.test.mjs`，用同一套括号配对/顶层键解析逻辑直接读源码比对，而非人工抄一份期望值）：

- `GESTURE_TARGET 与 spellcraft.mjs 源码的 GESTURES.*.target.type 逐项一致` —— 断言键集合与源码姿态集合相同、17 项值逐一相等。

**红态验证**（临时把 `create` 改回 `"single"`）：

```
$ node --test test/source-tables.test.mjs
not ok 1 - GESTURE_TARGET 与 spellcraft.mjs 源码的 GESTURES.*.target.type 逐项一致
  error: |-
    GESTURE_TARGET 与源码不一致的姿态：create(表=single 源=summon)
    + actual - expected
    + [
    +   'create'
    + ]
    - []
# pass 1
# fail 1
```

改回 `create: "summon"` 后重跑，恢复绿：

```
$ node --test test/source-tables.test.mjs
ok 1 - GESTURE_TARGET 与 spellcraft.mjs 源码的 GESTURES.*.target.type 逐项一致
ok 2 - STATUSES 与 statuses.mjs 源码的 statusEffects 键集合一致（46 个，不含 flanked）
# tests 2
# pass 2
# fail 0
```

#### 2. 去重改为内容签名

用独立脚本直读 `steamVent`/`invisibility`/`graveMark` 三个撞 id 在各包里的完整字段，结果：

| id | 条目 A | 条目 B | 是否同一动作 |
| --- | --- | --- | --- |
| `steamVent` | "Burnout"：`tags=[ranged,fire,reflex]` `target.type=blast` `range.max=15` `cost.action=0` | "Steam Vent"：`tags=[ranged,fire]` `target.type=pulse` `range.max=null` `cost.action=4` | 否——两个不同动作 |
| `invisibility` | "Natural Invisibility"：`tags=[]` `target.type=self` `cost.action=3,focus=1` | 法术 "Invisibility"：`tags=[spell,iconicSpell,maintained]` `target.type=self` `cost.action=3,focus=2` | 否——`maintained` 标签的法术版本被旧逻辑整个丢弃 |
| `graveMark` | adversary-talents："Grave Mark"，`tags=[harmless,willpower,skill,intimidation]` `target.type=single` | ember crucible-adversary：同名同字段 | 是——同一怪物在 Crucible 核心与 Ember 间移植，字段全等 |

`tools/dump-fixtures.mjs` 里的去重判据改为内容签名（`id + 排序后的 tags + target + range + cost` 序列化字符串），只有签名完全相同才判定为重复：

```js
const sig = `${id}::${JSON.stringify([...tags].sort())}::` +
  `${JSON.stringify(target)}::${JSON.stringify(range)}::${JSON.stringify(cost)}`;
if (seenSig.has(sig)) continue;
seenSig.add(sig);
```

`DEFAULT_ACTIONS` 的判重仍用 id 级 `seen`（这些是硬编码 id，没有源自 compendium 的完整字段可比对内容签名，语义上也不会与 compendium 撞车）。

修复后重新生成，实测三个撞 id 各自保留条数：

| id | 保留条数 |
| --- | --- |
| `steamVent` | **2**（Burnout blast 版 + Steam Vent pulse 版） |
| `invisibility` | **2**（Natural Invisibility 自然能力版 + 法术 maintained 版） |
| `graveMark` | **1**（两处内容全等，正确去重） |

动作总数：432 → **434**（多回来的 2 条 = steamVent+1、invisibility+1；graveMark 不变）。与评审预期的 434 完全吻合。`test/fixtures.test.mjs` 的数量阈值同步从 `>= 432` 改为 `>= 434`，注释更新为准确根因（不再笼统称"简报预告过的正常情况"）。

#### 3. STATUSES 去掉 flanked，改为 46 个

用同一套括号配对解析器读取 `statuses.mjs` 的 `export const statusEffects = {...}`，提取顶层键，实测 **46 个**，与旧 `STATUSES` 数组去掉 `flanked` 后逐一相等；确认 `flanked` 只存在于 `derivedConditions`（源码注释：`cannot be assigned`）。

`tools/dump-fixtures.mjs` 里 `STATUSES` 数组删除 `"flanked"`，注释改为明确标注取自 `statusEffects` 而非 `derivedConditions`。`test/fixtures.test.mjs` 里 `effects.length` 断言从 47 改为 46，并加一条 `flanked` 不应出现的显式断言。

**新增守卫测试**：`STATUSES 与 statuses.mjs 源码的 statusEffects 键集合一致（46 个，不含 flanked）` —— 直接解析源码断言键集合相等、长度为 46、且不含 `flanked`。红/绿验证方式同 GESTURE_TARGET（人工临时改错值验证测试变红，过程一致，为节省篇幅不重复贴输出；GESTURE_TARGET 那条已完整贴出）。

#### 可导出化改造

为了让测试能直接 `import` 到 `GESTURE_TARGET`/`STATUSES` 而不必触发整轮 leveldb 抽取与写盘，给 `tools/dump-fixtures.mjs` 加了「直跑守卫」（与已有的 `tools/extract-db.mjs` 同一模式）：

```js
export const GESTURE_TARGET = { ... };
export const STATUSES = [ ... ];
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
if (isMain) { /* 原本的抽取 + 写盘逻辑，原样保留 */ }
```

`npm run fixtures` 行为不变（仍然直跑生成两份 fixture）；`test/source-tables.test.mjs` 改为纯 `import`，不触发 leveldb I/O。

### 修复后完整验证

```
$ npm run fixtures
> node tools/dump-fixtures.mjs
actions.json: 434 个快照
effects.json: 46 个状态
```

```
$ npm test
...
ok 20 - 动作 fixture 数量达到预期规模
ok 21 - 合成法术矩阵 12 × 17 完整
ok 22 - 每个 fixture 的必填字段齐全
ok 23 - 同时覆盖贴身与隔格两种几何
ok 24 - 状态 fixture 覆盖全部 46 个状态
...
ok 37 - GESTURE_TARGET 与 spellcraft.mjs 源码的 GESTURES.*.target.type 逐项一致
ok 38 - STATUSES 与 statuses.mjs 源码的 statusEffects 键集合一致（46 个，不含 flanked）
1..38
# tests 38
# suites 0
# pass 38
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

补充人工核对：
- `create`/`sense`/`surge` 三个法术 fixture 抽样：`create` → `target.type="summon"`, `region=null`, `targets.length=0`；`sense` → `target.type="aura"`, `region={type:circle,...}`, `targets.length=2`；`surge` → `target.type="ray"`, `region={type:line,...}`, `targets.length=2`。均符合修正后的预期。
- 法术矩阵仍是 12×17=204 个不重复组合，未受影响。
- `onLeft` 仍恒为 `false`（未动，按裁决保留）；`w`/`h` 字段仍在（未动）。
- `npm run fixtures` 重新执行两次，`git status --porcelain` 均为空，确认生成过程确定性未被破坏。

### 提交

```
$ git add -A
$ git commit -m "修正法术姿态目标表与状态列表，去重改按内容签名"
[v1-implementation 86c4bd9] 修正法术姿态目标表与状态列表，去重改按内容签名
 5 files changed, 214 insertions(+), 84 deletions(-)
 create mode 100644 test/source-tables.test.mjs
```

`git status --porcelain` 干净。

### 最终数据汇总（修复轮 1 后）

| 项 | 数值 |
| --- | --- |
| 四包原始动作数合计 | 218（不变，131+46+15+26） |
| 四包内容签名去重后 | 217（仅 graveMark 1 处被吸收，steamVent/invisibility 各保留 2 条） |
| DEFAULT_ACTIONS | 13 |
| 合成法术矩阵 12×17（`create`/`sense`/`surge` 已修正） | 204 |
| **actions.json 最终总数** | **434** |
| `steamVent` 保留条数 | 2 |
| `invisibility` 保留条数 | 2 |
| `graveMark` 保留条数 | 1 |
| **effects.json 最终总数** | **46**（不含 `flanked`） |

### 顾虑（修复轮 1 后）
- 无新增顾虑。三处评审指出的问题均已核实、修复、加守卫测试锁定，红/绿验证均已完成。
- 遗留、按裁决保留、不属于本轮修复范围：`ADJACENT`/`DISTANT` 均在原点右侧导致 `onLeft` 恒为 `false`，留给 Task 10 镜像测试显式覆盖左侧分支。
- 两个内容不同但共享同一 `action.id` 的 fixture（`steamVent`、`invisibility`）会各自拿到相同的 `seed`（`hashSeed(id)` 只按字符串 id 计算，不含内容）。现有测试未对此有断言，`actions.find(a => a.id === X)` 类查找只取首条不受影响；如果后续任务（如 Task 9-12）需要按 id 唯一定位 fixture，需注意这两个 id 现在各对应 2 条记录。
