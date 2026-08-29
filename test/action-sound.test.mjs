/**
 * 动作起手音 —— 覆盖、分档、素材、cue 形状（批次 E · §4.1）。
 *
 * ## 这一层修的是什么
 *
 * 改造前 434 个动作里 **128 条全程无声**（29.5%），且全部落在 8 条「从来不发声」的规则上。
 * 归 cast 槽管的是 6 条（`self.shape` 57 / `generic.cast` 22 / `tag.skill` 20 /
 * `cast.target.single` 18 / `cast.spell.iconic` 14 / `tag.healing` 7），外加 12 条
 * **连 cast cue 都拿不到**的无符文戏法。本轮由 `self-shapes.mjs` 的 `actionSoundFor`
 * 分 22 档配音（17 个语义档 + 5 个元素档）、`cast.mjs` 的 `actionSound` 统一构造 cue。
 *
 * ## 这里的每条断言都独立复算，不读被测代码的返回值
 *
 * 响度判据一律回 `data/audio-profiles.json` 现算（`peakDb` / `rmsDb`），**不调 `gainFor`**
 * ——否则就是拿实现验实现。时序判据回 SFX 表的原始列（`onsetMs` / `peakMs` /
 * `effectiveMs` / `totalMs`），**不调 `soundAt` / `contentEndOf`**。
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {resolve} from "../scripts/resolver/resolve.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import cast from "../scripts/armory/cast.mjs";
import {SFX, poolFor} from "../scripts/armory/sound-table.mjs";
import {ACTION_SOUND, SILENT_ACTION, STANCE_COLOR, STANCE_SOUND,
        actionSoundFor} from "../scripts/armory/self-shapes.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const actions = JSON.parse(readFileSync(join(ROOT, "test/fixtures/actions.json"), "utf8"));
const PROFILES = JSON.parse(readFileSync(join(ROOT, "data/audio-profiles.json"), "utf8")).profiles;
const mk = () => createAssets(offlineBackend(index));

/** 分档表里全部 DB 路径（17 个语义档 + 5 个元素档）。 */
const TIER_PATHS = [...Object.values(ACTION_SOUND), ...Object.values(STANCE_SOUND)];

/** 这些路径实际能取到的全部文件 —— 起手音的整个素材集合。 */
const TIER_FILES = (() => {
  const assets = mk();
  const out = new Set();
  for (const p of TIER_PATHS) {
    for (const q of poolFor(p)) {
      const r = assets.resolve(q);
      for (const f of r?.files ?? []) out.add(f);
    }
  }
  return out;
})();

/** 单目标口径求解全语料（`parallelizeTargets` 只改 delay，不改 file/volume）。 */
const PLANS = actions.map(s =>
  [s, resolve({...s, targets: (s.targets ?? []).slice(0, 1)}, {assets: mk(), armory: ARMORY})]);

/** 一个动作拿到的**起手音** cue（按素材集合认，不按 slot 认——slot 里还有符文施法音）。 */
const openersOf = plan =>
  (plan?.cues ?? []).filter(c => c.kind === "sound" && TIER_FILES.has(c.file));

/* -------------------------------------------- */
/*  一、覆盖：哑掉的只许是那五条                   */
/* -------------------------------------------- */

/**
 * **全语料只剩 5 条动作无声，而且是指名道姓的那五条。**
 *
 * 只断言「数量 ≤5」是不够的：那样把 `fall` 配上音、同时让 `stormStance` 掉回无声，
 * 数字纹丝不动。所以逐 id 比对集合。
 */
test("覆盖：无声的动作恰好是 SILENT_ACTION 那五条", () => {
  // ⚠ **期望值写死在这里，不从 SILENT_ACTION 取**：拿被测的那张表当期望值是同义反复
  //（从表里删掉 `move`，实测哑列表也跟着少一条，两边永远相等）。这五个 id 是声效层
  // 重做方案 §4.1 逐条登记的「有意静音」，改它要先有人拍板，不是顺手调个数字。
  const REGISTERED_SILENT = ["cast", "delay", "fall", "move", "rest"];
  assert.deepEqual([...SILENT_ACTION].sort(), REGISTERED_SILENT,
    "SILENT_ACTION 与 §4.1 登记的五条对不上了");

  const silent = new Set();
  for (const [s, plan] of PLANS) {
    if (!(plan?.cues ?? []).some(c => c.kind === "sound")) silent.add(s.id);
  }
  assert.deepEqual([...silent].sort(), REGISTERED_SILENT,
    `无声动作 ${silent.size} 条：${[...silent].sort().join(", ")}\n`
    + "改造前是 128 条。这五条是**有意静音**（逐条理由见 self-shapes.mjs 的 SILENT_ACTION），"
    + "多一条少一条都要先改那张表再改这条断言。");
  // 前提集合不许塌：语料还得有足够多的动作，这条断言才有意义。
  assert.ok(actions.length >= 400, `语料只剩 ${actions.length} 个动作`);
});

