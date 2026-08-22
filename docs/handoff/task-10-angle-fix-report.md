# Task 10 张角修复报告

基线 HEAD `e4b7daa`、122/122。本轮修两处经用户核实的数据/公式问题：
`tools/dump-fixtures.mjs` 的 fan 张角手填错（120，应为 210）、`scripts/armory/travel.mjs`
的 `coneYScale` 缺 ≥180° 的显式防护与输入有限性防护。并给 `test/source-tables.test.mjs`
补一条源码守卫，防止同类"手填表格与源码不一致"的错误再犯。落地后 **124/124 全绿**。

---

## 一、fixture 差异的影响面核对

`tools/dump-fixtures.mjs` 第 61 行 `TARGET_REGION.fan.angle`：`120` → `210`（依据
`crucible/module/const/action.mjs` 的 `TARGET_TYPES.fan.region.angle = 210`）。同时把
第 50-52 行注释里"cone 的 angle 只有 60/120"的过时描述改成指向源码字段，并把
`TARGET_REGION` 由模块内私有改成 `export`（供新守卫测试导入）。

重新生成前先备份了 `test/fixtures/actions.json`／`effects.json`，跑
`npm run fixtures` 后做了两轮独立核对：

1. **434 条 fixture 逐条 JSON 序列化比对**：只有 12 条差异，全部是 `spell.<rune>.fan`
   （control/death/earth/flame/frost/illumination/illusion/kinesis/life/oblivion/soul/storm）。
2. **对这 12 条做深度字段级 diff**（递归比较所有 key），每条都**只有 `region.angle`
   一个字段变化，且都是 `120 → 210`**；除这 12 条外，其余 422 条动作逐字节相同；
   `effects.json`（46 条状态特效）md5 前后一致，完全未受影响。

结论：影响面与预期完全一致，未扩散，无需停手。

---

## 二、≥180° 防护的方案与理由

**先纠正一处认知**：核实后发现 `coneYScale` 在本轮开工前**已经**对"张角直接钳制到
`[1°,179°]` 再代入 `tan()`"，`Math.tan(90°) = Infinity` 与 A>180° 的负值分支因此已经
碰不到——这是上一轮（`a981f2c`→`e4b7daa`）加 `CONE_YSCALE_MAX` 硬上限时顺带做的，只是
没有专门的测试把它钉死，也没有处理"输入本身不是有限数字"这条独立的泄漏路径。用
node 直接跑该函数验证过（60/120/180/210/360 五点，改动前）：

```
60  → {clamped:false, value:1.154701}
120 → {clamped:false, value:3.464102}
180 → {clamped:true,  value:4}
210 → {clamped:true,  value:4}
360 → {clamped:true,  value:4}
```

全部有限、非负、非 NaN——这五点在改动前就已经安全。真正的缺口在别处：

- `Number(angleDeg ?? 60)`：`??` 只拦 `null`/`undefined`，拦不住 `NaN` 本身
  （`NaN ?? 60` 仍是 `NaN`）或 `Infinity`/`-Infinity`（同样不是 nullish）。这类值一旦
  从上游（未来的 fan 专属规则、手误传参、损坏的 region 数据）传入，会在
  `Math.max(NaN,1)`/`Math.min(...,179)` 全程保持 `NaN`，比较 `raw > CONE_YSCALE_MAX`
  对 `NaN` 恒为 `false`，最终 `r6(NaN)` 把 `NaN` 一路带出函数——这是真实存在但之前
  没测过的漏洞，五点数值锁不到它。

采纳的方案（对应简报选项 1 + 3 的组合，未改用退化成圆形/脉冲呈现——理由见下）：

1. **输入有限性防护**：`angleDeg` 先过一遍 `Number.isFinite`，非有限值（`NaN`／
   `Infinity`／`-Infinity`／解析不出数字的字符串）一律退回默认 60°，不再让 `NaN`
   顺着 `tan()` 流出。
