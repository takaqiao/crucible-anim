# V2 进度与架构评审结论

> 每一轮更新，供跨会话接手。最后更新：**2026-08-30，发布 v1.0.0**。
> 上游文档：`V2-PLAN.md`（计划）、`LOCAL-STATUS.md`（本机环境）、`ASSET-NOTES.md`（选材依据）。

---

# v1.0.0（2026-08-30）

**跨会话接手先读这一节。**

## 起因：owner 实机测 0.9 报的三条

| | 原话 | 根因 | 结果 |
| --- | --- | --- | --- |
| a | 近战 angle 不对，A 打 B 动画出现在 B 的其他方向 | `at` ≡ `aim` 退化 → `play.mjs` 的 `rotates` 恒 false，**rotateTowards 一次都不调**；偏移恒沿屏幕 +x；方向只有 `isOnLeft` 一个布尔 | 8 罗盘方向 **8 种朝向**；2448 样本复算握把↔施法者、刀锋↔目标偏差 **0.000 格**，格宽 20/100/150/400 四档同结果 |
| a' | 起点终点过短 | stretchTo 素材两端留白从未补偿（jb2a `ranged` 首尾各 12.5%·d） | 内容段占比 `[0.125,0.875]` → **`[0,1]`** |
| b | 不够炫酷 / 对不上 / 不够全 | 素材利用率 0.84%，四个命名空间零使用 | 兜底 cue 307 → **100**；画面素材 107 → **173**；travel 最大桶 84 → **19** |
| c | 声效不够明显 / 不够对 / 不够好 | ①播出窗早收一个 `onsetMs`，**33 条挥击风声的峰值根本没播** ②响度跨度 21.3 dB 且 volume 手挑 ③8 档结果坍缩成 2 种 | 峰值丢失 **33 → 0**；跨度 **21.3 → 12.9 dB**；8 档 **8 种音源**；有声动作 306 → **429/434**；状态层 **0 → 45/46** |

## 过程中挖出、owner 没报但更致命的四条

1. **`fanOfArrows` / `flamingArrow` 在真游戏里一次都不会播** —— 原生 strike VFX 只给
   `projectile1/2` 造画面（`canvas/vfx/strikes.mjs:44`），`wrap.mjs:48` 见到非 null 就让位；
   而离线语料**不模拟原生链**，测试全绿。10 条带 `strike` 标签又用弓弩的动作同理。
2. **`.template()` 静默丢弃 `startPoint === 0`** → `_setAnchors:17024` 无 `?? 0` 兜底 →
   `anchor.set(NaN)` → **172 条 cue 整条不可见**。不知道这条就会把「短一截」修成「完全不见」。
3. **运行时 `.30ft` 形同虚设** —— Sequencer 的 `FEET_REGEX` 带前导点，匹配出 `".30ft"`
   而 json 键是 `"30ft"`，于是恒返回整族、随机取一支，**命中目标档只有 1/5**。
   离线沿树走到叶子恒单文件，**这条离线永远测不出来**。
4. **`module.json` 缺 `ggg`** —— 36% 的音效 cue 依赖它，缺包时 cue **静默消失**，而 618 条测试全绿。

## 守卫本身的账（这一轮最值钱的部分）

每一处都是同一个形状：**测的不是想测的那件事**。

- `geom-guard` 13 条里 **8 条是空真断言** —— 把被守功能整个删光，它反而从 9 红变 3 红
- `sound-layer` 的 `heard()` 不看播出窗 —— 33 条静音 cue 被判成「对齐良好」
- `clip-table` 的检查条件带 `&& profiles[f]` —— **把唯一的硬阻塞排除在检查之外**（尚未修，见下）
- 新写的依赖守卫第一次变异也没红 —— `index.modules` 以模块 id 为键，
  而 `ggg` 注册了两个命名空间，表里只留得下一个

测试 404 → **619 条**；真正的变化是判据从「等于某个数」换成「等于独立算出来的性质」。

## owner 定的一条原则（已写进选材纪律）

> 「闪爆作为一种数据没问题，但是**数据本身导致不使用某个动画这件事情本身不太合理**，
> 因为合适/更好更重要。**它再闪又如何。**」

据此翻出**三次同型翻车**（`explosion.02.green` / 召唤法阵 6 个 `dark_*` /
`palette.mjs` 的「同距非 dark 恒赢」），三次都是**拿量 A 回答问题 B + 跳过看图**。
第三次是全库性的——它把 12 色的族压回 6 色，正好抵消前一次翻案的收益。

**验收一条否决的判据**：把数字从理由里拿掉之后，还剩下一句关于「这东西**是什么**」的判断吗？
剩得下才是合法否决。三类数字的角色见 `ASSET-NOTES` 顶部：
排期输入 / 文档粒度条件 / 排序提示——**没有一类是否决线**，
唯一的硬阻塞是「压根没有量测」（`clipOf` 返回 null → 退回硬编码常数 → 静默错拍）。

## P0 十五条：14.5 条清，剩半条

⚠ **唯一未清的是 0.15 的画面侧**：92 件武器的 impact **结果层**仍是 1 个文件
（`jb2a.impact.005.white`）。音效侧已清（8 档 8 种音源，逐档验过）。

**为什么留着**：`RESULT_LAYER` 每一档的 `duration`/`fadeIn`/`fadeOut`/`flash` 窗口都是
**逐帧量出来的**（HIT 那条注释精确到「f16.5 只剩 2%」）。按打击分量分档要给 2-3 支新素材
做同等级的逐帧量测 + 读图签字，那是选材流程不是改代码。**半量测的素材塞进去会把命中时刻
搞错，而错拍比复用更糟。**

## 已知欠账（v1.0.0 之后）

1. **`test/clip-table.test.mjs` 的 `&& profiles[f]`** —— 没量测的文件被跳过检查，
   而那正是唯一的硬阻塞。今天缺口 0，但全库有 43 个文件没量测，一次升级就够触发。
2. **否决复审判定该翻的 11 条**（shield `.02/.03/.04`、`impact.fire.01.orange`、
   `eskie.aura.fire.01.orange`、4 个 markers/energy_field 等），见 scratchpad 的 `veto-audit.md`。
3. **§一「怎么变炫酷」九条一条没做** —— `DENSITY` 是个死设置（所有加特效改动的统一闸门，
   必须先做）、叠层最多 2 层（≥3 层 0 组）、滤镜只用了 `ColorMatrix.hue`、
   `copySprite` blfx 用了 5 种玩法我们只用 1 种、`shake` 只在暴击出现。
4. **`spell.gesture.strike` 按真实武器形制画** —— 需要 `snapshotAction` 为 `cost.weapon`
   的手势捕获主手武器（快照层改动）。现在用的是通用附魔剑 + 符文色。
5. **`strike.ranged.draw` 11 条 cue 未归一化**（写死 `volume: 0.8`），已被 `sound-gain` 棘轮挂着。
6. **`necrotic-00` 32 条**是现在最大的音效桶 —— 12 个伤害类型里 7 个是单文件池。

