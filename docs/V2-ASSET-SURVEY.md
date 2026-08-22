# crucible-anim V2 选材侦察报告

> 侦察日期：2026-08（九组侦察员并行扫描 + 合成阶段抽样复核）
> 扫描范围：`/root/fvtt14-data/Data/modules/`（534 个模组）与 `/root/fvtt14-data/Data/assets/`（35G 散装素材）
> 本报告是 **选材侦察**，不是实现方案。所有数字均来自实际 `find` / `ffprobe` / `node import` 核实，
> 凡属推断或未核实的，一律标注「需复核」。

---

## 0. 一句话结论

**视觉层不缺素材，缺的是开发度；音效层不缺素材，缺的是从零到一。**

- 本机在 Sequencer 数据库里注册的动画 webm 共 **19,819 个**（8 个模组），V1 只用了 **79 个（0.4%）**。
- 本机可用的短促战斗音效共约 **10,600 条**（8 个来源），V1 用了 **1 条**。
- V2 的第一优先级毫无争议：**音效层**。而且不需要下载任何东西——素材全在盘上。

---

## 1. 总表（按对本项目的价值排序，不是按体积）

| # | 库 | 类型 | 本地完整 | 规模 | Sequencer 命名空间 | 一句话定位 |
|---|---|---|---|---|---|---|
| 1 | **psfx-patreon** | 音效 | ✅ 完整 | 1199 ogg / 84M / 930 DB 键 | `psfx` | 唯一与 JB2A 同生态的音效库，ft 距离档与 jb2a 逐帧对齐；309 条真人咒语吟唱本机独一份 |
| 2 | **ggg** | 音效(+微量VFX) | ✅ 完整 | 3040 ogg / 213M / 3049 DB 叶 | `ggg-sfx` `ggg-vfx` | 规模最大、语义分层最贴 cue 模型的战斗音效库；**但采样率 192kHz，有内存隐患** |
| 3 | **assets/MGS** | 音效 | ✅ 完整 | 2263 条 SFX（另 1739 BGM/环境）/ 18G | 无（裸路径） | 唯一提供**完整伤害类型矩阵**的库，13 种伤害类型 × 3 变体 |
| 4 | **jb2a_patreon** | 动画 | ✅ 完整 | 11700 webm / 9.7G / 10038 DB 键 | `jb2a` | 风格基线。V1 只碰了 210 个顶级 key 里的 19 个 |
| 5 | **eskie-effects** | 动画 | ✅ 完整 | 3242 webm / 1.3G / 3236 DB 键 | `eskie` | 近战挥砍正交矩阵（伤害类型×重量×速度）+ d20 检定动画 + 持续伤口层，jb2a 全无 |
| 6 | **pf2e-graphics** | 音效(+11 精灵表) | ✅ 完整 | 1834 ogg / 178M | `graphics-sfx` `graphics-vfx` | 44.1kHz 的干净音源，可规避 ggg 的采样率问题；**但系统门禁使其在 Crucible 下不注册** |
| 7 | **blfx-assets-pack01** | 动画+音效 | ✅ 完整 | 1124 webm + 259 ogg / 1.4G / 1412 DB 键 | `blfx` | 唯一「视听同源同命名空间」的库，音画冲击点天然对齐 |
| 8 | **pf2e-creature-sounds** | 音效 | ✅ 完整 | 1971 m4a / 61M / 106 音组 | 无（裸路径） | 106 个生物类型 × attack/hurt/death 三态，补「谁在挨打」这一维度 |
| 9 | **jaamod** | 动画 | ⚠️ 部分缺 | 520 webm / 602M / 483 DB 键 | `jaamod` | 34 个具名 token 状态循环 + 27 条陷阱，都是 jb2a 的空白功能位；**condition.rings 整支 38 条死链** |
| 10 | **soundfxlibrary** | 音效 | ✅ 完整 | 167 mp3 / 219M（战斗仅 54 条） | 无（裸路径） | 规模小但命中率高；**Melee Miss / Shield Hit 是别处找不到的判定结果音** |
| 11 | **animated-spell-effects-cartoon** | 动画+音效 | ✅ 完整 | 845 webm + 151 ogg / 234M / 724 DB 键 | `animated-spell-effects-cartoon` | 视觉风格与本项目冲突；但 151 条 ogg 未进 DB，是「白捡」的音效 |
| 12 | **jb2a-extras** | 动画 | ✅ 完整 | 135 webm / 105M / 135 DB 键 | `jb2a-extras` | 128 条 Pathfinder 七宗罪符文（8 图案 × 8 色 × complete/loop），patreon 无对应物 |
| 13 | **assets/TV PROPS Essentials**（Kinemancer） | 动画 | ✅ 完整 | 1088 webm / 354M | 无（裸路径） | 持续型光环/法阵/元素球质感，jb2a 给不了；但慢速氛围循环，不适合瞬发打击 |
| 14 | **animated-shields-by-mattm** | 动画 | ✅ 完整 | 40 webm / 136M | 无 | 8 种护盾造型 × 5 配色；**全部无 alpha，深色地图会露黑底** |
| 15 | **animated-token-rings-by-mattm** | 动画 | ✅ 完整 | 111 webm / 300M | 无 | 37 种 token 光环 × 3 尺寸；**全部无 alpha** |
| 16 | **assets/Horror / Chaos / Weather** | 动画 | ✅ 完整 | 238 webm / 274M | 无 | 1920×1080 全屏叠加层。Chaos 的 Electricity 4 档×5 色、Horror 的 Dying×5 色可做「玩家视角状态层」 |
| 17 | **assets/FV_CREATURES_Dnd_Beasts_1** | 动画+内嵌音 | ✅ 完整 | 18 webm / 223M | 无 | 6 个怪物的 idle/death/reveal 三态，**自带 opus 音轨**，全 assets 唯一音画一体 |
| 18 | **assets/pokemon_stadium** | 音效 | ✅ 完整 | 320 mp3 / 40M | 无 | 已按 crit/hit/miss/ko/resist/status 分好目录的英文解说；梗向可选层 |
| 19 | **cinematic-cut-ins** | 音效 | ✅ 完整 | 21 mp3 / 18M | 无 | 演出型 stinger（登场/终结技），非打击音 |
| 20 | **JB2A_DnD5e** | 动画 | ✅ 完整 | 2117 webm / 1.6G / 1687 DB 键 | `jb2a`（与 patreon 共用） | **素材净值≈0（2100/2117 是 patreon 子集），但会翻转 jb2a 路径解析** |
| 21 | **boss-loot-assets-free** | 动画+音效 | ✅ 完整 | 136 webm + 10 ogg / 98M | `blfx`（pack01 激活时不注册） | pack01 的真子集，96M 纯重复占盘 |
| 22 | **boss-loot-assets-premium** | 引擎 | ✅（本就无素材） | 1 webm / 5M | 不注册 | **不是素材包是引擎包**，但它是 blfx 1412 条素材的硬性前置 |
| 23 | **sequencer** | 引擎 | ✅（本就无素材） | 69 个 demo 文件 / 7M | 不注册 | 只有 128px 火焰 demo。价值 100% 在 API（v4.2.3 空间音频、softFail、syncGroup） |
| 24 | ember | 音效 | ✅ 完整 | 2058 ogg / 3443M | 无 | **84% 是音乐**。战斗 SFX ≈ 0，仅 ~40 条 magic/metal/crystal one-shot 边缘可用 |
| 25 | psfx-ambience | 音效 | ✅ 完整 | 35 ogg / 131M | `psfx-ambience` | 全部 ≥16s 长循环环境床。**排除** |
| 26 | psfx-music | 音乐 | ✅ 完整 | 11 ogg / 43M | 无（仅 Playlist） | 最短 200 秒的 BGM，无 Sequencer 集成。**排除** |
| 27 | wise-gaming-premium-pack-242 | 音效 | ✅ 完整 | 去重约 80 条 / 2.1G | 无 | 约 10 条战斗音（puncture-flesh / sword-stab 音色独特）；**整个 Mod_Assets 在盘上存了两份** |
| 28 | michaelghelfi / TabletopAudio / james / 各 AP 冒险包 | — | ✅ | 见第 5 节 | 无 | 全部 BGM / 环境 / 地图背景。**排除** |
| 29 | tabletop-rpg-music-patreon / moulinette-soundboards | — | ❌ 空壳 | 本地零音频 | 无 | 靠外部 URL 串流，本地无文件 |
| 30 | dicemega / dice-vfx | — | ✅ | 598M / 14M | 无 | 3D 骰子模型与骰子拖尾贴图，与本项目无关 |

**合计**：有实际素材价值的库 **28 个**（另 2 个空壳、若干排除项）。其中**动画库 13 个**、**音效库 12 个**、**兼具两者 3 个**（blfx-assets-pack01 / animated-spell-effects-cartoon / boss-loot-assets-free）。

---

## 2. 动画库

### 2.1 V1 的开发度：0.4%

