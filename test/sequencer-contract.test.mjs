/**
 * 静态断言：把 player/play.mjs 依赖的 Sequencer 语义锁回 Sequencer 自己的源码。
 *
 * 这些断言不检查本仓库的任何代码，它们检查的是**判据本身还在不在**：Sequencer 一升级，
 * play.mjs 里那些「因为 Sequencer 会 throw 所以这么写」「因为这里是死代码所以能删」的
 * 注释就可能失效，而行为型测试（test/play-contract.test.mjs）只会继续绿——它用的是桩。
 * 两者必须成对存在：一个管「我们说的话对不对」，一个管「我们据以说话的那本书变没变」。
 *
 * 与 test/source-tables.test.mjs / test/coverage.test.mjs 同样的写法：路径写死、
 * readFileSync 直接读，文件不在就让测试硬失败，绝不 skip。
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {SEQUENCER_DIR} from "../tools/paths.mjs";

const SEQ_DIR = SEQUENCER_DIR;
const src = readFileSync(`${SEQ_DIR}/dist/sequencer.js`, "utf8");
const manifest = JSON.parse(readFileSync(`${SEQ_DIR}/module.json`, "utf8"));
const occurrences = needle => src.split(needle).length - 1;

test("Sequencer 版本仍在核对过的范围内", () => {
  assert.equal(manifest.id, "sequencer");
  assert.match(manifest.version, /^4\.2\./,
    `本仓库对 Sequencer 的全部语义判读基于 4.2.3；实际装的是 ${manifest.version}，`
    + "升级后必须重新逐条核对 player/play.mjs 的注释与本文件的断言");
});

test("stretchTo 与 scaleToObject 仍是互斥的（play.mjs 的 else-if 靠这条成立）", () => {
  assert.equal(occurrences("while scaling to fit another"), 1,
    "_expressWarnings 里那条 throw 不见了或改了措辞");
  assert.equal(occurrences("while trying to randomly rotate"), 1,
    "stretchTo × randomRotation 的互斥判据变了");
  assert.equal(occurrences("while moving towards it?"), 1,
    "stretchTo × moveTowards 的互斥判据变了");
  assert.equal(occurrences("Could not determine where to play the effect!"), 1,
    "「说不出在哪播」的 throw 判据变了");
});

test("stretchTo 分支下 scaleToObject 仍然是死代码（尺寸只由距离缩放决定）", () => {
  assert.match(src, /if \(this\.data\.stretchTo\) \{\s*await this\._applyDistanceScaling\(\);\s*\}\s*if \(!this\.data\.stretchTo\) \{\s*this\._transformNoStretchSprite\(\);\s*\}/,
    "_transformSprite 的二选一结构变了：一旦 stretchTo 与 scaleToObject 能同时生效，"
    + "play.mjs 的 else-if 就从「去掉死代码」变成「丢掉一次真实缩放」，须重新评估");
  assert.equal(occurrences("if (this.data.scaleToObject) {\n      this._applyScaleToObject("), 1,
    "scaleToObject 的唯一消费点（_transformNoStretchSprite 内）变了");
  assert.match(src, /const ray = new foundry\.canvas\.geometry\.Ray\(this\.sourcePosition, this\.targetPosition\);\s*this\._rotateTowards\(ray\);/,
    "_applyDistanceScaling 不再自己按 source→target 射线转向；"
    + "play.mjs「带 stretchTo 就不调 rotateTowards」的前提变了");
  assert.match(src, /const widthWithPadding = textureWidth - \(startPoint \+ endPoint\);\s*const spriteScale = distance \/ widthWithPadding;/,
    "_getDistanceScaling 的算法变了");
});

test("run() 里的 throw 仍然会让 _execute() 的 Promise 永不 settle", () => {
  assert.match(src, /return new Promise\(async \(resolve\) => \{\s*setTimeout\(async \(\) => \{/,
    "Section._execute 的 Promise/setTimeout 结构变了，挂死路径的论证需要重做");
  assert.match(src, /if \(!this\._deserializedData\) this\._expressWarnings\(\);/,
    "_expressWarnings 不再在 EffectSection.run() 里调用");
  assert.match(src, /get _waitAnyway\(\) \{\s*return \(this\._async \|\| this\._waitUntilFinished\) && this\._isLastRepetition \|\| this\._isLastRepetition && this\._isLastSection;\s*\}/,
    "_waitAnyway 变了：从前它保证「最后一条 section 无论如何都被 await」，挂死才是必然的");
  assert.match(src, /promises\.push\(await section\._execute\(\)\);/,
    "Sequence.play() 不再对 shouldWaitUntilFinished 的 section 直接 await");
  assert.match(src, /return Promise\.allSettled\(promises\)\.then\(/,
    "Sequence.play() 末尾不再 allSettled：任何一个不 settle 的 section 都会让 playPlan() 永不返回");
});

test("Section 一被创建就进了 sections 数组（play.mjs 的 catch 必须自己撤下来）", () => {
  assert.equal(occurrences("this.sections.push(effect2);\n    return effect2;"), 1,
    "Sequence.effect() 不再是「先 push 再 return」；dropSection 的前提变了");
  assert.equal(occurrences("this.sections.push(sound);\n    return sound;"), 1,
    "Sequence.sound() 不再是「先 push 再 return」");
  assert.equal(occurrences("this.sections = [];"), 1,
    "Sequence.sections 不再是普通数组，dropSection 的 splice 可能不再安全");
});

test("playIf(false) 仍能在 run() 之前完全短路（dropSection 的兜底靠它）", () => {
  assert.match(src, /playIf\(inCondition\) \{\s*this\._playIf = inCondition;\s*return this;\s*\}/,
    "playIf 开始做入参校验了，dropSection 的兜底分支可能自己抛错");
  assert.match(src, /if \(!await this\._shouldPlay\(\)\) \{\s*this\.sectionStatus = CONSTANTS\.STATUS\.SKIPPED;\s*return;\s*\}/,
    "_execute 不再在 _shouldPlay 为假时提前 return");
});

test("时间窗口：duration 是 clamp 上限，绝对终点只能靠 timeRange 的 isRange", () => {
  assert.match(src, /this\._animationDuration = clamp\(this\.endTimeMs - this\.startTimeMs, 0, this\._animationDuration\);/,
    "_calculateDuration 的 clamp 变了；applyTimeWindow 的换算需要重做");
  assert.match(src, /this\._endTime = this\.data\.time\.isRange \? this\.data\.time\.end\.value : this\._animationDuration - this\.data\.time\.end\.value;/,
    "time.isRange 不再决定 end 是绝对终点还是「从末尾裁掉多少」");
  assert.match(src, /timeRange\(inMsStart, inMsEnd\) \{[\s\S]{0,400}?this\._isRange = true;/,
    "timeRange 不再置 _isRange；那就没有任何入口能表达绝对终点了");
  for (const m of ["startTime", "startTimePerc", "endTime", "endTimePerc"]) {
    assert.match(src, new RegExp(`${m}\\(in(Ms|Percentage)\\) \\{[\\s\\S]{0,400}?this\\._isRange = false;`),
      `${m}() 不再显式把 _isRange 置假——timeRange 与它们的互斥关系变了`);
  }
  assert.match(src, /this\.duration = this\.data\.duration === false \? this\.endTime - this\.startTime : this\.data\.duration;/,
    "SoundSection 对 data.duration 的解释变了（它与 EffectSection 相反正是选 (A) 语义的理由之一）");
});

test("rotateTowards 的边缘 pivot 与 anchor 的抵消关系", () => {
  assert.match(src, /if \(this\.data\.rotateTowards && !this\.data\.rotateTowards\.template && !this\.data\.anchor\) \{/,
    "_setAnchors 的 pivot 判据变了：play.mjs 靠给一个显式 anchor 走 else 分支");
  assert.match(src, /this\.spriteContainer\.pivot\.set\(this\.sprite\.width \* -0\.5, 0\);/,
    "那条 -w/2 的 pivot 位移不见了；play.mjs 的 anchor 配对可能已无必要");
  assert.match(src, /get _target\(\) \{\s*return this\._stretchTo \|\| this\._rotateTowards \|\| this\._moveTowards \|\| false;\s*\}/,
    "_target 取值器变了：stretchTo 与 rotateTowards 的优先级是「带 stretchTo 就不转向」的依据");
  assert.match(src, /if \(this\.data\.missed && \(!source2 \|\| !this\.data\.target\)\) \{/,
    "_getOffset 的 missed 判据变了：「有 data.target 就不挪源点」是那条 warn 的依据");
});

test("零长拉伸仍会报错并把 spriteScale 算成 0", () => {
  assert.equal(occurrences("You are stretching over a distance of"), 1,
    "零距离拉伸的报错不见了；travel.mjs 的 originAnchor 注释需要重写");
  assert.match(src, /this\._updateCurrentFilePath\(false, true\);/,
    "_initialize 不再以 showDistanceWarning=true 调用 _updateCurrentFilePath");
});

test("atLocation 的 gridUnits 仍然只在 inOptions.offset 分支里生效（所以 play.mjs 不传它）", () => {
  const at = src.slice(src.indexOf("  atLocation(inLocation, inOptions = {}) {"));
  const body = at.slice(0, at.indexOf("\n  }\n"));
  assert.ok(body.includes("gridUnits: false"), "atLocation 的默认选项里没有 gridUnits 了");
  const uses = body.split("gridUnits").length - 1;
  assert.equal(uses, 1,
    "atLocation 现在自己用起 gridUnits 了（从前它只是 mergeObject 的一个默认值、"
    + "只随 inOptions.offset 转交给 _validateOffset）——play.mjs 删掉那个参数的理由需要复核");
});

test("持久化与清理：落盘判据、origin 过滤、endEffects 的 push 默认值", () => {
  assert.match(src, /if \(data\.persist && setFlags && effect2\.context && effect2\.owner && !effect2\.isSourceTemporary && !data\.temporary && !data\.remote\) \{/,
    "落盘判据变了（注意它至今没有 !data.local 子句，.locally() 拦不住写盘）");
  assert.match(src, /this\._temporaryEffect = inBool \|\| this\._temporaryEffect;/,
    "temporary() 不再是 sticky-OR");
  assert.match(src, /\(!inFilter\.origin \|\| inFilter\.origin === effect2\.data\.origin\)/,
    "_filterEffects 的 origin 子句变了");
  assert.match(src, /static async endEffects\(inFilter = \{\}, push2 = true\) \{/,
    "endEffects 的第二个参数默认值变了——Task 15 的兜底清理必须显式传 false");
  assert.match(src, /\(!this\.data\.local \|\| this\.data\.creatorUserId === game\.user\.id\)/,
    "CanvasEffect.shouldPlay 的 local 子句变了；CUE_DEFAULTS.worldPersist 的说理依赖它");
});

test("裸文件路径走 SequencerFilePlain（所以两端 padding 按 0 算）", () => {
  assert.match(src, /if \(typeof inData === "string" && !inDBPath && !inMetadata\) \{\s*return new SequencerFilePlain\(inData\);/,
    "SequencerFileBase.make 对裸字符串的处理变了");
  assert.match(src, /const startPoint = this\.template\?\.startPoint \?\? 0;/,
    "两端 padding 不再来自 template；本仓库喂的是裸文件路径，padding 恒按 0 算这条结论要重看");
  assert.match(src, /this\._template = this\.data\.template;/,
    "CanvasEffect 不再从 data.template 初始化 _template：若将来要补 padding，"
    + ".template() 对裸路径素材将不再生效");
});

test("持久特效的 run() 等的是一个只有 endEffect() 才兑现的 promise", () => {
  // playPlan() 对带 persist cue 的计划提前返回（不 await seq.play()），全部依据在这里。
  // 这四条只要有一条变了，"持久序列永不 settle" 就不再成立，那个提前返回要么多余、
  // 要么变成真的丢等待；tools/fake-sequencer.mjs 的 sectionBlocks 也会开始模拟一个
  // 不再成立的行为——测试全绿而线上表现相反。
  assert.match(src, /if \(this\._persist\) \{\s*totalDuration \+= await canvasEffectData\.promise;\s*\} else \{\s*totalDuration \+= await canvasEffectData\.duration;\s*\}/,
    "EffectSection.run() 不再对 _persist 走 canvasEffectData.promise —— "
    + "playPlan 对 persist 计划提前返回的理由需要重新论证");
  assert.match(src, /const finishPromise = new Promise\(async \(resolve, reject\) => \{\s*this\._resolve = resolve;/,
    "CanvasEffect.play() 的 finishPromise 结构变了");
  assert.match(src, /endEffect\(\) \{\s*if \(this\._ended\) return;\s*this\._durationResolve\?\.\(0\);[\s\S]{0,120}?this\._resolve\?\.\(this\.data\);/,
    "endEffect() 不再是兑现 finishPromise 的地方");
  assert.equal(occurrences("class PersistentCanvasEffect extends CanvasEffect {"), 1,
    "PersistentCanvasEffect 不见了：持久特效可能又走回会自然结束的那条路");
  // PersistentCanvasEffect 覆写掉的 _setEndTimeout 是"持久特效不会自然结束"的关键：
  // 基类那份会 `this._resolve(this.data); this.endEffect();`，覆写版只暂停媒体。
  const persistent = src.slice(src.indexOf("class PersistentCanvasEffect extends CanvasEffect {"));
  const override = persistent.slice(persistent.indexOf("_setEndTimeout() {"));
  assert.ok(!override.slice(0, override.indexOf("\n  }\n")).includes("_resolve"),
    "PersistentCanvasEffect._setEndTimeout 开始 resolve 了：持久特效变成会自然结束，"
    + "playPlan 的提前返回与 tools/fake-sequencer.mjs 的 sectionBlocks 都要重看");
});

test("假 Sequencer 的方法白名单全部在 Sequencer 源码里找得到定义", async () => {
  const {EFFECT_METHODS, SOUND_METHODS} = await import("../tools/fake-sequencer.mjs");
  const names = new Set([...EFFECT_METHODS, ...SOUND_METHODS]);
  assert.ok(names.size >= 40, `白名单只有 ${names.size} 个方法，桩可能被削过`);
  for (const m of names) {
    assert.match(src, new RegExp(`^\\s{2,4}${m}\\(`, "m"),
      `.${m}() 在 sequencer.js 里找不到定义——桩比真 Sequencer 宽容，`
      + "契约测试会放行一个上机即 TypeError 的调用");
  }
});

/**
 * 三个 SequencerFile 子类的形态。
 *
 * `scripts/resolver/assets.mjs` 的 `flattenEntry()` 建立在两条上游事实上：
 *   1. `getEntry()` 返回的是这三个子类之一（或它们的数组、或 ft 解析后的字符串/数组）
 *   2. 三个子类**都**实现了 `getAllFiles()`，那是唯一能同时应付
 *      「私有字段」「string」「string[]」「ft 键对象」四种内部存储的对外 API
 *
 * 上游一旦改名或删掉 `getAllFiles`，`flattenEntry` 会安静地退回到 `.file ?? .files` 兜底，
 * 于是 Plain 类的 cue 再次静默消失、RangeFind 再次把对象下发给 preload——
 * **正是 2026-08-23 上机撞到的那两个 bug**。这条守卫让上游漂移先把测试打红。
 */
