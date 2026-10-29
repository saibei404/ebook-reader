import { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, dialog, nativeImage, shell, protocol } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'
import { davList, davDownload } from './netpan'
import {
  baiduStartAuth,
  baiduPollAuth,
  baiduAuthStatus,
  baiduLogout,
  baiduList,
  baiduDownload,
} from './baidu'

const isShot = process.argv.includes('--shot')

/**
 * 书籍本地文件协议：moyu-file://f/<base64url(绝对路径)>
 * 目的：让 PDF 这类可能上百 MB 的文件由引擎按 Range 分块流式读取，
 * 不必把整个文件经 IPC 结构化克隆复制进渲染进程内存（277MB 会放大成 1GB+ 峰值）。
 */
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'moyu-file',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      bypassCSP: true,
      stream: true,
    },
  },
])

function toBookUrl(absPath: string): string {
  return `moyu-file://f/${Buffer.from(absPath, 'utf8').toString('base64url')}`
}

function bookUrlToPath(url: string): string | null {
  try {
    const u = new URL(url)
    if (u.protocol !== 'moyu-file:') return null
    const raw = u.pathname.replace(/^\/+/, '')
    if (!raw) return null
    const decoded = Buffer.from(decodeURIComponent(raw), 'base64url').toString('utf8')
    return path.isAbsolute(decoded) ? decoded : null
  } catch {
    return null
  }
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  epub: 'application/epub+zip',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  fb2: 'application/xml; charset=utf-8',
  cbz: 'application/zip',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
}

/** 注册书籍文件协议处理器（支持 Range，供 pdf.js 分块加载） */
function registerBookProtocol(): void {
  protocol.handle('moyu-file', async (request) => {
    const filePath = bookUrlToPath(request.url)
    if (!filePath) return new Response('bad url', { status: 400 })

    let st: fs.Stats
    try {
      st = await fs.promises.stat(filePath)
    } catch {
      return new Response('not found', { status: 404 })
    }
    if (!st.isFile()) return new Response('not a file', { status: 404 })

    const size = st.size
    const type = MIME_BY_EXT[path.extname(filePath).slice(1).toLowerCase()] ?? 'application/octet-stream'
    const rangeHeader = request.headers.get('range') || ''
    const m = /bytes=(\d*)-(\d*)/i.exec(rangeHeader)

    if (m && (m[1] || m[2])) {
      let start = m[1] ? Number.parseInt(m[1], 10) : 0
      let end = m[2] ? Number.parseInt(m[2], 10) : size - 1
      // bytes=-N（后缀范围）：取末尾 N 字节
      if (!m[1] && m[2]) {
        start = Math.max(0, size - Number.parseInt(m[2], 10))
        end = size - 1
      }
      if (!Number.isFinite(start) || start >= size || start < 0) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
      }
      end = Math.min(Number.isFinite(end) ? end : size - 1, size - 1)
      const stream = fs.createReadStream(filePath, { start, end })
      return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
        status: 206,
        headers: {
          'Content-Type': type,
          'Content-Length': String(end - start + 1),
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store',
        },
      })
    }

    const stream = fs.createReadStream(filePath)
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream, {
      status: 200,
      headers: {
        'Content-Type': type,
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      },
    })
  })
}

interface AppSettings {
  theme?: 'light' | 'dark'
  material?: string
  nativeAcrylic?: boolean
  bossKey?: string
}

let mainWin: BrowserWindow | null = null
let tray: Tray | null = null
/** 独立阅读窗口（全屏沉浸） */
let readerWin: BrowserWindow | null = null
/** 阅读窗口正在创建中（防重复创建） */
let readerOpening = false
/** 窗口重建中（防重入） */
let recreating = false

/** 写入 userData/crash.log，便于事后定位窗口/进程异常 */
function logCrash(message: string): void {
  try {
    fs.appendFileSync(path.join(app.getPath('userData'), 'crash.log'), `[${new Date().toISOString()}] ${message}\n`)
  } catch {
    /* ignore */
  }
}

/** 取仍在存活的窗口（避免访问已销毁对象抛错） */
function aliveWin(): BrowserWindow | null {
  return mainWin && !mainWin.isDestroyed() ? mainWin : null
}

function aliveReader(): BrowserWindow | null {
  return readerWin && !readerWin.isDestroyed() ? readerWin : null
}

/**
 * 创建独立全屏阅读窗口。
 * 采用「无边框 + maximize」而非 fullscreen(true)：后者在多显示器/缩放切换时
 * 容易出现黑边与退出后尺寸错乱（Windows 已知问题）。
 * 使用独立 HTML 入口（reader.html），epub.js / pdf.js 仅在此窗口按需加载，
 * 主窗口包体与内存零负担。
 */
