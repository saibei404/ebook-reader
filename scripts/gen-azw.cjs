/**
 * 生成一个最小可用的 MOBI6（.azw）样本，用于验证 AZW 解析链路。
 *
 * 关键：@lingo-reader/mobi-parser 的字段偏移是**相对 record0 起点**的（不是相对 MOBI 头），
 * 已用真实 AZW3 对照确认：
 *   magic@16 / length@20 / titleOffset@84 / titleLength@88 / resourceStart@108 / exthFlag@128
 *   EXTH 块位于 16 + length 处
 * 照这个布局生成，解析器的 MOBI6 分支才能跑通。
 *
 * 用法：node scripts/gen-azw.cjs [输出路径]
 */
const fs = require('node:fs')
const path = require('node:path')

const out = process.argv[2] || path.join(__dirname, '..', 'test-fixtures', 'azw', '01-排版全要素.azw')
fs.mkdirSync(path.dirname(out), { recursive: true })

const title = '排版全要素（AZW 样本）'
const author = '墨鱼测试组'
const html = `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${title}</title></head>
<body>
<h1>第一章 AZW 解析验证</h1>
<p>这一段来自 MOBI6（.azw）容器的正文记录。能显示这行字，说明 PalmDOC 头、MOBI 头、EXTH 与记录表都被正确解析。</p>
<p>MOBI6 与 AZW3 的差别在排版能力：前者只有 HTML 3.2 子集，没有 CSS 盒模型，缩进靠段落与换行模拟。</p>
<h2>1.1 中文字形</h2>
<p>窗外下雨，落在空调外机上，声音像有人在极远处翻动一叠旧报纸。</p>
<h2>1.2 结束</h2>
<p>样本到此结束。</p>
</body></html>`

const textBytes = Buffer.from(html, 'utf8')
const REC_SIZE = 4096
const textRecords = []
for (let i = 0; i < textBytes.length; i += REC_SIZE) textRecords.push(textBytes.subarray(i, i + REC_SIZE))

const MOBI_LEN = 232
const titleBuf = Buffer.from(title, 'utf8')
const authorBuf = Buffer.from(author, 'utf8')

const exthRec = (type, data) => {
  const h = Buffer.alloc(8)
  h.writeUInt32BE(type, 0)
  h.writeUInt32BE(8 + data.length, 4)
  return Buffer.concat([h, data])
}
const u32 = (n) => {
  const b = Buffer.alloc(4)
  b.writeUInt32BE(n >>> 0, 0)
  return b
}
const exthBody = Buffer.concat([
  exthRec(503, titleBuf),
  exthRec(100, authorBuf),
  exthRec(121, u32(0xffffffff)),
])
const exthHead = Buffer.alloc(12)
exthHead.write('EXTH', 0, 'ascii')
exthHead.writeUInt32BE(12 + exthBody.length, 4)
exthHead.writeUInt32BE(3, 8)
const exth = Buffer.concat([exthHead, exthBody])

const nameOffset = 16 + MOBI_LEN + exth.length
const rec0 = Buffer.alloc(nameOffset + titleBuf.length, 0)

// PalmDOC header（0..15）
rec0.writeUInt16BE(1, 0) // compression = 1（不压缩）
rec0.writeUInt16BE(0, 2)
rec0.writeUInt32BE(textBytes.length, 4) // 正文总长
rec0.writeUInt16BE(textRecords.length, 8)
rec0.writeUInt16BE(REC_SIZE, 10)
rec0.writeUInt16BE(0, 12) // 未加密
rec0.writeUInt16BE(0, 14)

// MOBI header（16 起）
rec0.write('MOBI', 16, 'ascii')
rec0.writeUInt32BE(MOBI_LEN, 20)
rec0.writeUInt32BE(2, 24) // type = book
rec0.writeUInt32BE(65001, 28) // utf-8
rec0.writeUInt32BE(0x12345678, 32) // uid
rec0.writeUInt32BE(6, 36) // file version 6
rec0.writeUInt32BE(nameOffset, 84) // 书名偏移（绝对）
rec0.writeUInt32BE(titleBuf.length, 88)
rec0.writeUInt32BE(0x00000804, 92) // locale = zh-CN
rec0.writeUInt32BE(0, 96)
rec0.writeUInt32BE(0, 100)
rec0.writeUInt32BE(6, 104) // min version
rec0.writeUInt32BE(textRecords.length + 1, 108) // first image index（无图）
rec0.writeUInt32BE(0, 112)
rec0.writeUInt32BE(0, 116)
rec0.writeUInt32BE(0, 120)
rec0.writeUInt32BE(0, 124)
rec0.writeUInt32BE(0x40, 128) // exthFlag：bit0x40 = 有 EXTH

exth.copy(rec0, 16 + MOBI_LEN)
titleBuf.copy(rec0, nameOffset)

const records = [rec0, ...textRecords]
const numRecords = records.length

// PalmDB 头（78 字节）
const header = Buffer.alloc(78)
header.write('AZWtest'.padEnd(32, '\0'), 0, 'ascii')
const now = Math.floor(Date.now() / 1000) + 2082844800
header.writeUInt32BE(now, 36)
header.writeUInt32BE(now, 40)
header.write('BOOK', 60, 'ascii')
header.write('MOBI', 64, 'ascii')
header.writeUInt32BE(numRecords * 2, 68)
header.writeUInt16BE(numRecords, 76)

// 记录表（MOBI 用 8 字节项）+ 数据
const table = Buffer.alloc(numRecords * 8)
let offset = 78 + table.length + 2
records.forEach((r, i) => {
  table.writeUInt32BE(offset, i * 8)
  table.writeUInt8(0, i * 8 + 4)
  table.writeUIntBE(i, i * 8 + 5, 3)
  offset += r.length
})

fs.writeFileSync(out, Buffer.concat([header, table, Buffer.alloc(2), ...records]))
console.log('written', out, `${(fs.statSync(out).size / 1024).toFixed(1)}KB`, 'records=', numRecords)
