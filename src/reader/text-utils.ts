/** 文本解码与分章工具：TXT / MD / FB2 共用 */

/** 解码字节：优先 UTF-8（含 BOM），失败回退 GBK/GB18030 */
export function decodeText(buf: ArrayBuffer): { text: string; encoding: string } {
  const bytes = new Uint8Array(buf)
  // BOM 检测
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return { text: new TextDecoder('utf-8').decode(bytes.subarray(3)), encoding: 'utf-8-bom' }
  }
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    return { text: new TextDecoder('utf-16le').decode(bytes.subarray(2)), encoding: 'utf-16le' }
  }
  if (bytes[0] === 0xfe && bytes[1] === 0xff) {
    return { text: new TextDecoder('utf-16be').decode(bytes.subarray(2)), encoding: 'utf-16be' }
  }
  // 先严格 UTF-8，非法序列则判为 GBK 系（中文 TXT 常见）
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(bytes), encoding: 'utf-8' }
  } catch {
    try {
      return { text: new TextDecoder('gb18030').decode(bytes), encoding: 'gb18030' }
    } catch {
      return { text: new TextDecoder('utf-8').decode(bytes), encoding: 'utf-8-lossy' }
    }
  }
}

export interface Chapter {
  title: string
  html: string
  /** 该章首个字符在全文中的偏移，用于 locator(offset) 定位 */
  startChar: number
  charCount: number
}

const CHAPTER_RE =
  /^\s*(?:第\s*[0-9零一二三四五六七八九十百千万两]+\s*[章回节卷篇部集]|Chapter\s+\d+|CHAPTER\s+\d+|[0-9]{1,3}[、.．]\s*\S)/im

