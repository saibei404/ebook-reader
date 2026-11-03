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
    mode?: 'url' | 'buffer'
    url?: string
    data?: ArrayBuffer
    size?: number
    name?: string
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
}

declare global {
  interface Window {
    moyu?: MoyuAPI
  }
}

export const nativeApi: MoyuAPI | null =
  typeof window !== 'undefined' && window.moyu ? window.moyu : null

export const isElectron = !!nativeApi
