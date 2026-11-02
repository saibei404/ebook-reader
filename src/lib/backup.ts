/**
 * 数据备份（最小版）：把书架元数据、阅读位置、书签与全部设置导出为单个 JSON。
 *
 * 不含壁纸与封面二进制：壁纸可达数十 MB，封面是程序化生成（可按 coverSeed 重建），
 * 二者放进来会让"轻量快照"变成大文件，反而降低用户备份频率。
 * 换机恢复时：书籍元数据 + 位置 + 设置齐全，重新导入原文件即可继续读。
 */
import { getDB } from './db'
import { nativeApi } from './native'

export interface BackupPayload {
  app: 'moyu-reader'
  /** 备份结构版本（与 IndexedDB 版本解耦，便于以后加字段） */
  schema: number
  exportedAt: number
  dbVersion: number
  books: unknown[]
  kv: { key: string; value: unknown }[]
  bookmarks: unknown[]
}

export const BACKUP_SCHEMA = 1

export async function buildBackup(): Promise<BackupPayload> {
  const db = await getDB()
  const books = await db.getAll('books')
  const kv = await db.getAll('kv')

  // bookmarks 表在 v2 才存在；旧库（v1）读取时跳过，保证导出在任何版本都不炸
  let bookmarks: unknown[] = []
  try {
    if (db.objectStoreNames.contains('bookmarks')) {
      bookmarks = await db.getAll('bookmarks')
    }
  } catch {
    bookmarks = []
  }

  return {
    app: 'moyu-reader',
    schema: BACKUP_SCHEMA,
    exportedAt: Date.now(),
    dbVersion: db.version,
    books,
    kv,
    bookmarks,
  }
}

export interface ExportResult {
  ok: boolean
  path?: string
  canceled?: boolean
  error?: string
  /** 统计，用于 toast 文案 */
  counts?: { books: number; kv: number; bookmarks: number; bytes: number }
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
