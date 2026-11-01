/**
 * DOCX → 章节：mammoth 把 Word 文档转成语义化 HTML（保留标题层级/粗斜体/列表/表格），
 * 再按 <h1> 切章，交给与 TXT/MD 相同的渲染管线。
 *
 * 设计取舍：Word 里的绝对字号（如「小四 12pt」）不透传，正文统一走阅读器的字号设置——
 * 这与阅读类应用的通行做法一致（排版由读者掌控），也避免同一本书在不同格式下观感割裂。
 */
import type { Chapter } from '../text-utils'

export interface DocxResult {
  chapters: Chapter[]
  /** mammoth 的转换告警（如不支持的样式），用于诊断 */
  warnings: string[]
}

const TEXT_ONLY = (html: string): string => html.replace(/<[^>]+>/g, '')

const escapeHtml = (t: string): string =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export async function docxToChapters(data: ArrayBuffer): Promise<DocxResult> {
  const mammoth = (await import('mammoth')) as unknown as {
    convertToHtml: (
      input: { arrayBuffer: ArrayBuffer },
      options?: { styleMap?: string[] }
    ) => Promise<{ value: string; messages: { type: string; message: string }[] }>
  }

  const result = await mammoth.convertToHtml(
    { arrayBuffer: data },
    {
      styleMap: [
        // 书名/副标题保持段落语义：若映射为 h1 会被切章逻辑当作章标题，产生一个空章
        "p[style-name='Title'] => p.doc-title:fresh",
        "p[style-name='Subtitle'] => p.doc-subtitle:fresh",
      ],
    }
  )

  const doc = new DOMParser().parseFromString(result.value, 'text/html')

  // mammoth 把所有单元格都输出为 td，这里把每个表格的首行提升为表头（视觉分层 + 语义正确）
  doc.querySelectorAll('table').forEach((table) => {
    const firstRow = table.querySelector('tr')
    if (!firstRow) return
    firstRow.querySelectorAll('td').forEach((td) => {
      const th = td.ownerDocument.createElement('th')
      th.innerHTML = td.innerHTML
      td.replaceWith(th)
    })
  })

  const nodes = Array.from(doc.body.children)

  const chapters: Chapter[] = []
  let cursor = 0
  let startChar = 0
  let cur: { title: string; parts: string[]; chars: number } | null = null

  const flush = () => {
    if (!cur) return
    const body = cur.parts.join('')
    if (!TEXT_ONLY(body).trim()) {
      cur = null
      return
    }
    // 章标题必须写回 html：TextReader 只渲染 chapter.html，不单独渲染 title
    const heading = cur.title && cur.title !== '正文' ? `<h1>${escapeHtml(cur.title)}</h1>` : ''
    chapters.push({ title: cur.title, html: heading + body, startChar, charCount: cur.chars })
    cur = null
  }

  for (const el of nodes) {
    if (el.tagName === 'H1') {
      flush()
      startChar = cursor
      const t = (el.textContent ?? '').trim()
      cur = { title: t || '正文', parts: [], chars: 0 }
      continue
    }
    if (!cur) {
      startChar = cursor
      cur = { title: '正文', parts: [], chars: 0 }
    }
    cur.parts.push(el.outerHTML)
    const len = (el.textContent ?? '').length
    cur.chars += len
    cursor += len
  }
  flush()

  // 兜底：无任何标题且内容非空时，整体作为一章
  if (!chapters.length && result.value.trim()) {
    chapters.push({
      title: '正文',
      html: result.value,
      startChar: 0,
      charCount: TEXT_ONLY(result.value).length,
    })
  }

  return {
    chapters,
    warnings: result.messages.filter((m) => m.type === 'warning').map((m) => m.message),
  }
}