/**
 * **cast 槽里出得来 cue 的每一条规则，都至少发过一次声。**
 *
 * 规格 §4.1 守卫 ③：「一条规则永远不发声」本身就该红，不必等覆盖率掉下来。
 * 改造前这条会点名 6 条规则。
 *
 * ⚠ `strike.melee.heavy` 的 build 恒返回 null（重武器起手不出内容，蓄力感交给 travel 段），
 * 它一条 cue 都没有，自然不在「出得来 cue 的规则」之列——所以这里用**实测出现过的规则名**
 * 当分母，而不是照抄兵库的规则表。
 */
test("cast 槽：出得来 cue 的规则，没有一条是哑的", () => {
  const seen = new Map();                        // rule -> 该规则产出的 sound cue 条数
  for (const [, plan] of PLANS) {
    for (const c of plan?.cues ?? []) {
      if (c.slot !== "cast") continue;
      const n = seen.get(c.rule) ?? 0;
      seen.set(c.rule, n + (c.kind === "sound" ? 1 : 0));
    }
  }
  assert.ok(seen.size >= 10, `cast 槽只出得来 ${seen.size} 条规则的 cue，样本不足`);
  const mute = [...seen].filter(([, n]) => n === 0).map(([r]) => r);
  assert.deepEqual(mute, [], `${mute.length} 条 cast 规则在全语料里一次都不发声：${mute.join(", ")}`);
  // 兵库里确实有 `strike.melee.heavy` 这条「什么都不出」的规则，上面那句分母的说明才站得住。
  assert.ok(cast.some(r => r.id === "strike.melee.heavy"));
});

/**
 * **一个动作最多一条起手音；符文合成法术一条都没有。**
 *
 * 后半句是 `actionSoundFor` 第一行 `if (!s || s.spell) return null` 的守卫：符文法术
 * 已经各自带着 12 支施法音（`sounds.mjs` 的 `CAST_SOUND`），再叠一层起手音就是同一时刻
 * 两张床垫。删掉那一行 → 204 条法术各多一条 → 这里红。
 */
test("起手音：每个动作至多一条，符文合成法术恒零条", () => {
  const many = [];
  for (const [s, plan] of PLANS) {
    const n = openersOf(plan).length;
    if (n > 1) many.push(`${s.id}: ${n} 条`);
  }
  assert.deepEqual(many.slice(0, 8), [], `${many.length} 个动作拿到了不止一条起手音`);

  // 后半句**直接问分档表**，不看计划：今天 cast 槽的四条法术规则（ward / conjure /
  // aspect / composed）走的是 `spellCastSound`、根本不调 `actionSound`，所以从计划里
  // 是量不出这条的——那样写出来的断言在任何改动下都恒绿。而 `actionSoundFor` 的第一行
  // `if (!s || s.spell) return null` 是**给将来那条会调它的法术规则**留的闸：
  // 一旦有人给某条法术规则也摊上起手音，同一时刻就会叠两张床垫（符文施法音 + 起手音）。
  const spells = actions.filter(s => s.spell);
  assert.ok(spells.length >= 100, `语料里只剩 ${spells.length} 条符文法术，这条断言在空转`);
  const leaked = spells.filter(s => actionSoundFor(s)).map(s => `${s.id}（rune ${s.spell.rune}）`);
  assert.deepEqual(leaked.slice(0, 8), [],
    `${leaked.length} 条符文法术能从分档表里取到起手音——它们已经有 12 支符文施法音了`);
});

/* -------------------------------------------- */
/*  二、分档：不许有死档，也不许两档撞素材          */
/* -------------------------------------------- */

