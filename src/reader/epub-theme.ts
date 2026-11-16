/**
 * EPUB 作者 CSS 的主题适配（纯函数，便于单测）。
 *
 * epub.js 会把作者 CSS 原样注入 iframe，里面常写死：
 *  - 灰阶文字 / 底色：h4{color:#444}、blockquote{background:#f7f7f8}
 *  - 彩色强调：span{color:#ffff00}、em{color:#000080}、mark{background:#fff3a0}
 * 在相反主题下这些都会失去对比度，表现为「有内容但看不见」。
 *
 * 适配原则：只修「确实看不清」的颜色，尽量保留作者配色。
 *  - 灰阶文字 → inherit（跟随主题前景色）
 *  - 彩色文字 → 保留色相与饱和度，只把 HSL 明度推到可读区间
 *  - 与主题冲突的底色 → 灰阶换中性半透明；彩色保留 RGB、降低不透明度做柔和 tint
 *  - 对比充分的彩色强调色（如暗底上的亮蓝）一律不干预
 */

export interface Rgb {
  r: number
  g: number
  b: number
  a: number
}

const RGB_RE = /rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\s*\)/i

/** 解析 getComputedStyle 返回的 rgb()/rgba()；不认识的颜色返回 null（交回原样） */
export function parseRgb(input: string): Rgb | null {
  const m = RGB_RE.exec(input ?? '')
  if (!m) return null
  const clamp = (n: number) => Math.max(0, Math.min(255, n))
  return {
    r: clamp(Number(m[1]) || 0),
    g: clamp(Number(m[2]) || 0),
    b: clamp(Number(m[3]) || 0),
    a: m[4] === undefined ? 1 : Math.max(0, Math.min(1, Number(m[4]))),
  }
}

/** 感知亮度 0–1（不按 sRGB 伽马校正，和 CSS 里肉眼观感足够接近） */
export function luminance(c: Pick<Rgb, 'r' | 'g' | 'b'>): number {
  return (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255
}

/** #rrggbb / #rgb → 亮度（主题底色以 hex 传入） */
export function hexLuminance(hex: string): number {
  const h = (hex ?? '').replace('#', '').trim()
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h.slice(0, 6)
  return luminance({
    r: Number.parseInt(full.slice(0, 2), 16) || 0,
    g: Number.parseInt(full.slice(2, 4), 16) || 0,
    b: Number.parseInt(full.slice(4, 6), 16) || 0,
  })
}

/** 灰阶判定：RGB 通道极差 ≤ 45 视为中性色 */
export function isNeutral(c: Pick<Rgb, 'r' | 'g' | 'b'>): boolean {
  return Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) <= 45
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  let h = 0
  const l = (max + min) / 2
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1))
  if (d !== 0) {
    if (max === rn) h = ((gn - bn) / d) % 6
    else if (max === gn) h = (bn - rn) / d + 2
    else h = (rn - gn) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return [h, s, l]
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2
  let r = 0
  let g = 0
  let b = 0
  if (h < 60) [r, g, b] = [c, x, 0]
  else if (h < 120) [r, g, b] = [x, c, 0]
  else if (h < 180) [r, g, b] = [0, c, x]
  else if (h < 240) [r, g, b] = [0, x, c]
  else if (h < 300) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  const round = (n: number) => Math.round(Math.max(0, Math.min(255, (n + m) * 255)))
  return [round(r), round(g), round(b)]
}

/** 保留色相/饱和度，把彩色文字的明度推到与主题相反的可读区间 */
export function readableColor(c: Rgb, dark: boolean): string {
  const [h, s] = rgbToHsl(c.r, c.g, c.b)
  const [r, g, b] = hslToRgb(h, Math.max(s, 0.35), dark ? 0.72 : 0.3)
  return `rgb(${r}, ${g}, ${b})`
}

/** 文字与主题底色亮度差小于此值即视为「看不见」 */
const MIN_LUM_GAP = 0.3

export interface AdaptResult {
  color?: string
  backgroundColor?: string
}

/**
 * 计算某个元素需要覆盖的颜色。返回空对象表示作者配色可读、不干预。
 *
 * @param color            getComputedStyle(el).color
 * @param backgroundColor  getComputedStyle(el).backgroundColor
 * @param bgLum            当前主题底色亮度（hexLuminance(theme.bg)）
 * @param dark             当前是否深色主题
 */
export function adaptAuthorColors(
  color: string,
  backgroundColor: string,
  bgLum: number,
  dark: boolean
): AdaptResult {
  const out: AdaptResult = {}
  const fg = parseRgb(color)
  if (fg && fg.a > 0.2) {
    const lum = luminance(fg)
    if (isNeutral(fg)) {
      const tooDim = dark ? lum < 0.5 : lum > 0.74
      if (tooDim) out.color = 'inherit'
    } else if (Math.abs(lum - bgLum) < MIN_LUM_GAP) {
      // 彩色硬编码与主题底色撞车（亮黄字配白底、深蓝字配黑底等）
      out.color = readableColor(fg, dark)
    }
  }
  const bg = parseRgb(backgroundColor)
  if (bg && bg.a > 0.2) {
    const lum = luminance(bg)
    const clashes = dark ? lum > 0.62 : lum < 0.35
    if (clashes) {
      out.backgroundColor = isNeutral(bg)
        ? dark
          ? 'rgba(255,255,255,0.07)'
          : 'rgba(0,0,0,0.05)'
        : `rgba(${bg.r}, ${bg.g}, ${bg.b}, 0.16)`
    }
  }
  return out
}
