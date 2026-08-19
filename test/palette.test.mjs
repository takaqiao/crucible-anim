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

test("COLOR_HUE 的每个键都是真实颜色段（兄弟关系验证）", () => {
  const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));

  // 种子集：绝对无歧义的颜色名
  const SEED_COLORS = new Set(["blue", "green", "red", "purple", "orange", "yellow"]);

  // 非颜色词黑名单（参数词、索引号等）
  const NON_COLOR_WORDS = new Set([
    "intro", "outro", "01", "02", "03", "04", "05", "06", "07", "08", "09",
    "001", "002", "003", "004", "005", "006", "007", "008", "009", "010",
    "011", "012", "013", "014",
    "reversed", "standard", "loop", "still_frame",
    "001_reversed", "01_reversed",
    "deployed", "reserve", "sequence",
    "fast", "slow", "normal", "veryfast",
    "single", "few", "many",
    "small", "large", "complete",
    "particles", "particles_only", "no_base", "no_ring",
    "ring", "circle", "deployed",
    "refraction", "rainbow",
    "200px", "400px", "1200",
    "rock", "shrapnel", "ground_crack", "side_fracture", "top_fracture",
    "standard", "reversed", "still_frame", "textured", "unlit", "extinguished", "multicolored",
    "water", "earth", "fire", "poison", "sound"
  ]);

  // 递归收集所有「颜色选择分组」的子键
  const colorSegments = new Set();
  function traverse(node, depth = 0) {
    if (!node || typeof node !== 'object' || depth > 20) return;
    for (const key in node) {
      if (key.startsWith('_')) continue;
      const child = node[key];
      if (typeof child === 'object' && child !== null) {
        const childKeys = Object.keys(child).filter(k => !k.startsWith('_'));
        const seedCount = childKeys.filter(k => SEED_COLORS.has(k)).length;

        // 识别颜色分组：≥2 个种子颜色，且多数键看起来像颜色（不在黑名单中）
        if (seedCount >= 2) {
          const colorLikeKeys = childKeys.filter(k => !NON_COLOR_WORDS.has(k));
          const ratio = colorLikeKeys.length / childKeys.length;

          // 如果颜色词占比 ≥ 60%，认定这是一个选色分组
          if (ratio >= 0.6) {
            colorLikeKeys.forEach(k => colorSegments.add(k));
          }
        }

        traverse(child, depth + 1);
      }
    }
  }
  traverse(index.tree);

  // 白名单：在 COLOR_HUE 中但在索引中确实不出现的颜色
  const UNUSED_COLORS = new Set();

  // 验证 COLOR_HUE 的每个键都在识别出的颜色分组中
  for (const key of Object.keys(COLOR_HUE)) {
    const isColorSegment = colorSegments.has(key);
    const whitelisted = UNUSED_COLORS.has(key);
    assert.ok(isColorSegment || whitelisted,
      `键 '${key}' 不存在于任何颜色分组中`);
  }
});
