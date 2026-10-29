import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Book } from '@/types/book'

export interface CoverRec {
  id: string
  dataUrl: string
  createdAt: number
}

export interface WallpaperRec {
  id: string
  blob: Blob
  type: string
  name: string
  sourcePath: string | null
  createdAt: number
}

interface MoyuDB extends DBSchema {
  books: { key: string; value: Book }
  covers: { key: string; value: CoverRec }
  wallpapers: { key: string; value: WallpaperRec }
  kv: { key: string; value: { key: string; value: unknown } }
}

let dbp: Promise<IDBPDatabase<MoyuDB>> | null = null

export function getDB(): Promise<IDBPDatabase<MoyuDB>> {
  if (!dbp) {
    dbp = openDB<MoyuDB>('moyu-reader', 1, {
      upgrade(db) {
        db.createObjectStore('books', { keyPath: 'id' })
        db.createObjectStore('covers', { keyPath: 'id' })
        db.createObjectStore('wallpapers', { keyPath: 'id' })
        db.createObjectStore('kv')
      },
    })
  }
  return dbp
}

export async function allBooks(): Promise<Book[]> {
  const db = await getDB()
  return db.getAll('books')
}

export async function putBook(book: Book): Promise<void> {
  const db = await getDB()
  await db.put('books', book)
}

export async function deleteBook(id: string): Promise<void> {
  const db = await getDB()
  await db.delete('books', id)
}

export async function putCover(rec: CoverRec): Promise<string> {
  const db = await getDB()
  await db.put('covers', rec)
  return rec.id
}

export async function getCover(id: string): Promise<string | null> {
  const db = await getDB()
  const rec = await db.get('covers', id)
  return rec ? rec.dataUrl : null
}

export async function deleteCover(id: string): Promise<void> {
  const db = await getDB()
  await db.delete('covers', id)
}

export async function putWallpaper(rec: WallpaperRec): Promise<string> {
  const db = await getDB()
  await db.put('wallpapers', rec)
  return rec.id
}

export async function allWallpapers(): Promise<WallpaperRec[]> {
  const db = await getDB()
  return db.getAll('wallpapers')
}

/** 清理损坏的壁纸记录（blob 缺失/非 Blob），返回被清理的 id 列表 */
export async function pruneBrokenWallpapers(): Promise<string[]> {
  const db = await getDB()
  const recs = await db.getAll('wallpapers')
  const broken = recs.filter((r) => !(r.blob instanceof Blob) || r.blob.size === 0).map((r) => r.id)
  for (const id of broken) await db.delete('wallpapers', id)
  return broken
}

export async function deleteWallpaper(id: string): Promise<void> {
  const db = await getDB()
  await db.delete('wallpapers', id)
}

export async function getKV<T>(key: string): Promise<T | null> {
  const db = await getDB()
  const rec = await db.get('kv', key)
  return rec ? (rec.value as T) : null
}

export async function setKV(key: string, value: unknown): Promise<void> {
  const db = await getDB()
  // kv store 无 keyPath（out-of-line keys），put 必须显式传 key
  await db.put('kv', { key, value }, key)
}
