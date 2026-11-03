/**
 * 诊断脚本：打开阅读窗口，打印 DOM 关键节点与控制台错误。
 * 用法：env -u ELECTRON_RUN_AS_NODE npx electron scripts/probe-reader.cjs "<testpath>" "<userDataDir>"
 * 不参与打包，仅供排查（P0/P1 回归时定位「iframe 不出现」这类静默失败）。
 */
const path = require('path')
const fs = require('fs')
const { app, BrowserWindow, ipcMain, protocol } = require('electron')

// 可选：模拟主进程的自定义协议注册（诊断 epub.js 是否受其影响）
if (process.env.PROBE_SCHEME === '1') {
  protocol.registerSchemesAsPrivileged([
    { scheme: 'moyu-file', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: true, stream: true } },
  ])
}

const testPath = process.argv[2] || ''
const profile = process.argv[3] || path.join(require('os').tmpdir(), 'moyu-probe')
const waitMs = Number(process.argv[4] || 7000)

app.commandLine.appendSwitch('disable-gpu-compositing')
app.setPath('userData', profile)

app.whenReady().then(async () => {
  if (process.env.PROBE_HANDLE === '1') {
    try {
      protocol.handle('moyu-file', async () => new Response('', { status: 404 }))
    } catch (e) {
      console.log('[probe] protocol.handle failed', String(e))
    }
  }

  // 最小实现 read-book：仅返回完整字节（本项目 PDF 走协议，诊断 EPUB/文本够用）
  ipcMain.handle('moyu:read-book', async (_e, p) => {
    try {
      const st = fs.statSync(p)
      const buf = fs.readFileSync(p)
      return {
        ok: true,
        mode: 'buffer',
        data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
        size: st.size,
        name: path.basename(p),
      }
    } catch (err) {
      return { ok: false, error: String(err && err.message) }
    }
  })
  const win = new BrowserWindow({
    width: 1200,
    height: 900,
    frame: false,
    show: process.env.PROBE_SHOW === '1',
    webPreferences: {
      preload: path.join(__dirname, '../out/preload/preload.js'),
      contextIsolation: true,
      sandbox: false,
      backgroundThrottling: process.env.PROBE_NOTHROTTLE === '1' ? false : undefined,
    },
  })
  win.webContents.on('console-message', (_e, level, message) => {
    console.log(`[console:${level}] ${String(message).slice(0, 300)}`)
  })
  win.webContents.on('render-process-gone', (_e, d) => console.log('[gone]', JSON.stringify(d)))
  win.webContents.on('dom-ready', () => {
    win.webContents.executeJavaScript(`window.addEventListener('unhandledrejection', (e) => console.log('UNHANDLED_REJ: ' + ((e.reason && e.reason.stack) || e.reason))); window.addEventListener('error', (e) => console.log('WINDOW_ERR: ' + e.message))`).catch(() => {})
  })
  await win.loadFile(path.join(__dirname, '../out/renderer/reader.html'), {
    search: `?testpath=${encodeURIComponent(testPath)}`,
  })
  await new Promise((r) => setTimeout(r, waitMs))
  const info = await win.webContents.executeJavaScript(`(() => {
    const q = (s) => document.querySelector(s)
    const chunks = Array.from(document.querySelectorAll('script[src]')).map((s) => s.getAttribute('src'))
    const host = q('.epub-host')
    return JSON.stringify({
      html: document.body.innerText.slice(0, 300),
      host: !!host,
      hostSize: host ? [host.clientWidth, host.clientHeight] : null,
      hostHtml: host ? host.innerHTML.slice(0, 400) : null,
      state: q('.reader-state')?.innerText ?? '',
      iframes: document.querySelectorAll('iframe').length,
      chunks,
      containerKids: q('.epub-container') ? q('.epub-container').children.length : -1,
      containerHtmlLen: q('.epub-container') ? q('.epub-container').innerHTML.length : -1,
    }, null, 2)
  })()`)
  console.log(info)
  app.exit(0)
})
