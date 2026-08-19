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
