import { describe, expect, it } from 'vitest'
import { strToU8, zipSync } from 'fflate'
import { docxToHtmlOoxml } from '@/reader/formats/docx-ooxml'
import { docxToChapters } from '@/reader/formats/docx'

const NS =
  'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ' +
  'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'

/** 用 fflate 现场造一个最小 docx（只含 document.xml，可选 styles.xml） */
function makeDocx(bodyXml: string, stylesXml?: string): ArrayBuffer {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"></Types>'
    ),
    'word/document.xml': strToU8(`<?xml version="1.0" encoding="UTF-8"?><w:document ${NS}><w:body>${bodyXml}</w:body></w:document>`),
  }
  if (stylesXml) files['word/styles.xml'] = strToU8(stylesXml)
  const zipped = zipSync(files)
  return zipped.buffer.slice(zipped.byteOffset, zipped.byteOffset + zipped.byteLength) as ArrayBuffer
}

const STYLES = `<?xml version="1.0"?><w:styles ${NS}>
  <w:style w:styleId="Heading1"><w:name w:val="heading 1"/></w:style>
  <w:style w:styleId="Heading2"><w:name w:val="heading 2"/></w:style>
  <w:style w:styleId="Title"><w:name w:val="Title"/></w:style>
</w:styles>`

describe('docxToHtmlOoxml · 段落与标题', () => {
  it('按样式名识别标题层级（Heading1 → h1）', () => {
    const buf = makeDocx(
      `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>第一章</w:t></w:r></w:p>
       <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>小节</w:t></w:r></w:p>`,
      STYLES
    )
    const { html } = docxToHtmlOoxml(buf)
    expect(html).toContain('<h1>第一章</h1>')
    expect(html).toContain('<h2>小节</h2>')
  })

  it('Title 不升级为 h1（否则会多出一个只有标题的空章）', () => {
    const buf = makeDocx(
      `<w:p><w:pPr><w:pStyle w:val="Title"/><w:jc w:val="center"/></w:pPr><w:r><w:t>书名</w:t></w:r></w:p>`,
      STYLES
    )
    const { html } = docxToHtmlOoxml(buf)
    expect(html).not.toContain('<h1>')
    expect(html).toContain('class="docx-title"')
    expect(html).toContain('text-align:center')
  })

  it('没有 styles.xml 时按 styleId 猜标题，并给出告警', () => {
    const buf = makeDocx(
      `<w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>小标题</w:t></w:r></w:p>`
    )
    const { html, warnings } = docxToHtmlOoxml(buf)
    expect(html).toContain('<h2>小标题</h2>')
    expect(warnings.join()).toContain('styles.xml')
  })

  it('空段落被跳过', () => {
    const buf = makeDocx(`<w:p><w:r><w:t>  </w:t></w:r></w:p>`)
    expect(docxToHtmlOoxml(buf).html.trim()).toBe('')
  })
})

describe('docxToHtmlOoxml · 直接格式透传（D7）', () => {
  it('字体颜色 → color-mix（深色主题自动提亮）', () => {
    const buf = makeDocx(
      `<w:p><w:r><w:rPr><w:color w:val="FF0000"/></w:rPr><w:t>红字</w:t></w:r></w:p>`
    )
    const { html } = docxToHtmlOoxml(buf)
    expect(html).toContain('color:color-mix(in srgb, #ff0000 62%, var(--r-fg))')
  })

  it('字号（半磅）→ em，随阅读器字号缩放', () => {
    const buf = makeDocx(`<w:p><w:r><w:rPr><w:sz w:val="32"/></w:rPr><w:t>大字</w:t></w:r></w:p>`)
    // 32 半磅 = 16pt → 16/12 = 1.33em
    expect(docxToHtmlOoxml(buf).html).toContain('font-size:1.33em')
  })

  it('标题不透传字号（避免与 h1 样式双重放大）', () => {
    const buf = makeDocx(
      `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:rPr><w:sz w:val="48"/></w:rPr><w:t>章</w:t></w:r></w:p>`,
      STYLES
    )
    expect(docxToHtmlOoxml(buf).html).not.toContain('font-size')
  })

  it('段落对齐 both → justify', () => {
    const buf = makeDocx(
      `<w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:t>两端对齐</w:t></w:r></w:p>`
    )
    expect(docxToHtmlOoxml(buf).html).toContain('text-align:justify')
  })

  it('非法颜色值被丢弃（防注入）', () => {
    const buf = makeDocx(
      `<w:p><w:r><w:rPr><w:color w:val="javascript:alert(1)"/></w:rPr><w:t>x</w:t></w:r></w:p>`
    )
    expect(docxToHtmlOoxml(buf).html).not.toContain('javascript')
  })

  it('粗体 / 斜体 / 删除线 / 下划线', () => {
    const buf = makeDocx(
      `<w:p><w:r><w:rPr><w:b/><w:sz w:val="24"/></w:rPr><w:t>粗</w:t></w:r>
       <w:r><w:rPr><w:i/><w:sz w:val="24"/></w:rPr><w:t>斜</w:t></w:r>
       <w:r><w:rPr><w:strike/><w:sz w:val="24"/></w:rPr><w:t>删</w:t></w:r>
       <w:r><w:rPr><w:u w:val="single"/><w:sz w:val="24"/></w:rPr><w:t>下划线</w:t></w:r></w:p>`
    )
    const { html } = docxToHtmlOoxml(buf)
    expect(html).toContain('<strong>粗</strong>')
    expect(html).toContain('<em>斜</em>')
    expect(html).toContain('<s>删</s>')
    expect(html).toContain('<u>下划线</u>')
  })

  it('文本中的尖括号被转义（不会变成标签）', () => {
    const buf = makeDocx(`<w:p><w:r><w:t>&lt;script&gt;alert(1)&lt;/script&gt;</w:t></w:r></w:p>`)
    const { html } = docxToHtmlOoxml(buf)
    expect(html).toContain('&lt;script&gt;')
    expect(html).not.toContain('<script>')
  })

  it('制表符与换行保留', () => {
    const buf = makeDocx(`<w:p><w:r><w:t>a</w:t><w:tab/><w:t>b</w:t><w:br/><w:t>c</w:t></w:r></w:p>`)
    const { html } = docxToHtmlOoxml(buf)
    expect(html).toContain('\t')
    expect(html).toContain('<br/>')
  })
})

