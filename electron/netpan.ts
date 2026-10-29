import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { URL } from 'node:url'

export interface DavEntry {
  href: string
  name: string
  isDir: boolean
  size: number
}

export interface DavListResult {
  ok: boolean
  entries?: DavEntry[]
  error?: string
}

export interface DavDownloadResult {
  ok: boolean
  path?: string
  name?: string
  size?: number
  error?: string
}

const TIMEOUT_MS = 20000

function normalizeBase(raw: string): string {
  let s = raw.trim()
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s
  return s.replace(/\/+$/, '')
}

function joinUrl(base: string, sub: string): string {
  if (!sub) return base + '/'
  return base + (sub.startsWith('/') ? sub : '/' + sub)
}

function basicAuth(username: string, password: string): string {
  return 'Basic ' + Buffer.from(`${username}:${password}`, 'utf-8').toString('base64')
}

/** 通用 WebDAV 请求（PROPFIND / GET 等） */
function davRequest(
  fullUrl: string,
  method: string,
  opts: { username: string; password: string; headers?: Record<string, string>; body?: string }
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    let u: URL
    try {
      u = new global.URL(fullUrl)
    } catch {
      reject(new Error('无效的服务器地址'))
      return
    }
    const mod = u.protocol === 'http:' ? http : https
    const req = mod.request(
      u,
      {
        method,
        headers: {
          Authorization: basicAuth(opts.username, opts.password),
          ...opts.headers,
        },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) })
        )
      }
    )
    req.on('timeout', () => req.destroy(new Error('请求超时（20s）')))
    req.on('error', reject)
    if (opts.body) req.write(opts.body)
    req.end()
  })
}

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<d:propfind xmlns:d="DAV:"><d:prop>
<d:displayname/><d:getcontentlength/><d:resourcetype/><d:getlastmodified/>
</d:prop></d:propfind>`

/** 列目录（PROPFIND Depth:1），解析 multistatus */
export async function davList(
  baseUrl: string,
  subPath: string,
  username: string,
  password: string
): Promise<DavListResult> {
  const base = normalizeBase(baseUrl)
  const full = joinUrl(base, subPath)
  let res: { status: number; body: Buffer }
  try {
    res = await davRequest(full, 'PROPFIND', {
      username,
      password,
      headers: { Depth: '1', 'Content-Type': 'application/xml' },
      body: PROPFIND_BODY,
    })
  } catch (e) {
    return { ok: false, error: `连接失败：${String(e).slice(0, 160)}` }
  }
  if (res.status === 401 || res.status === 403) return { ok: false, error: '认证失败：请检查用户名与密码/授权码' }
  if (res.status >= 400) return { ok: false, error: `服务器返回 ${res.status}` }

  const xml = res.body.toString('utf-8')
  const entries: DavEntry[] = []
  const responseRe = /<d:response[^>]*>([\s\S]*?)<\/d:response>/gi
  let m: RegExpExecArray | null
  while ((m = responseRe.exec(xml))) {
    const block = m[1]
    const hrefM = /<d:href>([\s\S]*?)<\/d:href>/i.exec(block)
    if (!hrefM) continue
    let href = decodeURIComponent(hrefM[1].trim())
    const isDir = /<d:collection\s*\/?>|<\/d:collection>/i.test(block)
    const sizeM = /<d:getcontentlength>(\d+)<\/d:getcontentlength>/i.exec(block)
    const size = sizeM ? parseInt(sizeM[1], 10) : 0
    // 名称：href 末段；根条目（与请求路径同）跳过
    const clean = href.split('?')[0].replace(/\/+$/, '')
    const name = clean.split('/').pop() ?? ''
    if (!name) continue
    // 去掉与当前目录自身相等的条目
    const selfHref = new global.URL(full).pathname.replace(/\/+$/, '')
    if (clean === selfHref) continue
    entries.push({ href, name: isDir ? name + '/' : name, isDir, size })
  }
  entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, 'zh-Hans-CN') : a.isDir ? -1 : 1))
  return { ok: true, entries }
}

/** 下载网盘文件到 userData/webdav-cache/ */
export async function davDownload(
  baseUrl: string,
  filePath: string,
  username: string,
  password: string
): Promise<DavDownloadResult> {
  const base = normalizeBase(baseUrl)
  const full = joinUrl(base, filePath)
  let u: URL
  try {
    u = new global.URL(full)
  } catch {
    return { ok: false, error: '无效的文件路径' }
  }
  const mod = u.protocol === 'http:' ? http : https
  const name = path.basename(u.pathname) || 'download.bin'
  const cacheDir = path.join(app.getPath('userData'), 'webdav-cache')
  try {
    fs.mkdirSync(cacheDir, { recursive: true })
  } catch {
    /* ignore */
  }
  const dest = path.join(cacheDir, `${Date.now().toString(36)}-${name}`)

  return new Promise<DavDownloadResult>((resolve) => {
    const req = mod.get(
      u,
      {
        headers: { Authorization: basicAuth(username, password) },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        if (res.statusCode === 401 || res.statusCode === 403) {
          res.resume()
          resolve({ ok: false, error: '认证失败：请检查用户名与密码/授权码' })
          return
        }
        if ((res.statusCode ?? 0) >= 400) {
          res.resume()
          resolve({ ok: false, error: `下载失败：服务器返回 ${res.statusCode}` })
          return
        }
        const out = fs.createWriteStream(dest)
        res.pipe(out)
        out.on('finish', () => {
          out.close(() => {
            let size = 0
            try {
              size = fs.statSync(dest).size
            } catch {
              /* ignore */
            }
            resolve({ ok: true, path: dest, name, size })
          })
        })
        out.on('error', (e) => {
          try {
            fs.unlinkSync(dest)
          } catch {
            /* ignore */
          }
          resolve({ ok: false, error: `写入失败：${String(e).slice(0, 160)}` })
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error('下载超时（20s）')))
    req.on('error', (e) => {
      try {
        fs.unlinkSync(dest)
      } catch {
        /* ignore */
      }
      resolve({ ok: false, error: `下载失败：${String(e).slice(0, 160)}` })
    })
  })
}
