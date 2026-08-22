# Task 3 实现报告：bestFit 资源解析器（双后端）

## 任务完成状态
**DONE** - 初始 8 个测试通过后，发现评审问题 C1/I1/I2，已补充 5 个契约测试、修复实现与扫描测试。现 24/24 全测试通过。

## 创建的文件

### 1. `/root/crucible-anim/scripts/resolver/assets.mjs`
Sequencer 数据库路径的降级解析实现，包含以下导出：

#### `offlineBackend(index) -> Backend`
- 消费 `data/asset-index.json`，构造离线查询后端
- 用于 Node 测试环境
- 内部函数：
  - `node(path)`：沿点分路径下行到对应节点
  - `templateOf(path)`：从节点自身或最近祖先继承 `_template`，同时处理数组形态（直接锚点）和字符串形态（命名空间根部 `_templates` 表引用）
- 返回对象包含两个方法：
  - `getPathsUnder(path)`：返回某节点下的直接子键，过滤掉元数据键
  - `getEntry(path)`：获取节点对应的文件信息和模板元数据

#### `runtimeBackend() -> Backend`
- 运行时后端，函数体内调用 `Sequencer.Database`
- 用于游戏内运行时环境
- 关键特性：
  - 函数体内的 `Sequencer.Database.getPathsUnder()` 和 `.getEntry()` 调用末尾加了 `// foundry-global-ok` 标记
  - 本模块在 Node 中导入时无副作用（Sequencer 只在函数被调用时触及，而不是导入时）
  - 与离线后端共用同一套算法，确保测试与运行时行为一致

#### `bestFit(backend, path: string) -> {path, diverged, divergedAt, options}`
- 核心算法：沿点分路径逐级下行
- 遇到某一级不存在，取该级第一个可用项并记录降级点
- 返回值：
  - `path`：最终解析出的点分路径
  - `diverged`：布尔值，是否发生了降级
  - `divergedAt`：降级发生的位置（如 "jb2a.melee_attack.01"）
  - `options`：降级处的可选项列表
- 设计保证从构造上不会产出数据库里没有的路径

#### `createAssets(backend) -> {resolve, colorsUnder, warnings}`
对外门面，返回三个成员：

##### `resolve(path: string) -> {...} | null`
- 解析 Sequencer 数据库路径到真实文件
- 含 `/` 的输入视为直接文件路径，原样返回（学自 eskie）
- 返回对象：
  - `path`：点分路径或直接文件路径
  - `file`：单个文件路径（变体数组的第一个）
  - `files`：所有变体文件路径数组
  - `template`：模板元数据三元组或 null
  - `diverged`：是否发生降级
- 对变体数组返回 `files`（全部）与 `file`（`files[0]`），调用方通过 `ctx.rng()` 随机选择变体，保证本层是纯函数

##### `colorsUnder(path: string) -> string[]`
- 列出某特效路径下实际可用的颜色或变体键
- 是 `backend.getPathsUnder()` 的直接代理

##### `warnings: Array<{requested, resolved, at}>`
- 累积所有降级事件的日志
- 每条记录包含原始请求路径、解析结果路径、降级位置

### 2. `/root/crucible-anim/test/assets.test.mjs`
8 个测试用例，涵盖：

1. **精确路径直接命中**：验证存在的路径不降级
2. **降级到同级第一个**：验证不存在的分支降级并记录位置
3. **resolve 返回真实文件**：验证文件路径以 .webm 结尾、files 数组有效
4. **_template 元数据**：验证 melee 分支的三元组模板被正确返回
5. **含斜杠的直接路径**：验证直接文件路径原样返回
6. **colorsUnder 列出颜色**：验证特效的颜色变体列表
7. **降级累积 warnings**：验证每次降级被记录
8. **不存在的路径返回 null**：验证错误处理而非抛错

### 3. `/root/crucible-anim/test/manifest.test.mjs`（修改）
扫描测试改进，用于处理 `runtimeBackend()` 的 Foundry 全局引用：

```javascript
test("resolver 与 armory 不得引用 Foundry 全局", async () => {
  // ... 文件遍历代码 ...
  const src = readFileSync(f, "utf8")
    .split("\n")
    .filter(l => {
      // 过滤掉单行注释、块注释、以及标记为 foundry-global-ok 的行
      const trimmed = l.trimStart();
      if (trimmed.startsWith("//")) return false;
      if (trimmed.startsWith("*")) return false;
      if (l.includes("// foundry-global-ok")) return false;
      return true;
    })
    .join("\n");
  assert.ok(!banned.test(src), `${f} 引用了 Foundry 全局`);
});
```