function openReaderWin(bookId: string): void {
  const existing = aliveReader()
  if (existing) {
    // 已有阅读窗口：切换书籍并聚焦（不重复建窗）
    const base = process.env.ELECTRON_RENDERER_URL
    const url = base
      ? `${base}/reader.html?bookId=${encodeURIComponent(bookId)}`
      : undefined
    if (url) void existing.loadURL(url)
    else
      void existing.loadFile(path.join(__dirname, '../renderer/reader.html'), {
        search: `?bookId=${encodeURIComponent(bookId)}`,
      })
    existing.show()
    existing.focus()
    return
  }
  if (readerOpening) return
  readerOpening = true
  try {
    const s = readSettings()
    const win = new BrowserWindow({
      width: 1200,
      height: 900,
      minWidth: 720,
      minHeight: 560,
      frame: false,
      show: false,
      backgroundColor: s.theme === 'light' ? '#f7f6f2' : '#111113',
      icon: assetPath('resources', 'icon.png'),
      webPreferences: {
        preload: path.join(__dirname, '../preload/preload.js'),
        contextIsolation: true,
        sandbox: false,
        // 必须与主窗口共用默认 session：
        // 1) IndexedDB 库（书架/定位/偏好）在同源同分区才可见，独立分区会读不到书；
        // 2) BroadcastChannel 也只在同一分区内通信，位置变更无法回传书架。
      },
    })
    readerWin = win

    win.once('ready-to-show', () => {
      win.maximize()
      win.show()
    })
    win.on('closed', () => {
      readerWin = null
    })
    win.webContents.on('render-process-gone', (_e, details) => {
      logCrash(`reader render-process-gone: ${JSON.stringify(details)}`)
      // 阅读窗口崩溃不应拖垮主窗口：仅提示并销毁残留
      if (!win.isDestroyed()) win.destroy()
      readerWin = null
      const w = aliveWin()
      w?.show()
      w?.focus()
      w?.webContents.send('moyu:reader-crashed')
    })

    const base = process.env.ELECTRON_RENDERER_URL
    if (base) void win.loadURL(`${base}/reader.html?bookId=${encodeURIComponent(bookId)}`)
    else
      void win.loadFile(path.join(__dirname, '../renderer/reader.html'), {
        search: `?bookId=${encodeURIComponent(bookId)}`,
      })
  } finally {
    readerOpening = false
  }
}

/** 关闭阅读窗口并回到主窗口 */
function closeReaderWin(): void {
  const w = aliveReader()
  if (w) w.destroy()
  readerWin = null
  const m = aliveWin()
  m?.show()
  m?.focus()
}
let quitting = false
let currentAccel = 'Alt+X'

function settingsPath(): string {
  return path.join(app.getPath('userData'), 'settings.json')
}

function readSettings(): AppSettings {
  try {
    return JSON.parse(fs.readFileSync(settingsPath(), 'utf-8'))
  } catch {
    return {}
  }
}

function writeSettings(s: AppSettings): void {
  try {
    fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2))
  } catch {
    /* ignore */
  }
}

function assetPath(...p: string[]): string {
  return path.join(app.getAppPath(), ...p)
}

function registerBossKey(accel: string): boolean {
  if (currentAccel) {
    try {
      globalShortcut.unregister(currentAccel)
    } catch {
      /* ignore */
    }
  }
  const ok = globalShortcut.register(accel, () => {
    const main = aliveWin()
    const reader = aliveReader()
    const anyVisible = (main?.isVisible() ?? false) || (reader?.isVisible() ?? false)
    if (anyVisible) {
      reader?.hide()
      main?.hide()
      return
    }
    if (reader) {
      reader.show()
      reader.focus()
      return
    }
    if (main) {
      main.show()
      main.focus()
    }
  })
  if (ok) currentAccel = accel
  return ok
}

function createTray(): void {
  const iconFile = assetPath('resources', 'tray-icon.png')
  let icon = nativeImage.createFromPath(iconFile)
  if (icon.isEmpty()) icon = nativeImage.createFromPath(assetPath('resources', 'icon.png'))
  if (icon.isEmpty()) return
  tray = new Tray(icon)
  tray.setToolTip('墨鱼阅读器 · Alt+X 摸鱼键')
  tray.on('click', () => {
    const main = aliveWin()
    const reader = aliveReader()
    const target = reader ?? main
    if (!target) return
    if (target.isVisible()) {
      target.hide()
      if (reader) main?.hide()
    } else {
      target.show()
      target.focus()
    }
  })
  const menu = Menu.buildFromTemplate([
    { label: '显示 / 隐藏', click: () => {
      const w = aliveWin()
      if (!w) return
      if (w.isVisible()) w.hide()
      else { w.show(); w.focus() }
    } },
    { label: '继续阅读', click: () => {
      const w = aliveWin()
      if (!w) return
      w.show()
      w.focus()
    } },
    { type: 'separator' },
    { label: '退出', click: () => { quitting = true; app.quit() } },
  ])
  tray.setContextMenu(menu)
}

function createWindow(opts?: { forceOpaque?: boolean; initialUrl?: string }): BrowserWindow {
  const s = readSettings()
  // forceOpaque：兜底模式，避免 transparent + backgroundMaterial 在个别环境下创建失败导致无窗口可用
  const useNative = !opts?.forceOpaque && process.platform === 'win32' && !!s.nativeAcrylic && s.material === 'acrylic'
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    show: false,
    paintWhenInitiallyHidden: true,
    transparent: useNative,
    backgroundColor: useNative ? '#00000000' : s.theme === 'light' ? '#ffffff' : '#0e0e10',
    ...(useNative ? { backgroundMaterial: 'acrylic' as const } : {}),
    icon: assetPath('resources', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      sandbox: false,
    },
  })

  win.on('close', (e) => {
    // 仅在托盘可用时隐藏到托盘；托盘创建失败时放行关闭，避免窗口唤不回
    if (!quitting && tray) {
      e.preventDefault()
      win.hide()
    }
  })

  // 崩溃诊断：渲染/GPU 子进程异常时记录到 userData/crash.log（便携版解压失败多因磁盘空间不足）
  win.webContents.on('render-process-gone', (_e, details) => {
    logCrash(`render-process-gone: ${JSON.stringify(details)}`)
  })
  app.on('child-process-gone', (_e, details) => {
    logCrash(`child-process-gone: ${JSON.stringify({ type: details?.type, reason: details?.reason })}`)
  })

  if (opts?.initialUrl) {
    // 重建场景：沿用旧窗口地址，保持用户当前所在页面（如设置页外观分区）
    win.loadURL(opts.initialUrl).catch(() => {
      win.loadFile(path.join(__dirname, '../renderer/index.html'))
    })
  } else if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  return win
}

