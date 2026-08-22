# 交接说明 —— 从服务器转到本地继续

服务器是 2 核 / 7.2G，workflow 并发被卡在 2，且大范围 I/O 扫描会把机器拖到近乎失联。
本地继续是对的选择。这份文档说明：**要装什么、当前到哪一步、下一步做什么**。

---

## 一、本地要装的模组

> **2026-08-23 更新：本地已实测完毕，本节的悬置问题全部有答案了。**
> 见 [`LOCAL-STATUS.md`](LOCAL-STATUS.md) —— 本地装机集合与 VPS **不一样**，
> 本节与 `V2-ASSET-SURVEY.md` 里有两条结论在本地翻转，照搬会错。

### 1.1 必需（V1 代码直接引用）

| 模组 | 命名空间 | 本机体积 | V1 引用 | 用途 |
| --- | --- | --- | --- | --- |
| **`sequencer`** | — | 小 | 渲染引擎 | **硬依赖**，没有它模组自我禁用 |
| **`jb2a_patreon`** | `jb2a` | 9.7G | **36 条路径** | 绝大部分画面 |
| **`eskie-effects`** | `eskie` | 1.3G | **13 条路径** | Damage / Pulse / Casting / Attack |
| **`blfx-assets-pack01`** | `blfx` | 1.4G | **6 条路径** | 血泊、少量法术模板 |
| **`psfx-patreon`** | `psfx` | 84M | **2 条路径** | 音效（V1 目前只用到 1 条规则） |

> **关于 JB2A 免费版够不够**：没有可靠结论。V1 是对着 Patreon 版开发的。
> 目录名与数据库命名空间对不上（磁盘上叫 `Cast Generic`，DB 里叫 `cast_generic`），
> 靠 grep 判不准。想省 8G 的话，本地装完免费版后一行就能测：
> ```js
> // 把 scripts/ 里全部 DB 路径喂给它，看哪些不存在
> Sequencer.Database.entryExists("jb2a.cast_generic.01")
> ```
> 缺失的路径不会报错，只会静默降级成「没动画」——所以**必须显式测**，不能靠观察。

### 1.2 系统自带（不用装，但要知道存在）

`systems/crucible/assets/sfx/` 下有 **53 个 .ogg**，是 Crucible 原生的符文音效
（frost / flame / life / death 各 charge/passive/damage/impact/miss）。
音效层可以直接引用这些，音色与原生完全一致 —— 见 §3.2。

### 1.3 V2 候选（**现在不用装**）

完整盘点见 [`V2-ASSET-SURVEY.md`](V2-ASSET-SURVEY.md)（584 行）。摘要：

- 本机 Sequencer 已注册动画 webm **19,819 个**，V1 只用了 79 个（**0.4%**）
- 可用短促战斗音效约 **10,564 条**，V1 只用了 1 条
- **V2 下载清单：0 项必需、1 项可选** —— 东西基本都已经在机器上了

两个坑写在前面：

- **`ggg` 是 192kHz vorbis**（psfx 是 44.1kHz），PCM 缓冲 4.35 倍。以你那三个世界的
  音频缓存泄漏史，引入前必须处理。报告里提了一条缓解路径（ggg 与 pf2e-graphics 有
  705 个同名文件），但**只做了文件名比对、没做内容比对**，能否成立未定。
- **alpha 判据**：本机主力库（jb2a / eskie / blfx / cartoon / Kinemancer）用 WebM
  **容器级 BlockAdditional** 存 alpha，`pix_fmt` 一律报 `yuv420p`。
  正确判据是 `stream_tags=alpha_mode=1`。用 `pix_fmt=yuva420p` 判会**全部假阴性**。

---

## 二、建议砍掉的动画（未执行，等你定）

当前 434 条语料动作 **100% 都出动画**，其中 34% 来自兜底规则。这偏离了设计定的
「克制」基调。下面是分析结果，**我没有动代码**。

### 2.1 一条是错误，不是风格问题

`generic.impact` 会打在 `undetectable`（不可察觉）动作上：

| 动作 | 标签 | 现在播什么 |
| --- | --- | --- |
| `markForDeath` | `undetectable` | cast 1 + impact 2 |
| `assessStrength` | `harmless, undetectable` | cast 1 + impact 2 |
| `intuitWeakness` | `harmless, undetectable` | cast 1 + impact 2 |

给「对方不该察觉」的动作播命中特效，等于把它广播出去。**这是规则层面的错。**

### 2.2 `generic.cast` 打在所有东西上

`move`（走一步）、`delay`（等待）、`defend`、`rest`、`reload`、`fieldStudy`（实地研究）
—— 各播 1 条 cast cue。有人走路，地上开个法阵。

### 2.3 建议的裁剪判据

**「安静标签」且「无战斗标签」** —— 命中 **35 个动作**：

```
安静标签: undetectable, noncombat, rest, movement, harmless, maintained, reload
战斗标签: melee, ranged, spell, strike, unarmed, natural, projectile, dualwield,
          shield, brute, finesse, twohand, onehand, mainhand, offhand,
          afterStrike, mechanical, talisman
```

完整 35 条名单见 [`handoff/CUT-CANDIDATES.md`](handoff/CUT-CANDIDATES.md)。

**为什么要「且无战斗标签」**：单看安静标签会命中 67 个，但其中 30 个同时是战斗动作
（`ferociousLeap` 是 `movement+melee`，那是实打实的飞踢）。一刀切会砍错。

