// 外壳布局探针：打印根节点/侧栏/顶栏/壁纸层的真实矩形，用于定位「顶部多出一条」。
// 用法：env -u ELECTRON_RUN_AS_NODE npx electron scripts/probe-shell.cjs [query] [profile]
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')

const root = path.resolve(__dirname, '..')
const query = process.argv[2] || '?theme=light&injectwp=1'
const profile = process.argv[3] || path.join(os.tmpdir(), 'moyu-probe-shell')
fs.mkdirSync(profile, { recursive: true })
app.setPath('userData', profile)

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    frame: false,
    show: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: path.join(root, 'out/preload/preload.js'),
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: false,
    },
  })
  await win.loadFile(path.join(root, 'out/renderer/index.html'), { search: query })
  await new Promise((r) => setTimeout(r, 3500))

  const info = await win.webContents.executeJavaScript(`(() => {
    const rect = (sel) => {
      const el = document.querySelector(sel)
      if (!el) return null
      const r = el.getBoundingClientRect()
      const cs = getComputedStyle(el)
      return {
        top: Math.round(r.top * 10) / 10,
        left: Math.round(r.left * 10) / 10,
        w: Math.round(r.width),
        h: Math.round(r.height),
        pad: cs.padding,
        margin: cs.margin,
        pos: cs.position,
        bg: cs.backgroundColor,
        z: cs.zIndex,
      }
    }
    return JSON.stringify({
      inner: [window.innerWidth, window.innerHeight],
      dpr: window.devicePixelRatio,
      scroll: [document.documentElement.scrollTop, document.body.scrollTop],
      root: rect('.app-root'),
      shell: rect('.app-shell'),
      main: rect('.app-main'),
      tabbar: rect('.tabbar'),
      topbar: rect('.topbar'),
      content: rect('.app-content'),
      wallpaper: rect('.wallpaper-layer'),
      dim: rect('.wallpaper-dim, .wallpaper-scrim'),
      bodyFirst: (() => {
        const kids = Array.from(document.body.children).map((el) => ({
          tag: el.tagName,
          cls: el.className && String(el.className).slice(0, 40),
          top: Math.round(el.getBoundingClientRect().top),
        }))
        return kids
      })(),
    }, null, 1)
  })()`)
  console.log('SHELL_PROBE', info)

  const img = await win.webContents.capturePage()
  const out = path.join(os.tmpdir(), 'probe-shell.png')
  fs.writeFileSync(out, img.toPNG())
  console.log('SHOT', out, img.getSize())
  app.exit(0)
})
