/**
 * 兵库音效的时序事实 —— **本文件由 `tools/gen-sound-table.mjs` 生成，不要手改。**
 *
 * 每条是 `[peakMs, onsetMs, effectiveMs]`，来自 `data/audio-profiles.json` 的全库量测。
 *
 * 排音效的口径是**「什么时候听见」**而不是「什么时候开始播」：psfx 家族的起音中位数
 * 是 200ms，`psfx.impacts.bludgeoning.v1` 更是 210-240ms 才有声。按命中时刻直接排，
 * 玩家会在刀收招之后才听见那一声。
 *
 * 重新生成： npm run sounds
 */

/** @type {Record<string, [peakMs: number, onsetMs: number, effectiveMs: number]>} */
export const SFX = Object.freeze({
  "assets/MGS/ogg/SFX/Basic/Weapons/Slingshot Acid Hit 1.ogg": [350,0,1260],
  "assets/MGS/ogg/SFX/Basic/Weapons/Slingshot Electrical Hit 1.ogg": [350,0,1440],
  "assets/MGS/ogg/SFX/Basic/Weapons/Slingshot Holy Hit 1.ogg": [420,40,1400],
  "assets/MGS/ogg/SFX/Basic/Weapons/Slingshot Poison Hit 1.ogg": [350,0,1810],
  "assets/MGS/ogg/SFX/Basic/Weapons/Sword Miss.ogg": [180,0,1000],
  "modules/psfx-patreon/library/impacts/bludgeoning/v1/meleeattack-impacts-bludgeoning-00.ogg": [250,240,320],
  "modules/psfx-patreon/library/impacts/bludgeoning/v1/meleeattack-impacts-bludgeoning-01.ogg": [250,240,320],
  "modules/psfx-patreon/library/impacts/bludgeoning/v1/meleeattack-impacts-bludgeoning-02.ogg": [250,210,370],
  "modules/psfx-patreon/library/impacts/bludgeoning/v1/meleeattack-impacts-bludgeoning-03.ogg": [250,240,320],
  "modules/psfx-patreon/library/impacts/magicaleffects/cold/meleeattack-impacts-magicaleffects-cold-00.ogg": [230,140,3080],
  "modules/psfx-patreon/library/impacts/magicaleffects/fire/meleeattack-impacts-magicaleffects-fire-00.ogg": [260,190,2480],
  "modules/psfx-patreon/library/impacts/magicaleffects/necrotic/meleeattack-impacts-magicaleffects-necrotic-00.ogg": [370,0,1940],
  "modules/psfx-patreon/library/impacts/magicaleffects/psychic/meleeattack-impacts-magicaleffects-psychic-00.ogg": [390,20,2540],
  "modules/psfx-patreon/library/impacts/magicaleffects/psychic/meleeattack-impacts-magicaleffects-psychic-01.ogg": [390,20,2470],
  "modules/psfx-patreon/library/impacts/magicaleffects/psychic/meleeattack-impacts-magicaleffects-psychic-02.ogg": [390,30,2460],
  "modules/psfx-patreon/library/impacts/magicaleffects/psychic/meleeattack-impacts-magicaleffects-psychic-03.ogg": [390,20,2470],
  "modules/psfx-patreon/library/impacts/slashing/v1/meleeattack-impacts-slashing-00.ogg": [170,0,440],
  "modules/psfx-patreon/library/impacts/slashing/v1/meleeattack-impacts-slashing-01.ogg": [220,50,560],
  "modules/psfx-patreon/library/impacts/slashing/v1/meleeattack-impacts-slashing-02.ogg": [230,0,580],
  "modules/psfx-patreon/library/impacts/slashing/v1/meleeattack-impacts-slashing-03.ogg": [240,0,460],
  "modules/psfx-patreon/library/ranged-weapons/longbow/v1/longbow-001-30ft.ogg": [520,60,940],
  "modules/psfx-patreon/library/ranged-weapons/longbow/v1/longbow-002-30ft.ogg": [520,60,930],
  "modules/psfx-patreon/library/ranged-weapons/longbow/v1/longbow-003-30ft.ogg": [510,60,930],
  "modules/psfx-patreon/library/ranged-weapons/longbow/v1/longbow-004-30ft.ogg": [520,60,920],
  "modules/psfx-patreon/library/ranged-weapons/longbow/v1/longbow-005-30ft.ogg": [520,60,930],
  "modules/psfx-patreon/library/weapon-swooshes/heavy/v1/group01/meleeattack-swoosh-heavy-group01-00.ogg": [620,350,400],
  "modules/psfx-patreon/library/weapon-swooshes/heavy/v1/group01/meleeattack-swoosh-heavy-group01-01.ogg": [390,100,470],
  "modules/psfx-patreon/library/weapon-swooshes/heavy/v1/group01/meleeattack-swoosh-heavy-group01-02.ogg": [440,110,510],
  "modules/psfx-patreon/library/weapon-swooshes/heavy/v1/group01/meleeattack-swoosh-heavy-group01-03.ogg": [500,230,440],
  "modules/psfx-patreon/library/weapon-swooshes/light/v1/group01/meleeattack-swoosh-light-group01-00.ogg": [610,180,590],
  "modules/psfx-patreon/library/weapon-swooshes/light/v1/group01/meleeattack-swoosh-light-group01-01.ogg": [360,40,470],
  "modules/psfx-patreon/library/weapon-swooshes/light/v1/group01/meleeattack-swoosh-light-group01-02.ogg": [420,170,360],
  "modules/psfx-patreon/library/weapon-swooshes/light/v1/group01/meleeattack-swoosh-light-group01-03.ogg": [480,190,450]
});

/**
 * 一条音效该在什么时候开始播，才能让它**在 `atMs` 那一刻响**。
 *
 * @param {string|null|undefined} file
 * @param {number} atMs  想让它响的时刻（相对本条 cue 所在的时间基准）
 * @returns {{delay: number, startTime: number, peakMs: number, effectiveMs: number, lateBy: number}|null}
 *          null = 表里没有这个文件（调用方应退回 delay 0，不要静默按 0 当成对齐）
 */
export function soundAt(file, atMs = 0) {
  const s = SFX[file];
  if (!s) return null;
  const [peakMs, onsetMs, effectiveMs] = s;
  if (atMs >= peakMs) {
    return {delay: Math.round(atMs - peakMs), startTime: 0, peakMs, effectiveMs, lateBy: 0};
  }
  // 想让它响的时刻比它自己的峰值还早——延迟已经压到 0 仍然来不及。
  // 用 startTime 跳进音频：**只跳到起音为止**，那一段是纯静音，跳过去不损失任何声音
  //（psfx.impacts.bludgeoning.v1 的前 240ms 就是静音）。再往后跳会削掉真正的起振，
  // 而起振正是「打中」这个瞬态的听感来源，宁可晚一点也不削。
  const startTime = Math.min(onsetMs, Math.round(peakMs - atMs));
  const lateBy = Math.max(0, Math.round(peakMs - startTime - atMs));
  return {delay: 0, startTime, peakMs, effectiveMs, lateBy};
}
