/**
 * 「降分辨率不改变量测结论」的守卫。
 *
 * `tools/media.mjs` 的 `eachFrame` 在扫描前先把帧缩到 400² 个像素——不缩的话
 * jb2a 全库 11,700 个文件要通过管道传约 1 TB 的 RGBA，实测 3.5 秒/文件、十小时起。
 *
 * 缩放成立的前提是：`profile-family.mjs` 算的量全部是**比值或帧序号**，对分辨率不敏感。
 * 这份测试就是在兑现那句话——**否则它只是个好听的说法**。
 *
 * 容差不是拍的，是对着 40 条分层抽样（eskie 20 + jb2a 20）实测出来的分布定的：
 *
 * | 量 | 全分辨率 vs 400² | 结论 |
 * | --- | --- | --- |
 * | `frames` / `peak` / `leadEmpty` | 40/40 完全一致 | 整数项，零容差 |
 * | `tailEmpty` | 37/40 | 尾部弱帧会跨过空帧门限，允许 ±1 |
 * | `contentRatio` | 中位 0.22%，max 0.81% | 容差 2% |
 * | `darkLuma` | 中位 0.24%，max 8.77% | 容差 15% |
 * | `flashRatio` | 中位 0.26%，max 12.50% | 容差 20% |
 *
 * **按面积缩而不是按最长边**也是这轮量出来的：初版按最长边缩到 240，`4000×400` 的宽条
 * 素材变成 `240×24`（只剩 5760 个像素），tailEmpty 掉到 33/40、darkLuma 差到 22%。
 * 改成面积口径后宽条缩成 `1096×110`，像素数与方形素材同量级。
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {existsSync} from "node:fs";
import {join} from "node:path";

/** ffmpeg 缺席时整份跳过：这是开发机上的量测工具，不是运行时依赖。 */
let profileAsset, FOUNDRY_DATA, unavailable = null;
try {
  ({FOUNDRY_DATA} = await import("../tools/paths.mjs"));
  ({profileAsset} = await import("../tools/profile-family.mjs"));
} catch (err) {
  unavailable = err?.message ?? String(err);
}

/**
 * 两条固定素材，刻意选成两种极端：
 *   · 方形中等画幅（800×800，15 帧）—— 最常见的形态
 *   · **宽条**（jb2a 的 ranged 系是 1600×400 一类）—— 正是把「按最长边缩」判死的那一类
 */
const CASES = [
  // 方形中等画幅，最常见的形态
  "modules/eskie-effects/assets/Damage/Fire/Damage_Fire_01_Orange.webm",
  // **4:1 的宽条**（21 帧，跑得快）。这一条是本文件的关键：
  // 初版两个用例都是方形，而对方形素材来说「按面积缩」与「按最长边缩」结果**完全相同**——
  // 变异验证时把口径改回最长边，测试照样全绿。宽条才分得开这两种口径。
  "modules/blfx-assets-pack01/artwork/01-weapon/arrow/Vortex_Arrow_1_30ft_1600x400.webm"
];

const TOL = {contentRatio: 0.02, darkLuma: 0.15, flashRatio: 0.20};

for (const rel of CASES) {
  const name = rel.split("/").pop();
  const skip = unavailable
    ? `量测工具不可用：${unavailable.split("\n")[0]}`
    : (existsSync(join(FOUNDRY_DATA, rel)) ? false : `本机没有 ${rel}`);

  test(`降分辨率不改变量测结论：${name}`, {skip}, async () => {
    const abs = join(FOUNDRY_DATA, rel);
    const fast = await profileAsset(abs, 1, 400);   // 缩到 400² 像素
    const full = await profileAsset(abs, 1, 0);     // 不缩
    assert.ok(fast && full, "量测返回空");

    for (const k of ["frames", "peak", "leadEmpty", "w", "h", "fps", "alpha", "codec"]) {
      assert.deepEqual(fast[k], full[k],
        `${k} 在缩放后变了（${fast[k]} vs ${full[k]}）——这几项必须逐字相同`);
    }
    assert.ok(Math.abs(fast.tailEmpty - full.tailEmpty) <= 1,
      `tailEmpty 差了 ${Math.abs(fast.tailEmpty - full.tailEmpty)} 帧，只允许 ±1：` +
      "尾部弱帧跨过空帧门限是可接受的，差更多说明缩放把内容也抹掉了");

    for (const [k, tol] of Object.entries(TOL)) {
      if (typeof full[k] !== "number" || full[k] === 0) continue;
      const rel_ = Math.abs(fast[k] - full[k]) / Math.abs(full[k]);
      assert.ok(rel_ <= tol,
        `${k} 相对偏差 ${(rel_ * 100).toFixed(2)}% 超过容差 ${(tol * 100)}%` +
        `（缩放 ${fast[k]} vs 全分辨率 ${full[k]}）。` +
        "要么调 maxDim，要么这个量本身对分辨率敏感、不该在缩放模式下用。");
    }
  });
}

/** 面积口径本身：宽条素材缩完之后不能只剩几千个像素。 */
test("缩放按面积而不是最长边（宽条素材不能被压扁）", {skip: unavailable ? "量测工具不可用" : false}, async () => {
  const {eachFrame} = await import("../tools/media.mjs");
  const rel = CASES[1];   // 必须用宽条：方形素材两种口径同解
  const abs = join(FOUNDRY_DATA, rel);
  if (!existsSync(abs)) return;
  let seen = null;
  const info = await eachFrame(abs, (buf, w, h) => { seen ??= {w, h}; }, {maxDim: 400});
  assert.ok(seen, "一帧都没解出来");
  assert.equal(seen.w, info.scaledW);
  assert.equal(seen.h, info.scaledH);
  const px = info.scaledW * info.scaledH;
  assert.ok(px <= 400 * 400 * 1.05, `缩放后 ${px} 个像素，超过了 400² 的上限`);
  assert.ok(px >= 400 * 400 * 0.7,
    `缩放后只剩 ${px} 个像素，远低于 400² —— 说明用的是最长边口径，` +
    "宽条素材会被压扁到几千像素，空帧判据与暗底均值都会失真");
  // 长宽比要保住
  const arSrc = info.w / info.h, arDst = info.scaledW / info.scaledH;
  assert.ok(Math.abs(arSrc - arDst) / arSrc < 0.05, "长宽比在缩放中变了");
});

/**
 * 默认值守卫。
 *
 * 上面的用例都显式传 `maxDim`，所以**改默认值它们一条都不会红**——变异验证时把默认
 * 从 400 改成 120，三条测试全绿。默认值才是全库量测实际用的那个，必须单独钉。
 */
test("profileAsset 的默认 maxDim 就是标定过的 400，且真的生效", {skip: unavailable ? "量测工具不可用" : false}, async () => {
  const abs = join(FOUNDRY_DATA, CASES[0]);
  if (!existsSync(abs)) return;
  const dflt = await profileAsset(abs);
  assert.equal(dflt.maxDim, 400,
    "默认 maxDim 不是 400。这个数是对着全分辨率基线抽样 40 条标定出来的：" +
    "400 时 frames/peak/leadEmpty 全部一致、contentRatio 最大差 0.81%；" +
    "改小会让 darkLuma 与 tailEmpty 失真，改大只换来微小精度、代价是成倍的时间。");
  const explicit = await profileAsset(abs, 1, 400);
  assert.deepEqual(dflt, explicit, "默认参数与显式传 400 的结果不一致——默认值没被用上");
});