/**
 * **22 个档必须落在 22 条互不相同的路径上，且每一档在全语料里都真的被用到。**
 *
 * 两头都要钉：撞路径 = 白写一档（复用桶凭空翻倍）；没被用到 = 判据写错了，
 * 那一档永远轮不到，表看着丰富、实际派发不到。
 */
test("分档表：22 条路径互不相同，且每一档都被真的用到过", () => {
  assert.equal(new Set(TIER_PATHS).size, TIER_PATHS.length,
    `${TIER_PATHS.length} 个档只有 ${new Set(TIER_PATHS).size} 条不同路径——有两档指到了同一支素材`);
  assert.equal(TIER_PATHS.length, 22, "分档数变了，先确认新档有判据能接住东西再改这个数");

  const used = new Set();
  for (const s of actions) {
    const want = actionSoundFor({...s, targets: (s.targets ?? []).slice(0, 1)});
    if (want) used.add(want.path);
  }
  const dead = TIER_PATHS.filter(p => !used.has(p));
  assert.deepEqual(dead, [], `${dead.length} 个档在全语料里一次都轮不到：${dead.join(", ")}`);
});

/**
 * **画面与声音同源：四条元素架势在两张表里是同一组键。**
 *
 * `STANCE_COLOR`（画面：光环颜色）与 `STANCE_SOUND`（声音：元素灌注档）走的是同一条
 * 「按动作 id 派发」的轴。少配一条 = 那条架势的声音掉回通用档，而画面还是雷/火/水/土
 * ——听见的和看见的对不上，且这种偏差没有任何别的守卫看得见。
 * `poisonBlades` 只在声音那张表里（它不是架势，占的是空着的毒档），所以用「包含」不用「相等」。
 */
test("同源：STANCE_SOUND 覆盖 STANCE_COLOR 的全部四条架势", () => {
  const missing = Object.keys(STANCE_COLOR).filter(id => !STANCE_SOUND[id]);
  assert.deepEqual(missing, [], `${missing.length} 条架势有画面没有声音：${missing.join(", ")}`);
  assert.equal(new Set(Object.values(STANCE_SOUND)).size, Object.keys(STANCE_SOUND).length,
    "元素灌注是**按元素路由的真分档**（ASSET-NOTES:333），两条架势指到同一支素材就不是分档了");
});

/**
 * **复用棘轮：起手音的单文件最大桶。**
 *
 * 直接对着 owner 那句「尽量不复用」。改造前这 429 条动作里 128 条一声不出，
 * 剩下的落在 cast 槽最大的一支上；现在 22 个档摊到 47 个文件、145 条 cue。
 * 上限贴着实测值（11 = `Ability Shield`，11 条反应类动作共用一层护罩——它们**是**同一件事）。
 */
test("复用棘轮：起手音最大桶 ≤11，素材 ≥40 个", () => {
  const hist = new Map();
  for (const [, plan] of PLANS) {
    for (const c of openersOf(plan)) hist.set(c.file, (hist.get(c.file) ?? 0) + 1);
  }
  const total = [...hist.values()].reduce((a, b) => a + b, 0);
  assert.ok(total >= 130, `起手音只有 ${total} 条，样本不足（实测 145）`);
  assert.ok(hist.size >= 40, `起手音只落在 ${hist.size} 个文件上（22 个档，实测 47）`);
  const [top, n] = [...hist].sort((a, b) => b[1] - a[1])[0];
  assert.ok(n <= 11, `${top.split("/").pop()} 一支占了 ${n} 条（上限 11，${(n / total * 100).toFixed(1)}%）`);
});

/* -------------------------------------------- */
/*  三、素材：必须落在 cast 角色的响度窗口内        */
/* -------------------------------------------- */

