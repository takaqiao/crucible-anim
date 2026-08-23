/**
 * 多目标：每个目标的时间轴必须与「它单独是唯一目标」时一模一样。
 *
 * ## 这条守卫在守什么
 *
 * `Sequence.play()`（sequencer.js:27772-27776）是**一条线性队列**：
 *
 *     if (section.shouldWaitUntilFinished) promises.push(await section._execute());
 *     else promises.push(section._execute());
 *
 * 带交棒点的一段会卡住整个 for 循环。而每目标规则**每个目标各出一条 cue**，于是两个
 * 目标的挥击不是同时挥，是排队：
 *
 *     travel(A) dur=933 wuf=-400   → 队列 t=533 放行
 *     travel(B) dur=767 wuf=-400   → B 从 t=533 才起手，队列 t=900 放行
 *     impact(A) delay=0            → **A 的血溅打在 t=900**
 *
 * A 的交棒点本该是 533（挥击 933ms、提前 400ms 出血），实际晚 367ms——那时 A 的挥击
 * （933ms 结束）几乎收招了。全量语料实测 **177 个动作**中招，首目标迟到中位 503ms、
 * 最大 636ms；其中 fan/aura/pulse/cone/blast/ray 这些**系统里真会打到多个目标**的
 * 类型占 53 个，`fanOfArrows` 当时是一支箭飞完再射下一支。
 *
 * 修法是 `resolver/resolve.mjs` 的 `parallelizeTargets`：≥2 目标时把「靠
 * waitUntilFinished 逐条交棒」改写成「每个目标各一条并行的绝对时间轴」。
 *
 * ## 为什么判据是「与单目标等价」而不是别的
 *
 * 单目标计划的线性队列**本来就是对的**（一条分支，无人可顶）。所以「多目标下每个目标
 * 看到的画面 == 它单独出现时看到的画面」既是最强的表述，也是最好写的：不必在测试里
 * 重新推导一遍应该是几毫秒，直接拿单目标那条当参照系。
 *
 * ## 时间轴怎么算——两种表示法都要认
 *
 * 交棒点在计划里有两种写法：单目标（以及 `parallelizeTargets` 提前返回时）是
 * `waitUntilFinished`，改写之后是绝对 `delay`。测试**不认表示法，只认播放效果**：
 * 两边都按 Sequencer 的线性队列语义模拟一遍，比的是「这条 cue 第几毫秒起播」。
 *
 * 等待量 = `delay + duration + wuf`，逐条对应源码：
 *   · `Section._execute()`（21506-21538）整段包在 `setTimeout(..., _basicDelay)` 里 → delay 计入；
 *   · `EffectSection.run()`（25008-25014）是 `totalDuration = _currentWaitTime + await duration`
 *     再 setTimeout，其中 duration 是 `_totalDuration`（16112），**不含 delay**。
 *
 * 模拟里略去了 `play()` 每段之间那 3ms 的让步（27779）。两边都略，比对不受影响；
 * 绝对值上一条计划最多偏十几毫秒，在感知阈之下。
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {resolve} from "../scripts/resolver/resolve.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const actions = JSON.parse(readFileSync(join(ROOT, "test/fixtures/actions.json"), "utf8"));
const mk = () => createAssets(offlineBackend(index));

/** 按 Sequencer 的线性队列语义算出每条 cue 的绝对起播时刻（ms）。 */
function timeline(plan) {
  let cur = 0;
  return plan.cues.map(c => {
    const start = cur + (c.delay ?? 0);
    if (c.waitUntilFinished !== null) cur = start + (c.duration ?? 0) + c.waitUntilFinished;
    return start;
  });
}

/** 同一条规则可能在一个槽里出多条 cue（impact.layered 的结果层+元素层），按序成组比。 */
function group(cues, times, keep) {
  const out = new Map();
  cues.forEach((c, i) => {
    if (!keep(c)) return;
    const k = `${c.slot}|${c.rule}`;
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(times[i]);
  });
  return out;
}

const multiTarget = actions.filter(a => (a.targets ?? []).length >= 2);

test("多目标：每个目标的时间轴与它单独作为唯一目标时逐毫秒相同", () => {
  let checked = 0;
  const bad = [];
  for (const s of multiTarget) {
    const multi = resolve(s, {assets: mk(), armory: ARMORY});
    if (!multi) continue;
    const mt = timeline(multi);
    // **只比第 0 个目标。** `ctx.pick` 用的是一条共享的种子随机流，`resolve` 按目标
    // 顺序逐个调 build，于是**目标数一变，随机流的调用次数就变，后面的目标取到的变体
    // 也跟着变**——变体不同则素材时长不同（短剑四个变体的可播时长 800-967ms 不等），
    // 时间轴自然对不上。这不是并行改写的毛病，是「同一份计划里 pick 的调用序列」这件事。
    //
    // 目标 0 的 pick 永远是该槽的第一次调用，单目标与多目标下拿到的是同一个变体，
    // 所以它的时间轴可以逐毫秒比。其余目标「有没有被排队」由下面那条守卫直接查
    //（各分支的 travel 必须同时起播），两条合起来覆盖面不变。
    s.targets.slice(0, 1).forEach((t, i) => {
      const solo = resolve({...s, targets: [t]}, {assets: mk(), armory: ARMORY});
      if (!solo) return;
      const want = group(solo.cues, timeline(solo), () => true);
      // 多目标计划里属于这个目标的：它自己的 cue + 所有共享 cue（cast 槽、once 规则）
      const got = group(multi.cues, mt, c => c.forTarget === null || c.forTarget === t.tokenId);
      for (const [k, w] of want) {
        checked++;
        const g = got.get(k);
        if (!g || g.length !== w.length || w.some((x, j) => Math.abs(x - g[j]) > 1)) {
          if (bad.length < 8) {
            bad.push(`${s.id} 目标${i} ${k}：单独出现时 ${JSON.stringify(w)}ms，`
                   + `多目标计划里 ${JSON.stringify(g ?? null)}ms`);
          }
        }
      }
    });
  }
  // 语料真的行使到了这条通路才算数：全零目标/单目标的语料会让上面一个循环都不进
  assert.ok(checked >= 700, `只比对了 ${checked} 组，语料没有真正行使多目标通路`);
  assert.deepEqual(bad, [],
    "多目标计划里某个目标的画面时序与它单独出现时不同——线性队列把各目标的分支排了队。"
  + "见 resolver/resolve.mjs 的 parallelizeTargets。");
});

