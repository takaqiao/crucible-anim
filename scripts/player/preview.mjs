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
  else { ui.notifications.warn(`未知槽位 "${slot}"，可选：${SLOTS.join(", ")}`); return; }

  let played = 0;
  const skipped = [];
  ui.notifications.info(game.i18n.localize("CANIM.Preview.Title"));

  for (const s of slots) {
    for (const rule of deps.armory[s] ?? []) {
      if (filter && !rule.id.includes(filter)) continue;
      const plan = s === "persist"
        ? previewEffectPlan(rule, target, env, deps)
        : previewActionPlan(rule, s, origin, target, env, deps);
      if (!plan) { skipped.push(`${s}/${rule.id}`); continue; }

      ui.notifications.info(`${s} / ${rule.id}`);
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
    debug(`预览宏：以下 ${skipped.length} 条规则无法用合成的通用快照强制命中（多半需要`
      + "真实施法上下文，例如法术姿态/区域数据），请在 Task 16 的真实战斗里核对：", skipped);
  }
  ui.notifications.info(`预览完成，共播放 ${played} 条`
    + (skipped.length ? `，跳过 ${skipped.length} 条（见控制台）` : ""));
}

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
export function previewActionPlan(rule, slot, origin, target, env, deps) {
  const targetActor = target.actor ?? {id: "x"};
  const action = {
    id: `__preview__.${rule.id}`, name: rule.id,
    tags: new Set(["strike", "melee", "slashing"]),
    target: {type: "single", number: 1, distance: 1, scope: 2},
    range: {minimum: 0, maximum: 1}, cost: {action: 1, focus: 0, heroism: 0, health: 0},
    region: null, actor: origin.actor ?? null, token: origin,
    targets: new Map([[targetActor, {token: target}]]),
    usage: {damageType: "slashing", isAttack: true, isRanged: false,
            strikes: [{category: "balanced1", system: {damageType: "slashing"}}]},
    eventsByTarget: new Map([[targetActor,
      {all: [], roll: [{roll: {data: {result: 7}, isCriticalSuccess: true}}]}]])
  };
  const snapshot = snapshotAction(action, env);
  const forced = {...rule, when: () => true};
  const armory = {...deps.armory, [slot]: [forced]};
  const plan = resolve(snapshot, {assets: deps.assets, armory});
  return plan?.cues?.some(c => c.rule === rule.id) ? plan : null;
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

const PREVIEW_COMMAND = "/canim-preview";

/**
 * 注册 `/canim-preview` 聊天命令与 `game.modules.get(MODULE_ID).api.preview()`。
 *
 * 聊天命令走 `mod.api.preview`（而不是直接闭包调用 `runPreview`）：两个入口——
 * 控制台/宏里的 `api.preview()` 与聊天框的 `/canim-preview`——因此永远是同一个
 * 调用点，不会出现"改了公开 API 却忘了同步改聊天命令"这种漂移；副作用是这个
 * 函数在 `mod` 是 falsy（理论上不该发生，`game.modules.get(MODULE_ID)` 在自己的
 * module.json 已加载时必然拿到对象，这里只是防御）时优雅退化成不注册聊天命令。
 */
export function installPreview(deps) {
  const mod = game.modules.get(MODULE_ID);
  const api = {preview: opts => runPreview(opts, deps)};
  if (mod) mod.api = {...(mod.api ?? {}), ...api};
  if (!mod) return;

  Hooks.on("chatMessage", (_log, message) => {
    if (typeof message !== "string" || !message.startsWith(PREVIEW_COMMAND)) return true;
    const opts = parsePreviewArgs(message.slice(PREVIEW_COMMAND.length));
    mod.api.preview(opts).catch(err => warn("预览宏执行失败", err));
    return false;                      // 吞掉这条消息，不要真的发进聊天
  });
}

/**
 * 聊天卡右键菜单加一条"重放动画"。Crucible 自带的重放条件是 `flags.vfxConfig`，
 * 本模组的计划挂在 `flags.crucible.metadata.cav`（`META_KEY`）上，原生那条菜单认不出
 * 我们的卡，必须自己注册一条。
 *
 * `condition` 与 `playFromMessage` 的播放闸门共用同一份判据（dispatch.mjs 导出的
 * `planOf`），两处各写一遍迟早漂移成"菜单出现但点了没反应"——这正是 Task 14 移交
 * 时点名要避免的坑。
 */
export function installReplayMenu() {
  Hooks.on("getChatMessageContextOptions", (_app, options) => {
    options.push({
      name: game.i18n.localize("CANIM.Replay"),
      icon: '<i class="fa-solid fa-repeat"></i>',
      condition: li => !!planOf(game.messages.get(li.dataset.messageId)),
      // 重放**不**接管 message._vfxPlayback：那个字段只服务于 CrucibleAction#confirm()
      // 的 Promise.race（推迟 postConfirm 连锁动作，models/action.mjs:2683-2686），
      // 而重放发生在 confirm 早已结束之后，没有任何东西在等它。写进去反而会污染
      // 下一次"撤销 → 重新确认"的判断——onMessageConfirmed 的闸门是"有 plan 才覆盖
      // 赋值"，重放留下的陈旧 promise 会被下一轮真实确认正常覆盖掉，谈不上污染那个
      // 方向；但反过来，如果重放发生在两次确认之间，写 _vfxPlayback 会让当时正在
      // await 它的 confirm() 提前以为动画播完了。playFromMessage 本身保持无状态、
      // 可重复调用，重放不需要也不该碰这个字段。
      callback: async li => {
        const msg = game.messages.get(li.dataset.messageId);
        if (msg) await playFromMessage(msg);
      }
    });
  });
}
