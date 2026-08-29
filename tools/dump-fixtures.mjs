/**
 * 从 Crucible 与 Ember 的 compendium 抽出全部动作，合成 ActionSnapshot 形状的测试样本。
 *
 * 直读 leveldb，不启动 Foundry。目标与结果是参数化合成的：每个动作配两个目标，
 * 一个贴身一个隔格，覆盖 §8.2 的两条几何分支。
 *
 * 用法： node tools/dump-fixtures.mjs [--data <Foundry Data>]
 */
import {ClassicLevel} from "classic-level";
import {writeFileSync, existsSync, readFileSync} from "node:fs";
import {join, dirname} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";
import {FOUNDRY_DATA} from "./paths.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const argData = process.argv.indexOf("--data");
const DATA = argData > -1 ? process.argv[argData + 1] : FOUNDRY_DATA;

const GRID = 100;                       // 合成场景的网格像素
const ORIGIN = {x: 500, y: 500};
const ADJACENT = {x: 600, y: 500};      // 相邻一格
const DISTANT = {x: 900, y: 500};       // 隔三格

const PACKS = [
  join(DATA, "systems/crucible/packs/talent"),
  join(DATA, "systems/crucible/packs/adversary-talents"),
  join(DATA, "systems/crucible/packs/spell"),
  join(DATA, "modules/ember/packs/crucible-adversary")
];

/**
 * 92 件真实武器（`tools/dump-weapons.mjs` 枚举 Crucible 的 equipment +
 * adversary-equipment 两个包得来）。语料从前用抽象的 `{category, damageType}` 造武器，
 * **按 identifier 分支的派发规则一条都测不到**。
 */
const WEAPONS = existsSync(join(ROOT, "data/weapons.json"))
  ? JSON.parse(readFileSync(join(ROOT, "data/weapons.json"), "utf8")).weapons
  : [];

const DEFAULT_ACTIONS = ["cast", "move", "fall", "defend", "delay", "escape", "reactiveStrike",
                         "throwWeapon", "investiture", "recover", "reload", "rest", "strike"];

/**
 * `dice/attack-roll.mjs:67-76` 的 `AttackRoll.RESULT_TYPES`。语料从前 642/642 全是
 * HIT(7)，于是 impact 的 8 个结果层里 7 个从没被任何测试跑到过（施工清单 §4.3）。
 */
const RESULT = {MISS: 0, DODGE: 1, PARRY: 2, BLOCK: 3, ARMOR: 4, RESIST: 5, GLANCE: 6, HIT: 7};
const RESULT_HIT = RESULT.HIT;

const RUNES = ["control", "death", "earth", "flame", "frost", "illumination",
               "illusion", "kinesis", "life", "oblivion", "soul", "storm"];
const GESTURES = ["arrow", "aspect", "aura", "blast", "cone", "conjure", "create", "fan",
                  "influence", "pulse", "ray", "sense", "step", "strike", "surge", "touch", "ward"];

/**
 * `const/spellcraft.mjs` 的 `INFLECTIONS` 顶层 10 个键（屈折 / 变体施法）。
 * 主语料 204 条法术的 `spell.inflection` **全是 null**（`spellSnapshot` 的默认值），
 * 这条轴在离线侧一条样本都没有——施工清单 §4.3 点名的六个结构性盲区之一。
 * 由 test/source-tables.test.mjs 解析源码核对锁定。
 */
export const INFLECTIONS = ["compose", "determine", "eluding", "extend", "negate",
                            "pull", "push", "quicken", "react", "reshape"];

/**
 * 8 个罗盘方向的单位向量。**画布 y 向下**，所以 +y 是正南。
 *
 * 主语料的施法者恒在 (500,500)、两个目标恒在**正右方**——施工清单 §4.3 把这条列为
 * 「比空真断言更根本」的结构性盲区：任何「朝向跟着目标走」的断言在只有正东一个方向的
 * 语料上都是既证不伪也证不实的。8 方向样本让它们有定义域。
 */
export const DIRECTIONS = {
  east: {dx: 1, dy: 0}, southeast: {dx: 1, dy: 1}, south: {dx: 0, dy: 1},
  southwest: {dx: -1, dy: 1}, west: {dx: -1, dy: 0}, northwest: {dx: -1, dy: -1},
  north: {dx: 0, dy: -1}, northeast: {dx: 1, dy: -1}
};

/**
 * 12 个符文的伤害类型与资源池，取自 crucible/module/const/spellcraft.mjs 的
 * RUNES.<rune>.damageType / RUNES.<rune>.resource，由 test/source-tables.test.mjs
 * 解析源码逐项核对锁定（与 GESTURE_TARGET 同法，不是手抄）。
 *
 * 为什么法术语料必须带上伤害类型：组合法术的伤害类型由符文决定，
 * models/spell-action.mjs 的 #prepareDamage 写的是
 * `type: this.damageType ?? this.rune.damageType`，一路经 resolveDamage →
 * event.resources[].damageType 落进 trigger/snapshot.mjs 的 target.damage.type。
 * 从前这份语料的 204 条法术全部 damage:null，直接后果是 impact 元素层的 12 条支路
 * 只有 3 条被全量语料跑到过（其余 9 条只有手写用例覆盖），见 test/coverage.test.mjs 的
 * 「12 种伤害类型的元素层都被全量语料行使过」。
 *
 * kinesis 的取值 "physical" 原样保留：它是 DAMAGE_CATEGORIES 的顶层**类别**、
 * 不在 DAMAGE_TYPES 的 12 键里（schema 见 models/spellcraft-rune.mjs 的
 * `choices: ["physical"].concat(...)`），语料带上它才能真正跑到 impact.mjs 的
 * DAMAGE_ALIAS 那条路——把它在这里就换成 bludgeoning 等于把要测的东西提前测掉了。
 */
export const RUNE_DAMAGE = {
  control: "psychic", death: "corruption", earth: "acid", flame: "fire",
  frost: "cold", illumination: "radiant", illusion: "psychic", kinesis: "physical",
  life: "poison", oblivion: "void", soul: "psychic", storm: "electricity"
};

