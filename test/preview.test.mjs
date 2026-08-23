/**
 * Task 15：预览宏的纯函数部分（`previewActionPlan` / `previewEffectPlan` /
 * `parsePreviewArgs`）+ 重放菜单接线（`installReplayMenu`）。
 *
 * 预览宏本体（`installPreview`/`runPreview`）依赖 `canvas`/`game.user.targets`/
 * Sequencer 的完整运行时，headless 测不了；但它内部构造 FXPlan 的两个函数是纯的
 * （给定 rule/token/env/deps，不碰任何全局），可以像 armory 规则表一样直接单测。
 *
 * 这里同时钉住简报参考实现里两个没写出来的坑（对应交接约束 (5)：
 * 「previewEffectPlan 需要显式降级」）：
 *   1. 只把 armory[slot] 收窄成单条规则并不够——规则自己的 `when()` 仍然可能因为
 *      合成快照缺字段而判负，那样"这一槽没产出"会被其它三槽的常规产出悄悄掩盖，
 *      通知上写着这条规则的 id，画面播的却是别的东西。
 *   2. persist 规则的 cue.tieTo 来自 `effectSnapshot.effectUuid`；不给一个真实存在、
 *      可解析的值，`resolveEffect()` 的 `keepTied()` 会把 cue 整条丢弃——12 个分组
 *      会全部拿到 `plan === null`。
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";

import {tokenPlaceable} from "../tools/token-mocks.mjs";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import {resolve, resolveEffect} from "../scripts/resolver/resolve.mjs";
import {snapshotAction} from "../scripts/trigger/snapshot.mjs";
import {NO_PERSIST, GROUP_FX} from "../scripts/armory/persist.mjs";
import {previewActionPlan, previewEffectPlan, parsePreviewArgs, installReplayMenu,
        PREVIEW_FIXTURES, ALWAYS_SILENT} from "../scripts/player/preview.mjs";
import {planOf} from "../scripts/trigger/dispatch.mjs";
import {TARGET_REGION} from "../tools/dump-fixtures.mjs";
import {SLOTS} from "../scripts/const.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const ENV = {gridSize: 100, distancePixels: 100};
const deps = () => ({assets: createAssets(offlineBackend(index)), armory: ARMORY});

const origin = () => tokenPlaceable({id: "origin", center: {x: 500, y: 500}});
const target = () => tokenPlaceable({id: "target", center: {x: 600, y: 500}});

const ruleIn = (slot, id) => ARMORY[slot].find(r => r.id === id);

function probeAction() {
  return {
    id: "__probe__", name: "probe", tags: new Set(["strike", "melee", "slashing"]),
    target: {type: "single", number: 1, distance: 1, scope: 2},
    range: {minimum: 0, maximum: 1}, cost: {action: 1, focus: 0, heroism: 0, health: 0},
    region: null, actor: null, token: origin(),
    targets: new Map([[{id: "x"}, {token: target()}]]),
    usage: {damageType: "slashing", isAttack: true, isRanged: false,
            strikes: [{category: "balanced1", system: {damageType: "slashing"}}]},
    eventsByTarget: new Map([[{id: "x"},
      {all: [], roll: [{roll: {data: {result: 7}, isCriticalSuccess: true}}]}]])
  };
}

/* -------------------------------------------- */
/*  previewActionPlan                            */
/* -------------------------------------------- */

test("previewActionPlan：strike.ranged.draw 强制命中后必须带自己的 cue（弓弦音轨）", () => {
  const rule = ruleIn("cast", "strike.ranged.draw");
  assert.ok(rule);
  const plan = previewActionPlan(rule, "cast", origin(), target(), ENV, deps());
  assert.ok(plan, "build() 只用了 ctx.sound()，不依赖 when() 判的那个 category，强制命中后必须有产出");
  assert.ok(plan.cues.some(c => c.rule === "strike.ranged.draw" && c.slot === "cast"));
});

