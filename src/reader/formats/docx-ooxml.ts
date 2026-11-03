/**
 * DOCX（OOXML）→ HTML：自研轻量转换器。
 *
 * 为什么不用 mammoth：mammoth 会丢弃「直接格式」——`w:color`（字体颜色）、
 * `w:sz`（字号）、`w:jc`（对齐）在它的 document 模型里要么没读、要么不输出到 HTML，
 * 于是 Word 里的红色强调、居中小标题在阅读器里全部变成普通正文（技术债 D7）。
 *
 * 做法：用 fflate 解开 zip，直接读 `word/document.xml`（+ `word/styles.xml` 拿样式名），
 * 只处理阅读需要的那部分结构：段落 / run / 表格 / 标题 / 对齐 / 颜色 / 字号。
 * 复杂文档（图片、域代码、文本框）解析不出内容时由调用方回退到 mammoth。
 *
 * 安全：所有文本走 escapeHtml；颜色只接受 6 位 hex；字号夹在合理区间。
 */
import { unzipSync } from 'fflate'
import { escapeHtml } from '../text-utils'

export interface OoxmlResult {
  html: string
  /** 解析过程中的告警（例如缺少 styles.xml），用于诊断 */
  warnings: string[]
}

const W_NS = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

/** 直接子元素（不递归） */
function childOf(el: Element | null | undefined, tag: string): Element | null {
  if (!el) return null
  for (const c of Array.from(el.children)) {
    if (c.tagName === tag || c.localName === tag.replace(/^w:/, '')) return c
  }
  return null
}

/** 按 localName 取直接子元素（命名空间前缀可能不同，用 localName 最稳） */
function kids(el: Element | null | undefined, local: string): Element[] {
  if (!el) return []
  return Array.from(el.children).filter((c) => c.localName === local)
}

function attr(el: Element | null | undefined, name: string): string {
  if (!el) return ''
  return el.getAttribute(`w:${name}`) ?? el.getAttribute(name) ?? ''
}

/** 布尔型属性：存在且不为 0/false 即为真 */
function flag(el: Element | null | undefined): boolean {
  if (!el) return false
  const v = attr(el, 'val')
  return v !== '0' && v !== 'false' && v !== 'off'
}

