import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {resolve} from "../scripts/resolver/resolve.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import cast from "../scripts/armory/cast.mjs";
import {RUNE_COLOR} from "../scripts/resolver/palette.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const actions = JSON.parse(readFileSync(join(ROOT, "test/fixtures/actions.json"), "utf8"));
const mk = () => createAssets(offlineBackend(index));
const byId = id => actions.find(a => a.id === id);
// cast 槽的**画面** cue。法术现在还会发一条施法音，它排在画面之前（见 armory/sounds.mjs），
// 用 find 会取到声音。
const castCue = s => resolve(s, {assets: mk(), armory: ARMORY})?.cues
  .find(c => c.slot === "cast" && c.kind !== "sound");

test("规则表规模与 pri 区间合法", () => {
  assert.ok(cast.length >= 9, `只有 ${cast.length} 条规则`);
  for (const r of cast) {
    assert.equal(typeof r.id, "string");
    assert.ok(r.pri >= 0 && r.pri < 1000, `${r.id} 的 pri 越界`);
    assert.equal(typeof r.when, "function");
    assert.equal(typeof r.build, "function");
  }
  const ids = cast.map(r => r.id);
  assert.equal(new Set(ids).size, ids.length, "规则 id 重复");
});

test("ward 姿态命中专属规则而非通用施法圈", () => {
  const c = castCue(byId("spell.frost.ward"));
  assert.equal(c?.rule, "spell.gesture.ward");
});

test("未特化的姿态回落到通用法术规则", () => {
  const c = castCue(byId("spell.storm.surge"));
  assert.equal(c?.rule, "spell.composed");
});

test("12 个符文的通用施法圈都能解析、颜色各异，且色相补偿确实生效", () => {
  // 阈值原为 >= 6：把 spell.composed 的 filter 硬改成恒 null 也能通过（12 个符文本身
  // 就落到 8 个不同 file，只看 file 这一半就已经 >= 6）。收紧到 >= 10（12 符文里最多
  // 允许 2 个因为映射到同一个 RUNE_COLOR 目标色而真正撞车，如 kinesis/soul 都是 teal），
  // 并单独断言足够多的符文带非零 hue——这才是「色相补偿没被整体丢弃」的直接证据。
  const files = new Set();
  let withHue = 0;
  for (const rune of ["control", "death", "earth", "flame", "frost", "illumination",
                      "illusion", "kinesis", "life", "oblivion", "soul", "storm"]) {
    const c = castCue(byId(`spell.${rune}.surge`));
    assert.ok(c?.file, `${rune} 无 cast 特效`);
    files.add(`${c.file}|${JSON.stringify(c.filter)}`);
    if (c.filter?.data?.hue) withHue++;
  }
  // 【2026-08-29 换判据】原来是 `files.size >= 10` + `withHue >= 5`。
  //
  // `withHue >= 5` 是个**方向反了的代理指标**：它把「需要色相旋转」当成「配色在起作用」，
  // 而色相旋转是**退而求其次**——能精确取到目标色分支时根本不该旋转（旋转会连带
  // 改掉饱和度与所有非目标色的像素）。D6 给 `COLOR_HUE` 补齐了 eskie/jb2a 的色名之后，
  // `pickColor` 认得出的分支从 2 支涨到全部，于是 12 个符文里 8 个**精确命中**、
  // 只剩 4 个需要补偿——判别度更高了，这条断言却因此转红。
  //
  // 换成直接量**判别度本身**：12 个符文必须产出 12 种互不相同的 (文件, 滤镜) 组合。
  //
  // ⚠ 它盖不住的那一半在下一条用例里：这个槽从 D4 起走**学派轴**选圈，
  // 学派已经把符文分开了，所以就算两个符文的 `RUNE_COLOR` 撞色，这里也照样 12 种
  // （实测把 kinesis 改回 teal 与 soul 撞色，这条断言**不会红**）。
  // 撞色的真实代价在**只有颜色轴、没有学派轴**的族上（武器、元素层），
  // 那必须由下面那条直接查 RUNE_COLOR 的守卫来钉。
  assert.equal(files.size, 12,
    `12 个符文只产出 ${files.size} 种 (文件,滤镜) 组合——每个符文都该有自己的施法圈。`
    + "塌成少数几种说明学派轴或颜色轴有一条没起作用。");
  // 补偿仍然要在：全部精确命中固然更好，但那说明的是素材恰好齐全，不是补偿被删了。
  // 只要还有符文取不到精确分支，它就必须带非零 hue——0 意味着 pickColor 的补偿被绕过。
  assert.ok(withHue > 0,
    "一个符文都不带色相补偿：要么 12 个符文恰好全部精确命中（那就把这条改成 equal(0) 并写清），"
    + "要么 pickColor 的 hue 返回值在半路被丢掉了");
});

