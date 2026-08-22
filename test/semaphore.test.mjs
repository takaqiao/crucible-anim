import {test} from "node:test";
import assert from "node:assert/strict";
import {createSemaphore} from "../scripts/player/semaphore.mjs";

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
  assert.ok(sem.pending >= 1);
  await Promise.all(p);
  assert.equal(sem.pending, 0);
});
