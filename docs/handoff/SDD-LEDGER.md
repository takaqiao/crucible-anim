# SDD ledger — plan: /root/crucible-anim/docs/IMPLEMENTATION-PLAN.md

Spec: /root/crucible-anim/docs/DESIGN.md (可达)
Branch: v1-implementation (从 master 起，master 只有 2 个文档提交)
Ruling: 用同仓库分支而非 git worktree 隔离 — 本仓库为本计划专用、无并行工作，且 worktree 会
  与已装的 node_modules 和 Task 16 的 Foundry 符号链接路径冲突 — 若错，代价是 master 上多一条
  可随时删除的分支。

## Pre-flight 冲突扫描

### 跨任务共享（每对共享文件/接口一行）

| 任务对 | 共享物 | 产出 vs 消费 | 结论 |
| --- | --- | --- | --- |
| 1 → 7,11,13,14 | scripts/const.mjs | T1 出 MODULE_ID/META_KEY/PLAN_VERSION/SLOTS/RESULT/RESULT_NAME/HIT_RESULTS/SETTINGS；T7 用 PLAN_VERSION+SLOTS，T11 用 RESULT+RESULT_NAME+HIT_RESULTS，T13 用 PLAN_VERSION，T14 用 META_KEY | 一致 |
| 1 → 14 → 15 | scripts/main.mjs | T1 建（ready 回调非 async）；T14 追加挂载并改 async；T15 再追加 | 一致，T14 Step 5 已明写改 async |
| 2 → 3 | data/asset-index.json | T2 出 {generated,modules,failed,tree}；T3 offlineBackend 读 index.tree | 一致 |
| 2 → 8 | tools/contact-sheet.sh | T2 建；T8 用 | 一致 |
| 3 → 4 | assets 门面 | T3 出 {resolve,colorsUnder,warnings}；T4 pickColor 用 colorsUnder | 一致 |
| 3 → 7 | assets 门面 | T7 createContext({assets}) 用 resolve+colorsUnder | 一致 |
| 4 → 7 | palette | T4 出 RUNE_COLOR/DAMAGE_COLOR/pickColor；T7 context.mjs 全部 import | 一致 |
| 5 → 6 | hashSeed（两份实现） | T5 内联一份，T6 导出一份 | 一致，T6 Step 5 有专门一致性校验 |
| 5 → 7 | test/fixtures/actions.json | T5 出 ActionSnapshot 形状；T7 coverage 测试消费 | **见 F5** |
| 6 → 14 | snapshotAction | T6 出；T14 wrap.mjs 用 | 一致 |
| 6 → 15 | snapshotEffect | T6 出；T15 effects.mjs 用 | 一致 |
| 7 → 9,10,11,12 | 规则形状 {id,pri,when,build} + ctx | T7 定义；T9-12 填充 | 一致；build 入参 cast=(s,ctx)、travel/impact/aftermath=(s,ctx,target)、persist=(e,ctx) |
| 7 → 13 | FXPlan cue 字段 | T7 CUE_DEFAULTS 定义；T13 playPlan 消费 | **见 F3** |
| 8 → 9,10,11,12 | docs/ASSET-NOTES.md | T8 出已验证路径；T9-12 填进兵库 | 一致 |
| 11 → 13 | kind:"shake" cue | T11 出 {intensity,duration,delay} 无 file；T13 用 copySprite 分支，intensity 有 ?? 兜底 | 一致 |
| 13 → 14 | resolveRef 注入 | T13 playPlan 收；T14 resolveRefIn 供 | 一致 |
| 14 → 15 | dispatch.mjs 导出 | T14 出 animationsEnabled/resolveRefIn/playFromMessage；T15 三个都 import | 一致 |

### 任务内自洽（每任务一行）

| 任务 | 自洽性 | 结论 |
| --- | --- | --- |
| 1 | 测试 vs 代码 | **F1** — 测试用 fs.globSync，Node v20.20.2 无此 API |
| 2 | 沙箱代码 vs 实测结果表 | 一致（沙箱原型已实测 7/10 通过） |
| 3 | 8 条断言 vs bestFit/offlineBackend 实现 | 一致（divergedAt 推导、_template 字符串引用经 _templates 解引用、含斜杠直通、null 路径均对得上） |
| 4 | 测试 vs 色表 | **F4** — 测试依赖 COLOR_HUE 里的合成键 __t350/__t10，污染生产色表 |
| 5 | fixture 形状 vs T6 快照形状 | **F5** — makeToken 缺 w/h；且两个目标 x 均 > 原点，onLeft 恒为 false |
| 6 | 7 条断言 vs 实现 | 一致 |
| 7 | 测试 vs resolve/context 实现 | 一致（firstMatch 只取一条 → T10「blast 无 travel」得以成立）；一处无害死条件见 F6 |
| 8 | 表格断言 vs 文档格式 | 一致 |
| 9 | 测试 vs 规则清单 | 一致（surge 属 travel 槽，故 cast 落到 spell.composed，两条断言不打架） |
| 10 | 测试 vs 规则清单 vs fixture | 一致（ray/cone 的 region 类型与 fixture 的 TARGET_REGION 对得上） |
| 11 | 测试 vs RESULT_LAYER/ELEMENT_LAYER | 一致（8 结果全覆盖，playIf 取值与 RESULT_NAME 一致） |
| 12 | 测试 vs STATUS_GROUP | 一致（47 状态全部归组，12 组 + 兜底 = 13 条 ≥ 断言下限） |
| 13 | 测试 vs semaphore/playPlan | semaphore 一致；playPlan 见 **F3** |
| 14 | 测试 vs wrap/dispatch | **F2** — 「抛错返回 null」用例的 broken 对象在 mockAction 展开时即触发 getter，抛在 doesNotThrow 之外 |
| 15 | 测试 vs effects/preview | 一致（此处 getter 直接写在字面量上，不经展开，故不重演 F2） |
| 16 | 验收清单 vs 前序交付 | 一致 |

### 裁决

Ruling: F1 — T1 测试改用 readdirSync 递归遍历替代 fs.globSync — Node v20.20.2 无 fs.globSync（实测
  typeof undefined），照写必崩 — 若错，代价是多写 6 行遍历代码。
Ruling: F2 — T14 该用例改为用 Object.defineProperty 构造 broken 对象，或把 mockAction 调用挪进
  doesNotThrow 内 — 实测 {...overrides} 展开会读取并触发 getter，异常逃出断言 — 若错，代价是这条
  用例假绿，掩盖包装体的容错缺陷。
Ruling: F3 — T7 的 resolve() 须在返回的计划上带 region: snapshot.region ?? null；T13 的 playPlan
  把 plan.regionShape 改读 plan.region，且仅在运行时能解析出形状时才调 .mask() — 原文中
  plan.regionShape 从未被任何任务产出，遮罩会静默失效，而 T10 的断言只校验 cue.mask 字段、
  察觉不到 — 若错，代价是射线/锥形特效溢出模板边界，需回头补一次。
Ruling: F4 — 从 COLOR_HUE 删除 __t350/__t10 合成键；T4 的环绕断言改用真实颜色
  （hueDelta("dark_red","red") === 5，355°→0°） — 生产色表不该为测试留后门 — 若错，代价是
  环绕分支少一个直观用例。
Ruling: F5 — T5 的 makeToken 补上 w/h 两字段与 T6 快照形状对齐 — 当前 resolve() 不读这两字段
  所以不影响测试，但形状不一致会让 fixture 失去「忠实样本」的意义 — 若错，代价是 fixture 多两个
  冗余字段。onLeft 恒 false 不改：T10 自建目标显式覆盖了该分支。
Ruling: F6 — T7 测试里 `if (k !== "waitUntilFinished")` 是死条件（该键不在被遍历的列表中），
  记为 deferred minor，不入修复循环 — 无害 — 若错，代价为零。

Task 1: minor (deferred): T7 数值卫生测试含一处无害死条件（F6）

## 执行

Task 1: 评审回报 — 规范 ✅；质量 Issues（1 Important + 3 Minor）
Ruling: Task 1 的 Important（RESULT 常量测试只抽样断言 8 项中的 MISS/HIT + 键数，未校验中间
  6 个值，也未断言 PLAN_VERSION）成立，进入修复循环 — 该测试代码逐字来自计划 Step 1，属
  plan-mandated，但计划的意图正是防住这组常量：RESULT 是 Crucible AttackRoll.RESULT_TYPES 的
  镜像，Task 11 的 8 分支 impact 层全建在这些值上，PARRY(2)/BLOCK(3) 若被互换，键数仍为 8、
  MISS/HIT 边界不变，测试会误报绿灯而动画全错 — 若错，代价是多两行 deepEqual 断言。
Ruling: 同文件同缺陷类的一个 Minor（relationships 只断言 id 存在、未断言 minimum 版本号）
  并入本轮一起修 — 属同一「断言了等于没断言」类别、同一文件、一行改动，另开一轮不划算 —
  若错，代价是本轮 diff 略大。
Task 1: minor (deferred): scripts/log.mjs debugEnabled() 裸 catch 吞掉一切异常（计划原文实现，
  最坏后果仅调试日志静默，不影响功能）
Task 1: minor (deferred): 评审无法接入真实 Foundry 环境验证 configureVFXEffect 路径与
  i18n.format 占位符 — 由 Task 16 第 1/2 项游戏内验收覆盖
Task 1: fix round 1/5 (2 addressed, 0 open — RESULT 全值 deepEqual + PLAN_VERSION 断言；
  依赖版本号按 id 查找断言；复审员独立重做红/绿验证通过；commits bbf2cec..dc09d12)
Task 1: complete (commits e25b914..dc09d12, review clean)

Task 2: 评审回报 — 规范 ✅；质量 3 Important + 2 Minor（三条 Important 均为计划逐字代码，
  属 plan-mandated，由我裁决）
Ruling: Task 2 Important-1（`_template 元数据被保留` 测试只做 JSON 子串包含检查）成立，本轮修 —
  评审员实测证实数据本身正确（293 处均为字符串引用形态，jb2a/eskie/blfx 三个命名空间根部各有
  独立 _templates 表，jb2a._templates.melee === [200,300,300]），但该断言防不住「根表丢失而叶子
  残留孤立 _template 字符串」这一类回归；Task 3 的 templateOf 正是靠字符串→根表解引用，根表一丢
  射线/锥形的 stretchTo 锚点会静默失准，与我 pre-flight 裁决的 F3 同一失效类别 — 若错，代价是
  多几行断言。
Ruling: Task 2 Important-2（`failed` 字段测试对空对象也成立，失败路径从未被走过）成立，本轮修 —
  7 个目标全部成功，这条断言至今零覆盖；改法是让 extract-db.mjs 导出 extract() 并加
  import.meta.url 直跑守卫，测试对一个不存在的模组 id 断言其确实落进 failed — 若错，代价是
  一个开发期工具多一层导出。
Ruling: Task 2 Important-3（全局桩防污染靠「必须整体重赋值」的隐式纪律，无测试守护）park，不修 —
  评审员已实测无泄漏（JB2A_DnD5e 单独提取与在 patreon 之后提取均为 1687 叶子）；且回归网已经存在：
  索引本身已提交进 git，任何污染都会表现为 index diff + 「jb2a ≥ 10038」与「200 个抽样文件存在」
  两条断言变红。所提议的双次提取回归测试要在每次 npm test 上多花数秒，换一个推测性失效模式，
  不划算 — 若错，代价是将来某人用增量赋值加桩时，要靠索引 diff 而非测试名来定位问题。
Task 2: minor (deferred): 测试名「七个素材命名空间齐备」但列了 6 个键（jb2a_patreon 与 JB2A_DnD5e
  共享 jb2a 命名空间）— 纯措辞
Task 2: minor (deferred): generated 字段只到日期，跨天重跑产生 1 行 diff — 换来同日绝对幂等，可接受
Task 2: fix round 1/5 (2 addressed, 1 parked — _template 改为三层结构性断言（根表存在/melee 锚点值/
  引用不悬空），两次破坏实验（删整表、删单键）均变红；extract() 导出 + 直跑守卫，import 实测 5ms
  不触发提取，失败路径由不存在模组 id 覆盖；npm run index 产出 md5 不变 867c2a63；commits
  23bb4ab..1e611f8)
Task 2: complete (commits dc09d12..1e611f8, 1 parked)

Task 3: 评审回报 — 规范 ❌（C1 导致契约不满足）；质量 1 Critical + 2 Important + 3 Minor。
  全部涉事代码均为计划逐字原文，属 plan-mandated，由我裁决。
  正面结论：foundry-global-ok 豁免标记经滥用检验证实是**行级**而非文件级，防线未被削弱；
  降级算法两组 30 条实证通过（真实路径 0 降级、乱码末段仍全部落到真实文件）。
