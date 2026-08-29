/**
 * 随机流分离 —— 音效改动不得改画面。
 *
 * ## 这条守卫在防什么
 *
 * `ctx.sound()` 对**单文件**路径一次抽取都不消耗（`context.mjs` 里 `files.length > 1`
 * 的短路），而兵库里音效常排在视觉之前（`travel.mjs` 先 `strikeSounds(...)`、
 * 后 `ctx.pick(trailPath)`）。三者共用一条 rng 时，**只要某条规则的抽取次数从 0 变 1**
 * ——也就是「给这个音效加一个随机池」这件事本身——这条 cue 之后的每一个 `pick()`
 * 都会摇到另一个 variant，跨目标、跨槽位一路传染。
 *
 * 后果不是「结果变了」这么轻：clip-table 的 startTime/duration 是**逐文件实测**的，
 * ASSET-NOTES 的结论是**逐条读图**得来的，sound-layer 的音画对齐钉的是具体素材的峰值时刻。
 * 画面选材静默改掉之后这些数字全部配到了别的素材上，而没有任何既有守卫会报警——
 * 「改了音效画面变了」只会被误当成别的回归。
 *
 * 同样的道理已经让 `rngAux` 单独开过一条流（`context.mjs` 那条注释）；这里是第二次发作，
 * 对应第三条流 `rngSfx`。
 *
 * ## 判据（声效层重做方案 §3.2）
 *
 * 对全语料求解两次：一次现状，一次把一条**被大量使用的单文件音效**换成 5 文件池，
 * 断言所有**非 sound** cue 的 `file` 字段逐条相等。共用一条流即红。
 *
 * ## 「换池」怎么做到不碰兵库
 *
 * 不改 `sounds.mjs`，改的是喂给 resolver 的 `assets`：包一层，让指名的那几条路径
 * 解析出 5 个文件。对 `ctx.sound` 而言这与「兵库把它换成了池」逐字节等价——
 * 它看的只有 `r.files.length`。其余路径原样透传，`pick()` 那一侧完全没被动过。
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
import {
  HIT_SOUND, HIT_DEFAULT, MISS_SOUND, CAST_SOUND, CAST_DEFAULT, SWING_LIGHT, SWING_HEAVY
} from "../scripts/armory/sounds.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const actions = JSON.parse(readFileSync(join(ROOT, "test/fixtures/actions.json"), "utf8"));
const mk = () => createAssets(offlineBackend(index));

/**
 * 被「换池」的路径：**兵库当前所有解析成单文件的音效路径**。
 *
 * ⚠ 为什么不能只换规格原文举的 `MISS_SOUND`：当前语料里一个 miss 结果的样本都没有
 * （`canim…sword_miss` 在全语料 701 条 sound cue 里出现 0 次），只换它这条守卫是**空绿**。
 * 只换 `CAST_DEFAULT` 也不够：它点得着火（136 条），但施法音那条 cue 排在该动作
 * **所有 `ctx.pick` 之后**，多消耗的那次抽取没有下游可传染——实测共用一条流也照样绿。
 *
 * 真正能点着的是命中音里那几条单文件的（`psfx.impacts.magicaleffects.{cold,fire,necrotic}`）：
 * `strikeSounds` 排在 `travel.mjs` 的 `ctx.pick(trailPath)` **之前**，正是 §3.2 点名的那条通路。
 * 所以判据取「全部单文件音效路径一起换池」——既覆盖规格举的例子，又保证有火可点，
 * 而且这张表是**从兵库现算的**，将来兵库改了路径它自己跟着变，不会退化成空绿。
 */
const ARMORY_SOUND_PATHS = [
  ...Object.values(HIT_SOUND), HIT_DEFAULT, MISS_SOUND,
  ...Object.values(CAST_SOUND), CAST_DEFAULT, SWING_LIGHT, SWING_HEAVY,
  "psfx.ranged-weapons.longbow.v1.30ft"   // cast.mjs 的拉弓音，兵库里唯一一条没进常量表的
];
const SWAPPED = (() => {
  const a = mk();
  return [...new Set(ARMORY_SOUND_PATHS)].filter(p => a.resolve(p)?.files.length === 1);
})();

/**
 * 换进去的 5 个文件：原文件 + `HIT_DEFAULT` 那条 4 文件池的成员。
 *
 * 刻意全部取自兵库已经在用的真实路径，而不是造几个假文件名：这样它们都在 SFX 表里查得到，
 * `soundAt` / `gainFor` 走的是正常分支，换池这件事除了「多消耗抽取」以外不引入别的差异。
 * （也因此不会给 `docs/ASSET-NOTES.md` 添任何新路径。）
 */
function poolFiles(assets, original) {
  const hit = assets.resolve(HIT_DEFAULT);
  assert.ok(hit && hit.files.length >= 4, `HIT_DEFAULT 不再是多文件池：${hit?.files.length}`);
  const pool = [original, ...hit.files];
  assert.equal(new Set(pool).size, 5, "换进去的池必须是 5 个互不相同的文件");
  return pool;
}

/** 把 SWAPPED 里的路径伪装成 5 文件池，其余原样透传。 */
function pooledAssets() {
  const assets = mk();
  const inner = assets.resolve;
  return {
    ...assets,
    resolve(path) {
      const r = inner(path);
      if (!r || !SWAPPED.includes(path)) return r;
      const files = poolFiles(assets, r.file);
      return {...r, files, file: files[0]};
    }
  };
}

