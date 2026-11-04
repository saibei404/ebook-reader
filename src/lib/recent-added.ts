/**
 * 「刚导入的书」标记：只服务于入场动画，不进 zustand。
 *
 * 故意做成模块级集合而不是 store 状态：
 *  - 卡片只需要在**挂载那一刻**知道自己是不是新来的，之后不该因为标记过期而重渲染；
 *  - 导入本身会触发一次 setState，那次重渲染就够让新卡片读到标记了。
 *
 * 用 globalThis.setTimeout 而不是 window.setTimeout：store 在单测（node）里也会被 import。
 */
const recent = new Set<string>()

/** 在把新书写进 store **之前**调用，这样新卡片挂载时一定能读到 */
export function markAdded(ids: string[]): void {
  if (!ids.length) return
  ids.forEach((id) => recent.add(id))
  globalThis.setTimeout(() => ids.forEach((id) => recent.delete(id)), 1500)
}

export function isRecentlyAdded(id: string): boolean {
  return recent.has(id)
}
