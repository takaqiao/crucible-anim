/**
 * 几何守卫：把「动画画在哪、朝哪、拉到哪」变成可断言的东西。
 *
 * 这一层此前完全不存在。上机报的三类几何缺陷（近战 angle 不对、法术位置不对、起点
 * 终点过短）在离线侧**全部是绿的**，原因不是断言写错了，而是压根没有断言，且所有语料
 * 的几何都退化成同一种：`test/fixtures/actions.json` 里施法者恒在 (500,500)、两个目标
 * 恒在 (600,500) 与 (900,500)——**八个罗盘方向里只用到了正东一个**。于是「只认左右、
 * 不认上下」的几何在离线侧永远测不出来。
 *
 * 本文件用 tools/geom-probe.mjs 的 placeAt() 把同一个动作摆到 8 个罗盘方向 × 3 个距离
 * 档上，对每条 cue 的落点几何逐条断言。四组守卫：
 *   §1 方向矩阵     —— 世界朝向必须等于攻击轴；stretchTo 必须真的落到终点；at 与 aim
 *                      不许退化；带偏移的 cue 必须真的会转向；震屏那一路必须可达
 *   §2 大体型       —— ctx.geom.sizeScale() / offsetFor() 在 origin.width>1 时的行为
 *   §3 零目标/多目标 —— once 规则在 0 目标时的锚点；两个反方向目标各自朝向自己
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ## 本轮（批次 A）改了什么，以及凭什么
 *
 * ### (1) 样本量下限：本文件此前 13 条里有 8 条是空真断言
 *
 * §1 全部与 §2.3 都是「对所有声明了 P 的 cue，必须 Q」的 **∀ 形状**。∀ 断言有一个
 * 致命的退化方向：前提集合 P 空掉时 `bad` 恒为 `[]`，`assert.deepEqual(bad, [])`
 * **静默通过**。这不是假想——把 `scripts/resolver/resolve.mjs` 的 normalize 改成硬塞
 * `stretchTo: null, aim: null, offset: {x:0,y:0}`（= 把被守的功能整个删光），本文件
 * 从 `pass 4 / fail 9` 变成 `pass 10 / fail 3`：**红转绿 6 条、退化成空真 2 条，
 * 合计 8/13 在功能被删光后零检出**。
 *
 * 所以每条 ∀ 用例都配一条**样本量下限**（`floor()`）：先证明前提集合非空且够大，
 * 再证明性质成立。下限取实测值本身，**不留放水余量**（仓库惯例见
 * `test/fallback-ratchet.test.mjs:150`「基线必须贴着实测值，不许留放水余量」）；
 * 末尾那条「下限必须贴着实测」把余量钉在 5% 以内，防止有人靠调小下限绕过。
 *
 * ⚠ 下面 9 条已知缺陷标着 `{todo}`（批次 B 才修）。**todo 的测试体照样执行**
 * （Node v24 实测：`not ok … # TODO`、`# fail 0`、退出码 0），但它一旦失败就永远
 * 是红的，里面的 `floor()` 塌了也看不出来。所以另有一条**非 todo** 的
 * 「§0 样本量下限」用例把全部下限再走一遍——空真的兜底在那条，不在这里。
 *
 * ### (2) 朝向判据从「8 种不同」升级成「等于攻击轴」
 *
 * 旧 §1.1 只要求「8 个方向给出 8 种不同的朝向」。那是个**弱得多**的判据：把全部朝向
 * 统一转错 90° 照样是 8 种，照样绿。真正的不变式是
 * **`heading(cue) ≡ bearing(施法者 → 目标)`**（容差 1°），本轮换成它。
 * `heading()` 与 `bearing()` / `angleDelta()` 直接 import 自 tools/geom-probe.mjs
 * （公式与 sequencer.js 的源码逐条对上，不在这里重写第二份）。
 *
 * ### (3) §1.4 的判据本身是错的，同批改正
 *
 * 旧断言名写「at==aim = 等于白写 aim」，但 `play.mjs:379 if (cue.aim.missed) e.missed(true)`
 * 落在 `if (rotates)` **之外**——`aim` 是 `missed` 的唯一载体，退化的 aim 对
 * `missed:true` 的 cue 是**正常且必要**的。`test/play-contract.test.mjs:195/:230`
 * 有两条常绿断言把这个行为钉死。判据因此改成 `samePoint(at, aim) && !c.aim.missed`。
 * ⚠ 今天语料里 `aim.missed` 的 cue 数是 **0**（全部目标都是 result 7 / critical false），
 * 所以这条修正在今天**一条报告都不会减少**（仍是 6392 例）；它是给批次 A 的
 * dump-fixtures 补上非 HIT 结果样本之后准备的。见文末「语料盲区」。
 *
 * ### (4) shake 放回扫掠
 *
 * 旧 `sweep()` 与 §1.7 都把 `kind === "shake"` 一起过滤掉了，于是震屏那一路完全没人守。
 * 现在只过滤 `sound`。⚠ 但**原样语料里 shake cue 恒为 0**：`impact.mjs:490`
 * 的闸门是 `spec.shake && hit.critical`，而语料 434 个动作的每个 result 都写着
 * `critical: false`。所以新增 §1.0 用暴击变体扫一遍，证明这一路真的可达——
 * 没有它，「放回 shake」就是另一条空真。
 *
 * ### (5) §1.6 提升到全语料
 *
 * 旧 §1.6 的前提在 7 个代表动作里只有 **3** 个去重 key（arrow / ray / cone 三条 travel），
 * 样本太小。现在跑全语料 434 × 8 方向，前提 **1128** 条 cue 实例 / **8** 条规则。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ## 判据的源码依据（每条都核对过，不是猜的）
 *
 * · **朝向由什么决定**。播放层只有两条路会让贴图真的转起来：
 *   (a) `stretchTo` —— `_transformSprite()`（sequencer.js:17080-17085）对带 stretchTo 的
 *       走 `_applyDistanceScaling()`，后者第一件事是 `this._rotateTowards(ray)`
 *       （sequencer.js:16992-16994，ray = 源点→拉伸终点）；
 *   (b) `rotateTowards` —— `_rotateTowards(ray)`（sequencer.js:17064-17074）把
 *       `rotationContainer.rotation` 设成 `ray.angle`。
 *   而 play.mjs:347 只在 `!stretchTo && atPoint && aimPoint && !samePoint(aim, at)` 时
 *   才调 `.rotateTowards()`。三者都不成立时，贴图**保持素材自带朝向**，画面上只剩
 *   `mirrorY` 这一个布尔能表达方向——最多两种朝向，八个方向的攻击有六个是错的。
 *   `heading()` / `rotates()` 就是这三条的离线复算，直接 import 自 tools/geom-probe.mjs，
 *   与 play.mjs 的判据逐字同构。
 *
 * · **offset 活在旋转之后的坐标系里**。`spriteOffset` 写的是 `this.sprite.position`
 *   （sequencer.js:16317-16323），而 sprite 的祖先链是
 *   rotationContainer（15673）→ pluginContainer（15675）→ spriteContainer（15676）→ sprite。
 *   `_rotateTowards` 转的正是 rotationContainer（17070）。所以：
 *     - 会转向的 cue，`offset:{x:0.5,y:0}` = 沿攻击轴前移半格 ✓
 *     - 不转向的 cue，同一个 offset = **恒沿屏幕 +x 前移半格**，与攻击方向无关 ✗
 *   这就是「A 打 B，刀光出现在 B 的右边」的机制层解释。
 *
 * · **stretchTo 素材两端的透明留白**。`_getDistanceScaling`（sequencer.js:16966-16985）：
 *       const startPoint = this.template?.startPoint ?? 0;
 *       const endPoint   = this.template?.endPoint   ?? 0;
 *       const widthWithPadding = textureWidth - (startPoint + endPoint);
 *       const spriteScale = distance / widthWithPadding;
 *   而 `_loadFile`（16215-16233）只有在 `Sequencer.Database.entryExists(this.data.file)`
 *   或 `file.template` 存在时才把 template 填进 `this._template`——本模组下发的是**裸文件
 *   路径**，走 16221 的 `SequencerFileBase.make(this.data.file)` → `SequencerFilePlain`
 *   （6374-6396，它没有 template），于是 startPoint/endPoint 双双按 0 算：整张贴图（含
 *   两端透明留白）被拉成射线全长，可见光束首尾各缩进 `padding/W · d`。这就是「起点终点
 *   过短」。补偿手段是现成的：`EffectSection.template({gridSize, startPoint, endPoint})`
 *   （sequencer.js:24079）写进 `data.template`，`_initializeVariables`（15680）
 *   `this._template = this.data.template` 直接采纳，`_loadFile` 的那个 if 对裸路径不进入、
 *   不会把它覆盖掉。缺的只是把 `ctx.pick()` 已经带回来的 `template` 传下去
 *   （resolver/assets.mjs:249/261 的 `template: entry.template`，形如
 *   `[gridSize, startPoint, endPoint]`）。
 *
 * · **模板（region）的朝向怎么来**。Crucible 放置区域时 anchor:"self" 的形状**位置锁在
 *   施法者、只改 rotation**：`rawAngle = Math.toDegrees(Math.atan2(position.y - origin.y,
 *   position.x - origin.x))` 再吸附（crucible/module/dice/action-use-dialog.mjs:396-399）。
 *   `place()` 只搬 origin 与 target，**不动 region**——直接拿它测锥形/射线会把「模板没
 *   跟着转」这个探针自身的缺口误报成产品缺陷。本文件此前自带一份 placeAt()；本轮改成
 *   直接 import tools/geom-probe.mjs 的 placeAt()，两份逐条等价（那边多做的
 *   `directionDelta` 吸附在 45° 倍数的 8 个方向上恰好是恒等变换；且语料里带 rotation 的
 *   region 恰好就是 cone 24 + line 24 = 48 个，与 REGION_DIRECTION_DELTA 的键集一致）。
 *
 * ## ⚠ 语料盲区（不是本文件能修的，记在这里免得被当成「已经守住了」）
 *
 * `test/fixtures/actions.json` 的每个 result 都是 `{result: 7, critical: false}`、
 * `healed: 0`、`origin.width: 1`。于是：
 *   · `aim.missed` 的 cue 数恒 0 —— §1.4 / §1.7 里 `!c.aim.missed` 那半条今天是空转的；
 *   · shake cue 数恒 0 —— §1.0 只能自己造暴击变体（`asCritical()`）；
 *   · 大体型只能靠 §2.3 自己造 3×3 的施法者。
 * 施工清单批次 A 的 `tools/dump-fixtures.mjs` 那一格要补的正是这些合成样本；
 * 它落地之后，上面三条应当改成直接吃语料，并把下限抬到新的实测值。
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {resolve, resolveEffect} from "../scripts/resolver/resolve.mjs";
import {createContext} from "../scripts/resolver/context.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import {RESULT} from "../scripts/const.mjs";
import {DIRS, placeAt, rotates, heading, bearing, angleDelta} from "../tools/geom-probe.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const actions = JSON.parse(readFileSync(join(ROOT, "test/fixtures/actions.json"), "utf8"));
const mk = () => createAssets(offlineBackend(index));
const byId = id => actions.find(a => a.id === id);

const GRID = 100;                                  // 语料与 geom-probe 同为 100px/格
const TOL = 1;                                     // 朝向容差，度

/** 三个距离档：贴身、隔一格、远距离。单位是格。 */
const DISTS = [{name: "贴身", d: 1}, {name: "隔格", d: 2}, {name: "远距", d: 6}];

