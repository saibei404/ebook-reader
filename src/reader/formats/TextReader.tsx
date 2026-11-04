import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Chapter } from '../text-utils'
import { ScrollProgress } from '@/components/ui/ScrollProgress'
import { chapterHtml } from '../text-utils'
import type { AnnotationColor, Locator } from '@/types/book'
import {
  chapterIndexAtOffset,
  countForBudget,
  estimateHeight,
  averagePxPerChar,
  visibleRange,
  DEFAULT_PX_PER_CHAR,
  FIRST_BATCH_CHARS,
} from '../chapter-window'
import { charOffsetToDom, domToCharOffset, scrollTopForCharOffset } from '../text-range'
import { perfMark } from '@/lib/perf'

export interface TextHighlight {
  id: string
  start: number
  end: number
  color: AnnotationColor
}

export interface SelectionInfo {
  start: number
  end: number
  text: string
  /** 选区中心（视口坐标），用于浮动工具条定位 */
  x: number
  top: number
  bottom: number
}

interface Props {
  chapters: Chapter[]
  fontSize: number
  lineHeight: number
  maxWidth: number
  fontFamily: string
  initialLocator: Locator | null
  onLocate: (loc: Locator) => void
  /** HTML 源（MD/DOCX/FB2）：空白按 HTML 规则折叠，不用 pre-wrap */
  htmlMode?: boolean
  /** 已存在的高亮（字符偏移区间，全文坐标） */
  highlights?: TextHighlight[]
  /** 选区变化（null = 已取消选择） */
  onSelect?: (sel: SelectionInfo | null) => void
  /** 点击已有高亮（附带点击位置，供备注气泡定位） */
  onHighlightClick?: (id: string, at: { x: number; top: number }) => void
}

/** 章节所属的 section（选区端点向上找） */
function sectionOf(node: Node | null, inner: HTMLElement): HTMLElement | null {
  let el: Node | null = node
  while (el && el !== inner) {
    if (el.nodeType === 1) {
      const he = el as HTMLElement
      if (he.tagName === 'SECTION' && he.dataset.start != null) return he
    }
    el = el.parentNode
  }
  return null
}

/**
 * 文本阅读器（TXT / MD / FB2 / DOCX 共用）。
 *
 * 大文件策略（A4）：
 * - 章节 HTML **惰性生成**：3MB TXT 若在打开时就全量转义，会阻塞主线程 1–2s；
 * - 章节 **分批挂载**：首屏只挂约 4 万字符，其余用「按实测每字像素高度估算」的占位撑开，
 *   滚动后用前缀偏移 + 二分算出可视窗口再挂载（不用 IntersectionObserver，
 *   避免「一次滚动后缓冲内的章节迟迟不挂载」这类时序问题）；
 * - 位置以「字符偏移」为准：恢复时把偏移换算到具体段落（段内再按字符比例微调），
 *   不再依赖整章高度比例，因此占位估算误差不会把位置带偏。
 */
