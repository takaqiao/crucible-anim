/**
 * 音效层 —— **响度归一化**的守卫。
 *
 * ## 这一层修的是「不够明显」的第二层
 *
 * 第一层是「那一声根本没播」（播出窗把峰值切掉了，守卫在 `sound-layer.test.mjs`）。
 * 第二层是**响度没有归一化**：volume 从前是五处逐规则手挑的常数，与实测响度完全无关。
 * 改造前实测（本语料，单目标口径，552 条音效 cue / 50 个素材）：
 *
 * | | 有效峰值 min / 中位 / max | 角色内跨度 |
 * | --- | --- | --- |
 * | cast（床垫） | −15.1 / **−12.7** / −9.3 | 5.8 |
 * | draw（拉弓） | −13.3 / **−13.3** / −12.6 | 0.7 |
 * | impact（打中） | −25.7 / **−17.0** / −8.0 | 17.7 |
 * | swing（风声） | −29.3 / **−20.4** / −12.9 | 16.4 |
 * | 全局 | −29.3 / −13.2 / −8.0 | **21.3 ≈ 12 倍振幅** |
 *
 * **该最响的那一下（impact）按中位排第三**，235 个双段动作里 **153 个命中音比它前面的
 * 前置音还轻**。改造后：跨度 **12.9**、倒挡 **39**（其中 3 条见下面 `LEGACY_ROLELESS`）。
 *
 * ## 为什么这些判据不是同义反复
 *
 * **全部回到 `data/audio-profiles.json` 的原始 `peakDb`/`rmsDb` 重算**，一条都不读
 * `gainFor()` 的返回值：读了就变成「表等于表」，volume 被谁改成什么都测不出来。
 * 分组一律按 `soundRole` 而**不按 volume 数值**——归一化之前 vol 0.8 同时覆盖
 * impact 与 draw 两个角色，按数值分组会把两族混在一起。
 *
 * ## 为什么单开一个文件而不是并进 sound-layer.test.mjs
 *
 * 那边测的是**时序**（什么时候听见），这边测的是**响度**（听成多响），两者的判据来源
 * 不同（SFX 前四列 vs 后两列），公用的只有「怎么枚举音效 cue」这一点点。
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {resolve} from "../scripts/resolver/resolve.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import {SFX, GAIN_TARGET, GAIN_FLOOR, GAIN_CEIL} from "../scripts/armory/sound-table.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const actions = JSON.parse(readFileSync(join(ROOT, "test/fixtures/actions.json"), "utf8"));
/** 判据的**唯一**真值来源：兵库改什么都不影响它。 */
const PROFILES = JSON.parse(readFileSync(join(ROOT, "data/audio-profiles.json"), "utf8")).profiles;
const mk = () => createAssets(offlineBackend(index));

/**
 * 还没接进 `gainFor` 的音效 cue —— **这是一张欠账单，不是白名单**。
 *
 * `cast.mjs` 的 `strike.ranged.draw` 规则（拉弓放弦）仍写着手挑的 `volume: 0.8`。
 * 那一处不在本轮改造的文件归属内，接上之后倒挂会从 39 掉到 36、瞬态从 13 掉到 10。
 * 这里给它一个角色，是为了让它照样进得了下面所有的判据——**欠账要能被量到，
 * 不能因为「没报角色」就从统计里消失**。新增的音效 cue 一律要自己报 `soundRole`，
 * 漏报会被「音效 cue 必须报角色」那条拦下。
 */
const LEGACY_ROLELESS = Object.freeze({"strike.ranged.draw": "draw"});
const LEGACY_ROLELESS_MAX = 11;   // 本语料实测 11 条，棘轮

const roleOf = c => c.soundRole ?? LEGACY_ROLELESS[c.rule] ?? null;

/** 全语料的音效 cue（单目标口径：`parallelizeTargets` 只改 delay，不改 file/volume）。 */
const CUES = actions.flatMap(s => {
  const p = resolve({...s, targets: (s.targets ?? []).slice(0, 1)}, {assets: mk(), armory: ARMORY});
  return (p?.cues ?? []).filter(c => c.kind === "sound" && PROFILES[c.file]).map(c => [s, c]);
});

/**
 * 一条 cue 的**有效峰值**（dBFS）：素材自身的峰值电平叠上这条 cue 的 volume。
 * `peakDb` 取自量测文件，`volume` 取自计划——两个来源互相独立，所以这个量能证伪。
 */