| 库 | V1 用到的 DB 路径 | 文件数 | 库内总量 | 开发度 |
|---|---|---|---|---|
| jb2a_patreon | 39 | 55 | 10038 键 / 11700 webm | 0.47% |
| eskie-effects | 12 | 22 | 3236 键 / 3242 webm | 0.68% |
| blfx-assets-pack01 | 5 | 2 | 1412 键 / 1124 webm | 0.18% |
| psfx-patreon | 1（音效） | 1 | 930 键 / 1199 ogg | 0.08% |
| **合计** | **53** | **79 + 1 音效** | **19,819 webm（8 个已注册库）** | **0.4%** |

> 数法：`grep -rhoE '"(jb2a\|eskie\|blfx\|psfx)\.[A-Za-z0-9_.-]+"' scripts/ \| sort -u` → 53 条唯一 DB 路径。
> 文件数取自任务书给出的 V1 统计（一条 DB 路径可能展开成多个颜色分支文件）。
> 「19,819」= jb2a_patreon 11700 + JB2A_DnD5e 2117 + eskie 3242 + blfx 1124 + cartoon 845 + jaamod 520 + jb2a-extras 135 + boss-loot-free 136。

另有 **5 个未注册进任何 Sequencer DB 的动画来源**（合计约 1,500 个 webm）完全未被触及：
assets/TV PROPS Essentials 1088、assets/Horror 139、animated-token-rings 111、assets/Chaos 64、animated-shields 40。

### 2.2 jb2a_patreon 自己就还剩 91% 没挖

V1 用了 210 个顶级 key 里的 19 个：
`aura_themed / breath_weapons / cast_generic / energy_field / extras(TMFX) / healing_generic / impact / liquid / magic_missile / magic_signs / markers / melee_attack / on_token_buff / ranged / shield / static_electricity / teleport / ui / unarmed_strike`

**191 个 key 完全没碰**，其中对 Crucible 最对口的：

| 未用 key | 条目数 | 为什么对 Crucible 有用 |
|---|---|---|
| `Generic/Weapon_Attacks` 的 arrow / bolt | 165 / 160 | 各含 **cold/fire/lightning/physical/poison 五种伤害类型 × 7 色 × 5 距离档**——这是全库最贴合 Crucible 伤害类型分派的一族 |
| `2nd_Level/Spiritual_Weapon` | 255 | **25 种具体武器 × 6 主题 × 颜色**，key 形如 `spiritual_weapon.club.01.astral.01.blue`。唯一能按武器种类精确匹配 Crucible 装备栏的素材 |
| `Generic/Template` | 1723 | `template_circle` 1101（含 aura/lightning/out_pulse/radar/smoke/symbol/vortex/whirl 八分支）、**`template_cone_PF2e` 29**、`template_line` 60、`template_square` 118、齐射 volley 261 |
| `Generic/Conditions` | 216 | `condition.boon` / `condition.curse` 两支，正好对应 Crucible 的 buff/debuff 图标层 |
| `Generic/RangedSpell` | 931 | `ranged_missile` 378 **带 cast/hit/missile_only 三段拆分**，与 crucible-anim 的 cast/travel/impact 槽位天然对齐 |
| `Generic/Energy` | 527 | energy_strands 264 带 range 分距、energy_beam 116 normal/reverse、energy_wall 60 |
| `Generic/Token_Stage` / `Token_Border` | 135 / 117 | hex/round/square 底座与描边，做目标指示 |
| `Generic/Traps` | 145 | spike_trap 117 按 05×05/10×05/10×10ft 分档 **+ endframe 静帧** |
| `2nd_Level/Scorching_Ray` | 305 | 带 loop 段的持续射线，适合持续伤害/引导类动作 |
| 按武器名注册的近战 key | — | sword/greatsword/dagger/spear/hammer/mace/glaive/quarterstaff/falchion/scimitar/halberd/club/warhammer/maul/greatclub/handaxe/javelin/rapier/greataxe，各带 melee/throw/return 分支 |

另有 **173 条 DB 条目直接指向 webp 静态帧**（falling_rocks 40、template_circle 36、zoning 29、spike_trap 27、on_token_cast 18、braziers 13…）——这是持久化「残留痕迹」的现成素材，不需要自己截帧。

**还有一份被低估的工具文件**：`modules/jb2a_patreon/scripts/effects.js`（260K，免费版没有），是给 Automated Animations 用的扁平预设列表，**含每个素材的 scale / anchor / angle 默认值**。V2 要抄某个素材的默认缩放锚点，这是现成答案。

### 2.3 「jb2a 给不了什么」——按库分

**eskie-effects（V1 只碰了 28 个类目里的 7 个，21 个类目零使用）**

1. **近战挥砍正交矩阵**：`attack.melee.generic.01 × {bludgeoning|piercing|slashing} × {light|medium|heavy} × 8 色 × {fast|normal|slow} × 3 变体` = **1250 个文件，V1 一个没用**。jb2a 的近战是按具体武器名走的，**没有「伤害类型 × 重量」这个正交度**。Crucible 的武器恰好有这两个属性。
2. **`ui.ability_check.d20`（90 文件）**：d20 骰面动画，分 roll/static，面值含 pass/fail/skull/star + 六大属性。crucible-anim 是聊天卡驱动，检定成败的视觉反馈可以直接用。
3. **Slice(141) + Wounds(20) + Texture_Mask(42)**：命中后在 token 上留伤痕的整套素材。**jb2a 基本没有持续性伤口层。**
4. **`colorless` 分支**：可以自己 tint，不必为 Crucible 每种元素单独选色。
5. 未用大类：objects 398（chain/rope/grappling_hook/meat_hook，擒抱拉拽）、crosshair 196（目标指示器）、screen_overlay 24（cinema_bars/speed_lines，暴击特写）。
6. 「用过」的 7 类里也只擦了边：`damage` 14 种伤害类型只用了 8 种，**`critical` 的 01/02/03 三个变体没用**——那是现成的暴击反馈。

**blfx-assets-pack01**

- `misc.enchantment.1~22` 一族在 jb2a 里没有对应物——套在武器/角色身上的附魔态叠加层（blades_clash / heart_beat / hunters_mark / barkskin / see_invisibility…），多数带 color1-color7。
- `condition.frightened1.dread.fear.skull.loop.{green,grey,purple,red}` 四色骷髅循环。
- `07-steampunk`（3 条齿轮蒸汽朋克）——jb2a 完全没有这个题材。
- **帧率一致性**：1120/1124 严格 30fps。而 `docs/ASSET-NOTES.md` 记录 jb2a/eskie 那边 71 条视觉记录里 **54% 不是整 30fps**（24fps 24 条、29.97 12 条、25fps 1 条、60fps 1 条），每条都要单独量帧。blfx 可以按 30fps 统一换算，大幅降低时序标注成本。
- **画幅基准差异**：blfx 主力 1200×1200，jb2a 常见 400×400，eskie 800×800。厂商自己的代码就在做归一化——`boss-loot-assets-premium/scripts/macros/weapon/weaponMacros.js` 里 `getAnimationSize()` 对 blfx 返回 0.5、对 jb2a 返回 1.0。

**jaamod**（低分辨率老库，但占了两个功能位）

- `jaamod.condition`：**34 个具名状态的 token 循环动画**（asleep/blessed/blinded/burning/charmed/concentration/cursed/deafened/diseased/exhaustion.level1-6/fire_shield/flying/frightened/frozen/grappled/hexed/incapacitated/invisible/paralyzed/petrified/poisoned/prone/raging/restrained/stunned/unconscious…）。**这是 jb2a 最缺的一层。** 分辨率只有 512×512，但贴 token 时本来只占一格，掉档不明显。
- `jaamod.traps`（27 条）：bear_trap / blade_trap / bolt_trap / pit_trap 4 变体 / saw_blade / spikes_trap / lever 系列 6 个。Abomination Vaults 那种地城陷阱，jb2a 和 eskie 都没有。
- `sequencer_fx_master`（43 条）：作者专为 Sequencer 调过的 **boom[8] 随机爆炸数组、blood_splat 5 色**，数组叶子省了自己写随机池。
- `breath_weapon`（6 条）：**形状已烘进素材**（30×5_line 三条、15_cone 三条），配 Crucible 的锥形/线形 AoE 可直接用，不用 stretchTo。

**jb2a-extras**：`jb2a-extras.magic_signs.rune.03.{complete,loop}.<01-08>.<8色>` 共 128 条。patreon 的 `magic_signs.rune` 只有 `02` 和八大学派，**没有 `03` 这一族**，是纯增量。8 个图案 × 8 色 × complete/loop 两态，天然适合做「按伤害类型上色的持久符文标记」。

**animated-spell-effects-cartoon**：视觉上不建议接入主线（硬边平涂赛璐璐，与 Crucible 原生的暗沉写实和 jb2a 的柔光粒子都打架）。可挑的只有三样：16 个 conditions 状态循环、cantrips 的「5 色 × 4 距离」预切条带、以及**未进 DB 的 sparks 目录 80 个文件**（风格中性，卡通味最淡）。

**Kinemancer / assets 目录的裸素材**：提供的是 jb2a 给不了的「实拍质感持续氛围」——`aura`×4 色、`ritual_circle` 四种风格、`portal`/`portal_[energy]`、`magic_sphere_[fire/leaves/stone/wind]`、`fire_breath`×4 色（含 black）、`smoke_bomb`×6 色。强弱档位 `[+] / [-] / [area]` 天然对应「效果强度分级」。但**全是慢速循环，不适合做一次挥砍的瞬发层**。

