import { motion } from 'motion/react'
import { useStore } from '@/store/useStore'
import { IconNote } from '@/components/Icons'

const INFO: Record<string, { Icon: typeof IconNote; title: string; desc: string }> = {
  notes: { Icon: IconNote, title: '笔记', desc: '书摘、想法与阅读笔记规划中，敬请期待' },
}

export function PlaceholderPage({ tab }: { tab: string }) {
  const { setUI } = useStore()
  const info = INFO[tab] ?? INFO.explore

  return (
    <motion.div
      className="placeholder-page"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
    >
      <info.Icon size={46} />
      <h2>{info.title}</h2>
      <p>{info.desc}</p>
      <button className="tbtn primary" onClick={() => setUI({ tab: 'library' })}>
        回到书架
      </button>
    </motion.div>
  )
}
