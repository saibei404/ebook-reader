import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { Locator } from '@/types/book'

// pdf.js worker：Vite 将其作为独立资源打包，离线可用（不依赖 CDN）
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href

interface Props {
  /** 完整字节（小文件或非流式来源时使用） */
  data: ArrayBuffer | null
  /** moyu-file:// 地址：由 pdf.js 按 Range 分块读取，数百 MB 也不占内存 */
  url?: string
  scaleMode: 'page-width' | 'page-fit' | 'auto'
  initialLocator: Locator | null
  onLocate: (loc: Locator) => void
  onError: (msg: string) => void
  onInfo: (info: { pages: number }) => void
}

/**
 * PDF 渲染（pdf.js）。
 * - 首屏只渲染第 1 页，其余页按 IntersectionObserver 懒渲染（大文件不卡死）；
 * - 每页 canvas 在离开视口较远时释放像素（限制保留数量），控制内存；
 * - 位置：locator.kind='page'（1-based 页码）。
 */
export function PdfReader({ data, url, scaleMode, initialLocator, onLocate, onError, onInfo }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const docRef = useRef<PDFDocumentProxy | null>(null)
  const [pages, setPages] = useState<{ width: number; height: number }[]>([])
  const renderedRef = useRef(new Map<number, HTMLCanvasElement>())
  const pageRefs = useRef<(HTMLDivElement | null)[]>([])
  const ioRef = useRef<IntersectionObserver | null>(null)
  const restored = useRef(false)

  // 载入文档 + 计算每页占位尺寸
  useEffect(() => {
    let disposed = false
    if (!data && !url) {
      onError('缺少可读取的文件来源')
      return
    }
    // 优先 url（Range 流式）；仅在无 url 时退化为内存数据
    const task = pdfjsLib.getDocument(
      url
        ? {
            url,
            // 每块 512KB：大文件首屏只需读少量分块即可出第一页
            rangeChunkSize: 512 * 1024,
            disableAutoFetch: true,
            disableStream: false,
          }
        : { data: new Uint8Array(data as ArrayBuffer) }
    )
    task.promise
      .then(async (doc) => {
        if (disposed) return
        docRef.current = doc
        onInfo({ pages: doc.numPages })
        const host = scrollRef.current
        const baseWidth = Math.max(320, (host?.clientWidth ?? 900) - 48)
        const sizes: { width: number; height: number }[] = []
        // 仅探测前 3 页尺寸，其余用第 1 页比例推算（避免大文档逐页 await）
        const probe = await doc.getPage(1)
        const vp1 = probe.getViewport({ scale: 1 })
        const scale = scaleMode === 'page-fit' ? 1 : baseWidth / vp1.width
        for (let i = 1; i <= doc.numPages; i++) {
          if (i <= 3) {
            const pg = await doc.getPage(i)
            const vp = pg.getViewport({ scale })
            sizes.push({ width: vp.width, height: vp.height })
          } else {
            sizes.push({ width: vp1.width * scale, height: vp1.height * scale })
          }
        }
        if (!disposed) setPages(sizes)
      })
      .catch((e) => {
        if (!disposed) onError(`PDF 打开失败：${String(e?.message ?? e)}`)
      })
    return () => {
      disposed = true
      ioRef.current?.disconnect()
      void task.destroy()
      docRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, url])

  // 懒渲染 + 内存控制
  useEffect(() => {
    if (!pages.length) return
    const root = scrollRef.current
    if (!root) return
    ioRef.current?.disconnect()

    const render = async (idx: number) => {
      const doc = docRef.current
      const holder = pageRefs.current[idx]
      if (!doc || !holder || renderedRef.current.has(idx)) return
      const size = pages[idx]
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const canvas = document.createElement('canvas')
      canvas.className = 'pdf-page'
      canvas.width = Math.floor(size.width * dpr)
      canvas.height = Math.floor(size.height * dpr)
      canvas.style.width = `${size.width}px`
      canvas.style.height = `${size.height}px`
      try {
        const page = await doc.getPage(idx + 1)
        const vp = page.getViewport({ scale: (size.width / page.getViewport({ scale: 1 }).width) * dpr })
        const ctx = canvas.getContext('2d')
        if (!ctx) return
        await page.render({ canvasContext: ctx, viewport: vp }).promise
        if (!holder.isConnected) return
        holder.replaceChildren(canvas)
        renderedRef.current.set(idx, canvas)
        // 保留最近 12 页，超出释放像素以控制内存
        if (renderedRef.current.size > 12) {
          const oldest = [...renderedRef.current.keys()].find((k) => Math.abs(k - idx) > 6)
          if (oldest != null) {
            const c = renderedRef.current.get(oldest)
            if (c) {
              c.width = 0
              c.height = 0
            }
            renderedRef.current.delete(oldest)
          }
        }
      } catch {
        /* 单页渲染失败保留占位，不阻断整篇 */
      }
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const idx = Number((e.target as HTMLElement).dataset.page)
          if (e.isIntersecting) void render(idx)
        }
      },
      { root, rootMargin: '600px 0px' }
    )
    ioRef.current = io
    pageRefs.current.forEach((el) => el && io.observe(el))
    void render(0)
    return () => io.disconnect()
  }, [pages])

  // 恢复页码：占位元素布局完成后才定位，未就绪时按帧重试
  useEffect(() => {
    if (restored.current || !pages.length) return
    const page = initialLocator && initialLocator.kind === 'page' ? Number(initialLocator.value) : 1
    if (!Number.isFinite(page) || page <= 1) {
      restored.current = true
      return
    }
    let tries = 0
    const attempt = () => {
      tries++
      const root = scrollRef.current
      const el = pageRefs.current[Math.min(page - 1, pages.length - 1)]
      if (root && el && el.offsetTop > 0) {
        root.scrollTop = el.offsetTop
        restored.current = true
        return
      }
      if (tries < 20) requestAnimationFrame(attempt)
      else restored.current = true
    }
    requestAnimationFrame(attempt)
  }, [pages, initialLocator])

  // 上报当前页码
  useEffect(() => {
    const root = scrollRef.current
    if (!root || !pages.length) return
    let raf = 0
    const report = () => {
      const top = root.scrollTop + 40
      let current = 1
      for (let i = 0; i < pageRefs.current.length; i++) {
        const el = pageRefs.current[i]
        if (el && el.offsetTop <= top) current = i + 1
        else break
      }
      const percent = Math.min(1, Math.max(0, current / pages.length))
      onLocate({ kind: 'page', value: current, percent, label: `第 ${current} 页`, updatedAt: Date.now() })
    }
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(report)
    }
    root.addEventListener('scroll', onScroll, { passive: true })
    const t = window.setTimeout(report, 500)
    return () => {
      root.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
      window.clearTimeout(t)
    }
  }, [pages, onLocate])

  return (
    <div className="pdf-scroll" ref={scrollRef}>
      {pages.map((s, i) => (
        <div
          key={i}
          data-page={i}
          ref={(el) => {
            pageRefs.current[i] = el
          }}
          style={{ width: s.width, minHeight: s.height }}
        >
          <div className="pdf-page-ph" style={{ width: s.width, height: s.height }}>
            {i + 1}
          </div>
        </div>
      ))}
    </div>
  )
}
