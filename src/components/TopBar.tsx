import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'motion/react'
import { useStore } from '@/store/useStore'
import { nativeApi } from '@/lib/native'
import { NumberField } from './NumberFields'
import {
  IconPlus,
  IconImage,
  IconMinus,
  IconSquare,
  IconX,
  IconMoon,
  IconSun,
  IconSearch,
  IconBookmark,
} from './Icons'

function ImportBooksButton() {
  const { addBooksFromFiles, addBooksFromPicked } = useStore()
  const inputRef = useRef<HTMLInputElement>(null)

  const onClick = async () => {
    if (nativeApi) {
      const picked = await nativeApi.pickBooks()
      if (picked && picked.length) await addBooksFromPicked(picked)
      return
    }
    inputRef.current?.click()
  }

  return (
    <>
      <button className="tbtn" onClick={onClick} title="导入本地书籍">
        <IconPlus size={15} />
        <span className="tbtn-text">导入</span>
      </button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".epub,.pdf,.mobi,.azw3,.fb2,.txt,.md,.cbz,.cbr"
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? [])
          if (files.length) void addBooksFromFiles(files)
          e.target.value = ''
        }}
      />
    </>
  )
}

function WallpaperPopover() {
  const { settings, ui, wallpapers, setUI, setSettings, importWallpaperFile, importWallpaperPicked, removeWallpaper } =
    useStore()
  const inputRef = useRef<HTMLInputElement>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const open = ui.wallpaperOpen
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null)

  const openPanel = () => {
    const r = btnRef.current?.getBoundingClientRect()
    if (r) {
      const right = Math.max(12, window.innerWidth - r.right)
      setPos({ top: r.bottom + 10, right })
    }
    setUI({ wallpaperOpen: true })
  }

  // 仅在外层（Esc / 截图参数）打开弹层时补算定位，点击打开走 openPanel
  useEffect(() => {
    if (open && !pos) {
      const r = btnRef.current?.getBoundingClientRect()
      if (r) setPos({ top: r.bottom + 10, right: Math.max(12, window.innerWidth - r.right) })
    }
  }, [open, pos])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return
      setUI({ wallpaperOpen: false })
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open, setUI])

  const onImport = async () => {
    if (nativeApi) {
      const picked = await nativeApi.pickWallpaper()
      if (picked) await importWallpaperPicked(picked)
      return
    }
    inputRef.current?.click()
  }

  const panel = (
    <AnimatePresence>
      {open && pos && (
        <motion.div
          ref={panelRef}
          className={`wp-panel mat-${settings.material}`}
          style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 150 }}
          initial={{ opacity: 0, y: -8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -8, scale: 0.97 }}
          transition={{ type: 'spring', stiffness: 420, damping: 32 }}
        >
      <div className="wp-section">
        <div className="wp-label">我的壁纸</div>
            {wallpapers.map((w) => (
              <div key={w.id} className={`wp-item${settings.wallpaperId === w.id ? ' active' : ''}`}>
                <button
                  className="wp-item-main"
                  onClick={() => void setSettings({ wallpaperId: w.id })}
                  title={w.builtin ? '系统默认壁纸' : w.name}
                >
                  <span className="wp-item-name">{w.name}</span>
                  {/* 内置壁纸：标注来源、不给删除入口（删了也还在，容易让人误解） */}
                  {w.builtin && <span className="wp-badge">系统</span>}
                  {settings.wallpaperId === w.id && <span className="wp-item-check" />}
                </button>
                {!w.builtin && (
                  <button className="wp-item-del" onClick={() => void removeWallpaper(w.id)} title="删除">
                    <span className="wp-item-x" />
                  </button>
                )}
              </div>
            ))}
          </div>

          <div className="wp-actions">
            <button className="tbtn primary" onClick={onImport}>
              <IconImage size={14} />
              <span>导入本地壁纸</span>
            </button>
          </div>

          <div className="wp-section">
            <div className="wp-label">显示模式</div>
            <div className="wp-fit-quick">
              {(['cover', 'contain', 'stretch'] as const).map((f) => (
                <button
                  key={f}
                  className={`chip${settings.wallpaperFit === f ? ' active' : ''}`}
                  onClick={() => void setSettings({ wallpaperFit: f })}
                  title={`${f} 模式`}
                >
                  <span>{f === 'cover' ? '覆盖' : f === 'contain' ? '适应' : '拉伸'}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 全局透明度：一个滑块同时调节书架与 Dock 底纹透明度；细分项在「我的 → 壁纸」 */}
          <div className="wp-section">
            <div className="wp-label">全局透明度</div>
            <div className="wp-opacity-row">
              <input
                type="range"
                min={20}
                max={90}
                value={Math.round(settings.contentOpacity * 100)}
                aria-label="全局透明度"
                onChange={(e) => {
                  const v = Number(e.target.value) / 100
                  void setSettings({ contentOpacity: v, dockOpacity: v })
                }}
              />
              {/* 数字框可直接输入：滑块只能拖个大概，想精确到 55% 得有输入口 */}
              <NumberField
                value={Math.round(settings.contentOpacity * 100)}
                min={20}
                max={90}
                step={1}
                unit="%"
                ariaLabel="全局透明度百分比"
                onChange={(v) => void setSettings({ contentOpacity: v / 100, dockOpacity: v / 100 })}
              />
            </div>
            <div className="wp-label-sub">统一调节书架与 Dock 栏底纹透明度；分别微调请在「我的 → 壁纸」。</div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )

  return (
    <>
      <button
        ref={btnRef}
        className={`tbtn${open ? ' active' : ''}`}
        onClick={() => (open ? setUI({ wallpaperOpen: false }) : openPanel())}
        title="壁纸"
      >
        <IconImage size={15} />
        <span className="tbtn-text">壁纸</span>
      </button>
      {typeof document !== 'undefined' && createPortal(panel, document.body)}
      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,image/heic,image/heif,image/tiff,video/mp4,video/webm"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (f) void importWallpaperFile(f)
          e.target.value = ''
        }}
      />
    </>
  )
}