---

---

# 当前状态（2026-08-29 收盘，批次 0/1 + A + B 已落地，**未提交**）

> **跨会话接手从这里读起。** 下面那一节「当前状态（2026-08-23 收盘，v0.9.0）」是**上一轮**
> 的收盘快照，四大块的补全度数字仍然有效，但它对**几何**的描述已经全面过时——
> 这一轮改的正是几何。

## 下一个人的阅读顺序

1. **本节**（这一轮做了什么、推翻了什么）。
2. `docs/ASSET-NOTES.md` 末尾两节：**「射程口径：贴图内部像素 ≠ 画布距离」**与
   **「`stretchTo` 素材两端的透明留白（已补偿）」**。这两节是本轮所有几何改动的账本，
   带完整的原结论 + 推翻依据。
3. 代码里三处「说理写在注释上」的地方，按这个顺序读：
   `scripts/armory/travel.mjs` 的 `swingScale()` 与 `meleeGeom()`（近战几何的全部代数）→
   `scripts/player/play.mjs` 的 `.template()` 补偿块（留白补偿 + NaN 锚点陷阱）→
   `scripts/armory/impact.mjs` 的 `RESULT_GEOM` / `attackAxis()` / `impactOffset()`
   （八种攻击结果各转不转、位移怎么算）。
4. `test/geom-guard.test.mjs` 的文件头（∀ 守卫为什么必须配样本量下限）与
   `test/todo-retire.test.mjs`（为什么「修好一条 = 悄悄退休一条守卫」需要一道闸）。
5. 施工清单原文在会话临时目录的 `geom-plan.md`（§零 13 条缺陷 + §五 批次表 A–G）。
   ⚠ **那是临时文件，可能已经没了**；它里面属于本轮的结论都已经搬进上面 2、3、4 三处，
   没搬的是**尚未开工的批次 C–G**。

## 验收数字（可复现）

跑全套：`node --test --test-reporter=tap` 加上 `test/*.test.mjs` 展开的全部文件，
输出 `# tests 521 / pass 520 / fail 0 / skipped 1 / todo 0`。

⚠ **必须加 `--test-reporter=tap`**：spec reporter 在非 TTY 下不打 `# fail` 汇总，
这一轮踩过一次（看起来全绿，其实有红）。

`node tools/geom-probe.mjs strike` 的 travel 行：8 个罗盘方向给出 **8 种朝向**，
且每一行的「朝向」与「方位角」逐字相等（改造前恒为 0°）。

## 一、批次 0 / 1：音效播出窗（`playFor`）

**病象**：33 条挥击风声的响度峰值被切在播出窗外——玩家侧的表现不是「声音小」，
是那一声**根本没播出来**。

**根因**：`sound-table.mjs` 的四个量**基准不一样**。`peakMs` / `onsetMs` / `totalMs`
相对素材第 0 毫秒，而 `effectiveMs` 相对**起振点**。把 `effectiveMs` 直接当 cue 的
`duration` 用，播出窗会整整早收一个 `onsetMs`（psfx swooshes 的起振点普遍 170-190ms）。

**修法**：`SFX` 表加第四列 `totalMs`（每条从三元组变成
`[peakMs, onsetMs, effectiveMs, totalMs]`，由 `npm run sounds` 重新生成），
`soundAt()` 改成 `contentEnd = min(totalMs, onsetMs + effectiveMs)`、
`playFor = contentEnd − startTime`。
`totalMs` 的上钳是必需的：10ms 包络窗的量化误差会让 `onset+effective` 比素材总长多几
毫秒，不钳会写出越界的 `timeRange`。实测被误裁的是 **379 条 cue**。

**顺带**：`scripts/player/preview.mjs` 的 `PREVIEW_REGION` 跟着
`tools/dump-fixtures.mjs` 的 `TARGET_REGION` 改口径——后者从「每种 target.type 一个
手写的规范摆位」改成**按 gesture 从 Crucible 源码复算**（含 `curvature`），
预览镜像表因此 radius 300→650、length 400→650、ray.width 100→20。
`test/preview.test.mjs` 的交叉断言如实报了警，这正是它存在的理由。

## 二、批次 A：守卫地基（不改任何画面）

**这一批存在的唯一理由**：B 批的每一条改动都要能被「单条变异精确点红」验收，
而改之前那套守卫做不到。

- `test/geom-guard.test.mjs`：13 条里 **8 条是空真断言**（62%）。判据是「对所有声明了 P
  的 cue 必须 Q」的 ∀ 形状，P 空掉时 `assert.deepEqual(bad, [])` 静默通过。
  隔离副本里把 `resolve.mjs` 的 normalize 改成硬塞 `stretchTo: null, aim: null,
  offset: {x:0,y:0}`（= 把被守的功能整个删光），文件从 `pass 4 / fail 9` 变成
  **`pass 10 / fail 3`**——红转绿 6 条、退化成空真 2 条。
  修法照仓库自己的棘轮惯例（`fallback-ratchet.test.mjs:150`「基线必须贴着实测值，
  不许留放水余量」）：每条 ∀ 守卫配一对「样本量下限 + 下限必须贴着实测」的断言。
  现在是 **16 条，全绿，0 todo**。
- **§1.1 的判据从「8 个方向给出 8 种不同朝向」升级成「朝向 ≡ bearing(施法者→目标)，
  容差 1°」**。旧判据弱得多：把全部朝向整体偏 90° 也能给出 8 种。
- **§1.4 的判据本身是个错的不变式**：它写「at == aim 就等于白写 aim」，但
  `play.mjs:379` 的 `if (cue.aim.missed) e.missed(true)` 落在 `if (rotates)` **之外**，
  aim 是 missed 的唯一载体。旧判据报的 6392 例退化里 **5992 例（93.7%）是假阳性**。
  改成 `samePoint(atPt, aimPt) && !c.aim.missed`。
- 新增 `test/todo-retire.test.mjs`：**修好一条缺陷 = 悄悄退休一条守卫**（todo 的失败
  不计入 `# fail`），这个文件是那个漏洞的闸。它的探测器自己也有活性检查——
  旧版靠 `seen > 0` 判活，被 TAP 汇总行喂饱，todo 全摘干净之后它在**零条 todo**
  的情况下照样绿（批次 B 第 6 步实测踩到），现在改成现造一份「一条通过 + 一条失败」
  的合成 todo 去验探测器。
- 新增 `test/impact-harmless.test.mjs`（4 条）与 `test/fixtures/edge-cases.json`
  （**100 条**合成样本：非 HIT 结果 / critical / healed / `origin.width ∈ {2,3}` /
  inflection / 带 strikes 的 strike 手势）。这些支路此前是**零覆盖**，先写守卫只会得到空绿。
- 新增工具 `tools/geom-probe.mjs`（8 罗盘方向落点几何，含 heading/bearing）与
  `tools/has-path.mjs`（DB 路径校验）。geom-guard 直接 import 前者的 `heading()` /
  `placeAt()`，**两边不许各写一份**。