改进点：
- 过滤掉块注释中的行（以 `*` 开头），避免文档中的 `Sequencer.Database` 被误检
- 识别 `// foundry-global-ok` 标记，允许标记行中的 Foundry 全局引用
- 仍然能捕捉真正的违规代码

## npm test 完整输出

```
> crucible-anim@0.1.0 test
> node --test test/

TAP version 13
# Subtest: 七个素材命名空间齐备
ok 1 - 七个素材命名空间齐备
# Subtest: jb2a 叶子数达到 Patreon 版实测量级
ok 2 - jb2a 叶子数达到 Patreon 版实测量级
# Subtest: _template 根表存在且字符串引用能解析到锚点
ok 3 - _template 根表存在且字符串引用能解析到锚点
# Subtest: 抽样 200 个条目的文件在磁盘上真实存在
ok 4 - 抽样 200 个条目的文件在磁盘上真实存在
# Subtest: 提取失败的模组被显式记录而非静默丢弃
ok 5 - 提取失败的模组被显式记录而非静默丢弃
# Subtest: extract() 对未安装的模组返回 error 而非抛出或静默通过
ok 6 - extract() 对未安装的模组返回 error 而非抛出或静默通过
# Subtest: 精确路径直接命中，不降级
ok 7 - 精确路径直接命中，不降级
# Subtest: 不存在的分支降级到同级第一个可用项并记录位置
ok 8 - 不存在的分支降级到同级第一个可用项并记录位置
# Subtest: resolve 返回真实文件路径
ok 9 - resolve 返回真实文件路径
# Subtest: _template 元数据随解析结果一并返回
ok 10 - _template 元数据随解析结果一并返回
# Subtest: 含斜杠的输入按直接文件路径原样返回
ok 11 - 含斜杠的输入按直接文件路径原样返回
# Subtest: colorsUnder 列出某特效实际可用的颜色
ok 12 - colorsUnder 列出某特效实际可用的颜色
# Subtest: 降级会累积进 warnings
ok 13 - 降级会累积进 warnings
# Subtest: 解析不出任何东西时返回 null 而不抛错
ok 14 - 解析不出任何东西时返回 null 而不抛错
# Subtest: module.json 字段完整且与常量一致
ok 15 - module.json 字段完整且与常量一致
# Subtest: 清单引用的每个文件都存在
ok 16 - 清单引用的每个文件都存在
# Subtest: 两份语言文件键集合完全一致
ok 17 - 两份语言文件键集合完全一致
# Subtest: 常量自洽
ok 18 - 常量自洽
# Subtest: resolver 与 armory 不得引用 Foundry 全局
ok 19 - resolver 与 armory 不得引用 Foundry 全局

1..19
# tests 19
# suites 0
# pass 19
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 187.895041
```

## magic_sword 实际颜色键

查询命令：
```bash
node -e "const i=require('fs').readFileSync('data/asset-index.json','utf8'); 
console.log(Object.keys(JSON.parse(i).tree.jb2a.melee_attack['01'].magic_sword)
  .filter(k => !k.startsWith('_')).sort())"
```

**实际颜色键列表**（5 个）：
- `blue`
- `dark_green`
- `dark_purple`
- `orange`
- `yellow`

测试中的断言 `assert.ok(colors.includes("blue"))` 和 `assert.ok(colors.includes("orange"))` 均有效，无需修正。

## 扫描测试验证

### 第一步：放置真的违规文件

创建 `/root/crucible-anim/scripts/resolver/test-violation.mjs`：
```javascript
// 这是一个测试用的违规文件，用来验证扫描测试能正确检测真正的违规
export function badFunction() {
  return game.actors.get("test");
}
```

### 第二步：运行测试确认变红

```
# Subtest: resolver 与 armory 不得引用 Foundry 全局
not ok 19 - resolver 与 armory 不得引用 Foundry 全局
  error: '/root/crucible-anim/scripts/resolver/test-violation.mjs 引用了 Foundry 全局'
```

✓ 测试正确检测到违规

### 第三步：删除违规文件

```bash
rm /root/crucible-anim/scripts/resolver/test-violation.mjs
```

### 第四步：运行测试确认变绿

```
# Subtest: resolver 与 armory 不得引用 Foundry 全局
ok 19 - resolver 与 armory 不得引用 Foundry 全局
```

✓ 测试恢复通过

## 遇到的问题与决定

### 问题 1：扫描测试与 Foundry 全局引用的冲突

