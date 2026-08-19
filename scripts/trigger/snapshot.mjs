/**
 * 把活的 CrucibleAction / ActiveEffect 压成纯数据快照。
 *
 * 快照必须能通过 JSON 往返（它要序列化进聊天卡 flag 广播给所有客户端），
 * 因此所有坐标在此固化为原始数值，不保留 token.center 之类的活引用。
 * 这一点取自 eskie-macros 的做法：先 snapshot 再入队，避免 token 中途移动导致锚点漂移。
 */

/** 两个像素矩形是否边缘相接或重叠（含斜相邻）。用于「贴身 vs 隔格」判定。 */
export function edgesIntersect(a, b) {
  const ax1 = a.x - a.w / 2, ax2 = a.x + a.w / 2;
  const ay1 = a.y - a.h / 2, ay2 = a.y + a.h / 2;
  const bx1 = b.x - b.w / 2, bx2 = b.x + b.w / 2;
  const by1 = b.y - b.h / 2, by2 = b.y + b.h / 2;
  const EPS = 1;                                  // 容忍 1px 浮点误差
  return (ax2 >= bx1 - EPS) && (bx2 >= ax1 - EPS)
      && (ay2 >= by1 - EPS) && (by2 >= ay1 - EPS);
}

/** b 是否位于 a 的左侧。用于决定武器挥击是否需要 mirrorY。 */
export function isOnLeft(a, b) {
  return b.x < a.x;
}

/** FNV-1a 32 位。与 tools/dump-fixtures.mjs 的同名函数必须行为一致。 */
export function hashSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/** 从一个 Token 对象取出快照所需的几何。 */
function tokenGeom(token, gridSize) {
  const w = (token.document?.width ?? 1) * gridSize;
  const h = (token.document?.height ?? 1) * gridSize;
  return {
    tokenId: token.id ?? null,
    uuid: token.document?.uuid ?? token.uuid ?? null,
    x: token.center?.x ?? 0, y: token.center?.y ?? 0,
    elevation: token.document?.elevation ?? 0,
    width: token.document?.width ?? 1, height: token.document?.height ?? 1,
    w, h, radiusPx: Math.max(w, h) / 2
  };
}

/**
 * @param {CrucibleAction} action
 * @param {{gridSize: number, distancePixels: number}} env
 * @returns {ActionSnapshot}
 */
export function snapshotAction(action, env) {
  const gridSize = env.gridSize;
  const origin = action.token
    ? tokenGeom(action.token, gridSize)
    : {tokenId: null, uuid: null, x: 0, y: 0, elevation: 0, width: 1, height: 1,
       w: gridSize, h: gridSize, radiusPx: gridSize / 2};

  // 提取伤害/治疗时看哪个资源，由动作自身决定：大多数打 health，但 control/illusion/oblivion/soul
  // 四个符文默认打 morale（见 crucible/module/const/spellcraft.mjs）。快照下方 usage.resource 字段
  // 就是这个值（已经在这里做过一次 "health" 兜底），不要在下面重复硬编码 "health" 再兜一遍。
  const resourceName = action.usage?.resource ?? "health";

  const targets = [];
  const byTarget = action.eventsByTarget ?? new Map();
  for (const [actor, t] of (action.targets ?? new Map())) {
    if (!t?.token) continue;
    const g = tokenGeom(t.token, gridSize);
    const group = byTarget.get(actor);
    const results = [];
    let damage = null;
    let healed = 0;
    for (const ev of (group?.roll ?? [])) {
      if (!ev?.roll?.data) continue;
      results.push({
        result: ev.roll.data.result ?? null,
        critical: ev.roll.isCriticalSuccess === true,
        strike: ev.roll.data.strike ?? null
      });
    }
    // event.resources 是 CrucibleAction#_resolveEventStream 结算后写回的最终资源增量数组：
    // [{resource, delta, damageType, restoration}]（见 crucible/module/models/action.mjs）。
    // 没有 ev.resource.health 这个字段——resources 恒为数组，需要按 resource 名过滤；按 resourceName
    // 而非硬编码 "health"，因为部分符文（control/illusion/oblivion/soul）打的是 morale。
    // 按 delta 的符号判断伤害/治疗而非 restoration 标注：delta 是结算后唯一如实反映最终发生了什么的
    // 字段，restoration 在合并场景下未必跟随最终结算结果。
    // 双持等场景对同一目标会有多条负 delta（见「双持」测试），因此伤害总量必须累加而非覆盖，与 healed
    // 保持对称。type 取伤害量最大的一条决定（视觉上应由主要伤害来源决定元素层）；量相同则取先出现的
    // 一条——用严格大于比较实现，后来者不会覆盖已记录的同量者。
    let damageMax = -Infinity;
    for (const ev of (group?.all ?? [])) {
      for (const r of (ev?.resources ?? [])) {
        if (r.resource !== resourceName) continue;
        if (r.delta < 0) {
          const amount = -r.delta;
          damage ??= {total: 0, type: null, resource: resourceName};
          damage.total += amount;
          if (amount > damageMax) {
            damageMax = amount;
            damage.type = r.damageType ?? action.usage?.damageType ?? null;
          }
        } else if (r.delta > 0) {
          healed += r.delta;
        }
      }
    }
    targets.push({
      ...g,
      adjacent: edgesIntersect(origin, g),
      onLeft: isOnLeft(origin, g),
      results, damage, healed,
      effects: (group?.all ?? []).flatMap(ev => (ev?.effects ?? []).map(e => e.statuses?.[0] ?? e._id).filter(Boolean))
    });
  }

  const spell = action.rune && action.gesture
    ? {rune: action.rune.id, gesture: action.gesture.id, inflection: action.inflection?.id ?? null}
    : null;

  const region = action.region?.shapes?.[0]
    ? {...action.region.shapes[0].toObject?.() ?? action.region.shapes[0]}
    : null;

  return {
    id: action.id, name: action.name ?? action.id,
    actorType: action.actor?.type ?? null,
    tags: [...(action.tags ?? [])],
    target: {...(action.target ?? {type: "none", number: 0, distance: 0, scope: 0})},
    range: {...(action.range ?? {minimum: 0, maximum: 0})},
    cost: {...(action.cost ?? {action: 0, focus: 0, heroism: 0, health: 0})},
    spell, region,
    strikes: (action.usage?.strikes ?? []).map(w => ({
      category: w.category ?? w.system?.category ?? null,
      damageType: w.system?.damageType ?? w.damageType ?? null
    })),
    origin, targets,
    usage: {
      damageType: action.usage?.damageType ?? null,
      isAttack: action.usage?.isAttack === true,
      isRanged: action.usage?.isRanged === true,
      skillId: action.usage?.skillId ?? null,
      resource: action.usage?.resource ?? "health"
    },
    seed: hashSeed(`${action.id}:${origin.x},${origin.y}:${targets.length}`)
  };
}

/**
 * 状态效果快照，驱动 persist 槽。
 * @param {ActiveEffect} effect
 * @param {Token} token
 * @param {{gridSize: number}} env
 * @returns {EffectSnapshot}
 */
export function snapshotEffect(effect, token, env) {
  const statusId = [...(effect.statuses ?? [])][0] ?? effect.id ?? null;
  return {
    statusId,
    effectUuid: effect.uuid ?? null,
    target: tokenGeom(token, env.gridSize),
    seed: hashSeed(`${statusId}:${effect.uuid ?? ""}`)
  };
}