- `test/asset-families.test.mjs`：族级记录的合法性判据从四条扩到六条，并把
  `jb2a.melee_attack.03.greataxe` **拆成 `.01` / `.02` 两族**（`.02` 有 9 色轴而 `.01`
  没有，本来就是两种素材），`greatsword` 成员数 4→8。
  其中第 4 条判据整个换掉了：**「内容占比离散度上限」是错的**——同一族里变体号常常就是
  「几种不同的挥砍形状」，占画幅不同是设计不是缺陷。族级记录的承诺是「看过的能代表没看
  过的」，所以对的要求是**看全形态**（按 10% 相对容差聚簇，聚出几簇就得抽过几簇），
  不是**长得都一样**。

## 三、批次 B：几何原子改动（owner 实机报的头号问题）

owner 原话：「起点/终点不一致/不对。例如近战的 angle 不对——A 打 B，动画在 B 的其他方向
受到击打，而且击打方向也不对。例如法术，有的时候位置不对，有的时候起点终点过短。」

七步**顺序不可换**，全部落地：

| 步 | 改哪 | 做了什么 |
| --- | --- | --- |
| 1 | `tools/fake-sequencer.mjs` | `EFFECT_METHODS` 白名单加 `"template"`。不先加，`play.mjs:444` 的 catch 会把整条 cue 静默吞掉（实测漏加时 play-contract 转红 8 条） |
| 2 | `scripts/resolver/assets.mjs` | 加 `bandOf()`：运行时后端自己按路径里的 `.30ft` 挑档 |
| 3 | `scripts/resolver/resolve.mjs` | `CUE_DEFAULTS` 加 `template: null` |
| 4 | `scripts/player/play.mjs` | `.template()` 留白补偿块 + `rotateTowards` 的 template 分支 + `sizePx` + round-cone 遮罩 |
| 5 | `scripts/armory/travel.mjs` | 8 条 stretchTo 规则透传 `template`；4 条近战规则收敛成 `meleeGeom()`；`strike.thrown` 删 mirrorY；surge 改落点 |
| 6 | `scripts/armory/impact.mjs` | 删 1164 条的死 aim；元素层 `randomRotation` → 攻击轴；逐结果裁定表 `RESULT_GEOM`；MISS 的构图补偿 |
| 7 | `scripts/resolver/context.mjs` | `offsetFor` / `onLeft` 整个删除；`sizeScale` 改连续 `1 + 0.4·(w−1)` |

### 三个必须记住的陷阱（都是实测出来的）

1. **`.template()` 会静默丢弃为 0 的 startPoint → NaN 锚点 → 整条特效不可见。**
   `EffectSection.template()`（sequencer.js:24079-24108）三条赋值都是
   `if (x) this._template[k] = x`，0 被丢掉；丢掉后 `_setAnchors:17024` 的
   `this.template.startPoint / textureWidth` **没有 `?? 0` 兜底**（同一字段在 16971 处
   **有**），算出 NaN → `sprite.anchor.set(NaN, 0.5)` → vertexData 全 NaN。
   **不传 template 是安全的，打了补丁反而炸**；影响 172 条 cue = 待修 249 条的 69%。
   修法 `startPoint: Math.max(startPoint, 1)`（代价上界 0.143%·d，像素读不出来）
   加上「两端全 0 的模板整条跳过」。
2. **运行时 `.30ft` 形同虚设**，命中目标档只有 1/5（`FEET_REGEX` 带前导点，
   `:6768` 恒 undefined → 原样返回整族 → `ctx.pick` 随机取一支）。
   **离线不这样**——典型的「离线全绿、上机走样」。不修它，陷阱一的补偿会被随机档稀释。
3. **`at` 改施法者会同时改变 `scaleToObject` 的参照物**（`_applyScaleToObject`
   17171-17190 取的是 atLocation 那个对象的宽度）。所以近战的「改锚点」与「改尺寸」
   **必须一次原子落地**，拆两步会让大体型挥击翻倍。

### 推翻的既有结论（本轮落地的部分）

| 文档 / 代码 | 原结论 | 凭什么推翻 |
| --- | --- | --- |
| `ASSET-NOTES.md` 末节 | stretchTo 留白不补偿，「理由是 `data/asset-index.json` 里没有这项元数据」 | `git show HEAD:data/asset-index.json` 逐字数：那份索引 `generated: 2026-08-22`，**正是写下这句话的同一批**，四张 `_templates` 表已在（jb2a 13 / eskie 7 / blfx 6 / ggg-vfx 3）、带 `_template` 的节点 **326 个**；`assets.mjs` 的 `templateOfEntry()` 早就把它读成数值三元组。**这句话从落笔起就不成立，不是「过期」** |
| `ASSET-NOTES.md` 主表 84/85/160/161 四行 + `travel.mjs` 两处注释 | 「野太刀是全族唯一够得到隔一格的一支」 | 那些 x 值量的是**贴图内部像素**；改造前 `scaleToObject` 把画幅差归一化掉（净增益 9.4 画布 px = 0.094 格，缺口是 1 整格），改造后握把→刀锋恒等于中心距、与素材无关。换素材的理由只剩「画面像不像」 |
| `DESIGN.md` §3.2 / §6.5 / §8.1 | 「未命中用 `.missed()`，不自行计算偏移」 | `calculate_missed_position` 的 `!target` 分支用 `creationTimestamp` 播种、**逐客户端不同**，与本模组「出手端广播一份 plan、各客户端本地播」相抵触；且 DODGE 一旦转向，`rotateTowards` 会填上 `data.target`，`missed && !data.target` 恒假——**它本来就不生效**。范围只限 `impact.layered`，飞行物落空与 `generic.impact` 兜底继续用 |
| `DESIGN.md` §8.2 第 3 条 | 「镜像朝向：`mirrorY(target.onLeft)`，否则武器反手挥」 | `mirrorY` 翻的是 y 轴，物理上表达不了左右；探针实测 8 方向朝向恒 0°。朝向改由真旋转承担，`ctx.geom.onLeft` 随调用点一起退休 |
| `DESIGN.md` §8.2 第 2 条 | 「大体型 ×1.4；offset 按 `width` 折半」 | ×1.4 是**一档**的经验值被当成了一条曲线（2×2 与 4×4 同系数），改连续 `1+0.4·(w−1)`（w=2 处仍是 1.4）；`offsetFor` 乘的是**施法者**宽而用它的 cue 锚在**目标**身上，3×3 的施法者会把偏移推到 150px，整个删除 |
| `sound-table.mjs` 的用法 | 拿 `effectiveMs` 当 cue 的 `duration` | 两者基准差一个 `onsetMs`，379 条 cue 被误裁、33 条挥击风声的峰值落在窗外 |
| `asset-families.test.mjs` 第 4 条判据 | 「族内均匀 = 内容占比离散度 ≤ 0.20」 | 同族变体号常常就是几种挥砍形状，占画幅不同是设计。改成「抽样必须覆盖每一种形态簇」 |
| `geom-guard.test.mjs` §1.4 | 「at == aim = 等于白写 aim」 | `play.mjs:379` 的 `e.missed(true)` 落在 `if (rotates)` 之外，aim 是 missed 的唯一载体；旧判据 93.7% 是假阳性 |

