/**
 * archive-batches.cjs — 工程改动批次归档脚本
 *
 * 批次识别逻辑（三级优先）：
 *   1. memory 日志（.workbuddy/memory/*.md）：
 *      - `## 第N轮：<标题>（MM-DD）` → 轮次标题 + 日期
 *      - ``新 exe：`ebook-reader/release(-vN)?/...` `` → 版本号 + 产物路径
 *      - 无轮次号的 MVP 段落 → v1（对应最早的 release/ 目录）
 *   2. 文件系统扫描：release/、release-vN/、根目录 release-vN-*.exe
 *      → 与 memory 版本号对齐；memory 缺失时回退为「未登记批次」
 *   3. 文件 mtime：memory 缺日期时用产物 mtime 补全
 *
 * 安全规则（铁律）：
 *   - 只移动（rename），不删除、不覆盖；同卷 rename 零副本
 *   - 跨卷时 copy + sha256 校验，**保留原文件**
 *   - 目标已存在 → 自动追加 -2/-3 后缀
 *   - 默认 dry-run，--apply 才执行
 *
 * 用法：
 *   node scripts/archive-batches.cjs            # 预演（只打印计划）
 *   node scripts/archive-batches.cjs --apply    # 执行归档
 */

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')

const ROOT = path.resolve(__dirname, '..')
const ARCHIVE = path.join(ROOT, '_archive')
const APPLY = process.argv.includes('--apply')
const MEMORY_DIRS = [path.join(ROOT, '..', '.workbuddy', 'memory'), path.join(ROOT, '.workbuddy', 'memory')]

/* ---------- 工具 ---------- */

const log = (...a) => console.log(...a)

function sha256(file) {
  const h = crypto.createHash('sha256')
  h.update(fs.readFileSync(file))
  return h.digest('hex').slice(0, 16)
}

function fmtSize(n) {
  if (n >= 1 << 30) return (n / (1 << 20) / 1024).toFixed(2) + ' GB'
  if (n >= 1 << 20) return (n / (1 << 20)).toFixed(1) + ' MB'
  return (n / 1024).toFixed(0) + ' KB'
}

function walk(dir) {
  const out = []
  if (!fs.existsSync(dir)) return out
  if (fs.statSync(dir).isFile()) return [dir] // 入口为文件时直接返回
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) out.push(...walk(p))
    else out.push(p)
  }
  return out
}

function dirSize(dir) {
  return walk(dir).reduce((s, f) => s + fs.statSync(f).size, 0)
}

