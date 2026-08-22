import {MODULE_ID, SLOTS} from "../const.mjs";
import {playPlan} from "./play.mjs";
import {snapshotAction} from "../trigger/snapshot.mjs";
import {resolve, resolveEffect} from "../resolver/resolve.mjs";
import {animationsEnabled, resolveRefIn, runPersistAnimation, planOf, playFromMessage}
  from "../trigger/dispatch.mjs";
import {debug, warn} from "../log.mjs";

const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * 逐条播放兵库里的每条规则，无需真实战斗即可过一遍所有配方。
 * 这是渲染层唯一必须人工观看的验收手段——324 条离线测试能钉住"计划构造得对不对"，
 * 钉不住"画出来是不是那么回事"，后者只能靠这个宏。
 *
 * 用法：选中一个 token（作为施法者），可选再目标一个 token，然后
 *   game.modules.get("crucible-anim").api.preview({slot: "impact"})
 * 或聊天框输入 `/canim-preview`（支持 `slot:impact filter:melee gap:800` 这样的
 * 空格分隔 key:value 参数，见 parsePreviewArgs）。
 *
 * @param {{slot?: string, filter?: string, gap?: number}} [opts]
 *   slot   只播某个槽（cast/travel/impact/aftermath/persist）；不给则全播
 *   filter 只播 rule id 含此子串的规则
 *   gap    每条之间的间隔毫秒，默认 1200
 * @param {{assets: object, armory: object}} deps
 */
async function runPreview({slot = null, filter = null, gap = 1200} = {}, deps) {
  if (!animationsEnabled()) {
    ui.notifications.warn(game.i18n.localize("CANIM.Preview.Disabled"));
    return;
  }
  const origin = canvas.tokens.controlled[0];
  if (!origin) { ui.notifications.warn(game.i18n.localize("CANIM.Preview.NoToken")); return; }
  const target = [...game.user.targets][0] ?? origin;
  const env = {gridSize: canvas.dimensions.size, distancePixels: canvas.dimensions.distancePixels};
  const resolveRef = resolveRefIn(canvas.scene);

  let slots;
  if (slot === null) slots = SLOTS;
  else if (SLOTS.includes(slot)) slots = [slot];
  else {
    const slots = SLOTS.join(", ");
    ui.notifications.warn(game.i18n.format("CANIM.Preview.UnknownSlot", {slot, slots}));
    return;
  }

  let played = 0;
  const skipped = [];
  ui.notifications.info(game.i18n.localize("CANIM.Preview.Title"));

  for (const s of slots) {
    for (const rule of deps.armory[s] ?? []) {
      if (filter && !rule.id.includes(filter)) continue;
      const key = `${s}/${rule.id}`;
      // fixture 只盖掉默认快照满足不了的那几条守卫，其余规则照旧吃默认的近战快照。
      const plan = s === "persist"
        ? previewEffectPlan(rule, target, env, deps)
        : previewActionPlan(rule, s, origin, target, env, deps, PREVIEW_FIXTURES[key] ?? {});
      if (!plan) { skipped.push(key); continue; }

      ui.notifications.info(game.i18n.format("CANIM.Preview.Playing", {slot: s, rule: rule.id}));
      if (s === "persist") {
        // 走 runPersistAnimation 而不是裸 playPlan：这是持久特效唯一的播放通道
        // （Task 14 的 Critical-2），预览也不例外——playPlan() 对带 persist cue 的
        // 计划只 await 到序列交给 Sequencer 为止，直接调它虽然不会挂住（这一点已经
        // 在 play.mjs 里改过），但绕开 runPersistAnimation 会破坏"新增播放点只有
        // 一条入口"这个约束，未来这条通道再长出新逻辑（比如真的排队让路）预览宏会
        // 悄悄漏掉。
        await runPersistAnimation(`预览 ${rule.id}`, () =>
          playPlan(plan, {volume: 0.5, shake: true, resolveRef}));
      } else {
        await playPlan(plan, {volume: 0.5, shake: true, resolveRef});
      }
      played++;
      await sleep(gap);
      // persist 预览必须自己收尾：previewEffectPlan 把 tieTo 钉在目标 token 的 uuid
      // 上（真实状态没有这个问题，tieTo 是 ActiveEffect uuid，随状态被移除自动清理），
      // 不主动清理的话，一次跑完 12 组状态会在目标身上叠 12 圈永久光环，只能靠
      // Sequencer.EffectManager.endAllEffects() 手工收拾。
      if (s === "persist") cleanupPersistPreview(plan);
    }
  }

  if (skipped.length) {
    // 跳过的应当**只有** ALWAYS_SILENT 里那四条「设计上就没有画面」的规则；出现别的
    // id 就说明有规则缺 fixture（test/preview.test.mjs 的覆盖率守卫会先在 CI 里变红）。
    debug(`预览宏：以下 ${skipped.length} 条规则没有产出画面。设计上恒空的是 `
      + `${ALWAYS_SILENT.join(", ")}；除此以外的条目说明缺一份 PREVIEW_FIXTURES：`, skipped);
  }
  ui.notifications.info(skipped.length
    ? game.i18n.format("CANIM.Preview.DoneSkipped", {played, skipped: skipped.length})
    : game.i18n.format("CANIM.Preview.Done", {played}));
}

