/**
 * 几何探针：把同一个动作放到 8 个罗盘方向上，把每条 cue 的**落点几何**逐条打出来。
 *
 * 存在理由：0.9 上机后报的第一类问题是「A 打 B，画面出现在 B 的另一侧、挥击方向也不对」。
 * 这类缺陷在既有测试里查不出来——所有用例都只放一个目标、且几乎都在施法者右侧，
 * 于是「只认左右、不认上下」的几何在离线侧永远是绿的。
 *
 * 用法：node tools/geom-probe.mjs [动作id ...]     不给就跑默认的一组代表动作
 *
 * ## 本轮（批次 A）改了四件事，每件都写清了「凭什么」
 *
 * 1. **汇总键剔除绝对锚点**。旧版把整行（含 `锚=(1100,1000)` 这种绝对坐标）当分桶键，
 *    于是任何锚在目标身上的 cue 都恒报「8 种不同的几何」——`seen.size === 1` 的 ⚠
 *    分支永不触发，探针存在的理由被自己的汇总掩盖。实测：`strike` 的三条 cue 朝向
 *    在 8 个方向上恒为 {0°, 0°, 355°}、只有 mirrorY 翻转，旧汇总仍报「8 种」。
 *    现在分桶键只含**朝向语义**（朝向 / 是否转向 / mirrorY / offset / 有无 stretch /
 *    mask / angle 与 at 的引用**名**），绝对坐标只进显示行、不进键。
 *    另加一张逐 cue 的朝向多样性表，直接点名哪条 cue 对方向不敏感。
 *
 * 2. **`placeAt()` —— region 跟着方向一起摆，并按 `directionDelta` 吸附 rotation**。
 *    旧版 `place()` 只搬 origin 与 target，region 留在语料原处（(500,500)），于是
 *    `spell.storm.ray` 的 travel cue 八个方向恒 `at=(500,500) → stretchTo=(900,500)`、
 *    朝向恒 0°——那是**探针自己的缺口**，会被误读成产品缺陷。
 *    真游戏的摆位在 `crucible/module/dice/action-use-dialog.mjs:394-400`：
 *        case "self": // Lock position and rotate based on mouse position
 *          if ( regionConfig.directionDelta ) {
 *            const rawAngle = Math.toDegrees(Math.atan2(position.y - origin.y, position.x - origin.x));
 *            const snappedAngle = rawAngle.toNearest(regionConfig.directionDelta);
 *            shape.updateSource({rotation: snappedAngle});
 *          }
 *          return false; // Prevent core handling
 *    即 anchor:"self" 的形状**锁位置、只改 rotation**，且 rotation 要吸附；
 *    anchor:"vertex"（blast / summon）则位置跟着落点走、整条不设 rotation
 *    （:401 起的 vertex 分支只改写 position）。判据沿用「region 的 x/y 是否贴着施法者」。
 *
 * 3. **`stretchTo` 打坐标**。旧版只打 `o.stretchTo.ref`，而模板类 cue 的 stretchTo 是
 *    裸点（`travel.mjs:47 templateEnd()` 产出 `{x,y}`，没有 ref），实测恒打印
 *    `stretch=undefined`——读不出终点在哪。
 *
 * 4. **新增 region 列**。模板类 cue（`mask:"region"`）的位置完全由 region 决定，
 *    不打出来就看不出「模板没跟着转」这类问题。
 */
import {readFileSync} from "node:fs";
import {fileURLToPath, pathToFileURL} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {resolve} from "../scripts/resolver/resolve.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const actions = JSON.parse(readFileSync(join(ROOT, "test/fixtures/actions.json"), "utf8"));
const mk = () => createAssets(offlineBackend(index));
const byId = id => actions.find(a => a.id === id);

const G = 100;                       // 像素/格
const OX = 1000, OY = 1000;          // 施法者中心
const DEG = 180 / Math.PI;

/** 8 个罗盘方向，屏幕坐标（y 向下）。E = 目标在右，S = 目标在下。 */
export const DIRS = [
  {name: "E ", dx:  1, dy:  0}, {name: "SE", dx:  1, dy:  1},
  {name: "S ", dx:  0, dy:  1}, {name: "SW", dx: -1, dy:  1},
  {name: "W ", dx: -1, dy:  0}, {name: "NW", dx: -1, dy: -1},
  {name: "N ", dx:  0, dy: -1}, {name: "NE", dx:  1, dy: -1},
];

