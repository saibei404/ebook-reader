/**
 * 二进制容器格式 → 阅读管线可消费的中间产物。
 *
 * 为什么放在主进程：AZW3/AZW（PalmDB + MOBI/KF8）、CBR（RAR）、DOC（OLE2/CFB）
 * 都是 Node 生态成熟的解析场景，放主进程可以：
 *   - 直接读文件、写临时资源（图片），不必把几十 MB 塞进 IPC；
 *   - 复用 `moyu-file://` 协议给渲染层供图，避开 CSP 对 blob/data 的限制。
 *
 * 统一契约（供 `moyu:read-book` 返回）：
 *   mode:'chapters' → 章节 HTML（AZW3/AZW/MOBI），渲染层按 h1 分章、走文本管线；
 *   mode:'images'   → 图片 URL 序列（CBR），渲染层走漫画管线；
 *   mode:'text'     → 纯文本（DOC），渲染层按段落规则分章。
 * 任何失败都返回 `{ ok:false, error }`，文案与其它格式的错误处理保持一致。
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { unzipSync } from 'fflate'
import { initKf8File, initMobiFile } from '@lingo-reader/mobi-parser'
import { createExtractorFromData } from 'node-unrar-js'
import WordExtractor from 'word-extractor'

export interface ChapterHtml {
  title: string
  html: string
}

export type ConvertResult =
  | { ok: true; mode: 'chapters'; chapters: ChapterHtml[]; meta: { title?: string; author?: string } }
  | { ok: true; mode: 'images'; images: { name: string; url: string }[] }
  | { ok: true; mode: 'text'; text: string }
  | { ok: false; error: string }

const IMG_EXT = /\.(jpe?g|png|gif|webp|bmp|avif|heic|heif|tiff?)$/i
/** 章节标题兜底：从 HTML 里抹掉标签后取前 24 字 */
const plain = (s: string): string =>
  s
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()

/** 缓存目录：同一文件（路径+mtime+size）复用，避免每次打开都重新解包 */
export function convDir(root: string, filePath: string): string {
  let stamp = ''
  try {
    const st = fs.statSync(filePath)
    stamp = `${filePath}|${st.size}|${st.mtimeMs}`
  } catch {
    stamp = filePath
  }
  const hash = crypto.createHash('sha1').update(stamp).digest('hex').slice(0, 16)
  return path.join(root, hash)
}

/** KF8/MOBI 章节 HTML 清理：去掉文档壳、把本地图片路径换成 moyu-file:// （保留其它属性） */
function cleanMobiHtml(html: string, toUrl: (p: string) => string): string {
  let out = html
  // <?xml …?> / <!DOCTYPE …> / <html>/<head>/<body> 外壳渲染层不需要
  out = out.replace(/<\?xml[^>]*\?>/gi, '')
  out = out.replace(/<!DOCTYPE[^>]*>/gi, '')
  out = out.replace(/<\/?(html|head|body|meta|title|link)\b[^>]*>/gi, '')
  // <img src="D:\…\0002.gif"> → 自定义协议；只改真实磁盘路径，http/data 保持原样
  out = out.replace(/(<img\b[^>]*?\bsrc=")([^"]+)(")/gi, (m, pre: string, src: string, post: string) => {
    if (/^(https?:|data:|blob:|moyu-file:)/i.test(src)) return m
    const abs = /^[a-zA-Z]:[\\/]/.test(src) || src.startsWith('\\\\') ? src : ''
    if (!abs) return m
    return `${pre}${toUrl(abs)}${post}`
  })
  // kindle:pos / filepos 内部锚点：保留文字，去掉不可跳转的 href
  out = out.replace(/href="kindle:[^"]*"/gi, 'href="#"')
  return out
}

/** 单章节 HTML 拆成多章：优先 h1，没有就 h2，再没有就整篇一章 */
function splitHtml(html: string, fallbackTitle: string): ChapterHtml[] {
  const cut = (h: string, tag: 'h1' | 'h2'): ChapterHtml[] => {
    const re = new RegExp(`(?=<${tag}[\\s>])`, 'i')
    const parts = h.split(re)
    const head = parts.shift() ?? ''
    const chapters: ChapterHtml[] = []
    if (plain(head).length > 0) {
      chapters.push({ title: fallbackTitle, html: `<p>${head.trim()}</p>` })
    }
    for (const p of parts) {
      const m = p.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'))
      const title = plain(m?.[1] ?? '').slice(0, 40) || fallbackTitle
      chapters.push({ title, html: p })
    }
    return chapters
  }
  if (/<h1[\s>]/i.test(html)) {
    const list = cut(html, 'h1')
    if (list.length > 1) return list
  }
  if (/<h2[\s>]/i.test(html)) {
    const list = cut(html, 'h2')
    if (list.length > 1) return list
  }
  return [{ title: fallbackTitle, html }]
}

/**
 * AZW3 / AZW / MOBI → 章节 HTML。
 * 先按 KF8（AZW3 的正文格式）解，失败或空正文再退回 MOBI6；
 * KF8 常常整本只有一个 spine 项，所以还要按 h1 二次分章（与 DOCX 的策略一致）。
 */
