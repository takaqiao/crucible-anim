import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, bestFit, createAssets} from "../scripts/resolver/assets.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const backend = offlineBackend(index);

test("精确路径直接命中，不降级", () => {
  const r = bestFit(backend, "jb2a.melee_attack.01.shortsword");
  assert.equal(r.path, "jb2a.melee_attack.01.shortsword");
  assert.equal(r.diverged, false);
});

test("不存在的分支降级到同级第一个可用项并记录位置", () => {
  const r = bestFit(backend, "jb2a.melee_attack.01.没有这种武器");
  assert.equal(r.diverged, true);
  assert.equal(r.divergedAt, "jb2a.melee_attack.01");
  assert.ok(r.path.startsWith("jb2a.melee_attack.01."));
  assert.ok(r.options.length > 0, "应报告降级处的可选项");
});

test("resolve 返回真实文件路径", () => {
  const a = createAssets(backend);
  const r = a.resolve("jb2a.melee_attack.01.shortsword");
  assert.ok(r, "应解析出结果");
  assert.ok(r.file.endsWith(".webm"), `不是 webm: ${r.file}`);
  assert.ok(Array.isArray(r.files) && r.files.length >= 1);
});

test("_template 元数据随解析结果一并返回", () => {
  const a = createAssets(backend);
  const r = a.resolve("jb2a.melee_attack.01.shortsword");
  assert.ok(Array.isArray(r.template), "melee 分支应带 _template 三元组");
  assert.equal(r.template.length, 3);
});

test("含斜杠的输入按直接文件路径原样返回", () => {
  const a = createAssets(backend);
  const p = "modules/jb2a_patreon/Library/Generic/Impact/Foo.webm";
  const r = a.resolve(p);
  assert.equal(r.file, p);
  assert.equal(r.diverged, false);
});

test("colorsUnder 列出某特效实际可用的颜色", () => {
  const a = createAssets(backend);
  const colors = a.colorsUnder("jb2a.melee_attack.01.magic_sword");
  assert.ok(colors.includes("blue"), `实际颜色: ${colors.join(",")}`);
  assert.ok(colors.includes("orange"));
});

test("降级会累积进 warnings", () => {
  const a = createAssets(backend);
  a.resolve("jb2a.melee_attack.01.没有这种武器");
  assert.equal(a.warnings.length, 1);
  assert.equal(a.warnings[0].at, "jb2a.melee_attack.01");
});

test("解析不出任何东西时返回 null 而不抛错", () => {
  const a = createAssets(backend);
  assert.equal(a.resolve("完全不存在的命名空间.foo"), null);
});

/* ========== 运行时后端契约测试（模拟真实 Sequencer 4.2.3） ========== */

/**
 * 模拟真实 Sequencer.Database 的行为，基于实际源码：
 * - getEntry 精确命中返回对象，前缀匹配多条返回裸数组
 * - getPathsUnder 未命中返回 false，命中返回数组
 */
class MockSequencerDatabase {
  constructor(entries) {
    this.entries = entries; // {path: SequencerFile}
  }

  getEntry(path, {softFail = false} = {}) {
    if (!path) return softFail ? false : null;

    // 精确命中
    if (this.entries[path]) {
      return this.entries[path];
    }

    // 前缀匹配
    const matched = Object.entries(this.entries)
      .filter(([k]) => k.startsWith(path + ".") || k === path)
      .map(([, v]) => v);

    if (matched.length === 0) {
      return softFail ? false : null;
    }

    // 多条命中返回数组，单条返回对象
    return matched.length === 1 ? matched[0] : matched;
  }

  getPathsUnder(path) {
    if (!path) return false;

    const matched = Object.keys(this.entries)
      .filter(k => k.startsWith(path + "."))
      .map(k => k.split(".").slice(path.split(".").length).shift())
      .filter((v, i, a) => a.indexOf(v) === i);

    return matched.length > 0 ? matched : false;
  }
}

