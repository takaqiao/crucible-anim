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

/**
 * Crucible 的 5 个 DoT generator 返回的 ActiveEffectData **没有 `statuses` 字段**：
 * `crucible/module/const/effects.mjs` 的 corroding / decay / irradiated / mending /
 * inspired（实测解析该文件的 18 个 export function，只有这 5 个缺 statuses）。
 *
 * 只有从 token HUD 或 `actor.toggleStatusEffect()` 走 core 的
 * `ActiveEffect.fromStatusEffect()` 时，core 先写好 `statuses:[id]`，Crucible 的
 * `_fromStatusEffect` 再 `mergeObject(effectData, generated, {overwrite:true})`——因为
 * generator 没给 statuses，这个键才得以幸存。战斗里走的是另一条路：talent/action 钩子
 * `event.effects.push(SYSTEM.EFFECTS.corroding(...))`，经 `actor#_applyActionEffects`
 * 原样 createEmbeddedDocuments，statuses 全程为空。落地的 ActiveEffect 于是不带任何
 * 状态，statusId 退化成 `effect.id`——也就是 generator 里写死的
 * `_id: getEffectId("Corroding")`，即 crucible 的 generateId 把标签截到 16 位再用 "0"
 * 补齐得到的 "corroding0000000"。不翻译的话这 5 个状态在战斗路径上会全部掉进
 * generic.persist 兜底，播一颗无 tint 的白泡。
 *
 * 这张表把那 5 个固定 _id 翻回规范状态 id。两侧都由 test/source-tables.test.mjs 解析
 * Crucible 源码核对，不是手抄——源码给某个 generator 补上 statuses、或者改掉 _id 的
 * 标签，那条守卫会先红。
 */
export const GENERATED_EFFECT_STATUS = {
  corroding0000000: "corroding",
  decaying00000000: "decaying",
  irradiated000000: "irradiated",
  mending000000000: "mending",
  inspired00000000: "inspired"
};

/**
 * 从一个 ActiveEffect 文档（`statuses` 是 Set）或一条 ActionEffect 原始数据
 * （`statuses` 是数组、id 在 `_id` 上）取规范状态 id。
 *
 * 优先取 `statuses[0]`：那是效果**实际**赋予的状态，即使与它的来源状态 id 不同也一样
 * ——entropy 的 generator 产出 `statuses:["frightened"]`，取到 frightened 才是对的，
 * 强行还原成 entropy 反而会让画面与角色身上真正挂着的状态对不上。
 * statuses 为空时过一遍 GENERATED_EFFECT_STATUS（战斗直调落地的 5 个 DoT 效果不带
 * statuses，只剩 generator 写死的 16 位补零 _id）；表外的 _id **不是状态**，返回 null。
 *
 * 这里绝不能原样放行裸 _id：真实 ActiveEffect 文档的 id 永远非空，放行等于让
 * planForEffect 的 `if (!snapshot?.statusId) return null` 这道闸对所有非状态效果失效，
 * 而 armory/persist.mjs 的 generic.persist 是 `when: () => true`——每一个纯记账/纯增益的
 * ActiveEffect 都会挂上一圈 jb2a inflow 白环。Crucible 里这类效果是常态不是边缘：
 *   hooks/action.mjs:112     Amplify Affix 标记（getEffectId("Amplify Affix")，无 statuses）
 *   models/action.mjs:1916   所有 gesture 的通用法术效果（regionEffectRequired）
 *   hooks/spellcraft.mjs:45  aspect 抗性增益 / :149 senseCreature
 *   hooks/talent.mjs:376     Dominance 标记
 * 外加 GM 手搓效果与其它模组建的效果。
 *
 * 「将来 Crucible 新增状态就没人兜底了」这个担心不成立：新状态一定带 statuses（走
 * 生成器或 core 的 _fromStatusEffect），仍会命中 generic.persist；而新增的**无 statuses**
 * DoT generator 会让 test/source-tables.test.mjs 的
 * 「GENERATED_EFFECT_STATUS 与 const/effects.mjs 的 generator 产出一致」先变红、强制补表。
 *
 * @param {ActiveEffect|{statuses?: string[]|Set<string>, _id?: string, id?: string}} effect
 * @returns {string|null}
 */
