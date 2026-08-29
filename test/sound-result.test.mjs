/**
 * 音效**核心派发**的守卫 —— 「这一下该听见什么」是不是真的分开了。
 *
 * ## 这一层此前的三处坍缩（全部实测，全部是本文件的判据来源）
 *
 * | 坍缩 | 改造前 | 改造后 |
 * | --- | --- | --- |
 * | 8 档攻击结果 | `result 2/3/4/5/6/7` 输出**逐字节相同**，全库只有 2 种声音 | 每个动作 8 档产出 **8** 个不同命中音 |
 * | 42 件天生/徒手武器 | 风声集合与 50 件兵器**完全重合**（都是 psfx 的金属刀剑风声） | 两个集合**交集为空** |
 * | 12 个符文的施法音 | `cast-generic-03.ogg` 一支占 cast 槽 **136/215 = 63%** | 最大桶 **9/215 = 4.2%**，素材 24 → 50 |
 *
 * ## 判据一律独立算，不读被测那一侧的返回值
 *
 * - 响度回到 `data/audio-profiles.json` 的原始 `peakDb`/`rmsDb` 重算（`sound-gain.test.mjs`
 *   那边同法），不读 `gainFor()`；
 * - 「池到底摇不摇得动」用**跨 200 个种子的实际产出**去数，不读 `POOL` 的长度当结论
 *   （只拿它当**上限**比对）；
 * - 结果分档用**逐结果重解全语料**，不读 `RESULT_SOUND` 表本身。
 *
 * ⚠ 取音效 cue 一律 `kind === "sound"`，**不能靠下标**：音效 cue 排在画面之前，
 * 取 `[0]` 会拿到音效、取 `[cues.length-1]` 会拿到画面，这个坑仓库栽过三次。
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {createContext} from "../scripts/resolver/context.mjs";
import {resolve} from "../scripts/resolver/resolve.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import {RESULT, RESULT_NAME} from "../scripts/const.mjs";
import {SFX, POOL, poolFor} from "../scripts/armory/sound-table.mjs";
import {RESULT_SOUND, HIT_SOUND, MISS_SOUND, CAST_SOUND} from "../scripts/armory/sounds.mjs";
import {GROUP_SOUND} from "../scripts/armory/persist.mjs";
import {OFF_SOUND} from "../scripts/armory/persist-off.mjs";
import {ACTION_SOUND, STANCE_SOUND} from "../scripts/armory/self-shapes.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const actions = JSON.parse(readFileSync(join(ROOT, "test/fixtures/actions.json"), "utf8"));
const weapons = JSON.parse(readFileSync(join(ROOT, "test/fixtures/weapon-strikes.json"), "utf8"));
const PROFILES = JSON.parse(readFileSync(join(ROOT, "data/audio-profiles.json"), "utf8")).profiles;
const mk = () => createAssets(offlineBackend(index));

/** 单目标口径求解（`parallelizeTargets` 只改 delay，不改 file/volume）。 */
const solve = s => resolve({...s, targets: (s.targets ?? []).slice(0, 1)},
                          {assets: mk(), armory: ARMORY})?.cues ?? [];
const soundsOf = s => solve(s).filter(c => c.kind === "sound");
/** 一条兵库路径**真正会播出的文件集合**：先展开成池，再逐条解析。 */
const filesOf = dbPath => [...new Set(poolFor(dbPath).flatMap(p => mk().resolve(p)?.files ?? []))];

/**
 * 把一个动作改写成「这一下的结果是 r」。
 *
 * 刻意与 `test/coverage.test.mjs:47-56` 的构造**同形**（`results: [{result, critical:false}]`），
 * 那边已经在做 40 动作 × 8 结果的遍历、只是没有断言。**不新造 fixture 文件**：
 * 再造一份就会与 coverage 的构造分叉，两边同时腐烂而谁也发现不了。
 */
const withResult = (s, r) =>
  ({...s, targets: s.targets.map(t => ({...t, results: [{result: r, critical: false}]}))});

