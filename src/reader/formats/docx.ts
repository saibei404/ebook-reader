/**
 * DOCX → 章节。
 *
 * 两条路径：
 * 1. **自研 OOXML 解析（首选）**：直接读 `word/document.xml`，保留 Word 的直接格式
 *    —— 字体颜色（`w:color`）、字号（`w:sz`）、段落对齐（`w:jc`）、标题层级、表格。
 *    mammoth 不解析这些，导致「Word 里的红字/居中小标题在阅读器里全变普通正文」（D7）。
 * 2. **mammoth 回退**：自研解析失败（图片型文档、特殊结构、损坏文件）时退回 mammoth，
 *    保结构但不保直接格式；mammoth 仍按需动态加载，正常路径不会下载它。
 *
 * 字号策略：正文透传为 em（相对 12pt），随阅读器字号缩放；标题字号交给阅读器自己的
 * h1/h2/h3 规则，避免「Word 24pt 标题 × 阅读器 h1 1.5em」双重放大。
 */
import type { Chapter } from '../text-utils'
import { docxToHtmlOoxml } from './docx-ooxml'

export interface DocxResult {
  chapters: Chapter[]
  /** 转换告警（如不支持的样式），用于诊断 */
  warnings: string[]
}

const TEXT_ONLY = (html: string): string => html.replace(/<[^>]+>/g, '')

const escapeHtml = (t: string): string =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** HTML（h1 分章）→ Chapter[]，两条转换路径共用 */
function htmlToChapters(html: string): Chapter[] {
  const doc = new DOMParser().parseFromString(html, 'text/html')
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
    // 章标题必须写回 html：TextReader 渲染的是章节 HTML，不单独渲染 title
    const heading = cur.title && cur.title !== '正文' ? `<h1>${escapeHtml(cur.title)}</h1>` : ''
    chapters.push({
      title: cur.title,
      body: heading + body,
      source: 'html',
      startChar,
      charCount: cur.chars,
    })
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

  if (!chapters.length && html.trim()) {
    chapters.push({
      title: '正文',
      body: html,
      source: 'html',
      startChar: 0,
      charCount: TEXT_ONLY(html).length,
    })
  }
  return chapters
}

/** mammoth 回退路径 */
async function mammothToHtml(data: ArrayBuffer): Promise<{ html: string; warnings: string[] }> {
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
  // mammoth 把所有单元格都输出为 td，首行提升为表头（视觉分层 + 语义正确）
  const doc = new DOMParser().parseFromString(result.value, 'text/html')
  doc.querySelectorAll('table').forEach((table) => {
    const firstRow = table.querySelector('tr')
    if (!firstRow) return
    firstRow.querySelectorAll('td').forEach((td) => {
      const th = td.ownerDocument.createElement('th')
      th.innerHTML = td.innerHTML
      td.replaceWith(th)
    })
  })
  return {
    html: doc.body.innerHTML,
    warnings: result.messages.filter((m) => m.type === 'warning').map((m) => m.message),
  }
}

export async function docxToChapters(data: ArrayBuffer): Promise<DocxResult> {
  // 1) 自研 OOXML：保留颜色 / 字号 / 对齐
  try {
    const { html, warnings } = docxToHtmlOoxml(data)
    const chapters = htmlToChapters(html)
    if (chapters.length) return { chapters, warnings }
  } catch (e) {
    console.warn('[docx] OOXML 解析失败，回退 mammoth：', String((e as Error)?.message ?? e))
  }

  // 2) 回退 mammoth（结构优先，直接格式丢失）
  const { html, warnings } = await mammothToHtml(data)
  return { chapters: htmlToChapters(html), warnings }
}
