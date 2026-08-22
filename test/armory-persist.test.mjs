import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {resolve, resolveEffect} from "../scripts/resolver/resolve.mjs";
import {createContext} from "../scripts/resolver/context.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";
import persist, {NO_PERSIST} from "../scripts/armory/persist.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const effects = JSON.parse(readFileSync(join(ROOT, "test/fixtures/effects.json"), "utf8"));
const actions = JSON.parse(readFileSync(join(ROOT, "test/fixtures/actions.json"), "utf8"));
const mk = () => createAssets(offlineBackend(index));
const planFor = id => resolveEffect(effects.find(e => e.statusId === id), {assets: mk(), armory: ARMORY});

/** NO_PERSIST 的状态刻意不产 cue（见 persist.mjs），凡是逐状态遍历的断言都要先摘掉它们。 */
const audible = effects.filter(e => !NO_PERSIST.includes(e.statusId));

test("persist 规则表规模", () => {
  assert.ok(persist.length >= 14, `只有 ${persist.length} 条（静默 + 12 组 + 兜底）`);
});

test("每个 persist cue 都带 persist 与非空 tieTo，否则效果移除后动画不会清理", () => {
  for (const e of audible) {
    // 先钉住语料本身：fixture 若自己就没有 effectUuid，下面的 tieTo 断言会退化成
    // null === null 的同义反复，永远钉不住回归。
    assert.ok(e.effectUuid, `fixture ${e.statusId} 没有 effectUuid，这条断言测不出东西`);
    const plan = resolveEffect(e, {assets: mk(), armory: ARMORY});
    for (const c of plan.cues) {
      assert.equal(c.persist, true, `${e.statusId} 的 cue 没开 persist`);
      // 真值断言是主断言：tieTo 为空 ⇒ Sequencer 两条清理链路全部失效 ⇒ 光效永久残留。
      assert.ok(c.tieTo, `${e.statusId} 的 tieTo 是空值（${c.tieTo}），持久特效将无法清理`);
      // 再钉住绑的是「效果」而不是「token」：绑到 target.uuid 一样是真值，但那样只在
      // token 被删除时才清理，状态移除后光效照样留着。
      assert.equal(c.tieTo, e.effectUuid, `${e.statusId} 的 tieTo 不是 effectUuid`);
      // 对称自检：target.uuid 若为空，下面那条 notEqual 就退化成「真字符串 ≠ undefined」
      // 恒真，「绑到 token 而不是效果」这个它自称要防的回归一条都抓不住。
      assert.ok(e.target.uuid, `fixture ${e.statusId} 的 target 没有 uuid，notEqual 会退化成恒真`);
      assert.notEqual(c.tieTo, e.target.uuid, `${e.statusId} 绑到了 token 而不是效果`);
    }
  }
});

test("effectUuid 缺失时绝不产出 persist cue（宁可不画也不能留清不掉的光）", () => {
  // Sequencer 4.2.3 的持久化特效只有两条清理链路，都要求 tiedDocuments 可解析：
  // CanvasEffect 初始化时按 tiedDocuments 逐条 fromUuidSync 注册 delete 钩子；场景重载时
  // _validateEffect 按 tiedDocuments 是否还在剔除。tieTo 为空时两条都不生效，而
  // persist:true 又让 Sequencer 把特效持久化——光效永久残留、重载后照样回来，只能 GM
  // 手动 endAllEffects。上游 snapshotEffect 写的是 `effect.uuid ?? null`，本来就承认
  // uuid 可能缺，这里守住对应的下游行为。
  const samples = ["burning", "freezing", "weakened"].map(id => effects.find(e => e.statusId === id));
  for (const e of samples) {
    for (const bad of [null, undefined, ""]) {
      const plan = resolveEffect({...e, effectUuid: bad}, {assets: mk(), armory: ARMORY});
      const stuck = (plan?.cues ?? []).filter(c => c.persist);
      assert.deepEqual(stuck.map(c => c.rule), [],
        `${e.statusId} 在 effectUuid=${JSON.stringify(bad)} 时仍产出了 persist cue`);
    }
  }
  // 未知状态走 generic.persist 兜底，同样不得例外
  const unknown = resolveEffect({...samples[0], statusId: "__未来新增的状态__", effectUuid: null},
                                {assets: mk(), armory: ARMORY});
  assert.deepEqual((unknown?.cues ?? []).filter(c => c.persist), [], "兜底规则也不得放行");
});

