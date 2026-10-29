import { useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useStore } from '@/store/useStore'

export function Toast() {
  const { ui, dismissToast } = useStore()
  const toast = ui.toast

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => dismissToast(toast.id), 2600)
    return () => clearTimeout(t)
  }, [toast, dismissToast])

  return (
    <AnimatePresence>
      {toast && (
        <motion.div
          key={toast.id}
          className={`toast toast-${toast.kind}`}
          initial={{ opacity: 0, y: 24, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 14, scale: 0.95 }}
          transition={{ type: 'spring', stiffness: 420, damping: 30 }}
        >
          {toast.text}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
