import {MODULE_ID} from "./const.mjs";
import {debug, warn} from "./log.mjs";

/**
 * 把本模组自带的 `data/sfx-index.json` 注册进 Sequencer 的 `canim` 命名空间。
 *
 * ## 为什么要自己注册
 *
 * 两批最对口的战斗音效在本机**没有** Sequencer 数据库：
 *   · `assets/MGS/ogg/SFX`（2263 条）是裸素材目录，根本不是模组；
 *   · `soundfxlibrary` 是模组，但它的注册代码依赖未安装的 SoundBoard，
 *     `sequencerReady` 里抛 `SoundBoard is not defined`，命名空间不存在。
 *
 * 注册进 DB 之后，`ctx.pick("canim.mgs.…")` 与任何 jb2a/eskie 路径走的是**同一条解析链**：
 * `bestFit` 降级、数组随机池、预览宏、聊天卡重放全部零改动可用。
 * 备选方案（给 resolver 加第二个后端）要在 `assets.mjs` 里分叉命名空间判断，
 * 每个消费者都得记住「这条路径走哪个后端」——那是必然会漏的地方。
 *
 * ## 文件为什么一定取得到
 *
 * 已核实 Foundry v14.366 的 `dist/server/express.mjs`：
 * `express.static(this.paths.data)` **无条件服务整个 Data 目录**，只挡 LevelDB 内部文件
 * （`.db` / `.ldb` / `MANIFEST-*` / `CURRENT` / `LOCK` / `LOG`）。与素材所属模组启没启用无关，
 * 与它是不是模组都无关——`assets/` 下的裸目录同样服务。
 *
 * ## 失败必须是软失败
 *
 * 索引读不到或 Sequencer 不在时**只警告不抛**：音效缺失应当降级成「没声音」，
 * 而不是掀翻整个挂载流程。调用方（main.mjs）在 try 块里，抛出去会让 `state.active`
 * 停在 false，连画面一起没了——那比没声音坏得多。
 */
export async function registerSfxDatabase() {
  if (typeof Sequencer === "undefined" || !Sequencer?.Database?.registerEntries) { // foundry-global-ok
    warn("Sequencer.Database 不可用，跳过音效索引注册");
    return false;
  }

  let index;
  try {
    const res = await fetch(`modules/${MODULE_ID}/data/sfx-index.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    index = await res.json();
  } catch (err) {
    warn("读取 data/sfx-index.json 失败，裸路径音效将不可用（画面不受影响）", err);
    return false;
  }

  const tree = index?.tree?.canim;
  if (!tree || typeof tree !== "object") {
    warn("data/sfx-index.json 里没有 tree.canim —— 重跑 npm run index:sfx");
    return false;
  }

  try {
    // override=true：本命名空间只有我们注册，重复注册（如 F5 后模组重载）时
    // 应当整棵替换而不是 mergeObject 叠加——叠加会把上一版删掉的条目留在树上。
    Sequencer.Database.registerEntries("canim", tree, false, true); // foundry-global-ok
    const n = Object.values(index.sources ?? {}).reduce((a, s) => a + (s.files ?? 0), 0);
    debug(`音效索引已注册：canim（${n} 个文件，${index.excluded?.length ?? 0} 条 ≥${index.longSeconds}s 未收录）`);
    return true;
  } catch (err) {
    warn("registerEntries('canim') 失败，裸路径音效将不可用", err);
    return false;
  }
}
