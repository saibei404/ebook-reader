import { useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { useStore } from '@/store/useStore'
import { FORMAT_LABEL } from '@/types/book'
import { formatSize } from '@/lib/format'
import { IconX, IconImage, IconShuffle, IconRefresh, IconTrash, IconBook } from './Icons'

export function BookDetail() {
  const { books, covers, procCovers, ui, settings, openBook, updateBook, removeBook, setCoverFromFile, randomizeCover, resetCover, toast } =
    useStore()
  const fileRef = useRef<HTMLInputElement>(null)
  // 进度拖拽：本地即时反馈 + 260ms 防抖落库，避免拖动过程中高频写 IndexedDB
  const [dragPct, setDragPct] = useState<number | null>(null)
  const saveTimer = useRef<number | null>(null)
  const book = books.find((b) => b.id === ui.selectedId)

  useEffect(() => {
    setDragPct(null)
    return () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current)
    }
  }, [ui.selectedId])

  if (!book) return null
  const coverUrl = (book.coverId ? covers[book.coverId] : null) ?? procCovers[book.id] ?? ''
  const pct = dragPct ?? Math.round(book.progress * 100)

  const commitProgress = (v: number) => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current)
    saveTimer.current = null
    void updateBook(book.id, { progress: v / 100, lastReadAt: Date.now() })
    setDragPct(null)
  }

  return (
    <motion.div
      className="detail-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={() => openBook(null)}
    >
      <motion.div
        className={`detail-panel mat-${settings.material}`}
        initial={{ rotateY: 64, opacity: 0, scale: 0.92 }}
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
            className="detail-cover"
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
            <input
              className="progress-slider"
              type="range"
              min={0}
              max={100}
              value={pct}
              onChange={(e) => {
                const v = Number(e.target.value)
                setDragPct(v)
                if (saveTimer.current) window.clearTimeout(saveTimer.current)
                saveTimer.current = window.setTimeout(() => commitProgress(v), 260)
              }}
              onPointerUp={() => {
                if (dragPct != null) commitProgress(dragPct)
              }}
              onKeyUp={() => {
                if (dragPct != null) commitProgress(dragPct)
              }}
            />
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

          <div className="detail-actions">
            <button
              className="tbtn primary"
              onClick={() => toast('阅读内核将在下一阶段接入（EPUB.js / PDF.js）', 'info')}
            >
              <IconBook size={15} />
              <span>开始阅读</span>
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
