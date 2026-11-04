interface Props {
  children: React.ReactNode
  /** 波纹速度（秒），默认 3.6s 一圈 */
  speed?: number
  className?: string
}

/**
 * 文字微光（源自 motion-primitives 的 text-shimmer，改成纯 CSS 实现）。
 *
 * 为什么不用 JS：这层光斑只是背景渐变位移，交给合成线程即可；
 * 用 motion 驱动会每帧写 style，反而在低端机上掉帧。`prefers-reduced-motion`
 * 由 CSS 负责关掉，不需要在组件里判断。
 */
export function TextShimmer({ children, speed = 3.6, className = '' }: Props) {
  return (
    <span
      className={`text-shimmer ${className}`}
      style={{ ['--shimmer-duration' as string]: `${speed}s` }}
    >
      {children}
    </span>
  )
}
