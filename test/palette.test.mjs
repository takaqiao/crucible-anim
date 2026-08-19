import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {RUNE_COLOR, DAMAGE_COLOR, COLOR_HUE, hueDelta, pickColor}
  from "../scripts/resolver/palette.mjs";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RUNES = ["control", "death", "earth", "flame", "frost", "illumination",
               "illusion", "kinesis", "life", "oblivion", "soul", "storm"];
const DAMAGE = ["bludgeoning", "corruption", "piercing", "slashing", "poison", "acid",
                "fire", "cold", "electricity", "psychic", "radiant", "void"];

test("12 个符文全部有配色", () => {
  for (const r of RUNES) {
    assert.ok(RUNE_COLOR[r], `符文 ${r} 缺配色`);
    assert.ok(COLOR_HUE[RUNE_COLOR[r]] !== undefined, `颜色 ${RUNE_COLOR[r]} 不在色相表中`);
  }
  assert.equal(Object.keys(RUNE_COLOR).length, 12);
});

test("12 个伤害类型全部有条目，物理三种为 null", () => {
  for (const d of DAMAGE) assert.ok(d in DAMAGE_COLOR, `伤害类型 ${d} 缺条目`);
  for (const d of ["bludgeoning", "piercing", "slashing"]) {
    assert.equal(DAMAGE_COLOR[d], null, `${d} 是物理伤害，不应配色`);
  }
  for (const d of DAMAGE.filter(x => !["bludgeoning", "piercing", "slashing"].includes(x))) {
    assert.ok(COLOR_HUE[DAMAGE_COLOR[d]] !== undefined, `${d} 的颜色不在色相表中`);
  }
});

test("hueDelta 走最短弧且带符号", () => {
  assert.equal(hueDelta("blue", "blue"), 0);
  assert.ok(Math.abs(hueDelta("red", "orange")) <= 60);
  const d = hueDelta("red", "purple");
  assert.ok(d >= -180 && d <= 180, `越界: ${d}`);
  // dark_red: 355 → red: 0 应是 +5 而不是 -355
  assert.equal(hueDelta("dark_red", "red"), 5);
});

test("pickColor 在实际可用颜色中取最近色并给出补偿量", () => {
  const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
  const assets = createAssets(offlineBackend(index));
  const p = "jb2a.melee_attack.01.magic_sword";
  const exact = pickColor(assets, p, "blue");
  assert.equal(exact.color, "blue");
  assert.equal(exact.hue, 0, "精确命中不应有色相补偿");

  const near = pickColor(assets, p, "red");
  assert.ok(assets.colorsUnder(p).includes(near.color), "必须返回实际存在的颜色");
  assert.notEqual(near.hue, 0, "取了近似色就应给出补偿量");
});

test("特效没有任何颜色分支时返回空颜色且不补偿", () => {
  const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
  const assets = createAssets(offlineBackend(index));
  const r = pickColor(assets, "完全不存在的路径", "blue");
  assert.equal(r.color, null);
  assert.equal(r.hue, 0);
});

test("映射值可达性：12个符文+9个伤害类型的配色都能精确命中至少一条路径", () => {
  const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
  const assets = createAssets(offlineBackend(index));

  // 收集所有待验证的值：12个符文 + 9个非物理伤害
  const mappedValues = new Set();
  for (const color of Object.values(RUNE_COLOR)) {
    mappedValues.add(color);
  }
  for (const color of Object.values(DAMAGE_COLOR)) {
    if (color !== null) {
      mappedValues.add(color);
    }
  }

  // 收集所有含颜色分支的父节点路径
  const colorParentPaths = [];
  function traverse(node, path = '') {
    if (!node || typeof node !== 'object') return;
    for (const key in node) {
      if (key.startsWith('_')) continue;
      const child = node[key];
      const newPath = path ? path + '.' + key : key;
      if (typeof child === 'object' && child !== null) {
        // 检查这个节点是否是颜色分组（至少有一个字母键）
        const childKeys = Object.keys(child).filter(k => !k.startsWith('_'));
        if (childKeys.some(k => /^[a-z]/.test(k))) {
          colorParentPaths.push(newPath);
        }
        traverse(child, newPath);
      }
    }
  }
  traverse(index.tree);

  // 对每个映射值，验证至少能精确命中一条路径
  const hitRecord = {};
  const failures = [];

  for (const value of mappedValues) {
    let found = false;
    for (const path of colorParentPaths) {
      const result = pickColor(assets, path, value);
      if (result.color === value && result.hue === 0) {
        hitRecord[value] = path;
        found = true;
        break;
      }
    }
    if (!found) {
      // 找出是哪个符文或伤害类型映射到这个值
      let source = '';
      for (const [k, v] of Object.entries(RUNE_COLOR)) {
        if (v === value) source = `RUNE_COLOR.${k}`;
      }
      for (const [k, v] of Object.entries(DAMAGE_COLOR)) {
        if (v === value) source = `DAMAGE_COLOR.${k}`;
      }
      failures.push(`${source} → '${value}'`);
    }
  }

  assert.equal(failures.length, 0,
    `以下映射值无法精确命中任何路径:\n${failures.join('\n')}`);

  // 记录用于后续参考
  if (global.TEST_MAPPING_HITS === undefined) {
    global.TEST_MAPPING_HITS = hitRecord;
  }
});

test("COLOR_HUE键的可达性：每个键至少在某个colorsUnder结果里出现", () => {
  const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
  const assets = createAssets(offlineBackend(index));

  // 收集所有含颜色分支的父节点路径
  const colorParentPaths = [];
  function traverse(node, path = '') {
    if (!node || typeof node !== 'object') return;
    for (const key in node) {
      if (key.startsWith('_')) continue;
      const child = node[key];
      const newPath = path ? path + '.' + key : key;
      if (typeof child === 'object' && child !== null) {
        const childKeys = Object.keys(child).filter(k => !k.startsWith('_'));
        if (childKeys.some(k => /^[a-z]/.test(k))) {
          colorParentPaths.push(newPath);
        }
        traverse(child, newPath);
      }
    }
  }
  traverse(index.tree);

  // 对 COLOR_HUE 的每个键，检查是否在某个 colorsUnder 结果里出现
  const UNUSED_COLORS = new Set();
  const missingKeys = [];

  for (const key of Object.keys(COLOR_HUE)) {
    let found = false;
    for (const path of colorParentPaths) {
      const colors = assets.colorsUnder(path);
      if (colors.includes(key)) {
        found = true;
        break;
      }
    }
    if (!found && !UNUSED_COLORS.has(key)) {
      missingKeys.push(key);
    }
  }

  assert.equal(missingKeys.length, 0,
    `以下颜色键不可达:\n${missingKeys.join(', ')}`);
});