## 下一步

批次 **C**（法术区域几何，依赖 B 的 template + sizePx + round-cone）、**D**（素材语义，
可与 C 并行，每条都要走 ASSET-NOTES 读图流程）、**E**（音效）、**F**（状态时间轴）、
**G**（架构清理）都还没开工。C 有一个已知阻塞点：fan 的 210° 会触发 `coneYScale` 的 warn
从而弄红 `coverage.test.mjs`。

**本轮全部改动仍在工作区，未 commit**——提交由 owner 决定。

---

# 当前状态（2026-08-23 收盘，v0.9.0）

> **这是上一轮（2026-08-23）的收盘快照。** 四大块的补全度数字仍然有效；
> **但它对几何的描述已被 2026-08-29 那一轮全面订正**，几何相关的话以上一节为准。
> 下面的数字都是实测的，重跑 `node --test "test/*.test.mjs"`
> 与 `test/weapon-dispatch.test.mjs` 可复现。

## 四大块

| 块 | 总数 | 有专属画面 | 走兜底 | 不同画面 | 有声音 | 不同音效 |
| --- | --- | --- | --- | --- | --- | --- |
| 武器 | 69 | **68** | 1 | 46 | **68** | 26 |
| 法术 | 204 | **204** | 0 | 119 | **204** | 35 |
| 其它动作 | 161 | 123 | **38** | 42 | 34 | 18 |
| 状态 | 46 | 45 | — | 12 | **0** | 0 |

另有 92 件武器的独立语料（`test/fixtures/weapon-strikes.json`）：**0 件哑的**、
43 条不同派发路径、最大碰撞桶 7（都是语义正确的复用）。

- **动画补全度**：434 条动作里 39 条走兜底 = **91%**
- **音效补全度**：306 / 434 = **71%**（状态层 0/46）

## 剩下的 39 条兜底不打算做

系统默认动作（`move` / `delay` / `escape` / `fall` / `defend` …）与无标签天赋。
快照上**没有任何可以据以选材的字段**——没有 damageType、没有 target 形状、没有标签。
配一个错的不如让它走兜底：兜底是「没为它选」，错配是「为它选错了」，后者更难发现。

## 真正缺素材的地方（不是工作量问题）

| 缺什么 | 影响 | 为什么没有 |
| --- | --- | --- |
| **一次性状态提示音** | 状态层 0/46 有声 | `psfx.conditions` 只有 6 秒**环境循环**，挂在每个带状态的 token 上会一直嗡 |
| **无文字的状态标记** | 状态只能用 12 组通用图 | `jaamod.condition` 34 个具名状态**把英文单词烤进了画面**，中文场不能用（已进否决清单，无文字可用的约 10 个也逐条列了） |
| **piercing 命中音** | 穿刺借用斩击音 | psfx 只有 slashing / bludgeoning |
| **腐蚀/虚空/心灵/光耀的箭矢** | 这四种元素射普通箭 | jb2a.arrow 只有 cold/fire/lightning/poison/physical |
| **爪牙类元素风声** | 元素咬击只有物理风声 | MGS 只有刀剑斧锤杖鞭六类 |
| **角色残影 / afterimage** | 冲扑只有尘迹没有残影 | 十个命名空间搜遍，最接近的 `jb2a.teleport.01.white` 已被 DODGE 占用 |

## 下一步的候选（按我的判断排序）

1. **上机实测** —— 这一路全是离线验证，还没在真游戏里看过一次。本项目最贵的失败模式
   就是「离线全绿、game 里悄悄坏掉」：这一轮就撞到过一次 `spell.gesture.*` 签名的坑，
   build 抛异常被 `runBuild` 的 try/catch 吞掉 → **整条画面静默消失只剩降级告警**，
   在游戏里表现为「这个法术怎么没画面了」而不是报错。只有测试抓住了它。
2. **其它动作的音效**（34/161）—— 架势、吟唱、召唤现在只有画面没有声音。
3. **法术画面细化** —— 已有 119 种组合，再细要靠屈折（inflection）维度，收益递减。

## 纪律（每一轮都适用，栽过的坑）

1. **守卫必须变异验证**：把被测的东西弄坏，测试必须转红。这一轮有两个新功能写完时
   **全关掉测试仍然全绿**——「加了但没人管」。
2. **变异本身要确认落地**：替换字符串缩进对不上会静默失效，读出来像是「守卫失效」。
3. **判据不能引用被测对象自己**：`assert(wuf === clip.contactMs - clip.durationMs)` 两边
   都来自同一张生成表，是同义反复。要回到源数据重算。
4. **看图要看规则真会取的那一支**：`family-sheet` 默认取叶子第一个文件（字母序），
   而规则取的可能是 `white`。第一张图全是品红色能量弧，按 white 重渲才是实际画面。
5. **DB 路径必须是完整字面量**：插值拼的路径静态扫描还原不了，三条依据守卫会整体失效。
   连 `"jb2a.arrow."` 这种**半截前缀**都会被路径抽取当成一条路径（栽了两次）。
6. **测试取 cue 要过滤 `kind !== "sound"`**：音效 cue 排在画面之前，`[0]` 会取到声音（栽了三次）。

---

## 一、这一轮改了什么（已提交前状态）

| 项 | 状态 |
| --- | --- |
| 语料标签传播修复（`tools/dump-fixtures.mjs`） | ✅ 兜底率 −37%，武器通路首次被测到 |
| 兜底棘轮基线重量 | ✅ 105 / 203 / 387（旧值 180 / 270 / 616 是坏语料上量的） |
| 反引号守卫洞（`test/armory-assets.test.mjs`） | ✅ 三条守卫此前对反引号路径完全失明 |
| 预处理：17,305 条画面 + 7,322 条音频量测 | ✅ 零失败 |
| **B2 多目标交棒（本轮）** | ✅ 见下 |

测试：**450 条，449 绿 1 skip**（skip 是 J1 终点「语料零兜底」，那是进度表不是失败）。

---

## 二、B2：多目标下各目标的分支被排了队（已修）

### 病象

`Sequence.play()`（sequencer.js:27772-27776）是**一条线性队列**，带 `waitUntilFinished`
的一段会 `await` 住整个 for 循环。而每目标规则**每个目标各出一条 cue**，于是：

```
travel(A) dur=933 wuf=-400   → 队列 t=533 放行
travel(B) dur=767 wuf=-400   → B 从 t=533 才起手，队列 t=900 放行
impact(A) delay=0            → A 的血溅打在 t=900
```

A 的交棒点本该 533（挥击 933ms、提前 400ms 出血），实际晚 **367ms**——那时 A 的挥击
（933ms 结束）几乎收招了。

### 影响面（全量语料实测）