/** 16 进制颜色白名单 */
function safeColor(raw: string): string {
  const v = raw.trim().replace(/^#/, '')
  if (!/^[0-9a-fA-F]{6}$/.test(v)) return ''
  return `#${v.toLowerCase()}`
}

/** 字号（半磅）→ em（以 12pt 正文为基准），并夹在可读区间 */
function fontSizeEm(halfPoints: number): string {
  if (!Number.isFinite(halfPoints) || halfPoints <= 0) return ''
  const pt = halfPoints / 2
  const em = Math.min(2.2, Math.max(0.78, pt / 12))
  return `${em.toFixed(2)}em`
}

/**
 * 段落样式 → 标题级别（1–3），0 表示正文。
 *
 * Title / Subtitle 故意**不**升级为标题：切章是按 h1 做的，若把书名当 h1
 * 会多出一个只有标题的空章（mammoth 时代就踩过，靠 styleMap 规避）。
 */
function headingLevel(styleId: string, styleName: string): number {
  const probe = `${styleId} ${styleName}`.toLowerCase()
  const m = /(?:heading|标题)\s*([1-6])/.exec(probe)
  if (m) return Math.min(3, Math.max(1, Number(m[1])))
  return 0
}

/** 书名/副标题：保留段落 + 居中 + 字号，但不参与切章 */
function isDocTitle(styleId: string, styleName: string): boolean {
  return /title|subtitle|文档标题|副标题/.test(`${styleId} ${styleName}`.toLowerCase())
}

function alignOf(pPr: Element | null): string {
  const jc = attr(childOf(pPr, 'w:jc'), 'val')
  if (jc === 'center' || jc === 'right' || jc === 'both' || jc === 'distribute') {
    return jc === 'both' || jc === 'distribute' ? 'justify' : jc
  }
  return ''
}

interface RunStyle {
  bold: boolean
  italic: boolean
  underline: boolean
  strike: boolean
  color: string
  size: string
}

function readRunStyle(rPr: Element | null): RunStyle {
  return {
    bold: flag(childOf(rPr, 'w:b')),
    italic: flag(childOf(rPr, 'w:i')),
    underline: !!childOf(rPr, 'w:u'),
    strike: flag(childOf(rPr, 'w:strike')) || flag(childOf(rPr, 'w:dstrike')),
    color: safeColor(attr(childOf(rPr, 'w:color'), 'val')),
    size: fontSizeEm(Number(attr(childOf(rPr, 'w:sz'), 'val'))),
  }
}

/** 一个 run 的文本内容（w:t / w:tab / w:br） */
function runContent(r: Element): string {
  let out = ''
  const walk = (n: Element) => {
    for (const c of Array.from(n.children)) {
      const name = c.localName
      if (name === 'rPr') continue
      if (name === 't') out += escapeHtml(c.textContent ?? '')
      else if (name === 'tab') out += '\t'
      else if (name === 'br' || name === 'cr') out += '<br/>'
      else if (name === 'noBreakHyphen') out += '-'
      else if (name === 'drawing' || name === 'pict') {
        // 图片暂不透传（需要 rels + 媒体解码），保留 alt 文本便于识别
        const alt = c.getElementsByTagName('wp:docPr')[0]?.getAttribute('descr') ?? ''
        if (alt) out += `<span class="docx-img-alt">[图片：${escapeHtml(alt)}]</span>`
      } else if (name === 'hyperlink' || name === 'smartTag' || name === 'ins' || name === 'fldSimple') {
        // 超链接/修订等容器：继续向下收集文本，避免整段丢失
        walk(c)
      }
    }
  }
  walk(r)
  return out
}

function renderRun(r: Element, inHeading: boolean): string {
  const style = readRunStyle(childOf(r, 'w:rPr'))
  let inner = runContent(r)
  if (!inner) return ''
  if (style.bold) inner = `<strong>${inner}</strong>`
  if (style.italic) inner = `<em>${inner}</em>`
  if (style.underline) inner = `<u>${inner}</u>`
  if (style.strike) inner = `<s>${inner}</s>`

  const decls: string[] = []
  if (style.color) {
    // 用 color-mix 向正文色靠拢：深色主题自动提亮、浅色主题自动压暗，
    // 既保留 Word 里的色相，又不会出现「深色背景上的黑字」。
    decls.push(`color:color-mix(in srgb, ${style.color} 62%, var(--r-fg))`)
  }
  // 标题的字号由阅读器自己的 h1/h2/h3 规则决定，避免与 Word 字号叠加放大
  if (style.size && !inHeading) decls.push(`font-size:${style.size}`)
  if (!decls.length) return inner
  return `<span style="${decls.join(';')}">${inner}</span>`
}

/** 段落 → HTML（p / h1-h3） */
function renderParagraph(p: Element, styles: Map<string, string>): string {
  const pPr = childOf(p, 'w:pPr')
  const styleId = attr(childOf(pPr, 'w:pStyle'), 'val')
  const styleName = styles.get(styleId) ?? ''
  const level = headingLevel(styleId, styleName)
  const docTitle = isDocTitle(styleId, styleName)
  const align = alignOf(pPr)
  const indent = !!childOf(pPr, 'w:ind')
  const listItem = !!childOf(pPr, 'w:numPr')

  const runs = Array.from(p.getElementsByTagName('*')).filter((n) => n.localName === 'r')
  const inner = runs.map((r) => renderRun(r, level > 0)).join('')
  const text = (p.textContent ?? '').replace(/\s+/g, '')
  if (!inner || (!text && !inner.includes('<br'))) return ''
  // 纯图片段落：inner 已经有占位文本，保留

  const decls: string[] = []
  if (align) decls.push(`text-align:${align}`)
  if (indent && !level && !listItem) decls.push('text-indent:2em')
  if (listItem) decls.push('padding-left:1.4em', 'text-indent:-1.1em')
  const style = decls.length ? ` style="${decls.join(';')}"` : ''
  const cls = docTitle ? ' class="docx-title"' : ''
  const bullet = listItem ? '• ' : ''

  if (level > 0) return `<h${level}${style}>${inner}</h${level}>`
  return `<p${cls}${style}>${bullet}${inner}</p>`
}

/** 表格：首行提升为表头（与既有 DOCX 处理口径一致） */
function renderTable(tbl: Element, styles: Map<string, string>): string {
  const rows = kids(tbl, 'tr')
  if (!rows.length) return ''
  const out: string[] = []
  rows.forEach((tr, ri) => {
    const cells = kids(tr, 'tc')
    const tag = ri === 0 ? 'th' : 'td'
    const cellsHtml = cells.map((tc) => {
      const paras = kids(tc, 'p').map((p) => renderParagraph(p, styles)).filter(Boolean)
      const body = paras
        .map((h) => (/^<p[ >]/.test(h) ? h.replace(/^<p[^>]*>/, '').replace(/<\/p>$/, '') : h))
        .join('<br/>')
      const span = Number(attr(childOf(tc, 'w:tcPr') && childOf(childOf(tc, 'w:tcPr'), 'w:gridSpan'), 'val'))
      const spanAttr = Number.isFinite(span) && span > 1 ? ` colspan="${span}"` : ''
      return `<${tag}${spanAttr}>${body}</${tag}>`
    })
    out.push(`<tr>${cellsHtml.join('')}</tr>`)
  })
  const head = out[0] ?? ''
  return `<table><thead>${head}</thead><tbody>${out.slice(1).join('')}</tbody></table>`
}

/** styles.xml → styleId→name（用于识别 Heading 1/2/3） */
function readStyles(files: Record<string, Uint8Array>): Map<string, string> {
  const map = new Map<string, string>()
  const raw = files['word/styles.xml']
  if (!raw) return map
  try {
    const xml = new TextDecoder('utf-8').decode(raw)
    const doc = new DOMParser().parseFromString(xml, 'application/xml')
    for (const st of Array.from(doc.getElementsByTagName('*'))) {
      if (st.localName !== 'style') continue
      const id = attr(st, 'styleId')
      const name = attr(childOf(st, 'w:name'), 'val')
      if (id && name) map.set(id, name)
    }
  } catch {
    /* 样式表损坏时退化为按 styleId 猜标题 */
  }
  return map
}

export function docxToHtmlOoxml(data: ArrayBuffer): OoxmlResult {
  const warnings: string[] = []
  const files = unzipSync(new Uint8Array(data))
  const docXml = files['word/document.xml']
  if (!docXml) throw new Error('DOCX 缺少 word/document.xml（可能是旧版 .doc 或已损坏）')

  const xml = new TextDecoder('utf-8').decode(docXml)
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) {
    throw new Error('DOCX 的 document.xml 解析失败（XML 异常）')
  }
  const styles = readStyles(files)
  if (!styles.size) warnings.push('缺少 styles.xml，标题级别按 styleId 推断')

  const body = doc.getElementsByTagNameNS(W_NS, 'body')[0] ?? doc.getElementsByTagName('w:body')[0]
  if (!body) throw new Error('DOCX 缺少 w:body')

  const parts: string[] = []
  for (const el of Array.from(body.children)) {
    if (el.localName === 'p') parts.push(renderParagraph(el, styles))
    else if (el.localName === 'tbl') parts.push(renderTable(el, styles))
  }
  return { html: parts.filter(Boolean).join('\n'), warnings }
}
