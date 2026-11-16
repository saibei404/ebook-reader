import { describe, expect, it } from 'vitest'
import {
  adaptAuthorColors,
  hexLuminance,
  isNeutral,
  luminance,
  parseRgb,
  readableColor,
} from '@/reader/epub-theme'

const BG_WHITE = hexLuminance('#ffffff')
const BG_DARK = hexLuminance('#121316')

describe('parseRgb / 亮度', () => {
  it('解析 rgb()/rgba()（含空格与斜杠 alpha）', () => {
    expect(parseRgb('rgb(68, 68, 68)')).toEqual({ r: 68, g: 68, b: 68, a: 1 })
    expect(parseRgb('rgba(255, 243, 160, 0.5)')).toEqual({ r: 255, g: 243, b: 160, a: 0.5 })
    expect(parseRgb('rgb(1 2 3 / 0.25)')).toEqual({ r: 1, g: 2, b: 3, a: 0.25 })
  })

  it('不认识的颜色返回 null，交给调用方原样保留', () => {
    expect(parseRgb('transparent')).toBeNull()
    expect(parseRgb('color(srgb 1 0 0)')).toBeNull()
  })

  it('hex 亮度与灰阶判定', () => {
    expect(hexLuminance('#ffffff')).toBeCloseTo(1, 5)
    expect(hexLuminance('#000000')).toBe(0)
    expect(hexLuminance('#fff')).toBeCloseTo(1, 5)
    expect(luminance({ r: 68, g: 68, b: 68 })).toBeCloseTo(68 / 255, 5)
    expect(isNeutral({ r: 68, g: 68, b: 68 })).toBe(true)
    expect(isNeutral({ r: 255, g: 255, b: 0 })).toBe(false)
  })
})

describe('adaptAuthorColors（作者 CSS 主题适配）', () => {
  it('深色主题下的深灰字跟随主题前景', () => {
    expect(adaptAuthorColors('rgb(68, 68, 68)', 'rgba(0, 0, 0, 0)', BG_DARK, true)).toEqual({ color: 'inherit' })
  })

  it('浅色主题下的浅灰字跟随主题前景', () => {
    expect(adaptAuthorColors('rgb(238, 238, 238)', 'rgba(0, 0, 0, 0)', BG_WHITE, false).color).toBe('inherit')
  })

  it('白底亮黄字：保留色相但压暗到可读区间', () => {
    const res = adaptAuthorColors('rgb(255, 255, 0)', 'rgba(0, 0, 0, 0)', BG_WHITE, false)
    expect(res.color).toMatch(/^rgb\(/)
    const c = parseRgb(res.color!)
    expect(c).not.toBeNull()
    // 断言「与主题底色拉开了亮度差」，而非绝对明暗：HSL 明度与感知亮度不是一回事
    expect(Math.abs(luminance(c!) - BG_WHITE)).toBeGreaterThan(0.3)
    // 仍是黄色系：红绿接近且明显高于蓝
    expect(c!.r).toBeGreaterThan(c!.b)
    expect(Math.abs(c!.r - c!.g)).toBeLessThan(30)
  })

  it('黑底深蓝字：保留色相但提亮到可读区间', () => {
    const res = adaptAuthorColors('rgb(0, 0, 128)', 'rgba(0, 0, 0, 0)', BG_DARK, true)
    expect(res.color).toMatch(/^rgb\(/)
    const c = parseRgb(res.color!)
    expect(Math.abs(luminance(c!) - BG_DARK)).toBeGreaterThan(0.3)
    expect(c!.b).toBeGreaterThan(c!.r)
  })

  it('对比充分的彩色强调色（暗底上的亮蓝）不干预', () => {
    expect(adaptAuthorColors('rgb(65, 105, 225)', 'rgba(0, 0, 0, 0)', BG_DARK, true)).toEqual({})
  })

  it('与主题冲突的灰阶底换成中性半透明', () => {
    expect(adaptAuthorColors('rgb(255, 255, 255)', 'rgb(247, 247, 248)', BG_DARK, true).backgroundColor).toBe(
      'rgba(255,255,255,0.07)'
    )
    expect(adaptAuthorColors('rgb(0, 0, 0)', 'rgb(51, 51, 51)', BG_WHITE, false).backgroundColor).toBe(
      'rgba(0,0,0,0.05)'
    )
  })

  it('与主题冲突的彩色底保留 RGB 但降低不透明度', () => {
    expect(adaptAuthorColors('rgb(0, 0, 0)', 'rgb(255, 243, 160)', BG_DARK, true).backgroundColor).toBe(
      'rgba(255, 243, 160, 0.16)'
    )
  })

  it('透明底与半透明文字不干预，避免误伤', () => {
    expect(adaptAuthorColors('rgb(255, 255, 255)', 'rgba(0, 0, 0, 0)', BG_DARK, true)).toEqual({})
    expect(
      adaptAuthorColors('rgba(255, 255, 0, 0.1)', 'rgba(0, 0, 0, 0)', BG_WHITE, false)
    ).toEqual({})
  })

  it('readableColor 在深浅主题下分别朝相反方向调整', () => {
    const c = parseRgb('rgb(200, 60, 60)')!
    expect(luminance(parseRgb(readableColor(c, true))!)).toBeGreaterThan(luminance(parseRgb(readableColor(c, false))!))
  })
})