test("同组状态共用素材，不同组视觉可区分", () => {
  const f = id => planFor(id).cues[0].file;
  assert.equal(f("poisoned"), f("diseased"), "同组应共用");
  assert.notEqual(f("burning"), f("freezing"), "不同组应可区分");
  const groups = new Set(audible.map(e => planFor(e.statusId).cues[0].rule));
  assert.ok(groups.size >= 10, `${audible.length} 个状态只归出 ${groups.size} 组，区分度不足`);
});

test("燃烧与冰冻命中专属规则而非兜底", () => {
  assert.notEqual(planFor("burning").cues[0].rule, "generic.persist");
  assert.notEqual(planFor("freezing").cues[0].rule, "generic.persist");
});

test("除 NO_PERSIST 外的状态都归了组（不落在 generic.persist 兜底上）", () => {
  const fallback = audible.filter(e => planFor(e.statusId).cues[0].rule === "generic.persist");
  assert.deepEqual(fallback.map(e => e.statusId), [],
    `${fallback.length} 个状态没有命中任何一组，落在了兜底上`);
});

test("NO_PERSIST 的状态确实一条 cue 都不产", () => {
  // 名单锁：与 test/armory-assets.test.mjs 的 LEGACY_UNVERIFIED 同构。「让某个状态不出
  // 特效」是一次产品决定（该状态从此在场上没有任何本模组的画面），不能靠往数组里悄悄加
  // 一行完成；反过来把 dead 拿掉也一样——每具尸体会重新挂上与 stunned 一模一样的青绿环。
  // 想改就得先改这一行，改动会出现在 diff 里。
  assert.deepEqual([...NO_PERSIST].sort(), ["dead"],
    "NO_PERSIST 变了：静默一个状态 / 取消静默都必须走评审并同步这条名单锁");
  for (const id of NO_PERSIST) {
    assert.equal(planFor(id), null, `${id} 不该产持续特效`);
    // 反过来钉住「静默」不是靠把它们从 fixture 里删掉实现的——否则「刻意静默」与
    // 「忘了归组」在测试里就分不出来了。
    assert.ok(effects.some(e => e.statusId === id), `${id} 应该仍在状态 fixture 里`);
  }
});

/* ─── 多客户端持久化契约（见 scripts/armory/persist.mjs 文件头） ───────────────── */

test("persist cue 一律不落世界存档、一律本地播放", () => {
  for (const e of audible) {
    const plan = resolveEffect(e, {assets: mk(), armory: ARMORY});
    for (const c of plan.cues) {
      assert.equal(c.worldPersist, false,
        `${e.statusId}/${c.rule}: 一旦让 Sequencer 落盘，N 个在线客户端会各写一条记录`
        + "（落盘判据里没有 !data.local 子句），GM 重载后光环叠 N 层");
      assert.equal(c.local, true,
        `${e.statusId}/${c.rule}: 本模组没有 socket 通路（DESIGN §5.4），非 local 的 cue 只有出手端看得见`);
    }
  }
});

test("persist 规则不得自行声明 local / worldPersist —— 这两项是槽级契约", () => {
  const e = effects[0];
  const ctx = createContext({assets: mk(), snapshot: e, seed: e.seed});
  for (const rule of persist) {
    if (!rule.when(e, ctx)) continue;
    for (const raw of [rule.build(e, ctx)].flat().filter(Boolean)) {
      for (const k of ["local", "worldPersist"]) {
        assert.equal(Object.hasOwn(raw, k), false,
          `规则 ${rule.id} 自己写了 ${k}；这两项只能由 resolve.mjs 的 CUE_DEFAULTS 决定，`
          + "逐条写等于把契约摊给每条规则，新增的那条一定会漏");
      }
    }
  }
});