export function TextReader({
  chapters,
  fontSize,
  lineHeight,
  maxWidth,
  fontFamily,
  initialLocator,
  onLocate,
  htmlMode = false,
  highlights = [],
  onSelect,
  onHighlightClick,
}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const innerRef = useRef<HTMLDivElement>(null)
  const sectionRefs = useRef<(HTMLElement | null)[]>([])
  const restored = useRef(false)
  const rafRef = useRef(0)
  const mountedRef = useRef<Set<number>>(new Set())
  const pxPerCharRef = useRef(DEFAULT_PX_PER_CHAR)
  /** 校准次数上限（防止测量抖动） */
  const calibrations = useRef(0)
  /** 章节前缀偏移与高度（mounted 用实测，其余用估算） */
  const layoutRef = useRef<{ offsets: number[]; heights: number[]; total: number }>({
    offsets: [],
    heights: [],
    total: 0,
  })
  const [, forceRender] = useState(0)

  const totalChars = useMemo(
    () => chapters.reduce((s, c) => s + Math.max(1, c.charCount), 0),
    [chapters]
  )

  /** 首屏挂载集合：预算内的章节 + 需要恢复的目标章 */
  const initialMounted = useMemo(() => {
    const n = countForBudget(chapters, FIRST_BATCH_CHARS)
    const set = new Set<number>()
    for (let i = 0; i < n; i++) set.add(i)
    if (initialLocator && initialLocator.kind === 'offset') {
      const idx = chapterIndexAtOffset(chapters, Number(initialLocator.value) || 0)
      if (idx >= 0) set.add(idx)
    }
    return set
  }, [chapters, initialLocator])

  const [mounted, setMounted] = useState<Set<number>>(initialMounted)
  mountedRef.current = mounted

  // 换书 / 换偏移时重置挂载窗口（组件通常按 bookId 重挂载，这里兜底）
  const chaptersRef = useRef(chapters)
  useEffect(() => {
    if (chaptersRef.current === chapters) return
    chaptersRef.current = chapters
    setMounted(initialMounted)
    restored.current = false
  }, [chapters, initialMounted])

  const mount = useCallback((idxs: number[]) => {
    if (!idxs.length) return
    setMounted((prev) => {
      let changed = false
      const next = new Set(prev)
      for (const i of idxs) {
        if (!next.has(i)) {
          next.add(i)
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [])

  /* ---------- 布局测量 + 前缀偏移（必须早于位置恢复执行） ---------- */
  useLayoutEffect(() => {
    if (!chapters.length) return
    const heights: number[] = []
    const offsets: number[] = []
    const samples: { chars: number; height: number }[] = []
    let acc = 0
    for (let i = 0; i < chapters.length; i++) {
      const sec = sectionRefs.current[i]
      let h: number
      if (sec && mounted.has(i)) {
        h = sec.offsetHeight
        samples.push({ chars: chapters[i].charCount, height: h })
      } else {
        h = estimateHeight(chapters[i].charCount, pxPerCharRef.current)
      }
      offsets.push(acc)
      heights.push(h)
      acc += h
    }
    layoutRef.current = { offsets, heights, total: acc }
    const avg = averagePxPerChar(samples)
    // 校准上限 8 次：避免极端排版下「测量 → 重估 → 再测量」来回抖动
    if (Math.abs(avg - pxPerCharRef.current) / pxPerCharRef.current > 0.05 && calibrations.current < 8) {
      calibrations.current++
      pxPerCharRef.current = avg
      forceRender((n) => n + 1)
    }
  }, [mounted, chapters, fontSize, lineHeight, maxWidth])

  /* ---------- 把视口（含缓冲）内的占位章节挂载 ---------- */
  const ensureWindow = useCallback(() => {
    const el = scrollRef.current
    const { offsets, heights } = layoutRef.current
    if (!el || !offsets.length) return
    const { from, to } = visibleRange(offsets, heights, el.scrollTop, el.clientHeight, 1600)
    if (from < 0) return
    const add: number[] = []
    for (let i = from; i <= to; i++) {
      if (!mountedRef.current.has(i)) add.push(i)
    }
    if (add.length) mount(add)
  }, [mount])

  /* ---------- 位置恢复 ---------- */
  useLayoutEffect(() => {
    if (restored.current) return
    const el = scrollRef.current
    if (!el || !chapters.length) return
    if (!initialLocator) {
      restored.current = true
      ensureWindow()
      return
    }
    restored.current = true
    const maxScroll = () => Math.max(1, el.scrollHeight - el.clientHeight)
    /** 全书是否已完整挂载（小文件）：此时像素比例才是精确的 */
    const allMounted = initialMounted.size >= chapters.length

    // 1) 小文件：像素比例最准（与保存时的布局一比一）
    if (allMounted && typeof initialLocator.scrollRatio === 'number') {
      el.scrollTop = Math.min(maxScroll(), Math.max(0, initialLocator.scrollRatio) * maxScroll())
      ensureWindow()
      return
    }
    // 2) 大文件：字符偏移换算到具体段落（不受未挂载章节的估算高度影响）
    if (initialLocator.kind === 'offset') {
      const target = Number(initialLocator.value) || 0
      const idx = chapterIndexAtOffset(chapters, target)
      const sec = sectionRefs.current[idx]
      if (sec && idx >= 0) {
        const want = scrollTopForCharOffset(el, sec, Math.max(0, target - chapters[idx].startChar))
        if (want != null) {
          el.scrollTop = Math.min(maxScroll(), Math.max(0, want))
          ensureWindow()
          return
        }
      }
    }
    // 3) 兜底：像素比例
    requestAnimationFrame(() => {
      if (typeof initialLocator.scrollRatio === 'number') {
        el.scrollTop = Math.min(maxScroll(), initialLocator.scrollRatio * maxScroll())
      }
      ensureWindow()
    })
  }, [chapters, initialLocator, initialMounted, ensureWindow])

  /* ---------- 语义阶段打点（性能自检用，生产无副作用） ---------- */
  useLayoutEffect(() => {
    perfMark('text-first-paint', { chapters: chapters.length, totalChars })
  }, [chapters.length, totalChars])

  /* ---------- 滚动 → 上报位置 + 挂载可视章节 ---------- */
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const report = () => {
      const { offsets, heights } = layoutRef.current
      if (!offsets.length) return
      const sRect = el.getBoundingClientRect()
      const probe = el.scrollTop + 8
      let idx = Math.max(0, visibleRange(offsets, heights, probe, 0, 0).from)
      // 估算可能有一两章偏差：用实际矩形在候选附近校正到真正覆盖顶部的那一章
      let secTop = offsets[idx] ?? 0
      let secHeight = Math.max(1, heights[idx] ?? 1)
      for (let k = Math.max(0, idx - 2); k < Math.min(chapters.length, idx + 3); k++) {
        const sec = sectionRefs.current[k]
        if (!sec) continue
        const r = sec.getBoundingClientRect()
        const top = r.top - sRect.top + el.scrollTop
        if (top <= probe && top + r.height > probe) {
          idx = k
          secTop = top
          secHeight = Math.max(1, r.height)
          break
        }
      }
      const chapter = chapters[idx]
      if (!chapter) return
      const ratio = Math.min(1, Math.max(0, (el.scrollTop - secTop) / secHeight))
      const offset = Math.round(chapter.startChar + ratio * Math.max(1, chapter.charCount))
      const percent = Math.min(1, Math.max(0, offset / Math.max(1, totalChars)))
      const scrollRatio = Math.min(
        1,
        Math.max(0, el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight))
      )
      onLocate({
        kind: 'offset',
        value: offset,
        percent,
        scrollRatio,
        label: chapter.title || '',
        updatedAt: Date.now(),
      })
    }
    const onScroll = () => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => {
        ensureWindow()
        report()
      })
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    // 首次进入也上报一次，保证书架能看到"已开始阅读"
    const t = window.setTimeout(() => {
      ensureWindow()
      report()
    }, 400)
    return () => {
      el.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(rafRef.current)
      window.clearTimeout(t)
    }
  }, [chapters, totalChars, onLocate, ensureWindow])

  /* ---------- 高亮渲染（CSS Custom Highlight API，不改 DOM） ---------- */
  useEffect(() => {
    const registry = (CSS as unknown as { highlights?: Map<string, unknown> } | undefined)?.highlights
    if (!registry || typeof Highlight === 'undefined') return
    const inner = innerRef.current
    if (!inner) return

    const groups = new Map<AnnotationColor, Range[]>()
    for (const h of highlights) {
      const startIdx = chapterIndexAtOffset(chapters, h.start)
      const endIdx = chapterIndexAtOffset(chapters, Math.max(h.start, h.end - 1))
      const sSec = sectionRefs.current[startIdx]
      const eSec = sectionRefs.current[endIdx]
      if (!sSec || !eSec) continue
      const sPos = charOffsetToDom(sSec, Math.max(0, h.start - chapters[startIdx].startChar))
      const ePos = charOffsetToDom(eSec, Math.max(0, h.end - chapters[endIdx].startChar))
      if (!sPos || !ePos) continue
      const range = document.createRange()
      try {
        range.setStart(sPos.node, sPos.offset)
        range.setEnd(ePos.node, ePos.offset)
      } catch {
        continue
      }
      const arr = groups.get(h.color) ?? []
      arr.push(range)
      groups.set(h.color, arr)
    }

    const COLORS: AnnotationColor[] = ['yellow', 'green', 'blue', 'pink']
    for (const color of COLORS) registry.delete(`moyu-hl-${color}`)
    for (const [color, ranges] of groups) {
      if (!ranges.length) continue
      try {
        registry.set(`moyu-hl-${color}`, new Highlight(...ranges))
      } catch {
        /* 极旧内核不支持时静默跳过，数据仍在笔记页可用 */
      }
    }
    return () => {
      for (const color of COLORS) registry.delete(`moyu-hl-${color}`)
    }
  }, [highlights, chapters, mounted])

  /* ---------- 选区 → 字符偏移 ---------- */
  const readSelection = useCallback((): SelectionInfo | null => {
    const inner = innerRef.current
    if (!inner || !onSelect) return null
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null
    const range = sel.getRangeAt(0)
    if (!inner.contains(range.commonAncestorContainer)) return null
    const sSec = sectionOf(range.startContainer, inner)
    const eSec = sectionOf(range.endContainer, inner)
    if (!sSec || !eSec) return null
    const start =
      Number(sSec.dataset.start) + domToCharOffset(sSec, range.startContainer, range.startOffset)
    const end = Number(eSec.dataset.start) + domToCharOffset(eSec, range.endContainer, range.endOffset)
    const text = sel.toString().replace(/\s+/g, ' ').trim()
    if (end <= start || !text) return null
    const rect = range.getBoundingClientRect()
    if (!rect.width && !rect.height) return null
    return { start, end, text, x: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom }
  }, [onSelect])

  useEffect(() => {
    const inner = innerRef.current
    const el = scrollRef.current
    if (!inner || !el) return
    const onUp = () => {
      if (!onSelect) return
      // 等浏览器稳定选区（双击选词在 mouseup 后一帧才落定）
      window.setTimeout(() => onSelect(readSelection()), 0)
    }
    const onDown = (e: MouseEvent) => {
      // 点击已有高亮：先判断是否命中，再决定是否清空工具条
      if (onHighlightClick && highlights.length) {
        const sel = window.getSelection()
        if (!sel || sel.isCollapsed) {
          const caret = document.caretRangeFromPoint?.(e.clientX, e.clientY)
          if (caret) {
            const sec = sectionOf(caret.startContainer, inner)
            if (sec) {
              const off =
                Number(sec.dataset.start) +
                domToCharOffset(sec, caret.startContainer, caret.startOffset)
              const hit = highlights.find((h) => off >= h.start && off < h.end)
              if (hit) {
                onHighlightClick(hit.id, { x: e.clientX, top: e.clientY - 10 })
                return
              }
            }
          }
        }
      }
      onSelect?.(null)
    }
    el.addEventListener('mouseup', onUp)
    el.addEventListener('mousedown', onDown)
    return () => {
      el.removeEventListener('mouseup', onUp)
      el.removeEventListener('mousedown', onDown)
    }
  }, [onSelect, onHighlightClick, highlights, readSelection])

  return (
    <div className="text-scroll" ref={scrollRef}>
      <ScrollProgress containerRef={scrollRef} />
      <div
        className={`text-inner${htmlMode ? ' text-inner--html' : ''}${onSelect || highlights.length ? ' text-inner--selectable' : ''}`}
        ref={innerRef}
        style={{
          fontSize: `${fontSize}px`,
          lineHeight,
          fontFamily,
          maxWidth: maxWidth > 0 ? `${maxWidth}px` : 'none',
        }}
      >
        {chapters.map((c, i) => {
          const isMounted = mounted.has(i)
          return (
            <section
              key={`${i}-${c.startChar}`}
              data-start={c.startChar}
              data-len={c.charCount}
              data-idx={i}
              data-ph={isMounted ? undefined : '1'}
              ref={(el) => {
                sectionRefs.current[i] = el
              }}
              style={isMounted ? undefined : { height: estimateHeight(c.charCount, pxPerCharRef.current), overflow: 'hidden' }}
              {...(isMounted
                ? {
                    // 内容来自本地文件，已做 HTML 转义/标签白名单处理
                    dangerouslySetInnerHTML: { __html: chapterHtml(c) },
                  }
                : {})}
            />
          )
        })}
      </div>
    </div>
  )
}