/**
 * 代表动作。每一条都对应一类**不同的**几何装法，不是随手挑的：
 *   strike            近战挥击（at=target + offset + mirrorY，无 stretchTo）
 *   spell.storm.arrow 定向飞弹（at=origin + stretchTo=target + aim）
 *   spell.storm.ray   line 模板光束（at=point + stretchTo=模板末端 + mask:region）
 *   spell.storm.cone  cone 模板（同上，另加 scale.y 撑张角）
 *   spell.storm.blast vertex 锚定的圆形模板（region 跟着目标走）
 *   spell.storm.pulse 自身脉冲（径向对称，本就不该随方向变）
 *   fanOfArrows       扇形齐射（at=origin + aim，靠 rotateTowards 转）
 */
const CASES = ["strike", "spell.storm.arrow", "spell.storm.ray", "spell.storm.cone",
               "spell.storm.blast", "spell.storm.pulse", "fanOfArrows"];

/** CASES 与语料对不上时必须炸在这里，而不是让 8 条 ∀ 断言一起空真变绿。 */
function requireAction(id) {
  const a = byId(id);
  if (!a) throw new Error(`test/fixtures/actions.json 里没有代表动作 "${id}"——`
    + "CASES 与语料对不上，本文件的方向矩阵整层会退化成空真。");
  return a;
}

/**
 * 把一个锚点引用解析成世界坐标。
 *
 * ⚠ 为什么不直接用 geom-probe 的 `pointResolver()`：那一份把 `ref: "target"` 一律解析成
 * `targets[0]`（探针的 `place()` 只留一个目标，那里没问题），而 §3.3 是**南北两个目标**
 * 的场景，会被它全部解析到北边那个身上。所以这里 **tokenId 优先**，再退回冻结坐标，
 * 最后才退回 targets[0]。在单目标语料上两者逐条一致（全语料 24288 个引用点实测 0 差异）。
 */
function resolverFor(s) {
  return ref => {
    if (!ref) return null;
    if (ref.ref === "origin") return {x: s.origin.x, y: s.origin.y};
    const hit = ref.tokenId != null ? (s.targets ?? []).find(t => t.tokenId === ref.tokenId) : null;
    if (hit) return {x: hit.x, y: hit.y};
    if (Number.isFinite(ref.x) && Number.isFinite(ref.y)) return {x: ref.x, y: ref.y};
    const t = s.targets?.[0];
    return ref.ref === "target" && t ? {x: t.x, y: t.y} : null;
  };
}
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/** 计划里给每条 cue 一个稳定标识：同一规则出多条时按出现次序编号。 */
function keyed(cues) {
  const seen = new Map();
  return cues.map(c => {
    const n = seen.get(c.rule) ?? 0;
    seen.set(c.rule, n + 1);
    return [`${c.slot}/${c.rule}#${n}`, c];
  });
}

/**
 * 把语料动作改成「全暴击」。只动 `results[].critical`，别的一个字段不碰——
 * `impact.mjs:490` 的 shake 闸门就是 `spec.shake && hit.critical`。
 */
function asCritical(base) {
  return {...base, targets: (base.targets ?? []).map(t => ({
    ...t, results: (t.results ?? []).map(r => ({...r, critical: true}))
  }))};
}

/**
 * 跑一个动作的 8 方向 × 一个距离档，返回 [{dir, snap, plan, pt, cues:[[key,cue]]}]。
 * **只过滤 sound**：shake 是几何 cue（带 at / forTarget），本轮放回来。
 */
