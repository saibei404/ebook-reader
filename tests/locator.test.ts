import { describe, expect, it } from 'vitest'
import {
  averagePxPerChar,
  chapterIndexAtOffset,
  countForBudget,
  DEFAULT_PX_PER_CHAR,
  estimateHeight,
  indexAtPx,
  nextBatchEnd,
  visibleRange,
} from '@/reader/chapter-window'
import {
  charOffsetToDom,
  collectTextNodes,
  domToCharOffset,
  locateInLengths,
  resolveTextPos,
  textLengthOf,
} from '@/reader/text-range'
import type { Chapter } from '@/reader/text-utils'

function ch(startChar: number, charCount: number): Chapter {
  return { title: `c${startChar}`, body: '', source: 'text', startChar, charCount }
}

describe('countForBudget', () => {
  const chapters = [ch(0, 100), ch(100, 200), ch(300, 300)]

  it('累计到预算即停（返回章节数）', () => {
    expect(countForBudget(chapters, 100)).toBe(1)
    expect(countForBudget(chapters, 250)).toBe(2)
    expect(countForBudget(chapters, 1000)).toBe(3)
  })

  it('至少挂载 min 章', () => {
    expect(countForBudget(chapters, 0, 1)).toBe(1)
  })

  it('空数组返回 0', () => {
    expect(countForBudget([], 100)).toBe(0)
  })
})

describe('chapterIndexAtOffset', () => {
  const chapters = [ch(0, 100), ch(100, 100), ch(200, 100)]

  it('命中章节起点', () => {
    expect(chapterIndexAtOffset(chapters, 0)).toBe(0)
    expect(chapterIndexAtOffset(chapters, 100)).toBe(1)
    expect(chapterIndexAtOffset(chapters, 200)).toBe(2)
  })

  it('章内偏移落在所属章', () => {
    expect(chapterIndexAtOffset(chapters, 150)).toBe(1)
    expect(chapterIndexAtOffset(chapters, 299)).toBe(2)
  })

  it('越界收敛到末章 / 首章', () => {
    expect(chapterIndexAtOffset(chapters, 99999)).toBe(2)
    expect(chapterIndexAtOffset(chapters, -50)).toBe(0)
  })

  it('空数组返回 -1', () => {
    expect(chapterIndexAtOffset([], 10)).toBe(-1)
  })
})

describe('nextBatchEnd', () => {
  const chapters = [ch(0, 10), ch(10, 10), ch(20, 10), ch(30, 10)]

  it('按预算推进，不越过末章', () => {
    expect(nextBatchEnd(chapters, 0, 25)).toBe(3)
    expect(nextBatchEnd(chapters, 0, 100)).toBe(4)
    expect(nextBatchEnd(chapters, 3, 100)).toBe(4)
  })

  it('已到末尾时原样返回', () => {
    expect(nextBatchEnd(chapters, 4, 10)).toBe(4)
  })
})

describe('indexAtPx / visibleRange', () => {
  const offsets = [0, 500, 1000, 1500]
  const heights = [500, 500, 500, 500]

  it('像素位置命中起始偏移', () => {
    expect(indexAtPx(offsets, 0)).toBe(0)
    expect(indexAtPx(offsets, 500)).toBe(1)
    expect(indexAtPx(offsets, 1200)).toBe(2)
    expect(indexAtPx(offsets, 99999)).toBe(3)
  })

  it('视口 + 缓冲覆盖多章，且不越界', () => {
    const r = visibleRange(offsets, heights, 0, 400, 100)
    expect(r.from).toBe(0)
    expect(r.to).toBe(1)
    const r2 = visibleRange(offsets, heights, 1000, 400, 0)
    expect(r2.from).toBe(2)
    expect(r2.to).toBe(3)
  })

  it('空输入返回 -1 区间', () => {
    expect(visibleRange([], [], 0, 100)).toEqual({ from: -1, to: -1 })
  })
})