function registerIPC(): void {
  ipcMain.handle('moyu:get-settings', () => readSettings())
  ipcMain.handle('moyu:save-settings', (_e, s: AppSettings) => {
    writeSettings({ ...readSettings(), ...s })
  })
  ipcMain.handle('moyu:pick-wallpaper', async () => {
    if (!mainWin) return null
    const r = await dialog.showOpenDialog(mainWin, {
      title: '选择壁纸（图片或视频）',
      properties: ['openFile'],
      filters: [
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'avif', 'heic', 'heif', 'tif', 'tiff'] },
        { name: '视频', extensions: ['mp4', 'webm', 'mov'] },
      ],
    })
    if (r.canceled || !r.filePaths[0]) return null
    const p = r.filePaths[0]
    let size = 0
    try {
      size = fs.statSync(p).size
    } catch {
      return null // 文件已不可读（被移动/删除/无权限）
    }
    return { path: p, name: path.basename(p), size }
  })
  ipcMain.handle('moyu:pick-books', async () => {
    if (!mainWin) return null
    const r = await dialog.showOpenDialog(mainWin, {
      title: '导入书籍',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '电子书', extensions: ['epub', 'pdf', 'mobi', 'azw3', 'fb2', 'txt', 'md', 'cbz', 'cbr'] },
      ],
    })
    if (r.canceled) return null
    // 逐个读取元信息，跳过已失效的文件（不因单个文件抛错导致整批导入失败）
    const out: { path: string; name: string; size: number }[] = []
    for (const p of r.filePaths) {
      try {
        out.push({ path: p, name: path.basename(p), size: fs.statSync(p).size })
      } catch {
        /* skip unreadable */
      }
    }
    return out.length ? out : null
  })
  ipcMain.handle('moyu:read-dataurl', async (_e, p: string) => {
    const buf = fs.readFileSync(p)
    const ext = path.extname(p).slice(1).toLowerCase()
    // 按类型族映射 MIME：视频壁纸必须用 video/*，否则 <video> 无法解码
    const MIME_MAP: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      webp: 'image/webp',
      gif: 'image/gif',
      bmp: 'image/bmp',
      avif: 'image/avif',
      heic: 'image/heic',
      heif: 'image/heif',
      tif: 'image/tiff',
      tiff: 'image/tiff',
      svg: 'image/svg+xml',
      mp4: 'video/mp4',
      webm: 'video/webm',
      mov: 'video/quicktime',
      m4v: 'video/mp4',
      ogv: 'video/ogg',
    }
    const mime = MIME_MAP[ext] || 'application/octet-stream'
    return `data:${mime};base64,${buf.toString('base64')}`
  })
  // ---- 阅读窗口 ----
  ipcMain.on('moyu:open-reader', (_e, bookId: string) => {
    if (typeof bookId !== 'string' || !bookId) return
    openReaderWin(bookId)
  })
  ipcMain.on('moyu:close-reader', () => closeReaderWin())

  /**
   * 提供书籍数据源，两种模式：
   * - mode:'url'（PDF）：返回 moyu-file:// 地址，由 pdf.js 按 Range 分块流式读取。
   *   数百 MB 的文件因此不进入主进程内存、不经 IPC 复制，页数再多也只在需要时读那几段。
   * - mode:'buffer'（TXT/EPUB/FB2/CBZ/MD）：整份字节经结构化克隆传输（这些引擎必须拿到完整数据）。
   *   上限 300MB；超限给出明确提示，不阻塞 UI。
   */
  ipcMain.handle('moyu:read-book', async (_e, p: string) => {
    try {
      if (typeof p !== 'string' || !p) return { ok: false, error: '缺少文件路径' }
      const st = fs.statSync(p)
      if (!st.isFile()) return { ok: false, error: '不是有效文件' }

      const ext = path.extname(p).slice(1).toLowerCase()
      if (ext === 'pdf') {
        return { ok: true, mode: 'url', url: toBookUrl(p), size: st.size, name: path.basename(p) }
      }

      const LIMIT = 300 * 1024 * 1024
      if (st.size > LIMIT) {
        return {
          ok: false,
          error: `文件过大（${(st.size / 1024 / 1024).toFixed(0)}MB），${ext.toUpperCase()} 当前上限 300MB`,
        }
      }
      const buf = fs.readFileSync(p)
      return {
        ok: true,
        mode: 'buffer',
        data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        size: st.size,
        name: path.basename(p),
      }
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code
      const msg =
        code === 'ENOENT'
          ? '文件不存在或被移动'
          : code === 'EACCES' || code === 'EPERM'
            ? '没有读取权限'
            : '读取文件失败'
      return { ok: false, error: msg }
    }
  })

  ipcMain.on('moyu:window', (_e, action: string) => {
    const win = aliveWin()
    if (!win) return
    if (action === 'minimize') win.minimize()
    else if (action === 'maximize') {
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
    } else if (action === 'close') {
      // 主窗口收进托盘时，同步关闭阅读窗口（否则全屏阅读窗会留在前台）
      if (aliveReader()) closeReaderWin()
      win.hide()
    }
    else if (action === 'quit') {
      quitting = true
      app.quit()
    }
  })
  ipcMain.on('moyu:recreate', () => {
    // 防重入：连续切换（快速点多个材质）时，后一次重建会在旧窗口未销毁完成时执行，
    // 导致 mainWin 引用错乱、访问已销毁对象而退出进程
    if (recreating) return
    if (!mainWin || mainWin.isDestroyed()) return
    recreating = true
    const old = mainWin
    const wasMax = old.isMaximized()
    const bounds = old.getBounds()
    const prevUrl = (() => {
      try {
        return old.webContents.getURL() || undefined
      } catch {
        return undefined
      }
    })()
    old.destroy()
    mainWin = null
    // 延迟到下一轮事件循环：等旧窗口资源（DWM 图层、渲染进程）释放后再建新窗口，
    // 同步 destroy → create 是 Windows 上创建 transparent 窗口的高危时序
    setImmediate(() => {
      try {
        const w = createWindow({ initialUrl: prevUrl })
        mainWin = w
        if (wasMax) w.maximize()
        else w.setBounds(bounds)
        w.show()
      } catch (err) {
        logCrash(`recreate failed: ${String(err)}`)
        // 兜底：创建不透明窗口，保证应用仍可用（此时原生亚克力失效但不再闪退）
        try {
          const w = createWindow({ forceOpaque: true })
          mainWin = w
          if (wasMax) w.maximize()
          else w.setBounds(bounds)
          w.show()
        } catch (err2) {
          logCrash(`recreate fallback failed: ${String(err2)}`)
        }
      } finally {
        recreating = false
      }
    })
  })
  ipcMain.handle('moyu:open-external', async (_e, url: string) => {
    if (typeof url === 'string' && /^https?:\/\//i.test(url)) {
      await shell.openExternal(url)
    }
  })
  ipcMain.handle('moyu:webdav-list', (_e, p: { url: string; path: string; username: string; password: string }) =>
    davList(p.url, p.path, p.username, p.password)
  )
  ipcMain.handle('moyu:webdav-download', (_e, p: { url: string; path: string; username: string; password: string }) =>
    davDownload(p.url, p.path, p.username, p.password)
  )
  ipcMain.handle('moyu:baidu-auth-start', (_e, p: { appKey: string; appSecret: string }) =>
    baiduStartAuth(p.appKey, p.appSecret)
  )
  ipcMain.handle('moyu:baidu-auth-poll', () => baiduPollAuth())
  ipcMain.handle('moyu:baidu-auth-status', () => baiduAuthStatus())
  ipcMain.handle('moyu:baidu-logout', () => {
    baiduLogout()
  })
  ipcMain.handle('moyu:baidu-list', (_e, p: { appKey: string; appSecret: string; path: string }) =>
    baiduList(p.appKey, p.appSecret, p.path)
  )
  ipcMain.handle('moyu:baidu-download', (_e, p: { appKey: string; appSecret: string; fsid: number; name: string }) =>
    baiduDownload(p.appKey, p.appSecret, p.fsid, p.name)
  )
  ipcMain.handle('moyu:set-boss-key', (_e, accel: string) => {
    const ok = registerBossKey(accel)
    if (ok) {
      writeSettings({ ...readSettings(), bossKey: accel })
    }
    return ok
  })
}

