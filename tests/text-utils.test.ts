import { describe, expect, it } from 'vitest'
import {
  chapterHtml,
  chapterText,
  countTextChars,
  decodeText,
  escapeHtml,
  fb2ToChapters,
  htmlToText,
  markdownToHtml,
  splitPlainText,
  textToHtml,
  plainParagraphs,
  type Chapter,
} from '@/reader/text-utils'

/** 造一个 ArrayBuffer（UTF-8） */
function buf(text: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(text)
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

describe('escapeHtml / htmlToText', () => {
  it('转义四个敏感字符', () => {
    expect(escapeHtml(`a & b < c > d " e`)).toBe('a &amp; b &lt; c &gt; d &quot; e')
  })

  it('htmlToText 反向还原实体并去标签', () => {
    expect(htmlToText('<p>a &amp; b</p><p>&lt;tag&gt; &quot;x&quot;&nbsp;y</p>')).toBe(
      'a & b<tag> "x" y'
    )
  })
})

describe('countTextChars', () => {
  it('不计换行（与 DOM textContent 同口径）', () => {
    expect(countTextChars('a\nb\r\nc')).toBe(3)
  })

  it('空串为 0', () => {
    expect(countTextChars('')).toBe(0)
  })
})

describe('decodeText', () => {
  it('识别 UTF-8', () => {
    const r = decodeText(buf('中文 abc'))
    expect(r.text).toBe('中文 abc')
    expect(r.encoding).toBe('utf-8')
  })

  it('识别 UTF-8 BOM 并去掉 BOM', () => {
    const b = new Uint8Array([0xef, 0xbb, 0xbf, 0x41])
    const r = decodeText(b.buffer as ArrayBuffer)
    expect(r.text).toBe('A')
    expect(r.encoding).toBe('utf-8-bom')
  })

  it('识别 UTF-16LE BOM', () => {
    const b = new Uint8Array([0xff, 0xfe, 0x2d, 0x4e])
    const r = decodeText(b.buffer as ArrayBuffer)
    expect(r.text).toBe('中')
    expect(r.encoding).toBe('utf-16le')
  })

  it('非法 UTF-8 回退 GB18030（中文 TXT 常见）', () => {
    // "中文" 的 GBK 编码
    const b = new Uint8Array([0xd6, 0xd0, 0xce, 0xc4])
    const r = decodeText(b.buffer as ArrayBuffer)
    expect(r.text).toBe('中文')
    expect(r.encoding).toBe('gb18030')
  })
})

describe('textToHtml', () => {
  it('按空行分段，段内换行转 br', () => {
    expect(textToHtml('一\n二\n\n三')).toBe('<p>一<br/>二</p><p>三</p>')
  })

  it('转义尖括号，避免正文里的伪标签被当 HTML', () => {
    expect(textToHtml('<b>x</b>')).toBe('<p>&lt;b&gt;x&lt;/b&gt;</p>')
  })

  it('空内容返回空串', () => {
    expect(textToHtml('   \n  ')).toBe('')
  })
})

describe('chapterHtml / chapterText（惰性渲染）', () => {
  it('text 源首次访问才生成 HTML，并缓存到 chapter.html', () => {
    const c: Chapter = { title: '一', body: '甲\n\n乙', source: 'text', startChar: 0, charCount: 2 }
    expect(c.html).toBeUndefined()
    expect(chapterHtml(c)).toBe('<p>甲</p><p>乙</p>')
    expect(typeof c.html).toBe('string')
    // 二次调用命中缓存（同一字符串引用即可说明没重新生成）
    expect(chapterHtml(c)).toBe(c.html)
  })

  it('html 源直接返回 body', () => {
    const c: Chapter = { title: '一', body: '<h1>甲</h1>', source: 'html', startChar: 0, charCount: 1 }
    expect(chapterHtml(c)).toBe('<h1>甲</h1>')
  })

  it('chapterText 对 text 源只去换行，对 html 源去标签', () => {
    expect(chapterText({ title: 't', body: '甲\n乙', source: 'text', startChar: 0, charCount: 0 })).toBe(
      '甲乙'
    )
    expect(
      chapterText({ title: 't', body: '<p>甲<em>乙</em></p>', source: 'html', startChar: 0, charCount: 0 })
    ).toBe('甲乙')
  })
})

describe('splitPlainText', () => {
  const raw = `前言部分文字

第一章 起点
第一段内容

第二段内容

第二章 转折
转折内容`

  it('按章标题切分，标题作为 heading 渲染', () => {
    const chapters = splitPlainText(raw)
    expect(chapters.map((c) => c.title)).toEqual(['前言', '第一章 起点', '第二章 转折'])
    expect(chapters[1].heading).toBe('第一章 起点')
    expect(chapterHtml(chapters[1])).toContain('<h2>第一章 起点</h2>')
  })

  it('startChar 单调递增且与 DOM 文本口径一致', () => {
    const chapters = splitPlainText(raw)
    for (let i = 1; i < chapters.length; i++) {
      expect(chapters[i].startChar).toBe(chapters[i - 1].startChar + chapters[i - 1].charCount)
    }
    // 第一章字符数 = 标题字数 + 正文去换行字数
    const h = '第一章 起点'
    expect(chapters[1].charCount).toBe(h.length + countTextChars('第一段内容\n\n第二段内容'))
  })

  it('无章节标记时按 chunkSize 硬切', () => {
    const long = '啊'.repeat(25)
    const chapters = splitPlainText(long, 10)
    expect(chapters.length).toBe(3)
    expect(chapters.map((c) => c.charCount)).toEqual([10, 10, 5])
    expect(chapters[2].startChar).toBe(20)
  })

  it('空文本返回空数组', () => {
    expect(splitPlainText('   ')).toEqual([])
  })

  it('只有一个标题时也能成章', () => {
    const chapters = splitPlainText('第一章 只有标题\n正文')
    expect(chapters.length).toBe(1)
    expect(chapters[0].title).toBe('第一章 只有标题')
  })
})

describe('markdownToHtml', () => {
  it('标题分级上限 h3', () => {
    const html = markdownToHtml('# a\n## b\n#### d')
    expect(html).toContain('<h1>a</h1>')
    expect(html).toContain('<h2>b</h2>')
    expect(html).toContain('<h3>d</h3>')
  })

  it('粗体 / 斜体 / 行内码', () => {
    const html = markdownToHtml('**粗** 与 *斜* 与 `code`')
    expect(html).toContain('<strong>粗</strong>')
    expect(html).toContain('<em>斜</em>')
    expect(html).toContain('<code>code</code>')
  })

  it('无序与有序列表', () => {
    const html = markdownToHtml('- a\n- b\n\n1. c\n2. d')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>a</li>')
    expect(html).toContain('<ol>')
    expect(html).toContain('<li>d</li>')
  })

  it('引用、分隔线、链接', () => {
    const html = markdownToHtml('> 引用\n\n---\n\n[文本](https://example.com)')
    expect(html).toContain('<blockquote>引用</blockquote>')
    expect(html).toContain('<hr/>')
    expect(html).toContain('<a href="https://example.com" rel="noreferrer">文本</a>')
  })

  it('GFM 表格带对齐（:-- 左 / --: 右 / :-: 居中）', () => {
    const html = markdownToHtml('| a | b |\n|:-:|--:|\n| 1 | 2 |')
    expect(html).toContain('<table>')
    expect(html).toContain('<th style="text-align:center">a</th>')
    expect(html).toContain('<td style="text-align:right">2</td>')
    // 显式左对齐不额外加 style（默认即左）
    const left = markdownToHtml('| a | b |\n|:--|--:|\n| 1 | 2 |')
    expect(left).toContain('<th>a</th>')
  })

  it('GFM 段落对齐转 style', () => {
    const html = markdownToHtml('<p align="center">居中</p>')
    expect(html).toContain('<p style="text-align:center">居中</p>')
  })

  it('白名单放行颜色 span，其它 HTML 一律转义', () => {
    const ok = markdownToHtml('<span style="color:#ff0000">红</span>')
    expect(ok).toContain('<span style="color:#ff0000">红</span>')
    const bad = markdownToHtml('<img src=x onerror=alert(1)>')
    expect(bad).not.toContain('<img')
    expect(bad).toContain('&lt;img')
  })
})

describe('fb2ToChapters', () => {
  const fb2 = `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
  <body>
    <section>
      <title><p>第一章</p></title>
      <p>正文一</p>
      <p><strong>加粗</strong>与<emphasis>斜体</emphasis></p>
    </section>
    <section>
      <title><p>第二章</p></title>
      <p>正文二</p>
      <section>
        <title><p>小节</p></title>
        <p>嵌套内容</p>
      </section>
    </section>
  </body>
</FictionBook>`

  it('按 section 切章，保留行内标记', () => {
    const chapters = fb2ToChapters(buf(fb2))
    expect(chapters.length).toBe(2)
    expect(chapters[0].title).toBe('第一章')
    expect(chapterHtml(chapters[0])).toContain('<strong>加粗</strong>')
    expect(chapterHtml(chapters[0])).toContain('<em>斜体</em>')
    expect(chapterHtml(chapters[1])).toContain('嵌套内容')
  })

  it('charCount 与 startChar 单调递增', () => {
    const chapters = fb2ToChapters(buf(fb2))
    expect(chapters[1].startChar).toBe(chapters[0].charCount)
    expect(chapters[0].charCount).toBeGreaterThan(0)
  })

  it('无 section 时把 body 下的 p 收成一章', () => {
    const simple = `<?xml version="1.0"?><FictionBook><body><p>甲</p><p>乙</p></body></FictionBook>`
    const chapters = fb2ToChapters(buf(simple))
    expect(chapters.length).toBe(1)
    expect(chapterHtml(chapters[0])).toBe('<p>甲</p><p>乙</p>')
  })

  it('XML 损坏时抛错（调用方转成可读错误）', () => {
    expect(() => fb2ToChapters(buf('<FictionBook><body>'))).toThrow()
  })
})

describe('plainParagraphs（纯文本分段）', () => {
  it('无空行、无缩进的网文：每行一段', () => {
    const raw = '第一段结束了。\n第二段也结束了。\n第三段。'
    expect(plainParagraphs(raw)).toEqual(['第一段结束了。', '第二段也结束了。', '第三段。'])
  })

  it('硬折行（长行 + 无句末标点）会被接回同一段', () => {
    const long = '这是一段长度超过四十个字符的正文内容，用来模拟按照固定列宽折行的电子书文本'
    const raw = `${long}\n后半句没有标点结尾`
    const out = plainParagraphs(raw)
    expect(out.length).toBe(1)
    expect(out[0]).toContain('后半句')
  })

  it('行首全角缩进表示新段（未缩进行是续行）', () => {
    const raw = '\u3000\u3000第一段开头\n接着上一段继续写\n\u3000\u3000第二段开头'
    expect(plainParagraphs(raw)).toEqual(['第一段开头接着上一段继续写', '第二段开头'])
  })

  it('有空行时按空行分段，短行之间保留硬换行', () => {
    expect(textToHtml('一\n二\n\n三')).toBe('<p>一<br/>二</p><p>三</p>')
  })

  it('超长折行在空行分段模式下被拼接，而不是拆成多段', () => {
    const line = '这一行已经很长了，长度足够到四十个字符以上，属于被容器宽度折开的续行'
    const raw = `${line}\n仍然属于同一段的内容。\n\n下一段。`
    const out = plainParagraphs(raw)
    expect(out.length).toBe(2)
    expect(out[0]).toContain('仍然属于同一段')
  })

  it('西文折行拼接时补空格，不把两个单词粘起来', () => {
    const raw = 'This line is deliberately long enough to look like a hard wrapped line in a book file\nand continues here.'
    const out = plainParagraphs(raw)
    expect(out.length).toBe(1)
    expect(out[0]).toContain('file and continues')
  })

  it('纯空白文本返回空数组', () => {
    expect(plainParagraphs('   \n\u3000\n')).toEqual([])
  })
})