test("previewActionPlan：generic.cast 对「有目标的攻击动作」按设计就该是空——" +
     "这是正确的诚实降级，不是 bug", () => {
  // build() 里第一行就是 `if (s.usage.isAttack && s.targets.length) return null`：
  // 非法术攻击已经有 impact/travel 承担视觉，cast 槽的通用施法特效会跟攻击动作抢戏。
  // previewActionPlan 的合成动作恰好是「有目标的攻击」，所以这条规则强制命中之后
  // 仍然诚实返回 null——钉住这一点，免得将来有人把 previewActionPlan 的容错逻辑
  // 改成"build() 返回 null 也硬凑一条 cue"这种更"讨喜"但错误的行为。
  const rule = ruleIn("cast", "generic.cast");
  assert.ok(rule);
  const plan = previewActionPlan(rule, "cast", origin(), target(), ENV, deps());
  assert.equal(plan, null);
});

test("previewActionPlan：强制 when 恒真让按 tag 精确匹配的规则也能被命中", () => {
  // tag.healing 的 when 要求 tags 里有 "healing"，previewActionPlan 的合成动作只有
  // ["strike","melee","slashing"]——不强制 when 的话这条规则在预览里永远选不中。
  const rule = ruleIn("cast", "tag.healing");
  assert.ok(rule);
  const plan = previewActionPlan(rule, "cast", origin(), target(), ENV, deps());
  assert.ok(plan, "强制 when 之后 tag.healing 必须能被预览到（它的 build() 不依赖 tags 本身）");
  assert.ok(plan.cues.some(c => c.rule === "tag.healing"));
});

test("previewActionPlan：build() 需要合成快照给不出的字段时，诚实返回 null 而不是别的槽冒名顶替", () => {
  // spell.gesture.ray 的 build() 需要 s.region.length/rotation 之类的模板几何——
  // previewActionPlan 的合成动作 region:null，即便强制 when 命中，build() 也会因为
  // 读取 null.length 抛错，被 resolve.mjs 的 runBuild 接住降级成 0 条 cue。
  const rule = ruleIn("travel", "spell.gesture.ray");
  assert.ok(rule);
  const plan = previewActionPlan(rule, "travel", origin(), target(), ENV, deps());
  assert.equal(plan, null,
    "没有真实模板数据时必须诚实地返回 null，不能让其它槽的常规产出冒充这条规则的预览结果");
});

test("回归：不强制 when、只收窄 armory 数组——按 tag 精确匹配的规则在预览下静默失踪，" +
     "整体计划却仍然非空，这正是需要「显式降级」的理由", () => {
  const rule = ruleIn("cast", "tag.healing");
  const snapshot = snapshotAction(probeAction(), ENV);
  // 朴素写法：只把 cast 槽收窄成这一条规则，不动它的 when()。
  const naive = resolve(snapshot, {assets: deps().assets, armory: {...ARMORY, cast: [rule]}});
  assert.ok(naive, "其它三槽（travel/impact/aftermath）仍会各自选出常规规则，计划本身非空");
  assert.ok(!naive.cues.some(c => c.rule === "tag.healing"),
    "cast 槽里唯一候选 tag.healing 的 when() 判负，这条规则的 cue 一条都没有——" +
    "但调用方只看到 plan 非空，很容易误判成「预览成功」");
});

/* -------------------------------------------- */
/*  previewEffectPlan                            */
/* -------------------------------------------- */

test("previewEffectPlan：12 个状态分组 + 通用兜底，强制命中后全部产出绑定到目标 token 的持久 cue", () => {
  const t = target();
  for (const group of Object.keys(GROUP_FX)) {
    const rule = ruleIn("persist", `status.${group}`);
    assert.ok(rule, `分组 "${group}" 对应的规则不存在`);
    const plan = previewEffectPlan(rule, t, ENV, deps());
    assert.ok(plan, `分组 "${group}" 强制命中后不该是 null（交接约束 (5) 钉的正是这个症状）`);
    assert.equal(plan.cues.length, 1);
    const cue = plan.cues[0];
    assert.equal(cue.rule, rule.id);
    assert.equal(cue.persist, true);
    assert.equal(cue.tieTo, t.document.uuid, "tieTo 必须钉在目标 token 自己的 uuid 上");
  }
  const generic = ruleIn("persist", "generic.persist");
  const plan = previewEffectPlan(generic, t, ENV, deps());
  assert.ok(plan);
  assert.equal(plan.cues[0].rule, "generic.persist");
});

