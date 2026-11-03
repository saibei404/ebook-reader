import { useEffect, useRef, useState } from 'react'
import type { Book, Shelf } from '@/types/book'
import { BookGrid } from './BookGrid'
import { IconTrash } from './Icons'

interface Props {
  /** null = 未分组 */
  shelf: Shelf | null
  books: Book[]
  draggingId: string | null
  onDragStartBook: (id: string) => void
  onDropOnBook: (targetId: string, after: boolean) => void
  /** 拖到组头 / 空白区 → 归入该组 */
  onDropToShelf: (shelfId: string | null) => void
  onToggle?: () => void
  /** 覆盖折叠状态（未分组这类虚拟组没有持久化字段时用） */
  collapsed?: boolean
  onRename?: (name: string) => void
  onDelete?: () => void
  /** 单组视图：不显示组头，只保留放置区 */
  headless?: boolean
}

/**
 * 书架分组区块：组头（折叠 / 重命名 / 删除）+ 组内网格。
 * 整块都是放置目标（拖书到组头或空白处即归组），组内拖到卡片上则重排。
 */
export function ShelfSection({
  shelf,
  books,
  draggingId,
  onDragStartBook,
  onDropOnBook,
  onDropToShelf,
  onToggle,
  collapsed: collapsedProp,
  onRename,
  onDelete,
  headless = false,
}: Props) {
  const [over, setOver] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(shelf?.name ?? '')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const collapsed = collapsedProp ?? !!shelf?.collapsed
  const canManage = !!shelf

  const commitRename = () => {
    const name = draft.trim()
    setEditing(false)
    if (name && name !== shelf?.name && onRename) onRename(name)
    else setDraft(shelf?.name ?? '')
  }

  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      if (!draggingId) return
      e.preventDefault()
      e.stopPropagation()
      setOver(true)
    },
    onDragLeave: (e: React.DragEvent) => {
      // 只在离开整个区块时取消高亮（子元素之间移动会连续触发）
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
      setOver(false)
    },
    onDrop: (e: React.DragEvent) => {
      if (!draggingId) return
      e.preventDefault()
      e.stopPropagation()
      setOver(false)
      onDropToShelf(shelf?.id ?? null)
    },
  }

  return (
    <section
      className={`shelf-section${over ? ' drop-active' : ''}${draggingId ? ' droppable' : ''}`}
      data-shelf-id={shelf?.id ?? 'ungrouped'}
      {...dropProps}
    >
      {!headless && (
        <div className="shelf-head">
          <button
            className="shelf-collapse"
            onClick={onToggle}
            title={collapsed ? '展开分组' : '收起分组'}
            aria-expanded={!collapsed}
          >
            <span className={`shelf-caret${collapsed ? ' collapsed' : ''}`}>▾</span>
          </button>
          {editing && canManage ? (
            <input
              ref={inputRef}
              className="shelf-rename"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename()
                if (e.key === 'Escape') {
                  setDraft(shelf?.name ?? '')
                  setEditing(false)
                }
              }}
            />
          ) : (
            <span
              className="shelf-name"
              onDoubleClick={() => {
                if (!canManage) return
                setDraft(shelf?.name ?? '')
                setEditing(true)
              }}
              title={canManage ? '双击重命名' : undefined}
            >
              {shelf?.name ?? '未分组'}
            </span>
          )}
          <span className="shelf-count">{books.length}</span>
          {canManage && (
            <button
              className="shelf-del"
              title="删除分组（书回到未分组）"
              onClick={() => onDelete?.()}
            >
              <IconTrash size={13} />
            </button>
          )}
        </div>
      )}

      {!collapsed && (
        <>
          {books.length > 0 ? (
            <BookGrid
              books={books}
              draggingId={draggingId}
              onDragStartBook={onDragStartBook}
              onDropOnBook={onDropOnBook}
            />
          ) : (
            <div className="shelf-empty">
              {draggingId ? '松手放入此分组' : canManage ? '拖动书籍到这里归组' : '这里还没有书'}
            </div>
          )}
        </>
      )}
    </section>
  )
}