const effPeak = c => PROFILES[c.file].peakDb + 20 * Math.log10(c.volume);

test("响度棘轮：全语料有效峰值跨度不许超过 13.0 dB", () => {
  const eff = CUES.map(([, c]) => effPeak(c)).sort((a, b) => a - b);
  const span = eff[eff.length - 1] - eff[0];
  assert.ok(eff.length >= 400, `只量到 ${eff.length} 条音效 cue，样本不足`);
  assert.ok(span <= 13.0,
    `有效峰值跨度 ${span.toFixed(1)} dB（min ${eff[0].toFixed(1)} / max ${eff[eff.length - 1].toFixed(1)}）。`
    + "改造前是 21.3，归一化后实测 12.9。volume 必须由 `gainFor(file, role)` 算出来，"
    + "不许退回手挑常数。");
});

/**
 * **每个角色内部**的跨度。
 *
 * impact 的 10.6 不是没做归一化，是**素材天花板**：19 个命中素材里 12 个连 −12 dB 都够不到
 *（最惨的 `necrotic-00` 峰值 −22.6），而 volume 只能衰减不能放大。这一条只能靠换素材去修
 * （sound-plan §1.4），不是调表能解决的，所以 impact 这一档的棘轮就钉在实测值上。
 */
/*
 * 【批 E 复算】`cast` 从 3.7 抬到 7.2：12 符文施法音落地，施法床垫从 psfx 那 5 支
 * （同一家厂、同一批电平）换成 ggg 的 12 支（六个厂牌、跨四个音效包）。
 * 池**内**齐（12 池最大 Δ3.8），跨 12 池不齐——`Arcane Ripple` 与 `Ailments Hypnotize`
 * 的峰均比 13.2 dB，而 `Rocks_Spell` 只有 6.0，同一个 RMS 目标下峰值自然差 7 dB。
 * 这不是归一化没做（volume 全部是 gainFor 反算的），是**十二个符文本来就该有音色差**。
 * 7.2 仍在规格给的「同 role ≤8」线内。
 */
test("响度棘轮：每个角色内部的跨度", () => {
  const CEILING = {impact: 10.6, swing: 6.9, draw: 0.7, cast: 7.2};
  const by = new Map();
  for (const [, c] of CUES) {
    const r = roleOf(c);
    if (!by.has(r)) by.set(r, []);
    by.get(r).push(effPeak(c));
  }
  const bad = [];
  for (const [role, v] of by) {
    v.sort((a, b) => a - b);
    const span = v[v.length - 1] - v[0];
    const ceil = CEILING[role];
    assert.ok(ceil != null, `角色 ${role} 没有登记跨度上限`);
    if (span > ceil + 0.05) bad.push(`${role}: 角色内跨度 ${span.toFixed(1)} > 登记的 ${ceil}`);
  }
  assert.deepEqual(bad, [], bad.join("\n"));
});

/**
 * **倒挂**：一次动作里「打中」的那一声比它前面的任何一声都轻。
 *
 * 前置音（cast 床垫 / swing 风声 / draw 拉弓）在构造上恒排在命中音之前：床垫 delay 0、
 * 风声排在命中前 150ms、拉弓在 cast 槽。所以只比响度、不再比时刻。
 * 取「最响的那条前置音」与「最响的那条命中音」比——耳朵记住的是最响的那一下。
 */
function inversions() {
  const byAction = new Map();
  for (const [s, c] of CUES) {
    if (!byAction.has(s.id)) byAction.set(s.id, []);
    byAction.get(s.id).push(c);
  }
  const all = [], transient = [];
  let pairs = 0, transientPairs = 0;
  for (const [id, cs] of byAction) {
    const hit = cs.filter(c => roleOf(c) === "impact");
    const pre = cs.filter(c => roleOf(c) !== "impact" && roleOf(c) !== null);
    if (!hit.length || !pre.length) continue;
    const loudestHit = Math.max(...hit.map(effPeak));
    const loudestPre = pre.reduce((a, b) => effPeak(b) > effPeak(a) ? b : a);
    pairs++;
    if (loudestHit < effPeak(loudestPre)) {
      all.push(`${id}: 命中 ${loudestHit.toFixed(1)} < ${roleOf(loudestPre)} ${effPeak(loudestPre).toFixed(1)}`);
    }
    // 只看**瞬态**前置（风声 / 拉弓）：它们与命中音是同一类听感，倒挂最刺耳；
    // 床垫是背景，压过它没那么难受。
    const tr = pre.filter(c => roleOf(c) === "swing" || roleOf(c) === "draw");
    if (tr.length) {
      transientPairs++;
      if (loudestHit < Math.max(...tr.map(effPeak))) transient.push(id);
    }
  }
  return {all, transient, pairs, transientPairs};
}

