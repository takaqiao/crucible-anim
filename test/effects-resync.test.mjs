/**
 * Task 15：persist 生命周期缺的三个钩子 + `resyncPersist`/`isPlayingPersist`。
 *
 * Task 14 只落地了 createActiveEffect / deleteActiveEffect 两端。缺的三条正是
 * `worldPersist:false` 这个选择的收益侧（见 effects.mjs 头部注释）：GM 在 token HUD
 * 上 toggle 状态（updateActiveEffect）、客户端重载/切场景回来/中途进场
 * （sequencerEffectManagerReady → resyncPersist）、带状态的 token 被拖进场景
 * （createToken）。
 *
 * 复用 persist-lane.test.mjs 的 stubFoundry 思路，但额外装一个会记录调用、且支持
 * `getEffects` 的 Sequencer 桩——`isPlayingPersist` 的幂等性正是靠这个方法判断。
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

import {installFakeSequencer} from "../tools/fake-sequencer.mjs";
import {tokenPlaceable} from "../tools/token-mocks.mjs";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import {installEffectTriggers, resyncPersist} from "../scripts/trigger/effects.mjs";
import {queueDepth} from "../scripts/trigger/dispatch.mjs";
import {PERSIST_LEAD_MS} from "../scripts/const.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const ENV = {gridSize: 100};
const deps = () => ({assets: createAssets(offlineBackend(index)), armory: ARMORY});

const sleep = ms => new Promise(r => setTimeout(r, ms));
const bounded = (p, ms = 3000) => Promise.race([p, sleep(ms)]);
/**
 * playPersist 走 runPersistAnimation，没有排队中的动作动画时会先老实等满一个
 * PERSIST_LEAD_MS 的宽限期才播出（见 dispatch.mjs 的两段让路）。这里没有任何一条
 * 用例喂了并发的动作动画，所以每次都要等这么久，而不是随手 sleep 几十毫秒。
 */
const afterGrace = () => bounded(sleep(PERSIST_LEAD_MS + 150));

/**
 * 最小 Foundry 桩，在 persist-lane.test.mjs 的 stubFoundry 基础上补两样：
 *   · `Sequencer.EffectManager.getEffects` 真的按 {origin, object} 过滤已播出的记录
 *     （`isPlayingPersist` 靠它判断"这份光环本地是不是已经在放"）；
 *   · `game.settings.get` 需要能回答 crucible 的 enableVFX 与本模组的 enabled/volume
 *     三个键（`animationsEnabled()`/`getSetting()` 都会读）。
 */
function stubFoundry({tokens, effectAlive = () => true} = {}) {
  const prev = {
    Hooks: globalThis.Hooks, Actor: globalThis.Actor, game: globalThis.game,
    canvas: globalThis.canvas, fromUuidSync: globalThis.fromUuidSync,
    Sequencer: globalThis.Sequencer
  };
  const handlers = {};
  const playing = [];               // {origin, object} 一旦"播出"就记进这里
  globalThis.Hooks = {on: (n, fn) => { (handlers[n] ??= []).push(fn); }};
  globalThis.Actor = class FakeActor {};
  globalThis.game = {
    settings: {get: (ns, key) => (ns === "crucible" ? true : key !== "debug")}
  };
  globalThis.canvas = {dimensions: {size: 100}, ready: true, tokens: {placeables: tokens ?? []}};
  globalThis.fromUuidSync = uuid => (uuid.includes("ActiveEffect")
    ? (effectAlive(uuid) ? {uuid} : null)
    : {uuid, object: (tokens ?? [])[0]});
  globalThis.Sequencer = {
    EffectManager: {
      endEffects: async () => {},
      getEffects: ({origin, object}) => playing.filter(p => p.origin === origin && p.object === object)
    }
  };
  const actor = Object.assign(new globalThis.Actor(), {getActiveTokens: () => tokens ?? []});
  return {
    handlers, actor, playing,
    /** 让 isPlayingPersist 认为这一份光环已经在放。 */
    markPlaying: (origin, object) => playing.push({origin, object}),
    fire: (name, ...args) => { for (const fn of handlers[name] ?? []) fn(...args); },
    restore: () => { for (const [k, v] of Object.entries(prev)) globalThis[k] = v; }
  };
}

function activeEffect(token, statusId = "burning") {
  return {uuid: `Scene.s.Token.${token.id}.ActiveEffect.${statusId}`,
          statuses: new Set([statusId]), id: statusId, active: true};
}

/* -------------------------------------------- */
/*  updateActiveEffect: disabled 翻转             */
/* -------------------------------------------- */