/**
 * 预览用的模板几何。数值与 tools/dump-fixtures.mjs 的 `TARGET_REGION` 逐字段相同
 * （test/preview.test.mjs 有一条交叉断言把两张表钉在一起），而那张表的 `angle` 又由
 * test/source-tables.test.mjs 直接解析 crucible/module/const/action.mjs 的
 * `TARGET_TYPES.<key>.region.angle` 核对。字段名与坐标约定见 armory/travel.mjs 顶部：
 * cone = {x, y, radius, angle, rotation}（x/y 是**锥尖**），
 * line = {x, y, length, width, rotation}（x/y 是**线首**），rotation 单位是度。
 *
 * 这里不能直接 import tools/dump-fixtures.mjs：那是开发期工具，import 了 node:fs 与
 * classic-level，进不了浏览器运行时。
 */
const PREVIEW_REGION = Object.freeze({
  cone: Object.freeze({type: "cone", x: 500, y: 500, radius: 300, angle: 60, rotation: 0}),
  ray: Object.freeze({type: "line", x: 500, y: 500, length: 400, width: 100, rotation: 0})
});

/**
 * 合成动作的默认形状：近战挥砍 + 暴击 + 单个相邻目标。
 * 这就是 Task 15 交付时唯一存在的那一份快照，也正是「28/39，缺 11 条」的成因——
 * 一条写死的近战快照满足不了 12 条规则各自的 `build()` 守卫。
 */
const PREVIEW_ACTION_DEFAULTS = Object.freeze({
  tags: ["strike", "melee", "slashing"],
  targetType: "single",
  isAttack: true, isRanged: false,
  resource: "health", damageType: "slashing",
  strikeCategory: "balanced1",
  rune: "control", gesture: null,
  region: null,
  damage: 0, healed: 0, effects: [],
  result: 7, critical: true
});

/**
 * 把一份 fixture 展开成一个**合法的** CrucibleAction 形状，再交给真正的
 * `snapshotAction()` 压成快照。
 *
 * 为什么覆盖动作而不是直接覆盖快照：直接改快照可以捏出任何字段组合，包括
 * `snapshotAction()` 永远产不出来的组合——那样预览成功了，实战里那条规则照样不出画面，
 * 正是本项目栽过三次的「假成功」。经动作层进去，`healed`/`damage`/`effects` 必须真的
 * 由事件流推导出来（下面的 `all` 数组），形状对不上就会诚实地落空。
 *
 * 事件流形状取自 crucible 源码，不是编的：
 *   · `event.resources` 是结算后写回的 `[{resource, delta, damageType, restoration}]`
 *     （trigger/snapshot.mjs 的 snapshotAction 按 `resource` 名过滤、按 `delta` 符号
 *     分伤害/治疗）；
 *   · `event.effects` 是 ActiveEffectData 列表，`statuses` 是字符串数组
 *     （crucible/module/const/effects.mjs 的 5 个生成器，如 :46 `statuses: ["bleeding"]`；
 *     models/action.mjs:2890 也是 `statuses: [id]`），由 statusIdOf 取首项。
 *
 * @param {object} rule
 * @param {Token} origin
 * @param {Token} target
 * @param {object} fixture  见 PREVIEW_ACTION_DEFAULTS 的键
 */
