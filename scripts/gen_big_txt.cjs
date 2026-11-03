/**
 * 生成大体积 TXT 样本（默认 ~3MB，120 章），用于验证大文件首开性能与位置记忆。
 *
 * 用法：
 *   node scripts/gen_big_txt.cjs [输出路径] [目标MB]
 * 默认输出到 D:/moyu-builds/fixtures/moyu-big-3mb.txt（不进仓库，避免 git 膨胀）
 */
const fs = require('fs')
const path = require('path')

const out = process.argv[2] || 'D:/moyu-builds/fixtures/moyu-big-3mb.txt'
const targetMB = Number(process.argv[3] || 3)
const targetBytes = targetMB * 1024 * 1024

const SENTENCES = [
  '窗外的雨落在空调外机上，声音像有人在极远处翻动一叠旧报纸。',
  '他把杯子放回桌角，杯底与木面接触的一瞬间，发出一声轻得几乎听不见的响。',
  '这条路他走了七年，闭着眼也知道第三个路口有一块被树根顶起的地砖。',
  '会议室的投影仪嗡嗡作响，屏幕上那页幻灯片停了整整四分钟没有人说话。',
  '她想起小时候夏天午睡醒来，房间里只剩下风扇转动和蝉声的下午。',
  '代码在凌晨两点终于跑通，他没有欢呼，只是把椅子往后推了一点，看着天花板。',
  '书架最上层那本没读完的书，书签还夹在第一百二十页，已经放了三年。',
  '楼下的便利店换了第三块招牌，只有凌晨值班的那个店员一直是同一张脸。',
]

const paras = (n) => {
  const arr = []
  for (let i = 0; i < n; i++) {
    const s = []
    const len = 3 + Math.floor(Math.random() * 4)
    for (let k = 0; k < len; k++) s.push(SENTENCES[(i * 7 + k * 3) % SENTENCES.length])
    arr.push(s.join(''))
  }
  return arr.join('\n\n')
}

const chunks = ['墨鱼阅读器 · 大文件性能样本\n\n本文件由脚本生成，仅用于验证分章、惰性渲染与位置记忆。\n\n']
let i = 1
let bytes = Buffer.byteLength(chunks[0], 'utf8')
while (bytes < targetBytes) {
  const head = `第${i}章 长夜的第三个路口\n\n`
  const body = paras(14) + '\n\n'
  const block = head + body
  chunks.push(block)
  bytes += Buffer.byteLength(block, 'utf8')
  i++
}
fs.mkdirSync(path.dirname(out), { recursive: true })
fs.writeFileSync(out, chunks.join(''), 'utf8')
const st = fs.statSync(out)
console.log(`written ${out} ${(st.size / 1024 / 1024).toFixed(2)}MB chapters=${i - 1}`)