Ruling: Task 3 C1（runtimeBackend.getEntry 与 offlineBackend.getEntry 返回形状不一致）成立，必修 —
  评审员对照本机实际安装的 Sequencer 4.2.3 源码（modules/sequencer/dist/sequencer.js）查实：
  getEntry 在路径未精确命中叶子时退化为前缀匹配并返回**裸数组**，而计划里写的
  `typeof e === "string" ? e : (e.file ?? e.files ?? null)` 对裸数组求得 null。兵库绝大多数选材路径
  正是这种「不带颜色段的容器节点」，意味着离线测试全绿、游戏内静默无动画 —— 这是我在设计文档
  §7.2 承诺「测试与运行时天然一致」的直接反例 — 若错，代价是整个 V1 上机后大面积不出动画。
Ruling: Task 3 I1（getPathsUnder 未命中时真实 API 返回 false 而非 null，`?? []` 不兜底，且会在
  游戏界面弹红色 toast）成立，与 C1 同因同源同文件，并入本轮修 — 若错，代价是 colorsUnder 对
  拼错路径抛 TypeError，外加玩家看到 Sequencer 报错弹窗。
Ruling: Task 3 I2（扫描测试把整行以 `*` 开头者当块注释跳过，导致 `*next() { return game.actors; }`
  绕过）成立，本轮修 — 与 C1 无关的独立盲点，且是我批准改动那条防线时引入的附带损伤，属于必须
  补上的窟窿 — 若错，代价是生成器方法里引用 Foundry 全局不被拦截。
Task 3: minor (deferred): templateOf 的数组形态分支在生产数据中 0 实例（已用合成数据验证可达且正确）
Task 3: minor (deferred): 扫描测试对单行/未对齐块注释误判为违规（失败即安全方向，仅开发摩擦）
Task 3: minor (deferred): bestFit 的 divergedAt/options 只记录首次降级点，多级降级时信息不全
Ruling: Task 3 修复报告的红/绿验证仅有叙述、缺红态实际输出，按流程应退回补证据；我裁决不退回，
  改为在 scoped 复审中强制要求复审员独立复现三个红态 — 由第三方实际重现，比实现者自贴一段
  输出是更强的证据，且省一轮往返 — 若错，代价是复审耗时略增。
Task 3: fix round 1/5 (3 addressed, 0 open — C1 裸数组分支、I1 false 归一化、I2 正经注释剥离；
  复审员独立复现三个红态并贴出 not ok 16/17/24 实际输出，还原后 24/24 全绿；commits 68e7b79..2f2a7ad)
Ruling: 复审新提的 Important（假 Database 在 getPathsUnder 的 false vs [] 语义上不完全忠实：真实 API
  仅在路径彻底不存在时返回 false，叶子存在但无子项时返回 []，而 mock 把两种都折叠成 false）park —
  该 Important 是我在复审指令里写死「任何不忠实都记 Important」逼出来的，复审员自己也确认对当前
  实现零影响（runtimeBackend 的 `Array.isArray(r) ? r : []` 对两种返回一视同仁），且 I1 测试用的
  正是「彻底不存在」这一被正确建模的分支 — 若错，代价是将来若有人需要区分「路径不存在」与
  「叶子无子项」，mock 会误导。
Task 3: 携带事实（供 Task 10/13 使用，复审员读真实 Sequencer 源码所得）:
  (a) 真实 SequencerFile 只有 .file 字段，没有 .files —— 实现里 `?? e.files` 是死分支（无害）
  (b) 真实 template 经 _processEntries 处理后**永不为 null**，未指定时默认 [100,0,0]；
      而 offlineBackend 的 templateOf 在查不到时返回 null。两端在此存在语义差异，
      任何依赖 `template === null` 判断的代码在游戏内永远不会命中。当前兵库无此依赖。
Task 3: minor (deferred): 形状一致性测试只做独立类型检查，不比较两端键集合、也不比较等价输入下的
  返回值是否相同（复审实测：多余字段与错误 file 值均漏检；template 类型回归能抓住）
Task 3: complete (commits 1e611f8..2f2a7ad, 1 parked)

Task 4: 评审回报 — 规范 ✅；质量 1 Important + 3 Minor
Ruling: Task 4 Important（COLOR_HUE 把双色混合名写成带下划线 blue_purple/orange_purple/blue_yellow/
  green_yellow，而真实 JB2A 双色名一律不带下划线）成立，必修 — 评审员在索引里穷举计数坐实：
  bluepurple 221 次 / blue_purple 0 次，greenyellow 221 / green_yellow 3，blueyellow 39 / blue_yellow 0，
  orangepurple 10 / orange_purple 0；而 dark_X 系列确实带下划线（dark_red 175 次、无下划线版 0 次），
  说明我对 dark_ 系列判断正确、唯独把「双色混合」的命名规则搞反了。后果：pickColor 用真实键名
  bluepurple 查表查不到，该颜色被整个排除出候选池，实测 control 符文退化成相距 35° 的 blue。
  现有「交叉一致性」测试抓不住它——bug 不在键存不存在，而在键的拼法与素材命名规则不一致 —
  若错，代价是 control 符文颜色偏差，另三个错拼是未来扩表的潜伏坑。
Ruling: 同轮追加一条**守卫测试**：断言 COLOR_HUE 里每个键都至少在索引里作为真实颜色段出现过一次 —
  只改四个键名是治标，这条不变量才是防住同类错误的东西（正是它缺席才让我的拼写错误一路走到评审） —
  若错，代价是某个合法但素材库未用的颜色名被判失败，需按实际情况调整。
Ruling: frost/storm 双重撞色（RUNE_COLOR 里同为 blue，且二者原生 damageType 分别是 cold/electricity，
  在 DAMAGE_COLOR 里又同为 blue）本轮一并修 — 评审员查 crucible 源码坐实这是施法层与命中层同时撞色，
  两个常用元素符文在 V1 里没有任何颜色差异；改一行数据、同文件、同已触发轮次 — 若错，代价是
  storm 换成一个不如蓝色贴切的颜色。
Task 4: minor (deferred): kinesis/soul 同为 teal、poison/corruption 同为 dark_green — 单层撞色，
  且 Task 9-12 会给它们不同的姿态形状作区分，暂不动
Task 4: minor (deferred): pickColor 在 want 为未知颜色名时静默返回 available[0] 且 hue:0（计划原文
  的防御分支；交叉一致性穷举证明真实数据永不触发）
Task 4: minor (deferred): task-4-report.md 声称「所有 COLOR_HUE 颜色实测可用」属过度概括，
  实际只验了 magic_sword 的 5 个单色词
Task 4: fix round 1/5 (2 addressed, 1 new open — 键名四处已改且 dark_* 未误伤、control 同步更新、
  pickColor 精确命中复现通过；storm/electricity 改 blueyellow 两处一致、hueDelta 非 0；
  但新加的守卫测试判据过窄，复审实测 intro/complete/fast/slow/normal/rock/refraction/multicolored
  八个非颜色词全部能通过守卫；commits e60d61b..cd39b20)
Ruling: 守卫测试判据过窄这条新 Important 进入修复轮 2 — 它是本轮 diff 引入的，且与实现者
  人工计数偏差（173/171/19 vs 正确的 221/221/39）同源：traverse 只认
  `typeof child === "string"` 的单文件折叠叶子，漏掉约 22% 的多变体（对象/数组）颜色节点，
  即把「单文件折叠节点」误当成「颜色节点」的全集。这道防线本是为防住我的拼写错误而加，
  自己却漏得比要防的还多 — 若错，代价是守卫继续放过非颜色词，同类拼写错误仍可能溜过。
Task 4: minor (deferred): blueyellow 在索引里可得性低（1141 个含颜色分支的父节点中仅 39 个有它，
  3.4%；真实闪电类特效 electric_arc/lightning_ball/lightning_strike 完全没有该色，只有 blue/blue02）。
  实际渲染多数时候是「blue 底图 + 20° 色相滤镜」，与 frost 的「blue + 0°」只有滤镜级差异。
  数据层撞色已解，渲染层区分度有限；留待 Task 16 上机肉眼评估后再定是否换色。
Task 4: fix round 2/5 (0 addressed, 1 open — 守卫改成「种子色分组识别 + 30 项黑名单」；复审实测：
  清空黑名单后结构算法独立挡住 8 个原始反例中的 6 个（说明结构信号真实有效），但 frost/square/
  colorless/multicolored01/rainbow01/rainbow02 六个黑名单外真实非颜色词全部通过；黑名单逐字包含
  上一轮复审用过的全部 8 个词，且只拉黑了 rainbow/multicolored 裸词、未拉黑索引里实际存在的
  带编号变体 —— 构成上即「对答案」；commits cd39b20..825934a)
Ruling: 不进入修复轮 3 继续追这条守卫，改为**重新定义它要证明的命题** —— 是我把目标设错了。
  我要求的是「判断一个字符串是不是颜色」，这需要一部颜色词典，而 COLOR_HUE 自己就是那部词典，
  所以是循环论证，实现者被迫退化成黑名单是这个错误目标的必然结果，不是它偷懒。
  真正要锁住的不变量其实更窄且完全可判定：**RUNE_COLOR/DAMAGE_COLOR 里实际被映射到的 21 个值，
  每个都必须能被 pickColor 在某个真实路径上精确命中（hue===0）**。原始 bug（blue_purple 在任何
  colorsUnder 结果里都不出现）会被这条直接抓住，而「某个没被映射的词是不是颜色」这个不可判定的
  问题彻底消失。附带保留一条纯可达性检查（COLOR_HUE 每个键至少在一次 colorsUnder 结果里出现），
  不做任何分类、不要种子集、不要黑名单、不要比例阈值 — 若错，代价是一个未被映射的非颜色词可以
  躺在 COLOR_HUE 里不被发现（无害，因为没有任何代码会去取它）。
Task 4: fix round 3/5 (1 addressed, 0 open — 守卫改为「实际映射值可达性」范式：测试 A 对 15 个去重
  映射值逐一走真实 pickColor 断言 {color:value, hue:0}，测试 B 纯可达性不做分类；SEED_COLORS/
  黑名单/60% 阈值/分组识别全部删除且 grep 无残留。复审独立复现两个红态（control→blue_purple、
  storm→electric_blue，错误信息均能指出是哪个符文），对抗性检验把 pickColor 的 hue 硬改成 1 后
  测试 A 红 11/15，证明确实校验 hue===0；命中清单抽查 5/5 属实；commits 825934a..6c48af3)
Task 4: minor (deferred): 测试里残留 global.TEST_MAPPING_HITS 调试写入，无副作用
Task 4: complete (commits 2f2a7ad..6c48af3, 3 parked)

Task 5: 评审回报 — 规范 ✅；质量 1 Critical + 2 Important + 1 Minor。三条均为计划逐字原文，我裁决。
Ruling: Task 5 C1（GESTURE_TARGET 表 17 项中 3 项与 Crucible 源码不符：create 应为 summon 而非
  single、sense 应为 aura 而非 self、surge 应为 ray 而非 self）成立，必修 — 我在计划里手填这张表
  并在注释里写「取自 spellcraft.mjs 的 GESTURES」，实测 3 项不实。后果是 12 符文 × 3 姿态 = 36 个
  法术 fixture 的 target.type/region/targets 全是错的合成数据（flame.create 被伪造了近战贴身目标、
  frost.sense 与 storm.surge 的 region 白白置空而 TARGET_REGION 里现成有 aura/ray 定义），
  且现有测试一条都发现不了——「矩阵完整」只数 204 个组合、「字段齐全」只查字段在不在。
  Task 10 的射线/光环规则会拿这 36 条假数据匹配，绿灯是假的 — 若错，代价是射线与光环两类姿态的
  几何规则全部建立在错误样本上。
Ruling: Task 5 I1（seen 跨包全局去重假设「同 id ⇒ 同动作」，实测证伪）成立，必修 — 评审员直读
  leveldb 逐字段比对三个撞 id 的动作：graveMark 两处确实全等（无害），但 steamVent 是
  "Burnout"(blast/range15/cost0) 与 "Steam Vent"(pulse/无限射程/cost4) 两个不同动作，
  invisibility 是 "Natural Invisibility"(tags=[]) 与 "Invisibility" 法术(tags 含 spell/iconicSpell/
  maintained) 两个不同动作。去重按包遍历顺序取先到者，两个真实场景整个丢失，其中 maintained
  标签的覆盖为空会影响 Task 12 — 若错，代价是 fixture 少两个独立场景且去重策略继续带病。
  改法：按内容签名去重而非按 id；内容不同的撞 id 条目全部保留（数组允许重复 id，测试里的
  byId 取首个不受影响）。
Ruling: Task 5 I2（effects.json 的 47 个状态里 flanked 不属于 statusEffects）成立，必修 —
  评审员精确提取 statuses.mjs 的 statusEffects 边界得 46 项，与 fixture 除 flanked 外逐一吻合；
  flanked 实为单独导出的 derivedConditions，源码注释明写「derived from circumstance rather than
  applied as a status ... cannot be assigned」，没有 img/hud/generator 字段，永远不会作为
  ActiveEffect 出现 — 若错，代价是 Task 12 为一个永不出现的状态配特效。
Task 5: 携带事项（Task 12 用）: STATUS_GROUP 表里的 flanked 条目应一并移除，分组数由 47 状态
  改为 46 状态；Task 12 的测试断言 effects.length 也要相应改为 46。
