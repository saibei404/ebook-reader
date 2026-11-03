import { useEffect, useRef, useState } from 'react'
import ePub, { EpubCFI, type Book as EpubBook, type Rendition } from 'epubjs'
import type { Annotation, AnnotationColor, Locator } from '@/types/book'

export interface EpubSelection {
  cfiRange: string
  text: string
  x: number
  top: number
}

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
  /** 已有高亮（CFI Range） */
  annotations?: Annotation[]
  onSelect?: (sel: EpubSelection | null) => void
  onHighlightClick?: (id: string) => void
}

/** 高亮配色（iframe 内的 ::highlight 伪元素） */
const EPUB_COLORS: AnnotationColor[] = ['yellow', 'green', 'blue', 'pink']

const EPUB_HL_CSS: Record<AnnotationColor, string> = {
  yellow: 'rgba(250, 204, 21, 0.38)',
  green: 'rgba(52, 211, 153, 0.34)',
  blue: 'rgba(96, 165, 250, 0.34)',
  pink: 'rgba(244, 114, 182, 0.34)',
}

/** 往章节文档注入一次高亮样式（::highlight 只在注册表所在文档生效） */
function ensureHighlightStyle(doc: Document): void {
  if (doc.querySelector('style[data-moyu-hl]')) return
  const style = doc.createElement('style')
  style.setAttribute('data-moyu-hl', '1')
  style.textContent = EPUB_COLORS.map(
    (c) => `::highlight(moyu-hl-${c}) { background-color: ${EPUB_HL_CSS[c]}; }`
  ).join('\n')
  ;(doc.head ?? doc.documentElement).appendChild(style)
}

type Contents = {
  document?: Document
  window?: Window
  cfiFromRange?: (range: Range) => string
}

/**
 * EPUB 渲染（epub.js）。
 * - 定位：CFI（locator.kind='cfi'），跨字号/窗口尺寸仍精确；
 * - 百分比：locations 异步生成（大书耗时），未就绪时用 spine 进度兜底；
 * - 渲染：iframe 内嵌，flow='scrolled-doc' 纵向滚动；
 * - 主题：通过 hooks.content 直接写入 iframe 文档。
 *   （只用 rendition.themes.override 时首章常保持默认黑字黑底，表现为「有内容但看不见」）
 */
/** #rrggbb / #rgb → 相对亮度 0–1（用于判断主题底色深浅） */
function hexLuminance(hex: string): number {
  const h = hex.replace('#', '').trim()
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6)
  const r = Number.parseInt(full.slice(0, 2), 16) || 0
  const g = Number.parseInt(full.slice(2, 4), 16) || 0
  const b = Number.parseInt(full.slice(4, 6), 16) || 0
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