test("previewEffectPlan：status.silent 的语义是「就该没有画面」，预览诚实返回 null", () => {
  const rule = ruleIn("persist", "status.silent");
  assert.ok(rule);
  assert.ok(NO_PERSIST.length > 0, "语料前提：至少存在一个刻意静默的状态");
  const plan = previewEffectPlan(rule, target(), ENV, deps());
  assert.equal(plan, null, "build() 恒返回 null，即便强制 when 命中也不该凭空生出画面");
});

test("回归：effectUuid 不给真实值（如简报参考实现的字面 null）——" +
     "keepTied 会把 persist cue 整条丢弃，12 个分组全部拿到 null", () => {
  const t = target();
  const rule = {...ruleIn("persist", "status.burning"), when: () => true};
  const naiveSnapshot = {
    statusId: "__preview__.status.burning",
    effectUuid: null,                              // 简报参考实现原样这么写
    target: {tokenId: t.id, uuid: t.document.uuid, x: t.center.x, y: t.center.y,
             elevation: 0, width: 1, height: 1, w: 100, h: 100, radiusPx: 50},
    seed: 1
  };
  const naive = resolveEffect(naiveSnapshot, {assets: deps().assets, armory: {persist: [rule]}});
  assert.equal(naive, null,
    "effectUuid:null → cue.tieTo 为空 → keepTied 丢弃这条 cue → cues.length===0 → plan===null");
});

/* -------------------------------------------- */
/*  parsePreviewArgs                             */
/* -------------------------------------------- */

test("parsePreviewArgs：解析 slot/filter/gap，冒号与等号都认", () => {
  assert.deepEqual(parsePreviewArgs("slot:impact filter:melee gap:800"),
    {slot: "impact", filter: "melee", gap: 800});
  assert.deepEqual(parsePreviewArgs("slot=persist"), {slot: "persist"});
});

test("parsePreviewArgs：空输入/纯空白返回空对象", () => {
  assert.deepEqual(parsePreviewArgs(""), {});
  assert.deepEqual(parsePreviewArgs("   "), {});
  assert.deepEqual(parsePreviewArgs(undefined), {});
  assert.deepEqual(parsePreviewArgs(null), {});
});

test("parsePreviewArgs：无法识别的 key 与非数字的 gap 被忽略，不抛错", () => {
  assert.deepEqual(parsePreviewArgs("bogus:xyz gap:notanumber slot:cast"), {slot: "cast"});
});

test("parsePreviewArgs：多余空白与制表符不影响解析", () => {
  assert.deepEqual(parsePreviewArgs("  slot:cast   gap:500  "), {slot: "cast", gap: 500});
});

/* -------------------------------------------- */
/*  installReplayMenu                            */
/* -------------------------------------------- */

function stubHooksAndMessages(messages) {
  const handlers = {};
  const prev = {Hooks: globalThis.Hooks, game: globalThis.game};
  globalThis.Hooks = {on: (n, fn) => { (handlers[n] ??= []).push(fn); }};
  globalThis.game = {
    messages: {get: id => messages.find(m => m.id === id) ?? null},
    i18n: {localize: k => k}
  };
  return {
    handlers,
    fire: (name, ...args) => { for (const fn of handlers[name] ?? []) fn(...args); },
    restore: () => { for (const [k, v] of Object.entries(prev)) globalThis[k] = v; }
  };
}

test("installReplayMenu：visible 与 dispatch.mjs 共享的 planOf 同源——" +
     "带本模组 plan 的卡返回 true，没有的返回 false", () => {
  const withPlan = {id: "m1", flags: {crucible: {metadata: {cav: {v: 1, cues: []}}}}};
  const withoutPlan = {id: "m2", flags: {crucible: {}}};
  const world = stubHooksAndMessages([withPlan, withoutPlan]);
  try {
    installReplayMenu(() => true);
    let pushed = null;
    world.fire("getChatMessageContextOptions", {}, {push: opt => { pushed = opt; }});
    assert.ok(pushed, "必须真的注册了一条菜单项");
    assert.equal(pushed.visible({dataset: {messageId: "m1"}}), true);
    assert.equal(pushed.visible({dataset: {messageId: "m2"}}), false);
    assert.equal(pushed.visible({dataset: {messageId: "does-not-exist"}}), false);
    // visible 的判据必须真的是导出的 planOf，而不是各写一份容易漂移的等价逻辑。
    assert.equal(!!planOf(withPlan), true);
    assert.equal(!!planOf(withoutPlan), false);
  } finally { world.restore(); }
});