/** 语料里前 40 条「有目标的攻击动作」，与 coverage 那边取的是同一批。 */
const ATTACKS = actions.filter(a => a.usage.isAttack && a.targets.length).slice(0, 40);

/* -------------------------------------------- */
/*  一、8 档攻击结果                              */
/* -------------------------------------------- */

/**
 * **表必须把 8 个键都显式写出来，值可以是 null。**
 *
 * 「登记为不由结果决定（null）」与「忘了写」在代码上长得一模一样，而两者的语义相反。
 * Crucible 原生 `configureImpact()` 就漏了 RESIST 那个 case，本仓库不重蹈。
 */
test("RESULT_SOUND 必须覆盖全部 8 档结果，一个不许漏", () => {
  const missing = Object.values(RESULT).filter(r => !(r in RESULT_SOUND));
  assert.deepEqual(missing.map(r => RESULT_NAME[r]), [],
    "RESULT_SOUND 少了这几档。值可以写 null（含义是「交给伤害类型表」），但键必须在。");
  assert.equal(Object.keys(RESULT_SOUND).length, 8);
});

/**
 * **同一个动作，8 档结果必须听得出区别。**
 *
 * 改造前实测 result 2/3/4/5/6/7 六档的输出逐字节相同（`sighash` 一致），全语料
 * 只有 2 种声音。这条按「同一个动作跑 8 遍，命中音有几个不同 file」来量，
 * 语料 `actions.json` 的 642 条 result 全是 7，所以必须自己构造变体——
 * **不构造的话这条缺口现有测试一次都碰不到**。
 */
test("同一个动作的 8 档结果至少产出 5 个不同的命中音（改造前 2）", () => {
  const bad = [];
  let checked = 0;
  for (const base of ATTACKS) {
    const files = new Set();
    for (const r of Object.values(RESULT)) {
      for (const c of soundsOf(withResult(base, r))) {
        if (c.soundRole === "impact") files.add(c.file);
      }
    }
    if (!files.size) continue;              // 这条动作根本不出命中音（法术自我增益之类）
    checked++;
    if (files.size < 5) bad.push(`${base.id}: 8 档只产出 ${files.size} 种命中音`);
  }
  assert.ok(checked >= 20, `只量到 ${checked} 条会出命中音的攻击动作，样本不足`);
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} 条动作的结果分档塌了`);
});

/** 挡下「格挡/护甲/招架又被并回命中音」的回归——这正是改造前的形态。 */
test("BLOCK / ARMOR / PARRY / GLANCE 的声音都不等于 HIT", () => {
  const bad = [];
  for (const base of ATTACKS) {
    const fileFor = r => soundsOf(withResult(base, r))
      .filter(c => c.soundRole === "impact").map(c => c.file).join("|");
    const hit = fileFor(RESULT.HIT);
    if (!hit) continue;
    for (const r of [RESULT.BLOCK, RESULT.ARMOR, RESULT.PARRY, RESULT.GLANCE]) {
      if (fileFor(r) === hit) bad.push(`${base.id}: ${RESULT_NAME[r]} 与 HIT 同一条音（${hit}）`);
    }
  }
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} 处结果分档没生效`);
});

/**
 * **一中一空的目标取哪一掷 —— 这是一处显式的语义变更，必须钉住。**
 *
 * 旧实现 `results.some(r => r.result === 0 || r.result === 1)`：任一掷落空即整体算划空。
 * 画面那一侧从来不是这么取的（`impact.mjs` 逐目标取 `results[0]` 挂 `playIf`），
 * 于是一中一空的目标会**看见血花、听见划空**。现在两侧统一取 `results[0]`。
 *
 * 判据不看实现，只看产出：`[命中, 落空]` 的 file 必须落在命中音的池里，
 * `[落空, 命中]` 的 file 必须落在 `MISS_SOUND` 的池里。
 */