/**
 * 各目标的 travel 必须**同时起播**。
 *
 * 这是「分支没有被排成队」最直接的表述，而且**不受变体随机性影响**：所有分支都从
 * 共享前奏结束处起跑，所以每目标的第一条 travel cue 的绝对时刻必须相同。
 * 一旦退回线性队列，第二个目标的挥击就要等第一个交棒之后才开始（实测差 367-636ms），
 * 这条立刻红。
 *
 * 与上面那条「与单目标等价」互补：那条逐毫秒核对第 0 个目标的**整条链**，
 * 这条核对**所有目标**的起跑线。
 */
test("多目标：各目标的 travel 同时起播，没有被排成队", () => {
  let checked = 0;
  const bad = [];
  for (const s of multiTarget) {
    const plan = resolve(s, {assets: mk(), armory: ARMORY});
    if (!plan) continue;
    const heads = new Map();
    for (const c of plan.cues) {
      if (c.slot !== "travel" || c.forTarget == null) continue;
      if (!heads.has(c.forTarget)) heads.set(c.forTarget, c.delay ?? 0);
    }
    if (heads.size < 2) continue;
    checked++;
    const starts = [...heads.values()];
    const spread = Math.max(...starts) - Math.min(...starts);
    if (spread > 1) {
      bad.push(`${s.id}：各目标 travel 起播时刻 ${starts.join(" / ")}ms，相差 ${spread}ms`);
    }
  }
  assert.ok(checked >= 100, `只检查了 ${checked} 份多目标计划`);
  assert.deepEqual(bad.slice(0, 8), [], `${bad.length} 份计划里各目标的挥击被排成了队`);
});

/**
 * 结构判据：一份多目标计划里**最多只能有一条 cue 带交棒点**。
 *
 * 这是上面那条等价性的机制侧表述，也是更容易一眼看懂的那个：两条以上带交棒点，
 * 各目标的分支就必然互相顶。留一条是给信号量兜底用的（见下）。
 */
test("多目标计划里最多一条 cue 带交棒点", () => {
  const bad = [];
  for (const s of multiTarget) {
    const p = resolve(s, {assets: mk(), armory: ARMORY});
    if (!p) continue;
    const blocking = p.cues.filter(c => c.waitUntilFinished !== null);
    if (blocking.length > 1) {
      bad.push(`${s.id}：${blocking.length} 条带交棒点（${blocking.map(c => c.rule).join(", ")}）`);
    }
  }
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} 份多目标计划的分支会互相排队`);
});

/**
 * 交棒锚点：恰有一条，在队尾，且是起播最晚的那条。
 *
 * ## 为什么非要留一条交棒点
 *
 * 不是画面需要，是**信号量的兜底**。非阻塞段的 promise 不覆盖播放时长：
 * `_execute()`（sequencer.js:21526）对非 async 段是裸 `this.run()` 不 await，
 * `play()` 末尾的 `Promise.allSettled` 于是会在画面还在播时就兑现，
 * `player/semaphore.mjs` 提前放行、下一个动作叠上来。Sequencer 自己靠 `_waitAnyway`
 * （21247）给最后一段兜了这个底，这里要求把它**显式写进计划**——依赖一个看不见的
 * 实现细节，等于没有守卫。
 *
 * ## 为什么要求它同时是「起播最晚」的那条
 *
 * 分支长短不一：`strike` 里 A 的挥击 933ms、B 的 767ms，于是 A 分支的尾巴比 B 的晚
 * 166ms 收工。初版直接拿发出顺序的最后一条当锚点，那是 B 的尾巴，信号量会早放行
 * 166ms。挑起播最晚的那条并挪到队尾才是对的。
 */
test("多目标计划：交棒锚点恰有一条、在队尾、且起播最晚", () => {
  let checked = 0;
  const bad = [];
  for (const s of multiTarget) {
    const p = resolve(s, {assets: mk(), armory: ARMORY});
    if (!p?.cues.length) continue;
    checked++;
    const blocking = p.cues.filter(c => c.waitUntilFinished !== null);
    if (blocking.length !== 1) { bad.push(`${s.id}：${blocking.length} 条带交棒点，应恰 1 条`); continue; }
    const last = p.cues[p.cues.length - 1];
    if (blocking[0] !== last) { bad.push(`${s.id}：带交棒点的是 ${blocking[0].rule}，不在队尾`); continue; }
    const latest = Math.max(...p.cues.map(c => c.delay ?? 0));
    if ((last.delay ?? 0) < latest) {
      bad.push(`${s.id}：锚点起播 ${last.delay}ms，但有 cue 到 ${latest}ms 才起播——信号量会早放行`);
    }
  }
  assert.ok(checked >= 300, `只检查了 ${checked} 份多目标计划`);
  assert.deepEqual(bad.slice(0, 10), [], `${bad.length} 份多目标计划的交棒锚点不对`);
});
