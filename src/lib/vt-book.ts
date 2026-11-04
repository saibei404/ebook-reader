import { useStore } from '@/store/useStore'
import { motionAllowed, withViewTransition } from './vt'

/**
 * 书架 → 详情的**共享元素**过渡（只有主窗口会用到，所以单独成模块，
 * 避免阅读窗口为了一个过渡把整个 store 打进包里）。
 *
 * 做法：给被点卡片的封面临时挂 `view-transition-name: book-cover`，
 * 再在同一次更新里把它摘掉、并打开详情（详情封面同名）——
 * 浏览器就会把「旧快照的卡片封面」和「新快照的详情封面」当成同一个元素做形变。
 * 名字必须唯一：两处同时带这个名字会让过渡直接中止。
 */
let bookMorph = false

/** 详情挂载时读一次：走形变时跳过它自己的翻卡入场，否则两个动画会叠 */
export function vtMorphActive(): boolean {
  return bookMorph
}

export function openBookWithCover(bookId: string, cardEl: HTMLElement | null): void {
  const open = useStore.getState().openBook
  const cover = (cardEl?.querySelector('.book-cover img, .book-cover, img') as HTMLElement | null) ?? null
  if (!cover || !motionAllowed()) {
    open(bookId)
    return
  }
  const prev = cover.style.viewTransitionName
  cover.style.viewTransitionName = 'book-cover'
  bookMorph = true
  try {
    withViewTransition(() => {
      // 旧快照已经拍完（此刻卡片封面带名字），更新里摘掉，避免与新快照的详情封面重名
      cover.style.viewTransitionName = prev
      open(bookId)
    })
  } finally {
    window.setTimeout(() => {
      bookMorph = false
    }, 420)
  }
}
