import {warn} from "../log.mjs";

/**
 * 超时放行时 run() 的兑现值。用一个 Symbol 而不是 undefined，是为了让调用方能把
 * 「超时放行」与「任务正常返回 undefined」区分开——playPlan() 正常结束返回的就是
 * undefined，从前两者完全不可分辨。
 */
export const TIMED_OUT = Symbol("crucible-anim:semaphore-timeout");

/**
 * 串行化动画播放。
 *
 * 多个动作接连确认时（连续反击、多目标群体动作、多人同时出手），并发播放会让画面
 * 叠成一团。用一个带超时的信号量把它们排成队。取自 blfx 的 waitForSemaphore 做法。
 *
 * **超时只是「不再等」，不会中止已经在播的那条序列**（Promise.race 拦不住 fn 自己
 * 那一路，而 Sequencer 也只有私有的 `Sequence._abort()`、信号量拿不到序列句柄）。
 * 也就是说超时一旦发生，它本来要防的重叠就已经发生了——因此超时值必须给足，
 * 不能当成常规节流手段：
 *  · 本仓库 434 条计划按 Sequencer 的等待语义（waitUntilFinished 的负延迟 + delay +
 *    有效播放时长，未知素材按 1000ms 估）模拟，最长的一条落在 7-8 秒量级；
 *  · 更吃预算的是 preload：`Sequence.play()`（sequencer.js:27741-27762）先
 *    `await Promise.allSettled(section._initialize())`、再 `await
 *    Sequencer.Preloader.preload(...)`，两者都发生在任何一段开跑**之前**，冷缓存
 *    首次加载 jb2a webm 走网络、秒级很常见——而这正是每条法术的第一次施放。
 * 原来的 8000ms 对最长的那几条只剩个位数百分比的余量，超时会精准地打在画面最长、
 * 最该被保护的那几条上，所以放宽到 15000ms 并在超时时留一条日志。
 */
export function createSemaphore({timeoutMs = 15000} = {}) {
  let tail = Promise.resolve();
  let pending = 0;
  let arrivals = [];                       // whenBusy() 的等待者

  function run(fn) {
    pending++;
    for (const notify of arrivals.splice(0)) notify();
    const slot = tail.then(() => {
      // 单条任务最多占用 timeoutMs，超时后放行队列（任务本身继续跑完）
      let timer = null;
      const task = Promise.resolve().then(fn);
      const guard = new Promise(resolve => {
        timer = setTimeout(() => {
          warn(`一条动画超过 ${timeoutMs}ms 仍未播完，提前放行队列；`
            + "后一条动画会与它重叠——超时不会中止已经在播的序列。");
          resolve(TIMED_OUT);
        }, timeoutMs);
      });
      // clearTimeout 不可省：任务提前完成后这枚定时器仍会烧满整个 timeoutMs。
      // 浏览器里只是白留一枚活定时器（一场战斗下来每条 playPlan 各留一枚），
      // 在 Node 里它直接吊住事件循环——测试进程会整整多挂 timeoutMs。
      return Promise.race([task, guard]).finally(() => clearTimeout(timer));
    });
    // 队列尾部吞掉异常，否则一次失败会毒化后续所有任务
    tail = slot.then(() => {}, () => {});
    return slot.finally(() => { pending--; });
  }

  /**
   * 等**此刻已经排在队里**的任务全部走完，但自己不占队列——不 run、不递增 pending、
   * 不阻塞后来者。给「不属于动作时间轴、却应当排在动作画面之后」的播放用（persist）。
   *
   * 只等调用那一刻的 tail：之后新入队的任务不在等待范围内，否则一条持续被喂任务的队列
   * 会让等待者永远排不上。超时同样只是「不再等」，兑现 false 供调用方留痕。
   *
   * @param {{timeoutMs?: number}} [opts]
   * @returns {Promise<boolean>}  true = 队列已排空，false = 等到超时
   */
  function whenIdle({timeoutMs: waitMs = timeoutMs} = {}) {
    const drained = tail.then(() => true, () => true);
    let timer = null;
    const capped = new Promise(resolve => { timer = setTimeout(() => resolve(false), waitMs); });
    // clearTimeout 与 run() 里同一个理由：Node 下不清会吊住事件循环整整 waitMs。
    return Promise.race([drained, capped]).finally(() => clearTimeout(timer));
  }

  /**
   * 等到队列里**出现**任务为止（或宽限期用尽）。
   *
   * 唯一的用途是修 Crucible 的顺序倒置：状态特效的触发（createActiveEffect）比造成它的
   * 那个动作的触发（updateChatMessage → confirmed 翻真）**早**一个数据库往返，直接播会
   * 让光环抢在挥剑前面。先 whenBusy 等那条动作动画入队、再 whenIdle 等它播完，就把
   * 「等一个还没发生的事件」变成了有界的两段等待。
   *
   * @param {{timeoutMs?: number}} [opts]
   * @returns {Promise<boolean>}  true = 有任务入队，false = 宽限期内无人入队
   */
  function whenBusy({timeoutMs: waitMs = timeoutMs} = {}) {
    if (pending > 0) return Promise.resolve(true);

    let timer = null;
    let notify = null;
    const waited = new Promise(resolve => {
      notify = () => resolve(true);
      arrivals.push(notify);
      timer = setTimeout(() => resolve(false), waitMs);
    });
    // 超时的等待者必须从 arrivals 里摘掉，否则一场战斗下来数组只增不减。
    return waited.finally(() => {
      clearTimeout(timer);
      const i = arrivals.indexOf(notify);
      if (i > -1) arrivals.splice(i, 1);
    });
  }

  return {run, whenIdle, whenBusy, get pending() { return pending; }};
}