/**
 * 三条契约的文本守卫。**不再用 existsSync 自我 skip**：那是一个「play.mjs 一改名，三条
 * 契约的唯一防线就无声退场、npm test 仍然退出 0」的后门。文件不在就让它硬失败。
 *
 * 文本守卫只是第一道防线，它证明不了「这几行真的在执行路径上」——注释、死代码、动态
 * 属性名都能整体绕过。真正承重的是 test/play-contract.test.mjs：那边用记录型 Sequence
 * 替身驱动真实的 playPlan()，断言的是构造链上**实际**调了什么。两者一并保留。
 */
test("播放层把持久化契约落到实处", () => {
  const src = readFileSync(join(ROOT, "scripts/player/play.mjs"), "utf8");
  assert.match(src, /\.temporary\(\s*cue\.worldPersist\s*!==\s*true\s*\)/,
    "persist 分支必须写成 .temporary(cue.worldPersist !== true)：用 !== true 而不是 === false，"
    + "字段缺失（旧 plan / 将来漏填默认值）时才会落在不写盘的安全侧");
  assert.match(src, /\.play\(\s*\{[^}]*\blocal:\s*true\b/,
    "seq.play() 必须带 local:true：否则 preload 会走 preloadForClients，"
    + "每个客户端各自向全场广播预载请求并等所有人应答");
  assert.doesNotMatch(src, /executeForOthers|remote:\s*true/,
    "本模组不使用 Sequencer socket（DESIGN §5.4）");
});

test("契约 3：整个 scripts/ 都不碰 Sequencer 的跨客户端 socket", () => {
  // 把面从一个文件扩到整个 scripts/：行为断言只能证明 seq.play() 没带那两个开关，
  // 证不了别处没有别的入口。这一条本来就是一条**仓库级政策**而不是某个函数的行为。
  const files = readdirSync(join(ROOT, "scripts"), {recursive: true, withFileTypes: true})
    .filter(d => d.isFile() && d.name.endsWith(".mjs"))
    .map(d => join(d.parentPath ?? d.path, d.name));
  assert.ok(files.length >= 10, `只扫到 ${files.length} 个源文件，扫描面可疑`);
  for (const file of files) {
    // 注释里可以谈论它（play.mjs 的 seq.play 注释就在解释为什么不用），
    // 所以只对剥掉块注释与整行行注释之后的代码正文断言。
    const code = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    assert.doesNotMatch(code, /executeForOthers|\bremote:\s*true/,
      `${file} 使用了 Sequencer 的跨客户端通路（DESIGN §5.4）`);
    // endEffects / endAllEffects 的第二个参数 push 默认 **true**，那一路就走
    // sequencerSocket（sequencer.js:11626-11639）——契约 3 的同一条红线，只是藏在
    // 默认参数里。Task 15 的兜底清理必须显式传 false。
    for (const [n, line] of code.split("\n").entries()) {
      if (!/\bend(All)?Effects\(/.test(line)) continue;
      assert.match(line, /,\s*false\s*\)/,
        `${file}:${n + 1} 调 end(All)Effects 未显式传 push=false，第二个参数默认 true 会走 socket`);
    }
  }
});

test("治疗动作产出 aftermath 辉光", () => {
  const base = actions.find(a => a.targets.length);
  const s = {...base, targets: [{...base.targets[0], healed: 12}]};
  const cues = resolve(s, {assets: mk(), armory: ARMORY}).cues.filter(c => c.slot === "aftermath");
  assert.ok(cues.length >= 1);
  assert.ok(cues[0].file);
});

test("兵库两文件均不引用绝对路径", () => {
  for (const f of ["aftermath.mjs", "persist.mjs"]) {
    const src = readFileSync(join(ROOT, "scripts/armory", f), "utf8");
    assert.ok(!src.includes("modules/"), `${f} 出现绝对路径`);
  }
});