test("installReplayMenu：onClick 不得写 message._vfxPlayback——那个字段只服务于 confirm()", async () => {
  const msg = {id: "m3", flags: {crucible: {metadata: {cav: {v: 1, cues: []}}}}};
  const world = stubHooksAndMessages([msg]);
  try {
    installReplayMenu(() => true);
    let pushed = null;
    world.fire("getChatMessageContextOptions", {}, {push: opt => { pushed = opt; }});
    assert.equal(msg._vfxPlayback, undefined, "调用前不该有这个字段");
    // playFromMessage 会尝试碰 canvas/game.settings 等真实运行时全局，这里不追求它
    // 真的播出动画，只钉住 onClick 本身绝不主动写 _vfxPlayback 这一条契约。
    await pushed.onClick({}, {dataset: {messageId: "m3"}}).catch(() => {});
    assert.equal(msg._vfxPlayback, undefined,
      "重放不是 confirm() 的一部分，写 _vfxPlayback 会污染下一次「撤销→重新确认」的判断");
  } finally { world.restore(); }
});

/* -------------------------------------------- */
/*  installPreview / installPreviewCommand        */
/* -------------------------------------------- */

/**
 * v14 的聊天输入是 ProseMirror，`processMessage()` 转发给钩子与 `parse()` 的都是 HTML。
 * `ChatLog.parse()` 对**非 isRoll** 的命令匹配的不是原串，而是剥掉最外层 `<p>` 之后的
 * `html`（foundry client/applications/sidebar/tabs/chat.mjs:812 与 820-826）。
 * 这个 helper 复刻那一行；`test/source-tables.test.mjs` 有一条守卫把它钉在真源码上，
 * 免得核心改了剥法之后这里还在按老规矩自测自嗨。
 */
export const CORE_HTML_STRIP = message => message.replace(/^<p>|<\/p>$/gi, "");

function stubChatWorld({withApi = true} = {}) {
  const prev = {game: globalThis.game, foundry: globalThis.foundry, ui: globalThis.ui};
  const mod = {};
  const CHAT_COMMANDS = {};
  const notices = [];
  globalThis.game = {
    modules: {get: id => (id === "crucible-anim" ? mod : null)},
    i18n: {localize: k => k, format: (k, d) => `${k}:${JSON.stringify(d)}`}
  };
  globalThis.foundry = {applications: {sidebar: {tabs: {ChatLog: {CHAT_COMMANDS}}}}};
  globalThis.ui = {notifications: {warn: m => notices.push(m), info: m => notices.push(m)}};
  if (!withApi) mod.api = undefined;
  return {
    mod, CHAT_COMMANDS, notices,
    entry: () => CHAT_COMMANDS["canim-preview"],
    /** 走一遍核心 parse() 的判据：剥 <p> → 匹配 rgx → 调 fn。 */
    send: (message) => {
      const entry = CHAT_COMMANDS["canim-preview"];
      const match = CORE_HTML_STRIP(message).match(entry.rgx);
      if (!match) return null;                     // 没匹配上 = 核心会继续往下找别的命令
      return entry.fn.call({}, "canim-preview", match, {}, {});
    },
    restore: () => { for (const [k, v] of Object.entries(prev)) globalThis[k] = v; }
  };
}

test("installPreview：把 preview() 挂到 game.modules.get(MODULE_ID).api 上", async () => {
  const {installPreview} = await import("../scripts/player/preview.mjs");
  const world = stubChatWorld();
  try {
    installPreview(deps());
    assert.equal(typeof world.mod.api.preview, "function");
  } finally { world.restore(); }
});

test("installPreviewCommand：注册进 ChatLog.CHAT_COMMANDS，而不是挂 chatMessage 钩子", async () => {
  const {installPreviewCommand, PREVIEW_COMMAND_KEY} = await import("../scripts/player/preview.mjs");
  const world = stubChatWorld();
  try {
    assert.equal(installPreviewCommand(), true);
    const entry = world.CHAT_COMMANDS[PREVIEW_COMMAND_KEY];
    assert.ok(entry, "必须真的写进 CHAT_COMMANDS");
    assert.ok(entry.rgx instanceof RegExp);
    assert.equal(typeof entry.fn, "function");
    // isRoll 必须为假（不设即为假）：parse() 只有非 isRoll 的分支才拿剥过 <p> 的 html 去
    // 匹配，置真会改成拿 textContent，我们的 rgx 就对不上了。
    assert.ok(!entry.isRoll);
  } finally { world.restore(); }
});