export function EpubReader({
  data,
  fontSize,
  lineHeight,
  bg,
  fg,
  initialLocator,
  onLocate,
  onToc,
  onError,
  annotations = [],
  onSelect,
  onHighlightClick,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null)
  const bookRef = useRef<EpubBook | null>(null)
  const renditionRef = useRef<Rendition | null>(null)
  const [ready, setReady] = useState(false)
  /** 首章是否已渲染完成（resize 与高亮都要等它） */
  const readyRef = useRef(false)
  const locReady = useRef(false)
  const styleRef = useRef({ fontSize, lineHeight, bg, fg })
  const reapplyRef = useRef<(() => void) | null>(null)
  /** 回调走 ref：初次初始化只跑一次（依赖 data），不能因回调变化重建整本书 */
  const onSelectRef = useRef(onSelect)
  const onHighlightClickRef = useRef(onHighlightClick)
  const annotationsRef = useRef<Annotation[]>(annotations)
  onSelectRef.current = onSelect
  onHighlightClickRef.current = onHighlightClick
  annotationsRef.current = annotations
  /** 已渲染的高亮 Range（点击命中检测用） */
  const rangeMapRef = useRef<{ id: string; range: Range }[]>([])
  /** 重挂载高亮的函数（初始化时写入，annotations 变化时调用） */
  const applyAnnoRef = useRef<(() => void) | null>(null)
  /** 最近一次 relocated 的 CFI 与百分比；滚动上报时复用 */
  const lastRef = useRef<{ cfi: string; percent: number }>({ cfi: '', percent: 0 })
  /** 主动上报当前位置（display / 跳章后调用） */
  const reportCurrentRef = useRef<(() => void) | null>(null)
  /** 位置快照（cfi/href/percent/章内滚动比例/章节名） */
  const snapshotRef = useRef<
    (() => { cfi: string; href: string; percent: number; scrollRatio: number; label?: string } | null) | null
  >(null)
  /** 目录（章节名快照用） */
  const tocRef = useRef<{ label: string; href: string; depth: number }[]>([])

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

    /**
     * 真正的滚动容器是 epub.js 生成的 .epub-container（scrolled-doc 下 iframe 撑满高度、
     * 由 container 滚动）。此前读写 host（.epub-host，overflow:hidden）导致 scrollTop 恒为 0，
     * 章内位置既记不下也恢复不了。
     */
    const getScroller = (): HTMLElement | null =>
      (host.querySelector('.epub-container, .epub-view') as HTMLElement | null) ?? null

    const clamp01 = (n: number) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0))

    /** 采集当前位置快照：CFI + href + 全局百分比 + 章内滚动比例 */
    const snapshot = () => {
      try {
        const cur = (
          rendition as unknown as {
            currentLocation?: () => {
              start?: { cfi?: string; href?: string; index?: number; percentage?: number }
            }
          }
        ).currentLocation?.()
        const start = cur?.start
        const cfi = start?.cfi
        if (!cfi) return null

        let pct = 0
        if (locReady.current) {
          try {
            pct = book.locations.percentageFromCfi(cfi) || 0
          } catch {
            pct = 0
          }
        }
        if (!pct && typeof start?.percentage === 'number') pct = start.percentage
        if (!pct) {
          const spine = book.spine as unknown as { spineItems?: unknown[]; length?: number }
          const total = spine?.spineItems?.length ?? spine?.length ?? 1
          pct = (Number(start?.index ?? 0) + 1) / Math.max(1, total)
        }

        const el = getScroller()
        const scrollRatio = el ? clamp01(el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight)) : 0

        // 章节名：toc 里 href 前缀匹配（书签展示用）
        let label = ''
        const href = start?.href || ''
        if (href) {
          const hit = tocRef.current.find((t) => href.endsWith(t.href) || t.href.endsWith(href))
          label = hit?.label || href.split('/').pop()?.replace(/\.x?html?$/i, '') || ''
        }

        return { cfi, href, percent: clamp01(pct), scrollRatio, label }
      } catch {
        return null
      }
    }

    /** 读取当前渲染位置并上报（不依赖 relocated 事件） */
    const reportCurrent = () => {
      const snap = snapshot()
      if (!snap) return
      lastRef.current = { cfi: snap.cfi, percent: snap.percent }
      onLocate({
        kind: 'cfi',
        value: snap.cfi,
        percent: snap.percent,
        scrollRatio: snap.scrollRatio,
        href: snap.href || undefined,
        label: snap.label || undefined,
        updatedAt: Date.now(),
      })
    }
    reportCurrentRef.current = reportCurrent
    snapshotRef.current = snapshot

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

      // 作者 CSS 常写死深灰字（h4{color:#444}、small{color:#666}）与浅灰底（blockquote{background:#f7f7f8}），
      // 在深色主题下几乎不可读。这里只对「灰阶」颜色做主题适配，高饱和强调色保持作者原样。
      const bgLum = hexLuminance(s.bg)
      const dark = bgLum < 0.5
      doc.querySelectorAll('body *').forEach((node) => {
        const el = node as HTMLElement
        if (el.tagName === 'IMG' || el.tagName === 'svg' || el.tagName === 'SVG') return
        const cs = doc.defaultView?.getComputedStyle(el)
        if (!cs) return

        const cm = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s]+([\d.]+))?/.exec(cs.color)
        if (cm) {
          const r = Number(cm[1])
          const g = Number(cm[2])
          const b = Number(cm[3])
          const alpha = cm[4] === undefined ? 1 : Number(cm[4])
          const sat = Math.max(r, g, b) - Math.min(r, g, b)
          const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
          const tooDim = dark ? lum < 0.5 : lum > 0.74
          if (sat <= 45 && alpha > 0.2 && tooDim) el.style.setProperty('color', 'inherit', 'important')
        }

        const bm = /rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)(?:[,\s]+([\d.]+))?/.exec(cs.backgroundColor)
        if (bm) {
          const r = Number(bm[1])
          const g = Number(bm[2])
          const b = Number(bm[3])
          const alpha = bm[4] === undefined ? 1 : Number(bm[4])
          const sat = Math.max(r, g, b) - Math.min(r, g, b)
          const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
          const clashes = dark ? lum > 0.62 : lum < 0.35
          // 灰阶且与主题背景冲突的整块底色 → 换成低透明度中性底，保留「有底色块」的层次感
          if (sat <= 45 && alpha > 0.2 && clashes) {
            el.style.setProperty('background-color', dark ? 'rgba(255,255,255,0.07)' : 'rgba(0,0,0,0.05)', 'important')
          }
        }
      })
    }

    /** iframe 内的选区：CFI Range + 视口坐标（加上 iframe 偏移，供外层工具条定位） */
    const attachSelection = (contents: Contents) => {
      const doc = contents.document
      const win = contents.window
      if (!doc || !win) return
      const flag = doc as Document & { __moyuSel?: boolean }
      if (flag.__moyuSel) return
      flag.__moyuSel = true

      const report = () => {
        if (!onSelectRef.current) return
        let sel: Selection | null = null
        try {
          sel = win.getSelection()
        } catch {
          return
        }
        if (!sel || sel.isCollapsed || sel.rangeCount === 0) return
        const range = sel.getRangeAt(0)
        const text = sel.toString().replace(/\s+/g, ' ').trim()
        if (!text) return
        let cfiRange = ''
        try {
          cfiRange = contents.cfiFromRange?.(range) ?? ''
        } catch {
          cfiRange = ''
        }
        if (!cfiRange) return
        const r = range.getBoundingClientRect()
        const frame = doc.defaultView?.frameElement as HTMLElement | null
        const fr = frame?.getBoundingClientRect()
        onSelectRef.current({
          cfiRange,
          text,
          x: (fr?.left ?? 0) + r.left + r.width / 2,
          top: (fr?.top ?? 0) + r.top,
        })
      }
      doc.addEventListener('mouseup', () => window.setTimeout(report, 0))
      doc.addEventListener('mousedown', () => onSelectRef.current?.(null))
      // 点击已有高亮 → 交回外层打开备注气泡
      doc.addEventListener('click', (e) => {
        const caret = doc.caretRangeFromPoint?.(e.clientX, e.clientY)
        if (!caret) return
        const hit = rangeMapRef.current.find(({ range }) => {
          try {
            return range.isPointInRange(caret.startContainer, caret.startOffset)
          } catch {
            return false
          }
        })
        if (hit) onHighlightClickRef.current?.(hit.id)
      })
    }

    // 每个章节加载完成后注入样式 + 挂选区监听
    rendition.hooks.content.register((contents: Contents) => {
      applyStyle(contents)
      attachSelection(contents)
    })

    /**
     * 高亮应用：不用 epub.js 的 annotations 模块（它依赖 sectionIndex 与 view 对齐，
     * 在 scrolled-doc + 单章重复渲染时经常「无异常但不出现」），
     * 改为在 iframe 文档里直接把 CFI Range 注册到 CSS Custom Highlight API，
     * 与文本类高亮共用一套思路：不改 DOM、可随时清除重挂。
     */
    const applyAnnotations = () => {
      const contentsList =
        (rendition as unknown as { getContents?: () => Contents[] }).getContents?.() ?? []
      let applied = 0
      const ranges: { id: string; range: Range }[] = []
      for (const c of contentsList) {
        const doc = c.document
        const win = c.window as
          | (Window & { CSS?: { highlights?: Map<string, unknown> }; Highlight?: unknown })
          | undefined
        if (!doc || !win) continue
        const registry = win.CSS?.highlights
        const HighlightCtor =
          (win as { Highlight?: new (...r: Range[]) => unknown }).Highlight ??
          (typeof Highlight !== 'undefined' ? Highlight : null)
        if (!registry || !HighlightCtor) continue

        ensureHighlightStyle(doc)
        for (const color of EPUB_COLORS) registry.delete(`moyu-hl-${color}`)
        const groups = new Map<AnnotationColor, Range[]>()
        for (const a of annotationsRef.current) {
          if (!a.cfiRange) continue
          let range: Range | null = null
          try {
            range = new EpubCFI(a.cfiRange).toRange(doc) ?? null
          } catch {
            range = null
          }
          if (!range) continue
          const arr = groups.get(a.color) ?? []
          arr.push(range)
          groups.set(a.color, arr)
          ranges.push({ id: a.id, range })
          applied += 1
        }
        for (const [color, list] of groups) {
          try {
            registry.set(`moyu-hl-${color}`, new HighlightCtor(...list))
          } catch {
            /* 内核不支持时忽略 */
          }
        }
      }
      rangeMapRef.current = ranges
      ;(window as unknown as { __moyuAnno?: unknown }).__moyuAnno = {
        calls: ((window as unknown as { __moyuAnno?: { calls?: number } }).__moyuAnno?.calls ?? 0) + 1,
        total: annotationsRef.current.length,
        applied,
        docs: contentsList.length,
      }
    }
    applyAnnoRef.current = applyAnnotations
    rendition.on('rendered', () => {
      if (disposed) return
      window.setTimeout(() => {
        if (!disposed) applyAnnotations()
      }, 150)
    })

    reapplyRef.current = () => {
      try {
        const contents = (rendition as unknown as { getContents?: () => Contents[] }).getContents?.()
        if (Array.isArray(contents)) contents.forEach(applyStyle)
      } catch {
        /* ignore */
      }
    }

    // 窗口尺寸变化时同步 iframe
    // 注意：首章渲染完成前不得调用 resize —— 可见窗口在 show 后会立即触发一次
    // ResizeObserver 回调，此时 epub.js 还没有任何 view，resize 会打断 display 流程，
    // 表现为「有 .epub-container、但永远没有 iframe、也没有报错」。
    let raf = 0
    const ro = new ResizeObserver(() => {
      if (!readyRef.current) return
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

    /** 章内滚动恢复：容器高度依赖 iframe 布局，按帧重试直到可滚 */
    const restoreScroll = (ratio: number | undefined) => {
      if (typeof ratio !== 'number' || ratio <= 0.001) return
      let tries = 0
      const tick = () => {
        if (disposed) return
        const el = getScroller()
        if (el) {
          const max = el.scrollHeight - el.clientHeight
          if (max > 4) {
            el.scrollTop = clamp01(ratio) * max
            return
          }
        }
        if (++tries < 30) requestAnimationFrame(tick)
      }
      requestAnimationFrame(tick)
    }

    const targetHref = initialLocator?.href

    rendition
      .display(startCfi ?? targetHref)
      .then(async () => {
        if (disposed) return
        readyRef.current = true
        setReady(true)

        // 校验：display 后若章节不符（CFI 属于旧版/异常），用 href 二次定位
        try {
          const cur = (
            rendition as unknown as { currentLocation?: () => { start?: { href?: string } } }
          ).currentLocation?.()
          const gotHref = cur?.start?.href
          if (targetHref && gotHref && gotHref !== targetHref) {
            await rendition.display(targetHref)
          }
        } catch {
          /* 兜底失败时保留当前章，不阻断阅读 */
        }
        if (disposed) return

        restoreScroll(initialLocator?.scrollRatio)

        // 延迟上报：等 relocated 稳定，避免把"尚未到位的旧位置"写回覆盖目标
        window.setTimeout(() => {
          if (disposed) return
          const snap = snapshot()
          if (targetHref && snap?.href && snap.href !== targetHref) return
          reportCurrent()
        }, 500)
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
        tocRef.current = items
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
      applyAnnoRef.current = null
      rangeMapRef.current = []
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
    const onRelocated = () => {
      // 统一走快照：CFI / href / 百分比 / 章内滚动一并取，避免多套口径
      window.setTimeout(() => reportCurrentRef.current?.(), 120)
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

  // 注解增删改：重新挂载高亮（不重建整本书）
  useEffect(() => {
    if (!ready) return
    applyAnnoRef.current?.()
  }, [annotations, ready])

  return <div className="epub-host" ref={hostRef} />
}
