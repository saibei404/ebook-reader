import type { Book } from '@/types/book'

const HUES = [12, 28, 44, 68, 96, 150, 178, 196, 216, 248, 276, 296, 322, 344]

export function coverHue(seed: number): number {
  return HUES[Math.abs(Math.trunc(seed)) % HUES.length]
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

function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
  maxLines: number
): number {
  let line = ''
  let lines = 0
  for (const ch of text) {
    const test = line + ch
    if (ctx.measureText(test).width > maxWidth && line) {
      ctx.fillText(line, x, y + lines * lineHeight)
      line = ch
      lines++
      if (lines >= maxLines - 1) break
    } else {
      line = test
    }
  }
  if (lines < maxLines) {
    ctx.fillText(line, x, y + lines * lineHeight)
    lines++
  }
  return lines * lineHeight
}

/** 程序化生成书籍封面（无封面书籍的默认外观，也用于“随机封面”） */
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

  const hue = coverHue(book.coverSeed)
  const bg = ctx.createLinearGradient(0, 0, w, h)
  bg.addColorStop(0, `hsl(${hue}, 58%, 44%)`)
  bg.addColorStop(1, `hsl(${(hue + 46) % 360}, 52%, 22%)`)
  ctx.fillStyle = bg
  roundRectPath(ctx, 0, 0, w, h, 14)
  ctx.fill()

  // 书脊
  ctx.fillStyle = 'rgba(0,0,0,0.30)'
  ctx.fillRect(0, 0, 15, h)
  ctx.fillStyle = 'rgba(255,255,255,0.16)'
  ctx.fillRect(15, 0, 3, h)

  // 顶部光泽
  const sheen = ctx.createLinearGradient(0, 0, 0, h)
  sheen.addColorStop(0, 'rgba(255,255,255,0.20)')
  sheen.addColorStop(0.45, 'rgba(255,255,255,0)')
  ctx.fillStyle = sheen
  ctx.fillRect(18, 0, w - 18, h)

  // 装饰圆环
  ctx.strokeStyle = 'rgba(255,255,255,0.14)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.arc(w - 44, h - 46, 38, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(w - 44, h - 46, 52, 0, Math.PI * 2)
  ctx.stroke()

  // 格式信息由书架卡片的格式徽标（左下角）展示，封面不再绘制，避免与右上角进度环重合

  // 书名
  ctx.fillStyle = '#ffffff'
  ctx.font = '600 30px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
  ctx.textBaseline = 'alphabetic'
  const titleEnd = wrapText(ctx, book.title || '未命名', 38, 116, w - 84, 38, 4)

  // 分隔线
  const ruleY = Math.max(titleEnd + 96, 210)
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(38, ruleY)
  ctx.lineTo(w - 38, ruleY)
  ctx.stroke()

  // 作者
  ctx.fillStyle = 'rgba(255,255,255,0.78)'
  ctx.font = '400 19px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
  ctx.fillText(book.author || '佚名', 38, ruleY + 34)

  return canvas.toDataURL('image/png')
}