// ---------------- 截图测试模式 ----------------
interface ShotState {
  q: string
  name: string
  wait?: number
  keepFirst?: boolean
}

const SHOT_STATES: ShotState[] = [
  { q: '?theme=dark', name: '01-home-flip' },
  { q: '?anim=fade&theme=dark', name: '02-anim-fade' },
  { q: '?anim=zoom&theme=dark', name: '03-anim-zoom' },
  { q: '?anim=slide&theme=dark', name: '04-anim-slide' },
  { q: '?anim=stack&theme=dark', name: '05-anim-stack' },
  { q: '?material=acrylic&theme=dark', name: '06-material-acrylic' },
  { q: '?material=mica&theme=dark', name: '07-material-mica' },
  { q: '?theme=light&wallpaper=mist&material=solid', name: '08-light-mist-solid' },
  { q: '?open=seed-01&theme=dark', name: '09-book-detail' },
  { q: '?open=seed-01&cover=1&theme=dark', name: '10-cover-editor' },
  { q: '?tab=settings&theme=dark', name: '11-settings' },
  { q: '?tab=settings&sec=wallpaper&theme=dark', name: '12-settings-we' },
  { q: '?anim=flip', wait: 700, keepFirst: true, name: '13-mid-flip' },
  { q: '?anim=stack', wait: 950, keepFirst: true, name: '14-mid-stack' },
  { q: '?wp=1&theme=dark', name: '15-wallpaper-popover' },
  { q: '?wallpaper=mist&theme=dark', name: '16-bright-wallpaper-dark' },
  { q: '?theme=light&wallpaper=mist&material=frosted', name: '17-light-mist-frosted' },
  { q: '?scroll=1&theme=dark', name: '18-nav-scrolled' },
  { q: '?tab=notes&theme=dark', name: '19-tab-notes' },
  { q: '?fit=contain&wallpaper=mist&theme=dark', name: '21-fit-contain' },
  { q: '?theme=light&wallpaper=dusk', name: '22-nav-light-dusk' },
  { q: '?theme=light&wallpaper=deep', name: '23-nav-light-deep' },
  { q: '?tab=profile&sec=webdav&theme=dark', name: '24-webdav-import' },
  { q: '?tab=profile&sec=webdav&netpan=baidu&theme=dark', name: '25-baidu-import' },
  { q: '?theme=light', name: '26-light-chips' },
  { q: '?injectwp=1&theme=dark', name: '27-wallpaper-texture' },
  { q: '?injectwp=1&theme=light', name: '28-wallpaper-texture-light' },
  { q: '?injectwp=1&maximized=1', name: '29-maximized-wallpaper' },
]

