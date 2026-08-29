/**
 * 【批次 E】aftermath 槽守卫 —— 士气两档 × 四符文，以及地面残留的 sizePx。
 *
 * ## 为什么单起一个文件
 *
 * aftermath 槽此前没有专属守卫：`preview.test.mjs` 只查「这条规则预览得出东西」，
 * `armory-persist.test.mjs` 只顺手查了治疗辉光那一条。而本批次改的那两件事
 * （把 52 个动作共用的一张紫脸拆开、核实批次 B 补的 sizePx）都需要**跨全语料**的
 * 统计判据，塞进那两个文件都不合适。
 *
 * ## 判据全部独立于兵库
 *
 * 桶大小、符文正交、色相补偿量、素材时长，四类断言的期望值分别算自
 * `test/fixtures/actions.json`、`scripts/resolver/palette.mjs` 的配色表、
 * `data/asset-profiles.json` 的逐帧量测——**没有一条是「拿兵库里的常数核兵库」**。
 * 这正是 `clip-table.test.mjs` 文件头那条「不读生成表去核生成表」的同一条纪律。
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {resolve, resolveEffect} from "../scripts/resolver/resolve.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import {RUNE_COLOR, hueDelta} from "../scripts/resolver/palette.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const actions = JSON.parse(readFileSync(join(ROOT, "test/fixtures/actions.json"), "utf8"));
const effects = JSON.parse(readFileSync(join(ROOT, "test/fixtures/effects.json"), "utf8"));
const visuals = JSON.parse(readFileSync(join(ROOT, "data/asset-profiles.json"), "utf8")).profiles;
const mk = () => createAssets(offlineBackend(index));
const planOf = s => resolve(s, {assets: mk(), armory: ARMORY});

/** 某条规则在全语料里产出的 cue（**单目标口径**：每个动作只数第一个目标那一份）。 */
function cuesOfRule(id, corpus = actions) {
  const out = [];
  for (const a of corpus) {
    const first = a.targets?.[0]?.tokenId ?? null;
    for (const c of planOf(a).cues) {
      if (c.rule !== id) continue;
      if (c.forTarget && first && c.forTarget !== first) continue;
      out.push([a, c]);
    }
  }
  return out;
}

/** 文件名 → 它是 eskie 冲击环的哪个色支（`Energy_Pulse_01_Blue.webm` → `blue`）。 */
const pulseColorOf = file => (file.match(/Energy_Pulse_01_([A-Za-z]+)\.webm$/)?.[1] ?? "").toLowerCase();

/* ============================================================ */
/*  一、士气：52 个动作不再共用一张紫脸                            */
/* ============================================================ */

/**
 * **棘轮：只许降不许升。**
 *
 * 改造前实测 `52 个动作 / 1 个素材 / 最大桶 52`——全仓「一层一素材」里仅次于 impact
 * 结果层的第二个大桶。改造后是 `52 / 4 / 13`（四个打士气的符文各占 13 个手势）。
 * 这里把 13 写死成上限而不是写成「等于 4 个素材」：将来若把手势也拆进来，桶还能再降，
 * 那时改小这个数；但**任何让它回升的改动都必须先在这里说明理由**。
 */
test("士气冲击环：52 个动作至少落在 4 个素材上，最大桶不超过 13", () => {
  const hits = cuesOfRule("aftermath.morale");
  const acts = new Set(hits.map(([a]) => a.id));
  assert.equal(acts.size, 52, `语料里打士气且真掉了士气的动作是 ${acts.size} 条，不是 52——语料变了`);

  const bucket = new Map();
  for (const [, c] of hits) bucket.set(c.file, (bucket.get(c.file) ?? 0) + 1);
  const worst = Math.max(...bucket.values());
  assert.ok(bucket.size >= 4,
    `只用到 ${bucket.size} 个素材：${[...bucket.keys()].map(f => f.split("/").pop()).join(", ")}`);
  assert.ok(worst <= 13,
    `最大桶 ${worst}（改造前 52）——这一层又塌回去了：`
    + [...bucket].sort((x, y) => y[1] - x[1]).map(([f, n]) => `${n}× ${f.split("/").pop()}`).join(" / "));
});

/**
 * 四个打士气的符文**两两文件不同**。
 *
 * 这一条才是「拆开」的真正定义：桶大小可以靠语料条数凑，正交性不能。
 * 变异验证：把 `MORALE_BRANCH.control` 从 `blue` 改回 `pickColor` 会给的 `purple`
 * （即删掉那一行让它落进兜底），control 与 oblivion 立刻撞在同一个文件上，这里红。
 */
