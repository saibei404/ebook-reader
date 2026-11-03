import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore, selectBooks, DONE_THRESHOLD } from '@/store/useStore'
import { ANIM_MODES, type Book, type Shelf } from '@/types/book'
import { BookGrid } from '@/components/BookGrid'
import { ShelfSection } from '@/components/ShelfSection'
import { IconPlus, IconLibrary } from '@/components/Icons'
import { nativeApi } from '@/lib/native'

const FILTERS: { id: 'all' | 'reading' | 'unread' | 'done'; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'reading', label: '在读' },
  { id: 'unread', label: '未读' },
  { id: 'done', label: '读完' },
]

const SORTS: { id: 'recent' | 'title' | 'author' | 'progress' | 'manual'; label: string }[] = [
  { id: 'recent', label: '最近阅读' },
  { id: 'title', label: '书名' },
  { id: 'author', label: '作者' },
  { id: 'progress', label: '进度' },
  { id: 'manual', label: '自定义顺序' },
]

const CARD_SIZES: { id: 'sm' | 'md' | 'lg'; label: string }[] = [
  { id: 'sm', label: '小' },
  { id: 'md', label: '中' },
  { id: 'lg', label: '大' },
]

/** 组内顺序：有分组按 bookIds（手动顺序），未分组按导入时间 */
function orderByShelf(list: Book[], shelf: Shelf | null): Book[] {
  if (!shelf) return [...list].sort((a, b) => a.addedAt - b.addedAt)
  const idx = new Map(shelf.bookIds.map((id, i) => [id, i]))
  return [...list].sort(
    (a, b) => (idx.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (idx.get(b.id) ?? Number.MAX_SAFE_INTEGER)
  )
}

export function LibraryPage() {
  const {
    books,
    shelves,
    ui,
    setUI,
    settings,
    setSettings,
    addBooksFromFiles,
    addBooksFromPicked,
    createShelf,
    renameShelf,
    deleteShelf,
    toggleShelf,
    moveBookToShelf,
    reorderInShelf,
  } = useStore()

  const [draggingId, setDraggingId] = useState<string | null>(null)
  /** 未分组是虚拟组，折叠状态只放内存（不写 kv） */
  const [ungroupedCollapsed, setUngroupedCollapsed] = useState(false)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const newRef = useRef<HTMLInputElement>(null)

  // 拖到空白处松手时也要清掉拖拽态，否则卡片会一直保持「可拖」
  useEffect(() => {
    const clear = () => setDraggingId(null)
    window.addEventListener('dragend', clear)
    window.addEventListener('drop', clear)
    return () => {
      window.removeEventListener('dragend', clear)
      window.removeEventListener('drop', clear)
    }
  }, [])

  useEffect(() => {
    if (creating) newRef.current?.focus()
  }, [creating])

  const current = ANIM_MODES.find((m) => m.id === settings.animMode)
  const doneCount = books.filter((b) => b.progress >= DONE_THRESHOLD).length

  /** 分组 → 书（shelfId 指向已删除的分组时计入未分组） */
  const grouped = useMemo(() => {
    const byShelf = new Map<string, Book[]>()
    for (const s of shelves) byShelf.set(s.id, [])
    const ungrouped: Book[] = []
    for (const b of books) {
      const arr = b.shelfId ? byShelf.get(b.shelfId) : undefined
      if (arr) arr.push(b)
      else ungrouped.push(b)
    }
    return { byShelf, ungrouped }
  }, [books, shelves])

  /**
   * 当前分组筛选范围内的书。
   * 单组视图也必须按分组顺序排——否则拖拽重排后 bookIds 变了、界面还是导入顺序。
   */
  const scopeBooks = useMemo(() => {
    if (ui.shelfFilter === 'all') return books
    if (ui.shelfFilter === 'ungrouped') return orderByShelf(grouped.ungrouped, null)
    const sh = shelves.find((x) => x.id === ui.shelfFilter)
    const list = grouped.byShelf.get(ui.shelfFilter) ?? []
    return sh ? orderByShelf(list, sh) : list
  }, [books, grouped, shelves, ui.shelfFilter])

  const list = useMemo(() => selectBooks(scopeBooks, ui), [scopeBooks, ui])

  /** 是否分区展示：全部 + 无搜索 + 无筛选（其它情况平铺，避免与筛选语义打架） */
  const spacedView = ui.shelfFilter === 'all' && ui.filter === 'all' && !ui.search.trim()

  const dropToShelf = (shelfId: string | null) => {
    if (!draggingId) return
    void moveBookToShelf(draggingId, shelfId)
    setDraggingId(null)
  }

  const dropOnBook = (shelfId: string | null) => (targetId: string, after: boolean) => {
    if (!draggingId || draggingId === targetId) {
      setDraggingId(null)
      return
    }
    const from = books.find((b) => b.id === draggingId)?.shelfId ?? null
    if (from !== shelfId) {
      // 跨组拖到卡片：先归组，再按落点定位（否则 bookIds 与 shelfId 会不一致）
      void (async () => {
        await moveBookToShelf(draggingId, shelfId)
        if (shelfId) await reorderInShelf(shelfId, draggingId, targetId, after)
      })()
    } else if (shelfId) {
      void reorderInShelf(shelfId, draggingId, targetId, after)
    }
    // 未分组没有显式顺序（按导入时间），同组拖到卡片上不改变顺序
    setDraggingId(null)
  }

  const submitNewShelf = async () => {
    const name = newName.trim()
    setCreating(false)
    setNewName('')
    if (!name) return
    // 新建后停在当前视图：切到空分组会让用户看不到书，也没法继续拖放
    await createShelf(name)
  }

  const onImport = async () => {
    if (nativeApi) {
      const picked = await nativeApi.pickBooks()
      if (picked?.length) await addBooksFromPicked(picked)
      return
    }
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = '.epub,.pdf,.mobi,.azw3,.fb2,.txt,.md,.cbz,.cbr'
    input.onchange = () => {
      const files = Array.from(input.files ?? [])
      if (files.length) void addBooksFromFiles(files)
    }
    input.click()
  }

  const shelfChips = [
    { id: 'all', label: '全部', count: books.length },
    { id: 'ungrouped', label: '未分组', count: grouped.ungrouped.length },
    ...shelves.map((s) => ({ id: s.id, label: s.name, count: s.bookIds.length })),
  ]

  return (
    <div className="library-page">
      <div className="library-toolbar">
        <div className="filter-chips">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              className={`chip${ui.filter === f.id ? ' active' : ''}`}
              onClick={() => setUI({ filter: f.id })}
            >
              <span>{f.label}</span>
            </button>
          ))}
        </div>

        <div className="toolbar-right">
          <select
            className="sort-select"
            value={ui.sort}
            onChange={(e) => setUI({ sort: e.target.value as typeof ui.sort })}
            title="排序方式"
          >
            {SORTS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 分组条：点击切换分组；拖书到 chip 上也能归组 */}
      <div className="shelf-bar">
        {shelfChips.map((c) => {
          const active = ui.shelfFilter === c.id
          const targetId = c.id === 'all' ? undefined : c.id === 'ungrouped' ? null : c.id
          return (
            <button
              key={c.id}
              className={`shelf-chip${active ? ' active' : ''}${draggingId && targetId !== undefined ? ' droppable' : ''}`}
              onClick={() => setUI({ shelfFilter: c.id })}
              onDragOver={(e) => {
                if (!draggingId || targetId === undefined) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'move'
              }}
              onDrop={(e) => {
                if (targetId === undefined) return
                e.preventDefault()
                e.stopPropagation()
                dropToShelf(targetId)
              }}
              title={c.id === 'all' ? '显示全部分组' : `${c.label}（${c.count} 本）`}
            >
              <span>{c.label}</span>
              <span className="shelf-chip-count">{c.count}</span>
            </button>
          )
        })}

        {creating ? (
          <input
            ref={newRef}
            className="shelf-new-input"
            value={newName}
            placeholder="分组名称"
            onChange={(e) => setNewName(e.target.value)}
            onBlur={() => void submitNewShelf()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitNewShelf()
              if (e.key === 'Escape') {
                setCreating(false)
                setNewName('')
              }
            }}
          />
        ) : (
          <button className="shelf-add" onClick={() => setCreating(true)} title="新建分组">
            <IconPlus size={13} />
            <span>分组</span>
          </button>
        )}
      </div>

      <div className="library-sub">
        <span className="library-count">{list.length} 本在架</span>
        {current && (
          <span className="library-hint">
            动效：{current.label} · {current.hint}
          </span>
        )}
        <span className="library-hint">{doneCount} 本已读完</span>
        {/* 封面尺寸（自「我的 → 外观」迁移而来）：位于统计栏右侧 */}
        <div className="lib-card-size" title="书籍封面尺寸">
          {CARD_SIZES.map((c) => (
            <button
              key={c.id}
              className={`lib-cs-btn${settings.cardSize === c.id ? ' active' : ''}`}
              onClick={() => void setSettings({ cardSize: c.id })}
            >
              {c.label}
            </button>
          ))}
        </div>
      </div>

      {spacedView ? (
        /* 分区视图：未分组 + 每个分组，整块可接收拖放 */
        <div className="shelf-stack">
          <ShelfSection
            shelf={null}
            books={selectBooks(orderByShelf(grouped.ungrouped, null), ui)}
            draggingId={draggingId}
            onDragStartBook={setDraggingId}
            onDropOnBook={dropOnBook(null)}
            onDropToShelf={dropToShelf}
            collapsed={ungroupedCollapsed}
            onToggle={() => setUngroupedCollapsed((v) => !v)}
          />
          {shelves.map((sh) => (
            <ShelfSection
              key={sh.id}
              shelf={sh}
              books={selectBooks(orderByShelf(grouped.byShelf.get(sh.id) ?? [], sh), ui)}
              draggingId={draggingId}
              onDragStartBook={setDraggingId}
              onDropOnBook={dropOnBook(sh.id)}
              onDropToShelf={dropToShelf}
              onToggle={() => void toggleShelf(sh.id)}
              onRename={(name) => void renameShelf(sh.id, name)}
              onDelete={() => void deleteShelf(sh.id)}
            />
          ))}

          {books.length === 0 && (
            <div className="empty-state">
              <IconLibrary size={44} />
              <h3>书架空空如也</h3>
              <p>导入本地书籍，或使用网盘导入</p>
              <button className="tbtn primary" onClick={onImport}>
                <IconPlus size={15} />
                <span>导入书籍</span>
              </button>
            </div>
          )}
          {books.length > 0 && list.length === 0 && (
            <div className="empty-state">
              <IconLibrary size={44} />
              <h3>没有符合条件的书籍</h3>
              <p>当前筛选或搜索条件下没有匹配项</p>
              <button className="tbtn" onClick={() => setUI({ filter: 'all', search: '' })}>
                <span>重置筛选条件</span>
              </button>
            </div>
          )}
        </div>
      ) : list.length === 0 ? (
        books.length === 0 ? (
          <div className="empty-state">
            <IconLibrary size={44} />
            <h3>书架空空如也</h3>
            <p>导入本地书籍，或使用网盘导入</p>
            <button className="tbtn primary" onClick={onImport}>
              <IconPlus size={15} />
              <span>导入书籍</span>
            </button>
          </div>
        ) : (
          <div className="empty-state">
            <IconLibrary size={44} />
            <h3>没有符合条件的书籍</h3>
            <p>当前筛选或搜索条件下没有匹配项</p>
            <button
              className="tbtn"
              onClick={() => setUI({ filter: 'all', search: '', shelfFilter: 'all' })}
            >
              <span>重置筛选条件</span>
            </button>
          </div>
        )
      ) : (
        <div
          className="shelf-flat"
          onDragOver={(e) => {
            if (draggingId) e.preventDefault()
          }}
          onDrop={(e) => {
            if (!draggingId) return
            e.preventDefault()
            const target = ui.shelfFilter === 'ungrouped' || ui.shelfFilter === 'all' ? null : ui.shelfFilter
            dropToShelf(target)
          }}
        >
          <BookGrid
            books={list}
            draggingId={draggingId}
            onDragStartBook={setDraggingId}
            onDropOnBook={dropOnBook(
              ui.shelfFilter === 'ungrouped' || ui.shelfFilter === 'all' ? null : ui.shelfFilter
            )}
          />
        </div>
      )}
    </div>
  )
}
