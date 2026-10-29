import type { Variants, TargetAndTransition } from 'motion/react'
import type { AnimMode } from '@/types/book'

export const GRID_VARIANTS: Record<AnimMode, { container: Variants; item: Variants; exit: TargetAndTransition }> = {
  flip: {
    container: { hidden: {}, show: { transition: { staggerChildren: 0.055, delayChildren: 0.08 } } },
    item: {
      hidden: { rotateY: 92, opacity: 0 },
      show: { rotateY: 0, opacity: 1, transition: { type: 'spring', stiffness: 260, damping: 30, mass: 0.8 } },
    },
    exit: { rotateY: -60, opacity: 0, transition: { duration: 0.18 } },
  },
  fade: {
    container: { hidden: {}, show: { transition: { staggerChildren: 0.04, delayChildren: 0.05 } } },
    item: {
      hidden: { opacity: 0, y: 14 },
      show: { opacity: 1, y: 0, transition: { duration: 0.42, ease: 'easeOut' } },
    },
    exit: { opacity: 0, y: -10, transition: { duration: 0.18 } },
  },
  zoom: {
    container: { hidden: {}, show: { transition: { staggerChildren: 0.045, delayChildren: 0.05 } } },
    item: {
      hidden: { opacity: 0, scale: 0.55 },
      show: { opacity: 1, scale: 1, transition: { type: 'spring', stiffness: 320, damping: 24 } },
    },
    exit: { opacity: 0, scale: 0.8, transition: { duration: 0.18 } },
  },
  slide: {
    container: { hidden: {}, show: { transition: { staggerChildren: 0.05, delayChildren: 0.06 } } },
    item: {
      hidden: (i: number) => ({ opacity: 0, x: i % 2 === 0 ? -70 : 70 }),
      show: { opacity: 1, x: 0, transition: { type: 'spring', stiffness: 300, damping: 26 } },
    },
    exit: { opacity: 0, x: -40, transition: { duration: 0.18 } },
  },
  stack: {
    container: { hidden: {}, show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } } },
    item: {
      hidden: { opacity: 0, scale: 0.8, y: 36, rotate: -5 },
      show: { opacity: 1, scale: 1, y: 0, rotate: 0, transition: { type: 'spring', stiffness: 210, damping: 22, mass: 1.1 } },
    },
    exit: { opacity: 0, scale: 0.85, y: 20, transition: { duration: 0.18 } },
  },
}

export const CARD_SPRING = { type: 'spring', stiffness: 400, damping: 30, mass: 1 } as const
