/**
 * 阅读位置持久化 + 跨窗口同步。
 *
 * 数据流：渲染器上报 locator → 本模块节流（1.2s）写入 IndexedDB books →
 * BroadcastChannel 广播 → 主窗口书架刷新圆环与进度。
 *
 * 选择 IndexedDB 直连而非 IPC：阅读窗口与主窗口同源（file:// 或 dev localhost），
 * 共享同一 store，读写无需主进程中转，离线亦可用。
 */
import type { Locator } from '@/types/book'
import { putBook, allBooks } from '@/lib/db'

const CHANNEL = 'moyu-reader-sync'

export function broadcastBookUpdate(bookId: string, percent: number, locator: Locator): void {
  try {
    const ch = new BroadcastChannel(CHANNEL)
    ch.postMessage({ type: 'book-updated', bookId, percent, locator })
    ch.close()
  } catch {
    /* BroadcastChannel 不可用时静默降级（下次打开主窗口仍能从 IDB 读到） */
  }
}

/** 在主窗口侧监听阅读窗口的进度更新 */
export function subscribeBookUpdates(
  cb: (payload: { bookId: string; percent: number; locator: Locator }) => void
): () => void {
  try {
    const ch = new BroadcastChannel(CHANNEL)
    const h = (e: MessageEvent) => {
      const d = e.data
      if (d && d.type === 'book-updated' && typeof d.bookId === 'string') cb(d)
    }
    ch.addEventListener('message', h)
    return () => {
      ch.removeEventListener('message', h)
      ch.close()
    }
  } catch {
    return () => {}
  }
}

/**
 * 位置保存器：节流 + 立即刷盘（退出/隐藏前调用 flush，保证不丢位置）。
 */
export function createLocatorSaver(bookId: string) {
  let pending: { locator: Locator; percent: number } | null = null
  let timer: number | null = null
  let writing = false

  const write = async () => {
    if (!pending || writing) return
    const { locator, percent } = pending
    pending = null
    writing = true
    try {
      const books = await allBooks()
      const target = books.find((b) => b.id === bookId)
      if (target) {
        await putBook({
          ...target,
          locator,
          progress: percent,
          lastReadAt: Date.now(),
        })
        broadcastBookUpdate(bookId, percent, locator)
      }
    } catch (e) {
      console.warn('[reader] 保存阅读位置失败', e)
    } finally {
      writing = false
    }
  }

  return {
    push(locator: Locator, percent: number) {
      pending = { locator, percent: Math.min(1, Math.max(0, percent)) }
      if (timer) window.clearTimeout(timer)
      timer = window.setTimeout(() => {
        timer = null
        void write()
      }, 1200)
    },
    async flush() {
      if (timer) {
        window.clearTimeout(timer)
        timer = null
      }
      await write()
    },
  }
}
