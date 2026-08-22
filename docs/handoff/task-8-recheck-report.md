# Task 8 重验落地报告：用正确解码重验并订正素材侦察备注

## 1. 做了什么

把 8 组重验员对 62 行素材备注的重验结论，逐条落到 `docs/ASSET-NOTES.md`。

- **订正 48 行**：备注列整段换成 `newNote`，行首统一加 `【订正】` 标记。
- **属实 14 行**：备注原样保留、不加标记（62 - 48 = 14）。
- **同步改了 7 行的结构化列**（共 8 处改动）：
  - 相位结构：`blfx.misc.enchantment.1.blades_clash1.color1`（聚拢-爆发 → 淡入-剪刀交叉-白光渐盛-长衰减）、
    `jb2a.impact.011.orange`（扩散 → 爆闪-火星-电弧回闪）、
    `jb2a.magic_signs.circle.02.abjuration.complete.blue`（intro-loop-outro → intro-稳态-outro）、
    `jb2a.ui.miss.white`（单段 → 弹入-静置-上飞）
  - 锚点：`jb2a.on_token_buff.001.001.blue`、`jb2a.extras.tmfx.inflow.circle.01`、`eskie.buff.one_shot.simple.green`
  - mirrorY：`jb2a.ui.miss.white`（是 → **否**，原值与备注「mirrorY 必须锁死为不可翻」自相矛盾）
- **文末订正小节**：新增「第二轮全量重验（62 行 → 48 行订正）」逐行表，小节开头写明重验规模、
  判定分布与失真根因（原抽帧工具不解 alpha 通道）；原「第一轮抽验」表保留并加了子标题。
- **文档开头**新增一条警示：未带【订正】且不在两轮重验范围内的行（即 `sound` 槽 22 行）未经正确解码复核。
- 顺带结清了三条【待复核】（side 版 alpha、snowflake 浓淡、eskie.buff.loop 空间分布）——表内已无【待复核】。

两条重名路径按槽位消歧后写入：`jb2a.markers.skull.purple.01`（aftermath / persist 各一条结论）、
`jb2a.markers.fear.dark_purple.01`（本轮结论落在 persist 行）。

## 2. 判定分布

| 判定 | 行数 |
| --- | --- |
| 失真（有硬断言被推翻） | 18 |
| 部分失真（主体成立，某几句要改） | 30 |
| 属实（不动） | 14 |
| **本轮重验合计** | **62** |

全表覆盖情况：93 行 = 视觉 71 + sound 22。视觉 71 行 = 第一轮已订正 9 + 本轮订正 48 + 本轮属实 14。
sound 槽 22 行不在任何一轮重验范围内，已在开头加警示。

## 3. 最高频的几类失真（一行常同时命中多类，行数为归类估计）

1. **「浓 / 淡 / 亮 / 暗 / 密度」判反或夸大 —— 约 19 行，最高频。**
   典型：`jb2a.liquid.splash.red` 的「几乎看不见的淡红残雾」实为均值 104 的近黑污渍；
   `eskie.damage.psychic.01.pink` 的「偏暗紫看不出打了什么」实为高饱和亮品红且前 8 帧盖脸；
   `jb2a.markers.light.loop.yellow` 的「整体偏亮最容易喧宾夺主」实为全场最稀薄的一支。
   根因直接就是丢 alpha：半透明粒子被渲成实心块、缩图把稀疏亮点和透明底平均成灰。
2. **空间分布判反 —— 约 20 行。**
   「中心有亮核」实为中心最空（light.loop）、「缺口固定在右侧」实为缺口绕圈（snowflake / drop.red /
   smoke.ring）、「粒子从画面下缘生成」实为 72-88% 高度（eskie.buff.one_shot）、
   「环紧贴画幅边缘」实为缩进 20px 才有内容（on_token_buff）。
3. **帧号与相位边界 —— 约 20 行。**
   空帧区间差一帧（magic_signs 两条 0-9 → 0-8）、峰值帧差一帧（impact.011 系列 f0 → f1）、
   整段偏 3-6 帧（`jb2a.ranged.01.projectile` 起手 f4 → f1、命中 f20 → f14；
   `jb2a.ranged.beam.001` f42 → f37）。大半源于拿联系表贴片序号 × step 倒推源帧号。
4. **把衰减默认成单调 —— 约 12 行。**
   实测普遍是反弹 / 脉冲 / 多峰：cast_generic.02 收到底后朝外抛一圈；impact.011.yellow 的
   「余烬尾巴」还会闪三下大亮弧；blfx.spell.impact.flash 是三拍闪烁。
   直接后果是原备注给出的 `endTime` 药方切在闪烁中间或砍掉真正的爆发（blades_clash 的
   endTime≈1000ms 只到峰值的 84%）。
5. **同族关系想当然 —— 约 11 行。**
   「和某某是同一素材换色」（acid vs poison、bright vs regular，alpha PSNR 只有 21-26 dB）、
   「yellow 是唯一变体」（011 实为 10 色支，只有一支的是 006）、「四个变体可互换」（实为 5 个且
   simple 离群）、同名分支帧数不等长（skull.dark_red 144 vs purple 145）。

另有一类值得单记：**由前面的误读直接开出的有害操作建议约 10 行**（压 opacity、belowTokens、
startTime/endTime 裁剪），照做会把素材裁没或整段看不见——订正时都一并推翻了。

## 4. 测试

```
$ npm test
# tests 69
# pass 69
# fail 0
```

守卫测试 `test/asset-notes.test.mjs` 全绿，未放宽任何断言。表格结构复核：
93 行数据行、每行精确 9 列、槽位分布 cast 14 / travel 10 / impact 22 / aftermath 8 /
persist 17 / sound 22（与订正前一致）；48 行行首带【订正】、9 行为第一轮的行内【订正】、
表内已无【待复核】。所有 `newNote` 均无裸 `|`，无需替换。

## 5. 遗留问题

- **sound 槽 22 行仍未复核**：音频行不受 alpha 缺陷影响，但也从未被这两轮逐行核对过，
  开头警示已写明。若后续要依赖它们的 onset / 时长数字，需要单独跑一轮频谱复核。
- **`jb2a.ui.miss.white` 的性质问题没解决**：它是烘死的英文字 `Miss!`，无法本地化，
  备注里要求上线前与设计确认是否换素材——这是产品决策，不是本任务能定的。
- **多处 variant / 分支时长不一致的坑仍是开放项**：`jb2a.melee_attack.01.shortsword.01`
  命中帧随 variant 在 f9-f16 之间跳、`jb2a.smoke.puff.side.grey` 播出时长 1.067-1.900s、
  `jb2a.impact.007` white 22 帧 vs 其余色 12 帧。要钉死时序必须在规则层锁 variant 或按分支重算时长，
  这属于后续兵库/编排任务。
- 文末「抽验属实、可直接引用的行」小节列的 5 行，在第二轮里全部又被翻出问题（1 失真 / 4 部分失真），
  已就地加注说明该小节只代表「当时抽验的那几个数字属实」，并非整行免检。
