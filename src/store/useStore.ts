import { create } from 'zustand'
import type { Book, Settings, AnimMode, MaterialStyle, BookFormat, WallpaperFit } from '@/types/book'
import { formatFromName } from '@/types/book'
import {
  allBooks,
  putBook,
  deleteBook,
  putCover,
  deleteCover,
  putWallpaper,
  allWallpapers,
  deleteWallpaper,
  pruneBrokenWallpapers,
  getKV,
  setKV,
  deleteBookmarksOfBook,
  deleteAnnotationsOfBook,
} from '@/lib/db'
import { generateCoverDataUrl } from '@/lib/cover'
import { seedBooks } from '@/lib/seed'
import { nativeApi, type PickedFile } from '@/lib/native'

export const DEFAULT_SETTINGS: Settings = {
  theme: 'dark',
  material: 'frosted',
  animMode: 'flip',
  wallpaperId: null,
  wallpaperDim: 0.4,
  wallpaperFit: 'cover',
  wallpaperZoom: 1,
  contentOpacity: 0.66,
  dockOpacity: 0.55,
  cardSize: 'md',
  bossKey: 'Alt+X',
  nativeAcrylic: false,
}

export type SortKey = 'recent' | 'title' | 'author' | 'progress'
export type FilterKey = 'all' | 'reading' | 'unread' | 'done'

export interface ToastMsg {
  id: number
  text: string
  kind: 'info' | 'ok' | 'err'
}

export interface WallpaperItem {
  id: string
  name: string
  url: string
  type: string
  sourcePath: string | null
}

export interface NetpanEntry {
  key: string
  name: string
  isDir: boolean
  size: number
  path: string
}

export interface WebdavState {
  provider: 'webdav' | 'baidu'
  config: { url: string; username: string; password: string } | null
  baiduConfig: { appKey: string; appSecret: string } | null
  baiduAuth: { authorized: boolean; account: string }
  status: 'idle' | 'connecting' | 'importing' | 'ok' | 'error'
  entries: NetpanEntry[]
  currentPath: string
  selected: string[]
  error: string | null
  progress: { done: number; total: number; current: string }
  lastResult: { ok: number; fail: number; errors: string[] } | null
}

interface UIState {
  tab: 'library' | 'notes' | 'profile'
  search: string
  sort: SortKey
  filter: FilterKey
  selectedId: string | null
  coverEditing: boolean
  wallpaperOpen: boolean
  settingsSection: string
  toast: ToastMsg | null
  wallpaperPreviewFit: WallpaperFit | null
}

