/**
 * D3 隔格 + D9 武器身份 —— `armory/weapon-shapes.mjs` 的形制守卫。
 *
 * ## 为什么不并进 `weapon-dispatch.test.mjs`
 *
 * 那边的 `measure()` 只取 `travel[0].file`，而武器语料的 `targets[0]` 恒为
 * `adjacent: true`——**隔格那半边对它结构性不可见**（施工清单 §0.14 点名的盲区）。
 * 本文件绕开 resolve、直接量 `weapon-shapes.mjs` 导出的表与函数，因此
 * ①不受隔格语料缺失的影响；②不受同批其它 agent 改兵库规则的影响。
 *
 * 定义域全部来自枚举（`data/weapons.json` + `data/asset-index.json`），不手写清单。
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {pickFor, reachFor, REACH_SHAPE, isBoneBlade} from "../scripts/armory/weapon-shapes.mjs";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const {weapons, count} = JSON.parse(readFileSync(join(ROOT, "data/weapons.json"), "utf8"));
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const assets = createAssets(offlineBackend(index));

/**
 * 「够得到隔一格」的分类。取自 Crucible `const/weapon.mjs` 的 CATEGORIES：
 * `range >= 2` 的是 balanced1(2) / heavy1(2) / simple2(2) / balanced2(3) / heavy2(3)；
 * unarmed / light1 / simple1 与两种盾都是 range 1，走不到隔格分支。
 */
const REACHY = new Set(["balanced1", "heavy1", "simple2", "balanced2", "heavy2"]);
const far = weapons.filter(w => REACHY.has(w.category));
const byId = id => weapons.find(w => w.identifier === id);

test("语料完整性：weapons.json 里够得到隔格的正是 48 件（其中 28 件天生武器）", () => {
  assert.ok(count >= 90, `只枚举到 ${count} 件武器，包路径是不是变了？`);
  assert.equal(far.length, 48, `range>=2 的武器数变成 ${far.length}——CATEGORIES 或武器表变了`);
  assert.equal(far.filter(w => w.properties.includes("natural")).length, 28);
});

test("D3 隔格：48 件武器不再塌成同一记野太刀", () => {
  const buckets = new Map();
  for (const w of far) {
    const p = reachFor(w)?.path ?? "(兜底)";
    if (!buckets.has(p)) buckets.set(p, []);
    buckets.get(p).push(w.identifier);
  }
  const biggest = [...buckets.values()].sort((a, b) => b.length - a.length)[0] ?? [];
  // 改造前：`travel.mjs` 的隔格分支是一个常量 `nodachi`，48 件全在一桶（路径 1 / 最大桶 48）。
  // 改造后实测：路径 20 / 最大桶 12。桶里那 12 件是 bite 族（12 件咬击共用一张獠牙大口，
  // 元素变体再按颜色轴分开）——**语义正确的复用**，不许为了把数字做小而乱配。
  assert.ok(buckets.size >= 18,
    `隔格只派发出 ${buckets.size} 条不同路径（下限 18，改造前是 1）——` +
    "reachFor 是不是又退回常量了？");
  assert.ok(biggest.length <= 14,
    `隔格最大碰撞桶 ${biggest.length} 件（上限 14，改造前是 48）：${biggest.join(", ")}`);
});

test("D3 隔格：天生武器绝不换成金属刀光", () => {
  // ASSET-NOTES 的 D3 一节明写「天生武器隔格时保持 bite / claws 本族，绝不换成金属刀光」。
  // 判据独立算：不引用 REACH_SHAPE，直接看隔格路径是不是与贴身同一支，且不落进
  // 那几个金属形制族里。
  const METAL = /^jb2a\.melee_attack\.\d+\.(shortsword|katana|scimitar|khybersword|greatsword|handaxe|battleaxe|greataxe|nodachi|scythe|flail|chakram|club|mace|warhammer|hammer|maul|greatclub|magic_sword|magical_greatsword)/;
  const bad = [];
  for (const w of far.filter(x => x.properties.includes("natural"))) {
    const near = pickFor(w)?.path ?? null;
    const reach = reachFor(w)?.path ?? null;
    if (reach !== near) bad.push(`${w.identifier}: 贴身 ${near} → 隔格 ${reach}`);
    if (reach && METAL.test(reach)) bad.push(`${w.identifier}: 隔格落到金属形制 ${reach}`);
  }
  assert.deepEqual(bad, [], `${bad.length} 件天生武器的隔格画面被换掉了：\n  ${bad.join("\n  ")}`);
});