test("runtime: 精确命中返回单个对象", async () => {
  const {runtimeBackend} = await import("../scripts/resolver/assets.mjs");

  const swordEntry = {file: "sword.webm", template: [200, 300, 300]};
  const mockDb = new MockSequencerDatabase({
    "jb2a.melee_attack.01.shortsword": swordEntry
  });

  // 临时覆盖全局 Sequencer
  const oldSeq = globalThis.Sequencer;
  globalThis.Sequencer = {Database: mockDb};
  try {
    const backend = runtimeBackend();
    const entry = backend.getEntry("jb2a.melee_attack.01.shortsword");
    assert.ok(entry, "应返回非空");
    assert.equal(entry.file, "sword.webm");
    assert.deepEqual(entry.template, [200, 300, 300]);
  } finally {
    globalThis.Sequencer = oldSeq;
  }
});

test("runtime: 前缀匹配多条返回数组（关键修复 C1）", async () => {
  const {runtimeBackend} = await import("../scripts/resolver/assets.mjs");

  const blueEntry = {file: "blue.webm", template: [200, 300, 300]};
  const orangeEntry = {file: "orange.webm", template: [200, 300, 300]};

  const mockDb = new MockSequencerDatabase({
    "jb2a.melee_attack.01.shortsword.blue": blueEntry,
    "jb2a.melee_attack.01.shortsword.orange": orangeEntry
  });

  const oldSeq = globalThis.Sequencer;
  globalThis.Sequencer = {Database: mockDb};
  try {
    const backend = runtimeBackend();
    // 路径 shortsword 不精确存在，但前缀匹配到 blue 和 orange，返回数组
    const entry = backend.getEntry("jb2a.melee_attack.01.shortsword");
    assert.ok(entry, "应返回非空");
    // 应该取第一个数组元素
    assert.equal(entry.file, "blue.webm");
    assert.deepEqual(entry.template, [200, 300, 300]);
  } finally {
    globalThis.Sequencer = oldSeq;
  }
});

test("runtime: getPathsUnder 返回 false 时处理（关键修复 I1）", async () => {
  const {runtimeBackend} = await import("../scripts/resolver/assets.mjs");

  const mockDb = new MockSequencerDatabase({
    "jb2a.melee": {file: "melee.webm"}
  });

  const oldSeq = globalThis.Sequencer;
  globalThis.Sequencer = {Database: mockDb};
  try {
    const backend = runtimeBackend();
    // 请求不存在的路径，getPathsUnder 返回 false
    const paths = backend.getPathsUnder("完全不存在");
    assert.ok(Array.isArray(paths), "getPathsUnder 应返回数组而非 false");
    assert.equal(paths.length, 0, "应返回空数组");
  } finally {
    globalThis.Sequencer = oldSeq;
  }
});

test("runtime: getEntry softFail 返回 false 时处理", async () => {
  const {runtimeBackend} = await import("../scripts/resolver/assets.mjs");

  const mockDb = new MockSequencerDatabase({
    "jb2a.melee": {file: "melee.webm"}
  });

  const oldSeq = globalThis.Sequencer;
  globalThis.Sequencer = {Database: mockDb};
  try {
    const backend = runtimeBackend();
    // 请求不存在的路径，getEntry 返回 false
    const entry = backend.getEntry("完全不存在");
    assert.equal(entry, null, "getEntry 应返回 null 而非 false");
  } finally {
    globalThis.Sequencer = oldSeq;
  }
});

