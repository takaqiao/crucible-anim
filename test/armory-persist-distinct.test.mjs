/**
 * persist 槽区分度守卫：12 组状态标记同时挂在场上，玩家必须能靠颜色反查是哪一组。
 *
 * 这条测试补的是 test/armory-persist.test.mjs 里 `groups.size >= 10` 与
 * `f("burning") !== f("freezing")` 那两条弱断言的空洞——它们只看「解析出来的 file
 * 字符串是不是同一个」，而 persist 层撞车的方式恰恰不是 file 相同：12 组取的是 12 个
 * 不同文件、12 条不同 DB 路径，数得整整齐齐，屏幕上却有三对是同一个颜色。
 * 出厂配置（f591c15）实测：
 *     3.1  decay / fear      两圈紫环，ASSET-NOTES skull 行：「把两者都缩到 100px 的
 *                            1 格 token 尺寸并排看，两圈完全糊成同一种斑点环，形状
 *                            提供的区分度是零」
 *    10.2  stun / buff       两圈青绿，语义正好相反（丧失行动 / 受保护）
 *    10.4  hidden / slow     压到 0.55 之后的淡灰蓝弧 vs 灰链，双双掉进无彩区
 * 三对全部能在 170 条测试全绿的情况下过关。
 *
 * 与 impact 层那条守卫（test/armory-element-distinct.test.mjs）的两点不同，都是**收紧**：
 *   1. impact 只在同一个模板家族内部判色差，跨家族豁免——理由是「形状本身已经把它们
 *      分开了」。persist 不做家族划分，12 组两两都判。依据是 ASSET-NOTES 对这一批
 *      marker 素材两次实测过形状在 token 尺寸上不提供区分度（skull 行与 stun 行，
 *      后者：「实渲 60px 对比……要到 240px 才分得出」），而且 persist 与 impact 不同——
 *      一次命中只播一种元素，一个 token 上却可以同时挂五六条状态，颜色就是索引本身。
 *   2. impact 有一张记名豁免表 SAME_TEMPLATE_ALLOWED。persist **不设豁免**：一套颜色
 *      索引里任何一对撞车都必须真修。真遇到「换不动」的一对（decay 就是：skull 四个
 *      分支全撞），出路是 tint，不是记一笔豁免——见 scripts/armory/persist.mjs 的
 *      decay/hidden 两条注释。
 *
 * lab 数字全部来自 tools/element-residual-colour.mjs 对真实 webm 的逐帧解码，跑的是
 * 该工具的 `--persist` 预设（见工具头注释里为什么 impact 那套取样规则不能直接拿来量
 * persist：debuff 会返回「全片没有非灰像素」、slow 会量到四角的深色烟雾而不是链环）。
 * 改素材、改 opacity、改 tint 之后都必须用那个脚本重算再同步到本文件的 PALETTE——
 * 下面的「PALETTE 不许陈旧」一条会逼出来。
 *
 * CIEDE2000 直接 import 工具里的那一份，全仓只此一处实现。
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {resolveEffect} from "../scripts/resolver/resolve.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import {NO_PERSIST} from "../scripts/armory/persist.mjs";
import {ciede2000} from "../tools/element-residual-colour.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const effects = JSON.parse(readFileSync(join(ROOT, "test/fixtures/effects.json"), "utf8"));
const mk = () => createAssets(offlineBackend(index));

/**
 * 出厂选材 + 实测屏幕残留色。
 *
 * path/opacity/tint  与 scripts/armory/persist.mjs 的 GROUP_FX 逐字对齐，由下面的对齐
 *                    测试校验。拆开写而不是只存一个 lab，是为了让「这个数字是在什么
 *                    配置下量出来的」写在纸面上：opacity 与 tint 都会改变屏幕颜色，
 *                    只钉 lab 的话改了 opacity 也不会有人发现 lab 过期了。
 * lab                屏幕残留色的 CIELAB。取样窗口是整段循环（persist 不裁），把每个
 *                    像素按 tint 乘色、按 opacity 合成到 0x303030 的已知底色上，再以
 *                    「合成后对底色的偏离量」为权重求平均——权重不是 alpha：marker
 *                    素材常自带大片高 alpha 的暗色配件（slow 那支四角的深色烟雾就是），
 *                    alpha 加权量到的是烟不是链。命令：
 *                      node tools/element-residual-colour.mjs --persist \
 *                        --opacity <opacity> [--tint <tint>] <file.webm>
 */