function sweep(base, distGrids, {critical = false} = {}) {
  const src = critical ? asCritical(base) : base;
  return DIRS.map(dir => {
    const snap = placeAt(src, dir, distGrids);
    const plan = resolve(snap, {assets: mk(), armory: ARMORY});
    const cues = keyed((plan?.cues ?? []).filter(c => c.kind !== "sound"));
    return {dir, snap, plan, pt: resolverFor(snap), cues};
  });
}

/**
 * 这条 cue 声明的常量偏置扣掉之后，它的世界朝向**应当**落在哪。
 *
 * 攻击轴 = `bearing(施法者 → 目标)`。在它之上允许两项**显式声明的**常量偏置：
 *   · `aim.rotationOffset` —— 素材自带的固定偏角（`play.mjs` 把它加进 rotateTowards）；
 *   · `cue.angle`          —— `spriteContainer.rotation = -toRadians(angle)`（16346），
 *                             符号是负的，所以这里减。
 * 两项都扣掉，剩下的就是「这条 cue 到底有没有跟着攻击方向转」——判据只管这一件事，
 * 不去管素材自己歪多少度（那是选材的事，归 ASSET-NOTES）。
 * 带 stretchTo 的 cue 由 `_applyDistanceScaling` 自己转向，`heading()` 对它直接返回
 * `at → stretchTo` 的方位角、不掺 angle，所以这里也不扣。
 */
function aimAxis(snap, c, target = snap.targets?.[0]) {
  const want = bearing({x: snap.origin.x, y: snap.origin.y}, target);
  if (want == null) return null;
  if (c.stretchTo) return want;
  return want + (c.aim?.rotationOffset ?? 0) - (c.angle ?? 0);
}

/** 这条 cue 的世界朝向与攻击轴差多少度。解析不出坐标一律记 Infinity（不许静默放过）。 */
function headingError(snap, c, pt, target = snap.targets?.[0]) {
  const d = angleDelta(heading(c, pt), aimAxis(snap, c, target));
  return d == null ? Infinity : d;
}
const fmtDeg = v => v == null || !Number.isFinite(v) ? "?" : v.toFixed(1);
/** 方位显示用：aimAxis() 刻意不归一化（角差交给 angleDelta），打印时归一到 [0,360)。 */
const fmtDir = v => v == null || !Number.isFinite(v) ? "?" : (((v % 360) + 360) % 360).toFixed(1);

// ─────────────────────────────────────────────────────────────────────────────
// 扫掠语料：只跑一次，下面所有用例共用（也保证 census 的口径与用例逐字同源）
// ─────────────────────────────────────────────────────────────────────────────

/** 7 个代表动作 × 3 个距离档 × 8 方向。 */
const SWEEPS = CASES.flatMap(id =>
  DISTS.map(({name, d}) => ({id, name, d, runs: sweep(requireAction(id), d)})));

/** 同上，但全暴击——§1.0 用它证明 shake 这一路真的可达。 */
const CRIT_SWEEPS = CASES.flatMap(id =>
  DISTS.map(({name, d}) => ({id, name, d, runs: sweep(requireAction(id), d, {critical: true})})));

/** §2.3 的 3×3 施法者，两个距离档。 */
const BIG_BASE = (() => {
  const base = requireAction("strike");
  return {...base, origin: {...base.origin, width: 3, height: 3,
                            w: 3 * GRID, h: 3 * GRID, radiusPx: 1.5 * GRID}};
})();
const BIG_DISTS = [{name: "贴身", d: 2}, {name: "远距", d: 6}];
const BIG_SWEEPS = BIG_DISTS.map(({name, d}) => ({name, d, runs: sweep(BIG_BASE, d)}));

/** 全语料 434 动作 × 8 方向 × 贴身档，供 §1.6 / §1.7 共用。 */
const FULL = (() => {
  const out = [];
  for (const base of actions) {
    for (const dir of DIRS) {
      const snap = placeAt(base, dir, 1);
      const plan = resolve(snap, {assets: mk(), armory: ARMORY});
      if (!plan) continue;
      out.push({id: base.id, dir, snap, plan, pt: resolverFor(snap)});
    }
  }
  return out;
})();

/** 全语料零目标，供 §3.1 共用。 */
const ZERO = actions.map(base => {
  const snap = {...base, targets: []};
  try { return {id: base.id, snap, plan: resolve(snap, {assets: mk(), armory: ARMORY}), err: null}; }
  catch (err) { return {id: base.id, snap, plan: null, err}; }
});

// ─────────────────────────────────────────────────────────────────────────────
// 样本量下限（反空真）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 各字段是 2026-08-29 的实测值。口径**必须与用例里的过滤条件逐字一致**，
 * 否则下限守的是另一个集合，空真照样漏过去；下面 census 的每一行都标了它对应
 * 哪条用例的哪一句 `continue` / `if`。
 */
/*
 * 【2026-08-29 批次 C+D 下调】directedCases 54→51 / aimCases 384→360 /
 * offsetCases 144→120 / fullAim 7344→6864 / fullOffset 3352→3256 / fullStretch 1128→840。
 *
 * 成因是**区域姿态改成了 once**：批次 C 给 fan / blast / contact / step / aura / create 六个
 * 手势补了专属规则，其中区域类置 ——一个动作出 **1 条** cue 而不是每目标各 1 条。
 * 于是 84 条法术从 （每目标一条 stretchTo 飞行物）挪到专属规则，cue 实例数
 * 整体下降。**这是结构性改进，不是几何保证丢了。**
 *
 * ⚠ 下调之前按守卫自己的失败讯息要求查过「被守的字段是不是被整个删掉了」：
 * 全语料 141 条带 stretchTo 的画面 cue，**没带 template 的 0 条**（§1.6 守的正是这个），
 * 带 aim 的 1341 条。字段都在，塌的只是实例数。
 */