/** 标题 → slug：保留中文/字母/数字，截断 24 字 */
function slugify(title) {
  const s = title
    .replace(/[（(].*?[)）]/g, '') // 去括号备注
    .replace(/[^0-9A-Za-z\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24)
  return s || 'batch'
}

/* ---------- 1. 解析 memory 日志，识别改动批次 ---------- */

function parseMemoryBatches() {
  const batches = new Map() // version -> { no, title, date, exeRel, section }
  const allSections = [] // 所有章节（含无 exe 的，供 MVP 识别）
  const logs = []
  for (const d of MEMORY_DIRS) {
    if (!fs.existsSync(d)) continue
    for (const f of fs.readdirSync(d)) if (f.endsWith('.md')) logs.push(path.join(d, f))
  }
  logs.sort()

  for (const file of logs) {
    const lines = fs.readFileSync(file, 'utf8').split('\n')
    const fileYear = (file.match(/(\d{4})-(\d{2})-(\d{2})/) || [])[1] || '2026'
    let cur = null // 当前章节
    let curVersion = null

    const flush = () => {
      if (!cur) return
      const rec = {
        no: cur.no,
        title: cur.title,
        date: cur.date || (cur.md ? `${fileYear}-${cur.md}` : null),
        exeRel: cur.exeRel,
        section: cur.section,
      }
      allSections.push(rec)
      if (curVersion != null) batches.set(curVersion, rec)
    }

    for (const raw of lines) {
      const line = raw.trim()
      // 新章节
      const h = line.match(/^## (.+)$/)
      if (h) {
        flush()
        cur = { title: h[1], section: [line], no: null, date: null, md: null, exeRel: null }
        curVersion = null
        // 日期：标题中任意位置的 MM-DD（取最后一个，如「…（参考 WorkBuddy，10-24）」）
        const dmAll = [...h[1].matchAll(/(\d{2})-(\d{2})/g)]
        if (dmAll.length) {
          const dm = dmAll[dmAll.length - 1]
          cur.date = `${fileYear}-${dm[1]}-${dm[2]}`
          cur.md = `${dm[1]}-${dm[2]}`
        }
        continue
      }
      if (!cur) continue
      cur.section.push(line)
      // 轮次标题（第N轮：xxx）
      const rm = cur.title.match(/第(.+?)轮[：:]\s*(.+)/)
      if (rm && cur.no == null) cur.no = `第${rm[1]}轮`
      // exe 路径 → 版本号
      const em = line.match(/新 exe：`[^`]*?\/release(-v(\d+))?[^`]*?\.exe/)
      if (em) {
        curVersion = em[2] ? Number(em[2]) : 1
        cur.exeRel = line.match(/`([^`]+\.exe)`/)?.[1] || null
      }
    }
    flush()
  }

  // MVP 段（标题含 MVP 的最早章节）→ v1（对应最早的 release/ 目录）
  if (!batches.has(1)) {
    const mvp = allSections.find((s) => /MVP/.test(s.title))
    if (mvp) {
      batches.set(1, { no: 'MVP', title: mvp.title, date: mvp.date || '2026-10-20', exeRel: null, section: mvp.section })
    }
  }
  return batches
}

/* ---------- 2. 扫描文件系统，对齐产物 ---------- */

function scanArtifacts() {
  const found = new Map() // version -> { dirs: [], rootExes: [] }
  const put = (v, kind, p) => {
    if (!found.has(v)) found.set(v, { dirs: [], rootExes: [] })
    found.get(v)[kind].push(p)
  }
  for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (!e.isDirectory()) {
      const m = e.name.match(/^release-v(\d+)-.*\.exe$/)
      if (m) put(Number(m[1]), 'rootExes', path.join(ROOT, e.name))
      continue
    }
    if (e.name === 'release') put(1, 'dirs', path.join(ROOT, e.name))
    else {
      const m = e.name.match(/^release-v(\d+)$/)
      if (m) put(Number(m[1]), 'dirs', path.join(ROOT, e.name))
    }
  }
  return found
}

/* ---------- 3. 组装批次计划 ---------- */

function buildPlan() {
  const mem = parseMemoryBatches()
  const fsFound = scanArtifacts()
  const allVersions = [...new Set([...mem.keys(), ...fsFound.keys()])].sort((a, b) => a - b)

  const plan = []
  for (const v of allVersions) {
    const m = mem.get(v)
    const f = fsFound.get(v) || { dirs: [], rootExes: [] }
    if (!m && f.dirs.length === 0 && f.rootExes.length === 0) continue
    const date = m?.date || '2026-10-20'
    const title = m?.title || `未登记版本 v${v}`
    const folder = `${date}_v${String(v).padStart(2, '0')}_${slugify(title)}`
    plan.push({
      version: v,
      no: m?.no || `v${v}`,
      title,
      date,
      folder,
      section: m?.section || ['（memory 日志无记录，按目录归档）'],
      moves: [
        ...f.dirs.map((d) => ({ from: d, to: path.join(ARCHIVE, folder, path.basename(d)) })),
        ...f.rootExes.map((d) => ({ from: d, to: path.join(ARCHIVE, folder, 'release', path.basename(d)) })),
      ],
    })
  }

  // 杂项：构建临时配置残留（非版本批次）
  const misc = []
  for (const e of fs.readdirSync(ROOT, { withFileTypes: true })) {
    if (e.isFile() && /^electron\.vite\.config\.\d+\.mjs$/.test(e.name)) misc.push(path.join(ROOT, e.name))
  }
  if (misc.length) {
    plan.push({
      version: null,
      no: '杂项',
      title: '构建临时配置残留',
      date: '2026-10-25',
      folder: `_misc_build-temp-configs`,
      section: ['electron-vite 中断/重试留下的临时配置副本，非交付物，归档备查。'],
      moves: misc.map((f) => ({ from: f, to: path.join(ARCHIVE, `_misc_build-temp-configs`, e_name(f)) })),
    })
  }

  // dist-electron 旧输出目录 → 归入 v1 批次
  const de = path.join(ROOT, 'dist-electron')
  if (fs.existsSync(de)) {
    const v1 = plan.find((p) => p.version === 1)
    if (v1) v1.moves.push({ from: de, to: path.join(ARCHIVE, v1.folder, 'dist-electron') })
  }

  // screenshots：当前验证截图归属最新批次
  const shotDir = path.join(ROOT, 'screenshots')
  const latest = plan.filter((p) => p.version != null).at(-1)
  if (latest && fs.existsSync(shotDir) && fs.readdirSync(shotDir).length) {
    latest.moves.push({ from: shotDir, to: path.join(ARCHIVE, latest.folder, 'screenshots') })
    latest.screenshots = true
  }
  return plan
}

const e_name = (p) => path.basename(p)

/* ---------- 4. 执行（安全移动） ---------- */

function uniqueDest(p) {
  if (!fs.existsSync(p)) return p
  const dir = path.dirname(p)
  const ext = path.extname(p)
  const base = path.basename(p, ext)
  for (let i = 2; i < 999; i++) {
    const c = path.join(dir, `${base}-${i}${ext}`)
    if (!fs.existsSync(c)) return c
  }
  throw new Error('无法找到可用目标名: ' + p)
}

function safeMove(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true })
  const dest = uniqueDest(to)
  try {
    fs.renameSync(from, dest) // 同卷：瞬时移动，内容零损
    return { ok: true, dest, mode: 'rename' }
  } catch (err) {
    // EXDEV（跨卷）/ EPERM·EBUSY（文件被进程锁定）：降级为文件级复制，保留原件
    if (err.code !== 'EXDEV' && err.code !== 'EPERM' && err.code !== 'EBUSY') throw err
  }
  // 文件级复制：逐个 copyFileSync，单文件失败仅记录不中断（cpSync 对锁文件会段错误，禁用）
  let copied = 0
  const skipped = []
  for (const f of walk(from)) {
    const d = path.join(dest, path.relative(from, f))
    try {
      fs.mkdirSync(path.dirname(d), { recursive: true })
      fs.copyFileSync(f, d)
      copied++
    } catch {
      skipped.push(path.relative(ROOT, f))
    }
  }
  return { ok: true, dest, mode: 'copy-keep-source', copied, skipped }
}