async function waitRenderReady(win: BrowserWindow): Promise<void> {
  try {
    await win.webContents.executeJavaScript(
      `(async () => {
        if (document.readyState !== 'complete') {
          await new Promise(r => window.addEventListener('load', r, { once: true }));
        }
        if (document.fonts && document.fonts.ready) await document.fonts.ready;
        await Promise.all(Array.from(document.images).map(img =>
          img.complete ? null : new Promise(r => { img.onload = r; img.onerror = r; })
        ));
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      })()`
    )
  } catch {
    /* page may still be loading; fall through to timed wait */
  }
}

/** 自检结果落盘到 userData（打包后 app.asar 不可写，实机验证需从用户数据目录取证） */
function writeTestResult(kind: string, lines: string[]): void {
  try {
    const dir = app.getPath('userData')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `test-result-${kind}.txt`), lines.join('\n') + '\n', 'utf8')
  } catch {
    /* 忽略：仅诊断用 */
  }
}

// ---------------- 跨窗口可见性自检（MOYU_TEST_CROSSWIN=<testpath>） ----------------
/**
 * 验证真实链路：主窗口写入书架的书籍，阅读窗口能否读到。
 * 这是「找不到这本书（可能已被移除）」的回归用例 —— 根因是阅读窗口曾用独立
 * partition，IndexedDB 与主窗口隔离。此用例必须在共用默认 session 时通过。
 */
async function runCrossWinTest(testPath: string): Promise<void> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const out: string[] = []
  const main = createWindow()
  mainWin = main
  try {
    await main.loadFile(path.join(__dirname, '../renderer/index.html'), { search: '?theme=dark' })
    await sleep(3200) // 等 hydrate 建好 IndexedDB

    const seeded = await main.webContents.executeJavaScript(`(async () => {
      const ext = ${JSON.stringify(testPath)}.split('.').pop().toLowerCase()
      const req = indexedDB.open('moyu-reader')
      const db = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error) })
      if (!db.objectStoreNames.contains('books')) { db.close(); return 'no-store' }
      const tx = db.transaction('books', 'readwrite')
      tx.objectStore('books').put({
        id: 'crossbook', title: '跨窗口验证书', author: '测试', format: ext,
        addedAt: Date.now(), lastReadAt: null, progress: 0, locator: null,
        coverId: null, coverSeed: 7, shelfId: null, size: 0,
        sourcePath: ${JSON.stringify(testPath)}, description: '',
      })
      await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error) })
      db.close()
      return 'seeded'
    })()`)
    out.push(`seed: ${seeded}`)

    openReaderWin('crossbook')
    await sleep(7000)

    const rw = aliveReader()
    if (!rw) {
      out.push('FAIL: 阅读窗口未创建')
    } else {
      const st = (await rw.webContents.executeJavaScript(`({
        title: document.querySelector('.reader-title')?.textContent ?? '',
        state: (document.querySelector('.reader-state')?.innerText ?? '').replace(/\\s+/g, ' ').slice(0, 60),
        container: document.querySelector('.text-scroll')
          ? 'text'
          : document.querySelector('.pdf-scroll')
            ? 'pdf'
            : 'none',
        chars: (document.querySelector('.reader-body')?.innerText ?? '').length,
      })`)) as { title: string; state: string; container: string; chars: number }
      out.push(`reader: ${JSON.stringify(st)}`)
      const okRun = st.container !== 'none' && !st.state.includes('找不到') && !st.state.includes('无法打开')
      out.push(okRun ? 'CROSSWIN_OK' : 'CROSSWIN_FAIL')
      const img = await rw.webContents.capturePage()
      const buf = img.toPNG()
      if (buf.length > 2000) {
        // 优先写工程 screenshots（开发期）；打包后回退到 userData
        const devShot = path.join(app.getAppPath(), 'screenshots')
        const target = fs.existsSync(devShot) ? devShot : app.getPath('userData')
        fs.writeFileSync(path.join(target, 'crosswin-open.png'), buf)
      }
    }
  } catch (e) {
    out.push(`ERROR ${String(e)}`)
  }
  console.log('CROSSWIN_TEST:')
  for (const l of out) console.log('  ' + l)
  writeTestResult('crosswin', out)
  app.exit(0)
}

