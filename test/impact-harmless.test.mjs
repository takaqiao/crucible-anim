/**
 * 良性动作（治疗 / harmless）不许在目标身上炸血溅。
 *
 * ## 这是实机一眼可见的错，不是观感取舍
 *
 * `impact.layered` 的元素层闸门从前只有 `if (isHitLike)`——只问「打中没有」，不问
 * 「有没有造成伤害」。而 `elementFor()` 的三级取值链
 * （`t.damage.type` → `s.usage.damageType` → `s.strikes[0].damageType`）全空时兜底到
 * `bludgeoning`，也就是 `ELEMENT_LAYER.bludgeoning` = `jb2a.liquid.splash.red`。于是：
 *
 *   · life / soul 符文（crucible `const/spellcraft.mjs` 的 rune 表里两者都写着
 *     `restoration: true`）在**被治疗者**身上炸一团血；
 *   · 带 harmless / healing / rallying 标签的动作同样（施工清单 §0.9 实测其它动作块 28 条）。
 *
 * 施工清单 §0.8 / §0.9。修法落在 `scripts/armory/impact.mjs` 的 `isBenign()` 与元素层
 * 闸门上；本文件是它的守卫。
 *
 * ## 语料
 *
 * 主语料 `test/fixtures/actions.json` 的 642 个 `healed` 字段**取值全是 0**
 * （`tools/dump-fixtures.mjs` 的注释自陈那条路径跑不到），所以「结算后真的治疗了」这一
 * 判据在主语料上一条都命中不了。批次 A 新增的 `test/fixtures/edge-cases.json` 补上了这个
 * 缺口：`edge.heal.{life,soul}.<17 个手势>` 共 34 条带 `healed: 8 / damage: null`，
 * 另有 `edge.heal.action.{healing,harmless}` 两条走标签那一支。本文件就吃这份语料。
 *
 * ## 反向也钉死
 *
 * 只断言「良性动作没有元素层」是不够的：把闸门写成 `if (false)` 同样能让它全绿，代价是
 * 12 种伤害类型的元素层集体消失。所以同一份语料里的**非良性**动作必须仍然出元素层、
 * 仍然出血溅，两侧一起断言。
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {resolve} from "../scripts/resolver/resolve.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import {ELEMENT_LAYER, RESTORATION_LAYER, isBenign, restorationFor} from "../scripts/armory/impact.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const edge = JSON.parse(readFileSync(join(ROOT, "test/fixtures/edge-cases.json"), "utf8"));
const actions = JSON.parse(readFileSync(join(ROOT, "test/fixtures/actions.json"), "utf8"));
const mk = () => createAssets(offlineBackend(index));

/**
 * 血溅那条素材解析出来的全部候选文件。
 * 判据取自 `ELEMENT_LAYER.bludgeoning.path` 而不是硬写文件名：兵库哪天把物理三系换成
 * eskie（施工清单 §0.15 / 批次 D1 要做的事），这条守卫要跟着换、而不是变成空转。
 */
const SPLASH = (() => {
  const r = mk().resolve(ELEMENT_LAYER.bludgeoning.path);
  assert.ok(r?.files?.length, `解析不出 ${ELEMENT_LAYER.bludgeoning.path}，本文件失去判据`);
  return new Set(r.files);
})();

const plan = s => resolve(s, {assets: mk(), armory: ARMORY});
const cuesOf = s => plan(s)?.cues ?? [];

/** 这条动作在这份语料里算不算良性（逐目标判，只要有一个目标是良性就算命中这条支路）。 */
const benignAction = a => (a.targets ?? []).some(t => isBenign(a, t));

