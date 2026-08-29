/**
 * 兵库音效的时序事实 —— **本文件由 `tools/gen-sound-table.mjs` 生成，不要手改。**
 *
 * 每条是 `[peakMs, onsetMs, effectiveMs, totalMs, peakDb, rmsDb]`，来自
 * `data/audio-profiles.json` 的全库量测。前四列是**时序**（毫秒），后两列是**响度**（dBFS，
 * 满刻度为 0）：`peakDb` 是整段的最大瞬时幅度，`rmsDb` 是整段的均方根。
 * 后两列只被 `gainFor()` 使用，与 `soundAt()` 的排期完全无关。
 *
 * ⚠ **四个时序量的基准不一样。** `peakMs` / `onsetMs` / `totalMs` 相对素材第 0 毫秒，
 * 而 `effectiveMs` 相对**起振点**（见 `tools/profile-audio.mjs` 的包络分析）。所以
 * 「有声内容到第几毫秒为止」是 `min(totalMs, onsetMs + effectiveMs)`，**不是** `effectiveMs`。
 * 把 `effectiveMs` 直接当播放时长用，播出窗会整整早收一个 `onsetMs`——
 * 曾因此把 33 条挥击风声的响度峰值切在窗外（psfx swooshes 的起振点普遍 170-190ms），
 * 玩家侧的表现就是「挥击没有声音」。
 *
 * 排音效的口径是**「什么时候听见」**而不是「什么时候开始播」：psfx 家族的起音中位数
 * 是 200ms，`psfx.impacts.bludgeoning.v1` 更是 210-240ms 才有声。按命中时刻直接排，
 * 玩家会在刀收招之后才听见那一声。
 *
 * 重新生成： npm run sounds
 */

/** @type {Record<string, [peakMs: number, onsetMs: number, effectiveMs: number, totalMs: number,
 *                         peakDb: number, rmsDb: number]>} */