Task 5: minor (deferred): 「同时覆盖贴身与隔格」断言在当前生成器结构下不可能单独失败其中一半
  （targets 要么整对生成要么不生成）
Task 5: fix round 1/5 (3 addressed, 0 open — GESTURE_TARGET 三项改正 + 新增 test/source-tables.test.mjs
  真解析 spellcraft.mjs 逐项比对；去重改为内容签名（id + 排序后 tags + target + range + cost），
  steamVent/invisibility 各恢复 2 条、graveMark 仍 1 条、总数 432→434；flanked 移除、状态 47→46
  且解析器止步于 statusEffects 块。复审做了真实源码变异测试：备份 spellcraft.mjs → 改 ray 姿态
  target.type → 守卫变红 → 还原 → md5 字节一致；statuses.mjs 注入假 derivedConditions 项后解析
  结果不受影响；commits 71b4128..86c4bd9)
Task 5: 携带事实（Task 9-12 用）: actions.json 里 steamVent 与 invisibility 各有 2 条内容不同的
  fixture（撞 id），`actions.find(a => a.id === X)` 只会取到第一条（分别是 Burnout 版与
  Natural Invisibility 版）。需要另一条时必须按内容筛选，不能靠 id。两条同 id fixture 的 seed
  相同（hashSeed 只按 id 算），仅影响素材变体选择，无语义影响。
Task 5: complete (commits 6c48af3..86c4bd9, review clean)

Task 6: 评审回报 — 规范 ✅；质量 2 Important + 2 Minor。事件流修正经复审独立回源码核实属实
  （resources 恒为数组、delta 负数=伤害/正数=治疗、实现者弃用 restoration 标注改用 delta 符号
  更稳健、eventsByTarget 的 all/roll 分组描述正确）；大体型贴身坐标 700 对 800 错，简报确有笔误。
Ruling: Task 6 I1（damage 用 `=` 覆盖而 healed 用 `+=` 累加，两者不对称）成立，必修 —
  复审用双持模拟实证：主手 -6、副手 -4，results 正确显示两次命中，damage.total 却只报 4（应为 10）；
  且查 crucible 源码确认双持会对同一目标 recordEvent 两次（const/action.mjs 的 roll(target) 遍历
  usage.strikes.entries()），不是罕见边角。继承自我的计划原文，非本轮回归 — 若错，代价是双持
  角色的伤害数值在动画层被少算，impact 层的强度分级会偏轻。
Ruling: Task 6 I2（硬编码 r.resource !== "health"，忽略 morale）成立，必修 —
  crucible 12 符文中有 4 个（control/illusion/oblivion/soul）默认打 morale 而非 health，
  这类动作的 damage/healed 永远是 null/0。快照本身已导出 usage.resource 字段，却不用它，
  自相矛盾 — 若错，代价是四分之一的符文在 aftermath 槽永远没有资源变化反馈。
Task 6: minor (deferred): hashSeed 测试只做自洽检查，未对标准 FNV-1a 向量断言（跨文件一致性
  靠手工脚本验证，未固化进 npm test）
Task 6: 携带限制（Task 12 用）: snapshotEffect 对绑定多个 status 的 ActiveEffect 只取 Set 首个
  （crucible 有 freezing+slowed、confused+disoriented、suffocating+silenced 等捆绑效果）。
  判定为可接受设计：一个 effect 对应一个动画，避免两层光环叠在同一 token 上。Task 12 需知悉
  第二个 status 不会独立触发特效。
Task 6: fix round 1/5 (2 addressed, 0 open — damage.total 改累加且 type 取伤害量最大者（同量取先，
  damageMax 初值 -Infinity + 严格大于）、资源名改用 usage.resource 支持 morale。复审复现两个红态
  并自写六组 mock 实测：累加/顺序对调/同量/符号/morale/混合资源全过，healed 仍为裸数字；
  commits 50d5270..1dd9d09)
Task 6: complete (commits 86c4bd9..1dd9d09, review clean)

Task 7: 实现者上报 NEEDS_CONTEXT（未提交）— 53/434 个 fixture 零 cue，全部是
  usage.isAttack===true 且 targets.length===0 的自我增益/召唤类动作（5 个具名法术 +
  spell.*.{aspect,conjure,create,ward} 共 48 个）。另自查出 jb2a.cast_generic.abjuration
  在索引里不存在（cast_generic 下只有 01/02/03/dark/earth/fire/ice/sound/water），改用
  jb2a.cast_generic.03 后降级率从 42.6% → 0.00%（那条 15% 断言按设计发挥了作用）。
Ruling: 缺陷在我写的 generic.cast 规则条件里，不在 fixture、也不在 Task 5 的 isAttack 判定 —
  已回源码核实 crucible 的 composed 标签在 initialize() 里**无条件**设 usage.isAttack = true
  （const/action.mjs:563），不看目标类型，所以自我增益法术确实 isAttack=true 且零目标，
  fixture 是忠实的。我原来写「攻击类动作不出 cast 内容，起手交给 travel 段」，这个假设在
  没有目标时崩塌：travel 与 impact 都按目标循环，零目标时根本不执行，整条链断掉。
  改法：跳过条件从「isAttack」改为「isAttack 且有目标」——下游没东西可演时，cast 段必须自己扛。
  另加一条回归测试专门锁住「零目标的攻击类动作必须有 cast cue」 —
  若错，代价是自我增益与召唤类法术在 V1 无动画（占 fixture 的 12%）。

Task 7: 评审回报 — 规范 ✅；质量 Approved（1 Important + 2 Minor）。复审独立复算：覆盖率
  434/434 与 46/46 零 cue 数均为 0，降级率 0.0000%；五个兜底路径 diverged 全 false；
  优先级对抗检验命中 pri=900、抛异常时正确降级到 500；rng 确定性与非共享实测通过
  （先解 A 再解 B 与单解 B 结果相同）；build() 四种返回形态归一化正确；ctx.geom 三项与设计一致；
  CUE_DEFAULTS 对 DESIGN §6.2 的 37 个字段无一缺失，多出的 rule/source/region 均有据。
Ruling: Task 7 Important（firstMatch 把 when() 抛出的异常静默吞成「不匹配」，无任何日志）成立，
  本轮修 — 该代码逐字来自我的计划，非实现者偏离；但 Task 9-12 要往兵库里写 40+ 条规则，
  任何一条高优先级规则的 when() 里出现编程错误（访问 undefined 属性之类），行为上会和
  「这条规则本来就不适用」完全无法区分，静默降级到兜底且不留痕迹。这是给接下来四个任务
  埋的诊断黑洞 — 若错，代价是多几行 warn 调用。
Ruling: Task 7 Minor（数值卫生测试的字段列表漏了 zIndex/playbackRate/startTime/
  waitUntilFinished/extraEndDuration/volume，且含一处死条件）并入本轮修 — 这正是我 pre-flight
  记为 F6 的那条，当时判为无害延后；现在复审指出 Task 9-12 新增规则会引入 playbackRate/volume
  等字段，这张回归网对它们零防护，性质变了 — 若错，代价是多覆盖几个字段。
Task 7: 携带事项（Task 12 用）: aftermath 兜底规则的 color:"green" 从未生效——
  jb2a.healing_generic.burst 的颜色分支是复合命名（bluewhite/greenorange/purplepink/
  tealyellow/yellowwhite），都不在 COLOR_HUE 表内，pickColor 过滤后 available 为空返回
  {color:null}，色彩参数被静默忽略。Task 12 重写 aftermath 时需正视：要么换素材，
  要么把这些复合色名加进 COLOR_HUE（注意会触发 Task 4 的可达性守卫，需同步确认）。
Task 7: fix round 1 首次派发因 API 周限额中断，实现者未做任何改动（工作树干净、HEAD 仍为
  7e2a311、62/62 全绿）。改派新实现者重做本轮，携带 brief + report 路径与两条发现。
Task 7: fix round 1/5 (2 addressed, 0 open — firstMatch 加 slot 参数并在 catch 里 ctx.warn 记录
  「槽位+规则id+原始错误」，resolve() 与 resolveEffect() 均带出 warnings；数值卫生字段从 6 个补到
  13 个，死条件改为 NO_SIGN_CHECK 集合，waitUntilFinished/elevation 只断言有限数、zIndex 要求
  非负整数。复审复现两个红态（not ok 51 / not ok 50），打印 warnings 确认三要素齐全，
  降级行为正常（pri900 抛错后 pri10 接手产出 cue），覆盖率 434/434、46/46、53/53 全绿；
  commits 7e2a311..b115f85)
Task 7: complete (commits 1dd9d09..b115f85, review clean)

Task 8: 改用 Workflow 并行执行（run wf_0648ea04-6dd）— 7 路侦察（cast/travel/impact-结果层/
  impact-元素层/aftermath/persist/音效）+ 1 路汇总。侦察员只产结构化数据、不碰仓库，
  联系表写各自临时目录，仅汇总 agent 写文件并提交，因此无 git 冲突、无需 worktree。
Ruling: Task 8 用 Workflow 而非单 agent — 该任务需对 ~61 个候选逐个抽帧并**实际读图**，
  是计划中唯一不可自动化的一步；六个槽位的候选彼此独立，天然可切分，且每张联系表都要占用
  上下文，串行会让单个 agent 的上下文被图片挤爆 — 若错，代价是并行结果需要额外一轮汇总复核。

Task 8: 汇总完成（commit bdb4dfd，93 行/91 路径/67 测试），随后派 4 视角验证 workflow
  （wf_be9b3c04-ce8）+ 修订（commit ff5a997，69 测试）。验证抓到的东西远超预期：

Ruling: 验证发现的 tool-fix Critical#2 —— **我亲手实测并作为「已验证可用」交给下游的抽帧命令
  本身有缺陷**：ffmpeg 的 color 源默认 rate=25，作为 overlay 的 framesync master 会把素材重采样到
  25fps，30fps 素材被静默丢帧。实测 Club01（66 帧 30fps、step=5）应选出 14 帧，我的命令只得 11 帧，
  且格子里的帧根本不是 n=0,5,10... 那几帧。这意味着 stdout 打印的 frames/step 与图上格子对不上，
  一切「第 N 帧如何」的结论都会整体偏移。修法用 select→scale→setpts=N/TB 打到 1fps 时间轴、
  底色源同样 r=1，实测三个文件 old_bytes==new_bytes（抽帧结果与旧脚本逐帧一致）。
  教训：我验证了「渲染正确」，没验证「帧选取保真」——看图看对了不等于看的是对的那几帧。
Ruling: note-fidelity 抽验 8 行得 4 失真 + 2 部分失真，全部可追溯到 alpha 缺陷。据此裁决对
  62 行视觉备注做全量重验（wf_a5edf036-024，8 组并行）— 抽样虽偏向「最具体最易证伪」的行、
  不是随机样本，但 75% 的缺陷率下，剩余 85 行大概率同病；而这份文档是 Task 9-12 的选材依据，
  错误备注会导出错误的 Sequencer 参数（不必要的 opacity 压制、不存在的尺寸限制），
  这类错误 Task 16 上机也未必看得出来 — 若错，代价是多花一轮重验。
Task 8: 已确认的系统性误读（后续侦察需警惕）:
  (a) 丢 alpha 的近白底渲染里，柔光外扩会看起来像「被方形画幅切平」——两个互不相干的侦察员
      都写了这个假坑，实测最外圈 alpha ≤5/255、bbox 有 5-20px 留边
  (b) 粒子簇被误判成「近乎不透明的实心块、会盖死 token、必须压 opacity」
  (c) 空间分布判断可能整个反过来（称「能量集中在上半部、下三分之一空」，实测峰值在正中央）
  (d) 帧号区间可能是从联系表**贴片序号 × 步长**倒推的而非量出来的（「72-99」恰好等于
      贴片 8-11 × STEP 9）
Task 8: 守卫测试硬化（我已独立复验三个绕过全部被堵）:
  行识别从 startsWith("| `") 改为「定位 | DB 路径 | 表头后读连续行」（漏反引号的行不再被
  全部断言跳过，且文末新增小节的表格不再污染计数）；补 r.path !== p 断言（堵住 bestFit
  静默吞尾段：真实叶子后接垃圾会返回 diverged=false 且 path 变短）；槽位改为逐行取第 2 列
  集合判断（原来是全文档子串匹配，删光 persist 行再补足总数也能通过）。
Task 8: 携带事项（Task 11 用）: 表格新增「自带闪爆」列。相当多素材自带命中白闪，
  impact 槽若再叠通用闪光层会大面积双闪——这一列就是给分层规则查的。
Task 8: 携带事项（Task 9-13 用）: 文档新增 A/B/D 三节记录同族颜色分支的帧数与帧率不一致
  （pickColor 运行时可能选到帧数差一倍的兄弟分支，按记录帧数算的时序会错位）。
Task 8: minor (deferred): sound 槽 22 行未经正确解码复核（音频无画面，本就不受 alpha 缺陷影响，
  但其"帧数"列记的是毫秒时长，值得 Task 13 用前抽验）