---

## 3. 音效库（V2 的主战场）

### 3.1 现状与可用总量

V1：**1818 条 cue，音效 0 条**；兵库里只有一条音效规则，引用 1 个 psfx 文件。

本机可用的**短促战斗 SFX** 总量（已排除 BGM、≥10s 环境循环、乐器演奏、UI 提示音）：

| 来源 | 战斗可用条数 | 格式 | 采样率 | 已注册 DB |
|---|---|---|---|---|
| ggg | 3040（全部） | ogg | **192000 Hz ⚠️** | ✅ `ggg-sfx` |
| assets/MGS | 2263（SFX 树全部） | ogg | 48000 Hz | ❌ 裸路径 |
| pf2e-creature-sounds | 1971（全部） | **m4a/AAC** | 44100 Hz | ❌ 裸路径 |
| pf2e-graphics | 1834（全部） | ogg | 44100 Hz | ⚠️ 系统门禁，Crucible 下不注册 |
| psfx-patreon | 1022（1199 减去 doors 60 / 乐器 112 / ambient 5） | ogg | 44100 Hz | ✅ `psfx` |
| blfx-assets-pack01 | 约 229（259 减去乐器约 30） | ogg | 48000 Hz | ✅ `blfx.sound.*` |
| animated-spell-effects-cartoon | 151 | ogg | — | ❌ **未进 DB** |
| soundfxlibrary | 54（Combat/Single） | mp3 | 44100 Hz | ❌ 裸路径 |
| **合计** | **约 10,564 条** | | | |

**结论：不需要下载任何东西。V2 音效层的素材问题已经解决，剩下的全是选型与映射工作。**

### 3.2 psfx 三件套（兵库规则要按这个结构选材）

三个模组同前缀但**性质完全不同**，命名空间也不同，不要混为一谈：

| 模组 | 命名空间 | 文件 | 性质 | 对本项目 |
|---|---|---|---|---|
| psfx-patreon | **`psfx`**（硬编码，不是 `psfx-patreon`） | 1199 ogg | 战斗 SFX | ★ 主力 |
| psfx-ambience | `psfx-ambience`（= MODULE_NAME） | 35 ogg | 环境长循环（16s–600s，中位 300s） | 排除 |
| psfx-music | 无（只有 Playlist compendium，**无 esmodules、无 scripts 目录**） | 11 ogg | BGM（200s–327s） | 排除，可考虑禁用省 43M |

> ⚠️ 命名空间陷阱：`psfx-patreon` 注册的是 `psfx`（`init.js` 里的硬编码字符串），
> `psfx-ambience` 注册的是模组 id 本身。两个库都有 `ambient` 顶层键，前缀写错就查不到。

#### psfx-patreon 完整分类结构（20 个顶层，930 DB 键 / 1135 条已注册文件引用）

| 顶层分类 | ogg 数 | 结构与变体维度 |
|---|---|---|
| `incantations` | 309 | `<masculine\|feminine>.<001\|002>.<reverb\|dry\|demonic>.<harm\|help\|summon>.<001..010>`——3 演员 × 3 处理 × 3 意图 × 6-10 take |
| `musical-instruments` | 112 | lute/violin/flute/bagpipes × 奏法 × 调性 × 7 和弦 + drum.01.001-007。**非战斗，排除** |
| `cantrips` | 110 | 16 个 5e 戏法名（fire-bolt / ray-of-frost / eldritch-blast…），部分带 v1/v2 与 ft 档 |
| `1st-level-spells` | 93 | entangle/burning-hands/arms-of-hadar/cure-wounds/magic-missile/bless/shield-spell/sleep/detect-magic |
| `magic-signs` | 80 | `<circle\|rune>.v1.<8 学派>.<complete\|intro\|loop\|outro\|intro-fade>` = 2×8×5。**完整三段式** |
| `creature` | 66 | movement.footsteps.`<outdoors\|indoors>`.`<001-003>`.`<single\|sequence>`；movement.burrow 带 ft 档；flight.landing/wings 分 large/small；dragons.attacks.breath/rend × fire/cold；dragons.roar |
| `2nd-level-spells` | 65 | scorching-ray / misty-step（intro+outro+complete × 五元素）/ moonbeam |
| `weapon-swooshes` | 64 | **`<light\|heavy\|fire\|cold\|necrotic\|psychic\|lightning>.v1.group01..group06`，每组是 4 条的数组**（Sequencer 自动随机）。light/heavy 各 6 组，5 种元素各 1 组 |
| `doors` | 60 | 3 混响空间 × 5 动作 × 2 材质。**非战斗，排除** |
| `ranged-weapons` | 58 | `longbow.v1.<05\|15\|30\|60\|90>ft` 每档 5 条数组；`guns.single-fire.<revolver\|shotgun\|rifle\|musket\|energy-blaster\|energy-rifle>`；`guns.prepare.*` |
| `ranged-magic` | 51 | **`generic.missile.<only\|complete>.<001-003>.<ft>`、`generic.projectile.<ranged\|instant>`、`generic.beam.<001-003>`——不绑任何法术名，Crucible 最该用这一支** |
| `casting` | 41 | `<fire\|fire-side\|earth\|sound\|water>.001`（5 条数组）、`generic.001`、`generic.002.<001-003>`、`generic-v2.<001-003>.<01\|02>`、`on-token.<001\|002>` |
| `conditions` | 23 | **`boon.<001..020>.01`（20 条 6 秒 buff 音）** + `generic-layer.<001-003>` |
| `impacts` | 23 | `<slashing\|bludgeoning>.v1`（各 4 条数组）+ `magicaleffects.<fire\|cold\|necrotic\|psychic\|lightning>`（psychic 4、lightning 5，其余各 1）+ `magicaleffects.generic.002.<001-003>`。**没有 piercing** |
| `weapon-attacks` | 12 | `<spear\|sword>.v1`，各 6 条数组 |
| `class-features` | 11 | divine-smite.v1.001.`<caster\|target>`；bardic-inspiration × 3 调性 |
| `3rd/5th-level-spells` | 10 | fireball / call-lightning / cone-of-cold |
| `consumables` | 6 | potions-vials.`<cork-bottle\|drink-liquid>`.001-003 |
| `ambient` | 5 | firesources.fireplace 001/002、tools.saw/gears/hammer。**排除** |

**psfx 的 7 个正交变体维度**（写兵库规则时按这套选材）：

1. **距离档 `ft`**：`05ft / 15ft / 30ft / 60ft / 90ft`（固定 5 档）。出现在 longbow、magic-missile、scorching-ray、fire-bolt、ranged-magic 全系、creature.movement.burrow。
   > 已验证 ft 分档**不是简单改名**：longbow 05ft 的箭矢命中峰值在 0.5–0.75s，30ft 在 0.75–1.0s，90ft 在 1.0–1.5s——飞行时间真的烘进了波形。**这与 jb2a 的 05/15/30/60/90ft 投射物档位逐帧同构，一套距离选档代码可以同时选动画和音效。**
2. **版本号 `v1/v2/v3/v4`**：是**不同音色的重录版**，不是升级替换（fire-bolt v1/v2、bless v1/v2/v3、sleep v1..v4、casting `generic` vs `generic-v2`）。
3. **take 序号**：`001..010` / `01..05` / `-00..-07`，纯随机池。
4. **时间段落**：`intro / loop / outro / complete / intro-fade / persist-complete / fade-complete`。magic-signs、produce-flame、misty-step、entangle、moonbeam、shield-spell 都有。对应 crucible-anim 的 cast→persist→aftermath 槽位。
5. **视角/角色**：`caster` vs `target`（sacred-flame、divine-smite）。
6. **元素/学派**：swooshes 的 fire/cold/necrotic/psychic/lightning；magic-signs 的 8 学派；casting 的 fire/earth/sound/water。
7. **空间/混响**：doors 的 clean/room/hall；footsteps 的 indoors/outdoors；incantations 的 reverb/dry/demonic。

非路径维度：`group01..group06`（swoosh 音色分组）、`only` vs `complete`（只有飞行声 vs 飞行+命中一体）、`single` vs `sequence`（单步 vs 连续脚步）。

**优先取用顺序（Crucible 非 5e，按名字硬凑法术是死路）**：
`ranged-magic.generic.*`（51 条，完全不绑法术名）> `weapon-swooshes` + `impacts`（近战两拍）> `casting.*` > `magic-signs.*`（三段式）> `conditions.boon.*`（20 条一人一条）> `incantations`（人声层）。**最后才是 cantrips / N-level-spells 那些绑 5e 法术名的。**

### 3.3 ggg（规模最大，但有一个必须先解决的问题）