function syntheticAction(rule, origin, target, fixture) {
  const f = {...PREVIEW_ACTION_DEFAULTS, ...fixture};
  const targetActor = target.actor ?? {id: "x"};

  const resources = [];
  if (f.damage > 0) resources.push({resource: f.resource, delta: -f.damage, damageType: f.damageType});
  if (f.healed > 0) resources.push({resource: f.resource, delta: f.healed});
  const all = [];
  if (resources.length) all.push({resources});
  if (f.effects.length) all.push({effects: f.effects.map(id => ({statuses: [id]}))});

  return {
    id: `__preview__.${rule.id}`, name: rule.id,
    tags: new Set(f.tags),
    target: {type: f.targetType, number: 1, distance: 1, scope: 2},
    range: {minimum: 0, maximum: 1}, cost: {action: 1, focus: 0, heroism: 0, health: 0},
    // snapshotAction 读的是 action.region.shapes[0]（CrucibleAction 的 region 是一个
    // RegionDocument 形状的容器），不是裸 shape。
    region: f.region ? {shapes: [f.region]} : null,
    // 同理，snapshot.spell 只有在 action.rune 与 action.gesture **都**非空时才成形。
    rune: f.gesture ? {id: f.rune} : null,
    gesture: f.gesture ? {id: f.gesture} : null,
    actor: origin.actor ?? null, token: origin,
    targets: new Map([[targetActor, {token: target}]]),
    usage: {damageType: f.damageType, isAttack: f.isAttack, isRanged: f.isRanged,
            resource: f.resource,
            strikes: [{category: f.strikeCategory, system: {damageType: f.damageType}}]},
    eventsByTarget: new Map([[targetActor,
      {all, roll: [{roll: {data: {result: f.result}, isCriticalSuccess: f.critical}}]}]])
  };
}

/**
 * 每条「默认快照打不到」的规则各配一份 fixture，键是 `<slot>/<rule.id>`。
 *
 * 每一份要什么都能从规则自己的 `build()` 守卫直接读出来，不存在猜测成分：
 *   cast/generic.cast          `if (s.usage.isAttack && s.targets.length) return null`
 *   travel/spell.gesture.ray   `templateEnd(s.region)`（line 的 x/y/length）
 *   travel/spell.gesture.cone  `templateEnd(s.region)` + `coneYScale(s.region.angle)`
 *   travel/generic.travel      `if (!s.usage.isRanged) return null`
 *   aftermath/aftermath.healing    `if (!(target?.healed > 0)) return null`
 *   aftermath/aftermath.kill       `if (!target?.effects?.includes("dead")) return null`
 *   aftermath/aftermath.morale     `if (!target?.damage) return null`（且 damage 只在
 *                                   `r.resource === usage.resource` 时才成形）
 *   aftermath/aftermath.groundResidue  `residueAnchor(s)`（cone 或 circle 区域）
 *
 * 顺带把 `when()` 真正要的条件也一起给上（gesture/targetType/tags/resource）：预览虽然
 * 强制 `when: () => true`，但让 fixture 同时满足 when 才对得起「这份快照代表的是这条
 * 规则真实会遇到的局面」，也让将来把守卫从 build 挪到 when（或反过来）不会悄悄失效。
 *
 * test/preview.test.mjs 的「全兵库预览覆盖」会遍历整张兵库断言除 ALWAYS_SILENT 之外
 * 每条规则都预览得出自己的 cue——新增规则漏配 fixture 会直接变红。
 */