test("installPreviewCommand：ProseMirror 送来的 <p> 包裹形态能匹配，参数照常解析，并吞掉消息", async () => {
  const {installPreview, installPreviewCommand} = await import("../scripts/player/preview.mjs");
  const world = stubChatWorld();
  try {
    installPreviewCommand();
    installPreview(deps());
    let called = null;
    world.mod.api.preview = opts => { called = opts; return Promise.resolve(); };
    const ret = world.send("<p>/canim-preview slot:persist gap:500</p>");
    assert.equal(ret, false, "fn 必须返回 false，否则消息会真的发进聊天（chat.mjs:886-887）");
    assert.deepEqual(called, {slot: "persist", gap: 500});
  } finally { world.restore(); }
});

test("installPreviewCommand：不带参数、以及裸文本（非 ProseMirror）两种形态都匹配", async () => {
  const {installPreview, installPreviewCommand} = await import("../scripts/player/preview.mjs");
  const world = stubChatWorld();
  try {
    installPreviewCommand();
    installPreview(deps());
    const seen = [];
    world.mod.api.preview = opts => { seen.push(opts); return Promise.resolve(); };
    assert.equal(world.send("<p>/canim-preview</p>"), false);
    assert.equal(world.send("/canim-preview slot:cast"), false);
    assert.deepEqual(seen, [{}, {slot: "cast"}]);
  } finally { world.restore(); }
});

test("回归：Task 15 交付版的 `message.startsWith(\"/canim-preview\")` 对 v14 的 HTML 判负", () => {
  // 这是 C 组缺陷的根：钩子拿到的是 "<p>/canim-preview …</p>"，startsWith 永远为假 →
  // 放行 → parse() 判 invalid command → 弹「Invalid command」。命令一次都没触发过。
  const raw = "<p>/canim-preview slot:persist</p>";
  assert.equal(raw.startsWith("/canim-preview"), false,
    "如果这条都为真，说明 v14 的输入形态变了，C 组的修法要重新评估");
  assert.equal(CORE_HTML_STRIP(raw).startsWith("/canim-preview"), true);
});

test("installPreviewCommand：普通聊天消息不匹配这条命令的 rgx", async () => {
  const {installPreviewCommand} = await import("../scripts/player/preview.mjs");
  const world = stubChatWorld();
  try {
    installPreviewCommand();
    let called = false;
    world.mod.api = {preview: () => { called = true; return Promise.resolve(); }};
    for (const msg of ["<p>大家好</p>", "<p>/canim-previewX</p>", "<p>/roll 1d20</p>",
                       "<p>说到 /canim-preview 这个命令</p>"]) {
      assert.equal(world.send(msg), null, `"${msg}" 不该匹配 /canim-preview`);
    }
    assert.equal(called, false);
  } finally { world.restore(); }
});

test("installPreviewCommand：模组未成功挂载（api.preview 不存在）时给提示并仍然吞掉消息", async () => {
  const {installPreviewCommand} = await import("../scripts/player/preview.mjs");
  const world = stubChatWorld({withApi: false});
  try {
    installPreviewCommand();
    const ret = world.send("<p>/canim-preview</p>");
    assert.equal(ret, false, "不能放行——放行会让核心抛「Invalid command」");
    assert.deepEqual(world.notices, ["CANIM.Preview.Unavailable"]);
  } finally { world.restore(); }
});

test("installPreviewCommand：ChatLog.CHAT_COMMANDS 不可用时优雅退化，不抛错", async () => {
  const {installPreviewCommand} = await import("../scripts/player/preview.mjs");
  const prev = globalThis.foundry;
  const realWarn = console.warn;
  console.warn = () => {};
  try {
    globalThis.foundry = {};
    assert.equal(installPreviewCommand(), false);
  } finally { globalThis.foundry = prev; console.warn = realWarn; }
});