export const SFX = Object.freeze({
  "assets/MGS/ogg/SFX/Basic/Combat/Necrotic Damage 2.ogg": [140,0,1090,1087,-12.9,-21.9],
  "assets/MGS/ogg/SFX/Basic/Combat/Necrotic Damage 3.ogg": [590,0,1090,1087,-16.9,-23.2],
  "assets/MGS/ogg/SFX/Basic/Combat/Necrotic Damage 4.ogg": [190,0,1090,1087,-12.9,-22.2],
  "assets/MGS/ogg/SFX/Basic/Spells/Piercing Damage Spell  2.ogg": [100,0,1060,1099,-16.3,-23.2],
  "assets/MGS/ogg/SFX/Basic/Spells/Piercing Damage Spell  3.ogg": [100,0,1070,1099,-16.8,-24.2],
  "assets/MGS/ogg/SFX/Basic/Spells/Piercing Damage Spell 1.ogg": [30,0,1050,1099,-16.7,-24.1],
  "assets/MGS/ogg/SFX/Basic/Weapons/Acid Axe Whoosh.ogg": [190,0,1600,1863,-6.3,-20.3],
  "assets/MGS/ogg/SFX/Basic/Weapons/Acid Dagger Whoosh.ogg": [190,60,1270,1863,-13.5,-24.8],
  "assets/MGS/ogg/SFX/Basic/Weapons/Acid Hammer Whoosh.ogg": [250,0,1610,1863,-9.5,-22],
  "assets/MGS/ogg/SFX/Basic/Weapons/Acid Staff Whoosh.ogg": [210,70,1530,1863,-7.6,-19.7],
  "assets/MGS/ogg/SFX/Basic/Weapons/Acid Sword Whoosh.ogg": [190,60,1570,1863,-11.2,-24.6],
  "assets/MGS/ogg/SFX/Basic/Weapons/Acid Two-Handed Sword Whoosh.ogg": [200,0,1600,1863,-7.9,-19.4],
  "assets/MGS/ogg/SFX/Basic/Weapons/Electrical Axe Whoosh.ogg": [260,0,1040,1686,-5.7,-18.8],
  "assets/MGS/ogg/SFX/Basic/Weapons/Electrical Dagger Whoosh.ogg": [190,140,780,1222,-13.4,-26.8],
  "assets/MGS/ogg/SFX/Basic/Weapons/Electrical Hammer Whoosh.ogg": [250,0,1070,1686,-9.4,-21.4],
  "assets/MGS/ogg/SFX/Basic/Weapons/Electrical Staff Whoosh.ogg": [190,90,980,1686,-7.7,-18.5],
  "assets/MGS/ogg/SFX/Basic/Weapons/Electrical Sword Whoosh.ogg": [190,120,990,1686,-11.4,-26.1],
  "assets/MGS/ogg/SFX/Basic/Weapons/Electrical Two-Handed Sword Whoosh.ogg": [200,0,1070,1686,-8.4,-18.2],
  "assets/MGS/ogg/SFX/Basic/Weapons/Flaming Axe Whoosh.ogg": [260,0,1320,1668,-5.2,-17.8],
  "assets/MGS/ogg/SFX/Basic/Weapons/Flaming Dagger Whoosh.ogg": [190,60,1120,2716,-8.5,-21.3],
  "assets/MGS/ogg/SFX/Basic/Weapons/Flaming Hammer Whoosh.ogg": [190,0,1370,1668,-8.4,-19.5],
  "assets/MGS/ogg/SFX/Basic/Weapons/Flaming Staff Whoosh.ogg": [190,60,1260,1709,-7.8,-18.6],
  "assets/MGS/ogg/SFX/Basic/Weapons/Flaming Sword Whoosh.ogg": [190,60,1290,1668,-8.5,-20.9],
  "assets/MGS/ogg/SFX/Basic/Weapons/Flaming Two-Handed Sword Whoosh.ogg": [200,0,1320,1668,-6.2,-17.1],
  "assets/MGS/ogg/SFX/Basic/Weapons/Icy Axe Whoosh.ogg": [260,0,1060,1420,-6.5,-19.8],
  "assets/MGS/ogg/SFX/Basic/Weapons/Icy Dagger Whoosh.ogg": [190,40,820,2629,-14.9,-28.5],
  "assets/MGS/ogg/SFX/Basic/Weapons/Icy Hammer Whoosh.ogg": [250,0,980,1420,-10.3,-22.1],
  "assets/MGS/ogg/SFX/Basic/Weapons/Icy Staff Whoosh.ogg": [190,50,1010,1420,-8.5,-19.4],
  "assets/MGS/ogg/SFX/Basic/Weapons/Icy Sword Whoosh.ogg": [190,50,800,1420,-12.5,-26.7],
  "assets/MGS/ogg/SFX/Basic/Weapons/Icy Two-Handed Sword Whoosh.ogg": [180,0,950,1420,-8.6,-18.4],
  "assets/MGS/ogg/SFX/Basic/Weapons/Slingshot Acid Hit 1.ogg": [350,0,1260,1441,-14.5,-27],
  "assets/MGS/ogg/SFX/Basic/Weapons/Slingshot Electrical Hit 1.ogg": [350,0,1440,1441,-13.6,-25.7],
  "assets/MGS/ogg/SFX/Basic/Weapons/Slingshot Holy Hit 1.ogg": [420,40,1400,1441,-8.9,-21.8],
  "assets/MGS/ogg/SFX/Basic/Weapons/Slingshot Poison Hit 1.ogg": [350,0,1810,1805,-14.2,-29.7],
  "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Dark_Spell 1.ogg": [370,20,2140,3166,-8.5,-16.1],
  "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Dark_Spell 2.ogg": [430,20,3360,4902,-9.1,-17.6],
  "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Dark_Spell 3.ogg": [550,30,4750,5000,-12.8,-20.1],
  "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Fire_Spell 1.ogg": [100,0,1970,2832,-13,-19.9],
  "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Fire_Spell 2.ogg": [120,0,1310,2461,-9.2,-19.8],
  "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Fire_Spell 3.ogg": [180,0,1710,3243,-9,-15.9],
  "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Ice_spell 1.ogg": [560,0,3110,3818,-14.2,-22.4],
  "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Ice_spell 2.ogg": [730,10,3370,4246,-11.2,-21.7],
  "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Ice_spell 3.ogg": [2000,20,4000,4037,-13.1,-22.2],
  "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Lighting_Buff 1.ogg": [320,0,2610,2824,-16.3,-25.3],
  "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Lighting_Buff 2.ogg": [560,20,2690,2957,-17,-25.7],
  "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Lighting_Buff 3.ogg": [910,30,2420,2922,-17.3,-25.8],
  "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Lighting_Spell 1.ogg": [610,0,1940,2117,-15.9,-23.3],
  "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Lighting_Spell 2.ogg": [350,10,1690,2358,-15.9,-23.1],
  "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Lighting_Spell 3.ogg": [360,10,3150,3166,-11.6,-20.6],
  "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Rocks_Spell 1.ogg": [330,0,1890,2661,-12.1,-21.4],
  "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Rocks_Spell 2.ogg": [540,30,2740,3386,-9.4,-17.9],
  "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Rocks_Spell 3.ogg": [820,10,2260,2652,-13.9,-22.6],
  "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Wind_Spell 1.ogg": [740,40,3300,3752,-9.5,-19.2],
  "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Wind_Spell 2.ogg": [320,10,4200,4481,-15.2,-21.6],
  "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Wind_Spell 3.ogg": [560,0,4190,4510,-13.3,-20.3],
  "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 01.ogg": [180,0,570,600,-15,-22.3],
  "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 02.ogg": [200,0,630,638,-15.1,-23.5],
  "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 03.ogg": [120,0,600,606,-16.1,-22.7],
  "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 04.ogg": [350,0,690,699,-13.9,-22.6],
  "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 05.ogg": [360,0,600,606,-15.9,-22.6],
  "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 06.ogg": [260,0,620,656,-14,-22.1],
  "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 07.ogg": [160,0,660,666,-15,-22.6],
  "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 08.ogg": [330,10,700,715,-14.5,-22.8],
  "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 09.ogg": [250,0,570,580,-16.6,-22.8],
  "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 10.ogg": [200,0,550,550,-15.9,-22.7],
  "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 11.ogg": [210,10,620,654,-16.8,-23],
  "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 12.ogg": [280,0,620,634,-13.8,-22],
  "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 13.ogg": [220,0,570,593,-14.3,-21.3],
  "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 14.ogg": [220,0,570,581,-14.5,-22.3],
  "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 15.ogg": [320,0,660,670,-14.5,-22.7],
  "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 16.ogg": [340,0,670,678,-13.4,-21.7],
  "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 17.ogg": [330,0,700,703,-14.1,-23.1],
  "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 18.ogg": [310,0,620,638,-14.4,-21.8],
  "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 19.ogg": [310,0,650,663,-14,-21.5],
  "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Whoosh Metal Claws 01.ogg": [180,0,410,429,-18.4,-25.9],
  "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Whoosh Metal Claws 02.ogg": [180,0,610,639,-19.6,-27.1],
  "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Whoosh Metal Claws 03.ogg": [160,0,560,572,-18.4,-26],
  "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Whoosh Metal Claws 04.ogg": [240,0,530,536,-17.1,-24.7],
  "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Whoosh Metal Claws 05.ogg": [270,0,640,640,-18.4,-23.8],
  "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Whoosh Metal Claws 06.ogg": [90,0,680,684,-18.9,-26.9],
  "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Whoosh Metal Claws 07.ogg": [190,0,590,609,-18.9,-25.9],
  "modules/ggg/assets/sounds/ovani-sounds/_Free Weekly WAVs/1000 Sword Jutsu.ogg": [140,0,1280,1671,-9.9,-20.5],
  "modules/ggg/assets/sounds/ovani-sounds/_Free Weekly WAVs/Ability Shield.ogg": [730,230,1600,3311,-7.7,-19.1],
  "modules/ggg/assets/sounds/ovani-sounds/Air/Designed/Air Suck A.ogg": [770,120,1130,1407,-19.3,-25.1],
  "modules/ggg/assets/sounds/ovani-sounds/Air/Designed/Air Suck B.ogg": [900,170,1100,1477,-13.9,-22.8],
  "modules/ggg/assets/sounds/ovani-sounds/Air/Designed/Air Suck C.ogg": [900,170,1090,1453,-14.6,-22.6],
  "modules/ggg/assets/sounds/ovani-sounds/Air/Designed/Air Suck D.ogg": [900,150,1130,1477,-16.8,-24.6],
  "modules/ggg/assets/sounds/ovani-sounds/Air/Designed/Air Suck E.ogg": [760,120,1020,1265,-18.7,-24.7],
  "modules/ggg/assets/sounds/ovani-sounds/Air/Ghostly/Ghost Breath A.ogg": [360,30,2620,3366,-13.3,-21.8],
  "modules/ggg/assets/sounds/ovani-sounds/Air/Ghostly/Ghost Breath B.ogg": [520,40,2750,3474,-12.8,-21.7],
  "modules/ggg/assets/sounds/ovani-sounds/Air/Ghostly/Ghost Breath C.ogg": [600,80,3030,3778,-12.5,-21.7],
  "modules/ggg/assets/sounds/ovani-sounds/Air/Ghostly/Ghost Breath D.ogg": [570,40,2970,3682,-14.8,-22.4],
  "modules/ggg/assets/sounds/ovani-sounds/Air/Ghostly/Ghost Breath E.ogg": [710,130,3230,4031,-14,-23.3],
  "modules/ggg/assets/sounds/ovani-sounds/Foley Impacts Vol. 1/Beefy Impacts/Beefy Miss A.ogg": [90,0,430,879,-9.8,-20],
  "modules/ggg/assets/sounds/ovani-sounds/Foley Impacts Vol. 1/Beefy Impacts/Beefy Miss B.ogg": [50,10,320,876,-8.5,-16.4],
  "modules/ggg/assets/sounds/ovani-sounds/Magic II/Nature/Animate Tree 001.ogg": [610,0,1110,2004,-15.8,-22.4],
  "modules/ggg/assets/sounds/ovani-sounds/Magic II/Nature/Animate Tree 002.ogg": [330,0,1630,2504,-13.5,-21.7],
  "modules/ggg/assets/sounds/ovani-sounds/Magic II/Nature/Animate Tree 003.ogg": [1090,0,2420,3004,-12.8,-20.2],
  "modules/ggg/assets/sounds/ovani-sounds/Magic II/Nature/Animate Tree 004.ogg": [860,0,2440,3004,-13.9,-19.9],
  "modules/ggg/assets/sounds/ovani-sounds/Medieval Fantasy Sound FX Pack Vol. 2/Items & Misc/Equip Charm A.ogg": [460,70,1980,2478,-14.5,-25.5],
  "modules/ggg/assets/sounds/ovani-sounds/Medieval Fantasy Sound FX Pack Vol. 2/Items & Misc/Equip Charm B.ogg": [360,20,1840,2475,-17,-25],
  "modules/ggg/assets/sounds/ovani-sounds/Medieval Fantasy Sound FX Pack Vol. 2/Items & Misc/Equip Charm C.ogg": [300,20,1240,1558,-15.8,-24.8],
  "modules/ggg/assets/sounds/ovani-sounds/Medieval Fantasy Sound FX Pack Vol. 2/Weapons/Weapon Power Up Fire.ogg": [90,10,900,1276,-10.9,-21.1],
  "modules/ggg/assets/sounds/ovani-sounds/Medieval Fantasy Sound FX Pack Vol. 2/Weapons/Weapon Power Up Ice.ogg": [460,30,2220,3453,-11.3,-20.4],
  "modules/ggg/assets/sounds/ovani-sounds/Medieval Fantasy Sound FX Pack Vol. 2/Weapons/Weapon Power Up Lightning.ogg": [270,70,1930,2513,-9.9,-20.4],
  "modules/ggg/assets/sounds/ovani-sounds/Medieval Fantasy Sound FX Pack Vol. 2/Weapons/Weapon Power Up Poison.ogg": [750,50,1540,2164,-14.1,-22.3],
  "modules/ggg/assets/sounds/ovani-sounds/Medieval Fantasy Sound FX Pack Vol. 2/Weapons/Weapon Power Up.ogg": [240,30,1270,1912,-9.4,-21],
  "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Arcane Spells/Arcane Ripple 001.ogg": [1160,10,2500,2878,-10.2,-22],
  "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Arcane Spells/Arcane Ripple 002.ogg": [1230,10,2690,2937,-10.5,-20.7],
  "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Arcane Spells/Arcane Ripple 003.ogg": [230,10,2410,2632,-9.5,-19.9],
  "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Arcane Spells/Arcane Ripple 004.ogg": [870,10,2200,2658,-8,-21.2],
  "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Arcane Spells/Arcane Ripple 005.ogg": [330,0,3950,4208,-9.1,-19.7],
  "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Arcane Spells/Arcane Ripple 006.ogg": [860,0,3040,3320,-10.2,-20.1],
  "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Arcane Spells/Arcane Ripple 007.ogg": [890,0,2920,3253,-10,-20],
  "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Divine Magic/Celestial Choir 001.ogg": [1010,70,2350,2829,-10.3,-19.7],
  "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Divine Magic/Celestial Choir 002.ogg": [360,30,2280,2701,-7.9,-18.4],
  "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Divine Magic/Celestial Choir 003.ogg": [330,30,2360,2739,-8.3,-19.2],
  "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Divine Magic/Celestial Choir 004.ogg": [290,100,2170,2617,-10.7,-20.9],
  "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Divine Magic/Celestial Choir 005.ogg": [170,20,2270,2690,-9.1,-19.1],
  "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Offensive Spells/Oblivion Strike 001.ogg": [410,20,850,1001,-11.8,-19.9],
  "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Offensive Spells/Oblivion Strike 002.ogg": [370,10,1010,1346,-15.7,-21.7],
  "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Offensive Spells/Oblivion Strike 003.ogg": [410,30,980,1291,-11.3,-20.9],
  "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Offensive Spells/Oblivion Strike 004.ogg": [490,20,970,1323,-14.3,-21.6],
  "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Offensive Spells/Oblivion Strike 005.ogg": [440,50,980,1183,-12,-20.1],
  "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Offensive Spells/Oblivion Strike 006.ogg": [390,40,1040,1297,-13.3,-21.2],
  "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Offensive Spells/Oblivion Strike 007.ogg": [310,0,930,1253,-14,-21.6],
  "modules/ggg/assets/sounds/ovani-sounds/Modular Magic Sound FX Pack Vol. 1/Fire/Fire Impact C.ogg": [10,0,1670,1932,-14.5,-26.4],
  "modules/ggg/assets/sounds/ovani-sounds/Modular Magic Sound FX Pack Vol. 1/Fire/Fire Impact D.ogg": [0,0,1830,2066,-9.8,-20.4],
  "modules/ggg/assets/sounds/ovani-sounds/Motion and Impacts Sound FX Pack Vol. 2/Impacts/Impact Fire Start 001.ogg": [70,0,1040,1514,-17.5,-29.2],
  "modules/ggg/assets/sounds/ovani-sounds/Motion and Impacts Sound FX Pack Vol. 2/Impacts/Impact Fire Start 002.ogg": [40,0,1000,1511,-13.6,-26],
  "modules/ggg/assets/sounds/ovani-sounds/Motion and Impacts Sound FX Pack Vol. 2/Impacts/Impact Fire Start 003.ogg": [20,0,1130,1503,-14.2,-29],
  "modules/ggg/assets/sounds/ovani-sounds/Motion and Impacts Sound FX Pack Vol. 2/Impacts/Impact Fire Start 004.ogg": [140,50,1270,2014,-15.4,-26.3],
  "modules/ggg/assets/sounds/ovani-sounds/Motion and Impacts Sound FX Pack Vol. 2/Impacts/Impact Fire Start 005.ogg": [130,0,1530,2008,-14.1,-25.9],
  "modules/ggg/assets/sounds/ovani-sounds/Motion and Impacts Sound FX Pack Vol. 2/Impacts/Impact Heavy Tom 001.ogg": [140,0,2370,3508,-8.3,-19.9],
  "modules/ggg/assets/sounds/ovani-sounds/Motion and Impacts Sound FX Pack Vol. 2/Impacts/Impact Heavy Tom 002.ogg": [120,0,3080,4507,-6.5,-19.5],
  "modules/ggg/assets/sounds/ovani-sounds/Motion and Impacts Sound FX Pack Vol. 2/Impacts/Impact Heavy Tom 003.ogg": [240,0,4220,7514,-9,-21.1],
  "modules/ggg/assets/sounds/ovani-sounds/Motion and Impacts Sound FX Pack Vol. 2/Impacts/Impact Heavy Tom 004.ogg": [110,0,2130,2521,-7.8,-20.8],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailment Hunger 001.ogg": [320,20,580,649,-12.1,-19.5],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailment Hunger 002.ogg": [610,30,1140,1349,-9.2,-18.8],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailment Hunger 003.ogg": [480,20,950,1035,-12.4,-18.7],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailment Hunger 004.ogg": [500,0,670,734,-10.5,-18.7],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Bleed 001.ogg": [260,0,1160,2005,-8.8,-19],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Bleed 002.ogg": [210,0,1370,2022,-10.4,-21.5],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Bleed 003.ogg": [0,0,1560,2005,-17.6,-28.7],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Bleed 004.ogg": [170,0,1740,3024,-14,-23.1],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Grease 001.ogg": [160,0,850,2019,-8.3,-21.8],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Grease 002.ogg": [360,20,820,2008,-13.6,-22.7],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Grease 003.ogg": [60,0,710,2008,-9.7,-20.1],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Grease 004.ogg": [70,20,780,1511,-11.2,-21.1],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Grease 005.ogg": [370,0,1250,2011,-13.8,-20.8],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Hypnotize 001.ogg": [600,0,2570,3520,-9.7,-19.5],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Hypnotize 002.ogg": [1000,0,3330,5006,-7.2,-20.4],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Hypnotize 003.ogg": [40,0,1260,2011,-12,-21.4],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Hypnotize 004.ogg": [360,0,3250,4518,-10.6,-20.5],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Poison 001.ogg": [220,0,900,1982,-10.6,-19.8],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Poison 002.ogg": [380,0,840,2011,-13.6,-23.8],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Poison 003.ogg": [230,0,930,2016,-10.2,-19.3],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Poison 004.ogg": [20,0,910,2019,-7.7,-20.9],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Stun 001.ogg": [10,0,1020,1514,-11.7,-26.1],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Stun 002.ogg": [10,0,730,2016,-11.5,-24.9],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Stun 003.ogg": [20,0,1130,2016,-9.3,-23],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Stun 004.ogg": [100,0,1230,2016,-13,-24.1],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Fantasy/Fantasy Dispel 001.ogg": [200,0,2840,3587,-14.8,-24.6],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Fantasy/Fantasy Dispel 002.ogg": [230,0,2840,3511,-13.7,-24.2],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Fantasy/Fantasy Dispel 003.ogg": [240,0,3020,3593,-15,-24.9],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Fantasy/Fantasy Dispel 004.ogg": [300,0,2850,3607,-14.7,-24.4],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/General/Abstract Dash 001.ogg": [110,10,2410,4510,-14.9,-24.7],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/General/Abstract Dash 002.ogg": [120,10,2360,4513,-14.6,-24.1],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/General/Abstract Dash 003.ogg": [70,10,2430,4008,-16.6,-25.4],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/General/Abstract Dash 004.ogg": [130,20,2080,3520,-14.3,-24.2],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/General/Abstract Reward 001.ogg": [210,50,1520,2521,-17.4,-27],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/General/Abstract Reward 002.ogg": [270,40,1340,2513,-17.8,-26.5],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/General/Abstract Reward 003.ogg": [220,50,1300,2510,-18.8,-27.3],
  "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/General/Abstract Reward 004.ogg": [270,50,1310,2513,-17.6,-27.3],
  "modules/ggg/assets/sounds/ovani-sounds/Simple Magic Sound FX Pack Vol. 3/Light/Shield Counter A.ogg": [180,10,1150,2264,-11.4,-20.8],
  "modules/ggg/assets/sounds/ovani-sounds/Simple Magic Sound FX Pack Vol. 3/Light/Shield Counter B.ogg": [220,10,1260,2238,-11.4,-20.9],
  "modules/ggg/assets/sounds/ovani-sounds/Simple Magic Sound FX Pack Vol. 3/Nature/Goodberry Heal A.ogg": [30,0,1450,2260,-11.9,-23.6],
  "modules/ggg/assets/sounds/ovani-sounds/Simple Magic Sound FX Pack Vol. 3/Nature/Goodberry Heal B.ogg": [270,0,1410,2323,-16.2,-25.1],
  "modules/ggg/assets/sounds/ovani-sounds/Weaponry Melee Sound FX Pack Vol. 1/Blade/Block Blade Thin 001.ogg": [20,10,220,455,-16.9,-25.9],
  "modules/ggg/assets/sounds/ovani-sounds/Weaponry Melee Sound FX Pack Vol. 1/Blade/Block Blade Thin 002.ogg": [20,10,130,496,-15.5,-22.4],
  "modules/ggg/assets/sounds/ovani-sounds/Weaponry Melee Sound FX Pack Vol. 1/Blade/Block Blade Thin 003.ogg": [20,10,180,475,-17.3,-25.5],
  "modules/ggg/assets/sounds/ovani-sounds/Weaponry Melee Sound FX Pack Vol. 1/Blade/Block Blade Thin 004.ogg": [10,10,160,588,-13.8,-22],
  "modules/ggg/assets/sounds/ovani-sounds/Weaponry Melee Sound FX Pack Vol. 1/Blade/Block Blade Thin 005.ogg": [10,10,190,490,-14.3,-23.1],
  "modules/ggg/assets/sounds/ovani-sounds/Weaponry Melee Sound FX Pack Vol. 1/Blade/Parry Blade 001.ogg": [230,0,720,1003,-12.1,-20.7],
  "modules/ggg/assets/sounds/ovani-sounds/Weaponry Melee Sound FX Pack Vol. 1/Blade/Parry Blade 002.ogg": [270,10,740,1047,-13.2,-20.8],
  "modules/ggg/assets/sounds/ovani-sounds/Weaponry Melee Sound FX Pack Vol. 1/Blade/Parry Blade 003.ogg": [240,20,820,1131,-11.9,-21],
  "modules/ggg/assets/sounds/ovani-sounds/Weaponry Melee Sound FX Pack Vol. 1/Blade/Parry Blade 004.ogg": [230,20,790,998,-13.1,-20.2],
  "modules/ggg/assets/sounds/ovani-sounds/Weaponry Melee Sound FX Pack Vol. 1/Blade/Parry Blade 005.ogg": [210,0,810,1149,-13,-20.1],
  "modules/ggg/assets/sounds/ovani-sounds/Weaponry Melee Sound FX Pack Vol. 1/Blunt/Block Blunt Large 001.ogg": [10,0,310,536,-10,-17.3],
  "modules/ggg/assets/sounds/ovani-sounds/Weaponry Melee Sound FX Pack Vol. 1/Blunt/Block Blunt Large 002.ogg": [50,20,280,551,-12.1,-18.6],
  "modules/ggg/assets/sounds/ovani-sounds/Weaponry Melee Sound FX Pack Vol. 1/Blunt/Block Blunt Large 003.ogg": [10,0,340,551,-11.3,-18.5],
  "modules/ggg/assets/sounds/ovani-sounds/Weaponry Melee Sound FX Pack Vol. 1/Blunt/Block Blunt Large 004.ogg": [10,0,270,536,-10.5,-17.9],
  "modules/ggg/assets/sounds/ovani-sounds/Weaponry Melee Sound FX Pack Vol. 1/Blunt/Block Blunt Large 005.ogg": [0,0,260,525,-10.7,-17.2],
  "modules/ggg/assets/sounds/Soniss/GDC2024/Justsoundeffects/Metal Shield Block 1.ogg": [80,10,850,1231,-11.5,-20.2],
  "modules/ggg/assets/sounds/Soniss/GDC2024/Justsoundeffects/Metal Shield Block 2.ogg": [120,0,910,1385,-11.8,-20],
  "modules/ggg/assets/sounds/Soniss/GDC2024/Justsoundeffects/Metal Shield Block 3.ogg": [100,10,770,1317,-12.1,-19.9],
  "modules/ggg/assets/sounds/Soniss/GDC2024/Justsoundeffects/Metal Shield Block 4.ogg": [110,0,680,1265,-11.3,-19.8],
  "modules/ggg/assets/sounds/Soniss/GDC2024/Justsoundeffects/Metal Shield Block 5.ogg": [200,0,720,1017,-13.2,-20.7],
  "modules/ggg/assets/sounds/Soniss/GDC2026/Epic Stock Media/Blast.ogg": [100,20,1180,1481,-12.2,-20.8],
  "modules/ggg/assets/sounds/TomMusic/FreeFantasySFX/Spells/Ice Freeze 1.ogg": [40,0,830,831,-16.2,-25.5],
  "modules/ggg/assets/sounds/TomMusic/FreeFantasySFX/Spells/Ice Freeze 2.ogg": [30,0,810,810,-17.9,-28.7],
  "modules/ggg/assets/sounds/TomMusic/FreeFantasySFX/Spells/Spell Impact 1.ogg": [10,0,380,374,-17.2,-24.8],
  "modules/ggg/assets/sounds/TomMusic/FreeFantasySFX/Spells/Spell Impact 2.ogg": [20,0,310,313,-16.7,-23.5],
  "modules/ggg/assets/sounds/TomMusic/FreeFantasySFX/Spells/Spell Impact 3.ogg": [60,0,380,385,-17.3,-24.4],
  "modules/psfx-patreon/library/1st-level-spells/cure-wounds/v1/cure-wounds-00.ogg": [260,150,2970,5995,-10.1,-16.4],
  "modules/psfx-patreon/library/3rd-level-spells/fireball/v1/fireball-explosion-01.ogg": [10,0,3450,3994,-10.8,-20.1],
  "modules/psfx-patreon/library/cantrips/mind-sliver/v1/mind-sliver-001.ogg": [160,20,1070,4000,-8.3,-18.9],
  "modules/psfx-patreon/library/casting/earth/cast-earth-01.ogg": [730,30,1640,3000,-4.8,-15.1],
  "modules/psfx-patreon/library/casting/earth/cast-earth-02.ogg": [610,30,1670,3000,-5.6,-15.2],
  "modules/psfx-patreon/library/casting/earth/cast-earth-03.ogg": [600,30,1710,3000,-6.4,-14.8],
  "modules/psfx-patreon/library/casting/earth/cast-earth-04.ogg": [600,30,1710,3000,-5.7,-15.2],
  "modules/psfx-patreon/library/casting/earth/cast-earth-05.ogg": [720,30,1670,3000,-6.2,-15.6],
  "modules/psfx-patreon/library/casting/fire/cast-fire-01.ogg": [610,0,1690,2500,-4.7,-13.9],
  "modules/psfx-patreon/library/casting/fire/cast-fire-02.ogg": [610,0,1690,2500,-4.1,-13.7],
  "modules/psfx-patreon/library/casting/fire/cast-fire-03.ogg": [600,0,1740,2500,-5.5,-13.4],
  "modules/psfx-patreon/library/casting/fire/cast-fire-04.ogg": [600,0,1750,2500,-5.2,-14.3],
  "modules/psfx-patreon/library/casting/fire/cast-fire-05.ogg": [600,0,1750,2500,-5.9,-14.3],
  "modules/psfx-patreon/library/casting/generic-v2/001/cast-generic-001-01.ogg": [210,20,3590,4000,-9.8,-21.6],
  "modules/psfx-patreon/library/casting/generic/001/cast-generic-03.ogg": [220,30,620,1518,-7.5,-14.8],
  "modules/psfx-patreon/library/casting/generic/002/cast-generic-001-03.ogg": [240,100,1720,3503,-13.4,-18.3],
  "modules/psfx-patreon/library/casting/generic/002/cast-generic-002-03.ogg": [240,0,600,3500,-5.6,-13],
  "modules/psfx-patreon/library/casting/generic/002/cast-generic-003-03.ogg": [270,20,960,3500,-7.8,-16],
  "modules/psfx-patreon/library/casting/on-token/on-token-cast-001.ogg": [1690,0,3810,6000,-6.3,-15.9],
  "modules/psfx-patreon/library/casting/sound/cast-sound-01.ogg": [560,30,2530,4000,-5.5,-15.3],
  "modules/psfx-patreon/library/casting/sound/cast-sound-02.ogg": [560,30,2600,4000,-5.1,-15.4],
  "modules/psfx-patreon/library/casting/sound/cast-sound-03.ogg": [560,30,2600,4000,-5.5,-15],
  "modules/psfx-patreon/library/casting/sound/cast-sound-04.ogg": [600,30,2610,4000,-5.8,-15.6],
  "modules/psfx-patreon/library/casting/sound/cast-sound-05.ogg": [810,30,2610,4000,-6,-15.8],
  "modules/psfx-patreon/library/casting/water/cast-water-01.ogg": [760,30,4090,5000,-9,-16.4],
  "modules/psfx-patreon/library/casting/water/cast-water-02.ogg": [770,20,4120,5000,-9.9,-16.5],
  "modules/psfx-patreon/library/casting/water/cast-water-03.ogg": [2420,20,4120,5000,-9.2,-16],
  "modules/psfx-patreon/library/casting/water/cast-water-04.ogg": [760,20,4130,5000,-9.4,-16.5],
  "modules/psfx-patreon/library/casting/water/cast-water-05.ogg": [770,20,4140,5000,-9.7,-16.5],
  "modules/psfx-patreon/library/impacts/bludgeoning/v1/meleeattack-impacts-bludgeoning-00.ogg": [250,240,320,1703,-6.1,-16.7],
  "modules/psfx-patreon/library/impacts/bludgeoning/v1/meleeattack-impacts-bludgeoning-01.ogg": [250,240,320,1703,-6.1,-16.7],
  "modules/psfx-patreon/library/impacts/bludgeoning/v1/meleeattack-impacts-bludgeoning-02.ogg": [250,210,370,1703,-6.2,-16.8],
  "modules/psfx-patreon/library/impacts/bludgeoning/v1/meleeattack-impacts-bludgeoning-03.ogg": [250,240,320,1703,-6.1,-16.6],
  "modules/psfx-patreon/library/impacts/magicaleffects/cold/meleeattack-impacts-magicaleffects-cold-00.ogg": [230,140,3080,5000,-9.6,-30.7],
  "modules/psfx-patreon/library/impacts/magicaleffects/fire/meleeattack-impacts-magicaleffects-fire-00.ogg": [260,190,2480,4500,-9,-27.8],
  "modules/psfx-patreon/library/impacts/magicaleffects/generic/002/impact-magicaleffects-generic-001-03.ogg": [950,90,1880,3494,-11.7,-18.3],
  "modules/psfx-patreon/library/impacts/magicaleffects/necrotic/meleeattack-impacts-magicaleffects-necrotic-00.ogg": [370,0,1940,3000,-22.6,-30.6],
  "modules/psfx-patreon/library/impacts/magicaleffects/psychic/meleeattack-impacts-magicaleffects-psychic-00.ogg": [390,20,2540,3500,-17.1,-33.7],
  "modules/psfx-patreon/library/impacts/magicaleffects/psychic/meleeattack-impacts-magicaleffects-psychic-01.ogg": [390,20,2470,3500,-16.9,-31.2],
  "modules/psfx-patreon/library/impacts/magicaleffects/psychic/meleeattack-impacts-magicaleffects-psychic-02.ogg": [390,30,2460,3500,-17.5,-34.1],
  "modules/psfx-patreon/library/impacts/magicaleffects/psychic/meleeattack-impacts-magicaleffects-psychic-03.ogg": [390,20,2470,3500,-17.1,-32.6],
  "modules/psfx-patreon/library/impacts/slashing/v1/meleeattack-impacts-slashing-00.ogg": [170,0,440,1206,-14.4,-23.7],
  "modules/psfx-patreon/library/impacts/slashing/v1/meleeattack-impacts-slashing-01.ogg": [220,50,560,1224,-14.4,-25.9],
  "modules/psfx-patreon/library/impacts/slashing/v1/meleeattack-impacts-slashing-02.ogg": [230,0,580,1230,-13.9,-21.9],
  "modules/psfx-patreon/library/impacts/slashing/v1/meleeattack-impacts-slashing-03.ogg": [240,0,460,1244,-15.8,-24.7],
  "modules/psfx-patreon/library/incantations/masculine/001/reverb/harm/incantation-masculine001-reverb-harm-001.ogg": [310,90,2150,5360,-12.1,-19.7],
  "modules/psfx-patreon/library/ranged-weapons/longbow/v1/longbow-001-30ft.ogg": [520,60,940,3500,-11.4,-24.8],
  "modules/psfx-patreon/library/ranged-weapons/longbow/v1/longbow-002-30ft.ogg": [520,60,930,3500,-11.2,-24.4],
  "modules/psfx-patreon/library/ranged-weapons/longbow/v1/longbow-003-30ft.ogg": [510,60,930,3500,-10.7,-22.6],
  "modules/psfx-patreon/library/ranged-weapons/longbow/v1/longbow-004-30ft.ogg": [520,60,920,3500,-11.3,-24.1],
  "modules/psfx-patreon/library/ranged-weapons/longbow/v1/longbow-005-30ft.ogg": [520,60,930,3500,-11.4,-24.3],
  "modules/psfx-patreon/library/weapon-swooshes/heavy/v1/group01/meleeattack-swoosh-heavy-group01-00.ogg": [620,350,400,3000,-17.5,-27.9],
  "modules/psfx-patreon/library/weapon-swooshes/heavy/v1/group01/meleeattack-swoosh-heavy-group01-01.ogg": [390,100,470,3000,-24.9,-34.7],
  "modules/psfx-patreon/library/weapon-swooshes/heavy/v1/group01/meleeattack-swoosh-heavy-group01-02.ogg": [440,110,510,3000,-14,-26.2],
  "modules/psfx-patreon/library/weapon-swooshes/heavy/v1/group01/meleeattack-swoosh-heavy-group01-03.ogg": [500,230,440,3000,-15.5,-25.2],
  "modules/psfx-patreon/library/weapon-swooshes/light/v1/group01/meleeattack-swoosh-light-group01-00.ogg": [610,180,590,3000,-14.3,-28.4],
  "modules/psfx-patreon/library/weapon-swooshes/light/v1/group01/meleeattack-swoosh-light-group01-01.ogg": [360,40,470,3000,-16,-30.7],
  "modules/psfx-patreon/library/weapon-swooshes/light/v1/group01/meleeattack-swoosh-light-group01-02.ogg": [420,170,360,3000,-18.1,-31],
  "modules/psfx-patreon/library/weapon-swooshes/light/v1/group01/meleeattack-swoosh-light-group01-03.ogg": [480,190,450,3000,-8.5,-23.7],
  "modules/soundfxlibrary/Combat/Single/Melee Miss/melee-miss-1.mp3": [30,0,220,260,-9.4,-18.2]
});