test("多掷骰目标按 results[0] 取声音（与画面同源），不是「任一落空即划空」", () => {
  const base = ATTACKS.find(a => a.strikes?.length);
  assert.ok(base, "语料里应有带武器的攻击动作");
  const twoRolls = (a, b) => ({...base, targets: base.targets.map(t => ({...t,
    results: [{result: a, critical: false}, {result: b, critical: false}]}))});

  const impactFiles = s => soundsOf(s).filter(c => c.soundRole === "impact").map(c => c.file);
  // ⚠ `poolFor` 给的是**路径**（单文件路径原样返回），cue 里躺的是**文件**——
  // 必须再 resolve 一次才能比，否则两条断言都空绿。
  const missPool = filesOf(MISS_SOUND);
  assert.ok(missPool.length, "落空音解析不出文件");

  const hitFirst = impactFiles(twoRolls(RESULT.HIT, RESULT.MISS));
  const missFirst = impactFiles(twoRolls(RESULT.MISS, RESULT.HIT));
  assert.ok(hitFirst.length && missFirst.length, "两种排列都该出命中音 cue");
  assert.ok(hitFirst.every(f => !missPool.includes(f)),
    `[命中, 落空] 取到了落空音 ${hitFirst}——又退回「任一落空即划空」了`);
  assert.ok(missFirst.every(f => missPool.includes(f)),
    `[落空, 命中] 应当取落空音，实得 ${missFirst}`);
});

/**
 * **8 档结果不许全挤在同一个音源族里。**
 *
 * 「分了 8 档」与「8 档听得出是 8 件不同的事」不是一回事：同一个厂商同一个文件夹里
 * 挑 8 条编号相邻的采样，量测上是 8 个 file、耳朵里仍是一种声音。族按**目录**切
 * （厂商就是按录音批次分目录的），判据独立于 DB 路径。
 */
test("8 档结果至少落在 5 个不同的音源族（目录）上", () => {
  const dirs = new Set();
  for (const r of Object.values(RESULT)) {
    for (const base of ATTACKS) {
      for (const c of soundsOf(withResult(base, r))) {
        if (c.soundRole === "impact") dirs.add(c.file.slice(0, c.file.lastIndexOf("/")));
      }
    }
  }
  assert.ok(dirs.size >= 5,
    `8 档结果只用了 ${dirs.size} 个音源族：${[...dirs].join(" / ")}`);
});

/* -------------------------------------------- */
/*  二、穿刺 / 天生武器                            */
/* -------------------------------------------- */

test("穿刺不再借用斩击音，而且它自己是个真池", () => {
  assert.notEqual(HIT_SOUND.piercing, HIT_SOUND.slashing,
    "piercing 又指回 slashing 了：24/92 件穿刺武器会重新播斩击音");
  const resolved = filesOf(HIT_SOUND.piercing);
  assert.ok(resolved.length >= 3,
    `穿刺命中音只解析出 ${resolved.length} 个文件——单文件等于每次命中都是同一个采样`);
});

/**
 * **天生武器的风声集合与制式兵器的风声集合必须不相交。**
 *
 * 改造前两个集合**完全重合**：42 件獠牙/爪/触手/拳与 50 件刀剑斧锤同用
 * `psfx.weapon-swooshes.{light,heavy}` 两条池。`sounds.mjs` 里那句「爪牙不是刀剑」
 * 当时只挡住了元素矩阵那一支，掉下来立刻落回金属刀剑风声。
 *
 * 判据走 `test/fixtures/weapon-strikes.json` 的 92 件逐件求解，**不读 `NATURAL_WHOOSH` 表**。
 */
test("42 件天生/徒手武器的风声与 50 件兵器的风声毫不相干", () => {
  const nat = new Set(), arm = new Set();
  let natCount = 0;
  for (const w of weapons) {
    const st = w.strikes?.[0];
    if (!st) continue;
    const isNat = (st.properties ?? []).includes("natural") || st.category === "unarmed";
    if (isNat) natCount++;
    for (const c of soundsOf(w)) {
      if (c.soundRole === "swing") (isNat ? nat : arm).add(c.file);
    }
  }
  assert.ok(natCount >= 40, `语料里的天生/徒手武器只剩 ${natCount} 件`);
  assert.ok(nat.size >= 2 && arm.size >= 2, `风声素材太少：天生 ${nat.size} / 兵器 ${arm.size}`);
  const shared = [...nat].filter(f => arm.has(f));
  assert.deepEqual(shared, [],
    `${shared.length} 条风声同时给天生武器和制式兵器用——「獠牙发出金属刀剑风声」又回来了`);
});