export const PREVIEW_FIXTURES = Object.freeze({
  "cast/generic.cast": Object.freeze({isAttack: false, tags: ["movement"]}),
  "travel/spell.gesture.ray": Object.freeze({
    gesture: "ray", targetType: "ray", region: PREVIEW_REGION.ray, tags: ["spell"]
  }),
  "travel/spell.gesture.cone": Object.freeze({
    gesture: "cone", targetType: "cone", region: PREVIEW_REGION.cone, tags: ["spell"]
  }),
  "travel/generic.travel": Object.freeze({
    isRanged: true, tags: ["strike", "ranged", "piercing"],
    damageType: "piercing", strikeCategory: "projectile1"
  }),
  "aftermath/aftermath.healing": Object.freeze({
    isAttack: false, tags: ["healing"], healed: 6
  }),
  "aftermath/aftermath.kill": Object.freeze({damage: 12, effects: ["dead"]}),
  "aftermath/aftermath.morale": Object.freeze({resource: "morale", damage: 6}),
  "aftermath/aftermath.groundResidue": Object.freeze({
    gesture: "cone", targetType: "cone", region: PREVIEW_REGION.cone, tags: ["spell"]
  })
});

/**
 * 「按设计就该没有画面」的规则——`build()` **无条件**返回 null，不是被快照缺字段卡住的。
 * 给它们配 fixture 没有意义，预览里返回 null 就是正确行为。
 *
 * 【与修复简报的偏差，已逐条核对源码】简报 F 的缺口表把 `cast/strike.melee.heavy`、
 * `travel/target.blast`、`aftermath/generic.aftermath` 三条也列成「快照多样性不够」，
 * 并给出了对应的快照要求。实际读源码：这三条的分类条件都写在 `when()` 里，`build()`
 * 一律是 `build: () => null`（armory/cast.mjs:157-161、armory/travel.mjs:479-483、
 * armory/aftermath.mjs:181-185），三处的注释也各自写明了为什么「就该不出内容」
 * （重武器蓄力感交给 travel 段的挥击弧线；blast 没有飞行段、全交给 impact；aftermath
 * 兜底允许"这个动作没有 S4 内容"）。所以任何 fixture 都不可能让它们产出 cue——
 * 它们与 `persist/status.silent` 是同一类，列进这张豁免表而不是缺口表。
 *
 * 豁免不是免检：覆盖率守卫会拿**每一份** fixture 轮流喂给这四条规则，断言它们在任何
 * 一份下都仍然为空——否则说明某条其实是能出画面的，得从这张表里挪走。
 */
export const ALWAYS_SILENT = Object.freeze([
  "cast/strike.melee.heavy",
  "travel/target.blast",
  "aftermath/generic.aftermath",
  "persist/status.silent"
]);

/**
 * 用一条合成快照强制命中指定规则：把该槽的兵库临时替换成只含这一条规则，并把它的
 * `when()` 强制改成恒真——单独把候选收窄到一条并不够，travel/cast 里不少规则按
 * `spell.gesture`/tags 精确匹配，通用的近战突刺快照未必满足，那样会让 firstMatch
 * 在这一槽上直接判负，其余三槽仍会各自选出自己的常规规则，拼出一份看起来正常、
 * 实际上根本不含被预览规则那条 cue 的计划——通知上写的是这条规则的 id，画面播的却是
 * 别的东西，比"什么都不播"更容易骗过人工验收。
 *
 * 强制命中之后仍然过一遍 `plan.cues.some(c => c.rule === rule.id)`：`build()` 可能
 * 因为读不到快照没有的字段（`s.spell`/`s.region` 等）而抛错，被 resolve.mjs 的
 * runBuild 接住降级成 0 条 cue——这种情况下同样不能算"预览成功"，返回 null 交给
 * 调用方跳过并留痕，而不是让另外三槽的常规产出冒充这条规则的预览结果。
 *
 * @param {object} rule
 * @param {string} slot
 * @param {Token} origin  施法者 token placeable
 * @param {Token} target  目标 token placeable
 * @param {{gridSize: number, distancePixels: number}} env
 * @param {{assets: object, armory: object}} deps
 * @returns {FXPlan|null}
 */
export function previewActionPlan(rule, slot, origin, target, env, deps, fixture = {}) {
  const snapshot = snapshotAction(syntheticAction(rule, origin, target, fixture), env);
  const forced = {...rule, when: () => true};
  const armory = {...deps.armory, [slot]: [forced]};
  const plan = resolve(snapshot, {assets: deps.assets, armory});
  // 判据带上 slot：规则 id 目前在五个槽之间不重名，但「另一个槽里恰好同名的规则替它
  // 出场」正是本模组反复栽过的那类假成功，加一个字段的代价换掉整类误判。
  return plan?.cues?.some(c => c.rule === rule.id && c.slot === slot) ? plan : null;
}

