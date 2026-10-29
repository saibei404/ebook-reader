import { useRef } from 'react'
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react'
import type { Book } from '@/types/book'
import { FORMAT_LABEL } from '@/types/book'
import { useStore } from '@/store/useStore'
import { IconTrash, IconImage } from './Icons'

interface Props {
  book: Book
  index: number
  itemVariants: any
  exitVariants: any
}

export function BookCard({ book, index, itemVariants, exitVariants }: Props) {
  const { covers, procCovers, openBook, removeBook, setUI } = useStore()
  const coverUrl = (book.coverId ? covers[book.coverId] : null) ?? procCovers[book.id] ?? ''

  const rx = useMotionValue(0)
  const ry = useMotionValue(0)
  const springCfg = { stiffness: 300, damping: 26 }
  const rxs = useSpring(rx, springCfg)
  const rys = useSpring(ry, springCfg)
  const glareX = useTransform(rys, [-8, 8], ['30%', '70%'])
  const glareOpacity = useTransform(rys, [-8, 0, 8], [0.16, 0.05, 0.16])
  const lastMove = useRef(0)

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const now = performance.now()
    if (now - lastMove.current < 24) return
    lastMove.current = now
    const rect = e.currentTarget.getBoundingClientRect()
    const px = (e.clientX - rect.left) / rect.width - 0.5
    const py = (e.clientY - rect.top) / rect.height - 0.5
    ry.set(px * 12)
    rx.set(-py * 10)
  }

  const onLeave = () => {
    rx.set(0)
    ry.set(0)
  }

  // 以 locator 为准（真实阅读位置），老数据回退 progress
  const progress = book.locator?.percent ?? book.progress
  const pct = Math.round(progress * 100)
  // 圆环周长（r=15.5），用于 stroke-dashoffset 计算
  const ringC = 2 * Math.PI * 15.5

  return (
    <motion.div
      className="book-card"
      custom={index}
      variants={itemVariants}
      exit={exitVariants}
      layout="position"
      whileHover={{ y: -10, scale: 1.035, transition: { type: 'spring', stiffness: 400, damping: 26 } }}
      onClick={() => openBook(book.id)}
    >
      <motion.div
        className="book-card-inner"
        style={{ rotateX: rxs, rotateY: rys, transformPerspective: 900 }}
        onMouseMove={onMove}
        onMouseLeave={onLeave}
      >
        <div className="book-cover-wrap">
          {coverUrl ? (
            <motion.img layoutId={`cover-${book.id}`} className="book-cover" src={coverUrl} alt={book.title} draggable={false} />
          ) : (
            <div className="book-cover book-cover-ph" />
          )}
          <span className="spine" aria-hidden />
          <motion.div className="cover-glare" style={{ left: glareX, opacity: glareOpacity }} />
          <span className="format-badge">{FORMAT_LABEL[book.format]}</span>
          {progress > 0.0005 && (
            /* 圆环进度（iPhone 电量环风格）：置于右上角，与左下角格式徽标错开，杜绝重叠 */
            <div className="progress-ring" title={`阅读进度 ${pct}%`}>
              <svg viewBox="0 0 36 36" aria-hidden>
                <circle className="ring-track" cx="18" cy="18" r="15.5" />
                <circle
                  className="ring-fill"
                  cx="18"
                  cy="18"
                  r="15.5"
                  strokeDasharray={ringC}
                  strokeDashoffset={ringC * (1 - Math.min(1, Math.max(0, progress)))}
                />
              </svg>
            </div>
          )}
          <div className="card-actions">
            <button
              className="card-act"
              title="更换封面"
              onClick={(e) => {
                e.stopPropagation()
                openBook(book.id)
                setUI({ coverEditing: true })
              }}
            >
              <IconImage size={14} />
            </button>
            <button
              className="card-act danger"
              title="移除书籍"
              onClick={(e) => {
                e.stopPropagation()
                void removeBook(book.id)
              }}
            >
              <IconTrash size={14} />
            </button>
          </div>
        </div>
        <div className="book-meta">
          <div className="book-title">{book.title}</div>
          <div className="book-author">{book.author}</div>
        </div>
      </motion.div>
    </motion.div>
  )
}