/**
 * **风声与命中音的同出率棘轮。**
 *
 * `strikeSounds` 在「风声挤不到命中音前面」时会把整条风声丢掉（「铛——唰」比没有风声更糟）。
 * 改造前 118 个出攻击音的目标组里 **35 组只剩命中音**（29.7%，其中 33 组是 `strike.unarmed`
 * ——psfx 风声的峰值在 360-610ms，根本排不进命中前 150ms 的窗口）。
 *
 * 现在 111/118 = **94.1%**。剩下的 7 组全部是**制式兵器**（`strike.melee` 5 + `strike.thrown` 2），
 * 它们还挂在 psfx 的 light/heavy 上——要到 95% 以上得做 §2.2 的形态风声那一批
 * （ggg 的 `melee.{blade,bludgeoning,axe,polearm}.strike.*`，峰值 40-150ms），不在本轮范围。
 * 所以棘轮钉在 93%：只许涨不许跌，而 95% 这个目标要靠换素材去够，不是靠调这一层。
 */
test("挥击类规则的「风声 + 命中音」同出率 ≥93%（改造前 70.3%）", () => {
  let both = 0, only = 0;
  const missing = [];
  for (const s of actions) {
    const plan = resolve(s, {assets: mk(), armory: ARMORY});
    if (!plan) continue;
    for (const t of s.targets ?? []) {
      const snd = plan.cues.filter(c => c.slot === "travel" && c.forTarget === t.tokenId
                                     && c.kind === "sound");
      // 只看挥击类规则：法术命中（`spellImpactSound`）**按构造就不出风声**，
      // 把它们算进分母会把这条守卫稀释成量不出东西的 52%。
      if (!snd.length || !snd[0].rule?.startsWith("strike.")) continue;
      if (snd.some(c => c.soundRole === "swing")) both++;
      else { only++; missing.push(`${s.id} / ${snd[0].rule}`); }
    }
  }
  assert.ok(both + only >= 100, `只量到 ${both + only} 个挥击目标组，样本不足`);
  const rate = both / (both + only);
  assert.ok(rate >= 0.93,
    `同出率掉到 ${(rate * 100).toFixed(1)}%（${only}/${both + only} 组只剩命中音）：\n`
    + missing.slice(0, 8).join("\n"));
});

/* -------------------------------------------- */
/*  三、显式池                                    */
/* -------------------------------------------- */

/**
 * **每条显式池都要真的摇得动，而且摇得遍。**
 *
 * 这条抓的是本轮最容易犯的那个错：ggg 全库都是并列的编号子枝，`assets.resolve` 对分支
 * 只取第一个叶子——**规则里写 `ctx.sound(分支路径)` 一样跑得通、一样有声音、
 * 一样过得了所有既有守卫，只是永远播同一个文件**。判据数的是「跨 200 个种子实际摇出
 * 多少个不同文件」，与池长比对；写成 `ctx.sound` 的那条路径会立刻掉到 1。
 */
test("POOL 里每条池跨种子都摇得遍（写成 ctx.sound 就会掉到 1）", () => {
  const bad = [];
  for (const [path, pool] of Object.entries(POOL)) {
    const seen = new Set();
    for (let seed = 0; seed < 200; seed++) {
      const ctx = createContext({assets: mk(), snapshot: {seed}, seed});
      seen.add(ctx.soundFrom(pool)?.file);
    }
    if (seen.size !== pool.length) bad.push(`${path}: 200 个种子只摇出 ${seen.size}/${pool.length}`);
  }
  assert.ok(Object.keys(POOL).length >= 15, `显式池只剩 ${Object.keys(POOL).length} 条`);
  assert.deepEqual(bad, [], bad.join("\n"));
});