test("runtime 与 offline 返回值形状一致", async () => {
  const {runtimeBackend, offlineBackend: buildOfflineBackend} =
    await import("../scripts/resolver/assets.mjs");

  // 构造等价数据
  const mockDb = new MockSequencerDatabase({
    "jb2a.melee_attack.01.shortsword.blue": {
      file: "blue.webm",
      template: [200, 300, 300]
    }
  });

  const offlineIndex = {
    tree: {
      jb2a: {
        melee_attack: {
          "01": {
            shortsword: {
              blue: "blue.webm",
              _template: "melee"
            },
            _templates: {
              melee: [200, 300, 300]
            }
          }
        }
      }
    }
  };

  const oldSeq = globalThis.Sequencer;
  globalThis.Sequencer = {Database: mockDb};
  try {
    const runtimeBackendInst = runtimeBackend();
    const offlineBackendInst = buildOfflineBackend(offlineIndex);

    const runtimeEntry = runtimeBackendInst.getEntry("jb2a.melee_attack.01.shortsword.blue");
    const offlineEntry = offlineBackendInst.getEntry("jb2a.melee_attack.01.shortsword.blue");

    // 检查返回值的键集合与类型
    assert.ok(runtimeEntry && offlineEntry, "两者都应返回非空");
    assert.ok("file" in runtimeEntry && "file" in offlineEntry, "都应有 file 字段");
    assert.ok("template" in runtimeEntry && "template" in offlineEntry, "都应有 template 字段");

    // file 应该都是字符串或数组
    assert.ok(
      typeof runtimeEntry.file === "string" || Array.isArray(runtimeEntry.file),
      "runtime file 应是字符串或数组"
    );
    assert.ok(
      typeof offlineEntry.file === "string" || Array.isArray(offlineEntry.file),
      "offline file 应是字符串或数组"
    );

    // template 应该都是数组或 null
    assert.ok(
      Array.isArray(runtimeEntry.template) || runtimeEntry.template === null,
      "runtime template 应是数组或 null"
    );
    assert.ok(
      Array.isArray(offlineEntry.template) || offlineEntry.template === null,
      "offline template 应是数组或 null"
    );
  } finally {
    globalThis.Sequencer = oldSeq;
  }
});

/* ================================================================
 * Sequencer 的真实条目形态（2026-08-23 上机实测补的一组）
 *
 * 这组测试补的是本项目第 6 类失败模式的一个实例：**离线全绿、上机静默失效**。
 * 上面那些用例喂给 mock 的都是 `{file: "x.webm"}` 这种朴素对象，而
 * `Sequencer.Database.getEntry()` 实际返回的是三个 SequencerFile 子类之一，
 * 它们的 `.file` 形态各不相同（`sequencer.js:6374 / 6400 / 6490`）：
 *
 *   · SequencerFilePlain     —— 文件存在**私有字段 `#file`**，`.file` 是 undefined
 *   · SequencerFile          —— `.file` 是 string 或 string[]
 *   · SequencerFileRangeFind —— `.file` 是**按 ft 键的对象**
 *
 * 旧实现读 `e.file ?? e.files`，于是：Plain 拿到 undefined → 整条 cue 静默消失；
 * RangeFind 拿到对象 → 一路传到 Sequencer 的 preload，报
 * `each entry in inSrcs must be of type string`（这条是玩家实际撞到的）。
 *
 * 下面的假类只复刻**真实类的对外形态**，不复刻实现。形态本身由
 * test/sequencer-contract.test.mjs 钉在 Sequencer 源码上，那边红了说明上游改了 API。
 * ================================================================ */