/**
 * **显式池** —— 兵库路径 → 它底下真正的整池文件。
 *
 * ## 这张表补的是 `assets.resolve()` 的一个结构性缺口
 *
 * `offlineBackend.getEntry` 对**中间节点取其下第一个叶子作代表**，运行时侧
 * `flattenEntry` 对条目数组同样只取第一条：**路径指到分支 = 1 个文件**。
 * psfx / MGS 把变体存成**数组叶子**，`resolve` 一次拿到整池，`ctx.sound` 就能摇；
 * 而 **ggg-sfx 全库都是并列的编号子枝**（`….05.01` / `….05.02` / …），
 * 同一条路径每次解析恒定拿到 `01`——「同一件武器连挥三次是三次一模一样的声音」。
 *
 * 池只能由调用方逐条列出（`ctx.soundFrom(paths)`），可是**叶子路径写不进兵库**：
 * `test/armory-assets.test.mjs` 只认「ASSET-NOTES 主表某一行本身、或它的**父**路径」，
 * 而选材登记到的是「装着这一池文件的那个分支」（`….05`）这一级，写 `….05.01` 更深、过不了闸。
 * 所以兵库照旧只写登记过的那一级（死链 / 否决清单 / 依据三条守卫照样看得见它），
 * 整池由这张**机械展开**的表给出；展开的每个文件都落在同一行登记的逐文件量测里。
 *
 * ## 只收「resolve 够不到」的那些
 *
 * 判据 `filesUnder(p).length > 1 且 resolve(p).files.length <= 1`。收全了会关掉
 * `test/rng-streams.test.mjs` 的火——那条守卫靠包一层 `assets.resolve` 把兵库的单文件
 * 音效路径伪装成 5 文件池来点火，兵库若一律改走文件路径就再也点不着
 * （`resolve` 对含 `/` 的路径直接原样返回，绕过包装）。
 *
 * 调用方一律走 `poolFor()`：表里没有就返回 `[path]`，退回 `ctx.sound` 的老路。
 */
