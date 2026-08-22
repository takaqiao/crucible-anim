# crucible-anim

为 Foundry VTT v14 的 **Crucible** 系统补齐原生 VFX 未覆盖的动画。自用模组，硬绑本机已装素材。

- 设计文档：[`docs/DESIGN.md`](docs/DESIGN.md)
- 实现计划：[`docs/IMPLEMENTATION-PLAN.md`](docs/IMPLEMENTATION-PLAN.md)
- 素材侦察记录：[`docs/ASSET-NOTES.md`](docs/ASSET-NOTES.md)

## 它做什么

Crucible 0.10.2 自带完整的 VFX 框架，但**内容**只覆盖一小部分：

| | 原生已实现 | 本模组补齐 |
| --- | --- | --- |
| 法术姿态 | 6 / 17 | **11**：aspect, aura, cone, conjure, create, pulse, sense, step, strike, surge, ward |
| 符文 | 4 / 12 | **8**：control, earth, illumination, illusion, kinesis, oblivion, soul, storm |
| 武器攻击 | 仅弓弩（`projectile1/2`） | **全部近战** 12 类 |
| 默认动作 | 0 | 13 个 |
| 天赋动作 | 0 | ≈ 218 个 |
| 变格 inflection | 0 | 全部 10 个 |
| 状态效果 | 0 | 全部 46 个 |

粒子图集 `CrucibleVFX0.json` 里只有 death / life / frost / flame 四个符文的美术资源，
另外 8 个符文一张贴图都没有 —— 缺失部分只能靠外部素材。

**不替换原生已实现的部分。** 判据是单一条件：原生链最终返回 `null` ⟺ 系统对该动作无动画。
不维护白名单，系统升级新增覆盖时本模组会自动让位。这条判据由
`test/native-boundary.test.mjs` 逐项钉在 Crucible 源码上，上游漂移会先让测试变红。

## 架构

```
CrucibleAction#configureVFXEffect  ← 原型包装，运行在整条原生链之后
        ↓ 原生返回 null 才接管
    快照 → 兵库规则匹配 → FXPlan
        ↓ 写进 flags.crucible.metadata.cav
      聊天卡广播 → 每个客户端本地播放（不用 Sequencer socket）

ActiveEffect 创建/删除 → persist 槽（持续光环）/ death 槽（击杀爆发）
```

六个槽位：`cast` / `travel` / `impact` / `aftermath` / `persist` / `death`。
随机选材在出手端摇定并写成具体数值，播放层不做任何随机 —— 保证多客户端画面一致。

## 依赖

- **必需**：`sequencer` ≥ 4.2
- **素材**（缺失则相应动画降级，不报错）：`jb2a_patreon`、`eskie-effects`、
  `blfx-assets-pack01`、`psfx-patreon`

## 开发

```bash
npm test           # headless 测试
npm run index      # 重新生成 data/asset-index.json
npm run fixtures   # 重新生成 test/fixtures/
```

素材包升级后须重跑 `npm run index` 并跑一遍测试 —— 守卫会暴露失效的 DB 路径。

**测试能证明什么、不能证明什么**：测试验证的是「代码符合我们对 Sequencer 与 Foundry API
的理解」，不是「屏幕上是对的」。渲染效果只能靠预览宏和上机验收裁定，见
`.superpowers/sdd/IMPLEMENTATION-PLAN/task-16-carried-items.md` 的延后项清单。

## 游戏内预览

选中一个 token、目标另一个 token，然后用聊天命令：

```
/canim-preview                    全部规则
/canim-preview slot:impact        只看某个槽位
/canim-preview filter:melee       只看匹配的规则
```

或在控制台：

```js
game.modules.get("crucible-anim").api.preview()
game.modules.get("crucible-anim").api.preview({slot: "persist"})
```

预览宏是渲染层唯一的人工验收手段 —— 除它之外只能靠实战触发。

另：任何一张由本模组接管的聊天卡，**右键 → 重放动画** 可以重播。

## 设置

模组设置里可关闭「启用动画」；Crucible 自己的 `enableVFX` 关闭时本模组同样不出手。
自检失败（Crucible API 或 Sequencer 不可用）时模组自我禁用并提示 GM，不会半装配。