const PALETTE = Object.freeze({
  burning:  {path: "eskie.burn.embers.orange",                    opacity: 0.9,  tint: null,
             lab: [42.0, 11.7, 34.8]},
  freezing: {path: "jb2a.markers.snowflake.blue.01",              opacity: 0.85, tint: null,
             lab: [50.7, -9.0, -30.7]},
  poison:   {path: "jb2a.markers.poison.dark_green.01",           opacity: 0.75, tint: null,
             lab: [42.1, -30.1, 39.1]},
  decay:    {path: "jb2a.markers.skull.purple.01",                opacity: 0.8,  tint: "#e0a060",
             lab: [28.1, 42.0, -6.2]},
  bleed:    {path: "jb2a.markers.drop.red.01",                    opacity: 0.75, tint: null,
             lab: [31.7, 44.0, 31.8]},
  stun:     {path: "jb2a.markers.stun.dark_teal.01",              opacity: 0.85, tint: null,
             lab: [54.3, -30.7, -5.6]},
  fear:     {path: "jb2a.markers.fear.dark_purple.01",            opacity: 0.85, tint: null,
             lab: [33.8, 63.7, -62.5]},
  hidden:   {path: "jb2a.markers.smoke.ring.loop.bluepurple",     opacity: 0.55, tint: "#a0a0ff",
             lab: [30.8, 13.0, -27.9]},
  haste:    {path: "jb2a.markers.light.loop.yellow",              opacity: 1,    tint: null,
             lab: [46.6, -1.2, 11.5]},
  slow:     {path: "jb2a.markers.chain.standard.loop.01.grey",    opacity: 0.8,  tint: null,
             lab: [35.8, 1.5, -2.1]},
  buff:     {path: "jb2a.energy_field.01.green",                  opacity: 0.65, tint: null,
             lab: [50.3, -25.9, 17.8]},
  debuff:   {path: "jb2a.markers.runes.dark_black.01",            opacity: 1,    tint: null,
             lab: [17.8, 1.3, 0.4]}
});

/**
 * 分离阈值（CIEDE2000，屏幕残留色）。取 11.5 的理由是出厂配置上的四个实测锚点：
 *    3.1  decay / fear     —— 真撞车。ASSET-NOTES 实测形状在 token 尺寸上区分度为零
 *   10.2  stun / buff      —— 真撞车。两圈青绿，语义正好相反
 *   10.4  hidden / slow    —— 真撞车。两支都掉进无彩区，只剩一点点亮度差
 *   13.6  slow / debuff    —— **不是**撞车，是本表要保留的最紧的一对：银亮锁链
 *                             （L*35.8）对近黑符文（L*17.8），是一条刻意的亮度阶梯
 * 阈值必须落在 (10.4, 13.6]：低于 10.4，hidden/slow 修回去也不会红；高于 13.6，
 * slow/debuff 这对合法配色自己就是红的。11.5 两边留 1.1 / 2.1 的余量，同时与 impact
 * 层的 MIN_DELTA_E 取同一个数，全仓只有一个「感知上算不算同一个颜色」的门槛。
 *
 * 修完之后全表最紧的是 poison/buff 12.2，余量 0.7——与 impact 层的 0.7-0.9 同档，
 * 同样是**刻意的脆性**：往后任何一次换素材、调 opacity、加 tint 都可能触到它，
 * 那正是它存在的意义。触到了就重量一遍残留色，不要凭「绿和黄绿应该分得开」放行。
 */
const MIN_DELTA_E = 11.5;

/** 每组挑一个代表状态：从全量 fixture 反查命中该组规则的第一个 statusId。 */
function representatives() {
  const byRule = new Map();
  for (const e of effects) {
    const plan = resolveEffect(e, {assets: mk(), armory: ARMORY});
    if (!plan) continue;                       // NO_PERSIST 的状态刻意不产 cue
    if (!byRule.has(plan.cues[0].rule)) byRule.set(plan.cues[0].rule, e);
  }
  return byRule;
}

/** 某一组的 persist cue。 */
function groupCue(group, byRule) {
  const e = byRule.get(`status.${group}`);
  assert.ok(e, `没有任何 fixture 状态命中规则 status.${group}`);
  return resolveEffect(e, {assets: mk(), armory: ARMORY}).cues[0];
}

const GROUPS = Object.freeze(Object.keys(PALETTE));

/* -------------------------------------------------- */
/*  1. 结构层                                          */
/* -------------------------------------------------- */

test("PALETTE 覆盖 persist 的全部分组规则，一条不多一条不少", () => {
  const byRule = representatives();
  const rules = [...byRule.keys()].filter(r => r.startsWith("status.")).map(r => r.slice(7)).sort();
  assert.deepEqual(rules, [...GROUPS].sort(),
    "persist.mjs 的分组与本文件的 PALETTE 对不上——新增/删除分组必须同步补一行实测色，"
    + "否则新组不会进入下面的色差判定，等于白加");
});

