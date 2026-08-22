# Task 8 报告：素材侦察与选材清单

## 交付物

- `docs/ASSET-NOTES.md`（207 行）— 93 条素材记录 + 50 条被否候选
- `test/asset-notes.test.mjs` — 4 条守卫测试

## 最终行数

**93 行**表格记录（表格行以 `` | ` `` 开头，守卫测试靠这个前缀识别）。
七组侦察员提交的 93 行**全部保留**，没有一条被剔除。

对应 **91 条不同的 DB 路径**——两条路径各出现两次，因为同一素材在两个槽位里
用法和坑点不同，各占一行：

- `jb2a.markers.fear.dark_purple.01` → aftermath（一次性士气下降闪光，需自补 fadeIn/fadeOut）+ persist（恐惧状态常驻环）
- `jb2a.markers.skull.purple.01` → aftermath（击杀标记）+ persist（decay 腐朽状态）

## 路径复核

对 91 条不同路径逐条跑 `createAssets(offlineBackend(index)).resolve(p)`：

```
total=91 bad=0
```

**被剔除的路径：无。** 91 条全部 `diverged === false`，且解析结果路径与输入路径逐字相同。

侦察阶段确实撞到过两条不存在的路径，但侦察员已经自行发现并放进了被否清单，
没有混进正式表格，本轮无需再剔除：

- `jb2a.markers.chain.standard.loop.dark_black` → 降级到 `...loop.01.blue`（正确写法必须带 `.01` 这一级，已改用 `...loop.01.grey`）
- `psfx.doors.clean.lock.001` → 降级到 `.../shop-lock-clean-01.ogg`（真实结构是 `lock.shop.01` / `lock.wooden.01-03`）

两条降级结果均未记录进表格，符合「不保留降级路径」的要求。

## 各槽位分布

| 槽位 | 条数 | brief 的下限 | 覆盖情况 |
| --- | --- | --- | --- |
| cast | 14 | 8 | 通用施法圈（12 色主力 + intro/loop/complete 三段）、ward、conjure、近战起手（正/侧视）、远程拉弓、技能检定闪光、治疗手部、神圣全身、自身增益、长引导 |
| travel | 10 | 7 | 投射物、射线（beam / arrow.ray）、锥形（thin/wide）、喷吐锥、近战贴身、近战隔格、徒手、投掷 |
| impact | 22 | 18 | 8 种攻击结果（HIT/GLANCE/ARMOR/BLOCK/PARRY/RESIST/DODGE/MISS）+ 14 条伤害元素层（物理三系共用血溅，fire/cold/electricity/acid/poison/radiant/psychic/corruption/void 各有主选，其中 fire/acid/radiant/void 另收了备选） |
| aftermath | 8 | 6 | 治疗、地面血泊、地面焦痕、地裂静帧、士气下降、击杀标记、增益上身、减益上身 |
| persist | 17 | 12 | 12 类状态归并（burning/freezing/poison/decay/bleed/stun/fear/hidden/haste/slow/buff/debuff）+ electricity/poison 两条元素余韵层 + buff/slow/debuff 三条备选 |
| sound | 22 | 10 | 起手 3、飞行 2、挥击 4、命中 4、护盾/爆发/治疗 3、状态 2、法阵循环 1、士气 2、精神 1 |
| **合计** | **93** | **61** | |

五个视觉槽（cast/travel/impact/aftermath/persist）共 71 行，sound 22 行。

## 测试输出

```
$ npm test
1..67
# tests 67
# suites 0
# pass 67
# fail 0
# cancelled 0
# skipped 0
# todo 0
```

`test/asset-notes.test.mjs` 的 4 条全绿：

1. 清单条目数达到覆盖五槽所需的规模（下限 `MIN_ROWS = 93`，取**实际复核通过的行数**而非 brief 里估算的 61，这样删掉任何一条已侦察记录都会立刻失败）
2. 清单里每条路径都能无降级地解析
3. 五个槽位都有选材（sound 不计入，它不是视觉槽）
4. 每条记录都填了相位结构与锚点，没有留空（额外加了一条列数断言 `cols.length === 10`，防止备注里混进裸 `|` 把表格结构撑坏）

## 顾虑

1. **`jb2a.ui.miss.white` 是烘死的英文文字，不是特效。** 它和另外 7 个纯 VFX 的视觉语言脱节，
   也没法本地化成中文。上线前需要产品/设计拍板：要么接受英文 Miss! 字样，要么换成扬尘/挥空类素材
   （备选 `jb2a.smoke.puff.side.grey.0`，但那条尚未按 MISS 语义完整复核过时序）。
2. **12 符文色只有 `jb2a.magic_signs.circle.02` 一家配得满。** 其余 cast 候选最多 9 色
   （on_token_buff），少的只有 4 色（cast_generic）。而 magic_signs 的 6 个 `dark_*` 分支
   实测是「低亮度描边版」而不是深色调，在暗色地牢图上几乎糊没——12 色里真正可读的只有 6 个 regular。
   S1 做符文配色时要么给 `dark_*` 加 opacity/发光补偿，要么接受同色相复用。
3. **同族分支帧数不一致会打穿时序。** `jb2a.impact.007` 的 white 是 22 帧、其余 7 色全是 12 帧；
   `jb2a.impact.009` 更夸张（white 29 帧、其余 8 帧）。按 white 调好的 `duration`/`waitUntilFinished`
   一旦做色相补偿换分支，时序行为就变了。目前只对 `jb2a.impact.011/012` 逐色 ffprobe 确认过帧数统一，
   其余多色节点建议在 S3 落地前补一轮全分支 ffprobe。
4. **三家素材的画幅与帧率都不统一**（JB2A 400px/30fps、eskie 800px/30fps、blfx 1200px/24-30fps、
   `jb2a.liquid.splash` 24fps）。同一个 `.scale()` 值在三家之间差 2-3 倍，混排必须改用 `.size()`。
   这个约束应该写进 S3 的分层规则，而不是靠每条素材单独配参数。
5. **「自带命中闪爆」的素材相当多**（ranged.01、ranged.beam、unarmed_strike.physical、
   blfx dagger、eskie.damage 全系、jb2a.impact.011、blades_clash 等）。S3 若无脑叠一层通用命中闪光，
   这些组合全部会双闪。建议在兵库规则里给素材加一个 `hasBuiltInFlash` 标记，由 S3 据此决定是否叠层。
6. **本轮全部是离线抽帧判读，没有一条上机验证过。** 时间轴上的 `startTime`/`endTime` 建议值来自
   逐帧 alpha 采样，理论上准确，但 Sequencer 的 `startTime` 单位、`stretchTo` 与 `_template`
   锚点的实际交互（尤其是 eskie 的 `[200,0,100]` 与 JB2A 的 `[200,200,200]` 混排差一格）
   必须在 S4 上机时逐条回归。
7. **`tools/contact-sheet.sh` 会丢 VP8 alpha。** 至少 5 个素材（shield.02、liquid.splash 全系、
   markers.skull.dark_red、markers.drop.red、ground_crack.still_frame）在默认联系表里会呈现成
   实心色块或满屏噪点，据此判读会得出完全错误的结论。建议给该脚本补一个 `-c:v libvpx` 开关，
   否则下一轮侦察还会踩同一个坑。
