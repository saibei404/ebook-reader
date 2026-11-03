import { describe, expect, it } from 'vitest'
import {
  annotationToMarkdown,
  annotationsToMarkdown,
  cfiStartOf,
  clampExcerpt,
  COLOR_LABEL,
  EXCERPT_MAX,
  formatDateTime,
  groupByBook,
  makeAnnotationId,
} from '@/lib/annotations'
import { ANNOTATION_COLORS, FORMAT_LABEL, formatFromName, type Annotation } from '@/types/book'

function an(patch: Partial<Annotation> = {}): Annotation {
  return {
    id: 'a1',
    bookId: 'b1',
    type: 'highlight',
    color: 'yellow',
    locator: { kind: 'offset', value: 100, percent: 0.25, updatedAt: 1 },
    endOffset: 140,
    chapterTitle: '第二章',
    excerpt: '这是一段摘录',
    createdAt: 1000,
    updatedAt: 1000,
    ...patch,
  }
}

describe('clampExcerpt', () => {
  it('压缩空白并去首尾空格', () => {
    expect(clampExcerpt('  a \n\n b  ')).toBe('a b')
  })

  it('超长截断并加省略号', () => {
    const long = 'x'.repeat(EXCERPT_MAX + 10)
    const out = clampExcerpt(long)
    expect(out.length).toBe(EXCERPT_MAX + 1)
    expect(out.endsWith('…')).toBe(true)
  })

  it('刚好等于上限时不截断', () => {
    const s = 'y'.repeat(EXCERPT_MAX)
    expect(clampExcerpt(s)).toBe(s)
  })

  it('空值安全', () => {
    expect(clampExcerpt('')).toBe('')
    expect(clampExcerpt(undefined as unknown as string)).toBe('')
  })
})

describe('makeAnnotationId', () => {
  it('带前缀且两次不重复', () => {
    const a = makeAnnotationId(1000, () => 0.123456)
    const b = makeAnnotationId(1001, () => 0.654321)
    expect(a.startsWith('an-')).toBe(true)
    expect(a).not.toBe(b)
  })
})

describe('cfiStartOf', () => {
  it('把 CFI Range 截到起点', () => {
    expect(cfiStartOf('epubcfi(/6/4[chap02]!/4/2,/1:0,/1:12)')).toBe('epubcfi(/6/4[chap02]!/4/2)')
  })

  it('单点 CFI 原样返回', () => {
    expect(cfiStartOf('epubcfi(/6/4[chap02]!/4/2/2)')).toBe('epubcfi(/6/4[chap02]!/4/2/2)')
  })

  it('空串与非 CFI 输入安全', () => {
    expect(cfiStartOf('')).toBe('')
    expect(cfiStartOf('chapter1.xhtml')).toBe('chapter1.xhtml')
  })
})

describe('groupByBook', () => {
  const titleOf = (id: string) => (id === 'b1' ? '书一' : id === 'b2' ? '书二' : '')

  it('按书分组，组内按创建时间倒序', () => {
    const groups = groupByBook(
      [an({ id: 'a', bookId: 'b1', createdAt: 1 }), an({ id: 'b', bookId: 'b1', createdAt: 5 })],
      titleOf
    )
    expect(groups).toHaveLength(1)
    expect(groups[0].title).toBe('书一')
    expect(groups[0].items.map((x) => x.id)).toEqual(['b', 'a'])
  })

  it('组之间按最近更新时间倒序', () => {
    const groups = groupByBook(
      [
        an({ id: 'a', bookId: 'b1', createdAt: 1, updatedAt: 1 }),
        an({ id: 'b', bookId: 'b2', createdAt: 9, updatedAt: 9 }),
      ],
      titleOf
    )
    expect(groups.map((g) => g.bookId)).toEqual(['b2', 'b1'])
  })

  it('未知书显示占位标题', () => {
    const groups = groupByBook([an({ bookId: 'zzz' })], titleOf)
    expect(groups[0].title).toBe('未知书籍')
  })

  it('空输入返回空数组', () => {
    expect(groupByBook([], titleOf)).toEqual([])
  })
})

