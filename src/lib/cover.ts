/**
 * 程序化默认封面 · 方案 04「巨型首字水印」。
 *
 * Astryx 设计语言：
 *  - 低饱和带色调中性色（HSL 饱和度 10–30%），禁纯黑白、禁渐变/光斑/玻璃
 *  - 深浅双模：同一色相槽位各有一套明暗配色，切换主题时同一本书换版不换「身份」
 *  - 单一 primary emphasis（顶部 40×8 accent 条），巨型首字仅作低对比底纹
 *  - 4px 栅格、字号 role 阶梯 33/17、字重 500/400
 *
 * 版面为直角满版，圆角由 .book-cover-wrap 的 overflow:hidden 统一裁切，
 * 避免「封面自带 28px 圆角 + 容器 12px 圆角 + 1px 边框」形成双层留白。
 * 左下角 60px 完全留空，交给书卡的 format-badge，杜绝图标重合。
 *
 * 契约：300×400 PNG dataURL；coverSeed 仍作为槽位回退与「随机封面」的变更标记。
 */
export type CoverMode = 'light' | 'dark'

/** 8 个低饱和色相槽位：色相 + 明度双重错开，保证相邻图书视觉上一眼可分辨 */
const HUES = [212, 192, 148, 36, 352, 18, 264, 172]
const LIGHT_BG_L = [95, 90, 94, 89, 96, 91, 93, 88]
const DARK_BG_L = [13, 19, 12, 20, 14, 18, 15, 22]
export const PALETTE_COUNT = HUES.length

interface Scheme {
  bg: string
  fg: string
  sub: string
  line: string
  mark: string
  accent: string
}

function scheme(slot: number, mode: CoverMode): Scheme {
  const i = ((slot % HUES.length) + HUES.length) % HUES.length
  const h = HUES[i]
  const c = (s: number, l: number) => `hsl(${h}, ${s}%, ${l}%)`
  if (mode === 'light') {
    const L = LIGHT_BG_L[i]
    return {
      bg: c(14, L),
      fg: c(12, 15),
      sub: c(10, 38),
      line: c(14, L - 9),
      mark: c(18, L - 7),
      accent: c(30, 46),
    }
  }
  const L = DARK_BG_L[i]
  return {
    bg: c(14, L),
    fg: c(10, 93),
    sub: c(10, 66),
    line: c(12, L + 12),
    mark: c(16, L + 8),
    accent: c(30, 62),
  }
}

/** 兼容旧调用：seed → 槽位（未经过书架顺序分配时的回退） */
export function coverHue(seed: number): number {
  return Math.abs(Math.trunc(seed)) % PALETTE_COUNT
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

/** 逐字折行；超过 maxLines 时末行收省略号 */
function layoutLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const all: string[] = []
  let line = ''
  for (const ch of Array.from(text)) {
    const test = line + ch
    if (ctx.measureText(test).width > maxWidth && line) {
      const bp = line.lastIndexOf(' ')
      if (bp > 0 && line.length - bp < 8) {
        all.push(line.slice(0, bp).trim())
        line = (line.slice(bp + 1) + ch).trimStart()
      } else {
        all.push(line)
        line = ch
      }
    } else {
      line = test
    }
  }
  if (line) all.push(line)
  const lines = all.slice(0, maxLines).map((l) => l.trim()).filter(Boolean)
  if (all.length > maxLines && lines.length) {
    let last = lines[lines.length - 1]
    while (last && ctx.measureText(last + '…').width > maxWidth) last = last.slice(0, -1)
    lines[lines.length - 1] = last + '…'
  } else if (lines.length >= 2 && Array.from(lines[lines.length - 1]).length <= 2) {
    const prev = Array.from(lines[lines.length - 2])
    let last = lines[lines.length - 1]
    while (Array.from(last).length < 3 && prev.length > 2) {
      const candidate = prev[prev.length - 1] + last
      if (ctx.measureText(candidate).width > maxWidth) break
      prev.pop()
      last = candidate
    }
    lines[lines.length - 2] = prev.join('')
    lines[lines.length - 1] = last
  }
  return lines
}

/** 首字水印：取书名第一个字母/汉字/数字，英文转大写 */
function initialChar(title: string): string {
  const hit = Array.from(title || '').find((ch) => /[\p{L}\p{N}]/u.test(ch))
  return (hit ?? '书').toUpperCase()
}

export interface CoverInput {
  id?: string
  title: string
  author: string
  format: string
  coverSeed: number
}

export interface CoverOptions {
  mode?: CoverMode
  slot?: number
}