/* -------------------------------------------- */
/*  F 组：全兵库预览覆盖率                        */
/* -------------------------------------------- */

/**
 * 与 runPreview 里的取用方式逐字一致：由 ActiveEffect 驱动的两槽（persist / death）
 * 走 previewEffectPlan，其余四槽走动作快照 + fixture。
 */
const EFFECT_SLOTS = ["persist", "death"];
function previewOf(slot, rule) {
  return EFFECT_SLOTS.includes(slot)
    ? previewEffectPlan(rule, target(), ENV, deps(), slot)
    : previewActionPlan(rule, slot, origin(), target(), ENV, deps(),
                        PREVIEW_FIXTURES[`${slot}/${rule.id}`] ?? {});
}

/**
 * 【F 组 · 主守卫】遍历整张兵库，断言除 ALWAYS_SILENT 之外每条规则都能预览出**含自己
 * 那条 cue** 的非空计划。
 *
 * 为什么必须有这条：预览宏是渲染层唯一的人工验收手段。交付时实测 28/40 非空，扣掉
 * `persist/status.silent` 是 28/39——aftermath 整槽 0/5，也就是治疗/击杀/士气/地面残留
 * 这四个「实战中最难按需触发」的效果，上机前谁都没见过一眼。
 *
 * 这条守卫也自动约束以后新增的规则：加一条规则却没给它配 fixture，这里直接红。
 */
test("F：全兵库每条规则（ALWAYS_SILENT 除外）都能预览出含自己 cue 的非空计划", () => {
  const gaps = [];
  let checked = 0;
  for (const slot of SLOTS) {
    for (const rule of ARMORY[slot]) {
      const key = `${slot}/${rule.id}`;
      if (ALWAYS_SILENT.includes(key)) continue;
      checked++;
      const plan = previewOf(slot, rule);
      if (!plan) { gaps.push(key); continue; }
      // 「非空」还不够：必须真的含这条规则自己的 cue，否则就是别的槽冒名顶替。
      if (!plan.cues.some(c => c.rule === rule.id)) gaps.push(`${key}（计划非空但不含自己的 cue）`);
    }
  }
  assert.deepEqual(gaps, [], `${gaps.length} 条规则预览不出来`);
  assert.equal(checked, 39,
    "兵库规则条数变了：确认新规则要么配了 fixture、要么进了 ALWAYS_SILENT，再改这个数字");
});

/**
 * 【F 组 · 反向守卫】ALWAYS_SILENT 不是免检通道：拿**每一份** fixture 轮流喂给这几条
 * 规则，它们必须在任何一份下都仍然为空。某条其实能出画面 = 它被错误地藏进了豁免表。
 */
test("F：ALWAYS_SILENT 里的规则在任何一份 fixture 下都仍然为空（豁免不是免检）", () => {
  const wrong = [];
  const fixtures = [{}, ...Object.values(PREVIEW_FIXTURES)];
  for (const key of ALWAYS_SILENT) {
    const [slot, id] = [key.slice(0, key.indexOf("/")), key.slice(key.indexOf("/") + 1)];
    const rule = ruleIn(slot, id);
    assert.ok(rule, `ALWAYS_SILENT 里的 ${key} 在兵库里不存在`);
    if (slot === "persist") {
      if (previewEffectPlan(rule, target(), ENV, deps())) wrong.push(key);
      continue;
    }
    for (const f of fixtures) {
      if (previewActionPlan(rule, slot, origin(), target(), ENV, deps(), f)) {
        wrong.push(`${key}（fixture ${JSON.stringify(f)}）`);
        break;
      }
    }
  }
  assert.deepEqual(wrong, [], "这些规则其实能出画面，不该留在 ALWAYS_SILENT 里");
});

/**
 * 【F 组 · 与简报的偏差】简报把 `cast/strike.melee.heavy`、`travel/target.blast`、
 * `aftermath/generic.aftermath` 列成「快照多样性不够」的缺口并给了快照要求。实际这三条
 * 的 `build` 是**无条件** `() => null`，分类条件写在 `when()` 里——任何 fixture 都救不了，
 * 它们与 status.silent 同类。这条测试直接读兵库对象钉住这个事实，免得将来有人照着简报
 * 又去给它们配 fixture。
 */