const BASELINE = {
  /** §1.1：7 动作 × 3 距离档里，声明了 aim 或 stretchTo 的**去重 cue key** 数之和。 */
  directedCases: 51,
  /** §1.2：非模板类（`mask !== "region"`）且两端都解析得出坐标的 stretchTo cue 实例数。 */
  plainStretch: 24,
  /** §1.3：模板类（`mask === "region"`）且两端都解析得出坐标的 stretchTo cue 实例数。 */
  regionStretch: 48,
  /** §1.4：带 aim、两端可解析、且 `!aim.missed` 的 cue 实例数（口径含那半条修正）。 */
  aimCases: 360,
  /**
   * §1.5：带非零 offset 的 cue 实例数。
   *
   * 两次改动、三个数：
   *   · 批次 B 第 5 步 24 → **0**：全语料唯一的偏移是近战四条规则那句
   *     `offset:{x: offsetFor(target,0.5), y:0}`，它随 `meleeGeom()` 一起退休
   *     （施工清单 §0.2：偏移活在旋转之后的坐标系里，锚点定对之后再推就是纯错位）；
   *   · 批次 B 第 6 步 0 → **144**：impact 的结果层按 RESULT_GEOM 补上了沿攻击轴的位移。
   *     本语料 434 条动作的结算结果全是 HIT，所以这里数到的全是 HIT 那一行的 `along: 0.10`。
   * 新增的这一档**必须**是会转向的（HIT 行 rotate:true），所以它同时把 §1.5 的 ∀ 断言
   * 从「合法空真 + 探测器活性」拉回到真的有东西可验。
   */
  offsetCases: 120,
  /** §1.0：全暴击变体下扫出来的 shake cue 数。原样语料是 0，见文件头 (4)。 */
  shakeCrit: 168,
  /** §1.6 / §1.7：全语料 8 方向下出得来的计划数。 */
  fullPlans: 3472,
  /**
   * §1.4 的全量对应项：带 aim、可解析、非 missed 的 cue 实例数。
   *
   * 2026-08-29 批次 B 第 6 步 7600 → **7344**：impact 槽不再无条件挂 aim。
   * 「拿不到施法者坐标 / 施法者与目标重合」的动作（自我增益、自伤一类）从此**没有**
   * 攻击轴可言，那 256 条 cue 一个 aim 都不写——按 §0.7 的裁定那正是要删掉的死字段，
   * 不是被谁悄悄抹掉的（`attackAxis()` 返回 null 那一支）。
   */
  fullAim: 6864,
  /**
   * §1.5 的全量对应项：带非零 offset 的 cue 实例数（§1.5 的体量真正在这里）。
   * 批次 B 第 5 步 400 → 0（strike.melee 200 / strike.unarmed 144 / strike.melee.combo 48 /
   * strike.talisman 8，四条近战规则的屏幕坐标系偏移全删了）；
   * 第 6 步 0 → **3352**（impact 结果层的攻击轴位移，全语料 × 8 方向）。
   * 两批的差别不只是数量：删掉的那 400 例**不转向**，新增的 3352 例每一条都转向——
   * 所以 §1.7 的第二半（「偏移恒沿屏幕 +x 的必须为 0」）仍然是 0。
   */
  fullOffset: 3256,
  /** §1.6 的前提：带 stretchTo 的 cue 实例数。 */
  fullStretch: 744,
  /** §1.6 的前提（规则口径）：出过 stretchTo 的规则数。 */
  fullStretchRules: 8,
  /** §2.3：3×3 施法者 × 2 距离档里，声明了朝向意图的去重 cue key 数之和。 */
  directedBig: 6,
  /** §3.1：零目标下仍然出得来的计划数（once 规则不依赖目标）。 */
  zeroTargetPlans: 428,
  /** §3.3：南北两个目标共有、且声明了朝向意图的 cue key 数。 */
  multiTargetKeys: 3
};

/** 只数一次，全部用例共用。 */
const census = (() => {
  const c = {
    directedCases: 0, plainStretch: 0, regionStretch: 0, aimCases: 0, offsetCases: 0,
    shakeCrit: 0, fullPlans: FULL.length, fullAim: 0, fullOffset: 0,
    fullStretch: 0, fullStretchRules: 0, directedBig: 0,
    zeroTargetPlans: 0, multiTargetKeys: 0
  };
  const stretchRules = new Set();

  for (const {runs} of SWEEPS) {
    const directed = new Set();
    for (const r of runs) {
      for (const [key, cue] of r.cues) {
        if (cue.aim || cue.stretchTo) directed.add(key);          // §1.1：if (!(c.aim || c.stretchTo)) continue
        if (cue.stretchTo) {
          const a = r.pt(cue.at), b = r.pt(cue.stretchTo);
          if (cue.mask === "region") { if (a && b) c.regionStretch++; }  // §1.3
          else if (b) c.plainStretch++;                                  // §1.2：只要终点解析得出
        }
        if (cue.aim && !cue.aim.missed) {                          // §1.4：if (!c.aim || c.aim.missed) continue
          const a = r.pt(cue.at), b = r.pt(cue.aim.towards);
          if (a && b) c.aimCases++;
        }
        if (cue.offset && (cue.offset.x || cue.offset.y)) c.offsetCases++;   // §1.5
      }
    }
    c.directedCases += directed.size;
  }

  for (const {runs} of CRIT_SWEEPS) {
    for (const r of runs) for (const [, cue] of r.cues) if (cue.kind === "shake") c.shakeCrit++;  // §1.0
  }

  for (const f of FULL) {
    for (const cue of f.plan.cues) {
      if (cue.kind === "sound") continue;
      if (cue.aim && !cue.aim.missed) {
        const a = f.pt(cue.at), b = f.pt(cue.aim.towards);
        if (a && b) c.fullAim++;                                   // §1.7 退化 aim 那一半
      }
      if (cue.offset && (cue.offset.x || cue.offset.y)) c.fullOffset++;   // §1.7 屏幕 offset 那一半
      if (cue.stretchTo) { c.fullStretch++; stretchRules.add(cue.rule); } // §1.6
    }
  }
  c.fullStretchRules = stretchRules.size;

  for (const {runs} of BIG_SWEEPS) {
    const directed = new Set();
    for (const r of runs) for (const [key, cue] of r.cues) if (cue.aim || cue.stretchTo) directed.add(key);
    c.directedBig += directed.size;                                // §2.3
  }

  for (const z of ZERO) if (!z.err && z.plan) c.zeroTargetPlans++;  // §3.1

  return c;
})();

/** §3.3 是手搭的双目标场景，单独数一次（它不走 SWEEPS）。 */
const NS = (() => {
  const base = requireAction("strike");
  const t0 = base.targets[0];
  const O = {x: 1000, y: 1000};
  const mkT = (id, x, y) => ({...t0, tokenId: id, uuid: `Scene.s.Token.${id}`, x, y,
                              w: GRID, h: GRID, width: 1, height: 1, radiusPx: GRID / 2,
                              adjacent: true, onLeft: x < O.x});
  const snap = {...base,
    origin: {...base.origin, x: O.x, y: O.y},
    targets: [mkT("north", O.x, O.y - GRID), mkT("south", O.x, O.y + GRID)]};
  const plan = resolve(snap, {assets: mk(), armory: ARMORY});
  const byTarget = new Map();
  for (const c of (plan?.cues ?? [])) {
    if (c.kind === "sound" || !c.forTarget) continue;
    const arr = byTarget.get(c.forTarget) ?? [];
    arr.push(c); byTarget.set(c.forTarget, arr);
  }
  const north = keyed(byTarget.get("north") ?? []), south = keyed(byTarget.get("south") ?? []);
  const shared = north.filter(([k, c]) => (c.aim || c.stretchTo) && south.some(([k2]) => k2 === k));
  return {snap, plan, byTarget, north, south, shared};
})();
census.multiTargetKeys = NS.shared.length;

/** 下限断言的统一写法：先证明前提非空且够大，再让调用方去证性质。 */
function floor(key, what) {
  assert.ok(census[key] >= BASELINE[key],
    `${what}只剩 ${census[key]} 个（下限 ${BASELINE[key]}）——前提集合塌了，`
    + "这条 ∀ 断言正在空真通过。先查被守的字段（aim / stretchTo / offset / template）"
    + "是不是被整个删掉了，再改下限。");
}

/**
 * ⚠ 这条**不许标 todo**。
 *
 * 下面 9 条已知缺陷是 `{todo}`，它们体内的 `floor()` 一旦塌了会被「本来就红」盖住。
 * 这条把全部下限单独再走一遍，是空真的真正兜底：只要有人把 aim / stretchTo / offset
 * 从 normalize 里抹掉，这一条会立刻转红，而且它是**非 todo** 的，`# fail` 直接回不去 0。
 */
test("§0 样本量下限：全部 ∀ 守卫的前提集合都必须非空且够大", () => {
  const under = Object.keys(BASELINE)
    .filter(k => census[k] < BASELINE[k])
    .map(k => `${k}: 实测 ${census[k]} < 下限 ${BASELINE[k]}`);
  assert.deepEqual(under, [],
    "几何守卫的前提集合塌了——下面这些 ∀ 断言现在是空真通过的：\n  " + under.join("\n  "));
});

// ─────────────────────────────────────────────────────────────────────────────
// §1 方向矩阵
// ─────────────────────────────────────────────────────────────────────────────

