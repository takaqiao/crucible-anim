/**
 * **不许有「已经修好却还挂着 todo」的守卫。**
 *
 * ## 它堵的是哪个洞
 *
 * 批次 A 收口时 `test/geom-guard.test.mjs` 里有 9 条几何断言标着 `{todo}`——它们守的是
 * 批次 B 才修的已知缺陷，标 todo 是为了让 `# fail` 回到 0，好让「变异必须转红」有一条
 * 可机检的基准线。（批次 B 收口时这 9 条已全部摘完，见文末 BASELINE。）
 *
 * 代价是 Node 的 todo 语义：**通过时不计 pass、失败时不计 fail**。于是批次 B 修好一条
 * 几何缺陷之后，那条断言会变成「静默通过的 todo」——
 *
 *   · `# fail` 仍是 0，没有任何信号；
 *   · 而它从此对**任何**变异都给不出红——因为 todo 的失败不计入 fail。
 *
 * 也就是说：**修好一条缺陷 = 悄悄退休一条守卫**，且没有任何断言强制把 todo 摘掉。
 * 批次 A 的验收把这一条列为「遗留机制漏洞」，本文件就是那个漏洞的闸。
 *
 * ## 判据
 *
 * 跑一遍 geom-guard，看 TAP 输出里有没有 `ok N - ... # TODO`（= todo 却通过了）。
 * 有就红，并要求把那条的 `{todo}` 摘掉——摘掉之后它就是一条正常的常绿守卫，
 * 变异能再次点红它。
 *
 * ⚠ 判据必须同时要求行首是 `ok` / `not ok`：汇总行 `# todo 0` 也能被 `/# TODO/i`
 * 匹配上。旧版靠 `seen > 0` 做的「探测器还活着吗」检查正是被这行汇总喂饱的——todo 全摘
 * 干净之后它在**零条 todo** 的情况下照样绿（2026-08-29 批次 B 第 6 步实测踩到）。
 * 现在改成现造一份「一条通过 + 一条失败」的合成 todo 去验探测器，见 livenessLines()。
 *
 * ## 为什么要另开进程
 *
 * todo 的「通过 / 失败」是 **runner 层**的状态，测试体内部读不到自己的 todo 结果。
 * 唯一可靠的观测点是 TAP 输出，所以这里 spawn 一个子进程去跑。geom-guard 单文件
 * 约 1 秒，代价可接受；只跑它一个文件，不会递归到本文件自己。
 */