- **177 个动作**中招，首目标迟到**中位 503ms、最大 636ms**；
- 其中 fan 14 / aura 24 / pulse 8 / ray 4 / cone 2 / blast 1 = **53 个是系统里真会打到
  多个目标的类型**（其余 single 106 / movement 18 是语料给每个动作硬塞 2 目标的产物）；
- `fanOfArrows` 当时的实际表现是「一支箭飞完再射下一支」。

### 修法

`scripts/resolver/resolve.mjs` 新增 `parallelizeTargets()`：≥2 目标时把「靠
`waitUntilFinished` 逐条交棒」改写成「每个目标各一条并行的绝对时间轴」。

前提是实测出来的，不是假定的：多目标计划里带交棒点的 cue **354 条全部有显式
`duration`**、无一条 persist、无一条 sound——不然改绝对时刻算不出来。真有规则漏写时长
时会 `ctx.warn`，不静默按 0 算。

改完 `strike`（2 目标）：

```
travel A  delay=0    dur=933        两把挥击同时起手
travel B  delay=0    dur=767
impact A  delay=533  (=933-400) ✓
impact B  delay=367  (=767-400) ✓
```

### 两个反直觉的点

1. **一致性优先于「能省则省」。** 初版对「阻塞 cue 不足 2 条」的计划提前返回（反正不会
   互相顶）。结果是同一批计划里两种表示法并存，守卫得先分辨「这份改写了没有」，而那个
   判据只能从改写留下的痕迹反推——循环论证。现在一律改写，不变式没有特例。
2. **交棒锚点要挑「起播最晚」的那条，不是队尾那条。** 分支长短不一（A 933ms、B 767ms），
   队尾是 B 的尾巴，比 A 早收工 166ms，信号量会早放行。锚点挑最晚的并挪到队尾。
   留这条交棒点**不是画面需要，是信号量兜底**：非阻塞段的 promise 不覆盖播放时长
   （21526 对非 async 段是裸 `run()` 不 await）。

### 守卫（`test/resolve-parallel.test.mjs`，3 条）

判据是**与单目标等价**：单目标的线性队列本来就是对的（一条分支，无人可顶），所以
「多目标下每个目标看到的画面 == 它单独出现时看到的画面」既最强也最好写——不必在测试里
重新推导应该是几毫秒。两边都按 Sequencer 队列语义模拟，**不认表示法只认播放效果**。

变异验证（全部转红才算数）：

| 变异 | 结果 |
| --- | --- |
| 整个改写不调用 | 3/3 红 |
| 交棒偏移丢掉（`+ wuf` 删掉） | 1/3 红 |
| 分支不等共享前奏（`branch.set(key, 0)`） | 1/3 红 |
| 锚点用队尾而非起播最晚 | 1/3 红 |

### 顺带修正的两条既有守卫

`armory-flash.test.mjs` T3 与 `armory-travel.test.mjs` 的飞弹用例都直接断言
`waitUntilFinished` 常数，改写后读不到。**语料里一个单目标快照都没有**（113 个零目标、
321 个双目标），所以两处都加了 `oneTarget()` 把目标砍到 1 个——它们守的是**规则自己写的
常数**，用单目标读最贴切。

试过让 T3 改成「从绝对 delay 反推交棒点」，**读不回来**：交棒点是槽的入场时刻，而 impact
槽里每条 cue 还各带槽内偏移。`spell.gesture.arrow` 交棒点 467ms，但自带闪爆规则会压掉
impact 结果层（T1），只剩再 +200 的元素层，从外面读到 667ms——多出的 200 与交棒点无从
分离。所以分工：T3 守规则常数，`parallelizeTargets` 由 `resolve-parallel` 守。

---

## 三、四通道派发：评审结论（**这个设计要改，别照着做**）

### 它是什么（大白话）

Crucible 里**武器自己没有动作**，动作是天赋给的，而且所有武器都用同一个「打击」动作。
所以「这一下该播什么动画」必须从别处凑。四通道就是把它拆成四个正交的问题：

| 通道 | 回答的问题 | 大白话 | 取值例 |
| --- | --- | --- | --- |
| **form** 形 | 挥出来是什么形状 | 大剑是横扫的大弧，匕首是短促的直刺，弓是一条飞行轨迹 | 大弧 / 小弧 / 直刺 / 飞行 |
| **grain** 质 | 打上去是什么质感 | 砍是血口子，砸是钝击闷响，刺是穿刺孔 | 斩 / 钝 / 刺 |
| **beat** 拍 | 节奏是什么 | 一下重击 vs 连续几下 | 单发 / 连发 |
| **accent** 饰 | 附加什么修饰 | 强力打击要更亮更大、暴击要加一层、火焰武器要染成橙色 | 强度档 + 颜色 |

想法是：`大弧 × 斩 × 单发 × 强` 组合出一个具体画面，于是不必给 92 件武器 × N 个动作
各写一条规则，只写四张小表就能铺满。

### 评审判定：**思路对，但这个版本会把判别度投影掉**

实测（69 个武器动作）：

| 阶段 | 不同的「键」有几个 |
| --- | --- |
| 快照原始字段能区分出来的 | **63** |
| 四通道编码之后 | 29 |
| 落到挥击分支的实际画面 | **10** |

**53/69 个动作落进了碰撞桶，最大的一个桶里 12 个动作长得一模一样。** 也就是说信息不是
不够——原始字段里有 63 种区别——是四通道这个编码把它压没了。用户的核心诉求正是
「每个动作/物品/技能都有 specific 的动画」，这个设计恰好与它相反。

### 逐通道裁定

| 通道 | 裁定 | 理由 |
| --- | --- | --- |
| **form** 形 | **留** | 真的加信息：武器分类 → 形状是稳定映射 |
| **grain** 质 | **留** | 真的加信息：伤害类型 → 质感是稳定映射 |
| **beat** 拍 | **砍掉** | 离线语料上 100% 是死代码，运行时也只分得开 5 个动作。为 5 个动作留一个通道，不值 |
| **accent** 饰 | **重写映射** | 现在把 `blueyellow` 派给 `accurate/finesse/keen`（武器属性），但 `palette.mjs:35-40` 里 `blueyellow` 是 **electricity**、`RUNE_COLOR` 里是 **storm**。同一个颜色两种语义，画面上「精准武器」会看起来像「闪电武器」。正确做法：**图案 = 强度轴，颜色 = `DAMAGE_COLOR[damageType]`** |

### 修正后的立场

保留 form + grain 两个真的加信息的通道；**动作轴的判别度不要投影到 3 个 accent 图案上，
原样留着**——它才是「每个动作 specific」的来源。

---

## 三点五、A1 第一轮：武器专属选材（已落地）

### 派发键定错会全盘作废，所以逐条读源码定

