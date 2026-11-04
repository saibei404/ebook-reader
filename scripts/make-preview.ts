/**
 * 为 AZW3 / AZW / CBR / DOC 生成「浏览版」预览（自包含 HTML，双击即可在浏览器里看）。
 *
 * 复用 electron/convert.ts 里的转换逻辑（同一套解析代码，避免预览与实际阅读效果不一致）：
 *   node --experimental-strip-types scripts/make-preview.ts <输出目录>
 *
 * 产物：
 *   previews/azw3-<书名>.html + <书名>-assets/    章节正文（含图片）
 *   previews/azw-<书名>.html
 *   previews/doc-<书名>.html
 *   previews/cbr-<书名>.html                      图片按页拼版（图片内联 base64）
 *   previews/index.html                           总目录
 */
import fs from 'node:fs'
import path from 'node:path'
import { convertCbr, convertDoc, convertMobi, convDir, type ConvertResult } from '../electron/convert.ts'

const outDir = process.argv[2] || 'D:/moyu-reader/previews'
fs.mkdirSync(outDir, { recursive: true })

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const CSS = `
  :root { color-scheme: light dark; }
  body { margin: 0; background: #f6f5f2; color: #1c1c1e;
         font: 16px/1.85 "Songti SC","Source Han Serif SC","Noto Serif CJK SC",serif; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 48px 24px 96px; }
  .meta { border-bottom: 1px solid #e2e0da; padding-bottom: 16px; margin-bottom: 32px;
          font: 13px/1.6 -apple-system,"PingFang SC",sans-serif; color: #6b6b70; }
  .meta b { color: #1c1c1e; font-size: 20px; display: block; margin-bottom: 6px; font-weight: 600; }
  .toc { background: #fff; border: 1px solid #e8e6e0; border-radius: 12px; padding: 16px 20px; margin-bottom: 36px;
         font: 14px/1.9 -apple-system,"PingFang SC",sans-serif; }
  .toc a { color: #0066cc; text-decoration: none; }
  .toc ol { margin: 0; padding-left: 20px; }
  h1 { font-size: 24px; margin: 44px 0 16px; }
  h2 { font-size: 19px; margin: 32px 0 12px; }
  p { margin: 0 0 1em; text-indent: 2em; }
  img { max-width: 100%; height: auto; display: block; margin: 16px auto; }
  table { border-collapse: collapse; margin: 16px 0; font-size: 15px; }
  td, th { border: 1px solid #dcdad4; padding: 6px 10px; }
  .sheet { display: grid; gap: 12px; }
  .sheet figure { margin: 0; background: #fff; border: 1px solid #e8e6e0; border-radius: 10px; overflow: hidden; }
  .sheet img { margin: 0; width: 100%; }
  .sheet figcaption { font: 12px/1.6 -apple-system,sans-serif; color: #6b6b70; padding: 6px 10px; }
  .err { color: #b3261e; }
`

