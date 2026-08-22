# 本地环境实测（2026-08-23）

> `HANDOFF.md` §1 列的是「本地**要装**什么」。这份是「本地**实际装了**什么」——逐条实测，
> 不是从 VPS 那份 `V2-ASSET-SURVEY.md` 推断的。两台机器的装机集合**不一样**，
> 直接照搬 VPS 结论会错。

机器：Windows 11 / Foundry **v14.366.0**（`C:\Program Files\Foundry Virtual Tabletop\resources\app`）
数据目录：`C:\Users\Taka\AppData\Local\FoundryVTT\Data`（276 个模组，含本模组的符号链接）
Node v24.13.0 / npm 11.6.2

---

## 一、V1 硬依赖：全部到位

| 模组 | 本地版本 | 体积 | 状态 |
| --- | --- | --- | --- |
| `sequencer` | 4.2.3 | 8 MB | ✅ |
| `jb2a_patreon` | 0.9.0 | 9859 MB / 11701 webm | ✅ |
| `eskie-effects` | 1.7.0 | 1238 MB / 3242 webm | ✅ |
| `blfx-assets-pack01` | **1.0.16** | 1526 MB / 1257 webm + **508 ogg** | ✅ |
| `boss-loot-assets-premium` | **3.3.5** | 6 MB | ✅ 远超 blfx 注册所需的 > 3.0 |
| `psfx-patreon` | 0.14.0 | 83 MB / 1199 ogg | ✅ |
| Crucible 系统 | **0.10.2** | — | ✅ 与开发时同版本，53 个 ogg 齐 |

**V1 的 53 条 DB 路径全部解析成功，展开出的 143 个文件在本地磁盘上一个不缺。**
这条是 `HANDOFF.md` §1.1 明确要求「必须显式测、不能靠观察」的那一项，已了结。

验证方法：`tools/extract-db.mjs` 离线重建 Sequencer DB → 逐条下钻 → 对每个文件 `existsSync`。

---

## 二、与 VPS 的差异（照搬 VPS 结论会错的地方）

| 命名空间 | VPS 叶子 | 本地叶子 | 说明 |
| --- | --- | --- | --- |
| `jb2a` | 10060 | **10038** | VPS 多的 22 条来自 `JB2A_DnD5e`（免费版），本地没装 |
| `jb2a-extras` | 135 | **135** | 补装于 2026-08-23（v0.0.2 / 105 MB / 135 webm）。V1 代码零引用，装它是为了让本地重生成的索引与守卫对齐 |
| `eskie` | 3236 | 3236 | 一致 |
| `blfx` | 1412 | **1789** | 本地 blfx 版本更新，**多 377 条**（音效树从 259 涨到 503） |
| `psfx` | 930 | 930 | 一致 |
| `animated-spell-effects-cartoon` | 724 | 724 | 一致 |

### 完整装机清单（枚举得来，不是按名单查）

> **这份表订正了本文档的初版。** 初版只核了我自己列的模组名，漏掉了 6 个——
> 正确做法是枚举 `modules/` 下全部 276 个目录再按媒体文件数筛。同类错误要避免。

凡 webm 或音频 ≥ 20 个的模组（按体积降序）：

| 模组 | 体积 | webm | 音频 | Sequencer DB |
| --- | --- | --- | --- | --- |
| `jb2a_patreon` | 9859 MB | 11701 | 0 | ✅ `jb2a` |
| `ember` | 3444 MB | 0 | 2058 | — |
| `pf2e-season-of-ghosts` | 2038 MB | 2 | 134 | — |
| `blfx-assets-pack01` | 1526 MB | 1257 | **509** | ✅ `blfx` |
| `eskie-effects` | 1238 MB | 3242 | 0 | ✅ `eskie` |
| `pf2e-claws-of-the-tyrant` | 876 MB | 0 | 107 | — |
| **`jaamod`** | 602 MB | **520** | 0 | ✅ `jaamod` |
| `pf2e-abomination-vaults` | 550 MB | 0 | 112 | — |
| **`boss-loot-adventures-premium`** | 249 MB | **160** | 0 | — 裸路径，**侦察报告完全没提过这个库** |
| `animated-spell-effects-cartoon` | 234 MB | 845 | 151 | ✅ |
| `soundfxlibrary` | 219 MB | 0 | 167 | ⚠️ 注册失败（依赖未装的 SoundBoard） |
| **`ggg`** | 214 MB | 0 | **3040** | ✅ `ggg-sfx` / `ggg-vfx` |
| `psfx-ambience` | 131 MB | 0 | 35 | ✅（排除） |
| `jb2a-extras` | 105 MB | 135 | 0 | ✅ |
| `psfx-patreon` | 83 MB | 0 | 1199 | ✅ `psfx` |
| **`psfx`（免费版）** | 29 MB | 0 | **420** | ⚠️ **也注册 `psfx`，见下** |
| `cinematic-cut-ins` | 18 MB | 0 | 21 | — |