test("士气冲击环：control / illusion / oblivion / soul 四个符文互不撞素材", () => {
  const byRune = new Map();
  for (const [a, c] of cuesOfRule("aftermath.morale")) {
    const rune = a.spell?.rune;
    assert.ok(rune, `${a.id} 打士气却没有符文——语料变了`);
    if (!byRune.has(rune)) byRune.set(rune, new Set());
    byRune.get(rune).add(c.file);
  }
  assert.deepEqual([...byRune.keys()].sort(), ["control", "illusion", "oblivion", "soul"]);
  for (const [rune, files] of byRune) {
    assert.equal(files.size, 1, `${rune} 在 13 个手势上摇出了 ${files.size} 个文件——符文身份不该随手势变`);
  }
  const all = new Set([...byRune.values()].flatMap(s => [...s]));
  assert.equal(all.size, 4,
    `四个符文只落在 ${all.size} 个文件上：`
    + [...byRune].map(([r, f]) => `${r}→${[...f][0].split("/").pop()}`).join(" / "));
});

/**
 * 色相补偿量必须真的把分支色旋回**符文自己的颜色**。
 *
 * 期望值算自 `resolver/palette.mjs` 的 `RUNE_COLOR` 与 `hueDelta`，输入是 cue 里
 * **文件名解析出来的色支**——兵库那张 `MORALE_BRANCH` 完全没参与计算。所以「分支表改错」
 * 与「补偿量算错」这两种错法都逃不掉：前者让分支色变，期望值跟着变但 cue 里的 hue 不变；
 * 后者直接对不上。
 */
test("士气冲击环：ColorMatrix 的 hue 把分支色旋回符文色", () => {
  for (const [a, c] of cuesOfRule("aftermath.morale")) {
    const branch = pulseColorOf(c.file);
    assert.ok(branch, `${a.id} 的素材不是 eskie 冲击环：${c.file}`);
    const want = hueDelta(branch, RUNE_COLOR[a.spell.rune]);
    const got = c.filter?.data?.hue ?? 0;
    assert.equal(got, want,
      `${a.id}（${a.spell.rune}）：分支 ${branch} 旋 ${got}°，应旋 ${want}° 才到 ${RUNE_COLOR[a.spell.rune]}`);
  }
});

/**
 * **不许播到素材的空尾之后。**
 *
 * 判据算自 `data/asset-profiles.json`：`(frames − tailEmpty) / fps`。冲击环
 * `[23 帧, 29.97fps, tailEmpty 3]` ⇒ 有内容的只有 667ms，写 767（播满）就是白等 3 帧。
 * fadeOut 也要在窗内收完，否则最后那一下是硬切不是淡出。
 */
test("士气冲击环：duration 与 fadeOut 都不超过素材的有内容时长", () => {
  for (const [a, c] of cuesOfRule("aftermath.morale")) {
    const p = visuals[c.file];
    assert.ok(p, `${c.file} 没有画面量测`);
    const contentMs = Math.round(((p.frames - p.tailEmpty) / p.fps) * 1000);
    assert.ok(c.duration <= contentMs,
      `${a.id}: duration ${c.duration} > 有内容时长 ${contentMs}（素材尾部 ${p.tailEmpty} 帧是空的）`);
    assert.ok(c.duration - c.fadeOut >= 0,
      `${a.id}: fadeOut ${c.fadeOut} 比 duration ${c.duration} 还长`);
    assert.ok(c.fadeIn > 0,
      `${a.id}: leadEmpty=${p.leadEmpty}，帧 0 就有内容，不给 fadeIn 会「啪」地弹出来`);
  }
});

/**
 * **不许往 persist 的配色地盘里挤。**
 *
 * `docs/ASSET-NOTES.md` 的 marker 撞色那一节记着：persist 12 组里紫只留 fear 一个，
 * skull 要靠 tint 才把对 fear 的 CIEDE2000 从 3.1 拉到 20.5。也就是说这一族的配色余量
 * 已经被 persist 用尽——常规档（每次打士气都会出的那一层）绝不能再落进去。
 *
 * 判据是**实解**出来的 persist 文件集合，不是抄一份清单。
 */
test("士气冲击环：常规档与 persist 槽的素材集合交集为空", () => {
  const persistFiles = new Set();
  for (const e of effects) {
    const plan = resolveEffect(e, {assets: mk(), armory: ARMORY});
    for (const c of plan?.cues ?? []) if (c.file) persistFiles.add(c.file);
  }
  assert.ok(persistFiles.size >= 10, `persist 只解出 ${persistFiles.size} 个素材，这条断言会退化成空过`);
  const collided = [...new Set(cuesOfRule("aftermath.morale").map(([, c]) => c.file))]
    .filter(f => persistFiles.has(f));
  assert.deepEqual(collided, [],
    `${collided.length} 个士气素材与 persist 槽撞车：${collided.join(", ")}`);
});