/** 复刻 SequencerFilePlain：文件藏在私有字段里，只有 getAllFiles() 拿得到。 */
class FakePlain {
  #file;
  constructor(file) { this.#file = file; }
  getAllFiles() { return [this.#file]; }
}

/** 复刻 SequencerFile：`.file` 可能是 string 或 string[]。 */
class FakeSeqFile {
  constructor(file, template = null) { this.file = file; this.template = template; }
  getAllFiles() { return [this.file].flat(Infinity); }
}

/** 复刻 SequencerFileRangeFind：`.file` 是 `{"05ft": …, "30ft": …}`。 */
class FakeRangeFind {
  constructor(byFt) { this.file = byFt; }
  getAllFiles() { return Object.values(this.file).flat(Infinity); }
}

async function withMockDb(entries, fn) {
  const {runtimeBackend} = await import("../scripts/resolver/assets.mjs");
  const mockDb = new MockSequencerDatabase(entries);
  const old = globalThis.Sequencer;
  globalThis.Sequencer = {Database: mockDb};
  try { return fn(runtimeBackend()); } finally { globalThis.Sequencer = old; }
}

test("runtime: SequencerFilePlain 的私有字段也要取得到（否则 cue 静默消失）", async () => {
  await withMockDb({"jb2a.impact.005.white": new FakePlain("impact.webm")}, backend => {
    const e = backend.getEntry("jb2a.impact.005.white");
    assert.ok(e, "返回了 null —— 旧实现读 e.file 拿到 undefined 就是这个下场");
    assert.equal(e.file, "impact.webm");
  });
});

test("runtime: SequencerFileRangeFind 的 ft 键对象不能原样下发", async () => {
  const entry = new FakeRangeFind({"05ft": "near.webm", "30ft": "far.webm"});
  await withMockDb({"jb2a.ranged.beam.001.01.blue": entry}, backend => {
    const e = backend.getEntry("jb2a.ranged.beam.001.01.blue");
    assert.ok(e, "应返回非空");
    const files = Array.isArray(e.file) ? e.file : [e.file];
    for (const f of files) {
      assert.equal(typeof f, "string",
        "下发了非字符串 —— Sequencer 的 preload 会抛 " +
        "`each entry in inSrcs must be of type string`，这是玩家实际撞到的报错");
    }
    assert.deepEqual(files.sort(), ["far.webm", "near.webm"]);
  });
});

test("runtime: 一个条目内部的字符串变体数组整池带走", async () => {
  await withMockDb({"psfx.weapon-swooshes.light.v1.group01": ["a.ogg", "b.ogg", "c.ogg"]},
    backend => {
      const e = backend.getEntry("psfx.weapon-swooshes.light.v1.group01");
      assert.ok(e);
      assert.deepEqual(e.file, ["a.ogg", "b.ogg", "c.ogg"],
        "同一条目的变体池应整池带走，由 ctx.pick 用出手端 seeded rng 摇定");
    });
});

test("runtime: 前缀命中多个不同条目时仍只取第一条，不跨分支组池", async () => {
  await withMockDb({
    "jb2a.melee_attack.01.shortsword.blue": new FakeSeqFile("blue.webm", [200, 300, 300]),
    "jb2a.melee_attack.01.shortsword.orange": new FakeSeqFile("orange.webm", [200, 300, 300])
  }, backend => {
    const e = backend.getEntry("jb2a.melee_attack.01.shortsword");
    assert.equal(e.file, "blue.webm",
      "兄弟分支之间帧数/帧率可能不同（ASSET-NOTES 实测差到 1.83 倍），" +
      "而兵库的 startTime/duration 是逐条实测值 —— 跨分支随机会让这些数字配错素材");
    assert.deepEqual(e.template, [200, 300, 300], "模板要从被选中的那条上取");
  });
});

test("runtime: 精确路径不再触发逐级 getPathsUnder（消除弃用警告 + 省全库扫描）", async () => {
  const {createAssets} = await import("../scripts/resolver/assets.mjs");
  let pathsUnderCalls = 0;
  const backend = {
    getPathsUnder(p) { pathsUnderCalls++; return ["impact"]; },
    getEntry(p) { return p === "jb2a.impact.005.white" ? {file: "x.webm", template: null} : null; }
  };
  const assets = createAssets(backend);
  const r = assets.resolve("jb2a.impact.005.white");
  assert.equal(r.file, "x.webm");
  assert.equal(r.diverged, false);
  assert.equal(pathsUnderCalls, 0,
    "精确命中却仍在逐级下行。bestFit 的第一步查裸命名空间，会让 Sequencer 的 entryExists " +
    "打出 `matched via partial segment prefix` 弃用警告（jb2a 会先命中 jb2a-extras），" +
    "而且每级都要全库扫一遍。");
});

test("runtime: 路径不存在时仍走 bestFit 降级，divergence 警告照旧", async () => {
  const {createAssets} = await import("../scripts/resolver/assets.mjs");
  let pathsUnderCalls = 0;
  const tree = {"jb2a": ["impact"], "jb2a.impact": ["005"], "jb2a.impact.005": ["white"]};
  const backend = {
    getPathsUnder(p) { pathsUnderCalls++; return tree[p] ?? []; },
    getEntry(p) { return p === "jb2a.impact.005.white" ? {file: "x.webm", template: null} : null; }
  };
  const assets = createAssets(backend);
  const r = assets.resolve("jb2a.impact.999.purple");
  assert.ok(pathsUnderCalls > 0, "没命中就必须走降级 walk");
  assert.equal(r.file, "x.webm", "应降级到同级第一个可用项");
  assert.equal(r.diverged, true);
  assert.equal(assets.warnings.length, 1, "降级必须留下诊断");
});
