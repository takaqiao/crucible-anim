# Task 8 交付物修订报告

四个验证视角（table-audit / tool-fix / note-fidelity / frame-sweep）全部给出 ISSUES。
本轮按其结论修订了三份文件：`tools/contact-sheet.sh`、`docs/ASSET-NOTES.md`、
`test/asset-notes.test.mjs`。以下是逐项的处理与复验输出。

---

## 1. 工具修复：`tools/contact-sheet.sh`

按 tool-fix 视角设计并实测过的脚本落盘，权限 `-rwxr-xr-x`（84 行，旧版 17 行）。
两个 Critical 都在这一版里：**按 codec 选 `libvpx` / `libvpx-vp9` 解出 WebM 的 alpha 平面**，
以及**用 `setpts=N/TB` + `color … r=1` 保证 overlay 的 framesync 与素材帧一一对应**
（直接拿默认 25fps 的 color 源当 overlay 主输入会把 30fps 素材重采样丢帧）。
另含：合成 0x303030 底 + 链尾 `format=rgb24`（输出 PNG 不带 alpha 通道）、
libvpx 失败时打警告并回退默认解码器、缺参数/文件不存在的显式守卫（exit 2）、
帧数非法 exit 3。抽帧步长算法与 stdout 约定与旧版逐字一致。

### 落盘后自己重跑的验证

**(a) VP8 + alpha 的联系表（任务点名的 `GenericCast01_01_Regular_Blue_400x400.webm`）**

```
$ tools/contact-sheet.sh …/Generic/Cast/GenericCast01_01_Regular_Blue_400x400.webm after_vp8.png
…/GenericCast01_01_Regular_Blue_400x400.webm  frames=21 step=1 -> after_vp8.png
EXIT=0（stderr 无输出）

$ ffprobe -show_entries stream=pix_fmt,width,height   → 1030,342,rgb24   （无 alpha 通道）
底色三处 16x16 采样（贴片内空白区、贴片顶部、贴片右下）：
  after_vp8.png   R=48.0 G=48.0 B=48.0   → 精确 0x303030
  before_vp8.png  R=253.0 G=253.0 B=253.0 → 旧版是白底
```

**用 Read 实际打开两张图对比**（这一步不是量化，是真的看图）：

- 修复前：整张 12 格全白底，蓝色漩涡臂画在白底上，特效自己的白色高光与背景糊成一片，
  第 0、1 格是纯白（其实是空帧），第 9-11 格背景里还能看到一圈灰色的解码残迹。
- 修复后：背景是均匀的 0x303030 深灰，空帧（第 0、1 格）就是干净的一块深灰；
  相位一眼可读——第 2 格两条细弧起手 → 3-5 格旋开成环 → 6-8 格达到最大直径且环带最厚
  → 9-11 格向心收拢缩小。**环心一直是深灰底色（透明）**，修复前那团白完全可能被误判成「亮核」。
  顺带用这张图交叉确认了 note-fidelity 的结论：第 6-8 格的环四周仍有留边，
  **没有**原记录说的「左右被画幅切平的两个平口」。

**(b) `frames=N step=S` 仍然照常打印**：上面 `frames=21 step=1`；
VP9 + 自定义 4x3：`frames=36 step=3 -> after_vp9_4x3.png`（686x514，rgb24，exit 0）。

**(c) 不存在的文件报错退出、不静默产图**

```
$ tools/contact-sheet.sh …/modules/nope/does_not_exist.webm should_not_exist.png
contact-sheet: no such file: …/modules/nope/does_not_exist.webm
EXIT=2
$ ls should_not_exist.png → No such file or directory      ← 确认没有产出空图
$ tools/contact-sheet.sh only_one.webm
contact-sheet: usage: …/contact-sheet.sh <webm> <out.png> [cols] [rows]
EXIT=2
```

**(d) 帧精确性回归**（tool-fix 视角报的第二个 Critical，30fps 素材被 25fps 重采样）

```
Club01_01_Regular_Blue_800x600.webm（66 帧 @30fps，step=5，应得 14 帧）
  旧脚本滤镜链   old_bytes=913920
  新滤镜链       new_bytes=913920   same=YES   frames=14
```

**已知遗留（未改，因为不在已实测脚本的范围内）**：`drawtext` 的 `%{n}` 画在 `select` 之后，
黄色数字是**贴片序号**而不是源帧号，源帧号 = 贴片号 × step。已在 ASSET-NOTES 前言里
写成一条独立提醒——note-fidelity 判定 `aura_themed` 那条「72-99 帧变暗」的假象
八成就是照着黄字反推出来的。

