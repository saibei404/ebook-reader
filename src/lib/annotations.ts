/**
 * 高亮 / 笔记的纯函数层：截断、ID、按书分组、Markdown 导出。
 *
 * 独立成模块的目的有两个：
 * 1. 阅读窗口与主窗口（笔记页）共用同一套格式化逻辑，避免两处口径不一致；
 * 2. 全部是纯函数，可直接单测（P3 C1）。
 */
import type { Annotation, AnnotationColor } from '@/types/book'

/** 摘录上限：超过就截断——长段落整本存下来会让 IndexedDB 迅速膨胀 */
export const EXCERPT_MAX = 500

export function clampExcerpt(text: string, max = EXCERPT_MAX): string {
  const t = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim()
  if (t.length <= max) return t
  return t.slice(0, max) + '…'
}

export function makeAnnotationId(now: number = Date.now(), rand = Math.random): string {
  return `an-${now.toString(36)}-${rand().toString(36).slice(2, 8)}`
}

/**
 * CFI Range → 起点 CFI。
 * 高亮范围形如 `epubcfi(/6/4[chap02]!/4/2,/1:0,/1:12)`，
 * 而 `rendition.display()` 需要单点 CFI，取第一个逗号之前的部分即为范围起点。
 */
export function cfiStartOf(range: string): string {
  const s = String(range ?? '').trim()
  if (!s) return ''
  if (!s.startsWith('epubcfi(')) return s
  const comma = s.indexOf(',')
  const body = comma > 0 ? s.slice(0, comma) : s.replace(/\)+$/, '')
  return body + ')'
}

/** 颜色 → 展示名（导出 Markdown 与列表都按这个顺序） */
export const COLOR_LABEL: Record<AnnotationColor, string> = {
  yellow: '黄',
  green: '绿',
  blue: '蓝',
  pink: '粉',
}

export interface AnnotationGroup {
  bookId: string
  title: string
  items: Annotation[]
}

/** 按书分组（组内按创建时间倒序；组顺序按最近更新时间倒序） */
export function groupByBook(annotations: Annotation[], titleOf: (bookId: string) => string): AnnotationGroup[] {
  const map = new Map<string, Annotation[]>()
  for (const a of annotations) {
    const arr = map.get(a.bookId) ?? []
    arr.push(a)
    map.set(a.bookId, arr)
  }
  const groups: AnnotationGroup[] = []
  for (const [bookId, items] of map) {
    items.sort((x, y) => y.createdAt - x.createdAt)
    groups.push({ bookId, title: titleOf(bookId) || '未知书籍', items })
  }
  groups.sort((a, b) => {
    const at = a.items.reduce((m, x) => Math.max(m, x.updatedAt || x.createdAt), 0)
    const bt = b.items.reduce((m, x) => Math.max(m, x.updatedAt || x.createdAt), 0)
    return bt - at
  })
  return groups
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function formatDateTime(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

/** 单条：标题行（章名 · 位置）+ 引用块 + 可选备注 */
export function annotationToMarkdown(a: Annotation): string {
  const where = [a.chapterTitle || '正文', `${Math.round((a.locator.percent ?? 0) * 100)}%`]
    .filter(Boolean)
    .join(' · ')
  const quote = a.excerpt
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n')
  const lines = [`- **${where}**（${COLOR_LABEL[a.color]}）`, quote]
  if (a.note && a.note.trim()) {
    lines.push('', `  备注：${a.note.trim().replace(/\n/g, '\n  ')}`)
  }
  return lines.join('\n')
}

/** 全部书摘 → Markdown 文档（按书分组，书内按位置先后） */
export function annotationsToMarkdown(
  annotations: Annotation[],
  titleOf: (bookId: string) => string,
  now: number = Date.now()
): string {
  const groups = groupByBook(annotations, titleOf)
  const total = annotations.length
  const head = [
    '# 墨鱼阅读器 · 书摘与笔记',
    '',
    `导出时间：${formatDateTime(now)}　共 ${total} 条 / ${groups.length} 本书`,
    '',
  ]
  if (!total) return [...head, '_（暂无书摘）_', ''].join('\n')

  const body: string[] = []
  for (const g of groups) {
    // 组内按阅读位置排（导出文档用于回看，顺序应与书内一致）
    const items = [...g.items].sort((a, b) => (Number(a.locator.value) || 0) - (Number(b.locator.value) || 0))
    body.push(`## ${g.title}（${items.length} 条）`, '')
    for (const a of items) body.push(annotationToMarkdown(a), '')
  }
  return [...head, ...body].join('\n')
}