test("§1.0 震屏那一路必须真的可达：暴击变体下 shake cue 数 > 0，且每份计划至多一条", () => {
  // 原样语料 434 个动作的每个 result 都是 critical:false，shake cue 恒为 0——
  // 「把 shake 放回 sweep()」如果没有这条，就是又一条空真。
  // 至多一条：impact.mjs:432 的注释写死了「多目标暴击各来一次 shake、叠加成灾难」，
  // :447/:490/:527 用 shakeAt 只留第一条。
  floor("shakeCrit", "暴击变体下扫出来的 shake cue");
  const bad = [];
  for (const {id, name, runs} of CRIT_SWEEPS) {
    for (const r of runs) {
      const shakes = r.cues.filter(([, c]) => c.kind === "shake");
      if (shakes.length > 1) {
        bad.push(`${id}/${name}/${r.dir.name.trim()}：一份计划里有 ${shakes.length} 条 shake`);
      }
      for (const [key, c] of shakes) {
        const at = r.pt(c.at);
        const t = (r.snap.targets ?? []).find(t => t.tokenId === c.forTarget);
        if (!at) { bad.push(`${id}/${name} ${key}：shake 的 at 解析不出坐标`); continue; }
        if (!t) { bad.push(`${id}/${name} ${key}：shake 的 forTarget=${c.forTarget} 不在目标里`); continue; }
        if (dist2(at, t) > 1) {
          bad.push(`${id}/${name} ${key}：shake 锚点距它自己的目标 ${dist2(at, t).toFixed(1)}px`);
        }
      }
    }
  }
  assert.deepEqual(bad, [], `震屏 cue 的锚定不对：\n  ${bad.join("\n  ")}`);
});

// 2026-08-29 批次 B 第 5、6 步：`{todo}` 已摘。改前红的是 strike/travel/strike.melee#0
// 与全部 impact/impact.layered 共 14 个去重 key（朝向恒定不随方向变，8 个方向里只有正东
// 碰巧对，最坏方向差 180°）。第 5 步把近战四条规则换成 meleeGeom（at 改施法者），第 6 步
// 把 impact 的死 aim 换成 attackAxis() + RESULT_GEOM 逐结果裁定、元素层的 randomRotation
// 换成「攻击轴 + 确定性抖动」。这条从此是常绿守卫。
test("§1.1 声明了 aim 或 stretchTo 的 cue，世界朝向必须等于施法者→目标的方位角（容差 1°）",
  () => {
  floor("directedCases", "声明了朝向意图（aim / stretchTo）的 cue key");
  const bad = [];
  for (const {id, name, runs} of SWEEPS) {
    const worst = new Map();                 // key -> 最坏的那个方向
    for (const r of runs) {
      for (const [key, c] of r.cues) {
        if (!(c.aim || c.stretchTo)) continue;
        const err = headingError(r.snap, c, r.pt);
        const cur = worst.get(key);
        if (!cur || err > cur.err) {
          worst.set(key, {err, dir: r.dir.name.trim(),
                          got: heading(c, r.pt), want: aimAxis(r.snap, c)});
        }
      }
    }
    for (const [key, w] of worst) {
      if (w.err <= TOL) continue;
      bad.push(`${id}/${name} ${key}：最坏方向 ${w.dir} 朝向 ${fmtDir(w.got)}°，`
        + `攻击轴（扣掉 rotationOffset 与 angle 之后）${fmtDir(w.want)}°，差 ${fmtDeg(w.err)}°`);
    }
  }
  assert.deepEqual(bad, [],
    "以下 cue 声明了朝向意图（aim / stretchTo），世界朝向却不等于攻击轴：\n  " + bad.join("\n  "));
});

test("§1.2 非模板类 stretchTo 的终点必须落在目标身上（容差 1px）", () => {
  floor("plainStretch", "非模板类的 stretchTo cue");
  const bad = [];
  for (const {id, name, runs} of SWEEPS) {
    for (const r of runs) {
      for (const [key, c] of r.cues) {
        if (!c.stretchTo || c.mask === "region") continue;   // 模板类归 §1.3
        const end = r.pt(c.stretchTo), t = r.snap.targets[0];
        const err = end ? dist2(end, t) : Infinity;
        if (!(err <= 1)) {
          bad.push(`${id}/${name}/${r.dir.name.trim()} ${key}：终点距目标 ${err.toFixed(1)}px`);
        }
      }
    }
  }
  assert.deepEqual(bad, [], `stretchTo 终点没落在目标上：\n  ${bad.join("\n  ")}`);
});

test("§1.3 模板类 stretchTo（mask:region）的方位必须与施法者→目标一致（容差 1°）", () => {
  floor("regionStretch", "模板类（mask:region）的 stretchTo cue");
  const bad = [];
  for (const {id, name, runs} of SWEEPS) {
    for (const r of runs) {
      for (const [key, c] of r.cues) {
        if (!c.stretchTo || c.mask !== "region") continue;
        const at = r.pt(c.at), end = r.pt(c.stretchTo);
        const want = bearing({x: r.snap.origin.x, y: r.snap.origin.y}, r.snap.targets[0]);
        const err = at && end ? angleDelta(bearing(at, end), want) : null;
        // 实测这条今天的最坏误差是 0.00°，1° 容差纯粹是浮点余量，不是放水。
        if (err == null || err > TOL) {
          bad.push(`${id}/${name}/${r.dir.name.trim()} ${key}：光束方位 `
            + `${at && end ? fmtDir(bearing(at, end)) : "解析不出"}°，施法者→目标 ${fmtDir(want)}°`);
        }
        // 零长拉伸会让 Sequencer 弹 ui.notifications.error 并把 sprite 缩到 0
        // （见 armory/travel.mjs 的 originAnchor 注释）；模板类同样不许退化。
        if (at && end && dist2(at, end) < 1) {
          bad.push(`${id}/${name}/${r.dir.name.trim()} ${key}：零长拉伸`);
        }
      }
    }
  }
  assert.deepEqual(bad, [], `模板类光束的方位与攻击方向不一致：\n  ${bad.join("\n  ")}`);
});

// 2026-08-29 批次 B 第 5、6 步：`{todo}` 已摘，成因同 §1.1。
// ⚠ 判据里 `samePoint(at, aim) && !aim.missed` 那半条修正保留：aim 仍是 missed 的唯一
// 载体（play.mjs:379 的 e.missed(true) 落在 if(rotates) 之外）。第 6 步之后这一支的唯一
// 使用者是 generic.impact 的落空两档——它们**故意**用退化 aim 驮着 missed，不是缺陷。
test("§1.4 非 missed 的 cue，at 与 aim 不许落在同一点（退化 = 等于白写 aim）",
  () => {
  // play.mjs:347 的 samePoint 分支会把这种 cue 的 rotateTowards 整个跳过，
  // Ray(p,p).angle 是 atan2(0,0)=0，转向是 no-op。写了 aim 却拿不到任何朝向。
  floor("aimCases", "带 aim、两端可解析、且不是 missed 的 cue");
  const bad = [];
  for (const {id, name, runs} of SWEEPS) {
    for (const r of runs) {
      for (const [key, c] of r.cues) {
        if (!c.aim || c.aim.missed) continue;
        const at = r.pt(c.at), aim = r.pt(c.aim.towards);
        if (at && aim && dist2(at, aim) < 1e-6) {
          bad.push(`${id}/${name}/${r.dir.name.trim()} ${key}`);
        }
      }
    }
  }
  assert.deepEqual(bad, [], `以下 cue 的 at 与 aim.towards 是同一个点：\n  ${bad.join("\n  ")}`);
});

