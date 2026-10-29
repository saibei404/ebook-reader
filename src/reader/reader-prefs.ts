/** 阅读窗口排版偏好：与书籍无关，全部本地保存（IndexedDB kv） */
import { getKV, setKV } from '@/lib/db'

export type ReaderTheme = 'paper' | 'sepia' | 'night' | 'system'

export interface ReaderPrefs {
  fontSize: number // px，TXT/EPUB/FB2 生效
  lineHeight: number // 倍数
  maxWidth: number // 正文最大宽度（px），0 = 铺满
  fontFamily: 'serif' | 'sans' | 'kai'
  theme: ReaderTheme
  /** PDF 默认缩放模式 */
  pdfScale: 'page-width' | 'page-fit' | 'auto'
}

export const DEFAULT_PREFS: ReaderPrefs = {
  fontSize: 19,
  lineHeight: 1.85,
  maxWidth: 720,
  fontFamily: 'serif',
  theme: 'system',
  pdfScale: 'page-width',
}

const KEY = 'reader-prefs'

export async function loadPrefs(): Promise<ReaderPrefs> {
  try {
    const saved = await getKV<Partial<ReaderPrefs>>(KEY)
    return { ...DEFAULT_PREFS, ...(saved ?? {}) }
  } catch {
    return DEFAULT_PREFS
  }
}

export async function savePrefs(p: ReaderPrefs): Promise<void> {
  try {
    await setKV(KEY, p)
  } catch {
    /* 偏好保存失败不应影响阅读 */
  }
}

export const FONT_STACK: Record<ReaderPrefs['fontFamily'], string> = {
  serif: '"Songti SC", "SimSun", "Source Han Serif SC", Georgia, serif',
  sans: '"PingFang SC", "Microsoft YaHei", "Helvetica Neue", system-ui, sans-serif',
  kai: '"Kaiti SC", "KaiTi", "STKaiti", serif',
}

/** 主题 → 背景/文字色（paper 走浅色，night 走深色，system 跟随主窗口设置） */
export function themeColors(theme: ReaderTheme, systemDark: boolean): { bg: string; fg: string; sub: string } {
  const dark = theme === 'night' || (theme === 'system' && systemDark)
  if (dark) return { bg: '#111113', fg: '#e8e6e3', sub: 'rgba(232,230,227,0.55)' }
  if (theme === 'sepia') return { bg: '#f4ecd8', fg: '#3b3226', sub: 'rgba(59,50,38,0.55)' }
  return { bg: '#faf9f6', fg: '#26241f', sub: 'rgba(38,36,31,0.55)' }
}
