// 用 Chromium（Electron）把 test-fixtures/pdf/_source.html 打印成 A4 PDF。
// 走真实排版引擎，保证中文字体、字号、颜色、表格与阅读器所见一致。
// 用法: electron scripts/make-test-pdf.cjs
const { app, BrowserWindow } = require('electron')
const fs = require('node:fs')
const path = require('node:path')

const root = path.dirname(__dirname)
const src = path.join(root, 'test-fixtures', 'pdf', '_source.html')
const out = path.join(root, 'test-fixtures', 'pdf', '01-排版全要素.pdf')

app.disableHardwareAcceleration()

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 900,
    height: 1200,
    show: false,
    webPreferences: { offscreen: false },
  })
  try {
    await win.loadFile(src)
    await new Promise((r) => setTimeout(r, 800))
    const data = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { marginType: 'none' },
      preferCSSPageSize: true,
    })
    fs.writeFileSync(out, data)
    console.log(`PDF_OK: ${out} (${(data.length / 1024).toFixed(1)} KB)`)
  } catch (e) {
    console.log('PDF_FAIL:', String(e))
  }
  app.exit(0)
})