另有编排类模组（零素材，但有现成的映射表可挖，见 `V2-PLAN.md`）：
`trigger-animations` 0.8.6 / `trigger-engine` 1.30.0 / `pf2e-trigger-animations-trove` 0.10.3 /
`pf2e-trigger-trove` 2.3.2。

本地**没有**的（VPS 有）：`JB2A_DnD5e`、`pf2e-graphics`、`pf2e-creature-sounds`、`Kinemancer`、
`boss-loot-assets-free`、`animated-token-rings/shields`。

**`JB2A_DnD5e` 不装是有意的**：它一旦启用就会反向覆盖 patreon 的路径解析。

`assets/MGS` 已于 2026-08-23 补装（18.3 G / 4002 音频，其中 `ogg/SFX` **2263 条 / 638 MB**
是唯一有用的部分；`Ambiences` 13.9 G + `Music` 3.8 G 明确不用）。

### ⚠️ `psfx` 命名空间冲突 —— 本机活着的一个坑

免费版与付费版**都注册命名空间 `psfx`，都挂在 `sequencer.ready` 钩子，两边都没有让位守卫**：

- `psfx/scripts/init.js:46` → `registerEntries(MODULE_NAME, …)`，`MODULE_NAME = "psfx"`
- `psfx-patreon/scripts/init.js:32` → `registerEntries("psfx", …)`（硬编码）

Sequencer 4.2.3 的 `registerEntries`（`sequencer.js:6636`）在 `override=false`（两边都是默认）
下走 `mergeObject`——**后注册的覆盖先注册的**，并弹一条可见警告：
`module "psfx" has already been registered to the database! Do you have two similar modules active?`

两版 ogg 文件名交集 **393**，免费版独有仅 **26**。而免费版的 `psfx_sequencer.js` 里
`ranged-weapons` 出现 16 次——**V1 唯一那条音效路径 `psfx.ranged-weapons.longbow.v1.30ft`
正好落在冲突区**，现在到底解析到哪一边取决于模组加载顺序。

**建议禁用免费版 `psfx`**（净增 26 条，不值这个风险）。这与 `JB2A_DnD5e` 是同一类问题，
区别是那个本地没装、这个装了。

### Crucible 素材的许可

`systems/crucible/LICENSE` 写的是「只允许在 Foundry 内安装和使用本系统；暂不授权修改、
发布、分发、销售或以其他方式使用本软件及其数据」，并注明**playtest 结束后会换成更开放的许可**。

本模组只写路径字符串、不拷贝任何文件，且是自用——引用那 53 个 ogg 不构成分发。
但这条许可比一般素材库严，**将来若要公开发布模组需重新评估**。记在这里免得以后再查。

### 两条因此翻转的结论

1. **`V2-ASSET-SURVEY.md` §5.2-2 的 JB2A 路径漂移风险，在本地不存在。**
   本地没装 `JB2A_DnD5e`，`jb2a.*` 稳定解析到 `jb2a_patreon`。P2-1 那条待办本地免费达成。
2. **§5.3 里 blfx 那条死链是 Linux 专属**（`_Orange_` vs `_ORANGE_` 大小写）。
   本地实测 blfx 全库 1789 条、psfx 1135 条，**零死链**。

---

## 三、代码可移植性（已修）

原仓库把 VPS 路径写死在 6 处，本地跑测试会以 ENOENT 红 21 条——那不是上游漂移，是环境噪声。

新增 `tools/paths.mjs`：环境变量 → 平台候选表 → 抛错（**刻意不做「找不到就 skip」**，
静默跳过等于在没装 Foundry 的机器上全绿，正是本项目反复栽过的「守卫比以为的弱」）。

