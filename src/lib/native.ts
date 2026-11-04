export interface PickedFile {
  path: string
  name: string
  size: number
}

export interface MoyuAPI {
  platform: 'electron'
  getSettings(): Promise<Record<string, unknown>>
  saveSettings(s: Record<string, unknown>): Promise<void>
  pickWallpaper(): Promise<PickedFile | null>
  pickBooks(): Promise<PickedFile[] | null>
  readFileDataUrl(p: string): Promise<string>
  windowControl(action: 'minimize' | 'maximize' | 'close' | 'quit'): void
  openReader(bookId: string, jump?: string): void
  closeReader(): void
  saveTextFile(
    name: string,
    content: string
  ): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>
  /** 打开文件对话框并读取文本（备份导入） */
  openTextFile(): Promise<{
    ok: boolean
    path?: string
    content?: string
    canceled?: boolean
    error?: string
  }>
  readBook(
    p: string
  ): Promise<{
    ok: boolean
    mode?: 'url' | 'buffer' | 'chapters' | 'images' | 'text'
    url?: string
    data?: ArrayBuffer
    size?: number
    name?: string
    /** mode:'chapters' —— AZW3/AZW/MOBI 解析出的章节 HTML */
    chapters?: { title: string; html: string }[]
    /** mode:'chapters' 附带的元信息（书名/作者） */
    meta?: { title?: string; author?: string }
    /** mode:'images' —— CBR 解出的图片（已按文件名自然排序） */
    images?: { name: string; url: string }[]
    /** mode:'text' —— DOC 提取出的纯文本 */
    text?: string
    error?: string
  }>
  onReaderCrashed(cb: () => void): () => void
  recreateWindow(): void
  openExternal(url: string): Promise<void>
  setBossKey(accel: string): Promise<boolean>
  webdavList(p: { url: string; path: string; username: string; password: string }): Promise<{
    ok: boolean
    entries?: { href: string; name: string; isDir: boolean; size: number }[]
    error?: string
  }>
  webdavDownload(p: { url: string; path: string; username: string; password: string }): Promise<{
    ok: boolean
    path?: string
    name?: string
    size?: number
    error?: string
  }>
  baiduAuthStart(p: { appKey: string; appSecret: string }): Promise<{
    ok: boolean
    info?: { userCode: string; verificationUrl: string; interval: number; expiresIn: number }
    error?: string
  }>
  baiduAuthPoll(): Promise<{ ok: boolean; pending?: boolean; account?: string; error?: string }>
  baiduAuthStatus(): Promise<{ authorized: boolean; account: string; expiresAt: number | null }>
  baiduLogout(): Promise<void>
  baiduList(p: { appKey: string; appSecret: string; path: string }): Promise<{
    ok: boolean
    entries?: { fsid: number; path: string; name: string; isDir: boolean; size: number }[]
    error?: string
  }>
  baiduDownload(p: { appKey: string; appSecret: string; fsid: number; name: string }): Promise<{
    ok: boolean
    path?: string
    name?: string
    size?: number
    error?: string
  }>
  /** 上报渲染进程异常（写进主进程日志文件） */
  reportLog(payload: {
    scope: string
    level?: 'error' | 'warn' | 'info'
    message: string
    stack?: string
    extra?: unknown
  }): void
  /** 阅读窗口把当前书的元信息报给主进程：崩溃弹窗/日志要能说出是哪本书 */
  reportReaderMeta(meta: { id: string; title: string; format: string; size: number }): void
  /** 导出诊断报告（环境信息 + 最近日志），弹系统保存框 */
  exportDiagnostics(): Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>
  /** 兜底页用：关闭发起请求的窗口 */
  selfClose(): void
  /**
   * 拖入文件的真实路径。
   *
   * Electron 32 起移除了 `File.path`，必须用 `webUtils.getPathForFile`；
   * 该 API 只在 preload 可用，所以桥一层。拿不到路径（非真实文件）返回 null。
   */
  resolveDroppedFile(
    file: File
  ): { name: string; size: number; path: string } | null
}

declare global {
  interface Window {
    moyu?: MoyuAPI
  }
}

export const nativeApi: MoyuAPI | null =
  typeof window !== 'undefined' && window.moyu ? window.moyu : null

export const isElectron = !!nativeApi