/** 与 scripts/trigger/snapshot.mjs 的两个判据逐字同构，用来在离线侧复算。 */
const edgesIntersect = (a, b) => {
  const EPS = 1;
  return (a.x + a.w/2 >= b.x - b.w/2 - EPS) && (b.x + b.w/2 >= a.x - a.w/2 - EPS)
      && (a.y + a.h/2 >= b.y - b.h/2 - EPS) && (b.y + b.h/2 >= a.y - a.h/2 - EPS);
};
const isOnLeft = (a, b) => b.x < a.x;

/**
 * 把一份语料快照改造成「施法者在 (OX,OY)，单个目标在 dir 方向、相距 dist 格」。
 * adjacent / onLeft 用与 snapshot.mjs 同构的判据**重新算**，不沿用语料里的值。
 *
 * ⚠ 它**不动 region**——要连模板一起摆请用 placeAt()。保留裸 place() 是因为
 * test/geom-guard.test.mjs 已经 import 了它。
 */
export function place(snap, dir, dist = 1) {
  const t0 = snap.targets?.[0] ?? {};
  const w = (t0.w ?? G), h = (t0.h ?? G);
  const tx = OX + dir.dx * dist * G, ty = OY + dir.dy * dist * G;
  const origin = {...(snap.origin ?? {}), x: OX, y: OY, w: snap.origin?.w ?? G, h: snap.origin?.h ?? G};
  const target = {...t0, x: tx, y: ty, w, h};
  target.adjacent = edgesIntersect(origin, target);
  target.onLeft = isOnLeft(origin, target);
  return {...snap, origin, targets: [target]};
}

// ─────────────────────────────────────────────────────────────────────────────
// region 摆位
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 形状 → 旋转吸附增量（度）。**逐条枚举自** crucible/module/const/action.mjs 的
 * `TARGET_TYPES`（不是估的，是把 11 个 target type 的 region 配置整段读过一遍）：
 *
 *   cone   → shape "cone"       angle 60   directionDelta **15**   anchor self
 *   fan    → shape "cone"       angle 210  directionDelta **15**   anchor self
 *   ray    → shape "line"       width 1    directionDelta **3**    anchor self
 *   pulse  → shape "circle"                （无 directionDelta）   anchor self
 *   aura   → shape "emanation"             （无 directionDelta）   anchor self
 *   blast  → shape "circle"                （无 directionDelta）   anchor vertex
 *   summon → shape "rectangle"             （无 directionDelta）   anchor vertex
 *   none / self / single → region: null
 *
 * 即 cone 形状的两个 target type 取值一致（15），line 只有 ray 一家（3），
 * 其余形状**根本不设 directionDelta**——`action-use-dialog.mjs:396` 的
 * `if ( regionConfig.directionDelta )` 会让它们整条不改 rotation。
 */
export const REGION_DIRECTION_DELTA = Object.freeze({cone: 15, line: 3});

/**
 * 复刻 Foundry 的 `Number#toNearest(interval, "round", 0)`
 * （common/primitives/number.mjs:73-80）：
 *     const eps = method === "floor" ? 1e-8 : method === "ceil" ? -1e-8 : 0;
 *     const float = base + (Math[method](((this - base) / interval) + eps) * interval);
 *     ...
 *     return Number(float.toFixed(Math.max(trunc1, trunc2)));
 * method="round" 时 eps=0、base=0；interval 是整数（15 / 3）时 trunc2=0，末尾按整数收敛。
 */
export function toNearest(value, interval) {
  if (!(interval > 0)) return value;
  return Number((Math.round(value / interval) * interval).toFixed(0));
}

/**
 * 把 region 的朝向按方向复算一次并吸附。
 * 返回**未归一化**的度数（与 Foundry 的 `Math.toDegrees(Math.atan2(...))` 同域，
 * 落在 (-180, 180]），因为 armory 与 play 两侧读的都是这个约定
 * （travel.mjs:51 与 play.mjs:179 都直接 `(region.rotation ?? 0) * DEG` 当弧度用）。
 *
 * ⚠ 实测：8 个罗盘方向的 rawAngle ∈ {0, ±45, ±90, ±135, 180}，而 45 同时是 15 与 3 的
 * 整数倍，**吸附在这 8 个方向上恰好是恒等变换**。留着它是为了「方向集合一旦扩展
 * （非 45° 倍数、非等距）探针仍与真游戏一致」，不是为了改变现有输出。
 */