/** 全语料求解一遍，按动作分组给出 cue 的 file 序列。 */
function solveAll(assets) {
  return actions.map(s => {
    const cues = resolve(s, {assets: assets(), armory: ARMORY})?.cues ?? [];
    // ⚠ 音效 cue 排在画面之前，靠 kind 过滤，不能靠下标
    return {
      visual: cues.filter(c => c.kind !== "sound").map(c => c.file),
      sound: cues.filter(c => c.kind === "sound").map(c => c.file)
    };
  });
}

const base = solveAll(mk);
const swapped = solveAll(pooledAssets);

test("语料前提：换池这件事确实点着了火（否则下面那条是空绿）", () => {
  assert.ok(SWAPPED.length >= 5, `可换池的单文件音效路径只剩 ${SWAPPED.length} 条`);
  assert.ok(SWAPPED.includes(MISS_SOUND), "规格点名的 MISS_SOUND 必须在换池清单里");
  const fired = base.filter((b, i) => b.sound.join("|") !== swapped[i].sound.join("|")).length;
  assert.ok(fired >= 50,
    `换池后音效有变化的动作只有 ${fired} 个，守卫失去意义——检查 SWAPPED 里的路径还在不在兵库主干上`);
});

test("音效换池不得改动任何画面 cue 的选材（共用一条随机流即红）", () => {
  assert.equal(swapped.length, base.length);
  let compared = 0;
  for (let i = 0; i < base.length; i++) {
    assert.deepEqual(swapped[i].visual, base[i].visual,
      `第 ${i} 个动作的画面选材被音效换池改掉了：`
      + `ctx.sound 与 ctx.pick 共用了同一条 rng（context.mjs 的 rngSfx）`);
    compared += base[i].visual.length;
  }
  assert.ok(compared >= 1900, `参与比对的画面 cue 只有 ${compared} 条，语料像是缩水了`);
});

test("soundFrom 摇取不得挪动 ctx.pick 的取数位置", () => {
  // 必须挑一条**多变体**的视觉路径：单文件路径的 pick 根本不消耗抽取，
  // 拿它来测「有没有被挪动」是空绿。
  const path = "jb2a.melee_attack.01.shortsword";
  assert.ok(mk().resolve(path).files.length >= 4, `${path} 不再是多变体，换一条`);
  const pool = poolFiles(mk(), mk().resolve(MISS_SOUND).file);
  const seen = new Set();
  for (const seed of [0, 1, 7, 12345, 999999]) {
    const a = createContext({assets: mk(), snapshot: {seed}, seed});
    const b = createContext({assets: mk(), snapshot: {seed}, seed});
    // b 在每次 pick 之前先摇一次音效池；a 不摇。两边的 pick 结果必须逐条相同。
    for (let k = 0; k < 6; k++) {
      const before = a.pick(path);
      assert.ok(b.soundFrom(pool), "soundFrom 应当摇得出东西");
      const after = b.pick(path);
      assert.deepEqual(after?.file, before?.file,
        `seed=${seed} 第 ${k} 次 pick 被 soundFrom 挪动了`);
      seen.add(before.file);
    }
  }
  assert.ok(seen.size >= 3, `30 次 pick 只摇出 ${seen.size} 种，这条守卫没有真的在动 rng`);
});

test("soundFrom：查不到的路径跳过，全查不到才返回 null", () => {
  const ctx = createContext({assets: mk(), snapshot: {seed: 3}, seed: 3});
  // 混进两条不存在的路径，剩下那条真的仍要摇得出来
  const one = ctx.soundFrom(["没有.这个.命名空间", CAST_DEFAULT, "也.没有.这个"]);
  assert.ok(one, "只要还有一条查得到就不该返回 null");
  assert.equal(one.files.length, 1);

  assert.equal(ctx.soundFrom(["没有.这个.命名空间", "也.没有.这个"]), null,
    "全部查不到必须返回 null，让调用方能退回单条兜底");
  assert.equal(ctx.soundFrom([]), null);
  assert.equal(ctx.soundFrom(null), null);
});

test("soundFrom：整池按文件去重，且跨种子摇得遍全池", () => {
  const ctx = createContext({assets: mk(), snapshot: {seed: 1}, seed: 1});
  // 同一条路径写两遍不该拿到双倍权重
  assert.deepEqual(ctx.soundFrom([HIT_DEFAULT, HIT_DEFAULT]).files,
    mk().resolve(HIT_DEFAULT).files);

  const seen = new Set();
  for (let seed = 0; seed < 40; seed++) {
    const c = createContext({assets: mk(), snapshot: {seed}, seed});
    seen.add(c.soundFrom([CAST_DEFAULT, HIT_DEFAULT]).file);
  }
  assert.equal(seen.size, 5, `40 个种子只摇出 ${seen.size} 种，池没有真的在起作用`);
});

test("三条流互不相同：同一个种子下 rng / rngAux / rngSfx 的取数序列两两有别", () => {
  const ctx = createContext({assets: mk(), snapshot: {seed: 42}, seed: 42});
  const take = f => Array.from({length: 8}, () => f());
  const [a, b, c] = [take(ctx.rng), take(ctx.rngAux), take(ctx.rngSfx)];
  assert.notDeepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.notDeepEqual(b, c);
});
