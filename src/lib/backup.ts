/**
 * 数据备份：导出 / 导入（合并去重）。
 *
 * 取舍：不含壁纸与封面二进制——壁纸可达数十 MB，封面是程序化生成（可按 coverSeed 重建），
 * 二者放进来会让「轻量快照」变成大文件，反而降低用户备份频率。
 * 换机恢复时：书籍元数据 + 位置 + 书签 + 笔记 + 设置齐全，重新导入原文件即可继续读。
 *
 * 合并策略（导入不能在用户现有数据上乱写）：
 * - 书籍：先按 id，再按「书名 + 大小」判为同一本；命中则复用现有 id，
 *   并保留 lastReadAt 更新的那份（不把已读到第 10 章的位置覆盖回第 2 章）；
 * - 书签/笔记：按「书 + 位置 + 摘录」去重，id 冲突但内容不同则分配新 id；
 * - 设置/其它 kv：导入值覆盖当前值，但 `seeded`（示例书已播种）保持当前。
 */
import { getDB } from './db'
import { nativeApi } from './native'
import type { Annotation, Book, Bookmark } from '@/types/book'

export const BACKUP_SCHEMA = 2
/** 仍然能读的最老备份结构（v1 没有 annotations 字段） */
export const MIN_SUPPORTED_SCHEMA = 1

export interface BackupPayload {
  app: 'moyu-reader'
  /** 备份结构版本（与 IndexedDB 版本解耦，便于以后加字段） */
  schema: number
  exportedAt: number
  dbVersion: number
  books: Book[]
  kv: { key: string; value: unknown }[]
  bookmarks: Bookmark[]
  /** v2 新增：高亮 / 笔记 */
  annotations: Annotation[]
}

export async function buildBackup(): Promise<BackupPayload> {
  const db = await getDB()
  const books = await db.getAll('books')
  const kv = await db.getAll('kv')

  // 旧库（v1/v2）缺表时跳过，保证导出在任何版本都不炸
  const safeGetAll = async <T>(store: 'bookmarks' | 'annotations'): Promise<T[]> => {
    try {
      if (!db.objectStoreNames.contains(store)) return []
      return (await db.getAll(store)) as T[]
    } catch {
      return []
    }
  }
  const bookmarks = await safeGetAll<Bookmark>('bookmarks')
  const annotations = await safeGetAll<Annotation>('annotations')

  return {
    app: 'moyu-reader',
    schema: BACKUP_SCHEMA,
    exportedAt: Date.now(),
    dbVersion: db.version,
    books,
    kv,
    bookmarks,
    annotations,
  }
}

export interface ExportResult {
  ok: boolean
  path?: string
  canceled?: boolean
  error?: string
  /** 统计，用于 toast 文案 */
  counts?: { books: number; kv: number; bookmarks: number; annotations: number; bytes: number }
}

