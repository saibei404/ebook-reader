import type { Book } from '@/types/book'

/**
 * 程序化默认封面（无封面书籍 / 随机封面）。
 *
 * Astryx 设计语言（参考 meta/astryx 的 Design Conventions）：
 *  - 表面用带色调的中性色，禁用纯黑纯白；明暗双模文字都过 AA
 *  - 圆角按 role：page 28 → container 12 → element 8 → inner 4，同心 r_inner = r_outer - gap
 *  - 排版走 base 14 / ratio 1.2 的 role 阶梯，字重四档 400/500/600/700
 *  - 一个界面只有一个 primary emphasis：这里只用一条 accent 条，不做满版渐变
 *  - 不用玻璃拟态、径向光斑、内高光、渐变文字等装饰
 *
 * 契约不变：300x400 PNG dataURL、coverSeed → 配色、函数签名与调用处。
 * 格式标签由书架卡片徽标展示，封面不重复绘制。
 */
export function coverHue(seed: number): number {
  return Math.abs(Math.trunc(seed)) % PALETTES.length
}

/** 7 组语义配色，对应 Astryx 预置主题的中性/强调取向；均为带色调中性，非纯黑白 */
const PALETTES: { bg: string; fg: string; sub: string; line: string; accent: string; onAccent: string }[] = [
  { bg: '#e9ecf1', fg: '#1b1d21', sub: '#4c515b', line: '#cfd5df', accent: '#2f6fe4', onAccent: '#ffffff' }, // neutral
  { bg: '#f2ecd9', fg: '#2c2718', sub: '#635b42', line: '#ded4b8', accent: '#a2761a', onAccent: '#ffffff' }, // butter
  { bg: '#eae2dd', fg: '#2b211d', sub: '#63504a', line: '#d6c7bf', accent: '#8b4a2f', onAccent: '#ffffff' }, // chocolate
  { bg: '#e4ece3', fg: '#1c291d', sub: '#4a5c4b', line: '#cbd9c9', accent: '#2f7a4c', onAccent: '#ffffff' }, // matcha
  { bg: '#e8eaed', fg: '#20242a', sub: '#525963', line: '#d0d4da', accent: '#4a5b70', onAccent: '#ffffff' }, // stone
  { bg: '#24262b', fg: '#e9eaed', sub: '#a7abb4', line: '#3a3d44', accent: '#8b7bd8', onAccent: '#14161a' }, // gothic
  { bg: '#e2edf2', fg: '#17242c', sub: '#4a626f', line: '#c6dbe5', accent: '#1f7fa0', onAccent: '#ffffff' }, // y2k
]

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

export function generateCoverDataUrl(book: {
  title: string
  author: string
  format: string
  coverSeed: number
}): string {
  const w = 300
  const h = 400
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return ''

  const p = PALETTES[coverHue(book.coverSeed)]

  // 4px 栅格：外边距 24、内容区 252、gap 8/16/24
  const margin = 24
  const contentW = w - margin * 2
  const innerW = contentW - 16 * 2

  ctx.save()
  // page role：28px，同心父级
  roundRectPath(ctx, 0, 0, w, h, 28)
  ctx.clip()

  // 1) 页面级底色（不透明、带色调中性）
  ctx.fillStyle = p.bg
  ctx.fillRect(0, 0, w, h)

  // 2) 顶部语义条：唯一的 accent emphasis，用 8px 高度 + 圆角，不做满版渐变
  roundRectPath(ctx, margin, margin, 40, 8, 4)
  ctx.fillStyle = p.accent
  ctx.fill()

  // 3) 书名容器：container role 12px，内部间距 16px → 同心
  ctx.font = '600 27px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
  const titleLines = layoutLines(ctx, book.title || '未命名', innerW, 3)
  const titleLH = 36
  const titleH = Math.max(titleLH, titleLines.length * titleLH)

  const cardY = 120
  const cardH = titleH + 16 * 2 + 20 + 16
  roundRectPath(ctx, margin, cardY, contentW, cardH, 12)
  ctx.fillStyle = p.bg
  ctx.fill()
  ctx.strokeStyle = p.line
  ctx.lineWidth = 1
  ctx.stroke()

  // 4) 文字：role 阶梯 + 四档字重
  ctx.textBaseline = 'alphabetic'
  const tx = margin + 16
  ctx.fillStyle = p.fg
  ctx.font = '600 27px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
  titleLines.forEach((ln, i) => ctx.fillText(ln, tx, cardY + 16 + 28 + i * titleLH))

  // 分隔线：1px 语义描边
  const ruleY = cardY + 16 + 28 + (titleLines.length - 1) * titleLH + 20
  ctx.strokeStyle = p.line
  ctx.beginPath()
  ctx.moveTo(tx, ruleY)
  ctx.lineTo(margin + contentW - 16, ruleY)
  ctx.stroke()

  // 作者（supporting role、400 字重、次级文字色）
  ctx.fillStyle = p.sub
  ctx.font = '400 15px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
  let author = book.author || '佚名'
  while (author.length > 1 && ctx.measureText(author).width > innerW) author = author.slice(0, -1)
  if (author !== (book.author || '佚名')) author = author.slice(0, -1) + '…'
  ctx.fillText(author, tx, cardY + cardH - 20)

  // 5) 底部标签：element role 8px + accent 实心。宽度按实测文字量取，
  //    避免文字被裁（旧版固定 88px 装不下 "MOYU BOOKS"）。
  const chipY = h - margin - 30
  ctx.font = '500 13px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
  const label = 'MOYU BOOKS'
  const chipW = Math.ceil(ctx.measureText(label).width) + 24
  roundRectPath(ctx, margin, chipY, chipW, 28, 8)
  ctx.fillStyle = p.accent
  ctx.fill()
  ctx.fillStyle = p.onAccent
  ctx.fillText(label, margin + 12, chipY + 19)

  // 6) 右下角页码式几何锚点（inner role 4px），纯装饰但不带渐变/发光
  roundRectPath(ctx, w - margin - 20, chipY + 6, 20, 16, 4)
  ctx.strokeStyle = p.line
  ctx.lineWidth = 1
  ctx.stroke()

  ctx.restore()
  return canvas.toDataURL('image/png')
}
