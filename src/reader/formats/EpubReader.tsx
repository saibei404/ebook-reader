import { useEffect, useRef, useState } from 'react'
import ePub, { type Book as EpubBook, type Rendition } from 'epubjs'
import type { Locator } from '@/types/book'

interface Props {
  data: ArrayBuffer
  fontSize: number
  lineHeight: number
  bg: string
  fg: string
  initialLocator: Locator | null
  onLocate: (loc: Locator) => void
  onToc: (items: { label: string; href: string; depth: number }[]) => void
  onError: (msg: string) => void
}

type Contents = { document?: Document }

/**
 * EPUB 渲染（epub.js）。
 * - 定位：CFI（locator.kind='cfi'），跨字号/窗口尺寸仍精确；
 * - 百分比：locations 异步生成（大书耗时），未就绪时用 spine 进度兜底；
 * - 渲染：iframe 内嵌，flow='scrolled-doc' 纵向滚动；
 * - 主题：通过 hooks.content 直接写入 iframe 文档。
 *   （只用 rendition.themes.override 时首章常保持默认黑字黑底，表现为「有内容但看不见」）
 */
export function EpubReader({ data, fontSize, lineHeight, bg, fg, initialLocator, onLocate, onToc, onError }: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const bookRef = useRef<EpubBook | null>(null)
  const renditionRef = useRef<Rendition | null>(null)
  const [ready, setReady] = useState(false)
  const locReady = useRef(false)
  const styleRef = useRef({ fontSize, lineHeight, bg, fg })
  const reapplyRef = useRef<(() => void) | null>(null)
  /** 最近一次 relocated 的 CFI 与百分比；滚动上报时复用 */
  const lastRef = useRef<{ cfi: string; percent: number }>({ cfi: '', percent: 0 })
  /** 主动上报当前位置（display / 跳章后调用） */
  const reportCurrentRef = useRef<(() => void) | null>(null)

  styleRef.current = { fontSize, lineHeight, bg, fg }

  // 初始化：仅依赖数据本身
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let disposed = false
    const book = ePub(data)
    bookRef.current = book

    // renderTo 需要确定像素尺寸：容器未布局（高度 0）时会生成 0 高 iframe
    const w = host.clientWidth || Math.max(720, window.innerWidth)
    const h = host.clientHeight || Math.max(420, window.innerHeight - 108)

    const rendition = book.renderTo(host, {
      width: w,
      height: h,
      // 'scrolled-doc'：单章滚动（章内 iframe 承载），CFI 定位与首章渲染最稳定。
      // 位置记忆以 CFI 段落级恢复为准（像素滚动被封在 iframe 内，跨会话不保证逐像素还原）。
      flow: 'scrolled-doc',
      spread: 'none',
      allowScriptedContent: false,
    })
    renditionRef.current = rendition

    /** 读取当前渲染位置并上报（CFI + 百分比），不依赖 relocated 事件 */
    const reportCurrent = () => {
      try {
        const cur = (
          rendition as unknown as {
            currentLocation?: () => { start?: { cfi?: string; index?: number; percentage?: number } }
          }
        ).currentLocation?.()
        const cfi = cur?.start?.cfi
        if (!cfi) return
        const spine = book.spine as unknown as { spineItems?: unknown[]; length?: number }
        const total = spine?.spineItems?.length ?? spine?.length ?? 1
        const pct =
          typeof cur?.start?.percentage === 'number'
            ? cur.start.percentage
            : Math.min(1, ((cur?.start?.index ?? 0) + 1) / Math.max(1, total))
        lastRef.current = { cfi, percent: Math.max(0, pct) }
        onLocate({
          kind: 'cfi',
          value: cfi,
          percent: Math.max(0, pct),
          scrollRatio: Math.max(0, pct),
          updatedAt: Date.now(),
        })
      } catch {
        /* 读取当前位置失败不影响阅读 */
      }
    }
    reportCurrentRef.current = reportCurrent

    const applyStyle = (contents: Contents) => {
      const doc = contents?.document
      const body = doc?.body
      const html = doc?.documentElement
      if (!doc || !body || !html) return
      const s = styleRef.current
      html.style.background = s.bg
      body.style.background = s.bg
      body.style.color = s.fg
      body.style.fontSize = `${s.fontSize}px`
      body.style.lineHeight = String(s.lineHeight)
      body.style.padding = '0 4%'
      body.style.maxWidth = '780px'
      body.style.margin = '0 auto'
      doc.querySelectorAll('img').forEach((img) => {
        const el = img as HTMLImageElement
        el.style.maxWidth = '100%'
        el.style.height = 'auto'
      })
    }

    // 每个章节加载完成后注入样式
    rendition.hooks.content.register((contents: Contents) => applyStyle(contents))

    reapplyRef.current = () => {
      try {
        const contents = (rendition as unknown as { getContents?: () => Contents[] }).getContents?.()
        if (Array.isArray(contents)) contents.forEach(applyStyle)
      } catch {
        /* ignore */
      }
    }

    // 窗口尺寸变化时同步 iframe
    let raf = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        const nw = host.clientWidth
        const nh = host.clientHeight
        if (nw > 0 && nh > 0) {
          try {
            rendition.resize(nw, nh)
          } catch {
            /* ignore */
          }
        }
      })
    })
    ro.observe(host)

    const startCfi =
      initialLocator && initialLocator.kind === 'cfi' && typeof initialLocator.value === 'string'
        ? initialLocator.value
        : undefined

    rendition
      .display(startCfi)
      .then(() => {
        if (disposed) return
        setReady(true)
        // 主动上报：部分 epub.js 版本的 relocated 在首章不触发，仅靠事件会导致进度恒为 0%
        reportCurrent()
        // 恢复像素滚动位置（scrolled-doc 下 iframe 撑高，由宿主容器滚动）
        const ratio = initialLocator?.scrollRatio
        if (typeof ratio === 'number' && ratio > 0) {
          requestAnimationFrame(() => {
            const max = Math.max(1, host.scrollHeight - host.clientHeight)
            host.scrollTop = Math.min(max, ratio * max)
          })
        }
      })
      .catch((e) => {
        if (!disposed) onError(`EPUB 渲染失败：${String((e as Error)?.message ?? e)}`)
      })

    // 目录
    void book.loaded.navigation
      .then((nav) => {
        if (disposed) return
        const items: { label: string; href: string; depth: number }[] = []
        const walk = (list: { label: string; href: string; subitems?: unknown[] }[], depth = 0) => {
          for (const it of list) {
            items.push({ label: (it.label || '').trim() || '未命名章节', href: it.href, depth })
            const subs = (it.subitems ?? []) as { label: string; href: string; subitems?: unknown[] }[]
            if (subs.length) walk(subs, depth + 1)
          }
        }
        walk((nav.toc as unknown as { label: string; href: string; subitems?: unknown[] }[]) ?? [])
        onToc(items)
      })
      .catch(() => {
        /* 无目录不阻断阅读 */
      })

    // locations 生成后百分比更准（异步，不阻塞首屏）
    void book.ready
      .then(() => book.locations.generate(1200))
      .then(() => {
        if (!disposed) locReady.current = true
      })
      .catch(() => {
        /* 大书生成失败时保留 spine 兜底 */
      })

    return () => {
      disposed = true
      ro.disconnect()
      cancelAnimationFrame(raf)
      reapplyRef.current = null
      try {
        rendition.destroy()
      } catch {
        /* ignore */
      }
      try {
        book.destroy()
      } catch {
        /* ignore */
      }
      bookRef.current = null
      renditionRef.current = null
    }
    // 仅随数据变化重建（字号/配色走独立 effect，避免重载整本书）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  // 位置上报
  useEffect(() => {
    const rendition = renditionRef.current
    const book = bookRef.current
    if (!rendition || !book) return
    const onRelocated = (loc: { start: { cfi: string; href: string; percentage?: number; index?: number } }) => {
      const cfi = loc?.start?.cfi
      if (!cfi) return
      let percent = 0
      if (locReady.current) {
        try {
          percent = book.locations.percentageFromCfi(cfi) || 0
        } catch {
          percent = 0
        }
      }
      if (!percent && typeof loc.start.percentage === 'number') percent = loc.start.percentage
      if (!percent) {
        const spine = book.spine as unknown as { spineItems?: unknown[]; length?: number }
        const total = spine?.spineItems?.length ?? spine?.length ?? 1
        percent = Math.min(1, ((loc.start.index ?? 0) + 1) / total)
      }
      const p = Math.min(1, Math.max(0, percent))
      lastRef.current = { cfi, percent: p }
      const host = hostRef.current
      const scrollRatio = host
        ? Math.min(1, Math.max(0, host.scrollTop / Math.max(1, host.scrollHeight - host.clientHeight)))
        : p
      onLocate({ kind: 'cfi', value: cfi, percent: p, scrollRatio, updatedAt: Date.now() })
    }
    rendition.on('relocated', onRelocated)
    return () => {
      rendition.off('relocated', onRelocated)
    }
  }, [onLocate, ready])

  // 目录跳转（外层目录面板派发 CustomEvent）
  useEffect(() => {
    const onJump = (e: Event) => {
      const href = (e as CustomEvent<string>).detail
      const rendition = renditionRef.current
      if (!href || !rendition) return
      void rendition
        .display(href)
        .then(() => {
          // 跳章后立即更新进度与 CFI，保证"读到哪记到哪"
          window.setTimeout(() => reportCurrentRef.current?.(), 350)
        })
        .catch(() => {
          /* 无效 href 时忽略 */
        })
    }
    window.addEventListener('moyu:toc-jump', onJump as EventListener)
    return () => window.removeEventListener('moyu:toc-jump', onJump as EventListener)
  }, [])

  // 宿主滚动 → 上报像素比例（relocated 只在段落/章节切换时触发，不足以记录连续滚动位置）
  useEffect(() => {
    const host = hostRef.current
    if (!host || !ready) return
    let raf = 0
    const report = () => {
      const max = Math.max(1, host.scrollHeight - host.clientHeight)
      const scrollRatio = Math.min(1, Math.max(0, host.scrollTop / max))
      const { cfi, percent } = lastRef.current
      onLocate({
        kind: 'cfi',
        value: cfi || percent,
        percent: Math.max(percent, scrollRatio),
        scrollRatio,
        updatedAt: Date.now(),
      })
    }
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(report)
    }
    host.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      host.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [onLocate, ready])

  // 排版/主题变化：直接改写当前 iframe（不重建整本书）
  useEffect(() => {
    reapplyRef.current?.()
    const rendition = renditionRef.current
    if (!rendition || !ready) return
    try {
      rendition.themes.fontSize(`${fontSize}px`)
    } catch {
      /* ignore */
    }
  }, [fontSize, lineHeight, bg, fg, ready])

  return <div className="epub-host" ref={hostRef} />
}
