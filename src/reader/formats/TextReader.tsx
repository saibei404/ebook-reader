import { useEffect, useLayoutEffect, useRef } from 'react'
import type { Chapter } from '../text-utils'
import type { Locator } from '@/types/book'

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
}

/**
 * 文本阅读器（TXT / MD / FB2 共用）。
 * - 章节分段渲染 + content-visibility 提升长文性能；
 * - 位置以「字符偏移」记录：章节 startChar + 章内滚动比例，字号变化后仍可近似还原；
 * - 滚动上报经 rAF 节流，避免高频 setState 与写库。
 */
export function TextReader({ chapters, fontSize, lineHeight, maxWidth, fontFamily, initialLocator, onLocate, htmlMode = false}: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const restored = useRef(false)
  const rafRef = useRef(0)
  const totalChars = chapters.reduce((s, c) => s + Math.max(1, c.charCount), 0)

  // 首次恢复位置（等待布局稳定后执行）
  useLayoutEffect(() => {
    if (restored.current) return
    const el = scrollRef.current
    if (!el || !chapters.length) return
    restored.current = true
    if (!initialLocator) return
    const maxScroll = () => Math.max(1, el.scrollHeight - el.clientHeight)
    requestAnimationFrame(() => {
      // 首选像素比例：与渲染高度一一对应，恢复最准
      if (typeof initialLocator.scrollRatio === 'number') {
        el.scrollTop = Math.min(maxScroll(), initialLocator.scrollRatio * maxScroll())
        return
      }
      // 兜底：按字符偏移定位到章节
      const target = initialLocator.kind === 'offset' ? Number(initialLocator.value) : 0
      if (!target || target <= 0) return
      const secs = Array.from(el.querySelectorAll<HTMLElement>('section[data-start]'))
      let hit: HTMLElement | null = null
      for (const s of secs) {
        if (Number(s.dataset.start) <= target) hit = s
        else break
      }
      if (hit) {
        const start = Number(hit.dataset.start) || 0
        const len = Math.max(1, Number(hit.dataset.len) || 1)
        const ratio = Math.min(1, Math.max(0, (target - start) / len))
        el.scrollTop = hit.offsetTop + ratio * hit.offsetHeight
      }
    })
  }, [chapters, initialLocator])

  // 滚动 → 上报位置
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const report = () => {
      const secs = Array.from(el.querySelectorAll<HTMLElement>('section[data-start]'))
      if (!secs.length) return
      const top = el.scrollTop + 8
      let current = secs[0]
      for (const s of secs) {
        if (s.offsetTop <= top) current = s
        else break
      }
      const start = Number(current.dataset.start) || 0
      const len = Math.max(1, Number(current.dataset.len) || 1)
      const ratio = Math.min(1, Math.max(0, (el.scrollTop - current.offsetTop) / Math.max(1, current.offsetHeight)))
      const offset = Math.round(start + ratio * len)
      const percent = Math.min(1, Math.max(0, offset / Math.max(1, totalChars)))
      const scrollRatio = Math.min(
        1,
        Math.max(0, el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight))
      )
      // 带章节名：书签列表与恢复提示都需要可读标签（否则只显示 0%）
      const idx = secs.indexOf(current)
      const label = chapters[idx]?.title || ''
      onLocate({ kind: 'offset', value: offset, percent, scrollRatio, label, updatedAt: Date.now() })
    }
    const onScroll = () => {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(report)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    // 首次进入也上报一次，保证书架能看到"已开始阅读"
    const t = window.setTimeout(report, 400)
    return () => {
      el.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(rafRef.current)
      window.clearTimeout(t)
    }
  }, [chapters, totalChars, onLocate])

  return (
    <div className="text-scroll" ref={scrollRef}>
      <div
        className={`text-inner${htmlMode ? ' text-inner--html' : ''}`}
        style={{
          fontSize: `${fontSize}px`,
          lineHeight,
          fontFamily,
          maxWidth: maxWidth > 0 ? `${maxWidth}px` : 'none',
        }}
      >
        {chapters.map((c, i) => (
          <section
            key={`${i}-${c.startChar}`}
            data-start={c.startChar}
            data-len={c.charCount}
            /* 内容来自本地文件，已做 HTML 转义/标签白名单处理 */
            dangerouslySetInnerHTML={{ __html: c.html }}
          />
        ))}
      </div>
    </div>
  )
}
