/**
 * 记录型 Sequencer 桩：只记录 player/play.mjs 对每个 section 的调用序列，不渲染任何东西。
 *
 * 为什么需要它：play.mjs 从前是全仓唯一无法 headless 验证的文件，而它承载的缺陷全都
 * 不是逻辑错误、是**对 Sequencer 语义的误解**——代码可读、注释自洽、测试全绿，上机才炸
 * （stretchTo 与 scaleToObject 同用直接挂死整条序列、startTime+duration 把播放时长
 * 静默削掉、退化的 rotateTowards 把整张贴图挪走半个身位）。这类缺陷全部落在「play.mjs
 * 对 Sequencer 说了什么」这一层，而那一层是纯函数：把全局 `Sequence` 与 `PIXI` 换成
 * 记录器，真实的 `playPlan()` 就能在 Node 里跑完全量语料。
 *
 * 桩不模拟 Sequencer 的**行为**（不算尺寸、不放素材），只模拟它的**接口形状**：方法名
 * 白名单逐个核对过 Sequencer 4.2.3 源码里的定义（test/sequencer-contract.test.mjs 有
 * 一条交叉断言把这份白名单钉死在真源码上，堵住「桩比真环境宽容」这个保真度漏洞），
 * 调白名单外的方法会得到 undefined 再报 TypeError，等价于真环境的行为。
 *
 * 放 tools/ 而不是 test/：`node --test test/` 会把 test/ 下所有 .mjs 当测试文件跑，
 * helper 放进去会变成一个 0 用例的空文件；test/source-tables.test.mjs 已有
 * `import … from "../tools/dump-fixtures.mjs"` 的先例。
 */

export const EFFECT_METHODS = Object.freeze([
  "playIf", "file", "opacity", "fadeIn", "fadeOut", "zIndex", "delay", "startTime", "endTime",
  "timeRange", "playbackRate", "belowTokens", "locally", "attachTo", "atLocation", "rotateTowards",
  "missed", "stretchTo", "scale", "scaleToObject", "spriteOffset", "mirrorY", "randomizeMirrorY",
  "randomRotation", "rotate", "elevation", "duration", "tint", "filter", "mask", "persist", "temporary",
  "tieToDocuments", "origin", "extraEndDuration", "waitUntilFinished", "copySprite", "loopProperty",
  "name", "anchor", "center", "size", "spriteScale", "moveTowards",
  /*
   * `template` 必须在白名单里，否则 play.mjs 的 `.template()` 调用会在桩上得到
   * undefined、抛 TypeError，被 play.mjs:444 的 catch 连同整条 cue 一起丢掉——
   * 而那条 catch 只打一行 warn，测试看到的是「cue 少了几条」而不是「方法名错了」。
   * 实测漏加时 play-contract 转红 8 条，且失败讯息全都指向别处。
   * 真实定义在 sequencer.js:24079 `template({gridSize, startPoint, endPoint} = {})`。
   */
  "template"
]);

export const SOUND_METHODS = Object.freeze([
  "playIf", "file", "volume", "delay", "startTime", "endTime", "timeRange", "duration",
  "waitUntilFinished", "locally", "name", "origin"
]);

function makeSection(kind, methods, seq) {
  const calls = [];
  const api = {};
  for (const m of methods) {
    api[m] = (...args) => {
      calls.push({m, args});
      if (seq.faultOn === m) throw new Error(`[fake-sequencer] injected fault at .${m}()`);
      return api;                      // 与 Sequencer 一样返回 this，链式调用得以继续
    };
  }
  api.__rec = {
    kind, calls, api,
    /** 调用过这个方法吗 */
    has: m => calls.some(c => c.m === m),
    /** 这个方法的全部调用 */
    get: m => calls.filter(c => c.m === m),
    /** 第一次调用的实参数组，没调过则 undefined */
    argOf: m => calls.find(c => c.m === m)?.args,
    /** 调用次数 */
    count: m => calls.filter(c => c.m === m).length,
    /** 最后一次调用的方法名——注入故障时用来认出「配置到一半」的 section */
    last: () => calls[calls.length - 1]?.m ?? null,
    /** 调用顺序里的下标，未调用为 -1 */
    indexOf: m => calls.findIndex(c => c.m === m)
  };
  return api;
}