/**
 * persist 槽的预览版本，同样强制 `when()` 恒真（12 个分组的 when 精确按 statusId
 * 等值匹配，合成的 `__preview__.<rule.id>` 永远不会等于任何真实状态名，不强制的话
 * 12 组会全部落空——见交接约束 (5)）。
 *
 * `effectUuid` 钉在目标 token 自己的 uuid 上，而不是 null：resolveEffect() 末尾的
 * keepTied() 会把 `persist:true` 但 `tieTo` 为空的 cue 直接丢弃（宁可这次没有状态
 * 标记也不留一枚清不掉的光，见 resolve.mjs 的注释），传 null 会让 12 组预览全部
 * 拿到空计划。用目标 token 的 uuid 是唯一在预览语境下现成、真实存在、Sequencer
 * 确实能 `fromUuidSync` 解析出来的 tieTo 候选——`tieToDocuments` 因此能正常注册
 * delete 钩子，即便这次没有主动清理，token 被删掉时光环也不会永久残留。
 * @param {object} rule
 * @param {Token} target
 * @param {{gridSize: number}} env
 * @param {{assets: object, armory: object}} deps
 * @returns {FXPlan|null}
 */
export function previewEffectPlan(rule, target, env, deps) {
  const snapshot = {
    statusId: `__preview__.${rule.id}`,
    effectUuid: target.document.uuid,
    target: {tokenId: target.id, uuid: target.document.uuid,
             x: target.center.x, y: target.center.y, elevation: 0,
             width: 1, height: 1, w: env.gridSize, h: env.gridSize, radiusPx: env.gridSize / 2},
    seed: 1
  };
  const forced = {...rule, when: () => true};
  const plan = resolveEffect(snapshot, {assets: deps.assets, armory: {...deps.armory, persist: [forced]}});
  return plan?.cues?.some(c => c.rule === rule.id) ? plan : null;
}

/** 收尾一份 persist 预览。origin 是 previewEffectPlan 钉在目标 token uuid 上的 tieTo。 */
function cleanupPersistPreview(plan) {
  const origin = plan?.cues?.[0]?.tieTo;
  if (!origin) return;
  // 同 effects.mjs 的 endPersist：endEffects 是 static async，同步 try/catch 接不住
  // 异步体内的失败，必须用 .catch()；外面套 Promise.resolve().then() 顺带接住
  // Sequencer 全局缺失时的同步 TypeError。
  Promise.resolve()
    .then(() => Sequencer.EffectManager.endEffects({origin}, false))
    .catch(err => warn(`清理预览持续特效失败：${origin}`, err));
}

/**
 * `/canim-preview` 的极简参数语法：空格分隔的 `key:value`（`=` 也认），故意不用
 * `{slot:"impact"}` 这种 JS 字面量——那需要一个 `eval`/`new Function` 来解析，
 * 聊天框里输入意外的花括号/引号很容易崩成语法错误又看不到堆栈。纯函数，方便单测。
 * @param {string} rest  命令名之后的剩余文本
 * @returns {{slot?: string, filter?: string, gap?: number}}
 */
export function parsePreviewArgs(rest) {
  const opts = {};
  for (const token of String(rest ?? "").trim().split(/\s+/).filter(Boolean)) {
    const i = token.search(/[:=]/);
    if (i < 0) continue;
    const key = token.slice(0, i);
    const value = token.slice(i + 1);
    if (key === "slot") opts.slot = value;
    else if (key === "filter") opts.filter = value;
    else if (key === "gap") { const n = Number(value); if (Number.isFinite(n)) opts.gap = n; }
  }
  return opts;
}

/** CHAT_COMMANDS 注册表里的键名。与核心自带的键（roll/ooc/ic/gm/whisper/macro…）不撞。 */
export const PREVIEW_COMMAND_KEY = "canim-preview";