function page(title: string, body: string): string {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body><div class="wrap">${body}</div></body></html>`
}

/** 把章节 HTML 里的本地图片复制进 assets 目录，改写成相对路径 */
function localizeImages(html: string, assetsDir: string, prefix: string, counter: { n: number }): string {
  return html.replace(/(<img\b[^>]*?\bsrc=")([^"]+)(")/gi, (m, pre: string, src: string, post: string) => {
    if (!/^[a-zA-Z]:[\\/]/.test(src)) return m
    if (!fs.existsSync(src)) return m
    const name = `${prefix}-${String(++counter.n).padStart(3, '0')}${path.extname(src).toLowerCase()}`
    fs.mkdirSync(assetsDir, { recursive: true })
    fs.copyFileSync(src, path.join(assetsDir, name))
    return `${pre}${path.basename(assetsDir)}/${name}${post}`
  })
}

interface Item {
  kind: string
  file: string
  html?: string
  count?: number
  error?: string
  bytes?: number
}

const targets: { kind: string; file: string }[] = []
const addDir = (kind: string, dir: string, exts: string[]): void => {
  if (!fs.existsSync(dir)) return
  for (const f of fs.readdirSync(dir)) {
    if (exts.includes(path.extname(f).toLowerCase())) targets.push({ kind, file: path.join(dir, f) })
  }
}
// 真实样本（Kindle 书在下载目录），其余用 test-fixtures 里造出来的样本
addDir('azw3', 'C:/Users/HUAPPLE/Downloads', ['.azw3'])
addDir('azw', path.join(process.cwd(), 'test-fixtures/azw'), ['.azw'])
addDir('cbr', path.join(process.cwd(), 'test-fixtures/cbr'), ['.cbr'])
addDir('doc', path.join(process.cwd(), 'test-fixtures/doc'), ['.doc'])

const results: Item[] = []

for (const t of targets) {
  const base = path.basename(t.file, path.extname(t.file))
  // 文件名里常带「（z-library.sk, 1lib.sk…）」这类尾巴，预览名只留主标题，便于浏览
  const short = base.split(/\s*[（(]/)[0].trim() || base
  const safeBase = short.replace(/[\\/:*?"<>|]/g, '_').slice(0, 40)
  const cache = convDir(path.join(outDir, '.cache'), t.file)
  let res: ConvertResult
  try {
    if (t.kind === 'azw3' || t.kind === 'azw') res = await convertMobi(t.file, path.join(cache, 'res'), (p) => p)
    else if (t.kind === 'cbr') res = await convertCbr(t.file, cache, (p) => p)
    else res = await convertDoc(t.file)
  } catch (e) {
    res = { ok: false, error: String((e as Error).message ?? e) }
  }

  const outName = `${t.kind}-${safeBase}.html`
  const outFile = path.join(outDir, outName)

  if (!res.ok) {
    results.push({ kind: t.kind, file: t.file, error: res.error })
    fs.writeFileSync(outFile, page(`${t.kind} 预览失败`, `<div class="meta"><b>${esc(base)}</b>${esc(t.kind.toUpperCase())} · ${esc(t.file)}</div><p class="err">解析失败：${esc(res.error)}</p>`))
    continue
  }

  if (res.mode === 'chapters') {
    const assetsDir = path.join(outDir, `${safeBase}-assets`)
    const counter = { n: 0 }
    const toc = res.chapters.map((c, i) => `<li><a href="#ch-${i}">${esc(c.title)}</a></li>`).join('')
    const body = res.chapters
      .map((c, i) => `<section id="ch-${i}">${localizeImages(c.html, assetsDir, safeBase, counter)}</section>`)
      .join('\n')
    const meta = `<b>${esc(res.meta.title || base)}</b>${esc(res.meta.author || '')} · ${t.kind.toUpperCase()} · ${res.chapters.length} 章`
    fs.writeFileSync(outFile, page(base, `<div class="meta">${meta}</div><div class="toc"><ol>${toc}</ol></div>${body}`))
    results.push({ kind: t.kind, file: t.file, html: outFile, count: res.chapters.length })
  } else if (res.mode === 'text') {
    const paras = res.text.split(/\n{2,}/).map((p) => `<p>${esc(p.trim())}</p>`).join('\n')
    fs.writeFileSync(outFile, page(base, `<div class="meta"><b>${esc(base)}</b>DOC · ${res.text.length} 字</div>${paras}`))
    results.push({ kind: t.kind, file: t.file, html: outFile, count: 1 })
  } else {
    const figs = res.images
      .map((img, i) => {
        const b64 = fs.readFileSync(img.url).toString('base64')
        const mime = /\.png$/i.test(img.url) ? 'image/png' : /\.gif$/i.test(img.url) ? 'image/gif' : /\.webp$/i.test(img.url) ? 'image/webp' : 'image/jpeg'
        return `<figure><img alt="${esc(img.name)}" src="data:${mime};base64,${b64}"><figcaption>第 ${i + 1} 页 · ${esc(img.name)}</figcaption></figure>`
      })
      .join('\n')
    fs.writeFileSync(outFile, page(base, `<div class="meta"><b>${esc(base)}</b>CBR · 共 ${res.images.length} 页</div><div class="sheet">${figs}</div>`))
    results.push({ kind: t.kind, file: t.file, html: outFile, count: res.images.length })
  }
}

// 总目录
const rows = results
  .map((r) =>
    r.error
      ? `<tr><td>${r.kind.toUpperCase()}</td><td>${esc(path.basename(r.file))}</td><td class="err">失败：${esc(r.error)}</td></tr>`
      : `<tr><td>${r.kind.toUpperCase()}</td><td><a href="${encodeURI(path.basename(r.html!))}">${esc(path.basename(r.file))}</a></td><td>${r.count} ${r.kind === 'cbr' ? '页' : '章'}</td></tr>`
  )
  .join('\n')
fs.writeFileSync(
  path.join(outDir, 'index.html'),
  page('墨鱼阅读器 · 格式浏览版', `<div class="meta"><b>格式浏览版</b>AZW3 / AZW / CBR / DOC · 共 ${results.length} 个文件</div>
  <table><thead><tr><th>格式</th><th>源文件</th><th>内容</th></tr></thead><tbody>${rows}</tbody></table>`)
)

const okCount = results.filter((r) => !r.error).length
console.log(`\n生成完成：成功 ${okCount} / ${results.length}`)
for (const r of results) {
  console.log(`  ${r.error ? '✗' : '✓'} [${r.kind}] ${path.basename(r.file)}${r.error ? ' → ' + r.error : ` → ${path.basename(r.html!)}（${r.count}${r.kind === 'cbr' ? ' 页' : ' 章'}）`}`)
}
console.log(`\n目录：${outDir}`)
