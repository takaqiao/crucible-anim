# Task 2 报告：素材索引与识图工具

## 文件与作用

- `tools/extract-db.mjs`：离线提取器。造一套够用的 Foundry 全局桩（`Hooks`、`Sequencer.Database`、
  `game`、`canvas`、`foundry.utils` 等），逐个 import 七个目标素材模组的入口脚本，捕获它们通过
  `Sequencer.Database.registerEntries` 注册的钩子回调，按 Foundry 真实钩子顺序
  （`init → i18nInit → setup → sequencerReady → sequencer.ready → ready → canvasReady`，
  剩余未列出的钩子兜底触发）逐一触发，拦截 `registerEntries` 的入参得到原始 DB 树。
  免费/付费互斥模组（`jb2a_patreon`/`JB2A_DnD5e` 等）用 `RIVALS` 表让对偶模组在
  `game.modules.get().active` 上呈现未激活，绕开注册守卫。提取结果按 `TARGETS` 顺序
  深合并进 `out.tree[ns]`（`mergeTree`：已存在分支不覆盖，只补空缺，故先提取的模组
  优先——Patreon 版优先于免费版），最终写入 `data/asset-index.json`。
  内容与 `docs/_harness-verified.mjs`（已删除，见 Step 8）的沙箱原型逻辑一致，
  补上了合并（`mergeTree`）与落盘（`writeFileSync`）。
- `tools/contact-sheet.sh`：把一个 `.webm` 均匀抽帧、缩放、标帧号、拼成一张网格 PNG
  联系表，用于人工判断动画的相位结构（起手/挥砍/命中/收招）与素材可用的锚点。
  依赖 `ffprobe`（数帧）与 `ffmpeg`（`select`+`tile` 滤镜链）。
- `data/asset-index.json`（生成物，已提交进 git，2.2MB）：结构为
  `{generated, modules: {模组id: {namespace, leaves}}, failed: {模组id: 错误原因}, tree: {命名空间: DB子树}}`。
  `tree` 原样保留 `registerEntries` 传入的树形状（叶子为字符串或数组，`_template`/`_metadata` 保留）。
- `test/asset-index.test.mjs`：5 个测试，覆盖命名空间齐备性、`jb2a` 叶子数量级、
  `_template` 元数据留存、抽样文件磁盘真实存在、失败模组被显式记录。
- 删除：`docs/_harness-verified.mjs`（内容已并入 `tools/extract-db.mjs`）。

## `npm run index` 完整输出

```
> crucible-anim@0.1.0 index
> node tools/extract-db.mjs

✓ jb2a_patreon                     jb2a                             10038
✓ JB2A_DnD5e                       jb2a                             1687
✓ jb2a-extras                      jb2a-extras                      135
✓ eskie-effects                    eskie                            3236
blfx-assets-pack01 | Loaded.
✓ blfx-assets-pack01               blfx                             1412
PREFIX:  modules/psfx-patreon
✓ psfx-patreon                     psfx                             930
✓ animated-spell-effects-cartoon   animated-spell-effects-cartoon   724
  合并后 jb2a: 10060 叶子
  合并后 jb2a-extras: 135 叶子
  合并后 eskie: 3236 叶子
  合并后 blfx: 1412 叶子
  合并后 psfx: 930 叶子
  合并后 animated-spell-effects-cartoon: 724 叶子
已写入 data/asset-index.json
```

七个目标模组全部提取成功（`out.failed` 为空对象）。`boss-loot-assets-premium/free` 与
`soundfxlibrary` 按简报要求不在 `TARGETS` 里，因此本次运行中未出现——它们的失败原因
（非 Sequencer 资源库 / 注册进 SoundBoard）在简报的背景说明里已有记录，未来若要纳入
提取需另行处理，本任务不强行凑数硬塞进 `failed`。

各模组叶子数与简报实测表完全一致：`jb2a_patreon`=10038、`JB2A_DnD5e`=1687、
`jb2a-extras`=135、`eskie-effects`=3236、`blfx-assets-pack01`=1412、`psfx-patreon`=930、
`animated-spell-effects-cartoon`=724。合并后 `jb2a`=10060（10038 Patreon 基础上，
免费版补了 22 个 Patreon 没有的分支），达到 ≥10038 的要求。

