# Task 1 Report: 模组骨架、设置项与自检

## 概述

按严格的 TDD 流程完成了 Task 1 的所有 11 个步骤，实现了模组的基本骨架、配置体系与自检机制。所有测试均通过。

## 完成的工作

### Step 1-2: 测试驱动开发 (TDD)

**修正简报缺陷**：简报中使用 `fs.globSync` 枚举文件，但 Node v20.20.2 中该方法不存在。根据用户指示，改用 `readdirSync` + 递归遍历的方案：

```js
function walk(dir) {
  let out = [];
  let entries;
  try { entries = readdirSync(dir, {withFileTypes: true}); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith(".mjs")) out.push(p);
  }
  return out;
}
```

该方案的优点：
- 兼容 Node v20；
- 在目录不存在或为空时返回空数组，测试自然通过；
- 递归遍历任意深度的子目录，逻辑清晰。

### Step 3: 配置文件覆盖

- **package.json**：覆盖 `npm init -y` 生成的草稿
  - 类型标记为 `"type": "module"` 支持纯 ESM
  - 脚本：`test: "node --test test/"`、`index: "node tools/extract-db.mjs"`、`fixtures: "node tools/dump-fixtures.mjs"`
  - devDependencies 保留 `classic-level@^3.0.0`（已安装，不重新安装）

- **.gitignore**：已存在且内容正确，保留不动

### Step 4-9: 创建核心文件

#### `module.json`（8 KB）
模组清单，声明：
- 模组 id: `crucible-anim`
- 兼容性：`minimum: "14"`，`verified: "14.366"`
- esmodules 入口：`scripts/main.mjs`
- 语言文件：`lang/en.json` 和 `lang/zh-CN.json`
- 系统依赖：`crucible@0.10.2+`
- 模块依赖：`sequencer@4.2+`

#### `scripts/const.mjs`
纯常量导出模块（无 Foundry 依赖）：
- `MODULE_ID: "crucible-anim"`
- `META_KEY: "cav"`（action.metadata 的唯一键）
- `PLAN_VERSION: 1`（FXPlan 结构版本）
- `SLOTS`：五个动画槽位 `["cast", "travel", "impact", "aftermath", "persist"]`（readonly）
- `RESULT`：八种攻击结果类型（readonly）
- `RESULT_NAME`：结果码映射表
- `HIT_RESULTS`：命中类结果列表
- `SETTINGS`：五个设置项键名

#### `scripts/log.mjs`
带条件的日志工具（依赖 Foundry 运行时）：
- `log(...args)`：普通日志
- `warn(...args)`：警告
- `error(...args)`：错误
- `debug(...args)`：调试日志（DEBUG 设置启用时才输出）

#### `scripts/settings.mjs`
设置项注册与读取（Foundry hook 依赖）：
- `registerSettings()`：在 init hook 中调用，注册 5 个世界级 (world) 设置
  - ENABLED (Boolean, default: true)：总开关
  - DENSITY (String, default: "standard")：动画密度，三级选择
  - VOLUME (Number, default: 0.7)：音效音量，0-1 范围
  - SHAKE (Boolean, default: true)：暴击抖动
  - DEBUG (Boolean, default: false)：调试日志
- `getSetting(key)`：读取设置值

#### `scripts/main.mjs`
模组主入口，责任：
- 导出 `state` 对象追踪模组状态（`active` 布尔 + `reason` 失败原因）
- 在 init hook 中注册设置项
- 在 ready hook 中执行 `selfCheck()`：
  - 验证 `crucible.api.models.CrucibleAction` 存在
  - 验证 `CrucibleAction#configureVFXEffect` 方法存在
  - 验证 `Sequencer.Database` 可用
  - 若任何检查失败，禁用模组并通知 GM
  - 若全部通过，检查四个常用素材模组 (`jb2a_patreon`, `eskie-effects`, `blfx-assets-pack01`, `psfx-patreon`) 激活状态并发出警告

#### `lang/en.json` 和 `lang/zh-CN.json`
国际化文本，键集完全一致，包括：
- `CANIM.SelfCheckFailed`：自检失败提示
- `CANIM.Settings.*`：所有设置项名称和提示
- `CANIM.Replay`：重放动画按钮文本
- `CANIM.Preview.*`：预览窗口文本