```
CRUCIBLE_ANIM_DATA   Foundry 用户数据目录
CRUCIBLE_ANIM_CORE   Foundry 客户端源码目录（也接受装机根目录）
```

顺带修的两处 Windows 专属问题：

- `tools/extract-db.mjs`：动态 `import()` 传裸绝对路径在 Windows 下不是合法 ESM 说明符，改走 `pathToFileURL`。
- `test/native-boundary.test.mjs`：冻结表的键是相对路径，Windows 下分隔符是 `\`，归一成 `/`。
  **已做变异验证**：把 Crucible 源码里 `configureLandingVFXEffect(this) ?? vfxConfig` 改成
  去掉 `?? vfxConfig`，守卫变红；还原后变绿。

**结果：404/404 全绿。** 与 VPS 上的数字一致。

---

## 三点五、选材工具链（ffmpeg）—— 零安装解锁

整套选材方法学（联系表读图、逐帧 alpha 采样、残留主色 CIEDE2000）依赖 ffmpeg，
而且**必须是带 `libvpx` / `libvpx-vp9` 的构建**：主力库的 alpha 存在 Matroska 的
BlockAdditional 里，默认原生解码器不解这个平面，据此做的判断全错。

本机 PATH 上没有 ffmpeg，但 `%LOCALAPPDATA%\oopz\ffmpeg.exe` 有一份随某应用安装的
2022 年 gyan.dev 构建，`-decoders` 实测同时列出 `libvpx` 与 `libvpx-vp9`，够用。
**没有 ffprobe。**

全仓用到 ffprobe 的地方只取 codec / 宽 / 高 / 帧数四样，`ffmpeg -i` 的 stderr 全都有，
所以新增 `tools/media.mjs` 做定位 + 无 ffprobe 的等价探针，三个工具统一走它：

| 工具 | 改动 |
| --- | --- |
| `tools/contact-sheet.sh` | 自己定位 ffmpeg（bash 用不了 .mjs）；`probe_codec` / `probe_frames` 两个函数在无 ffprobe 时回退到解析 `ffmpeg -i`。**注意 `head` 会让上游吃 SIGPIPE，`set -euo pipefail` 下必须给管道补 `\|\| true`**，否则脚本静默退出、连错误都不打 |
| `tools/element-residual-colour.mjs` | 改用 `probeVideo()` + `alphaDecoder()` |
| `tools/persist-occlusion.mjs` | 同上 |

```
CRUCIBLE_ANIM_FFMPEG    ffmpeg 可执行文件（必需）
CRUCIBLE_ANIM_FFPROBE   ffprobe（可选，没有就走 ffmpeg 回退）
```

**实测通过**：

- `contact-sheet.sh` 对 `jb2a.impact.013` 与 `eskie.damage.fire.01.orange` 出图正常，
  alpha 正确合成到 0x303030 底色，能直接读出相位结构（后者 f0 空帧 / f1-4 生长 /
  **f5 自带白色闪爆** / f6-14 衰减，与 ASSET-NOTES 的记录一致）
- `element-residual-colour.mjs --from 7` 实测：fire `rgb=[246.3,176.6,58.4]`、
  cold `rgb=[172.4,232.4,252.1]`，与 `armory-element-distinct` 守卫用的量级对得上

**alpha 判据在本地复现**：`jb2a` 的 webm `ffmpeg -i` 报 `pix_fmt yuv420p` 但
`alpha_mode : 1`——正是侦察报告说的假阴性陷阱。`media.mjs` 的 `probeVideo().alpha`
按 `alpha_mode` 判，不看 pix_fmt。

---

## 四、部署

```
Data\modules\crucible-anim  ->  C:\Users\Taka\Desktop\fvtt\crucible-anim   （符号链接）
```

与本机 `ember-crucible-tempfix` 的做法一致。`module.json` 的 `compatibility.verified` 是 14.366，
与本地 Foundry 版本正好对上。

---

## 五、音效层的本地实测数据

本机无 `ffprobe`，改用纯 Node 解 Ogg/Vorbis 头（identification header 取采样率，
末页 granule position ÷ 采样率取时长）。

| 库 | 条数 | 采样率 | 时长中位 | ≥10s 占比 |
| --- | --- | --- | --- | --- |
| `ggg` | 3040 | **192000 Hz × 3040（全库）** | 1.53s | 1.3% |
| `psfx-patreon` | 1199 | 44100×1041 / 48000×158 | 4.50s | 9.3% |
| `blfx.sound` | 508 | 48000×507 / 44100×1 | **1.64s** | **0%** |
| `animated-spell-effects-cartoon` | 151 | 44100×83 / 48000×68 | 1.50s | 2.6% |
| Crucible 系统自带 | 53 | 44100×37 / **96000×16** | 1.56s | 3.8% |

两条订正：

**(1) ggg 的 192kHz 独立复现了**——VPS 侦察抽样 8 个，本地是全量 3040 个，
用的还是另一套方法（不是 ffprobe）。这条成立。

**(2) 但 `V2-ASSET-SURVEY.md` 对它的风险推算（「PCM 缓冲 4.35 倍」）不成立。** 依据是本地
Foundry v14.366 的源码，不是推断：

- `sequencer.js` 走的是 `foundry.audio.Sound`（dist 里唯一一处音频入口）
- `client/audio/sound.mjs:942` → `this.#context.decodeAudioData(arrayBuffer)`
- `client/audio/helper.mjs:653` → 三个通道都是 `new AudioContext()`，**不带 sampleRate 参数**，
  取设备默认（通常 48kHz）