/**
 * **兵库里当池用的路径，产出必须真的散开。**
 *
 * 上面那条量的是 `soundFrom` 本身；这条量的是**规则有没有用上它**——同一条规则跨 200
 * 个种子求解，产出的不同文件数必须等于它那条池的大小。把 `pick()` 改回 `ctx.sound`，
 * 12 个符文的施法音会一起掉到 1。
 */
test("12 符文的施法音逐个符文都摇得遍自己那一池", () => {
  const byRune = new Map();
  for (const s of actions) if (s.spell?.rune && !byRune.has(s.spell.rune)) byRune.set(s.spell.rune, s);
  assert.equal(byRune.size, 12, `语料里只找到 ${byRune.size} 个符文`);

  const bad = [];
  for (const [rune, s] of byRune) {
    const want = poolFor(CAST_SOUND[rune]).length;
    const seen = new Set();
    for (let seed = 0; seed < 200; seed++) {
      for (const c of soundsOf({...s, seed})) if (c.soundRole === "cast") seen.add(c.file);
    }
    if (seen.size !== want) bad.push(`${rune}: 200 个种子摇出 ${seen.size} 种，池里有 ${want}`);
  }
  assert.deepEqual(bad, [], `${bad.length} 个符文的施法音没有真的用上池：\n${bad.join("\n")}`);
});

/**
 * **复用棘轮：cast 槽里单个文件的占比。**
 *
 * 这是直接对着 owner 那句「尽量不复用」的守卫，与响度守卫正交。
 * 改造前 `cast-generic-03.ogg` 一支占 cast 槽 **136/215 = 63.3%**（全语料 24.7%）；
 * 现在最大桶 9/215 = 4.2%、素材 24 → 50。
 */
test("复用棘轮：cast 槽最大桶 ≤10%，施法素材 ≥40 个", () => {
  const hist = new Map();
  for (const s of actions) {
    for (const c of soundsOf(s)) {
      if (c.soundRole !== "cast") continue;
      hist.set(c.file, (hist.get(c.file) ?? 0) + 1);
    }
  }
  const total = [...hist.values()].reduce((a, b) => a + b, 0);
  assert.ok(total >= 150, `cast 音效 cue 只有 ${total} 条，样本不足`);
  assert.ok(hist.size >= 40, `施法音素材只剩 ${hist.size} 个（改造前 24，本轮实测 50）`);
  const [top, n] = [...hist.entries()].sort((a, b) => b[1] - a[1])[0];
  assert.ok(n / total <= 0.10,
    `${top.split("/").pop()} 一支占 cast 槽 ${(n / total * 100).toFixed(1)}%（${n}/${total}）`);
});

/* -------------------------------------------- */
/*  四、素材形态                                  */
/* -------------------------------------------- */

/**
 * **池内起音差得太多会听成节奏乱。**
 *
 * ⚠ 规格原文的判据是「池内 `peakMs` max/min ≤2」，**这个形式量不出想量的东西，本轮换成极差**：
 *  · `ggg-sfx.melee.bludgeoning.block.two-hand.01` 的比值是 **50.0**（一条峰值 0ms、
 *    另一条 50ms）——耳朵听到的是 50ms 的差别，比值大得吓人只是因为分母趋近 0；
 *  · 反过来「1000ms 与 2000ms」比值只有 2.0 却差整整一秒。
 * 极差直接就是「同一池里两次抽样，响点最多差多少毫秒」，与听感一一对应。
 *
 * **cast 角色整族豁免，理由是构造上的**：施法床垫走 `delay: 0` 起播、不做峰值对齐
 * （`spellCastSound` 按 RMS 归一化，见 `GAIN_TARGET`），池内 peakMs 怎么散都不改变
 * 「什么时候开始听见」。瞬态那三档才靠 `soundAt` 把峰值钉到命中点上。
 * 实测瞬态池的极差上限是 240ms（`claws.strike.stab.01` 的 19 变体），阈值取 250。
 *
 * 【批次 E】状态层的 `status` / `statusOff` 两档同理豁免，而且是**同一条构造理由**：
 * `armory/persist.mjs` 的 `statusSoundCue` 与 `armory/persist-off.mjs` 的 `offSoundCue`
 * 都写 `delay: 0`、都不写 `startTime`、都不经 `soundAt` —— 状态提示音不跟任何一帧画面
 * 对拍（光环是稳态标记，摘下音对应的是同一帧收掉的那圈光），池内峰值散到哪里都不改变
 * 「什么时候开始听见」。豁免名单从两张兵库表现取，不手抄：换素材时自动跟着走。
 */
