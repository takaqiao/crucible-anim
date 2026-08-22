## Task 16: 部署与端到端验收

**Files:**
- Create: `README.md`
- Test: 无新增自动化测试；本任务是人工验收

- [ ] **Step 1: 全量测试与体检**

```bash
cd /root/crucible-anim
npm test
```
Expected: 全部测试通过。记录总断言数与降级率。

```bash
# 兵库规则总数
node -e '
import("./scripts/armory/index.mjs").then(({ARMORY}) => {
  let n = 0;
  for (const [slot, rules] of Object.entries(ARMORY)) {
    console.log(slot.padEnd(10), rules.length);
    n += rules.length;
  }
  console.log("合计", n, "条规则");
})'
```
Expected: 合计 40–55 条

- [ ] **Step 2: 部署为符号链接**

沿用同机其他模组的约定（`gesturecast`、`leak-doctor` 都是符号链接）：

```bash
ln -sfn /root/crucible-anim /root/fvtt14-data/Data/modules/crucible-anim
ls -la /root/fvtt14-data/Data/modules/crucible-anim
```

- [ ] **Step 3: 写 `README.md`**

````markdown
# crucible-anim

为 Foundry VTT 的 Crucible 系统补齐原生 VFX 未覆盖的动画。

- 设计文档：`docs/DESIGN.md`
- 实现计划：`docs/IMPLEMENTATION-PLAN.md`
- 素材侦察记录：`docs/ASSET-NOTES.md`

## 它做什么

Crucible 0.10.2 自带完整的 VFX 框架，但内容只覆盖 6/17 个法术姿态、4/12 个符文和弓弩射击。
本模组在原生链返回 `null`（即系统对该动作无动画）时接管，用 Sequencer + JB2A/eskie/blfx
素材补齐其余部分：11 个姿态、8 个符文、全部近战武器、默认动作与 47 个状态效果。

不替换原生已实现的部分。

## 依赖

必需：`sequencer` ≥ 4.2
素材（缺失则相应动画降级）：`jb2a_patreon`、`eskie-effects`、`blfx-assets-pack01`、`psfx-patreon`

## 开发

```bash
npm test           # headless 测试，1500+ 断言样本
npm run index      # 重新生成 data/asset-index.json
npm run fixtures   # 重新生成 test/fixtures/
```

素材包升级后须重跑 `npm run index` 并跑一遍测试，降级率断言会暴露失效的路径。

## 游戏内验收

选中一个 token，目标另一个 token，然后在控制台：

```js
game.modules.get("crucible-anim").api.preview()                    // 全部规则
game.modules.get("crucible-anim").api.preview({slot: "impact"})    // 只看 impact
game.modules.get("crucible-anim").api.preview({filter: "melee"})   // 只看近战
```
````

- [ ] **Step 4: 游戏内验收清单**

在 `ember-test` 世界中逐项确认（**不要在 `ember-` 二团正式世界里首测**）：

| # | 项 | 期望 |
| --- | --- | --- |
| 1 | 启动世界 | 控制台出现「设置项已注册」「自检通过」「触发层已挂载」，无红字 |
| 2 | 设置面板 | 5 个设置项显示中文，density 三个选项齐全 |
| 3 | `api.preview()` | 逐条播放全部规则，`ui.notifications` 报出 `槽/规则 id`，无卡死 |
| 4 | 近战攻击（贴身） | 挥击弧线长度与身位相符，朝向正确 |
| 5 | 近战攻击（隔一格） | 换用长版素材，未穿模 |
| 6 | 目标在左侧 | 挥击已镜像，未反手 |
| 7 | 暴击 | 目标 sprite 抖动，画面其余部分不动 |
| 8 | 未命中 / 闪避 | 特效偏移落空，未贴在目标身上 |
| 9 | 格挡 / 招架 / 护甲 | 三者视觉可区分，且都没有元素溅射层 |
| 10 | 大体型敌人出手 | 特效放大，未显得过小 |
| 11 | 缺失符文法术（如 storm.arrow） | 有动画，颜色与符文相符 |
| 12 | 已实现符文法术（如 frost.arrow） | 播放的是**原生**粒子效果，本模组未插手 |
| 13 | 射线 / 锥形法术 | 贴合模板形状，未溢出边界 |
| 14 | 状态上身（如燃烧） | 目标身上出现循环光效 |
| 15 | 状态移除 | 光效自动消失，无残留 |
| 16 | 撤销一个动作 | 不播放动画 |
| 17 | 关闭 Crucible 的 enableVFX | 本模组也不播 |
| 18 | 关闭本模组 enabled | 原生动画照常，本模组不播 |
| 19 | 聊天卡右键 | 出现「重放动画」，点击后重播 |
| 20 | 第二个客户端 | 同一动作只播一次，画面与主客户端一致 |
| 21 | 连续多次反击 | 动画排队播放，未叠成一团 |
| 22 | 开 debug 后出手 | 控制台打印快照与计划；降级 warning 数量可接受 |