export function statusIdOf(effect) {
  if (!effect) return null;
  const first = [...(effect.statuses ?? [])][0];
  if (first) return first;
  const id = effect.id ?? effect._id ?? null;
  return id ? (GENERATED_EFFECT_STATUS[id] ?? null) : null;
}

/**
 * 从一个 Token 取出快照所需的几何。**两种形状都要吃**，因为两条调用路径交出来的
 * 东西根本不是同一类对象：
 *
 *   · 动作路径（trigger/wrap.mjs → snapshotAction）拿到的是 **TokenDocument**。
 *     `CrucibleAction#token` 与 `action.targets.get(actor).token` 都是文档而不是
 *     placeable：`CrucibleAction.#getTargetFromToken`（crucible/module/models/
 *     action.mjs:1541-1545）显式 `if (token instanceof Token) token = token.document`
 *     之后才写进 targets；action.mjs:1719 的注释也把这件事写死了——「`token` is a
 *     placeable from game.user.targets while this.token is a TokenDocument」。
 *   · 状态路径（trigger/effects.mjs → snapshotEffect）拿到的是 **Token placeable**：
 *     `Actor#getActiveTokens(linked=false, document=false)`（foundry client/documents/
 *     actor.mjs:286-296）在 document 为假时 push 的是 `t.object`。
 *
 * TokenDocument 上**没有** `center` 取值器，也没有 `.document`（全 foundry 源码
 * `get center()` 只出现在 placeable / 形状类：canvas/placeables/{region,drawing}.mjs、
 * placeables/mixins/shapes.mjs、containers/elements/door-control.mjs、data/shapes.mjs；
 * `get document()` 只出现在 6 个 Application / 控件类上，没有一个是 Document）。
 * 于是 `token.document ?? token` 是一句能同时归一化两种形状的安全写法：placeable 归到
 * 它的 TokenDocument，TokenDocument 原样返回自身。归一化之后**只读文档 API**，
 * 与 Crucible 自己的两个 VFX 配置器同源（canvas/vfx/landing.mjs:20-24 的
 * `token.getCenterPoint()` / `token.width`，canvas/vfx/helpers.mjs:41-44 的 tokenCenter）。
 *
 * 中心点与像素尺寸走文档自己的方法而不是 `x + width*gridSize/2` 手算：
 *   · `BaseToken#getCenterPoint(data={})`（foundry common/documents/token.mjs:506-530）
 *     返回 `{x, y, elevation}`，且是唯一处理六边形 token 形状的地方；placeable 的
 *     `get center()`（client/canvas/placeables/token.mjs:448-451）本身就是转调它。
 *   · `BaseToken#getSize(data={})`（common/documents/token.mjs:481-494）返回**像素**
 *     宽高，六边形网格下会把宽（或高）折算成 `0.75*floor(n) + 0.5*(n%1) + 0.25` 再
 *     乘 `grid.sizeX/sizeY`；placeable 的 `get w()/get h()`（client/canvas/placeables/
 *     token.mjs:431-433 / 441-443）同样只是转调它。
 * 两者都取不到（纯数据 mock、或将来 foundry 改名）时才退回 `gridSize` 手算，
 * 与 helpers.mjs:41-44 同式，保证快照永远出得来。
 *
 * @param {TokenDocument|Token|null} token
 * @param {number} gridSize
 */
