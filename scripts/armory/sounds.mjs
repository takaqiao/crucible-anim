import {soundAt} from "./sound-table.mjs";

/**
 * 音效表 —— 「这一下该听见什么」。
 *
 * ## 现状
 *
 * 改造前 434 个动作里**只有 11 个有声音**（远程拉弓那一条）。刀砍上去没有声音，
 * 砍空了也没有声音。这一层补的就是这个。
 *
 * ## 三个时刻
 *
 * | 时刻 | 听见什么 | 由谁发 |
 * | --- | --- | --- |
 * | 挥出去 | 风声（按武器轻重） | travel 槽的挥击规则 |
 * | 打中 | 命中音（按伤害类型） | impact 槽的结果层 |
 * | 打空 | 落空音 | impact 槽的结果层 |
 *
 * ## 排音效的口径是「什么时候听见」，不是「什么时候开始播」
 *
 * 全库音频量测里 psfx 家族的起音中位数是 **200ms**，`psfx.impacts.bludgeoning.v1`
 * 更是 **210-240ms** 才有声。按命中时刻直接排下去，玩家会在刀已经收招之后四分之一秒
 * 才听见那一声。所以一律走 `soundAt(file, atMs)`（见 `armory/sound-table.mjs`），
 * 它把**响度峰值**对齐到指定时刻。
 *
 * ## 为什么全是字面量路径
 *
 * DB 路径不能由插值拼出来——静态扫描还原不了，「必须有 ASSET-NOTES 依据」「不在否决
 * 清单」「不引用死链」三条守卫会对它整体失效（`test/armory-assets.test.mjs` 有专门一条
 * 禁令）。MGS 的命名是 `<元素>_<武器类>_whoosh` / `<武器类>_<元素>_hit`，很想拼，不许拼。
 */

/**
 * 命中音，按**伤害类型**。
 *
 * 物理三种走 `psfx.impacts.*`（psfx 没有 piercing，用 slashing——都是利器入肉，
 * 而 bludgeoning 的闷响差得远，不能拿它顶）；元素走 `magicaleffects` 的对应支。
 *
 * `magicaleffects` 只有 fire / cold / necrotic / psychic / lightning / generic 六支，
 * 所以 acid / poison / radiant 落到 generic。**这是缺口不是选择**——MGS 那边有
 * `hammer_acid_hit` / `hammer_poison_hit` / `hammer_holy_hit`，但它们自带锤子的钝响，
 * 拿来配剑会怪；等哪天找到武器中性的元素命中音再换。
 */
export const HIT_SOUND = Object.freeze({
  slashing:    "psfx.impacts.slashing.v1",
  piercing:    "psfx.impacts.slashing.v1",
  bludgeoning: "psfx.impacts.bludgeoning.v1",
  fire:        "psfx.impacts.magicaleffects.fire",
  cold:        "psfx.impacts.magicaleffects.cold",
  corruption:  "psfx.impacts.magicaleffects.necrotic",
  void:        "psfx.impacts.magicaleffects.necrotic",
  psychic:     "psfx.impacts.magicaleffects.psychic",
  // 这四支走 MGS，不走 psfx，两个原因都是量出来的：
  //  · `psfx.impacts.magicaleffects.lightning` **在否决清单里**——频谱是三次放电
  //    （0.25 / 0.55 / 1.00s）加持续噼啪，响度峰值在 1020ms，挂到单次命中上会听成打了三下；
  //  · `psfx.impacts.magicaleffects.generic` 峰值 470-950ms，对不上单次命中的节拍。
  // MGS 的 `slingshot_<元素>_hit` 是同一族的完整元素集（酸/电/火/圣/冰/腐/毒/心灵/雷），
  // 峰值一致落在 350ms、有效声长 1.0-1.4s，是这批里唯一齐全且节拍对得上的一套。
  electricity: "canim.mgs.basic.weapons.slingshot_electrical_hit",
  acid:        "canim.mgs.basic.weapons.slingshot_acid_hit",
  poison:      "canim.mgs.basic.weapons.slingshot_poison_hit",
  radiant:     "canim.mgs.basic.weapons.slingshot_holy_hit"
});

/** 认不出伤害类型时的命中音。挥击落在肉上，斩击是最中性的一支。 */
export const HIT_DEFAULT = "psfx.impacts.slashing.v1";

/**
 * 落空音。
 *
 * MGS 只有四条 miss（`sword_miss` / `dagger_miss` / `axe_throwing_miss` /
 * `slingshot_miss`）。近战一律用 sword_miss——**MISS 结果层此前完全没有声音**，
 * 有一声划空比按武器分得更细重要。
 */
export const MISS_SOUND = "canim.mgs.basic.weapons.sword_miss";

/**
 * 挥击风声，按**武器轻重**。
 *
 * `psfx.weapon-swooshes.{light,heavy}.v1.group01` 各 4 条，`ctx.sound` 会在其中按种子取一。
 * 元素武器另有 MGS 的 `<元素>_<武器类>_whoosh` 46 条，那是下一轮的事——先让每一次挥击
 * 都有声音，再谈按元素分。
 */
export const SWING_LIGHT = "psfx.weapon-swooshes.light.v1.group01";
export const SWING_HEAVY = "psfx.weapon-swooshes.heavy.v1.group01";

/** 走重档风声的武器分类：双手与重型。其余走轻档。 */
const HEAVY_CATEGORIES = new Set(["heavy1", "heavy2", "balanced2", "simple2",
                                  "shieldHeavy", "projectile2", "mechanical2", "talisman2"]);

