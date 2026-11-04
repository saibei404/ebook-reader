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

/**
 * 章节源类型：
 * - `text`：纯文本（TXT），HTML 延迟到首次渲染时才转义生成；
 * - `html`：已是 HTML（MD / DOCX / FB2 预处理产物），直接渲染。
 */
export type ChapterSource = 'text' | 'html'

export interface Chapter {
  title: string
  /** 章节正文源。`text` 为纯文本（未转义），`html` 为已生成的 HTML */
  body: string
  source: ChapterSource
  /**
   * 标题（需要以 <h2> 渲染时才有），字符空间里排在正文之前。
   * 与 title 分开是为了让「字符偏移 → DOM 文本偏移」一一对应：
   * DOM 里标题文字也占字符位，若不计数会导致每个高亮锚点整体前移一个标题宽度。
   */
  heading?: string
  /** HTML 缓存：首次渲染生成后写回，避免重复转义（3MB TXT 全量转义曾是首开卡顿主因） */
  html?: string
  /** 该章首个字符在全文中的偏移（文本类按「去掉换行后的字符数」累计，与 DOM 文本长度一致） */
  startChar: number
  /** 该章纯文本字符数（不含标签/换行） */
  charCount: number
}

const CHAPTER_RE =
  /^\s*(?:第\s*[0-9零一二三四五六七八九十百千万两]+\s*[章回节卷篇部集]|Chapter\s+\d+|CHAPTER\s+\d+|[0-9]{1,3}[、.．]\s*\S)/im

/** 文本字符数：去掉换行后的长度。DOM 的 textContent 不含 <br/> 与段落分隔，两边必须同口径 */
export function countTextChars(text: string): number {
  let n = 0
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    if (c !== 10 && c !== 13) n++
  }
  return n
}

/** 纯文本段落 → HTML（按空行分段，段内换行转 <br/>） */
/** 行首缩进（全角空格 / 两个以上半角空格 / 制表符）—— 中文 TXT 判断新段最可靠的信号 */
const INDENT_RE = /^(?:\u3000+| {2,}|\t+)/

/** 折行判定阈值：正文一行大约 30–40 字，超过它还没收句基本就是被容器折开的续行 */
const WRAP_HINT = 30

/** 句末标点：以它结尾的行通常是一段的结束 */
const SENT_END_RE = /[。！？…；：”』」）)】\]"'.,!?;:]$/

/** 软换行拼接：中文直接拼，西文之间补空格（否则 "word" 与 "word" 会粘成一个词） */
function joinSoft(prev: string, next: string): string {
  if (!prev) return next
  const a = prev.slice(-1)
  const b = next.slice(0, 1)
  const wordish = (c: string) => /[A-Za-z0-9]/.test(c)
  return wordish(a) && wordish(b) ? `${prev} ${next}` : prev + next
}

/**
 * 纯文本 → 段落数组。
 *
 * 旧实现按「空行」切段，结果是把整本无空行 TXT 压成一个大段落：
 * 章节内没有任何段间距、没有首行缩进，屏幕上就是一大坨密不透风的字
 * （用户反馈「过于密集」的根因）。
 *
 * 三种排版约定都要能认：
 * - `blank`：有空行分段（Markdown 风格），段内单换行是硬换行 → 软拼接；
 * - `indent`：行首全角缩进表示新段（大量中文 TXT 的写法），未缩进行是续行；
 * - `line`：既没空行也没缩进 → 每行一段；但若某行没有句末标点且较长，
 *   判定为硬换行续行（兼顾英文按列折行的 TXT）。
 */
