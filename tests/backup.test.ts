import { describe, expect, it } from 'vitest'
import { mergeBackup, parseBackup, type BackupSnapshot } from '@/lib/backup'
import type { Annotation, Book, Bookmark } from '@/types/book'

function book(patch: Partial<Book> = {}): Book {
  return {
    id: 'b1',
    title: '书名',
    author: '作者',
    format: 'txt',
    addedAt: 1,
    lastReadAt: null,
    progress: 0,
    locator: null,
    coverId: null,
    coverSeed: 1,
    shelfId: null,
    size: 100,
    sourcePath: '/x.txt',
    description: '',
    ...patch,
  }
}

function bm(patch: Partial<Bookmark> = {}): Bookmark {
  return {
    id: 'bm1',
    bookId: 'b1',
    locator: { kind: 'offset', value: 10, percent: 0.1, updatedAt: 1 },
    label: '第一章',
    createdAt: 1,
    ...patch,
  }
}

function an(patch: Partial<Annotation> = {}): Annotation {
  return {
    id: 'an1',
    bookId: 'b1',
    type: 'highlight',
    color: 'yellow',
    locator: { kind: 'offset', value: 10, percent: 0.1, updatedAt: 1 },
    endOffset: 20,
    chapterTitle: '第一章',
    excerpt: '摘录',
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  }
}

function snapshot(patch: Partial<BackupSnapshot> = {}): BackupSnapshot {
  return { books: [], bookmarks: [], annotations: [], kv: [], ...patch }
}