/**
 * **每一档的素材都必须落在 cast 角色现有的响度窗口内。**
 *
 * 这不是口味，是两条**零余量**的既有棘轮的前置条件
 *（`test/sound-gain.test.mjs`：角色内跨度 ≤7.2、施法床垫峰均比 ≤13.5）。
 * 那两条只会在越窗之后报「跨度 7.7」这类总量数字，**不会告诉你是哪一档带的**；
 * 这一条逐档点名，把责任落到分档表上。
 *
 * 三项判据全部回 `data/audio-profiles.json` 现算：
 * - **有效峰值** `peakDb + 20·log10(volume)` ∈ `[−24.0, −16.8]`（volume 按 RMS 目标
 *   −30 dBFS 反算并钳到 `[0.10, 1.00]`，与 `gainFor` 同一个公式但**不调它**）；
 * - **峰均比** `peakDb − rmsDb` ≤ 13.5；
 * - **`rmsDb` > −30**：低于目标时 volume 顶上钳仍够不到，会给「欠额棘轮」（现值 17／上限 17）
 *   再添条目。
 *
 * 本轮因此否掉了四条语义更对的候选，逐条记在 `self-shapes.mjs` 的表头注释里。
 */
test("素材：每一档归一化后都落在 cast 角色的窗口内（回量测复算，不读 gainFor）", () => {
  const bad = [];
  for (const f of TIER_FILES) {
    const pr = PROFILES[f];
    if (!pr) { bad.push(`${f.split("/").pop()}: 没有量测`); continue; }
    const v = Math.min(1.00, Math.max(0.10, 10 ** ((-30 - pr.rmsDb) / 20)));
    const eff = pr.peakDb + 20 * Math.log10(v);
    const crest = pr.peakDb - pr.rmsDb;
    const name = f.split("/").pop();
    if (eff < -24.0 || eff > -16.8) bad.push(`${name}: 有效峰值 ${eff.toFixed(1)} 越出 [−24.0, −16.8]`);
    if (crest > 13.5) bad.push(`${name}: 峰均比 ${crest.toFixed(1)} > 13.5`);
    if (pr.rmsDb <= -30) bad.push(`${name}: rmsDb ${pr.rmsDb} ≤ −30，顶上钳也够不到目标`);
  }
  assert.ok(TIER_FILES.size >= 40, `起手音素材只剩 ${TIER_FILES.size} 个，本用例失去意义`);
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} 条起手音素材越出 cast 角色的窗口：\n${bad.join("\n")}`);
});

/* -------------------------------------------- */
/*  四、cue 形状：床垫从第一毫秒有声内容起播        */
/* -------------------------------------------- */

/**
 * **起手音的播出窗必须正好罩住有声内容：`[onsetMs, onsetMs + effectiveMs]`。**
 *
 * 两头各钉一个失败模式：
 * - **左端漏了 `startTime`** —— `ggg-sfx.abilities.misc.whip.01`（Ability Shield）的起音
 *   在 **230ms**，从 0 起播的话「架起防御」那一声比画面晚将近四分之一秒；
 * - **右端与左端不成对** —— `duration` 的口径是「从 `startTime` 起还播多久」，
 *   只改一个会让窗整整偏一个 `onsetMs`。`sounds.mjs` 的 `spellCastSound` 上一轮正是栽在
 *   这里（31 条 cue 被从尾巴上削掉一截），那次的教训写在它的注释里。
 *
 * 右端用 `min(totalMs, onsetMs + effectiveMs)` ——量测用 10ms 包络窗，
 * `onsetMs + effectiveMs` 会比素材总长多出几毫秒。
 */
test("cue 形状：播出窗 = [onsetMs, 有声内容结束]，delay 恒 0，role 恒 cast", () => {
  const bad = [];
  let checked = 0;
  for (const [s, plan] of PLANS) {
    for (const c of openersOf(plan)) {
      const meta = SFX[c.file];
      if (!meta) { bad.push(`${s.id}: ${c.file.split("/").pop()} 不在 SFX 表里（没重跑 npm run sounds？）`); continue; }
      const [peakMs, onsetMs, effectiveMs, totalMs] = meta;
      const end = Math.min(totalMs ?? Infinity, onsetMs + effectiveMs);
      checked++;
      const name = `${s.id}/${c.file.split("/").pop()}`;
      if (c.soundRole !== "cast") bad.push(`${name}: soundRole=${c.soundRole}`);
      if ((c.delay ?? 0) !== 0) bad.push(`${name}: delay=${c.delay}（床垫不做峰值对齐，恒 0）`);
      if (c.startTime !== onsetMs) bad.push(`${name}: startTime=${c.startTime}，起音在 ${onsetMs}ms`);
      if (Math.round((c.startTime ?? 0) + c.duration) !== Math.round(end)) {
        bad.push(`${name}: 窗右端 ${(c.startTime ?? 0) + c.duration} ≠ 有声内容结束 ${Math.round(end)}`);
      }
      if (peakMs < (c.startTime ?? 0) || peakMs > (c.startTime ?? 0) + c.duration) {
        bad.push(`${name}: 峰值 ${peakMs}ms 落在播出窗外——这一声根本没播`);
      }
    }
  }
  assert.ok(checked >= 130, `只核了 ${checked} 条起手音（实测 145）`);
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} 条起手音的播出窗不对：\n${bad.join("\n")}`);
});