- Web Audio 规范规定 `decodeAudioData` 把结果**重采样到 AudioContext 的采样率** ——
  所以 192kHz 的源文件解出来是 48kHz 的 buffer，不是 192kHz
- `client/audio/cache.mjs:92` 算的正是解码后的 buffer：
  `size = buffer.length * buffer.numberOfChannels * 4`
- 而且 `AudioBufferCache` 是 **LRU + 1GB 硬上限**（`helper.mjs:59`），到顶自动淘汰，不是无界泄漏

即：192kHz 的实际代价是**解码 CPU** 和磁盘体积，不是常驻内存的 4.35 倍。
中位 1.53s 立体声一条约 0.59 MB（按 48k 算），不是 2.35 MB。

⚠️ **离线只能推到这里。** 剩下两点必须上机验（一行）：

```js
// 1. 本机 AudioContext 实际采样率
game.audio.environment.sampleRate

// 2. 192kHz 源解出来到底是多少 —— 直接证伪或证实上面整条推理
const r = await fetch(encodeURI("modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Dark_Hit 1.ogg"));
const b = await game.audio.environment.decodeAudioData(await r.arrayBuffer());
console.log(b.sampleRate, b.duration, (b.length * b.numberOfChannels * 4 / 1048576).toFixed(2) + " MB");
```

如果 `b.sampleRate` 报 192000，上面整段推翻，回到侦察报告的重采样方案。

---

## 六、待办与已裁定

### 已裁定（2026-08-23）

1. **`data/asset-index.json` 改用本地重生成的版本。** 补装 `jb2a-extras` 后重跑
   `npm run index`，六个命名空间齐备，404/404 全绿。当前索引：
   jb2a 10038 / jb2a-extras 135 / eskie 3236 / blfx 1789 / psfx 930 / cartoon 724。
   `index.failed` 只剩 `JB2A_DnD5e: 模组未安装`——这是**有意为之**，不是缺陷。
2. **全库死链复验**：19,124 条可寻址条目，死链 **5** 条（0.026%）——
   eskie 2（`crosshair.circle.generic_01.red.full.radius_60ft`、`slice.01_ranged.color.blue.60ft`）、
   cartoon 3（`earth.debris.02`、`fire.65`、`mix.electricity`）。
   jb2a / jb2a-extras / blfx / psfx 全部为 0。比 `V2-ASSET-SURVEY.md` 记的少一半，
   因为本地 eskie 1.7.0 已修掉其中 8 条。写兵库规则时只需挡这 5 条。
3. **58 项上机验收全部推迟到 V2 一起做**（owner 裁定）。

### 未决

1. `HANDOFF.md` §2 的裁剪名单（35 + 8 个动作）仍未执行。V2 会连同新轴一起重新评估——
   届时 `generic.cast` / `generic.impact` 兜底命中率会因为新轴接入而大幅下降，
   现在这份名单的判据可能要重算。
2. `Data/modules/module-0.9.0.zip` 是 **9.96 GB** 的 jb2a_patreon 安装包残留，
   同名内容已解压在旁边。可删。