/** RUNES.<rune>.resource：control/illusion/oblivion/soul 打 morale，其余打 health。 */
export const RUNE_RESOURCE = {
  control: "morale", death: "health", earth: "health", flame: "health",
  frost: "health", illumination: "health", illusion: "morale", kinesis: "health",
  life: "health", oblivion: "morale", soul: "morale", storm: "health"
};

/**
 * 【已知简化】life 与 soul 两个符文的 RUNES.<rune>.restoration 是 true，实战里
 * action.mjs 的 _resolveEventStream 会把它们的 delta 取正号（`restoration ? 1 : -1`），
 * 结算结果落进快照的 healed 而不是 damage。这份语料仍然按「造成伤害」生成这两支，
 * 是有意为之：
 *   · 语料的 results 一律写死 result:7、damage.total 一律 8，本来就是合成值而非真实
 *     结算，restoration 只影响 damage / healed 落在哪一格，不影响 damage.type 本身
 *     ——rune.damageType 对 life 就是 poison（#prepareDamage 照样返回 type:"poison"）；
 *   · 真按 restoration 建模会让 poison 失去语料里唯一的攻击侧来源（元素层覆盖从
 *     12/12 掉到 11/12），而唯一能补回来的 noxiousSpit / noxiousSpray 现在被 isAttack
 *     判据挡在门外——那条判据漏了 crucible 的标签传播（melee/natural → strike →
 *     isAttack），是另一个独立缺陷，应当与本次改动分开处理。
 * 两件事一起做才是完整解；先做 restoration 会让覆盖网倒退。
 */

/**
 * 挥击类默认动作的合成武器。crucible const/action.mjs 的 DEFAULT_ACTIONS 里 strike 与
 * reactiveStrike 的 target 都是 `{type: "single", number: 1, scope: 3}`（reactiveStrike
 * 见第 1496 行起那条，tags 写着 `["reaction"] // Added to in #prepareDefaultActions`），
 * 且 models/actor-base.mjs 的 #prepareDefaultActions 会给这两个 id 补上 "melee"/"ranged"
 * 标签——melee 标签 `propagate: ["strike"]`，strike.prepare() 于是把手上的武器塞进
 * usage.strikes 并置 usage.isAttack。原先这份 fixture 只给 id === "strike" 一个目标、
 * 其余默认动作一律 target:self，reactiveStrike 因此既没有目标也没有武器，与源码不符。
 *
 * 两把武器的 damageType 分别取 slashing / piercing：item-weapon.mjs 的 damageType 字段
 * 在 12 种伤害类型里自由取值（initial 为 bludgeoning），语料里必须至少各有一条走
 * 「命中后由武器决定伤害类型」这条路（impact.mjs elementFor 的第 3 级），否则
 * ELEMENT_LAYER 的 piercing/slashing 两支永远只能靠手写用例覆盖。
 * 这两条动作的 targets[].damage 仍保持 null（tags 里没有伤害类型词），正是为了让第 3 级
 * 回退在真实语料上被行使到，而不是被第 1 级抢先。
 */
/**
 * Crucible 的标签传播表，逐条取自 `const/action.mjs` 的 `TAGS[...].propagate`。
 *
 * **不复刻这张表，整条武器通路就永远测不到。** 天赋物品上写的是 `melee` / `twohand` /
 * `thrown` 这些标签，**没有一个带字面 `strike`**；运行时由传播补上，而这份语料从前直接
 * 读原始标签，于是 `tags.includes("strike")` 恒假、`usage.strikes` 恒为 `[]`。
 *
 * 后果实测：69 条 `cost.weapon === true` 的动作里 **55 条一条 travel cue 都不出**，
 * `strike.melee` 只服务于 `strike` / `reactiveStrike` 两个默认动作（全语料命中 4 次）、
 * `strike.unarmed` **命中 0 次**。整个武器天赋空间从未被任何测试执行过。
 *
 * `armory/travel.mjs:349` 的注释早就写着「现有 fixture 的 strikes 恒为 [] 正好掩盖了
 * 这个实战 bug」——知道，但没人回头补语料。
 */
/**
 * `const/action.mjs` 的 `export const TAGS = {...}` 字面量里**静态写死**的 12 条传播。
 * 逐条取自源码的 `TAGS.<tag>.propagate`（行号 299/317/346/366/409/805/828/852/866/885/
 * 904/931），由 test/source-tables.test.mjs 的「TAG_PROPAGATE 与 const/action.mjs 的
 * propagate 逐条一致」解析核对。
 */
const STATIC_TAG_PROPAGATE = {
  projectile: ["ranged"], mechanical: ["ranged"], talisman: ["strike"],
  unarmed: ["melee"], rest: ["noncombat"], melee: ["strike"], ranged: ["strike"],
  mainhand: ["strike"], twohand: ["strike"], offhand: ["strike"], thrown: ["melee"],
  natural: ["melee"]
};

/**
 * `const/skills.mjs` 的 `SKILLS` 顶层 12 个键。`const/action.mjs:1369-1394` 的
 * `for (const {id, abilities, label} of Object.values(SKILLS))` 循环把每一个都注册成
 * `TAGS[id] = {category: "skills", propagate: ["skill"], initialize(){ ... this.usage.skillId = id ... }}`。
 *
 * **这 12 条从前一条都没复刻**，于是离线语料里带技能标签的动作 `tags.includes("skill")`
 * 恒假、`usage.isAttack` 恒 false（判据是 `["strike","spell","skill"]`），实机却是 true——
 * 同一个动作离线走兜底、上机走攻击通路，是施工清单 §4.3 点名的「本仓库最贵的失败模式」。
 * 顺带 `usage.skillId` 也是靠这条循环的 `initialize()` 填的，语料从前恒为 null。
 */
const SKILL_TAGS = ["athletics", "awareness", "stealth", "wilderness", "arcana", "medicine",
                    "science", "society", "deception", "diplomacy", "intimidation", "performance"];

/**
 * `const/actor.mjs` 的 `MOVEMENT_ACTIONS` 顶层 9 个键。`const/action.mjs:1299-1310` 的
 * `for (const id of Object.keys(MOVEMENT_ACTIONS))` 循环把每一个注册成
 * `TAGS[id] = {category: "movement", propagate: ["movement"]}`。
 *
 * 与技能同因同果：`walk`/`jump`/`fly` 这些标签在离线语料里不会传出 `movement`，
 * 而兵库里按 `movement` 分支的规则（travel 的冲扑、cast 的 self.shape）因此少接一批动作。
 */
