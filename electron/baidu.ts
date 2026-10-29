import http from 'node:http'
import https from 'node:https'
import fs from 'node:fs'
import path from 'node:path'
import { shell, app } from 'electron'

/**
 * 百度网盘 OpenAPI provider（个人开发者可申请：基础网盘能力，scope=basic,netdisk）。
 * 流程：设备码 OAuth → token 持久化（userData/baidu-token.json）→ 列目录 → filemetas 取 dlink → 下载。
 * dlink 规则（官方）：拼接 &access_token=xxx；请求头 User-Agent: pan.baidu.com；有效期 8h；存在 302 跳转。
 */

export interface BaiduEntry {
  fsid: number
  path: string
  name: string
  isDir: boolean
  size: number
}

export interface BaiduAuthInfo {
  userCode: string
  verificationUrl: string
  interval: number
  expiresIn: number
}

interface BaiduToken {
  access_token: string
  refresh_token: string
  expiresAt: number
  uid: string
  account: string
}

let pendingDevice: { deviceCode: string; interval: number; expiresAt: number } | null = null

function tokenFile(): string {
  return path.join(app.getPath('userData'), 'baidu-token.json')
}

function readToken(): BaiduToken | null {
  try {
    return JSON.parse(fs.readFileSync(tokenFile(), 'utf-8')) as BaiduToken
  } catch {
    return null
  }
}

function writeToken(t: BaiduToken): void {
  try {
    fs.writeFileSync(tokenFile(), JSON.stringify(t))
  } catch {
    /* ignore */
  }
}

function clearToken(): void {
  try {
    fs.unlinkSync(tokenFile())
  } catch {
    /* ignore */
  }
}

function apiGetJson(url: string, timeoutMs = 20000): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: timeoutMs }, (res) => {
      const chunks: Buffer[] = []
      res.on('data', (c: Buffer) => chunks.push(c))
      res.on('end', () => {
        let json: any = null
        try {
          json = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
        } catch {
          /* ignore */
        }
        resolve({ status: res.statusCode ?? 0, json })
      })
    })
    req.on('timeout', () => req.destroy(new Error('请求超时（20s）')))
    req.on('error', reject)
  })
}

function apiPostForm(url: string, params: Record<string, string>): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams(params).toString()
    const u = new URL(url)
    const req = https.request(
      u,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) },
        timeout: 20000,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          let json: any = null
          try {
            json = JSON.parse(Buffer.concat(chunks).toString('utf-8'))
          } catch {
            /* ignore */
          }
          resolve({ status: res.statusCode ?? 0, json })
        })
      }
    )
    req.on('timeout', () => req.destroy(new Error('请求超时（20s）')))
    req.on('error', reject)
    req.write(body)
    req.end()
  })
}

/** 错误码 → 可读信息（百度 errno） */
function baiduErr(errno: number, fallback: string): string {
  const map: Record<number, string> = {
    [-6]: '认证失败：请重新授权登录',
    [-1]: '参数错误，请检查输入',
    [111]: 'access_token 已过期，请重新授权',
    [31066]: '目录不存在或无权访问（第三方应用默认只能访问 /apps/<应用名> 目录）',
    [31034]: '文件大小超过单次下载限制（>50MB 需原生客户端下载）',
    [2]: '参数错误：请检查 AppKey/AppSecret 与应用状态',
    [213019]: '授权已取消或失败，请重试',
  }
  return map[errno] ?? `${fallback}（errno=${errno}）`
}

/** 打开系统浏览器让用户输入 user_code */
export async function baiduStartAuth(appKey: string, appSecret: string): Promise<{ ok: boolean; info?: BaiduAuthInfo; error?: string }> {
  if (!appKey.trim() || !appSecret.trim()) return { ok: false, error: '请先填写 AppKey 与 AppSecret' }
  const url = `https://openapi.baidu.com/oauth/2.0/device/code?response_type=device_code&client_id=${encodeURIComponent(appKey.trim())}&scope=basic,netdisk`
  try {
    const { json } = await apiGetJson(url)
    if (!json?.device_code) {
      return { ok: false, error: `获取设备码失败：${json?.error_description ?? json?.error ?? '未知错误'}` }
    }
    pendingDevice = {
      deviceCode: json.device_code,
      interval: Math.max(1, Number(json.interval) || 5),
      expiresAt: Date.now() + (Number(json.expires_in) || 300) * 1000,
    }
    await shell.openExternal(json.verification_url ?? `https://pan.baidu.com/oauth?device_code=${json.device_code}`)
    return {
      ok: true,
      info: {
        userCode: json.user_code,
        verificationUrl: json.verification_url ?? '',
        interval: pendingDevice.interval,
        expiresIn: Number(json.expires_in) || 300,
      },
    }
  } catch (e) {
    return { ok: false, error: `连接授权服务器失败：${String(e).slice(0, 160)}` }
  }
}