test("updateActiveEffect：disabled 翻真时结束光环，翻假（重新生效）时补齐", async () => {
  const fake = installFakeSequencer();
  const token = tokenPlaceable({id: "t1", center: {x: 500, y: 500}});
  const world = stubFoundry({tokens: [token]});
  try {
    installEffectTriggers(deps());
    const effect = {...activeEffect(token), parent: world.actor, active: false};

    // disabled: true（active 翻假）→ 必须走 endPersist（Sequencer.endEffects）
    let ended = false;
    world.playing.length = 0;
    const origEnd = world.actor; // noop, 保留变量避免 lint 误报
    globalThis.Sequencer.EffectManager.endEffects = async (filter) => {
      if (filter.origin === effect.uuid) ended = true;
    };
    world.fire("updateActiveEffect", effect, {disabled: true});
    await sleep(5);
    assert.ok(ended, "GM 在 HUD 上禁用状态后必须结束对应的持续特效");

    // disabled: false（active 翻真）→ 必须重新播放（走 runPersistAnimation）
    effect.active = true;
    world.fire("updateActiveEffect", effect, {disabled: false});
    await afterGrace();
    assert.equal(fake.sequences.length, 1, "重新生效后必须补播一份持续特效");
    assert.equal(queueDepth(), 0);
  } finally { world.restore(); fake.restore(); }
});

test("updateActiveEffect：非 disabled 字段更新不触发任何播放/清理", async () => {
  const fake = installFakeSequencer();
  const token = tokenPlaceable({id: "t1", center: {x: 500, y: 500}});
  const world = stubFoundry({tokens: [token]});
  try {
    installEffectTriggers(deps());
    const effect = {...activeEffect(token), parent: world.actor};
    let endCalled = false;
    globalThis.Sequencer.EffectManager.endEffects = async () => { endCalled = true; };
    world.fire("updateActiveEffect", effect, {name: "改了名字"});
    await sleep(5);
    assert.equal(fake.sequences.length, 0);
    assert.equal(endCalled, false);
  } finally { world.restore(); fake.restore(); }
});

/* -------------------------------------------- */
/*  createToken: 带状态的 token 被拖进场景         */
/* -------------------------------------------- */

test("createToken：token 带着已生效的状态被放进当前场景时补播光环", async () => {
  const fake = installFakeSequencer();
  const token = tokenPlaceable({id: "t2", center: {x: 300, y: 300}});
  const actor = {effects: [activeEffect(token)]};
  Object.assign(token, {actor});
  const world = stubFoundry({tokens: [token]});
  try {
    installEffectTriggers(deps());
    world.fire("createToken", {parent: {isView: true}, object: token});
    await afterGrace();
    assert.equal(fake.sequences.length, 1, "入场的 token 带着生效中的状态必须补齐光环");
  } finally { world.restore(); fake.restore(); }
});

test("createToken：不在当前视图的场景（isView:false）不触发", async () => {
  const fake = installFakeSequencer();
  const token = tokenPlaceable({id: "t3", center: {x: 300, y: 300}});
  const actor = {effects: [activeEffect(token)]};
  Object.assign(token, {actor});
  const world = stubFoundry({tokens: [token]});
  try {
    installEffectTriggers(deps());
    world.fire("createToken", {parent: {isView: false}, object: token});
    await sleep(20);
    assert.equal(fake.sequences.length, 0);
  } finally { world.restore(); fake.restore(); }
});

test("createToken：object 尚未渲染完成（null）时静默跳过，不抛错", async () => {
  const fake = installFakeSequencer();
  const world = stubFoundry({tokens: []});
  try {
    installEffectTriggers(deps());
    assert.doesNotThrow(() => world.fire("createToken", {parent: {isView: true}, object: null}));
  } finally { world.restore(); fake.restore(); }
});

/* -------------------------------------------- */
/*  sequencerEffectManagerReady → resyncPersist  */
/* -------------------------------------------- */

test("sequencerEffectManagerReady：接线后自动触发 resyncPersist，补齐场上全部 token", async () => {
  const fake = installFakeSequencer();
  const t1 = tokenPlaceable({id: "t1", center: {x: 100, y: 100}});
  const t2 = tokenPlaceable({id: "t2", center: {x: 200, y: 200}});
  Object.assign(t1, {actor: {effects: [activeEffect(t1, "burning")]}});
  Object.assign(t2, {actor: {effects: [activeEffect(t2, "chilled")]}});
  const world = stubFoundry({tokens: [t1, t2]});
  try {
    installEffectTriggers(deps());
    world.fire("sequencerEffectManagerReady");
    await afterGrace();
    assert.equal(fake.sequences.length, 2, "场上两个各带一个状态的 token 必须各补一份光环");
  } finally { world.restore(); fake.restore(); }
});

test("resyncPersist：canvas 未就绪时直接跳过，不抛错", async () => {
  const world = stubFoundry({tokens: []});
  globalThis.canvas.ready = false;
  try {
    await assert.doesNotReject(resyncPersist(deps(), ENV));
  } finally { world.restore(); }
});

test("resyncPersist：本地已经在放的（isPlayingPersist 命中）直接跳过", async () => {
  const fake = installFakeSequencer();
  const token = tokenPlaceable({id: "t1", center: {x: 500, y: 500}});
  const effect = activeEffect(token, "burning");
  Object.assign(token, {actor: {effects: [effect]}});
  const world = stubFoundry({tokens: [token]});
  try {
    installEffectTriggers(deps());
    world.markPlaying(effect.uuid, token);        // 伪造"本地已经在播"
    await resyncPersist(deps(), {gridSize: 100});
    await afterGrace();
    assert.equal(fake.sequences.length, 0, "已经在播的状态不该被重新播放一次");
  } finally { world.restore(); fake.restore(); }
});
