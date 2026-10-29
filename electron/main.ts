import { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, dialog, nativeImage, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
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

interface AppSettings {
  theme?: 'light' | 'dark'
  material?: string
  nativeAcrylic?: boolean
  bossKey?: string
}

let mainWin: BrowserWindow | null = null
let tray: Tray | null = null
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
    const w = aliveWin()
    if (!w) return
    if (w.isVisible()) {
      w.hide()
    } else {
      w.show()
      w.focus()
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
    const w = aliveWin()
    if (!w) return
    if (w.isVisible()) w.hide()
    else {
      w.show()
      w.focus()
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
  ipcMain.on('moyu:window', (_e, action: string) => {
    const win = aliveWin()
    if (!win) return
    if (action === 'minimize') win.minimize()
    else if (action === 'maximize') {
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
    } else if (action === 'close') win.hide()
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
    registerIPC()
    if (isShot) {
      mainWin = createWindow()
      runShots(mainWin)
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
  })
}