test("三个 SequencerFile 子类都还在，且都实现 getAllFiles", () => {
  for (const cls of ["SequencerFilePlain", "SequencerFile", "SequencerFileRangeFind"]) {
    assert.ok(src.includes(`class ${cls}`), `Sequencer 里找不到 ${cls}`);
  }
  // 三个类各有一处 getAllFiles 定义
  assert.ok(occurrences("getAllFiles()") >= 3,
    `getAllFiles() 的定义少于 3 处（实测 ${occurrences("getAllFiles()")}）——` +
    "assets.mjs 的 flattenEntry 依赖这个统一出口");
});

test("SequencerFilePlain 的文件仍存在私有字段里（.file 读不到）", () => {
  const i = src.indexOf("class SequencerFilePlain");
  assert.notEqual(i, -1);
  const body = src.slice(i, i + 900);
  assert.match(body, /#file/,
    "SequencerFilePlain 不再用私有字段了。若它改成公开 `file`，flattenEntry 的 " +
    "getAllFiles 优先策略仍然正确，但这条守卫记录的『为什么必须用 getAllFiles』就过期了");
  assert.match(body, /getAllFiles\(\)\s*\{\s*return\s*\[this\.#file\]/,
    "SequencerFilePlain.getAllFiles 的实现变了");
});

test("SequencerFileRangeFind 的 file 仍是按 ft 键的对象", () => {
  const i = src.indexOf("class SequencerFileRangeFind");
  assert.notEqual(i, -1);
  const body = src.slice(i, i + 1400);
  assert.match(body, /getAllFiles\(\)\s*\{\s*return\s*Object\.values\(this\.file\)/,
    "RangeFind.getAllFiles 不再是 Object.values(this.file) —— " +
    "说明 .file 的形态变了，flattenEntry 里那条 ft 键对象兜底要重新核");
  assert.match(body, /getFile\(inFt\s*=\s*"15ft"\)/,
    "RangeFind.getFile 的 ft 默认值变了（选档逻辑的前提）");
});

test("entryExists 的部分前缀匹配仍会告警（快路径存在的理由）", () => {
  assert.match(src, /matched via partial segment prefix/,
    "Sequencer 不再打这条弃用警告了。assets.mjs 的『先试完整路径』快路径主要为它而设——" +
    "警告没了不代表快路径该删（省全库扫描那条理由仍成立），但注释要更新");
  assert.match(src, /this\.flattenedEntries\.find\(\(entry\) => entry\.startsWith\(inString\)\)/,
    "entryExists 的匹配方式变了：它用的是裸 startsWith，所以查 `jb2a` 会命中 " +
    "`jb2a-extras...`。这是快路径要绕开的具体机制。");
});