const MOVEMENT_TAGS = ["walk", "step", "crawl", "jump", "climb", "swim", "fly",
                       "blink", "burrow"];

/**
 * Crucible 的标签传播表 = 静态 12 条 + 技能 12 条 + 移动 9 条 = **33 条**。
 * 三个来源各自的行号与后果见上面三段注释；整表由 test/source-tables.test.mjs 解析
 * `const/action.mjs`（含两条 `for ... TAGS[id] = {...}` 循环）逐条核对，上游加标签这里先红。
 */
const TAG_PROPAGATE = {
  ...STATIC_TAG_PROPAGATE,
  ...Object.fromEntries(SKILL_TAGS.map(t => [t, ["skill"]])),
  ...Object.fromEntries(MOVEMENT_TAGS.map(t => [t, ["movement"]]))
};

export {STATIC_TAG_PROPAGATE, SKILL_TAGS, MOVEMENT_TAGS, TAG_PROPAGATE};

/** 传递闭包：`thrown → melee → strike`、`projectile → ranged → strike` 都要走到底。 */
function propagateTags(tags) {
  const out = new Set(tags);
  for (let changed = true; changed;) {
    changed = false;
    for (const t of [...out]) {
      for (const n of TAG_PROPAGATE[t] ?? []) if (!out.has(n)) { out.add(n); changed = true; }
    }
  }
  return [...out];
}

/**
 * 按标签合成一件**合理的**武器。
 *
 * 从前一律 `balanced1 / slashing`，于是 16 个武器分类里只有 1 个、12 种伤害类型里只有
 * 1 种被语料行使到。武器派发规则按 category 分支，用单一 category 的语料测它等于没测。
 *
 * 全部**确定性**推导，不掷骰：语料要能逐字复现（`npm run fixtures` 两次结果必须相同）。
 */
const DAMAGE_TAGS = ["bludgeoning", "piercing", "slashing", "poison", "acid", "fire",
                     "cold", "electricity", "corruption", "psychic", "radiant", "void"];

function synthWeapon(tags) {
  const t = new Set(tags);
  // 分类：按最具体的标签定，顺序即优先级
  const category =
    t.has("natural") || t.has("unarmed") ? "unarmed"
    : t.has("mechanical") ? (t.has("twohand") ? "mechanical2" : "mechanical1")
    : t.has("talisman")   ? (t.has("twohand") ? "talisman2"   : "talisman1")
    : t.has("projectile") || t.has("ranged") ? (t.has("twohand") ? "projectile2" : "projectile1")
    : t.has("twohand")  ? "heavy2"
    : t.has("brute")    ? "heavy1"
    : t.has("offhand") || t.has("finesse") ? "light1"
    : t.has("shield")   ? "shieldLight"
    : "balanced1";

  const byCategory = {
    unarmed: "bludgeoning", light1: "piercing", balanced1: "slashing", heavy1: "slashing",
    heavy2: "slashing", shieldLight: "bludgeoning",
    projectile1: "piercing", projectile2: "piercing",
    mechanical1: "piercing", mechanical2: "piercing",
    talisman1: "radiant", talisman2: "fire"
  };
  // **武器的伤害类型不等于动作的伤害类型。** `flamingArrow` 的火来自动作，弓仍是穿刺的；
  // 从前把动作的伤害标签直接当武器伤害，推出 `projectile1/fire` 这种 92 件里根本不存在
  // 的组合（17 条）。这里只按分类的真实形制给。
  //
  // 这个改动对现有兵库**行为中性**：impact.mjs:410 的伤害链是
  // `[目标伤害, usage.damageType, strikes[0].damageType]`，武器伤害只是最后兜底；
  // 而动作带伤害标签时 usage.damageType 必非空，链子够不到那一层。
  const damageType = byCategory[category] ?? "bludgeoning";

  // 挑一件**真实存在**的同类武器，好让按 identifier 分支的规则被语料行使到。
  // 伤害类型仍以上面推出来的为准（改了会连带改掉整份语料的元素分支，与本次目的无关）；
  // 天生武器只配给带 natural 标签的动作——英雄天赋不该抡着怪物的獠牙。
  const pool = WEAPONS.filter(w => w.category === category && w.damageType === damageType);
  const wantNatural = t.has("natural");
  const real = pool.find(w => w.properties.includes("natural") === wantNatural) ?? pool[0];
  return [real
    ? {identifier: real.identifier, category, damageType, properties: real.properties}
    // 推出来的 (分类,伤害) 组合在 92 件里不存在时如实退回抽象武器，不硬凑
    : {identifier: null, category, damageType, properties: []}];
}

const DEFAULT_STRIKES = {
  strike: synthWeapon(["strike", "melee"]),
  reactiveStrike: synthWeapon(["strike", "melee", "finesse"])
};

/**
 * 法术姿态 → 目标形态与模板形状，取自 crucible/module/const/spellcraft.mjs 的
 * GESTURES.<gesture>.target.type。由 test/source-tables.test.mjs 直接解析该源文件逐项
 * 核对锁定——Crucible 升级改动姿态定义时测试会自己报警，不会再次悄悄漂移。
 */
export const GESTURE_TARGET = {
  arrow: "single", aspect: "self", aura: "aura", blast: "blast", cone: "cone",
  conjure: "summon", create: "summon", fan: "fan", influence: "single", pulse: "pulse",
  ray: "ray", sense: "aura", step: "movement", strike: "single", surge: "ray",
  touch: "single", ward: "self"
};
/* -------------------------------------------------------------------------- */
/*  模板区域：按 gesture 复算，公式逐行抄自 crucible 的 #getRegionData             */
/* -------------------------------------------------------------------------- */

/**
 * 每尺多少像素 —— 就是 `canvas.dimensions.distancePixels`，`#getRegionData` 里的那个 `d`。
 *
 * Crucible 的 `system.json` 写死 `grid: {type: 1, distance: 5, units: "ft"}`；
 * `documents/scene.mjs:34-38` 的微格（microgrid）把 `grid.size /= 5`、`grid.distance = 1`，
 * 两种口径算出来的 `size/distance` **是同一个数**：源格 100px/5ft ≡ 微格 20px/1ft。
 * 这份语料的 `GRID = 100` 走源格口径，于是 d = 100/5 = 20 px/尺。
 */