2. **保留原有的 `[1°,179°]` 钳制 + `CONE_YSCALE_MAX=4` 硬上限**：这条已经把
   180°/210°/360° 都安全截到同一个有限正值，逻辑上不需要另开一条分支去"退化成圆形"——
   `mask:"region"` 本来就会把撑出去的画面裁到模板形状内，179° 钳制只是在诚实表达
   "这份 53.13° 的素材撑不出比 179° 更宽的锥"，跟真实渲染结果（被遮罩裁过的画面）不冲突。
   没有选"钳到 180°"是因为 `tan(90°)` 在浮点下不稳定（不同运行时/优化级别对边界值的
   处理有细微差异），179° 是明确落在数学定义域内的安全值。
3. **告警信息按 ≥180° 单独加一句提示**：≥180° 时额外注明"已超出锥形的几何定义"，
   与"只是超过单张贴图拉伸上限但仍是有效锥形"（如 150°）的告警区分开，方便以后
   Task 11/12 真的给 fan 挂规则时，一眼看出触发的是哪一类截断。

未采纳"退化成圆形/脉冲式呈现"：那需要改 `spell.gesture.cone` 规则本身换素材/换渲染
路径，属于新增行为而不是把现有公式钉安全；且当前 fan 仍落在 `generic.travel` 兜底，
没有实际调用方，属于超出本任务范围的预防性重构，留给 Task 11/12 按实际需要决定。

代码位置：`scripts/armory/travel.mjs` 的 `coneYScale()`（约第 71-98 行），函数上方
docstring 新增了"≥180° 防护"一段，写明 179° 钳制值的推导与 `CONE_YSCALE_MAX` 接管的
关系。

---

## 三、新守卫的红/绿实际输出

`test/source-tables.test.mjs` 新增 `parseTargetTypeAngles()`：解析
`crucible/module/const/action.mjs` 的 `export const TARGET_TYPES = defineEnum({...})`，
复用现有 `matchBrace`/`parseTopLevelBlocks` 的括号配对法，对每个目标类型取
`region.angle` 字段（`region: null` 或 region 里没有 `angle` 字段的直接跳过），
与 `tools/dump-fixtures.mjs` 新导出的 `TARGET_REGION` 逐项比对。新测试
`"TARGET_REGION 的 region.angle 与 action.mjs 源码的 TARGET_TYPES.*.region.angle 逐项一致"`
额外锁了两条：源码里带 `angle` 字段的目标类型集合恰好是 `{cone, fan}`（第三个目标类型
一旦在未来带上 `angle`，这条会先红，逼着同步补 `TARGET_REGION`），以及具体数值
`cone=60`、`fan=210`。

**验证有效性**：临时把 `tools/dump-fixtures.mjs` 第 61 行的 `angle: 210` 改回
`angle: 120`（未重新生成 fixture，只改源文件常量），单独跑该测试文件，实际
`not ok` 输出：

```
# Subtest: TARGET_REGION 的 region.angle 与 action.mjs 源码的 TARGET_TYPES.*.region.angle 逐项一致
not ok 2 - TARGET_REGION 的 region.angle 与 action.mjs 源码的 TARGET_TYPES.*.region.angle 逐项一致
  ---
  duration_ms: 1.871917
  location: '/root/crucible-anim/test/source-tables.test.mjs:121:1'
  failureType: 'testCodeFailure'
  error: |-
    TARGET_REGION 与源码张角不一致：fan(表=120 源=210)
    + actual - expected

    + [
    +   'fan'
    + ]
    - []
  code: 'ERR_ASSERTION'
  name: 'AssertionError'
```

还原成 `angle: 210` 后重跑：

```
# Subtest: TARGET_REGION 的 region.angle 与 action.mjs 源码的 TARGET_TYPES.*.region.angle 逐项一致
ok 2 - TARGET_REGION 的 region.angle 与 action.mjs 源码的 TARGET_TYPES.*.region.angle 逐项一致
```