export const POOL = Object.freeze({
  "ggg-sfx.actions.movement.dash.02": [
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/General/Abstract Dash 001.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/General/Abstract Dash 002.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/General/Abstract Dash 003.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/General/Abstract Dash 004.ogg"
  ],
  "ggg-sfx.equipment.armor.shield.impact.02": [
    "modules/ggg/assets/sounds/Soniss/GDC2024/Justsoundeffects/Metal Shield Block 1.ogg",
    "modules/ggg/assets/sounds/Soniss/GDC2024/Justsoundeffects/Metal Shield Block 2.ogg",
    "modules/ggg/assets/sounds/Soniss/GDC2024/Justsoundeffects/Metal Shield Block 3.ogg",
    "modules/ggg/assets/sounds/Soniss/GDC2024/Justsoundeffects/Metal Shield Block 4.ogg",
    "modules/ggg/assets/sounds/Soniss/GDC2024/Justsoundeffects/Metal Shield Block 5.ogg"
  ],
  "ggg-sfx.impact.general.01": [
    "modules/ggg/assets/sounds/TomMusic/FreeFantasySFX/Spells/Spell Impact 1.ogg",
    "modules/ggg/assets/sounds/TomMusic/FreeFantasySFX/Spells/Spell Impact 2.ogg",
    "modules/ggg/assets/sounds/TomMusic/FreeFantasySFX/Spells/Spell Impact 3.ogg"
  ],
  "ggg-sfx.magic.air.cast.general.05": [
    "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Wind_Spell 1.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Wind_Spell 2.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Wind_Spell 3.ogg"
  ],
  "ggg-sfx.magic.air.cast.suck.01": [
    "modules/ggg/assets/sounds/ovani-sounds/Air/Designed/Air Suck A.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Air/Designed/Air Suck B.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Air/Designed/Air Suck C.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Air/Designed/Air Suck D.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Air/Designed/Air Suck E.ogg"
  ],
  "ggg-sfx.magic.arcane.buff.general.02": [
    "modules/ggg/assets/sounds/ovani-sounds/Medieval Fantasy Sound FX Pack Vol. 2/Items & Misc/Equip Charm A.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Medieval Fantasy Sound FX Pack Vol. 2/Items & Misc/Equip Charm B.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Medieval Fantasy Sound FX Pack Vol. 2/Items & Misc/Equip Charm C.ogg"
  ],
  "ggg-sfx.magic.arcane.cast.general.02": [
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/General/Abstract Reward 001.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/General/Abstract Reward 002.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/General/Abstract Reward 003.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/General/Abstract Reward 004.ogg"
  ],
  "ggg-sfx.magic.arcane.cast.ripple.01": [
    "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Arcane Spells/Arcane Ripple 001.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Arcane Spells/Arcane Ripple 002.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Arcane Spells/Arcane Ripple 003.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Arcane Spells/Arcane Ripple 004.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Arcane Spells/Arcane Ripple 005.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Arcane Spells/Arcane Ripple 006.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Arcane Spells/Arcane Ripple 007.ogg"
  ],
  "ggg-sfx.magic.counter.dispel.01": [
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Fantasy/Fantasy Dispel 001.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Fantasy/Fantasy Dispel 002.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Fantasy/Fantasy Dispel 003.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Fantasy/Fantasy Dispel 004.ogg"
  ],
  "ggg-sfx.magic.divine.cast.dispel.general.01": [
    "modules/ggg/assets/sounds/ovani-sounds/Simple Magic Sound FX Pack Vol. 3/Light/Shield Counter A.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Simple Magic Sound FX Pack Vol. 3/Light/Shield Counter B.ogg"
  ],
  "ggg-sfx.magic.divine.cast.general.01": [
    "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Divine Magic/Celestial Choir 001.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Divine Magic/Celestial Choir 002.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Divine Magic/Celestial Choir 003.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Divine Magic/Celestial Choir 004.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Divine Magic/Celestial Choir 005.ogg"
  ],
  "ggg-sfx.magic.earth.cast.general.01": [
    "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Rocks_Spell 1.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Rocks_Spell 2.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Rocks_Spell 3.ogg"
  ],
  "ggg-sfx.magic.electricity.buff.general.01": [
    "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Lighting_Buff 1.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Lighting_Buff 2.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Lighting_Buff 3.ogg"
  ],
  "ggg-sfx.magic.electricity.cast.general.01": [
    "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Lighting_Spell 1.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Lighting_Spell 2.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Lighting_Spell 3.ogg"
  ],
  "ggg-sfx.magic.fire.cast.general.05": [
    "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Fire_Spell 1.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Fire_Spell 2.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Fire_Spell 3.ogg"
  ],
  "ggg-sfx.magic.fire.impact.extinguish.01": [
    "modules/ggg/assets/sounds/ovani-sounds/Modular Magic Sound FX Pack Vol. 1/Fire/Fire Impact C.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Modular Magic Sound FX Pack Vol. 1/Fire/Fire Impact D.ogg"
  ],
  "ggg-sfx.magic.fire.impact.spark.01": [
    "modules/ggg/assets/sounds/ovani-sounds/Motion and Impacts Sound FX Pack Vol. 2/Impacts/Impact Fire Start 001.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Motion and Impacts Sound FX Pack Vol. 2/Impacts/Impact Fire Start 002.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Motion and Impacts Sound FX Pack Vol. 2/Impacts/Impact Fire Start 003.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Motion and Impacts Sound FX Pack Vol. 2/Impacts/Impact Fire Start 004.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Motion and Impacts Sound FX Pack Vol. 2/Impacts/Impact Fire Start 005.ogg"
  ],
  "ggg-sfx.magic.ice.cast.general.01": [
    "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Ice_spell 1.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Ice_spell 2.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Ice_spell 3.ogg"
  ],
  "ggg-sfx.magic.ice.freeze.03": [
    "modules/ggg/assets/sounds/TomMusic/FreeFantasySFX/Spells/Ice Freeze 1.ogg",
    "modules/ggg/assets/sounds/TomMusic/FreeFantasySFX/Spells/Ice Freeze 2.ogg"
  ],
  "ggg-sfx.magic.misc.debuffs.bleed.01": [
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Bleed 001.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Bleed 002.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Bleed 003.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Bleed 004.ogg"
  ],
  "ggg-sfx.magic.misc.debuffs.grease.01": [
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Grease 001.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Grease 002.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Grease 003.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Grease 004.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Grease 005.ogg"
  ],
  "ggg-sfx.magic.misc.debuffs.hunger.01": [
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailment Hunger 001.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailment Hunger 002.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailment Hunger 003.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailment Hunger 004.ogg"
  ],
  "ggg-sfx.magic.occult.cast.blast.01": [
    "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Offensive Spells/Oblivion Strike 001.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Offensive Spells/Oblivion Strike 002.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Offensive Spells/Oblivion Strike 003.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Offensive Spells/Oblivion Strike 004.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Offensive Spells/Oblivion Strike 005.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Offensive Spells/Oblivion Strike 006.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Modern Magic Sound FX Pack Vol. 1/Offensive Spells/Oblivion Strike 007.ogg"
  ],
  "ggg-sfx.magic.occult.cast.general.06": [
    "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Dark_Spell 1.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Dark_Spell 2.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Elemental Spell Vol 1/Dark_Spell 3.ogg"
  ],
  "ggg-sfx.magic.occult.cast.ghostly.02": [
    "modules/ggg/assets/sounds/ovani-sounds/Air/Ghostly/Ghost Breath A.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Air/Ghostly/Ghost Breath B.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Air/Ghostly/Ghost Breath C.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Air/Ghostly/Ghost Breath D.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Air/Ghostly/Ghost Breath E.ogg"
  ],
  "ggg-sfx.magic.occult.curse.hypnotize.01": [
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Hypnotize 001.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Hypnotize 002.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Hypnotize 003.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Hypnotize 004.ogg"
  ],
  "ggg-sfx.magic.occult.curse.stun.01": [
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Stun 001.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Stun 002.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Stun 003.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Stun 004.ogg"
  ],
  "ggg-sfx.magic.primal.cast.animate_tree.01": [
    "modules/ggg/assets/sounds/ovani-sounds/Magic II/Nature/Animate Tree 001.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Magic II/Nature/Animate Tree 002.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Magic II/Nature/Animate Tree 003.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Magic II/Nature/Animate Tree 004.ogg"
  ],
  "ggg-sfx.magic.primal.healing.02": [
    "modules/ggg/assets/sounds/ovani-sounds/Simple Magic Sound FX Pack Vol. 3/Nature/Goodberry Heal A.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Simple Magic Sound FX Pack Vol. 3/Nature/Goodberry Heal B.ogg"
  ],
  "ggg-sfx.magic.water.cast.bubble.01": [
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Poison 001.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Poison 002.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Poison 003.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Player Status SFX/Ailments/Ailments Poison 004.ogg"
  ],
  "ggg-sfx.melee.blade.block.rapier.01": [
    "modules/ggg/assets/sounds/ovani-sounds/Weaponry Melee Sound FX Pack Vol. 1/Blade/Block Blade Thin 001.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Weaponry Melee Sound FX Pack Vol. 1/Blade/Block Blade Thin 002.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Weaponry Melee Sound FX Pack Vol. 1/Blade/Block Blade Thin 003.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Weaponry Melee Sound FX Pack Vol. 1/Blade/Block Blade Thin 004.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Weaponry Melee Sound FX Pack Vol. 1/Blade/Block Blade Thin 005.ogg"
  ],
  "ggg-sfx.melee.blade.parry.01": [
    "modules/ggg/assets/sounds/ovani-sounds/Weaponry Melee Sound FX Pack Vol. 1/Blade/Parry Blade 001.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Weaponry Melee Sound FX Pack Vol. 1/Blade/Parry Blade 002.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Weaponry Melee Sound FX Pack Vol. 1/Blade/Parry Blade 003.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Weaponry Melee Sound FX Pack Vol. 1/Blade/Parry Blade 004.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Weaponry Melee Sound FX Pack Vol. 1/Blade/Parry Blade 005.ogg"
  ],
  "ggg-sfx.melee.bludgeoning.block.two-hand.01": [
    "modules/ggg/assets/sounds/ovani-sounds/Weaponry Melee Sound FX Pack Vol. 1/Blunt/Block Blunt Large 001.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Weaponry Melee Sound FX Pack Vol. 1/Blunt/Block Blunt Large 002.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Weaponry Melee Sound FX Pack Vol. 1/Blunt/Block Blunt Large 003.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Weaponry Melee Sound FX Pack Vol. 1/Blunt/Block Blunt Large 004.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Weaponry Melee Sound FX Pack Vol. 1/Blunt/Block Blunt Large 005.ogg"
  ],
  "ggg-sfx.melee.claws.strike.slash.01": [
    "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Whoosh Metal Claws 01.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Whoosh Metal Claws 02.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Whoosh Metal Claws 03.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Whoosh Metal Claws 04.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Whoosh Metal Claws 05.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Whoosh Metal Claws 06.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Whoosh Metal Claws 07.ogg"
  ],
  "ggg-sfx.melee.claws.strike.stab.01": [
    "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 10.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 11.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 12.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 13.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 14.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 15.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 16.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 17.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 18.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 19.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 01.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 02.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 03.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 04.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 05.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 06.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 07.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 08.ogg",
    "modules/ggg/assets/sounds/KhronStudio/Forged In Fury Vol 1/Metal Claws/Stab Metal Claws 09.ogg"
  ],
  "ggg-sfx.melee.unarmed.fist.miss.01": [
    "modules/ggg/assets/sounds/ovani-sounds/Foley Impacts Vol. 1/Beefy Impacts/Beefy Miss A.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Foley Impacts Vol. 1/Beefy Impacts/Beefy Miss B.ogg"
  ],
  "ggg-sfx.tasks.stealth.spotted.02": [
    "modules/ggg/assets/sounds/ovani-sounds/Motion and Impacts Sound FX Pack Vol. 2/Impacts/Impact Heavy Tom 001.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Motion and Impacts Sound FX Pack Vol. 2/Impacts/Impact Heavy Tom 002.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Motion and Impacts Sound FX Pack Vol. 2/Impacts/Impact Heavy Tom 003.ogg",
    "modules/ggg/assets/sounds/ovani-sounds/Motion and Impacts Sound FX Pack Vol. 2/Impacts/Impact Heavy Tom 004.ogg"
  ],
  "psfx.casting.generic": [
    "modules/psfx-patreon/library/casting/generic/001/cast-generic-03.ogg",
    "modules/psfx-patreon/library/casting/generic/002/cast-generic-001-03.ogg",
    "modules/psfx-patreon/library/casting/generic/002/cast-generic-002-03.ogg",
    "modules/psfx-patreon/library/casting/generic/002/cast-generic-003-03.ogg"
  ]
});