---

## 2. 订正的记录行（依据 = note-fidelity 的逐帧量化）

被判「失真」4 行、「部分失真」2 行，全部就地改写备注并在句首标【订正】，**没有删行**
（6 条素材本身都仍然可用，不属于「完全不适用」，因此不移入被否清单）。

| 行（DB 路径） | 原断言 | 复核实证 → 改成什么 |
| --- | --- | --- |
| `jb2a.healing_generic.400px.green` | 帧 4-32 是近乎不透明实心绿块会盖死 token、必须压 opacity；帧 36-40 才镂空成绿环；空尾从 f44 起 | 真身是十字星花粒子簇 + 细光环。中心 100x100 alpha：f10=216 / f20=174 / f32=11；细光环自 f10 起一直可见；f36-f38 全画面 alpha 峰值仅 53→20，无「36-40 才镂空」这一相位。空尾改为从 **f40** 起、endTime ~40 帧 |
| `jb2a.cast_generic.01.blue` | 第 7-8 帧能量超出画布、左右被切平、只能小尺寸用 | f2-f9 四条边 alpha 最大值 ≤5/255（左列恒 0），f7/f8 bbox = x[5-394] / x[6-392]，留边 5-8px，从未被裁切；删掉「只能小尺寸用」的限制 |
| `eskie.burn.embers.orange` | 余烬全在 y10%-40%、下三分之一是空的、需下移或放大 1.3 倍 | 8 条横带 alpha 均值 0.94/6.46/12.83/14.28/**14.72**/11.17/5.05/0.20，峰值在正中央，居中贴才对；另把「首尾帧完全一致」降级为「构图吻合」（PSNR 20.2dB vs 相邻帧 23.8dB） |
| `eskie.pulse.energy.01.purple` | 环在帧 11-13 撑到画布边缘被裁出左右两条直边 | f10-f14 最左/最右列 alpha ≤3/255，bbox 最大 x[18-783]，完整闭合圆；同时按 29.97fps 把「23 帧≈0.9s」订正为 0.767s |
| `jb2a.aura_themed.01.inward.loop.metal.01.grey` | 约第 72-99 帧整体变暗接近消失 | 全片 alpha 均值只有 6.44～10.06、黑底亮度 19.50～21.61，最暗段是 f57-f66；保留「首尾一致、非 outro」的正确结论 |
| `jb2a.shield.02.outro_explode.blue` | 圆心近乎透空；startTime 到 ~20，否则前 0.7s 什么都没发生 | 中心 alpha 均值 74.6/255≈29%、峰值 58%（是蓝纱不是透空）；f8 已达稳态 53%、f15 起满亮平台，起势是线性淡入。同时把行内「0-8 帧几乎全暗」改为「0-7 帧偏暗但一直在线性变亮」以免自相矛盾 |

另按 frame-sweep 订正了 4 处**秒数**错误（都是帧率换算错，帧数本身全对）：
`eskie.poison.01.green`（约9s → 60fps/4.500s，差 2 倍）、
`jb2a.unarmed_strike.physical.01.blue`（≈0.5秒 → 1.033s，差 2 倍）、
`eskie.attack.ranged.arrow.ray…30ft`（约0.4秒 → 24fps/1.000s，差 2.5 倍）、
`eskie.pulse.energy.01.purple`（≈0.9s → 0.767s）。

并给 5 行补了运行时分支/variant 警告：`melee_attack.01.shortsword.01`（4 文件 46/40/39/41，
每次攻击重掷）、`jb2a.teleport.01.white` 的 DODGE 备选（`…grey.0` 的 `.0` 被静默丢弃、
5 文件 32-57 帧）、`unarmed_strike.physical.01.blue`（dark_purple/dark_red=51 帧）、
`tmfx.inpulse.circle.02.normal`（fast 减半）、`blood1.splatter.red`（兄弟 static 是 1 帧静帧）。

**标为【待复核】而非订正的**（观感型断言、本轮没有逐帧量化）：
`eskie.casting.physical.01.side.one_shot.orange`（「alpha 只有 center 版一半」与它自己给的
峰值 26 vs 29 自相矛盾）、`jb2a.markers.snowflake.blue.01`（浓淡判断写于工具修复前）、
`eskie.buff.loop.simple.blue`（与已证伪的 embers 同型）、以及 persist 槽 12 组 marker 行
（全表唯一「无任何可证伪数字」的成片区域，抽验的 `markers.drop.red.01` 属实，但其余
如其所写无法证伪）。这些在文末「本轮订正与待复核」里集中列出。