test("语料自查：edge-cases 真的覆盖了治疗与 harmless 两条支路", () => {
  const tagged = edge.filter(a => (a.tags ?? [])
    .some(t => ["harmless", "healing", "rallying"].includes(t)));
  const healed = edge.filter(a => (a.targets ?? [])
    .some(t => t.healed > 0 && !(t.damage?.total > 0)));
  assert.ok(tagged.length >= 2,
    `edge-cases 里带 harmless/healing/rallying 标签的动作只有 ${tagged.length} 条`);
  // 28 = life/soul 34 条（17 手势 × 2 符文）里带目标的 26 条 + healing/harmless 两条动作。
  // 少掉的 8 条正是 aspect / conjure / create / ward 四个手势 × 2 符文——它们零目标、
  // 本来就不产 impact，与施工清单 §0.8 的实测（「四手势零目标不产 impact」）逐条对上。
  assert.ok(healed.length >= 28,
    `edge-cases 里「治疗了但没造成伤害」的动作只有 ${healed.length} 条——`
    + "life/soul 那一族是这条守卫的主体，缺了就只剩标签那一支");
  // 主语料确实还是那个盲区：这句不是装饰，它说明为什么本文件必须另开一份语料。
  assert.equal(actions.filter(a => (a.targets ?? []).some(t => t.healed > 0)).length, 0,
    "主语料的 healed 不再恒为 0 了——那说明 dump-fixtures 已经能产出治疗样本，"
    + "本文件可以（也应该）把断言扩到主语料上");
});

test("良性动作（治疗 / harmless）不出元素层，一滴血都不许有", () => {
  const withElement = [];
  const withSplash = [];
  let checked = 0;
  for (const a of edge) {
    if (!benignAction(a)) continue;
    const cues = cuesOf(a);
    if (!cues.length) continue;                 // 零目标手势（aspect/conjure/ward…）本就不产 impact
    checked++;
    for (const c of cues) {
      if (c.layer === "element") withElement.push(`${a.id} ${c.slot}/${c.rule}`);
      if (c.file && SPLASH.has(c.file)) withSplash.push(`${a.id} ${c.slot}/${c.rule} ${c.file}`);
    }
  }
  assert.ok(checked >= 20,
    `只有 ${checked} 条良性动作真的出了 cue，样本太少，这条断言接近空真`);
  assert.deepEqual(withElement.slice(0, 8), [],
    `${withElement.length} 条良性动作仍在叠元素层。元素层回答的是「打中了什么属性」，`
    + "而治疗没有属性可言，兜底键又恰好是血溅——见 impact.mjs 的 isBenign()");
  assert.deepEqual(withSplash.slice(0, 8), [],
    `${withSplash.length} 条 cue 在被治疗者身上播血溅（${ELEMENT_LAYER.bludgeoning.path}）`);
});

test("反向：非良性动作照旧出元素层与血溅，闸门不许一刀切", () => {
  const hostile = edge.filter(a => !benignAction(a));
  assert.ok(hostile.length >= 40, `edge-cases 里的非良性动作只有 ${hostile.length} 条`);
  let element = 0, splash = 0;
  for (const a of hostile) {
    for (const c of cuesOf(a)) {
      if (c.layer === "element") element++;
      if (c.file && SPLASH.has(c.file)) splash++;
    }
  }
  assert.ok(element > 20,
    `非良性动作只出了 ${element} 条元素层——闸门开得太大，把正常的命中反馈也关掉了`);
  assert.ok(splash > 0,
    "非良性动作一条血溅都不出了：物理伤害的元素层是这条闸门最容易误伤的一档");
});

/* ------------------------------------------------------------------ *
 *  治疗汇聚层（批次 D2 / 施工清单 §0.8）
 *
 *  上面三条守的是「别喷血」这半句。这一节守另外半句：真的治到人时，impact 槽必须说出
 *  「他被治好了」，而不是留着结果层那记命中火光——那记火光打在被治疗者身上读作「他挨了
 *  一下」，与血溅是同一类错，只是没那么刺眼。
 * ------------------------------------------------------------------ */