export function plainParagraphs(raw: string): string[] {
  const text = raw.replace(/\r\n?/g, '\n')
  if (!text.trim()) return []
  const lines = text.split('\n').map((l) => l.replace(/\s+$/, ''))
  const filled = lines.filter((l) => l.trim())
  if (!filled.length) return []

  const hasBlank = /\n[ \t\u3000]*\n/.test(text)
  const indentedCount = filled.filter((l) => INDENT_RE.test(l)).length
  /** 缩进占比够高才认为这套 TXT 用缩进分段（少量缩进多半是引文/诗歌） */
  const useIndent = indentedCount / filled.length >= 0.4
  const mode: 'indent' | 'blank' | 'line' = useIndent ? 'indent' : hasBlank ? 'blank' : 'line'

  const out: string[] = []
  let buf = ''
  const flush = () => {
    const t = buf.trim()
    if (t) out.push(t)
    buf = ''
  }

  for (const line of lines) {
    if (!line.trim()) {
      flush()
      continue
    }
    const isIndented = INDENT_RE.test(line)
    const clean = line.replace(INDENT_RE, '')
    if (!buf) {
      buf = clean
      continue
    }
    if (mode === 'indent') {
      // 缩进 = 新段；未缩进 = 上一段的续行（中文 TXT 最常见的写法）
      if (isIndented) {
        flush()
        buf = clean
      } else {
        buf = joinSoft(buf, clean)
      }
      continue
    }
    if (mode === 'line') {
      // 每行一段；只有"长行 + 无句末标点"才当折行续接
      if (SENT_END_RE.test(buf) || buf.length < WRAP_HINT) {
        flush()
        buf = clean
      } else {
        buf = joinSoft(buf, clean)
      }
      continue
    }
    // blank 模式：句末标点收尾 → 新段；贴到行宽的长行 → 折行拼接；
    // 短行（诗行、对白）保留硬换行，用 <br/> 而不是拆成两段（拆开会多出一段间距）
    if (SENT_END_RE.test(buf)) {
      flush()
      buf = clean
    } else if (buf.length >= WRAP_HINT) {
      buf = joinSoft(buf, clean)
    } else {
      buf = `${buf}\n${clean}`
    }
  }
  flush()
  return out
}