test("F：三条被简报误列为「缺 fixture」的规则，其 build() 是无条件恒空", () => {
  for (const key of ["cast/strike.melee.heavy", "travel/target.blast",
                     "aftermath/generic.aftermath"]) {
    const [slot, id] = [key.slice(0, key.indexOf("/")), key.slice(key.indexOf("/") + 1)];
    const rule = ruleIn(slot, id);
    assert.ok(rule, key);
    assert.equal(rule.build.length, 0, `${key} 的 build() 收参数了，可能不再是恒空`);
    assert.equal(rule.build(), null, `${key} 的 build() 不再恒返回 null`);
    assert.ok(ALWAYS_SILENT.includes(key), `${key} 必须在 ALWAYS_SILENT 里`);
  }
});

/**
 * 【F 组 · 反伪造】fixture 里的模板几何必须与 tools/dump-fixtures.mjs 的 TARGET_REGION
 * 一致——那张表的 angle 由 test/source-tables.test.mjs 直接解析 crucible 的
 * `TARGET_TYPES.<key>.region.angle` 核对。preview 侧不能 import 那个工具（它拉了
 * node:fs / classic-level），只能抄一份数值，所以这里把两份钉在一起。
 */
test("F：PREVIEW_FIXTURES 的模板几何与 TARGET_REGION 逐字段一致（不是现编的）", () => {
  assert.deepEqual(PREVIEW_FIXTURES["travel/spell.gesture.ray"].region, TARGET_REGION.ray);
  assert.deepEqual(PREVIEW_FIXTURES["travel/spell.gesture.cone"].region, TARGET_REGION.cone);
  assert.deepEqual(PREVIEW_FIXTURES["aftermath/aftermath.groundResidue"].region,
                   TARGET_REGION.cone);
});

/**
 * 【F 组 · 逐条】aftermath 三条各自要的信号必须真的经 snapshotAction 推导出来，
 * 而不是被直接塞进快照。断言落在**产出的 cue 与它依赖的字段**上。
 * （原来的第四条 `aftermath.kill` 已迁去 death 槽，见 armory/death.mjs 与
 * test/effects-death.test.mjs——它要的信号根本不在动作快照里。）
 */
test("F：aftermath 三条各自被自己的 fixture 命中，且 cue 落在 aftermath 槽", () => {
  for (const id of ["aftermath.healing", "aftermath.morale", "aftermath.groundResidue"]) {
    const rule = ruleIn("aftermath", id);
    const plan = previewOf("aftermath", rule);
    assert.ok(plan, `${id} 预览不出来`);
    const own = plan.cues.filter(c => c.rule === id);
    assert.ok(own.length > 0, `${id} 的计划里没有它自己的 cue`);
    for (const c of own) assert.equal(c.slot, "aftermath");
    assert.ok(own.every(c => typeof c.file === "string" && c.file.length > 0),
      `${id} 的 cue 没有素材路径`);
  }
});

test("F：fixture 走的是动作层而不是直接改快照——healed/damage/effects 由事件流推导", () => {
  // 这是「不许伪造快照」的落点：如果 previewActionPlan 改成直接覆盖 snapshot 字段，
  // 下面这些 snapshotAction 才会算出来的派生值就不再被行使，实战里照样不出画面。
  const s = snapshotAction(probeAction(), ENV);
  assert.equal(s.targets[0].healed, 0, "前提：默认快照没有治疗");
  assert.equal(s.targets[0].damage, null, "前提：默认快照没有伤害");
  assert.deepEqual(s.targets[0].effects, [], "前提：默认快照没有状态");

  // 反过来，配了 fixture 的两条必须真的走通 snapshotAction 的推导，
  // 表现为 build() 里那两个守卫（healed>0 / damage 非空）放行。
  for (const id of ["aftermath.healing", "aftermath.morale"]) {
    assert.ok(previewOf("aftermath", ruleIn("aftermath", id)),
      `${id} 的信号没能经事件流推导出来`);
  }
});

/* -------------------------------------------- */
/*  A1：重放菜单的自我禁用短路                    */
/* -------------------------------------------- */