/**
 * 这条路径该喂给 `ctx.soundFrom` 的池。表里没有就是「`resolve` 自己够得到」，
 * 原样返回单条路径——调用方拿它走 `ctx.sound` 与改造前逐字节一致。
 * @param {string|null|undefined} path
 * @returns {string[]}
 */
export function poolFor(path) {
  if (!path) return [];
  return POOL[path] ?? [path];
}

/**
 * 一条音效该在什么时候开始播，才能让它**在 `atMs` 那一刻响**。
 *
 * `playFor` 是调用方该写进 cue 的 `duration`：从 `startTime` 起播到**有声内容结束**为止。
 *
 * ⚠ **不要用 `effectiveMs` 当 duration。** 它相对起振点量，而 `duration` 的口径是
 * 「从 startTime 起还播多久」，两者基准差一个 `onsetMs`；直接拿来用会把播出窗整整
 * 早收一个起振点。实测曾因此让 379 条 cue 被误裁、其中 33 条挥击风声的响度峰值
 * 落在窗外——那不是「声音小」，是那一声根本没播出来。
 * `totalMs` 的上钳是必需的：10ms 包络窗的量化误差会让 `onset+effective` 比素材总长多出
 * 几毫秒，不钳会写出越界的 timeRange。
 *
 * @param {string|null|undefined} file
 * @param {number} atMs  想让它响的时刻（相对本条 cue 所在的时间基准）
 * @returns {{delay: number, startTime: number, peakMs: number, effectiveMs: number,
 *            playFor: number, lateBy: number}|null}
 *          null = 表里没有这个文件（调用方应退回 delay 0，不要静默按 0 当成对齐）
 */