export function textToHtml(body: string): string {
  return plainParagraphs(body)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`)
    .join('')
}

/** 取章节 HTML：`text` 源按需生成并缓存（标题按 h2 渲染，字符空间里排在正文之前） */
export function chapterHtml(c: Chapter): string {
  if (c.source === 'html') return c.html ?? c.body
  if (c.html == null) {
    const head = c.heading ? `<h2>${escapeHtml(c.heading)}</h2>` : ''
    c.html = head + textToHtml(c.body)
  }
  return c.html
}

/** HTML → 纯文本（搜索与字符偏移换算用） */
export function htmlToText(html: string): string {
  return html
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
}

/** 取章节纯文本（搜索/导出用，不含标签与换行，与 charCount 同口径） */
export function chapterText(c: Chapter): string {
  if (c.source === 'text') return c.body.replace(/\r?\n/g, '')
  return htmlToText(c.html ?? c.body)
}

/**
 * 外部已切好的 HTML 章节 → Chapter[]。
 * 用于主进程转换出来的容器格式（AZW3/AZW/MOBI 的章节 HTML），
 * 字符偏移按「去标签后的正文长度」累计，与 TextReader 的 DOM 文本口径一致。
 */
export function htmlChapters(items: { title: string; html: string }[]): Chapter[] {
  let cursor = 0
  return items.map((it) => {
    const chars = countTextChars(htmlToText(it.html))
    const ch: Chapter = {
      title: it.title || '正文',
      // 标题已经在 html 里（h1/h2 原样保留），这里不再补 heading，避免重复一行
      body: it.html,
      source: 'html',
      startChar: cursor,
      charCount: chars,
    }
    cursor += chars
    return ch
  })
}

/** 纯文本 → 章节（按常见章节标题切分；无标题则整篇按长度分块） */
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
  /** 字符空间游标：只累计「去掉换行」的字符，保证与 DOM textContent 长度同口径 */
  let cursor = 0

  const pushChapter = (heading: string, body: string, showTitle = false) => {
    const trimmed = body.trim()
    if (!trimmed) {
      // 空章也要推进游标（标题文字在 DOM 里已被 h2 渲染）
      if (showTitle && heading) cursor += countTextChars(heading)
      return
    }
    const charCount = countTextChars(trimmed) + (showTitle && heading ? heading.length : 0)
    chapters.push({
      title: heading || `第 ${chapters.length + 1} 节`,
      body: trimmed,
      source: 'text',
      heading: showTitle && heading ? heading : undefined,
      startChar: cursor,
      charCount,
    })
    cursor += charCount
  }

  if (marks.length === 0) {
    // 无章节标记：按字符数硬切，避免单章过长拖慢渲染
    for (let i = 0; i < text.length; i += chunkSize) {
      pushChapter(`第 ${chapters.length + 1} 节`, text.slice(i, i + chunkSize))
    }
    if (chapters.length === 0 && text.trim()) {
      chapters.push({
        title: '正文',
        body: text,
        source: 'text',
        startChar: 0,
        charCount: countTextChars(text),
      })
    }
    return chapters
  }

  // 有序切分：标题行归入本章（作为 h2），正文为其后到下一个标题前的行
  for (let m = 0; m < marks.length; m++) {
    const idx = marks[m]
    const heading = lines[idx].trim()
    if (m === 0 && idx > 0) {
      pushChapter('前言', lines.slice(0, idx).join('\n'))
    }
    const nextIdx = m + 1 < marks.length ? marks[m + 1] : lines.length
    pushChapter(heading, lines.slice(idx + 1, nextIdx).join('\n'), true)
  }
  return chapters.length
    ? chapters
    : [{ title: '正文', body: text, source: 'text', startChar: 0, charCount: countTextChars(text) }]
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
  let inList: 'ul' | 'ol' | false = false
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    const line = raw.trimEnd()

    // 段落级 HTML 对齐（GFM 常见的 <p align="center">…</p>）：转成 style，避免被当纯文本
    const al = line.match(/^<p\s+align=["'](left|center|right)["']\s*>(.*)<\/p>$/i)
    if (al) {
      if (inList) {
        out.push(`</${inList}>`)
        inList = false
      }
      out.push(`<p style="text-align:${al[1].toLowerCase()}">${inlineMd(al[2])}</p>`)
      continue
    }

    // GFM 表格：表头行 + 分隔行（|---|:--:|）→ table/th/td
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? '')) {
      if (inList) {
        out.push(`</${inList}>`)
        inList = false
      }
      const cells = line.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
      const aligns = (lines[i + 1] ?? '')
        .trim()
        .replace(/^\||\|$/g, '')
        .split('|')
        .map((c) => {
          const t = c.trim()
          if (t.startsWith(':') && t.endsWith(':')) return 'center'
          if (t.endsWith(':')) return 'right'
          return 'left'
        })
      const styleOf = (idx: number) => (aligns[idx] && aligns[idx] !== 'left' ? ` style="text-align:${aligns[idx]}"` : '')
      const head = '<tr>' + cells.map((c, idx) => `<th${styleOf(idx)}>${inlineMd(c)}</th>`).join('') + '</tr>'
      const body: string[] = []
      let j = i + 2
      for (; j < lines.length; j++) {
        const row = lines[j].trimEnd()
        if (!/^\s*\|.*\|\s*$/.test(row)) break
        const rc = row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim())
        body.push('<tr>' + rc.map((c, idx) => `<td${styleOf(idx)}>${inlineMd(c)}</td>`).join('') + '</tr>')
      }
      out.push(`<table><thead>${head}</thead><tbody>${body.join('')}</tbody></table>`)
      i = j - 1
      continue
    }

    // 无序列表
    if (/^\s*[-*+]\s+/.test(line)) {
      if (inList !== 'ul') {
        if (inList) out.push(`</${inList}>`)
        out.push('<ul>')
        inList = 'ul'
      }
      out.push(`<li>${inlineMd(line.replace(/^\s*[-*+]\s+/, ''))}</li>`)
      continue
    }
    // 有序列表
    if (/^\s*\d+[.)]\s+/.test(line)) {
      if (inList !== 'ol') {
        if (inList) out.push(`</${inList}>`)
        out.push('<ol>')
        inList = 'ol'
      }
      out.push(`<li>${inlineMd(line.replace(/^\s*\d+[.)]\s+/, ''))}</li>`)
      continue
    }
    if (inList) {
      out.push(`</${inList}>`)
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
  if (inList) out.push(`</${inList}>`)
  return out.join('\n')
}

function inlineMd(s: string): string {
  let t = escapeHtml(s)
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>')
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
  t = t.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
  t = t.replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2" rel="noreferrer">$1</a>')
  // 白名单式还原内联 HTML：先整体转义，再只放行「颜色 span / 下划线 / 删除线」，
  // 颜色值限定为 hex，避免把任意 HTML 当内容执行。
  // 注意：escapeHtml 会把双引号转成 &quot;，正则必须同时兼容两种形态
  t = t.replace(
    /&lt;span style=(?:"|&quot;)color:(#[0-9a-fA-F]{3,8});?(?:"|&quot;)&gt;([\s\S]*?)&lt;\/span&gt;/g,
    '<span style="color:$1">$2</span>'
  )
  t = t.replace(/&lt;u&gt;([\s\S]*?)&lt;\/u&gt;/g, '<u>$1</u>')
  t = t.replace(/&lt;s&gt;([\s\S]*?)&lt;\/s&gt;/g, '<s>$1</s>')
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
  /** FB2 行内标记 → HTML（strong/emphasis/strikethrough/code），保留粗斜体 */
  const inlineFb2 = (el: Element | ChildNode): string => {
    let out = ''
    el.childNodes.forEach((n) => {
      if (n.nodeType === 3) {
        out += escapeHtml(n.textContent || '')
        return
      }
      if (n.nodeType !== 1) return
      const tag = (n as Element).tagName.toLowerCase()
      const inner = inlineFb2(n)
      if (tag === 'strong') out += `<strong>${inner}</strong>`
      else if (tag === 'emphasis') out += `<em>${inner}</em>`
      else if (tag === 'strikethrough') out += `<s>${inner}</s>`
      else if (tag === 'code') out += `<code>${inner}</code>`
      else out += inner
    })
    return out
  }

  // 必须按子节点顺序遍历：分别 querySelectorAll 会把 subtitle/p 分批输出，导致标题跑到正文之后
  const renderSection = (sec: Element, depth = 0): string => {
    const parts: string[] = []
    const hLevel = Math.min(3, depth + 1)
    Array.from(sec.children).forEach((node) => {
      const tag = node.tagName.toLowerCase()
      if (tag === 'title') {
        const t = (node.textContent || '').trim()
        if (t) parts.push(`<h${hLevel}>${escapeHtml(t)}</h${hLevel}>`)
      } else if (tag === 'subtitle') {
        const t = (node.textContent || '').trim()
        if (t) parts.push(`<h3>${escapeHtml(t)}</h3>`)
      } else if (tag === 'p') {
        const html = inlineFb2(node).trim()
        if (html) parts.push(`<p>${html}</p>`)
      } else if (tag === 'cite') {
        const t = (node.textContent || '').trim()
        if (t) parts.push(`<blockquote>${escapeHtml(t)}</blockquote>`)
      } else if (tag === 'code') {
        const t = (node.textContent || '').trim()
        if (t) parts.push(`<pre>${escapeHtml(t)}</pre>`)
      } else if (tag === 'empty-line') {
        parts.push('<p>&nbsp;</p>')
      } else if (tag === 'section') {
        parts.push(renderSection(node, depth + 1))
      }
    })
    return parts.join('')
  }

  for (const sec of sections) {
    const html = renderSection(sec)
    if (!html) continue
    const title = (sec.querySelector(':scope > title')?.textContent || '').trim() || `第 ${chapters.length + 1} 节`
    const charCount = htmlToText(html).length
    chapters.push({ title, body: html, source: 'html', startChar: cursor, charCount })
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
    chapters.push({
      title: '正文',
      body: html,
      source: 'html',
      startChar: 0,
      charCount: htmlToText(html).length,
    })
  }
  return chapters
}
