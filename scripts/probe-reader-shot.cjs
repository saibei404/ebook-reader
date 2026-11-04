// 阅读窗口截图探针：加载指定文件并截一张图，用于人工确认排版。
// 用法：npx electron scripts/probe-reader-shot.cjs <absPath> [outName] [query]
const { app, BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')

const file = process.argv[2]
const outName = process.argv[3] || 'reader-shot.png'
const extra = process.argv[4] || 'theme=paper'
const root = path.resolve(__dirname, '..')
const profile = path.join(os.tmpdir(), 'moyu-probe-reader-shot')
fs.mkdirSync(profile, { recursive: true })
app.setPath('userData', profile)

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1200, height: 880, frame: false, show: true,
    backgroundColor: '#faf9f6',
    webPreferences: {
      preload: path.join(root, 'out/preload/preload.js'),
      contextIsolation: true, sandbox: false, backgroundThrottling: false,
    },
  })
  const q = `?testpath=${encodeURIComponent(file)}&${extra}`
  await win.loadFile(path.join(root, 'out/renderer/reader.html'), { search: q })
  for (let i = 0; i < 60; i++) {
    const ok = await win.webContents.executeJavaScript(
      `document.querySelector('.text-inner section p') ? 1 : 0`
    )
    if (ok) break
    await new Promise((r) => setTimeout(r, 300))
  }
  await new Promise((r) => setTimeout(r, 1200))
  const info = await win.webContents.executeJavaScript(`(() => {
    const p = document.querySelector('.text-inner section p')
    const cs = p ? getComputedStyle(p) : null
    const inner = document.querySelector('.text-inner')
    return JSON.stringify({
      paragraphs: document.querySelectorAll('.text-inner section p').length,
      first: (p && p.textContent || '').slice(0, 40),
      indent: cs ? cs.textIndent : '',
      lineHeight: cs ? cs.lineHeight : '',
      margin: cs ? cs.marginBottom : '',
      align: cs ? cs.textAlign : '',
      innerWidth: inner ? Math.round(inner.getBoundingClientRect().width) : 0,
    })
  })()`)
  console.log('TEXT_INFO', info)
  const dom = await win.webContents.executeJavaScript(`(() => {
    const inner = document.querySelector('.text-inner')
    const scroll = document.querySelector('.text-scroll')
    return JSON.stringify({
      state: document.querySelector('.reader-state')?.innerText?.slice(0, 120) || '',
      hasScroll: !!scroll,
      innerHtml: inner ? inner.innerHTML.slice(0, 300) : '',
      children: inner ? Array.from(inner.children).map((c) => c.tagName + '.' + c.className).slice(0, 8) : [],
    })
  })()`)
  console.log('DOM', dom)
  const img = await win.webContents.capturePage()
  const out = path.join(os.tmpdir(), outName)
  fs.writeFileSync(out, img.toPNG())
  console.log('SHOT', out)
  app.exit(0)
})