## `npm test` 完整输出

```
> crucible-anim@0.1.0 test
> node --test test/

TAP version 13
# Subtest: 七个素材命名空间齐备
ok 1 - 七个素材命名空间齐备
# Subtest: jb2a 叶子数达到 Patreon 版实测量级
ok 2 - jb2a 叶子数达到 Patreon 版实测量级
# Subtest: _template 元数据被保留
ok 3 - _template 元数据被保留
# Subtest: 抽样 200 个条目的文件在磁盘上真实存在
ok 4 - 抽样 200 个条目的文件在磁盘上真实存在
# Subtest: 提取失败的模组被显式记录而非静默丢弃
ok 5 - 提取失败的模组被显式记录而非静默丢弃
# Subtest: module.json 字段完整且与常量一致
ok 6 - module.json 字段完整且与常量一致
# Subtest: 清单引用的每个文件都存在
ok 7 - 清单引用的每个文件都存在
# Subtest: 两份语言文件键集合完全一致
ok 8 - 两份语言文件键集合完全一致
# Subtest: 常量自洽
ok 9 - 常量自洽
# Subtest: resolver 与 armory 不得引用 Foundry 全局
ok 10 - resolver 与 armory 不得引用 Foundry 全局
1..10
# tests 10
# pass 10
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

全部 10 个测试（Task 1 的 5 个 + 本任务新增的 5 个）通过。

## 识图工具验证：联系表实际内容

命令：

```
tools/contact-sheet.sh \
  /root/fvtt14-data/Data/modules/jb2a_patreon/Library/Generic/Weapon_Attacks/Melee/Club01_01_Regular_Blue_800x600.webm \
  /tmp/sheet-check.png 6 2
