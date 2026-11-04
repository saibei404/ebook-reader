// 用「桌面级截屏」对比「窗口内容截屏」，判断顶部色带是渲染层还是 DWM/窗口层画的。
// 用法：npx electron scripts/probe-screen.cjs [query]
const { app, BrowserWindow, screen, desktopCapturer } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const root = path.resolve(__dirname, '..')
const query = process.argv[2] || '?theme=dark&injectwp=1'

const profile = path.join(os.tmpdir(), 'moyu-probe-screen')
fs.mkdirSync(profile, { recursive: true })
app.setPath('userData', profile)

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280, height: 820, frame: false, show: true,
    x: 60, y: 60,
    transparent: true,
    backgroundColor: '#00000000',
    backgroundMaterial: 'acrylic',
    webPreferences: { preload: path.join(root, 'out/preload/preload.js'), contextIsolation: true, sandbox: false, backgroundThrottling: false },
  })
  await win.loadFile(path.join(root, 'out/renderer/index.html'), { search: query })
  await new Promise((r) => setTimeout(r, 4000))
  win.setAlwaysOnTop(true)
  if (process.env.PROBE_MAX === '1') {
    win.maximize()
    await new Promise((r) => setTimeout(r, 1500))
  }
  await new Promise((r) => setTimeout(r, 600))

  const b = win.getBounds()
  const disp = screen.getPrimaryDisplay()
  const scale = disp.scaleFactor
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: Math.round(disp.size.width * scale), height: Math.round(disp.size.height * scale) },
  })
  const full = sources[0].thumbnail
  const buf = full.toPNG()
  const outDir = path.join(os.tmpdir())
  fs.writeFileSync(path.join(outDir, 'probe-screen-full-max.png'), buf)
  const img = await win.webContents.capturePage()
  fs.writeFileSync(path.join(outDir, 'probe-screen-content-max.png'), img.toPNG())
  console.log('SCREEN_INFO', JSON.stringify({
    max: !!win.isMaximized(),
    bounds: b, scale, dispSize: disp.size,
    full: full.getSize(), content: img.getSize(), outDir,
  }))
  app.exit(0)
})