test("§1.5 带非零 offset 的 cue 必须真的会转向，否则偏移恒沿屏幕 +x", () => {
  // 依据见文件头「offset 活在旋转之后的坐标系里」：spriteOffset 写的是 sprite.position，
  // 而 sprite 挂在 rotationContainer 之下；不转向 = 偏移留在屏幕坐标系里。
  //
  // 批次 B 第 5 步之后这条断言一度**空真**：唯一的偏移来源是近战四条规则那句
  // `offset:{x: offsetFor(target,0.5), y:0}`，它随 meleeGeom() 一起退休了；第 6 步 impact
  // 的结果层又按 RESULT_GEOM 补回了沿攻击轴的位移（本语料 144 条），前提集合重新非空。
  // 下面那对合成 cue 是那段空窗期留下的**探测器活性**检查：即使语料哪天再次空掉，它也
  // 照样能证明判据本身还活着（rotates 恒真 / 恒假都会当场点红），所以留着不删。
  const pt = a => (a && Number.isFinite(a.x) && Number.isFinite(a.y) ? {x: a.x, y: a.y} : null);
  const withOffset = {offset: {x: 0.5, y: 0}, gridUnits: true, at: {ref: "point", x: 100, y: 100}};
  assert.equal(rotates({...withOffset, aim: {towards: {x: 100, y: 100}, missed: false}}, pt), false,
    "判据必须认出 at 与 aim 同点的退化转向——认不出，这条 ∀ 断言就是个哑弹");
  assert.equal(rotates({...withOffset, aim: {towards: {x: 300, y: 100}, missed: false}}, pt), true,
    "判据必须承认 at 与 aim 分开的 cue 真的会转向——否则它只会误报，同样不可信");
  floor("offsetCases", "带非零 offset 的 cue");
  const bad = new Set();
  for (const {id, name, runs} of SWEEPS) {
    for (const r of runs) {
      for (const [key, c] of r.cues) {
        if (!c.offset || (!c.offset.x && !c.offset.y)) continue;
        if (!rotates(c, r.pt)) {
          bad.add(`${id}/${name} ${key}：offset=(${c.offset.x},${c.offset.y})`
            + `${c.gridUnits ? "格" : "px"}，但这条 cue 不会 rotateTowards`);
        }
      }
    }
  }
  assert.deepEqual([...bad], [], `以下 cue 的偏移与攻击方向无关：\n  ${[...bad].join("\n  ")}`);
});

// 2026-08-29 批次 B 第 5 步：`{todo}` 已摘。八条出 stretchTo 的规则各加了
// `template: fx.template`，1128 条 cue 实例全部带上留白，本条从此是常绿守卫——
// 哪条规则漏了透传都会当场点红（施工清单 §0.4）。
test("§1.6 全语料：带 stretchTo 的 cue 必须携带素材模板的两端留白，否则光束首尾缩进",
  () => {
  // 依据见文件头「stretchTo 素材两端的透明留白」。允许的表达：
  // cue.template = [gridSize, startPoint, endPoint] 或 {gridSize, startPoint, endPoint}。
  // 本轮从 7 个代表动作（只有 3 个去重 key）提升到全语料 434 × 8 方向。
  floor("fullStretch", "全语料里带 stretchTo 的 cue");
  floor("fullStretchRules", "出过 stretchTo 的规则");
  const ok = v => Array.isArray(v)
    ? (v.length === 3 && v.every(Number.isFinite))
    : (!!v && Number.isFinite(v.gridSize) && Number.isFinite(v.startPoint)
       && Number.isFinite(v.endPoint));
  const bad = new Map();          // 规则 -> 命中次数
  const sample = new Map();       // 规则 -> 一条样例
  for (const f of FULL) {
    for (const c of f.plan.cues) {
      if (c.kind === "sound" || !c.stretchTo || ok(c.template)) continue;
      bad.set(c.rule, (bad.get(c.rule) ?? 0) + 1);
      if (!sample.has(c.rule)) sample.set(c.rule, `${f.id} ${c.slot}/${c.rule}`);
    }
  }
  const rows = [...bad.entries()].sort((a, b) => b[1] - a[1])
    .map(([rule, n]) => `${rule}×${n}（例：${sample.get(rule)}）`);
  assert.deepEqual(rows, [],
    `带 stretchTo 却没带模板留白的规则（全语料 ${census.fullStretch} 条 stretchTo cue 里）：\n  `
    + rows.join("\n  "));
});

// ─────────────────────────────────────────────────────────────────────────────
// §1.7 全量语料普查：把上面几个代表动作的结论压到全部 434 条动作上
// ─────────────────────────────────────────────────────────────────────────────

