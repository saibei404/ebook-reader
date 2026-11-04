import { useEffect, useMemo } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useStore } from '@/store/useStore'
import { WALLPAPER_FITS, type WallpaperFit } from '@/types/book'

/** 取壁纸平均色 + 相对亮度（0~1），亮度用来判断浅色模式要不要给表面兜底 */
function averageColor(url: string): Promise<{ css: string; lum: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = 24
        c.height = 24
        const ctx = c.getContext('2d')
        if (!ctx) return resolve({ css: '', lum: -1 })
        ctx.drawImage(img, 0, 0, 24, 24)
        const d = ctx.getImageData(0, 0, 24, 24).data
        let r = 0
        let g = 0
        let b = 0
        const n = d.length / 4
        for (let i = 0; i < d.length; i += 4) {
          r += d[i]
          g += d[i + 1]
          b += d[i + 2]
        }
        const ar = r / n
        const ag = g / n
        const ab = b / n
        // sRGB → 相对亮度（WCAG 同款系数）；不追求精确，够判断"深/浅"即可
        const lin = (v: number) => {
          const s = v / 255
          return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
        }
        const lum = 0.2126 * lin(ar) + 0.7152 * lin(ag) + 0.0722 * lin(ab)
        resolve({ css: `rgb(${Math.round(ar)}, ${Math.round(ag)}, ${Math.round(ab)})`, lum })
      } catch {
        resolve({ css: '', lum: -1 })
      }
    }
    img.onerror = () => resolve({ css: '', lum: -1 })
    img.src = url
  })
}

/**
 * 壁纸底纹层（纯净底座模式）：
 * - 系统预设壁纸已移除，仅渲染用户导入的本地壁纸（图片/视频）；
 * - 渲染层级：壁纸媒体（z0）→ 主题适配罩（z1）→ 界面 Shell（z2）；
 * - 亮度适配：浅色模式叠加白色提亮罩（高亮度），深色模式叠加黑色压暗罩（低亮度），
 *   强度由 wallpaperDim 控制，深浅切换时罩色即时过渡（0.25s）；
 * - 仍从壁纸取平均色写入 --wall-tint 供云母材质使用。
 */
export function WallpaperLayer() {
  const { settings, wallpapers, ui } = useStore()
  const url = useMemo(() => {
    if (settings.wallpaperId) {
      return wallpapers.find((w) => w.id === settings.wallpaperId)?.url ?? null
    }
    return null
  }, [settings.wallpaperId, wallpapers])

  const isVideo = useMemo(() => {
    if (!settings.wallpaperId) return false
    const w = wallpapers.find((x) => x.id === settings.wallpaperId)
    return !!w && w.type.startsWith('video')
  }, [settings.wallpaperId, wallpapers])

  const fit: WallpaperFit = ui.wallpaperPreviewFit ?? settings.wallpaperFit
  const fitInfo = WALLPAPER_FITS.find((f) => f.id === fit) ?? WALLPAPER_FITS[0]
  const zoom = settings.wallpaperZoom

  useEffect(() => {
    if (!url || isVideo) {
      // 视频壁纸取不到平均色：按"未知"处理，浅色下走不透明兜底，宁可保守
      if (isVideo) document.documentElement.dataset.bgLum = 'unknown'
      return
    }
    let alive = true
    void averageColor(url).then(({ css, lum }) => {
      if (!alive) return
      if (css) document.documentElement.style.setProperty('--wall-tint', css)
      // 浅色主题要据此决定「表面能不能半透明」：底下太暗就必须用不透明浅色合成，
      // 否则黑字压在深灰上，对比度直接崩掉。
      document.documentElement.dataset.bgLum = lum < 0 ? 'unknown' : lum < 0.45 ? 'dark' : 'light'
    })
    return () => {
      alive = false
    }
  }, [url, isVideo])

  // 「到底有没有壁纸」以这里解出来的 url 为准：settings.wallpaperId 可能指向一条
  // 已被删除/损坏的记录，那时不渲染任何媒体，底层就该按无壁纸的实色方案铺。
  useEffect(() => {
    document.documentElement.dataset.noWallpaper = url ? '0' : '1'
  }, [url])

  const mediaStyle = {
    objectFit: fitInfo.objectFit,
    transform: zoom !== 1 ? `scale(${zoom})` : undefined,
    transformOrigin: 'center',
  }

  if (!url) return null

  return (
    <div className="wallpaper-layer" aria-hidden>
      <AnimatePresence>
        {!isVideo && (
          <motion.img
            key={url}
            className="wallpaper-media"
            src={url}
            alt=""
            style={mediaStyle}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.7, ease: 'easeOut' }}
          />
        )}
        {isVideo && (
          <motion.video
            key={url}
            className="wallpaper-media"
            src={url}
            autoPlay
            loop
            muted
            playsInline
            style={mediaStyle}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.7 }}
          />
        )}
      </AnimatePresence>
      {/* 主题适配罩：浅色提亮（高亮度）/ 深色压暗（低亮度），由 CSS 变量按主题切换 */}
      <div className="wallpaper-dim" style={{ opacity: settings.wallpaperDim }} />
    </div>
  )
}
