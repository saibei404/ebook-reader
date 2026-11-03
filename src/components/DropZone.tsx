import { useCallback, useEffect, useRef, useState } from 'react'
import { useStore } from '@/store/useStore'
import { nativeApi, type PickedFile } from '@/lib/native'

/** 与「导入」对话框的过滤器保持一致，避免拖入时接受对话框选不到的文件 */
const ACCEPTED = [
  'epub',
  'pdf',
  'mobi',
  'azw3',
  'azw',
  'fb2',
  'txt',
  'md',
  'markdown',
  'docx',
  'doc',
  'cbz',
  'cbr',
]

function isAccepted(name: string): boolean {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  return ACCEPTED.includes(ext)
}

interface Progress {
  done: number
  total: number
  name: string
}

/**
 * 全窗口拖拽导入。
 *
 * 两个关键点：
 * 1. **必须在 window 上 `preventDefault`**：Electron 里不拦截 drop，窗口会直接导航到被拖入的文件
 *    （表现为整个界面被替换成一张图片/一段文本），这是最常见的"拖拽把应用搞坏"。
 * 2. **dragleave 要计数**：指针在子元素间移动时浏览器会连续派发 enter/leave，
 *    直接用布尔开关会让遮罩疯狂闪烁。
 */
export function DropZone() {
  const addBooksFromEntries = useStore((s) => s.addBooksFromEntries)
  const toast = useStore((s) => s.toast)
  const [active, setActive] = useState(false)
  const [progress, setProgress] = useState<Progress | null>(null)
  const [hoverCount, setHoverCount] = useState(0)
  const depth = useRef(0)

  const handleDrop = useCallback(
    async (e: DragEvent) => {
      e.preventDefault()
      depth.current = 0
      setActive(false)

      const files = Array.from(e.dataTransfer?.files ?? [])
      if (!files.length) return

      const entries: PickedFile[] = []
      let rejected = 0
      for (const f of files) {
        if (!isAccepted(f.name)) {
          rejected += 1
          continue
        }
        // Electron 32+ 移除了 File.path，只能经 preload 的 webUtils 拿真实路径
        const resolved = nativeApi?.resolveDroppedFile?.(f) ?? null
        entries.push(resolved ?? { name: f.name, size: f.size, path: '' })
      }

      if (!entries.length) {
        toast('没有可导入的文件：支持 EPUB / PDF / TXT / MD / FB2 / DOCX / CBZ', 'info')
        return
      }
      if (rejected) toast(`已忽略 ${rejected} 个不支持的文件`, 'info')

      setProgress({ done: 0, total: entries.length, name: entries[0].name })
      try {
        await addBooksFromEntries(entries, {
          onProgress: (done, total, name) => setProgress({ done, total, name }),
        })
      } finally {
        setProgress(null)
      }
    },
    [addBooksFromEntries, toast]
  )

  useEffect(() => {
    const hasFiles = (e: DragEvent): boolean =>
      Array.from(e.dataTransfer?.types ?? []).includes('Files')

    const onEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current += 1
      setActive(true)
      setHoverCount(Array.from(e.dataTransfer?.items ?? []).length)
    }
    const onOver = (e: DragEvent) => {
      if (!hasFiles(e)) return
      // 不拦截就会导航到文件本身
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const onLeave = () => {
      // 这里**不能**再判断 hasFiles：部分环境下 dragleave 的 dataTransfer.types 是空的，
      // 一旦返回就直接漏掉计数，遮罩会在"拖出去但没松手"时永久卡住。
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setActive(false)
    }
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return
      void handleDrop(e)
    }
    /** 拖拽中途按 Esc / 拖出窗口：兜底收起遮罩 */
    const onDragEnd = () => {
      depth.current = 0
      setActive(false)
    }

    window.addEventListener('dragenter', onEnter)
    window.addEventListener('dragover', onOver)
    window.addEventListener('dragleave', onLeave)
    window.addEventListener('drop', onDrop)
    window.addEventListener('dragend', onDragEnd)
    window.addEventListener('blur', onDragEnd)
    return () => {
      window.removeEventListener('dragenter', onEnter)
      window.removeEventListener('dragover', onOver)
      window.removeEventListener('dragleave', onLeave)
      window.removeEventListener('drop', onDrop)
      window.removeEventListener('dragend', onDragEnd)
      window.removeEventListener('blur', onDragEnd)
    }
  }, [handleDrop])

  const running = !!progress

  /**
   * 只用条件渲染 + CSS 入场动画。
   *
   * 试过 AnimatePresence 做淡出：它会把节点留在 DOM 里（实测 opacity 已到 0、
   * `stillThere` 仍为 true）——一个全屏 z-index 200 的透明层长期挂着，
   * 是不可接受的脏状态。功能型遮罩优先可靠，入场动画在 CSS 里做就够了。
   */
  return (
    <>
      {(active || running) && (
        <div className="dropzone" key="moyu-dropzone">
          <div className={`dropzone-card${running ? ' running' : ''}`}>
            <div className="dropzone-icon" aria-hidden="true">
              {running ? (
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M12 3v10m0 0 4-4m-4 4-4-4" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" strokeLinecap="round" />
                </svg>
              ) : (
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                  <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4H10l2 2h6.5A1.5 1.5 0 0 1 20 7.5v10A1.5 1.5 0 0 1 18.5 19h-13A1.5 1.5 0 0 1 4 17.5v-12Z" strokeLinejoin="round" />
                  <path d="M12 11v4m0-4 2 2m-2-2-2 2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              )}
            </div>

            {running && progress ? (
              <>
                <div className="dropzone-title">
                  正在导入 {Math.min(progress.done + 1, progress.total)} / {progress.total}
                </div>
                <div className="dropzone-sub dropzone-file">{progress.name}</div>
                <div className="dropzone-bar">
                  <span style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
                </div>
              </>
            ) : (
              <>
                <div className="dropzone-title">
                  松开以导入{hoverCount > 1 ? ` ${hoverCount} 个文件` : ''}
                </div>
                <div className="dropzone-sub">
                  支持 EPUB / PDF / TXT / MD / FB2 / DOCX / CBZ，可一次拖入多本
                </div>
                <div className="dropzone-hint">带封面的书会自动提取封面，其余用书名生成</div>
              </>
            )}
          </div>
        </div>
      )}
    </>
  )
}