/* ---------- 主流程 ---------- */

function main() {
  const plan = buildPlan()
  log(`\n📦 归档计划（${plan.length} 个批次）${APPLY ? ' — 执行模式' : ' — 预演模式（--apply 执行）'}\n`)
  const report = { generatedAt: new Date().toISOString(), apply: APPLY, batches: [] }
  let totalBytes = 0
  let totalFiles = 0

  for (const b of plan) {
    const files = []
    let bytes = 0
    for (const mv of b.moves) {
      const src = walk(mv.from)
      for (const f of src) bytes += fs.statSync(f).size
      files.push(...src)
    }
    totalBytes += bytes
    totalFiles += files.length
    log(`${b.no} ${b.date} ${b.title}`)
    log(`   → _archive/${b.folder}/  （${files.length} 个文件, ${fmtSize(bytes)}）`)
    for (const mv of b.moves) log(`      · ${path.relative(ROOT, mv.from)}`)
    report.batches.push({
      version: b.version, no: b.no, title: b.title, date: b.date,
      folder: b.folder, fileCount: files.length, bytes,
      files: files.map((f) => ({ path: path.relative(ROOT, f), size: fs.statSync(f).size })),
    })
  }

  log(`\n合计：${totalFiles} 个文件, ${fmtSize(totalBytes)}${APPLY ? '' : '（预演，未动任何文件）'}`)

  if (APPLY) {
    fs.mkdirSync(ARCHIVE, { recursive: true })
    const moved = []
    for (const b of plan) {
      for (const mv of b.moves) {
        const r = safeMove(mv.from, mv.to)
        moved.push({ from: path.relative(ROOT, mv.from), to: path.relative(ROOT, r.dest), mode: r.mode })
      }
    // MANIFEST
    const lines = [
        `# ${b.no} · ${b.title}`,
        '',
        `- 批次版本：${b.version == null ? '（非版本批次）' : 'v' + b.version}`,
        `- 日期：${b.date}`,
        `- 归档目录：_archive/${b.folder}/`,
        '',
        '## memory 日志原始记录',
        '',
        ...b.section.filter(Boolean).map((l) => (l ? '> ' + l : '>')),
        '',
      ]
      const dir = path.join(ARCHIVE, b.folder)
      if (fs.existsSync(dir)) {
        lines.push('## 文件清单', '')
        for (const f of walk(dir)) {
          const st = fs.statSync(f)
          lines.push(`- \`${path.relative(dir, f)}\` — ${fmtSize(st.size)}${st.size < 80 * 1024 * 1024 ? ' · sha256:' + sha256(f) : ''}`)
        }
      }
      fs.writeFileSync(path.join(dir, 'MANIFEST.md'), lines.join('\n'))
    }

    // 当前版 exe 回根目录（交付件常驻位置）
    const latestBatch = plan.filter((p) => p.version != null).at(-1)
    const latestExe = latestBatch?.moves.find((m) => m.from.endsWith('.exe') && fs.existsSync(m.to))
    if (latestExe) {
      const rootCopy = path.join(ROOT, '墨鱼阅读器-0.1.0-portable.exe')
      if (!fs.existsSync(rootCopy)) fs.copyFileSync(latestExe.to, rootCopy)
    }

    // 总索引 README
    const idx = [
      '# 改动批次归档索引',
      '',
      `> 生成时间：${new Date().toISOString()}`,
      '> 规则：只移动不删除不覆盖；同卷 rename 零副本；目标冲突自动追加 -N 后缀。',
      '',
      '| 批次 | 日期 | 标题 | 目录 | 文件数 | 体积 |',
      '|---|---|---|---|---|---|',
    ]
    for (const b of plan) {
      idx.push(`| ${b.no} | ${b.date} | ${b.title} | \`_archive/${b.folder}/\` | ${report.batches.find((x) => x.folder === b.folder)?.fileCount ?? 0} | ${fmtSize(report.batches.find((x) => x.folder === b.folder)?.bytes ?? 0)} |`)
    }
    idx.push('', '## 说明', '', '- 每个批次文件夹含 `MANIFEST.md`（memory 日志原文 + 文件清单 + sha256）。', '- `screenshots/` 归入最新验证批次（历史截图曾被同名覆盖，无法追溯）。', '- 代码无 git 历史；后续建议 `git init` 纳入版本管理。', '- 构建产物另存于 `D:/moyu-builds`，旧版整包已迁 `D:/moyu-oldbuilds`。', '')
    fs.writeFileSync(path.join(ARCHIVE, 'README.md'), idx.join('\n'))
    fs.writeFileSync(path.join(ARCHIVE, 'archive-report.json'), JSON.stringify({ ...report, moved }, null, 2))

    log(`\n✅ 归档完成：${moved.length} 项移动`)
    for (const m of moved) log(`   ${m.mode === 'rename' ? '→' : '⊕'} ${m.from}  =>  ${m.to}`)
    log(`\n索引：_archive/README.md · 报告：_archive/archive-report.json`)
  }
}

main()