test("D3 隔格：覆写表只收「素材库真有长打版」的那几件，且不许把长柄/巨兵换走", () => {
  // 覆写表天生该很短。这条守着它别膨胀成「第二张形制表」——那正是这一批要消灭的东西。
  assert.ok(Object.keys(REACH_SHAPE).length <= 4,
    `REACH_SHAPE 涨到 ${Object.keys(REACH_SHAPE).length} 条了：` +
    "隔格默认就该取贴身同一件武器的形状，覆写只留「真有长打版」的例外。");
  // 太刀 → 野太刀（长太刀）是唯一一条：全族唯一 1000x800 画幅，大幅过顶下劈。
  assert.equal(reachFor(byId("katana")).path, "jb2a.melee_attack.05.nodachi.01");
  // 长柄与巨兵**不许**被换走：scythe.01 的剪影辨识度是全族最高的一支，
  // greatsword/greataxe 的 .02 是 D9 刚配上的「认得出形制」的一支。
  for (const [id, want] of [["glaive", "jb2a.melee_attack.05.scythe.01"],
                            ["halberd", "jb2a.melee_attack.05.scythe.01"],
                            ["greatsword", "jb2a.melee_attack.03.greatsword.02"],
                            ["greataxe", "jb2a.melee_attack.03.greataxe.02"]]) {
    assert.equal(reachFor(byId(id)).path, want, `${id} 的隔格画面被换成了别的武器`);
  }
});

test("D9：四条新素材各自接上了对的武器", () => {
  // 判据逐条独立写死，不引用 WEAPON_SHAPE——引用它就退化成同义反复。
  assert.equal(pickFor(byId("chainHook")).path, "jb2a.melee_attack.01.flail.01",
    "链钩是「链上挂重物甩出去」，chakram 是脱手飞出的环形飞盘");
  assert.equal(pickFor(byId("greatsword")).path, "jb2a.melee_attack.03.greatsword.02",
    ".01 末端只有一条细长直线，token 尺寸下读不出是剑");
  const axe = pickFor(byId("greataxe"));
  assert.equal(axe.path, "jb2a.melee_attack.03.greataxe.02", ".01 的峰值帧上看不到斧头");
  assert.equal(axe.color, "white",
    "greataxe.02 有 9 色轴，不钉色支会一下蓝一下紫；white 是亮度安全档");
  for (const id of ["tusks", "horns"]) {
    assert.equal(pickFor(byId(id)).path, "jb2a.melee_attack.01.bonesword.01",
      `${id} 是骨刃（heavy1 / slashing 与 piercing），不是钝击`);
  }
});

test("D9：纯钝击的天生武器仍然落骨棒，thorns 仍然落爪痕", () => {
  // 兜底优于错配。ASSET-NOTES 的 bonesword 那一行专门警告过不许把这几件也改过来。
  for (const id of ["tail", "giantTail", "tentacles", "pseudopod"]) {
    assert.match(pickFor(byId(id)).path, /jb2a\.melee_attack\.0[23]\.(great)?bone\.01/,
      `${id} 是钝击/顶撞，该留在骨棒上`);
  }
  // `thorns`（荆棘）里含着 `horn`。骨刃判据必须是**整词**匹配，不能靠「CLAW_PARTS 排在
  // 前面先接走它」——那是靠顺序而不是靠判据，调换两行次序就会静默地把荆棘变成犄角。
  assert.equal(pickFor(byId("thorns")).path, "jb2a.claws.400px");
  // ⚠ 上面那句**单独用是空真的**：`pickFor` 里爪痕分支排在骨刃分支之前，`thorns` 永远
  // 先被爪痕接走，把整词匹配改回 `/tusk|horn/i` 也不会红——顺序替判据挡了枪。
  // 所以直接量谓词本身（这正是 isBoneBlade 导出的理由）。
  assert.equal(isBoneBlade("thorns"), false, "荆棘里含着 horn，整词匹配必须把它排除");
  assert.equal(isBoneBlade("tusks"), true);
  assert.equal(isBoneBlade("horns"), true);
  assert.equal(isBoneBlade("giantHorns"), true, "驼峰词也要切得开");
  assert.equal(isBoneBlade("thornedLimb"), false);
  assert.equal(pickFor(byId("hooves")).path, "jb2a.melee_generic.creature_attack.fist.001");
});

test("D3/D9：每件武器的贴身与隔格路径都能在 DB 里解析到真文件", () => {
  const bad = [];
  for (const w of weapons) {
    for (const [tag, r] of [["贴身", pickFor(w)], ["隔格", REACHY.has(w.category) ? reachFor(w) : null]]) {
      if (!r?.path) continue;
      const got = assets.resolve(r.color ? `${r.path}.${r.color}` : r.path);
      if (!got?.file) bad.push(`${w.identifier} ${tag}: ${r.path} 解析不出文件`);
    }
  }
  assert.deepEqual(bad, [], `${bad.length} 条形制路径解析不到文件：\n  ${bad.join("\n  ")}`);
});