export function regionRotationFor(dir, shape) {
  const raw = Math.atan2(dir.dy, dir.dx) * DEG;
  return toNearest(raw, REGION_DIRECTION_DELTA[shape]);
}

/** region 是不是锚在施法者身上（anchor:"self"）：位置贴着 origin 就是。 */
export function isSelfAnchored(base) {
  return !!base.region && !!base.origin
    && Math.abs(base.region.x - base.origin.x) < 1
    && Math.abs(base.region.y - base.origin.y) < 1;
}

/**
 * place() 之上再把 region 摆到位。依据见文件头第 2 条。
 *   anchor:"self"   → 位置锁在施法者；**有 directionDelta 才**改 rotation，且吸附
 *   anchor:"vertex" → 位置跟着落点（本探针里就是目标）走，不设 rotation
 *
 * 这段与 test/geom-guard.test.mjs 里那份 placeAt() 同源（§1.3 因此是绿的），
 * 本轮按施工清单 §4.7 提回 CLI 探针，并补上 directionDelta 吸附。
 */
export function placeAt(base, dir, dist = 1) {
  const placed = place(base, dir, dist);
  if (!base.region) return placed;
  const region = {...base.region};
  if (isSelfAnchored(base)) {
    region.x = placed.origin.x;
    region.y = placed.origin.y;
    if (REGION_DIRECTION_DELTA[region.type]) region.rotation = regionRotationFor(dir, region.type);
  } else {
    region.x = placed.targets[0].x;
    region.y = placed.targets[0].y;
  }
  return {...placed, region};
}

/**
 * 把一个锚点引用解析成世界坐标。顺序有讲究：
 *   1. 具名引用（origin / target / 按 tokenId 匹配）——摆位之后这一支才是权威的；
 *   2. 裸坐标（模板末端 templateEnd() 产出的 {x,y} 没有 ref）。
 * ⚠ tokenId 必须先判非空：语料里裸点的 tokenId 是 undefined，目标若也没有 tokenId，
 *    `undefined === undefined` 会把裸点误判成目标。
 */
export function pointResolver(s) {
  const t = s.targets?.[0];
  return ref => {
    if (!ref) return null;
    if (ref.ref === "origin") return {x: s.origin.x, y: s.origin.y};
    if (t && (ref.ref === "target" || (ref.tokenId != null && ref.tokenId === t.tokenId))) {
      return {x: t.x, y: t.y};
    }
    if (Number.isFinite(ref.x) && Number.isFinite(ref.y)) return {x: ref.x, y: ref.y};
    return null;
  };
}

/** 一条 cue 的几何摘要。只取与「画在哪、朝哪」有关的字段。 */
export function geomOf(c) {
  return {
    slot: c.slot, rule: c.rule, kind: c.kind, layer: c.layer,
    at: c.at ? {ref: c.at.ref, tokenId: c.at.tokenId ?? null, x: c.at.x ?? null, y: c.at.y ?? null} : null,
    aim: c.aim ? {x: c.aim.towards?.x ?? null, y: c.aim.towards?.y ?? null,
                  tokenId: c.aim.towards?.tokenId ?? null,
                  rotationOffset: c.aim.rotationOffset ?? 0, missed: c.aim.missed ?? false} : null,
    stretchTo: c.stretchTo ? {ref: c.stretchTo.ref ?? null, x: c.stretchTo.x ?? null, y: c.stretchTo.y ?? null,
                              tokenId: c.stretchTo.tokenId ?? null} : null,
    offset: c.offset ?? null, gridUnits: c.gridUnits ?? false,
    mirrorY: c.mirrorY ?? false, angle: c.angle ?? 0, randomRotation: c.randomRotation ?? null,
    spriteAnchor: c.spriteAnchor ?? null,
    scale: c.scale ?? null, objectScale: c.objectScale ?? null, mask: c.mask ?? null,
  };
}

/**
 * play.mjs 的旋转判据（:347）在离线侧的复算：
 * 带 stretchTo 一律不转；at 与 aim 落在同一点也不转（退化）。
 * 返回 true = 这条 cue 会 rotateTowards，false = 贴图保持素材自带朝向。
 */
export function rotates(c, resolvePt) {
  if (c.stretchTo) return false;
  if (!c.aim) return false;
  const a = resolvePt(c.at), b = resolvePt(c.aim.towards);
  if (!a || !b) return false;
  return !(Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6);
}

