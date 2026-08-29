/**
 * 状态层的**声音**（批次 E · 规格 §4.2）。
 *
 * 交付前实测：`persist` 槽 46 个状态 **0 条声音**，`persistOff`（摘下）槽在结构上**不存在**。
 * 本文件钉的是这一层落地之后的四件事：
 *   §1 判据「短」—— 每条上身音 `min(duration, effectiveMs) < 1500ms`（规格给的守卫 ⑤）；
 *   §2 `dead` 显式静默（规格给的守卫 ③ / 闸 c）；
 *   §3 复用 —— 12 组各摇各的池，组与组之间零重叠；
 *   §4 响度 —— **回 `data/audio-profiles.json` 重算**，不读 `statusGain()` 的返回值。
 *
 * 与 test/effects-persist-off.test.mjs 的分工：那边是 persistOff 槽（摘下）的形状与触发
 * 层，这边是 persist 槽（上身）的兵库层，外加两槽共用的响度口径。
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {resolveEffect} from "../scripts/resolver/resolve.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import {GROUP_SOUND, STATUS_SOUND_DB, STATUS_SOUND_MAX_MS, NO_PERSIST, STATUS_GROUP}
  from "../scripts/armory/persist.mjs";
import {SFX, GAIN_FLOOR, GAIN_CEIL, poolFor} from "../scripts/armory/sound-table.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const effects = JSON.parse(readFileSync(join(ROOT, "test/fixtures/effects.json"), "utf8"));
/** 判据的**唯一**真值来源：兵库改什么都不影响它。 */
const PROFILES = JSON.parse(readFileSync(join(ROOT, "data/audio-profiles.json"), "utf8")).profiles;
const mk = () => createAssets(offlineBackend(index));

/** 全语料的状态音 cue：`[快照, cue]`，两槽都收。 */
const cuesIn = slot => effects.flatMap(e => {
  const p = resolveEffect(e, {assets: mk(), armory: ARMORY}, slot);
  return (p?.cues ?? []).filter(c => c.kind === "sound").map(c => [e, c]);
});
const ON = cuesIn("persist");
const OFF = cuesIn("persistOff");

/* -------------------------------------------- */
/*  §1 判据「短」                                 */
/* -------------------------------------------- */

/**
 * 规格给的守卫 ⑤。状态提示音是「上身了」这一下的标点，不是一段音乐——拖过 1.5 秒就会
 * 盖住紧随其后的下一个动作，而状态在一场战斗里出现的频次远高于任何一条动作规则。
 *
 * `min(duration, effectiveMs)` 而不是单看哪一个：`duration` 是兵库的硬切点，
 * `effectiveMs` 是素材自己的有声长度（尾部静音已扣除），实际听到多久是两者的小者。
 * ⚠ 判据回 `SFX` 表取 `effectiveMs`，**不读兵库里那个 capMs**：读了就是「表等于表」，
 * 换素材换成一条 4 秒的也照样绿。
 */
test("守卫 ⑤：每条上身音 min(duration, effectiveMs) < 1500ms", () => {
  const bad = [];
  for (const [e, c] of ON) {
    const eff = SFX[c.file]?.[2];
    assert.ok(typeof eff === "number",
      `${c.file} 不在 SFX 表里 —— 没有它就没有 duration、没有归一化（npm run sounds 没跑？）`);
    const heard = Math.min(c.duration ?? Infinity, eff);
    if (heard >= STATUS_SOUND_MAX_MS) bad.push(`${e.statusId}/${c.rule}: ${heard}ms`);
  }
  assert.deepEqual([...new Set(bad)], [], `${bad.length} 条上身音太长`);
  assert.equal(STATUS_SOUND_MAX_MS, 1500);
});

/**
 * 反向自检：上面那条 0 不能是「因为压根没有声音」得来的。
 *
 * 交付前正是这个状态——46 个状态一条 sound cue 都没有，一条「所有 sound cue 都够短」的
 * 断言在那时是恒真的。
 */
