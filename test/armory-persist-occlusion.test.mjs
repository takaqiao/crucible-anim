/**
 * persist 槽的遮挡预算与分层守卫。
 *
 * 为什么需要：persist 是唯一一个**常驻**的槽，一个状态挂多久它就盖 token 多久，
 * 而 Crucible 一个 token 上同时挂三五个状态是常态。impact/travel 那种「半秒就没了」的
 * 判据在这里不适用——这里要守的是「不管挂了多少个状态，token 本身还看得清」。
 *
 * 能真正降低遮挡的字段只有 `belowTokens`。zIndex 改的是同层内的先后，而 N 层半透明
 * 叠加的合成不透明度 1−∏(1−aᵢ) 与顺序无关：12 条 zIndex 排一遍也不会少挡一个像素。
 * 所以本文件守两件事——**分层只有一套规则**，以及**能压在 token 之上的那几组，单独和
 * 叠加都在预算内**。
 *
 * 四条阈值的来历：
 *   MAX_VEIL 0.10   token 中心 40% 的常驻有效 alpha 到 10% 时，token 自身的明暗对比被
 *                   压掉约一成，观感从「围着 token 的标记」变成「盖在 token 上的一层膜」。
 *   MAX_PEAK 0.25   单帧峰值。短于半秒的脉冲读作动画而不是遮挡（haste 每 5.04s 两次
 *                   金色光条脉冲），但四分之一的对比度是上限。
 *   MAX_STACK 0.20  同时挂载时的合成遮挡，取单组线的两倍：设计上允许两条满预算的层叠，
 *                   第三条就必须接近零。
 *   MAX_DARK_HOLE 0.01
 *                   近黑（亮度<96）且近不透明（alpha>=200）的像素占比。这类像素不是蒙
 *                   一层膜，而是把 token 的像素整个换成黑——观感是在脸上打洞，与同样
 *                   alpha 的亮色完全不是一回事。opacity <= 0.75 时有效 alpha 数学上到
 *                   不了 0.75，打不出洞，这条豁免。
 *
 * OCCLUSION 里的数字全部来自 tools/persist-occlusion.mjs 对真实 webm 的逐帧解码
 * （libvpx/libvpx-vp9 解出 alpha 平面，与 tools/contact-sheet.sh 同法），改素材或改
 * objectScale 之后用那个脚本重算并粘回来。表与实现的对齐由下面第一条测试守着：
 * path 与 measuredScale 一旦和 GROUP_FX 对不上就红，绝不会拿陈旧的数字放行。
 *
 * 本文件不读任何 webm，只做插值与比较，整套跑完 <100ms。
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {resolveEffect} from "../scripts/resolver/resolve.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import {GROUP_FX, ABOVE_TOKENS, LAYER} from "../scripts/armory/persist.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const effects = JSON.parse(readFileSync(join(ROOT, "test/fixtures/effects.json"), "utf8"));
const mk = () => createAssets(offlineBackend(index));

const FACE = 0.4;
const MAX_VEIL = 0.10;
const MAX_PEAK = 0.25;
const MAX_STACK = 0.20;
const MAX_DARK_HOLE = 0.01;
/** 有效 alpha 低于这个值就不可能把 token 的像素换掉，暗洞一列自动豁免。 */
const HOLE_FLOOR = 0.75;
/** persist 标记必须自己盖住一格、又不许越进邻格：12 支内容占画幅 0.84-0.95，故取这个区间。 */
const SCALE_RANGE = [0.9, 1.25];
const OPACITY_RANGE = [0.5, 1.0];

