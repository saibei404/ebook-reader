/**
 * 字符偏移 ↔ DOM 位置换算。
 *
 * 坐标空间：全文「去掉换行后的纯文本」，章节 `startChar` 由分章阶段按同一口径累计。
 * 因此只要在 DOM 里按 TreeWalker 累加文本节点长度，就能与 locator / 高亮锚点一一对应。
 *
 * 这套换算是三处的公共地基：
 * 1. 位置恢复（把字符偏移变成精确的 scrollTop，而不是按章高比例估算）；
 * 2. 选区高亮（DOM 位置 → 字符偏移，再写入 IndexedDB）；
 * 3. 搜索命中跳转（字符偏移 → 段落位置）。
 */

export interface DomPos {
  node: Text
  offset: number
}

/**
 * 在「各文本节点长度」数组中定位字符偏移（纯函数，无 DOM 依赖，便于单测）。
 * 越界时收敛到最后一个节点末尾 / 第一个节点开头。
 */
export function locateInLengths(
  lengths: number[],
  offset: number
): { index: number; offset: number } | null {
  if (!lengths.length) return null
  const target = Math.max(0, Math.floor(offset))
  let acc = 0
  for (let i = 0; i < lengths.length; i++) {
    const len = lengths[i]
    if (target < acc + len) return { index: i, offset: target - acc }
    if (target === acc + len) {
      // 恰好落在节点边界：归到当前节点末尾（下一步插入高亮时不会跨节点）
      return { index: i, offset: len }
    }
    acc += len
  }
  return { index: lengths.length - 1, offset: lengths[lengths.length - 1] }
}

export function collectTextNodes(root: Node): Text[] {
  const doc = root.ownerDocument ?? (root as Document)
  const out: Text[] = []
  if (!doc?.createTreeWalker) return out
  const walker = doc.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */)
  let n = walker.nextNode()
  while (n) {
    out.push(n as Text)
    n = walker.nextNode()
  }
  return out
}

/** 元素内文本总长度（与角色偏移同口径） */
export function textLengthOf(root: Node): number {
  return collectTextNodes(root).reduce((s, n) => s + n.data.length, 0)
}

/** 字符偏移 → DOM 文本节点位置 */
export function charOffsetToDom(root: HTMLElement, offset: number): DomPos | null {
  const nodes = collectTextNodes(root)
  const hit = locateInLengths(
    nodes.map((n) => n.data.length),
    offset
  )
  if (!hit) return null
  return { node: nodes[hit.index], offset: hit.offset }
}

/** 选区端点可能落在元素节点上（整段选中时锚点是 section），统一收敛到文本节点 */
export function resolveTextPos(node: Node, offset: number): DomPos | null {
  if (node.nodeType === 3) {
    return { node: node as Text, offset: Math.max(0, Math.min(offset, (node as Text).data.length)) }
  }
  const el = node as Element
  const firstText = (n: Node): Text | null => {
    if (n.nodeType === 3) return n as Text
    const list = collectTextNodes(n)
    return list[0] ?? null
  }
  const lastText = (n: Node): Text | null => {
    if (n.nodeType === 3) return n as Text
    const list = collectTextNodes(n)
    return list[list.length - 1] ?? null
  }
  const child = el.childNodes?.[offset] ?? null
  if (child) {
    const t = firstText(child)
    if (t) return { node: t, offset: 0 }
    let sib: Node | null = child.nextSibling
    while (sib) {
      const t2 = firstText(sib)
      if (t2) return { node: t2, offset: 0 }
      sib = sib.nextSibling
    }
    const lt = lastText(el)
    return lt ? { node: lt, offset: lt.data.length } : null
  }
  const lt = lastText(el)
  return lt ? { node: lt, offset: lt.data.length } : null
}

/** DOM 位置 → 元素内字符偏移 */
export function domToCharOffset(root: Node, node: Node, offset: number): number {
  const pos = resolveTextPos(node, offset)
  if (!pos) return 0
  const nodes = collectTextNodes(root)
  let acc = 0
  for (const n of nodes) {
    if (n === pos.node) return acc + pos.offset
    acc += n.data.length
  }
  return acc
}

const BLOCK_SELECTOR = 'p, li, blockquote, h1, h2, h3, h4, h5, h6, pre, td, th'

/** 文本节点 → 最近的块级祖先（定位与高亮点击命中用） */
export function blockOf(node: Node, boundary: HTMLElement): HTMLElement | null {
  let el: Node | null = node
  while (el && el !== boundary) {
    if (el.nodeType === 1 && (el as HTMLElement).matches?.(BLOCK_SELECTOR)) return el as HTMLElement
    el = el.parentNode
  }
  return boundary
}

/**
 * 把「元素内字符偏移」换算成滚动位置：先落到段落，再按段内字符比例微调。
 * 比「整章高度 × 比例」精确得多——同一段落内字符与像素近似线性，误差不超过一行。
 */
export function scrollTopForCharOffset(
  scroller: HTMLElement,
  section: HTMLElement,
  charOffsetInSection: number,
  pad = 8
): number | null {
  const pos = charOffsetToDom(section, Math.max(0, charOffsetInSection))
  if (!pos) return null
  const block = blockOf(pos.node, section)
  if (!block) return null
  const sRect = scroller.getBoundingClientRect()
  const bRect = block.getBoundingClientRect()
  const base = bRect.top - sRect.top + scroller.scrollTop
  const inBlock = domToCharOffset(block, pos.node, pos.offset)
  const blockLen = Math.max(1, textLengthOf(block))
  const ratio = Math.min(1, Math.max(0, inBlock / blockLen))
  return base + ratio * bRect.height - pad
}