describe('averagePxPerChar / estimateHeight', () => {
  it('忽略无效样本后按总量平均', () => {
    expect(averagePxPerChar([{ chars: 100, height: 50 }, { chars: 0, height: 10 }, { chars: 100, height: 0 }])).toBe(
      0.5
    )
  })

  it('无有效样本回落到默认值', () => {
    expect(averagePxPerChar([])).toBe(DEFAULT_PX_PER_CHAR)
  })

  it('极端值被夹在合理区间', () => {
    expect(averagePxPerChar([{ chars: 1, height: 1000 }])).toBe(4)
    expect(averagePxPerChar([{ chars: 10000, height: 1 }])).toBe(0.08)
  })

  it('估算高度有下限，避免空段落塌陷', () => {
    expect(estimateHeight(0, 0.5)).toBe(24)
    expect(estimateHeight(1000, 0.5)).toBe(500)
  })
})

describe('locateInLengths（字符偏移 → 文本节点）', () => {
  const lengths = [3, 5, 2]

  it('节点内部命中', () => {
    expect(locateInLengths(lengths, 0)).toEqual({ index: 0, offset: 0 })
    expect(locateInLengths(lengths, 2)).toEqual({ index: 0, offset: 2 })
    expect(locateInLengths(lengths, 4)).toEqual({ index: 1, offset: 1 })
  })

  it('恰好落在节点边界归到前一节点末尾', () => {
    expect(locateInLengths(lengths, 3)).toEqual({ index: 0, offset: 3 })
    expect(locateInLengths(lengths, 8)).toEqual({ index: 1, offset: 5 })
  })

  it('越界收敛到最后一个节点末尾', () => {
    expect(locateInLengths(lengths, 999)).toEqual({ index: 2, offset: 2 })
  })

  it('空数组返回 null', () => {
    expect(locateInLengths([], 1)).toBeNull()
  })
})

describe('DOM 字符偏移换算（jsdom）', () => {
  function makeRoot(): HTMLElement {
    const root = document.createElement('section')
    root.innerHTML = '<h2>标题</h2><p>第一段文字</p><p>第二段</p>'
    document.body.appendChild(root)
    return root
  }

  it('collectTextNodes 只收文本节点', () => {
    const root = makeRoot()
    const nodes = collectTextNodes(root)
    expect(nodes.map((n) => n.data)).toEqual(['标题', '第一段文字', '第二段'])
    root.remove()
  })

  it('textLengthOf 等于各文本节点长度之和', () => {
    const root = makeRoot()
    expect(textLengthOf(root)).toBe(2 + 5 + 3)
    root.remove()
  })

  it('charOffsetToDom 能定位到跨节点的任意偏移', () => {
    const root = makeRoot()
    const p1 = charOffsetToDom(root, 2) // 标题末
    expect(p1?.node.data).toBe('标题')
    expect(p1?.offset).toBe(2)
    const p2 = charOffsetToDom(root, 5) // 第一段第 3 个字
    expect(p2?.node.data).toBe('第一段文字')
    expect(p2?.offset).toBe(3)
    root.remove()
  })

  it('domToCharOffset 与 charOffsetToDom 互逆', () => {
    const root = makeRoot()
    for (const target of [0, 3, 4, 9, 10]) {
      const pos = charOffsetToDom(root, target)
      expect(pos).not.toBeNull()
      expect(domToCharOffset(root, pos!.node, pos!.offset)).toBe(target)
    }
    root.remove()
  })

  it('resolveTextPos 把元素端点收敛到其首/末文本', () => {
    const root = makeRoot()
    const p = root.querySelectorAll('p')[1]
    const start = resolveTextPos(p, 0)
    expect(start?.node.data).toBe('第二段')
    expect(start?.offset).toBe(0)
    const end = resolveTextPos(p, 1)
    expect(end?.node.data).toBe('第二段')
    expect(end?.offset).toBe(3)
    root.remove()
  })

  it('越界偏移收敛到最后一个节点末尾', () => {
    const root = makeRoot()
    const pos = charOffsetToDom(root, 999)
    expect(pos?.node.data).toBe('第二段')
    expect(pos?.offset).toBe(3)
    root.remove()
  })
})