/** tools/persist-occlusion.mjs 的输出，逐条对应 GROUP_FX 加一条兜底。 */
const OCCLUSION = {
  burning: {
    path: "eskie.burn.embers.orange", measuredScale: 1,
    alpha: [[0.20, 33.2], [0.25, 31.2], [0.30, 28.8], [0.35, 26.9], [0.40, 25.5], [0.45, 24.3], [0.50, 23.0], [0.60, 19.7], [0.70, 16.0], [0.85, 11.3], [1.00, 8.2]],
    peakRatio: 1.59, darkHole: 0.0005, outerFrac: 0.229
  },
  freezing: {
    path: "jb2a.markers.snowflake.blue.01", measuredScale: 1,
    alpha: [[0.20, 0.0], [0.25, 0.0], [0.30, 0.2], [0.35, 3.2], [0.40, 12.0], [0.45, 26.0], [0.50, 41.2], [0.60, 64.2], [0.70, 72.1], [0.85, 60.3], [1.00, 43.6]],
    peakRatio: 1.51, darkHole: 0.0000, outerFrac: 0.683
  },
  poison: {
    path: "jb2a.markers.poison.dark_green.01", measuredScale: 1,
    alpha: [[0.20, 0.0], [0.25, 0.0], [0.30, 0.6], [0.35, 3.8], [0.40, 13.2], [0.45, 28.6], [0.50, 46.1], [0.60, 69.9], [0.70, 72.1], [0.85, 56.1], [1.00, 40.6]],
    peakRatio: 1.57, darkHole: 0.0027, outerFrac: 0.592
  },
  decay: {
    path: "jb2a.markers.skull.purple.01", measuredScale: 1,
    alpha: [[0.20, 0.0], [0.25, 0.0], [0.30, 1.5], [0.35, 10.7], [0.40, 29.8], [0.45, 53.8], [0.50, 75.6], [0.60, 104.0], [0.70, 111.5], [0.85, 93.5], [1.00, 67.8]],
    peakRatio: 1.41, darkHole: 0.0771, outerFrac: 0.638
  },
  bleed: {
    path: "jb2a.markers.drop.red.01", measuredScale: 1,
    alpha: [[0.20, 0.2], [0.25, 0.2], [0.30, 0.2], [0.35, 0.2], [0.40, 1.1], [0.45, 5.2], [0.50, 14.6], [0.60, 40.7], [0.70, 53.4], [0.85, 42.3], [1.00, 30.6]],
    peakRatio: 2.38, darkHole: 0.0010, outerFrac: 0.836
  },
  stun: {
    path: "jb2a.markers.stun.dark_teal.01", measuredScale: 1,
    alpha: [[0.20, 0.0], [0.25, 0.0], [0.30, 0.1], [0.35, 1.6], [0.40, 6.8], [0.45, 16.6], [0.50, 28.1], [0.60, 47.5], [0.70, 52.8], [0.85, 43.6], [1.00, 31.5]],
    peakRatio: 1.89, darkHole: 0.0000, outerFrac: 0.680
  },
  fear: {
    path: "jb2a.markers.fear.dark_purple.01", measuredScale: 1,
    alpha: [[0.20, 0.0], [0.25, 0.0], [0.30, 0.0], [0.35, 0.1], [0.40, 1.5], [0.45, 7.0], [0.50, 19.2], [0.60, 50.9], [0.70, 64.7], [0.85, 51.7], [1.00, 37.4]],
    peakRatio: 2.58, darkHole: 0.0018, outerFrac: 0.811
  },
  hidden: {
    path: "jb2a.markers.smoke.ring.loop.bluepurple", measuredScale: 1,
    alpha: [[0.20, 0.0], [0.25, 0.0], [0.30, 0.0], [0.35, 0.2], [0.40, 1.0], [0.45, 4.1], [0.50, 11.3], [0.60, 30.2], [0.70, 41.2], [0.85, 32.0], [1.00, 23.2]],
    peakRatio: 1.49, darkHole: 0.0000, outerFrac: 0.872
  },
  haste: {
    path: "jb2a.markers.light.loop.yellow", measuredScale: 1.15,
    alpha: [[0.20, 9.3], [0.25, 14.6], [0.30, 19.1], [0.35, 22.5], [0.40, 24.3], [0.45, 25.2], [0.50, 25.3], [0.60, 24.0], [0.70, 21.1], [0.85, 15.4], [1.00, 11.2]],
    peakRatio: 2.51, darkHole: 0.0000, outerFrac: 0.353
  },
  slow: {
    path: "jb2a.markers.chain.standard.loop.01.grey", measuredScale: 1,
    alpha: [[0.20, 0.0], [0.25, 0.0], [0.30, 0.2], [0.35, 6.5], [0.40, 22.3], [0.45, 40.0], [0.50, 58.1], [0.60, 93.9], [0.70, 101.5], [0.85, 82.4], [1.00, 59.6]],
    peakRatio: 1.22, darkHole: 0.0498, outerFrac: 0.660
  },
  buff: {
    path: "jb2a.energy_field.01.green", measuredScale: 1.2,
    alpha: [[0.20, 0.0], [0.25, 0.0], [0.30, 0.0], [0.35, 0.9], [0.40, 4.6], [0.45, 12.7], [0.50, 26.7], [0.60, 62.0], [0.70, 86.7], [0.85, 86.5], [1.00, 66.0]],
    peakRatio: 2.15, darkHole: 0.0000, outerFrac: 0.863
  },
  debuff: {
    path: "jb2a.markers.runes.dark_black.01", measuredScale: 1,
    alpha: [[0.20, 0.0], [0.25, 0.3], [0.30, 2.5], [0.35, 9.2], [0.40, 21.2], [0.45, 35.1], [0.50, 47.7], [0.60, 66.1], [0.70, 73.7], [0.85, 62.0], [1.00, 44.9]],
    peakRatio: 1.55, darkHole: 0.0333, outerFrac: 0.662
  },
  generic: {
    path: "jb2a.extras.tmfx.inflow.circle.01", measuredScale: 1,
    alpha: [[0.20, 4.7], [0.25, 6.6], [0.30, 9.1], [0.35, 11.8], [0.40, 14.8], [0.45, 17.9], [0.50, 20.9], [0.60, 26.7], [0.70, 34.3], [0.85, 43.7], [1.00, 43.2]],
    peakRatio: 1.33, darkHole: 0.0000, outerFrac: 0.853
  }
};

