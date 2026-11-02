export type BookFormat = 'epub' | 'pdf' | 'mobi' | 'azw3' | 'fb2' | 'txt' | 'md' | 'docx' | 'cbz' | 'cbr' | 'unknown'

/**
 * 阅读定位（locator）：跨格式统一的位置抽象，唯一真源。
 * - cfi：EPUB（epub.js CFI 字符串，精确定位到段落）
 * - page：PDF（1-based 页码）
 * - offset：TXT / FB2 / MD（字符偏移，配合 fontSize 变化仍可近似还原）
 * - index：CBZ（图片序号，0-based）
 * percent 恒为 0–1，用于书架圆环与统计，不参与精确恢复。
 */
export interface Locator {
  kind: 'cfi' | 'page' | 'offset' | 'index'
  value: string | number
  percent: number
  /** 章节/标题提示（可选，用于恢复时的视觉反馈） */
  label?: string
  /** EPUB 章节 href（CFI 定位失败时的兜底锚点） */
  href?: string
  /**
   * 像素滚动比例 0–1（scrollTop / (scrollHeight - clientHeight)）。
   * 文本类格式恢复时优先用它（与渲染高度直接对应，精度高于字符比例）；
   * 字号变化后可用 value(字符偏移) 兜底。
   */
  scrollRatio?: number
  updatedAt: number
}

export interface Book {
  id: string
  title: string
  author: string
  format: BookFormat
  addedAt: number
  lastReadAt: number | null
  progress: number
  /** 精确阅读位置；老数据缺失时以 progress 兜底 */
  locator?: Locator | null
  coverId: string | null
  coverSeed: number
  shelfId: string | null
  size: number
  sourcePath: string | null
  description: string
}

/** 书签：定位复用 locator，label 存快照（章节调整后仍可读） */
export interface Bookmark {
  id: string
  bookId: string
  locator: Locator
  /** 章节名 / 页码快照 */
  label: string
  /** 摘录文本（可选，来自当前页首段） */
  excerpt?: string
  createdAt: number
}

export type AnimMode = 'flip' | 'fade' | 'zoom' | 'slide' | 'stack'
export type MaterialStyle = 'frosted' | 'acrylic' | 'mica' | 'solid'
export type CardSize = 'sm' | 'md' | 'lg'
export type WallpaperFit = 'cover' | 'fill' | 'center' | 'contain' | 'stretch'

export const WALLPAPER_FITS: { id: WallpaperFit; label: string; hint: string; objectFit: 'cover' | 'none' | 'contain' | 'fill' }[] = [
  { id: 'cover', label: '覆盖', hint: '保持比例，裁剪溢出，铺满容器', objectFit: 'cover' },
  { id: 'fill', label: '填充', hint: '以铺满为目标，短边优先放大（与覆盖的差异：允许轻微形变容忍度更高，适合动图/视频避免黑边）', objectFit: 'cover' },
  { id: 'center', label: '居中', hint: '保持原始尺寸（可配缩放），容器中居中', objectFit: 'none' },
  { id: 'contain', label: '适应', hint: '保持比例，完整显示，允许留白', objectFit: 'contain' },
  { id: 'stretch', label: '拉伸', hint: '缩放到容器尺寸，允许形变', objectFit: 'fill' },
]

export interface Settings {
  theme: 'light' | 'dark'
  material: MaterialStyle
  animMode: AnimMode
  wallpaperId: string | null
  wallpaperDim: number
  wallpaperFit: WallpaperFit
  wallpaperZoom: number
  /** 书架内容区衬底不透明度（背景透明度）：越小壁纸越清晰 */
  contentOpacity: number
  /** Dock 栏（侧栏+顶栏）不透明度：必须显著低于 contentOpacity，壁纸在 Dock 下更明显 */
  dockOpacity: number
  cardSize: CardSize
  bossKey: string
  nativeAcrylic: boolean
}

export const ANIM_MODES: { id: AnimMode; label: string; hint: string }[] = [
  { id: 'flip', label: '翻页', hint: '3D 书页翻转入场，弹簧跟手' },
  { id: 'fade', label: '淡入', hint: '柔和平移淡入，最轻量' },
  { id: 'zoom', label: '缩放', hint: '由小到大弹出，活泼' },
  { id: 'slide', label: '滑入', hint: '左右交替滑入，节奏感' },
  { id: 'stack', label: '堆叠', hint: '卡片如洗牌般展开' },
]

export const MATERIALS: { id: MaterialStyle; label: string; hint: string }[] = [
  { id: 'frosted', label: '磨砂玻璃', hint: 'blur + 高饱和，通透柔和' },
  { id: 'acrylic', label: '亚克力', hint: '深层模糊 + 噪点 + 高光描边' },
  { id: 'mica', label: '云母', hint: '从壁纸取色的不透明材质' },
  { id: 'solid', label: '纯色', hint: '纯色表面，性能最好' },
]

export const FORMAT_LABEL: Record<BookFormat, string> = {
  epub: 'EPUB',
  pdf: 'PDF',
  mobi: 'MOBI',
  azw3: 'AZW3',
  fb2: 'FB2',
  txt: 'TXT',
  md: 'MD',
  docx: 'DOCX',
  cbz: 'CBZ',
  cbr: 'CBR',
  unknown: 'FILE',
}

export function formatFromName(name: string): BookFormat {
  const ext = name.toLowerCase().split('.').pop() || ''
  if (ext === 'epub') return 'epub'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'mobi') return 'mobi'
  if (ext === 'azw3' || ext === 'azw') return 'azw3'
  if (ext === 'fb2') return 'fb2'
  if (ext === 'txt') return 'txt'
  if (ext === 'md' || ext === 'markdown') return 'md'
  if (ext === 'docx' || ext === 'doc') return 'docx'
  if (ext === 'cbz') return 'cbz'
  if (ext === 'cbr') return 'cbr'
  return 'unknown'
}