/** 治疗层素材解析出来的全部候选文件（判据取自表，不硬写文件名，理由同 SPLASH）。 */
const RESTORE = (() => {
  const r = mk().resolve(RESTORATION_LAYER.health.path);
  assert.ok(r?.files?.length, `解析不出 ${RESTORATION_LAYER.health.path}，本节失去判据`);
  return new Set(r.files);
})();

/** 结果层 HIT 那条命中火光的候选文件——治疗时它必须让位。 */
const HIT_BURST = (() => {
  const r = mk().resolve("jb2a.impact.005.white");
  assert.ok(r?.files?.length, "解析不出结果层 HIT 素材，本节失去判据");
  return new Set(r.files);
})();

test("真的治到人时，impact 槽出治疗汇聚层，且结果层让位", () => {
  // life 符文回 health，soul 回 morale；现在只有 health 这一行有登记好的素材，
  // 所以下面按 usage.resource 分两半断言——morale 那半是**明确的空缺**，不是漏测。
  const healed = edge.filter(a => (a.targets ?? [])
    .some(t => t.healed > 0 && !(t.damage?.total > 0)));
  const withRestore = [], stillBurst = [];
  let health = 0, morale = 0;
  for (const a of healed) {
    const cues = cuesOf(a).filter(c => c.slot === "impact");
    if (!cues.length) continue;
    const rest = cues.filter(c => c.layer === "restoration");
    if (a.usage?.resource === "health") {
      health++;
      if (!rest.length) withRestore.push(`${a.id} 没有治疗层`);
      for (const c of rest) {
        if (!RESTORE.has(c.file)) withRestore.push(`${a.id} 治疗层用了 ${c.file}`);
      }
      // 结果层让位：同一个目标上不许再出那记命中火光
      for (const c of cues) {
        if (c.layer === "result" || (c.file && HIT_BURST.has(c.file))) {
          stillBurst.push(`${a.id} ${c.rule}/${c.layer} ${c.file}`);
        }
      }
    } else {
      morale++;
      assert.equal(rest.length, 0,
        `${a.id}（resource=${a.usage?.resource}）出了治疗层——RESTORATION_LAYER 里没有这一行，`
        + "解析得出来只能说明有人把 health 那支医疗十字扣到了士气恢复上");
    }
  }
  // 样本量下限只钉 health 这一半，而且钉得比实测（13）低两档。
  // 为什么不钉 morale：那一半是**负向**断言（不许出治疗层），一条 cue 都不出时它照样成立，
  // 不存在空真风险；而「这个手势还出不出 impact cue」取决于 travel/cast 那边的规则，
  // 不该由本文件的下限去约束别的槽——批次 C 并行改 cast/travel 时实测就抖过一次（13→11）。
  assert.ok(health >= 10, `只有 ${health} 条 health 治疗动作出了 impact cue，样本太少`);
  // 语料自查（这一条才是「morale 那半有没有被测到」的正确问法：问语料，不问计划）
  const moraleFixtures = healed.filter(a => a.usage?.resource === "morale");
  assert.ok(moraleFixtures.length >= 12,
    `edge-cases 里 morale 治疗只有 ${moraleFixtures.length} 条，morale 那半失去意义`
    + `（实际参与断言的是其中出了 impact cue 的 ${morale} 条）`);
  assert.deepEqual(withRestore.slice(0, 8), [], withRestore.join("\n"));
  assert.deepEqual(stillBurst.slice(0, 8), [],
    `${stillBurst.length} 条治疗仍然在被治疗者身上炸结果层的命中火光：\n${stillBurst.slice(0, 8).join("\n")}`);
});

