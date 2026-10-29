import { useEffect, useRef } from 'react'
import { AnimatePresence } from 'motion/react'
import { useStore } from '@/store/useStore'
import { WallpaperLayer } from '@/components/WallpaperLayer'
import { TabBar } from '@/components/TabBar'
import { TopBar } from '@/components/TopBar'
import { BookDetail } from '@/components/BookDetail'
import { Toast } from '@/components/Toast'
import { LibraryPage } from '@/pages/LibraryPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { PlaceholderPage } from '@/pages/PlaceholderPage'

export default function App() {
  const { hydrated, hydrate, ui, settings } = useStore()
  const contentRef = useRef<HTMLElement>(null)

  useEffect(() => {
    void hydrate()
  }, [hydrate])

  useEffect(() => {
    document.documentElement.dataset.nativeAcrylic =
      settings.nativeAcrylic && settings.material === 'acrylic' ? '1' : '0'
  }, [settings.nativeAcrylic, settings.material])

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
            {ui.tab === 'library' ? (
              <LibraryPage />
            ) : ui.tab === 'profile' ? (
              <SettingsPage />
            ) : (
              <PlaceholderPage tab={ui.tab} />
            )}
          </main>
        </div>
      </div>
      <AnimatePresence>{ui.selectedId && <BookDetail />}</AnimatePresence>
      <Toast />
    </div>
  )
}
