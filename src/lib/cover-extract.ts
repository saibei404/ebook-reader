/**
 * 导入时自动提取书籍封面。
 *
 * 三类来源：
 * - **EPUB**：按 OPF 规范找封面（`<meta name="cover">` → `properties="cover-image"` → 文件名含 cover），
 *   这是最可靠的（规范里封面有明确声明）。
 * - **CBZ**：漫画包，取包内第一张图片。
 * - **PDF**：没有"封面"概念，用第一页渲染成缩略图（视觉上最接近）。
 *
 * 两条工程约束：
 * 1. 解析库一律**动态 import**（fflate / pdfjs），导入收藏功能不能拖慢首屏；
 * 2. 任何一步失败都返回 null 而不是抛错——调用方据此回退到「书名程序化封面」，
 *    绝不能因为"取封面失败"而让整本书导入失败。
 */

/** 从路径/名字推断图片 mime */
function mimeOf(name: string): string {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  if (ext === 'png') return 'image/png'
  if (ext === 'gif') return 'image/gif'
  if (ext === 'webp') return 'image/webp'
  if (ext === 'svg') return 'image/svg+xml'
  if (ext === 'bmp') return 'image/bmp'
  return 'image/jpeg'
}

/** Uint8Array → Blob：显式复制到独立 ArrayBuffer，规避 ArrayBufferLike 的类型不兼容 */
function toBlob(bytes: Uint8Array, type: string): Blob {
  const buf = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buf).set(bytes)
  return new Blob([buf], { type })
}

/** zip 内路径解码（EPUB 的 href 常带 %20 等转义） */
function decodePath(p: string): string {
  try {
    return decodeURIComponent(p)
  } catch {
    return p
  }
}

/** 取 zip 里的条目：先精确匹配，再忽略大小写/前导斜杠兜底 */
function pickEntry(
  zip: Record<string, Uint8Array>,
  want: string
): Uint8Array | undefined {
  const norm = decodePath(want).replace(/^\.?\//, '')
  if (zip[norm]) return zip[norm]
  const lower = norm.toLowerCase()
  for (const key of Object.keys(zip)) {
    if (key.replace(/^\.?\//, '').toLowerCase() === lower) return zip[key]
  }
  return undefined
}

interface OpfItem {
  id: string
  href: string
  properties: string
  mediaType: string
}

/** 从 OPF 的 manifest 里挑封面图 */
function findEpubCoverHref(opf: string): string | null {
  const items: OpfItem[] = []
  const itemRe = /<item\b([^>]*?)\/?>/gi
  let m: RegExpExecArray | null
  while ((m = itemRe.exec(opf))) {
    const attrs = m[1] ?? ''
    const get = (name: string): string => {
      const r = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(attrs)
      return r ? r[1] : ''
    }
    items.push({
      id: get('id'),
      href: get('href'),
      properties: get('properties'),
      mediaType: get('media-type'),
    })
  }
  const isImage = (it: OpfItem) => /^image\//i.test(it.mediaType) || /\.(jpe?g|png|gif|webp)$/i.test(it.href)

  // 1) EPUB3：properties 里显式声明 cover-image
  const byProp = items.find((it) => /cover-image/i.test(it.properties) && isImage(it))
  if (byProp) return byProp.href

  // 2) EPUB2：<meta name="cover" content="cover-id">
  const meta = /<meta\b[^>]*name\s*=\s*["']cover["'][^>]*content\s*=\s*["']([^"']+)["']/i.exec(opf)
  if (meta) {
    const target = items.find((it) => it.id === meta[1])
    if (target && isImage(target)) return target.href
  }

  // 3) 兜底：文件名里带 cover 的第一张图
  const byName = items.find((it) => isImage(it) && /cover/i.test(it.href))
  return byName ? byName.href : null
}

export interface ExtractedCover {
  blob: Blob
  /** 来源，便于排查 */
  from: 'epub' | 'cbz' | 'pdf'
}

/** EPUB：读 META-INF/container.xml → OPF → 封面图 */
export async function extractEpubCover(data: ArrayBuffer): Promise<ExtractedCover | null> {
  try {
    const { unzipSync } = await import('fflate')
    const zip = unzipSync(new Uint8Array(data))
    const dec = new TextDecoder('utf-8')

    const containerBytes = pickEntry(zip, 'META-INF/container.xml')
    if (!containerBytes) return null
    const rootfile = /full-path\s*=\s*["']([^"']+)["']/i.exec(dec.decode(containerBytes))
    const opfPath = rootfile?.[1]
    if (!opfPath) return null

    const opfBytes = pickEntry(zip, opfPath)
    if (!opfBytes) return null
    const href = findEpubCoverHref(dec.decode(opfBytes))
    if (!href) return null

    // 封面 href 相对 OPF 所在目录
    const dir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : ''
    const bytes = pickEntry(zip, dir + href)
    if (!bytes || !bytes.length) return null
    return { blob: toBlob(bytes, mimeOf(href)), from: 'epub' }
  } catch {
    return null
  }
}

/** CBZ：取包内第一张图片（跳过 macOS 的 __MACOSX 与隐藏文件） */
export async function extractCbzCover(data: ArrayBuffer): Promise<ExtractedCover | null> {
  try {
    const { unzipSync } = await import('fflate')
    const zip = unzipSync(new Uint8Array(data))
    const names = Object.keys(zip)
      .filter((n) => !n.startsWith('__MACOSX/') && !/(^|\/)\./.test(n))
      .filter((n) => /\.(jpe?g|png|webp|gif)$/i.test(n))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    const first = names[0]
    if (!first) return null
    const bytes = zip[first]
    if (!bytes?.length) return null
    return { blob: toBlob(bytes, mimeOf(first)), from: 'cbz' }
  } catch {
    return null
  }
}

/**
 * PDF：渲染第一页。
 *
 * 超过 60MB 的文件直接放弃——为了取缩略图把几百 MB 再读一遍不划算，
 * 大 PDF 本来也不缺封面这一块（用户更在意打开速度）。
 */
export async function extractPdfCover(
  data: ArrayBuffer,
  size = data.byteLength
): Promise<ExtractedCover | null> {
  if (size > 60 * 1024 * 1024) return null
  try {
    const pdfjs = await import('pdfjs-dist')
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url
    ).href
    const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise
    try {
      const page = await doc.getPage(1)
      // 目标宽度约 300px，按比例算缩放（封面卡片 3:4）
      const base = page.getViewport({ scale: 1 })
      const scale = Math.min(1.4, 300 / Math.max(1, base.width))
      const viewport = page.getViewport({ scale })
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(viewport.width))
      canvas.height = Math.max(1, Math.round(viewport.height))
      const ctx = canvas.getContext('2d')
      if (!ctx) return null
      // PDF 背景是透明的，先铺白底再渲染，否则深色主题下会看到黑块
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      await page.render({ canvasContext: ctx, viewport }).promise
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86))
      return blob ? { blob, from: 'pdf' } : null
    } finally {
      void doc.destroy()
    }
  } catch {
    return null
  }
}

/** 按格式分派；返回 null 表示"没有可用封面"，调用方回退书名封面 */
export async function extractCover(
  format: string,
  data: ArrayBuffer,
  size?: number
): Promise<ExtractedCover | null> {
  if (format === 'epub') return extractEpubCover(data)
  if (format === 'cbz' || format === 'cbr') return extractCbzCover(data)
  if (format === 'pdf') return extractPdfCover(data, size)
  // txt/md/fb2/docx/mobi/azw3：没有内嵌封面概念
  return null
}