interface Store {
  books: Book[]
  settings: Settings
  covers: Record<string, string>
  procCovers: Record<string, string>
  wallpapers: WallpaperItem[]
  webdav: WebdavState
  hydrated: boolean
  ui: UIState
  hydrate: () => Promise<void>
  addBooksFromFiles: (files: File[]) => Promise<void>
  addBooksFromPicked: (picked: PickedFile[]) => Promise<void>
  updateBook: (id: string, patch: Partial<Book>) => Promise<void>
  removeBook: (id: string) => Promise<void>
  setCoverFromFile: (id: string, file: File) => Promise<void>
  randomizeCover: (id: string) => Promise<void>
  resetCover: (id: string) => Promise<void>
  importWallpaperFile: (file: File) => Promise<void>
  importWallpaperPicked: (picked: PickedFile) => Promise<void>
  removeWallpaper: (id: string) => Promise<void>
  setWallpaperDim: (n: number) => void
  setWallpaperFit: (fit: WallpaperFit) => void
  setWallpaperZoom: (z: number) => void
  setWallpaperPreviewFit: (fit: WallpaperFit | null) => void
  setNetpanProvider: (p: 'webdav' | 'baidu') => void
  setWebdavConfig: (c: { url: string; username: string; password: string }) => Promise<void>
  setBaiduConfig: (c: { appKey: string; appSecret: string }) => Promise<void>
  baiduAuthorize: () => Promise<void>
  baiduPollOnce: () => Promise<void>
  baiduLogout: () => Promise<void>
  netpanConnect: (subPath?: string) => Promise<void>
  netpanToggleSelect: (key: string) => void
  netpanImportSelected: () => Promise<void>
  setSettings: (patch: Partial<Settings>) => Promise<void>
  toast: (text: string, kind?: ToastMsg['kind']) => void
  dismissToast: (id: number) => void
  setUI: (patch: Partial<UIState>) => void
  openBook: (id: string | null) => void
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function applyDoc(s: Settings): void {
  const root = document.documentElement
  root.dataset.theme = s.theme
  root.dataset.material = s.material
  root.style.setProperty('--content-opacity', String(s.contentOpacity))
  root.style.setProperty('--dock-opacity', String(s.dockOpacity))
}

function readShotOverrides(): Partial<Settings> & { tab?: string; open?: string; cover?: boolean; sec?: string; wp?: string; scroll?: string; netpan?: string } {
  if (typeof location === 'undefined') return {}
  const p = new URLSearchParams(location.search)
  const o: Partial<Settings> & { tab?: string; open?: string; cover?: boolean; sec?: string; wp?: string; scroll?: string; netpan?: string } = {}
  const anim = p.get('anim')
  if (anim && ['flip', 'fade', 'zoom', 'slide', 'stack'].includes(anim)) o.animMode = anim as AnimMode
  const mat = p.get('material')
  if (mat && ['frosted', 'acrylic', 'mica', 'solid'].includes(mat)) o.material = mat as MaterialStyle
  const th = p.get('theme')
  if (th === 'light' || th === 'dark') o.theme = th
  const fit = p.get('fit')
  if (fit && ['cover', 'fill', 'center', 'contain', 'stretch'].includes(fit)) o.wallpaperFit = fit as WallpaperFit
  if (p.get('tab')) o.tab = p.get('tab') as string
  if (p.get('open')) o.open = p.get('open') as string
  if (p.get('cover')) o.cover = true
  if (p.get('sec')) o.sec = p.get('sec') as string
  if (p.get('wp')) o.wp = p.get('wp') as string
  if (p.get('scroll')) o.scroll = p.get('scroll') as string
  if (p.get('netpan')) o.netpan = p.get('netpan') as string
  return o
}

/** 进度完成阈值：与统计口径保持一致，避免 99.9% 处于分类盲区 */
export const DONE_THRESHOLD = 0.999

export function selectBooks(books: Book[], ui: UIState): Book[] {
  const q = ui.search.trim().toLowerCase()
  let list = books.filter((b) => {
    if (q && !`${b.title} ${b.author}`.toLowerCase().includes(q)) return false
    if (ui.filter === 'reading') return b.progress > 0 && b.progress < DONE_THRESHOLD
    if (ui.filter === 'unread') return b.progress === 0
    if (ui.filter === 'done') return b.progress >= DONE_THRESHOLD
    return true
  })
  list = [...list].sort((a, b) => {
    switch (ui.sort) {
      case 'title':
        return a.title.localeCompare(b.title, 'zh-Hans-CN')
      case 'author':
        return a.author.localeCompare(b.author, 'zh-Hans-CN')
      case 'progress':
        return b.progress - a.progress
      default:
        return (b.lastReadAt ?? b.addedAt) - (a.lastReadAt ?? a.addedAt)
    }
  })
  return list
}

let toastSeq = 1

/** 静态图片格式（WebView2/Chromium 确定支持解码） */
const STATIC_IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif']
/** 动图能力格式（是否动画取决于文件本身是否含多帧） */
const ANIMATED_EXTS = ['gif', 'webp', 'avif']
/** 需实际解码探测的格式（平台解码能力不一） */
const PROBE_EXTS = ['heic', 'heif', 'tif', 'tiff']
/** 视频壁纸格式 */
const VIDEO_EXTS = ['mp4', 'webm', 'mov']

function extOf(name: string): string {
  return name.toLowerCase().split('.').pop() || ''
}

/** 用 Image 实际解码验证格式是否被当前环境支持 */
function probeImage(dataUrl: string): Promise<{ ok: boolean; width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ ok: true, width: img.naturalWidth, height: img.naturalHeight })
    img.onerror = () => resolve({ ok: false, width: 0, height: 0 })
    img.src = dataUrl
  })
}