/**
 * `/canim-preview` 的匹配式。
 *
 * **匹配的对象是 HTML，不是纯文本**：v14 的聊天输入是 ProseMirror，`processMessage()`
 * 收到并原样转发给 `chatMessage` 钩子的是 `"<p>/canim-preview slot:persist</p>"`
 * （foundry client/applications/sidebar/tabs/chat.mjs:871 的
 * `Hooks.call("chatMessage", this, message, chatData)`）。这正是 Task 15 交付版
 * 用 `message.startsWith("/canim-preview")` 永远判负、命令一次都没触发过的原因。
 *
 * 核心自己在 `ChatLog.parse()` 里已经剥好了：非 `isRoll` 的命令匹配的是
 * `const html = message.replace(/^<p>|<\/p>$/gi, "")`（chat.mjs:812、820-826），
 * 所以这里按「已剥掉最外层 `<p>`」来写，**不要**自己再剥一遍 HTML。
 * 第 1 个捕获组是命令名之后的剩余文本，交给 parsePreviewArgs。
 */
export const PREVIEW_COMMAND_RGX = /^\/canim-preview(?:\s+([^]*?))?\s*$/i;

/**
 * 在 `init` 注册 `/canim-preview` 聊天命令。
 *
 * 时机：`ChatLog.parse()` 在用户按下回车那一刻才读 `CHAT_COMMANDS`，但注册本身必须
 * 早于第一次解析，而且 `CHAT_COMMANDS` 是 ChatLog 的**静态**字段、任何时候写都生效，
 * 所以放 `init` 最省心（与 A 组的另外两个钩子同批）。
 *
 * 为什么用注册表而不是 `chatMessage` 钩子：见 PREVIEW_COMMAND_RGX 的注释。
 * `fn` 的签名是 `(command, match, chatData, createOptions)`、以 ChatLog 为 this，
 * **返回 `false` 阻止消息发出**（chat.mjs:884-888 的
 * `const result = await fn?.call(...); if (result === false) return;`，
 * 与核心自己的 `macroCommand` 同一手法，chat.mjs:89-92）。
 *
 * 仍然经 `mod.api.preview` 转发而不是直接闭包调 `runPreview`：两个入口——控制台/宏里的
 * `api.preview()` 与聊天框的 `/canim-preview`——因此永远是同一个调用点，不会出现
 * "改了公开 API 却忘了同步改聊天命令"这种漂移。这条转发顺带就是 A 组要求的短路：
 * `api.preview` 只在 `installPreview()`（ready，且五次挂载全部成功）之后才存在，
 * 模组被自检禁用时拿不到它，于是给一条提示并照样吞掉这条消息——总比让核心抛
 * "Invalid command" 强。
 */
export function installPreviewCommand() {
  const ChatLog = foundry?.applications?.sidebar?.tabs?.ChatLog;
  if (!ChatLog?.CHAT_COMMANDS) {
    warn("ChatLog.CHAT_COMMANDS 不可用，/canim-preview 聊天命令未注册（api.preview 不受影响）");
    return false;
  }
  ChatLog.CHAT_COMMANDS[PREVIEW_COMMAND_KEY] = {
    rgx: PREVIEW_COMMAND_RGX,
    fn: (_command, match) => {
      const preview = game.modules.get(MODULE_ID)?.api?.preview;
      if (typeof preview !== "function") {
        ui.notifications.warn(game.i18n.localize("CANIM.Preview.Unavailable"));
        return false;
      }
      preview(parsePreviewArgs(match?.[1] ?? "")).catch(err => warn("预览宏执行失败", err));
      return false;                    // 吞掉这条消息，不要真的发进聊天
    }
  };
  return true;
}

/**
 * 在 `ready` 把 `preview()` 挂到 `game.modules.get(MODULE_ID).api` 上。
 *
 * `mod` 是 falsy（理论上不该发生，`game.modules.get(MODULE_ID)` 在自己的 module.json
 * 已加载时必然拿到对象，这里只是防御）时优雅退化成什么都不做——聊天命令那侧会因此
 * 拿不到 api.preview 而给出提示。
 */
export function installPreview(deps) {
  const mod = game.modules.get(MODULE_ID);
  if (!mod) return;
  mod.api = {...(mod.api ?? {}), preview: opts => runPreview(opts, deps)};
}