test("installReplayMenu：模组未激活（isActive 为假）时菜单项不可见，即便卡上还留着旧 plan", () => {
  const withPlan = {id: "m1", flags: {crucible: {metadata: {cav: {v: 1, cues: []}}}}};
  const world = stubHooksAndMessages([withPlan]);
  try {
    installReplayMenu(() => false);
    let pushed = null;
    world.fire("getChatMessageContextOptions", {}, {push: opt => { pushed = opt; }});
    assert.ok(pushed, "提前注册意味着条目照样在册（首渲染时冻结，之后没机会补）");
    assert.equal(pushed.visible({dataset: {messageId: "m1"}}), false,
      "自检失败/挂载出错时，上一场会话留在旧卡上的 plan 不该让这条菜单亮起来");
  } finally { world.restore(); }
});

test("installReplayMenu：拿不到 isActive 时按不可用处理（fail-closed）", () => {
  const withPlan = {id: "m1", flags: {crucible: {metadata: {cav: {v: 1, cues: []}}}}};
  const world = stubHooksAndMessages([withPlan]);
  try {
    installReplayMenu();                           // 忘了传
    let pushed = null;
    world.fire("getChatMessageContextOptions", {}, {push: opt => { pushed = opt; }});
    assert.equal(pushed.visible({dataset: {messageId: "m1"}}), false);
  } finally { world.restore(); }
});

/* ================================================================
 * isolate 模式（2026-08-23 上机反馈补的一组）
 *
 * 玩家反馈：「不管预览哪个动画都会有个收到击打（匕首挥砍 + 出血）」。
 *
 * 原因不是 bug 而是设计——previewActionPlan 从前只替换**被预览的那一个槽**，
 * 其余三槽照常解析。而 PREVIEW_ACTION_DEFAULTS 合成的是
 * `tags:[strike,melee,slashing]` + `result:HIT` + `critical:true`，于是每次预览都附带：
 *   · travel 槽的 strike.melee  → 近战挥砍
 *   · impact 槽的 impact.layered → 结果层白闪 + 元素层血溅（物理三系共用 liquid.splash.red）
 *
 * 实战不会这样（火焰法术的元素层取火不取血），但预览时它盖在每一条规则上，
 * 人分不清哪部分是被测的那条。V2 要靠预览验收 573 条规则，这会直接毁掉验收的有效性。
 * ================================================================ */

test("isolate 默认开：计划里只有被预览那条规则的 cue", () => {
  const rule = ARMORY.travel.find(r => r.id === "strike.melee");
  assert.ok(rule, "语料变了？找不到 strike.melee");
  const plan = previewActionPlan(rule, "travel", origin(), target(), ENV, deps());
  assert.ok(plan, "强制命中后应有产出");
  const foreign = plan.cues.filter(c => c.rule !== "strike.melee");
  assert.deepEqual(foreign.map(c => `${c.slot}/${c.rule}`), [],
    "隔离模式下混进了别的槽的 cue —— 验收时会分不清哪部分是被测的那条规则");
});

test("isolate:false 恢复旧行为：其余三槽照常出 cue", () => {
  const rule = ARMORY.travel.find(r => r.id === "strike.melee");
  const plan = previewActionPlan(rule, "travel", origin(), target(), ENV, deps(), {}, {isolate: false});
  assert.ok(plan, "强制命中后应有产出");
  const foreign = plan.cues.filter(c => c.rule !== "strike.melee");
  assert.ok(foreign.length > 0,
    "isolate:false 应当保留上下文（「放在真实上下文里好不好看」也是要验的）");
  // 玩家看到的那两条正是这里来的
  assert.ok(plan.cues.some(c => c.slot === "impact" && c.rule === "impact.layered"),
    "上下文模式下 impact.layered 应当照常出现——它就是玩家说的「出血」那一层");
});

test("parsePreviewArgs 认得 isolate / context 两种写法", () => {
  assert.equal(parsePreviewArgs("isolate:false").isolate, false);
  assert.equal(parsePreviewArgs("isolate:0").isolate, false);
  assert.equal(parsePreviewArgs("isolate:true").isolate, true);
  assert.equal(parsePreviewArgs("context:true").isolate, false);
  assert.equal(parsePreviewArgs("context:false").isolate, true);
  // 没写就不覆盖，交给 runPreview 的默认值
  assert.equal(parsePreviewArgs("slot:impact").isolate, undefined);
});