export function soundAt(file, atMs = 0) {
  const s = SFX[file];
  if (!s) return null;
  const [peakMs, onsetMs, effectiveMs, totalMs] = s;
  /** 有声内容的结束时刻（相对素材第 0 毫秒），再减去 startTime 就是该播多久。 */
  const contentEnd = Math.min(totalMs ?? Infinity, onsetMs + effectiveMs);
  const playFrom = st => Math.max(0, Math.round(contentEnd - st));
  if (atMs >= peakMs) {
    return {delay: Math.round(atMs - peakMs), startTime: 0, peakMs, effectiveMs,
            playFor: playFrom(0), lateBy: 0};
  }
  // 想让它响的时刻比它自己的峰值还早——延迟已经压到 0 仍然来不及。
  // 用 startTime 跳进音频：**只跳到起音为止**，那一段是纯静音，跳过去不损失任何声音
  //（psfx.impacts.bludgeoning.v1 的前 240ms 就是静音）。再往后跳会削掉真正的起振，
  // 而起振正是「打中」这个瞬态的听感来源，宁可晚一点也不削。
  const startTime = Math.min(onsetMs, Math.round(peakMs - atMs));
  const lateBy = Math.max(0, Math.round(peakMs - startTime - atMs));
  return {delay: 0, startTime, peakMs, effectiveMs, playFor: playFrom(startTime), lateBy};
}