原计划用 `w.id`（官方 pack 里确实是 `dagger0000000000` 这种语义 slug）。**实测推翻**：
那个补零 slug 是 `standardizeItemIds()`（crucible-compiled.mjs:48925）给**世界物品**做的
规范化，角色身上的嵌入物品不走它——pregens 里那把匕首的 `_id` 是 `U0pzlydffRGomINf`。
备选的 `_stats.compendiumSource` 在 pack 里与角色身上**都是 null**。两个候选实战全废。

改用 **`system.identifier`**：pack 里与角色身上都是 `dagger`；不是显示名，Babele 把名字
译成「匕首 Dagger」也动不到它。不保证语义（`ItemIdentifierField` 默认值是 `randomID(10)`），
但查不到就落回 category 级联，正是现有行为。

### 战果

| | 起点 | 第一轮后 |
| --- | --- | --- |
| 92 件武器命中的不同 travel 素材 | 6 | **43** |
| 最大碰撞桶 | 20 件共用一段短剑挥砍 | **8** |
| 一条 travel cue 都不出 | 14（5 盾 + 9 法器） | **5**（只剩盾） |

做了什么：

1. `tools/dump-weapons.mjs` → `data/weapons.json`：92 件武器枚举（定义域，不是手写清单）
2. 快照 `strikes` 带上 `identifier` + `properties`
3. `test/fixtures/weapon-strikes.json`：92 件武器各一份平打快照（单独一份文件，不污染兜底棘轮）
4. `scripts/armory/weapon-shapes.mjs`：武器 → jb2a.melee_attack 形制表，67 件近战武器 → 18 个形制
5. 新规则 `travel/strike.talisman`：9 件法器从全程静音变成按 `DAMAGE_COLOR` 染色的附魔剑挥击
6. `test/weapon-dispatch.test.mjs`：三条棘轮 + 反向守卫（基线不许虚高），已变异验证

### 选材依据：21 个族级记录

`docs/ASSET-NOTES.md` 新增 21 个族（全族机器量测 + **每个内容占比簇各抽一条读图**，
共 57 条抽样）。族内均匀性由 `test/asset-families.test.mjs` 四条守卫强制。

读图的实际发现（`tools/family-sheet.mjs` 拼图，27 形制 + 88 变体两张）：

- 同一形制的 4 个变体是**四种挥击方向**（平扫 / 高弧 / 竖劈 / 下斩），可做随机池
- 形制之间确实可辨：`greatclub` 看得见褐色木棒、`scythe` 有完整镰刀柄与弯刃、
  `nodachi` 画幅 1000×800 弧幅明显更大、`chakram` 有环、`bone`/`greatbone` 是骨白
- `magic_sword` / `magical_greatsword` 有颜色分支 → 法器按伤害类型染色

### 两条否决被**限定范围**并提升为主表记录（不是绕过）

`jb2a.melee_attack.03.greatsword.01` 与 `.05.scythe.01` 原本在否决清单上，而
**否决压过族级记录**，`test/armory-assets.test.mjs` 会机械拦下。处理方式不是放宽守卫，
是把两条从否决清单**提升为主表逐条记录**，原判据与新范围都留着：

- greatsword 原判据是「拿它当通用近战挥击，不如 shortsword」——**继续成立**。本轮用法是
  「给巨剑配巨剑的挥击」，不必更好只需更像。原记录说的「极暗」指 f4-f16 **起手段**，
  与量测出的峰值帧暗底亮度 131-158（全族最高档）不矛盾，两个口径量的是不同的东西。
- scythe 原判据是「做不出隔一格的长度差」——**继续成立**，隔格仍然只能用 nodachi。
  本轮用它当长柄类形制，与长度无关。

### 第二轮（同日）

| | 起点 | 一轮 | 二轮 |
| --- | --- | --- | --- |
| 不同 travel 素材 | 6 | 43 | **58** |
| 最大碰撞桶 | 20 | 8 | **6** |
| 哑的武器 | 14 | 5 | **0** ✅ |

1. **39 件天生武器**从骨棒改到 `jb2a.bite.400px`（獠牙大口 7 色）与 `jb2a.claws.400px`
   （3-4 道抓痕 8 色）。部位决定形状、伤害类型决定颜色，元素变体一条规则全覆盖。
2. **5 面盾**接上盾撞（`jb2a.melee_attack.06.shield.01`，只登记 `.01` 一支，整族离散度 0.49 不合格）。
3. **8 件远程武器**按弓/弩/枪分成箭矢 / 弩矢 / 弹丸三类（新规则 `strike.ranged.weapon`）。

顺带修好一个**调色表缺口**：`pickColor` 先 `filter(c => c in COLOR_HUE)`，而 `jb2a.claws`
整族的分支名是 `bright_*` 前缀加 `brown`，**表里一个都没有**——8 个分支只剩 red/dark_red
两支进候选集，10 件元素爪击实测全塌成同一支。补进 `bright_blue/green/orange/purple/yellow`
与 `brown`、`grey`（后者记 -1，可显式指定但不作为饱和色的近似）。

### 打偏与血溅（本轮核实，不是新增）

- **血溅只在命中时出**：`HIT_RESULTS = [GLANCE, HIT]`，只有这两种结果叠加元素层。
  MISS 出 `jb2a.ui.miss.white`、DODGE 出闪避残影，都不带血。
- **飞行物打偏会真的偏出去**，近战不会。`.missed()` 的偏移只在特效**没有** `data.target`
  时才加得上（sequencer.js:15360 的 `missed && (!source || !data.target)`）；`aim.towards`
  会经 `rotateTowards` 装上 `data.target`，那时 `.missed()` 只打歪朝向。所以
  用 `stretchTo` 的飞行物（含新的 `strike.ranged.weapon`）偏得出来，用 `aim.towards`
  的近战三条规则写 `missed: false` 是对的，打偏由 impact 的 MISS 层表达。

### 第三轮：动作轴开工 + 一处订正

#### 订正：突刺素材是存在的，我之前找错了族

一轮的结论「突刺类武器整个 melee_attack 族没有对应素材，故意留空」**是错的**，而且已经
写进了 v0.2.0 的发布说明。`jb2a.melee_generic.piercing.{one_handed,two_handed}` 就是突刺
（亮尖横向前突 / 弧线冲刺）。刺剑 / 短击剑 / 细身匕 / 长矛 / 标枪 / 骑枪现在各自刺出去。

同族还有 `bludgeoning` / `slashing` / `creature_attack.{claw,fist,pincer}`，留作后续。

#### 动作轴第一条规则：`strike.shape.area`

判据是 Crucible 动作自己的 `target.type`——玩家选的那半件事，此前在画面上完全不存在：

| 动作 | 之前播的 | 现在 |
| --- | --- | --- |
| `tailSweep` 尾巴横扫一圈 | 一记拳击 ×2 | 黄色火花环（一次） |
| `acidSpray` 喷一口酸 | 一记拳击 ×2 | 黄绿锥形喷吐（一次） |
| `lightningBurst` 闪电爆发 | 一记拳击 ×2 | 蓝紫火花环（一次） |
| `penetratingShot` 贯穿射击 | 一发普通子弹 ×2 | 橙色穿刺直线（一次） |
| `noxiousSpray` 毒喷 | 一记拳击 ×2 | 绿色穿刺直线（一次） |
| `fanOfArrows` 扇形箭雨 | 一支普通箭 ×2 | 锥形箭矢齐射（一次） |