**现象**：`runtimeBackend()` 函数体内必须包含 `Sequencer.Database.getPathsUnder()` 和 `.getEntry()`，但这会导致扫描测试失败。

**解决**：
1. 在两行末尾加 `// foundry-global-ok` 标记
2. 改进 `test/manifest.test.mjs` 中的扫描测试过滤条件
3. 过滤掉注释行（单行 `//` 和块注释 `*`）和标记行
4. 验证修改后的测试仍能捕捉真正的违规

**关键决定**：过滤策略采用多层防守：
- 过滤单行注释（`//` 开头）
- 过滤块注释内部（`*` 开头）
- 识别允许标记（`// foundry-global-ok`）

### 问题 2：文档注释中的 Sequencer 引用

**现象**：`runtimeBackend()` 的 JSDoc 注释中写了 "Sequencer.Database"，也被正则匹配到。

**解决**：改进过滤条件，过滤掉以 `*` 开头的行（块注释标准格式）。

### 问题 3：_template 元数据处理

**现象**：简报要求 `templateOf()` 同时处理数组形态和字符串形态。

**实现**：双分支检查：
- 数组形态：直接检查 `Array.isArray(n._template)`
- 字符串形态：在命名空间根部查找 `roots[parts[0]]?._templates?.[n._template]`

验证通过：melee_attack.01.shortsword 的 _template 正确返回三元组 `[200, 300, 300]`。

## 技术要点

1. **双后端一致性**：离线和运行时后端共用相同的算法逻辑，通过 Backend 接口约束
2. **纯函数设计**：`resolve()` 不在内部随机选择变体，保留该职责给调用方
3. **向下兼容**：直接文件路径（含 `/`）不走数据库，原样返回
4. **模块边界**：`runtimeBackend()` 是唯一允许引用 Foundry 全局的地方，且仅在函数体内

## 提交信息

```
commit 68e7b79
Author: Claude <noreply@anthropic.com>
Date:   [commit time]

    bestFit 资源解析器与离线/运行时双后端
```

文件变更：
- 创建：`scripts/resolver/assets.mjs` (164 行)
- 创建：`test/assets.test.mjs` (68 行)
- 修改：`test/manifest.test.mjs` (扫描测试改进)

---

## Revision 1：评审修复（C1/I1/I2）

评审发现三条规范符合性问题。根本原因是 `runtimeBackend` 与真实 Sequencer 4.2.3 的适配不足，以及扫描测试的注释剥离不够精确。

### Sequencer 4.2.3 真实行为

基于 `/root/fvtt14-data/Data/modules/sequencer/dist/sequencer.js` 源码分析：

**Database.getEntry(path, {softFail})**
- **精确命中**：返回单个 SequencerFile 对象
- **前缀匹配多条**：返回**裸数组** `SequencerFile[]`（这是 C1 的根本问题）
- **未命中且 softFail=true**：返回 `false`
- **未命中且 softFail=false**：弹 UI 错误提示，返回 `false`
- SequencerFile 对象字段：`file`（字符串或数组）、`template`（元数据）、`dbPath`、`moduleName` 等

**Database.getPathsUnder(path)**
- **命中**：返回数组（可能为空）
- **未命中**：弹 UI 错误提示，返回 `false`（这是 I1 的根本问题）

### 修复内容

#### C1 修复：`runtimeBackend().getEntry()` 处理裸数组

```javascript
// 原代码（存在缺陷）
const file = typeof e === "string" ? e : (e.file ?? e.files ?? null);
// 裸数组既不是字符串也没有 .file/.files → file = null

// 修复后的代码
if (e === false || !e) return null;
if (typeof e === "string") {
  return {file: e, template: null};
}
// 裸数组（前缀匹配多条）：取第一个元素代表
if (Array.isArray(e)) {
  if (e.length === 0) return null;
  const first = e[0];
  const file = first?.file ?? first?.files ?? null;
  if (!file) return null;
  return {file, template: first?.template ?? null};
}
// 对象形态（精确命中或单条前缀）
const file = e.file ?? e.files ?? null;
```

影响：容器节点（如 `jb2a.melee_attack.01.shortsword` 下有多个颜色分支）现在能正确取第一个颜色作代表，而非返回 null。

#### I1 修复：`runtimeBackend().getPathsUnder()` 处理 false 返回值

```javascript
// 原代码
return Sequencer.Database.getPathsUnder(path) ?? [];
// ?? 只在 null/undefined 时兜底，对字面量 false 不生效

// 修复后的代码
const r = Sequencer.Database.getPathsUnder(path);
return Array.isArray(r) ? r : [];
```