// ---------------- 阅读窗口自检（MOYU_TEST_READER="<name>|<query>"） ----------------
async function runReaderTest(name: string, query: string): Promise<void> {
  const renderer = path.join(__dirname, '../renderer/reader.html')
  const outDir = path.join(app.getAppPath(), 'screenshots')
  fs.mkdirSync(outDir, { recursive: true })
  const win = new BrowserWindow({
    width: 1200,
    height: 900,
    frame: false,
    show: true, // 隐藏窗口在部分环境下捕获不到合成帧（截图全黑），自检需显示
    backgroundColor: '#111113',
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      sandbox: false,
    },
  })
  const logs: string[] = []
  win.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    if (level >= 2) logs.push(`${sourceId}:${line} ${message}`)
  })
  try {
    await win.loadFile(renderer, { search: query })
    await new Promise((r) => setTimeout(r, 4200))
    const probe = await win.webContents.executeJavaScript(`(() => {
      const q = (s) => document.querySelector(s)
      const root = q('.reader-root')
      const state = q('.reader-state')
      return JSON.stringify({
        hasRoot: !!root,
        container: q('.text-scroll') ? 'text' : q('.epub-host') ? 'epub' : q('.pdf-scroll') ? 'pdf' : q('.comic-scroll') ? 'comic' : 'none',
        errorText: state ? state.innerText.replace(/\s+/g, ' ').slice(0, 120) : '',
        h1: q('.text-inner h1')?.textContent?.slice(0, 40) ?? '',
        percent: q('.reader-sub')?.textContent?.trim() ?? '',
        pages: document.querySelectorAll('.pdf-page, .comic-page, .pdf-page-ph').length,
        scrollHeight: q('.text-scroll')?.scrollHeight ?? q('.pdf-scroll')?.scrollHeight ?? 0,
        bodyText: (q('.reader-body')?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 80),
        hostSize: [q('.epub-host')?.clientWidth ?? 0, q('.epub-host')?.clientHeight ?? 0],
        iframeCount: document.querySelectorAll('.reader-body iframe').length,
        epubNode: (() => {
          const host = document.querySelector('.epub-host')
          if (!host) return 'none'
          const f = host.querySelector('iframe')
          const txt = f ? (f.contentDocument?.body?.innerText ?? '') : (host.innerText ?? '')
          return { mode: f ? 'iframe' : 'div', textLen: txt.length, head: txt.replace(/\s+/g, ' ').slice(0, 40) }
        })(),
        iframeInfo: (() => {
          const f = document.querySelector('.reader-body iframe')
          if (!f) return 'no-iframe'
          let textLen = -1
          let bodyStyle = ''
          let docBg = ''
          try {
            const doc = f.contentDocument
            textLen = doc?.body?.innerText?.length ?? -1
            if (doc?.body) {
              const cs = getComputedStyle(doc.body)
              bodyStyle = 'color=' + cs.color + ';bg=' + cs.backgroundColor + ';fs=' + cs.fontSize
              docBg = getComputedStyle(doc.documentElement).backgroundColor
            }
          } catch (e) {
            textLen = -2
          }
          const fcs = getComputedStyle(f)
          return {
            src: (f.getAttribute('src') || '').slice(0, 30),
            textLen,
            w: f.clientWidth,
            h: f.clientHeight,
            iframeOpacity: fcs.opacity,
            iframeVisibility: fcs.visibility,
            bodyStyle,
            docBg,
          }
        })(),
      })
    })()`)
    // 截图健壮性：capturePage 偶发返回空帧（尤其含 iframe 的页面），重试至拿到有效 PNG
    let png: Buffer | null = null
    for (let i = 0; i < 4 && !png; i++) {
      try {
        const img = await win.webContents.capturePage()
        const buf = img.toPNG()
        if (buf.length > 2000) png = buf
      } catch {
        /* 重试 */
      }
      if (!png) await new Promise((r) => setTimeout(r, 500))
    }
    if (png) {
      const target = fs.existsSync(outDir) ? outDir : app.getPath('userData')
      fs.writeFileSync(path.join(target, `reader-${name}.png`), png)
    }
    console.log(`READER_TEST[${name}]: ${probe}`)
    console.log(`READER_SHOT[${name}]: ${png ? png.length + ' bytes' : 'FAILED'}`)
    // 内存观测：各进程工作集（KB → MB），用于验证大文件是否被流式读取而非整份驻留
    const mem = app
      .getAppMetrics()
      .map((m) => `${m.type}#${m.pid}=${Math.round((m.memory?.workingSetSize ?? 0) / 1024)}MB`)
      .join(' ')
    console.log(`READER_MEM[${name}]: ${mem}`)
    writeTestResult(`reader-${name}`, [String(probe), `mem: ${mem}`, `shot: ${png ? png.length : 0}`])
    if (logs.length) console.log(`READER_LOG[${name}]: ${logs.slice(0, 3).join(' | ')}`)
  } catch (e) {
    console.log(`READER_TEST[${name}]: FAIL ${String(e)}`)
  }
  app.exit(0)
}

