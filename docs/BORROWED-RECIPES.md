# 借鉴成品配方 —— 社区已经调好的「动作 → 素材 + 参数 + 音效」

> 2026-08-23 建。来源都在本机，路径见下。**这份文档只记「他们怎么做的」与「我们据此改了什么」**，
> 不替代 `ASSET-NOTES.md`：任何素材真的要用，仍然要走那边的量测 + 读图 + 签字流程。

## 一、本机有哪些成品配方（枚举得来）

| 来源 | 文件 | 规模 | 可挖性 |
| --- | --- | --- | --- |
| **pf2e-jb2a-macros** | `Aug-2026-fvtt-AutomatedAnimations-GlobalMenu-pf2e.json` | 6.1 MB，近战 221 / 远程 164 / token 472 / 模板 205 / AE 165 | ★★★ 最全，带**参数与音效** |
| 同上（模块自带旧版） | `module/autorec.json` | 7.5 MB，近战 220 / 远程 157 | 上面那份的子集，用新的 |
| **pf2e-trigger-animations-trove** | `animations.json` | 1.8 MB，224 个具名动画图、631 处引用、374 条不同素材 | ★★★ 节点图，看得到**分层与时序** |
| pf2e-trigger-trove | `triggers/*.json` | 1.2 MB | ✗ 纯触发逻辑，素材引用 0 |
| trigger-animations | `dist/*.json` | 52 KB | △ 只有 13 条素材 |
| autoanimations | `dist/autoanimations.js` | 3.6 MB | ✗ 配方编进 JS，取不出结构 |

## 二、autorec 的字段怎么还原成 DB 路径

每条的 `primary.video` 是 `{dbSection, menuType, animation, variant, color}`。**`menuType` 决定还原方式**：

| menuType | 还原成 | 例 |
| --- | --- | --- |
| `weapon` | `jb2a.<animation>.<dbSection>.<variant>.<color>` | `rapier/melee/01/white` → `jb2a.rapier.melee.01.white` ✓ |
| `generic` | `jb2a.melee_generic.<伤害类型>.<单双手>` | `1hb` → `bludgeoning.one_handed`、`1hp` → `piercing.one_handed`、`2hp` → `piercing.two_handed` |

⚠ **还原出来的路径必须回索引里核**。按 weapon 规则还原 `sling`/`javelin`/`greatclub` 都解析不到，
但素材其实存在，只是真实路径不同（见下）。「照抄」前一定要核，否则会写出静默降级的死路径。

## 三、它验证了什么（本仓库的选择与它一致）

- `battleaxe` / `katana` / `scimitar` / `scythe` 的挥击素材逐条相同
- `Bite` 用 `jb2a.bite.400px.red`——**连物理咬击退回红色这个默认都一样**
- `Greatpick` 用 `jb2a.melee_generic.piercing.two_handed`，正是本仓库翻出来的突刺支
- `menuType: generic` 的 `1hp` 就是本仓库给刺剑/长矛用的 `piercing.one_handed`

## 四、它暴露了什么（本仓库漏掉的）

### 4.1 `jb2a.<武器>.melee.*` —— 与挥击族并列的另一族（已采纳）

20 件武器各 5-6 色 × 6 变体。差别在**长度**：挥击族 39-51 帧（一记），这一族 66-86 帧（2-3 下）。
本仓库据此新增 `strike.melee.combo` 规则。⚠ 注意 autorec 把它当**默认单击**用，本仓库
只用于「打好几下」的动作——2.2-2.9 秒对每一记普通挥击太长。

### 4.2 还没采纳的具体路径（下一轮）