`git diff tools/dump-fixtures.mjs` 确认还原后与修复后的版本逐字节相同，改动没有残留。

---

## 四、≥180° 五点行为锁的测试

`test/armory-travel.test.mjs` 新增两条测试（就地合成 region，不改 fixture，沿用文件
既有的"模板几何"一组做法）：

1. `"张角 60/120/180/210/360 五点锁：scale.y 恒为有限正数，≥180° 截断留痕"`——
   表驱动比对五个点的 `scale.x===1`、`scale.y` 精确值（60°→1.154701、120°→3.464102、
   180°/210°/360° 均→4）、`Number.isFinite(scale.y) && scale.y>0`、以及是否触发
   `plan.warnings`（60°/120° 不触发，180°/210°/360° 触发）。
2. `"张角输入非有限数字（NaN/Infinity/坏字符串）时退回默认 60°，不产生 NaN"`——
   覆盖本轮真正补上的那条防护，输入 `NaN`/`Infinity`/`-Infinity`/`"not-a-number"`
   四种坏值，断言输出恒为 `1.154701`（默认 60° 对应值）且恒为有限数。

同时把原有的 60°/120°/210° 三条断言拆分改写，补上"60°/120° 不该有告警"的反向断言
（原测试没有验证这一点）。`node --test test/armory-travel.test.mjs`：27/27 全绿。

---

## 五、回归复算（自己跑，未采信 task-10-fix-report.md 的转述数字）

用独立脚本直接调用 `resolve`/`resolveEffect`（不经由 test 文件），逐项复算：

| 指标 | 数值 |
| --- | --- |
| 动作覆盖率 | **434 / 434** |
| 状态覆盖率 | **46 / 46** |
| 零目标攻击动作有 cast cue | **53 / 53** |
| 降级率（`assets.warnings` / 动作数） | **0.00%（0/434）** |
| `plan.warnings` 总数 | **0** |
| 路径存在性（cue 引用文件在磁盘上） | 缺失 **0** 个 |
| `spell.gesture.ray` 每动作 cue 数 | 12 动作 / 12 cue / **1.000**，异常 0 |
| `spell.gesture.cone` 每动作 cue 数 | 12 动作 / 12 cue / **1.000**，异常 0 |
| `spell.gesture.pulse` 每动作 cue 数 | 12 动作 / 12 cue / **1.000**，异常 0 |
| `spell.gesture.surge` 每动作 cue 数 | 12 动作 / 12 cue / **1.000**，异常 0 |

`npm test`（全量 `node --test test/`）：**124/124 全绿**（原 122 条 + 本轮新增 2 条）。

`node --test test/manifest.test.mjs` 里的 `"resolver 与 armory 不得引用 Foundry 全局或
Math.random"`、`test/armory-travel.test.mjs` 里的 `"travel 规则不引用绝对路径"`、
`test/asset-notes.test.mjs` 的全部 6 条（含"兵库规则引用的每条 DB 路径都能在
ASSET-NOTES 主表里查到依据"）均通过——本轮改动没有新增任何 `ctx.pick` 路径、没有碰
Foundry 全局、没有引入 `Math.random()`、没有写绝对路径。

`git status --porcelain`：提交前确认为空（工作树干净）。

---

## 六、改动文件清单

- `tools/dump-fixtures.mjs` —— fan 张角 120→210，注释同步，`TARGET_REGION` 改为 `export`。
- `test/fixtures/actions.json` —— 重新生成，12 条 `spell.*.fan` 的 `region.angle` 变化（已核对影响面）。
- `scripts/armory/travel.mjs` —— `coneYScale` 补输入有限性防护与 ≥180° 告警区分，docstring 补充推导。
- `test/armory-travel.test.mjs` —— 五点行为锁 + 非有限输入防护测试，原 210° 测试合并进新表驱动测试。
- `test/source-tables.test.mjs` —— 新增 `parseTargetTypeAngles()` 与对应源码守卫测试。