describe('docxToHtmlOoxml · 表格与列表', () => {
  const table = `<w:tbl>
    <w:tr>
      <w:tc><w:p><w:r><w:t>格式</w:t></w:r></w:p></w:tc>
      <w:tc><w:p><w:r><w:t>引擎</w:t></w:r></w:p></w:tc>
    </w:tr>
    <w:tr>
      <w:tc><w:p><w:r><w:t>EPUB</w:t></w:r></w:p></w:tc>
      <w:tc><w:p><w:r><w:t>epub.js</w:t></w:r></w:p></w:tc>
    </w:tr>
  </w:tbl>`

  it('首行提升为表头，单元格内容保留', () => {
    const { html } = docxToHtmlOoxml(makeDocx(table))
    expect(html).toContain('<thead><tr><th>格式</th><th>引擎</th></tr></thead>')
    expect(html).toContain('<td>EPUB</td><td>epub.js</td>')
  })

  it('首行单元格合并（gridSpan）→ colspan', () => {
    const buf = makeDocx(`<w:tbl><w:tr>
      <w:tc><w:tcPr><w:gridSpan w:val="2"/></w:tcPr><w:p><w:r><w:t>合并表头</w:t></w:r></w:p></w:tc>
    </w:tr><w:tr><w:tc><w:p><w:r><w:t>a</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>b</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`)
    expect(docxToHtmlOoxml(buf).html).toContain('colspan="2"')
  })

  it('编号段落加项目符号 + 悬挂缩进', () => {
    const buf = makeDocx(
      `<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/></w:numPr></w:pPr><w:r><w:t>条目</w:t></w:r></w:p>`
    )
    const { html } = docxToHtmlOoxml(buf)
    expect(html).toContain('• ')
    expect(html).toContain('padding-left:1.4em')
  })
})

describe('docxToChapters（接入渲染管线）', () => {
  it('按 h1 切章，标题写回章 HTML', async () => {
    const buf = makeDocx(
      `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>第一章</w:t></w:r></w:p>
       <w:p><w:r><w:t>正文一</w:t></w:r></w:p>
       <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>第二章</w:t></w:r></w:p>
       <w:p><w:r><w:t>正文二</w:t></w:r></w:p>`,
      STYLES
    )
    const { chapters } = await docxToChapters(buf)
    expect(chapters.map((c) => c.title)).toEqual(['第一章', '第二章'])
    expect(chapters[0].body).toContain('<h1>第一章</h1>')
    expect(chapters[1].startChar).toBe(chapters[0].charCount)
  })

  it('保留颜色/字号/对齐（链路端到端）', async () => {
    const buf = makeDocx(
      `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:color w:val="2E7D32"/><w:sz w:val="28"/></w:rPr><w:t>绿色强调</w:t></w:r></w:p>`,
      STYLES
    )
    const { chapters } = await docxToChapters(buf)
    expect(chapters[0].body).toContain('#2e7d32')
    expect(chapters[0].body).toContain('font-size:1.17em')
    expect(chapters[0].body).toContain('text-align:center')
  })

  it('损坏的 docx 不会静默返回空（抛错或回退）', async () => {
    const bad = new TextEncoder().encode('not a zip').buffer as ArrayBuffer
    await expect(docxToChapters(bad)).rejects.toBeTruthy()
  })
})
