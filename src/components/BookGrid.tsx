import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { Book } from '@/types/book'
import { GRID_VARIANTS } from '@/lib/anim'
import { useStore } from '@/store/useStore'
import { BookCard } from './BookCard'

interface Props {
  books: Book[]
  /** 正在拖拽的书 id（用于开启其它卡片的落点提示） */
  draggingId?: string | null
  onDragStartBook?: (id: string) => void
  onDropOnBook?: (targetId: string, after: boolean) => void
}

export function BookGrid({ books, draggingId = null, onDragStartBook, onDropOnBook }: Props) {
  const { settings } = useStore()
  const [nonce, setNonce] = useState(0)
  const first = useRef(true)

  useEffect(() => {
    if (first.current) {
      first.current = false
      return
    }
    setNonce((n) => n + 1)
  }, [settings.animMode])

  const v = GRID_VARIANTS[settings.animMode]

  return (
    <motion.div
      key={`${settings.animMode}-${nonce}`}
      className={`book-grid size-${settings.cardSize}`}
      variants={v.container}
      initial="hidden"
      animate="show"
    >
      <AnimatePresence mode="popLayout">
        {books.map((b, i) => (
          <BookCard
            key={b.id}
            book={b}
            index={i}
            itemVariants={v.item}
            exitVariants={v.exit}
            dragging={!!draggingId && draggingId !== b.id}
            onDragStartBook={onDragStartBook}
            onDropOnBook={onDropOnBook}
          />
        ))}
      </AnimatePresence>
    </motion.div>
  )
}