/**
 * 剖面插值。播放层是 scaleToObject（`sprite.width = 目标宽 × objectScale`，源画幅像素
 * 只参与宽高比），所以 token 中心 FACE 的方框在源画幅上对应 rel = FACE / objectScale。
 * 剖面在 0.20-0.50 采样步长 0.05，线性插值与直接量的误差实测 <1%
 * （haste rel=0.348 插值 22.35 对实测 22.34）。
 */
function veilAlpha(group, objectScale) {
  const rel = Math.min(1, FACE / objectScale);
  const a = OCCLUSION[group].alpha;
  assert.ok(rel >= a[0][0],
    `${group}: objectScale ${objectScale} 使窗口 ${rel.toFixed(3)} 落在剖面采样范围之外，`
    + "重跑 tools/persist-occlusion.mjs");
  for (let i = 1; i < a.length; i++) {
    if (rel <= a[i][0]) {
      const [r0, v0] = a[i - 1], [r1, v1] = a[i];
      return v0 + (v1 - v0) * (rel - r0) / (r1 - r0);
    }
  }
  return a.at(-1)[1];
}

/** 一组的常驻有效遮挡（0-1）。压在 token 之下的组结构上遮不到 token，恒 0。 */
function veil(group, cfg) {
  if (!ABOVE_TOKENS.has(group)) return 0;
  return veilAlpha(group, cfg.scale) * cfg.opacity / 255;
}

