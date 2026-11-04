import { useEffect } from 'react'
import { Toaster, toast as sonner } from 'sonner'
import { useStore } from '@/store/useStore'

/**
 * 全局提示（sonner）。
 *
 * store 的 `toast(text, kind)` 契约不变，这里只把一次性的 ui.toast 事件转成 sonner 调用：
 * 堆叠、悬停暂停、合并、退场物理曲线都交给 sonner，业务代码一行不用改。
 */
export function Toast() {
  const toastMsg = useStore((s) => s.ui.toast)
  const dismissToast = useStore((s) => s.dismissToast)
  const theme = useStore((s) => s.settings.theme)

  useEffect(() => {
    if (!toastMsg) return
    const opts = {
      id: String(toastMsg.id),
      duration: 2600,
      // sonner 关闭（超时/点击/滑动）时同步清 store，避免同一条重复弹出
      onDismiss: () => dismissToast(toastMsg.id),
      onAutoClose: () => dismissToast(toastMsg.id),
    }
    if (toastMsg.kind === 'ok') sonner.success(toastMsg.text, opts)
    else if (toastMsg.kind === 'err') sonner.error(toastMsg.text, opts)
    else sonner(toastMsg.text, opts)
  }, [toastMsg, dismissToast])

  return (
    <Toaster
      className="toaster-host"
      position="bottom-center"
      theme={theme === 'light' ? 'light' : 'dark'}
      offset={28}
      gap={8}
      visibleToasts={3}
    />
  )
}