test("12 组解析到 12 个互不相同的素材文件", () => {
  const byRule = representatives();
  const seen = new Map();
  const dup = [];
  for (const g of GROUPS) {
    const f = groupCue(g, byRule).file;
    if (seen.has(f)) dup.push(`${seen.get(f)} 与 ${g} 解析到同一个文件：${f}`);
    else seen.set(f, g);
  }
  assert.deepEqual(dup, [], dup.join("\n"));
});

/* -------------------------------------------------- */
/*  2. 选材层：PALETTE 不许陈旧                        */
/* -------------------------------------------------- */

test("PALETTE 与 persist.mjs 的实际解析逐条对齐（路径/opacity/tint），且都能无降级解析", () => {
  const byRule = representatives();
  for (const g of GROUPS) {
    const {path, opacity, tint} = PALETTE[g];
    const assets = mk();

    const r = assets.resolve(path);
    assert.ok(r, `${g}: ${path} 解析失败`);
    assert.equal(r.path, path, `${g}: ${path} 被降级/尾段被吞成了 ${r.path}`);
    assert.equal(assets.warnings.length, 0, `${g}: ${path} 解析留下了降级警告`);

    const cue = groupCue(g, byRule);
    const hint = "——下面的色差判定会拿着过期的 lab 数字放行。请用"
      + " `node tools/element-residual-colour.mjs --persist --opacity <o> [--tint <t>] <file>`"
      + " 重算并同步本文件的 path/opacity/tint/lab。";
    assert.equal(cue.file, r.file, `${g}: persist.mjs 换了素材，但 PALETTE 没跟着改${hint}`);
    assert.equal(cue.opacity, opacity, `${g}: persist.mjs 把 opacity 改成了 ${cue.opacity}${hint}`);
    assert.equal(cue.tint, tint, `${g}: persist.mjs 把 tint 改成了 ${cue.tint}${hint}`);
  }
});

/* -------------------------------------------------- */
/*  3. 感知层：12 组两两                               */
/* -------------------------------------------------- */

test(`12 组两两的屏幕残留色 CIEDE2000 不得低于 ${MIN_DELTA_E}`, () => {
  const bad = [];
  for (let i = 0; i < GROUPS.length; i++) {
    for (let j = i + 1; j < GROUPS.length; j++) {
      const a = GROUPS[i], b = GROUPS[j];
      const d = ciede2000(PALETTE[a].lab, PALETTE[b].lab);
      if (d < MIN_DELTA_E) {
        bad.push(`${a} 对 ${b}：ΔE00 = ${d.toFixed(1)} < ${MIN_DELTA_E}`
               + "（同一个 token 上可以同时挂这两条状态，颜色撞了就没有别的线索可用——"
               + "ASSET-NOTES 实测形状在 token 尺寸上区分度为零）");
      }
    }
  }
  assert.deepEqual(bad, [], `${bad.length} 对分组在屏幕上是同一个颜色：\n${bad.join("\n")}`);
});

test("本槽不设豁免：任何一对都必须真过阈值", () => {
  // 反向锁：impact 层有 SAME_TEMPLATE_ALLOWED，persist 刻意不设。这条测试没有名单可查，
  // 它守的是「将来有人想加一张豁免表时，得先把这条注释和这条断言一起删掉」——一次显式的
  // 决定，而不是在数组里悄悄多一行。
  const pairs = GROUPS.length * (GROUPS.length - 1) / 2;
  assert.equal(pairs, 66, `12 组应有 66 对，实际 ${pairs}`);
  const worst = [];
  for (let i = 0; i < GROUPS.length; i++) {
    for (let j = i + 1; j < GROUPS.length; j++) {
      worst.push([ciede2000(PALETTE[GROUPS[i]].lab, PALETTE[GROUPS[j]].lab), `${GROUPS[i]}/${GROUPS[j]}`]);
    }
  }
  worst.sort((a, b) => a[0] - b[0]);
  console.log("  [persist 区分度] 最紧的三对："
    + worst.slice(0, 3).map(w => `${w[1]} ${w[0].toFixed(1)}`).join("、"));
  assert.ok(worst[0][0] >= MIN_DELTA_E);
});

test("NO_PERSIST 的状态不占颜色槽", () => {
  // 静默的状态既不需要颜色，也不该被 representatives() 当成某一组的代表——它压根没有
  // cue。这条断言把「静默」与「颜色索引」两件事的边界钉住：静默名单一旦误收了某个
  // 分组里唯一的状态，上面的「PALETTE 覆盖全部分组」会先红。
  for (const id of NO_PERSIST) {
    assert.equal(resolveEffect(effects.find(e => e.statusId === id), {assets: mk(), armory: ARMORY}),
      null, `${id} 产出了 cue，但它在 NO_PERSIST 里`);
  }
});