/** 12 组 + 兜底，逐条解析出来的实际 cue。 */
function cuesByRule() {
  const out = new Map();
  for (const e of effects) {
    const plan = resolveEffect(e, {assets: mk(), armory: ARMORY});
    if (!plan) continue;                        // NO_PERSIST 的状态刻意不产 cue
    out.set(plan.cues[0].rule, plan.cues[0]);
  }
  const fake = {statusId: "__no_such_status__", effectUuid: "Item.x.ActiveEffect.y",
                target: {tokenId: "t", uuid: "Scene.s.Token.t", x: 0, y: 0,
                         w: 100, h: 100, width: 1, height: 1, elevation: 0}, seed: 1};
  const fb = resolveEffect(fake, {assets: mk(), armory: ARMORY}).cues[0];
  out.set(fb.rule, fb);
  return out;
}

test("OCCLUSION 表与 GROUP_FX 对齐（表一旦陈旧就红）", () => {
  assert.deepEqual(Object.keys(OCCLUSION).filter(k => k !== "generic").sort(),
    Object.keys(GROUP_FX).sort(), "分组增删了但没重跑 tools/persist-occlusion.mjs");
  for (const [g, cfg] of Object.entries(GROUP_FX)) {
    assert.equal(OCCLUSION[g].path, cfg.path, `${g} 换了素材，OCCLUSION 里的数字作废`);
    assert.equal(OCCLUSION[g].measuredScale, cfg.scale,
      `${g} 的 objectScale 改成了 ${cfg.scale}，暗洞与峰值两列是在 `
      + `${OCCLUSION[g].measuredScale} 上量的，重跑 tools/persist-occlusion.mjs`);
  }
});

test("分层只有一套：每条 persist cue 的 (belowTokens, zIndex) 只取 LAYER 的两种之一", () => {
  const allowed = [LAYER.above, LAYER.below].map(l => JSON.stringify(l));
  for (const [rule, c] of cuesByRule()) {
    const got = JSON.stringify({belowTokens: c.belowTokens, zIndex: c.zIndex});
    assert.ok(allowed.includes(got), `${rule} 的分层 ${got} 不是 LAYER 里的任何一种`);
  }
});

test("分层与 ABOVE_TOKENS 一致，兜底与地面环同层（不许再出现两套）", () => {
  for (const [rule, c] of cuesByRule()) {
    const group = rule.startsWith("status.") ? rule.slice("status.".length) : null;
    const want = group && ABOVE_TOKENS.has(group) ? LAYER.above : LAYER.below;
    assert.equal(c.belowTokens, want.belowTokens, `${rule} 的 belowTokens 与分层规则不符`);
    assert.equal(c.zIndex, want.zIndex, `${rule} 的 zIndex 与分层规则不符`);
  }
});

test("分层规则的依据本身可查：留在上面必须有理由，压到下面必须还看得见", () => {
  // 判据是 outerFrac = alpha 落在 r>0.6 半幅之外的能量占比，也就是「压到 token 之下
  // 还能保住多少」。这条断言把分层规则的**依据**钉住，而不只是钉住结果。
  //
  // 上层的两种正当理由（满足其一即可，这不是随手放宽——两条对应两种不同的素材）：
  //   (a) 压下去等于取消这个标记：outerFrac < 0.5，能量主要落在 token 轮廓之内。
  //       burning（余烬中心最密，22.9%）与 haste（中心放射的光条，35.3%）属这类。
  //   (b) 留在上面零成本：中心 40% 的常驻遮挡低于预算的十分之一。buff 属这类——
  //       它 86.3% 的能量在外圈，但它是一层**罩住**生物的能量壳，压到脚下就丢了
  //       「罩着」这层语义，而它的脸部遮挡只有 0.1%，留在上面不占任何预算。
  const CHEAP = MAX_VEIL / 10;
  for (const g of ABOVE_TOKENS) {
    const {outerFrac} = OCCLUSION[g];
    const v = veil(g, GROUP_FX[g]);
    assert.ok(outerFrac < 0.5 || v < CHEAP,
      `${g}: ${(outerFrac * 100).toFixed(1)}% 的能量在 r>0.6 之外（压下去仍看得见），`
      + `而它在脸上的常驻遮挡有 ${(v * 100).toFixed(1)}%（超过 ${CHEAP * 100}% 的零成本线）`
      + "——两条留在上层的理由都不成立，应该压到 token 之下");
  }
  // 下层：压下去之后必须还有东西看得见，否则等于取消这个标记。
  for (const g of Object.keys(OCCLUSION)) {
    if (ABOVE_TOKENS.has(g)) continue;
    assert.ok(OCCLUSION[g].outerFrac > 0.5,
      `${g} 只有 ${(OCCLUSION[g].outerFrac * 100).toFixed(1)}% 的能量在 r>0.6 之外，`
      + "压到 token 之下会看不见");
  }
});

