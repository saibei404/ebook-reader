import { contextBridge, ipcRenderer } from 'electron'

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

const api: MoyuAPI = {
  platform: 'electron',
  getSettings: () => ipcRenderer.invoke('moyu:get-settings'),
  saveSettings: (s) => ipcRenderer.invoke('moyu:save-settings', s),
  pickWallpaper: () => ipcRenderer.invoke('moyu:pick-wallpaper'),
  pickBooks: () => ipcRenderer.invoke('moyu:pick-books'),
  readFileDataUrl: (p) => ipcRenderer.invoke('moyu:read-dataurl', p),
  windowControl: (a) => ipcRenderer.send('moyu:window', a),
  openReader: (id, jump) => ipcRenderer.send('moyu:open-reader', id, jump),
  closeReader: () => ipcRenderer.send('moyu:close-reader'),
  readBook: (p) => ipcRenderer.invoke('moyu:read-book', p),
  saveTextFile: (name, content) => ipcRenderer.invoke('moyu:save-text', { name, content }),
  onReaderCrashed: (cb) => {
    const h = () => cb()
    ipcRenderer.on('moyu:reader-crashed', h)
    return () => ipcRenderer.removeListener('moyu:reader-crashed', h)
  },
  recreateWindow: () => ipcRenderer.send('moyu:recreate'),
  openExternal: (u) => ipcRenderer.invoke('moyu:open-external', u),
  setBossKey: (a) => ipcRenderer.invoke('moyu:set-boss-key', a),
  webdavList: (p) => ipcRenderer.invoke('moyu:webdav-list', p),
  webdavDownload: (p) => ipcRenderer.invoke('moyu:webdav-download', p),
  baiduAuthStart: (p) => ipcRenderer.invoke('moyu:baidu-auth-start', p),
  baiduAuthPoll: () => ipcRenderer.invoke('moyu:baidu-auth-poll'),
  baiduAuthStatus: () => ipcRenderer.invoke('moyu:baidu-auth-status'),
  baiduLogout: () => ipcRenderer.invoke('moyu:baidu-logout'),
  baiduList: (p) => ipcRenderer.invoke('moyu:baidu-list', p),
  baiduDownload: (p) => ipcRenderer.invoke('moyu:baidu-download', p),
}

contextBridge.exposeInMainWorld('moyu', api)