第 12 项是「只补空缺」的核心验证——若原生法术被本模组接管了，说明
`buildPlanFor` 的 `nativeConfig` 判定有误，必须修复而不是绕过。

#### persist 多客户端契约与遮挡（至少 GM + 1 玩家两台客户端）

这一组离线测试完全测不出，必须上机。

| # | 项 | 期望 |
| --- | --- | --- |
| 23 | **零落盘**（本契约唯一的直接读数） | 给一个 token 挂 burning，然后在 GM 控制台跑下面那段，必须返回 `[]`。注意 Sequencer 4.2.x 的记录**不在 token flag 上**，在隐藏 JournalEntry 里 |
| 24 | GM F5 重载 | 光环只有一层，不变亮（刷新前后各截一张图，用 `tools/element-residual-colour.mjs` 量同一像素更稳） |
| 25 | 中途进场 | 状态挂上之后玩家 B 才登录/切进场景，B 必须看得到光环（这条只有 worldPersist:false + 自建重放能过；flag 回放方案下 B 什么都看不到） |
| 26 | 切场景往返 | GM 切到别的场景再切回来，光环恢复且只有一层。失败症状「切回来光环没了」= 重建误挂在 canvasReady 而非 sequencerEffectManagerReady |
| 27 | 移除即清理 | 移除状态，两端光环同时消失，且两端 `Sequencer.EffectManager.getEffects({origin: "<effectUuid>"})` 都返回 `[]` |
| 28 | linked actor 双 token | 同一个 actor 的两个 token 同挂一个状态，两个都要有光环。只有一个 = isPlayingPersist 的判重漏了 object 条件 |
| 29 | 无 GM 在线 | 关掉 GM 客户端，只有玩家在线时挂状态，玩家仍能看到光环 |
| 30 | preload 不再全场往返 | 用 role=PLAYER 的客户端打一次，控制台不得出现 `preloadForClients - You do not have permission`；一次动作不应看到 N 条 PRELOAD 广播 |
| 31 | **temporary 的位置 ticker 开销**（本方案唯一的实打实代价） | 10 个 token × 2 状态全挂上，拖动其中一个跨半个屏幕，看 F12 Performance 有没有可感掉帧、socket 面板里 UPDATE_EFFECT_POSITION 的量级 |
| 32 | 分层观感 | 9 支地面环压在 token 之下仍看得清（尤其 hidden，压下去只剩最弱的一支）；burning/haste/buff 在 token 之上不糊脸 |
| 33 | **tint 真的生效** | decay（腐朽/辐射）必须是酒红／绛紫骷髅环、hidden（隐匿）必须是靛蓝烟弧。若仍是紫色/灰蓝，说明播放端没接 `.tint()` 或把它当加法处理了——**这是本轮唯一测试兜不住的缺口**，测试量的是「按这个 tint 算出来的颜色」，不是「屏幕上真的是这个颜色」 |
| 34 | dead 不再挂环 | 打死一个敌人，尸体上只有 Foundry 自带的 dead overlay，没有青绿眩晕环 |
| 35 | 战斗直调的 DoT | 触发 death / illumination / earth / life / soul 符文暴击，落地的腐朽/辐射/酸蚀/治疗/鼓舞必须命中各自分组的颜色，而不是一颗无 tint 的白泡（那是 generic.persist 兜底，说明 GENERATED_EFFECT_STATUS 没生效） |

