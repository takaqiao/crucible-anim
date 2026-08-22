# 裁剪候选名单

> 由 `docs/HANDOFF.md` §2 生成。**未执行任何代码改动**，等 owner 裁定。

## A. 判据自动命中（35 个）

判据：带「安静标签」且**无**战斗标签。

| 动作 | 全部标签 | 命中的安静标签 |
| --- | --- | --- |
| `anticipateHarm` | movement, reaction | **movement** |
| `imbueAffix` | rest, noncombat | **noncombat, rest** |
| `amplifyAffix` | rest, noncombat | **noncombat, rest** |
| `markForDeath` | undetectable | **undetectable** |
| `assessStrength` | harmless, undetectable | **undetectable, harmless** |
| `bullrush` | harmless, fortitude, athletics | **harmless** |
| `challenge` | vocal, harmless | **harmless** |
| `defensiveRoll` | reaction, movement | **movement** |
| `dirtyTricks` | harmless, reflex, skill, deception | **harmless** |
| `evasiveShot` | movement | **movement** |
| `abjure` | harmless | **harmless** |
| `intercept` | reaction, movement | **movement** |
| `intuitWeakness` | harmless, undetectable | **undetectable, harmless** |
| `overrun` | reflex, bludgeoning, movement, skill, athletics | **movement** |
| `rapidReload` | reload | **reload** |
| `fieldStudy` | rest, noncombat | **noncombat, rest** |
| `slipstep` | movement | **movement** |
| `telekineticFlight` | maintained | **maintained** |
| `tumble` | harmless, reflex, athletics | **harmless** |
| `grapple` | difficult, harmless, skill, athletics | **harmless** |
| `vowOfAnimus` | harmless | **harmless** |
| `wildspeak` | noncombat | **noncombat** |
| `aqueousTransmission` | movement, blink | **movement** |
| `submergingWithdrawal` | movement, burrow | **movement** |
| `graveMark` | harmless, willpower, skill, intimidation | **harmless** |
| `horrificCritical` | harmless, willpower, psychic, performance | **harmless** |
| `sacrificeSelf` | movement, reaction | **movement** |
| `shadowGait` | movement | **movement** |
| `slipperyEscape` | movement | **movement** |
| `regurgitate` | harmless | **harmless** |
| `terrifyingPresence` | reaction, generic, harmless, willpower, presence | **harmless** |
| `webSpinner` | noncombat | **noncombat** |
| `oozeMagneticDisarm` | reaction, harmless, fortitude, skill, athletics, disarm | **harmless** |
| `swallowedScreams` | harmless, willpower, performance | **harmless** |
| `move` | movement | **movement** |

## B. 判据抓不到、需显式列名单（默认动作）

这些标签是 `generic`，不带安静标签，但同样在播 `generic.cast`：

| 动作 | 现在播什么 | 建议 |
| --- | --- | --- |
| `move` | 1 条 generic.cast | **砍**（标签 movement） |
| `delay` | 1 条 generic.cast | **砍**（标签 generic） |
| `defend` | 1 条 generic.cast | **砍**（标签 generic） |
| `escape` | 1 条 generic.cast | **砍**（标签 generic） |
| `fall` | 1 条 generic.cast | **砍**（标签 generic） |
| `recover` | 1 条 generic.cast | **砍**（标签 generic） |
| `rest` | 1 条 generic.cast | **砍**（标签 generic） |
| `reload` | 1 条 generic.cast | **砍**（标签 generic） |
| `cast` | 1 条 generic.cast | 保留（是真实攻击/施法）（标签 generic） |
| `throwWeapon` | 1 条 generic.cast | 保留（是真实攻击/施法）（标签 generic） |
| `investiture` | 1 条 generic.cast | 保留（是真实攻击/施法）（标签 generic） |
| `strike` | 1 条 generic.cast | 保留（是真实攻击/施法）（标签 strike,melee） |
| `reactiveStrike` | 1 条 generic.cast | 保留（是真实攻击/施法）（标签 reaction,melee） |

## C. 带安静标签但**应保留**（32 个）

它们同时带战斗标签——一刀切会砍错。

- `counterspell` — reaction, spell, harmless
- `ferociousLeap` — melee, mainhand, movement, jump
- `flyingKick` — unarmed, melee, mainhand, empowered, movement
- `markPrey` — ranged, difficult, harmless
- `repercussiveBlock` — shield, reaction, melee, offhand, harmless, disarm
- `motivate` — spell, harmless
- `ennervate` — spell, harmless
- `mould` — spell, harmless
- `enkindle` — spell, harmless
- `condense` — spell, harmless
- `reveal` — spell, harmless
- `seeming` — spell, harmless
- `propel` — spell, harmless
- `bloom` — spell, harmless
- `erase` — spell, harmless
- `evoke` — spell, harmless
- `energize` — spell, harmless
- `ruthlessMomentum` — melee, movement
- `shieldCharge` — shield, melee, offhand, movement
- `refocus` — talisman, harmless, rallying
- `oozeCorrodeWeapon` — reaction, melee, natural, harmless, reflex
- `tramplingCharge` — movement, melee, natural, reflex, bludgeoning
- `tuskCharge` — movement, melee, natural
- `curseAtrophy` — spell, iconicSpell, fortitude, harmless
- `curseDelusion` — spell, iconicSpell, harmless
- `curseDullness` — spell, iconicSpell, harmless
- `curseExhaustion` — spell, iconicSpell, harmless
- `curseLethargy` — spell, iconicSpell, harmless
- `curseScorn` — spell, iconicSpell, harmless
- `invisibility` — spell, iconicSpell, maintained
- `lifebloom` — spell, iconicSpell, maintained
- `telecognition` — spell, iconicSpell, harmless, willpower

---

## 怎么落地

裁剪不该靠删规则，而应在 resolver 里加一道**前置闸门**：命中名单的动作直接返回 null（等同「原生已处理」的那条路径），这样：

1. 不动兵库任何规则，回滚只需删名单
2. `test/native-boundary.test.mjs` 的「只补空缺」判据不受影响
3. 名单本身可以写成测试，防止以后有人无意中把它们又打开