/** 轮询授权结果（渲染层定时调用） */
export async function baiduPollAuth(): Promise<{ ok: boolean; pending?: boolean; account?: string; error?: string }> {
  if (!pendingDevice) return { ok: false, error: '没有进行中的授权，请重新开始' }
  if (Date.now() > pendingDevice.expiresAt) {
    pendingDevice = null
    return { ok: false, error: '授权已超时，请重新开始' }
  }
  const url = `https://openapi.baidu.com/oauth/2.0/token?grant_type=device_token&code=${encodeURIComponent(pendingDevice.deviceCode)}&client_id=${encodeURIComponent(currentAppKey())}&client_secret=${encodeURIComponent(currentAppSecret())}`
  try {
    const { json } = await apiGetJson(url)
    if (json?.error) {
      if (json.error === 'authorization_pending') return { ok: true, pending: true }
      if (json.error === 'slow_down') return { ok: true, pending: true }
      pendingDevice = null
      return { ok: false, error: `授权失败：${json.error_description ?? json.error}` }
    }
    if (json?.access_token) {
      const t: BaiduToken = {
        access_token: json.access_token,
        refresh_token: json.refresh_token,
        expiresAt: Date.now() + (Number(json.expires_in) || 2592000) * 1000,
        uid: String(json.uid ?? ''),
        account: '',
      }
      writeToken(t)
      pendingDevice = null
      await refreshAccount()
      return { ok: true, account: readToken()?.account ?? '' }
    }
    return { ok: false, error: '授权响应异常' }
  } catch (e) {
    return { ok: false, error: `轮询失败：${String(e).slice(0, 160)}` }
  }
}

// AppKey/Secret 由渲染层每次请求传入，主进程仅缓存最近一次用于轮询
let cachedAppKey = ''
let cachedAppSecret = ''
function currentAppKey(): string {
  return cachedAppKey
}
function currentAppSecret(): string {
  return cachedAppSecret
}
export function baiduSetCredentials(appKey: string, appSecret: string): void {
  cachedAppKey = appKey
  cachedAppSecret = appSecret
}

/** 拉取账号信息（uinfo） */
async function refreshAccount(): Promise<void> {
  const t = readToken()
  if (!t) return
  try {
    const { json } = await apiGetJson(
      `https://pan.baidu.com/rest/2.0/xpan/nas?method=uinfo&access_token=${encodeURIComponent(t.access_token)}`
    )
    if (json?.errno === 0 && json.baidu_name) {
      t.account = json.baidu_name
      writeToken(t)
    }
  } catch {
    /* ignore */
  }
}

export function baiduAuthStatus(): { authorized: boolean; account: string; expiresAt: number | null } {
  const t = readToken()
  if (!t?.access_token) return { authorized: false, account: '', expiresAt: null }
  return { authorized: true, account: t.account || t.uid, expiresAt: t.expiresAt }
}

export function baiduLogout(): void {
  clearToken()
  pendingDevice = null
}

/** 确保 token 有效，临期自动刷新 */
async function ensureToken(): Promise<BaiduToken | null> {
  const t = readToken()
  if (!t) return null
  if (t.expiresAt - Date.now() > 5 * 60 * 1000) return t
  try {
    const { json } = await apiGetJson(
      `https://openapi.baidu.com/oauth/2.0/token?grant_type=refresh_token&refresh_token=${encodeURIComponent(t.refresh_token)}&client_id=${encodeURIComponent(currentAppKey())}&client_secret=${encodeURIComponent(currentAppSecret())}`
    )
    if (json?.access_token) {
      t.access_token = json.access_token
      t.refresh_token = json.refresh_token ?? t.refresh_token
      t.expiresAt = Date.now() + (Number(json.expires_in) || 2592000) * 1000
      writeToken(t)
      return t
    }
  } catch {
    /* ignore */
  }
  return t.expiresAt > Date.now() ? t : null
}

