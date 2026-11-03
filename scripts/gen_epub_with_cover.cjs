// 生成「带封面」的 EPUB 样本，用于验证导入时的封面提取（原样本没有任何图片）
const fs = require('fs')
const path = require('path')
const { zipSync, unzipSync } = require('fflate')

const root = path.resolve(__dirname, '..')
const src = path.join(root, 'test-fixtures/epub/01-排版全要素.epub')
const icon = path.join(root, 'resources/icon-256.png')
const out = 'D:/moyu-builds/fixtures/sample-cover.epub'
const outLocal = path.join(root, 'test-fixtures/epub/02-带封面.epub')

const zip = unzipSync(new Uint8Array(fs.readFileSync(src)))
const opfKey = Object.keys(zip).find((k) => k.toLowerCase().endsWith('.opf'))
if (!opfKey) throw new Error('样本中没有 OPF')

const dir = opfKey.includes('/') ? opfKey.slice(0, opfKey.lastIndexOf('/') + 1) : ''
zip[`${dir}cover.png`] = new Uint8Array(fs.readFileSync(icon))

const dec = new TextDecoder('utf-8')
let opf = dec.decode(zip[opfKey])
if (!/<\/manifest>/.test(opf)) throw new Error('OPF 结构异常：找不到 </manifest>')
opf = opf.replace(
  '</manifest>',
  '<item id="cover-img" href="cover.png" media-type="image/png" properties="cover-image"/></manifest>'
)
zip[opfKey] = new TextEncoder().encode(opf)

const bytes = zipSync(zip, { level: 6 })
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, bytes)
fs.writeFileSync(outLocal, bytes)
console.log('written', out, bytes.length, 'bytes')
