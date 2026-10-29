import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Book, Locator } from '@/types/book'
import { allBooks, getKV } from '@/lib/db'
import { nativeApi } from '@/lib/native'
import { createLocatorSaver } from './locator'
import { decodeText, splitPlainText, markdownToHtml, fb2ToChapters, type Chapter } from './text-utils'
import { TextReader } from './formats/TextReader'
import { DEFAULT_PREFS, FONT_STACK, loadPrefs, savePrefs, themeColors, type ReaderPrefs } from './reader-prefs'
import './reader.css'

// 重引擎按格式懒加载：TXT/FB2 用户不会为 epub.js / pdf.js 付出首屏成本
const EpubReader = lazy(() => import('./formats/EpubReader').then((m) => ({ default: m.EpubReader })))
const PdfReader = lazy(() => import('./formats/PdfReader').then((m) => ({ default: m.PdfReader })))
const ComicReader = lazy(() => import('./formats/ComicReader').then((m) => ({ default: m.ComicReader })))

type Phase = 'loading' | 'ready' | 'error'

const UNSUPPORTED: Record<string, string> = {
  mobi: 'MOBI 为 Kindle 私有容器，当前版本不支持直接解析',
  azw3: 'AZW3（KF8）为 Kindle 私有容器，当前版本不支持直接解析',
  cbr: 'CBR 为 RAR 压缩包，需先转换为 CBZ',
  unknown: '无法识别该文件格式',
}

