/**
 * 从 Crucible 与 Ember 的 compendium 抽出全部动作，合成 ActionSnapshot 形状的测试样本。
 *
 * 直读 leveldb，不启动 Foundry。目标与结果是参数化合成的：每个动作配两个目标，
 * 一个贴身一个隔格，覆盖 §8.2 的两条几何分支。
 *
 * 用法： node tools/dump-fixtures.mjs [--data /root/fvtt14-data/Data]
 */
import {ClassicLevel} from "classic-level";
import {writeFileSync, existsSync} from "node:fs";
import {join, dirname} from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const argData = process.argv.indexOf("--data");
const DATA = argData > -1 ? process.argv[argData + 1] : "/root/fvtt14-data/Data";

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

const DEFAULT_ACTIONS = ["cast", "move", "fall", "defend", "delay", "escape", "reactiveStrike",
                         "throwWeapon", "investiture", "recover", "reload", "rest", "strike"];

const RUNES = ["control", "death", "earth", "flame", "frost", "illumination",
               "illusion", "kinesis", "life", "oblivion", "soul", "storm"];
const GESTURES = ["arrow", "aspect", "aura", "blast", "cone", "conjure", "create", "fan",
                  "influence", "pulse", "ray", "sense", "step", "strike", "surge", "touch", "ward"];

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
const DEFAULT_STRIKES = {
  strike: [{category: "balanced1", damageType: "slashing"}],
  reactiveStrike: [{category: "light1", damageType: "piercing"}]
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
/**
 * 每种 target.type 一个规范摆位。**注意 rotation 一律为 0、cone 的 angle 取自
 * crucible/module/const/action.mjs 的 TARGET_TYPES.<key>.region.angle（cone=60、
 * fan=210，由 test/source-tables.test.mjs 逐项解析源码核对锁定，不是手抄）**：
 * 真实放置时 rotation 由玩家鼠标现算（crucible 的 dice/action-use-dialog.mjs 按
 * directionDelta 吸附后写进 shape.rotation），compendium 里没有「真值」可抽，
 * 这份语料天然覆盖不到旋转。任何依赖模板朝向/张角的规则都不能靠这里证伪，
 * 必须在 test/armory-travel.test.mjs 的「模板几何」一组里就地合成旋转过的 region。
 */
export const TARGET_REGION = {
  blast: {type: "circle", x: 900, y: 500, radius: 200},
  cone: {type: "cone", x: 500, y: 500, radius: 300, angle: 60, rotation: 0},
  fan: {type: "cone", x: 500, y: 500, radius: 200, angle: 210, rotation: 0},
  ray: {type: "line", x: 500, y: 500, length: 400, width: 100, rotation: 0},
  pulse: {type: "circle", x: 500, y: 500, radius: 200},
  aura: {type: "circle", x: 500, y: 500, radius: 150}
};

/** 一个确定性的字符串哈希，用作 fixture 的 seed，保证跨机器可复现。 */
function hashSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

function makeToken(pos, {width = 1} = {}) {
  return {
    tokenId: `tok-${pos.x}-${pos.y}`, x: pos.x, y: pos.y, elevation: 0,
    width, height: width, radiusPx: (width * GRID) / 2,
    w: width * GRID, h: width * GRID
  };
}

function makeTarget(pos, {adjacent, damageType, resource = "health", width = 1}) {
  const t = makeToken(pos, {width});
  return {
    ...t, adjacent, onLeft: pos.x < ORIGIN.x,
    results: [{result: 7, critical: false}],
    damage: damageType ? {total: 8, type: damageType, resource} : null,
    healed: 0, effects: []
  };
}

function baseSnapshot(id, {tags = [], target, range, cost, spell = null, region = null,
                          strikes = [], usage = {}, dealt = null}) {
  const dmg = tags.find(t => ["bludgeoning", "corruption", "piercing", "slashing", "poison",
    "acid", "fire", "cold", "electricity", "psychic", "radiant", "void"].includes(t)) ?? null;
  const wantsTargets = target?.type && !["none", "self", "summon"].includes(target.type);
  const resource = usage.resource ?? "health";
  // 结算后写回目标身上的伤害类型：dealt 显式给出时以它为准（法术走符文的
  // RUNES.<rune>.damageType，见 RUNE_DAMAGE），否则退回 tags 里的伤害类型词
  // （TAGS[<damageType>].initialize 写的那个 usage.damageType ??= id）。
  const hitType = dealt?.type ?? dmg;
  return {
    id, name: id, actorType: "hero",
    tags, target, range, cost, spell, region, strikes,
    origin: makeToken(ORIGIN),
    targets: wantsTargets
      ? [makeTarget(ADJACENT, {adjacent: true, damageType: hitType, resource}),
         makeTarget(DISTANT, {adjacent: false, damageType: hitType, resource})]
      : [],
    usage: {
      damageType: dmg, isAttack: !!usage.isAttack, isRanged: !!usage.isRanged,
      skillId: usage.skillId ?? null, resource
    },
    seed: hashSeed(id)
  };
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
        out.push(baseSnapshot(id, {
          tags, target, range, cost,
          strikes: tags.includes("strike")
            ? [{category: tags.includes("natural") ? "unarmed" : "balanced1",
                damageType: "slashing"}]
            : [],
          usage: {
            isAttack: tags.some(t => ["strike", "spell", "skill"].includes(t)),
            isRanged: tags.includes("ranged")
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
      tags: DEFAULT_STRIKES[id] ? [id === "reactiveStrike" ? "reaction" : "strike", "melee"]
                                : [id === "move" ? "movement" : "generic"],
      target: DEFAULT_STRIKES[id] ? {type: "single", number: 1, distance: 1, scope: 3}
                                  : {type: "self", number: 0, distance: 0, scope: 1},
      range: {minimum: 0, maximum: 1},
      cost: {action: 1, focus: 0, heroism: 0, health: 0},
      strikes: DEFAULT_STRIKES[id] ?? [],
      usage: {isAttack: !!DEFAULT_STRIKES[id]}
    }));
  }

  for (const rune of RUNES) {
    for (const gesture of GESTURES) {
      const id = `spell.${rune}.${gesture}`;
      const tt = GESTURE_TARGET[gesture];
      out.push(baseSnapshot(id, {
        tags: ["spell", "composed"],
        target: {type: tt, number: tt === "single" ? 1 : 0, distance: 5, scope: 2},
        range: {minimum: 0, maximum: 10},
        cost: {action: 1, focus: 1, heroism: 0, health: 0},
        spell: {rune, gesture, inflection: null},
        region: TARGET_REGION[tt] ?? null,
        // 组合法术的伤害类型只写在 targets[].damage 上、不写 usage.damageType——
        // crucible 的 CrucibleSpellAction#prepareDamage 只产出 action.damage.type，
        // usage.damageType 对法术恒为 undefined（见 models/spell-action.mjs）。
        dealt: {type: RUNE_DAMAGE[rune]},
        usage: {isAttack: true, isRanged: tt !== "self", resource: RUNE_RESOURCE[rune]}
      }));
    }
  }

  writeFileSync(join(ROOT, "test/fixtures/actions.json"), JSON.stringify(out));
  console.log(`actions.json: ${out.length} 个快照`);

  const effects = STATUSES.map(statusId => ({
    statusId, effectUuid: `Scene.s.Token.t.ActiveEffect.${statusId}`,
    target: makeToken(ORIGIN), seed: hashSeed(statusId)
  }));
  writeFileSync(join(ROOT, "test/fixtures/effects.json"), JSON.stringify(effects));
  console.log(`effects.json: ${effects.length} 个状态`);
}