/**
 * 这条 section 会不会让 `Sequence.play()` 的 promise 永不 settle？
 *
 * 判据逐字对应 Sequencer 4.2.3 的三段源码：
 *  · `EffectSection.run()`（sequencer.js:25008-25013）对 `this._persist` 走
 *    `totalDuration += await canvasEffectData.promise`，非持久走 `await ...duration`；
 *  · 那个 promise 是 `CanvasEffect.play()` 的 finishPromise（15463-15476），只有
 *    `endEffect()`（15479-15485）里的 `this._resolve?.(this.data)` 能兑现它，而
 *    `PersistentCanvasEffect`（17784）把 `_setEndTimeout()`（17801-17808）整个换成了
 *    「只暂停媒体、不 resolve」——持久特效不存在自然结束；
 *  · `_execute()`（21506-21540）在 `_shouldPlay()` 为假时直接 SKIPPED 返回
 *    （21507-21510），所以 `playIf(false)` 的 persist cue 不会挂住。
 */
function sectionBlocks(rec) {
  if (rec.kind !== "effect") return false;
  if (!rec.has("persist") || rec.argOf("persist")?.[0] === false) return false;
  return !rec.has("playIf") || rec.argOf("playIf")?.[0] !== false;
}

export class FakeSequence {
  constructor(options) {
    this.options = options;
    this.sections = [];              // 与真 Sequence 一样是普通数组（sequencer.js:27726）
    this.played = null;
    this.faultOn = null;             // 注入构造期异常的方法名，用于验证 catch 是否撤下 section
    this.holdPlay = false;           // 强制 play() 悬着，用来验证「普通计划仍然被等到底」
    this.settled = false;            // play() 的 promise 兑现了没有
    this._settle = null;
  }
  effect() { const s = makeSection("effect", EFFECT_METHODS, this); this.sections.push(s); return s; }
  sound() { const s = makeSection("sound", SOUND_METHODS, this); this.sections.push(s); return s; }
  /**
   * 与真 `Sequence.play()` 同构地兑现：它末尾是 `Promise.allSettled(promises)`
   * （sequencer.js:27782），promises 里含**每一条** section 的 `_execute()`，所以只要
   * 序列里有一条持久 section，整个 play() 就悬着——与它排第几无关。
   *
   * 写成返回 Promise 的普通函数而不是 async：async 函数没法在返回之后再兑现。
   */
  play(opts) {
    this.played = opts;
    if (!this.holdPlay && !this.sections.some(s => sectionBlocks(s.__rec))) {
      this.settled = true;
      return Promise.resolve(this);
    }
    return new Promise(resolve => {
      this._settle = () => { this.settled = true; resolve(this); };
    });
  }
  /** 兑现悬着的那条 play()：对持久序列相当于状态被移除（CanvasEffect.endEffect()）。 */
  finish() { this._settle?.(); this._settle = null; }
  /** 留在序列里、真的会被 Sequencer 播出去的 section 的记录。 */
  get records() { return this.sections.map(s => s.__rec); }
}

/** 最小 PIXI：play.mjs 的 regionMaskShape() 只用这三个构造函数。 */
export const FakePIXI = {
  Circle: class { constructor(x, y, radius) { Object.assign(this, {x, y, radius, __shape: "circle"}); } },
  Polygon: class { constructor(points) { Object.assign(this, {points, __shape: "polygon"}); } },
  Rectangle: class { constructor(x, y, w, h) { Object.assign(this, {x, y, w, h, __shape: "rect"}); } }
};

/**
 * 安装/卸载全局。play.mjs 只碰 `Sequence` 与 `PIXI` 两个全局——log.mjs 里读
 * game.settings 那处被 try/catch 吞掉，const.mjs 是纯常量——所以两个桩就够跑真实的
 * playPlan()。
 *
 * @param {{faultOn?: string|null, holdPlay?: boolean}} [opts]
 *   faultOn  = 在这个方法上注入构造期异常
 *   holdPlay = 让**每一条** play() 都悬着，直到 finishAll()。默认只有带 persist 的
 *              序列会悬（那是真 Sequencer 的行为）；打开它是为了反向钉住「不带 persist
 *              的计划 playPlan() 仍然等到序列播完」——否则一个「永远不 await」的实现
 *              照样全绿。
 */
export function installFakeSequencer({faultOn = null, holdPlay = false} = {}) {
  const made = [];
  const prevSequence = globalThis.Sequence, prevPIXI = globalThis.PIXI;
  globalThis.Sequence = class extends FakeSequence {
    constructor(o) { super(o); this.faultOn = faultOn; this.holdPlay = holdPlay; made.push(this); }
  };
  globalThis.PIXI = FakePIXI;
  return {
    sequences: made,
    get records() { return made.flatMap(s => s.records); },
    /** 还悬着没兑现的 play()——「playPlan 永不返回」这件事的直接观测点。 */
    get unsettled() { return made.filter(s => !s.settled); },
    /** 兑现所有悬着的序列（相当于状态被移除 / Sequencer.EffectManager.endEffects()）。 */
    finishAll() { for (const s of made) s.finish(); },
    restore() { globalThis.Sequence = prevSequence; globalThis.PIXI = prevPIXI; }
  };
}