/**
 * 聊天卡右键菜单加一条"重放动画"。Crucible 自带的重放条件是 `flags.vfxConfig`，
 * 本模组的计划挂在 `flags.crucible.metadata.cav`（`META_KEY`）上，原生那条菜单认不出
 * 我们的卡，必须自己注册一条。
 *
 * **必须在 `init` 注册**（A 组）：`getChatMessageContextOptions` 不是每次右键都广播的
 * 钩子，它只在 ChatLog **首次渲染**时派发一次，返回的数组当场就被冻进 ContextMenu 实例：
 *   · chat.mjs:397-403 `this._createContextMenu(this._getEntryContextOptions, …,
 *     {hookName: "getChatMessageContextOptions", …})`，位于 `async _onFirstRender`；
 *   · application.mjs:2231-2235 `const menuItems = this._doEvent(handler, {hookName,
 *     hookResponse: true});` 紧接着 `new ContextMenu.implementation(container, selector,
 *     menuItems, …)`；
 *   · context-menu.mjs:99 `this.menuItems = menuItems;`——此后只重新求值每条的
 *     `visible`，**从不重新征集条目**。
 * 而首渲染发生在 `game.initializeUI()`（game.mjs:764，未 await）里，`Hooks.callAll("ready")`
 * （game.mjs:779）之前还隔着 `await documentIndex.index()` 与 `await canvas.initializing`
 * （整场景绘制）。在 `ready` 里注册 = 永远赶不上。对照组：Crucible 自己在模块顶层就注册
 * 同一个钩子（crucible-compiled.mjs:48790）。
 * 指纹：停靠的聊天栏右键没有「重放动画」，把聊天栏弹成独立窗口后反而有——
 * `sidebar-tab.mjs:152 renderPopout` 造的是新实例，会重走 `_onFirstRender`。
 *
 * 提前注册是安全的：回调体只在**菜单渲染时**才碰 `game.i18n`/`game.messages`/`planOf`，
 * 注册那一刻不读任何依赖。
 *
 * `visible` 与 `playFromMessage` 的播放闸门共用同一份判据（dispatch.mjs 导出的
 * `planOf`），两处各写一遍迟早漂移成"菜单出现但点了没反应"——这正是 Task 14 移交
 * 时点名要避免的坑。再叠一道 `isActive()`：提前注册意味着自检失败/挂载抛错时这条菜单
 * 项照样在册，而上一场会话留在旧聊天卡上的 plan 会让 `planOf` 判真——那样点下去只会
 * 走进一个半装配的模组。拿不到 `isActive` 时按**不可用**处理（fail-closed）。
 *
 * @param {() => boolean} isActive  main.mjs 的 `state.active` 读取器
 */
export function installReplayMenu(isActive) {
  const active = typeof isActive === "function" ? isActive : () => false;
  Hooks.on("getChatMessageContextOptions", (_app, options) => {
    options.push({
      label: game.i18n.localize("CANIM.Replay"),
      icon: '<i class="fa-solid fa-repeat"></i>',
      visible: li => active() && !!planOf(game.messages.get(li.dataset.messageId)),
      // 重放**不**接管 message._vfxPlayback：那个字段只服务于 CrucibleAction#confirm()
      // 的 Promise.race（推迟 postConfirm 连锁动作，models/action.mjs:2683-2686），
      // 而重放发生在 confirm 早已结束之后，没有任何东西在等它。写进去反而会污染
      // 下一次"撤销 → 重新确认"的判断——onMessageConfirmed 的闸门是"有 plan 才覆盖
      // 赋值"，重放留下的陈旧 promise 会被下一轮真实确认正常覆盖掉，谈不上污染那个
      // 方向；但反过来，如果重放发生在两次确认之间，写 _vfxPlayback 会让当时正在
      // await 它的 confirm() 提前以为动画播完了。playFromMessage 本身保持无状态、
      // 可重复调用，重放不需要也不该碰这个字段。
      onClick: async (_event, li) => {
        const msg = game.messages.get(li.dataset.messageId);
        if (msg) await playFromMessage(msg);
      }
    });
  });
}