import {test} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import {mkdtempSync, rmSync, writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {fileURLToPath} from "node:url";
import {dirname, join, resolve} from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** 挂着 todo 的守卫所在的文件。将来别处也用 todo 时往这里加。 */
const TODO_FILES = ["test/geom-guard.test.mjs"];

/**
 * 跑一个测试文件，返回 TAP 行。
 * 用 `--test-reporter=tap` 是必需的：spec reporter 在非 TTY 下不打 `# fail` 汇总，
 * 也不带 `# TODO` 标记（批次 A 验收踩过这个坑）。
 */
function tapLines(file) {
  // ⚠ 必须把 `NODE_TEST_CONTEXT` 从子进程环境里摘掉。Node 靠它判断「我已经在测试里了」，
  // 见到它就拒绝再跑一遍：`Warning: node:test run() is being called recursively within a
  // test file. skipping running files.` —— 而且它只是**警告**，stdout 一片空、退出码 0，
  // 不显式检查 `# tests` 的话这条守卫会静默变成永远通过的空壳。
  const env = {...process.env};
  delete env.NODE_TEST_CONTEXT;
  // resolve 而不是 join：下面的探测器用的是 os.tmpdir() 下的绝对路径，
  // join(ROOT, 绝对路径) 会拼出一个不存在的路径。
  const r = spawnSync(process.execPath,
    ["--test", "--test-reporter=tap", resolve(ROOT, file)],
    {encoding: "utf8", cwd: ROOT, timeout: 120_000, env});
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  assert.ok(out.includes("# tests"), `跑 ${file} 没拿到 TAP 汇总，无法判定 todo 状态：\n${out.slice(0, 800)}`);
  return out.split(/\r?\n/);
}

/**
 * 一行 TAP 是不是「一条 todo 的结果」。
 *
 * TAP：失败的 todo 是 `not ok N - name # TODO ...`，通过的是 `ok N - name # TODO ...`。
 * ⚠ `^(not )?ok\s` 这半条不是装饰：汇总行 `# todo 0` 也能被 `/#\s*TODO/i` 匹配上
 * （2026-08-29 批次 B 第 6 步实测踩到——todo 全摘干净之后，旧版靠 `seen > 0` 做的
 * 「探测器还活着吗」检查被这行汇总喂饱了，于是它在**零条 todo**的情况下照样绿）。
 */
const isTodoLine = line => /#\s*TODO/i.test(line) && /^(not )?ok\s/.test(line);
const countTodos = file => tapLines(file).filter(isTodoLine).length;

/**
 * 探测器活性：现造一个「一条通过的 todo + 一条失败的 todo」的测试文件，证明上面那条判据
 * 真的认得出 TAP 里的 todo 标记。
 *
 * 为什么必须有这一步：本文件唯一的观测手段是文本匹配，而 TODO_FILES 里的 todo **本来就该
 * 被摘光**（批次 B 收口时正是 0 条）。零条 todo 时，「扫不到 todo」与「扫得到但没通过的」
 * 在输出上完全一样——不另造一个已知答案的样本，这条守卫就永远分不清自己是绿的还是瞎的。
 * 判据与 §1.5 的合成 cue 是同一个手法：先证明探测器活着，再去扫真语料。
 *
 * 写到 os.tmpdir() 而不是仓库里：跑测试不该往工作树里落文件。
 */
function livenessLines() {
  const dir = mkdtempSync(join(tmpdir(), "crucible-anim-todo-"));
  const file = join(dir, "liveness.test.mjs");
  writeFileSync(file,
    'import {test} from "node:test";\n'
    + 'import assert from "node:assert/strict";\n'
    + 'test("合成样本：通过的 todo", {todo: "探测器活性"}, () => {});\n'
    + 'test("合成样本：失败的 todo", {todo: "探测器活性"}, () => { assert.fail("故意的"); });\n');
  try { return tapLines(file); } finally { rmSync(dir, {recursive: true, force: true}); }
}

test("探测器活性：TAP 里的 todo 标记还认得出来", () => {
  const lines = livenessLines().filter(isTodoLine);
  assert.equal(lines.length, 2,
    "合成样本里明明有两条 todo，判据只认出 " + lines.length + " 条——"
    + "TAP 输出格式变了，本文件下面两条用例已经失明。\n" + lines.join("\n"));
  assert.equal(lines.filter(l => /^ok\s/.test(l)).length, 1, "应当认出一条通过的 todo");
  assert.equal(lines.filter(l => /^not ok\s/.test(l)).length, 1, "应当认出一条失败的 todo");
});

test("没有「已经修好却还挂着 todo」的守卫", () => {
  const retired = [];
  for (const file of TODO_FILES) {
    for (const line of tapLines(file)) {
      if (isTodoLine(line) && /^ok\s/.test(line)) retired.push(`${file}: ${line.slice(0, 160)}`);
    }
  }
  assert.deepEqual(retired, [],
    `${retired.length} 条守卫已经不再失败，却还挂着 {todo}。todo 的测试**失败时不计入 # fail**，`
    + "所以挂着不摘等于让这条守卫静默退休——它守的东西再被弄坏也不会有人知道。"
    + "把这几条的 `{todo}` 参数删掉，让它们回到常绿守卫的行列。");
});

/**
 * todo 的条数只许减不许增。
 *
 * 没有这一条，「把新写坏的断言标成 todo」就是一条绕开所有守卫的捷径。
 * 数字贴着实测：批次 B 每修好一条就该减一条，同步下调这里。
 */
test("todo 条数只许减不许增", () => {
  // 2026-08-29 批次 A 收口是 9 条；批次 B 第 5 步（travel.mjs）摘掉 §1.6 与 §1.5；
  // 第 6 步（impact.mjs）摘掉 §1.1 / §1.4 / §1.7 / §2.3 / §3.3；
  // 第 7 步（context.mjs）摘掉 §2.1 与 §2.2。**批次 B 收口是 0 条。**
  //
  // 基线到 0 之后本文件不但没退休，反而变成纯粹的棘轮：任何人想把一条写坏的断言标成
  // todo 藏起来，这里立刻转红。上面那条「探测器活性」保证 0 是真的 0，不是扫瞎了。
  const BASELINE = 0;
  const n = TODO_FILES.reduce((acc, f) => acc + countTodos(f), 0);
  assert.ok(n <= BASELINE, `todo 从 ${BASELINE} 涨到了 ${n}——新缺陷不许用 todo 藏起来`);
  assert.ok(BASELINE - n <= 1,
    `todo 已经降到 ${n}，基线还挂在 ${BASELINE}。跟仓库里其它棘轮一样，基线要贴着实测走。`);
});
