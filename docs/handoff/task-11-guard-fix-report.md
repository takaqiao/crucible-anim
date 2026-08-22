# Task 11 守卫修复报告

基线 HEAD `4f44744`、131/131。本轮修的不是业务 bug，是两道防线本身的漏洞：
`test/armory-assets.test.mjs` 的素材路径扫描器只认 `ctx.pick()`/`ctx.sound()` 的
直接字面量参数，漏掉了放进表对象、以变量传入的路径；`test/manifest.test.mjs` 的
Foundry 全局扫描器用 `\b` 判边界，把 `jb2a.ui.miss.white` 里 `ui` 前的那个点误判成
`ui.` 全局引用，逼出了一处用字符串拼接绕过扫描器的坏味道代码。落地后
**133/133 全绿**（131 基线 + 本轮新增 2 条断言）。

---

## 一、缺陷 1：素材守卫的路径扫描器

### 问题实测

用旧正则 `/ctx\.(?:pick|sound)\(\s*["']([^"']+)["']/g` 与新正则分别扫描三个文件，
结果与任务描述完全吻合：

| 文件 | 旧守卫看到 | 文件里实际有（新算法，去重后） | 漏检 |
|---|---|---|---|
| impact.mjs | 1 | 18 | 17 |
| travel.mjs | 8 | 10 | 2 |
| cast.mjs | 8 | 8（无漏检，8 条全是直接字面量调用） |

impact.mjs 的 17 条漏检全部来自 `RESULT_LAYER`/`ELEMENT_LAYER` 两个表对象——路径写
在 `{path: "..."}` 里，运行时靠 `ctx.pick(spec.path)`/`ctx.pick(el.path)` 间接传入；
travel.mjs 的 2 条漏检来自 `strike.melee` 的三元表达式
`const branch = adjacent ? "jb2a.melee_attack.01.shortsword.01" : "jb2a.melee_attack.05.nodachi.01"; ctx.pick(branch)`。

### 修法

`pickedPaths()` 改成扫描剥离注释后的整份源码，抓取所有匹配已知命名空间前缀
（`jb2a`/`jb2a-extras`/`eskie`/`blfx`/`psfx`/`animated-spell-effects-cartoon`）的
完整字符串字面量，不再关心它是不是直接躺在 `ctx.pick()` 括号里。注释剥离逻辑与
`test/manifest.test.mjs` 的 `stripComments` 同法（先去 `/* */` 块注释，再去 `//`
行尾注释）。

**对任务给的参考正则做了一处必要修正**：字符类从 `[a-zA-Z0-9_.]+` 改成
`[a-zA-Z0-9_.-]+`，补上连字符。核实过 `docs/ASSET-NOTES.md` 主表 94 行里有 17 行
psfx 命名空间的路径本身就含连字符（如 `psfx.ranged-weapons.longbow.v1.30ft`、
`psfx.casting.on-token.001`）；不带连字符的字符类会把这些合法路径从中间截断成
`psfx.ranged`，那既不是任何主表行的精确匹配也不是父路径，会把 cast.mjs 里这条
已验证过的合法调用误判成「查不到依据」——即用任务给的参考正则原样实现会在完全没有
恶意绕过的正常代码上制造新的假阳性。改动后重新验证：这条路径能被完整抓到且在主表
里精确命中。

### 覆盖率自查断言（新增测试 4）

按要求把「扫描完必须自查覆盖率」做成了一条独立断言，且刻意用一套**与主抽取逻辑不同
的算法**去复核，避免自查沦为「拿同一个正则再跑一遍」的重言式：

- 主抽取（`pickedPaths`）：单条正则直接在剥注释源码上找「引号 + 已知前缀 + 点 +
  合法字符 + 引号」。
- 自查侧（`allQuotedLiterals` + `looksLikeDbPath`）：先用一个只认引号与转义、不关心
  内容的通用字符串字面量正则切出剥注释源码里**所有**引号字符串，再对每一条单独判定
  「第一个 `.` 之前的那一段在不在已知前缀清单里」。

两条独立路径分别统计出的条数必须相等；如果将来主抽取的字符类又被谁改窄（就像本轮
修复前那样漏掉连字符），或者出现新的传参写法让主抽取漏看某类字面量，两边条数就会
对不上，断言变红——而不是像当年 Task 9 那样，漏看的路径根本不会进入校验循环，静悄悄
地不报错。测试运行时会打印每个文件两侧的条数（见下方红/绿证据）。