/** 判重：同本地路径、或同书名+同大小视为同一本书 */
function isDuplicate(book: Pick<Book, 'title' | 'size' | 'sourcePath'>, existing: Book[]): boolean {
  return existing.some(
    (b) =>
      (book.sourcePath && b.sourcePath && book.sourcePath === b.sourcePath) ||
      (b.title === book.title && b.size === book.size)
  )
}

export const useStore = create<Store>((setState, getState) => ({
  books: [],
  settings: DEFAULT_SETTINGS,
  covers: {},
  procCovers: {},
  wallpapers: [],
  webdav: {
    provider: 'webdav',
    config: null,
    baiduConfig: null,
    baiduAuth: { authorized: false, account: '' },
    status: 'idle',
    entries: [],
    currentPath: '',
    selected: [],
    error: null,
    progress: { done: 0, total: 0, current: '' },
    lastResult: null,
  },
  hydrated: false,
  ui: {
    tab: 'library',
    search: '',
    sort: 'recent',
    filter: 'all',
    selectedId: null,
    coverEditing: false,
    wallpaperOpen: false,
    settingsSection: 'appearance',
    toast: null,
    wallpaperPreviewFit: null,
  },
  hydrate: async () => {
    const now = Date.now()
    let books = await allBooks()

    // 种子数据只在「首次启动」播一次：用户删光书籍后重启不应复活示例书
    const seeded = await getKV<boolean>('seeded')
    const procCovers: Record<string, string> = {}
    if (books.length === 0 && !seeded) {
      books = seedBooks(now)
      for (const b of books) {
        await putBook(b)
        procCovers[b.id] = generateCoverDataUrl(b)
      }
      await setKV('seeded', true)
    }
    for (const b of books) {
      if (!procCovers[b.id]) procCovers[b.id] = generateCoverDataUrl(b)
    }

    // 壁纸记录容错：损坏记录（blob 丢失/为空）清理掉，避免 createObjectURL 抛错导致启动卡死
    let wpRecs: Awaited<ReturnType<typeof allWallpapers>> = []
    try {
      const broken = await pruneBrokenWallpapers()
      if (broken.length) console.warn('[hydrate] 已清理损坏壁纸记录:', broken)
      wpRecs = await allWallpapers()
    } catch (e) {
      console.warn('[hydrate] 壁纸读取失败，跳过:', e)
    }
    const wallpapers: WallpaperItem[] = []
    for (const w of wpRecs) {
      try {
        wallpapers.push({
          id: w.id,
          name: w.name,
          url: URL.createObjectURL(w.blob),
          type: w.type,
          sourcePath: w.sourcePath,
        })
      } catch {
        /* 单条损坏不阻断启动 */
      }
    }

    const webdavConfig = await getKV<{ url: string; username: string; password: string } | null>('webdav-config')
    const baiduConfig = await getKV<{ appKey: string; appSecret: string } | null>('baidu-config')
    let baiduAuth = { authorized: false, account: '' }
    if (nativeApi) {
      try {
        const st = await nativeApi.baiduAuthStatus()
        baiduAuth = { authorized: st.authorized, account: st.account }
      } catch {
        /* ignore */
      }
    }

    let settings = { ...DEFAULT_SETTINGS, ...(await getKV<Settings>('settings')) }
    if (nativeApi) {
      try {
        const ns = await nativeApi.getSettings()
        settings = {
          ...settings,
          ...(ns.theme ? { theme: ns.theme as Settings['theme'] } : {}),
          ...(ns.material ? { material: ns.material as Settings['material'] } : {}),
          ...(ns.bossKey ? { bossKey: ns.bossKey as string } : {}),
          ...(ns.nativeAcrylic !== undefined ? { nativeAcrylic: !!ns.nativeAcrylic } : {}),
        }
      } catch {
        /* ignore */
      }
    }

    const ov = readShotOverrides()
    const uiPatch: Partial<UIState> = {}
    if (ov.tab === 'settings' || ov.tab === 'explore') uiPatch.tab = 'profile'
    else if (ov.tab === 'notes' || ov.tab === 'profile') uiPatch.tab = ov.tab
    if (ov.open) uiPatch.selectedId = ov.open
    if (ov.cover) uiPatch.coverEditing = true
    if (ov.wp) uiPatch.wallpaperOpen = true
    if (ov.sec) uiPatch.settingsSection = ov.sec
    const { tab: _t, open: _o, cover: _c, sec: _s, wp: _w, scroll: _s2, netpan: _n, ...settingsOverride } = ov

    const merged = { ...settings, ...settingsOverride }
    applyDoc(merged)
    setState({
      books,
      settings: merged,
      procCovers,
      covers: {},
      wallpapers,
      webdav: {
        ...getState().webdav,
        provider: ov.netpan === 'baidu' ? 'baidu' : getState().webdav.provider,
        config: webdavConfig ?? null,
        baiduConfig: baiduConfig ?? null,
        baiduAuth,
      },
      hydrated: true,
      ui: { ...getState().ui, ...uiPatch },
    })
  },

  addBooksFromFiles: async (files) => {
    const now = Date.now()
    const created: Book[] = []
    let dup = 0
    for (const f of files) {
      const book: Book = {
        id: uid('b'),
        title: f.name.replace(/\.[^.]+$/, ''),
        author: '本地导入',
        format: formatFromName(f.name) as BookFormat,
        addedAt: now,
        lastReadAt: null,
        progress: 0,
        coverId: null,
        coverSeed: Math.floor(Math.random() * 100000),
        shelfId: null,
        size: f.size,
        sourcePath: null,
        description: '',
      }
      if (isDuplicate(book, getState().books)) {
        dup++
        continue
      }
      await putBook(book)
      created.push(book)
    }
    if (created.length) {
      setState((s) => ({
        books: [...s.books, ...created],
        procCovers: {
          ...s.procCovers,
          ...Object.fromEntries(created.map((b) => [b.id, generateCoverDataUrl(b)])),
        },
      }))
    }
    if (created.length) getState().toast(`已导入 ${created.length} 本书${dup ? `，跳过 ${dup} 本重复` : ''}`, 'ok')
    else getState().toast(`所选 ${dup} 本书已在书架中`, 'info')
  },

  addBooksFromPicked: async (picked) => {
    const now = Date.now()
    const created: Book[] = []
    let dup = 0
    for (const p of picked) {
      const book: Book = {
        id: uid('b'),
        title: p.name.replace(/\.[^.]+$/, ''),
        author: '本地导入',
        format: formatFromName(p.name) as BookFormat,
        addedAt: now,
        lastReadAt: null,
        progress: 0,
        coverId: null,
        coverSeed: Math.floor(Math.random() * 100000),
        shelfId: null,
        size: p.size,
        sourcePath: p.path,
        description: '',
      }
      if (isDuplicate(book, getState().books)) {
        dup++
        continue
      }
      await putBook(book)
      created.push(book)
    }
    if (created.length) {
      setState((s) => ({
        books: [...s.books, ...created],
        procCovers: {
          ...s.procCovers,
          ...Object.fromEntries(created.map((b) => [b.id, generateCoverDataUrl(b)])),
        },
      }))
      getState().toast(`已导入 ${created.length} 本书${dup ? `，跳过 ${dup} 本重复` : ''}`, 'ok')
    } else {
      getState().toast(`所选 ${dup} 本书已在书架中`, 'info')
    }
  },

  updateBook: async (id, patch) => {
    const books = getState().books.map((b) => (b.id === id ? { ...b, ...patch } : b))
    setState({ books })
    const target = books.find((b) => b.id === id)
    if (target) await putBook(target)
  },

  removeBook: async (id) => {
    const book = getState().books.find((b) => b.id === id)
    if (book?.coverId) await deleteCover(book.coverId)
    await deleteBook(id)
    await deleteBookmarksOfBook(id)
    await deleteAnnotationsOfBook(id)
    setState((s) => {
      // 同步清理封面缓存，避免长期使用后内存中累积已删除书籍的 dataURL
      const procCovers = { ...s.procCovers }
      delete procCovers[id]
      const covers = { ...s.covers }
      if (book?.coverId) delete covers[book.coverId]
      return {
        books: s.books.filter((b) => b.id !== id),
        procCovers,
        covers,
        ui: { ...s.ui, selectedId: s.ui.selectedId === id ? null : s.ui.selectedId },
      }
    })
    getState().toast('已移除书籍', 'info')
  },

  setCoverFromFile: async (id, file) => {
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader()
      r.onload = () => resolve(String(r.result))
      r.onerror = () => reject(r.error)
      r.readAsDataURL(file)
    })
    const coverId = uid('cov')
    await putCover({ id: coverId, dataUrl, createdAt: Date.now() })
    const old = getState().books.find((b) => b.id === id)
    if (old?.coverId) await deleteCover(old.coverId)
    await getState().updateBook(id, { coverId })
    setState((s) => ({ covers: { ...s.covers, [coverId]: dataUrl } }))
    getState().toast('封面已更换', 'ok')
  },

  randomizeCover: async (id) => {
    const book = getState().books.find((b) => b.id === id)
    if (!book) return
    const seed = Math.floor(Math.random() * 100000)
    const dataUrl = generateCoverDataUrl({ ...book, coverSeed: seed })
    setState((s) => ({ procCovers: { ...s.procCovers, [id]: dataUrl } }))
    await getState().updateBook(id, { coverSeed: seed, coverId: null })
    getState().toast('已随机生成新封面', 'ok')
  },

  resetCover: async (id) => {
    const book = getState().books.find((b) => b.id === id)
    if (!book) return
    if (book.coverId) await deleteCover(book.coverId)
    const dataUrl = generateCoverDataUrl(book)
    setState((s) => ({ procCovers: { ...s.procCovers, [id]: dataUrl } }))
    await getState().updateBook(id, { coverId: null })
    getState().toast('已恢复默认封面', 'info')
  },

  /**
   * 导入本地壁纸：格式白名单 + 实际解码探测。
   * - 静态格式（png/jpg/jpeg/webp/gif/bmp/avif）直接接受；
   * - heic/heif/tif/tiff 先探测，环境可解码则接受并提示，否则明确拒绝；
   * - mp4/webm/mov 作为视频壁纸接受；
   * - 动图能力格式（gif/webp/avif）是否播放动画取决于文件本身是否含多帧。
   */
  importWallpaperFile: async (file) => {
    const ext = extOf(file.name)
    const isVideo = VIDEO_EXTS.includes(ext)
    if (!isVideo && !STATIC_IMAGE_EXTS.includes(ext) && !PROBE_EXTS.includes(ext)) {
      getState().toast(`不支持的格式：.${ext}（支持 JPEG/PNG/WebP/GIF/BMP/AVIF/HEIC/TIFF 及 MP4/WebM/MOV）`, 'err')
      return
    }
    if (file.size > 100 * 1024 * 1024) {
      getState().toast('文件超过 100MB，无法导入', 'err')
      return
    }

    let dataUrl = ''
    try {
      dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result))
        r.onerror = () => reject(r.error)
        r.readAsDataURL(file)
      })
    } catch {
      getState().toast('读取文件失败', 'err')
      return
    }

    if (!isVideo && PROBE_EXTS.includes(ext)) {
      const probe = await probeImage(dataUrl)
      if (!probe.ok) {
        getState().toast(`当前环境无法解码 .${ext} 格式，已取消导入`, 'err')
        return
      }
      getState().toast(`.${ext} 格式本机可解码，导入成功`, 'ok')
    }

    const blob = await (await fetch(dataUrl)).blob()
    const id = uid('wp')
    await putWallpaper({
      id,
      blob,
      type: file.type || blob.type,
      name: file.name,
      sourcePath: null,
      createdAt: Date.now(),
    })
    const item: WallpaperItem = {
      id,
      name: file.name,
      url: URL.createObjectURL(blob),
      type: blob.type,
      sourcePath: null,
    }
    setState((s) => ({
      wallpapers: [...s.wallpapers, item],
      settings: { ...s.settings, wallpaperId: id },
    }))
    await getState().setSettings({ wallpaperId: id })
    if (!isVideo && ANIMATED_EXTS.includes(ext)) {
      getState().toast('壁纸已导入（动图能力格式，是否播放动画取决于文件本身）', 'ok')
    } else {
      getState().toast('壁纸已导入', 'ok')
    }
  },

  importWallpaperPicked: async (picked) => {
    let dataUrl = ''
    try {
      dataUrl = await nativeApi!.readFileDataUrl(picked.path)
    } catch {
      getState().toast('读取文件失败', 'err')
      return
    }
    const ext = extOf(picked.name)
    const isVideo = VIDEO_EXTS.includes(ext)
    if (!isVideo && !STATIC_IMAGE_EXTS.includes(ext) && !PROBE_EXTS.includes(ext)) {
      getState().toast(`不支持的格式：.${ext}`, 'err')
      return
    }
    if (!isVideo && PROBE_EXTS.includes(ext)) {
      const probe = await probeImage(dataUrl)
      if (!probe.ok) {
        getState().toast(`当前环境无法解码 .${ext} 格式，已取消导入`, 'err')
        return
      }
    }
    const blob = await (await fetch(dataUrl)).blob()
    const id = uid('wp')
    await putWallpaper({
      id,
      blob,
      type: blob.type || 'image/png',
      name: picked.name,
      sourcePath: picked.path,
      createdAt: Date.now(),
    })
    const item: WallpaperItem = {
      id,
      name: picked.name,
      url: URL.createObjectURL(blob),
      type: blob.type || 'image/png',
      sourcePath: picked.path,
    }
    setState((s) => ({
      wallpapers: [...s.wallpapers, item],
      settings: { ...s.settings, wallpaperId: id },
    }))
    await getState().setSettings({ wallpaperId: id })
    getState().toast('壁纸已导入', 'ok')
  },

  removeWallpaper: async (id) => {
    const wasCurrent = getState().settings.wallpaperId === id
    await deleteWallpaper(id)
    setState((s) => ({
      wallpapers: s.wallpapers.filter((w) => w.id !== id),
      // 系统预设壁纸已移除：删除当前壁纸后回退纯净底色（无壁纸状态）
      settings: wasCurrent ? { ...s.settings, wallpaperId: null } : s.settings,
    }))
    if (wasCurrent) {
      await getState().setSettings({ wallpaperId: null })
      getState().toast('已删除壁纸，恢复纯净底色', 'info')
    } else {
      getState().toast('已删除壁纸', 'info')
    }
  },

  setWallpaperDim: (n) => {
    setState((s) => ({ settings: { ...s.settings, wallpaperDim: n } }))
    void setKV('settings', { ...getState().settings, wallpaperDim: n })
  },

  setWallpaperFit: (fit) => {
    setState((s) => ({ settings: { ...s.settings, wallpaperFit: fit } }))
    void setKV('settings', { ...getState().settings, wallpaperFit: fit })
  },

  setWallpaperZoom: (z) => {
    setState((s) => ({ settings: { ...s.settings, wallpaperZoom: z } }))
    void setKV('settings', { ...getState().settings, wallpaperZoom: z })
  },

  setWallpaperPreviewFit: (fit) => setState((s) => ({ ui: { ...s.ui, wallpaperPreviewFit: fit } })),

  setNetpanProvider: (p) =>
    setState((s) => ({
      webdav: { ...s.webdav, provider: p, status: 'idle', entries: [], selected: [], currentPath: '', error: null, lastResult: null },
    })),

  setWebdavConfig: async (c) => {
    setState((s) => ({ webdav: { ...s.webdav, config: c, error: null } }))
    await setKV('webdav-config', c)
  },

  setBaiduConfig: async (c) => {
    setState((s) => ({ webdav: { ...s.webdav, baiduConfig: c, error: null } }))
    await setKV('baidu-config', c)
  },

  /** 百度网盘：设备码授权（主进程打开系统浏览器） */
  baiduAuthorize: async () => {
    if (!nativeApi) {
      getState().toast('百度网盘导入仅在桌面客户端可用', 'err')
      return
    }
    const cfg = getState().webdav.baiduConfig
    if (!cfg?.appKey || !cfg.appSecret) {
      setState((s) => ({ webdav: { ...s.webdav, status: 'error', error: '请先填写 AppKey 与 AppSecret' } }))
      return
    }
    setState((s) => ({ webdav: { ...s.webdav, status: 'connecting', error: null } }))
    const r = await nativeApi.baiduAuthStart({ appKey: cfg.appKey, appSecret: cfg.appSecret })
    if (!r.ok || !r.info) {
      setState((s) => ({ webdav: { ...s.webdav, status: 'error', error: r.error ?? '授权启动失败' } }))
      getState().toast(`授权失败：${r.error ?? '未知错误'}`, 'err')
      return
    }
    setState((s) => ({
      webdav: { ...s.webdav, status: 'ok', error: null, currentPath: `__auth__:${r.info!.userCode}` },
    }))
    getState().toast('浏览器已打开，请完成百度账号授权', 'info')
  },

  /** 授权轮询一次（UI 定时调用） */
  baiduPollOnce: async () => {
    if (!nativeApi) return
    const r = await nativeApi.baiduAuthPoll()
    if (r.ok && !r.pending) {
      setState((s) => ({ webdav: { ...s.webdav, baiduAuth: { authorized: true, account: r.account ?? '' }, currentPath: '' } }))
      getState().toast(`百度网盘授权成功${r.account ? `：${r.account}` : ''}`, 'ok')
      void getState().netpanConnect('')
    } else if (!r.ok) {
      setState((s) => ({ webdav: { ...s.webdav, status: 'error', error: r.error ?? '授权失败', currentPath: '' } }))
      getState().toast(`授权失败：${r.error ?? '未知错误'}`, 'err')
    }
  },

  baiduLogout: async () => {
    if (!nativeApi) return
    await nativeApi.baiduLogout()
    setState((s) => ({
      webdav: { ...s.webdav, baiduAuth: { authorized: false, account: '' }, entries: [], selected: [], currentPath: '', status: 'idle' },
    }))
    getState().toast('已退出百度网盘账号', 'info')
  },

  /** 连接并列目录（按 provider 分支，默认根目录） */
  netpanConnect: async (subPath) => {
    if (!nativeApi) {
      getState().toast('网盘导入仅在桌面客户端可用', 'err')
      return
    }
    const wd = getState().webdav
    const target = subPath ?? ''
    setState((s) => ({
      webdav: { ...s.webdav, status: 'connecting', error: null, currentPath: target, selected: [] },
    }))
    if (wd.provider === 'baidu') {
      const cfg = wd.baiduConfig
      if (!cfg?.appKey) {
        setState((s) => ({ webdav: { ...s.webdav, status: 'error', error: '请先填写 AppKey 与 AppSecret' } }))
        return
      }
      if (!wd.baiduAuth.authorized) {
        setState((s) => ({ webdav: { ...s.webdav, status: 'error', error: '请先完成百度账号授权' } }))
        return
      }
      const r = await nativeApi.baiduList({ appKey: cfg.appKey, appSecret: cfg.appSecret, path: target || '/' })
      if (!r.ok) {
        setState((s) => ({ webdav: { ...s.webdav, status: 'error', error: r.error ?? '连接失败' } }))
        getState().toast(`百度网盘连接失败：${r.error ?? '未知错误'}`, 'err')
        return
      }
      setState((s) => ({
        webdav: {
          ...s.webdav,
          status: 'ok',
          currentPath: target,
          entries: (r.entries ?? []).map((e) => ({ key: String(e.fsid), name: e.name, isDir: e.isDir, size: e.size, path: e.path })),
        },
      }))
      return
    }
    // WebDAV
    const cfg = wd.config
    if (!cfg?.url || !cfg.username) {
      setState((s) => ({ webdav: { ...s.webdav, status: 'error', error: '请先填写服务器地址与用户名' } }))
      return
    }
    const r = await nativeApi.webdavList({ url: cfg.url, path: target, username: cfg.username, password: cfg.password })
    if (!r.ok) {
      setState((s) => ({ webdav: { ...s.webdav, status: 'error', error: r.error ?? '连接失败' } }))
      getState().toast(`网盘连接失败：${r.error ?? '未知错误'}`, 'err')
      return
    }
    setState((s) => ({
      webdav: {
        ...s.webdav,
        status: 'ok',
        entries: (r.entries ?? []).map((e) => ({ key: e.href, name: e.name, isDir: e.isDir, size: e.size, path: e.href })),
        currentPath: target,
      },
    }))
  },

  netpanToggleSelect: (key) => {
    setState((s) => ({
      webdav: {
        ...s.webdav,
        selected: s.webdav.selected.includes(key)
          ? s.webdav.selected.filter((h) => h !== key)
          : [...s.webdav.selected, key],
      },
    }))
  },

  /** 下载所选文件并逐本导入书架（按 provider 分支） */
  netpanImportSelected: async () => {
    if (!nativeApi) {
      getState().toast('网盘导入仅在桌面客户端可用', 'err')
      return
    }
    const wd = getState().webdav
    const targets = wd.entries.filter((e) => !e.isDir && wd.selected.includes(e.key))
    if (targets.length === 0) {
      getState().toast('请先选择要导入的文件', 'err')
      return
    }
    setState((s) => ({
      webdav: { ...s.webdav, status: 'importing', error: null, progress: { done: 0, total: targets.length, current: '' }, lastResult: null },
    }))
    const errors: string[] = []
    let ok = 0
    for (let i = 0; i < targets.length; i++) {
      const t = targets[i]
      setState((s) => ({ webdav: { ...s.webdav, progress: { done: i, total: targets.length, current: t.name } } }))
      let dl: { ok: boolean; path?: string; name?: string; size?: number; error?: string }
      if (wd.provider === 'baidu') {
        const cfg = wd.baiduConfig!
        dl = await nativeApi.baiduDownload({ appKey: cfg.appKey, appSecret: cfg.appSecret, fsid: Number(t.key), name: t.name })
      } else {
        const cfg = wd.config!
        dl = await nativeApi.webdavDownload({ url: cfg.url, path: t.path, username: cfg.username, password: cfg.password })
      }
      if (!dl.ok || !dl.path) {
        errors.push(`${t.name}：${dl.error ?? '下载失败'}`)
        continue
      }
      try {
        await getState().addBooksFromPicked([{ path: dl.path, name: dl.name ?? t.name, size: dl.size ?? t.size }])
        ok++
      } catch (e) {
        errors.push(`${t.name}：导入失败 ${String(e).slice(0, 80)}`)
      }
    }
    setState((s) => ({
      webdav: { ...s.webdav, status: 'ok', progress: { done: targets.length, total: targets.length, current: '' }, lastResult: { ok, fail: errors.length, errors } },
    }))
    if (errors.length === 0) {
      getState().toast(`网盘导入完成：${ok} 本书已加入书架`, 'ok')
    } else {
      getState().toast(`导入完成：成功 ${ok} 本，失败 ${errors.length} 本（详见列表）`, 'err')
    }
  },

  setSettings: async (patch) => {
    const prev = getState().settings
    const next = { ...prev, ...patch }
    applyDoc(next)
    setState({ settings: next })
    await setKV('settings', next)
    if (nativeApi) {
      await nativeApi.saveSettings({
        theme: next.theme,
        material: next.material,
        nativeAcrylic: next.nativeAcrylic,
        bossKey: next.bossKey,
      })
    }
    // 仅在「窗口级原生亚克力的生效状态」发生翻转时才重建窗口：
    // transparent / backgroundMaterial 只能在创建时决定，普通材质切换（frosted/mica/solid 互切，
    // 或未开启原生亚克力时）走纯 CSS 即可，重建窗口既无必要也会引发闪退。
    const useNative = (s: { nativeAcrylic: boolean; material: string }) =>
      s.nativeAcrylic && s.material === 'acrylic'
    if (useNative(prev) !== useNative(next) && nativeApi) {
      nativeApi.recreateWindow()
    }
  },

  toast: (text, kind = 'info') => {
    const id = toastSeq++
    setState((s) => ({ ui: { ...s.ui, toast: { id, text, kind } } }))
  },

  dismissToast: (id) => {
    if (getState().ui.toast?.id === id) {
      setState((s) => ({ ui: { ...s.ui, toast: null } }))
    }
  },

  setUI: (patch) => setState((s) => ({ ui: { ...s.ui, ...patch } })),

  openBook: (id) => setState((s) => ({ ui: { ...s.ui, selectedId: id, coverEditing: false } })),
}))
