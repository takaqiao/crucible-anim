/**
 * 串行化动画播放。
 *
 * 多个动作接连确认时（连续反击、多目标群体动作、多人同时出手），并发播放会让画面
 * 叠成一团。用一个带超时的信号量把它们排成队。取自 blfx 的 waitForSemaphore 做法，
 * 超时上限保证单条卡住的序列不会永久阻塞后续动画。
 */
export function createSemaphore({timeoutMs = 8000} = {}) {
  let tail = Promise.resolve();
  let pending = 0;

  function run(fn) {
    pending++;
    const slot = tail.then(() => {
      // 单条任务最多占用 timeoutMs，超时后放行队列（任务本身继续跑完）
      return Promise.race([
        Promise.resolve().then(fn),
        new Promise(resolve => setTimeout(resolve, timeoutMs))
      ]);
    });
    // 队列尾部吞掉异常，否则一次失败会毒化后续所有任务
    tail = slot.then(() => {}, () => {});
    return slot.finally(() => { pending--; });
  }

  return {run, get pending() { return pending; }};
}