test("瞬态用的池，池内 peakMs 极差 ≤250ms", () => {
  // 【批次 E · §4.1】动作起手音（`self-shapes.mjs` 的 `ACTION_SOUND` / `STANCE_SOUND`）
  // 同理豁免，而且是**同一条构造理由**：`cast.mjs` 的 `actionSound` 写 `delay: 0`、
  // 不经 `soundAt`、按 RMS 归一化（soundRole 就是 "cast"），池内峰值散到哪里都不改变
  // 「什么时候开始听见」。⚠ 实测只有 `ggg-sfx.magic.primal.cast.animate_tree.01` 一条
  // 越线（peakMs 极差 760ms，四条 330/610/860/1090ms）——它是林木苏醒的四个变奏，
  // 「起得慢一点」正是这支素材的样子，而不是排错了拍。
  const castPaths = new Set([
    ...Object.values(CAST_SOUND),
    ...Object.values(GROUP_SOUND).map(c => c.path),
    ...Object.values(OFF_SOUND).map(c => c.path),
    ...Object.values(ACTION_SOUND),
    ...Object.values(STANCE_SOUND)
  ]);
  const bad = [];
  for (const [path, pool] of Object.entries(POOL)) {
    if (castPaths.has(path) || path === "psfx.casting.generic") continue;   // 床垫不做峰值对齐
    const peaks = pool.map(f => PROFILES[f]?.peakMs).filter(v => typeof v === "number");
    if (peaks.length < 2) continue;
    const range = Math.max(...peaks) - Math.min(...peaks);
    if (range > 250) bad.push(`${path}: peakMs 极差 ${Math.round(range)}ms`);
  }
  assert.deepEqual(bad, [], `${bad.length} 条池的起音散得太开：\n${bad.join("\n")}`);
});

/**
 * **`kind: "sound"` 的 file 必须真的是音频。**
 *
 * 索引里 `eskie.sound.roar` 这类路径的叶子是 **`.webm`**（人家是**画面**族，只是名字里带
 * sound）。挂到音效 cue 上离线全绿、上机一声不响。扩展名判据独立于任何表。
 */
test("音效 cue 的 file 扩展名必须是音频", () => {
  const AUDIO = /\.(ogg|mp3|wav|m4a|flac|opus)$/i;
  const bad = [];
  let n = 0;
  for (const s of actions) {
    for (const c of soundsOf(s)) {
      n++;
      if (!AUDIO.test(c.file)) bad.push(`${s.id} / ${c.rule}: ${c.file}`);
    }
  }
  assert.ok(n >= 400, `只量到 ${n} 条音效 cue`);
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} 条音效 cue 指着非音频文件`);
});

/**
 * **每条音效 cue 的素材都要在 SFX 表里。**
 *
 * 不在表里 = `soundAt` 返回 null（排期退回 delay 0，峰值对齐整条失效）+ `gainFor` 返回 null
 * （volume 退回手挑常数，归一化整条失效）。两者都是**静默降级**，没有别的守卫看得见。
 * 换了素材忘了 `npm run sounds` 就是这个形态。
 */
test("每条音效 cue 的素材都在 SFX 表里（换了素材必须重跑 npm run sounds）", () => {
  const bad = new Set();
  for (const s of actions) for (const c of soundsOf(s)) if (!SFX[c.file]) bad.add(c.file);
  assert.deepEqual([...bad].slice(0, 10), [],
    `${bad.size} 个素材不在 SFX 表里——soundAt 与 gainFor 会同时静默退化`);
});
