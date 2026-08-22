/**
 * 修复轮 1 的 A 组：`scripts/main.mjs` 的两段接线。
 *
 * 被修的缺陷是结构性的——所有钩子都挂在 `ready` 里，而 Foundry 有两个关键钩子在 `ready`
 * 之前就已经播完了（`getChatMessageContextOptions` 只在 ChatLog 首渲染派发一次、
 * `sequencerEffectManagerReady` 每次画布加载只发一次）。修法是把**钩子注册**提到 `init`、
 * **依赖装配**留在 `ready`，两种到达顺序都要正确，且自检禁用时提前注册的钩子要自己短路。
 *
 * 这些性质只在 main.mjs 这一层成立，单测 effects.mjs / preview.mjs 各自的 install 函数
 * 覆盖不到「谁在哪个阶段被调用」。所以这里直接驱动 main.mjs 的两个 Hooks.once 回调。
 *
 * `Hooks` 必须在 import main.mjs **之前**装好：那两个 Hooks.once 是模块顶层副作用。
 */
import {test} from "node:test";
import assert from "node:assert/strict";

const HOOKS = {once: {}, on: {}};
globalThis.Hooks = {
  once: (n, fn) => { (HOOKS.once[n] ??= []).push(fn); },
  on: (n, fn) => { (HOOKS.on[n] ??= []).push(fn); }
};

const main = await import("../scripts/main.mjs");

const fireInit = () => { for (const fn of HOOKS.once.init ?? []) fn(); };
const fireReady = async () => { for (const fn of HOOKS.once.ready ?? []) await fn(); };

/**
 * 装一套刚好够 main.mjs 跑完两段的全局。
 *
 * `Sequencer.Database` 只需要存在（selfCheck 探它）并对查询给出空结果——本文件不验证
 * 素材解析，只验证接线时序。`EffectManager.getEffects` 是**观测点**：resyncPersist →
 * syncToken → playPersist 的第一件事就是查它，所以它被调用过 = 那次重同步真的跑了。
 */
function stubWorld({crucibleOk = true, freezeProto = false, tokens = []} = {}) {
  const prev = {};
  for (const k of ["game", "ui", "canvas", "foundry", "crucible", "Sequencer", "Actor",
                   "fromUuidSync"]) prev[k] = globalThis[k];

  const getEffectsCalls = [];
  const notifications = {error: [], warn: [], info: []};
  const CHAT_COMMANDS = {};

  const proto = {configureVFXEffect() { return null; }};
  if (freezeProto) Object.freeze(proto);

  globalThis.game = {
    user: {isGM: true},
    modules: {get: () => ({active: true})},
    settings: {get: (ns, key) => (ns === "crucible" ? true : key !== "debug"), register: () => {}},
    i18n: {localize: k => k, format: (k, d) => `${k}:${JSON.stringify(d)}`},
    messages: {get: () => null}
  };
  globalThis.ui = {notifications: {
    error: m => notifications.error.push(m),
    warn: m => notifications.warn.push(m),
    info: m => notifications.info.push(m)
  }};
  globalThis.canvas = {ready: true, dimensions: {size: 100}, tokens: {placeables: tokens}};
  globalThis.foundry = {applications: {sidebar: {tabs: {ChatLog: {CHAT_COMMANDS}}}}};
  globalThis.crucible = crucibleOk ? {api: {models: {CrucibleAction: {prototype: proto}}}} : undefined;
  globalThis.Sequencer = {
    Database: {getPathsUnder: () => [], getEntry: () => null},
    EffectManager: {
      getEffects: f => { getEffectsCalls.push(f); return []; },
      endEffects: async () => {}
    }
  };
  globalThis.Actor = class FakeActor {};
  globalThis.fromUuidSync = uuid => ({uuid, active: true});

  return {
    CHAT_COMMANDS, getEffectsCalls, notifications,
    restore: () => { for (const [k, v] of Object.entries(prev)) globalThis[k] = v; }
  };
}

/** 每条用例都从「模组还没挂载」的干净状态出发。 */
function reset() {
  HOOKS.once.init = HOOKS.once.init ?? [];
  HOOKS.once.ready = HOOKS.once.ready ?? [];
  HOOKS.on = {};
  main.state.active = false;
  main.state.deps = null;
  main.state.reason = null;
}

/** 场上一个带着生效状态的 token，用来观察 resyncPersist 有没有真的跑。 */
function loadedToken() {
  const document = {id: "t1", uuid: "Scene.s.Token.t1", parent: {id: "s"}};
  const effect = {uuid: "Scene.s.Token.t1.ActiveEffect.burning",
                  statuses: new Set(["burning"]), id: "burning", active: true};
  return {id: "t1", document, actor: {effects: [effect]}, effectUuid: effect.uuid};
}

/* -------------------------------------------- */

test("init：三处提前接线全部注册，而此时模组还没激活", () => {
  reset();
  const world = stubWorld();
  try {
    fireInit();
    assert.ok(HOOKS.on.getChatMessageContextOptions?.length,
      "重放菜单必须在 init 注册——getChatMessageContextOptions 只在 ChatLog 首渲染派发一次");
    assert.ok(HOOKS.on.sequencerEffectManagerReady?.length,
      "persist 重同步必须在 init 注册——这个钩子每次画布加载只发一次");
    assert.ok(world.CHAT_COMMANDS["canim-preview"],
      "/canim-preview 必须在 init 写进 ChatLog.CHAT_COMMANDS");

    assert.equal(main.state.active, false, "init 阶段不得置 active");
    assert.equal(main.liveDeps(), null, "init 阶段提前注册的钩子拿不到依赖");
  } finally { world.restore(); }
});

