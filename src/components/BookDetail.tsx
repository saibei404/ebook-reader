import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { useStore } from '@/store/useStore'
import { FORMAT_LABEL } from '@/types/book'
import { formatSize } from '@/lib/format'
import { bookmarksOfBook, deleteBookmark } from '@/lib/db'
import type { Bookmark, Locator } from '@/types/book'
import { nativeApi } from '@/lib/native'
import { vtMorphActive } from '@/lib/view-transition'
import { IconX, IconImage, IconShuffle, IconRefresh, IconTrash, IconBook } from './Icons'

export function BookDetail() {
  const { books, covers, procCovers, ui, settings, openBook, removeBook, setCoverFromFile, randomizeCover, resetCover, toast } =
    useStore()
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

  if (!book) return null
  // 由书架卡片点进来时走「共享元素」过渡：卡片封面已交给浏览器做形变，
  // 这里就不能再跑翻卡入场，否则两个动画会叠在一起。
  // 只在挂载时取一次：详情打开后书签是异步拉回来的，重新渲染时若再取值会变成 false，
  // 导致 .vt-morph 类被摘掉（封面在过渡期间会跳一下）。useState 的惰性初始化正好冻结它。
  const [morph] = useState(() => vtMorphActive())
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
        className={`detail-panel mat-${settings.material}`}
        initial={morph ? false : { rotateY: 64, opacity: 0, scale: 0.92 }}
        animate={{ rotateY: 0, opacity: 1, scale: 1 }}
        exit={{ rotateY: 46, opacity: 0, scale: 0.95 }}
        transition={{ type: 'spring', stiffness: 240, damping: 26 }}
        onClick={(e) => e.stopPropagation()}
      >
        <button className="detail-close" onClick={() => openBook(null)} title="关闭">
          <IconX />
        </button>

        <div className="detail-cover-col">
          <motion.img
            layoutId={`cover-${book.id}`}
            className={`detail-cover${morph ? ' vt-morph' : ''}`}
            src={coverUrl}
            alt={book.title}
            draggable={false}
          />
          <div className="detail-cover-actions">
            <button className="tbtn sm" onClick={() => fileRef.current?.click()}>
              <IconImage size={14} />
              <span>更换封面</span>
            </button>
            <button className="tbtn sm" onClick={() => void randomizeCover(book.id)} title="随机生成一张封面">
              <IconShuffle size={14} />
            </button>
            <button className="tbtn sm" onClick={() => void resetCover(book.id)} title="恢复默认封面">
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
              if (f) void setCoverFromFile(book.id, f)
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
            <span className="detail-key">阅读进度</span>
            <div className="detail-progress-bar" title="进度由阅读位置自动记录">
              <span style={{ width: `${pct}%` }} />
            </div>
            <span className="detail-val">{pct}%</span>
          </div>

          <div className="detail-row">
            <span className="detail-key">文件大小</span>
            <span className="detail-val">{formatSize(book.size)}</span>
          </div>
          <div className="detail-row">
            <span className="detail-key">加入时间</span>
            <span className="detail-val">{new Date(book.addedAt).toLocaleDateString('zh-CN')}</span>
          </div>
          {book.sourcePath && (
            <div className="detail-row">
              <span className="detail-key">本地路径</span>
              <span className="detail-val path" title={book.sourcePath}>
                {book.sourcePath}
              </span>
            </div>
          )}

          <div className="detail-row">
            <span className="detail-key">书签</span>
            <span className="detail-val">{bms.length} 个</span>
          </div>
          {bms.length > 0 && (
            <div className="detail-bm-list">
              {bms.slice(0, 5).map((b) => (
                <div className="detail-bm-row" key={b.id}>
                  <button
                    className="detail-bm-jump"
                    onClick={() => {
                      if (!nativeApi?.openReader) {
                        toast('当前环境不支持打开阅读窗口', 'err')
                        return
                      }
                      // 与阅读器内跳转同一编码：base64(encodeURIComponent(json))
                      nativeApi.openReader(book.id, btoa(encodeURIComponent(JSON.stringify(b.locator))))
                    }}
                    title={`跳转到：${b.label}`}
                  >
                    {b.label}
                  </button>
                  <button
                    className="detail-bm-del"
                    onClick={async () => {
                      await deleteBookmark(b.id)
                      setBms((prev) => prev.filter((x) => x.id !== b.id))
                    }}
                    title="删除书签"
                  >
                    ×
                  </button>
                </div>
              ))}
              {bms.length > 5 && <div className="detail-bm-more">还有 {bms.length - 5} 个书签…</div>}
            </div>
          )}

          <div className="detail-actions">
            <button
              className="tbtn primary"
              onClick={() => {
                if (!book.sourcePath) {
                  toast('这本书没有关联的本地文件，请在书架重新导入原始文件', 'err')
                  return
                }
                if (nativeApi?.openReader) nativeApi.openReader(book.id)
                else toast('当前环境不支持打开阅读窗口（请使用桌面客户端）', 'err')
              }}
            >
              <IconBook size={15} />
              <span>继续阅读</span>
            </button>
            <button
              className="tbtn danger"
              onClick={() => {
                void removeBook(book.id)
              }}
            >
              <IconTrash size={14} />
              <span>移除</span>
            </button>
          </div>

          {ui.coverEditing && (
            <motion.div
              className="cover-tip"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
            >
              提示：点击左侧「更换封面」可选择本地图片；「随机」可即时生成一张程序化封面。
            </motion.div>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}