/** 列目录（分页拉全，limit 上限 1000） */
export async function baiduList(appKey: string, appSecret: string, dir: string): Promise<{ ok: boolean; entries?: BaiduEntry[]; error?: string }> {
  baiduSetCredentials(appKey, appSecret)
  const token = await ensureToken()
  if (!token) return { ok: false, error: '未授权或登录已过期，请先授权登录' }
  const entries: BaiduEntry[] = []
  let start = 0
  const limit = 1000
  for (;;) {
    const url = `https://pan.baidu.com/rest/2.0/xpan/file?method=list&dir=${encodeURIComponent(dir || '/')}&start=${start}&limit=${limit}&access_token=${encodeURIComponent(token.access_token)}`
    let json: any
    try {
      ;({ json } = await apiGetJson(url))
    } catch (e) {
      return { ok: false, error: `连接失败：${String(e).slice(0, 160)}` }
    }
    if (!json || json.errno !== 0) {
      return { ok: false, error: baiduErr(json?.errno ?? -1, '获取文件列表失败') }
    }
    for (const f of json.list ?? []) {
      entries.push({
        fsid: Number(f.fs_id),
        path: f.path,
        name: f.server_filename,
        isDir: !!f.isdir,
        size: Number(f.size) || 0,
      })
    }
    if ((json.list ?? []).length < limit) break
    start += limit
    if (start > 20000) break // 安全上限，避免极端目录打爆内存
  }
  entries.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name, 'zh-Hans-CN') : a.isDir ? -1 : 1))
  return { ok: true, entries }
}

/** filemetas 取 dlink */
async function baiduDlink(token: BaiduToken, fsid: number): Promise<string | null> {
  const url = `https://pan.baidu.com/rest/2.0/xpan/multimedia?method=filemetas&fsids=${encodeURIComponent(`[${fsid}]`)}&dlink=1&access_token=${encodeURIComponent(token.access_token)}`
  try {
    const { json } = await apiGetJson(url)
    if (json?.errno === 0) {
      const first = json.list?.[0]
      if (first?.dlink) return first.dlink as string
    }
  } catch {
    /* ignore */
  }
  return null
}

/** 下载文件到 userData/webdav-cache/（处理 302 跳转） */
export async function baiduDownload(
  appKey: string,
  appSecret: string,
  fsid: number,
  name: string
): Promise<{ ok: boolean; path?: string; name?: string; size?: number; error?: string }> {
  baiduSetCredentials(appKey, appSecret)
  const token = await ensureToken()
  if (!token) return { ok: false, error: '未授权或登录已过期，请先授权登录' }
  const dlink = await baiduDlink(token, fsid)
  if (!dlink) return { ok: false, error: '获取下载地址失败（大文件或权限受限时百度会拒绝）' }

  const cacheDir = path.join(app.getPath('userData'), 'webdav-cache')
  try {
    fs.mkdirSync(cacheDir, { recursive: true })
  } catch {
    /* ignore */
  }
  const dest = path.join(cacheDir, `${Date.now().toString(36)}-${path.basename(name)}`)

  return new Promise((resolve) => {
    let redirects = 0
    const getOnce = (target: string) => {
      https
        .get(
          target,
          {
            headers: { 'User-Agent': 'pan.baidu.com' },
            timeout: 120000,
          },
          (res) => {
            if ([301, 302, 303, 307, 308].includes(res.statusCode ?? 0) && res.headers.location) {
              res.resume()
              redirects++
              if (redirects > 5) {
                resolve({ ok: false, error: '下载重定向次数过多' })
                return
              }
              getOnce(new URL(res.headers.location, target).toString())
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
        .on('timeout', function (this: http.ClientRequest) {
          this.destroy(new Error('下载超时（120s）'))
        })
        .on('error', (e) => {
          try {
            fs.unlinkSync(dest)
          } catch {
            /* ignore */
          }
          resolve({ ok: false, error: `下载失败：${String(e).slice(0, 160)}` })
        })
    }
    // dlink 必须拼接 access_token
    const sep = dlink.includes('?') ? '&' : '?'
    getOnce(`${dlink}${sep}access_token=${encodeURIComponent(token.access_token)}`)
  })
}