describe('parseBackup', () => {
  const valid = (patch: Record<string, unknown> = {}) =>
    JSON.stringify({
      app: 'moyu-reader',
      schema: 2,
      exportedAt: 1,
      dbVersion: 3,
      books: [book()],
      kv: [],
      bookmarks: [],
      annotations: [],
      ...patch,
    })

  it('接受合法备份', () => {
    const r = parseBackup(valid())
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.data.schema).toBe(2)
      expect(r.data.books).toHaveLength(1)
      expect(r.data.annotations).toEqual([])
    }
  })

  it('接受 v1 老备份（缺 annotations 字段时补空数组）', () => {
    const old = JSON.stringify({ app: 'moyu-reader', schema: 1, books: [book()], kv: [], bookmarks: [] })
    const r = parseBackup(old)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.data.annotations).toEqual([])
  })

  it('拒绝非 JSON', () => {
    const r = parseBackup('{oops')
    expect(r).toEqual({ ok: false, error: '不是有效的 JSON 文件' })
  })

  it('拒绝其它应用的备份', () => {
    const r = parseBackup(valid({ app: 'other' }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('不是墨鱼阅读器')
  })

  it('拒绝过旧 schema', () => {
    const r = parseBackup(valid({ schema: 0 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('版本过旧')
  })

  it('拒绝来自更新版本的备份', () => {
    const r = parseBackup(valid({ schema: 99 }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('更新的版本')
  })

  it('拒绝缺少书籍列表的文件', () => {
    const r = parseBackup(valid({ books: undefined }))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toContain('书籍列表')
  })

  it('null 内容被拒', () => {
    expect(parseBackup('null').ok).toBe(false)
  })
})

describe('mergeBackup · 书籍', () => {
  it('新书直接加入', () => {
    const r = mergeBackup(snapshot(), snapshot({ books: [book({ id: 'n1', title: '新书' })] }))
    expect(r.books).toHaveLength(1)
    expect(r.stats.addedBooks).toBe(1)
  })

  it('同 id 视为同一本，不重复', () => {
    const r = mergeBackup(snapshot({ books: [book()] }), snapshot({ books: [book()] }))
    expect(r.books).toHaveLength(1)
    expect(r.stats.mergedBooks).toBe(1)
  })

  it('id 不同但书名 + 大小相同也合并（换机后 id 会变）', () => {
    const cur = snapshot({ books: [book({ id: 'old' })] })
    const inc = snapshot({ books: [book({ id: 'new' })] })
    const r = mergeBackup(cur, inc)
    expect(r.books).toHaveLength(1)
    expect(r.books[0].id).toBe('old')
  })

  it('备份里的进度更晚时更新位置，但进度只增不减', () => {
    const cur = snapshot({ books: [book({ progress: 0.3, lastReadAt: 100 })] })
    const inc = snapshot({
      books: [book({ progress: 0.6, lastReadAt: 200, locator: { kind: 'offset', value: 900, percent: 0.6, updatedAt: 200 } })],
    })
    const r = mergeBackup(cur, inc)
    expect(r.books[0].progress).toBe(0.6)
    expect(r.books[0].locator?.value).toBe(900)
  })

  it('备份里的进度更早时不回退阅读位置', () => {
    const cur = snapshot({
      books: [book({ progress: 0.8, lastReadAt: 300, locator: { kind: 'offset', value: 3000, percent: 0.8, updatedAt: 300 } })],
    })
    const inc = snapshot({
      books: [book({ progress: 0.2, lastReadAt: 100, locator: { kind: 'offset', value: 100, percent: 0.2, updatedAt: 100 } })],
    })
    const r = mergeBackup(cur, inc)
    expect(r.books[0].progress).toBe(0.8)
    expect(r.books[0].locator?.value).toBe(3000)
  })
})

describe('mergeBackup · 书签与笔记', () => {
  it('书签按「书 + 位置」去重', () => {
    const cur = snapshot({ books: [book()], bookmarks: [bm()] })
    const inc = snapshot({ books: [book()], bookmarks: [bm({ id: 'bm2' })] })
    const r = mergeBackup(cur, inc)
    expect(r.bookmarks).toHaveLength(1)
    expect(r.stats.skippedBookmarks).toBe(1)
  })

  it('不同位置的书签会加入', () => {
    const cur = snapshot({ books: [book()], bookmarks: [bm()] })
    const inc = snapshot({
      books: [book()],
      bookmarks: [bm({ id: 'bm2', locator: { kind: 'offset', value: 88, percent: 0.8, updatedAt: 1 } })],
    })
    const r = mergeBackup(cur, inc)
    expect(r.bookmarks).toHaveLength(2)
    expect(r.stats.addedBookmarks).toBe(1)
  })

  it('换了 id 的书，其书签 bookId 会被重映射到现有书', () => {
    const cur = snapshot({ books: [book({ id: 'old' })] })
    const inc = snapshot({ books: [book({ id: 'new' })], bookmarks: [bm({ bookId: 'new' })] })
    const r = mergeBackup(cur, inc)
    expect(r.bookmarks[0].bookId).toBe('old')
  })

  it('书签 id 冲突但内容不同时改名，避免覆盖', () => {
    const cur = snapshot({
      books: [book()],
      bookmarks: [bm({ locator: { kind: 'offset', value: 1, percent: 0.01, updatedAt: 1 } })],
    })
    const inc = snapshot({
      books: [book()],
      bookmarks: [bm({ locator: { kind: 'offset', value: 900, percent: 0.9, updatedAt: 1 } })],
    })
    const r = mergeBackup(cur, inc)
    expect(r.bookmarks).toHaveLength(2)
    expect(new Set(r.bookmarks.map((b) => b.id)).size).toBe(2)
  })

  it('笔记按「书 + 起点 + 终点」去重', () => {
    const cur = snapshot({ books: [book()], annotations: [an()] })
    const inc = snapshot({ books: [book()], annotations: [an({ id: 'an2' })] })
    const r = mergeBackup(cur, inc)
    expect(r.annotations).toHaveLength(1)
    expect(r.stats.addedAnnotations).toBe(0)
  })

  it('EPUB 笔记按 cfiRange 去重', () => {
    const epubAn = (id: string, cfi: string) =>
      an({ id, locator: { kind: 'cfi', value: cfi, percent: 0.2, updatedAt: 1 }, endOffset: undefined, cfiRange: cfi })
    const cur = snapshot({ books: [book()], annotations: [epubAn('a1', 'epubcfi(/6/2!/4/2,/1:0,/1:5)')] })
    const inc = snapshot({ books: [book()], annotations: [epubAn('a2', 'epubcfi(/6/2!/4/2,/1:0,/1:5)')] })
    expect(mergeBackup(cur, inc).annotations).toHaveLength(1)
  })

  it('重复导入同一份备份是幂等的', () => {
    const inc = snapshot({
      books: [book({ id: 'n1', title: '新书' })],
      bookmarks: [bm({ bookId: 'n1', id: 'bmx' })],
      annotations: [an({ bookId: 'n1', id: 'anx' })],
      kv: [{ key: 'settings', value: { theme: 'light' } }],
    })
    const first = mergeBackup(snapshot({ books: [book()] }), inc)
    const second = mergeBackup(
      { books: first.books, bookmarks: first.bookmarks, annotations: first.annotations, kv: first.kv },
      inc
    )
    expect(second.books.length).toBe(first.books.length)
    expect(second.bookmarks.length).toBe(first.bookmarks.length)
    expect(second.annotations.length).toBe(first.annotations.length)
    expect(second.stats.addedAnnotations).toBe(0)
  })
})

describe('mergeBackup · KV', () => {
  it('导入的设置覆盖当前值', () => {
    const r = mergeBackup(
      snapshot({ kv: [{ key: 'settings', value: { theme: 'dark' } }] }),
      snapshot({ kv: [{ key: 'settings', value: { theme: 'light' } }] })
    )
    const settings = r.kv.find((r2) => r2.key === 'settings')?.value as { theme: string }
    expect(settings.theme).toBe('light')
  })

  it('seeded 标记不会被覆盖（防止已删空的示例书复活）', () => {
    const r = mergeBackup(
      snapshot({ kv: [{ key: 'seeded', value: true }] }),
      snapshot({ kv: [{ key: 'seeded', value: false }] })
    )
    expect(r.kv.find((x) => x.key === 'seeded')?.value).toBe(true)
  })
})
