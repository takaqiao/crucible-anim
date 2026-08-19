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

test("COLOR_HUE 的每个键都在素材库索引中实际存在", () => {
  const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));

  // 收集索引中所有字母数字（可含下划线）的叶子键名
  const colorSet = new Set();
  function traverse(node, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 10) return;
    for (const key in node) {
      if (key.startsWith('_')) continue;
      const child = node[key];
      if (typeof child === 'string' && /^[a-z_]+$/.test(key)) {
        colorSet.add(key);
      } else if (typeof child === 'object' && child !== null) {
        traverse(child, depth + 1);
      }
    }
  }
  traverse(index.tree);

  // 白名单：在表中但素材库真实不存在的颜色（含原因和出现次数）
  // 当前应该为空，因为所有双色混合已改用无下划线版本
  const UNUSED_COLORS = new Set();

  // 验证 COLOR_HUE 的每个键
  for (const key of Object.keys(COLOR_HUE)) {
    const found = colorSet.has(key);
    const whitelisted = UNUSED_COLORS.has(key);
    assert.ok(found || whitelisted,
      `颜色 '${key}' 既不在索引中实际存在，也不在白名单中`);
  }
});