- **3040 个 ogg / 3049 条 DB 叶，逐条 `fs.existsSync` 校验 0 缺失。**
- 全库 Loudness Normalized 到 **-16.0 LUFS**（`assets/MODIFICATIONS.MD` 明示），音量一致性开箱即用。
- 时长（100 条抽样）：min 0.33s / p25 0.73s / **median 1.48s** / p75 2.64s / p95 6.43s / max 11.93s。全是短促 SFX，无 BGM、无长环境音。
- 键树动词：`strike / block / parry / miss / impact / cast / buff / curse / surge`——几乎与 Crucible 的动作模型一一对应。
- 11 个顶层：melee / ranged / magic / equipment / tasks / abilities / impact / actions / creatures / scifi / misc。
  - `melee.blade` 216（strike 再分 general/dagger/greatsword/karambit/katana/rapier/shortsword/bamboo；另有 **block / parry** / throw / spin）
  - `melee.bludgeoning` 90、`melee.unarmed` 90（fist 分 strike/**miss**）、`melee.axe` 38（strike.heavy 分 general/blood/lethal 三档狠度）、`melee.polearm` 43、`melee.claws` 26、`melee.whip` 10
  - `ranged.thrown` 74（各自 strike+impact 配对）、`ranged.bomb` 12（按 acid/fire/ice/poison/electricity/holy_water 分元素）、bow 22 / crossbow 9 / sling 10 / firearm 43
  - `magic` 按传统链分 arcane 101 / divine 98 / occult 160 / primal 18，再按元素 air 182 / earth 213 / fire 161 / water 127 / ice 49 / electricity 37 / metal 25 / sonic 22 / acid 12 / time 8
  - `impact.blood` 36、`impact.fall` 29（按落地材质 concrete/grass/metal/sand/wood/carpet 分）
  - `equipment.weapons` 242（拔刀/收鞘，按 blade 67 / firearm 37 / bow 23 分）
  - **`misc.critical` 4 + `misc.critical_miss` 6**——判定结果专用音
- 命名法：`类别.武器/元素.动作.变体.NN.NN`，末两级是可随机化的编号数组，天生适合 Sequencer 模糊匹配随机抽取。

> ⚠️ **192kHz 问题（合成阶段已复核确认）**：抽样 8 个 ogg，`ffprobe` 报 `vorbis,192000`，**8/8 全部 192000 Hz**。
> 而 pf2e-graphics 里同源同名的文件是 44100 Hz。文件体积正常（比特率 117–240 kbps），
> 但浏览器 `decodeAudioData` 后的 PCM 缓冲是 44.1k 的 **4.35 倍**（3 秒立体声 ≈ 4.6 MB），
> 而 Sequencer 会缓存已解码音频。**考虑到本项目已有 FVTT14 内存泄漏史，这是必须处理的风险点。**
> 三条缓解路径：(a) 同名素材优先取 pf2e-graphics 的 44.1k 版本（两库文件名交集 705 个）；
> (b) 本地 `ffmpeg` 批量重采样到 48k 后走路径覆写；(c) 限制同时在播的 ggg 音效数。

**参考实现现成**：`pf2e-trigger-animations-trove` 的 `animations.json` 里，jb2a 出现 464 次、**ggg-sfx 247 次（180 条唯一路径）**——它示范的正是「动画用 jb2a、音效用 ggg-sfx」这个确切分工。180 条路径对本地 DB 逐条解析，**179/180 可解析**（唯一「失败」的是数组索引尾码，运行时会解析）。这是 V2 音效层最直接的抄袭对象。

### 3.4 其余音效库

**assets/MGS（18G，但 SFX 只占 ~0.2G）** — 裸路径，不在任何 DB 里。

- **唯一提供完整伤害类型矩阵的库**：13 种伤害类型 × 3 变体 = 39 个文件，但**散落在 4 个目录**：
  - `SFX/Basic/Combat/`：Acid / Bludgeoning / Cold / Fire / Force / Necrotic / Poison / Psychic / Radiant Damage
  - `SFX/Basic/Magic/`：Lightning Damage、Thunder Damage
  - `SFX/Basic/Spells/`：Piercing Damage Spell
  - `SFX/Basic/Weapons/`：Slashing Damage Spell
  - → **几乎 1:1 覆盖 Crucible 的伤害类型枚举，一条「按 damageType 选音效」的通用规则就能覆盖全部 1818 条 cue 的命中音。**
- **武器 × 附魔词缀矩阵**（Weapons 195）：`{Acid, Electrical, Flaming, Icy, Poison, Radiant, Holy, Necrotic, Psychic, Thunder} × {Axe, Broadsword, Dagger, Hammer, Staff, Sword, Two-Handed Sword, Whip} × {Draw, Whoosh, Hit}`。
- 命中/落空成对：Sword Hit/Miss、Dagger Hit/Miss、Axe Hit/Miss、Shuriken (Hit)/(No Hit)、Boomerang 四态。
- Gore 16（Wet Gore / Blood Spill / Bone Cracking / Skull Cracking）+ Combat 里 Crushing Body 1-4 / Beheading And Fall / Blade Execution。
- People 115（Human Death 1-5、Female/Male/Orc/Giant Effort ×4-5、Body Fall Heavy/Light）——「攻击者吭一声」的细节层。
- Monsters 344 按生物种类的死亡/咆哮。
- 格式：全部 ogg / Vorbis / 48000Hz / 2ch。SFX 平均 4.06s（n=804 抽样），3-6s 占 44%、>6s 占 10%——**给短动画配长音效需要在 Sequencer 里裁剪或 fadeOut**。
- ⚠️ Music(651) + Ambiences(1088) 占了 18G 里的 17.8G，**别扫进候选池**。

**pf2e-graphics（1834 ogg，44.1kHz）** — **有硬阻断，但文件仍可用**。

- `module.json` 声明 `relationships.systems=[pf2e]`。已核实 Foundry 核心 `/root/foundryvtt/dist/packages/module.mjs` 的 `supportsSystem()`：不支持的模组会被 `Module.getPackages({system})` **直接从集合里剔除**。所以在 Crucible 世界里 **`graphics-sfx` / `graphics-vfx` 两个命名空间根本不会注册**。
- **但文件仍可访问**：已核实 `/root/foundryvtt/dist/server/express.mjs` 的 `express.static(this.paths.data)` **无条件对外提供整个 Data 目录**，与模组是否启用无关。crucible-anim 只要把路径塞进自己的 `registerEntries` 就能用。
- DB 命名法值得直接抄：`graphics-sfx.<类别>.<动作>.<来源包 NN>.<序号>`——**第三层是「按来源音源包分组」**，请求到 `.swing` 层则跨包随机（风格混杂），请求到 `.swing.02` 则锁定单一包（风格统一）。这是一个可切换「多样性 vs 一致性」的分层随机设计。
- 语义层直接对上状态：`debuffs.{hunger,bleed,confused,freeze,grease,restrained,hypnotize,slow,stun}`、`buff.{weapon,regen,ready}`、`critical.{melee,ranged}`、`finisher`、`dodge`、`generic.miss`。
- ⚠️ 10 条 DB 条目指向不存在的文件，其中 **`graphics-sfx.sword.melee.swing.02.{01..05}` 整组 5 条全废**——恰好是最想用的挥剑音之一。
- ⚠️ `graphics-sfx.food` 是空的（0 条叶子）。
- ⚠️ 路径大量含空格和圆括号，shell 处理必须 `-print0` / `IFS= read -r -d ''`。

**pf2e-creature-sounds（1971 m4a）** — 补「谁在挨打」这一维度。

- 106 个可用音组，每组固定 attack_sounds / hurt_sounds / death_sounds 三类，每类约 4-5 条。
- 生物类型覆盖：Aberration / Dragon / Demon / Ghoul / Giant / Goblin A,B / Hag / Kobold / Ogre / Ooze / Orc / Owlbear / Skeleton / Spider / Troll / Zombie …以及 **Humanoid Feminine A–L（12 组）+ Humanoid Masculine A–K（11 组）**。
- 时长（100 抽样）：min 0.37 / p25 0.70 / **中位 1.23s** / p75 1.88 / max 6.50s（长尾多为 death）。
- ⚠️ **唯一格式是 m4a/AAC**，本机其余库全是 ogg/mp3。浏览器原生支持 AAC，但这是必须实测的点。
- ⚠️ `relationships.systems` 只声明 pf2e → **在 Crucible 世界不会启用，不能依赖它的 API**。正确用法：把 dist bundle 里的路径表**离线提取成 crucible-anim 自己的 JSON**，用 Sequencer 按裸路径播；模组只需保持安装（不必启用）。
- ⚠️ 路径命名不统一（GameDevMarket 分支是 `<生物>/<生物>_Attack/CREAHmn_*.m4a`，SamiOli 分支是扁平的 `samignome-attack-5.m4a`），且**含空格与 `&`**，必须 encodeURI。**不要按路径规则推导文件名**，唯一可靠来源是 dist bundle 里的数组。

**blfx-assets-pack01 的 259 条 ogg** — 唯一「视听同源同命名空间」。

- 挂在 `blfx.sound.*` 下：weapon.melee.{axe,club,slam,sword,whip}（sword 下有 whoosh.hit.{flesh|metal} 材质分支）/ weapon.range.{arrow,bow,crossbow} / spell.cast.（22 种）/ ability.{breath,movement.whoosh,roar.dragon,tail,unarmed.strike} / misc.{impact.1-6, bone_cracking.1-8, explosion.double, swoosh.*, thunder.strike} / nature.electric.* / voice.{male,female,goblin}。
- 48000 Hz，时长 min 0.20 / p25 0.72 / **median 1.30** / p90 2.53 / max 7.38s。全短促，0 条 BGM。
- crucible-anim 已经在用 blfx 的动画，**加音效是零边际成本**——同一条 cue 用 `blfx.<动画>` + `blfx.sound.<音效>`，冲击点天然对齐，省掉 timing 调试。
- ⚠️ 排除 `sound.misc.musical_instruments.*`（约 30 条乐器演奏）和 `sound.misc.laughter.madness.1`（全库唯一 mp3）。

**soundfxlibrary（54 条战斗单发）** — 规模最小但命中率最高。

- Combat/Single 十类：**Melee Hit 13 / Shield Hit 11 / Battle Cry 6 / Spell Impact 6 / Arrow Impact 5 / Spell Whoosh 4 / Spell Impact Lightning 4 / Arrow Fly-By 3 / Melee Miss 1 / Throw Hit 1**。
- **`Melee Miss` 和 `Shield Hit` 是别处很难找到的。** Crucible 有明确的命中/未命中/被格挡结果分支，这两类能把 miss 和 blocked 做出听觉区分。`Arrow Fly-By` 3 条可以配投射物的**飞行段**而不只是命中点。
- 时长（Combat/Single 全 54 条）：min 0.18 / 中位 0.91 / max 4.41s。
- ⚠️ 序号**有缺号**（Shield Hit 缺 `shield-hit-2`，实际是 1,3,4..12 共 11 个），**不能用 `range(1,n)` 生成路径**。
- ⚠️ 只有 mp3，无 DB，目录名带空格大写、文件名小写连字符，必须 encodeURI。
- ⚠️ 算时长分布时**必须排除 Combat/Loops**（里面有一条 195 秒的循环）。

**animated-spell-effects-cartoon 的 151 条 ogg** — 白捡但风格要配对。

- `sound-fx/<category>/sfx_<category>_NN[_描述].ogg`：swoosh 33 / energy 29 / liquid 28 / explosion 25 / fire 12 / misc 12 / debris 6 / sparks 6。
- **`grep -c 'sound-fx' scripts/sequencer-db.js` = 0**——完全未进 DB，只能裸路径或自建索引。
- 命名极规整，脚本一扫就能生成 DB。风格偏卡通明快，**建议只配它自己的动画用**。

**assets/pokemon_stadium（320 mp3）** — 事件分类出奇地对口。

`02_crit(24)` / `03_hit(25)` / `04_resist(10)` / `06_miss(14)` / `05_ko(18)` / `11_status(65)` / `01_battle_start(6)` / `07_swap(31)` / `08_remaining(21)` / `09_standoff(11)` / `10_commentary(47)` / `00_opening(48)`。每个事件 10–25 条变体足够随机不重复。做成一个**默认关闭的「解说员模式」开关**成本极低。⚠️ 任天堂版权素材，纯自用，绝不能随模组分发。

### 3.5 明确排除的音频（不要浪费时间）

| 来源 | 数量 | 排除理由 |
|---|---|---|
| ember | 2058 ogg（3443M） | **84% 是音乐**。`*-combat` 目录是战斗**背景音乐分轨**不是打击音；`effects/` 43 条全是脚步与队伍行进；`voices/` 的 fighting-groans 是群体氛围层。仅约 40 条 magic/metal/crystal one-shot 边缘可用（中位 4s，需裁剪） |
| psfx-ambience | 35 ogg（131M） | 全部 16s–600s 长循环，中位 300s |
| psfx-music | 11 ogg（43M） | 最短 200s，且**无 esmodules、无 Sequencer 注册**，架构上接不进来 |
| assets/TabletopAudio | 507 mp3（7.4G） | 抽样 8 个时长**全部精确等于 600.032653s** |
| michaelghelfi | 55（454M） | 38 环境 + 17 音乐，零战斗 SFX |
| assets/SoG + FotRP | 425（4.1G） | 游戏 OST 抓轨。可挖的只有 SoG/CRITHIT 2 条 + TurnSFX 8 条 + FotRP 的 11 条太鼓 stinger |
| 各 PF2E AP 冒险包 | 500+ | abomination-vaults 的 9 条 fx 是 BOSS 专属哀嚎；claws-of-the-tyrant 的 13 条 sfx 全是叙事广播；season-of-ghosts **完全没有 fx 目录** |
| baileywiki-maps-premium-towns | 323 | 地图装饰与场景氛围 |
| tabletop-rpg-music-patreon / moulinette-soundboards | 0 | **本地零音频**，空壳 |

---

## 4. 推荐但本地没有的库（V2 下载清单）

侦察覆盖了 6 个成熟宏模组的推荐清单与 manifest `recommends`。**结论：下载清单几乎是空的。**

| 模组 | 谁推荐的 | 本地状态 | 判定 |
|---|---|---|---|
| `animated-spell-effects`（**原版，不带 -cartoon**） | pf2e-jb2a-macros 的 autorec.json 引用了 1 条路径 | ❌ 未安装 | **清单上唯一真正值得考虑的一项，但优先级低**。整个生态只引用它 1 个文件（`spell-effects/misc/web_spider_realistic_CIRCLE_01.webm`，已确认 cartoon 版里没有同名文件）。除非 V2 明确需要蜘蛛网/缠绕效果，否则不必为 1 个文件装一个库 |
| `canvas3dcompendium` | autoanimations 的 3D 预设引用 13 个 .glb | ❌ 未安装 | **忽略**。是 3D 模型，对 2D Sequencer 管线完全不适用 |
| `eskie-effects-free` | eskie-macros 推荐清单的 altId | ❌ 未安装 | **假阳性**。本地已有完整 Patreon 版（3242 webm），免费版是其子集 |
| `psfx` | eskie-macros 推荐清单的 altId | ❌ 未安装 | **假阳性**。本地已有 psfx-patreon |
| `psfx-demo` | psfx-patreon 自带示例宏引用 | ❌ 未安装 | **不要装**。那些示例宏是过期残留，见第 5 节 |
| `automated-evocations` | — | ❌ 未安装 | **被明确反推荐**。pf2e-jb2a-macros README 有一节就叫 "Not-Recommended Modules"，唯一条目就是它 |
| `midi-qol` | boss-loot-assets-free 代码检测 | ❌ 未安装 | dnd5e 专用，与 Crucible 无关 |

**下载清单实际内容：0 项必需，1 项可选（animated-spell-effects，仅为 1 个文件）。**

另注：`assets/ogg.zip.filepart` 是一个 **176MB 的未完成下载残片**，文件名暗示是一批 ogg（可能是 MGS 的另一批）。要么重下要么删掉——当前状态下是死重量。

---

## 5. 坑（上机前必须知道）

### 5.1 空模组 / 名不副实

| 模组 | 名字暗示 | 实际 |
|---|---|---|
| `boss-loot-assets-premium` | 付费素材包 | **引擎包**。145 个文件里只有 1 个 webm，`grep -rln registerEntries scripts/` 结果为空。但它是 blfx 1412 条素材的**硬性前置**（见 5.2） |
| `dicemega` | 大型整合包 | 598M 全是 **3D 骰子模型**（gltf/glb），零音频 |
| `tabletop-rpg-music-patreon` | 音乐库 | **本地零音频**，靠外部 URL 串流 |
| `moulinette-soundboards` | 音效板 | **本地零音频**，只有 UI 模板 |
| `genga` | System Agnostic Anime Animations | 只有 7 个 webp + 4 个 ogg，靠代码+CSS 实现演出 |
| `sequencer` | — | samples 只有一团 128px 火焰 demo，**且不带 alpha** |
| `eskie.sound` | 音效分类 | **只有 2 个 webm**（Roar_01/02），是「吼叫的可视化声波」动画。eskie 全库音频文件为 **0** |
| `pf2e-graphics` 的 `graphics-vfx` | 视频特效 | 只有 11 组 webp 精灵表，不是 webm |
| `FotRP_Music/07_SFX_音效/` | 音效目录 | 15 个文件里 11 个时长 100–1200s，是整段 OST。**典型的「按名字猜会踩坑」** |

### 5.2 依赖链与命名空间冲突（最容易炸的一类）

1. **blfx 默认不注册**。`blfx-assets-pack01/scripts/module.js` 的 `sequencerReady` 钩子里：
   `if (!isNewerVersion(bossLootPremiumVersion, '3.0')) { 跳过注册; return; }`
   **必须有 `boss-loot-assets-premium` 且版本 > 3.0**，1412 条 `blfx.*` 才会进 DB。本机 premium 是 3.0.1 **刚好过线**。
   而 premium 的 `compatibility.verified` 只到 **13.351**（本世界是 v14），且它是 esmodule + socketlib 的重型引擎——**如果它在 v14 下挂了，blfx 命名空间整个消失**。
   → 建议把「blfx 命名空间是否非空」加进启动自检。项目已有的 `test/asset-index.test.mjs` 对 `blfx` 的检查正好覆盖这条。

2. **JB2A 合并覆盖，方向与直觉相反**。`jb2a_patreon/scripts/jb2a.js` 的注册是
   `if (!game.modules.get('JB2A_DnD5e')?.active) registerEntries("jb2a", patreonDatabase)`。
   两者都启用时 patreon **不自己注册**，改由 JB2A_DnD5e 执行 `mergeObject(patreonDatabase, freeDatabase)`。
   因为 free 0.9.2 > patreon 0.9.0，**免费版的路径覆盖付费版**。
   实测 V1 现用的 49 个 key 前缀里有 **32 个**在双开时会解析到 `modules/JB2A_DnD5e/...`。
   → **任何把 Sequencer DB 解析结果和硬编码 `jb2a_patreon` 路径做比对的快照测试，都会因为用户开关免费模组而结果翻转。**
   → 可以安全禁用 JB2A_DnD5e（已核对：V1 现用的 49 个前缀里没有 free-only 的），代价是失去 `melee_attack.01.flail.01`（连枷，patreon 零命中）和 `melee_attack.03.greataxe.02.blue` 两组。

3. **`jb2a.extras.*` ≠ `jb2a-extras.*`**。前者是 patreon 库内部的 TMFX 顶级 key（109 条，指向 `Library/TMFX/`），后者是独立模组的命名空间。V1 用的 `jb2a.extras.tmfx.inflow.circle.01` **属于 patreon**，禁用 jb2a-extras 模组不会影响它。

4. **`blfx` 命名空间三家共用**：`blfx-assets-pack01` / `boss-loot-assets-free` / `boss-loot-assets-premium` 的 `constants.js` 都写 `NAMESPACE = 'blfx'`。free 版靠 `if (!premiumAssetsPack01Active)` 避让。后果：free 独有的 9 条路径在当前配置下**根本不可寻址**。
   → 项目的 `data/asset-index.json` 里**没有** boss-loot-assets-free 条目是**正确**的，不是遗漏。

5. **`psfx` ≠ `psfx-patreon`**（硬编码）；**`psfx-ambience` = 模组 id**。两库都有 `ambient` 顶层键。

6. **注册钩子名不统一**：ggg 用 `sequencerReady`（无点），animated-spell-effects-cartoon 与 psfx-patreon 用 `sequencer.ready`（带点）。crucible-anim 若要在库就绪后做校验，**必须分别挂钩或统一等到 `ready`**。

7. **系统门禁**（两个库受影响）：`pf2e-graphics` 与 `pf2e-creature-sounds` 的 `module.json` 声明 `relationships.systems=[pf2e]`，在 Crucible 世界**不会被加载**。它们的命名空间不存在、API 不可用，但**磁盘文件仍可访问**（`express.static(paths.data)` 无条件服务）。

### 5.3 死链清单（写兵库规则时要挡）

| 库 | 死链数 | 位置 |
|---|---|---|
| jaamod | **38 / 483（7.9%）** | **`jaamod.condition.rings.*` 整支**（所有 `Conditions/*R.webm` 环形变体）。只有非 ring 版本可用 |
| eskie-effects | 10 / 3236（0.3%） | Crosshair_Circle_Generic_01_Red_60ft；`objects.biological.hand` 的 05/15/30/60/90ft 五条；`slice.01_ranged` 的 Blue_60ft；`texture_mask.glitter` 三条 |
| pf2e-graphics | 10 / 1864 | **`graphics-sfx.sword.melee.swing.02.{01..05}` 整组 5 条全废**；crossbow.unsheath.01.03；magic.air.cast.generic.02.{04,05}；crafting…；cooking… |
| animated-spell-effects-cartoon | 3 + 静默损耗 | `/earth/debris_02_800x800.webm`、`/fire/fire_65_800x800.webm`、`/mix/ectricity_SQUARE_01.webm`（文件名少了 'el'）。另有**重复键覆盖**：733 条字面量 → 求值后只剩 724，例如 air.blast 下连写 5 个 `"cone":`，只有 CONE_05 生效 |
| blfx-assets-pack01 | 1 / 1412（**Linux 专属**） | `blfx.spell.range.link.beam1.sinusoidal.loop.orange.90ft` 指向 `..._Orange_90ft_...webm`，磁盘上实际是 `..._ORANGE_90ft_...webm`（全大写）。同族 05/15/30/60ft 四档正常。**Windows 大小写不敏感所以厂商没发现，Linux VPS 上必然 404** |
| ggg（vfx） | 3 / 49 | `magic.buff.general.01.{attack,defense,magic}` 指向 `buff_a/b/c.json`，磁盘上是 `buff_2a/2b/2c.json`。**sfx 侧 3049 条全部存在，0 死链** |
| jaamod（孤儿文件） | 213 | 有 webp 缩略图无 webm 素材——本地是免费/公开版。**不要照着 webp 文件名写路径** |
| psfx-patreon（示例宏） | 全部 | `scripts/macros/*.js` 引用的是 `psfx-demo.*` 命名空间和 `modules/psfx-demo/...` 路径，**本机没装 psfx-demo，照抄示例宏 100% 失效**。只能信 `psfx_sequencer.js` |
| pf2e-jb2a-macros（autorec） | 1 + 1418 无关 | 1 条指向未安装的 `animated-spell-effects`；另有 1418 条 `modules/levels-3d-preview/` 的 3D 粒子 png，对 2D Sequencer 无用 |

### 5.4 格式与文件名的坑

**alpha 判定方法必须更正（这是全项目级的方法学问题）**

> 任务书里的判据「`pix_fmt=yuva420p` 才带 alpha」在本机的主力库上**会给出假阴性**。
> jb2a_patreon、eskie-effects、blfx-assets-pack01、animated-spell-effects-cartoon、Kinemancer——
> 这些库的 VP8/VP9 WebM 把 alpha 存在**容器级 BlockAdditional 轨道**，`ffprobe` 报的 `pix_fmt` 一律是 `yuv420p`。
> **正确判据：`ffprobe -v error -show_entries stream_tags=alpha_mode`，返回 1 才有 alpha。**
> 五组侦察员独立在五个不同的库上撞到同一个坑并给出同一结论，此项可视为已确证。

**真正不带 alpha 的素材（在深色地图上会露黑底）**：

| 素材 | 数量 | 后果 |
|---|---|---|
| `animated-token-rings-by-mattm` | **111/111 全部 yuv420p 无 alpha** | 420/560/700px 的黑色方块盖住 token。该模组自己绕开了这个问题——它用独立的 Tile 系统铺在 token 上。走 Sequencer 必须设 screen/add 混合模式，且暗色部分（smoke_border_white、necromancy）会明显失真 |
| `animated-shields-by-mattm` | **40/40 无 alpha**，单一 840×840 | 护盾本身偏亮，screen 混合效果通常可接受，比 token rings 好一些 |
| `animated-blizzards-and-sandstorms` | 16/16 无 alpha，2000×1333 | 只能当场景 tile，已排除 |
| `assets/james` | 508 个 **AV1** 编码，无 alpha | 动态地图背景，已排除。另注 AV1 解码开销大 |
| `assets/FV_SCENES_Medieval_1` | 23 个无 alpha | 整张动态地图背景 |
| `sequencer/samples/fire.webm` | 128×128 无 alpha | demo，别误当可用素材 |

**损坏 / 残缺文件**：

- `assets/FV OVERLAYS Lights/Moon Left purple.webm` = **0 字节**（全 assets 树唯一的 0 字节媒体文件）
- `assets/ogg.zip.filepart` = 176MB 未完成下载
- `wise-gaming-premium-pack-242`：`Mod_Assets/` 与 `storage/Mod_Assets/` 是**两份独立文件（非硬链接）**，重复占盘 1.1GB。**数文件时必须排除 `storage/` 否则翻倍**

**文件名必须 encodeURI 的场合**（本项目吃过这类亏）：

- `assets/MGS`：空格、圆括号、方括号、逗号、撇号（`Aganazzar's Scorcher.ogg`、`Boomerang (Hit, Coming Back).ogg`）
- `assets/MGS` **双空格 typo**：`Piercing Damage Spell  2.ogg` 和 `  3.ogg` 是两个空格，`1.ogg` 是一个
- `assets/MGS` **编号起点不统一**：Acid 从 3 起、Bludgeoning 从 1 起、Necrotic 从 2 起，**别假设 1..3**
- `assets/` 根目录散件：文件名带 `#`，**URL 里会被当锚点截断**
- `pf2e-rpg-numbers`：`Critical ⁄ Skill_activation.ogg` 里是 **U+2044 分数斜杠**不是普通斜杠
- `cinematic-cut-ins`：`sfx_legion.MP3` 是**大写扩展名**，按小写后缀过滤的脚本会漏掉
- `animated-shields`：`shield_02_v2_(purple_&_cyan).webm` 含 `&` 和圆括号
- `pf2e-creature-sounds` / `pf2e-graphics` / `soundfxlibrary`：目录名与文件名大量含空格
- `assets/FV_CREATURES`：`Purple Worm reveaL.webm` 尾部大写 L（typo）
- `animated-spell-effects-cartoon` 的 DB **键名含空格**：`level 01`、`level 02`、`fire earth explosion`、`water splash`

**时长陷阱**：

- **psfx 的文件时长 ≠ 音效时长**。大量文件被 padding 到整数秒（swoosh 恰好 3.00s、weapon-attacks 3.50s、conditions 6.00s），尾部是数字静音，实际可听内容常常只占前 1–1.5s。**做音画同步时不能拿 duration 当依据。**
- soundfxlibrary 算分布时必须排除 Combat/Loops（含 195 秒条目）。
- MGS 带 `(Loop)` 后缀的是循环音，不能当一次性 cue。

**其他**：

- `jaamod` 的 `loadEffects.js` 在 init 时无条件执行 `if (!CONFIG.fxmaster) CONFIG.fxmaster = {}`——**即使没装 FXMaster 也会凭空造出 `CONFIG.fxmaster`**。如果 crucible-anim 用它判断 FXMaster 装没装，会误判。
- Sequencer 4.2.3 的 `entryExists` **部分前缀匹配已弃用**（`dist/sequencer.js:6720` 有警告）。crucible-anim 里如果有靠部分前缀命中 DB 路径的写法，未来会炸，**现在就该改成完整路径或规范的点分前缀**。
- Sequencer `compatibility.maximum: 14` —— Foundry 上 v15 就会被判不兼容。
- `jb2a-extras` 的 `module.json` **license 字段是空字符串**（既非 CC 也未声明）。自用无碍，将来要写 credits 需回 jb2a.com 确认。
- 素材分发红线：**ggg / pf2e-graphics / eskie-effects 三家的 README 都有明确的「只能作为本模组的一部分分发」条款**。crucible-anim 只能软引用 DB 路径 + 在 `module.json` 挂 relationship，**绝不能把音频拷进自己仓库**。

---

## 6. 侦察员之间的矛盾与需复核项

九组侦察员有 6 个模组被两组以上重复侦察，产生了 7 处分歧。**合成阶段对其中 4 处做了独立抽样复核，逐条给出裁定。**

### 6.1 已裁定

| # | 分歧 | 裁定 |
|---|---|---|
| 1 | **ggg 采样率**：一组只提「-16 LUFS 归一化、开箱即用」未提采样率；另一组说抽样 60/60 全部 **192000 Hz**，有内存风险 | ✅ **复核确认 192kHz**。合成阶段抽样 8 个 ogg，`ffprobe` 全部报 `vorbis,192000`。**后者正确，前者是漏检**。这是 ggg 唯一的实质缺陷，必须在 V2 处理 |
| 2 | **psfx-patreon 死链**：A 组「1135 条引用，**0 缺失**，64 个磁盘文件未注册」；B 组「1224 条引用，**缺失 20 条**（fire-bolt v2 的 05/15ft）」 | ✅ **A 组正确**。复核：`grep` 出 1214 条唯一路径，其中 20 条缺失，但**这 20 条全部位于被注释掉的代码块内**（`scripts/psfx_sequencer.js:229` 起，行首是 `//`）。B 组的 grep 把注释行也算进去了。**实际注册的 1135 条引用零死链** |
| 3 | **ember 体积与音乐数**：一组 940 MB / music 1735；另一组 3443 MB / music 1717 | ✅ **后者正确**。复核：`du -sm ember` = **3443**，`find ember/assets/audio/music -name '*.ogg'` = **1717**。ogg 总数 2058 两组一致 |
| 4 | **asset-index.json 与侦察的叶子数不符**：项目记录 jb2a_patreon **10038**、JB2A_DnD5e **1687**；侦察报 **12105** / **2061** | ✅ **不是矛盾，是口径不同**。复核 `tools/extract-db.mjs:166`：`if (typeof v === "string" \|\| Array.isArray(v)) n++` —— **一个数组算 1 个叶子**。侦察员的递归 walk 把数组元素逐个展开了。旁证：psfx（930）、eskie（3236）、blfx（1412）、cartoon（724）四库两边完全一致，正是因为这四库的数组用得少或统计方式相同。**两个数字都对，指的是不同东西**：10038 = DB 键数，12105 ≈ 可寻址文件引用数（11700 webm + 386 webp + 别名） |

### 6.2 未裁定，需上机复核

| # | 分歧 / 缺口 | 建议做法 |
|---|---|---|
| 5 | **pf2e-graphics 在 Crucible 下能否用其 DB**：A 组核查 Foundry 核心 `module.mjs` 的 `supportsSystem()`，结论「**不会注册**」；B 组说「只要模组处于启用状态，`graphics-sfx.*` 就能被任何模组调用」并要求上机确认 | **以 A 组为准**（有核心源码依据，B 组是假设）。但上机时用一行 `Sequencer.Database.entryExists("graphics-sfx.sword.melee.hit")` 验证一次即可定案。**无论结果如何，V2 都不应依赖这两个命名空间存在**——按裸路径自建索引是唯一安全做法 |
| 6 | **ggg-vfx 死链**：一组说 `magic.buff.general.01.{attack,defense,magic}` 三条指向 `buff_a/b/c.json` 但磁盘上是 `buff_2a/2b/2c.json`；另一组说「videoDB.js 引用 49 条，实际 48 basis + 48 json」未报死链 | 影响极小（ggg-vfx 只有 49 条，且建议整个跳过）。**不必复核，V2 只取 ggg-sfx** |
| 7 | **boss-loot-assets-premium 的 `present` 标记**：一组标 `false`，一组标 `true` + `kind: empty-or-stub` | **不是矛盾，是判据不同**。作为「素材库」它实质性地没有素材（145 个文件里 1 个 webm）；作为「模组安装」它是完整的。**请勿据此误判为下载失败或残包** |
| 8 | **模组激活状态全线未知** | 九组侦察员一致报告：**FVTT v14 的模组激活状态不在 `world.json` 里**（21 个世界的 world.json 均无 modules 字段）。ggg / animated-spell-effects-cartoon / pf2e-graphics 等**是否已在 Ember 世界启用无法从磁盘确认**。→ V2 上机第一件事就是逐个勾选确认，并把「关键命名空间是否非空」写进启动自检 |

### 6.3 数据缺口（侦察未覆盖）

1. **eskie-effects 与 jaamod 的 alpha / 分辨率细节**，第二轮侦察明确写了「交素材偵察組」但两组给出的粒度不一致——jaamod 的 520 webm 只做了 60 个抽样，**未全量验证 alpha**。
2. **assets/MGS 的来源无法从文件本身证实**——目录里没有任何 license / README / manifest，「MGS = Michael Ghelfi Studios」是从缩写 + Basic/Modern/Sci-Fi 分类法**推断**的。18G 的东西来源不明，**需复核**（虽然自用不影响）。
3. **m4a 在 Sequencer `.sound()` 下的播放兼容性未实测**（pf2e-creature-sounds 1971 个文件全是这个格式）。
4. **ggg 与 pf2e-graphics 的 705 个同名文件**只做了文件名比对，**未做内容比对**——不能断言它们真是同一段音频的不同采样率版本。这直接影响「用 pf2e-graphics 的 44.1k 版替换 ggg 的 192k 版」这条缓解路径能否成立，**上机前需抽样 5–10 对做波形/时长比对**。
5. **V1 的 79 个文件与 53 条 DB 路径的对应关系**未逐条核对（合成阶段测得 53 条唯一 DB 路径：jb2a 39 / eskie 12 / blfx 5 / psfx 1；任务书给的是 55/22/2 个文件）。blfx 的「5 条路径 → 2 个文件」看起来对不上，**需复核**。

---

## 7. 给 V2 的建议（按投入产出比排序）

### P0 — 音效层从零到一（这是 V2 的定义性任务）

**P0-1. 建立音效路径索引，与视觉 asset-index 平级**

- 扩展 `tools/extract-db.mjs` 的 `TARGETS`，加入 `ggg`（`ggg-sfx`）。psfx 已在列表内但只提了 930 键的视觉侧索引，需确认音效树完整。
- 对**四个不注册 DB 的音效来源**新建离线索引脚本，输出到 `data/sfx-index.json`：
  `assets/MGS/ogg/SFX/`（2263 条，含伤害类型矩阵）、`pf2e-graphics/assets/library/sounds/`（1834 条，从 `dist/index-BeuIbmVc.js:25534` 起的 database 字面量切出，bundle 未压缩可直读）、`pf2e-creature-sounds/sounds/`（1971 条，从 dist bundle 的音组数组提取）、`soundfxlibrary/Combat/Single/`（54 条，直接扫目录，**注意序号缺号**）。
- 索引生成时**逐条 `fs.existsSync` 校验并剔除第 5.3 节列出的死链**，同时对文件名做 `encodeURI` 预处理。
- 配套写 `test/sfx-index.test.mjs`，与现有 `asset-index.test.mjs` 同构。

**P0-2. 定义音效槽位，与现有五个视觉槽位对齐**

现有视觉槽：`cast / travel / impact / aftermath / persist`。音效层建议同构 + 判定结果层：

| 音效槽 | 触发点 | 首选来源 |
|---|---|---|
| `swing` | 攻击发起 | `psfx.weapon-swooshes.<light\|heavy\|元素>.v1.group0N`（数组自动随机）；`ggg-sfx.melee.<武器类>.strike.*` |
| `travel` | 投射物飞行 | `psfx.ranged-magic.generic.<missile\|projectile\|beam>.<001-003>.<ft>`；`psfx.ranged-weapons.longbow.v1.<ft>`；soundfxlibrary 的 Arrow Fly-By |
| `hit` | 命中 | **`assets/MGS/ogg/SFX/Basic/Combat/<伤害类型> Damage <N>.ogg`（按 damageType 的通用规则）**；`psfx.impacts.<slashing\|bludgeoning>` / `.magicaleffects.<元素>`；`blfx.sound.weapon.melee.sword.whoosh.hit.<flesh\|metal>` |
| `miss` | 落空 | `soundfxlibrary/Combat/Single/Melee Miss/`；`ggg-sfx.melee.unarmed.fist.miss` |
| `block` | 被格挡 | `soundfxlibrary/Combat/Single/Shield Hit/`（11 条）；`ggg-sfx.melee.blade.block` / `.parry` |
| `crit` | 暴击 | `ggg-sfx.misc.critical`（4）/ `.critical_miss`（6）；`graphics-sfx.critical.<melee\|ranged>`（注意 sword.melee.swing.02 整组已废） |
| `cast` | 施法起手 | `psfx.casting.<generic\|generic-v2\|元素>.*`；`psfx.magic-signs.<circle\|rune>.v1.<学派>.intro`；`psfx.incantations.*`（人声层，可叠加） |
| `persist` | 持续状态 | `psfx.magic-signs.*.loop`；`psfx.conditions.boon.<001-020>.01`（20 条，一个状态一条） |
| `vocal` | 施动者/受击者发声 | `pf2e-creature-sounds` 的 attack / hurt / death 三态（按 Crucible actor 类型映射）；`assets/MGS/SFX/Basic/People/*Effort*` |

**这三层可以叠加播放**（吼叫 + 挥砍 + 撞击），互不冲突。

**P0-3. 抄 pf2e-graphics 的音效编排参数映射**

`processSound()`（`dist/index-BeuIbmVc.js:24985-25015`）把 Sequencer SoundSection 的全部方法串了一遍，是写音效层最省事的模板：
`atLocation({randomOffset, gridUnits}) / syncGroup / forUsers / volume(×全局音量设置) / waitUntilFinished / repeats(count, delayMin, delayMax) + async / duration / playIf(概率) / delay / fadeInAudio / fadeOutAudio / radius / constrainedByWalls / distanceEasing / muffledEffect / baseEffect / alwaysForGMs / audioChannel`。

其中对本项目直接相关的四项：
- `.syncGroup()` —— 音画严格同步。**考虑到 psfx 的 padding 静音尾和 jb2a/eskie 的 54% 非整 30fps 帧率，这个必须用。**
- `.audioChannel()` —— 把 SFX 与 BGM 分开输出，避免抢音乐音量（Ember 世界有大量官方 BGM）。
- `.radius()` + `.constrainedByWalls()` + `.distanceEasing()` —— 定位音。参考 `pf2e-trigger-animations-trove` 的 `troveSound` preset（半径 = 格宽/格高较大者、GM 必播、pan、低通滤波）。
- `.playIf(概率)` —— 让 vocal 层不必每次都响。

**P0-4. 处理 ggg 的 192kHz 问题**（在大规模引入 ggg 之前，不是之后）

三选一，建议按顺序尝试：
1. 抽样 5–10 对 ggg / pf2e-graphics 同名文件做时长与波形比对（见 6.3-4）。若确认同源，**同名素材一律走 pf2e-graphics 的 44.1k 版**。
2. 若不同源，用 `ffmpeg` 把 ggg 实际选用的那批（预计 100–300 条，不是全部 3040 条）批量重采样到 48k，落到项目自己的目录，走裸路径。
3. 兜底：限制同一时刻在播的 ggg 音效数，并给音效层加显式的 Sequencer 音频缓存清理。
> 理由：本项目已有 FVTT14 内存泄漏史（核心音频缓存少调 `super.delete`），**不能在音效层重蹈覆辙**。

### P1 — 用最低成本吃掉最大的视觉增量

**P1-1. 接入 jb2a 的伤害类型分派族**（改动集中在兵库规则表，不动架构）

`jb2a` 的 `arrow`(165) / `bolt`(160) 各含 **cold/fire/lightning/physical/poison 五种伤害类型 × 7 色 × 5 距离**。这是全库唯一按伤害类型正交切分的族，直接对上 Crucible 的 damageType。配合 P0-2 的 `hit` 槽（MGS 伤害类型矩阵），**一条规则同时决定视觉与音效**。

**P1-2. 接入 eskie 的近战正交矩阵**

`eskie.attack.melee.generic.01.<bludgeoning|piercing|slashing>.<light|medium|heavy>.<8色>.<fast|normal|slow>.<01-03>` = 1250 文件。Crucible 的武器同时有伤害类型和重量，**这是唯一能一一对上的素材族**。
配套：`eskie.damage.critical.<01,02,03>`（暴击反馈，V1 没用）。

**P1-3. 补状态层**（V1 完全空白的功能位）

优先级：`jb2a.condition.{boon,curse}`（216 条，风格与主线一致）> `jaamod.condition.*`（34 个具名状态，**但要挡掉 `condition.rings` 整支 38 条死链**）> `blfx.condition.*` + `blfx.misc.enchantment.1-22` > `jb2a-extras.magic_signs.rune.03.*`（128 条持久符文，8 图案 × 8 色）。
音效侧对应 `psfx.conditions.boon.001-020`（20 条，正好一个状态一条）。

**P1-4. 补 AoE 模板层**

`jb2a.template_circle`(1101) / `template_cone_PF2e`(29) / `template_line`(60) / `template_square`(118) / volley 齐射(261)。
`jaamod.breath_weapon`（6 条，**形状已烘进素材**，30×5_line 与 15_cone，不用 stretchTo）。

### P2 — 中等投入

**P2-1. 移除 blfx / JB2A_DnD5e 的路径漂移风险**

两个动作二选一：
- 禁用 `JB2A_DnD5e`，让所有 `jb2a.*` 稳定指向 `jb2a_patreon`（已核对 V1 现用的 49 个前缀里没有 free-only 的，安全）；代价是失去 flail 与 greataxe02.blue 两组。
- 或在 `data/asset-index.json` 的路径快照与 `test/asset-index.test.mjs` 里显式承认「双开时 32 个前缀会解析到 JB2A_DnD5e」，把这一点写成守卫而不是当 bug 修。

同时给 `blfx` 加启动自检：`boss-loot-assets-premium` 版本 > 3.0 且 `blfx` 命名空间非空，否则降级并告警（它的 `compatibility.verified` 只到 13.351，v14 下未验证）。

**P2-2. 抄 pf2e-graphics 的两个防炸守卫**

- `new Sequence({ inModuleName: "crucible-anim", softFail: true })`（其 `index-BeuIbmVc.js:25395`）—— 缺失的 DB 条目不抛异常、不炸整条序列。这直接对上本项目历史上的「素材库缺失」失败模式。
- `AnimCore.parseFiles()`（`:25158`）—— 支持 `jb2a.x.{blue,red}` 花括号展开后 `Sequencer.Helpers.random_array_element()` 随机取一个。**一行代码解决颜色分支随机**，比自己维护颜色池省事。
- 以及它的 `predicates: ["jb2a:patreon"] / ["jb2a:free"]` 双版本降级模式，与 `trigger-animations` 的 `[[module1,file1],[module2,file2]]` fallback（挑第一个 active 的模组）—— 两套现成的「素材库缺失时换素材」写法。

**P2-3. 修 Sequencer 4.2.3 的弃用警告**

`entryExists` 的部分前缀匹配已弃用（`dist/sequencer.js:6720`）。全项目搜一遍靠部分前缀命中 DB 的写法，改成完整路径或规范点分前缀。**现在改比 Sequencer 5 出来再改便宜。**

### P3 — 低优先，明确列出以免反复讨论

- **可选的解说员模式**：`assets/pokemon_stadium` 的 320 条按 crit/hit/miss/ko/resist/status 已分好目录，做成默认关闭的开关，成本极低。⚠️ 任天堂版权，仅自用。
- **暴击特写**：`eskie.screen_overlay`（cinema_bars / speed_lines）+ `cinematic-cut-ins` 的 21 条演出 stinger + Sequencer 的 `CanvasPanSection.shake()`。
- **持续氛围层**：Kinemancer 的 `aura` / `ritual_circle` / `portal`，风格与 jb2a 差异大，只适合仪式/召唤这类明确区分的场合。
- **磁盘瘦身**（与功能无关，纯运维）：`boss-loot-assets-free` 96M 纯重复、`wise-gaming-premium-pack-242` 的 `storage/` 副本 1.1G、`assets/ogg.zip.filepart` 176M、`psfx-music` 43M（V2 明确不用）。合计约 1.4G。

### 明确不做

- 不为 `animated-spell-effects`（原版）下载一个库去拿 1 个蜘蛛网文件。
- 不接入 `ggg-vfx`（49 条 basis 精灵表，渲染路径与 jb2a 完全不同，有 3 条死链）。
- 不接入 `animated-spell-effects-cartoon` 的视觉层作为主线（风格与 Crucible 原生和 jb2a 双重冲突）；只取它的 151 条 ogg 和未进 DB 的 sparks 80 个文件。
- 不依赖 `pf2e-graphics` / `pf2e-creature-sounds` 的模组 API 或命名空间（系统门禁），只当磁盘上的素材目录用。
- 不碰 ember 的 2058 条音频作为打击音源（84% 是音乐，战斗 SFX ≈ 0）。
- 不碰 `animated-token-rings` / `animated-shields`，**除非**先确认 screen/add 混合模式在 Crucible 的深色地图上视觉可接受（151 个文件全部无 alpha）。
