import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {resolve} from "../scripts/resolver/resolve.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import cast from "../scripts/armory/cast.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const actions = JSON.parse(readFileSync(join(ROOT, "test/fixtures/actions.json"), "utf8"));
const mk = () => createAssets(offlineBackend(index));
const byId = id => actions.find(a => a.id === id);
const castCue = s => resolve(s, {assets: mk(), armory: ARMORY})?.cues.find(c => c.slot === "cast");

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

test("12 个符文的通用施法圈都能解析且颜色各异", () => {
  const files = new Set();
  for (const rune of ["control", "death", "earth", "flame", "frost", "illumination",
                      "illusion", "kinesis", "life", "oblivion", "soul", "storm"]) {
    const c = castCue(byId(`spell.${rune}.surge`));
    assert.ok(c?.file, `${rune} 无 cast 特效`);
    files.add(`${c.file}|${JSON.stringify(c.filter)}`);
  }
  assert.ok(files.size >= 6, `12 个符文只产出 ${files.size} 种视觉，配色没起作用`);
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