// ---------------- 位置记忆自检（MOYU_TEST_RESTORE="<name>|<testpath>"） ----------------
async function runRestoreTest(name: string, testPath: string): Promise<void> {
  const renderer = path.join(__dirname, '../renderer/reader.html')
  const makeWin = () =>
    new BrowserWindow({
      width: 1200,
      height: 900,
      frame: false,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/preload.js'),
        contextIsolation: true,
        sandbox: false,
      },
    })
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const out: string[] = []
  try {
    // 阶段 1：打开 → 滚动到 3000px → 等待节流保存
    const w1 = makeWin()
    await w1.loadFile(renderer, { search: `?testpath=${encodeURIComponent(testPath)}` })
    await sleep(3800)
    const idInfo = await w1.webContents.executeJavaScript(
      `document.querySelector('.reader-title')?.textContent ?? ''`
    )
    // 推进阅读位置：文本类滚动；EPUB 通过目录跳到第 2 章（验证 CFI 持久化）
    const advanced = await w1.webContents.executeJavaScript(`(() => {
      const text = document.querySelector('.text-scroll')
      if (text) { text.scrollTo(0, 600); return 'scroll:' + Math.round(text.scrollTop) }
      const tocBtn = Array.from(document.querySelectorAll('.reader-top .rb')).find(b => b.textContent.includes('目录'))
      if (tocBtn) { tocBtn.click(); return 'toc-opened' }
      return 'noop'
    })()`)
    if (String(advanced) === 'toc-opened') {
      await sleep(500)
      const jumped = await w1.webContents.executeJavaScript(`(() => {
        const items = document.querySelectorAll('.epub-nav-item')
        if (items.length > 1) { items[1].click(); return 'jumped:' + items.length }
        return 'no-toc-items'
      })()`)
      out.push(`advance ${advanced} -> ${jumped}`)
    } else {
      out.push(`advance ${advanced}`)
    }
    await sleep(2600) // > 保存节流 1200ms
    const beforeClose = await w1.webContents.executeJavaScript(`({
      scrollTop: Math.round(document.querySelector('.text-scroll, .epub-host, .pdf-scroll, .comic-scroll')?.scrollTop ?? -1),
      percent: document.querySelector('.reader-sub')?.textContent?.trim() ?? '',
    })`)
    out.push(`phase1 ${JSON.stringify(beforeClose)} title=${idInfo}`)
    w1.destroy()
    await sleep(700)

    // 阶段 2：用真实 bookId 重开（不带 testpath），检查滚动位置是否恢复
    const bookId = `testbook-${name}`
    const w2 = makeWin()
    await w2.loadFile(renderer, { search: `?bookId=${bookId}` })
    await sleep(8000) // EPUB 重开需加载引擎 + 定位 + 渲染首章
    const after = await w2.webContents.executeJavaScript(`({
      scrollTop: Math.round(document.querySelector('.text-scroll, .epub-host, .pdf-scroll, .comic-scroll')?.scrollTop ?? -1),
      percent: document.querySelector('.reader-sub')?.textContent?.trim() ?? '',
      err: document.querySelector('.reader-state')?.innerText?.slice(0, 80) ?? '',
    })`)
    out.push(`phase2 ${JSON.stringify(after)}`)
    // EPUB 以 CFI 恢复：检查重开后 iframe 内首段文本是否仍属第 2 章
    const cfiCheck = await w2.webContents.executeJavaScript(`(() => {
      const host = document.querySelector('.epub-host')
      if (!host) return 'no-host'
      const f = host.querySelector('iframe')
      const t = f ? (f.contentDocument?.body?.innerText ?? '') : (host.innerText ?? '')
      if (!t) return 'empty'
      return t.includes('第二章') ? 'chapter2' : t.includes('第一章') ? 'chapter1' : 'text:' + t.slice(0, 20)
    })()`)
    out.push(`restore-chapter: ${cfiCheck}`)
    const got = Number((after as { scrollTop: number }).scrollTop)
    const want = Number((beforeClose as { scrollTop: number }).scrollTop)
    const tol = Math.max(60, want * 0.12)
    if (String(cfiCheck) === 'chapter2') out.push('RESTORE_OK(cfi)')
    else if (want > 5 && Math.abs(got - want) <= tol) out.push(`RESTORE_OK(scroll expect≈${want}, got=${got})`)
    else if (want <= 5) out.push('RESTORE_SKIP(无滚动量)')
    else out.push(`RESTORE_FAIL(expect≈${want}, got=${got}, chapter=${cfiCheck})`)
    const img = await w2.webContents.capturePage()
    fs.writeFileSync(path.join(app.getAppPath(), 'screenshots', `reader-${name}-restored.png`), img.toPNG())
    w2.destroy()
  } catch (e) {
    out.push(`ERROR ${String(e)}`)
  }
  console.log(`RESTORE_TEST[${name}]:`)
  for (const l of out) console.log('  ' + l)
  app.exit(0)
}

// ---------------- 材质切换自检（MOYU_TEST_CYCLE=1，仅用于回归验证） ----------------
async function runMaterialCycle(initial: BrowserWindow): Promise<void> {
  const renderer = path.join(__dirname, '../renderer/index.html')
  const results: string[] = []
  // 重建路径会销毁旧窗口并新建，因此每次操作后取当前存活窗口
  const current = (): BrowserWindow | null =>
    BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ?? null
  let win = initial
  try {
    await win.loadFile(renderer, { search: '?tab=profile&sec=appearance&theme=dark' })
    await new Promise((r) => setTimeout(r, 2200))
    const count = await win.webContents.executeJavaScript(
      `document.querySelectorAll('.material-card').length`
    )
    results.push(`material-cards: ${count}`)
    for (const i of [1, 2, 3, 0, 1, 0]) {
      const w0 = current()
      if (!w0) {
        results.push(`NO_WINDOW before index ${i}`)
        break
      }
      const clicked = await w0.webContents.executeJavaScript(`(() => {
        const btns = document.querySelectorAll('.material-card')
        if (!btns[${i}]) return 'no-btn'
        btns[${i}].click()
        return btns[${i}].textContent || 'ok'
      })()`)
      await new Promise((r) => setTimeout(r, 900))
      const w1 = current()
      if (!w1) {
        results.push(`CRASH after index ${i}`)
        break
      }
      const rebuilt = w1 !== w0
      win = w1
      results.push(
        `switched[${i}] ${rebuilt ? '(window rebuilt)' : ''} -> ${String(clicked).replace(/\s+/g, ' ').slice(0, 30)}`
      )
      if (rebuilt) {
        // 重建后需等待新窗口渲染完成再继续点击
        await new Promise((r) => setTimeout(r, 1600))
      }
    }
  } catch (err) {
    results.push(`ERROR: ${String(err)}`)
  }
  const alive = current() ? 'window alive' : 'no window'
  console.log('MATERIAL_CYCLE_RESULT:')
  for (const r of results) console.log('  ' + r)
  console.log('  ' + alive)
  console.log(alive === 'window alive' ? 'MATERIAL_CYCLE_OK' : 'MATERIAL_CYCLE_FAIL')
  app.exit(alive === 'window alive' ? 0 : 1)
}