/**
 * 这件武器挥出去该是什么风声。
 * @param {{category: string|null}|null|undefined} w
 * @returns {string}
 */
export const swingSoundFor = w => HEAVY_CATEGORIES.has(w?.category) ? SWING_HEAVY : SWING_LIGHT;

/**
 * 这一下打中该听见什么。
 *
 * 伤害类型的取法与 impact 的元素层同源：先看结算写回目标的伤害类型，再看动作自己的，
 * 最后才是武器的（`impact.mjs` 的 `chain`）。这里只收口到「给一个伤害类型，给一条路径」。
 *
 * @param {string|null|undefined} damageType
 * @returns {string}
 */
export const hitSoundFor = damageType => HIT_SOUND[damageType] ?? HIT_DEFAULT;

/**
 * 一次挥击该出的音效 cue。
 *
 * ## 为什么由 travel 槽发而不是 impact 槽
 *
 * 排音效要知道**命中时刻**（`contactMs`，见 `armory/clip-table.mjs`），而那个数只有
 * travel 槽手里有——impact 槽的 cue 本身就起于命中时刻，要让声音在那一刻**响**
 * 就得往前挪，而 cue 的 delay 不能是负数。放在 travel 槽里一切都是正数。
 *
 * travel 槽同样拿得到命中/落空：`target.results` 就在快照的目标上，`aim.missed`
 * 用的也是它。
 *
 * ## 两声的先后
 *
 * 风声的**响度峰值**排在命中前 150ms，命中音排在命中时刻。这样听起来是「唰——铛」
 * 而不是两声叠在一起。150 是留给耳朵分辨两个瞬态的间隔，不是量出来的常数。
 *
 * @param {object} s        动作快照
 * @param {object} ctx
 * @param {object} target
 * @param {number} contactMs 画面上「打中」的时刻（clipOf(...).contactMs）
 * @param {object|null} weapon
 * @returns {object[]} 0-2 条 sound cue
 */
export function strikeSounds(s, ctx, target, contactMs, weapon) {
  const out = [];

  // 命中音先算：风声要排在它之前，排不进去就不出——「铛——唰」比没有风声更糟。
  const missed = (target?.results ?? []).some(r => r.result === 0 || r.result === 1);
  const dmg = target?.damage?.type ?? s?.usage?.damageType ?? weapon?.damageType ?? null;
  const impact = ctx.sound(missed ? MISS_SOUND : hitSoundFor(dmg));
  const impactAt = impact && soundAt(impact.file, contactMs);
  const impactHeard = impactAt ? contactMs + impactAt.lateBy : contactMs;

  const swing = ctx.sound(swingSoundFor(weapon));
  if (swing) {
    const t = soundAt(swing.file, Math.max(0, contactMs - 150));
    const heard = t ? Math.max(0, contactMs - 150) + t.lateBy : 0;
    // 风声挤不到命中音前面就整条丢掉：这一记挥击太短，塞进去只会听成「铛——唰」
    if (t && heard < impactHeard) {
      out.push({kind: "sound", file: swing.file, volume: 0.6,
                delay: t.delay, startTime: t.startTime,
                duration: t.effectiveMs});
    }
  }

  // 打偏了就该是划空声。MISS 结果层此前完全没有声音。
  // 伤害类型的取法与 impact 的元素层同源：结算写回目标的 → 动作自己的 → 武器的
  if (impact) {
    out.push({kind: "sound", file: impact.file, volume: 0.8,
              delay: impactAt?.delay ?? contactMs, startTime: impactAt?.startTime ?? 0,
              duration: impactAt?.effectiveMs ?? null});
  }
  return out;
}

/**
 * 施法音，按**符文**。
 *
 * 改造前 204 条法术**一条声音都没有**。`psfx.casting` 按元素分了 fire / earth / water /
 * sound / generic 五支，正好接 Crucible 的符文。
 *
 * 对不上元素的八个符文（life / death / soul / oblivion / control / illusion / kinesis /
 * illumination）走 generic——**这是缺口不是选择**：psfx 只有这五支，硬把「死亡」配成
 * 「水」比走通用更糟。
 */
export const CAST_SOUND = Object.freeze({
  flame: "psfx.casting.fire",
  earth: "psfx.casting.earth",
  storm: "psfx.casting.sound",
  frost: "psfx.casting.water"
});

/** 认不出元素的符文用它。峰值 220-270ms、有效声长 600-1720ms，是这一族里最紧的一支。 */
export const CAST_DEFAULT = "psfx.casting.generic";

/**
 * 一次施法该出的音效 cue。
 *
 * 只出一条：施法音本身是个渐强的过程，**不按「让峰值落在某一刻」排**——那是给
 * 「打中」这种瞬态用的口径。这里 delay 0 起播，时长裁到有效声长（psfx.casting.water
 * 整段 4.1 秒，不裁会盖住后面的命中音）。
 *
 * @param {object} s 动作快照
 * @param {object} ctx
 * @returns {object[]} 0-1 条 sound cue
 */
export function spellCastSound(s, ctx) {
  if (!s?.spell) return [];
  const fx = ctx.sound(CAST_SOUND[s.spell.rune] ?? CAST_DEFAULT);
  if (!fx) return [];
  const t = soundAt(fx.file, 0);
  return [{kind: "sound", file: fx.file, volume: 0.55,
           delay: 0, duration: t?.effectiveMs ?? null}];
}
