import { useEffect, useRef, useState } from 'react'
import { unzipSync } from 'fflate'
import type { Locator } from '@/types/book'

interface Props {
  /** CBZ：压缩包字节，组件内用 fflate 解包 */
  data?: ArrayBuffer
  /** CBR：主进程已解好图片并落盘，这里直接给 URL（可能是 moyu-file://） */
  images?: { name: string; url: string }[]
  initialLocator: Locator | null
  onLocate: (loc: Locator) => void
  onError: (msg: string) => void
  onInfo: (info: { pages: number }) => void
}

const IMG_RE = /\.(jpe?g|png|webp|gif|avif|bmp)$/i

/**
 * 漫画渲染（CBZ = ZIP 图片包；CBR 实为 RAR，暂解不支持时明确提示）。
 * - 解压用 fflate（纯 JS，无依赖）；
 * - 图片按文件名自然排序（避免 10 排在 2 前面）；
 * - 位置：locator.kind='index'（0-based 图片序号）。
 */
export function ComicReader({ data, images, initialLocator, onLocate, onError, onInfo }: Props) {
  const [urls, setUrls] = useState<{ name: string; url: string }[]>([])
  const scrollRef = useRef<HTMLDivElement>(null)
  const pageRefs = useRef<(HTMLImageElement | null)[]>([])
  const objectUrls = useRef<string[]>([])
  const restored = useRef(false)

  useEffect(() => {
    let disposed = false
    // CBR 走主进程解包：图片地址已经就绪，不做二次解压，也不接管 URL 生命周期
    if (images?.length) {
      setUrls(images)
      onInfo({ pages: images.length })
      restored.current = false
      return () => {
        disposed = true
      }
    }
    if (!data) return
    try {
      const files = unzipSync(new Uint8Array(data))
      const names = Object.keys(files)
        .filter((n) => IMG_RE.test(n) && files[n]?.length)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }))
      if (!names.length) {
        onError('压缩包内没有可显示的图片（支持 JPG / PNG / WebP / GIF / AVIF / BMP）')
        return
      }
      const list = names.map((n) => {
        const blob = new Blob([files[n]], { type: mimeOf(n) })
        const url = URL.createObjectURL(blob)
        objectUrls.current.push(url)
        return { name: n, url }
      })
      if (!disposed) {
        setUrls(list)
        onInfo({ pages: list.length })
      }
    } catch (e) {
      onError(`漫画解包失败：${String((e as Error)?.message ?? e)}（CBZ/CBR 需为 ZIP 或 RAR 压缩包）`)
    }
    return () => {
      disposed = true
      for (const u of objectUrls.current) URL.revokeObjectURL(u)
      objectUrls.current = []
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, images])

  // 恢复页码：图片未加载时元素无高度，scrollIntoView 会失效，因此按帧重试至就位
  useEffect(() => {
    if (restored.current || !urls.length) return
    const idx = initialLocator && initialLocator.kind === 'index' ? Number(initialLocator.value) : 0
    if (!Number.isFinite(idx) || idx <= 0) {
      restored.current = true
      return
    }
    // 图片解码可能几百毫秒到数秒，rAF 重试窗口不够；改用定时器最多等 4s
    let tries = 0
    let timer = 0
    const attempt = () => {
      tries++
      const root = scrollRef.current
      const target = pageRefs.current[Math.min(idx, urls.length - 1)]
      // 必须等容器真正撑开（图片加载后才可滚），否则会把 scrollTop 设成 0 并提前结束
      if (root && target && target.offsetTop > 0 && root.scrollHeight - root.clientHeight > 100) {
        const max = root.scrollHeight - root.clientHeight
        const ratio = initialLocator?.scrollRatio
        // 与 PDF 同口径：优先精确比例，无比例时回到页首
        root.scrollTop = typeof ratio === 'number' && ratio > 0 ? ratio * max : target.offsetTop
        restored.current = true
        return
      }
      if (tries < 80) timer = window.setTimeout(attempt, 50)
      else restored.current = true
    }
    attempt()
    return () => window.clearTimeout(timer)
  }, [urls, initialLocator])

  // 上报
  useEffect(() => {
    const root = scrollRef.current
    if (!root || !urls.length) return
    let raf = 0
    const report = () => {
      const top = root.scrollTop + 60
      let current = 0
      for (let i = 0; i < pageRefs.current.length; i++) {
        const el = pageRefs.current[i]
        if (el && el.offsetTop <= top) current = i
        else break
      }
      const percent = Math.min(1, Math.max(0, (current + 1) / urls.length))
      const scrollRatio = Math.min(1, Math.max(0, root.scrollTop / Math.max(1, root.scrollHeight - root.clientHeight)))
      onLocate({
        kind: 'index',
        value: current,
        percent,
        scrollRatio,
        label: `${current + 1} / ${urls.length} 页`,
        updatedAt: Date.now(),
      })
    }
    const onScroll = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(report)
    }
    root.addEventListener('scroll', onScroll, { passive: true })
    const t = window.setTimeout(report, 400)
    return () => {
      root.removeEventListener('scroll', onScroll)
      cancelAnimationFrame(raf)
      window.clearTimeout(t)
    }
  }, [urls, onLocate])

  return (
    <div className="comic-scroll" ref={scrollRef}>
      {urls.map((u, i) => (
        <img
          key={u.name}
          className="comic-page"
          src={u.url}
          alt={`第 ${i + 1} 页`}
          loading="lazy"
          decoding="async"
          ref={(el) => {
            pageRefs.current[i] = el
          }}
        />
      ))}
    </div>
  )
}

function mimeOf(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  if (ext === 'png') return 'image/png'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'avif') return 'image/avif'
  if (ext === 'bmp') return 'image/bmp'
  return 'image/jpeg'
}