test("单组常驻遮挡不超过 token 中心 40% 的一成", () => {
  const bad = [];
  for (const [g, cfg] of Object.entries(GROUP_FX)) {
    const v = veil(g, cfg);
    if (v > MAX_VEIL) bad.push(`${g} ${(v * 100).toFixed(1)}%`);
  }
  assert.deepEqual(bad, [], `超预算：${bad.join("、")}（上限 ${MAX_VEIL * 100}%；压到 token 之下即为 0）`);
});

test("单组瞬时峰值不超过四分之一", () => {
  const bad = [];
  for (const [g, cfg] of Object.entries(GROUP_FX)) {
    const p = veil(g, cfg) * OCCLUSION[g].peakRatio;
    if (p > MAX_PEAK) bad.push(`${g} ${(p * 100).toFixed(1)}%`);
  }
  assert.deepEqual(bad, [], `峰值超预算：${bad.join("、")}（上限 ${MAX_PEAK * 100}%）`);
});

test("画在 token 之上的组不许在脸上打黑洞", () => {
  const bad = [];
  for (const g of ABOVE_TOKENS) {
    const cfg = GROUP_FX[g];
    if (cfg.opacity <= HOLE_FLOOR) continue;          // 有效 alpha 到不了 0.75，打不出洞
    if (OCCLUSION[g].darkHole > MAX_DARK_HOLE) {
      bad.push(`${g} ${(OCCLUSION[g].darkHole * 100).toFixed(2)}%`);
    }
  }
  assert.deepEqual(bad, [], `近黑近不透明像素超标：${bad.join("、")}（上限 ${MAX_DARK_HOLE * 100}%；`
    + `出路是压到 token 之下，或把 opacity 降到 ${HOLE_FLOOR} 及以下）`);
});

test("任意多个状态同挂，合成遮挡仍在预算内", () => {
  // 画在 token 之上的组才会叠加；下层的合成遮挡结构上为 0。
  const above = [...ABOVE_TOKENS].map(g => veil(g, GROUP_FX[g]));
  const worst = 1 - above.reduce((p, a) => p * (1 - a), 1);
  console.log(`  [persist 遮挡] 上层 ${ABOVE_TOKENS.size} 组全挂：${(worst * 100).toFixed(1)}%`
    + `（单组最高 ${(Math.max(...above) * 100).toFixed(1)}%）`);
  assert.ok(worst <= MAX_STACK,
    `${ABOVE_TOKENS.size} 组全部同挂时合成遮挡 ${(worst * 100).toFixed(1)}%，超过 ${MAX_STACK * 100}%`);
});

test("objectScale / opacity 落在 persist 槽的取值区间内", () => {
  for (const [rule, c] of cuesByRule()) {
    assert.ok(c.objectScale >= SCALE_RANGE[0] && c.objectScale <= SCALE_RANGE[1],
      `${rule} 的 objectScale ${c.objectScale} 越界 ${SCALE_RANGE.join("-")}——`
      + "objectScale 走 scaleToObject，是「铺满 token 宽度的百分之几」，不是画布归一化系数");
    assert.ok(c.opacity >= OPACITY_RANGE[0] && c.opacity <= OPACITY_RANGE[1],
      `${rule} 的 opacity ${c.opacity} 越界 ${OPACITY_RANGE.join("-")}`);
  }
});
