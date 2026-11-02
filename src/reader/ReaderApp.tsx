import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Book, Bookmark, Locator } from '@/types/book'
import { allBooks, getKV, bookmarksOfBook, putBookmark, deleteBookmark } from '@/lib/db'
import { nativeApi } from '@/lib/native'
import { createLocatorSaver } from './locator'
import { decodeText, splitPlainText, markdownToHtml, fb2ToChapters, type Chapter } from './text-utils'
import { docxToChapters } from './formats/docx'
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
  /** PDF 走 moyu-file:// 流式读取（大文件不进内存/IPC），其它格式用 data */
  const [sourceUrl, setSourceUrl] = useState('')
  const [chapters, setChapters] = useState<Chapter[] | null>(null)
  const [prefs, setPrefs] = useState<ReaderPrefs>(DEFAULT_PREFS)
  const [percent, setPercent] = useState(0)
  const [label, setLabel] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [tocOpen, setTocOpen] = useState(false)
  const [toc, setToc] = useState<{ label: string; href: string; depth: number }[]>([])
  const [toolbarVisible, setToolbarVisible] = useState(true)
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([])
  const [bmOpen, setBmOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [hint, setHint] = useState('')
  /** 当前阅读位置（加书签用；由 onLocate 持续更新） */
  const currentLoc = useRef<Locator | null>(null)
  const [systemDark, setSystemDark] = useState(false)
  const [pagesInfo, setPagesInfo] = useState<{ pages: number } | null>(null)

  const saverRef = useRef<ReturnType<typeof createLocatorSaver> | null>(null)
  const hideTimer = useRef<number | null>(null)

  const bookId = useMemo(() => new URLSearchParams(location.search).get('bookId') ?? '', [])

  /** 外部跳转目标（详情页点书签）：临时覆盖书籍自身 locator */
  const jumpLoc = useMemo<Locator | null>(() => {
    const raw = new URLSearchParams(location.search).get('jump')
    if (!raw) return null
    try {
      return JSON.parse(decodeURIComponent(atob(raw))) as Locator
    } catch {
      return null
    }
  }, [])
  /** 渲染器统一的起始位置：外部跳转 > 书籍上次位置 */
  const startLocator = jumpLoc ?? null

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
        // PDF 只需要 url（流式）；其它格式必须拿到完整字节
        const hasSource = !!res.data || !!res.url
        if (!res.ok || !hasSource) {
          setError(res.error ?? '读取文件失败')
          setPhase('error')
          return
        }
        if (res.url) setSourceUrl(res.url)
        if (res.data) setData(res.data)

        // 文本类格式在此完成预处理；EPUB/PDF/漫画交给各自渲染器
        if (res.data && fmt === 'docx') {
          // Word 走 mammoth 转语义化 HTML，再按标题切章（与 TXT/MD 共用渲染管线）
          const { chapters: docChapters, warnings } = await docxToChapters(res.data)
          if (warnings.length) console.warn('DOCX 转换告警:', warnings.slice(0, 3))
          setChapters(docChapters)
        } else if (res.data && (fmt === 'txt' || fmt === 'md' || fmt === 'fb2')) {
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
    currentLoc.current = loc
    saverRef.current?.push(loc, loc.percent)
  }, [])

  /** 轻提示（阅读器内无 toast 组件） */
  const flash = useCallback((text: string) => {
    setHint(text)
    window.setTimeout(() => setHint(''), 1800)
  }, [])

  /* ---------- 搜索 ---------- */
  const canSearch = !!book && (['txt', 'md', 'fb2', 'docx'] as string[]).includes(book.format)

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q || !chapters || !canSearch) return [] as { id: string; label: string; snippet: string; locator: Locator }[]
    const total = chapters.reduce((n, c) => n + c.charCount, 0) || 1
    const out: { id: string; label: string; snippet: string; locator: Locator }[] = []
    for (const c of chapters) {
      const text = c.html.replace(/<[^>]+>/g, '')
      const lower = text.toLowerCase()
      let idx = lower.indexOf(q)
      let hits = 0
      while (idx >= 0 && hits < 5 && out.length < 80) {
        const inChapter = Math.round((idx / Math.max(1, text.length)) * c.charCount)
        const offset = c.startChar + inChapter
        const percent = Math.min(1, Math.max(0, offset / total))
        out.push({
          id: `${c.startChar}-${idx}`,
          label: c.title,
          snippet: text.slice(Math.max(0, idx - 18), idx + q.length + 26).replace(/\s+/g, ' ').trim(),
          // 故意不给 scrollRatio：TextReader 恢复时优先用像素比例，
          // 而搜索只知道字符偏移，带上近似比例反而会把定位拉偏。只给 offset 走章节内精确定位。
          locator: {
            kind: 'offset',
            value: offset,
            percent,
            label: c.title,
            updatedAt: Date.now(),
          },
        })
        idx = lower.indexOf(q, idx + q.length)
        hits++
      }
      if (out.length >= 80) break
    }
    return out
  }, [query, chapters, canSearch])

  /* ---------- 书签 ---------- */
  useEffect(() => {
    const id = book?.id
    if (!id) return
    let alive = true
    void bookmarksOfBook(id)
      .then((list) => {
        if (alive) setBookmarks(list)
      })
      .catch(() => {
        if (alive) setBookmarks([])
      })
    return () => {
      alive = false
    }
  }, [book?.id])

  const bookmarkLabelOf = (loc: Locator): string => {
    if (loc.label) return loc.label
    if (loc.kind === 'page') return `第 ${loc.value} 页`
    if (loc.kind === 'index') return `第 ${Number(loc.value) + 1} 页`
    return `${Math.round((loc.percent ?? 0) * 100)}%`
  }

  const addBookmark = async () => {
    if (!book) return
    const loc = currentLoc.current
    if (!loc) {
      flash('位置尚未就绪')
      return
    }
    const dup = bookmarks.find(
      (b) => b.locator.kind === loc.kind && String(b.locator.value) === String(loc.value)
    )
    if (dup) {
      flash('当前位置已有书签')
      return
    }
    const bm: Bookmark = {
      id: `bm-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      bookId: book.id,
      locator: { ...loc, updatedAt: Date.now() },
      label: bookmarkLabelOf(loc),
      createdAt: Date.now(),
    }
    await putBookmark(bm)
    setBookmarks((prev) => [...prev, bm])
    flash('已添加书签')
  }

  const removeBm = async (id: string) => {
    await deleteBookmark(id)
    setBookmarks((prev) => prev.filter((b) => b.id !== id))
    flash('已删除书签')
  }

  /** 跳转到书签：重新挂载阅读器并带入 jump 参数（各渲染器无需各自实现跳转） */
  const jumpTo = (loc: Locator) => {
    const raw = btoa(encodeURIComponent(JSON.stringify(loc)))
    const u = new URL(location.href)
    u.searchParams.set('jump', raw)
    setBmOpen(false)
    location.replace(u.toString())
  }

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
          className={`rb${searchOpen ? ' active' : ''}`}
          onClick={() => setSearchOpen((v) => !v)}
          title="搜索全文"
        >
          搜索
        </button>
        <button
          className={`rb${bmOpen ? ' active' : ''}`}
          onClick={() => setBmOpen((v) => !v)}
          title="书签"
        >
          书签{bookmarks.length > 0 ? ` ${bookmarks.length}` : ''}
        </button>
        <button
          className={`rb${settingsOpen ? ' active' : ''}`}
          onClick={() => setSettingsOpen((v) => !v)}
          title="阅读设置"
        >
          排版
        </button>
      </div>

      {hint && <div className="reader-hint">{hint}</div>}

      {/* 搜索 */}
      {searchOpen && (
        <div className="epub-nav search-panel">
          <input
            className="search-input"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={canSearch ? '搜索全文…' : '当前格式暂不支持搜索'}
            disabled={!canSearch}
          />
          {!canSearch && (
            <div className="bm-empty">PDF / CBZ / EPUB 暂不支持全篇搜索，可用目录或书签跳转。</div>
          )}
          {canSearch && query.trim() && (
            <div className="search-count">{searchResults.length} 处匹配</div>
          )}
          {searchResults.map((r) => (
            <button key={r.id} className="search-hit" onClick={() => jumpTo(r.locator)} title={`${r.label}：${r.snippet}`}>
              <span className="search-hit-label">{r.label}</span>
              <span className="search-hit-snippet">{r.snippet}</span>
            </button>
          ))}
          {canSearch && query.trim() && searchResults.length === 0 && (
            <div className="bm-empty">没有找到「{query.trim()}」</div>
          )}
        </div>
      )}

      {/* 书签 */}
      {bmOpen && (
        <div className="epub-nav bm-panel">
          <div className="bm-head">
            <span>书签（{bookmarks.length}）</span>
            <button className="rb" onClick={() => void addBookmark()}>
              + 当前位置
            </button>
          </div>
          {bookmarks.map((b) => (
            <div key={b.id} className="bm-row">
              <button className="epub-nav-item bm-main" onClick={() => jumpTo(b.locator)} title={b.label}>
                <span className="bm-label">{b.label}</span>
                <span className="bm-meta">{Math.round((b.locator.percent ?? 0) * 100)}%</span>
              </button>
              <button className="bm-del" onClick={() => void removeBm(b.id)} title="删除书签">
                ×
              </button>
            </div>
          ))}
          {bookmarks.length === 0 && <div className="bm-empty">还没有书签，点「+ 当前位置」添加</div>}
        </div>
      )}

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
        {/* PDF 只有 url（流式），其余格式有 data；两者有其一即可渲染正文 */}
        {phase === 'ready' && book && (data || sourceUrl) && (
          <>
            {(fmt === 'txt' || fmt === 'md' || fmt === 'fb2' || fmt === 'docx') && chapters && (
              <TextReader
                chapters={chapters}
                fontSize={prefs.fontSize}
                lineHeight={prefs.lineHeight}
                maxWidth={prefs.maxWidth}
                fontFamily={FONT_STACK[prefs.fontFamily]}
                initialLocator={startLocator ?? book.locator ?? null}
                onLocate={onLocate}
                htmlMode={fmt === 'md' || fmt === 'docx' || fmt === 'fb2'}
              />
            )}
            {fmt === 'epub' && data && (
              <Suspense fallback={<div className="reader-state">正在加载 EPUB 引擎…</div>}>
                <EpubReader
                  data={data}
                  fontSize={prefs.fontSize}
                  lineHeight={prefs.lineHeight}
                  bg={colors.bg}
                  fg={colors.fg}
                  initialLocator={startLocator ?? book.locator ?? null}
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
                  url={sourceUrl || undefined}
                  scaleMode={prefs.pdfScale}
                  initialLocator={startLocator ?? book.locator ?? null}
                  onLocate={onLocate}
                  onInfo={setPagesInfo}
                  onError={(m) => {
                    setError(m)
                    setPhase('error')
                  }}
                />
              </Suspense>
            )}
            {(fmt === 'cbz' || fmt === 'cbr') && data && (
              <Suspense fallback={<div className="reader-state">正在解包漫画…</div>}>
                <ComicReader
                  data={data}
                  initialLocator={startLocator ?? book.locator ?? null}
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