/**
 * 从 from 指向 to 的方位角，度，归一化到 [0, 360)。
 * 与 `heading()` **同一个值域**，供守卫直接与 heading 比对：
 * 一条「朝着目标打」的 cue，正确的不变式是 `heading ≡ bearing(施法者, 目标)`。
 * 画布 y 向下，所以 +90° 是屏幕**下方**（正南），不是上方。
 */
export function bearing(from, to) {
  if (!from || !to) return null;
  return ((Math.atan2(to.y - from.y, to.x - from.x) * DEG % 360) + 360) % 360;
}

/**
 * 两个角（度）之间的最小夹角，落在 [0, 180]。
 * 比对朝向必须用它，别用减法——0° 与 359° 只差 1°，减法会得到 359。
 */
export function angleDelta(a, b) {
  if (a == null || b == null) return null;
  return Math.abs(((a - b) % 360 + 540) % 360 - 180);
}

/**
 * 这条 cue 的贴图 +x 轴在**世界坐标**里指向哪（度，+x 正东、顺屏幕时针为正）。
 *   rotationContainer.rotation = rotates ? angle(at→aim) + rotationOffset : 0   （sequencer.js:17070）
 *   spriteContainer.rotation   = -toRadians(cue.angle)                          （sequencer.js:16346）
 * 两者相加就是贴图自然朝向（素材画的是「从左打到右」）落到世界里的方向。
 * stretchTo 的 cue 由 _applyDistanceScaling 自己转向（16994），恒等于 at→stretchTo 的方位角。
 *
 * ⚠ 公式一个字都没动（施工清单：「正确实现已存在，不要重写」）。唯一的改动是删掉旧版
 * `deg` 里那句 `Math.toDegrees ? 0 : (...)`——`Math.toDegrees` 是 Foundry 给 Math 挂的
 * 扩展，Node 下恒 undefined，所以离线侧一直走的是 atan2 那一支（**行为完全不变**）；
 * 但只要有人在 Foundry 运行时里 import 本文件，它就会让 deg() 恒返回 0、朝向全塌成 0°。
 * 这是个哑弹，拆掉。
 */
export function heading(c, resolvePt) {
  const deg = (a, b) => Math.atan2(b.y - a.y, b.x - a.x) * DEG;
  if (c.stretchTo) {
    const a = resolvePt(c.at), b = resolvePt(c.stretchTo);
    return a && b ? ((deg(a, b) % 360) + 360) % 360 : null;
  }
  let h = 0;
  if (rotates(c, resolvePt)) {
    const a = resolvePt(c.at), b = resolvePt(c.aim.towards);
    h = deg(a, b) + (c.aim.rotationOffset ?? 0);
  }
  h -= (c.angle ?? 0);
  return ((h % 360) + 360) % 360;
}

// ─────────────────────────────────────────────────────────────────────────────
// 打表
// ─────────────────────────────────────────────────────────────────────────────

const fmtPt = p => p ? `(${p.x},${p.y})` : "(?)";
const fmtDeg = h => h === null ? "  ?°" : `${h.toFixed(0).padStart(3)}°`;

/** region 列。模板类 cue 的位置完全由它决定，所以每个方向都打一遍。 */
function regionCol(s, base) {
  const r = s.region;
  if (!r) return "region=-";
  const bits = [`${r.type}@(${r.x},${r.y})`];
  if (r.rotation != null) bits.push(`朝向=${Number(r.rotation).toFixed(0)}°`);
  if (r.radius != null) bits.push(`半径=${r.radius}`);
  if (r.length != null) bits.push(`长=${r.length}`);
  if (r.width != null) bits.push(`宽=${r.width}`);
  if (r.angle != null) bits.push(`张角=${r.angle}°`);
  bits.push(`锚=${isSelfAnchored(base) ? "self" : "vertex"}`);
  bits.push(`Δ=${REGION_DIRECTION_DELTA[r.type] ?? "无"}`);
  return `region=${bits.join(" ")}`;
}

/** 显示行：信息尽量全，绝对坐标都在这里。 */
function rowOf(g, pt) {
  const o = geomOf(g);
  return `${o.slot.padEnd(9)} ${String(o.rule).padEnd(22)} at=${o.at?.ref ?? "点"}${fmtPt(pt(g.at))}`
    + ` off=${o.offset ? `(${o.offset.x},${o.offset.y})${o.gridUnits ? "格" : "px"}` : "-"}`
    + ` mirrorY=${o.mirrorY} rot=${rotates(g, pt) ? "是" : "否"}`
    + ` stretch=${o.stretchTo ? `${o.stretchTo.ref ?? "点"}${fmtPt(pt(g.stretchTo))}` : "-"}`
    + ` mask=${o.mask ?? "-"} 朝向=${fmtDeg(heading(g, pt))}`;
}

