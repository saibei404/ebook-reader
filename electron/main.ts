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
  // 必须绝对路径：协议处理器只接受 isAbsolute 的路径（相对路径会 404，PDF 表现为「无法打开」）
  const abs = path.resolve(absPath)
  return `moyu-file://f/${Buffer.from(abs, 'utf8').toString('base64url')}`
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
function openReaderWin(bookId: string, jump?: string): void {
  const search = `?bookId=${encodeURIComponent(bookId)}${jump ? `&jump=${encodeURIComponent(jump)}` : ''}`
  const existing = aliveReader()
  if (existing) {
    // 已有阅读窗口：切换书籍并聚焦（不重复建窗）
    const base = process.env.ELECTRON_RENDERER_URL
    if (base) void existing.loadURL(`${base}/reader.html${search}`)
    else void existing.loadFile(path.join(__dirname, '../renderer/reader.html'), { search })
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
        // 关闭后台节流：阅读窗口常被其他窗口遮挡（摸鱼场景就是这么用的），
        // 一旦 Chromium 判定为后台/被遮挡，计时器与 rAF 会被大幅降频，
        // epub.js 的异步渲染管线会卡在「容器已建、iframe 迟迟不出现」的状态。
        backgroundThrottling: false,
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
    if (base) void win.loadURL(`${base}/reader.html${search}`)
    else void win.loadFile(path.join(__dirname, '../renderer/reader.html'), { search })
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
  ipcMain.on('moyu:open-reader', (_e, bookId: string, jump?: string) => {
    if (typeof bookId !== 'string' || !bookId) return
    openReaderWin(bookId, typeof jump === 'string' ? jump : undefined)
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

  /** 保存文本到用户选择的位置（备份导出用）；打包后 asar 只读，必须走对话框写真实路径 */
  ipcMain.handle('moyu:save-text', async (_e, payload: { name?: string; content?: string }) => {
    try {
      if (typeof payload?.content !== 'string') return { ok: false, error: '内容为空' }
      const name = typeof payload?.name === 'string' && payload.name ? payload.name : 'moyu-backup.json'
      const isMd = /\.md$/i.test(name)
      const opts: Electron.SaveDialogOptions = {
        title: isMd ? '导出书摘' : '导出备份',
        defaultPath: path.join(app.getPath('documents'), name),
        filters: isMd
          ? [{ name: 'Markdown', extensions: ['md'] }]
          : [{ name: 'JSON 备份', extensions: ['json'] }],
      }
      const w = aliveWin()
      const r = w ? await dialog.showSaveDialog(w, opts) : await dialog.showSaveDialog(opts)
      if (r.canceled || !r.filePath) return { ok: false, canceled: true }
      await fs.promises.writeFile(r.filePath, payload.content, 'utf8')
      return { ok: true, path: r.filePath }
    } catch (err) {
      return { ok: false, error: String((err as Error)?.message ?? err) }
    }
  })

  /** 读取用户选择的文本文件（备份导入）；打包后 asar 只读，必须走真实路径 */
  ipcMain.handle('moyu:open-text', async () => {
    try {
      const opts: Electron.OpenDialogOptions = {
        title: '导入备份',
        defaultPath: app.getPath('documents'),
        properties: ['openFile'],
        filters: [
          { name: '墨鱼备份', extensions: ['json'] },
          { name: '所有文件', extensions: ['*'] },
        ],
      }
      const w = aliveWin()
      const r = w ? await dialog.showOpenDialog(w, opts) : await dialog.showOpenDialog(opts)
      if (r.canceled || !r.filePaths?.length) return { ok: false, canceled: true }
      const p = r.filePaths[0]
      const content = await fs.promises.readFile(p, 'utf8')
      return { ok: true, path: p, content }
    } catch (err) {
      return { ok: false, error: String((err as Error)?.message ?? err) }
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

// ---------------- 搜索自检（MOYU_TEST_SEARCH=<testpath>|<关键词>） ----------------
async function runSearchTest(testPath: string, keyword: string): Promise<void> {
  const renderer = path.join(__dirname, '../renderer/reader.html')
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const out: string[] = []
  const win = new BrowserWindow({
    width: 1180,
    height: 880,
    frame: false,
    show: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false,
    },
  })
  try {
    await win.loadFile(renderer, { search: `?testpath=${encodeURIComponent(testPath)}` })
    await sleep(4200)

    const hits = await win.webContents.executeJavaScript(`(async () => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('搜索'))
      if (!btn) return -1
      btn.click()
      await new Promise(r => setTimeout(r, 300))
      const input = document.querySelector('.search-input')
      if (!input) return -2
      // React 受控组件：走原生 setter 再派发 input 事件才能触发 onChange
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
      setter.call(input, ${JSON.stringify(keyword)})
      input.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise(r => setTimeout(r, 500))
      return document.querySelectorAll('.search-hit').length
    })()`)
    out.push(`hits: ${hits}`)

    const firstSnippet = await win.webContents.executeJavaScript(
      `document.querySelector('.search-hit-snippet')?.textContent ?? ''`
    )
    out.push(`snippet: ${String(firstSnippet).slice(0, 60)}`)

    // 点击第一条 → 重载并跳到命中位置
    await win.webContents.executeJavaScript(
      `(() => {
        const list = document.querySelectorAll('.search-hit')
        if (!list.length) return false
        // 取靠后的命中，避免"第一条在文首"导致滚动量恰好为 0
        const h = list[Math.min(list.length - 1, 2)]
        h.click()
        return true
      })()`
    )
    await sleep(4200)
    const after = await win.webContents.executeJavaScript(`({
      scrollTop: Math.round(document.querySelector('.text-scroll')?.scrollTop ?? -1),
      percent: document.querySelector('.reader-sub')?.textContent?.trim() ?? '',
      hasJump: location.search.includes('jump='),
    })`)
    out.push(`after-jump: ${JSON.stringify(after)}`)

    const a = after as { scrollTop: number; hasJump: boolean }
    const okRun = Number(hits) > 0 && String(firstSnippet).length > 0 && a.scrollTop > 100
    out.push(okRun ? 'SEARCH_OK' : 'SEARCH_FAIL')

    try {
      const img = await win.webContents.capturePage()
      const devShot = path.join(app.getAppPath(), 'screenshots')
      const target = fs.existsSync(devShot) ? devShot : app.getPath('userData')
      fs.writeFileSync(path.join(target, 'reader-search.png'), img.toPNG())
    } catch {
      /* ignore */
    }
  } catch (e) {
    out.push(`ERROR ${String(e)}`)
  }
  console.log('SEARCH_TEST:')
  for (const l of out) console.log('  ' + l)
  writeTestResult('search', out)
  if (!win.isDestroyed()) win.destroy()
  app.exit(0)
}

// ---------------- 排版样本回归（MOYU_TEST_FIXTURES=<test-fixtures 目录>） ----------------
/** 一条命令跑完 8 份样本，按格式断言容器/结构/字号/颜色，输出通过表 */
async function runFixtures(dir: string): Promise<void> {
  const renderer = path.join(__dirname, '../renderer/reader.html')
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const cases = [
    { name: 'txt-main', rel: 'txt/01-排版全要素.txt', kind: 'text' },
    { name: 'txt-en', rel: 'txt/02-plain-ascii.txt', kind: 'text' },
    { name: 'md', rel: 'md/01-排版全要素.md', kind: 'text', needTable: true },
    { name: 'epub', rel: 'epub/01-排版全要素.epub', kind: 'epub', needTable: true, needColor: true },
    { name: 'docx', rel: 'docx/01-排版全要素.docx', kind: 'text', needTable: true },
    { name: 'fb2', rel: 'fb2/01-排版全要素.fb2', kind: 'text' },
    { name: 'pdf', rel: 'pdf/01-排版全要素.pdf', kind: 'pdf' },
    { name: 'cbz', rel: 'cbz/01-四页示例.cbz', kind: 'comic' },
  ]

  const PROBE = `(() => {
    const q = (s) => document.querySelector(s)
    const c = (s) => document.querySelectorAll(s).length
    const st = (s, d) => {
      const doc = d || document
      const el = doc.querySelector(s)
      if (!el) return null
      const cs = doc.defaultView.getComputedStyle(el)
      return cs.fontSize + '|' + cs.color
    }
    const ef = q('.epub-host iframe')
    const ed = ef && ef.contentDocument ? ef.contentDocument : null
    const ec = (s) => (ed ? ed.querySelectorAll(s).length : 0)
    const colors = []
    const add = (el) => { const co = el.ownerDocument.defaultView.getComputedStyle(el).color; if (colors.indexOf(co) < 0) colors.push(co) }
    document.querySelectorAll('.text-inner span, .text-inner [style*="color"]').forEach(add)
    if (ed) ed.querySelectorAll('span').forEach(add)
    return JSON.stringify({
      container: q('.text-scroll') ? 'text' : q('.epub-host') ? 'epub' : q('.pdf-scroll') ? 'pdf' : q('.comic-scroll') ? 'comic' : 'none',
      err: (q('.reader-state')?.innerText ?? '').replace(/\s+/g, ' ').slice(0, 60),
      p: c('.text-inner p'), h1: c('.text-inner h1'), h2: c('.text-inner h2'),
      table: c('.text-inner table'), th: c('.text-inner th'),
      epubP: ec('p'), epubTable: ec('table'), epubTh: ec('th'),
      pages: c('.pdf-page, .comic-page, .pdf-page-ph'),
      body: st('.text-inner p:not(.doc-title):not(.doc-subtitle)') || (ed ? st('p', ed) : null),
      colors: colors.slice(0, 6),
    })
  })()`

  type Row = { name: string; pass: boolean; detail: string }
  const rows: Row[] = []
  // 相对目录会让 PDF 走协议时拿不到绝对路径（moyu-file 只接受绝对路径）
  const base = path.resolve(dir)
  for (const t of cases) {
    let row: Row = { name: t.name, pass: false, detail: '未执行' }
    const win = new BrowserWindow({
      width: 1100,
      height: 860,
      show: false,
      webPreferences: {
        preload: path.join(__dirname, '../preload/preload.js'),
        contextIsolation: true,
        sandbox: false,
        backgroundThrottling: false,
      },
    })
    try {
      const target = path.join(base, t.rel)
      if (!fs.existsSync(target)) throw new Error(`样本缺失：${t.rel}`)
      await win.loadFile(renderer, { search: `?testpath=${encodeURIComponent(target)}` })
      await sleep(4200)
      const raw = await win.webContents.executeJavaScript(PROBE)
      const r = JSON.parse(String(raw)) as {
        container: string
        err: string
        p: number
        h1: number
        h2: number
        table: number
        th: number
        epubP: number
        epubTable: number
        epubTh: number
        pages: number
        body: string | null
        colors: string[]
      }

      const parts: string[] = []
      let pass = true
      if (r.container !== t.kind) {
        pass = false
        parts.push(`容器 ${r.container}≠${t.kind}`)
      }
      if (r.err) {
        pass = false
        parts.push(`报错:${r.err}`)
      }
      if (t.kind === 'text' && r.p <= 0) {
        pass = false
        parts.push('无段落')
      }
      if (t.kind === 'epub' && r.epubP <= 0) {
        pass = false
        parts.push('无 EPUB 段落')
      }
      if ((t.kind === 'pdf' || t.kind === 'comic') && r.pages <= 0) {
        pass = false
        parts.push('无页面')
      }
      if (t.needTable && r.table + r.epubTable <= 0) {
        pass = false
        parts.push('无表格')
      }
      if (t.needColor && r.colors.length < 3) {
        pass = false
        parts.push(`颜色 ${r.colors.length} 色`)
      }
      // PDF / CBZ 是位图渲染，没有可探针的文字样式
      if (t.kind !== 'pdf' && t.kind !== 'comic' && !r.body) {
        pass = false
        parts.push('无正文样式')
      }

      const stat =
        t.kind === 'text'
          ? `p=${r.p} h1=${r.h1} 表${r.table}/th${r.th}`
          : t.kind === 'epub'
            ? `p=${r.epubP} 表${r.epubTable}/th${r.epubTh} 色${r.colors.length}`
            : `${r.pages} 页`
      row = { name: t.name, pass, detail: pass ? `${r.container} ${stat} ${r.body ?? ''}` : parts.join('；') }
    } catch (e) {
      row = { name: t.name, pass: false, detail: String((e as Error)?.message ?? e) }
    }
    if (!win.isDestroyed()) win.destroy()
    rows.push(row)
    console.log(`FIXTURE ${row.pass ? 'PASS' : 'FAIL'}  ${row.name.padEnd(9)} ${row.detail}`)
  }

  const passed = rows.filter((r) => r.pass).length
  const summary = `FIXTURES ${passed}/${rows.length} ${passed === rows.length ? 'ALL_PASS' : 'HAS_FAIL'}`
  console.log(summary)
  writeTestResult('fixtures', [...rows.map((r) => `${r.pass ? 'PASS' : 'FAIL'}	${r.name}	${r.detail}`), summary])
  app.exit(passed === rows.length ? 0 : 1)
}

// ---------------- 书签自检（MOYU_TEST_BOOKMARK=<testpath>） ----------------
/** 加书签 → 关窗 → 重开，验证落库与面板恢复 */
async function runBookmarkTest(testPath: string): Promise<void> {
  const renderer = path.join(__dirname, '../renderer/reader.html')
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const makeWin = () =>
    new BrowserWindow({
      width: 1180,
      height: 880,
      frame: false,
      show: true,
      webPreferences: {
        preload: path.join(__dirname, '../preload/preload.js'),
        contextIsolation: true,
        sandbox: false,
        backgroundThrottling: false,
      },
    })
  const out: string[] = []
  const countBm = (win: BrowserWindow) =>
    win.webContents.executeJavaScript(`(async () => {
      const req = indexedDB.open('moyu-reader')
      const db = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error) })
      const n = await new Promise((res) => {
        const tx = db.transaction('bookmarks', 'readonly')
        const rq = tx.objectStore('bookmarks').count()
        rq.onsuccess = () => res(rq.result)
        rq.onerror = () => res(-1)
      })
      db.close()
      return n
    })()`)

  try {
    // 阶段 1：打开 → 加书签
    const w1 = makeWin()
    await w1.loadFile(renderer, { search: `?testpath=${encodeURIComponent(testPath)}` })
    await sleep(4200)
    const added = await w1.webContents.executeJavaScript(`(async () => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('书签'))
      if (!btn) return 'no-btn'
      btn.click()
      await new Promise(r => setTimeout(r, 350))
      const add = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('当前位置'))
      if (!add) return 'no-add-btn'
      add.click()
      await new Promise(r => setTimeout(r, 900))
      const panel = document.querySelector('.bm-panel')
      return panel ? panel.innerText.replace(/\s+/g, ' ').slice(0, 100) : 'no-panel'
    })()`)
    out.push(`add: ${added}`)
    const c1 = await countBm(w1)
    out.push(`db-after-add: ${c1}`)
    w1.destroy()
    await sleep(900)

    // 阶段 2：重开同一本书（不带 testpath），书签应仍在
    const w2 = makeWin()
    await w2.loadFile(renderer, { search: '?bookId=testbook-txt' })
    await sleep(4200)
    const c2 = await countBm(w2)
    const panel2 = await w2.webContents.executeJavaScript(`(async () => {
      const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('书签'))
      if (!btn) return 'no-btn'
      btn.click()
      await new Promise(r => setTimeout(r, 400))
      const p = document.querySelector('.bm-panel')
      return p ? p.innerText.replace(/\s+/g, ' ').slice(0, 100) : 'no-panel'
    })()`)
    out.push(`db-after-reopen: ${c2}`)
    out.push(`panel: ${panel2}`)
    const okRun = Number(c1) >= 1 && Number(c2) >= 1 && String(panel2).includes('%')
    out.push(okRun ? 'BOOKMARK_OK' : 'BOOKMARK_FAIL')
    try {
      const img = await w2.webContents.capturePage()
      const devShot = path.join(app.getAppPath(), 'screenshots')
      const target = fs.existsSync(devShot) ? devShot : app.getPath('userData')
      fs.writeFileSync(path.join(target, 'reader-bookmark.png'), img.toPNG())
    } catch {
      /* ignore */
    }
    w2.destroy()
  } catch (e) {
    out.push(`ERROR ${String(e)}`)
  }
  console.log('BOOKMARK_TEST:')
  for (const l of out) console.log('  ' + l)
  writeTestResult('bookmark', out)
  app.exit(0)
}

// ---------------- 通用等待助手 ----------------
/** 轮询渲染进程条件，直到返回真值或超时（自检里替代固定 sleep，避免机器慢时误判） */
async function waitFor(
  win: BrowserWindow,
  expr: string,
  timeoutMs = 30000,
  stepMs = 250
): Promise<unknown> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const v = await win.webContents.executeJavaScript(expr)
      if (v) return v
    } catch {
      /* 页面尚未就绪时继续等 */
    }
    await new Promise((r) => setTimeout(r, stepMs))
  }
  return null
}

// ---------------- 高亮 / 笔记自检（MOYU_TEST_ANNOT=<testpath>） ----------------
/**
 * 端到端验证 B1：
 * 1. 选中正文 → 浮出四色工具条（文本类在 .text-inner，EPUB 在 iframe 内）；
 * 2. 点色 → 写入 IndexedDB（annotations 表）并即时渲染（CSS Custom Highlight API）；
 * 3. 重开阅读窗口 → 高亮仍在（偏移/CFI 换算与渲染链路跨会话稳定）；
 * 4. 点高亮 → 备注气泡 → 保存 → 面板可见备注文本。
 */
async function runAnnotTest(testPath: string): Promise<void> {
  const renderer = path.join(__dirname, '../renderer/reader.html')
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const out: string[] = []
  const logs: string[] = []
  const ext = path.extname(testPath).slice(1).toLowerCase()
  const bookId = `testbook-${ext}`
  const makeWin = () =>
    new BrowserWindow({
      width: 1200,
      height: 900,
      frame: false,
      show: true,
      webPreferences: {
        preload: path.join(__dirname, '../preload/preload.js'),
        contextIsolation: true,
        sandbox: false,
        backgroundThrottling: false,
      },
    })
  const watchLogs = (w: BrowserWindow) => {
    w.webContents.on('console-message', (_e, level, message) => {
      if (level >= 2) logs.push(String(message).slice(0, 200))
    })
  }
  /** 读取注解数（IndexedDB） */
  const countAnnotations = (w: BrowserWindow) =>
    w.webContents.executeJavaScript(`(async () => {
      const req = indexedDB.open('moyu-reader')
      const db = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error) })
      const count = await new Promise((res) => {
        try {
          const tx = db.transaction('annotations', 'readonly')
          const rq = tx.objectStore('annotations').count()
          rq.onsuccess = () => res(rq.result)
          rq.onerror = () => res(-1)
        } catch (e) { res(-2) }
      })
      db.close()
      return count
    })()`)
  /** 读取高亮状态：文本类在宿主文档，EPUB 在 iframe 文档 */
  const readHighlights = (w: BrowserWindow) =>
    w.webContents.executeJavaScript(`(() => {
      const pick = (win) => {
        const reg = win && win.CSS ? win.CSS.highlights : null
        const hl = reg ? reg.get('moyu-hl-yellow') : null
        if (!hl || !hl.size) return null
        const r = [...hl][0].getBoundingClientRect()
        return { size: hl.size, left: r.left, top: r.top, width: r.width, height: r.height }
      }
      let info = pick(window)
      let inFrame = false
      let frameRect = null
      if (!info) {
        const f = document.querySelector('.epub-host iframe')
        if (f && f.contentDocument) {
          info = pick(f.contentDocument.defaultView)
          if (info) {
            inFrame = true
            const fr = f.getBoundingClientRect()
            frameRect = { left: fr.left, top: fr.top }
          }
        }
      }
      if (!info) return JSON.stringify({ size: 0, inFrame: false })
      const ox = inFrame && frameRect ? frameRect.left : 0
      const oy = inFrame && frameRect ? frameRect.top : 0
      return JSON.stringify({
        size: info.size,
        inFrame,
        // 宿主坐标系（用于派发点击）
        host: { x: Math.round(ox + info.left + Math.min(info.width, 40) / 2), y: Math.round(oy + info.top + info.height / 2) },
        // iframe 内坐标（点击要派发给 iframe 文档）
        local: { x: Math.round(info.left + Math.min(info.width, 40) / 2), y: Math.round(info.top + info.height / 2) },
      })
    })()`)

  try {
    const w1 = makeWin()
    watchLogs(w1)
    await w1.loadFile(renderer, { search: `?testpath=${encodeURIComponent(testPath)}` })
    const ready1 = await waitFor(w1, `(() => {
      const t = document.querySelector('.reader-title')?.textContent || ''
      if (!t) return ''
      if (document.querySelector('.text-inner section')) return 'text'
      const f = document.querySelector('.epub-host iframe')
      if (f && f.contentDocument && (f.contentDocument.body?.innerText || '').length > 10) return 'epub'
      return ''
    })()`, 30000)
    out.push(`ready1: ${ready1 ?? 'TIMEOUT'}`)
    await sleep(400)

    // 选中一段文字（文本类：.text-inner；EPUB：iframe 正文）
    const bar = await w1.webContents.executeJavaScript(`(async () => {
      const inner = document.querySelector('.text-inner')
      const frame = document.querySelector('.epub-host iframe')
      const doc = inner ? document : frame && frame.contentDocument ? frame.contentDocument : null
      const root = inner ? inner.querySelector('section') : doc && doc.body
      if (!doc || !root) return JSON.stringify({ dots: 0, reason: 'no-content' })
      const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      const nodes = []
      let n
      while ((n = walker.nextNode())) nodes.push(n)
      const usable = nodes.find((t) => (t.data || '').trim().length > 4)
      if (!usable) return JSON.stringify({ dots: 0, reason: 'no-text' })
      const r = doc.createRange()
      r.setStart(usable, 0)
      r.setEnd(usable, Math.min(30, usable.data.length))
      const sel = doc.defaultView.getSelection()
      sel.removeAllRanges()
      sel.addRange(r)
      if (inner) document.querySelector('.text-scroll').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      else doc.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
      await new Promise((r2) => setTimeout(r2, 500))
      return JSON.stringify({
        dots: document.querySelectorAll('.sel-bar .sel-dot').length,
        text: (sel.toString() || '').slice(0, 16),
        mode: inner ? 'text' : 'epub',
      })
    })()`)
    out.push(`selection ${bar}`)

    await w1.webContents.executeJavaScript(
      `document.querySelector('.sel-dot[data-color="yellow"]')?.click()`
    )
    await sleep(1100)
    const count1 = await countAnnotations(w1)
    const hl1 = await readHighlights(w1)
    out.push(`created count=${count1} hl=${hl1}`)
    const c1 = JSON.parse(String(hl1)) as { size: number }

    w1.destroy()
    await sleep(700)

    // 重开：验证高亮跨会话仍在
    const w2 = makeWin()
    watchLogs(w2)
    await w2.loadFile(renderer, { search: `?bookId=${bookId}` })
    await waitFor(w2, `document.querySelector('.reader-title')?.textContent || ''`, 25000)
    await waitFor(w2, `(() => {
      const f = document.querySelector('.epub-host iframe')
      if (f && f.contentDocument) {
        const reg = f.contentDocument.defaultView && f.contentDocument.defaultView.CSS
        const hl = reg && reg.highlights ? reg.highlights.get('moyu-hl-yellow') : null
        if (hl && hl.size) return 'epub-hl'
      }
      const reg = window.CSS && CSS.highlights
      const hl = reg ? reg.get('moyu-hl-yellow') : null
      return hl && hl.size ? 'hl' : ''
    })()`, 20000)
    await sleep(400)
    const count2 = await countAnnotations(w2)
    const hl2raw = await readHighlights(w2)
    out.push(`persist count=${count2} hl=${hl2raw}`)
    const hl2 = JSON.parse(String(hl2raw)) as {
      size: number
      inFrame: boolean
      host: { x: number; y: number }
      local: { x: number; y: number }
    }

    // 点高亮 → 备注气泡 → 保存 → 面板可见
    const notePanel = await w2.webContents.executeJavaScript(`(async () => {
      const hx = ${hl2.host?.x ?? -1}
      const hy = ${hl2.host?.y ?? -1}
      const lx = ${hl2.local?.x ?? -1}
      const ly = ${hl2.local?.y ?? -1}
      const inFrame = ${hl2.inFrame ? 'true' : 'false'}
      if (hx < 0 || hy < 0) return 'no-rect'
      if (inFrame) {
        const f = document.querySelector('.epub-host iframe')
        const doc = f && f.contentDocument
        if (!doc) return 'no-frame'
        doc.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: lx, clientY: ly }))
        doc.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: lx, clientY: ly }))
        doc.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: lx, clientY: ly }))
      } else {
        const el = document.querySelector('.text-scroll')
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, clientX: hx, clientY: hy }))
      }
      await new Promise((r) => setTimeout(r, 450))
      const pop = document.querySelector('.note-pop')
      if (!pop) return 'no-pop'
      const ta = pop.querySelector('textarea')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(ta, '自动化验证备注：这一段值得回看')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 200))
      const save = Array.from(pop.querySelectorAll('button')).find((b) => (b.textContent || '').includes('保存'))
      save?.click()
      await new Promise((r) => setTimeout(r, 800))
      const open = Array.from(document.querySelectorAll('.rb')).find((b) => (b.textContent || '').includes('笔记'))
      open?.click()
      await new Promise((r) => setTimeout(r, 400))
      const panel = document.querySelector('.anno-panel')
      return panel ? panel.innerText.replace(/\s+/g, ' ').slice(0, 200) : 'no-panel'
    })()`)
    out.push(`note ${notePanel}`)

    // 整页笔记（无选区）：面板「+ 笔记」→ 输入 → 保存
    const pageNote = await w2.webContents.executeJavaScript(`(async () => {
      // 上一步可能已经把面板打开了（按钮是 toggle，再点会关掉）
      if (!document.querySelector('.anno-panel')) {
        const open = Array.from(document.querySelectorAll('.rb')).find((b) => (b.textContent || '').includes('笔记'))
        open?.click()
        await new Promise((r) => setTimeout(r, 300))
      }
      const add = Array.from(document.querySelectorAll('.anno-panel .rb')).find((b) => (b.textContent || '').includes('+ 笔记'))
      if (!add) return 'no-add-btn'
      add.click()
      await new Promise((r) => setTimeout(r, 350))
      const pop = document.querySelector('.note-pop')
      if (!pop) return 'no-pop'
      const ta = pop.querySelector('textarea')
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set
      setter.call(ta, '整页笔记：这一页的要点')
      ta.dispatchEvent(new Event('input', { bubbles: true }))
      const save = Array.from(pop.querySelectorAll('button')).find((b) => (b.textContent || '').includes('保存'))
      save?.click()
      await new Promise((r) => setTimeout(r, 900))
      // 「+ 笔记」会先关面板，保存后重新打开再读列表
      const btn = Array.from(document.querySelectorAll('.rb')).find((b) => (b.textContent || '').includes('笔记'))
      btn?.click()
      await new Promise((r) => setTimeout(r, 350))
      return document.querySelector('.anno-panel')?.innerText.replace(/\s+/g, ' ').slice(0, 200) ?? 'no-panel'
    })()`)
    out.push(`page-note ${pageNote}`)

    // 主窗口笔记页：聚合展示（同一 profile，验证跨窗口读取）
    const main = createWindow()
    mainWin = main
    await main.loadFile(path.join(__dirname, '../renderer/index.html'), { search: '?tab=notes&theme=dark' })
    await waitFor(main, `document.querySelector('.note-card') ? 'ok' : ''`, 15000)
    const notesPage = await main.webContents.executeJavaScript(`(() => {
      const page = document.querySelector('.notes-page')
      if (!page) return 'no-page'
      return page.innerText.replace(/\s+/g, ' ').slice(0, 600)
    })()`)
    out.push(`notes-page ${notesPage}`)
    main.show()
    await sleep(900) // 等首帧把列表画出来，避免截到「读取中…」
    try {
      const img = await main.webContents.capturePage()
      const devShot = path.join(app.getAppPath(), 'screenshots')
      const target = fs.existsSync(devShot) ? devShot : app.getPath('userData')
      fs.writeFileSync(path.join(target, 'notes-page.png'), img.toPNG())
    } catch {
      /* ignore */
    }

    const okDots = String(bar).includes('"dots":4')
    const okCreate = count1 === 1 && c1.size === 1
    const okPersist = count2 === 1 && hl2.size === 1
    const okNote = String(notePanel).includes('自动化验证备注')
    const okNotesPage = String(notesPage).includes('自动化验证备注')
    const okPageNote = String(pageNote).includes('整页笔记')
    out.push(
      `checks dots=${okDots} create=${okCreate} persist=${okPersist} note=${okNote} notesPage=${okNotesPage} pageNote=${okPageNote}`
    )
    out.push(
      okDots && okCreate && okPersist && okNote && okNotesPage && okPageNote ? 'ANNOT_OK' : 'ANNOT_FAIL'
    )
    try {
      const img = await w2.webContents.capturePage()
      const devShot = path.join(app.getAppPath(), 'screenshots')
      const target = fs.existsSync(devShot) ? devShot : app.getPath('userData')
      fs.writeFileSync(path.join(target, 'reader-annotation.png'), img.toPNG())
    } catch {
      /* ignore */
    }
    w2.destroy()
  } catch (e) {
    out.push(`ERROR ${String(e)}`)
  }
  if (logs.length) out.push('logs: ' + logs.join(' | '))
  console.log('ANNOT_TEST:')
  for (const l of out) console.log('  ' + l)
  writeTestResult('annot', out)
  app.exit(0)
}

// ---------------- 备份导入自检（MOYU_TEST_BACKUP=1） ----------------
/**
 * 验证 B3（导入部分）：
 * 1. 合法备份导入后，书只合并不重复，书签/笔记各 +1；
 * 2. 同一份备份再导入一次完全幂等（去重生效）；
 * 3. 进度不倒退（备份里的进度更高时才更新位置）；
 * 4. 设置在导入后生效；
 * 5. 非法 JSON / 非本应用 / 过高 schema 均被拒。
 */
async function runBackupTest(): Promise<void> {
  const out: string[] = []
  const win = createWindow()
  mainWin = win
  try {
    await win.loadFile(path.join(__dirname, '../renderer/index.html'), {
      search: '?testhooks=1&theme=dark',
    })
    await waitFor(win, 'window.__moyuBackup ? 1 : 0', 20000)
    await new Promise((r) => setTimeout(r, 1500))

    const raw = await win.webContents.executeJavaScript(`(async () => {
      const B = window.__moyuBackup
      const db = await new Promise((res, rej) => {
        const q = indexedDB.open('moyu-reader')
        q.onsuccess = () => res(q.result)
        q.onerror = () => rej(q.error)
      })
      const getAll = (st) => new Promise((res) => {
        try {
          const tx = db.transaction(st, 'readonly')
          const rq = tx.objectStore(st).getAll()
          rq.onsuccess = () => res(rq.result)
          rq.onerror = () => res([])
        } catch (e) { res([]) }
      })
      const count = (st) => new Promise((res) => {
        try {
          const tx = db.transaction(st, 'readonly')
          const rq = tx.objectStore(st).count()
          rq.onsuccess = () => res(rq.result)
          rq.onerror = () => res(-1)
        } catch (e) { res(-1) }
      })
      const before = {
        books: await count('books'),
        bookmarks: await count('bookmarks'),
        annotations: await count('annotations'),
      }
      const books = await getAll('books')
      const target = books[0]
      const now = Date.now()
      const payload = {
        app: 'moyu-reader',
        schema: 2,
        exportedAt: now,
        dbVersion: 3,
        books: books.map((b) => b.id === target.id
          ? { ...b, progress: 0.5, lastReadAt: now + 1000, locator: { kind: 'offset', value: 1200, percent: 0.5, updatedAt: now } }
          : b),
        kv: [{ key: 'settings', value: { theme: 'light', material: 'solid', animMode: 'fade', wallpaperId: null, wallpaperDim: 0.4, wallpaperFit: 'cover', wallpaperZoom: 1, contentOpacity: 0.8, dockOpacity: 0.5, cardSize: 'md', bossKey: 'Alt+X', nativeAcrylic: false } }],
        bookmarks: [{
          id: 'bm-import-1', bookId: target.id,
          locator: { kind: 'offset', value: 1200, percent: 0.5, updatedAt: now },
          label: '导入书签', createdAt: now,
        }],
        annotations: [{
          id: 'an-import-1', bookId: target.id, type: 'note', color: 'green',
          locator: { kind: 'offset', value: 1200, percent: 0.5, updatedAt: now },
          endOffset: 1240, chapterTitle: '导入章', excerpt: '导入的摘录',
          note: '导入的备注', createdAt: now, updatedAt: now,
        }],
      }
      const json = JSON.stringify(payload)
      const r1 = await B.importBackup(json)
      const mid = {
        books: await count('books'),
        bookmarks: await count('bookmarks'),
        annotations: await count('annotations'),
      }
      const r2 = await B.importBackup(json)
      const after = {
        books: await count('books'),
        bookmarks: await count('bookmarks'),
        annotations: await count('annotations'),
      }
      const updated = (await getAll('books')).find((b) => b.id === target.id)
      const kv = await getAll('kv')
      const settings = (kv.find((r) => r.key === 'settings') || {}).value || {}
      const bad1 = await B.importBackup('{not json')
      const bad2 = await B.importBackup(JSON.stringify({ app: 'other', schema: 2, books: [] }))
      const bad3 = await B.importBackup(JSON.stringify({ app: 'moyu-reader', schema: 99, books: [] }))
      db.close()
      return JSON.stringify({
        before, mid, after,
        stats1: r1.stats, stats2: r2.stats,
        progress: updated ? updated.progress : -1,
        theme: settings.theme || '',
        bad: [bad1.ok, bad1.error, bad2.ok, bad2.error, bad3.ok, bad3.error],
      })
    })()`)

    out.push(String(raw))
    const r = JSON.parse(String(raw)) as {
      before: { books: number; bookmarks: number; annotations: number }
      mid: { books: number; bookmarks: number; annotations: number }
      after: { books: number; bookmarks: number; annotations: number }
      stats1: { addedBooks: number; mergedBooks: number; addedBookmarks: number; addedAnnotations: number }
      stats2: { addedBookmarks: number; addedAnnotations: number }
      progress: number
      theme: string
      bad: unknown[]
    }
    const okBooks = r.mid.books === r.before.books && r.mid.books > 0
    const okBookmarks = r.mid.bookmarks === r.before.bookmarks + 1
    const okAnnotations = r.mid.annotations === r.before.annotations + 1
    const okIdempotent =
      r.after.books === r.mid.books &&
      r.after.bookmarks === r.mid.bookmarks &&
      r.after.annotations === r.mid.annotations &&
      r.stats2.addedBookmarks === 0 &&
      r.stats2.addedAnnotations === 0
    const okProgress = r.progress >= 0.5
    const okSettings = r.theme === 'light'
    const okBad = r.bad[0] === false && r.bad[2] === false && r.bad[4] === false
    out.push(
      `checks books=${okBooks} bookmarks=${okBookmarks} annotations=${okAnnotations} idempotent=${okIdempotent} progress=${okProgress} settings=${okSettings} rejectInvalid=${okBad}`
    )
    out.push(
      okBooks && okBookmarks && okAnnotations && okIdempotent && okProgress && okSettings && okBad
        ? 'BACKUP_OK'
        : 'BACKUP_FAIL'
    )
  } catch (e) {
    out.push(`ERROR ${String(e)}`)
  }
  console.log('BACKUP_TEST:')
  for (const l of out) console.log('  ' + l)
  writeTestResult('backup', out)
  app.exit(0)
}

// ---------------- DB 迁移自检（MOYU_TEST_DB=1） ----------------
/** 校验 IndexedDB 版本与各表条目数：确认 v1→v2 迁移不丢数据 */
async function runDbCheck(): Promise<void> {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const win = createWindow()
  mainWin = win
  const out: string[] = []
  try {
    await win.loadFile(path.join(__dirname, '../renderer/index.html'), { search: '?theme=dark' })
    await sleep(3200)
    const info = await win.webContents.executeJavaScript(`(async () => {
      const req = indexedDB.open('moyu-reader')
      const db = await new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error) })
      const count = (name) => new Promise((res) => {
        try {
          const tx = db.transaction(name, 'readonly')
          const rq = tx.objectStore(name).count()
          rq.onsuccess = () => res(rq.result)
          rq.onerror = () => res(-1)
        } catch (e) { res(-2) }
      })
      const r = {
        version: db.version,
        stores: Array.from(db.objectStoreNames),
        books: await count('books'),
        covers: await count('covers'),
        kv: await count('kv'),
        bookmarks: await count('bookmarks'),
        annotations: await count('annotations'),
      }
      db.close()
      return JSON.stringify(r)
    })()`)
    out.push(String(info))
    const o = JSON.parse(String(info)) as {
      version: number
      stores: string[]
      books: number
      bookmarks: number
      annotations: number
    }
    const okRun =
      o.version === 3 &&
      o.stores.includes('bookmarks') &&
      o.stores.includes('annotations') &&
      o.books > 0 &&
      o.bookmarks >= 0 &&
      o.annotations >= 0
    out.push(okRun ? 'DB_CHECK_OK' : 'DB_CHECK_FAIL')
  } catch (e) {
    out.push(`ERROR ${String(e)}`)
  }
  console.log('DB_CHECK:')
  for (const l of out) console.log('  ' + l)
  writeTestResult('db', out)
  app.exit(0)
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
  // 打包后 app.getAppPath() 指向 app.asar（只读），必须回退到 userData 再建目录
  let outDir = path.join(app.getAppPath(), 'screenshots')
  try {
    fs.mkdirSync(outDir, { recursive: true })
  } catch {
    outDir = app.getPath('userData')
    fs.mkdirSync(outDir, { recursive: true })
  }
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
      backgroundThrottling: false,
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
      const pick = (sel, d) => {
        const doc = d || document
        const el = doc.querySelector(sel)
        if (!el) return null
        const cs = doc.defaultView.getComputedStyle(el)
        return [cs.fontSize, cs.color, cs.fontFamily.split(',')[0].replace(/["']/g, ''), 'w' + cs.fontWeight, 'lh' + cs.lineHeight].join('|')
      }
      const ef = document.querySelector('.epub-host iframe')
      const ed = ef && ef.contentDocument ? ef.contentDocument : null
      return JSON.stringify({
        styles: {
          h1: pick('.text-inner h1'), h2: pick('.text-inner h2'),
          p: pick('.text-inner p:not(.doc-title):not(.doc-subtitle)'),
          h3: pick('.text-inner h3'),
          strong: pick('.text-inner strong'), em: pick('.text-inner em'),
          table: pick('.text-inner table'), th: pick('.text-inner th'),
          pre: pick('.text-inner pre'), quote: pick('.text-inner blockquote'),
          epubBody: ed ? pick('body', ed) : null,
          epubH1: ed ? pick('h1', ed) : null,
          epubP: ed ? pick('p', ed) : null,
          epubTable: ed ? pick('table', ed) : null,
          epubTh: ed ? pick('th', ed) : null,
          epubStrong: ed ? pick('strong', ed) : null,
        },
        counts: (() => {
          const c = (sel) => document.querySelectorAll(sel).length
          const ec = (sel) => (ed ? ed.querySelectorAll(sel).length : 0)
          return {
            h1: c('.text-inner h1'), h2: c('.text-inner h2'), h3: c('.text-inner h3'), p: c('.text-inner p'),
            table: c('.text-inner table'), th: c('.text-inner th'), li: c('.text-inner li'),
            pre: c('.text-inner pre'), quote: c('.text-inner blockquote'), img: c('.text-inner img'),
            epubH1: ec('h1'), epubP: ec('p'), epubTable: ec('table'), epubTh: ec('th'), epubLi: ec('li'),
            epubStrong: ec('strong'), epubEm: ec('em'),
          }
        })(),
        colors: (() => {
          const out = []
          const add = (el) => { const c = el.ownerDocument.defaultView.getComputedStyle(el).color; if (c && out.indexOf(c) < 0) out.push(c) }
          document.querySelectorAll('.text-inner span, .text-inner [style*="color"]').forEach(add)
          if (ed) ed.querySelectorAll('span').forEach(add)
          return out.slice(0, 8)
        })(),
        fonts: (() => {
          const ok = (f) => { try { return document.fonts.check('16px ' + f) } catch (e) { return false } }
          return { yahei: ok('"Microsoft YaHei"'), simsun: ok('SimSun'), kaiti: ok('KaiTi'), consolas: ok('Consolas') }
        })(),
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
        epubScroll: (() => {
          const host = document.querySelector('.epub-host')
          if (!host) return null
          const box = (el) => (el ? [el.scrollHeight, el.clientHeight, el.scrollTop] : null)
          const view = host.querySelector('.epub-container, .epub-view, .epub-viewer')
          const f = host.querySelector('iframe')
          let docBox = null
          try {
            const d = f && f.contentDocument
            if (d) docBox = [d.documentElement.scrollHeight, d.documentElement.clientHeight, d.documentElement.scrollTop || d.body.scrollTop]
          } catch (e) { docBox = 'blocked' }
          return { host: box(host), view: box(view), viewTag: view ? view.className : null, doc: docBox }
        })(),
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

    // 第二屏：滚动到中下部再截一张，用于核对表格/列表/引用等首屏看不到的元素
    try {
      await win.webContents.executeJavaScript(`(() => {
        const host = document.querySelector('.text-scroll, .pdf-scroll, .comic-scroll, .epub-host')
        if (host) host.scrollTo(0, Math.max(0, (host.scrollHeight - host.clientHeight) * 0.55))
        const f = document.querySelector('.epub-host iframe')
        if (f && f.contentWindow) {
          try { f.contentWindow.scrollTo(0, f.contentDocument.documentElement.scrollHeight * 0.5) } catch (e) {}
        }
        return true
      })()`)
      await new Promise((r) => setTimeout(r, 900))
      for (let i = 0; i < 3; i++) {
        try {
          const img2 = await win.webContents.capturePage()
          const buf2 = img2.toPNG()
          if (buf2.length > 2000) {
            const target = fs.existsSync(outDir) ? outDir : app.getPath('userData')
            fs.writeFileSync(path.join(target, `reader-${name}-p2.png`), buf2)
            break
          }
        } catch {
          /* 重试 */
        }
        await new Promise((r) => setTimeout(r, 400))
      }
    } catch {
      /* 第二屏失败不影响主流程 */
    }
    if (logs.length) console.log(`READER_LOG[${name}]: ${logs.slice(0, 3).join(' | ')}`)
  } catch (e) {
    console.log(`READER_TEST[${name}]: FAIL ${String(e)}`)
  }
  app.exit(0)
}

// ---------------- 大文件性能自检（MOYU_TEST_PERF="<name>|<testpath>"） ----------------
/**
 * 验证 A4：惰性 HTML + 分批挂载后的首开耗时、DOM 规模，以及「滚到底」时占位高度是否撑得住。
 * 关键断言：
 * - PERF_FIRST_PAINT：从 loadFile 到正文首帧（含解码/分章/首屏挂载）；
 * - DOM_BUDGET：挂载章节数应远小于总章节数（否则分批没生效）；
 * - BOTTOM_OK：滚到底后末章已挂载（占位估算没把可滚高度做小）。
 */
async function runPerfTest(name: string, testPath: string): Promise<void> {
  const renderer = path.join(__dirname, '../renderer/reader.html')
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  const out: string[] = []
  const win = new BrowserWindow({
    width: 1200,
    height: 900,
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false,
    },
  })
  try {
    const t0 = Date.now()
    await win.loadFile(renderer, { search: `?testpath=${encodeURIComponent(testPath)}` })
    let perf: Record<string, number> | null = null
    for (let i = 0; i < 200; i++) {
      perf = await win.webContents.executeJavaScript('window.__moyuPerf ?? null')
      if (perf && perf.ready && perf['text-first-paint']) break
      await sleep(50)
    }
    const readyMs = perf?.ready ?? -1
    const paintMs = perf?.['text-first-paint'] ?? -1
    const ioMs = perf?.parseMs ?? -1
    out.push(`timing load=${Date.now() - t0}ms paint=${paintMs}ms ready=${readyMs}ms parse=${ioMs}ms`)
    out.push(`perf ${JSON.stringify(perf ?? {})}`)

    const dom = await win.webContents.executeJavaScript(`(() => {
      const secs = Array.from(document.querySelectorAll('.text-inner section'))
      const mounted = secs.filter((s) => s.dataset.ph !== '1')
      const scroller = document.querySelector('.text-scroll')
      return JSON.stringify({
        sections: secs.length,
        mounted: mounted.length,
        nodes: document.querySelectorAll('*').length,
        scrollHeight: scroller ? Math.round(scroller.scrollHeight) : -1,
        firstText: (document.querySelector('.text-inner section p')?.textContent ?? '').slice(0, 24),
      })
    })()`)
    const d = JSON.parse(dom) as {
      sections: number
      mounted: number
      nodes: number
      scrollHeight: number
      firstText: string
    }
    out.push(`dom ${dom}`)
    const mem = await win.webContents.executeJavaScript(
      'performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1'
    )
    out.push(`heapMB ${mem}`)

    // 滚到底：验证占位估算撑出的可滚高度够用，且末章会被挂载
    const bottom = await win.webContents.executeJavaScript(`(async () => {
      const el = document.querySelector('.text-scroll')
      if (!el) return 'no-scroller'
      el.scrollTop = el.scrollHeight
      await new Promise((r) => setTimeout(r, 900))
      const secs = Array.from(document.querySelectorAll('.text-inner section'))
      const last = secs[secs.length - 1]
      return JSON.stringify({
        mounted: secs.filter((s) => s.dataset.ph !== '1').length,
        lastMounted: last ? last.dataset.ph !== '1' : false,
        percent: document.querySelector('.reader-sub')?.textContent?.trim() ?? '',
      })
    })()`)
    out.push(`bottom ${bottom}`)
    const b = JSON.parse(String(bottom)) as { mounted: number; lastMounted: boolean; percent: string }

    out.push(paintMs >= 0 && paintMs < 1500 ? `PERF_OK(paint=${paintMs}ms)` : `PERF_SLOW(paint=${paintMs}ms)`)
    out.push(d.mounted < d.sections ? `LAZY_OK(${d.mounted}/${d.sections})` : `LAZY_FAIL(全量挂载)`)
    out.push(b.lastMounted ? 'BOTTOM_OK' : 'BOTTOM_FAIL(末章未挂载)')
  } catch (e) {
    out.push(`ERROR ${String(e)}`)
  }
  console.log(`PERF_TEST[${name}]:`)
  for (const l of out) console.log('  ' + l)
  writeTestResult(`perf-${name}`, out)
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
        backgroundThrottling: false,
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
    const advanced = await w1.webContents.executeJavaScript(`(async () => {
      const text = document.querySelector('.text-scroll')
      if (text) { text.scrollTo(0, 600); return 'scroll:' + Math.round(text.scrollTop) }
      // PDF / 漫画：滚各自的容器（此前只处理文本类与 EPUB，这两类从未推进过位置）
      const box = document.querySelector('.pdf-scroll, .comic-scroll')
      if (box) {
        const max = box.scrollHeight - box.clientHeight
        if (max > 40) {
          box.scrollTo(0, max * 0.5)
          return 'scroll2:' + Math.round(box.scrollTop) + '/' + Math.round(max)
        }
        return 'no-range:' + Math.round(max)
      }
      // EPUB：目录按钮要等 book.loaded.navigation 完成才渲染，轮询等待
      for (let i = 0; i < 80; i++) {
        const btn = Array.from(document.querySelectorAll('button')).find(b => (b.textContent || '').includes('目录'))
        if (btn) { btn.click(); return 'toc-opened' }
        await new Promise(r => setTimeout(r, 100))
      }
      return 'no-toc-btn'
    })()`)
    if (String(advanced) === 'toc-opened') {
      await sleep(500)
      const jumped = await w1.webContents.executeJavaScript(`(() => {
        const items = document.querySelectorAll('.epub-nav-item')
        if (items.length > 1) { items[1].click(); return 'jumped:' + items.length }
        return 'no-toc-items'
      })()`)
      out.push(`advance ${advanced} -> ${jumped}`)
      // 章内容器滚动（验证 K3：章内位置也要记住）
      await sleep(1200)
      const scrolled = await w1.webContents.executeJavaScript(`(() => {
        const el = document.querySelector('.epub-container, .epub-view')
        if (!el) return 'no-container'
        const max = el.scrollHeight - el.clientHeight
        el.scrollTo(0, max * 0.6)
        return 'scroll:' + Math.round(el.scrollTop) + '/' + Math.round(max)
      })()`)
      out.push(`inner-scroll ${scrolled}`)
    } else {
      out.push(`advance ${advanced}`)
    }
    await sleep(2600) // > 保存节流 1200ms
    const beforeClose = await w1.webContents.executeJavaScript(`({
      scrollTop: Math.round(document.querySelector('.text-scroll, .epub-host, .pdf-scroll, .comic-scroll')?.scrollTop ?? -1),
      containerScroll: Math.round(document.querySelector('.epub-container, .epub-view')?.scrollTop ?? -1),
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
      containerScroll: Math.round(document.querySelector('.epub-container, .epub-view')?.scrollTop ?? -1),
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
    const c1 = Number((beforeClose as { containerScroll: number }).containerScroll)
    const c2 = Number((after as { containerScroll: number }).containerScroll)
    if (c1 > 20) {
      const tolC = Math.max(40, c1 * 0.2)
      out.push(
        Math.abs(c2 - c1) <= tolC
          ? `INNER_SCROLL_OK(expect≈${c1}, got=${c2})`
          : `INNER_SCROLL_FAIL(expect≈${c1}, got=${c2})`
      )
    }
    if (String(cfiCheck) === 'chapter2') out.push('RESTORE_OK(cfi)')
    else if (want > 5 && Math.abs(got - want) <= tol) out.push(`RESTORE_OK(scroll expect≈${want}, got=${got})`)
    else if (want <= 5) out.push('RESTORE_SKIP(无滚动量)')
    else out.push(`RESTORE_FAIL(expect≈${want}, got=${got}, chapter=${cfiCheck})`)
    try {
      const img = await w2.webContents.capturePage()
      const devShot = path.join(app.getAppPath(), 'screenshots')
      const target = fs.existsSync(devShot) ? devShot : app.getPath('userData')
      fs.writeFileSync(path.join(target, `reader-${name}-restored.png`), img.toPNG())
    } catch {
      /* 截图失败不影响断言结果 */
    }
    w2.destroy()
  } catch (e) {
    out.push(`ERROR ${String(e)}`)
  }
  console.log(`RESTORE_TEST[${name}]:`)
  for (const l of out) console.log('  ' + l)
  writeTestResult(`restore-${name}`, out)
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
  // 打包后 app.getAppPath() 指向 app.asar（只读），必须回退到 userData 再建目录
  let outDir = path.join(app.getAppPath(), 'screenshots')
  try {
    fs.mkdirSync(outDir, { recursive: true })
  } catch {
    outDir = app.getPath('userData')
    fs.mkdirSync(outDir, { recursive: true })
  }
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
    if (process.env.MOYU_TEST_PERF) {
      const raw = process.env.MOYU_TEST_PERF
      const i = raw.indexOf('|')
      void runPerfTest(i > 0 ? raw.slice(0, i) : 'big', i > 0 ? raw.slice(i + 1) : '')
      return
    }
    if (process.env.MOYU_TEST_SEARCH) {
      const raw = process.env.MOYU_TEST_SEARCH
      const i = raw.indexOf('|')
      void runSearchTest(i > 0 ? raw.slice(0, i) : raw, i > 0 ? raw.slice(i + 1) : '排版')
      return
    }
    if (process.env.MOYU_TEST_FIXTURES) {
      void runFixtures(process.env.MOYU_TEST_FIXTURES)
      return
    }
    if (process.env.MOYU_TEST_BOOKMARK) {
      void runBookmarkTest(process.env.MOYU_TEST_BOOKMARK)
      return
    }
    if (process.env.MOYU_TEST_ANNOT) {
      void runAnnotTest(process.env.MOYU_TEST_ANNOT)
      return
    }
    if (process.env.MOYU_TEST_BACKUP === '1') {
      void runBackupTest()
      return
    }
    if (process.env.MOYU_TEST_DB === '1') {
      void runDbCheck()
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