const PAGE_TITLES: Record<string, string> = {
  library: '书架',
  notes: '笔记',
  profile: '我的',
}

export function TopBar() {
  const { settings, setSettings, books, ui, setUI, toast } = useStore()
  const pageTitle = PAGE_TITLES[ui.tab] ?? '书架'

  return (
    <header className="topbar">
      <div className="topbar-drag">
        <button className="brand-btn" onClick={() => setUI({ tab: 'library' })} title="返回书架首页">
          {/* Logo 仅展示于界面左上方（侧边 Dock 顶部），顶栏只保留页面标题 */}
          <span className="topbar-page">{pageTitle}</span>
          <span className="topbar-count">{books.length} 本</span>
        </button>
      </div>

      <div className="nav-search">
        <IconSearch size={15} />
        <input
          value={ui.search}
          placeholder="搜索书名 / 作者"
          onChange={(e) => setUI({ search: e.target.value })}
        />
      </div>

      <div className="topbar-actions">
        <button
          className="tbtn icon-only"
          onClick={() => toast('书签功能规划中', 'info')}
          title="书签"
        >
          <IconBookmark size={15} />
        </button>
        <ImportBooksButton />
        <WallpaperPopover />
        <button
          className="tbtn icon-only"
          onClick={() => void setSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}
          title="主题"
        >
          {settings.theme === 'dark' ? <IconMoon size={15} /> : <IconSun size={15} />}
        </button>
        <div className="win-controls">
          <button className="wbtn" onClick={() => nativeApi?.windowControl('minimize')} title="最小化">
            <IconMinus />
          </button>
          <button className="wbtn" onClick={() => nativeApi?.windowControl('maximize')} title="最大化">
            <IconSquare />
          </button>
          <button className="wbtn close" onClick={() => nativeApi?.windowControl('close')} title="关闭（隐藏到托盘）">
            <IconX />
          </button>
        </div>
      </div>
    </header>
  )
}