/**
 * **音效链路上一条引擎 fade 都不许有。**
 *
 * Sequencer 4.2.3 的 `fadeInAudio/fadeOutAudio` 内部写的是 `from: 1` / `to: 1`
 * ——**字面量，不读 `data.volume`**。本仓库 700+ 条 sound cue 全是全局音
 *（走 `volume_property="volume"`），加一句 fade 就会把归一化到 0.263 的施法床垫
 * 在淡入结束时**弹到 1.0（+11.6 dB）**，整层响度归一化当场作废（声效层重做方案 §3.3）。
 *
 * ⚠ 这条**必须查源码**，不能查 cue 字段：`resolver/resolve.mjs:48` 的 CUE_DEFAULTS 给
 * 每条 cue 都填了 `fadeIn: 200 / fadeOut: 300`，而 `player/play.mjs` 只在**画面** section
 * 上调 `.fadeIn(...)`，sound section 那一支从来不读它们——所以 cue 上带着 fadeIn
 * 是无害的默认值，查它只会得到一条永远为真的假警报。真正的失败模式是有人在 sound
 * 分支上补一句 `.fadeInAudio(...)`，那只有源码看得见。
 */
test("音效链路上没有引擎 fade（fadeInAudio / fadeOutAudio 一处都不许出现）", () => {
  const src = readFileSync(join(ROOT, "scripts/player/play.mjs"), "utf8");
  const hits = [...src.matchAll(/fade(?:In|Out)Audio/g)].map(m => m[0]);
  assert.deepEqual(hits, [],
    `player/play.mjs 里出现了 ${hits.join(" / ")}：Sequencer 4.2.3 的 from:1/to:1 是字面量、`
    + "不读 data.volume，一加就把整层响度归一化作废（声效层重做方案 §3.3）。"
    + "确实需要淡出时走「裁末尾」，见 ASSET-NOTES:155。");
  // 前提集合不许塌：这条查的是 sound 分支，play.mjs 里得真的有一支。
  assert.ok(/\.sound\(/.test(src), "play.mjs 里找不到 sound section，这条断言在空转");
});

/**
 * **有目标的武器攻击不得在 cast 槽多出一层床垫。**
 *
 * `generic.cast` 对「攻击且有目标」主动返回 null（声音归 travel/impact 两槽：风声 + 命中音），
 * 所以 `actionSound` 必须写在那句早返回**之后**。写到前面去 → 每一次挥刀前先响一段施法音，
 * 而且 `test/sound-gain.test.mjs` 的倒挂棘轮会跟着涨。
 *
 * ⚠ 判据是「**没有 cast 规则接住它**」而不是「带 strike 标签」：`whirlwind`（英雄气概）
 * 与 `feintingStrike`（欺瞒检定）都带 strike 标签，但它们各自被 `self.shape` / `tag.skill`
 * 接住了，本来就该有起手音。
 */
test("有目标的武器攻击落到兜底时不出起手音", () => {
  const bad = [];
  let checked = 0;
  for (const [s, plan] of PLANS) {
    if (!s.usage?.isAttack || !(s.targets ?? []).length) continue;
    const castCues = (plan?.cues ?? []).filter(c => c.slot === "cast");
    // 「落到兜底」= 除起手音外，cast 槽一条画面 cue 都没有（`generic.cast` 早返回了）。
    if (castCues.some(c => c.kind !== "sound")) continue;
    if (!(s.tags ?? []).includes("strike")) continue;
    checked++;
    const n = openersOf(plan).length;
    if (n) bad.push(`${s.id}: 兜底攻击动作多出 ${n} 条起手音`);
  }
  assert.ok(checked >= 50, `只核了 ${checked} 条兜底武器攻击，本用例失去意义`);
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} 条：\n${bad.join("\n")}`);
});