const FT_PER_SQUARE = 5;
const D = GRID / FT_PER_SQUARE;

/**
 * 合成施法者的体型，单位**尺**。`#getRegionData:498` 的 `addRange = regionConfig.addSize
 * ? (this.actor.size / 2) : 0`，而 `documents/actor.mjs:185 get size()` 返回
 * `system.movement.size`（微格单位＝尺；`models/actor-hero.mjs:104` 的祖先默认 `size = 4`）。
 *
 * ⚠ **已知近似**：语料的 `origin.width` 单位是 5 尺格（中体型 = 1），这里按
 * `width × 5` 折算成尺，中体型得 5 尺，比真实英雄的 4 尺大 1 尺（addRange 差 0.5 尺 = 10px）。
 * 语料里的 token 宽度本来就是「整格」而不是 Crucible 的微格真值，改这一处不能单独修好，
 * 只有把整份语料迁到微格坐标才行——那会移动全仓库每一个几何断言，不属本批。
 * 守卫（test/source-tables.test.mjs）用的是**同一条折算式**再从源码复算，
 * 所以它盯的是公式而不是这个近似值。
 */
const casterSizeFt = width => width * FT_PER_SQUARE;

/**
 * `const/action.mjs` 的 `TARGET_TYPES.<key>.region`，逐字段抄下来（`region: null` 的四个
 * 目标类型也列进来，好让守卫能核对**键集合**而不只是有 region 的那几个）。
 *
 * 五个字段各有各的用处，缺一个就有一整类模板算错：
 *   · `shape`     决定 `#getRegionData` 走哪个 switch 分支（circle/cone/emanation/line/rectangle）
 *   · `anchor`    "self" = 锚在施法者身上（区域中心/锥尖/线首）；"vertex" = 玩家在射程内点一个顶点
 *   · `addSize`   true 时半径/长度额外加 `actor.size / 2` 尺
 *   · `width`     line 形状的**宽度**（格），ray=1 / wall=2；`ray` 目标类型还会被 target.size 覆盖
 *   · `angle`     cone 形状的张角，并决定 `curvature`（≤90° 平底 flat，>90° 圆底 round）
 *
 * 由 test/source-tables.test.mjs 解析源码逐项核对锁定。
 */
export const TARGET_TYPE_REGION = {
  none: null, self: null, single: null, movement: null,
  cone:   {shape: "cone",      angle: 60,  directionDelta: 15, anchor: "self",   addSize: true,  ephemeral: true},
  fan:    {shape: "cone",      angle: 210, directionDelta: 15, anchor: "self",   addSize: true,  ephemeral: true},
  pulse:  {shape: "circle",                                    anchor: "self",   addSize: true,  ephemeral: true},
  aura:   {shape: "emanation",                                 anchor: "self",   addSize: false, ephemeral: false},
  blast:  {shape: "circle",                                    anchor: "vertex",                 ephemeral: true},
  ray:    {shape: "line",      width: 1,   directionDelta: 3,  anchor: "self",   addSize: true,  ephemeral: true},
  summon: {shape: "rectangle", size: 3,                        anchor: "vertex",                 ephemeral: true},
  wall:   {shape: "line",      width: 2,                       anchor: "vertex",                 ephemeral: false}
};

/**
 * `const/spellcraft.mjs` 的 `GESTURES.<gesture>.target.size`（只有 6 个手势写了 size）。
 * **这就是「按 gesture 复算」的全部理由**：老表按 target.type 建，于是
 *   · `aura`（20 尺）与 `sense`（30 尺）共用一条 —— 半径差 1.5 倍；
 *   · `ray`（宽 1 尺）与 `surge`（宽 10 尺）共用一条 —— **宽度差一个数量级**，
 *     而 surge 正是施工清单 §0.11 那条「画面是脚下爆闪、模板却是 15×10 尺直线」的动作。
 */
export const GESTURE_TARGET_SIZE = {aura: 20, blast: 6, pulse: 10, ray: 1, sense: 30, surge: 10};

/**
 * `const/spellcraft.mjs` 的 `GESTURES.<gesture>.range.maximum`。没有 range 块的四个手势
 * （aspect / aura / sense / ward）与 `range: {weapon: true}` 的 strike 不在表里 —— 它们的
 * 目标类型也都不带 region，取不到就是 0，不影响任何形状。
 */
export const GESTURE_RANGE = {
  arrow: 60, blast: 60, cone: 30, conjure: 30, create: 10, fan: 6,
  influence: 1, pulse: 0, ray: 30, step: 20, surge: 15, touch: 1
};

/**
 * 「玩家会把 anchor:"vertex" 的区域放在哪」的规范答案：沿 +x 放到**远目标身上**
 * （ORIGIN 东侧 400px = 20 尺），射程不够时贴着射程上限。
 * blast（射程 60 尺）与 conjure（30 尺）落在远目标处，create（10 尺）落在 200px 处。
 */
function vertexPoint(maxRangeFt) {
  const distantFt = (DISTANT.x - ORIGIN.x) / D;
  return {x: ORIGIN.x + Math.min(maxRangeFt, distantFt) * D, y: ORIGIN.y};
}

/**
 * 复算一个手势的落地区域，**逐行对着 crucible `dice/action-use-dialog.mjs` 的
 * `#getRegionData`（:491-600）翻译**，产出的形状就是 `trigger/snapshot.mjs:229-231`
 * 从 `action.region.shapes[0].toObject()` 抄进快照的那个对象。
 *
 * 老表（按 target.type 手写六条）与源码至少五处不符：aura 写成 circle 而源码是 emanation、
 * ray 与 surge 共用一条而真值差一个数量级、summon 整个缺项、pulse/blast 半径错、
 * **cone 的 curvature 全表缺失**（fan 的 210° 是圆底，画面按平底做就会畸形）。
 *
 * ⚠ `rotation` 一律为 0：真实放置时它由玩家鼠标现算
 * （`#onPlaceRegion` 的 onMove 按 `regionConfig.directionDelta` 吸附后 `updateSource({rotation})`），
 * compendium 里没有真值可抽。任何依赖模板朝向的规则都不能靠这份语料证伪，
 * 必须在 test/armory-travel.test.mjs 的「模板几何」一组里就地合成旋转过的 region。
 *
 * @param {string} gesture           手势 id
 * @param {{x: number, y: number, width: number}} caster  施法者 token（中心点与格宽）
 * @returns {object|null}            RegionShape 数据；该手势的目标类型没有 region 时返回 null
 */