test("倒挂棘轮：命中音比前置音轻的动作数", () => {
  const r = inversions();
  assert.ok(r.pairs >= 200, `只找到 ${r.pairs} 个双段动作，样本不足`);
  // 改造前 153 / 瞬态 23。改造后实测 39 / 13，其中 3 条与 3 条来自 cast.mjs 的
  // `strike.ranged.draw` 还挂着手挑的 0.8（见 LEGACY_ROLELESS）——那一处接进 gainFor 后是 36 / 10。
  assert.ok(r.all.length <= 39,
    `${r.all.length}/${r.pairs} 个动作的命中音比前置音轻（改造前 153，允许 ≤39）：\n`
    + r.all.slice(0, 8).join("\n"));
  /*
   * 【批 E 复算】瞬态那一档从 13 抬到 14，多出来的一条是**收益不是回归**：
   * 42 件天生/徒手武器此前**一条风声都排不进去**（psfx 的峰值在 360-610ms，来不及排到
   * 命中前 150ms，`strikeSounds` 整条丢掉），换成爪牙/拳风（峰值 50-270ms）之后
   * `necroticBite` / `corruptionVomit` 第一次有了风声——于是它们第一次成为「双段动作」，
   * 也第一次能被这条守卫量到。这两条的命中音是全库最惨的 `necrotic-00`（−22.6，欠 10.6 dB），
   * 倒挂的根在**素材**不在这一层：把风声撤回去能让数字变好看，代价是它们重新变哑。
   * 瞬态双段动作数同时从 78 涨到 94，比值反而从 13/78 降到 14/94。
   */
  assert.ok(r.transient.length <= 14,
    `${r.transient.length}/${r.transientPairs} 个动作的命中音比**瞬态**前置音轻（改造前 23，允许 ≤14）：`
    + r.transient.slice(0, 8).join(" "));
});

/**
 * **volume 必须落在 Sequencer 认的域里。**
 *
 * `sequencer.js` 的 `SoundSection.volume()` 对非数字直接 throw，随后
 * `this._volume = Math.max(0, Math.min(1, inVolume))` 把 >1 悄悄吃掉——写 1.5 不会更响，
 * 只会让计划里的数字骗人。下钳 0.10 是本仓库自己的防御值。
 */
test("每条音效 cue 的 volume 都在 [0.10, 1.00] 且是有限数", () => {
  const bad = [];
  for (const [s, c] of CUES) {
    if (!Number.isFinite(c.volume) || c.volume < GAIN_FLOOR - 1e-9 || c.volume > GAIN_CEIL + 1e-9) {
      bad.push(`${s.id} / ${c.rule}: volume=${c.volume}`);
    }
  }
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} 条 volume 越界`);
});

/**
 * **volume 必须真的是量测反算出来的**，不是 `?? <原常数>` 那条退路在顶着。
 *
 * 判据自己从 `audio-profiles.json` 重算一遍 `10^((目标 − 基准)/20)`，只借用 `GAIN_TARGET`
 * 这四个**常数**——常数不是量测，所以这不是同义反复：`gainFor()` 的实现、SFX 表的第 5/6 列、
 * 兵库那四处调用，任何一处走样都会在这里现形。
 */
test("volume 与量测反算的目标一致（走了 gainFor，不是退回手挑常数）", () => {
  const bad = [];
  for (const [s, c] of CUES) {
    const role = c.soundRole;
    if (!role) continue;                       // 没报角色的另有一条守卫
    const t = GAIN_TARGET[role];
    const pr = PROFILES[c.file];
    const base = t.base === "rms" ? pr.rmsDb : pr.peakDb;
    const want = Math.min(GAIN_CEIL, Math.max(GAIN_FLOOR, 10 ** ((t.db - base) / 20)));
    if (Math.abs(c.volume - want) > 0.002) {
      bad.push(`${s.id} / ${c.rule} [${role}]: volume=${c.volume} 应为 ${want.toFixed(3)}`
             + `（${t.base}Db=${base}，目标 ${t.db}）`);
    }
  }
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} 条 volume 对不上量测反算值`);
});