describe('formatDateTime', () => {
  it('补零到分钟', () => {
    const d = new Date(2026, 0, 5, 8, 7).getTime()
    expect(formatDateTime(d)).toBe('2026-01-05 08:07')
  })
})

describe('annotationToMarkdown', () => {
  it('含章名、百分比、颜色与引用块', () => {
    const md = annotationToMarkdown(an())
    expect(md).toContain('- **第二章 · 25%**（黄）')
    expect(md).toContain('> 这是一段摘录')
  })

  it('有备注时附「备注：」段', () => {
    const md = annotationToMarkdown(an({ note: '我的想法' }))
    expect(md).toContain('备注：我的想法')
  })

  it('多行摘录每行都加引用前缀', () => {
    const md = annotationToMarkdown(an({ excerpt: '第一行\n第二行' }))
    expect(md).toContain('> 第一行\n> 第二行')
  })

  it('无章名时回落到「正文」', () => {
    expect(annotationToMarkdown(an({ chapterTitle: '' }))).toContain('**正文')
  })
})

describe('annotationsToMarkdown', () => {
  const titleOf = (id: string) => (id === 'b1' ? '书一' : '书二')

  it('文档头包含统计与导出时间', () => {
    const md = annotationsToMarkdown([an(), an({ id: 'a2', bookId: 'b2' })], titleOf, new Date(2026, 10, 2, 10, 0).getTime())
    expect(md).toContain('# 墨鱼阅读器 · 书摘与笔记')
    expect(md).toContain('共 2 条 / 2 本书')
    expect(md).toContain('2026-11-02 10:00')
  })

  it('按书分节，节内按位置先后排序', () => {
    const md = annotationsToMarkdown(
      [
        an({ id: 'late', locator: { kind: 'offset', value: 900, percent: 0.9, updatedAt: 1 } }),
        an({ id: 'early', locator: { kind: 'offset', value: 10, percent: 0.01, updatedAt: 1 } }),
      ],
      titleOf
    )
    expect(md.indexOf('1%')).toBeLessThan(md.indexOf('90%'))
    expect(md).toContain('## 书一（2 条）')
  })

  it('无书摘时给出明确占位文案', () => {
    const md = annotationsToMarkdown([], titleOf)
    expect(md).toContain('暂无书摘')
  })
})

describe('类型常量与格式识别', () => {
  it('formatFromName 覆盖全部已支持扩展名', () => {
    expect(formatFromName('a.epub')).toBe('epub')
    expect(formatFromName('a.PDF')).toBe('pdf')
    expect(formatFromName('a.mobi')).toBe('mobi')
    expect(formatFromName('a.azw3')).toBe('azw3')
    expect(formatFromName('a.azw')).toBe('azw3')
    expect(formatFromName('a.fb2')).toBe('fb2')
    expect(formatFromName('a.txt')).toBe('txt')
    expect(formatFromName('a.markdown')).toBe('md')
    expect(formatFromName('a.docx')).toBe('docx')
    expect(formatFromName('a.doc')).toBe('docx')
    expect(formatFromName('a.cbz')).toBe('cbz')
    expect(formatFromName('a.cbr')).toBe('cbr')
  })

  it('未知扩展名回落 unknown', () => {
    expect(formatFromName('a.zip')).toBe('unknown')
    expect(formatFromName('noext')).toBe('unknown')
  })

  it('FORMAT_LABEL 覆盖所有格式', () => {
    for (const f of ['epub', 'pdf', 'mobi', 'azw3', 'fb2', 'txt', 'md', 'docx', 'cbz', 'cbr', 'unknown'] as const) {
      expect(FORMAT_LABEL[f]).toBeTruthy()
    }
  })

  it('四种高亮色都有中文标签', () => {
    expect(ANNOTATION_COLORS.map((c) => c.id)).toEqual(['yellow', 'green', 'blue', 'pink'])
    expect(COLOR_LABEL.yellow).toBe('黄')
    expect(COLOR_LABEL.pink).toBe('粉')
  })
})