export function ReaderApp() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [error, setError] = useState('')
  const [book, setBook] = useState<Book | null>(null)
  const [data, setData] = useState<ArrayBuffer | null>(null)
  const [chapters, setChapters] = useState<Chapter[] | null>(null)
  const [prefs, setPrefs] = useState<ReaderPrefs>(DEFAULT_PREFS)
  const [percent, setPercent] = useState(0)
  const [label, setLabel] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tocOpen, setTocOpen] = useState(false)
  const [toc, setToc] = useState<{ label: string; href: string; depth: number }[]>([])
  const [toolbarVisible, setToolbarVisible] = useState(true)
  const [systemDark, setSystemDark] = useState(false)
  const [pagesInfo, setPagesInfo] = useState<{ pages: number } | null>(null)

  const saverRef = useRef<ReturnType<typeof createLocatorSaver> | null>(null)
  const hideTimer = useRef<number | null>(null)

  const bookId = useMemo(() => new URLSearchParams(location.search).get('bookId') ?? '', [])

  /* ---------- 载入书籍与偏好 ---------- */
  useEffect(() => {
    let disposed = false
    void (async () => {
      try {
        const [prefsLoaded, themeKV] = await Promise.all([loadPrefs(), getKV<{ theme?: string }>('settings')])
        if (disposed) return
        setPrefs(prefsLoaded)
        setSystemDark((themeKV?.theme ?? 'dark') === 'dark')

        const books = await allBooks()
        let target = books.find((b) => b.id === bookId)

        // 自动化验证钩子：?testpath=<绝对路径> 时按扩展名建临时书目并落库，
        // 走与真实书完全一致的渲染/定位/持久化链路（生产环境无此参数不生效）
        const testPath = new URLSearchParams(location.search).get('testpath')
        if (!target && testPath) {
          const { formatFromName } = await import('@/types/book')
          const fmt0 = formatFromName(testPath)
          target = {
            id: `testbook-${fmt0}`,
            title: `测试样书 ${fmt0.toUpperCase()}`,
            author: '自动化验证',
            format: fmt0,
            addedAt: Date.now(),
            lastReadAt: Date.now(),
            progress: 0,
            locator: null,
            coverId: null,
            coverSeed: 1234,
            shelfId: null,
            size: 0,
            sourcePath: testPath,
            description: '',
          }
          const { putBook } = await import('@/lib/db')
          await putBook(target)
        }
        if (!target) {
          setError('找不到这本书（可能已被移除）')
          setPhase('error')
          return
        }
        setBook(target)
        setPercent(target.locator?.percent ?? target.progress ?? 0)
        saverRef.current = createLocatorSaver(target.id)

        const fmt = target.format
        if (UNSUPPORTED[fmt]) {
          setError(`${UNSUPPORTED[fmt]}。建议先转换为 EPUB / TXT / PDF 再导入。`)
          setPhase('error')
          return
        }
        if (!target.sourcePath) {
          setError('这本书没有关联的本地文件（示例书籍或已移动的文件）。请在书架重新导入原始文件。')
          setPhase('error')
          return
        }
        if (!nativeApi?.readBook) {
          setError('当前环境不支持读取本地文件（请使用桌面客户端）')
          setPhase('error')
          return
        }

        const res = await nativeApi.readBook(target.sourcePath)
        if (disposed) return
        if (!res.ok || !res.data) {
          setError(res.error ?? '读取文件失败')
          setPhase('error')
          return
        }
        setData(res.data)

        // 文本类格式在此完成预处理；EPUB/PDF/漫画交给各自渲染器
        if (fmt === 'txt' || fmt === 'md' || fmt === 'fb2') {
          if (fmt === 'fb2') {
            setChapters(fb2ToChapters(res.data))
          } else {
            const { text } = decodeText(res.data)
            setChapters(fmt === 'md' ? mdToChapters(text) : splitPlainText(text))
          }
        }
        setPhase('ready')
      } catch (e) {
        if (!disposed) {
          setError(`打开失败：${String((e as Error)?.message ?? e)}`)
          setPhase('error')
        }
      }
    })()
    return () => {
      disposed = true
    }
  }, [bookId])

  /* ---------- 位置上报 ---------- */
  const onLocate = useCallback((loc: Locator) => {
    setPercent(loc.percent)
    if (loc.label) setLabel(loc.label)
    saverRef.current?.push(loc, loc.percent)
  }, [])

  /* ---------- 退出前刷盘（保证位置不丢） ---------- */
  const exit = useCallback(async () => {
    await saverRef.current?.flush()
    if (nativeApi?.closeReader) nativeApi.closeReader()
    else window.close()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (settingsOpen) {
          setSettingsOpen(false)
          return
        }
        if (tocOpen) {
          setTocOpen(false)
          return
        }
        void exit()
        return
      }
      // 字号快捷调整
      if ((e.ctrlKey || e.metaKey) && (e.key === '=' || e.key === '+')) {
        e.preventDefault()
        setPrefs((p) => {
          const next = { ...p, fontSize: Math.min(34, p.fontSize + 1) }
          void savePrefs(next)
          return next
        })
      }
      if ((e.ctrlKey || e.metaKey) && e.key === '-') {
        e.preventDefault()
        setPrefs((p) => {
          const next = { ...p, fontSize: Math.max(13, p.fontSize - 1) }
          void savePrefs(next)
          return next
        })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [exit, settingsOpen, tocOpen])

  // 页面隐藏/关闭前刷盘（摸鱼热键隐藏时也要保住位置）
  useEffect(() => {
    const onHide = () => void saverRef.current?.flush()
    window.addEventListener('beforeunload', onHide)
    document.addEventListener('visibilitychange', onHide)
    return () => {
      window.removeEventListener('beforeunload', onHide)
      document.removeEventListener('visibilitychange', onHide)
    }
  }, [])

  // 鼠标移到顶部/底部自动露出工具栏
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const nearEdge = e.clientY < 70 || e.clientY > window.innerHeight - 60
      if (nearEdge) {
        setToolbarVisible(true)
        if (hideTimer.current) window.clearTimeout(hideTimer.current)
      } else {
        if (hideTimer.current) window.clearTimeout(hideTimer.current)
        hideTimer.current = window.setTimeout(() => setToolbarVisible(false), 1600)
      }
    }
    window.addEventListener('mousemove', onMove)
    const t = window.setTimeout(() => setToolbarVisible(false), 2600)
    return () => {
      window.removeEventListener('mousemove', onMove)
      if (hideTimer.current) window.clearTimeout(hideTimer.current)
      window.clearTimeout(t)
    }
  }, [])

  const colors = useMemo(() => themeColors(prefs.theme, systemDark), [prefs.theme, systemDark])

  const updatePrefs = (patch: Partial<ReaderPrefs>) => {
    setPrefs((p) => {
      const next = { ...p, ...patch }
      void savePrefs(next)
      return next
    })
  }

  /* ---------- 渲染 ---------- */
  const fmt = book?.format ?? 'unknown'

  return (
    <div
      className={`reader-root${toolbarVisible ? ' toolbar-visible' : ''}`}
      style={
        {
          '--r-bg': colors.bg,
          '--r-fg': colors.fg,
          '--r-sub': colors.sub,
          '--r-line': systemDark || prefs.theme === 'night' ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)',
          '--r-glass': systemDark || prefs.theme === 'night' ? 'rgba(32,32,36,0.86)' : 'rgba(255,255,255,0.82)',
        } as React.CSSProperties
      }
    >
      {/* 顶部栏 */}
      <div className="reader-top">
        <button className="rb" onClick={() => void exit()} title="返回书架（Esc）">
          ← 书架
        </button>
        <div className="reader-title">{book?.title ?? '加载中…'}</div>
        <div className="reader-sub">
          {label || (pagesInfo ? `${pagesInfo.pages} 页` : '')} · {Math.round(percent * 100)}%
        </div>
        {toc.length > 0 && (
          <button className={`rb${tocOpen ? ' active' : ''}`} onClick={() => setTocOpen((v) => !v)} title="目录">
            目录
          </button>
        )}
        <button
          className={`rb${settingsOpen ? ' active' : ''}`}
          onClick={() => setSettingsOpen((v) => !v)}
          title="阅读设置"
        >
          排版
        </button>
      </div>

      {/* 目录 */}
      {tocOpen && toc.length > 0 && (
        <div className="epub-nav">
          {toc.map((t, i) => (
            <button
              key={`${t.href}-${i}`}
              className={`epub-nav-item${t.depth > 0 ? ` depth-${Math.min(1, t.depth)}` : ''}`}
              onClick={() => {
                setTocOpen(false)
                const ev = new CustomEvent('moyu:toc-jump', { detail: t.href })
                window.dispatchEvent(ev)
              }}
              title={t.label}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* 设置面板 */}
      {settingsOpen && (
        <div className="reader-settings">
          <div className="rs-row">
            <span className="rs-label">字号</span>
            <input
              type="range"
              min={13}
              max={34}
              value={prefs.fontSize}
              onChange={(e) => updatePrefs({ fontSize: Number(e.target.value) })}
            />
            <span className="rs-val">{prefs.fontSize}</span>
          </div>
          <div className="rs-row">
            <span className="rs-label">行距</span>
            <input
              type="range"
              min={120}
              max={240}
              value={Math.round(prefs.lineHeight * 100)}
              onChange={(e) => updatePrefs({ lineHeight: Number(e.target.value) / 100 })}
            />
            <span className="rs-val">{prefs.lineHeight.toFixed(1)}</span>
          </div>
          <div className="rs-row">
            <span className="rs-label">宽度</span>
            <input
              type="range"
              min={520}
              max={1100}
              step={20}
              value={prefs.maxWidth}
              onChange={(e) => updatePrefs({ maxWidth: Number(e.target.value) })}
            />
            <span className="rs-val">{prefs.maxWidth}</span>
          </div>
          <div className="rs-row">
            <span className="rs-label">字体</span>
            <div className="rs-seg">
              {(['serif', 'sans', 'kai'] as const).map((f) => (
                <button
                  key={f}
                  className={prefs.fontFamily === f ? 'active' : ''}
                  onClick={() => updatePrefs({ fontFamily: f })}
                >
                  {f === 'serif' ? '宋体' : f === 'sans' ? '黑体' : '楷体'}
                </button>
              ))}
            </div>
          </div>
          <div className="rs-row">
            <span className="rs-label">主题</span>
            <div className="rs-seg">
              {(['paper', 'sepia', 'night', 'system'] as const).map((t) => (
                <button
                  key={t}
                  className={prefs.theme === t ? 'active' : ''}
                  onClick={() => updatePrefs({ theme: t })}
                >
                  {t === 'paper' ? '纸白' : t === 'sepia' ? '米黄' : t === 'night' ? '夜间' : '跟随'}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 正文 */}
      <div className="reader-body">
        {phase === 'loading' && (
          <div className="reader-state">
            <div>
              <h2>正在打开…</h2>
              <p>首次打开大文件可能需要几秒。</p>
            </div>
          </div>
        )}
        {phase === 'error' && (
          <div className="reader-state">
            <div>
              <h2>无法打开这本书</h2>
              <p>{error}</p>
              <div className="reader-actions">
                <button className="rb" onClick={() => void exit()}>
                  返回书架
                </button>
              </div>
            </div>
          </div>
        )}
        {phase === 'ready' && data && book && (
          <>
            {(fmt === 'txt' || fmt === 'md' || fmt === 'fb2') && chapters && (
              <TextReader
                chapters={chapters}
                fontSize={prefs.fontSize}
                lineHeight={prefs.lineHeight}
                maxWidth={prefs.maxWidth}
                fontFamily={FONT_STACK[prefs.fontFamily]}
                initialLocator={book.locator ?? null}
                onLocate={onLocate}
              />
            )}
            {fmt === 'epub' && (
              <Suspense fallback={<div className="reader-state">正在加载 EPUB 引擎…</div>}>
                <EpubReader
                  data={data}
                  fontSize={prefs.fontSize}
                  lineHeight={prefs.lineHeight}
                  bg={colors.bg}
                  fg={colors.fg}
                  initialLocator={book.locator ?? null}
                  onLocate={onLocate}
                  onToc={setToc}
                  onError={(m) => {
                    setError(m)
                    setPhase('error')
                  }}
                />
              </Suspense>
            )}
            {fmt === 'pdf' && (
              <Suspense fallback={<div className="reader-state">正在加载 PDF 引擎…</div>}>
                <PdfReader
                  data={data}
                  scaleMode={prefs.pdfScale}
                  initialLocator={book.locator ?? null}
                  onLocate={onLocate}
                  onInfo={setPagesInfo}
                  onError={(m) => {
                    setError(m)
                    setPhase('error')
                  }}
                />
              </Suspense>
            )}
            {(fmt === 'cbz' || fmt === 'cbr') && (
              <Suspense fallback={<div className="reader-state">正在解包漫画…</div>}>
                <ComicReader
                  data={data}
                  initialLocator={book.locator ?? null}
                  onLocate={onLocate}
                  onInfo={setPagesInfo}
                  onError={(m) => {
                    setError(m)
                    setPhase('error')
                  }}
                />
              </Suspense>
            )}
          </>
        )}
      </div>

      {/* 底部进度 */}
      <div className="reader-foot">
        <div className="reader-progress-track">
          <div className="reader-progress-fill" style={{ width: `${Math.round(percent * 100)}%` }} />
        </div>
        <span className="reader-sub">{Math.round(percent * 100)}%</span>
      </div>
    </div>
  )
}

/** Markdown → 按一级标题切章的章节数组 */
function mdToChapters(md: string): Chapter[] {
  const parts = md.split(/^(?=#\s)/m)
  const chapters: Chapter[] = []
  let cursor = 0
  for (const p of parts) {
    const trimmed = p.trim()
    if (!trimmed) continue
    const titleMatch = trimmed.match(/^#\s+(.+)$/m)
    const html = markdownToHtml(trimmed)
    chapters.push({
      title: titleMatch?.[1]?.trim() ?? `第 ${chapters.length + 1} 节`,
      html,
      startChar: cursor,
      charCount: trimmed.length,
    })
    cursor += trimmed.length
  }
  return chapters.length
    ? chapters
    : [{ title: '正文', html: markdownToHtml(md), startChar: 0, charCount: md.length }]
}
