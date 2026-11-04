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

/** 逐字折行；超过 maxLines 时末行收省略号。先排版后绘制，玻璃卡才能自适应高度 */
function layoutLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number): string[] {
  const all: string[] = []
  let line = ''
  for (const ch of Array.from(text)) {
    const test = line + ch
    if (ctx.measureText(test).width > maxWidth && line) {
      // 有空格时优先在词边界断，避免把「日常」这类词拆到两行
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
    // 逐字折行容易把最后一个字单独挤成一行（中文标题尤其明显）：
    // 从前一行末尾回填 1~2 个字，让末行至少有三个字，视觉上才不散
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

/**
 * 程序化生成书籍封面（无封面书籍的默认外观，也用于「随机封面」）。
 *
 * 视觉：低饱和柔和渐变 + 径向光斑 + 半透明玻璃文字卡，贴近 iOS 的 Liquid Glass
 * —— 大圆角、细边框、内高光、克制的排版。全部用 canvas 渐变绘制，不用 filter/blur，
 * 生成开销与旧版相当（hydrate 时会对每本无封面书跑一次）。
 *
 * 契约不变：300x400 PNG dataURL、coverSeed → 色相、函数签名与所有调用处。
 * 格式标签由书架卡片的徽标展示，封面不重复绘制。
 */
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
  const hue2 = (hue + 26) % 360
  const hue3 = (hue + 54) % 360

  // 先量文字，玻璃卡高度随书名行数自适应
  ctx.font = '600 29px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
  const titleLines = layoutLines(ctx, book.title || '未命名', 204, 3)
  const titleLH = 37
  const titleH = Math.max(titleLH, titleLines.length * titleLH)
  const authorFont = '400 16px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
  const authorText = book.author || '佚名'

  const gx = 24
  const gy = 108
  const gw = w - 48
  const padX = 22
  const titleTop = 58
  const ruleGap = 16
  const authorGap = 30
  const gh = titleTop + titleH + ruleGap + authorGap + 30

  ctx.save()
  // 关键：clip 到圆角内。旧版的 fillRect 光泽会画到四角外面，把圆角填成直角
  roundRectPath(ctx, 0, 0, w, h, 26)
  ctx.clip()

  // 1) 柔和主渐变（比旧版 58%/22% 更明快、低饱和）
  const bg = ctx.createLinearGradient(0, 0, w * 0.8, h)
  bg.addColorStop(0, `hsl(${hue}, 48%, 66%)`)
  bg.addColorStop(0.52, `hsl(${hue2}, 44%, 50%)`)
  bg.addColorStop(1, `hsl(${hue3}, 42%, 34%)`)
  ctx.fillStyle = bg
  ctx.fillRect(0, 0, w, h)

  // 2) 玻璃光斑：径向渐变模拟体积光，不引入合成层
  const blob = (cx: number, cy: number, r: number, alpha: number) => {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    g.addColorStop(0, `rgba(255,255,255,${alpha})`)
    g.addColorStop(1, 'rgba(255,255,255,0)')
    ctx.fillStyle = g
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2)
  }
  blob(w * 0.88, h * 0.08, 190, 0.30)
  blob(w * 0.08, h * 0.94, 155, 0.16)
  blob(w * 0.52, h * 0.46, 120, 0.10)

  // 3) 顶部弧形高光
  const sheen = ctx.createLinearGradient(0, 0, 0, h * 0.56)
  sheen.addColorStop(0, 'rgba(255,255,255,0.26)')
  sheen.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = sheen
  ctx.fillRect(0, 0, w, h * 0.56)

  // 4) 书脊：保留「书」的识别，改成细渐变 + 一道高光线
  const spine = ctx.createLinearGradient(0, 0, 14, 0)
  spine.addColorStop(0, 'rgba(12,14,22,0.34)')
  spine.addColorStop(1, 'rgba(12,14,22,0.04)')
  ctx.fillStyle = spine
  ctx.fillRect(0, 0, 14, h)
  ctx.fillStyle = 'rgba(255,255,255,0.34)'
  ctx.fillRect(14, 0, 1.5, h)

  // 5) 右上角玻璃圆点（替代旧版两个突兀的白色描边圆环）
  ctx.beginPath()
  ctx.arc(w - 44, 58, 13, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(255,255,255,0.18)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.38)'
  ctx.lineWidth = 1
  ctx.stroke()

  // 6) Liquid Glass 文字卡：半透明底 + 细边框 + 顶部内高光
  roundRectPath(ctx, gx, gy, gw, gh, 24)
  ctx.fillStyle = 'rgba(18,20,30,0.22)'
  ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,0.38)'
  ctx.lineWidth = 1.2
  ctx.stroke()
  ctx.save()
  roundRectPath(ctx, gx, gy, gw, gh, 24)
  ctx.clip()
  const glassSheen = ctx.createLinearGradient(0, gy, 0, gy + gh * 0.55)
  glassSheen.addColorStop(0, 'rgba(255,255,255,0.20)')
  glassSheen.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = glassSheen
  ctx.fillRect(gx, gy, gw, gh * 0.55)
  ctx.restore()

  // 7) 书名 / 分隔线 / 作者
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = '#ffffff'
  ctx.font = '600 29px "PingFang SC", "Microsoft YaHei", system-ui, sans-serif'
  const tx = gx + padX
  const firstY = gy + titleTop
  titleLines.forEach((ln, i) => ctx.fillText(ln, tx, firstY + i * titleLH))
  const ruleY = firstY - 8 + titleH + ruleGap
  ctx.strokeStyle = 'rgba(255,255,255,0.42)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(tx, ruleY)
  ctx.lineTo(gx + gw - padX, ruleY)
  ctx.stroke()
  ctx.fillStyle = 'rgba(255,255,255,0.82)'
  ctx.font = authorFont
  let author = authorText
  while (author.length > 1 && ctx.measureText(author).width > gw - padX * 2) author = author.slice(0, -1)
  if (author !== authorText) author = author.slice(0, -1) + '…'
  ctx.fillText(author, tx, ruleY + authorGap)

  ctx.restore()
  return canvas.toDataURL('image/png')
}
