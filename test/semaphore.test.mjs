import {test} from "node:test";
import assert from "node:assert/strict";
import {createSemaphore, TIMED_OUT} from "../scripts/player/semaphore.mjs";

const sleep = ms => new Promise(r => setTimeout(r, ms));

test("任务串行执行，不重叠", async () => {
  const sem = createSemaphore({timeoutMs: 2000});
  const log = [];
  await Promise.all([1, 2, 3].map(i => sem.run(async () => {
    log.push(`start${i}`);
    await sleep(20);
    log.push(`end${i}`);
  })));
  for (let i = 0; i < log.length; i += 2) {
    assert.ok(log[i].startsWith("start") && log[i + 1].startsWith("end"),
      `第 ${i} 处发生重叠: ${log.join(",")}`);
    assert.equal(log[i].slice(5), log[i + 1].slice(3));
  }
});

test("任务抛错不会卡死队列", async () => {
  const sem = createSemaphore({timeoutMs: 2000});
  await assert.rejects(sem.run(async () => { throw new Error("boom"); }));
  assert.equal(await sem.run(async () => "ok"), "ok");
  assert.equal(sem.pending, 0);
});

test("超时的任务不会永久阻塞后续任务", async () => {
  const sem = createSemaphore({timeoutMs: 60});
  const slow = sem.run(() => new Promise(() => {}));   // 永不 resolve
  const t0 = Date.now();
  const r = await sem.run(async () => "after");
  assert.equal(r, "after");
  assert.ok(Date.now() - t0 < 1000, "后续任务等待过久");
  slow.catch(() => {});
});

test("pending 反映排队数量", async () => {
  const sem = createSemaphore({timeoutMs: 2000});
  const p = [sem.run(() => sleep(30)), sem.run(() => sleep(30))];
  // 精确值而不是 >= 1：写成 >= 1 时，一个「pending 永远谎报 1」的实现照样全绿。
  assert.equal(sem.pending, 2);
  await Promise.all(p);
  assert.equal(sem.pending, 0);
});

test("timeoutMs 真的按入参生效，且超时兑现成可辨认的哨兵值", async () => {
  const elapse = async ms => {
    const sem = createSemaphore({timeoutMs: ms});
    const t0 = Date.now();
    assert.equal(await sem.run(() => new Promise(() => {})), TIMED_OUT,
      "超时必须兑现成 TIMED_OUT，否则与「任务正常返回 undefined」不可区分");
    return Date.now() - t0;
  };
  // 两个相差一个数量级的入参各测一次：任何忽略入参的硬编码常数都不可能同时落进
  // 这两条区间（只测一个值时，setTimeout(resolve, 50) 这种实现照样全绿）。
  const fast = await elapse(40);
  const slow = await elapse(400);
  assert.ok(fast >= 30 && fast < 250, `timeoutMs:40 实际 ${fast}ms`);
  assert.ok(slow >= 350 && slow < 900, `timeoutMs:400 实际 ${slow}ms`);
});

test("任务提前完成后不留活定时器", async () => {
  // 不 clearTimeout 时，一个 10ms 的任务会让 30 秒的定时器烧满整个时长：浏览器里是
  // 每条 playPlan 各留一枚活定时器，Node 里直接吊住事件循环（测试进程整整多挂 30 秒）。
  const before = process.getActiveResourcesInfo().filter(r => r === "Timeout").length;
  const sem = createSemaphore({timeoutMs: 30000});
  await sem.run(() => sleep(10));
  const after = process.getActiveResourcesInfo().filter(r => r === "Timeout").length;
  assert.ok(after <= before, `任务结束后仍留着 ${after - before} 枚定时器`);
});
