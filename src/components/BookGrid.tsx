import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import type { Book } from '@/types/book'
import { GRID_VARIANTS } from '@/lib/anim'
import { useStore } from '@/store/useStore'
import { BookCard } from './BookCard'

interface Props {
  books: Book[]
}

export function BookGrid({ books }: Props) {
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
          <BookCard key={b.id} book={b} index={i} itemVariants={v.item} exitVariants={v.exit} />
        ))}
      </AnimatePresence>
    </motion.div>
  )
}
