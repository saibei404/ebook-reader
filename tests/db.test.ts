import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
// auto 会把 IDBRequest / IDBKeyRange 等挂到全局（idb 内部依赖 instanceof IDBRequest）
import 'fake-indexeddb/auto'
import { IDBFactory } from 'fake-indexeddb'
import type { Book, Bookmark } from '@/types/book'

/**
 * 数据层测试（fake-indexeddb）：
 * db.ts 有模块级连接缓存，因此每个用例都 resetModules + 换一个全新的 IDBFactory，
 * 保证「v2 老库升级到 v3」这类场景不会被上一个用例的缓存污染。
 */

function book(id: string, title = '书' + id): Book {
  return {
    id,
    title,
    author: '作者',
    format: 'txt',
    addedAt: 1,
    lastReadAt: null,
    progress: 0,
    locator: null,
    coverId: null,
    coverSeed: 1,
    shelfId: null,
    size: 10,
    sourcePath: null,
    description: '',
  }
}

function bookmark(id: string, bookId: string): Bookmark {
  return {
    id,
    bookId,
    locator: { kind: 'offset', value: 10, percent: 0.1, updatedAt: 1 },
    label: '第一章',
    createdAt: 1,
  }
}

/** 全新 IDB + 全新模块缓存（普通用例） */
async function freshModules() {
  vi.resetModules()
  globalThis.indexedDB = new IDBFactory()
  return import('@/lib/db')
}

/** 只重置模块缓存，保留当前 IDB（迁移用例要沿用刚刚造好的 v2 库） */
async function loadDbModule() {
  vi.resetModules()
  return import('@/lib/db')
}

