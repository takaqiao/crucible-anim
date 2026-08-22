/**
 * Token 的两种运行时形状，各造一份**与 foundry / Crucible 源码逐字对齐**的 mock。
 *
 * 这个文件存在的唯一理由是 Task 14 的 Critical-1：此前所有用例里的 token 都被手搓成
 * `{id, document: {width, height, elevation}, center: {x, y}}`——那是一个现实中
 * **不存在**的对象（真 placeable 的 `.document` 上一定有 x/y/id/uuid，真
 * TokenDocument 上一定没有 `center`）。tokenGeom 照这个假形状写，277 条测试全绿，
 * 而线上贴身判定恒为真、`ref:"point"` 的模板锚点全画在场景左上角。所以 token mock
 * 一律从这里取，不要再在用例里手搓字面量。
 *
 * 放 tools/ 而不是 test/helpers/：`node --test test/` 会把 test/ 下（含子目录）的每个
 * .mjs 都当测试文件跑一遍，纯工具文件会贡献一条空的 pass 记录，把基线计数搅浑（实测
 * 加进去 277→278）。tools/fake-sequencer.mjs 出于同一个理由放在这里，本文件沿用它。
 *
 * 形状依据（行号均已核对）：
 *   · TokenDocument＝**动作路径**拿到的东西（crucible/module/models/action.mjs:1541-1545
 *     的 `if (token instanceof Token) token = token.document`，与 1719 的注释
 *     「this.token is a TokenDocument」）。x/y 是**左上角**像素坐标；width/height 是
 *     **格数**；`getCenterPoint(data={})` 见 foundry common/documents/token.mjs:506-530，
 *     返回 `{x, y, elevation}`；`getSize(data={})` 见同文件 481-494，返回**像素**
 *     `{width, height}`。这里只实现两者的方格分支（`grid.isHexagonal` 为假）。
 *   · Token placeable＝**状态路径**拿到的东西（foundry client/documents/actor.mjs:286-296，
 *     `getActiveTokens(linked=false, document=false)` push 的是 `t.object`）。
 *     `get center()` 见 client/canvas/placeables/token.mjs:448-451（转调
 *     `document.getCenterPoint()`，真实返回 PIXI.Point，这里用普通 {x,y} 代替）；
 *     `get w()/get h()` 见同文件 431-433 / 441-443（转调 `document.getSize()`）；
 *     `get id()` 见 canvas/placeables/placeable-object.mjs:224（转调 `document.id`）；
 *     `this.scene = document.parent` 见 placeable-object.mjs:34。
 *     placeable 上**没有 uuid**——取 uuid 必须经 document，这一点也照抄了。
 */

/**
 * @param {object} [opts]
 * @param {string} [opts.id]        token id
 * @param {number} [opts.x]         左上角 x（像素）；给了 center 就不用给
 * @param {number} [opts.y]         左上角 y（像素）
 * @param {{x: number, y: number}} [opts.center]  中心（像素），内部换算回左上角
 * @param {number} [opts.width]     格数
 * @param {number} [opts.height]    格数
 * @param {number} [opts.elevation]
 * @param {number} [opts.gridSize]  像素/格
 * @param {string} [opts.sceneId]
 * @returns {object} TokenDocument 形状的 mock
 */
export function tokenDoc({id = "t0", x, y, center, width = 1, height = 1, elevation = 0,
                          gridSize = 100, sceneId = "s"} = {}) {
  const left = x ?? ((center?.x ?? 0) - (width * gridSize) / 2);
  const top = y ?? ((center?.y ?? 0) - (height * gridSize) / 2);
  const scene = {id: sceneId, grid: {isHexagonal: false, sizeX: gridSize, sizeY: gridSize}};
  return {
    id, _id: id,
    uuid: `Scene.${sceneId}.Token.${id}`,
    parent: scene,                       // BaseToken#getSize/#getCenterPoint 读 this.parent.grid
    scene,                               // TokenDocument#scene 是 parent 的别名（client/documents/token.mjs:105-107）
    x: left, y: top,                     // 左上角，不是中心
    width, height, elevation,            // 格数
    /** common/documents/token.mjs:481-494（方格分支） */
    getSize(data = {}) {
      return {width: (data.width ?? width) * gridSize,
              height: (data.height ?? height) * gridSize};
    },
    /** common/documents/token.mjs:506-530（方格分支） */
    getCenterPoint(data = {}) {
      const size = this.getSize(data);
      return {x: (data.x ?? left) + size.width / 2,
              y: (data.y ?? top) + size.height / 2,
              elevation: data.elevation ?? elevation};
    }
  };
}

/**
 * Token placeable 形状的 mock，内部持有一份 tokenDoc()。
 * @param {Parameters<typeof tokenDoc>[0]} [opts]
 * @returns {object}
 */
export function tokenPlaceable(opts = {}) {
  const document = tokenDoc(opts);
  return {
    document,
    scene: document.parent,                                    // placeable-object.mjs:34
    get id() { return document.id; },                          // placeable-object.mjs:224
    get center() { const c = document.getCenterPoint(); return {x: c.x, y: c.y}; }, // token.mjs:448-451
    get w() { return document.getSize().width; },              // token.mjs:431-433
    get h() { return document.getSize().height; },             // token.mjs:437-443
    getCenterPoint(position) {                                 // token.mjs:2849-2852
      const c = document.getCenterPoint(position ? {x: position.x, y: position.y} : undefined);
      return {x: c.x, y: c.y};
    }
  };
}