同时在函数注释中说明：未命中时会在游戏界面弹红色错误提示，调用方不应试探明显拼错的顶层命名空间。

#### I2 修复：扫描测试的注释剥离

原过滤逻辑用启发式的 `if (trimmed.startsWith("*")) return false;` 导致以 `*` 开头的代码行（如 `*next() { ... }`）被误认为块注释行而跳过检查。

修复方案：用正经的注释剥离，而非启发式过滤
```javascript
function stripComments(src) {
  // 第一步：去掉块注释 /* ... */（包括跨行）
  let stripped = src.replace(/\/\*[\s\S]*?\*\//g, "");
  
  // 第二步：过滤掉标记为 foundry-global-ok 的整行，然后去掉行尾注释
  stripped = stripped
    .split("\n")
    .filter(line => !line.includes("// foundry-global-ok"))
    .map(line => {
      const commentIdx = line.indexOf("//");
      if (commentIdx !== -1) return line.substring(0, commentIdx);
      return line;
    })
    .join("\n");
  
  return stripped;
}
```

### 补充的契约测试

在 `test/assets.test.mjs` 中添加 5 个模拟真实 Sequencer 4.2.3 的测试，实现 `MockSequencerDatabase` 类以复现真实行为：

1. **runtime: 精确命中返回单个对象** — 验证精确命中路径返回单个对象
2. **runtime: 前缀匹配多条返回数组（关键修复 C1）** — 验证前缀匹配多条时返回裸数组，`getEntry()` 取第一个元素
3. **runtime: getPathsUnder 返回 false 时处理（关键修复 I1）** — 验证 getPathsUnder 返回 false 时被正确兜底为空数组
4. **runtime: getEntry softFail 返回 false 时处理** — 验证 getEntry softFail=true 时的 false 返回被正确转换为 null
5. **runtime 与 offline 返回值形状一致** — 验证两个后端在等价数据上返回值的键集合与类型一致

### 红/绿验证

#### C1 验证
- **变红**：仅添加契约测试，不改实现 → 第 10 号测试"runtime: 前缀匹配多条返回数组"失败，断言`应返回非空`报错
- **改实现**：修改 `runtimeBackend().getEntry()` 处理 `Array.isArray(e)` 的情况
- **变绿**：测试通过

#### I1 验证  
- **变红**：仅添加契约测试，不改实现 → 第 11 号测试"runtime: getPathsUnder 返回 false 时处理"失败，断言`getPathsUnder 应返回数组而非 false`报错
- **改实现**：修改 `runtimeBackend().getPathsUnder()` 改用 `Array.isArray(r) ? r : []`
- **变绿**：测试通过

#### I2 验证
- **变红**：在 `scripts/resolver/` 创建 `test-i2-violation.mjs`，含 `* game.actors.get("test");` 一行
  - 修复前（启发式过滤）：测试**绿色**（违规被误过滤，BUG）
  - 修复后（正经注释剥离）：测试**红色**（违规被正确抓住）
- **变绿**：删除测试文件，扫描测试恢复绿色

### 修复后的 npm test 输出摘要

```
1..24
# tests 24
# suites 0
# pass 24       ← 从原 19 增加到 24（新增 5 个契约测试）
# fail 0
```

关键测试结果：
- 原 8 个 offline 测试：✓ 全通
- 新 5 个 runtime 契约测试：✓ 全通（修复后）
- 原 11 个清单测试：✓ 全通（包括改进后的扫描测试）

### 技术总结

1. **离线/运行时一致性得以恢复**：两个后端现在对等价数据返回值形态完全一致，容器节点不再产出 null
2. **容器节点处理一致**：`offlineBackend` 的递归取第一个叶子与 `runtimeBackend` 的数组取第一个元素，行为语义对齐
3. **扫描测试防线加强**：注释剥离从启发式升级为正经的词法分析，再次防止真正的违规代码被漏掉
4. **Sequencer API 适配完整**：代码现在明确处理 API 的所有四种返回形态，不依赖隐含假设

### 提交信息（修复轮）

```
commit 2f2a7ad
Author: Claude <noreply@anthropic.com>

    修复 C1/I1/I2：runtimeBackend 裸数组处理、getPathsUnder false 兜底、扫描测试注释剥离
```

文件变更：
- 修改：`scripts/resolver/assets.mjs` — C1/I1 修复，增加 Sequencer 适配逻辑和注释
- 修改：`test/assets.test.mjs` — 添加 5 个契约测试（MockSequencerDatabase）
- 修改：`test/manifest.test.mjs` — I2 修复，改进注释剥离策略