test("语料自检：46 个状态里除 dead 之外条条有一条上身音", () => {
  const audible = effects.filter(e => !NO_PERSIST.includes(e.statusId));
  assert.equal(effects.length, 46, "状态语料条数变了");
  assert.equal(ON.length, audible.length,
    `${audible.length} 个状态只产出了 ${ON.length} 条上身音`);
  assert.equal(OFF.length, audible.length,
    `${audible.length} 个状态只产出了 ${OFF.length} 条摘下音`);
});

/**
 * 五条硬切点是**实测过包络**才定的（ffmpeg 单声道 22050Hz、10ms 窗 RMS、50ms 平滑）。
 * 这条断言钉的不是包络本身（那要解音频，测试里跑不动），而是「切点确实咬住了素材」：
 * `capMs` 必须真的比该池最长那条的有声内容短，否则它就是一个写着好看、实际从不生效的
 * 数字——而那样的话上面那条 <1500 就是靠素材侥幸过的，换一支变体立刻破。
 */
test("五个带 capMs 的组：切点必须真的咬住素材（不是写着好看的数字）", () => {
  const capped = Object.entries(GROUP_SOUND).filter(([, c]) => c.capMs !== null);
  assert.deepEqual(capped.map(([g]) => g).sort(),
    ["bleed", "buff", "burning", "fear", "haste"],
    "带硬切点的组变了：新的切点必须先实测包络（见 GROUP_SOUND 上方那张表）再改这里");
  const idle = [];
  for (const [group, cfg] of capped) {
    const files = poolFor(cfg.path).flatMap(p => mk().resolve(p)?.files ?? []);
    assert.ok(files.length, `${group} 的路径 ${cfg.path} 解析不到`);
    const longest = Math.max(...files.map(f => SFX[f]?.[3] ?? 0));
    if (cfg.capMs >= longest) idle.push(`${group}: capMs ${cfg.capMs} ≥ 素材总长 ${longest}`);
    assert.ok(cfg.capMs < STATUS_SOUND_MAX_MS,
      `${group} 的 capMs ${cfg.capMs} 没落在 1500 判据内（严格小于）`);
  }
  assert.deepEqual(idle, [], idle.join("\n"));
});

/* -------------------------------------------- */
/*  §2 dead 显式静默                              */
/* -------------------------------------------- */

/**
 * 规格给的守卫 ③ / 闸 c。`STATUS_GROUP` 把 `dead` 归在 **stun 组**——新的声音层若只照抄
 * 那张表，**每一次有人倒下都会播一声眩晕音**。挡住它的是 `status.silent`（pri 900，
 * 排在 12 条分组规则之前）返回 null，而不是把键从 STATUS_GROUP 里删掉（删了会掉进
 * generic.persist 兜底，比现状更糟）。
 *
 * 两端都要断：上身与摘下。
 */
test("守卫 ③：statusId=\"dead\" 在 persist / persistOff 两槽都产 0 条 cue", () => {
  const dead = effects.find(e => e.statusId === "dead");
  assert.ok(dead, "语料前提：fixture 里必须仍有 dead");
  assert.equal(STATUS_GROUP.dead, "stun",
    "dead 从 stun 组挪走了：那正是这条守卫存在的理由，挪之前先读规格 §4.2 闸 c");
  for (const slot of ["persist", "persistOff"]) {
    const plan = resolveEffect(dead, {assets: mk(), armory: ARMORY}, slot);
    assert.equal(plan, null, `dead 在 ${slot} 槽产出了 cue`);
  }
  // 对照组：同组的另一个状态必须照常有声，否则上面两个 null 可能只是「stun 组整个坏了」。
  const stunned = effects.find(e => e.statusId === "stunned");
  const p = resolveEffect(stunned, {assets: mk(), armory: ARMORY});
  assert.ok(p.cues.some(c => c.kind === "sound"), "对照组：stunned 必须有上身音");
});

/* -------------------------------------------- */
/*  §3 复用                                       */
/* -------------------------------------------- */