async function runShots(win: BrowserWindow): Promise<void> {  const only = process.env.MOYU_SHOT_ONLY?.split(',').map((s) => s.trim()).filter(Boolean)
  const states = only && only.length ? SHOT_STATES.filter((s) => only.some((o) => s.name.startsWith(o))) : SHOT_STATES
  const renderer = path.join(__dirname, '../renderer/index.html')
  const outDir = path.join(app.getAppPath(), 'screenshots')
  fs.mkdirSync(outDir, { recursive: true })
  const errors: string[] = []
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 3) errors.push(message)
  })
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    errors.push(`load-fail ${code} ${desc}`)
  })
  for (const st of states) {
    // 最大化状态：先真实最大化（触发硬件圆角内缩），截图后还原
    const wasMax = st.q.includes('maximized=1')
    if (wasMax) {
      win.setBounds({ x: 80, y: 60, width: 1280, height: 820 })
      win.maximize()
      await new Promise((r) => setTimeout(r, 600))
    }
    try {
      await win.loadFile(renderer, { search: st.q })
    } catch (e) {
      errors.push(`${st.name}: load error ${String(e)}`)
      continue
    }
    let captured = 0
    const attempts = st.keepFirst ? 1 : 3
    for (let attempt = 0; attempt < attempts && (st.keepFirst || captured < 20000); attempt++) {
      await new Promise((r) => setTimeout(r, st.wait ?? 1400))
      await waitRenderReady(win)
      try {
        const img = await win.webContents.capturePage()
        const png = img.toPNG()
        if (png.length > captured) {
          fs.writeFileSync(path.join(outDir, `${st.name}.png`), png)
          captured = png.length
        }
      } catch (e) {
        errors.push(`${st.name}: capture error ${String(e)}`)
      }
    }
    if (!st.keepFirst && captured < 20000) errors.push(`${st.name}: capture suspiciously small (${captured} bytes)`)
    if (wasMax) {
      win.unmaximize()
      await new Promise((r) => setTimeout(r, 300))
    }
  }
  console.log('SHOT_DONE')
  if (errors.length) {
    console.log('RENDER_ERRORS:')
    for (const e of errors) console.log(' - ' + e)
  } else {
    console.log('NO_RENDER_ERRORS')
  }
  app.exit(0)
}

if (!app.requestSingleInstanceLock() && !isShot) {
  app.quit()
} else {
  app.whenReady().then(() => {
    registerBookProtocol()
    registerIPC()
    if (isShot) {
      mainWin = createWindow()
      runShots(mainWin)
      return
    }
    if (process.env.MOYU_TEST_RESTORE) {
      const raw = process.env.MOYU_TEST_RESTORE
      const idx = raw.indexOf('|')
      void runRestoreTest(idx > 0 ? raw.slice(0, idx) : 'txt', idx > 0 ? raw.slice(idx + 1) : '')
      return
    }
    if (process.env.MOYU_TEST_CROSSWIN) {
      void runCrossWinTest(process.env.MOYU_TEST_CROSSWIN)
      return
    }
    if (process.env.MOYU_TEST_READER) {
      const raw = process.env.MOYU_TEST_READER
      const idx = raw.indexOf('|')
      const name = idx > 0 ? raw.slice(0, idx) : 'reader'
      const query = idx > 0 ? raw.slice(idx + 1) : ''
      void runReaderTest(name, query)
      return
    }
    if (process.env.MOYU_TEST_CYCLE === '1') {
      mainWin = createWindow()
      mainWin.show()
      void runMaterialCycle(mainWin)
      return
    }
    mainWin = createWindow()
    mainWin.show()
    createTray()
    registerBossKey(readSettings().bossKey || 'Alt+X')
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWin = createWindow()
      mainWin?.show()
    })
  })

  app.on('second-instance', () => {
    const w = aliveWin()
    if (w) {
      w.show()
      w.focus()
    }
  })

  // 托盘常驻应用：窗口重建（destroy → 新建）期间会短暂"无窗口"，
  // 若不拦截 window-all-closed 的默认行为，Electron 会在此刻退出进程 → 表现为切换材质闪退。
  app.on('window-all-closed', () => {
    if (quitting) app.quit()
  })

  app.on('will-quit', () => {
    globalShortcut.unregisterAll()
    if (aliveReader()) readerWin?.destroy()
  })
}
