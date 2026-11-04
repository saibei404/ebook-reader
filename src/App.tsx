import { lazy, Suspense, useEffect, useRef } from 'react'
import { AnimatePresence } from 'motion/react'
import { useStore } from '@/store/useStore'
import { subscribeBookUpdates, subscribeTheme } from '@/reader/locator'
import { nativeApi } from '@/lib/native'
import { setLang } from '@/lib/i18n'
import { WallpaperLayer } from '@/components/WallpaperLayer'
import { TabBar } from '@/components/TabBar'
import { TopBar } from '@/components/TopBar'

import { Toast } from '@/components/Toast'
import { LibraryPage } from '@/pages/LibraryPage'
import { PlaceholderPage } from '@/pages/PlaceholderPage'
import { DropZone } from '@/components/DropZone'

/**
 * 非首屏模块按需加载。
 *
 * 冷启动只需要「书架」：设置页有 30KB 源码（最大单页），笔记页、书籍详情弹层
 * 也只在用户点开时才用到。拆出去能少解析一部分，也让首屏的可执行代码更聚焦。
 * 注意这些页面都是命名导出，lazy 需要转成 default。
 */
const SettingsPage = lazy(() =>
  import('@/pages/SettingsPage').then((m) => ({ default: m.SettingsPage }))
)
const NotesPage = lazy(() => import('@/pages/NotesPage').then((m) => ({ default: m.NotesPage })))
const BookDetail = lazy(() =>
  import('@/components/BookDetail').then((m) => ({ default: m.BookDetail }))
)

export default function App() {
  const { hydrated, hydrate, ui, settings } = useStore()
  const contentRef = useRef<HTMLElement>(null)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  // 非首屏模块空闲预取：书籍详情是 lazy chunk，若等首次点击才加载，
  // 动态 import 会被塞进 View Transition 的 update 回调里——新快照要等网络/磁盘，
  // 表现为「点开详情明显卡一下」。启动后空闲时把 chunk 拉好，点击时就是纯渲染。
  useEffect(() => {
    if (!hydrated) return
    const warm = () => {
      void import('@/components/BookDetail')
      void import('@/pages/SettingsPage')
      void import('@/pages/NotesPage')
    }
    const w = window as Window & { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number }
    let cancel = () => {}
    if (typeof w.requestIdleCallback === 'function') {
      const id = w.requestIdleCallback(warm, { timeout: 2500 })
      cancel = () => w.cancelIdleCallback?.(id)
    } else {
      const t = window.setTimeout(warm, 1200)
      cancel = () => window.clearTimeout(t)
    }
    return cancel
  }, [hydrated])

  // 阅读窗口把进度写回 IndexedDB 后经 BroadcastChannel 通知；此处只更新内存，避免重复读库
  useEffect(() => {
    const off = subscribeBookUpdates(({ bookId, percent, locator }) => {
      useStore.setState((s) => ({
        books: s.books.map((b) =>
          b.id === bookId ? { ...b, progress: percent, locator, lastReadAt: locator.updatedAt } : b
        ),
      }))
    })
    return off
  }, [])

  // 阅读窗口里换了主题 → 主窗口跟随（否则回到书架还是旧配色，像两个软件）
  useEffect(() => {
    const off = subscribeTheme((theme) => {
      const s = useStore.getState()
      if (s.settings.theme !== theme) void s.setSettings({ theme })
    })
    return off
  }, [])

  // 阅读窗口崩溃：主窗口提示并可重开（阅读窗独立进程，主窗口不受影响）
  useEffect(() => {
    if (!nativeApi?.onReaderCrashed) return
    const off = nativeApi.onReaderCrashed(() => {
      useStore.getState().toast('阅读窗口异常退出，位置已保存，可重新打开', 'err')
    })
    return off
  }, [])

  useEffect(() => {
    document.documentElement.dataset.nativeAcrylic =
      settings.nativeAcrylic && settings.material === 'acrylic' ? '1' : '0'
  }, [settings.nativeAcrylic, settings.material])

  // 界面语言 → i18n 模块（词典缺条目时回退 zh-CN）
  useEffect(() => {
    setLang(settings.lang)
  }, [settings.lang])

  // 截图测试：?scroll=1 时把内容区滚动到液态玻璃触发阈值以下之外
  useEffect(() => {
    if (!hydrated) return
    if (new URLSearchParams(location.search).get('scroll') !== '1') return
    const t = setTimeout(() => {
      if (contentRef.current) contentRef.current.scrollTop = 320
    }, 400)
    return () => clearTimeout(t)
  }, [hydrated])

  // Esc 返回上级界面（层级栈）：输入框失焦 → 关壁纸弹层 → 退封面编辑 → 关书籍详情 → 回书架
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const ae = document.activeElement
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) {
        ;(ae as HTMLElement).blur()
        return
      }
      const s = useStore.getState()
      if (s.ui.wallpaperOpen) {
        s.setUI({ wallpaperOpen: false })
        return
      }
      if (s.ui.coverEditing) {
        s.setUI({ coverEditing: false })
        return
      }
      if (s.ui.selectedId) {
        s.openBook(null)
        return
      }
      if (s.ui.tab !== 'library') {
        s.setUI({ tab: 'library' })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // 截图测试：?injectwp=1 时注入一张程序化测试壁纸，验证底纹叠加渲染
  useEffect(() => {
    if (!hydrated) return
    if (new URLSearchParams(location.search).get('injectwp') !== '1') return
    const c = document.createElement('canvas')
    c.width = 960
    c.height = 600
    const ctx = c.getContext('2d')
    if (!ctx) return
    const g = ctx.createLinearGradient(0, 0, 960, 600)
    g.addColorStop(0, '#0ea5e9')
    g.addColorStop(0.5, '#8b5cf6')
    g.addColorStop(1, '#f43f5e')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 960, 600)
    ctx.fillStyle = 'rgba(255,255,255,0.5)'
    for (let i = 0; i < 12; i++) {
      ctx.beginPath()
      ctx.arc(Math.random() * 960, Math.random() * 600, 40 + Math.random() * 90, 0, Math.PI * 2)
      ctx.fill()
    }
    c.toBlob((blob) => {
      if (blob) {
        void useStore.getState().importWallpaperFile(new File([blob], 'test-texture.png', { type: 'image/png' }))
      }
    }, 'image/png')
  }, [hydrated])

  if (!hydrated) {
    return <div className="boot">墨鱼阅读器 · 启动中…</div>
  }

  return (
    <div className="app-root">
      <WallpaperLayer />
      <div className="app-shell">
        <TabBar />
        <div className="app-main">
          <TopBar />
          <main className="app-content" ref={contentRef}>
            {/* 首屏只加载书架；切页时短暂留白用骨架兜住，避免布局塌陷 */}
            <Suspense fallback={<div className="page-suspense" />}>
              {ui.tab === 'library' ? (
                <LibraryPage />
              ) : ui.tab === 'profile' ? (
                <SettingsPage />
              ) : ui.tab === 'notes' ? (
                <NotesPage />
              ) : (
                <PlaceholderPage tab={ui.tab} />
              )}
            </Suspense>
          </main>
        </div>
      </div>
      <AnimatePresence>
        {ui.selectedId && (
          <Suspense fallback={null}>
            <BookDetail />
          </Suspense>
        )}
      </AnimatePresence>
      {/* 拖拽导入：挂在应用根上，任何页面都能拖入 */}
      <DropZone />
      <Toast />
    </div>
  )
}