### 2.4 还需要你判断的

`move` / `delay` / `defend` / `rest` / `reload` 这几个默认动作的标签是 `generic`，
不带任何安静标签，**上面的判据抓不到它们**，要显式列名单。

---

## 三、V1 当前状态

**HEAD 见 `git log`，404/404 测试通过，工作树干净，已部署为符号链接。**

### 3.1 已完成（Task 1–15 + Task 16 前三步）

- 六个槽位：`cast` / `travel` / `impact` / `aftermath` / `persist` / `death`
- 覆盖：11 个法术姿态、8 个符文、全部近战武器、13 个默认动作、≈218 个天赋动作、
  10 个变格、46 个状态效果
- 「只补空缺」判据由 `test/native-boundary.test.mjs` 钉在 Crucible 源码上
- 预览宏 `/canim-preview`、聊天卡右键重放、i18n
- 部署符号链接、README

### 3.2 未完成：音效层（Task 17）

**这是 V1 最大的缺口**：1818 条 cue 里音效 **0** 条。播放管道支持（`play.mjs:244`
处理 `kind:"sound"`），但兵库只有 1 条音效规则。

**设计已经定死了，照抄 Crucible 自己的分类法**（`crucible/module/canvas/vfx/sounds.mjs:63`）：

```
RUNE_SOUNDS[符文] = charge(起手一次性) / passive(常驻循环) / damage(伤害循环)
                  / impact(命中) / impactHeavy(仅 flame) / miss(抵抗或失手)
```

音效缺口与画面缺口**完全同构**：

| | 原生 | 缺 |
| --- | --- | --- |
| 有音效的符文 | 4（frost/flame/life/death），53 个 ogg | **8 个符文零音效** |
| `generic.whoosh` 投射物破空 | 文档说有，**实际未定义** | 缺 |

**可占的便宜**：那 11 个原生未实现的姿态，配 frost/flame/life/death 时我们接管后
可以**直接引用 Crucible 自己的 53 个 ogg**，只有另外 8 个符文才需要 psfx。

**已完成的 psfx 侦察（3/7 组，31 条推荐）**：见
[`handoff/psfx-recon-partial.json`](handoff/psfx-recon-partial.json)

| 组 | 结果 |
| --- | --- |
| 近战武器（weapon-swooshes + weapon-attacks，76 个 ogg 全量分析） | 推荐 11 / 驳回 6 |
| impacts（23 个 ogg） | 推荐 8 / 驳回 4 |
| 施法起手（casting + incantations + magic-signs） | 推荐 12 / 驳回 13 |

**未跑的 4 组**：远程武器 ft 档位、8 个无音效符文的法术命中、状态音、兜底扫描。

侦察方法（本地重跑时照做）：不靠文件名猜，`ffmpeg showspectrumpic` 渲染频谱图
**并实际读图**，`ffprobe` + `silencedetect` 测起振点 / 峰值 / 尾部静音。

⚠️ **守卫约束**：`test/armory-assets.test.mjs` 要求**所有素材路径（含 psfx）必须在
`docs/ASSET-NOTES.md` 主表里**。新增音效路径必须同步加表行，否则测试变红。

### 3.3 未完成：最终全分支评审

SDD 流程要求的跨任务评审还没做过（前 15 个任务只做过单任务范围评审）。

### 3.4 未完成：上机验收（只能你做）

两份清单共 **58 项**：

- `handoff/task-16-brief.md` Step 4 —— 原始 38 项
- `handoff/task-16-carried-items.md` —— **C1–C20 累计延后项**

最重要的是原始清单第 **12** 项：确认 Crucible 原生已实现的 24 组法术组合仍走它自己的
粒子系统、本模组全程不介入。这是「只补空缺」的最终验证。

---

## 四、这个项目的六类反复失败模式

写在这里是因为**每一类都犯过不止一次**，本地继续时同样适用。

1. **猜字段路径 / 猜行为** —— 不看源码就写 `ev.resource.health`、`token.center`、
   `li.dataset`。已致 **6 次 Critical**。连我自己写简报时都栽过（只看 `when()` 就推断
   `build()` 的行为，错了三行）。
2. **守卫比以为的弱** —— 断言恒真，或能被「把被测东西删光」绕过。
   所以每条新守卫都要做**变异验证**：把被测行改坏，测试必须变红。
3. **假成功** —— 函数返回非 null，但内容不是被请求的那个东西。比「什么都没返回」更糟，
   因为它谎报成功。
4. **零元素边界** —— 对 targets 循环，targets 为空时整条链断掉。
5. **注释声称「取自源码」但其实没有**。
6. **离线全绿、上机静默失效** —— 这是前五类的共同结局。
   **404 条测试证明的是「代码符合我对 API 的理解」，不是「屏幕上是对的」。**
   这个理解在开发过程中被证伪过至少 8 次。

## 五、完整记录

- [`handoff/SDD-LEDGER.md`](handoff/SDD-LEDGER.md) —— 1000+ 行执行账本，
  每一条裁决、携带项、教训都在里面。**压缩上下文后靠它和 `git log` 恢复现场。**
- `handoff/task-*-report.md` —— 每个任务与每轮修复的完整报告
- [`DESIGN.md`](DESIGN.md) / [`IMPLEMENTATION-PLAN.md`](IMPLEMENTATION-PLAN.md) /
  [`ASSET-NOTES.md`](ASSET-NOTES.md)