/* ============================================================ */
/*  二、士气：暴击是「多一层」不是「换一张图」                       */
/* ============================================================ */

/** 拿一条真语料改成单目标，再按需要把第一掷改成暴击。 */
function moraleSnapshot({critical}) {
  const base = actions.find(a => a.id === "spell.oblivion.touch");
  const s = JSON.parse(JSON.stringify(base));
  s.targets = [s.targets[0]];
  s.targets[0].results = [{result: 7, critical}];
  return s;
}

test("士气暴击：普通命中 1 层、暴击 2 层，第二层是恐惧烙印且晚 100-300ms", () => {
  const plain = planOf(moraleSnapshot({critical: false})).cues.filter(c => c.rule === "aftermath.morale");
  assert.equal(plain.length, 1, "非暴击不该出恐惧烙印");
  assert.match(plain[0].file, /Energy_Pulse_01_/);

  const crit = planOf(moraleSnapshot({critical: true})).cues.filter(c => c.rule === "aftermath.morale");
  assert.equal(crit.length, 2, "暴击应当在冲击环之外再补一枚恐惧烙印");
  assert.match(crit[0].file, /Energy_Pulse_01_/, "第一层仍是冲击环");
  assert.match(crit[1].file, /MarkerFear_01_Dark_Purple/, "第二层是恐惧烙印");
  const gap = crit[1].delay - crit[0].delay;
  assert.ok(gap >= 100 && gap <= 300,
    `烙印比冲击环晚 ${gap}ms，落在 100-300ms 之外——同帧压上去会糊成一团，太晚又读不成一件事`);
  assert.ok(crit[1].zIndex > crit[0].zIndex, "烙印该压在冲击环之上");
});

/**
 * 暴击这一档在 `actions.json` 上**一次都不触发**（全语料零暴击）。
 * 这条断言把这件事写成事实而不是让它悄悄成立：哪天语料里出现暴击，上面那条合成快照
 * 就不再是唯一证据，这里会红并提醒把它改成真语料断言。
 */
test("语料自查：actions.json 里没有暴击，所以暴击档只能靠合成快照取证", () => {
  const crits = actions.filter(a => (a.targets ?? []).some(t => (t.results ?? []).some(r => r.critical)));
  assert.deepEqual(crits.map(a => a.id), []);
});

/* ============================================================ */
/*  三、地面残留：sizePx 跟着模板半径走（批次 B 的遗留核实）          */
/* ============================================================ */

/**
 * `aftermath.groundResidue` 锚在裸 `{x, y}` 上，而 `scaleToObject` 在裸点上恒等于「一格」
 * ——播放层已经把那条路硬性拦掉（`play.mjs` 的 sizePx 分支）。拦掉之后**必须自己给尺寸**，
 * 否则落到「素材原生像素」那一档：本素材 600×600，而 blast 直径只有 240px，会画大 2.5 倍。
 *
 * 这里逐条核实批次 B 补的那个换算：圆形取直径、锥形取半径（锚点已挪到轴线中点），
 * 再乘「比区域略大一圈」的 1.15。期望值算自快照里的 `region`，与兵库无关。
 */
test("地面残留：24 条 cue 全部带 sizePx，且等于区域尺寸 × 1.15", () => {
  const hits = cuesOfRule("aftermath.groundResidue");
  assert.equal(hits.length, 24, `地面残留是 ${hits.length} 条，不是 24——语料或触发条件变了`);
  for (const [a, c] of hits) {
    const r = a.region;
    const span = r?.type === "circle" ? r.radius * 2 : r?.type === "cone" ? r.radius : null;
    assert.ok(Number.isFinite(span) && span > 0, `${a.id} 的 region 取不出尺寸：${JSON.stringify(r)}`);
    const want = Math.round(span * 1.15);
    assert.deepEqual(c.sizePx, {width: want, height: want},
      `${a.id}（${r.type} r=${r.radius}）: sizePx ${JSON.stringify(c.sizePx)}，应为 ${want}`);
    // sizePx 在场时不许再留 objectScale 的放大系数——两条路同时给尺寸时播放层只认一条，
    // 留着另一条只会让读代码的人以为它在起作用。
    assert.equal(c.objectScale, 1, `${a.id} 同时给了 sizePx 与 objectScale ${c.objectScale}`);
  }
});
