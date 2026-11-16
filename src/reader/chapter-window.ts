/**
 * 章节挂载窗口（纯函数，无 DOM 依赖）。
 *
 * 大文件（3MB TXT ≈ 250 章）第一次打开时，把全书 HTML 一次性塞进 DOM 是首开卡顿的主因。
 * 这里改为「首屏只挂载约 4 万字符，其余章节用估算高度占位，滚到附近再挂载」：
 * - 占位高度让滚动条总长与真实值接近，跳转/位置比例仍然可用；
 * - 估算系数由已挂载章节实测得出，同一本书内字号一致，误差很小。
 */
import type { Chapter } from './text-utils'

/** 首屏挂载预算（字符）：约等于 2–4 屏中文正文 */
export const FIRST_BATCH_CHARS = 40000
/** 后续每批挂载预算（字符） */
export const BATCH_CHARS = 60000
/** 初始每字符像素高度的兜底值（18px 字号、1.85 行距、780px 宽实测约 0.5） */
export const DEFAULT_PX_PER_CHAR = 0.5

/** 从 0 开始累计字符数，返回达到 budget 时应挂载的章节数（至少 min 章） */
export function countForBudget(chapters: Chapter[], budget: number, min = 1): number {
  if (!chapters.length) return 0
  let acc = 0
  let n = 0
  for (const c of chapters) {
    acc += Math.max(1, c.charCount)
    n++
    if (acc >= budget) break
  }
  return Math.max(Math.min(min, chapters.length), Math.min(n, chapters.length))
}

/** 字符偏移落在第几章（二分查找；越界收敛到首/末章） */
export function chapterIndexAtOffset(chapters: Chapter[], offset: number): number {
  if (!chapters.length) return -1
  const target = Math.max(0, offset)
  let lo = 0
  let hi = chapters.length - 1
  let ans = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (chapters[mid].startChar <= target) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}

/** 下一批挂载到第几章（不含） */
export function nextBatchEnd(chapters: Chapter[], from: number, budget = BATCH_CHARS): number {
  if (from >= chapters.length) return chapters.length
  let acc = 0
  let i = from
  while (i < chapters.length) {
    acc += Math.max(1, chapters[i].charCount)
    i++
    if (acc >= budget) break
  }
  return i
}

/**
 * 由已挂载章节实测值推算「每字符像素高度」。
 * 只采用有效样本（高度 > 0、字符数 > 0），空样本回落到默认值。
 */
export function averagePxPerChar(samples: { chars: number; height: number }[]): number {
  let h = 0
  let c = 0
  for (const s of samples) {
    if (!(s.height > 0) || !(s.chars > 0)) continue
    h += s.height
    c += s.chars
  }
  if (c <= 0) return DEFAULT_PX_PER_CHAR
  const avg = h / c
  // 夹在合理区间：极端字号/超宽窗口下也不至于让占位高度离谱
  return Math.min(4, Math.max(0.08, avg))
}

/** 未挂载章节的估算高度（px） */
export function estimateHeight(charCount: number, pxPerChar: number): number {
  return Math.max(24, Math.round(Math.max(1, charCount) * pxPerChar))
}

/** 按像素位置在「章节前缀偏移数组」中定位（二分；越界收敛到首/末） */
export function indexAtPx(offsets: number[], y: number): number {
  if (!offsets.length) return -1
  const target = Math.max(0, y)
  let lo = 0
  let hi = offsets.length - 1
  let ans = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (offsets[mid] <= target) {
      ans = mid
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  return ans
}

/**
 * 当前视口（含上下缓冲）应挂载的章节闭区间。
 * 用前缀偏移 + 二分，O(log n)；不需要对每个占位做 getBoundingClientRect。
 */
export function visibleRange(
  offsets: number[],
  heights: number[],
  scrollTop: number,
  viewport: number,
  buffer = 1600
): { from: number; to: number } {
  if (!offsets.length) return { from: -1, to: -1 }
  const from = indexAtPx(offsets, scrollTop - buffer)
  const to = indexAtPx(offsets, scrollTop + viewport + buffer)
  // 至少覆盖 2 章，避免缓冲把单章窗口压没
  return { from, to: Math.min(offsets.length - 1, Math.max(to, from + 1)) }
}
