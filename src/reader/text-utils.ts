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