/**
 * 分桶键：**只含朝向语义**，绝对坐标一律不进（这正是本轮要修的那条：旧版把
 * `锚=(1100,1000)` 折进签名，锚在目标身上的 cue 恒报「8 种」）。
 * `at` 只取引用名（"origin" / "target" / "点"）——它是语义标签，不随方向漂。
 */
function orientKey(g, pt) {
  const o = geomOf(g);
  return `${o.slot}/${o.rule} at=${o.at?.ref ?? "点"} 朝向=${fmtDeg(heading(g, pt))}`
    + ` rot=${rotates(g, pt) ? 1 : 0} mirrorY=${o.mirrorY}`
    + ` off=${o.offset ? `${o.offset.x},${o.offset.y}${o.gridUnits ? "格" : "px"}` : "-"}`
    + ` stretch=${o.stretchTo ? "有" : "无"} mask=${o.mask ?? "-"} angle=${o.angle}`;
}

/** 同一规则出多条时按出现次序编号，得到跨方向稳定的 cue 标识。 */
function keyed(cues) {
  const seen = new Map();
  return cues.map(c => {
    const n = seen.get(c.rule) ?? 0;
    seen.set(c.rule, n + 1);
    return [`${c.slot}/${c.rule}#${n}`, c];
  });
}

function probe(id, dist = 1) {
  const base = byId(id);
  if (!base) { console.log(`## ${id} —— 语料里没有这个动作`); return; }
  console.log(`\n## ${id}  （距离 ${dist} 格）`);
  const seen = new Map();                 // 整方向的朝向签名 -> 次数
  const perCue = new Map();               // cue 标识 -> Set(朝向签名)
  for (const d of DIRS) {
    const s = placeAt(base, d, dist);
    const plan = resolve(s, {assets: mk(), armory: ARMORY});
    const t = s.targets[0];
    const pt = pointResolver(s);
    const cues = keyed((plan?.cues ?? []).filter(c => c.kind !== "sound" && c.kind !== "shake"));
    console.log(`  ${d.name}  adjacent=${t.adjacent} onLeft=${t.onLeft}`
      + `  方位角=${fmtDeg(bearing({x: s.origin.x, y: s.origin.y}, t))}  ${regionCol(s, base)}`);
    const keys = [];
    for (const [ck, g] of cues) {
      console.log(`      ${rowOf(g, pt)}`);
      const ok = orientKey(g, pt);
      keys.push(ok);
      if (!perCue.has(ck)) perCue.set(ck, new Set());
      perCue.get(ck).add(ok);
    }
    seen.set(keys.join("\n"), (seen.get(keys.join("\n")) ?? 0) + 1);
  }
  console.log(`  → 8 个方向一共只产生 ${seen.size} 种朝向签名（已剔除绝对锚点）。`
    + (seen.size === 1 ? "  ⚠ 完全不随方向变化" : ""));
  const blind = [...perCue].filter(([, v]) => v.size < DIRS.length);
  if (blind.length) {
    console.log(`  → 逐 cue 朝向多样性（< 8 即对方向不敏感）：`);
    for (const [ck, v] of perCue) {
      console.log(`      ${ck.padEnd(34)} ${String(v.size).padStart(2)}/8`
        + (v.size < DIRS.length ? "  ⚠" : ""));
    }
  }
}

/**
 * 只有**被当成脚本直接跑**时才打表。
 * test/geom-guard.test.mjs 要 import 本文件的 place()/DIRS/rotates()/heading()/bearing()，
 * 没有这道闸的话一次 import 就会把 7 个动作 × 8 方向的全表
 * 打进测试输出（实测 500+ 行噪音）。
 */
const isMain = process.argv[1] ? import.meta.url === pathToFileURL(process.argv[1]).href : false;
if (isMain) {
  const ids = process.argv.slice(2);
  const DEFAULTS = ["strike", "spell.storm.ray", "spell.storm.cone", "spell.storm.arrow",
                    "spell.storm.blast", "spell.storm.pulse", "fanOfArrows"];
  for (const id of (ids.length ? ids : DEFAULTS)) { probe(id, 1); }
  if (!ids.length) { console.log("\n\n===== 隔一格（dist=2）====="); for (const id of ["strike"]) probe(id, 2); }
}