---

## 3. 新增章节「同族分支的帧数与帧率不一致」

规模：**5 张表 + 3 段结论，覆盖 71 条视觉记录 / 67 个父节点 / 362 个 ffprobe 过的文件**。

- **A. 颜色分支帧数不一致（`pickColor` 运行时可达）——7 行**：`jb2a.impact.007.*`(1.83x)、
  `jb2a.unarmed_strike.physical.01.*`(1.65x)、`jb2a.extras.tmfx.inpulse.circle.02.*`(2.00x)、
  `blfx…blood1.splatter.*`(56x，webm vs 1 帧静帧)、`jb2a.impact.009.*`(3.63x，仅备注提及)、
  `jb2a.unarmed_strike.no_hit.01.*`(1.76x，仅备注提及)、`jb2a.markers.skull.*.01`(1.007x 容差内)。
- **B. 一个叶子挂多文件、variant 帧数不一致（`ctx.pick()` 每次随机取一）——4 行**：
  `melee_attack.01.shortsword.01`(46/40/39/41)、`smoke.puff.side.grey`(33/33/36/32/57)，
  外加两组已确认一致的对照。
- **C. 逐条帧率——17 行**（按槽位 × 帧率分组，列出全部 71 条的帧数与实测秒数）。
  两处最尖锐的后果单独点出：persist 的 marker 环分 24fps/30fps 两派（统一按 frames/30 算
  每圈短算 1.2s）、impact 同一瞬间叠的两层分属 30 / 24 / 29.97fps。
- **D. 备注秒数订正——4 行**，外加 11 条核对无误的秒数留档。
- **E. 已核对一致的 62 个父节点**，其中明确点出**兵库当前在用的 5 条路径全部内部一致**
  （今天跑起来不会因换色错位，风险全在待接入的 71 条选材上）。

另记录了一处本轮未改的上游不一致：`docs/DESIGN.md:466` 把记录格式定成「帧数与时长（30fps）」，
与实测的 5 种帧率冲突，已在新章节里注明「以本节逐条帧率为准」。

---

## 4. 新列 `自带闪爆`

列序：路径 / 槽位 / 相位结构 / 锚点 / 帧数 / stretchTo / mirrorY / **自带闪爆** / 备注
（8 列 → **9 列**，表头与分隔行同步）。

**统计：93 行里 29 行标「是」、64 行标「否」。**
按槽位：cast 9 / travel 4 / **impact 15** / aftermath 1 / persist 0 / sound 0。
也就是 impact 槽 22 条视觉记录里有 15 条素材内部已经带了一次爆发帧——
再叠通用闪光层就是大面积双闪，这正是 Task 8 汇总报告担心的情况。

判定口径（写进前言）：**素材自己某几帧出现的高亮爆发**（白闪 / 星芒爆闪 / 亮核爆出 /
自带命中光环），不是「这条素材被当闪光用」这种语义描述。三条边界判定留了档：
`jb2a.shield.02.outro_explode`（结尾是碎裂不是白闪）、`jb2a.teleport.01`（白色拖影亮带）、
`eskie.pulse.energy.01`（同心冲击环，帧 0 即有环但无亮核爆发）——均判「否」。
反过来，两条**关键词扫不到但确实自带**的行是人工补上的：
`blfx.weapon.range.dagger1.throw1.color1.30ft`（「金色命中光环自带」）与
`blfx…fireball1.ground.burn.orange`（前 48 帧是满屏火球爆炸，备注自己写了「会和 impact 层双爆」）；
`jb2a.static_electricity.01.blue` 的关键词命中来自「**不是**命中瞬闪」这个否定句，判「否」。

---

## 5. 守卫断言的修复与红/绿证据

table-audit 报出 3 条断言可绕过（A2/A3/E/F 四个探针在旧测试下全绿）。三条全部改掉：

1. **路径断言只查 `diverged`，不比对结果路径** → 增加 `r.path === p`、`r.files.length > 0`、
   `a.warnings.length === 0` 三重校验。根因在 `scripts/resolver/assets.mjs:135` 的 while 循环
   遇到叶子就退出、剩余段不计 diverged（本轮**未改 resolver**，只在测试侧补断言：
   现有 93 行全部满足 `r.path === p`，补这条零成本）。