Task 8: 第二轮全量重验完成（wf_a5edf036-024 → commit 7beef92）。62 行核验：**仅 14 行属实、
  48 行需订正**（18 失真 + 30 部分失真），77% 缺陷率，与首轮 8 行抽样的 75% 吻合。
  失真类型分布：浓淡/密度判反或夸大 ~19 行（直接源于丢 alpha）、空间分布判反 ~20 行、
  帧号与相位边界偏移 ~20 行（多为拿贴片号×step 倒推）、把衰减默认成单调而实为反弹/多峰 ~12 行、
  同族关系想当然 ~11 行；另有约 10 行据误读开出的有害 startTime/endTime/opacity 药方一并推翻。
  最终：93 行 × 9 列，57 行带【订正】，槽位分布不变，69/69 测试全绿，守卫断言未放宽。
  我已独立抽验 jb2a.cast_generic.01.blue：实测 f7/f8 最外圈 alpha 最大值 0-4/255，
  证实原「被画幅切平、只能小尺寸用」是假坑，订正正确。
Ruling: Task 8 到此收口，不做第三轮 — 首轮标为「属实、可直接引用」的 5 行在第二轮全部又被
  翻出问题，说明「属实」判定本身也带乐观偏差，第三轮必然还能找到东西；但边际价值已明显下降，
  且 DB 路径的正确性由 resolver + 守卫测试机械保证（与备注质量无关），结构化列已在两轮里
  各自订正过。后续兵库任务应把备注当作**带证据的参考**而非定论，最终以 Task 16 上机验收为准 —
  若错，代价是个别素材参数需在上机后回调。
Task 8: 遗留（已记入文档）: sound 槽 22 行未逐行复核（音频无画面、不受 alpha 缺陷影响，
  但"帧数"列记的是毫秒时长）；jb2a.ui.miss.white 是烘死的英文字，换素材属产品决策；
  variant 与分支帧数不一致的时序坑（melee_attack 命中帧 f9-f16 跳、smoke.puff 时长
  1.067-1.900s、impact.007 white 22 帧 vs 其余 12 帧）需在规则层锁 variant 或按分支重算。
Task 8: complete (commits b115f85..7beef92, 3 commits, review clean)

Task 9: 四视角评审（wf_cff0696d-b27）— 1 Critical + 7 Important + 15 Minor。
Ruling: Critical（generic.cast 用 jb2a.cast_generic.03，该素材在 ASSET-NOTES 的 46 条否决清单里）
  成立，必修 — 我已独立复核：8 条路径中 7 条合法（主表精确命中或表内颜色叶子的父路径），
  唯独这条既不在主表又被明确否决。否决理由是「第15帧整幅变纯白过曝球、第20帧碎裂甩出定向白光，
  这是一发命中/爆炸素材而不是起手，放在 cast 槽会让观众以为技能已经打中了」。该规则承担
  434 个 fixture 中的 185 个（42.6%），是 cast 槽流量最大的一条。路径系 Task 7 遗留（早于
  ASSET-NOTES 存在），Task 9 是唯一一次照记录重排 cast 槽的机会而未做 — 若错，代价是最高流量
  的起手动画放的是命中素材。