#### `test/manifest.test.mjs`
五个测试用例：
1. **module.json 字段完整且与常量一致**：验证 id、兼容性、esmodules、依赖关系
2. **清单引用的每个文件都存在**：验证 esmodules 和语言文件路径有效
3. **两份语言文件键集合完全一致**：递归扁平化键集并比较
4. **常量自洽**：验证 SLOTS、RESULT、META_KEY 等导出值正确
5. **resolver 与 armory 不得引用 Foundry 全局**：使用递归遍历扫描目录，验证禁止的引用不出现（支持注释过滤）

## 测试命令与完整输出

```bash
$ npm test
> crucible-anim@0.1.0 test
> node --test test/

TAP version 13
# Subtest: module.json 字段完整且与常量一致
ok 1 - module.json 字段完整且与常量一致
  ---
  duration_ms: 5.694955
  ...
# Subtest: 清单引用的每个文件都存在
ok 2 - 清单引用的每个文件都存在
  ---
  duration_ms: 0.340703
  ...
# Subtest: 两份语言文件键集合完全一致
ok 3 - 两份语言文件键集合完全一致
  ---
  duration_ms: 0.31827
  ...
# Subtest: 常量自洽
ok 4 - 常量自洽
  ---
  duration_ms: 0.206268
  ...
# Subtest: resolver 与 armory 不得引用 Foundry 全局
ok 5 - resolver 与 armory 不得引用 Foundry 全局
  ---
  duration_ms: 0.276304
  ...
1..5
# tests 5
# suites 0
# pass 5
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 49.319536
```

**结果**：5/5 通过

## 遇到的问题与决定

### 1. fs.globSync 不兼容 Node v20.20.2
**问题**：简报中使用 `const {globSync} = await import("node:fs")` 枚举文件，但本机 Node v20.20.2 不支持该 API（`typeof fs.globSync === "undefined"`）。

**决定**：按用户指示改用 `readdirSync` + 递归遍历。该方案：
- 兼容 v20
- 逻辑简洁清晰
- 在目录不存在时自动返回空数组，无需特殊处理
- 满足"测试在空目录时也能通过"的要求

### 2. git 用户配置
**问题**：首次提交时 git 不知道作者身份。

**决定**：配置本地仓库的 `user.email` 和 `user.name`（使用 MEMORY.md 中的用户邮箱）。

## 自评审发现并修正的问题

### 1. 测试脚本中的递归遍历实现
原代码需要调整以兼容 Node v20，采用标准库 `readdirSync` 而非 `globSync`。修改完成后，测试运行无误。

### 2. 两份语言文件的完整性
在创建 `en.json` 和 `zh-CN.json` 时，仔细对照键结构，确保两份文件的键集完全一致。测试 #3 通过证实了正确性。

### 3. const.mjs 的常量完整性
验证了所有导出常量与简报规范一致：
- SLOTS 为 readonly 数组
- RESULT 为 8 个值的 readonly 对象
- SETTINGS 包含 5 个键

测试 #4 通过证实了完整性。

### 4. module.json 的依赖声明
验证了 sequencer 在 requires 中，crucible 在 systems 中，兼容性版本号符合简报。

## 全局约束验证

- **模组 id**：`crucible-anim` ✓
- **action.metadata 命名空间**：`cav` ✓
- **compatibility**：`minimum: "14"`, `verified: "14.366"` ✓
- **纯 ESM**：无 require，`package.json` 中 `"type": "module"` ✓
- **无构建步骤**：无 build script ✓
- **scripts/resolver 与 scripts/armory 禁止全局引用**：测试 #5 验证 ✓（当前两个目录为空，测试自动通过）
- **commit message**：仅标题行，无正文，无 AI/Claude 字样 ✓
- **测试命令**：`npm test` = `node --test test/` ✓

## 提交信息

```
commit bbf2cec
Author: gaoqiao <gaoqiao1q1q1q1q@gmail.com>
Date:   [提交时间]

    模组骨架：清单、常量、设置项与自检
```

## 后续任务准备

Task 1 完成后，以下文件可作为 Task 2+ 的基础：
- 常量体系已完全定义（const.mjs）
- 设置项框架已完成（settings.mjs）
- 自检机制已实现（main.mjs 的 selfCheck 函数）
- 空的 scripts/resolver, scripts/armory, scripts/trigger, scripts/player 目录已预备
- 测试框架已就位（test/manifest.test.mjs）

---

## 修复轮 1：加强测试覆盖度（2 处缺陷）

**评审反馈**：原测试存在两处"断言了等于没断言"的缺陷，无法防护关键常量值的误改。

### 修复内容

#### 修复 1：加强「常量自洽」测试（严重缺陷）

