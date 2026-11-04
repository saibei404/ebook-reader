import { flushSync } from 'react-dom'
import { useStore } from '@/store/useStore'

/**
 * 原生 View Transitions 封装（Chromium 111+，本项目 Electron 45 = Chromium 156）。
 *
 * 为什么用它而不是再加一个动画库：列表/页面切换这种「旧状态 → 新状态」的过渡，
 * 浏览器能直接对比两棵快照树做形变（含共享元素），比手写 enter/exit 更连贯，
 * 而且零依赖、零 JS 逐帧计算——只多一次合成层快照。
 *
 * 三条降级路径（任一命中就走同步更新，完全不影响功能）：
 *   1. 环境不支持 startViewTransition；
 *   2. 用户开了「减少动态效果」（prefers-reduced-motion）；
 *   3. 应用内动效设置为 none。
 */

type DocWithVT = Document & {
  startViewTransition?: (cb: () => void | Promise<void>) => {
    ready: Promise<void>
    finished: Promise<void>
    updateCallbackDone: Promise<void>
    skipTransition: () => void
  }
}

export function viewTransitionSupported(): boolean {
  return typeof document !== 'undefined' && typeof (document as DocWithVT).startViewTransition === 'function'
}

function motionAllowed(): boolean {
  if (!viewTransitionSupported()) return false
  if (typeof window === 'undefined') return false
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false
  // 应用内动效模式（flip/stack/fade…）都允许过渡；用户若把系统动效关掉，上面已拦
  return true
}

/**
 * 把一次状态更新包进视图过渡。
 *
 * 必须 `flushSync`：zustand 的通知是异步批处理的，不强制同步提交的话，
 * 浏览器拍「新快照」时 DOM 还没更新，过渡就会拍成两张一样的图（表现为没动画）。
 */
export function withViewTransition(update: () => void): void {
  if (!motionAllowed()) {
    update()
    return
  }
  const doc = document as DocWithVT
  // 注意：ViewTransition 上的 types 只能通过构造参数传，实例属性是只读的
  // （写成 t.types = … 会抛 "Cannot set property types"，而且异常会顺着
  //  update 回调冒出来，把这次状态更新一起废掉，表现为"点了没反应"）。
  try {
    const t = doc.startViewTransition!(() => {
      flushSync(update)
    })
    // 连续快速点击会「跳过上一段过渡」，这是浏览器的正常行为，但 ready/finished
    // 会以 AbortError reject；不接住会变成 unhandledrejection 刷控制台。
    t.ready.catch(() => {})
    t.finished.catch(() => {})
  } catch {
    // 过渡起不来不能影响功能本身
    update()
  }
}

/** 打开详情时是否走「封面形变」——BookDetail 据此跳过自己的翻卡入场 */
let bookMorph = false
export function vtMorphActive(): boolean {
  return bookMorph
}

/**
 * 书架 → 详情：共享元素过渡。
 *
 * 做法是给被点卡片的封面临时挂上 `view-transition-name: book-cover`，
 * 再在同一次更新里把它摘掉、把详情挂上同名封面——
 * 浏览器就会把「旧快照里的卡片封面」和「新快照里的详情封面」当成同一个元素做形变。
 * 名字必须唯一：如果卡片和详情同时带这个名字，过渡会直接中止。
 */
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
    // 过渡结束（或被跳过）后还原标记，后续普通打开仍用翻卡动画
    window.setTimeout(() => {
      bookMorph = false
    }, 420)
  }
}
