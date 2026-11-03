import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

/**
 * 主进程日志。
 *
 * 设计取舍：
 * 1. **同步写**：我们只在异常/关键节点写日志，频率极低；同步写能保证进程崩溃前
 *    最后一条记录已经落盘（异步流在 crash 时会丢尾巴，恰恰是最需要的那部分）。
 * 2. **自己滚动**：单文件 2MB，保留 5 份，避免长期挂机把用户磁盘写满。
 * 3. **绝不抛错**：日志失败必须静默——否则「记录失败」会把应用带崩，本末倒置。
 */

export type LogLevel = 'error' | 'warn' | 'info'

const MAX_BYTES = 2 * 1024 * 1024
const MAX_FILES = 5
const FILE_NAME = 'app.log'

let dir = ''
let file = ''
let bytes = 0
let ready = false

function init(): boolean {
  if (ready) return true
  try {
    // userData 在 ready 前后都可访问；这里仍包 try，避免异常环境（只读盘）把启动打断
    dir = path.join(app.getPath('userData'), 'logs')
    fs.mkdirSync(dir, { recursive: true })
    file = path.join(dir, FILE_NAME)
    bytes = fs.existsSync(file) ? fs.statSync(file).size : 0
    ready = true
    return true
  } catch {
    return false
  }
}

/** 单文件超限时滚动：app.log → app.1.log → … → app.4.log（最旧的丢弃） */
function rotate(nextLen: number): void {
  if (bytes + nextLen <= MAX_BYTES) return
  try {
    for (let i = MAX_FILES - 1; i >= 1; i--) {
      const from = i === 1 ? file : path.join(dir, `app.${i - 1}.log`)
      const to = path.join(dir, `app.${i}.log`)
      // Windows 上 rename 到已存在文件会失败，必须先删目标
      if (fs.existsSync(to)) fs.unlinkSync(to)
      if (fs.existsSync(from)) fs.renameSync(from, to)
    }
    bytes = 0
  } catch {
    // 滚动失败就继续往原文件追加：宁可文件变大，也不能丢日志
  }
}

function stamp(): string {
  const d = new Date()
  const p = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(
    d.getMinutes()
  )}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
}

/** 把任意值压成一行文本（避免循环引用 / 二进制把日志撑爆） */
export function brief(value: unknown, max = 900): string {
  if (value === null || value === undefined) return String(value)
  if (typeof value === 'string') return value.length > max ? `${value.slice(0, max)}…` : value
  if (value instanceof Error) return formatError(value)
  if (typeof value === 'object') {
    const seen = new WeakSet<object>()
    try {
      const s = JSON.stringify(value, (_k, v) => {
        if (typeof v === 'object' && v !== null) {
          if (seen.has(v as object)) return '[Circular]'
          seen.add(v as object)
        }
        if (typeof v === 'function') return '[Function]'
        return v
      })
      return s && s.length > max ? `${s.slice(0, max)}…` : String(s)
    } catch {
      return Object.prototype.toString.call(value)
    }
  }
  return String(value)
}

export function formatError(e: unknown): string {
  if (e instanceof Error) {
    const stack = e.stack ? `\n${e.stack}` : ''
    return `${e.name}: ${e.message}${stack}`
  }
  return brief(e, 1600)
}

export function log(level: LogLevel, scope: string, message: string, extra?: unknown): void {
  if (!init()) return
  const line = `${stamp()} [${level.toUpperCase()}] [${scope}] ${message}${
    extra === undefined ? '' : ` | ${brief(extra)}`
  }\n`
  try {
    rotate(Buffer.byteLength(line))
    fs.appendFileSync(file, line)
    bytes += Buffer.byteLength(line)
  } catch {
    /* 只读盘 / 磁盘满：静默失败，不影响应用 */
  }
}

export function logError(scope: string, e: unknown, note?: string): void {
  log('error', scope, note ? `${note} :: ${formatError(e)}` : formatError(e))
}

/** 日志文件绝对路径（诊断页展示给用户） */
export function logFilePath(): string {
  init()
  return file
}

/** 读取最近日志（末尾 n 行），用于诊断导出 */
export function readRecentLogs(maxLines = 240): string {
  if (!init()) return '(日志目录不可用)'
  const parts: string[] = []
  // 只取当前文件 + 上一份，够用且快
  for (const name of [`app.1.log`, FILE_NAME]) {
    const p = path.join(dir, name)
    try {
      if (fs.existsSync(p)) parts.push(fs.readFileSync(p, 'utf8'))
    } catch {
      /* ignore */
    }
  }
  const lines = parts.join('').split('\n').filter(Boolean)
  return lines.slice(-maxLines).join('\n')
}

/** 环境与运行时快照（诊断报告抬头） */
export function environmentSnapshot(): string {
  let mem = 'n/a'
  try {
    const m = process.memoryUsage()
    const mb = (n: number) => `${Math.round(n / 1048576)}MB`
    mem = `rss ${mb(m.rss)} / heap ${mb(m.heapUsed)}`
  } catch {
    /* ignore */
  }
  return [
    `应用版本: ${app.getVersion()}`,
    `Electron: ${process.versions.electron} / Chrome: ${process.versions.chrome} / Node: ${process.versions.node}`,
    `平台: ${process.platform} ${process.arch} ${process.getSystemVersion?.() ?? ''}`,
    `内存: ${mem}`,
    `数据目录: ${app.getPath('userData')}`,
    `日志文件: ${logFilePath()}`,
  ].join('\n')
}