/** 每条音效 cue 都要报角色；漏报的只有那张欠账单上的，且数量只许减不许增。 */
test("音效 cue 必须报 soundRole，且角色必须是登记过的那四个", () => {
  const bad = [], roleless = [];
  for (const [s, c] of CUES) {
    if (c.soundRole == null) {
      if (!(c.rule in LEGACY_ROLELESS)) {
        bad.push(`${s.id} / ${c.rule}: 没有 soundRole，也不在欠账单里`);
      } else roleless.push(c.rule);
      continue;
    }
    if (!(c.soundRole in GAIN_TARGET)) bad.push(`${s.id} / ${c.rule}: 角色 "${c.soundRole}" 不认识`);
  }
  assert.deepEqual(bad.slice(0, 10), [],
    `${bad.length} 条音效 cue 的角色有问题。volume 归一化按角色分档，`
    + "角色**只能由规则显式声明**——从素材猜会把 4 条斩击命中与 2 条重挥风声猜成施法床垫。");
  assert.ok(roleless.length <= LEGACY_ROLELESS_MAX,
    `没报角色的音效 cue 涨到 ${roleless.length} 条（欠账单上限 ${LEGACY_ROLELESS_MAX}）`);
});

/**
 * **交叉验证：施法床垫的时域峰均比棘轮，以及「这个量不能当判据」的反证。**
 *
 * ## 它在守什么
 *
 * `GAIN_TARGET.cast` 用 RMS 作基准，而守卫与耳朵看的是**峰值**——两者之间隔的正是
 * 峰均比 `peakDb − rmsDb`。所以「cast 族的峰均比上限」就是「cast 那一档 dB 数该往下压多少」
 * 的直接输入：上限涨 1 dB，同一个 RMS 目标下床垫的峰值就高 1 dB。
 * **这个数一涨就必须重扫 `GAIN_TARGET.cast`**，否则床垫会重新压过命中音。
 *
 * 【批 E 复算】口径与阈值都换过一次，两处都要说清：
 *  · **口径**：旧版按文件路径含 `/casting/` 选样本——那是 psfx 的目录名。12 符文施法音
 *    换成 ggg 之后这条路径只剩 4 个文件（`CAST_DEFAULT` 的兜底池），样本量断言直接红，
 *    而且它量的已经不是「真正在当床垫用的那些素材」。改成按**计划里的 `soundRole`** 选，
 *    与厂商目录结构解耦，换素材族不会让守卫失去对象（47 条）。
 *  · **阈值**：10.4 → 13.5。psfx 施法族 24/24 在 10.4 以下，ggg 施法族最高 13.2
 *    （`Ailments Hypnotize 002` 与 `Arcane Ripple 004`，两条都是「一团渐强里带一个爆点」）。
 *    这正是 cast 的 RMS 目标从 −25 重扫到 −30 的原因，两处必须一起读。
 *
 * ## 反向断言仍然是禁止的，而且现在有了硬反证
 *
 * ⚠ 不要写成「峰均比低的就是 cast」。本语料实测各角色的峰均比上限：
 * impact **21.1**（`magicaleffects-cold-00`）、swing 15.2、draw 13.4、cast 13.2
 * ——**命中族的上限比床垫族还高 7.9 dB，两族完全重叠**。照着这个量写运行时判据，
 * 会把一记命中压进床垫档。下面第二条断言把这个反证钉住：它红了说明重叠没了，
 * 那时才谈得上「峰均比能分开两族」，而不是反过来。
 */
test("交叉验证：施法床垫的峰均比棘轮 ≤13.5，且它与命中族仍然重叠（不许写反向断言）", () => {
  const crestOf = f => PROFILES[f].peakDb - PROFILES[f].rmsDb;
  const byRole = new Map();
  for (const [, c] of CUES) {
    const r = roleOf(c);
    if (!r) continue;
    if (!byRole.has(r)) byRole.set(r, new Set());
    byRole.get(r).add(c.file);
  }
  const cast = [...(byRole.get("cast") ?? [])];
  assert.ok(cast.length >= 20, `只找到 ${cast.length} 条在 cast 角色上用的素材`);

  const bad = cast.map(f => [f.split("/").pop(), +crestOf(f).toFixed(1)])
    .filter(([, c]) => c > 13.5).sort((a, b) => b[1] - a[1]);
  assert.deepEqual(bad, [], `${bad.length} 条施法素材的峰均比越过 13.5——`
    + "床垫的峰值会跟着抬高，`GAIN_TARGET.cast` 的 RMS 目标必须重扫（见那边的扫描表）。");

  const castMax = Math.max(...cast.map(crestOf));
  const other = [...byRole].filter(([r]) => r !== "cast").flatMap(([, s]) => [...s]);
  assert.ok(other.some(f => crestOf(f) > castMax),
    "峰均比不再与 cast 族重叠了：这条守卫是用来证明『峰均比不能当角色判据』的，"
    + "重叠消失说明前提变了，要重新论证，而不是顺手把它写成运行时判据。");
});

