/**
 * 轻量更新检查（v41）。
 *
 * 设计取舍：
 * - **仅手动触发**：关于页点「检查更新」才发一次请求，不做启动静默检查，
 *   以守住关于页「无后台请求」的隐私承诺（本地优先、无遥测）。
 * - **不自动下载/安装**：只比较版本号 + 给出下载链接，由浏览器接管下载。
 *   不做增量更新、不静默替换 exe（便携版被运行中实例锁定会失败，且用户应掌控更新时机）。
 * - **主进程发请求**：用 node https（与 netpan.ts 一致），不受渲染层 CSP 限制，
 *   也不需要往 index.html 的 connect-src 放开 https:。
 * - **国内网络兜底**：GitHub 接口/下载常受限，任何失败都返回 ok:false + 发布页 URL，
 *   界面据此给「手动前往发布页」按钮，绝不把检查失败变成阻塞或报错弹窗。
 *
 * 接口结构已对真实 API 核验（releases/latest）：tag_name / name / html_url /
 * published_at / body / assets[{name,size,browser_download_url}]。
 * 未认证限额 60 次/小时/IP，手动检查远低于此，无需 token、不存任何凭据。
 */
import https from 'node:https'
import { app } from 'electron'
import { compareVersions } from './version'

export interface UpdateAsset {
  name: string
  size: number
  downloadUrl: string
}

export interface UpdateInfo {
  ok: boolean
  /** 当前运行版本（app.getVersion，来自 package.json） */
  current: string
  /** 最新正式版本号（已去掉 v 前缀），仅 ok:true 时有意义 */
  latest?: string
  hasUpdate?: boolean
  /** 发布页地址：成功时为本 release 的 html_url，失败时为 releases/latest 兜底页 */
  url: string
  /** release 标题 */
  name?: string
  /** 更新说明（markdown，截断防止超长） */
  body?: string
  publishedAt?: string
  /** 推荐下载资产（win.zip 优先，其次 portable.exe），无资产时为空 */
  assets?: UpdateAsset[]
  /** 失败原因（已转成对用户友好的中文） */
  error?: string
}

const REPO = 'saibei404/ebook-reader'
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`
const FALLBACK_PAGE = `https://github.com/${REPO}/releases/latest`
const TIMEOUT_MS = 12000
const MAX_BYTES = 2_000_000

/** 把底层网络/HTTP 错误转成对用户友好、且都指向手动兜底的中文提示 */
function friendlyError(err: unknown): string {
  const msg = String((err as Error)?.message ?? err ?? '')
  if (/timeout|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(msg))
    return '连接 GitHub 超时（网络可能受限），可稍后重试或手动前往发布页'
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|socket hang up/i.test(msg))
    return '无法连接 GitHub（网络可能受限），可稍后重试或手动前往发布页'
  if (/HTTP 403|rate limit/i.test(msg))
    return 'GitHub 接口限流（未认证每小时 60 次），请稍后重试或手动前往发布页'
  if (/HTTP 404/i.test(msg)) return '尚未发布正式 Release，可前往发布页查看'
  if (/HTTP 4\d\d|HTTP 5\d\d/i.test(msg)) return `GitHub 返回 ${msg}，可手动前往发布页`
  return `检查失败（${msg.slice(0, 80) || '未知错误'}），可手动前往发布页`
}

interface GhAsset {
  name?: string
  size?: number
  browser_download_url?: string
}
interface GhRelease {
  tag_name?: string
  name?: string
  html_url?: string
  body?: string
  published_at?: string
  draft?: boolean
  prerelease?: boolean
  assets?: GhAsset[]
}

/** 拉取 latest release JSON；非 200 / 超时 / 超大响应一律 reject。url 仅供自检注入失败场景 */
function fetchLatest(url: string = API_URL): Promise<GhRelease> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      url,
      {
        headers: {
          // GitHub 强制要求 User-Agent，缺失会 403
          'User-Agent': 'moyu-reader-update-check',
          Accept: 'application/vnd.github+json',
        },
        timeout: TIMEOUT_MS,
      },
      (res) => {
        const status = res.statusCode ?? 0
        if (status !== 200) {
          res.resume() // 释放 socket
          reject(new Error(`HTTP ${status}`))
          return
        }
        const chunks: Buffer[] = []
        let total = 0
        res.on('data', (c: Buffer) => {
          total += c.length
          if (total > MAX_BYTES) {
            req.destroy(new Error('响应过大'))
            return
          }
          chunks.push(c)
        })
        res.on('end', () => {
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')) as GhRelease)
          } catch (e) {
            reject(e instanceof Error ? e : new Error(String(e)))
          }
        })
        res.on('error', reject)
      }
    )
    req.on('timeout', () => req.destroy(new Error('timeout')))
    req.on('error', reject)
  })
}

/**
 * 资产排序：README 推荐 win.zip（解压即用、启动最快），其次 portable.exe。
 * 只保留 Windows 可执行资产，过滤 sha256/blockmap 等校验文件。
 */
function pickAssets(raw: GhAsset[] | undefined): UpdateAsset[] {
  const list = (raw ?? [])
    .map((a) => ({
      name: String(a.name ?? ''),
      size: Number(a.size ?? 0),
      downloadUrl: String(a.browser_download_url ?? ''),
    }))
    .filter((a) => a.downloadUrl && /\.(zip|exe)$/i.test(a.name))
  const rank = (n: string): number => (/win\.zip$/i.test(n) ? 0 : /portable\.exe$/i.test(n) ? 1 : 2)
  return list.sort((a, b) => rank(a.name) - rank(b.name))
}

export async function checkUpdate(apiUrl: string = API_URL): Promise<UpdateInfo> {
  const current = app.getVersion()
  try {
    const rel = await fetchLatest(apiUrl)
    const tag = String(rel.tag_name ?? rel.name ?? '').trim()
    const latest = tag.replace(/^v/i, '')
    if (!/^\d+\.\d+\.\d+/.test(latest)) {
      return { ok: false, current, url: String(rel.html_url ?? FALLBACK_PAGE), error: '无法识别最新版本号，可手动前往发布页' }
    }
    return {
      ok: true,
      current,
      latest,
      hasUpdate: compareVersions(latest, current) > 0,
      url: String(rel.html_url ?? FALLBACK_PAGE),
      name: String(rel.name ?? tag),
      body: String(rel.body ?? '').slice(0, 4000),
      publishedAt: String(rel.published_at ?? ''),
      assets: pickAssets(rel.assets),
    }
  } catch (err) {
    return { ok: false, current, url: FALLBACK_PAGE, error: friendlyError(err) }
  }
}