/**
 * 这条素材的**有声内容到第几毫秒为止**（相对素材第 0 毫秒）。
 *
 * 从第 0 毫秒起播的 cue（施法床垫那一路：`delay: 0`、不写 `startTime`）该写的
 * `duration` 就是这个数。
 *
 * ⚠ **不要拿 `soundAt(f, 0).playFor` 当它用。** `soundAt` 在「想让它响的时刻早于峰值」
 * 时会用 `startTime` 跳进音频（跳掉起音那段静音），它返回的 `playFor` 是**配套那个
 * startTime** 的；调用方若只取 `playFor` 而不把 `startTime` 一起写进 cue，播出窗就会
 * 整整**短一个 `onsetMs`**，从尾巴上削掉同样长的有声内容。
 * psfx 施法族的起音是 0-30ms，正好躲在 `test/sound-layer.test.mjs` 那条 30ms 容差里，
 * 这个错法一直没被抓住；换上起音 0-130ms 的 ggg 施法族之后一次冒出 31 条。
 *
 * @param {string|null|undefined} file
 * @returns {number|null} null = 表里没有这个文件
 */
export function contentEndOf(file) {
  const s = SFX[file];
  if (!s) return null;
  const [, onsetMs, effectiveMs, totalMs] = s;
  return Math.max(0, Math.round(Math.min(totalMs ?? Infinity, onsetMs + effectiveMs)));
}