test("init：不得把 selfCheck / 自我禁用提前——crucible 尚未就位时 init 也不能报错", () => {
  reset();
  const world = stubWorld({crucibleOk: false});
  try {
    assert.doesNotThrow(fireInit);
    assert.deepEqual(world.notifications.error, [],
      "init 阶段就报自检失败 = 把 ready 才成立的接触点提前判了死刑");
    assert.equal(main.state.reason, null);
  } finally { world.restore(); }
});

test("ready 成功：deps 公开、active 置真，两者都在 flush 之前", async () => {
  reset();
  const world = stubWorld();
  try {
    fireInit();
    await fireReady();
    assert.equal(main.state.active, true);
    assert.ok(main.liveDeps(), "装配成功后提前注册的钩子必须能拿到依赖");
    assert.deepEqual(world.notifications.error, []);
  } finally { world.restore(); }
});

/**
 * 【A2 · 顺序二，端到端】钩子在 `ready` 之前就到了——线上真实发生的顺序。
 * 装配完成后必须补跑一次重同步，否则「重载/切场景回来光环全没了」。
 */
test("A2：sequencerEffectManagerReady 早于 ready 到达时，装配完成后补跑重同步", async () => {
  reset();
  const token = loadedToken();
  const world = stubWorld({tokens: [token]});
  try {
    fireInit();
    for (const fn of HOOKS.on.sequencerEffectManagerReady) fn();   // 钩子先到
    assert.deepEqual(world.getEffectsCalls, [], "依赖还没装配好，此刻不该去查 Sequencer");

    await fireReady();
    assert.ok(world.getEffectsCalls.some(f => f.origin === token.effectUuid),
      "装配完成后没有补跑那次错过的重同步——这就是「切场景回来光环消失」");
  } finally { world.restore(); }
});

/** 【A2 · 顺序一】deps 先好，钩子后到——照常处理。 */
test("A2：ready 之后再收到 sequencerEffectManagerReady 时照常重同步", async () => {
  reset();
  const token = loadedToken();
  const world = stubWorld({tokens: [token]});
  try {
    fireInit();
    await fireReady();
    world.getEffectsCalls.length = 0;
    for (const fn of HOOKS.on.sequencerEffectManagerReady) fn();
    assert.ok(world.getEffectsCalls.some(f => f.origin === token.effectUuid));
  } finally { world.restore(); }
});

/* -------------------------------------------- */
/*  自检失败 / 挂载抛错时提前注册的钩子必须短路    */
/* -------------------------------------------- */

test("自检失败：active 保持假，提前注册的三处钩子全部短路", async () => {
  reset();
  const token = loadedToken();
  const world = stubWorld({crucibleOk: false, tokens: [token]});
  try {
    fireInit();
    await fireReady();
    assert.equal(main.state.active, false);
    assert.ok(main.state.reason, "必须记下失败原因");
    assert.equal(main.liveDeps(), null);
    assert.equal(main.isActive(), false);
    assert.equal(world.notifications.error.length, 1, "GM 必须收到一条提示");

    // sequencerEffectManagerReady：什么都不做
    for (const fn of HOOKS.on.sequencerEffectManagerReady) fn();
    assert.deepEqual(world.getEffectsCalls, []);

    // 重放菜单：条目在册（首渲染时就冻结了，没机会补），但不可见
    let pushed = null;
    for (const fn of HOOKS.on.getChatMessageContextOptions) fn({}, {push: o => { pushed = o; }});
    assert.ok(pushed);
    globalThis.game.messages.get = () => ({id: "m1",
      flags: {crucible: {metadata: {cav: {v: 1, cues: []}}}}});   // 上一场会话留下的旧计划
    assert.equal(pushed.visible({dataset: {messageId: "m1"}}), false);

    // /canim-preview：api.preview 不存在 → 给提示并吞掉，不放行给核心判 Invalid command
    const entry = world.CHAT_COMMANDS["canim-preview"];
    assert.equal(entry.fn.call({}, "canim-preview", ["/canim-preview", ""], {}, {}), false);
    assert.deepEqual(world.notifications.warn, ["CANIM.Preview.Unavailable"]);
  } finally { world.restore(); }
});

test("挂载抛错：active 保持假、deps 不公开，GM 收到提示", async () => {
  reset();
  const token = loadedToken();
  // 冻结原型 → installWrap 赋值 configureVFXEffect 时抛 TypeError（ESM 是严格模式）。
  const world = stubWorld({freezeProto: true, tokens: [token]});
  try {
    fireInit();
    await fireReady();
    assert.equal(main.state.active, false, "半装配状态绝不能置 active");
    assert.equal(main.state.deps, null);
    assert.ok(String(main.state.reason).includes("挂载失败"));
    assert.equal(world.notifications.error.length, 1);

    for (const fn of HOOKS.on.sequencerEffectManagerReady) fn();
    assert.deepEqual(world.getEffectsCalls, [], "挂载失败之后重同步也必须短路");
  } finally { world.restore(); }
});
