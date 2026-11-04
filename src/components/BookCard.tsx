import { useEffect, useRef, useState } from 'react'
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react'
import type { Book } from '@/types/book'
import { FORMAT_LABEL } from '@/types/book'
import { useStore } from '@/store/useStore'
import { openBookWithCover } from '@/lib/vt-book'
import { isRecentlyAdded } from '@/lib/recent-added'
import { NEW_CARD_INITIAL, NEW_CARD_ANIMATE } from '@/lib/anim'
import { IconTrash, IconImage } from './Icons'

interface Props {
  book: Book
  index: number
  itemVariants: any
  exitVariants: any
  /** 分组拖拽：开始拖动 / 拖到本卡片（after=true 表示插到后面） */
  onDragStartBook?: (id: string) => void
  onDropOnBook?: (targetId: string, after: boolean) => void
  /** 是否正在拖拽（用于开启落点提示，避免平时也注册 dragover） */
  dragging?: boolean
}

export function BookCard({
  book,
  index,
  itemVariants,
  exitVariants,
  onDragStartBook,
  onDropOnBook,
  dragging = false,
}: Props) {
  const { covers, procCovers, openBook, removeBook, setUI } = useStore()
  /** 只在挂载时判一次：标记 1.5s 后会过期，不能让重渲染把入场动画换掉 */
  const [justAdded] = useState(() => isRecentlyAdded(book.id))
  /** 落点提示：'before' | 'after' | null */
  const [dropSide, setDropSide] = useState<'before' | 'after' | null>(null)
  const dropSideRef = useRef<'before' | 'after' | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const setSide = (s: 'before' | 'after' | null) => {
    dropSideRef.current = s
    setDropSide(s)
  }

  /**
   * 拖拽事件必须走原生监听：motion.div 的 onDragStart 是 pan 手势
   * （`(event, info: PanInfo)`），与 HTML5 drag 的签名冲突，直接传会类型报错。
   */
  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    const onStart = (e: DragEvent) => {
      if (!onDragStartBook) return
      e.dataTransfer?.setData('text/plain', book.id)
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
      onDragStartBook?.(book.id)
    }
    const onOver = (e: DragEvent) => {
      if (!dragging || !onDropOnBook) return
      e.preventDefault()
      e.stopPropagation()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
      const r = el.getBoundingClientRect()
      setSide(e.clientX - r.left > r.width / 2 ? 'after' : 'before')
    }
    const onLeave = () => setSide(null)
    const onDrop = (e: DragEvent) => {
      if (!onDropOnBook) return
      e.preventDefault()
      e.stopPropagation()
      const side = dropSideRef.current ?? 'before'
      setSide(null)
      onDropOnBook(book.id, side === 'after')
    }
    const onEnd = () => setSide(null)
    el.addEventListener('dragstart', onStart)
    el.addEventListener('dragover', onOver)
    el.addEventListener('dragleave', onLeave)
    el.addEventListener('drop', onDrop)
    el.addEventListener('dragend', onEnd)
    return () => {
      el.removeEventListener('dragstart', onStart)
      el.removeEventListener('dragover', onOver)
      el.removeEventListener('dragleave', onLeave)
      el.removeEventListener('drop', onDrop)
      el.removeEventListener('dragend', onEnd)
    }
  }, [dragging, onDragStartBook, onDropOnBook, book.id, book.title])
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
      className={`book-card${dropSide ? ` drop-${dropSide}` : ''}${onDragStartBook ? ' draggable' : ''}`}
      custom={index}
      /* 中途插入的卡片显式声明自己的 initial/animate，不依赖父容器的 stagger 编排 */
      variants={justAdded ? undefined : itemVariants}
      initial={justAdded ? NEW_CARD_INITIAL : undefined}
      animate={justAdded ? NEW_CARD_ANIMATE : undefined}
      exit={exitVariants}
      /* layout（不是 position）：封面尺寸切换（小/中/大）时宽高一起补间，只是挪位的用不上 */
      layout
      whileHover={{ y: -10, scale: 1.035, transition: { type: 'spring', stiffness: 400, damping: 26 } }}
      onClick={(e) => openBookWithCover(book.id, e.currentTarget as HTMLElement)}
      ref={cardRef}
      data-book-id={book.id}
      /* 必须始终可拖：否则第一本书永远发起不了 dragstart（dragging 只能由拖动本身产生） */
      draggable={!!onDragStartBook}
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