2. **`rows()` 用 `l.startsWith("| \`")` 挑行**，首列漏反引号的行被所有断言静默跳过 →
   改成**以表头行为锚取其后连续的表格块**，块内除分隔行外全是数据行，格式跑偏也逃不掉；
   再加一条「九列齐全 + 首列必须是反引号包起来的 DB 点分路径」的形状断言
   （正则 `^[A-Za-z0-9_][A-Za-z0-9_.-]*$` 同时挡掉含斜杠的裸文件路径——
   `resolve()` 对含斜杠输入直接短路返回、连存不存在都不查）。
   顺带解决了新章节引入的问题：文末附录有 5 张表、21 行也以 `` | ` `` 开头，
   旧的挑行方式会把它们当成清单条目（`| \`` 开头的行现在全文档共 114 行，主表只有 93 行）。
3. **「五个槽位都有选材」是 `md.includes("| persist |")` 全文档子串匹配** →
   改成按行取槽位列做集合判断。

新增一条断言：**`自带闪爆` 列只能是 是 / 否**（列出现留空或写别的值等于没记）。

### 破坏 → 红 → 还原 → 绿（每次只跑 `node --test test/asset-notes.test.mjs`，6 个用例）

```
基线                              绿  tests 6 / pass 6 / fail 0   （全量 npm test: 69/69）

A  插入不存在的路径行              红  not ok 3 - 清单里每条路径都能无降级地解析，且解析结果与写下的路径逐字相等
B  清空某行「相位结构」列           红  not ok 5 - 每条记录都填了相位结构与锚点，没有留空
C  删掉全部 persist 行             红  not ok 1 - 清单条目数达到覆盖五槽所需的规模
                                       not ok 4 - 五个槽位都有选材
D  备注列塞裸竖线                  红  not ok 2 - 表格行的形状合法：九列齐全、首列是反引号包起来的 DB 点分路径

—— 以下四条在修复前是全绿（table-audit 的 5b 追加探针）——
A2 真实叶子后再接任意段            红  not ok 3 - …解析结果与写下的路径逐字相等
   （jb2a.impact.005.white.bogus_suffix.zzz → r.path 变回 jb2a.impact.005.white）
A3 首列写成裸文件路径              红  not ok 2 - …首列是反引号包起来的 DB 点分路径
   （modules/jb2a_patreon/Library/does_not_exist_at_all.webm）
E  无反引号+空列+多一列+不存在路径  红  not ok 2 - …行的形状合法
                                       not ok 3 - …解析结果与写下的路径逐字相等
                                       not ok 5 - …没有留空
F  删光 persist + 补足 93 行 + 正文塞 "| persist | 槽…"
                                   红  not ok 4 - 五个槽位都有选材

—— 新列的探针 ——
G  清空某行「自带闪爆」列           红  not ok 6 - 自带闪爆列只能是 是 / 否

每次实验后 copy 回备份；还原确认 md5 一致、npm test 回到 69/69。
```

---

## 6. 最终状态

```
$ npm test
# tests 69   # pass 69   # fail 0        （旧基线 67，新增 2 个用例）

docs/ASSET-NOTES.md      403 行（原 207）；主表 93 行 × 9 列；文末新增 2 节 / 5 张附录表
test/asset-notes.test.mjs 137 行（原 77）；6 个用例
tools/contact-sheet.sh    84 行（原 17）；可执行位保留
所有 markdown 表格列宽自检一致
```

## 仍然遗留

- **`scripts/resolver/assets.mjs:135` 的 bestFit 本身没改**：路径尾部多写一级仍然返回
  `diverged=false` 且不进 warnings 队列；`resolve()` 对含斜杠的输入仍然短路返回、不校验存在性。
  本轮只在守卫测试侧堵住了这两个口子（清单里写错会红），运行时规则若写出同样的路径依旧静默。
- **`docs/DESIGN.md:466`「帧数与时长（30fps）」未改**：与实测的 5 种帧率冲突，
  只在 ASSET-NOTES 新章节里加了「以本节为准」的注记。
- **联系表的黄色帧号仍是贴片序号**：已在文档里写明换算方式，脚本本身未动
  （改它会偏离 tool-fix 视角实测过的那版滤镜链）。
- **待复核的观感型断言未重测**：3 行 + persist 槽 12 组 marker 行（合计 15 行）只标了
  【待复核】。后续兵库任务若要依赖这些行的密度/亮度/缺口位置描述，需用修好的工具重看一遍。
- **多文件 variant 的相位图只在 variant 01 上读过**：`shortsword.01` 的另外三个 variant
  与 `smoke.puff.side.grey` 的 5 个文件，命中帧号至今没核对。
