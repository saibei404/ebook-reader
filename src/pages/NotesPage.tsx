import { useCallback, useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useStore } from '@/store/useStore'
import { allAnnotations, deleteAnnotation, putAnnotation } from '@/lib/db'
import type { Annotation } from '@/types/book'
import {
  annotationsToMarkdown,
  formatDateTime,
  groupByBook,
  COLOR_LABEL,
} from '@/lib/annotations'
import { nativeApi } from '@/lib/native'
import { IconNote, IconTrash } from '@/components/Icons'

/**
 * 笔记页：聚合所有书的高亮与备注。
 *
 * 数据只读 IndexedDB（与阅读窗口同一 store），因此不需要跨进程通信；
 * 阅读窗口写完注解后，回到主窗口（window focus）即刷新。
 */
export function NotesPage() {
  const { books, toast } = useStore()
  const [list, setList] = useState<Annotation[]>([])
  const [loading, setLoading] = useState(true)
  /** 'all' | bookId */
  const [filter, setFilter] = useState('all')
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)

  const reload = useCallback(async () => {
    try {
      setList(await allAnnotations())
    } catch {
      setList([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  // 从阅读窗口切回来时刷新（阅读窗口不经过主窗口 IPC，靠焦点事件兜住）
  useEffect(() => {
    const onFocus = () => void reload()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [reload])

  const titleOf = useCallback(
    (bookId: string) => books.find((b) => b.id === bookId)?.title ?? '未知书籍',
    [books]
  )

  const filtered = useMemo(
    () => (filter === 'all' ? list : list.filter((a) => a.bookId === filter)),
    [list, filter]
  )
  const groups = useMemo(() => groupByBook(filtered, titleOf), [filtered, titleOf])
  const bookOptions = useMemo(() => {
    const ids = Array.from(new Set(list.map((a) => a.bookId)))
    return ids.map((id) => ({ id, title: titleOf(id) }))
  }, [list, titleOf])

  const openAt = (a: Annotation) => {
    if (!nativeApi?.openReader) {
      toast('阅读窗口仅在桌面客户端可用', 'err')
      return
    }
    try {
      nativeApi.openReader(a.bookId, btoa(encodeURIComponent(JSON.stringify(a.locator))))
    } catch {
      nativeApi.openReader(a.bookId)
    }
  }

  const remove = async (id: string) => {
    await deleteAnnotation(id)
    setList((prev) => prev.filter((a) => a.id !== id))
    setEditing((e) => (e?.id === id ? null : e))
    toast('已删除', 'info')
  }

  const saveEdit = async () => {
    if (!editing) return
    const target = list.find((a) => a.id === editing.id)
    if (!target) {
      setEditing(null)
      return
    }
    const note = editing.text.trim()
    const next: Annotation = {
      ...target,
      note: note || undefined,
      type: note ? 'note' : 'highlight',
      updatedAt: Date.now(),
    }
    await putAnnotation(next)
    setList((prev) => prev.map((a) => (a.id === next.id ? next : a)))
    setEditing(null)
    toast('备注已保存', 'ok')
  }

  const exportMd = async () => {
    if (!filtered.length) {
      toast('还没有可导出的书摘', 'info')
      return
    }
    const md = annotationsToMarkdown(filtered, titleOf)
    const d = new Date()
    const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
    const name = `moyu-notes-${stamp}.md`
    if (nativeApi?.saveTextFile) {
      const r = await nativeApi.saveTextFile(name, md)
      if (r.ok) toast(`已导出 ${filtered.length} 条书摘`, 'ok')
      else if (!r.canceled) toast(`导出失败：${r.error ?? '未知错误'}`, 'err')
      return
    }
    const url = URL.createObjectURL(new Blob([md], { type: 'text/markdown' }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    URL.revokeObjectURL(url)
    toast('已导出书摘', 'ok')
  }

  return (
    <div className="notes-page">
      <div className="notes-head">
        <div>
          <h2>笔记</h2>
          <p className="notes-sub">
            {loading ? '读取中…' : `共 ${list.length} 条 · ${bookOptions.length} 本书`}
          </p>
        </div>
        <div className="notes-actions">
          {bookOptions.length > 0 && (
            <select
              className="notes-select"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            >
              <option value="all">全部书籍</option>
              {bookOptions.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                </option>
              ))}
            </select>
          )}
          <button className="tbtn" onClick={() => void exportMd()}>
            <IconNote size={14} />
            <span>导出 Markdown</span>
          </button>
        </div>
      </div>

      {!loading && filtered.length === 0 && (
        <div className="notes-empty">
          <IconNote size={40} />
          <h3>还没有书摘</h3>
          <p>阅读时选中正文即可高亮；点「写笔记」可以把想法留在那一段旁边。</p>
        </div>
      )}

      {groups.map((g) => (
        <motion.section
          key={g.bookId}
          className="notes-group"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 260, damping: 28 }}
        >
          <div className="notes-group-head">
            <span className="notes-book">{g.title}</span>
            <span className="notes-count">{g.items.length} 条</span>
          </div>
          <AnimatePresence initial={false}>
          {g.items.map((a) => (
            <motion.div
              key={a.id}
              className="note-card"
              layout
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.98, transition: { duration: 0.14 } }}
            >
              <div className="note-card-top">
                <button className="note-jump" onClick={() => openAt(a)}>
                  <span className="note-meta">
                    <span className="anno-chip" data-color={a.color} />
                    {a.chapterTitle || '正文'} · {Math.round((a.locator.percent ?? 0) * 100)}% ·{' '}
                    {COLOR_LABEL[a.color]}色 · {formatDateTime(a.createdAt)}
                  </span>
                  {a.excerpt ? (
                    <span className="note-quote">{a.excerpt}</span>
                  ) : (
                    <span className="note-quote note-quote--empty">（整页笔记，无摘录）</span>
                  )}
                </button>
                <button className="note-del" title="删除" onClick={() => void remove(a.id)}>
                  <IconTrash size={14} />
                </button>
              </div>

              {editing?.id === a.id ? (
                <div className="note-edit">
                  <textarea
                    autoFocus
                    value={editing.text}
                    onChange={(e) => setEditing({ id: a.id, text: e.target.value })}
                    placeholder="补充你的想法…"
                  />
                  <div className="note-edit-actions">
                    <button className="tbtn" onClick={() => setEditing(null)}>
                      取消
                    </button>
                    <button className="tbtn primary" onClick={() => void saveEdit()}>
                      保存
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  className={`note-mine${a.note ? '' : ' note-mine--empty'}`}
                  onClick={() => setEditing({ id: a.id, text: a.note ?? '' })}
                  title="点击编辑备注"
                >
                  {a.note || '＋ 添加备注'}
                </button>
              )}
            </motion.div>
          ))}
          </AnimatePresence>
        </motion.section>
      ))}
    </div>
  )
}
