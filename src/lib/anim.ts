import type { Variants, TargetAndTransition } from 'motion/react'
import type { AnimMode } from '@/types/book'

/**
 * Astryx 动效规范（Predictable movement）：
 *  - micro ~175ms / entrance ~410ms，统一 --ease-standard（cubic-bezier(0.2, 0, 0, 1)）
 *  - 只动 transform / opacity；不使用 spring / bounce / elastic（明确列为 dated & tacky）
 *  - 不做无意义的装饰性旋转、放大；reduced-motion 下由 CSS 归零
 *
 * 5 种「首页展示动效」仍保留方向性差异，但幅度与时长收敛到同一规范内。
 */
export const MOTION_EASE: [number, number, number, number] = [0.2, 0, 0, 1]
export const MOTION_FAST = { duration: 0.175, ease: MOTION_EASE } as const
export const MOTION_MEDIUM = { duration: 0.41, ease: MOTION_EASE } as const

export const GRID_VARIANTS: Record<AnimMode, { container: Variants; item: Variants; exit: TargetAndTransition }> = {
  flip: {
    container: { hidden: {}, show: { transition: { staggerChildren: 0.03, delayChildren: 0.04 } } },
    item: {
      hidden: { rotateY: 12, opacity: 0 },
      show: { rotateY: 0, opacity: 1, transition: MOTION_MEDIUM },
    },
    exit: { opacity: 0, transition: MOTION_FAST },
  },
  fade: {
    container: { hidden: {}, show: { transition: { staggerChildren: 0.03, delayChildren: 0.03 } } },
    item: {
      hidden: { opacity: 0, y: 6 },
      show: { opacity: 1, y: 0, transition: MOTION_MEDIUM },
    },
    exit: { opacity: 0, transition: MOTION_FAST },
  },
  zoom: {
    container: { hidden: {}, show: { transition: { staggerChildren: 0.03, delayChildren: 0.03 } } },
    item: {
      hidden: { opacity: 0, scale: 0.94 },
      show: { opacity: 1, scale: 1, transition: MOTION_MEDIUM },
    },
    exit: { opacity: 0, transition: MOTION_FAST },
  },
  slide: {
    container: { hidden: {}, show: { transition: { staggerChildren: 0.03, delayChildren: 0.03 } } },
    item: {
      hidden: (i: number) => ({ opacity: 0, x: i % 2 === 0 ? -16 : 16 }),
      show: { opacity: 1, x: 0, transition: MOTION_MEDIUM },
    },
    exit: { opacity: 0, transition: MOTION_FAST },
  },
  stack: {
    container: { hidden: {}, show: { transition: { staggerChildren: 0.04, delayChildren: 0.03 } } },
    item: {
      hidden: { opacity: 0, y: 14 },
      show: { opacity: 1, y: 0, transition: MOTION_MEDIUM },
    },
    exit: { opacity: 0, transition: MOTION_FAST },
  },
}

/** 兼容旧引用名：现在返回标准 tween，不再是 spring */
export const CARD_SPRING = MOTION_MEDIUM

/** 新书入场：轻微的 opacity + 位移，与 410ms 入场带一致 */
export const NEW_CARD_INITIAL = { opacity: 0, y: 6 } as const
export const NEW_CARD_ANIMATE = {
  opacity: 1,
  y: 0,
  transition: MOTION_MEDIUM,
} as const
