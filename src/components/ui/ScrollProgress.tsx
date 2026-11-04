import { useRef, type RefObject } from 'react'
import { motion, useScroll, useSpring } from 'motion/react'

interface Props {
  /** 真正的滚动容器（阅读正文），传 null 时不渲染 */
  containerRef: RefObject<HTMLDivElement | null>
}

/**
 * 滚动进度条（源自 motion-primitives 的 scroll-progress，去掉了 Tailwind 依赖）。
 *
 * 直接用 `useScroll` 跟真实滚动容器绑定，比「按字符偏移算百分比」跟手：
 * 用户拖动滚动条时进度条是连续的，而不是按章节离散跳。
 * 弹簧只做平滑，不改变幅度，所以视觉上仍与手指/滚轮同步。
 */
export function ScrollProgress({ containerRef }: Props) {
  const { scrollYProgress } = useScroll({ container: containerRef })
  const scaleX = useSpring(scrollYProgress, { stiffness: 260, damping: 44, restDelta: 0.001 })
  const ref = useRef<HTMLDivElement>(null)
  return <motion.div ref={ref} className="scroll-progress" style={{ scaleX }} aria-hidden />
}