```

输出：`frames=66 step=5 -> /tmp/sheet-check.png`（与简报预期的 `frames=66 step=5` 完全一致）。

用 Read 工具实际打开 `/tmp/sheet-check.png`（6×2=12 帧，黑底网格，每格左上角标黄色帧号），
观察到四个清晰的相位：

- **帧 0**：全黑，动画尚未起始的空白帧。
- **帧 1–5（起手）**：一条细小的灰白色棍棒剪影，斜置在画面中，位置逐帧轻微右移/下移——
  武器举起、开始运动的起手阶段，此时还没有发光特效。
- **帧 6（挥砍弧光）**：一道明亮的蓝色发光弧线划过画面，是武器挥砍轨迹的发光拖尾，
  弧光走向与武器朝向一致。
- **帧 7–8（命中闪爆）**：帧 7 出现一个正在聚拢的蓝色光点，帧 8 爆开成一个带放射状尖刺的
  明亮蓝色环形闪光——典型的命中特效爆闪，是四相位里最亮、最显眼的一帧。
- **帧 9–11（收招）**：灰白色棍棒剪影再次出现，比起手阶段更小更淡，逐渐远离/收回——
  武器收招归位的尾段。

四个相位（起手 → 挥砍弧光 → 命中闪爆 → 收招）在联系表上清晰可辨，取帧均匀（步长 5，
覆盖全部 66 帧），无全黑或单帧塌缩的问题，工具无需修改。

## 遇到的问题与决定

1. **`data/` 目录不存在**：`npm run index` 首次运行前手动 `mkdir -p data`，因为
   `writeFileSync` 不会自动建目录。这不是提取器逻辑问题，属于一次性环境准备，未改动
   `extract-db.mjs`（后续任何全新 checkout 后运行 `npm run index` 前也需要这一步，
   但 `data/asset-index.json` 已提交进 git，正常克隆后不会触发这个问题）。
2. **实现完全照抄简报代码**：`tools/extract-db.mjs`、`tools/contact-sheet.sh`、
   `test/asset-index.test.mjs` 均与简报给出的代码逐字一致，未做任何“改进”或精简，
   避免偏离已验证四轮的沙箱行为。
3. **`boss-loot-*` 与 `soundfxlibrary` 未纳入 `TARGETS`**：按简报明确说明（它们不是
   Sequencer 资源库/注册进 SoundBoard），未强行加入提取列表，也未在 `failed` 里
   人为造一条记录——`failed` 为空对象本身就是本次运行的真实状态，测试断言
  （`index.failed && typeof index.failed === "object"`）对此本就宽松，无需迁就。
4. **合并后 `jb2a` 是 10060 而非 10038**：符合预期——`JB2A_DnD5e`（1687 叶）中有
   22 个 Patreon 版没有的分支被 `mergeTree` 补进去了，验证了“Patreon 优先、免费版补空缺”
   的合并语义按预期工作，测试断言 `>= 10038` 通过。
5. `tools/` 目录按 Task 1 建立的规则不受 `manifest.test.mjs` 里“resolver/armory 禁用
   Foundry 全局”的约束检查，`extract-db.mjs` 中大量全局桩（`globalThis.Hooks` 等）
   是提取器的正当职责，未触发该测试（已用 `npm test` 全量验证）。

无遗留问题，八步均按简报顺序完成，未跳步、未放宽任何测试断言。

---

## 修复轮 1/5：评审反馈（Important 1 + Important 2）

评审裁定「全局桩防污染无测试守护」一项 park 不修（索引已提交进 git，`jb2a ≥ 10038` 与
「200 个抽样文件存在」两条断言已构成回归网），本轮只处理两条「断言了等于没断言」的缺陷。

### 改了什么

**Important 1 — `_template 元数据被保留` 测试太弱**

原断言只检查 2.2MB 序列化字符串里出现过一次 `"_template"` 子串，无法区分「根表健在」和
「根表丢了、只剩叶子上悬空的字符串引用」。用 `node -e` 先探真实数据，确认了：

```
jb2a._templates.melee === [200, 300, 300]
jb2a.melee_attack.01.shortsword._template === "melee"（该分支真实存在，未猜测路径）
eskie._templates / blfx._templates 均存在且非空
```

把测试替换为结构性断言（`test/asset-index.test.mjs`，改名为
「_template 根表存在且字符串引用能解析到锚点」）：
1. `jb2a`/`eskie`/`blfx` 三个命名空间的 `_templates` 根表都存在且是对象；
2. `jb2a._templates.melee` 深度相等 `[200, 300, 300]`；
3. 抽取真实分支 `jb2a.melee_attack["01"].shortsword`，断言其 `_template === "melee"`，
   且该键能在 `jb2a._templates` 根表里用 `hasOwnProperty` 查到（锁住「字符串 → 根表」
   这条解引用链路，而不只是字符串子串存在）。

**Important 2 — `提取失败的模组被显式记录而非静默丢弃` 测试从未走过失败路径**

`tools/extract-db.mjs` 按要求重构：
1. `extract(moduleId)` 加 `export`；
2. 脚本主体（`TARGETS` 循环到 `writeFileSync`）套进直跑守卫：
   ```js
   const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
   if (isMain) { /* 原主体 */ }
   ```
   这样 `import {extract} from "../tools/extract-db.mjs"` 只加载函数定义，
   不会触发整轮提取（七个模组的完整 import + 钩子触发）。
3. `test/asset-index.test.mjs` 新增一条测试，对不存在的模组 id `"__does_not_exist__"`
   调用 `extract()`，断言 `r.error === "模组未安装"`。

### 完整命令与输出

```
$ npm test
> crucible-anim@0.1.0 test
> node --test test/

TAP version 13
ok 1 - 七个素材命名空间齐备
ok 2 - jb2a 叶子数达到 Patreon 版实测量级
ok 3 - _template 根表存在且字符串引用能解析到锚点
ok 4 - 抽样 200 个条目的文件在磁盘上真实存在
ok 5 - 提取失败的模组被显式记录而非静默丢弃
ok 6 - extract() 对未安装的模组返回 error 而非抛出或静默通过
ok 7 - module.json 字段完整且与常量一致
ok 8 - 清单引用的每个文件都存在
ok 9 - 两份语言文件键集合完全一致
ok 10 - 常量自洽
ok 11 - resolver 与 armory 不得引用 Foundry 全局
1..11
# tests 11
# pass 11
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