export function regionForGesture(gesture, caster = {x: ORIGIN.x, y: ORIGIN.y, width: 1}) {
  const cfg = TARGET_TYPE_REGION[GESTURE_TARGET[gesture]];
  if (!cfg) return null;

  // #getRegionData:495-498
  const maxRange = GESTURE_RANGE[gesture] ?? 0;
  const targetSize = GESTURE_TARGET_SIZE[gesture] ?? null;
  const baseRange = targetSize ? targetSize : maxRange;
  const addRange = cfg.addSize ? casterSizeFt(caster.width) / 2 : 0;

  const self = {x: caster.x, y: caster.y};
  const vertex = vertexPoint(maxRange);
  let shape;
  switch (cfg.shape) {
    case "circle":                                                   // :510-518
      shape = {type: "circle", ...(cfg.anchor === "self" ? self : vertex),
               radius: (baseRange + addRange) * D};
      break;
    case "cone":                                                     // :519-529
      shape = {type: "cone", ...self,
               radius: (baseRange + addRange) * D,
               angle: cfg.angle ?? 60, rotation: 0,
               curvature: (cfg.angle ?? 60) <= 90 ? "flat" : "round"};
      break;
    case "emanation":                                                // :530-545
      shape = {type: "emanation", ...self,
               radius: (baseRange + addRange) * D,
               // token 的 x/y 是**左上角**（source 字段），不是中心；shape 是
               // CONST.TOKEN_SHAPES，方格网格下恒为 0。
               base: {type: "token", x: caster.x - (caster.width * GRID) / 2,
                      y: caster.y - (caster.width * GRID) / 2,
                      width: caster.width, height: caster.width, shape: 0}};
      break;
    case "line":                                                     // :546-555
      shape = {type: "line", ...(cfg.anchor === "self" ? self : vertex),
               length: (maxRange + addRange) * D,
               width: (cfg.width ?? 1) * D, rotation: 0};
      break;
    case "rectangle": {                                              // :556-568
      const size = cfg.width ?? 1;
      shape = {type: "rectangle", ...(cfg.anchor === "self" ? self : vertex),
               width: size * D, height: maxRange * D,
               anchorX: 0.5, anchorY: 0.5, rotation: 0};
      break;
    }
    default: throw new Error(`未知的 region.shape "${cfg.shape}"`);
  }

  // 按 target.type 的后处理（#getRegionData:573-587）
  switch (GESTURE_TARGET[gesture]) {
    case "summon": {                                                 // :575-580
      const size = targetSize ?? cfg.size ?? 1;
      shape.height = shape.width = size * D;
      shape.anchorX = shape.anchorY = 0;
      break;
    }
    case "ray":                                                      // :581-583
      if (targetSize) shape.width = targetSize * D;
      break;
  }
  return shape;
}

/**
 * 17 个手势各一份规范区域，按中体型（width = 1）施法者复算。键是**手势**不是目标类型。
 *
 * 没有 region 的 7 个手势（arrow / aspect / influence / step / strike / touch / ward）取值 null，
 * 与 `TARGET_TYPES.<type>.region === null` 一一对应。
 */
export const TARGET_REGION = Object.fromEntries(
  GESTURES.map(g => [g, regionForGesture(g)]));

/** 一个确定性的字符串哈希，用作 fixture 的 seed，保证跨机器可复现。 */
function hashSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function makeToken(pos, {width = 1} = {}) {
  // 体型后缀只在 width > 1 时加，好让改动前就有的 434+92 条样本 tokenId 一字不变
  const tokenId = width === 1 ? `tok-${pos.x}-${pos.y}` : `tok-${pos.x}-${pos.y}-w${width}`;
  return {
    // uuid 不可省：生产环境 trigger/snapshot.mjs 的 tokenGeom() 一定会写它
    // （`token.document?.uuid`），语料缺它会让一整批断言退化成同义反复——例如
    // armory-persist 的 `assert.notEqual(c.tieTo, e.target.uuid)` 变成
    // 「真字符串 ≠ undefined」恒真，「绑到 token 而不是效果」这条回归一条都抓不住；
    // Task 14 resolveRefIn 的 `fromUuidSync(at.uuid)` 主路径也一次都行使不到。
    tokenId, uuid: `Scene.s.Token.${tokenId}`,
    x: pos.x, y: pos.y, elevation: 0,
    width, height: width, radiusPx: (width * GRID) / 2,
    w: width * GRID, h: width * GRID
  };
}

/**
 * 一个目标的结算结果。
 *
 * `result` / `critical` / `healed` 三个参数的默认值就是从前写死的那一组
 * （HIT / 非暴击 / 不治疗），**默认调用逐字段等价于改动前**——现有 434+92 条样本
 * 一个字节都不该动（施工清单 §批次 A：新维度只许「额外生成」，不许替换）。
 * 三个参数只给下面的「边界语料」用，见 EDGE_CASES 那一段。
 *
 * `healed > 0` 时 damage 置 null：`trigger/snapshot.mjs:207-213` 按 `r.delta` 的符号
 * 分流（负数进 damage、正数进 healed），同一次结算不会两边都有。
 */
function makeTarget(pos, {adjacent, damageType, resource = "health", width = 1,
                          result = RESULT_HIT, critical = false, healed = 0,
                          origin = ORIGIN}) {
  const t = makeToken(pos, {width});
  return {
    ...t, adjacent, onLeft: pos.x < origin.x,
    results: [{result, critical}],
    damage: (damageType && !healed) ? {total: 8, type: damageType, resource} : null,
    healed, effects: []
  };
}