---

## 二、缺陷 2：字符串拼接绕过扫描器

### 根因

`test/manifest.test.mjs` 原 banned 正则：
`/\b(game|canvas|Hooks|Sequencer|ui|CONFIG)\s*\.|Math\.random\s*\(/`。`\b` 只看
「是不是标识符边界」，不看边界前到底是字母还是点号——`jb2a.ui.miss.white` 里 `ui`
前面是 `.`（非单词字符），`u` 是单词字符，边界成立，于是这条合法素材路径被误判成
引用了 `ui.` 全局。上一位实现者用 `"jb2a.ui" + ".miss.white"` 绕开这个假阳性，副
作用是这条路径也从 `test/armory-assets.test.mjs` 的扫描范围里消失了（虽然实测下来，
「jb2a.ui」这个拼接碎片恰好是 `jb2a.ui.miss.white` 的父路径前缀，会被现有的
「精确命中或父路径」判定误判为合法，侥幸没有触发误报——这正说明了为什么需要缺陷 2
自己单独一条断言，而不是指望缺陷 1 的路径校验顺带堵上这个绕法）。

### 修法

1. **正则**：`\b` 换成 `(?<![\w.])`，只在 banned 分支的第一部分生效，`Math\.random\s*\(`
   原样不动（任务要求）。负向后顾比 `\b` 多看一层：要求匹配起点前一个字符既不是单词
   字符也不是点号，这样「作为某条路径的一段被点出来」（前面必是 `.`）与「真正引用
   全局」（前面必是空格/括号/等号/语句开头等，不可能是 `.` 或字母数字下划线）就被
   精确区分开了。
2. **还原字面量**：`impact.mjs` 的 `[RESULT.MISS]` 路径改回完整的
   `"jb2a.ui.miss.white"`，并更新了旁边的注释说明为什么不再需要拼接绕法。
3. **新增断言（测试 5）禁止拼接绕法**：只在「两个引号字符串字面量之间紧挨着一个 `+`」
   这个窄口子上判定，且要求**把两段内容拼起来之后整体匹配完整的 DB 路径模式**才算
   违规（不要求任一段单独看起来就像路径）。取舍理由：
   - 不误伤：普通的字符串拼接（拼错误提示、拼日志、拼与路径无关的任意两段文本）
     拼出来的结果不会长得像 `jb2a.xxx`/`eskie.xxx` 等，不会命中。
   - 不会被「把断点切得更巧妙」躲过：因为判定标准是拼接后的整体结果，而不是「第一段
     是不是以已知前缀开头」——即便故意把断点切在前缀内部（比如
     `"jb2a" + ".ui.miss.white"`，第一段单独看甚至不完整），拼起来的整体判定同样会
     命中。
   - 已知局限（写进了代码注释里）：只处理相邻两段字面量的拼接，三段及以上的链式拼接
     （`"a" + "b" + "c"`）只保证前两段被纳入判定。当前代码库里只有这一处唯一的拼接
     实例，且只涉及两段，覆盖率自查断言可以在将来出现新的可疑字面量时兜底发现。

---

## 三、红/绿证据（临时探针，验证后已全部还原）

**缺陷 1 · 覆盖率扫描**

```
[覆盖率自查] impact.mjs: 守卫看到 21 条 / 文件实际 21 条
[覆盖率自查] travel.mjs: 守卫看到 10 条 / 文件实际 10 条
[覆盖率自查] cast.mjs:   守卫看到 8 条 / 文件实际 8 条
```
（21 = 8 条 RESULT_LAYER + 12 条 ELEMENT_LAYER + 1 条 generic.impact 兜底字面量，
不去重的原始出现次数；`jb2a.liquid.splash.red` 在 ELEMENT_LAYER 里出现 3 次，唯一
路径去重后是 18 条，与任务描述的「实际有 18」一致。）

**缺陷 1 · 注入否决清单路径（impact.mjs 的 `ELEMENT_LAYER.void` 临时改成否决清单
第一条 `jb2a.cast_generic.03.blue`）**：

