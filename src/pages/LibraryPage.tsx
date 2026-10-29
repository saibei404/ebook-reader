import { useMemo } from 'react'
import { useStore, selectBooks, DONE_THRESHOLD } from '@/store/useStore'
import { ANIM_MODES } from '@/types/book'
import { BookGrid } from '@/components/BookGrid'
import { IconPlus, IconLibrary } from '@/components/Icons'
import { nativeApi } from '@/lib/native'

const FILTERS: { id: 'all' | 'reading' | 'unread' | 'done'; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'reading', label: '在读' },
  { id: 'unread', label: '未读' },
  { id: 'done', label: '读完' },
]

const SORTS: { id: 'recent' | 'title' | 'author' | 'progress'; label: string }[] = [
  { id: 'recent', label: '最近阅读' },
  { id: 'title', label: '书名' },
  { id: 'author', label: '作者' },
  { id: 'progress', label: '进度' },
]

const CARD_SIZES: { id: 'sm' | 'md' | 'lg'; label: string }[] = [
  { id: 'sm', label: '小' },
  { id: 'md', label: '中' },
  { id: 'lg', label: '大' },
]

export function LibraryPage() {
  const { books, ui, setUI, settings, setSettings, addBooksFromFiles, addBooksFromPicked } = useStore()
  const list = useMemo(() => selectBooks(books, ui), [books, ui])
  const current = ANIM_MODES.find((m) => m.id === settings.animMode)
  const doneCount = books.filter((b) => b.progress >= DONE_THRESHOLD).length

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

      <div className="library-sub">
        <span className="library-count">{list.length} 本在架</span>
        {current && <span className="library-hint">动效：{current.label} · {current.hint}</span>}
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

      {list.length === 0 ? (
        books.length === 0 ? (
          /* 真空书架：引导导入 */
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
          /* 有书但筛选/搜索无结果：提示重置条件，而不是误报书架为空 */
          <div className="empty-state">
            <IconLibrary size={44} />
            <h3>没有符合条件的书籍</h3>
            <p>当前筛选或搜索条件下没有匹配项</p>
            <button className="tbtn" onClick={() => setUI({ filter: 'all', search: '' })}>
              <span>重置筛选条件</span>
            </button>
          </div>
        )
      ) : (
        <BookGrid books={list} />
      )}
    </div>
  )
}