/**
 * **欠额棘轮**：够不到角色目标的素材清单。
 *
 * volume 只能衰减（Sequencer clamp 到 1），所以「比目标轻」的素材**只能靠换素材去修**。
 * 这条把缺口钉住：条数 ≤17、最大欠额 ≤10.6 dB（`necrotic-00`，一条顶 corruption + void
 * 两种伤害类型）。把某个键指到更轻的素材上，两个数都会涨。
 *
 * 【批 E 复算】14 → 17：`HIT_SOUND.piercing` 从借用的 `slashing.v1` 换成
 * `piercing_damage_spell`（3 文件），三条的峰值都到不了 −12（欠 4.3 / 4.7 / 4.8 dB）。
 * **这是拿响度换语义，账要记明**：换回去能让这三条消失，代价是 24/92 件穿刺武器
 * 继续播斩击音。最大欠额没动（仍是 necrotic-00 的 10.6），也就是说没有新的最惨条目。
 * 真正的解法在素材侧——§2.4 给全部 12 个伤害类型开的 `canim.mgs.basic.combat.*_damage`
 * 那一族，本轮只动了 piercing 一个键。
 */
test("欠额棘轮：够不到目标响度的素材不许再多、也不许更惨", () => {
  const seen = new Map();                      // file -> role（本语料里实际用到的组合）
  for (const [, c] of CUES) {
    const r = roleOf(c);
    if (r) seen.set(c.file, r);
  }
  const short = [];
  for (const [f, role] of seen) {
    const t = GAIN_TARGET[role];
    const pr = PROFILES[f];
    const base = t.base === "rms" ? pr.rmsDb : pr.peakDb;
    const v = Math.min(GAIN_CEIL, Math.max(GAIN_FLOOR, 10 ** ((t.db - base) / 20)));
    const gap = t.db - (base + 20 * Math.log10(v));
    if (gap > 0.05) short.push([f.split("/").pop(), +gap.toFixed(1)]);
  }
  short.sort((a, b) => b[1] - a[1]);
  assert.ok(short.length <= 17,
    `够不到目标的素材涨到 ${short.length} 条（允许 ≤17）：${JSON.stringify(short.slice(0, 6))}`);
  assert.ok((short[0]?.[1] ?? 0) <= 10.6,
    `最大欠额涨到 ${short[0]?.[1]} dB（允许 ≤10.6，来自 necrotic-00）`);
});

/**
 * **SFX 表不许过期。**
 *
 * 表是 `npm run sounds` 从 `data/audio-profiles.json` 生成的。换了素材却不重跑，
 * 后两列就会留在上一支素材的电平上，而 volume 正是按它反算的——听感会整体偏掉，
 * 且没有任何别的守卫看得见。这条逐条比六列。
 */
test("SFX 表的六列与 audio-profiles 逐条一致（防表过期）", () => {
  const bad = [];
  for (const [f, row] of Object.entries(SFX)) {
    const pr = PROFILES[f];
    if (!pr) { bad.push(`${f}: 量测文件里没有这条`); continue; }
    const want = [Math.round(pr.peakMs ?? 0), Math.round(pr.onsetMs ?? 0),
                  Math.round(pr.effectiveMs ?? pr.durationMs ?? 0), Math.round(pr.durationMs ?? 0),
                  Math.round((pr.peakDb ?? 0) * 10) / 10, Math.round((pr.rmsDb ?? 0) * 10) / 10];
    if (row.length !== 6 || want.some((v, i) => v !== row[i])) {
      bad.push(`${f.split("/").pop()}: 表 [${row.join(",")}] ≠ 量测 [${want.join(",")}]`);
    }
  }
  assert.deepEqual(bad.slice(0, 6), [],
    `${bad.length} 条对不上——换过素材就得重跑 \`npm run sounds\`。`);
});