```
not ok 1 - 兵库规则引用的每条 DB 路径都能在 ASSET-NOTES 主表里查到依据，且不在否决清单里
  error: 1 条兵库路径没有 ASSET-NOTES 依据或已被否决：
    scripts/armory/impact.mjs: "jb2a.cast_generic.03.blue" — 在否决清单里
```
还原后重跑 → 5/5 全绿。

**缺陷 1 · 注入主表里没有的路径（travel.mjs 的 `strike.melee` 分支临时改成
`"jb2a.this.does.not.exist"`）**：

```
not ok 1 - 兵库规则引用的每条 DB 路径都能在 ASSET-NOTES 主表里查到依据，且不在否决清单里
  error: 1 条兵库路径没有 ASSET-NOTES 依据或已被否决：
    scripts/armory/travel.mjs: "jb2a.this.does.not.exist" — 主表里查不到依据（既非精确命中也非某行的父路径）
```
还原后重跑 → 5/5 全绿。

**缺陷 2 · 正则修正后，完整字面量不再误报**：`test/manifest.test.mjs` 单独跑
5/5 全绿（含 `jb2a.ui.miss.white` 所在的 impact.mjs）。

**缺陷 2 · 真违规仍被抓住**（临时在 `scripts/resolver/context.mjs` 末尾加一行探针，
逐个测试后还原）：

```
探针 const x = ui.notifications;  → not ok 5 - resolver 与 armory 不得引用 Foundry 全局或 Math.random
探针 const y = game.actors;       → not ok 5 - resolver 与 armory 不得引用 Foundry 全局或 Math.random
探针 const z = Math.random();     → not ok 5 - resolver 与 armory 不得引用 Foundry 全局或 Math.random
```
三次探针后都用 diff 确认 `context.mjs` 已恢复成探针前的原始内容。

**缺陷 2 · 拼接绕法被新断言抓住**（临时把 impact.mjs 的字面量改回
`"jb2a.ui" + ".miss.white"`）：

```
not ok 5 - 兵库文件里的 DB 路径不得以字符串拼接的形式出现（禁止绕过路径扫描器）
  error: scripts/armory/impact.mjs: "jb2a.ui" + ".miss.white" 拼出 "jb2a.ui.miss.white"——
         DB 路径不得用字符串拼接绕过扫描器，请写成完整字面量
```
还原后重跑 → 5/5 全绿。

---

## 四、回归复算（自己跑，未采信任何转述）

```
actions total: 434
effects total: 46
zero-target attack actions: 53

actions with >=1 cue: 434 / 434
zero-target with cast cue: 53 / 53
effects with >=1 cue: 46 / 46
degradation rate: 0.00% (0/434)
plan.warnings total across all actions: 0
```

`npm test` 全量 **133/133**（131 基线 + 2 条新断言：覆盖率自查、拼接绕法禁令）。

---

## 五、修好守卫后有没有查出 Task 11 的路径问题

**没有。** 守卫修好后，用新的扫描逻辑把 impact.mjs 全部 18 条唯一路径（含此前完全
不在旧守卫视野内的 17 条）逐条与 `docs/ASSET-NOTES.md` 主表核对：**18 条全部是主表
精确命中，无一条落在否决清单里，也无一条靠「父路径」这种宽松判定侥幸过关**——即便
是被拼接绕过、原本连字面量都不完整的 `jb2a.ui.miss.white`，还原成完整字符串后同样
精确命中主表。travel.mjs 此前漏检的 2 条（`jb2a.melee_attack.01.shortsword.01` /
`jb2a.melee_attack.05.nodachi.01`）也都精确命中主表。回归复算的 0% 降级率、0 条
`plan.warnings` 与这个结论一致：Task 11 的 20 条路径经得起机器校验，人工核对没有
遗留问题。

---

## 六、改动文件

- `test/armory-assets.test.mjs`：`pickedPaths()` 改为全文件字面量扫描（含
  `stripComments`/`DB_PREFIXES` 等辅助函数），新增覆盖率自查与拼接绕法禁令两条测试。
- `test/manifest.test.mjs`：banned 正则的 `\b` 换成 `(?<![\w.])`。
- `scripts/armory/impact.mjs`：`[RESULT.MISS]` 的路径从拼接字面量还原成完整字符串
  `"jb2a.ui.miss.white"`，更新旁注。