共 11 条动作。规则是 `once: true`——区域动作一次只该出一份画面，锥形打中 5 个人不该叠
5 份锥形；cue 数从每目标 1 条降到整个动作 1 条。颜色走**动作**的伤害类型而不是武器的
（喷酸的酸来自动作，不是牙）。这些快照 `region` 是 null，所以锚在施法者、朝代表目标定向，
不吃模板几何。

#### 顺带修好我自己那条棘轮的度量缺陷

`distinctTravel` 原本数的是**文件数**，而 `ctx.pick` 会在同一 DB 节点的 4 个变体里按种子
随机取一个——于是「短剑类武器都落在 shortsword」这**一个**派发决策被算成 4 种素材。
把 6 件突刺武器从「散落在短剑/木棒/巨剑的随机变体上」改成「统一刺出去」是明确的改进，
却让数字从 58 掉到 57，棘轮报了假警。改成数 **DB 路径**之后是 43，那才是「兵库做了多少种
不同的选择」。⚠ 43 与旧口径的 58 不可直接比较。

### 还剩什么

- 剩下四个大桶**都是语义正确的复用**：6 个物理爪、5 个物理咬、5 件单手突刺、5 面盾
- 动作轴还剩：`movement`（冲扑 5 条）、`fan`/`blast`（横扫 2 条）、`empowered`（强度 7 条）、
  多动作点（连击 12 条）——都还是单体挥击
- **元素弹药**：`jb2a.arrow.{fire,cold,lightning,poison}` 都在，可按动作伤害类型选
- `jb2a.melee_generic` 的 `creature_attack.{claw,fist,pincer}` 是攻击弧线，比现用的
  `jb2a.claws`（抓痕，更像命中标记）更适合 travel 槽，可考虑对调
## 三点六、借鉴成品配方（第四轮）

### 挖了什么

本机装着几个社区「成品菜」，里面是手工调过的「动作 → 素材 + 参数」映射。枚举后确认
可挖的是 `pf2e-trigger-animations-trove/animations.json`——**224 个具名动画图、631 处引用、
374 个不同素材路径**。其余几个（`pf2e-trigger-trove` / `trigger-animations` / `autoanimations`）
要么是纯触发逻辑、要么把配方编进了 JS 包，素材引用接近于零。

### 它验证了什么

trove 给 battleaxe / katana / scimitar / scythe 的选择与本仓库**逐条相同**；`Bite` 用的是
`jb2a.bite.400px.red`，**连默认色都一样**；`Greatpick` 用 `jb2a.melee_generic.piercing.two_handed`，
正是本仓库上一轮翻出来的那一支。

### 它暴露了什么

**`jb2a.<武器>.melee.*` 是与挥击族并列的另一族，20 件武器，本仓库整族没发现。**
trove 给 Rapier / Staff / Halberd 用的正是 `jb2a.rapier.melee.01.white` /
`jb2a.quarterstaff.melee.01.white` / `jb2a.halberd.melee.01.white`。两族的差别是长度：

| | 帧数 | 是什么 |
| --- | --- | --- |
| `melee_attack.<形制>` | 39-51（1.3-1.7s） | 一记挥击 |
| `<武器>.melee.01` | 66-86（2.2-2.9s） | 一套连段（2-3 下） |

正好对上「连击」这一类。其中 9 件还带 `.fire` 分支（火焰武器版），留作元素弹药那一轮。

### 本轮落地的三条新规则

| 规则 | 判据 | 覆盖 | 之前播的 |
| --- | --- | --- | --- |
| `strike.melee.combo` | `mainhand`+`offhand` / `dualwield` / 单体且 ≥2 动作点 | 7 条 | 一记单挥 |
| `strike.shape.charge` | `target.type === "movement"` | 5 条 | 原地挥击 |
| `strike.shape.area` 扩 fan/blast | `target.type` ∈ {fan, blast} | 2 条 | 每目标各挥一次 |

冲扑用 `jb2a.gust_of_wind.veryfast`（1200×200 尘团横条，自己从左走到右）stretchTo 从施法者
铺到目标；横扫用 `jb2a.melee_generic.whirlwind.01`（绕身 360° 刀光环）。

### 两个必须记住的坑

1. **`whirlwind.01` 的叶子把 84 帧与 24 帧混在同一个数组里**（前者前 733ms 全空），
   `ctx.pick` 均匀随机取——写到节点等于一半概率白等 0.73 秒。为此给时序表补了 `leadMs`，
   并加了 `leastDeadAir()` 按空头帧挑。族级守卫也如实拦下了它（离散度 0.71），改成逐条记录。
2. **拼图默认看到的不是规则会播的**：`family-sheet` 取叶子第一个文件（字母序 =
   `dark_orangepurple`），而规则取的是 `white`。第一张图全是品红色能量弧，重新按 white 渲染
   才看到实际画面（干净白色挥弧、长柄类看得见杆身）。**看图要看规则真会取的那一支。**

### module.json 声明素材依赖

本模组只做派发、不附带素材，缺哪个包哪一族就解析不到。`relationships.requires` 补上
`jb2a_patreon` / `eskie-effects` / `blfx-assets-pack01` / `psfx-patreon`，开本模组时会连带
提示启用。（MGS 音效是 Data 下的裸目录不是模块，声明不了。）
## 三点七、音效层 + 第四块空白（第五轮）

### 音效层

改造前 434 个动作里**只有 11 个有声音**。现在 **99 个**。挥出去有风声（按武器轻重）、
打中有命中音（按伤害类型）、打空有划空声——MISS 结果层此前完全静音。

**这一层最容易做错的事：把「开始播」当成「听见」。** psfx 家族起音中位数 200ms，
`psfx.impacts.bludgeoning.v1` 更是 210-240ms 才有声、峰值 250ms。按命中时刻直接排，
玩家会在刀收招之后四分之一秒才听见。口径改成 `delay = 想让它响的时刻 − 响度峰值`；
来不及时用 `startTime` 跳进音频，**只跳到起音为止**（那段是纯静音，跳过去不损失声音；
再往后跳会削掉起振，而起振正是「打中」的听感来源）。

量测直接否掉两条选材：`psfx.impacts.magicaleffects.lightning` **在否决清单里**
（三次放电、峰值 1020ms，会听成打了三下），`generic` 峰值 470-950ms 对不上节拍。
都换成 MGS 的 `slingshot_<元素>_hit`——同一族的完整元素集，峰值一致 350-420ms。

### 第四块空白：非武器非法术动作

**这是本仓库最大的一块，而原计划里没有它。** 434 个动作里武器 69、法术 204，
剩下 161 条「其它」中 **104 条只播通用兜底**——按条数比法术与状态加起来还多。