export function generateCoverDataUrl(book: CoverInput, opts: CoverOptions = {}): string {
  const w = 300
  const h = 400
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  const mode: CoverMode =
    opts.mode ?? (document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
  const slot = opts.slot ?? (book.id ? getCoverSlot(book.id, book.coverSeed) : coverHue(book.coverSeed))
  const p = scheme(slot, mode)

  const margin = 24
  const contentW = w - margin * 2

  ctx.save()
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = p.bg
  ctx.fillRect(0, 0, w, h)

  const titleFont = '500 33px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
  // 1) 先按书名字号折行（measureText 依赖当前 font）
  ctx.font = titleFont
  const titleLines = layoutLines(ctx, book.title || '未命名', contentW, 3)

  // 2) 顶部唯一的 accent emphasis（inner role 4px）
  roundRectPath(ctx, margin, margin, 40, 8, 4)
  ctx.fillStyle = p.accent
  ctx.fill()

  // 3) 巨型首字水印：尺寸/基线随书名行数自适应，与标题首行保持约 48px 间隙。
  //    短书名时下移放大填满中部，长书名时上移缩小避免挤压。
  const marks = [
    { size: 150, base: 210 },
    { size: 136, base: 172 },
    { size: 120, base: 136 },
  ]
  const mk = marks[Math.min(Math.max(titleLines.length, 1), 3) - 1]
  ctx.textAlign = 'center'
  ctx.font = `500 ${mk.size}px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif`
  ctx.fillStyle = p.mark
  ctx.fillText(initialChar(book.title), 218, mk.base)
  ctx.textAlign = 'left'

  // 4) 书名：底部对齐，最后一行基线恒为 288，最多 3 行
  ctx.font = titleFont
  const lineH = 38
  const lastBase = 288
  ctx.fillStyle = p.fg
  titleLines.forEach((ln, i) => {
    ctx.fillText(ln, margin, lastBase - (titleLines.length - 1 - i) * lineH)
  })

  // 5) 1px 语义分隔线
  ctx.strokeStyle = p.line
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(margin, 304)
  ctx.lineTo(margin + contentW, 304)
  ctx.stroke()

  // 6) 作者（supporting role），基线 328，下方 60px 留给书卡格式徽标
  ctx.font = '400 17px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
  ctx.fillStyle = p.sub
  const rawAuthor = book.author || '佚名'
  let author = rawAuthor
  while (author.length > 1 && ctx.measureText(author).width > contentW) author = author.slice(0, -1)
  if (author !== rawAuthor) author = author.slice(0, -1) + '…'
  ctx.fillText(author, margin, 328)

  ctx.restore()
  return canvas.toDataURL('image/png')
}

/** ---------- 槽位分配与缓存 ----------
 * 书架按「当前可见顺序」分配槽位（i % 8），保证相邻图书不同色；
 * 手动随机封面锁定的槽位不会被顺序分配覆盖。
 */
const slotMap = new Map<string, number>()
const pinned = new Set<string>()
const cache = new Map<string, string>()

/** 由 BookGrid 在每次渲染前调用，ids 为当前可见列表顺序 */
export function assignCoverSlots(ids: string[]): void {
  ids.forEach((id, i) => {
    if (pinned.has(id)) return
    slotMap.set(id, i % PALETTE_COUNT)
  })
}

export function getCoverSlot(id: string, seed = 0): number {
  return slotMap.get(id) ?? coverHue(seed)
}

/** 手动换封面：锁定新槽位并让该书缓存失效 */
export function pinCoverSlot(id: string, slot: number): void {
  slotMap.set(id, ((slot % PALETTE_COUNT) + PALETTE_COUNT) % PALETTE_COUNT)
  pinned.add(id)
  invalidateCover(id)
}

/** 恢复默认封面：解除锁定，回到顺序分配 */
export function unpinCoverSlot(id: string): void {
  pinned.delete(id)
  slotMap.delete(id)
  invalidateCover(id)
}

/** 移除书籍：只清这一本的槽位与缓存 */
export function dropCover(id: string): void {
  pinned.delete(id)
  slotMap.delete(id)
  invalidateCover(id)
}

function invalidateCover(id: string): void {
  for (const k of Array.from(cache.keys())) {
    if (k.startsWith(`${id}|`)) cache.delete(k)
  }
}

/** 组件统一入口：按 book + 主题 + 槽位派生，命中缓存则不重画 */
export function getProcCover(book: CoverInput, mode: CoverMode): string {
  const id = book.id ?? ''
  const slot = getCoverSlot(id, book.coverSeed)
  const key = `${id}|${mode}|${slot}|${book.title}|${book.author}|${book.coverSeed}`
  const hit = cache.get(key)
  if (hit) return hit
  const url = generateCoverDataUrl(book, { mode, slot })
  if (cache.size > 400) cache.clear()
  cache.set(key, url)
  return url
}

export function clearCoverCache(): void {
  cache.clear()
  slotMap.clear()
  pinned.clear()
}
