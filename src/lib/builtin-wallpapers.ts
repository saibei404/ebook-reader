/**
 * 内置壁纸（系统默认两张：浅色 / 深色）。
 *
 * 为什么用内联 SVG 而不是 PNG：
 * 1. 不占包体（两张加起来 < 3KB，PNG 要几百 KB）；
 * 2. 任意分辨率、任意缩放都不糊（书桌 4K 屏也能铺满）；
 * 3. 明暗两套是同一套「揉开的色块」构图，只有配色不同，切换主题时观感连续。
 *
 * 它们不写数据库：`builtin: true` 的项在「我的壁纸」里靠前展示，不提供删除。
 */
import type { WallpaperItem } from '@/store/useStore'

/** 渐变网格壁纸：底色 + 若干柔边色团（radialGradient 自带羽化，不用滤镜更省 GPU） */
function meshSvg(opts: {
  base: [string, string, string]
  blobs: { cx: number; cy: number; r: number; color: string; opacity: number }[]
}): string {
  const stops = opts.base
    .map((c, i) => `<stop offset="${[0, 0.55, 1][i]}" stop-color="${c}"/>`)
    .join('')
  const grads = opts.blobs
    .map(
      (b, i) =>
        `<radialGradient id="g${i}"><stop offset="0" stop-color="${b.color}" stop-opacity="${b.opacity}"/><stop offset="1" stop-color="${b.color}" stop-opacity="0"/></radialGradient>`
    )
    .join('')
  const circles = opts.blobs
    .map((b, i) => `<circle cx="${b.cx}" cy="${b.cy}" r="${b.r}" fill="url(#g${i})"/>`)
    .join('')
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMid slice">` +
    `<defs><linearGradient id="base" x1="0" y1="0" x2="0.85" y2="1">${stops}</linearGradient>${grads}</defs>` +
    `<rect width="1600" height="1000" fill="url(#base)"/>${circles}</svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

const LIGHT = meshSvg({
  base: ['#fdfdff', '#eef2f9', '#e4ebf6'],
  blobs: [
    { cx: 250, cy: 140, r: 520, color: '#c3d8ff', opacity: 0.9 },
    { cx: 1420, cy: 210, r: 470, color: '#ffe0cf', opacity: 0.75 },
    { cx: 1180, cy: 900, r: 540, color: '#d8d0ff', opacity: 0.6 },
    { cx: 420, cy: 880, r: 500, color: '#cdeee0', opacity: 0.55 },
  ],
})

const DARK = meshSvg({
  base: ['#0b0d14', '#12131d', '#080a10'],
  blobs: [
    { cx: 220, cy: 160, r: 560, color: '#2f4bff', opacity: 0.34 },
    { cx: 1440, cy: 180, r: 500, color: '#14b8a6', opacity: 0.2 },
    { cx: 1200, cy: 920, r: 560, color: '#7c3aed', opacity: 0.28 },
    { cx: 380, cy: 900, r: 520, color: '#0ea5e9', opacity: 0.16 },
  ],
})

export const BUILTIN_WALLPAPERS: WallpaperItem[] = [
  {
    id: 'builtin-light',
    name: '默认 · 晨雾白',
    url: LIGHT,
    type: 'image/svg+xml',
    sourcePath: null,
    builtin: true,
  },
  {
    id: 'builtin-dark',
    name: '默认 · 深海夜',
    url: DARK,
    type: 'image/svg+xml',
    sourcePath: null,
    builtin: true,
  },
]

export function isBuiltinWallpaper(id: string | null | undefined): boolean {
  return !!id && BUILTIN_WALLPAPERS.some((w) => w.id === id)
}