/**
 * **复用棘轮。** 直接对着 owner 那句「尽量不复用」。
 *
 * 交付前状态层是 0 条声音 / 0 个素材；本轮实测 45 条 cue / **26 个素材** / 最大桶 4
 * （`Ailments Stun 001`，8.9%）。素材数比 cue 数的一半还多，说明池是真的在摇。
 */
test("复用棘轮：上身音 ≥26 个素材，最大桶 ≤12%", () => {
  const hist = new Map();
  for (const [, c] of ON) hist.set(c.file, (hist.get(c.file) ?? 0) + 1);
  assert.ok(hist.size >= 26, `上身音只剩 ${hist.size} 个素材（本轮实测 26）`);
  const [top, n] = [...hist.entries()].sort((a, b) => b[1] - a[1])[0];
  assert.ok(n / ON.length <= 0.12,
    `${top.split("/").pop()} 一支占 ${(n / ON.length * 100).toFixed(1)}%（${n}/${ON.length}）`);
});

/**
 * **12 组两两零重叠。** 状态层是一套**索引**：一个 token 上可以同时挂好几条状态，
 * 玩家靠「哪一声」反查是哪一组。两组共用一个文件，索引就断了——这与画面侧
 * test/armory-persist-distinct.test.mjs 用 CIEDE2000 钉 66 对颜色是同一件事的听觉版。
 */
test("12 组的音效池两两不重叠", () => {
  const filesOf = path => new Set(poolFor(path).flatMap(p => mk().resolve(p)?.files ?? []));
  const pools = Object.entries(GROUP_SOUND).map(([g, c]) => [g, filesOf(c.path)]);
  for (const [g, s] of pools) assert.ok(s.size >= 2, `${g} 的池只有 ${s.size} 个文件`);
  const clash = [];
  for (let i = 0; i < pools.length; i++) {
    for (let j = i + 1; j < pools.length; j++) {
      const both = [...pools[i][1]].filter(f => pools[j][1].has(f));
      if (both.length) clash.push(`${pools[i][0]} / ${pools[j][0]} 共用 ${both.length} 个文件`);
    }
  }
  assert.deepEqual(clash, [], clash.join("\n"));
});

/**
 * **池要真的被摇到。** ggg-sfx 全库是并列编号子枝，`assets.resolve` 对分支只取其下第一个
 * 叶子——写 `ctx.sound(分支路径)` 一样有声、一样过前面每一条守卫，**只是永远播同一个
 * 文件**。整池由 `sound-table.mjs` 的 `POOL` 机械展开、`ctx.soundFrom` 摇。
 * 这条断言逐组跨 200 个种子求解，要求每一组都摇得遍自己那一池。
 */
test("12 组逐组跨 200 种子摇得遍整池，一条不漏", () => {
  const base = effects.find(e => e.statusId === "poisoned");
  const thin = [];
  for (const [group, cfg] of Object.entries(GROUP_SOUND)) {
    const rule = ARMORY.persist.find(r => r.id === `status.${group}`);
    const pool = new Set(poolFor(cfg.path).flatMap(p => mk().resolve(p)?.files ?? []));
    const seen = new Set();
    for (let seed = 0; seed < 200; seed++) {
      const plan = resolveEffect({...base, seed},
        {assets: mk(), armory: {persist: [{...rule, when: () => true}]}});
      for (const c of plan?.cues ?? []) if (c.kind === "sound") seen.add(c.file);
    }
    if (seen.size !== pool.size) thin.push(`${group}: 池 ${pool.size} 个文件，只摇出 ${seen.size} 个`);
  }
  assert.deepEqual(thin, [], thin.join("\n"));
});

/* -------------------------------------------- */
/*  §4 响度                                       */
/* -------------------------------------------- */

/** 一条 cue 的**有效峰值**（dBFS）：素材自身峰值叠上这条 cue 的 volume。两个来源互相独立。 */
const effPeak = c => PROFILES[c.file].peakDb + 20 * Math.log10(c.volume);