/**
 * **12 个符文的主色必须两两不同。**
 *
 * `pickColor` 是按目标色去族里取最近分支的，所以两个符文一旦映射到同一个 `RUNE_COLOR`，
 * 它们在**每一个带颜色轴的族**上都会取到同一支、带同样的 hue——两条符文线从此逐字相同。
 * 这是 owner 那条 KPI（「尽量不复用」）在符文轴上的最小要求。
 *
 * 上面那条 `files.size === 12` **守不住这件事**：cast 槽从 D4 起走学派轴选圈，
 * 学派已经把符文分开了，撞色在那里看不出来。实测把 kinesis 改回 teal（与 soul 同色），
 * 那条照样绿，这一条才转红。
 *
 * 历史：kinesis 与 soul 原本同为 `teal`——12 符文里唯一一对撞色。2026-08-29 按 Crucible
 * 自己逐符文钉的辉光色改开：kinesis `#d7d7d7`（浅灰，12 条里唯一无彩的，对应「动能是力场
 * 不是元素」）、soul `#00faff`（青）。
 */
test("12 个符文的主色两两不同", () => {
  const byColor = new Map();
  for (const [rune, color] of Object.entries(RUNE_COLOR)) {
    if (!byColor.has(color)) byColor.set(color, []);
    byColor.get(color).push(rune);
  }
  const clashes = [...byColor].filter(([, runes]) => runes.length > 1)
    .map(([color, runes]) => `${color} ← ${runes.join(" / ")}`);
  assert.deepEqual(clashes, [],
    "两个符文映射到同一个主色，它们在每个带颜色轴的族上都会取到同一支素材。"
    + "改色时以 Crucible 自己 `RUNES` 里那条辉光色为准，别凭意象猜。");
  assert.equal(Object.keys(RUNE_COLOR).length, 12, "RUNE_COLOR 必须覆盖全部 12 个符文");
});

test("conjure 姿态命中专属的召唤法阵规则", () => {
  const c = castCue(byId("spell.control.conjure"));
  assert.equal(c?.rule, "spell.gesture.conjure");
});

test("aspect 姿态命中专属的自身增益规则", () => {
  const c = castCue(byId("spell.control.aspect"));
  assert.equal(c?.rule, "spell.gesture.aspect");
});

test("healing 标签命中手部绿光规则", () => {
  const c = castCue(byId("medicinalCompound"));
  assert.equal(c?.rule, "tag.healing");
});

test("skill 标签（不带 healing）命中轻量闪光规则", () => {
  const c = castCue(byId("alchemicalResolve"));
  assert.equal(c?.rule, "tag.skill");
});

test("重武器近战不出 cast 内容", () => {
  const s = {...byId("strike"), strikes: [{category: "heavy2", damageType: "slashing"}]};
  assert.equal(castCue(s), undefined);
});

test("弓弩起手带音效轨", () => {
  const s = {...byId("strike"), strikes: [{category: "projectile2", damageType: "piercing"}],
             usage: {...byId("strike").usage, isRanged: true}};
  const plan = resolve(s, {assets: mk(), armory: ARMORY});
  const sounds = plan.cues.filter(c => c.slot === "cast" && c.kind === "sound");
  assert.ok(sounds.length >= 1, "拉弓应有弓弦音");
  assert.ok(sounds[0].file);
});

test("cast 规则不引用绝对路径", () => {
  const src = readFileSync(join(ROOT, "scripts/armory/cast.mjs"), "utf8");
  assert.ok(!src.includes("modules/"), "兵库里出现了绝对路径，必须走 ctx.pick");
});