export async function convertMobi(
  filePath: string,
  resourceDir: string,
  toUrl: (p: string) => string
): Promise<ConvertResult> {
  try {
    fs.mkdirSync(resourceDir, { recursive: true })
    let book: Awaited<ReturnType<typeof initKf8File>> | null = null
    let tried: string[] = []
    try {
      book = await initKf8File(filePath, resourceDir)
      const spine = book.getSpine()
      const first = spine?.[0] ? await book.loadChapter(spine[0].id) : null
      if (!spine?.length || !first?.html) {
        tried.push('KF8 正文为空')
        book = null
      }
    } catch (e) {
      tried.push(`KF8: ${(e as Error).message}`)
      book = null
    }
    if (!book) {
      try {
        book = await initMobiFile(filePath, resourceDir) as unknown as typeof book
      } catch (e) {
        tried.push(`MOBI6: ${(e as Error).message}`)
        book = null
      }
    }
    if (!book) {
      return {
        ok: false,
        error: `AZW/MOBI 解析失败（${tried.join('；') || '格式不支持'}）。若为 Kindle 加密书（DRM），需先去除保护再导入`,
      }
    }

    const meta = book.getMetadata() as { title?: string; author?: string[] | string }
    const author = Array.isArray(meta.author) ? meta.author.join('、') : meta.author
    const spine = book.getSpine()

    const raw: ChapterHtml[] = []
    for (const item of spine) {
      const ch = await book.loadChapter(item.id)
      if (!ch?.html) continue
      raw.push({ title: '', html: cleanMobiHtml(ch.html, toUrl) })
    }
    if (!raw.length) {
      return { ok: false, error: 'AZW/MOBI 解析失败（正文为空，可能是加密或损坏的文件）' }
    }

    // spine 只有一项（KF8 常见）→ 按标题二次分章
    const chapters: ChapterHtml[] =
      raw.length > 1
        ? raw.map((c, i) => ({ title: c.title || `第 ${i + 1} 节`, html: c.html }))
        : splitHtml(raw[0].html, meta.title || '正文')

    return {
      ok: true,
      mode: 'chapters',
      chapters,
      meta: { title: meta.title, author },
    }
  } catch (e) {
    return { ok: false, error: `AZW/MOBI 解析失败：${(e as Error).message}` }
  }
}

/** 自然排序：2.jpg 要排在 10.jpg 前面（与 CBZ 现有规则一致） */
const byName = (a: string, b: string): number => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' })

/**
 * CBR → 图片序列。
 * 现实里 `.cbr` 有一半其实是 ZIP（改名而来），所以两条路都试：先 RAR（node-unrar-js，WASM 编译的真 UnRAR），
 * 失败再按 ZIP 解。图片落到缓存目录，交给 `moyu-file://` 供给渲染层。
 */
export async function convertCbr(
  filePath: string,
  outDir: string,
  toUrl: (p: string) => string
): Promise<ConvertResult> {
  const imgDir = path.join(outDir, 'img')
  try {
    fs.rmSync(outDir, { recursive: true, force: true })
    fs.mkdirSync(imgDir, { recursive: true })
  } catch {
    /* 缓存目录清理失败不致命 */
  }

  const written: { name: string; file: string }[] = []
  let rarErr = ''

  // 1) RAR —— 用 data 版：解出来是 buffer，自己落盘（file 版只会写盘、拿不到字节）
  try {
    const raw = fs.readFileSync(filePath)
    const extractor = await createExtractorFromData({
      data: raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
    })
    const names = [...extractor.getFileList().fileHeaders].map((h) => h.name).filter((n) => IMG_EXT.test(n))
    if (names.length) {
      const res = extractor.extract({ files: names })
      for (const f of res.files) {
        const bytes = f.extraction
        if (!bytes?.length) continue
        const out = path.join(imgDir, path.basename(f.fileHeader.name))
        fs.writeFileSync(out, Buffer.from(bytes))
        written.push({ name: f.fileHeader.name, file: out })
      }
    }
  } catch (e) {
    rarErr = (e as Error).message || 'RAR 解包失败'
  }

  // 2) ZIP 兜底（.cbr 实为 zip 的情况）
  if (!written.length) {
    try {
      const entries = unzipSync(new Uint8Array(fs.readFileSync(filePath)))
      for (const [name, data] of Object.entries(entries)) {
        if (name.endsWith('/') || !IMG_EXT.test(name)) continue
        const out = path.join(imgDir, path.basename(name))
        fs.writeFileSync(out, data)
        written.push({ name, file: out })
      }
    } catch (e) {
      if (!rarErr) rarErr = (e as Error).message || '不是有效的压缩包'
    }
  }

  if (!written.length) {
    return {
      ok: false,
      error: `CBR 解析失败（既不是 RAR 也不是 ZIP 压缩包）：${rarErr || '未找到图片'}；CBR 为 RAR 压缩的漫画，可先用解压工具转成 CBZ`,
    }
  }

  written.sort((a, b) => byName(a.name, b.name))
  return { ok: true, mode: 'images', images: written.map((w) => ({ name: path.basename(w.name), url: toUrl(w.file) })) }
}

/**
 * DOC（Word 97-2003，OLE2/CFB）→ 纯文本。
 * 只取正文文本：老格式里的图片/文本框/域代码不在解析范围内（与 DOCX 回退路径的取舍一致）。
 */
export async function convertDoc(filePath: string): Promise<ConvertResult> {
  try {
    const extractor = new WordExtractor()
    const doc = await extractor.extract(filePath)
    const body = doc.getBody()
    if (!body || !body.trim()) {
      return { ok: false, error: 'DOC 解析失败（正文为空，可能是图片型文档或已损坏）' }
    }
    // 老 doc 的表格用制表符分列，段落用 \n；统一成 \n，让 TXT 的分章规则接管
    const text = body.replace(/\r\n?/g, '\n').replace(/\u0007/g, '\n')
    return { ok: true, mode: 'text', text }
  } catch (e) {
    return {
      ok: false,
      error: `DOC 解析失败：${(e as Error).message}。仅支持 Word 97-2003 文本内容，建议另存为 DOCX`,
    }
  }
}
