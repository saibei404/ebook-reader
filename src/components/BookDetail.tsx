import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { useStore } from '@/store/useStore'
import { FORMAT_LABEL } from '@/types/book'
import { formatSize } from '@/lib/format'
import { bookmarksOfBook, deleteBookmark } from '@/lib/db'
import type { Bookmark, Locator } from '@/types/book'
import { nativeApi } from '@/lib/native'
import { vtMorphActive } from '@/lib/vt-book'
import { withAsyncViewTransition } from '@/lib/vt'
import { t, useLang } from '@/lib/i18n'
import { IconX, IconImage, IconShuffle, IconRefresh, IconTrash, IconBook } from './Icons'

export function BookDetail() {
  const { books, covers, procCovers, ui, openBook, removeBook, setCoverFromFile, randomizeCover, resetCover, toast } =
    useStore()
  useLang()
  const fileRef = useRef<HTMLInputElement>(null)
  const book = books.find((b) => b.id === ui.selectedId)
  const [bms, setBms] = useState<Bookmark[]>([])

  const bookIdNow = book?.id
  useEffect(() => {
    if (!bookIdNow) {
      setBms([])
      return
    }
    let alive = true
    void bookmarksOfBook(bookIdNow)
      .then((list) => {
        if (alive) setBms(list)
      })
      .catch(() => {
        if (alive) setBms([])
      })
    return () => {
      alive = false
    }
  }, [bookIdNow])

  // 注意：这些 hook 必须放在 `if (!book) return null` 之前，否则书目为空时
  // 提前 return 会让 hook 数量变化，React 直接报 "Rendered fewer hooks than expected"。
  // 由书架卡片点进来时走「共享元素」过渡：卡片封面已交给浏览器做形变，
  // 这里就不能再跑翻卡入场，否则两个动画会叠在一起。
  // 只在挂载时取一次：详情打开后书签是异步拉回来的，重新渲染时若再取值会变成 false。
  const [morph] = useState(() => vtMorphActive())
  const coverRef = useRef<HTMLImageElement>(null)
  // `.vt-morph` 提供的 view-transition-name 只在「打开详情」那一次过渡里需要。
  // 一直挂着的话，之后任意一次切页过渡都会把这个封面当成孤立共享元素做退出动画。
  const [named, setNamed] = useState(() => vtMorphActive())
  useEffect(() => {
    if (!named) return
    const timer = window.setTimeout(() => setNamed(false), 480)
    return () => window.clearTimeout(timer)
  }, [named])

  if (!book) return null

  /**
   * 换封面时走异步视图过渡：旧封面与新封面是同一个 <img>，挂上名字后浏览器会做交叉形变，
   * 而不是硬切。必须用异步版——读文件/写库都在 Promise 里，浏览器的「新快照」要等它 resolve。
   */
  const swapCover = async (run: () => Promise<void> | void) => {
    const el = coverRef.current
    if (!el) {
      await run()
      return
    }
    const prev = el.style.viewTransitionName
    el.style.viewTransitionName = 'book-cover'
    try {
      await withAsyncViewTransition(run)
    } finally {
      // 取当前 ref，而不是闭包里的旧节点：React 有可能在 run() 里换掉 <img>。
      // 两个都清，避免旧节点残留名字导致后续过渡匹配错元素。
      const cur = coverRef.current
      if (cur) cur.style.viewTransitionName = prev
      if (cur && cur !== el) el.style.viewTransitionName = prev
    }
  }
  const coverUrl = (book.coverId ? covers[book.coverId] : null) ?? procCovers[book.id] ?? ''
  // 进度以 locator 为准（真实阅读位置），老数据回退 progress
  const pct = Math.round((book.locator?.percent ?? book.progress ?? 0) * 100)

  return (
    <motion.div
      className="detail-backdrop"
      initial={morph ? false : { opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => openBook(null)}
    >
      <motion.div
        /* 详情弹层统一亚克力材质：不再跟随全局材质设置，保证与其他弹层一致的
           「半透明 + 噪点 + 高光描边」观感；背景可视度由 --detail-scrim 调节。 */
        className="detail-panel mat-acrylic"
        initial={morph ? false : { rotateY: 64, opacity: 0, scale: 0.92 }}
        animate={{ rotateY: 0, opacity: 1, scale: 1 }}
        exit={{ rotateY: 46, opacity: 0, scale: 0.95 }}
        transition={{ type: 'spring', stiffness: 240, damping: 26 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="detail-close" onClick={() => openBook(null)} title={t('detail.close')}>
          <IconX />
        </button>

        <div className="detail-cover-col">
          <motion.img
            /* morph 时不再给 layoutId：原生 View Transitions 已经在做「卡片封面 → 详情封面」
               的形变，motion 的 shared layout 会再跑一遍同样的封面飞入，两个动画叠在一起。
               非 morph 场景（?open= / 阅读器返回）没有 VT，仍保留原来的封面飞入。 */
            layoutId={morph ? undefined : `cover-${book.id}`}
            ref={coverRef}
            className={`detail-cover${named ? ' vt-morph' : ''}`}
            src={coverUrl}
            alt={book.title}
            draggable={false}
          />
          <div className="detail-cover-actions">
            <button className="tbtn sm" onClick={() => fileRef.current?.click()}>
              <IconImage size={14} />
              <span>{t('detail.changeCover')}</span>
            </button>
            <button className="tbtn sm" onClick={() => void swapCover(() => randomizeCover(book.id))} title={t('detail.random')}>
              <IconShuffle size={14} />
            </button>
            <button className="tbtn sm" onClick={() => void swapCover(() => resetCover(book.id))} title={t('detail.reset')}>
              <IconRefresh size={14} />
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) void swapCover(() => setCoverFromFile(book.id, f))
              e.target.value = ''
            }}
          />
        </div>

        <div className="detail-info">
          <div className="detail-format">{FORMAT_LABEL[book.format]}</div>
          <h2 className="detail-title">{book.title}</h2>
          <div className="detail-author">{book.author}</div>

          {book.description && <p className="detail-desc">{book.description}</p>}

          <div className="detail-row">
            <span className="detail-key">{t('detail.progress')}</span>
            <div className="detail-progress-bar" title={t('detail.progressTip')}>
              <span style={{ width: `${pct}%` }} />
            </div>
            <span className="detail-val">{pct}%</span>
          </div>

          <div className="detail-row">
            <span className="detail-key">{t('detail.size')}</span>
            <span className="detail-val">{formatSize(book.size)}</span>
          </div>
          <div className="detail-row">
            <span className="detail-key">{t('detail.added')}</span>
            <span className="detail-val">{new Date(book.addedAt).toLocaleDateString('zh-CN')}</span>
          </div>
          {book.sourcePath && (
            <div className="detail-row">
              <span className="detail-key">{t('detail.path')}</span>
              <span className="detail-val path" title={book.sourcePath}>
                {book.sourcePath}
              </span>
            </div>
          )}

          <div className="detail-row">
            <span className="detail-key">{t('detail.bms')}</span>
            <span className="detail-val">{t('detail.bmCount', { n: bms.length })}</span>
          </div>
          {bms.length > 0 && (
            <div className="detail-bm-list">
              {bms.slice(0, 5).map((b) => (
                <div className="detail-bm-row" key={b.id}>
                  <button
                    className="detail-bm-jump"
                    onClick={() => {
                      if (!nativeApi?.openReader) {
                        toast(t('detail.noReader'), 'err')
                        return
                      }
                      // 与阅读器内跳转同一编码：base64(encodeURIComponent(json))
                      nativeApi.openReader(book.id, btoa(encodeURIComponent(JSON.stringify(b.locator))))
                    }}
                    title={t('detail.jump', { label: b.label })}
                  >
                    {b.label}
                  </button>
                  <button
                    className="detail-bm-del"
                    onClick={async () => {
                      await deleteBookmark(b.id)
                      setBms((prev) => prev.filter((x) => x.id !== b.id))
                    }}
                    title={t('detail.delBm')}
                  >
                    ×
                  </button>
                </div>
              ))}
              {bms.length > 5 && <div className="detail-bm-more">{t('detail.moreBms', { n: bms.length - 5 })}</div>}
            </div>
          )}

          <div className="detail-actions">
            <button
              className="tbtn primary"
              onClick={() => {
                if (!book.sourcePath) {
                  toast(t('detail.noFile'), 'err')
                  return
                }
                if (nativeApi?.openReader) nativeApi.openReader(book.id)
                else toast(t('detail.noReader'), 'err')
              }}
            >
              <IconBook size={15} />
              <span>{t('detail.continue')}</span>
            </button>
            <button
              className="tbtn danger"
              onClick={() => {
                void removeBook(book.id)
              }}
            >
              <IconTrash size={14} />
              <span>{t('detail.remove')}</span>
            </button>
          </div>

          {ui.coverEditing && (
            <motion.div
              className="cover-tip"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
            >
              {t('detail.coverTip')}
            </motion.div>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