它们不是没有判别信息：104 条在快照原始字段上能区分出 **77 种**。形状高度集中：
self 51 / single 21 / pulse 12 / summon 8 / aura 7。

新增 `cast/self.shape` 规则，按五簇分：

| 簇 | 判据 | 素材 |
| --- | --- | --- |
| 四大元素架势 | **动作 id**（这四条既无 damageType 也无元素标签，id 是唯一判据） | `jb2a.on_token_buff.002.001` + 元素色 |
| 英雄气概 | `cost.heroism > 0` | `eskie.buff.one_shot.attack`（升腾的剑） |
| 吟唱光环 | `vocal` + aura/pulse | `jb2a.soundwave.02`（song 蓝 / dirge 红） |
| 召唤 | `target.type === "summon"` | `jb2a.magic_signs.circle.02.conjuration.intro` |
| 自身增益 | `target.type === "self"` 且花动作点 | `eskie.buff.one_shot.simple` |

并把区域形状规则放开到非武器动作（`corruptingDeathBurst` 这类脉冲形状判据一模一样）。

**全兜底动作 105 → 39。** 剩下的 39 条**不打算硬凑**：系统默认动作（move / delay /
escape）与无标签天赋，快照上没有可算的判据，配一个错的不如让它走兜底。
## 三点八、法术音效 + 状态层复查（第六轮）

### 法术音效：204 条从完全静音到全部有施法音

法术的**画面其实已经很细**（204 条 → 119 种组合），缺的是声音。`psfx.casting` 按元素
分五支接符文：flame→fire、earth→earth、storm→sound、frost→water，其余八个符文走 generic。

施法音**不按「让峰值落在某一刻」排**——那是给「打中」这种瞬态用的口径。施法音本身是
渐强过程，delay 0 起播、时长裁到有效声长（casting.water 整段 4.1 秒，不裁会盖住命中音）。

有声音的动作 **99 → 303 / 434**。

### 状态层复查：我先前的判断是错的

我说过「46 个状态只有 12 种画面、`dead` 完全没画面」——**两句都不准**：

1. `dead` **有画面**。它在 persist 槽里是**刻意静音**的（注释写着「不该在尸体上永久挂
   一圈与震晕一模一样的青绿环」），由 `death` 槽的 `death.kill` 出一次性血溅。
   我先前只查了 persist 槽——`resolveEffect` 的 slot 参数默认就是 persist。
2. 46 → 12 组是**有意设计**，`STATUS_GROUP` 的注释里逐条写着语义理由
   （enraged 归 debuff 因为它把招架格挡归零、unaware 不归 hidden 因为「我藏起来」与
   「我被偷袭」的决策正好相反）。不是遗漏。

### 状态层真正的空白与它的障碍

**没有声音（0/46）**，而且暂时**没有合适素材**：`psfx.conditions.{boon,generic-layer}`
是 6 秒的环境循环而不是一次性提示音，挂在每个带状态的 token 上会很吵。不硬凑。

**`jaamod.condition.*` 看着像现成解，读图后整族大部分否掉**——34 个具名状态的 token 循环，
名字与 Crucible 的状态几乎一一对应，但**英文单词直接烤进了画面**（DEAFENED / STUNNED /
PRONE / FRIGHTENED…）。本项目跑的是中文场，token 上顶着英文词既跳戏又翻不了。
无文字可用的只有约 10 个，已逐条记进否决清单。
## 三点九、元素弹药 + 元素挥击风声（第七轮）

### 弹药跟着动作的元素走

`flamingArrow`（灼热箭）此前射的是一支**普通箭**——武器是弓、火来自动作，而选材只看了
武器。`jb2a.arrow` / `jb2a.bolt` 各有 cold / fire / lightning / poison / physical 五支
元素分支，同结构同色系，接 `usage.damageType` 即可。

颜色按元素取语义色，**不走 pickColor**：这一族的颜色是**弹药本身的颜色**而不是可染色的
中性素材，取错色会得到一支绿色的火箭。⚠ `jb2a.arrow.poison` 的 30ft 档没有 green 分支，
两族统一取 purple，免得同一发毒箭换个武器就换个色。

对不上的元素（腐蚀 / 虚空 / 心灵 / 光耀）落回 physical——**缺口不是选择**。

### 元素挥击风声

MGS 有一个 **4 元素 × 6 武器类的完整矩阵**（`<元素>_<武器类>_whoosh`，24 条），响度峰值
一致落在 180-260ms。元素取「动作的伤害类型 → 武器的伤害类型」，与命中音同源——
`flamingArrow` 的火来自动作，`flameStaff` 的火来自武器，两条都要认。

⚠ **天生武器不吃这张表**：爪牙不是刀剑，让獠牙发出金属火剑的风声是错的，而 MGS 没有
爪牙类的元素风声。这一条也写进了守卫。

### 两个新功能一开始完全没有守卫

写完跑变异验证：**把弹药元素关掉、把元素风声关掉，465 条测试全绿**。也就是说这两个
功能当时是「加了但没人管」的状态，将来任何改动把它们弄坏都不会有人知道。
补了两条守卫（判据独立算自文件名，不引用元素表本身，否则是同义反复），三个变异全红。
## 四、待办## 四、待办

### B 线（架构清理，B2 已完成）

| | 内容 | 状态 |
| --- | --- | --- |
| B1 | 武器身份 → `system.identifier`（原计划的 `w.id` 与 `compendiumSource` 实测在角色身上都失效） | ✅ 完成 |
| B2 | 多目标交棒 | ✅ 完成 |
| B3 | `(group, variant)` 的 CLIP 表换成逐文件生成的 `data/clip.json`（`{frames, peak, tailEmpty}`），`duration = (frames − tailEmpty)/fps×1000` | 待做 |
| B4 | 重写 accent 映射：图案 = 强度轴，颜色 = `DAMAGE_COLOR[damageType]` | 待做 |
| B5 | 一期砍掉 `beat` | 待做 |

### A1（下一步，92 件武器的专属选材）

修订后的顺序：

1. 快照带上武器身份（依赖 B1）
2. 武器素材级联
3. 动作修饰 / 身份表
4. 组合

### 悬而未决

- `ferociousLeap` / `interruptingThrow` 这类**非挥击**的武器动作
- 23 个带 `natural` 标签的动作
- 约 78 个无结构可算的具名动作（iconicSpell 15、无标签 26、summon 8）——它们**算不出键**，
  只能逐个手配或接受兜底

---

## 五、纪律（每一轮都适用）

1. **守卫必须变异验证**：把被测的东西弄坏，测试必须转红。不红的守卫等于没有。
2. **不读源码不下断言**：本项目 6 个 Critical 全部出自「猜字段路径 / 猜行为」。
3. **「本机有什么」的结论必须来自枚举**，不能来自清单——已经栽过一次。
4. **基线贴着实测值**，不留放水余量；兜底降了就同步下调。
5. 绿在离线、game 里悄悄坏掉——是本项目最贵的失败模式，上机前先想「这条离线绿意味着什么」。