// 2026-08-29 批次 B 第 5、6 步：`{todo}` 已摘。改前是退化 aim 6392 例
// （impact.layered 5160 / generic.impact 832 / strike.melee 200 / strike.unarmed 144 /
// strike.melee.combo 48 / strike.talisman 8）+ 屏幕 offset 400 例。
// ⚠ 其中 impact 那 5992 例（93.7%）按 §0.7 的裁定不是「补一个真 aim」而是**删掉死字段**：
// 补真 aim 会让 play-contract 的两条常绿断言当场转红（非拉伸的 missed cue 一旦装上
// rotateTowards，calculate_missed_position 的 !target 分支就进不去，落点不会偏）。
test("§1.7 全量语料 × 8 方向：退化 aim 与朝屏幕 +x 的偏移都必须为 0",
  () => {
  floor("fullPlans", "全语料 8 方向下出得来的计划");
  floor("fullAim", "全语料里带 aim、可解析、非 missed 的 cue");
  floor("fullOffset", "全语料里带非零 offset 的 cue");
  const degen = new Map();          // 规则 -> 命中 cue 次数
  const screenOffset = new Map();
  for (const f of FULL) {
    for (const c of f.plan.cues) {
      if (c.kind === "sound") continue;
      const at = f.pt(c.at);
      const aim = c.aim && !c.aim.missed ? f.pt(c.aim.towards) : null;
      if (at && aim && dist2(at, aim) < 1e-6) degen.set(c.rule, (degen.get(c.rule) ?? 0) + 1);
      if (c.offset && (c.offset.x || c.offset.y) && !rotates(c, f.pt)) {
        screenOffset.set(c.rule, (screenOffset.get(c.rule) ?? 0) + 1);
      }
    }
  }
  const fmt = m => [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}×${v}`);
  assert.deepEqual([...fmt(degen), ...fmt(screenOffset)], [],
    `全量 ${census.fullPlans} 份计划（${actions.length} 动作 × ${DIRS.length} 方向）里：`
    + `\n  退化 aim（at==aim 且非 missed，转向被跳过）：${fmt(degen).join(", ") || "无"}`
    + `\n  偏移恒沿屏幕 +x（不转向却带 offset）：${fmt(screenOffset).join(", ") || "无"}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// §2 大体型
// ─────────────────────────────────────────────────────────────────────────────

/** 造一份指定体型的 ctx，只为拿 ctx.geom。 */
const geomFor = width => createContext({
  assets: mk(), seed: 0,
  snapshot: {origin: {width, height: width}}
}).geom;

// 2026-08-29 批次 B 第 7 步：`{todo}` 已摘。改前是 `originWidth() > 1 ? 1.4 : 1`——
// 2×2 的狗头人与 4×4 的巨龙拿到同一个 1.4，四倍身位、同一个放大系数；现在是连续的
// `1 + 0.4*(w-1)`（w=2 处与旧值逐字相同，所以现有语料一条 cue 都没动）。
test("§2.1 sizeScale() 必须随施法者体型单调放大，而不是 1/1.4 两档",
  () => {
  const got = [1, 2, 3, 4].map(w => geomFor(w).sizeScale());
  const bad = [];
  for (let i = 1; i < got.length; i++) {
    if (!(got[i] > got[i - 1])) bad.push(`width ${i} → ${i + 1}：${got[i - 1]} → ${got[i]}（没变大）`);
  }
  assert.deepEqual(bad, [],
    `sizeScale() 在体型 1/2/3/4 上分别是 ${got.join(" / ")}：\n  ${bad.join("\n  ")}`);
});

// 2026-08-29 批次 B 第 7 步：`{todo}` 已摘，用例整条改写。
//
// 旧用例问的是「`ctx.geom.offsetFor()` 会不会把特效推出目标之外」，实测 3×3 / 4×4 的
// 施法者把偏移推到 150px / 200px——它乘的是**施法者**宽，而用它的那些 cue 锚在**目标**
// 身上。修法不是把系数调小，而是**把这个能力袋方法整个删掉**：偏移活在「锚点定对之后」
// 的坐标系里，再推就是纯错位（施工清单 §0.2）。调用点在第 5 步已经归零。
//
// 所以这条守卫现在钉两件事，合起来就是施工清单 §0.7 的第三条守卫：
//   (1) `ctx.geom` 上不许再长回一个 offsetFor —— 直接检查能力袋的形状；
//   (2) impact 槽那些真的带偏移的 cue，模长**随目标体型线性缩放、不随施法者体型变**。
//       (2) 是 (1) 的行为版：哪天有人换个名字把「乘施法者宽」写回来，(1) 拦不住，(2) 能。
test("§2.2 命中反馈的偏移只跟着目标体型走，不跟着施法者体型走", () => {
  // (1) 能力袋上不该再有 offsetFor / onLeft（后者在第 5 步之后也没有任何调用点了）
  const g = geomFor(3);
  assert.equal(typeof g.offsetFor, "undefined",
    "ctx.geom.offsetFor 又回来了。它乘的是施法者宽，而用它的 cue 锚在目标身上——"
    + "3×3 的施法者会把偏移推到 150px，整条特效飞到目标身后的空地上。"
    + "要沿攻击轴推，用 armory/impact.mjs 的 impactOffset()（单位是目标格宽）。");
  assert.equal(typeof g.onLeft, "undefined",
    "ctx.geom.onLeft 又回来了。真旋转落地之后左右翻转不该再承担「方向」这个职责"
    + "（见 armory/travel.mjs 的 mirrorY 注释），这个方法在第 5 步之后零调用点。");

  // (2) 行为版：同一个动作、同一个结果，一次只改一个维度，看偏移怎么动。
  const r6 = v => Math.round(v * 1e6) / 1e6;
  const src = requireAction("strike");
  const strikeAt = (ow, tw, result) => {
    const t0 = src.targets[0];
    const snap = {
      ...src,
      origin: {...src.origin, x: 1000, y: 1000, width: ow, height: ow,
               w: ow * GRID, h: ow * GRID, radiusPx: ow * GRID / 2},
      targets: [{...t0, x: 1000 + (ow + tw) * GRID / 2 + GRID, y: 1000,
                 width: tw, height: tw, w: tw * GRID, h: tw * GRID, radiusPx: tw * GRID / 2,
                 adjacent: false, onLeft: false,
                 results: [{result, critical: false}],
                 damage: {total: 8, type: "slashing", resource: "health"}}]
    };
    const plan = resolve(snap, {assets: mk(), armory: ARMORY});
    const c = (plan?.cues ?? []).find(x => x.slot === "impact" && x.layer === "result");
    assert.ok(c, `结果 ${result} 的 impact 结果层没出来，本用例失去意义`);
    return c;
  };
  // 比例判据要留浮点余量：offset 的两个分量各自经过一次 r6，翻倍之后末位对不齐
  // （0.067088×2 = 0.134176 而不是 r6(0.134177)），用等号会得到一条与几何无关的红。
  const ratio2 = (a, b, what) => assert.ok(Math.abs(a / b - 2) < 1e-4,
    `${what}：目标从 1×1 换成 2×2，偏移应当正好翻倍，实测 ${(a / b).toFixed(6)} 倍`);

  // HIT 与 GLANCE 的位移写在**攻击轴坐标系**里（RESULT_GEOM 的 along / lateral，单位是
  // 目标格宽），所以施法者体型一个字都不该改变它。
  for (const r of [RESULT.HIT, RESULT.GLANCE]) {
    const o1 = strikeAt(1, 1, r), o3 = strikeAt(3, 1, r), t2 = strikeAt(1, 2, r);
    assert.ok(o1.offset.x || o1.offset.y, `结果 ${r} 的结果层没有偏移，这条断言在空转`);
    assert.deepEqual(o3.offset, o1.offset,
      `结果 ${r}：施法者从 1×1 换成 3×3，偏移就变了（${JSON.stringify(o1.offset)} → `
      + `${JSON.stringify(o3.offset)}）——这正是 offsetFor 那条老毛病的形状`);
    ratio2(t2.offset.x, o1.offset.x, `结果 ${r} 的攻击轴位移`);
  }

  // MISS 与 DODGE 的位移写在**贴图自身坐标系**里（selfX / selfY，单位是这条 cue 渲染出来
  // 的身位），补的是素材构图偏心。它必须跟着贴图缩放走——而贴图缩放里含 sizeScale()，
  // 所以施法者体型会经 objectScale 影响它，**但除以 objectScale 之后必须不变**。
  // 两句合起来才是完整判据：随目标线性，随施法者只经「贴图尺寸」这一条路。
  for (const r of [RESULT.MISS, RESULT.DODGE]) {
    const o1 = strikeAt(1, 1, r), o3 = strikeAt(3, 1, r), t2 = strikeAt(1, 2, r);
    const norm = c => ({x: r6(c.offset.x / c.objectScale), y: r6(c.offset.y / c.objectScale)});
    const mag = c => c.offset.x || c.offset.y;
    assert.ok(mag(o1), `结果 ${r} 的结果层没有偏移，这条断言在空转`);
    assert.deepEqual(norm(o3), norm(o1),
      `结果 ${r}：偏移除以 objectScale 之后仍随施法者体型变——那它就不再是「构图补偿」，`
      + "而是又一个乘施法者宽的 offsetFor");
    ratio2(mag(t2), mag(o1), `结果 ${r} 的构图补偿`);
  }
});

// 2026-08-29 批次 B 第 5、6 步：`{todo}` 已摘，与 §1.1 同源同因（strike.melee 与
// impact.layered 两层）。单列一条是因为大体型会改变 adjacent 判定、走的几何分支不同。
test("§2.3 大体型施法者（3×3）下，世界朝向仍必须等于攻击轴",
  () => {
  floor("directedBig", "3×3 施法者下声明了朝向意图的 cue key");
  const bad = [];
  for (const {name, runs} of BIG_SWEEPS) {
    const worst = new Map();
    for (const r of runs) {
      for (const [key, c] of r.cues) {
        if (!(c.aim || c.stretchTo)) continue;
        const err = headingError(r.snap, c, r.pt);
        const cur = worst.get(key);
        if (!cur || err > cur.err) {
          worst.set(key, {err, dir: r.dir.name.trim(),
                          got: heading(c, r.pt), want: aimAxis(r.snap, c)});
        }
      }
    }
    for (const [key, w] of worst) {
      if (w.err <= TOL) continue;
      bad.push(`3×3 施法者 / ${name} ${key}：最坏方向 ${w.dir} 朝向 ${fmtDir(w.got)}°，`
        + `攻击轴 ${fmtDir(w.want)}°，差 ${fmtDeg(w.err)}°`);
    }
  }
  assert.deepEqual(bad, [], `大体型下朝向仍不跟着攻击轴走：\n  ${bad.join("\n  ")}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// §3 零目标 / 多目标
// ─────────────────────────────────────────────────────────────────────────────

test("§3.1 零目标：全量语料 resolve 不抛、不留告警、不把锚点画到场景 (0,0)", () => {
  // tools/token-mocks.mjs 的文件头记着这个坑真的发生过：ref:"point" 的模板锚点全画在
  // 场景左上角。区域法术没罩住任何人、自身增益本来就没有目标，都是正常情形
  // （resolve.mjs 的槽装配注释写死了「once 规则在零目标动作上照样出内容」）。
  floor("zeroTargetPlans", "零目标下仍然出得来的计划");
  const throwing = [], badAnchor = [], warned = [];
  for (const {id, snap, plan, err} of ZERO) {
    if (err) { throwing.push(`${id}: ${err?.message ?? err}`); continue; }
    if (!plan) continue;
    const pt = resolverFor(snap);
    if (plan.warnings.length) warned.push(`${id}: ${plan.warnings[0]}`);
    for (const c of plan.cues) {
      const at = pt(c.at);
      if (!at) { badAnchor.push(`${id} ${c.slot}/${c.rule}：at 解析不出坐标`); continue; }
      if (at.x === 0 && at.y === 0) badAnchor.push(`${id} ${c.slot}/${c.rule}：锚在场景 (0,0)`);
      if (c.stretchTo) {
        const e = pt(c.stretchTo);
        if (!e || (e.x === 0 && e.y === 0)) {
          badAnchor.push(`${id} ${c.slot}/${c.rule}：stretchTo 终点退化`);
        }
      }
    }
  }
  assert.deepEqual(throwing, [], `零目标下 resolve 抛异常：\n  ${throwing.join("\n  ")}`);
  assert.deepEqual(badAnchor, [], `零目标下锚点跑到场景原点：\n  ${badAnchor.join("\n  ")}`);
  assert.deepEqual(warned, [], `零目标下产生了告警：\n  ${warned.join("\n  ")}`);
});

test("§3.2 零目标：ActiveEffect 侧没有 target 时必须返回 null 而不是退化到原点", () => {
  // resolve.mjs 的 resolveEffect 第一句 `if (!target) return null`——持续标记退化到原点
  // 是在地图左上角挂一枚绑着不存在 token 的光环（cue 带 attachTo）。
  for (const slot of ["persist", "death"]) {
    assert.equal(resolveEffect(null, {assets: mk(), armory: ARMORY}, slot), null);
    assert.equal(resolveEffect({statusId: "staggered", target: null, seed: 1},
                               {assets: mk(), armory: ARMORY}, slot), null);
  }
  // 有 target 时锚点必须是那个 token 的真坐标，不是 (0,0)
  const plan = resolveEffect({
    statusId: "staggered", effectUuid: "Scene.s.Token.t.ActiveEffect.e", seed: 1,
    target: {tokenId: "t", uuid: "Scene.s.Token.t", x: 1234, y: 5678, elevation: 0,
             width: 1, height: 1, w: GRID, h: GRID, radiusPx: GRID / 2}
  }, {assets: mk(), armory: ARMORY}, "persist");
  assert.ok(plan, "staggered 应当出得来 persist 计划");
  for (const c of plan.cues) {
    assert.equal(c.at.x, 1234, `${c.rule} 的锚点 x 不是目标坐标`);
    assert.equal(c.at.y, 5678, `${c.rule} 的锚点 y 不是目标坐标`);
  }
});

// 2026-08-29 批次 B 第 5、6 步：`{todo}` 已摘。改前 3 条共有 cue（travel/strike.melee#0、
// impact/impact.layered#0/#1）× 2 个目标 = 6 行全红：朝向与目标在南在北无关。
// ⚠ 判据是「各自等于自己那条攻击轴」而不是「两个朝向必须不同」：旧判据被元素层骗过——
// impact.layered#1 的 angle 从前是 rng 冻定的随机角、逐目标不同，于是「不同」成立而方向
// 感知仍然是零，那是一条假绿。现在元素层的轴由 aim 给、抖动由 angle 给，两者分开，
// 抖动在 aimAxis() 与 heading() 里同时被扣掉，骗不过这条判据。
test("§3.3 多目标：正北与正南的两个目标，各自的 cue 必须朝向自己那个目标",
  () => {
  // 语料里两个目标恒在正东同一条线上（600,500 与 900,500），左右差异都测不出来，
  // 更别说上下。NS 把目标摆成正北与正南（见文件上方的 NS 构造）。
  floor("multiTargetKeys", "南北两个目标共有、且声明了朝向意图的 cue key");
  assert.ok(NS.plan, "多目标计划应当出得来");
  assert.deepEqual([...NS.byTarget.keys()].sort(), ["north", "south"],
    "每个目标都该拿到属于自己的 cue（forTarget 是注入字段，不该缺）");

  // 锚点各归各的目标
  for (const [id, cues] of NS.byTarget) {
    const t = NS.snap.targets.find(t => t.tokenId === id);
    const pt = resolverFor(NS.snap);
    for (const c of cues) {
      if (c.at.ref !== "target") continue;
      const p = pt(c.at);
      assert.ok(p && dist2(p, t) < 1, `${id} 的 ${c.slot}/${c.rule} 锚在了别的目标身上`);
    }
  }

  // 朝向：正北的 cue 必须朝正北（-90°），正南的必须朝正南（+90°）。
  const pt = resolverFor(NS.snap);
  const bad = [];
  for (const [key, cn] of NS.shared) {
    const cs = NS.south.find(([k]) => k === key)[1];
    for (const [tid, c] of [["north", cn], ["south", cs]]) {
      const t = NS.snap.targets.find(t => t.tokenId === tid);
      const err = headingError(NS.snap, c, pt, t);
      if (err > TOL) {
        bad.push(`${key} / ${tid}：朝向 ${fmtDir(heading(c, pt))}°，`
          + `该目标的攻击轴 ${fmtDir(aimAxis(NS.snap, c, t))}°，差 ${fmtDeg(err)}°`);
      }
    }
  }
  assert.deepEqual(bad, [], `南北两个目标的画面朝向没有各归各的：\n  ${bad.join("\n  ")}`);
});

// ─────────────────────────────────────────────────────────────────────────────
// 下限不许虚低
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 没有这一条，上面那十几处 `floor()` 就能被「把下限调小」轻易绕过——而那恰恰是最坏的
 * 用法：数字看着在管着，实际一路稀释。语料长大（dump-fixtures 补进非 HIT 结果 / 暴击 /
 * 大体型样本）之后下限不跟着抬，`floor()` 守的就是一个越来越松的旧集合，直到某天前提
 * 塌了一大半它还是绿的。这里要求下限**贴着实测**（不得低出 5%）。
 *
 * 5% 是给「刚往语料加了一两条样本、还没来得及改基线」留的缓冲，不是给放水留的。
 */
test("下限必须贴着实测值，不许留放水余量", () => {
  const slack = (base, actual) => actual === 0 ? 0 : (actual - base) / actual;
  const stale = Object.keys(BASELINE)
    .filter(k => slack(BASELINE[k], census[k]) > 0.05)
    .map(k => `${k}: 下限 ${BASELINE[k]}，实测 ${census[k]}`);
  assert.deepEqual(stale, [],
    "语料/计划已经长大了，但样本量下限还挂在旧值上。把 BASELINE 调到实测值——"
    + "下限只有贴着走才拦得住空真。");
});