export async function exportBackup(): Promise<ExportResult> {
  const data = await buildBackup()
  const json = JSON.stringify(data, null, 2)
  const d = new Date()
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`
  const name = `moyu-backup-${stamp}.json`
  const counts = {
    books: data.books.length,
    kv: data.kv.length,
    bookmarks: data.bookmarks.length,
    annotations: data.annotations.length,
    bytes: new Blob([json]).size,
  }

  if (nativeApi?.saveTextFile) {
    const r = await nativeApi.saveTextFile(name, json)
    return { ...r, counts }
  }

  // Web 降级：直接触发下载
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
  return { ok: true, counts }
}

/* ---------------- 导入 ----------------
 * 以下是纯函数：不碰 IndexedDB，便于单测（P3 覆盖「重复导入不产生重复书」等场景）。
 */

export interface BackupSnapshot {
  books: Book[]
  bookmarks: Bookmark[]
  annotations: Annotation[]
  kv: { key: string; value: unknown }[]
}

export interface MergeStats {
  addedBooks: number
  mergedBooks: number
  /** 因 id 冲突/内容重复而跳过的条目 */
  skippedBookmarks: number
  addedBookmarks: number
  addedAnnotations: number
  addedKV: number
}

export interface MergeResult extends BackupSnapshot {
  stats: MergeStats
}

function sameBook(a: Book, b: Book): boolean {
  if (a.id === b.id) return true
  return !!a.title && a.title === b.title && a.size === b.size
}

/** 位置去重键：同一本书里「同类型 + 同值 + 同终点」视为同一条 */
function anchorKey(bookId: string, loc: { kind: string; value: string | number }, end?: number | string): string {
  return `${bookId}|${loc.kind}|${String(loc.value)}|${end ?? ''}`
}

export function mergeBackup(current: BackupSnapshot, incoming: BackupSnapshot): MergeResult {
  const stats: MergeStats = {
    addedBooks: 0,
    mergedBooks: 0,
    skippedBookmarks: 0,
    addedBookmarks: 0,
    addedAnnotations: 0,
    addedKV: 0,
  }
  const books = [...current.books]
  /** incoming 书 id → 最终 id */
  const idMap = new Map<string, string>()

  for (const inc of incoming.books) {
    const hit = books.find((b) => sameBook(b, inc))
    if (!hit) {
      books.push(inc)
      idMap.set(inc.id, inc.id)
      stats.addedBooks++
      continue
    }
    idMap.set(inc.id, hit.id)
    stats.mergedBooks++
    // 保留读得更晚的那份进度/位置，但不丢封面与元数据补充
    const incNewer = (inc.lastReadAt ?? 0) > (hit.lastReadAt ?? 0)
    if (incNewer) {
      const idx = books.findIndex((b) => b.id === hit.id)
      books[idx] = {
        ...hit,
        progress: Math.max(hit.progress ?? 0, inc.progress ?? 0),
        locator: inc.locator ?? hit.locator,
        lastReadAt: inc.lastReadAt,
        coverSeed: inc.coverSeed ?? hit.coverSeed,
        sourcePath: inc.sourcePath ?? hit.sourcePath,
      }
    }
  }

  // 书签去重
  const bmKeys = new Set(current.bookmarks.map((b) => anchorKey(b.bookId, b.locator)))
  const bookmarks = [...current.bookmarks]
  for (const b of incoming.bookmarks) {
    const bookId = idMap.get(b.bookId) ?? b.bookId
    const key = anchorKey(bookId, b.locator)
    if (bmKeys.has(key)) {
      stats.skippedBookmarks++
      continue
    }
    bmKeys.add(key)
    bookmarks.push({ ...b, bookId, id: current.bookmarks.some((x) => x.id === b.id) ? `${b.id}-i${bookmarks.length}` : b.id })
    stats.addedBookmarks++
  }

  // 笔记去重（文本类看 endOffset，EPUB 看 cfiRange）
  const anKeys = new Set(
    current.annotations.map((a) => anchorKey(a.bookId, a.locator, a.endOffset ?? a.cfiRange))
  )
  const annotations = [...current.annotations]
  for (const a of incoming.annotations) {
    const bookId = idMap.get(a.bookId) ?? a.bookId
    const key = anchorKey(bookId, a.locator, a.endOffset ?? a.cfiRange)
    if (anKeys.has(key)) continue
    anKeys.add(key)
    annotations.push({
      ...a,
      bookId,
      id: current.annotations.some((x) => x.id === a.id) ? `${a.id}-i${annotations.length}` : a.id,
    })
    stats.addedAnnotations++
  }

  // 设置：导入值覆盖，但 seeded 必须保留当前（否则已删空的示例书可能复活）
  const kvMap = new Map(current.kv.map((r) => [r.key, r.value]))
  for (const r of incoming.kv) {
    if (r.key === 'seeded') continue
    kvMap.set(r.key, r.value)
    stats.addedKV++
  }
  const kv = Array.from(kvMap, ([key, value]) => ({ key, value }))

  return { books, bookmarks, annotations, kv, stats }
}

/** 解析 + 结构校验（不依赖 DOM，可在单测里直接喂字符串） */
export function parseBackup(text: string): { ok: true; data: BackupPayload } | { ok: false; error: string } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: '不是有效的 JSON 文件' }
  }
  if (!raw || typeof raw !== 'object') return { ok: false, error: '备份内容为空' }
  const o = raw as Partial<BackupPayload>
  if (o.app !== 'moyu-reader') return { ok: false, error: '不是墨鱼阅读器的备份文件' }
  const schema = Number(o.schema ?? 0)
  if (!Number.isFinite(schema) || schema < MIN_SUPPORTED_SCHEMA) {
    return { ok: false, error: `备份版本过旧（schema=${o.schema}）` }
  }
  if (schema > BACKUP_SCHEMA) {
    return { ok: false, error: `备份来自更新的版本（schema=${schema}），请先升级阅读器` }
  }
  if (!Array.isArray(o.books)) return { ok: false, error: '备份缺少书籍列表' }
  return {
    ok: true,
    data: {
      app: 'moyu-reader',
      schema,
      exportedAt: Number(o.exportedAt ?? 0),
      dbVersion: Number(o.dbVersion ?? 0),
      books: o.books as Book[],
      kv: Array.isArray(o.kv) ? (o.kv as { key: string; value: unknown }[]) : [],
      bookmarks: Array.isArray(o.bookmarks) ? (o.bookmarks as Bookmark[]) : [],
      annotations: Array.isArray(o.annotations) ? (o.annotations as Annotation[]) : [],
    },
  }
}

export interface ImportResult {
  ok: boolean
  canceled?: boolean
  error?: string
  stats?: MergeStats
  total?: { books: number; bookmarks: number; annotations: number }
}

/** 读取当前库 → 合并 → 落库 */
export async function importBackup(text: string): Promise<ImportResult> {
  const parsed = parseBackup(text)
  if (!parsed.ok) return { ok: false, error: parsed.error }

  const db = await getDB()
  const current: BackupSnapshot = {
    books: await db.getAll('books'),
    bookmarks: db.objectStoreNames.contains('bookmarks') ? await db.getAll('bookmarks') : [],
    annotations: db.objectStoreNames.contains('annotations') ? await db.getAll('annotations') : [],
    kv: await db.getAll('kv'),
  }
  const merged = mergeBackup(current, {
    books: parsed.data.books,
    bookmarks: parsed.data.bookmarks,
    annotations: parsed.data.annotations,
    kv: parsed.data.kv,
  })

  const tx1 = db.transaction('books', 'readwrite')
  await Promise.all([...merged.books.map((b) => tx1.store.put(b)), tx1.done])
  const tx2 = db.transaction('bookmarks', 'readwrite')
  await Promise.all([...merged.bookmarks.map((b) => tx2.store.put(b)), tx2.done])
  const tx3 = db.transaction('annotations', 'readwrite')
  await Promise.all([...merged.annotations.map((a) => tx3.store.put(a)), tx3.done])
  const tx4 = db.transaction('kv', 'readwrite')
  await Promise.all([...merged.kv.map((r) => tx4.store.put(r, r.key)), tx4.done])

  return {
    ok: true,
    stats: merged.stats,
    total: {
      books: merged.books.length,
      bookmarks: merged.bookmarks.length,
      annotations: merged.annotations.length,
    },
  }
}