/** 纯文本 → 章节（按常见章节标题切分；无标题则整体一章并按长度分块） */
export function splitPlainText(raw: string, chunkSize = 12000): Chapter[] {
  const text = raw.replace(/\r\n?/g, '\n')
  const lines = text.split('\n')
  const marks: number[] = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim()
    if (!line || line.length > 40) continue
    if (CHAPTER_RE.test(line)) marks.push(i)
  }

  const chapters: Chapter[] = []
  const pushChapter = (heading: string, body: string, startChar: number, showTitle = false) => {
    const trimmed = body.trim()
    if (!trimmed) return
    const bodyHtml = trimmed
      .split(/\n{2,}/)
      .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`)
      .join('')
    chapters.push({
      title: heading || `第 ${chapters.length + 1} 节`,
      html: (showTitle && heading ? `<h2>${escapeHtml(heading)}</h2>` : '') + bodyHtml,
      startChar,
      charCount: body.length,
    })
  }

  if (marks.length === 0) {
    // 无章节标记：按字符数硬切，避免单章过长拖慢渲染
    let cursor = 0
    for (let i = 0; i < text.length; i += chunkSize) {
      const slice = text.slice(i, i + chunkSize)
      chapters.push({
        title: `第 ${chapters.length + 1} 节`,
        html: slice
          .split(/\n{2,}/)
          .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`)
          .join(''),
        startChar: i,
        charCount: slice.length,
      })
      cursor = i
    }
    if (chapters.length === 0 && text.trim()) {
      chapters.push({
        title: '正文',
        html: `<p>${escapeHtml(text)}</p>`,
        startChar: 0,
        charCount: text.length,
      })
    }
    void cursor
    return chapters
  }

  // 有序切分：标题行归入下一章
  let start = 0
  for (let m = 0; m < marks.length; m++) {
    const idx = marks[m]
    const heading = lines[idx].trim()
    if (m === 0 && idx > 0) {
      const preface = lines.slice(0, idx).join('\n')
      pushChapter('前言', preface, 0)
      start = text.indexOf(heading, 0)
    }
    const nextIdx = m + 1 < marks.length ? marks[m + 1] : lines.length
    const body = lines.slice(idx + 1, nextIdx).join('\n')
    const startChar = text.indexOf(lines[idx], m === 0 ? 0 : text.indexOf(lines[marks[m - 1]], 0) + 1)
    pushChapter(heading, body, startChar >= 0 ? startChar : start, true)
  }
  return chapters.length ? chapters : [{ title: '正文', html: `<p>${escapeHtml(text)}</p>`, startChar: 0, charCount: text.length }]
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 极简 Markdown → HTML（标题/粗体/斜体/行内码/引用/列表/分隔线） */
export function markdownToHtml(md: string): string {
  const lines = md.replace(/\r\n?/g, '\n').split('\n')
  const out: string[] = []
  let inList = false
  for (const raw of lines) {
    const line = raw.trimEnd()
    if (/^\s*[-*+]\s+/.test(line)) {
      if (!inList) {
        out.push('<ul>')
        inList = true
      }
      out.push(`<li>${inlineMd(line.replace(/^\s*[-*+]\s+/, ''))}</li>`)
      continue
    }
    if (inList) {
      out.push('</ul>')
      inList = false
    }
    if (!line.trim()) {
      out.push('')
      continue
    }
    const h = line.match(/^(#{1,6})\s+(.*)$/)
    if (h) {
      const level = Math.min(3, h[1].length)
      out.push(`<h${level}>${inlineMd(h[2])}</h${level}>`)
      continue
    }
    if (/^>\s?/.test(line)) {
      out.push(`<blockquote>${inlineMd(line.replace(/^>\s?/, ''))}</blockquote>`)
      continue
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) {
      out.push('<hr/>')
      continue
    }
    out.push(`<p>${inlineMd(line)}</p>`)
  }
  if (inList) out.push('</ul>')
  return out.join('\n')
}

function inlineMd(s: string): string {
  let t = escapeHtml(s)
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>')
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  t = t.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
  t = t.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>')
  return t
}

/** FB2（FictionBook XML）→ 章节数组。仅提取正文文本结构，丢弃样式与脚本 */
export function fb2ToChapters(buf: ArrayBuffer): Chapter[] {
  const { text } = decodeText(buf)
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.querySelector('parsererror')) {
    throw new Error('FB2 文件解析失败（XML 格式异常）')
  }
  // 书名/作者（用于标题展示，由调用方按需读取）
  const sections = Array.from(doc.querySelectorAll('body > section'))
  const chapters: Chapter[] = []
  let cursor = 0
  const renderSection = (sec: Element, depth = 0): string => {
    const parts: string[] = []
    const title = sec.querySelector(':scope > title')
    if (title) {
      const t = (title.textContent || '').trim()
      if (t) parts.push(`<h${Math.min(3, depth + 1)}>${escapeHtml(t)}</h${Math.min(3, depth + 1)}>`)
    }
    sec.querySelectorAll(':scope > p').forEach((p) => {
      const t = (p.textContent || '').trim()
      if (t) parts.push(`<p>${escapeHtml(t)}</p>`)
    })
    sec.querySelectorAll(':scope > subtitle').forEach((st) => {
      const t = (st.textContent || '').trim()
      if (t) parts.push(`<h3>${escapeHtml(t)}</h3>`)
    })
    sec.querySelectorAll(':scope > section').forEach((child) => {
      parts.push(renderSection(child, depth + 1))
    })
    return parts.join('')
  }

  for (const sec of sections) {
    const html = renderSection(sec)
    if (!html) continue
    const title = (sec.querySelector(':scope > title')?.textContent || '').trim() || `第 ${chapters.length + 1} 节`
    const charCount = html.replace(/<[^>]+>/g, '').length
    chapters.push({ title, html, startChar: cursor, charCount })
    cursor += charCount
  }
  // 部分 FB2 正文直接挂在 body > p（无 section）
  if (chapters.length === 0) {
    const body = doc.querySelector('body')
    const html = body
      ? Array.from(body.querySelectorAll('p'))
          .map((p) => `<p>${escapeHtml((p.textContent || '').trim())}</p>`)
          .join('')
      : ''
    if (!html) throw new Error('FB2 中没有可显示的正文')
    chapters.push({ title: '正文', html, startChar: 0, charCount: html.replace(/<[^>]+>/g, '').length })
  }
  return chapters
}
