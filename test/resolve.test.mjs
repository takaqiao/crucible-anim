import {test} from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {dirname, join} from "node:path";
import {offlineBackend, createAssets} from "../scripts/resolver/assets.mjs";
import {createContext} from "../scripts/resolver/context.mjs";
import {resolve} from "../scripts/resolver/resolve.mjs";
import {ARMORY} from "../scripts/armory/index.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const index = JSON.parse(readFileSync(join(ROOT, "data/asset-index.json"), "utf8"));
const actions = JSON.parse(readFileSync(join(ROOT, "test/fixtures/actions.json"), "utf8"));
const mkAssets = () => createAssets(offlineBackend(index));
const strike = actions.find(a => a.tags.includes("strike") && a.targets.length);

test("rng 由 seed 决定，同 seed 同序列", () => {
  const a = createContext({assets: mkAssets(), snapshot: {seed: 42}, seed: 42});
  const b = createContext({assets: mkAssets(), snapshot: {seed: 42}, seed: 42});
  const sa = [a.rng(), a.rng(), a.rng()];
  const sb = [b.rng(), b.rng(), b.rng()];
  assert.deepEqual(sa, sb);
  assert.ok(sa.every(v => v >= 0 && v < 1));
  const c = createContext({assets: mkAssets(), snapshot: {seed: 43}, seed: 43});
  assert.notDeepEqual(sa, [c.rng(), c.rng(), c.rng()]);
});

test("geom.sizeScale 对大体型 token 放大 1.4 倍", () => {
  const small = createContext({assets: mkAssets(), snapshot: {seed: 1, origin: {width: 1}}, seed: 1});
  const big = createContext({assets: mkAssets(), snapshot: {seed: 1, origin: {width: 3}}, seed: 1});
  assert.equal(small.geom.sizeScale(), 1);
  assert.equal(big.geom.sizeScale(), 1.4);
});

test("geom.offsetFor 贴身不折半、隔格折半", () => {
  const ctx = createContext({assets: mkAssets(), snapshot: {seed: 1, origin: {width: 3}}, seed: 1});
  assert.equal(ctx.geom.offsetFor({adjacent: true}, 0.5), 3 * 0.5);
  assert.equal(ctx.geom.offsetFor({adjacent: false}, 0.5), (3 * 0.5) / 2);
});

test("解析产出带版本号与 cues 的计划", () => {
  const plan = resolve(strike, {assets: mkAssets(), armory: ARMORY});
  assert.ok(plan, "应产出计划");
  assert.equal(plan.v, 1);
  assert.ok(Array.isArray(plan.cues) && plan.cues.length > 0);
  for (const c of plan.cues) {
    assert.ok(["cast", "travel", "impact", "aftermath", "persist"].includes(c.slot));
    assert.ok(["effect", "sound", "shake"].includes(c.kind));
  }
});

test("解析确定：同快照两次结果完全相同", () => {
  const a = resolve(strike, {assets: mkAssets(), armory: ARMORY});
  const b = resolve(strike, {assets: mkAssets(), armory: ARMORY});
  assert.deepEqual(a, b);
});

test("高优先级规则截胡低优先级", () => {
  const probe = {
    ...strike,
    id: "__probe__",
    tags: ["__probe_tag__"]
  };
  const armory = {
    ...ARMORY,
    cast: [
      {id: "低", pri: 10, when: () => true, build: () => ({kind: "effect", file: "低"})},
      {id: "高", pri: 900, when: s => s.tags.includes("__probe_tag__"),
       build: () => ({kind: "effect", file: "高"})}
    ]
  };
  const plan = resolve(probe, {assets: mkAssets(), armory});
  const cast = plan.cues.find(c => c.slot === "cast");
  assert.equal(cast.rule, "高");
  assert.equal(cast.file, "高");
});

test("build 返回 null 时该槽静默跳过，不产生空 cue", () => {
  const armory = {...ARMORY, cast: [{id: "空", pri: 900, when: () => true, build: () => null}]};
  const plan = resolve(strike, {assets: mkAssets(), armory});
  assert.equal(plan.cues.some(c => c.slot === "cast"), false);
});

test("每个 cue 的数值字段无 NaN / undefined / 负时长", () => {
  for (const s of actions.slice(0, 120)) {
    const plan = resolve(s, {assets: mkAssets(), armory: ARMORY});
    if (!plan) continue;
    for (const c of plan.cues) {
      for (const k of ["delay", "duration", "fadeIn", "fadeOut", "opacity", "objectScale"]) {
        const v = c[k];
        if (v === undefined || v === null) continue;
        assert.ok(Number.isFinite(v), `${s.id}.${c.rule}.${k} = ${v}`);
        if (k !== "waitUntilFinished") assert.ok(v >= 0, `${s.id}.${c.rule}.${k} 为负`);
      }
    }
  }
});