function baseSnapshot(id, {tags = [], target, range, cost, spell = null, region = null,
                          strikes = [], usage = {}, dealt = null,
                          origin = ORIGIN, originWidth = 1, targetsAt = null,
                          result = RESULT_HIT, critical = false, healed = 0}) {
  const dmg = tags.find(t => ["bludgeoning", "corruption", "piercing", "slashing", "poison",
    "acid", "fire", "cold", "electricity", "psychic", "radiant", "void"].includes(t)) ?? null;
  const wantsTargets = target?.type && !["none", "self", "summon"].includes(target.type);
  const resource = usage.resource ?? "health";
  // 结算后写回目标身上的伤害类型：dealt 显式给出时以它为准（法术走符文的
  // RUNES.<rune>.damageType，见 RUNE_DAMAGE），否则退回 tags 里的伤害类型词
  // （TAGS[<damageType>].initialize 写的那个 usage.damageType ??= id）。
  const hitType = dealt?.type ?? dmg;
  // targetsAt 不给时用「正东贴身 + 正东隔格」这一对老摆位，与改动前逐字段相同。
  const spots = targetsAt ?? [{pos: ADJACENT, adjacent: true}, {pos: DISTANT, adjacent: false}];
  return {
    id, name: id, actorType: "hero",
    tags, target, range, cost, spell, region, strikes,
    origin: makeToken(origin, {width: originWidth}),
    targets: wantsTargets
      ? spots.map(({pos, adjacent, width = 1}) =>
          makeTarget(pos, {adjacent, damageType: hitType, resource, width,
                           result, critical, healed, origin}))
      : [],
    usage: {
      damageType: dmg, isAttack: !!usage.isAttack, isRanged: !!usage.isRanged,
      skillId: usage.skillId ?? null, resource
    },
    seed: hashSeed(id)
  };
}

/**
 * 一条组合法术的快照。主语料的 204 条（12 符文 × 17 手势）与下面「边界语料」的
 * 治疗 / 屈折 / strike 手势 / 大体型样本共用它，省得两边慢慢漂开。
 *
 * ⚠ **已知不一致**：`range` 写死 `{minimum: 0, maximum: 10}`、`target.distance` 写死 5，
 * 而 `region` 现在是按 `GESTURE_RANGE`（cone 的真射程是 30 尺）复算的。没有任何兵库规则
 * 读这两个字段（全仓 grep：`s.range` / `s.target.distance` 零命中），所以本轮不动它们——
 * 改了会平白移动 434 条样本的字节而换不来任何守卫。要修的时候把这两处一起换成
 * `GESTURE_RANGE` / `GESTURE_TARGET_SIZE` 即可。
 *
 * @param {string} id
 * @param {string} rune
 * @param {string} gesture
 * @param {object} [variant]  透传给 baseSnapshot 的边界维度（result / critical / healed /
 *                            origin / originWidth / targetsAt / strikes / inflection）
 */
function spellSnapshot(id, rune, gesture, {inflection = null, strikes = [], ...variant} = {}) {
  const tt = GESTURE_TARGET[gesture];
  return baseSnapshot(id, {
    tags: ["spell", "composed"],
    target: {type: tt, number: tt === "single" ? 1 : 0, distance: 5, scope: 2},
    range: {minimum: 0, maximum: 10},
    cost: {action: 1, focus: 1, heroism: 0, health: 0},
    spell: {rune, gesture, inflection},
    strikes,
    // 按**手势**取，不是按目标类型：aura/sense 与 ray/surge 各自共用一个 target.type
    // 但尺寸完全不同（见 GESTURE_TARGET_SIZE 的注释）
    region: regionForGesture(gesture, {x: variant.origin?.x ?? ORIGIN.x,
                                       y: variant.origin?.y ?? ORIGIN.y,
                                       width: variant.originWidth ?? 1}),
    // 组合法术的伤害类型只写在 targets[].damage 上、不写 usage.damageType——
    // crucible 的 CrucibleSpellAction#prepareDamage 只产出 action.damage.type，
    // usage.damageType 对法术恒为 undefined（见 models/spell-action.mjs）。
    dealt: {type: RUNE_DAMAGE[rune]},
    usage: {isAttack: true, isRanged: tt !== "self", resource: RUNE_RESOURCE[rune]},
    ...variant
  });
}

/**
 * 46 个可赋予状态，取自 crucible/module/const/statuses.mjs 的 `statusEffects`（不是
 * `derivedConditions`——那边的 flanked 源码注释明写「derived from circumstance ...
 * cannot be assigned」，不会作为 ActiveEffect 出现，因此不属于这份状态 fixture）。
 * 由 test/source-tables.test.mjs 直接解析该源文件核对锁定。
 */
export const STATUSES = ["weakened", "dead", "broken", "insane", "staggered", "stunned", "prone",
  "restrained", "slowed", "hastened", "disoriented", "exhausted", "blinded", "burrowing",
  "flying", "deafened", "silenced", "enraged", "frightened", "invisible", "invulnerable",
  "limitless", "resolute", "guarded", "exposed", "overrun", "diseased", "paralyzed", "asleep",
  "suffocating", "incapacitated", "unaware", "falling", "bleeding", "burning", "freezing",
  "confused", "corroding", "decaying", "dominated", "entropy", "irradiated", "mending",
  "inspired", "poisoned", "shocked"];

/** 直跑守卫：只有脚本被直接执行（而非被测试 import 取表）时才跑整轮抽取与写盘。 */
const isMain = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;