Ruling: 追加一道结构性守卫（我的裁决，非评审提出）：断言 scripts/armory/** 里传给 ctx.pick/
  ctx.sound 的每条路径，要么精确命中 ASSET-NOTES 主表、要么是表内某条目的父路径，且**不在
  否决清单里** — 现有守卫 test/asset-notes.test.mjs 只查「表→索引」，不查「兵库→表」，
  所以 76/76 全绿也拦不住 Critical。这道守卫同时保护 Task 10-12 三个尚未开始的兵库任务 —
  若错，代价是某些合法的间接引用需要加白名单。
Ruling: 4 条规则（conjure/aspect/healing/skill）无任何行为测试——把四条 when 同时改成 ()=>false
  仍 76/76 全绿，实测它们分别命中 12/12/7/15 个动作。必修，每条补行为测试。
Ruling: ward/conjure 未设 startTime，而 ASSET-NOTES 实测两条素材 f0-f8 均为纯空帧
  （24fps ≈ 375ms 什么都不发生），且 fadeIn:300 整个落在空帧上、实际观感是 375ms 后满不透明硬弹。
  同族 evocation.intro 行已白纸黑字写「要 startTime 裁掉」。24 个 fixture 命中。必修。
Ruling: strike.ranged.draw 把三段时间轴（拉弓/放弦/箭到）烘焙在一条 cast 音轨上且不设 duration，
  「箭到」声固定在 0.8s 响、与 travel/impact 脱钩。本轮只修 duration 截断；ft 档位需按实际格距
  选择这一条移交 Task 10（travel 槽才是投射物时序的归属地） — 若错，代价是远程命中音与实际
  飞行时间不同步，Task 16 上机可听出。
Ruling: Math.random 无守卫（实测往兵库注入 Math.random() 后 76/76 全绿，而注入 Foundry 全局
  会正确变红）。并入本轮：在 test/manifest.test.mjs 的 banned 正则里加 Math\.random。
  一行改动，保护全部后续兵库任务 — 随机性漏进兵库会让同 seed 两次 resolve 结果不同，
  多客户端画面不同步且测试不可复现，是最难人工发现的一类回归。
Task 9: minor (deferred): dark_* 分支可读性补偿（6 个符文会精确命中低亮度描边版，
  色相旋转救不了亮度）— 移交 Task 16 上机肉眼裁定
Task 9: minor (deferred): strike.ranged.draw 的视觉层缺失（简报表格与代码模板自相矛盾，
  实现者已声明偏离并说明理由）— 待 owner 确认视觉层归 travel 还是后补
Task 9: fix round 1/5 (Critical + 4 Important + 3 Minor addressed — 兜底素材换 ASSET-NOTES 认可路径；
  新增 test/armory-assets.test.mjs 结构性守卫（兵库路径必须在主表或为表内条目父路径、且不在
  46 条否决清单里，扫描整个 scripts/armory/）；4 条无测试规则各补行为测试；ward/conjure 设
  startTime:375 裁掉 f0-f8 空帧并重算 duration；ranged.draw 设 duration 截在放弦后；
  manifest banned 正则加 Math\.random；12 符文测试阈值提到 >=10 并单独断言 filter.data.hue；
  两处与【订正】行矛盾的注释帧号改正；commits d5b1955..ae9f070，76→81)
Task 9: fix round 2/5 (1 addressed — LEGACY_UNVERIFIED 白名单钉死：断言 size<=4 且内容恰好为
  那 4 条，另断言每条仍被兵库实际引用——迁移完成后僵尸条目会自动打红、强制删除，白名单自我清算；
  commits ae9f070..af001e6，81→83)
Task 9: fix round 3/5 (1 addressed — generic.cast 与 spell.composed 撞素材「塑能法阵」，
  而前者承担 42.6% 的非法术普通动作，语义错误。改用 jb2a.cast_generic.01（通用能量环扩散、
  自带闪爆为否、无双闪风险）。这条是我自己复验时发现的，四个评审视角都没报——它不违反任何断言，
  属于「不是错误、是不合适」，机器难抓；commits af001e6..d1b871f)
Ruling: Sequencer 的 duration 语义已从源码结清（dist/sequencer.js: `duration = this.data.duration
  === false ? this.endTime - this.startTime : this.data.duration`）——显式设置的 duration 原样
  采用作为播放时长，实现者的假设成立，无需等上机验证。能查源码就别留给上机。
Task 9: minor (deferred): jb2a.cast_generic.01 实际颜色分支为 dark_purple/dark_red/blue/yellow，
  ASSET-NOTES 原文隐含写成 .../green，第 4 色记录有误（不影响功能，兜底走最近色+色相补偿）
Task 9: complete (commits 7beef92..d1b871f, 4 commits, 83 tests)

Task 10: 携带事项 — (a) 必须把 jb2a.magic_missile 迁出 LEGACY_UNVERIFIED，白名单的「僵尸条目」
  断言会在迁移后主动打红强制删除；(b) Task 9 移交的 ft 档位问题：psfx 的 ranged 音效按距离分档
  （.05ft/.30ft/.90ft），必须按实际格距选，90ft 版本峰值在 1.50s，配贴脸攻击会听到迟到的到达声；
  (c) 新增的 armory-assets 守卫与 Math.random 守卫已生效，会自动约束本任务；
  (d) ASSET-NOTES 文末 A/B/D 三节记录了同族分支帧数/帧率不一致，选材时优先选同族内一致的分支。

Task 10: 四视角评审（wf_422aaa93-691）— 3 Critical + 18 Important + 16 Minor。
Ruling: 「每动作一次」用**解析器级 `once: true` 规则标志**实现（方案 b），不用「规则自己判首目标」
  （方案 a）也不挪到 cast 槽（方案 c） — 这是解析器缺的能力，不该让每条区域规则各自打补丁；
  且 Task 11 的 impact 槽会遇到同类问题（暴击震屏应每动作一次而非每目标一次），一处实现处处受益。
  语义定义：rule.once===true 时，build 每动作只调一次、传 s.targets[0] ?? null，默认 at 为
  {ref:"origin"}（区域/自身特效锚在施法者或模板，不锚目标），规则仍可自带 at 覆盖 —
  若错，代价是 resolve.mjs 契约变更需同步 Task 11/12。
Ruling: Critical「测试结构上抓不到重复 cue」必修 — 每个 travel 用例都用 travelCues(...)[0]
  丢弃其余 cue，全套唯一的数量断言是 blast 的 length===0。修 Critical 时必须同时给
  ray/cone/pulse/surge 各补一条 length===1 断言，否则修复不可验证、下次改回去照样全绿。
Ruling: Critical「cone 的 stretchTo 忽略 region.rotation、永远朝正东」与「ray 用目标坐标而非
  模板端点」必修 — 434 个 fixture 的 region.rotation **全是 0**、cone 的 angle **全是 60**，
  两个 bug 被数据盲区完美掩盖。除改实现外还须补带 rotation≠0 与 angle=120 的 fixture/用例，
  否则同样不可验证 — 若错，代价是旋转过的锥形指错方向并被遮罩切成残片。
Ruling: 双闪必修，不接受「转交 Task 11」 — 5 条 travel 规则全选中「自带闪爆＝是」素材，
  而 generic.impact 是 when:()=>true 的无条件闪光层，实测徒手那条两次闪相隔仅 100ms。
  ASSET-NOTES 对其中一条已点名零成本无闪替换（jb2a.unarmed_strike.no_hit.01.*，29 帧 vs 现用
  31 帧几乎等长），因它只在备注、不在主表而未被采用——**正确做法是先补 ASSET-NOTES 一行**
  （按既有流程抽帧看图验证后录入），而不是把「必须二选一」推给下游。
Ruling: strike.melee(620) 的 when 须加 `&& !s.tags?.includes("thrown")` — 而不是调整 pri
  （pri 是简报规定的）。fixture 里 thrown 动作的 strikes 恰好是 []，真实快照会带武器 category，
  届时投掷匕首会被渲染成近战挥击弧线、strike.thrown 永远不可达。这是 fixture 盲区掩盖的实战 bug。
Ruling: ray 写死颜色不跟 runeColor（因 ft 段在颜色段之后、ctx.pick 只能把颜色拼在末尾）——
  接受这个取舍，实现者论证充分。但记为待办：给 ctx.pick 增加 suffix 能力可同时解决 ray 染色与
  ft 档位两个问题，若 Task 11 再次撞到同类约束则一并实现 — 若错，代价是 12 个符文的射线同为蓝色。
Ruling: ray 的 startTime 从 333(f10) 改到 f33 — ASSET-NOTES 该行末句原文就是「当 travel 用
  startTime 裁到 f33」。评审逐帧复测确认 f10-f32 是「束还在施法者手上攒」（maxX 从 551 内收到 230），
  f33 才开始伸出。现状是 travel 段前 767ms 光束没离开施法者，而 cast 槽已经播过一次起手。
Task 10: fix workflow（wf_33706592-321，并行设计 4 组 → 单点应用）— commit e4b7daa，92→122 测试。
  我已独立复算：ray/cone/pulse/surge 每动作 cue 数 2→1，投射物类仍每目标一份（正确），
  覆盖率 434/434、零 cue 0、warnings 0、工作树干净。破坏实验 27/27 被捕获（应用者自查时
  发现 1 个漏网：ray 的 selfFlash.anchor 改 target 仍全绿，已补断言）。
  应用者拒绝了 geometry 组的 isExtraTarget 方案（零目标动作一条 cue 都不出）与若干冗余字段，
  并拒绝修 dump-fixtures 的 ActionTags 传播（实测会改动 80/81 条 fixture 解析结果、掀翻
  Task 11/12 基线）——这几处拒绝是对的。
Task 10: complete (commits d1b871f..e4b7daa, 122 tests)

== 下次开工必读：Task 11 的三个交接项 ==
(1) 张角基准从 1.0 改成实测 0.5（60°→1.1547、120°→3.4641），代价是现役 60° 锥纵向宽 15%。
    应用者称原值是"漏画"。**这条我没来得及独立复核**，且 design:geometry 那个 agent 的安全分类器
    当时不可用（rate-limited），务必先自己抽帧量一遍斜率再决定是否保留。
(2) cue 数组改为槽主序 → rng 消费顺序变了。Task 11 若换多 variant 素材，选中的文件会与现在不同。
(3) fixture 的 ActionTags 盲区仍在（thrown 动作的 strikes 恒为 []，真实快照会带武器 category），
    已在 travel 用 `!s.tags?.includes("thrown")` 绕过，Task 11 会再撞到同类问题。
    另：travel cue 没有 playIf，防御类结果上自带闪爆照播，需 Task 11 的 impact 层处理。
Task 10: 角度追查与修正（commit 1300d65，122→124）。结论反转两次，最终查实角度定义在
  **TARGET_TYPES**（const/action.mjs:90,102）而非 GESTURES：cone=60°、fan=210°。
  所以 (a) fixture 的 cone=60 是对的，那 15% 纵向拉伸是**真实且必要的修正**——JB2A 锥形按
  D&D 5e 惯例绘制（末端宽=长，等效 53.13°），要填满 60° 模板确需 tan(30°)/0.5=1.1547；
  (b) fixture 的 fan=120 是我手误，实际 210，已订正（仅 12 条 spell.*.fan 变化，无扩散）；
  (c) 新增源码守卫：source-tables.test.mjs 现同时解析 const/action.mjs 的 TARGET_TYPES.region.angle
  与 dump-fixtures 的 TARGET_REGION 逐项比对（临时改回 120 实测变红）。
Ruling: 实现者反驳我 brief 里「≥180° 会产生负数/Infinity」的前提——实测 coneYScale 原本就有
  Math.min(Math.max(deg,1),179) 钳制与 CONE_YSCALE_MAX=4 硬上限，那条路径已被挡住；
  它只补了 NaN 输入经 `?? 60` 漏网这条更窄的缺口，并把核实过程写进报告。**这个反驳是对的**，
  没有为不存在的 bug 编造修复。我已独立复验：60°→1.1547、120°→3.4641、179/210/360°→4 且记 warn、
  NaN→回落 1.1547，无负数无 Infinity。
Task 10: complete (commits d1b871f..1300d65, 124 tests)

== Task 11 携带事项（除既有的三条外新增）==
(4) **fan 姿态没有专属 travel 规则**——210° 大范围横扫落到 generic.travel，产出 2 个逐目标
    投射物 cue，语义错误（应是区域特效、once:true、每动作一份）。计划里 Task 10 的 9 条规则
    清单本就没列 fan，是我漏了。ASSET-NOTES 的 travel 组侦察包含过「扇形（fan 姿态）」候选，
    可去主表找。建议在 Task 11 或独立小任务里补这条规则。
(5) `once: true` 机制已可用（resolve.mjs 规则级标志，每动作调一次 build、传 s.targets[0] ?? null、
    默认 at 为 {ref:"origin"}、规则可自带 at 覆盖）。impact 槽的「暴击震屏」应该用它——
    震屏是每动作一次，不是每目标一次。

Task 11: 守卫修复（commit 7b71fa7，131→133）。我独立复验：素材守卫覆盖从 19 条路径升到 38 条
  （impact.mjs 从 1→18），注入否决路径与不存在路径均打红，"jb2a.ui"+".miss.white" 拼接绕法
  已还原成完整字面量。守卫修好后**未查出** Task 11 那 20 条路径的问题（全部精确命中主表）。
  实现者还指出我参考正则的 bug：字符类缺连字符会把 psfx.ranged-weapons... 从中间截断。
Ruling: 守卫必须自查覆盖率 — 这轮加的「提取到的路径数 == 剥离注释后文件里实际的 DB 路径数」
  断言是关键。Task 9 加的守卫本身没问题，问题是它只认 ctx.pick("字面量") 一种写法，
  Task 11 换成表对象传参就失明了。**防线不是加了就有效，得断言它实际覆盖到了什么。**

Task 11: 四视角评审（wf_f511a67a-50b）— 16 Important + 17 Minor，无 Critical。
Ruling: Important「GLANCE 的 ×0.6 只作用于结果层」必修 — 实现把元素层 objectScale 从简报的
  `spec.scale * 0.9 * ctx.geom.sizeScale()` 改成 `el.scale * ctx.geom.sizeScale()`，丢掉 spec.scale。
  实测 12 种伤害类型下 HIT 与 GLANCE 的元素层 objectScale 全部相等；而在 travel 自带闪爆抑制掉
  结果层的场景（24 个目标），两者逐字段只差 playIf 一个字段——掠过在画面上字面等于命中。
Ruling: Important「结果层与元素层互相双闪」必修 — 368/392 个目标两次白闪间隔 40-95ms。
  ASSET-NOTES 已把解法写死：jb2a.impact.012.dark_purple 行原文「如果 S3 还要在元素层之上叠
  自己的通用命中闪光，选 012 才不会双闪；不叠闪光层就用 011」，实现选了 011 且叠了闪光。
  附带：011 黑芯是实心不透明、zIndex 65 压在白闪的 60 上，会在白光正中挖一块黑。
Ruling: Important「fade 默认值吃掉主体」必修 — 12 条 impact cue 全继承 fadeIn200/fadeOut300
  ＝500ms 预算，而 8 条 eskie 元素层全长仅 501ms、ARMOR 266ms、DODGE 333ms。ASSET-NOTES 原文
  警告过「15 帧 0.5s 极短，再配 fade 会把主体吃掉」。cast.mjs 与 travel.mjs 都逐素材调了 fade，
  只有 impact.mjs 一条没写——这不是"默认值没人调"的通病，是本代码库已确立纪律的例外。
Ruling: Important「acid 与 poison 同取 green」必修 — ASSET-NOTES acid 行明确指令「同场景同时出
  酸伤和毒伤必须靠颜色拉开（酸用 green/teal、毒用 yellow/purple）」，实测 f0-f8 同构同色、
  PSNR 仅 21-26dB、f5 几乎逐像素重合。
Ruling: Minor「damageType 回退链用 ?? 判空值而非判可查」必修（升级处理）— 未知的
  target.damage.type 会遮蔽掉有效的 usage.damageType。这不是假想输入：kinesis 符文的
  damageType 是 "physical"，而 "physical" 是伤害**类别**、不在 DAMAGE_TYPES 12 键里，
  会被原样写进 damage.type，导致 kinesis 系法术静默退回血溅且无 warning 留痕。
Ruling: 元评审发现 — 实现者用 188/196 论证偏离，数字准确但不支持结论（target.damage.type 在
  同样那 188 个动作上也是 null，两种写法元素分布逐项相同 {bludgeoning:380, psychic:6, void:6}）。
  偏离本身仍正确（评审另去 crucible 源码核实 spell-action.mjs 的 #prepareDamage）。
  真正后果：**12 条元素路径有 9 条从未被 434 个 fixture 跑到**，只靠 7 条手工用例覆盖。
  须修 fixture 让 damage.type 有值（法术按 rune.damageType 派生），否则「12 种伤害分层」
  这个交付物在真实数据上没有回归网。
Task 11: fix workflow（wf_3f96bd75-350，五组并行设计 → 单点应用）— commit 1b825f7，133→163 测试。
  我独立复验：元素层 10 种不同视觉（12 伤害类型，物理三种有意共用血迹 → 10 正确）、
  GLANCE 元素层 = HIT 的 0.600（原为 1.000 即完全相同）、travel 区域特效每动作仍 1 份、
  覆盖 434/434、warnings 0、工作树干净。
  应用者的关键自查：**只打代码补丁不动测试，仍 133/133 全绿** —— 直接证明原套件对这五个缺陷
  零守护。15 组破坏实验全部按预期变红，其中 2 条是「照抄规格会漏掉、经自我修正后才捕获」。
Ruling: 应用者拒绝了 7 条规格并给出理由，我认可 — 其中最关键的一条：fade-timing 组主张
  「裁剪与 fade 不可兼得」，应用者复算发现裁后预算 79.8ms 而实际只用 60ms，论证不成立。
  另有两处它按现场实测改了规格给的数：MIN_DELTA_E 12→11.5（规格锚点 9.5/11.2/13.7 实测为
  9.7/14.3/12.4，**大小关系甚至反了**）、void duration 500→533（500 会让 fadeOut 压到两个亮帧）。
  设计组给的测量值本身有错，应用者当场复测纠正——这正是「并行设计 → 单点应用」该有的样子。
Task 11: 遗留（已记入报告）: 全部离线推演未上机（尤其 Sequencer 在 duration:null + playbackRate:2
  下的墙钟时长假设）；poison.purple 暗底上比 green 暗一档待上机复核；MIN_DELTA_E 余量仅 0.7-0.9
  且 PALETTE.lab 是测量常量、素材变更会静默过期；4 条投掷类非攻击动作解析出 0 条 impact cue
  （HEAD 既有行为，generic.impact 让位让过头）；reactiveStrike 语料语义变更（获得单体目标与武器、
  顺带失去 cast cue），有源码依据但是本轮唯一「改变某条 fixture 是什么」的改动。
Task 11: complete (commits 1300d65..1b825f7, 4 commits, 163 tests)

Task 12: 四视角评审（wf_695f6b50-c3a）— 2 Critical + 15 Important + 18 Minor。
Ruling: Critical-1（stun 组与 buff 组 ΔE00=6.2，低于本仓库自己的 MIN_DELTA_E=11.5）必修 —
  **我自己的复验漏掉了这条**：我按 file+filter 去重确认「12 组 12 种视觉」，但那不量感知距离。
  两支都是青绿色环（177.1° vs 181.2°），而语义完全相反：stun=丧失行动（stunned/staggered/
  paralyzed/incapacitated/asleep/dead）、buff=受保护（guarded/invulnerable/mending/enraged/
  flying/burrowing）。guarded 来自每回合人人可用的「防御」，staggered/stunned 是最常见控制状态，
  同框时会把「防好了」读成「被震晕了」。评审给出唯一可行修法：buff 换
  jb2a.energy_field.01.green（对其余 10 组最小 ΔE00=20.2）。
  **教训：视觉区分度必须量感知距离（CIEDE2000），不能用 file/filter 去重代替。**
Ruling: Critical-2（实现者自陈「decay/fear 撞色无解」不成立）必修 — 实测 ΔE00 仅 2.7、色相差 0.4°，
  比它自陈的 1° 更糟。两条出路都开着：(a) ASSET-NOTES 第 125 行原话是「必须靠 tint，**或者**
  换分支」，tint 是第一顺位建议且是 CUE_DEFAULTS 的一等字段，改一行即可，实现者只讨论了后半句；
  (b) skull.dark_red 的否决条目**已被同一份文档第 119 行撤销**——「那是旧工具丢 alpha 造成的假象，
  用修好的联系表重抽轮廓一样清楚」，评审已用修好的工具复核确认。换成它后最小 ΔE00=13.1。
  **教训：Task 8 重验订正过的结论没有传导到选材决策——否决清单需要标注「已撤销」状态。**
Ruling: Important（effectUuid 为 null 时仍产出 persist:true 且 tieTo:null，无 warning）必修 —
  这正是我在派发里点名的最严重失败模式。Sequencer 4.2.3 的清理链路两条都依赖 tiedDocuments
  可解析：canvas-effect.js 初始化时 fromUuidSync 注册 delete 钩子、_validateEffect 按存在性剔除。
  tieTo 缺失 ⇒ 两条都不生效，而 persist:true 又让它写进 token flag 持久化 ⇒ 光效永久残留、
  重载后照样回来。而新增的测试 `assert.equal(c.tieTo, e.effectUuid)` 是**同义反复**（null===null
  也通过），永远钉不住这个回归。
Ruling: Important（persist cue 继承 local:true 导致多客户端 flag 叠加）必修或明确移交 Task 13 —
  Sequencer 的 .locally(true) 只影响 socket 推送，仍会 setFlags；N 个客户端在线 ⇒ token flag 里
  存 N 条记录；场景重载时 GM 会绕过 users 过滤把 N 份全播出来 ⇒ 每次 F5 光环叠一层越来越亮，
  而中途进场的玩家一个都看不到。这类问题离线测试完全测不出。
Ruling: Important（burning objectScale 0.55 基于画布归一化，但播放层走 scaleToObject）必修 —
  Sequencer 的 _applyScaleToObject 实测：sprite.width = tokenWidth × scale × baseScale，
  源文件像素尺寸只参与宽高比、不定尺寸。所以 0.55 的真实含义是「铺满 token 宽度的 55%」，
  而其余 11 组是 100%~120%。注释写的意图（放大补足存在感）与实际效果正好相反。
  **同样的画布归一化前提也写在 impact.mjs:53/241，需一并对齐口径。**
Ruling: Minor（STATUS_GROUP.entropy 永远命不中）修 — Crucible 的 entropy generator 返回
  statuses:["frightened"]，_fromStatusEffect 用 mergeObject overwrite 把 ["entropy"] 整个替换掉，
  所以 statusId 恒为 frightened、走 fear 组。视觉后果这次恰为零（decay 与 fear 本就同色），
  但表与现实不符会误导后续改色的人。
Task 12: fix workflow（wf_b2da824b-69c，五组并行设计 → 单点应用）— commit 87841ce，170→202
  （201 pass + 1 skipped）。我独立复验：effectUuid=null 已正确拦截（返回 null）、46 状态唯一零 cue
  是刻意静默的 dead、persist/tieTo 零不合格、travel 区域特效仍每动作 1 份、impact 元素层仍 10 种
  视觉、白名单保持清空、工作树干净。
  12 组 66 对 ΔE00 全部 ≥ 11.5（最小 12.2 poison/buff），修复前三对撞车 3.1/10.2/10.4 均已复现并修掉；
  上层三组叠加遮挡 40.8% → 17.1%；14 项破坏实验全部变红。
Ruling: 应用者**拒绝了我要求的「否决清单已撤销机制」，理由正确且比我的判断更准** —
  它独立实测 skull.dark_red 对 bleed 只有 ΔE00 7.7，**这条素材本来就该继续被否决**；
  否决的「理由」是错的（旧工具丢 alpha 的假象），但否决本身是对的。它改为就地更正否决理由，
  不引入会削弱否决清单的新逃生舱。decay 改走 tint（ASSET-NOTES 的第一顺位建议）。
  **教训：我看到「否决理由已被撤销」就推断「该素材可用」，跳过了独立复核。**
Ruling: 应用者拒绝改 impact.mjs:53/241 与 aftermath.mjs:87 的画布归一化系数（只加注记）— 理由正确：
  牵动 element-distinct / MAX_FADE_RATIO / commit 1b825f7 的掠过缩放定义。附实测证据：
  内容占画幅比与画布像素**无相关性**（eskie 800² 填充 0.741-0.910、jb2a 400² 填充 0.718-0.930），
  当前 0.45/0.9 二分让 eskie 系实际只有 0.334-0.410 格宽而 jb2a 0.646-0.837。
  **这条留作独立议题，不在兵库任务内解决。**
Task 12: 给 Task 13 的强制契约（已埋 grep 守卫，play.mjs 一提交即自动生效）:
  (1) `e.temporary(cue.worldPersist !== true)` —— 必须用 !== true；缺了它 N 个客户端写 N 条世界记录，
      .locally() 拦不住（sequencer.js:11819 无 !data.local 子句）
  (2) `await seq.play({local: true, preload: true})` —— 全槽通用，缺 local:true 会走
      preloadForClients 全场广播并阻塞等应答
  (3) 不得出现 executeForOthers / remote: true
  另三条（计划稿已改好）：用 e.origin(cue.tieTo) 不要 e.name()（_filterEffects 的 name 与 origin 是
  AND，原草案兜底匹配 0 条）；worldPersist:false 与 local:true 同进同退；**.tint() 必须真的接上**
  ——decay/hidden 的正确颜色全靠它，没接则退回紫色而测试全绿（Task 16 第 33 项）。
Task 12: 给 Task 15 的强制跟进: snapshot.statusId 改 ?.；previewEffectPlan 显式降级
  （否则预览 12 条全 plan=null）。
Task 12: complete (commits 1b825f7..87841ce, 2 commits, 202 tests)
== 四个兵库任务全部完成，LEGACY_UNVERIFIED 清空，路径追溯链闭合 ==

Task 13: 四视角评审（wf_c8bcaa29-174）— **5 Critical + 12 Important + 18 Minor**。
  这是全项目最有价值的一次评审：206/206 全绿的情况下，V1 全部远程动画会让整条 Sequence 永久挂死。
  评审方法是**对照本机 Sequencer 4.2.3 源码逐条核 API**，而非跑测试——play.mjs 无法 headless 测试。
Ruling: Critical-1（.stretchTo 与 .scaleToObject 同时调用，Sequencer 在 _expressWarnings
  sequencer.js:24918-24923 直接 throw）必修 — 命中 1863 条 cue 中的 236 条（generic.travel×192 /
  arrow×24 / ray×12 / thrown×8 = V1 全部远程投掷光束动画）。后果不是单条不播而是**整条 Sequence
  永久挂死**：抛点在 new Promise(async resolve => setTimeout(...)) 的 executor 内，resolve() 永不
  被调用、Promise 永不 settle，Sequence.play() 对 shouldWaitUntilFinished 的 section 是
  `await section._execute()`，于是卡在 travel 段，impact/aftermath 一条都播不到，playPlan 永不返回，
  只靠 semaphore 8s 超时放行队列。修法：`else if (!cue.stretchTo) e.scaleToObject(...)`。
Ruling: Critical-2（.startTime 与 .duration 的语义反了）必修 — 源码 _calculateDuration()
  16049-16106 末行 `_animationDuration = clamp(endTimeMs - startTimeMs, 0, _animationDuration)`，
  **duration 是播放窗口的绝对终点（相对素材 0 点），不是「startTime 之后还要播多久」**。
  而兵库注释按后一种语义算数（impact.mjs:68-69 明写「不是绝对终点」、travel.mjs:126「2433-333=2100」）。
  334 条 cue 受影响：electricity(267/233) clamp 到 **0ms**（26 条彻底不可见）、
  fire/cold/acid/poison(234/266) → **32ms** 而非 266（240 条一帧闪过）、cone(3167/3666) → 499ms
  而非 3666。**ASSET-NOTES 逐帧实测的所有「掐两头」切点都被静默削掉。**
  修法：两者同时存在时改用 .timeRange(startTime, startTime + duration)。
Ruling: Important（无条件 .rotateTowards 导致 sprite 整体位移半个身位）必修 —
  _setAnchors() 17027-17028：设了 rotateTowards 又没设 .anchor() 时 pivot 挪到 sprite 左边缘。
  1232 条带 aim 的 cue 里 **1008 条的 aim.towards 与 cue.at 是同一坐标**（全部 impact 槽都是
  「站在目标身上朝目标转」），零长射线 angle=0、转向是 no-op，**唯一净效果就是那个 -w/2 位移**
  ——命中爆闪整体右移半格落在目标身侧。而 .missed(true) 本就不需要 rotateTowards
  （_getOffset 15360 的判据是 missed && !target）。
Ruling: Important（每条 cue 的 try/catch 不撤下半成品 section）必修 — seq.effect() 在**返回前**
  就把 section push 进 this.sections，catch 只打日志就 continue，那条配置到一半的 section 仍会照播。
  例如 e.mask() 抛错 → 光束/锥形**不带遮罩溢出模板**（正是 travel.mjs:130 要靠 mask 兜住的 bug）；
  tieToDocuments 抛错 → persist cue 变成**没有绑定、清不掉的永久光效**。
Ruling: Important（resolveRefIn 移交条升级）必修 — ray/cone 的 stretchTo 与 mask **都仍用 region
  坐标**，只有 atLocation 会被换成施法者 token 中心 ⇒ 起点、终点、遮罩来自两套原点，
  几何自相矛盾且无 warning。修法二选一都只要一行：travel.mjs 的 templateAnchor 改用 ref:"point"，
  或 resolveRefIn 对 "origin" 加「cue 自带有限 x/y 时优先信 x/y」。
Task 13: **教训 —— 对照第三方源码逐条核 API，是离线阶段唯一能发现这类缺陷的方法。**
  两条 Critical 都不是逻辑错误，是对 Sequencer 语义的误解；测试全绿、代码可读、注释自洽，
  但上机会全毁。这条经验适用于所有「集成第三方库」的任务。
Task 13: fix workflow（wf_947d5505-16d，四组并行设计 → 单点应用）— commit 5ca61e7，206→255 测试。
  我独立复验：255/255、cast 槽裸 origin 锚点 0 条、travel 区域特效每动作仍 1 份、
  persist/tieTo 零不合格、工作树干净。
  应用者的三项超出规格的贡献：
  (1) **造了一个记录型假 Sequencer**（tools/fake-sequencer.mjs，把四组各自提的桩统一成一份），
      用它驱动真实 playPlan() 跑 434 动作 × 8 结果 + 46 状态 = 3517 计划 / 12417 cue。
      **把一个原本无法 headless 测试的层变成可测的。** 新增 test/play-contract.test.mjs（32 例）
      与 test/sequencer-contract.test.mjs（13 例，静态锁源码判据）。
  (2) **补了一条四组都推给别人、合起来无人认领的 Critical**：resolve.mjs 的施法者默认锚点是裸
      {ref:"origin"}、不带 tokenId/uuid/x/y。三组规格都在 risks 里把它推给对方，
      不修则 Task 14 落地当天 434 条 cast cue 整槽被 `if (!target) continue` 吞掉。
      配套引入 ref:"point" 让模板/区域冻结坐标结构性免疫。
  (3) **源码验伪了三条规格错误**：sequence-hang 的「不带 waitUntilFinished 也必然挂死」过强
      （_shouldAsync 21235-21249 让非末尾无 wait 的 section 不 await run()）；anchor-aim 的前提
      「towards≠at 的 cue 为 0」在锚点修好那一刻失效（实测 0→224），两条排除必须并列；
      「temporary 必须排在 tieToDocuments 前」——_temporaryEffect 是 sticky-OR（23255），
      tieToDocuments 不碰它，**这是条假契约**。
Ruling: 应用者拒绝删除三条 persist 正则守卫，改为「保留 + 去掉 existsSync 自我 skip + 扩成
  仓库级扫描」— 正确。它同时用 M9 变异证明了正则的局限：保留正确写法、稍后再加一句
  scaleToObject → **新契约测试红、旧正则守卫绿**。正则表达不了「同一条 cue 上两个 API 不得并存」
  这种契约，但两者互补而非互斥。
Task 13: 关键指标 — stretchTo×scaleToObject 冲突 236→**0**（12417 条全扫）；零长拉伸 224→**0**；
  播放层 rotateTowards 调用 1232→**0**；334 条时间窗 cue 的实播时长由镜像 _calculateDuration 的
  复算函数逐条断言等于兵库 duration；12 组变异全部被杀。
Task 13: complete (commits 87841ce..5ca61e7, 2 commits, 255 tests)

== Task 14 携带事项 ==
(1) resolveRefIn 三条优先级已写成可执行契约（play-contract 的 makeResolveRef），
    **ref:"point" 必须最先短路**
(2) dispatch.mjs 草案里的 createSemaphore({timeoutMs: 8000}) 会覆盖新默认 15000
(3) semaphore.run() 可能兑现 TIMED_OUT
(4) plan===null 与 plan.warnings 仍无运行时消费者——trigger 层该补日志

Task 14: 四视角评审（wf_a72268a2-dfe）— 2 Critical + 10 Important + 15 Minor。
Ruling: Critical-1（tokenGeom 按 Token placeable 读字段，Crucible 交的是 TokenDocument）必修 —
  **本项目第四次「凭合理推测写字段路径」**。三处源码佐证：#getTargetFromToken（action.mjs:1541-1545）
  显式 `if (token instanceof Token) token = token.document`；action.mjs:1719 注释「this.token is a
  TokenDocument」；Crucible 自己的 VFX 配置器用 token.getCenterPoint() 与 token.width
  （landing.mjs:20-24、canvas/vfx/helpers.mjs:41-44）。TokenDocument 上根本没有 center getter。
  后果：x/y 恒 0、width 恒 1、elevation 恒 0 ⇒ adjacent **恒为 true**（贴身/隔格判定全退化，
  近战 vs 远程选材直接选错）、onLeft 恒 false（挥击永不镜像）、ref:"point" 的模板锚点画在
  场景左上角 (0,0)、seed 失去按位置分散的作用。而 ref:"origin"/"target" 的 cue 因 resolveRefIn
  走 uuid 反查真 placeable **侥幸对位** ⇒ 画面「一半对一半错」，最难排查。
  test/wrap.test.mjs 的 mockAction 把 token 造成 placeable 形状，277 条测试永远抓不到。
  对照组：effects.mjs 走 actor.getActiveTokens() 返回 placeable，那条路径反而正确——只错在动作路径。
Ruling: Critical-2（persist 计划把共享串行信号量顶死到 15 秒超时）必修 —
  playPlan() 对 persist 计划**永不 resolve**：Sequencer 的 EffectSection.run()（25008-25013）
  对持久特效走 `totalDuration += await canvasEffectData.promise`，该 promise 只在 endEffect()
  里 resolve（15479-15485）；_waitAnyway（21247-21249）让序列**最后一个** section 被无条件 await。
  实测 45 条 persist 计划全部恰好 1 条 cue ⇒ 那唯一一条就是最后一条 section ⇒ await seq.play()
  挂到状态消失为止。信号量严格串行 ⇒ 每次状态上身占满 15000ms 并打一条 warn。
Ruling: Important（状态特效与动作动画入队顺序倒置）必修 — Crucible 在 confirm() 里**先**创建
  ActiveEffect（action.mjs:2670 → actor.mjs:1228-1272 的 modifyBatch）、**后**才翻 confirmed
  （action.mjs:2680），所以 persist 动画总排在造成它的动作动画**前面**。与 Critical-2 叠加后的
  实际观感：「挨打上毒 → 光环出现 → 15 秒后才看见挥剑」。这是两个独立成因、两套修法。
Ruling: Important（`??` 让「撤销后重新确认」一次都不播）必修 — 原生的等价写法是**无条件覆盖**
  （chat-message.mjs:43-45 每次 confirmed===true 都 `this._vfxPlayback = this.#playVFXEffect()`）。
  `??` 防的是「原生已写」这个**永不发生**的分支（经核实两者确实互斥），代价是「本模组已写」
  这个**会发生**的分支被误伤。撤销→重新确认是真实路径（confirm({reverse:true}) 把 confirmed
  写回 false，双重确认守卫此时不再拦截）。
Task 14: 已核实无问题的事（评审确认）: metadata 序列化路径完全成立（isEmpty 守卫不会丢 plan、
  cav 与 Crucible 自用的 7 个 metadata 键无冲突、系统内无任何一处整体清空 metadata、
  fromChatMessage 会原样回灌）；FXPlan 体积实测最大 8560 字节（spell.control.fan，9 cue）、
  均值 4003 字节，20 目标合成用例 74009 字节——非正确性问题，但一场战斗几百条卡会持续膨胀世界库。
Task 14: fix workflow（wf_42eea3e1-504）— commit 20c9b2b，277→324 测试，24 文件 +2029/-137。
  我独立复验：用**纯 TokenDocument 形状**（无 center getter、无 .document）做 48 格环形扫描，
  adjacent 真 16/假 32、onLeft 真 23/假 25 —— 不再恒定（修复前 48/0 与 0/48）。
  修法用 `token.document ?? token` 归一化，同时兼容 placeable 与 document。324/324、工作树干净。
  19 个变异体全部被杀；freezeRandom 对既有选材零影响（1863 条 cue 的 [id,rule,file] 签名与
  e6c5b1b 逐行相同）。
Ruling: 应用者驳回规格 6-6（endEffects 加 sceneId）—— 它复核 _filterEffects（sequencer.js:
  11694-11703）确认根本没有 sceneId 子句，是空操作。**规格的结论是错的**，驳回正确。
  另修正了规格里 4 处行号漂移（finishPromise 15463 而非 15466 等），按实测行号写进注释。
Task 14: 应用者自己踩到两个规格没提的坑（值得记）:
  (1) `test/helpers/*.mjs` 会被 node --test 当测试文件跑 —— helper 改放 tools/token-mocks.mjs
  (2) persist cue 带 attachTo 时裸坐标 ref 会让 play.mjs 整条丢掉，接线用例最初「通过得莫名其妙」
  另：规格给 freezeRandom 没写任何测试，M18/M19 两个变异体最初存活，它补了一条全量语料用例才杀掉。
Task 14: complete (commits 5ca61e7..20c9b2b, 2 commits, 324 tests)

== Task 15 携带事项 ==
(1) playPlan() 对 persist 计划的**返回契约变了**——promise 不代表画面结束
(2) resyncPersist 与另三个钩子仍缺席，简报已重写为「还差什么」；新增播放点必须走 runPersistAnimation
(3) 持久特效重建挂 sequencerEffectManagerReady 而非 canvasReady
(4) 重放菜单用导出的 planOf，且**不得写 _vfxPlayback**
(5) snapshot.statusId 改 ?.；previewEffectPlan 显式降级（否则预览 12 条全 plan=null）
== Task 16 携带事项 ==
task-16-brief.md 此前丢了验收 #23-35 整组（应用者已搬回）并新增 #36-38 专项复验；
另附 effect→confirm gap 探针用于校准 PERSIST_LEAD_MS

## Task 15 —— 预览宏 / 重放菜单 / persist 生命周期 / i18n

实现提交 `c302c25`，控制者修复提交 `baab93a`。测试 324 → 350 全绿。

**实现者自查出的简报缺陷（值得记住的一类）**：简报给的参考实现把 `armory[slot]`
收窄到一条规则，却没强制那条规则自己的 `when()`。后果分两种：
- persist：12 组状态全部 `plan === null`（合成 id `__preview__.*` 永远匹配不上
  `STATUS_GROUP`）—— 正是移交约束 5 预言的症状；
- 动作规则：产出**非空但不含被预览规则 cue** 的计划（别的槽兜底填了进来）。
  这是**假成功**，比什么都不播更糟——预览宏是渲染层唯一人工验收手段，它谎报
  成功等于把整个验收环节废掉。
修法：强制 `when: () => true` + 显式 `plan.cues.some(c => c.rule === rule.id)` 包含性检查。
另修 `previewEffectPlan` 的 `effectUuid`（简报里字面写死 `null`，会被 `keepTied()` 丢掉）。

→ 归档为失败模式 E（假成功）的第二例。第一例是 Task 3 的 `runtimeBackend.getEntry()`
对裸数组返回 null。**共同点：离线测试全绿，上机静默无动画。**

**Ruling（控制者）：ContextMenuEntry 三个键名全部改用 v14 形状** —— 实现者把
`li.dataset.messageId` 标为"未经源码核实的唯一假设"。核实结果：`dataset.messageId`
本身是对的（`chat.mjs:340,380` 原生条目同款，选择器 `.message[data-message-id]`），
但**三个键名全是 v14 弃用项**：`name`→`label`、`condition`→`visible`、
`callback`→`onClick(event, li)`，依据 `context-menu.mjs:371,399,617`，
`since: 14, until: 16`。旧名现在仍能工作，只吐弃用警告。
- 代价若判错：几乎为零（新名是 v14 原生形状，核心自己在用）。
- 不改的代价：控制台每次开菜单两条警告，且 v16 静默失效。
- **这类错误没有任何运行期症状**，是最容易一路混到 v16 才炸的那种，故加源码守卫
  （`test/source-tables.test.mjs` 末条）从核心源码解析弃用表对账。
- 守卫已做**四向变异验证**：三个键各自改回旧名 → 报警；删键 → 报警。
  （账本教训：每条守卫都得先证明它会咬人，本项目已有多条守卫被发现比以为的弱。）

**移交 Task 16 的新增验收项**：
- #39 重放菜单在真实右键菜单里出现、点击能重放（v14 键名改动后的回归确认）
- #40 `resyncPersist` 在重载 / 换场景 / 迟到加入三种情形下的真实行为
- #41 `/canim-preview` 聊天命令往返 + 预览宏视觉


**控制者独立复验发现（Task 15，探针实测非推理）**：跑全量兵库测预览覆盖率，
`28/40` 条规则能产出非空计划。扣掉 `status.silent`（`NO_PERSIST` 规则，返回 null
是正确行为），真实覆盖 **28/39 = 72%，缺 11 条**，其中 **aftermath 整槽 0/5 全黑**。

成因：`previewActionPlan` 的合成快照写死成「近战挥砍 + 暴击」一种形状。
12 个缺口**全部**卡在 `build()` 层的守卫，不是 `when()`——所以实现者强制
`when: () => true` 的修法没错、包含性检查返回 null 也**诚实**，缺的是快照多样性：

- `generic.cast`：`isAttack && targets.length` → null（需非攻击动作）
- `strike.melee.heavy`：需 category ∈ heavy1/heavy2/balanced2（合成给的是 balanced1）
- `generic.travel`：`!isRanged` → null
- `spell.gesture.ray/cone`、`target.blast`：需 `region` + `spell.gesture`/`target.type`
- aftermath ×5：需 `healed>0` / `effects:["dead"]` / `usage.resource:"morale"` / cone region

**为什么这条要紧**：预览宏是渲染层唯一的人工验收手段。而 aftermath 这一槽
（治疗/击杀/士气/地面残留）恰恰是**实战中最难按需触发**的——要验证击杀特效
就得真的打死一个东西。0/5 意味着这五个效果在 Task 16 之前谁都没见过。

每个缺口所需的快照形状都能从规则自己的守卫条件直接读出，不存在猜测成分。
→ 与四镜头评审的发现**并成一轮修**（避免两轮 fix round）。

### Task 15 四镜头对抗评审（wf_107b240e-b6c，35 个 agent，2.16M token）

提出 31 → **存活 15，驳回 16**。驳回质量很高：多条是发现者「把自己做的变异测试
改动当成交付代码报告」，以及失败场景在真实调用路径下不可达。

**收敛信号极强的两处**（四个镜头彼此看不见对方，却各自撞上）：

**A【Critical，三票】所有钩子挂在 `ready` 里 —— 结构性问题，不是两个独立 bug。**
`main.mjs:33` 起：`selfCheck()` → 6 次 `await import(...)` → 才 `installXxx()`。
而 Foundry 有两个关键钩子在 `ready` 之前就播完了：
- `getChatMessageContextOptions` 只在 ChatLog 首渲染派发**一次**，返回数组当场冻进
  ContextMenu（`chat.mjs:397-403` 在 `_onFirstRender`；`application.mjs:2231-2235`
  `_doEvent` 后立刻 `new ContextMenu.implementation`；`context-menu.mjs:99`
  `this.menuItems = menuItems`，此后只重算 `visible`，**从不重新征集条目**）。
  时序：`game.mjs:764 initializeUI()`（未 await）→ `sidebar.mjs:145 #renderTabs()`
  渲染含 chat 的全部标签页；`Hooks.callAll("ready")` 在 `game.mjs:779`，中间还隔着
  `await documentIndex.index()` 与 `await canvas.initializing`。
  对照组：Crucible 自己在**模块顶层**注册同一钩子（`crucible-compiled.mjs:48790`）。
  **指纹**：停靠聊天栏右键没有该项，弹成独立窗口后反而有（`renderPopout` 造新实例
  会重走 `_onFirstRender`）。
- `sequencerEffectManagerReady` 同因 → 重载后所有持续光环消失。

  → 控制者已亲自打开全部引用行核对，属实。

**B【Important，四票全中】`resyncPersist` 绕过 `animationsEnabled()`** —— 关掉动画后
切场景/F5 仍补满全场光环，且只能靠移除状态才消得掉。新增 8 条测试无一覆盖。

**C【Important，控制者源码复核并给出更优修法】`/canim-preview` 永远不触发。**
镜头报的是「v14 传给 `chatMessage` 钩子的是 HTML 不是裸文本」——属实
（`chat.mjs:809-812` 核心自己在剥：`const html = message.replace(/^<p>|<\/p>$/gi, "")`）。
但控制者顺手查到 v14 有**公开的命令注册表** `ChatLog.CHAT_COMMANDS`（`chat.mjs:77`，
`{rgx, fn, isMultiline, isRoll}`，`fn` 返回 `false` 阻止发消息，见 `:89-92` macroCommand）。
**Ruling：改用注册表，不要自己剥 HTML。** 若错，代价是回退成钩子+剥 HTML，一行之差。

**Ruling：i18n 那条驳回不采纳。** 驳回者自己承认「代码属实」——`preview.mjs`
29/33/45/229 走 `game.i18n.localize`，41/55/82 硬编码中文。同文件内两种写法并存，
而 i18n 补齐是本任务明文交付项。已作为 G 组追发给实现者。若错，代价 3 行。

**Ruling：`runPreview` 零覆盖那条驳回采纳。** 按本次评审明文规则（「不报覆盖率诉求，
除非能描述出具体失败输入」）判 Invalid 是对的。但记在此处：预览宏主入口无守卫，
`runPreview` 掏空成空函数 350/350 仍全绿 —— 移交 Task 16 人工验收兜底。

→ 全部并入**修复轮 1/5**（brief: `task-15-fix1-brief.md`，159 行，A~G 七组）。

### Task 15 修复轮 1 —— 提交 `7084947`，350 → 387 测试

实现者报 DONE_WITH_CONCERNS，20 个变异体全 RED。控制者独立复验：

- **F 组覆盖率**：自跑探针确认 **36/36 可预览、4 条 ALWAYS_SILENT 豁免**（aftermath 0/5 → 4/5）
- **A 组守卫**：三处钩子挪回 `ready` → 红 4 条
- **B 组守卫**：删 `playPersist` 的 `animationsEnabled()` 闸 → 红 3 条

**我的简报 F 表有三行是错的，实现者纠正了我。**
`cast/strike.melee.heavy`、`travel/target.blast`、`aftermath/generic.aftermath` 的
`build` 是无条件 `() => null` —— 它们是**故意的「占位静默」规则**：`when` 命中即占住
槽位、阻断低优先级规则，任何 fixture 都救不了。我当时只看 `when()` 就推断了 `build()`
的行为。**这是一号失败模式（猜字段/猜行为）用在了我自己写的简报上**，记下来。
实现者归入 `ALWAYS_SILENT` 并加了反向守卫（拿每份 fixture 轮流喂，证明豁免不是免检）。

**Ruling：接受动态 import → 静态 import。** 失败模式从「半装配（动画计划照写进每张
聊天卡，却永远没人播）」变成「模组整体加载失败」。后者立刻可见，前者要查很久。
自用模组更怕静默失败。若错，代价是脚本 404 时整个模组不工作而非部分工作。

**Ruling：接受 `endPersist` 不受动画开关约束。** 关掉开关不该顺带关掉已有光环的
清理入口，否则光环会变成只能靠移除状态才消得掉的孤儿。闸门统一收敛到 `playPersist`。

### 【新发现｜控制者已完整核实】`aftermath.kill` 在实战中永不命中

实现者顺带查出、控制者逐条复核确认：

- 判据是 `s.targets.some(t => t.effects?.includes("dead"))`
- `snapshot.mjs:221` 的 `target.effects` 来自 `ev.effects`（动作自带的效果载荷）
- 而 `dead` 不走这条路：`actor.mjs:2926` 的 `applyResourceStatuses` 在资源结算后
  单独 `toggleStatusEffect("dead", {active: this.system.isDead})`

**时序更致命**：`configureVFXEffect()` 是在 `_prepareMessage()` 里调的（`action.mjs:3286`），
而那是**渲染聊天卡**的时候，远早于 `confirm()` 的 `#applyEvents()`。所以建计划那一刻
`dead` 根本没打上，改读目标的 `system.isDead` 同样无效。

**预测法不可行**：`isDead` = `wounds.value === wounds.max`（PC）/ `health.value === 0`
（敌人），敌人还有 `toughness.value` 为 0 时永不死的覆写（`actor-adversary.mjs:76`）。
在建卡时刻预测等于重新实现 Crucible 的伤害管线——正是本项目栽了 6 次的那类猜测。

**影响**：`persist.mjs:101-112` 显示 `dead` 是**故意**放进 `NO_PERSIST` 的（Foundry 自带
dead overlay），设计上就指望 `aftermath.kill` 接住击杀那一下。所以这条链断了 =
**击杀时刻完全没有专属动画**（命中伤害动画仍在，缺的是击杀爆发）。

**Ruling：改成事件驱动，另开一轮（Task 15b），在 Task 16 上机之前做。**
`dead` 本身就是通过 `toggleStatusEffect` 落地的真实状态效果，会触发 `createActiveEffect`
——本模组的 effects 层已经挂着这个钩子。由它驱动一次性击杀爆发，不需要任何预测，
「什么算死」交给 Crucible 自己判。
必须满足：① 只在真实状态转变时放（`createActiveEffect`），**不得**被 `resyncPersist`
或 `createToken` 触发——否则每次切场景、每具尸体都会重放一遍爆发；② 受
`animationsEnabled()` 约束；③ `dead` 留在 `NO_PERSIST`（不产持久光环），走独立的一次性通道。
若错，代价是击杀爆发在错误时机重放，上机一眼可见。

### Task 15 修复轮 1 的范围化复审

判定：**A/B/C/D/F/G 全部 ✅，E 组 ⚠️ 只关了一半**。387/387，工作树干净
（复审员自己做了 12 个变异并全部还原）。

复审员额外核实了三件报告没提、但决定成败的前提，值得记下：
- **A 组补跑不会双播**：`pendingResync` 只在 `getDeps()` 返回 null 那一支置真
  （`effects.mjs:94-97`），`flushPersistResync()` 先清标志再补跑（`:109-115`），
  而 `state.deps=deps; state.active=true; flushPersistResync();` 三行之间**无 await**
  （`main.mjs:106-108`），钩子插不进来。且 `canvas.#ready = true` 在 `board.mjs:1475`
  的 `#initialize()` 内，早于 `canvasReady`（:1243）更早于 `ready`（`game.mjs:779`）
  —— 所以补跑路径上 `resyncPersist` 的 `if (!canvas?.ready) return;` 不会把它吞掉。
- **C 组往核心静态表写键无副作用**：`MESSAGE_PATTERNS`（`chat.mjs:1575-1576`）是**类
  定义时**对 `CHAT_COMMANDS` 的一次性快照，后加的键进不去那个弃用代理；
  `text-editor.mjs:745` 的行内骰增强走 `if (!cfg?.isRoll) return null`，与注册前行为一致；
  静态类字段只活在当前页面，无世界间残留。
- **静态 import 无顶层全局触碰**：把 `game/canvas/ui/Sequencer/CONFIG/foundry/ChatLog/
  PIXI/Actor/Token` 全换成「一读就抛」的 getter，`import("scripts/main.mjs")` 通过。
  `init` 期唯一触碰的是 `foundry` 命名空间（`preview.mjs:383`），而它在 bundle 加载时
  就成形，早于 `Hooks.callAll("init")`（`game.mjs:652`）。

**E1 仍开着（Minor，带复现）**：`inFlight` 的销账挂在 `runPersistAnimation` 的 promise
上（`effects.mjs:345`），但 persist 计划**故意不 await `seq.play()`**（Task 14 Critical），
于是销账落在 `Sequence.play()` 内部 `Preloader.preload`（`sequencer.js:27756-27759`）
**之前**。冷缓存拉 jb2a webm 是秒级，这段是「`inFlight` 已销账、`isPlayingPersist` 仍为
假」的空窗，第二个入口进来就叠两圈光环。复审员用「play() 后 600ms 才登记」的桩复现出
`sequences.length === 2`。现有用例三次调用全落在 500ms 让路期内，结构上行使不到那段。

→ 与 Task 15b 并成**修复轮 2**（brief: `task-15-fix2-brief.md`，129 行）。
   顺带把 `aftermath.mjs:90-93` 那条 Task 12 记录未改的尺寸问题（objectScale 1/3 的
   推导前提已被推翻，实际只画到约 0.28 格宽）一并处理；离线定不下来就明确移交 Task 16。

### Task 15 修复轮 2 + Task 15b —— 提交 `aaf6069`，387 → 401 测试

E1（`inFlight` 销账挂到特效可被观察为止，`PERSIST_VISIBLE_TIMEOUT_MS = 15000`）+
Task 15b（击杀爆发改走 `dead` 驱动的独立 `death` 槽）。实现者做了 3+5 个变异体验证。

**Ruling：顾虑 6（边界判断）成立，且不只是判断——有文档依据。**
实现者问「原生 `configureVFXEffect` 返回非 null 的动作上也放击杀爆发，违不违反只补空缺」。
决定性证据两条：
- `docs/DESIGN.md:28` 缺口矩阵：`| 状态效果持续特效 | 0 | 全部 |`——Crucible 原生实现
  **0** 条，本模组覆盖**全部**
- `docs/DESIGN.md:131-132`：aefx 那 165 条「提示了一个**独立于「动作」的触发链**」

即「只补空缺」的作用域是**动作层**（`configureVFXEffect` 返回 null 那个谓词），
状态效果是另一条链。佐证：`effects.mjs` 对动作层**零耦合**（不 import wrap.mjs、
不查 vfxConfig），V1 的持久光环本来就是「不管触发它的动作有没有原生动画，照放」。
击杀爆发与之同类。若错，代价是原生有动画的击杀上多一层血泊，上机一眼可见可回退。

**其余裁定**：15000ms 接受（失败方式不对称，取大只推迟重试）；`resetPersistInFlight()`
测试专用导出接受（它借此查出既有用例里同时有假绿 1 条与假红 7 条）；`unref()` 接受；
复用 `runPersistAnimation` 不改名但补注释；`death` 进 `SLOTS` 接受（换来预览宏与 F 组
守卫自动覆盖）；objectScale 1/3 → **1.38** 接受（原值基于 Task 12 已推翻的前提；
新值由逐帧实测内容占画幅 0.837 + 对齐 groundResidue 的 1.153 格跨度推出，
审美目标离线定不下来，移交 C19）。

**新发现（实现者报为范围外，控制者核实属实并要求修）**：`endPersist`（`effects.mjs:515-520`）
只在当下扫一次 `endEffects({origin})`。特效还卡在 `Preloader.preload` 没登记时扫不到，
等它登记完就再没人来收 → **一枚只能靠重载才消的光环**。
这是 **E1 的镜像**：同一个 preload 空窗，一个漏在播、一个漏在收。E1 的「等到特效可被
观察」机械正好复用。已 resume 同一实现者接着修。

## Task 17（新增）—— V1 音效层

**用户裁定**：psfx 音效层**补进 V1**，上机前做完（新库如 ggg / soundfxlibrary /
animated-spell-effects-cartoon 留 V2）。理由：psfx 三件套本来就装着，且在最初需求里
点名过（「音效有 psfx sound library 等等」），属 V1 漏做而非 V2 新增。

**决定性发现：Crucible 有一套完整的原生音效分类法，必须照抄不要另发明。**
源码 `crucible/module/canvas/vfx/sounds.mjs:63`：
```
RUNE_SOUNDS[符文] = { charge(起手一次性) / passive(常驻循环) / damage(伤害循环)
                    / impact(命中) / impactHeavy(仅 flame) / miss(抵抗或失手) }
```
`getVFXSound()` 的注释还写着「Variant selection happens here so the choice is made once
on the originating client and baked into the serialized component config」——
**与本模组 FXPlan 冻结随机的原则一模一样**，说明设计同源。

音效缺口与画面缺口**完全同构**：
- 原生只覆盖 **4 个符文**（frost/flame/life/death），共 **53 个 ogg**
- **8 个符文（control/earth/illumination/illusion/kinesis/oblivion/soul/storm）零音效**
- 伪符文 `generic` 名义上该有 `whoosh`（投射物破空，见 `sounds.mjs:59` 文档字符串），
  **实际只定义了 `charge`** → `getVFXSound("generic","whoosh")` 返回 null，也是缺口

**可占的便宜**：那 11 个原生未实现的姿态，配 frost/flame/life/death 时我们接管后
**可以直接引用 Crucible 自己的 53 个 ogg**（`systems/crucible/assets/sfx/...`），
音色与原生完全一致，只有另外 8 个符文才需要 psfx。

**素材面**：`psfx-patreon` 有 **1199 个 ogg / 20 个分类**，而 ASSET-NOTES 只侦察了 29 条。
守卫 `test/armory-assets.test.mjs` 要求所有素材路径（含 psfx）必须在 ASSET-NOTES 主表内
→ 侦察产出就是新表行。

→ 已派发 psfx 侦察工作流（wf_7f878ce9-3bf，7 组并行 + 1 组汇总）。
   方法照搬对 webm 的要求：不靠文件名猜，**渲染频谱图并实际看图** + ffprobe 测
   起振/峰值/静音尾。实现留到侦察与修复轮都落地之后。

### Task 16 前三步（用户裁定：现在就做）
- Step 2 部署符号链接：**已完成** `/root/fvtt14-data/Data/modules/crucible-anim -> /root/crucible-anim`
  （与同机 gesturecast / leak-doctor 约定一致）
- Step 3 `README.md`：**已完成**。数字均经核对（6/17 姿态、4/12 符文、46 状态、
  原生 sfx 53 个 ogg）。音效层落地后需回头更新依赖与预览小节。
- Step 1 全量测试与体检 + 最终全分支评审：待所有在途工作落地后做

### 顺带查出（进 V2 侦察报告）
`soundfxlibrary` 本地存在（167 个音频）但**不注册 Sequencer 数据库**，要用得走裸文件路径。
另有 `dynamic-soundscapes`、`moulinette-soundboards`、`pf2e-creature-sounds` 三个音频模组。

### 顾虑 7（E1 镜像）已修 —— 提交 `6562554`，401 → 404 测试

实现者**没有另起一套等待机械**，而是收敛进 E1 已有的链：`awaitPersistVisible` 返回 true
的那一刻回头复检 `fromUuidSync(uuid)?.active`，不在了就调**同一个** `endPersist`。
`endPersist` 一行未动，`play.mjs` 全程未碰。判据与播出前的存活复检逐字相同，
所以「被删掉」与「被停用」两条路径一起覆盖——后者连 Sequencer 的 tiedDocuments 兜底
都指望不上（那条只认 delete，`sequencer.js:16932-16943`）。

控制者独立变异复验（双向）：
- **M4 不补收** → 红 2 条（正向用例）
- **M5 无条件补收** → 红 3 条，其中 #202 是**对照组**「登记时状态仍在，不得顺手把刚播出
  的光环收掉」。这条是本轮真正的守卫：只有它能抓住「补收过头」这个反方向。

实现者另做了一处必要的测试桩升级：`stubFoundry` 的 `endEffects` 从空实现改成真的把匹配项
从 `playing` 里摘掉。不改的话「光环到底收掉没有」没有观测点，只能退回断言
「endEffects 被调用过」——而那条在 bug 状态下同样成立（**又一例「守卫比以为的弱」**）。

Task 15: complete

### Task 16 Step 2/3 完成，工作树清理
- `README.md` 已提交（`0c8be65`）
- `durs.txt`（259 行裸浮点、素材侦察遗留、全仓无引用）已删除
- HEAD `0c8be65`，404/404，工作树干净

### V1 剩余
1. **Task 17 音效层** —— 等 psfx 侦察（wf_7f878ce9-3bf）落地后实现
2. **Task 16 Step 1** 全量体检 + **最终全分支评审**（SDD 流程，前 15 个任务只做过单任务
   范围评审，还没做过一次跨任务的）—— 等音效层落地后做
3. **Task 16 Step 4** 上机验收 58 项（38 原始 + C1–C20 携带）—— 只能由 owner 执行