/**
 * **volume 必须真的是量测反算出来的**，不是手挑常数、也不是 `?? 0.4` 那条退路在顶着。
 *
 * 判据自己从 `audio-profiles.json` 重算 `10^((STATUS_SOUND_DB − peakDb)/20)` 再钳位，
 * 只借用 `STATUS_SOUND_DB` / `GAIN_FLOOR` / `GAIN_CEIL` 三个**常数**——常数不是量测，
 * 所以这不是同义反复：`statusGain()` 的实现、SFX 表的第 5 列、两槽的调用点，
 * 任何一处走样都会在这里现形。
 */
test("每条状态音的 volume 都由量测反算（不是手挑常数）", () => {
  const bad = [];
  for (const [e, c] of [...ON, ...OFF]) {
    const peak = PROFILES[c.file]?.peakDb;
    assert.ok(typeof peak === "number", `${c.file} 没有量测`);
    const want = Math.round(Math.min(GAIN_CEIL, Math.max(GAIN_FLOOR,
      10 ** ((STATUS_SOUND_DB - peak) / 20))) * 1000) / 1000;
    if (Math.abs(c.volume - want) > 1e-9) bad.push(`${e.statusId}/${c.rule}: ${c.volume} ≠ ${want}`);
    if (!(c.volume >= GAIN_FLOOR - 1e-9 && c.volume <= GAIN_CEIL + 1e-9)) {
      bad.push(`${e.statusId}/${c.rule}: volume=${c.volume} 越界`);
    }
  }
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} 条 volume 不是反算来的`);
});

/**
 * **角色内跨度。** 状态层是同一类信息的一套索引，响度必须齐——某一组明显更响，玩家会
 * 以为那一组更要紧。本轮实测：上身 1.3 dB、摘下 0.0 dB（摘下那 0.0 是因为 Shield Counter
 * 两条 peakDb 完全相等），都远在规格给的「同 role ≤8 dB」线内。
 *
 * ⚠ 顶上钳（volume=1.0）的素材达不到目标：本层最轻的是 `Air Suck A`（peakDb −19.3，
 * 比 −18 目标还轻 1.3 dB），跨度里的 1.3 就是它一条贡献的。要更齐只能换素材，
 * 不是调这一层能解决的。
 */
test("响度棘轮：上身音跨度 ≤2.5 dB、摘下音跨度 ≤1.0 dB", () => {
  for (const [name, cues, ceil] of [["上身", ON, 2.5], ["摘下", OFF, 1.0]]) {
    const eff = cues.map(([, c]) => effPeak(c)).sort((a, b) => a - b);
    const span = eff[eff.length - 1] - eff[0];
    assert.ok(span <= ceil,
      `${name}音有效峰值跨度 ${span.toFixed(1)} dB`
      + `（min ${eff[0].toFixed(1)} / max ${eff[eff.length - 1].toFixed(1)}），登记上限 ${ceil}`);
  }
});

/**
 * **档位次序。** 状态提示音是次级信息，必须比「打中」轻、比施法床垫响。
 *
 * 三个数字都来自 `GAIN_TARGET` / `STATUS_SOUND_DB` 这几个常数本身，判的是**设计意图**
 * 有没有被后来的改动悄悄推翻——一条纯常数断言，跑得快、坏得响。
 */
test("档位次序：impact −12 > status −18 > cast −30(rms)", async () => {
  const {GAIN_TARGET} = await import("../scripts/armory/sound-table.mjs");
  assert.ok(GAIN_TARGET.impact.db > STATUS_SOUND_DB,
    "状态提示音不得比「打中」还响：它紧跟在那一击后面，喧宾夺主");
  assert.equal(STATUS_SOUND_DB, GAIN_TARGET.swing.db,
    "状态档与挥击风声同为「次级瞬态」，取同一个目标；换档要连 ASSET-NOTES 那 12 行一起重算");
  assert.equal(GAIN_TARGET.cast.base, "rms",
    "cast 是床垫按 RMS 对齐，与本层的峰值口径不可直接比大小");
});