function tokenGeom(token, gridSize) {
  const doc = token?.document ?? token ?? null;   // placeable → TokenDocument；文档原样
  const width = doc?.width ?? 1;                  // 格数（schema 字段），不是像素
  const height = doc?.height ?? 1;

  const size = typeof doc?.getSize === "function" ? doc.getSize() : null;
  const w = Number.isFinite(size?.width) ? size.width : width * gridSize;
  const h = Number.isFinite(size?.height) ? size.height : height * gridSize;

  const center = typeof doc?.getCenterPoint === "function" ? doc.getCenterPoint() : null;
  const x = Number.isFinite(center?.x) ? center.x : (doc?.x ?? 0) + w / 2;
  const y = Number.isFinite(center?.y) ? center.y : (doc?.y ?? 0) + h / 2;

  return {
    tokenId: doc?.id ?? null,
    uuid: doc?.uuid ?? null,
    x, y,
    elevation: doc?.elevation ?? 0,
    width, height,
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
      effects: (group?.all ?? []).flatMap(ev => (ev?.effects ?? []).map(statusIdOf).filter(Boolean))
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
    /**
     * 这一击用的武器。**`identifier` 是武器派发键**，逐条读源码定的——三个候选里
     * 只有它在「装到角色身上」之后还活着：
     *
     *   · `_id`：官方 pack 里是语义 slug（`dagger0000000000`），但那是
     *     `standardizeItemIds()`（crucible-compiled.mjs:48925）给**世界物品**做的规范化；
     *     角色身上的嵌入物品不走它，实测 pregens 里的匕首是 `U0pzlydffRGomINf`；
     *   · `_stats.compendiumSource`：pack 里与角色身上**都是 null**；
     *   · `system.identifier`：两边都是 `dagger`。✓
     *
     * 它还不是显示名，所以 Babele / crucible-cn 把名字译成「匕首 Dagger」也动不到它——
     * 按名字派发在本项目是已知会坏的路子。
     *
     * 不保证语义：`ItemIdentifierField` 默认值是 `randomID(10)`（23881），pack 作者
     * 没填时会留下 `G63t1Pjsjr` 这种串。不检测——派发表里查不到就落回 category 级联。
     *
     * `properties` 决定形态修正（versatile 双持 / oversized 更大 / thrown 可投 /
     * natural 天生武器不该出金属刀光）。排序后写入：快照要能逐字复现。
     */
    strikes: (action.usage?.strikes ?? []).map(w => ({
      identifier: w.system?.identifier ?? w.identifier ?? null,
      category: w.category ?? w.system?.category ?? null,
      damageType: w.system?.damageType ?? w.damageType ?? null,
      properties: [...(w.system?.properties ?? w.properties ?? [])].sort()
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
 *
 * 没有 token 时返回 null，而**不是**照搬 snapshotAction 的 (0,0) 兜底几何：动作特效
 * 退化到原点只是画错位置，持续标记退化到原点是在地图左上角挂一枚绑着不存在 token
 * 的光环（cue 带 attachTo:true，附着目标解析不到）。ActiveEffect 挂在当前场景没有
 * token 的 actor 上——离场角色、跨场景、未链接 token 尚未渲染——是完全正常的情形，
 * 正确答案是「不画」，交由调用方按 null 处理。
 *
 * statusId 走 statusIdOf（见其注释）：战斗直调落地的 DoT 效果不带 statuses，裸取
 * `effect.id` 会得到 16 位补零 _id 而不是状态名。
 *
 * effectUuid 保持 `?? null` 的如实记录，不在这里替它编一个：能不能凭它清理动画是
 * resolveEffect 的判断（见 resolver/resolve.mjs 的 keepTied），快照层只负责转写。
 *
 * @param {ActiveEffect} effect
 * @param {Token|null} token
 * @param {{gridSize: number}} env
 * @returns {EffectSnapshot|null}
 */
export function snapshotEffect(effect, token, env) {
  if (!token) return null;
  const statusId = statusIdOf(effect);
  return {
    statusId,
    effectUuid: effect.uuid ?? null,
    target: tokenGeom(token, env.gridSize),
    seed: hashSeed(`${statusId}:${effect.uuid ?? ""}`)
  };
}
