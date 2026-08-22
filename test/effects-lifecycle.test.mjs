/**
 * deleteActiveEffect 兜底清理的错误处理契约。
 *
 * `Sequencer.EffectManager.endEffects` 是 `static async`（sequencer.js:11626）：
 * `_validateFilters` 的 custom_error 与 `_endManyEffects` 的失败**全部**发生在异步函数体内，
 * 同步 try/catch 一条都接不住，只会在每个客户端的控制台里留下一条既没有本模组前缀、
 * 也没有 effect uuid 的 unhandled rejection。
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {installEffectTriggers} from "../scripts/trigger/effects.mjs";

function stubHooks() {
  const handlers = {};
  const old = globalThis.Hooks;
  globalThis.Hooks = {on: (name, fn) => { (handlers[name] ??= []).push(fn); }};
  return {handlers, restore: () => { globalThis.Hooks = old; }};
}

/**
 * 只驱动 deleteActiveEffect 那一路——它是唯一一处直接调用 Sequencer 全局的地方，
 * 也是唯一一处错误处理会被 async 语义静默架空的地方。
 */
async function fireDelete({endEffects, effect}) {
  const {handlers, restore} = stubHooks();
  const oldSeq = globalThis.Sequencer;
  const realWarn = console.warn;
  const warns = [];
  console.warn = (...a) => warns.push(a.map(x => (x instanceof Error ? x.message : String(x))).join(" "));
  try {
    globalThis.Sequencer = endEffects === null ? undefined : {EffectManager: {endEffects}};
    installEffectTriggers({assets: null, armory: null});
    for (const fn of handlers.deleteActiveEffect ?? []) fn(effect);
    await new Promise(r => setTimeout(r, 0));      // 放 microtask 队列跑完
    return warns;
  } finally {
    console.warn = realWarn;
    globalThis.Sequencer = oldSeq;
    restore();
  }
}

const EFFECT = {uuid: "Scene.s.Token.t1.ActiveEffect.burning"};

test("deleteActiveEffect：endEffects 的 rejection 必须落到本模组的 warn，而不是未处理 rejection", async () => {
  // node --test 下真正的 unhandled rejection 会直接判整个测试文件失败，
  // 所以「跑完了」本身就是这条断言的另一半。
  const warns = await fireDelete({
    endEffects: async () => { throw new Error("boom"); },
    effect: EFFECT
  });
  assert.ok(warns.some(l => l.includes("burning") && l.includes("boom")),
    `期望一条带 uuid 的 warn，实际：${JSON.stringify(warns)}`);
});

test("deleteActiveEffect：Sequencer 全局缺失时的同步 TypeError 走同一条 warn", async () => {
  const warns = await fireDelete({endEffects: null, effect: EFFECT});
  assert.ok(warns.some(l => l.includes("burning")),
    `期望一条带 uuid 的 warn，实际：${JSON.stringify(warns)}`);
});

test("deleteActiveEffect：正常返回时静默，且按 origin + push:false 调用", async () => {
  const seen = [];
  const warns = await fireDelete({
    endEffects: async (...args) => { seen.push(args); },
    effect: EFFECT
  });
  assert.equal(warns.length, 0);
  assert.deepEqual(seen, [[{origin: EFFECT.uuid}, false]]);
});

test("deleteActiveEffect：没有 uuid 的效果直接跳过，不调用 Sequencer", async () => {
  const seen = [];
  const warns = await fireDelete({endEffects: async (...a) => { seen.push(a); }, effect: {}});
  assert.equal(seen.length, 0);
  assert.equal(warns.length, 0);
});