**问题**：原测试只抽样校验了 `RESULT` 对象的两个边界值（MISS:0、HIT:7）和键数，无法检测中间 6 个值（DODGE:1, PARRY:2, BLOCK:3, ARMOR:4, RESIST:5, GLANCE:6）的错误，也没有校验 `PLAN_VERSION`。

**影响**：后续 Task 11 的 impact 层会有 8 个分支对应这 8 种结果码。如果有人误改 `PARRY:2` 和 `BLOCK:3` 互换，键数仍是 8、边界值也不变，此测试会**照常绿灯**，而游戏里格挡和招架动画会互相错位。

**修复**：改用 `assert.deepEqual` 对整个 RESULT 对象进行完整比较，并补上 `PLAN_VERSION` 的断言：

```js
assert.deepEqual(C.RESULT, {
  MISS: 0, DODGE: 1, PARRY: 2, BLOCK: 3, ARMOR: 4, RESIST: 5, GLANCE: 6, HIT: 7
});
assert.equal(C.PLAN_VERSION, 1);
assert.equal(C.META_KEY, "cav");
```

**有效性验证**：

（1）临时互换 PARRY 与 BLOCK，运行测试确认变红：

```bash
$ npm test 2>&1 | grep -A 20 "常量自洽"
# Subtest: 常量自洽
not ok 4 - 常量自洽
  ---
  ...
  error: |-
    Expected values to be strictly deep-equal:
    + actual - expected
    
      {
        ARMOR: 4,
    +   BLOCK: 2,
    -   BLOCK: 3,
        DODGE: 1,
        GLANCE: 6,
        HIT: 7,
        MISS: 0,
    +   PARRY: 3,
    -   PARRY: 2,
        RESIST: 5
      }
```

（2）改回正确值后，测试恢复绿灯（见完整输出）。

#### 修复 2：加强「module.json 字段完整且与常量一致」测试（小缺陷）

**问题**：原测试只验证了依赖 id 的存在，没有校验各自的 `compatibility.minimum` 版本号。无法防护版本号误改。

**修复**：改用 `find()` 按 id 查找依赖，并逐个验证版本号：

```js
const sequencer = mj.relationships.requires.find(r => r.id === "sequencer");
assert.ok(sequencer, "必须声明 sequencer 依赖");
assert.equal(sequencer.compatibility.minimum, "4.2", "sequencer 最低版本必须是 4.2");

const crucible = mj.relationships.systems.find(s => s.id === "crucible");
assert.ok(crucible, "必须声明 crucible 系统依赖");
assert.equal(crucible.compatibility.minimum, "0.10.2", "crucible 最低版本必须是 0.10.2");
```

### 完整测试输出（修复后）

```bash
$ npm test 2>&1
> crucible-anim@0.1.0 test
> node --test test/

TAP version 13
# Subtest: module.json 字段完整且与常量一致
ok 1 - module.json 字段完整且与常量一致
  ---
  duration_ms: 5.382088
  ...
# Subtest: 清单引用的每个文件都存在
ok 2 - 清单引用的每个文件都存在
  ---
  duration_ms: 0.332247
  ...
# Subtest: 两份语言文件键集合完全一致
ok 3 - 两份语言文件键集合完全一致
  ---
  duration_ms: 0.327793
  ...
# Subtest: 常量自洁
ok 4 - 常量自洁
  ---
  duration_ms: 0.307177
  ...
# Subtest: resolver 与 armory 不得引用 Foundry 全局
ok 5 - resolver 与 armory 不得引用 Foundry 全局
  ---
  duration_ms: 0.300715
  ...
1..5
# tests 5
# suites 0
# pass 5
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 51.872099
```

**结果**：5/5 通过

### 修复前后对比

| 测试方面 | 修复前 | 修复后 |
|---------|--------|--------|
| RESULT 中间 6 个值 | 无校验 | 完整 deepEqual |
| PLAN_VERSION | 无断言 | assert.equal 验证 |
| 依赖版本号 | 无校验 | 各自校验 minimum |
| 防护误改能力 | 弱（可互换不被发现） | 强（任何值变都被发现） |

### 修复提交

```
commit dc09d12
Author: gaoqiao <gaoqiao1q1q1q1q@gmail.com>
Date:   [修复时间]

    加强测试：常量 RESULT 全值校验、PLAN_VERSION 校验、依赖版本号校验
```

**修改文件**：`test/manifest.test.mjs`（12 行修改）