test("反向：正常攻击不许出治疗层，暴击治疗不许震屏", () => {
  const hostile = edge.filter(a => !benignAction(a));
  let checked = 0;
  for (const a of hostile) {
    for (const c of cuesOf(a)) {
      assert.notEqual(c.layer, "restoration", `${a.id} 是敌对动作，却出了治疗层`);
      if (c.file) assert.ok(!RESTORE.has(c.file), `${a.id} 在敌对动作里播了治疗素材 ${c.file}`);
    }
    checked++;
  }
  assert.ok(checked >= 40, `非良性样本只有 ${checked} 条`);

  // 暴击治疗：结果层让位之后震屏也必须跟着让位。抖动读作「挨了重击」，把它留在治疗上
  // 与 §0.8 要修的是同一类错。合成快照——语料里没有「暴击 + 治疗」这个组合。
  const src = edge.find(a => a.usage?.resource === "health"
    && (a.targets ?? []).some(t => t.healed > 0));
  assert.ok(src, "edge-cases 里找不到 health 治疗样本");
  const crit = {...src, targets: src.targets.map(t => ({...t, results: [{result: 7, critical: true}]}))};
  const critCues = plan(crit)?.cues ?? [];
  assert.equal(critCues.filter(c => c.kind === "shake").length, 0,
    "暴击治疗把被治疗者的贴图抖了一下——那是「挨了重击」的读法");
  assert.ok(critCues.some(c => c.layer === "restoration"), "暴击治疗反而没出治疗层");
});

test("判据本身：restorationFor 只认结算之后真的发生了的事", () => {
  const t = (over = {}) => ({tokenId: "t", healed: 0, damage: {total: 8}, ...over});
  const s = (over = {}) => ({tags: [], usage: {resource: "health"}, ...over});
  // 真治疗：healed>0 且这一路没造成伤害
  assert.equal(restorationFor(s(), t({healed: 8, damage: null}))?.key, "health");
  // 又治又打（吸血一类）：不换层，那一下确实打了人——与 isBenign 的第 3 条同源
  assert.equal(restorationFor(s(), t({healed: 8})), null);
  // healed 恒 0 的主语料形态：不许误判
  assert.equal(restorationFor(s(), t({healed: 0, damage: null})), null);
  // 只带 healing 标签、没治到任何人：不出治疗层（tags 那一支归 isBenign 管，判得宽没有代价，
  // 但「他被治好了」这句具体的话不能凭标签说）
  assert.equal(restorationFor(s({tags: ["healing"]}), t({healed: 0, damage: null})), null);
  // 表里没有的资源：返回 null 让结果层照原样出，兜底 > 错配
  assert.equal(restorationFor(s({usage: {resource: "morale"}}), t({healed: 8, damage: null})), null);
  assert.equal(restorationFor(s({usage: {}}), t({healed: 8, damage: null})), null);
  // 缺字段不许抛
  assert.equal(restorationFor(undefined, undefined), null);
});

test("判据本身：isBenign 逐条对得上快照字段", () => {
  const t = (over = {}) => ({tokenId: "t", healed: 0, damage: {total: 8}, ...over});
  // 标签那一支：三个标签都算（healing/rallying 的 prepare() 都写 usage.restoration = true，
  // 但 restoration 是派生字段、没进快照，所以判 tags）
  for (const tag of ["harmless", "healing", "rallying"]) {
    assert.equal(isBenign({tags: [tag]}, t()), true, `${tag} 标签应当算良性`);
  }
  assert.equal(isBenign({tags: ["strike", "melee"]}, t()), false);
  // 结算那一支：治疗了且这一路没造成伤害
  assert.equal(isBenign({tags: []}, t({healed: 8, damage: null})), true);
  // 又治疗又造成伤害（吸血一类）：仍然要出元素层，那一下确实打了人
  assert.equal(isBenign({tags: []}, t({healed: 8})), false);
  // healed 恒 0 的主语料形态：不许误判成良性，否则全语料的元素层集体消失
  assert.equal(isBenign({tags: []}, t({healed: 0, damage: null})), false);
  // 缺字段不许抛
  assert.equal(isBenign(undefined, undefined), false);
});