if (isMain) {
  const out = [];
  const seen = new Set();       // 已出现过的 id，供 DEFAULT_ACTIONS 判重（id 级）
  const seenSig = new Set();    // 已出现过的内容签名，供包内/跨包动作判重（内容级）

  for (const p of PACKS) {
    if (!existsSync(p)) { console.warn(`跳过不存在的包: ${p}`); continue; }
    const db = new ClassicLevel(p, {valueEncoding: "json"});
    for await (const [key, doc] of db.iterator()) {
      if (!key.startsWith("!items!") && !key.startsWith("!actors!")) continue;
      for (const a of (doc?.system?.actions ?? [])) {
        const id = a.id;
        if (!id) continue;
        const tags = a.tags ?? [];
        const target = a.target ?? {type: "single", number: 1, distance: 1, scope: 2};
        const range = a.range ?? {minimum: 0, maximum: 1};
        const cost = a.cost ?? {action: 1, focus: 0, heroism: 0, health: 0};
        // 同 id 不等于同一动作：不同道具上可能各自定义一个语义完全不同的同名动作
        // （如 adversary-talents 里 "Burnout" 与 "Steam Vent" 都用 id="steamVent"）。
        // 按 id+tags+target+range+cost 的内容签名去重，只吞掉真正的重复条目。
        const sig = `${id}::${JSON.stringify([...tags].sort())}::` +
          `${JSON.stringify(target)}::${JSON.stringify(range)}::${JSON.stringify(cost)}`;
        if (seenSig.has(sig)) continue;
        seenSig.add(sig);
        seen.add(id);
        // 先补传播标签，再判「是不是攻击 / 要不要武器」——两者都依赖传播后的结果
        const full = propagateTags(tags);
        out.push(baseSnapshot(id, {
          tags: full, target, range, cost,
          // `cost.weapon` 是物品自己声明的「这个动作要不要武器」，比标签更权威；
          // 传播出来的 strike 标签作为第二判据（Crucible 的 strike.prepare() 正是
          // 在 usage.strikes 为空时把手上的武器塞进去）
          strikes: (cost?.weapon === true || full.includes("strike")) ? synthWeapon(full) : [],
          usage: {
            isAttack: full.some(t => ["strike", "spell", "skill"].includes(t)),
            isRanged: full.includes("ranged"),
            // 技能标签的 initialize() 会写 `this.usage.skillId = id`
            // （const/action.mjs:1374-1382）。语料从前恒为 null，因为技能标签压根没进传播表。
            skillId: full.find(t => SKILL_TAGS.includes(t)) ?? null
          }
        }));
      }
    }
    await db.close();
  }

  for (const id of DEFAULT_ACTIONS) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(baseSnapshot(id, {
      // 同样要过传播：reactiveStrike 的原始标签是 ["reaction","melee"]，
      // 不传播就没有 strike，按 strike 匹配的规则对它不可达（与天赋动作同一个坑）
      tags: propagateTags(DEFAULT_STRIKES[id]
        ? [id === "reactiveStrike" ? "reaction" : "strike", "melee"]
        : [id === "move" ? "movement" : "generic"]),
      target: DEFAULT_STRIKES[id] ? {type: "single", number: 1, distance: 1, scope: 3}
                                  : {type: "self", number: 0, distance: 0, scope: 1},
      range: {minimum: 0, maximum: 1},
      cost: {action: 1, focus: 0, heroism: 0, health: 0},
      strikes: DEFAULT_STRIKES[id] ?? [],
      usage: {isAttack: !!DEFAULT_STRIKES[id]}
    }));
  }

  for (const rune of RUNES) {
    for (const gesture of GESTURES) out.push(spellSnapshot(`spell.${rune}.${gesture}`, rune, gesture));
  }

  // ---- 武器语料：92 件武器各一份平打快照 -------------------------------------
  //
  // 动作语料里一个动作只带一件武器，靠 synthWeapon 按标签推——推得再准也只覆盖到
  // 8 件。而 V2 线 A 要给**每件**武器配专属画面，「每件」是 92 件，覆盖率守卫得有个
  // 定义域才能说「还差几件」。
  //
  // 单独一份文件而不是并进 actions.json：并进去会把兜底棘轮的三个基线整体抬高 92,
  // 那三个数是 V2 的进度表，掺进与派发无关的量会让它读不出进度。
  //
  // `usage.damageType` 留空是**故意的**：impact 的伤害链是
  // `[目标伤害, usage.damageType, strikes[0].damageType]`，只有动作不带伤害标签时
  // 才够得到武器那一层——平打正是这种情形，也正是 ELEMENT_LAYER 12 支里靠武器
  // 定色的那条通路唯一被行使到的地方。
  const weaponStrikes = WEAPONS.map(w => {
    const ranged = ["projectile1", "projectile2", "mechanical1", "mechanical2"].includes(w.category);
    const tags = propagateTags(["strike", ranged ? "ranged" : "melee",
                                ...(w.properties.includes("natural") ? ["natural"] : [])]);
    const snap = baseSnapshot(`weapon:${w.category}:${w.identifier}`, {
      tags,
      target: {type: "single", number: 1, distance: ranged ? 10 : 1, scope: 3},
      range: {minimum: 0, maximum: ranged ? 10 : 1},
      cost: {action: 1, focus: 0, heroism: 0, health: 0, weapon: true},
      strikes: [{identifier: w.identifier, category: w.category,
                 damageType: w.damageType, properties: w.properties}],
      usage: {isAttack: true, isRanged: ranged}
    });
    return snap;
  });
  writeFileSync(join(ROOT, "test/fixtures/weapon-strikes.json"), JSON.stringify(weaponStrikes));
  console.log(`weapon-strikes.json: ${weaponStrikes.length} 件武器`);

  writeFileSync(join(ROOT, "test/fixtures/actions.json"), JSON.stringify(out));
  console.log(`actions.json: ${out.length} 个快照`);

  // ---- 边界语料：六条盲区轴的合成样本 ---------------------------------------
  //
  // **额外生成，不替换现有样本**（施工清单 §批次 A；不能替换的理由见本文件 RUNE_DAMAGE
  // 下方那段「已知简化」——主语料的 result/damage/healed 是有意固定的合成值，动它会让
  // 元素层覆盖从 12/12 退回 11/12）。
  //
  // 单独一份 `edge-cases.json` 而不是并进 actions.json，理由与 weapon-strikes.json 完全
  // 相同：兜底棘轮的三个基线是 V2 的进度表，掺进这批「专为打某条支路而造」的样本会让
  // 数字读不出进度。
  //
  // 六条轴逐条对应施工清单 §4.3 的盲区表：
  //   1. 8 罗盘方向        —— 主语料施法者恒在 (500,500)、目标恒在正右方
  //   2. 8 档结果 + 暴击   —— 主语料 642/642 全 HIT、critical 全 false
  //   3. healed            —— 主语料 642 个 healed 字段全 0（§0.8 治疗在被治疗者身上炸血溅）
  //   4. origin.width 2/3  —— 主语料全 1，sizeScale/offsetFor 的大体型分支零覆盖
  //   5. inflection ×10    —— 主语料全 null
  //   6. strike 手势带武器 —— 法术的 strike 手势（cost.weapon:true）在主语料里 strikes 恒 []
  //
  // 样本量下限由 test/source-tables.test.mjs 的「边界语料六条轴」按**实测值**钉住：
  // 生成器哪天少发一条，那条轴先红，而不是等某个 ∀ 断言悄悄退化成空真。
  const edge = [];

  /** 沿某个方向摆一对目标（贴身 1 格 + 隔格 4 格），距离与主语料的 ADJACENT/DISTANT 相同。 */
  const spotsToward = ({dx, dy}, origin = ORIGIN, far = (DISTANT.x - ORIGIN.x) / GRID) => [
    {pos: {x: origin.x + (dx * GRID), y: origin.y + (dy * GRID)}, adjacent: true},
    {pos: {x: origin.x + (dx * far * GRID), y: origin.y + (dy * far * GRID)}, adjacent: false}
  ];

  /** 近战平砍原型：与默认动作 `strike` 同形，但目标摆位/结果/体型可换。 */
  const meleeEdge = (id, variant = {}) => {
    const tags = propagateTags(["strike", "melee", "slashing"]);
    return baseSnapshot(id, {
      tags,
      target: {type: "single", number: 1, distance: 1, scope: 3},
      range: {minimum: 0, maximum: 1},
      cost: {action: 1, focus: 0, heroism: 0, health: 0, weapon: true},
      strikes: synthWeapon(tags),
      usage: {isAttack: true, isRanged: false},
      ...variant
    });
  };

  // 轴 1：8 罗盘方向 × {近战, 远程法术}
  for (const [name, dir] of Object.entries(DIRECTIONS)) {
    edge.push(meleeEdge(`edge.dir.${name}.melee`, {targetsAt: spotsToward(dir)}));
    edge.push(spellSnapshot(`edge.dir.${name}.arrow`, "storm", "arrow",
                            {targetsAt: spotsToward(dir)}));
  }

  // 轴 2：8 档结果（MISS…HIT）× {近战, 远程法术}，外加 GLANCE/HIT 的暴击变体
  for (const [name, result] of Object.entries(RESULT)) {
    edge.push(meleeEdge(`edge.result.${name}.melee`, {result}));
    edge.push(spellSnapshot(`edge.result.${name}.arrow`, "flame", "arrow", {result}));
  }
  for (const name of ["GLANCE", "HIT"]) {                 // 只有命中类结果才谈得上暴击
    edge.push(meleeEdge(`edge.crit.${name}.melee`, {result: RESULT[name], critical: true}));
    edge.push(spellSnapshot(`edge.crit.${name}.arrow`, "frost", "arrow",
                            {result: RESULT[name], critical: true}));
  }

  // 轴 3：治疗。life / soul 是源码里 restoration:true 的两个符文
  // （spellcraft.mjs 的 RUNES.<rune>.restoration，由 source-tables.test.mjs 锁定），
  // 结算走 models/action.mjs:2060 的 `restoration ? 1 : -1`，正 delta 落进 healed。
  for (const rune of ["life", "soul"]) {
    for (const gesture of GESTURES) {
      edge.push(spellSnapshot(`edge.heal.${rune}.${gesture}`, rune, gesture, {healed: 8}));
    }
  }
  // 非法术治疗：harmless / healing 标签那一簇（施工清单 §0.9 的 28 条动作同形）
  for (const tag of ["healing", "harmless"]) {
    edge.push(baseSnapshot(`edge.heal.action.${tag}`, {
      tags: [tag],
      target: {type: "single", number: 1, distance: 1, scope: 2},
      range: {minimum: 0, maximum: 1},
      cost: {action: 1, focus: 0, heroism: 0, health: 0},
      usage: {isAttack: false, isRanged: false},
      healed: 8
    }));
  }

  // 轴 4：大体型施法者。sizeScale 只有 1 / 1.4 两档、offsetFor 乘的是施法者宽，
  // 主语料 origin.width 恒为 1，两条分支一次都没走过。
  for (const originWidth of [2, 3]) {
    edge.push(meleeEdge(`edge.size.w${originWidth}.melee`, {originWidth}));
    edge.push(spellSnapshot(`edge.size.w${originWidth}.arrow`, "storm", "arrow", {originWidth}));
    // cone 走模板分支：addSize 让半径跟着施法者体型涨（regionForGesture 的 addRange）
    edge.push(spellSnapshot(`edge.size.w${originWidth}.cone`, "flame", "cone", {originWidth}));
  }

  // 轴 5：10 个屈折各一条。手势按下标轮换，免得 10 条样本全落在同一条规则上。
  INFLECTIONS.forEach((inflection, i) => {
    const gesture = GESTURES[i % GESTURES.length];
    edge.push(spellSnapshot(`edge.inflection.${inflection}`, RUNES[i % RUNES.length],
                            gesture, {inflection}));
  });

  // 轴 6：strike 手势带武器。GESTURES.strike 的 cost 是 `{action: 0, focus: 1, weapon: true}`、
  // range 是 `{weapon: true}`——它是「给武器附魔后砍一刀」，主语料里 strikes 恒为 []，
  // 于是 12 条 strike 手势法术在离线侧全部退回法术兜底。
  for (const rune of RUNES) {
    edge.push(spellSnapshot(`edge.strike-gesture.${rune}`, rune, "strike",
                            {strikes: synthWeapon(propagateTags(["strike", "melee"]))}));
  }

  writeFileSync(join(ROOT, "test/fixtures/edge-cases.json"), JSON.stringify(edge));
  console.log(`edge-cases.json: ${edge.length} 条边界样本`);

  const effects = STATUSES.map(statusId => ({
    statusId, effectUuid: `Scene.s.Token.t.ActiveEffect.${statusId}`,
    target: makeToken(ORIGIN), seed: hashSeed(statusId)
  }));
  writeFileSync(join(ROOT, "test/fixtures/effects.json"), JSON.stringify(effects));
  console.log(`effects.json: ${effects.length} 个状态`);
}