/**
 * 响度目标 —— **每个角色该被听成多响**，单位 dBFS（满刻度为 0）。
 *
 * ## 为什么要有这张表
 *
 * 改造前 volume 是五处逐规则手挑的常数（0.55 / 0.6 / 0.7 / 0.8 两处），**与实测响度完全
 * 无关**——尽管每条素材的 `peakDb`/`rmsDb` 早就量在 `data/audio-profiles.json` 里。
 * 实测有效峰值（`peakDb + 20·log10(volume)`）跨度 **21.3 dB ≈ 12 倍振幅**：最轻的是重武器
 * 挥击风声 −29.3，最响的是钝击命中音 −8.0；**235 个双段动作里 153 个「命中音比它前面的
 * 风声还轻」**（中位倒挂 −6.7 dB、最深 −13.0）。按角色中位排序是 cast −12.7 > draw −13.3 >
 * impact −17.0 > swing −20.4：**该最响的那一下排第三**。换句话说「哪一声该突出」从前完全由素材录制时
 * 的电平随机决定，而不是由这一下在打斗里的地位决定。
 *
 * ## 档位与基准
 *
 * | 角色 | 是哪一声 | 目标 | 基准 |
 * | --- | --- | --- | --- |
 * | `impact` | 打中 / 打空 | −12 dB | peak |
 * | `draw` | 拉弓放弦 | −14 dB | peak |
 * | `swing` | 挥击风声 | −18 dB | peak |
 * | `cast` | 施法床垫 | −30 dB | **rms** |
 *
 * **瞬态对齐峰值、持续段对齐 RMS**：一记命中的听感由那个几毫秒的尖峰决定，峰外能量再多
 * 也不改变「响不响」；施法音是一整段渐强的床垫，用峰值对齐会被段内单个爆点带偏
 * （`cast-water-03` 的峰值落在 2420ms 那一团上，而同族其余四条都在 760-770ms）。
 * 时域包络峰均比 `peakDb − rmsDb` 佐证了这个分野：表内 24 条 cast 素材全部 ≤10.3 dB，
 * 而 impact/swing/draw 的中位是 12.1/14.1/12.9——cast 族确实是「厚而不尖」的那一类。
 *
 * cast 的 −30 是**扫出来的**，不是拍的：固定另外三档扫 cast 的 RMS 目标。
 * 上一轮（psfx 施法族语料，540 条 cue）扫出的是 −25：
 * `−20→跨度15.2dB/倒挂130`、`−22→13.2/96`、`−24→12.9/77`、`−25→12.9/34`、`−26..−28→12.9/34`。
 *
 * **12 符文施法音落地后必须重扫，而且最优值真的搬家了。** 换上的 ggg 施法族峰均比
 * 明显更高（`Arcane Ripple 004` peak −8.0 / rms −21.2 = **13.2 dB**，而 psfx 施法族
 * 24/24 都在 10.4 dB 以下）——同一个 RMS 目标下，它们的**峰值**要高出 4-5 dB。
 * 本语料 567 条 cue 重扫：
 * `−25→跨度13.1/倒挂85`、`−26→12.9/75`、`−27→12.9/56`、`−28→12.9/48`、
 * `−29→12.9/44`、**`−30→12.9/36`**、`−31→13.0/20`、`−32→14.0/17`。
 * −30 是**跨度仍守在 12.9、而倒挂降回棘轮线以下**的第一个（也就是最响的）取值；
 * 再往下 −31/−32 倒挂还能降，但全局跨度开始反弹（床垫本身变成了最轻的那一端），
 * 那是用「让床垫听不见」换来的，不算改进。
 *
 * 换句话说，**这一档不是「音量偏好」而是「峰均比模型的补偿量」**：换施法素材族就要重扫。
 * 若哪天施法族换回低峰均比的素材，这个数会自己往回走。
 *
 * 方向与既有记录一致，不是翻案：`docs/ASSET-NOTES.md` 早写着
 * `psfx.weapon-swooshes.heavy.v1.group01`「低频量明显多于 light 组，和 impacts.bludgeoning
 * 同帧叠加时低频会堆到爆，impact 那一路建议压 -3dB」——本表把 bludgeoning 从 0.8 压到 0.507
 * （−4.0 dB），方向与幅度都落在这条上。
 * **反向风险为零**：gain 恒 ≤1，没有任何素材被放大，底噪抬不起来。
 *
 * ## 三条必须留在这里的订正
 *
 * 1. 「cast 与其余三族峰均比零重叠」**不成立，只单向成立**：cast 24/24 都在 10.4 dB 线下，
 *    但线下另有 6 条非 cast（impact 4 条：slashing-02 8.0 / necrotic-00 8.0 / slashing-03 8.9 /
 *    slashing-00 9.3；swing 2 条：swoosh-heavy-03 9.7 / -01 9.8）。所以峰均比**只能做交叉验证，
 *    绝不能做运行时判据**——角色必须由规则显式给出。这正是 `role` 做成必填入参、而本函数
 *    绝不自己从素材去猜的原因；把那 6 条按峰均比猜成 cast，等于把命中音压到床垫档。
 * 2. 归一化之后 impact 只升到**第二**：draw −14.0 > impact −14.4 > swing −18.0 > cast −21.0（按角色中位）。
 *    差额不在这张表里，在**素材**——19 个命中素材有 12 个连 −12 dB 都够不到（最惨的
 *    `necrotic-00` 峰值只有 −22.6，欠 10.6 dB），而 volume 只能衰减不能放大：Sequencer 的
 *    `this._volume = Math.max(0, Math.min(1, inVolume))`（`test/sequencer-contract.test.mjs` 有
 *    源码断言钉住它）。要让命中音真正排第一得换素材，不是调这张表。
 * 3. `GAIN_FLOOR = 0.10` 在当前语料上**永不触发**（未钳制的最小值是 cast 的 0.148）。
 *    它是纯防御值，**别当成在起作用的机制**：真触发意味着某条素材比它的角色目标还响
 *    20 dB 以上，那更可能是量测出错而不是素材太响。
 */
export const GAIN_TARGET = Object.freeze({
  impact: Object.freeze({db: -12, base: "peak"}),
  draw:   Object.freeze({db: -14, base: "peak"}),
  swing:  Object.freeze({db: -18, base: "peak"}),
  cast:   Object.freeze({db: -30, base: "rms"})
});

/** 下钳。当前语料上永不触发（见 GAIN_TARGET 注释第 3 条），纯防御。 */
export const GAIN_FLOOR = 0.10;
/**
 * 上钳。**这一条是硬约束不是选择**：Sequencer 的 SoundSection.volume() 自己就在
 * `Math.max(0, Math.min(1, inVolume))`，写 >1 不会更响、只会让计划里的数字骗人。
 */
export const GAIN_CEIL = 1.00;

/**
 * 这条素材在这个角色上该用多大 volume。
 *
 * `volume = 10^((目标dB − 基准dB) / 20)`，再钳到 `[GAIN_FLOOR, GAIN_CEIL]`。
 *
 * @param {string|null|undefined} file
 * @param {"impact"|"draw"|"swing"|"cast"|null|undefined} role
 * @returns {number|null} null = 表里没有这个文件、或者角色不认识。
 *          **调用方必须写成 `gainFor(f, role) ?? <原来的常数>`，不许静默按 1** —— 按 1 会让
 *          一条查不到的素材突然比全场响 3-8 dB，那比不归一化更糟。
 */
export function gainFor(file, role) {
  const s = SFX[file];
  const t = GAIN_TARGET[role];
  if (!s || !t) return null;
  // 第 5 列 peakDb 给瞬态，第 6 列 rmsDb 给持续段。
  const base = t.base === "rms" ? s[5] : s[4];
  if (typeof base !== "number" || !Number.isFinite(base)) return null;
  const raw = 10 ** ((t.db - base) / 20);
  // 保留三位小数：volume 再往下的位在听感上早已无意义，而计划是要下发给每个客户端的，
  // 短数字让 plan 的 diff 可读（0.1 dB 的量测精度对应 volume 上约 1.2%，三位小数够用）。
  return Math.round(Math.min(GAIN_CEIL, Math.max(GAIN_FLOOR, raw)) * 1000) / 1000;
}