beforeEach(() => {
  vi.resetModules()
  globalThis.indexedDB = new IDBFactory()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('books / covers / kv', () => {
  it('新建库即为 v3，包含全部表', async () => {
    const db = await freshModules()
    const handle = await db.getDB()
    expect(handle.version).toBe(3)
    expect(Array.from(handle.objectStoreNames).sort()).toEqual([
      'annotations',
      'bookmarks',
      'books',
      'covers',
      'kv',
      'wallpapers',
    ])
  })

  it('书籍写入 / 全量读取 / 删除', async () => {
    const db = await freshModules()
    await db.putBook(book('b1'))
    await db.putBook(book('b2'))
    expect((await db.allBooks()).map((b) => b.id).sort()).toEqual(['b1', 'b2'])
    await db.deleteBook('b1')
    expect((await db.allBooks()).map((b) => b.id)).toEqual(['b2'])
  })

  it('kv 用显式 key 存取（历史 bug：漏传 key 导致设置刷新即丢）', async () => {
    const db = await freshModules()
    await db.setKV('settings', { theme: 'light' })
    expect(await db.getKV<{ theme: string }>('settings')).toEqual({ theme: 'light' })
    await db.setKV('settings', { theme: 'dark' })
    expect(await db.getKV<{ theme: string }>('settings')).toEqual({ theme: 'dark' })
    expect(await db.getKV('missing')).toBeNull()
  })

  it('封面按 id 存取与删除', async () => {
    const db = await freshModules()
    await db.putCover({ id: 'c1', dataUrl: 'data:image/png;base64,xxx', createdAt: 1 })
    expect(await db.getCover('c1')).toContain('data:image/png')
    await db.deleteCover('c1')
    expect(await db.getCover('c1')).toBeNull()
  })

  it('壁纸记录可写入并读回（Blob 结构化克隆由浏览器负责，fake-indexeddb 不保证）', async () => {
    const db = await freshModules()
    await db.putWallpaper({
      id: 'w1',
      blob: new Blob(['x']),
      type: 'image/png',
      name: 'ok',
      sourcePath: null,
      createdAt: 1,
    })
    const list = await db.allWallpapers()
    expect(list.map((w) => w.id)).toEqual(['w1'])
    await db.deleteWallpaper('w1')
    expect(await db.allWallpapers()).toEqual([])
  })
})

describe('bookmarks', () => {
  it('按书查询并按创建时间排序', async () => {
    const db = await freshModules()
    await db.putBookmark({ ...bookmark('bm2', 'b1'), createdAt: 200 })
    await db.putBookmark({ ...bookmark('bm1', 'b1'), createdAt: 100 })
    await db.putBookmark(bookmark('bm3', 'b2'))
    const list = await db.bookmarksOfBook('b1')
    expect(list.map((b) => b.id)).toEqual(['bm1', 'bm2'])
    expect(await db.allBookmarks()).toHaveLength(3)
  })

  it('删除单本全部书签不影响其它书', async () => {
    const db = await freshModules()
    await db.putBookmark(bookmark('bm1', 'b1'))
    await db.putBookmark(bookmark('bm2', 'b1'))
    await db.putBookmark(bookmark('bm3', 'b2'))
    await db.deleteBookmarksOfBook('b1')
    expect(await db.bookmarksOfBook('b1')).toEqual([])
    expect(await db.bookmarksOfBook('b2')).toHaveLength(1)
  })
})

describe('annotations', () => {
  const anno = (id: string, bookId: string, value: number) => ({
    id,
    bookId,
    type: 'highlight' as const,
    color: 'yellow' as const,
    locator: { kind: 'offset' as const, value, percent: value / 100, updatedAt: 1 },
    endOffset: value + 10,
    chapterTitle: '第一章',
    excerpt: '摘录',
    createdAt: 1,
    updatedAt: 1,
  })

  it('写入后按书查询并按位置排序', async () => {
    const db = await freshModules()
    await db.putAnnotation(anno('a2', 'b1', 60))
    await db.putAnnotation(anno('a1', 'b1', 10))
    await db.putAnnotation(anno('a3', 'b2', 20))
    const list = await db.annotationsOfBook('b1')
    expect(list.map((a) => a.id)).toEqual(['a1', 'a2'])
    expect(await db.allAnnotations()).toHaveLength(3)
  })

  it('删除单条与删除整本', async () => {
    const db = await freshModules()
    await db.putAnnotation(anno('a1', 'b1', 10))
    await db.putAnnotation(anno('a2', 'b1', 20))
    await db.deleteAnnotation('a1')
    expect((await db.annotationsOfBook('b1')).map((a) => a.id)).toEqual(['a2'])
    await db.deleteAnnotationsOfBook('b1')
    expect(await db.annotationsOfBook('b1')).toEqual([])
  })
})

describe('v2 → v3 升级（R1 数据丢失风险）', () => {
  it('老库升级后书籍与书签完整，且新增 annotations 表', async () => {
    // 1) 手工造一个 v2 库（与 v28 线上的结构一致）
    const v2 = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = globalThis.indexedDB.open('moyu-reader', 2)
      req.onupgradeneeded = () => {
        const d = req.result
        d.createObjectStore('books', { keyPath: 'id' })
        d.createObjectStore('covers', { keyPath: 'id' })
        d.createObjectStore('wallpapers', { keyPath: 'id' })
        d.createObjectStore('kv')
        const bm = d.createObjectStore('bookmarks', { keyPath: 'id' })
        bm.createIndex('by-book', 'bookId')
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => reject(req.error)
    })
    await new Promise<void>((resolve, reject) => {
      const tx = v2.transaction(['books', 'bookmarks', 'kv'], 'readwrite')
      tx.objectStore('books').put(book('old1', '老书一'))
      tx.objectStore('books').put(book('old2', '老书二'))
      tx.objectStore('bookmarks').put(bookmark('bm-old', 'old1'))
      tx.objectStore('kv').put({ key: 'seeded', value: true }, 'seeded')
      tx.oncomplete = () => resolve()
      tx.onerror = () => reject(tx.error)
    })
    v2.close()

    // 2) 应用按 v3 打开 → 触发 upgrade（注意：不能换 IDB 实例，否则 v2 库就没了）
    const db = await loadDbModule()
    const handle = await db.getDB()
    expect(handle.version).toBe(3)
    expect(handle.objectStoreNames.contains('annotations')).toBe(true)

    // 3) 旧数据一条不少
    const books = await db.allBooks()
    expect(books.map((b) => b.id).sort()).toEqual(['old1', 'old2'])
    expect(books.map((b) => b.title).sort()).toEqual(['老书一', '老书二'].sort())
    expect(await db.bookmarksOfBook('old1')).toHaveLength(1)
    expect(await db.getKV<boolean>('seeded')).toBe(true)
    // 4) 新表可正常写入
    await db.putAnnotation({
      id: 'new-a',
      bookId: 'old1',
      type: 'note',
      color: 'blue',
      locator: { kind: 'offset', value: 1, percent: 0.01, updatedAt: 1 },
      chapterTitle: '第一章',
      excerpt: 'x',
      createdAt: 1,
      updatedAt: 1,
    })
    expect(await db.annotationsOfBook('old1')).toHaveLength(1)
  })

  it('升级后重复打开不会再次触发建表（幂等）', async () => {
    const db1 = await freshModules()
    await db1.putBook(book('x'))
    const db2 = await loadDbModule()
    const handle = await db2.getDB()
    expect(handle.version).toBe(3)
    expect(await db2.allBooks()).toHaveLength(1)
  })
})