11/11 通过（Task 1 的 5 个 + Task 2 原有 4 个改动后仍是 4 个位置 + 新增 2 个 = 6 个
`asset-index.test.mjs` 测试 + 5 个 `manifest.test.mjs` 测试）。

### 红/绿验证证据

**Important 2（`extract` 导出 + 直跑守卫）**：用旧版（未导出、无守卫）的
`tools/extract-db.mjs`（`git show HEAD~1:tools/extract-db.mjs`，即修复前的提交）在隔离目录
`/tmp/red-check-old` 里单独跑一次 `import()`：

```
$ cd /tmp/red-check-old && node run.mjs
✓ jb2a_patreon ... (完整提取跑了一遍，证明「没有直跑守卫」本身就是个问题——
                     import 一下就会触发全套七模组提取)
RED as expected (extract not exported / call failed): mod.extract is not a function
```

即：旧版本子既跑了不该跑的完整提取（副作用），又拿不到可调用的 `extract`
（`mod.extract is not a function`）——两个问题都被新测试挡住。
新版本上跑同一测试，`node --test test/asset-index.test.mjs` 全绿，且第 6 条测试
`duration_ms` 只有个位数毫秒（未触发整轮提取的证据，见下方完整耗时输出）：

```
ok 6 - extract() 对未安装的模组返回 error 而非抛出或静默通过
  duration_ms: 6.207138
...
real  0m0.114s   # 整个 test/asset-index.test.mjs 六条测试总耗时，证明未跑整轮提取
```

**Important 1（`_template` 结构断言）**：直接在真实 `data/asset-index.json` 上做两种破坏
性修改，确认测试 3 变红，再用备份还原确认变绿：

```
# 破坏 1：删掉整个根表 jb2a._templates
$ node -e "...delete d.tree.jb2a._templates..." && node --test test/asset-index.test.mjs
not ok 3 - _template 根表存在且字符串引用能解析到锚点
# pass 5 / # fail 1

# 破坏 2：根表还在，但只删掉 melee 这一条键（模拟「叶子引用悬空」）
$ node -e "...delete d.tree.jb2a._templates.melee..." && node --test test/asset-index.test.mjs
not ok 3 - _template 根表存在且字符串引用能解析到锚点
# pass 5 / # fail 1

# 还原
$ cp /tmp/asset-index-backup.json data/asset-index.json
$ node --test test/asset-index.test.mjs
ok 3 - _template 根表存在且字符串引用能解析到锚点
# pass 6 / # fail 0
$ md5sum data/asset-index.json
867c2a6397576f29b892a0b0de38e1aa  data/asset-index.json   # 与破坏前完全一致
```

两种破坏方式（根表整体丢失 / 单个引用悬空）都被新断言捕获，旧的子串断言对这两种破坏
都是绿的（子串 `"_template"` 依然存在于其他叶子上）——证明新断言确实比旧的更强。

### `npm run index` 重构前后产出一致的 md5 证据

重构 `extract-db.mjs`（加 `export` + `isMain` 守卫）不改变行为，实测：

```
$ md5sum data/asset-index.json         # 重构前（评审给出的基准值）
867c2a6397576f29b892a0b0de38e1aa  data/asset-index.json

$ npm run index                        # 用重构后的 extract-db.mjs 重新跑一遍
✓ jb2a_patreon ... (七行 ✓，与之前完全相同)
已写入 data/asset-index.json

$ md5sum data/asset-index.json         # 重构后
867c2a6397576f29b892a0b0de38e1aa  data/asset-index.json
```

md5 完全相同（`generated` 字段因为同一天运行也没有变化，`2026-08-19` → `2026-08-19`），
`tree`/`modules`/`failed` 三个字段另用 `JSON.stringify` 逐字段比对也确认一致。重构未改变产出。

### 结论

两条评审意见均已按要求修复：Important 1 从「子串存在」改为「根表结构 + 引用不悬空」的
结构性断言；Important 2 通过 `export` + 直跑守卫让失败路径可被独立测试覆盖，且用隔离环境
证明了旧代码在两个维度上都有问题（不可调用、且会有不必要的完整提取副作用）。
`data/asset-index.json` 内容未变（md5 校验），提交 `1e611f8`。