| 用途 | 真实 DB 路径（已核） | 本仓库现在用的 | 备注 |
| --- | --- | --- | --- |
| 投石索 | `jb2a.slingshot.<05/15/30/60/90>ft` | `jb2a.bullet.01.red.30ft`（将就） | 有真正的投石索素材 |
| 标枪投掷 | `jb2a.javelin.01.throw.<ft>` + `.return.<ft>` | 走近战突刺 | 带**回收**分段 |
| 巨木棒 | `jb2a.greatclub.standard.white` | `jb2a.melee_attack.03.greatclub.01` | 待比较 |
| 单手钝击（触手/尾） | `jb2a.melee_generic.bludgeoning.one_handed` | `jb2a.melee_attack.02.bone.01` | autorec 给 Pseudopod/Tail 用这个 |
| 单手斩（拳刃） | `jb2a.melee_generic.slashing.one_handed` | 徒手族 | autorec 给 Katar 用这个 |

⚠ autorec 给 `bastardSword` 用 `greatsword.melee.01`、给 `battleAxe` 用 `greataxe.melee.01`，
比本仓库的 `khybersword` / `melee_attack.02.battleaxe` 更「大一号」。**这是取舍不是对错**：
它按 PF2e 的武器分级，本仓库按形制像不像。留档，不改。

## 五、音效层：素材来源已经齐了（线 B，尚未实现）

### 5.1 autorec 的用法

每条 `primary.sound` 是 `{file, delay, volume, enable}`。观察到的规律：

- 挥击音 `psfx.weapon-attacks.<类型>.v1`（sword ×52、spear ×15）
- 命中音 `psfx.impacts.<伤害类型>.v1`（slashing ×52、bludgeoning ×52）
- 也大量直接用 `modules/soundfxlibrary/Combat/Single/Melee Hit/melee-hit-N.mp3`
- **`sound.delay` 是 800-1500ms**，即音效不与画面同时起，而是压在命中时刻上

⚠ 本机 `psfx.impacts` 只有 `slashing` / `bludgeoning` / `magicaleffects` 三支，**没有 piercing**；
`psfx.weapon-attacks` 只有 `spear` / `sword`。照抄会撞空。

### 5.2 MGS 才是更好的来源（`canim.mgs.basic.weapons`，185 条）

- **逐武器 × 逐元素的挥击风声**：`flaming_sword_whoosh` / `icy_axe_whoosh` / `acid_dagger_whoosh` /
  `electrical_staff_whoosh` / `electric_whip_whoosh`……（axe / dagger / hammer / staff / sword /
  two_handed_sword / whip × acid / electrical / flaming / icy）
- **逐元素命中音**：`*_acid_hit` / `fire_hit` / `icy_hit` / `holy_hit` / `necrotic_hit` /
  `poison_hit` / `psychic_hit` / `thunder_hit` / `electrical_hit`
- **落空音**：`*_miss` / `no_hit` / `throwing_miss` —— 本仓库的 MISS 结果层现在没有声音
- 拔刀音：`sword_draw` / `dagger_draw` / `broadsword_draw`
- 特写：`katana_backstab_blood` / `boomerang_hit_coming_back` / `crossbow_attack` / `cannon`

这套与本仓库的架构天然对齐：**cast 槽出挥击风声、impact 槽按结果出命中/落空音**，
元素维度直接吃 `usage.damageType`。

## 六、trove 的分层与时序（节点图里读到的）

- 投掷类一律拆成 **throw + return 两段**，`waitUntilFinished` 配 `waitDelayMin: -800`，
  回收段 `delayMin: 1200`
- 弓：`waitDelayMin: -1400`（比近战交棒早得多，箭在半空就开始结算）
- 近战统一 `delayMin: 300` 的起手延迟 + `randomizeMirrorY`
- 复合动作（Weapon Group: Axe）会把「挥击 + 投掷 + 回收」串成一条，`delayMin` 分别 300 / 800 / 2600

⚠ 它们的 `objectScale: 4` + `anchorX: 1` + `spriteAnchorX: 1` 是一套**整体的锚定方案**
（附着施法者、锚点在贴图右缘）。本仓库是锚在目标 + 偏移，两套不能混抄——单独把 `objectScale`
搬过来会让挥击大四倍且位置错。
