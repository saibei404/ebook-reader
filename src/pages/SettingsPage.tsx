import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { useStore } from '@/store/useStore'
import { ANIM_MODES, MATERIALS, WALLPAPER_FITS } from '@/types/book'
import { nativeApi } from '@/lib/native'
import { formatSize } from '@/lib/format'
import { getDB, setKV } from '@/lib/db'
import {
  IconSun,
  IconImage,
  IconKeyboard,
  IconDatabase,
  IconInfo,
  IconCheck,
  IconPlus,
  IconTrash,
  IconCloud,
} from '@/components/Icons'

const SECTIONS = [
  { id: 'appearance', label: '外观', Icon: IconSun },
  { id: 'wallpaper', label: '壁纸', Icon: IconImage },
  { id: 'webdav', label: '网盘导入', Icon: IconCloud },
  { id: 'shortcut', label: '快捷键', Icon: IconKeyboard },
  { id: 'data', label: '数据', Icon: IconDatabase },
  { id: 'about', label: '关于', Icon: IconInfo },
]

function AppearanceSection() {
  const { settings, setSettings } = useStore()
  return (
    <>
      <section className="set-block">
        <h3>主题</h3>
        <div className="seg">
          <button className={settings.theme === 'dark' ? 'active' : ''} onClick={() => void setSettings({ theme: 'dark' })}>
            深色
          </button>
          <button className={settings.theme === 'light' ? 'active' : ''} onClick={() => void setSettings({ theme: 'light' })}>
            浅色
          </button>
        </div>
      </section>

      <section className="set-block">
        <h3>标签栏材质</h3>
        <p className="set-desc">作用于左侧标签栏、顶栏与弹层。点击即可实时切换。</p>
        <div className="material-grid">
          {MATERIALS.map((m) => (
            <button
              key={m.id}
              className={`material-card${settings.material === m.id ? ' active' : ''}`}
              onClick={() => void setSettings({ material: m.id })}
            >
              <div className={`material-preview mat-${m.id}`}>
                <span className="mp-dot" />
                <span className="mp-bar" />
                <span className="mp-bar short" />
              </div>
              <div className="material-name">{m.label}</div>
              <div className="material-hint">{m.hint}</div>
            </button>
          ))}
        </div>
        <label className="switch-row">
          <input
            type="checkbox"
            checked={settings.nativeAcrylic}
            onChange={(e) => void setSettings({ nativeAcrylic: e.target.checked })}
            disabled={!nativeApi}
          />
          <span>
            窗口级原生亚克力（Windows 11）
            {!nativeApi && <em> · 仅客户端可用</em>}
            {nativeApi && <em> · 切换后窗口将重载以应用原生材质</em>}
          </span>
        </label>
      </section>

      <section className="set-block">
        <h3>首页展示动效</h3>
        <p className="set-desc">书籍卡片的入场动画，切换后立即重播一遍。</p>
        <div className="anim-grid">
          {ANIM_MODES.map((m) => (
            <button
              key={m.id}
              className={`anim-card${settings.animMode === m.id ? ' active' : ''}`}
              onClick={() => void setSettings({ animMode: m.id })}
            >
              <span className="anim-name">{m.label}</span>
              <span className="anim-hint">{m.hint}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="set-block">
        <p className="set-desc">封面尺寸调节已迁移至书架页统计栏右侧（小 / 中 / 大）。</p>
      </section>
    </>
  )
}

function WallpaperSection() {
  const { settings, wallpapers, setSettings, importWallpaperFile, importWallpaperPicked, removeWallpaper, setWallpaperFit, setWallpaperZoom, setWallpaperPreviewFit } =
    useStore()

  return (
    <>
      <section className="set-block">
        <h3>壁纸</h3>
        <p className="set-desc">
          系统预设壁纸已移除，仅保留深色 / 浅色底层模式（右上角主题按钮或「外观」分区切换）。
          导入本地壁纸后，壁纸作为底纹层叠加显示，并自动适配当前模式的亮度。
        </p>
        <ul className="kv-list">
          <li>
            <span>叠加层级</span>
            <span>壁纸媒体（最底层）→ 主题适配罩（第二层）→ 界面 Shell（最上层），UI 始终清晰可读</span>
          </li>
          <li>
            <span>亮度适配</span>
            <span>浅色模式叠加白色提亮罩，底纹呈现较高亮度；深色模式叠加黑色压暗罩，底纹呈现较低亮度</span>
          </li>
          <li>
            <span>模式切换</span>
            <span>壁纸图不变，仅适配罩颜色在黑白之间即时过渡（0.25s），无闪烁、无重新加载</span>
          </li>
        </ul>
        <div className="slider-row">
          <span className="detail-key">底纹适配强度</span>
          <input
            type="range"
            min={0}
            max={80}
            value={Math.round(settings.wallpaperDim * 100)}
            onChange={(e) => setWallpaperDimValue(Number(e.target.value) / 100)}
          />
          <span className="slider-val">{Math.round(settings.wallpaperDim * 100)}%</span>
        </div>
        <div className="slider-row">
          <span className="detail-key">背景透明度</span>
          <input
            type="range"
            min={20}
            max={100}
            value={Math.round(settings.contentOpacity * 100)}
            onChange={(e) => void setSettings({ contentOpacity: Number(e.target.value) / 100 })}
          />
          <span className="slider-val">{Math.round(settings.contentOpacity * 100)}%</span>
        </div>
        <p className="set-desc">背景透明度控制书架区域衬底的不透明度：数值越低壁纸越清晰，越高文字对比越强（浅色模式默认已调低）。</p>
        <div className="slider-row">
          <span className="detail-key">Dock 栏透明度</span>
          <input
            type="range"
            min={20}
            max={90}
            value={Math.round(settings.dockOpacity * 100)}
            onChange={(e) => void setSettings({ dockOpacity: Number(e.target.value) / 100 })}
          />
          <span className="slider-val">{Math.round(settings.dockOpacity * 100)}%</span>
        </div>
        <p className="set-desc">
          Dock 栏（侧栏 + 顶栏）为半透明毛玻璃底纹，透明度默认显著低于书架栏，壁纸在所有界面层级均可见；该滑块也可在顶栏「壁纸」弹层中调节。
        </p>
      </section>

      <section className="set-block">
        <h3>我的壁纸</h3>
        {wallpapers.length === 0 && <p className="set-desc">还没有导入壁纸，支持下方格式的图片与视频。</p>}
        {wallpapers.map((w) => (
          <div key={w.id} className={`wp-item${settings.wallpaperId === w.id ? ' active' : ''}`}>
            <button className="wp-item-main" onClick={() => void setSettings({ wallpaperId: w.id })}>
              <span className="wp-item-name">{w.name}</span>
              {settings.wallpaperId === w.id && <IconCheck size={13} />}
            </button>
            <button className="wp-item-del" onClick={() => void removeWallpaper(w.id)} title="删除">
              <IconTrash size={13} />
            </button>
          </div>
        ))}
        <div className="wp-actions">
          <button
            className="tbtn primary"
            onClick={async () => {
              if (nativeApi) {
                const picked = await nativeApi.pickWallpaper()
                if (picked) await importWallpaperPicked(picked)
              } else {
                const input = document.createElement('input')
                input.type = 'file'
                input.accept = 'image/png,image/jpeg,image/webp,image/gif,image/bmp,image/avif,image/heic,image/heif,image/tiff,video/mp4,video/webm'
                input.onchange = () => {
                  const f = input.files?.[0]
                  if (f) void importWallpaperFile(f)
                }
                input.click()
              }
            }}
          >
            <IconPlus size={14} />
            <span>导入本地壁纸</span>
          </button>
        </div>
      </section>

      <section className="set-block">
        <h3>显示模式与对齐</h3>
        <p className="set-desc">实时预览当前壁纸；设置自动保存。</p>
        <div className="fit-grid">
          {WALLPAPER_FITS.map((f) => (
            <button
              key={f.id}
              className={`fit-card${settings.wallpaperFit === f.id ? ' active' : ''}`}
              onClick={() => void setWallpaperFit(f.id)}
              onMouseEnter={() => setWallpaperPreviewFit(f.id)}
              onMouseLeave={() => setWallpaperPreviewFit(null)}
            >
              <span className="fit-name">{f.label}</span>
              <span className="fit-hint">{f.hint}</span>
            </button>
          ))}
        </div>
        <div className="slider-row">
          <span className="detail-key">缩放</span>
          <input
            type="range"
            min={25}
            max={300}
            value={Math.round(settings.wallpaperZoom * 100)}
            onChange={(e) => setWallpaperZoom(Number(e.target.value) / 100)}
          />
          <span className="slider-val">{Math.round(settings.wallpaperZoom * 100)}%</span>
        </div>
      </section>

      <section className="set-block">
        <h3>格式兼容性</h3>
        <ul className="kv-list">
          <li>
            <span>JPEG / PNG / BMP</span>
            <span>静态图片，全平台支持</span>
          </li>
          <li>
            <span>WebP / AVIF</span>
            <span>静态图片；动图能力格式，是否播放动画取决于文件本身是否含多帧</span>
          </li>
          <li>
            <span>GIF</span>
            <span>动图能力格式，是否播放动画取决于文件本身是否含多帧</span>
          </li>
          <li>
            <span>HEIC / HEIF / TIFF</span>
            <span>取决于本机解码能力，导入时自动探测，不支持将明确提示并取消导入</span>
          </li>
          <li>
            <span>MP4 / WebM / MOV</span>
            <span>视频壁纸，自动静音循环播放</span>
          </li>
        </ul>
        <p className="set-desc">
          限制：单个文件不超过 100MB；极端长宽比图片在「覆盖/填充」下按容器裁切，「适应」下留白，「拉伸」允许形变，可在上方实时预览后选择。
        </p>
      </section>
    </>
  )
}

function setWallpaperDimValue(n: number) {
  useStore.getState().setWallpaperDim(n)
}

const BOOK_EXTS = ['epub', 'pdf', 'mobi', 'azw3', 'fb2', 'txt', 'md', 'cbz', 'cbr']

function NetpanSection() {
  const {
    webdav,
    setNetpanProvider,
    setWebdavConfig,
    setBaiduConfig,
    baiduAuthorize,
    baiduPollOnce,
    baiduLogout,
    netpanConnect,
    netpanToggleSelect,
    netpanImportSelected,
    setUI,
  } = useStore()
  const [urlDraft, setUrlDraft] = useState(webdav.config?.url ?? '')
  const [userDraft, setUserDraft] = useState(webdav.config?.username ?? '')
  const [passDraft, setPassDraft] = useState(webdav.config?.password ?? '')
  const [keyDraft, setKeyDraft] = useState(webdav.baiduConfig?.appKey ?? '')
  const [secretDraft, setSecretDraft] = useState(webdav.baiduConfig?.appSecret ?? '')

  const isBaidu = webdav.provider === 'baidu'
  const authPending = webdav.currentPath.startsWith('__auth__')
  const authCode = authPending ? webdav.currentPath.slice('__auth__:'.length) : ''

  // 授权中：定时轮询授权结果
  useEffect(() => {
    if (!isBaidu || !authPending) return
    const t = setInterval(() => {
      void baiduPollOnce()
    }, 4000)
    return () => clearInterval(t)
  }, [isBaidu, authPending, baiduPollOnce])

  const bookFiles = webdav.entries.filter((e) => !e.isDir && BOOK_EXTS.includes(e.name.split('.').pop()?.toLowerCase() ?? ''))
  const dirs = webdav.entries.filter((e) => e.isDir)

  const onWebdavConnect = async () => {
    if (!urlDraft.trim() || !userDraft.trim()) {
      useStore.setState((s) => ({ webdav: { ...s.webdav, status: 'error', error: '请填写服务器地址与用户名' } }))
      return
    }
    await setWebdavConfig({ url: urlDraft.trim(), username: userDraft.trim(), password: passDraft })
    await netpanConnect('')
  }

  const onBaiduSave = async () => {
    if (!keyDraft.trim() || !secretDraft.trim()) {
      useStore.setState((s) => ({ webdav: { ...s.webdav, status: 'error', error: '请填写 AppKey 与 AppSecret' } }))
      return
    }
    await setBaiduConfig({ appKey: keyDraft.trim(), appSecret: secretDraft.trim() })
  }

  const ready = isBaidu ? webdav.baiduAuth.authorized : !!webdav.config

  return (
    <>
      <section className="set-block">
        <h3>网盘导入</h3>
        <p className="set-desc">
          从网盘导入书籍到书架：<strong>WebDAV</strong>（坚果云 / Nextcloud / 群晖 DSM / Alist 桥接的百度·夸克·阿里云盘）
          或 <strong>百度网盘</strong>（官方 OpenAPI，需自建应用）。凭据仅保存在本机。
        </p>

        <div className="seg">
          <button className={!isBaidu ? 'active' : ''} onClick={() => setNetpanProvider('webdav')}>
            WebDAV
          </button>
          <button className={isBaidu ? 'active' : ''} onClick={() => setNetpanProvider('baidu')}>
            百度网盘
          </button>
        </div>

        {!isBaidu ? (
          !ready ? (
            <div className="webdav-form">
              <input
                value={urlDraft}
                placeholder="服务器地址，如 https://dav.jianguoyun.com/dav/"
                onChange={(e) => setUrlDraft(e.target.value)}
              />
              <div className="webdav-form-row">
                <input value={userDraft} placeholder="用户名 / 邮箱" onChange={(e) => setUserDraft(e.target.value)} />
                <input
                  value={passDraft}
                  type="password"
                  placeholder="密码 / 应用授权码"
                  onChange={(e) => setPassDraft(e.target.value)}
                />
              </div>
              <div className="wp-actions">
                <button className="tbtn primary" onClick={onWebdavConnect} disabled={webdav.status === 'connecting'}>
                  <IconCloud size={14} />
                  <span>{webdav.status === 'connecting' ? '连接中…' : '连接并浏览'}</span>
                </button>
              </div>
            </div>
          ) : (
            <BreadcrumbBar webdav={webdav} netpanConnect={netpanConnect} />
          )
        ) : !webdav.baiduConfig?.appKey ? (
          <div className="webdav-form">
            <p className="set-desc">
              在{' '}
              <button className="link-btn" onClick={() => void nativeApi?.openExternal('https://pan.baidu.com/union/doc/')}>
                百度网盘开放平台
              </button>{' '}
              创建应用（选择「基础网盘」能力），拿到 AppKey / AppSecret 后填写下方。授权走官方设备码流程，密码不经过本软件服务器。
            </p>
            <input value={keyDraft} placeholder="AppKey（API Key）" onChange={(e) => setKeyDraft(e.target.value)} />
            <div className="webdav-form-row">
              <input value={secretDraft} placeholder="AppSecret（Secret Key）" onChange={(e) => setSecretDraft(e.target.value)} />
              <button className="tbtn" onClick={onBaiduSave}>
                保存
              </button>
            </div>
          </div>
        ) : !webdav.baiduAuth.authorized ? (
          <div className="webdav-form">
            {authPending ? (
              <div className="webdav-status">
                等待授权：请在浏览器中输入验证码 <strong style={{ userSelect: 'all', letterSpacing: '0.2em' }}>{authCode}</strong>
                ，完成百度账号授权（本页面自动检测，约每 4 秒）
              </div>
            ) : (
              <>
                <p className="set-desc">点击下方按钮，将在系统浏览器中打开百度授权页，登录并确认后自动回到导入界面。</p>
                <div className="wp-actions">
                  <button className="tbtn primary" onClick={() => void baiduAuthorize()} disabled={webdav.status === 'connecting'}>
                    <IconCloud size={14} />
                    <span>授权登录百度网盘</span>
                  </button>
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="webdav-browser">
            <div className="webdav-crumb">
              <span className="webdav-path">
                百度网盘 · {webdav.baiduAuth.account || '已授权账号'}
              </span>
              <div className="wp-actions">
                <button className="tbtn sm" onClick={() => void baiduLogout()}>
                  退出账号
                </button>
              </div>
            </div>
            <BreadcrumbBar webdav={webdav} netpanConnect={netpanConnect} />
          </div>
        )}
      </section>

      {ready && (
        <section className="set-block">
          <h3>{isBaidu ? '百度网盘目录' : '目录浏览'}</h3>
          {webdav.status === 'connecting' && <div className="webdav-status">目录加载中…</div>}
          {webdav.status === 'importing' && (
            <div className="webdav-status">
              正在导入 {webdav.progress.done + 1}/{webdav.progress.total}：{webdav.progress.current}
            </div>
          )}
          {webdav.status === 'error' && webdav.error && <div className="webdav-error">{webdav.error}</div>}

          <div className="webdav-list">
            {dirs.map((d) => (
              <button key={d.key} className="webdav-row dir" onClick={() => void netpanConnect(d.path)}>
                <span className="webdav-name">📁 {d.name}</span>
                <span className="webdav-go">进入</span>
              </button>
            ))}
            {bookFiles.length === 0 && dirs.length === 0 && webdav.status !== 'connecting' && (
              <div className="webdav-empty">此目录下没有可导入的内容</div>
            )}
            {bookFiles.map((f) => {
              const checked = webdav.selected.includes(f.key)
              return (
                <label key={f.key} className={`webdav-row file${checked ? ' checked' : ''}`}>
                  <input type="checkbox" checked={checked} onChange={() => netpanToggleSelect(f.key)} />
                  <span className="webdav-name">{f.name}</span>
                  <span className="webdav-size">{formatSize(f.size)}</span>
                </label>
              )
            })}
          </div>

          <div className="wp-actions">
            <button
              className="tbtn primary"
              onClick={() => void netpanImportSelected()}
              disabled={webdav.status === 'importing' || webdav.selected.length === 0}
            >
              <IconPlus size={14} />
              <span>{webdav.status === 'importing' ? '导入中…' : `导入所选（${webdav.selected.length}）`}</span>
            </button>
          </div>

          {webdav.lastResult && (
            <div className={`webdav-result ${webdav.lastResult.fail === 0 ? 'ok' : 'warn'}`}>
              本次导入：成功 {webdav.lastResult.ok} 本，失败 {webdav.lastResult.fail} 本
              {webdav.lastResult.errors.length > 0 && (
                <ul>
                  {webdav.lastResult.errors.map((e) => (
                    <li key={e}>{e}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <p className="set-desc">百度网盘非会员下载可能限速；超过 50MB 的文件百度官方接口会拒绝，建议分批导入小体积书籍。</p>
        </section>
      )}

      <section className="set-block">
        <h3>导入后在哪里查看</h3>
        <p className="set-desc">
          导入完成的书籍会出现在「书架」首页（默认按加入时间排序），也可以在顶栏搜索框输入书名/作者查找。
          不支持的格式会在下载后由导入链路自动提示并跳过。
        </p>
        <button className="tbtn" onClick={() => setUI({ tab: 'library' })}>
          回到书架
        </button>
      </section>
    </>
  )
}

function BreadcrumbBar({
  webdav,
  netpanConnect,
}: {
  webdav: { currentPath: string }
  netpanConnect: (p?: string) => Promise<void>
}) {
  return (
    <div className="webdav-browser">
      <div className="webdav-crumb">
        <span className="webdav-path">{webdav.currentPath || '/'}</span>
        <div className="wp-actions">
          <button className="tbtn sm" onClick={() => void netpanConnect(parentPath(webdav.currentPath))} title="返回上级">
            上级目录
          </button>
          <button className="tbtn sm" onClick={() => void netpanConnect('')} title="回到根目录">
            根目录
          </button>
        </div>
      </div>
    </div>
  )
}

function parentPath(p: string): string {
  const parts = p.split('/').filter(Boolean)
  parts.pop()
  return parts.length ? '/' + parts.join('/') : ''
}

function ShortcutSection() {
  const { settings, setSettings, toast } = useStore()
  const [recording, setRecording] = useState(false)

  useEffect(() => {
    if (!recording) return
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault()
      e.stopPropagation()
      if (e.key === 'Escape') {
        setRecording(false)
        toast('已取消录制', 'info')
        return
      }
      // 单独按下修饰键时继续等待，避免录成 "Alt+Alt" 这类无效组合
      if (['Control', 'Alt', 'Shift', 'Meta'].includes(e.key)) return
      const mods: string[] = []
      if (e.ctrlKey) mods.push('Ctrl')
      if (e.altKey) mods.push('Alt')
      if (e.shiftKey) mods.push('Shift')
      if (e.metaKey) mods.push('Command')
      if (!mods.length) {
        toast('请使用组合键（至少含 Ctrl / Alt / Shift）', 'err')
        return
      }
      const key = e.key.length === 1 ? e.key.toUpperCase() : e.key
      const accel = [...mods, key].join('+')
      // 先验证注册再写入设置，保证显示与实际快捷键一致
      if (nativeApi) {
        void nativeApi.setBossKey(accel).then((ok) => {
          if (!ok) {
            toast('该快捷键被系统占用或无效，请更换组合', 'err')
            return
          }
          void setSettings({ bossKey: accel })
          setRecording(false)
          toast(`摸鱼键已更新为 ${accel}`, 'ok')
        })
      } else {
        void setSettings({ bossKey: accel })
        setRecording(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [recording, setSettings, toast])

  return (
    <section className="set-block">
      <h3>摸鱼键（老板键）</h3>
      <p className="set-desc">
        按下快捷键立即隐藏窗口（连任务栏都不显示），再按一次恢复。关闭窗口会隐藏到系统托盘，阅读位置自动保留。
      </p>
      <div className="shortcut-row">
        <kbd className="shortcut-key">{settings.bossKey}</kbd>
        <button className={`tbtn${recording ? ' active' : ''}`} onClick={() => setRecording(true)}>
          {recording ? '按下新的组合键…（Esc 取消）' : '重新录制'}
        </button>
      </div>
      <ul className="kv-list">
        <li>
          <span>托盘图标</span>
          <span>单击显示 / 隐藏，右键菜单可退出</span>
        </li>
        <li>
          <span>窗口按钮</span>
          <span>最小化 / 最大化 / 关闭（关闭即隐藏到托盘）</span>
        </li>
      </ul>
    </section>
  )
}

function DataSection() {
  const { books, wallpapers, covers, toast, addBooksFromFiles, addBooksFromPicked, hydrate } = useStore()

  const clearAll = async () => {
    if (!window.confirm('确定清空全部书籍、封面与壁纸？此操作不可恢复。')) return
    const db = await getDB()
    await db.clear('books')
    await db.clear('covers')
    await db.clear('wallpapers')
    toast('已清空，正在重新初始化…', 'info')
    setTimeout(() => {
      void hydrate()
    }, 400)
  }

  return (
    <>
      <section className="set-block">
        <h3>导入书籍</h3>
        <p className="set-desc">支持 EPUB / PDF / MOBI / AZW3 / FB2 / TXT / MD / CBZ / CBR（阅读内核分阶段接入）。</p>
        <button
          className="tbtn"
          onClick={async () => {
            if (nativeApi) {
              const picked = await nativeApi.pickBooks()
              if (picked?.length) await addBooksFromPicked(picked)
            } else {
              const input = document.createElement('input')
              input.type = 'file'
              input.multiple = true
              input.accept = '.epub,.pdf,.mobi,.azw3,.fb2,.txt,.md,.cbz,.cbr'
              input.onchange = () => {
                const files = Array.from(input.files ?? [])
                if (files.length) void addBooksFromFiles(files)
              }
              input.click()
            }
          }}
        >
          <IconPlus size={14} />
          <span>选择文件导入</span>
        </button>
      </section>
      <section className="set-block">
        <h3>存储</h3>
        <ul className="kv-list">
          <li>
            <span>书籍</span>
            <span>{books.length} 本</span>
          </li>
          <li>
            <span>自定义封面</span>
            <span>{Object.keys(covers).length} 张</span>
          </li>
          <li>
            <span>壁纸</span>
            <span>{wallpapers.length} 个</span>
          </li>
          <li>
            <span>存储位置</span>
            <span>IndexedDB（本地优先，完全离线）</span>
          </li>
        </ul>
        <button className="tbtn danger" onClick={clearAll}>
          <IconTrash size={14} />
          <span>清空全部数据</span>
        </button>
      </section>
    </>
  )
}

function AboutSection() {
  return (
    <section className="set-block">
      <h3>关于墨鱼阅读器</h3>
      <ul className="kv-list">
        <li>
          <span>版本</span>
          <span>0.1.0（MVP · 首页展示模块）</span>
        </li>
        <li>
          <span>技术栈</span>
          <span>Electron 33 + React 18 + TypeScript + Vite + Motion + Zustand + IndexedDB</span>
        </li>
        <li>
          <span>架构说明</span>
          <span>
            前端为 shell 无关的纯 Web 实现；原技术选型为 Tauri 2，因本机缺少 Rust / MSVC 工具链无法编译其 Rust 核心，故以 Electron 交付 exe，前端代码可平移到 Tauri。
          </span>
        </li>
        <li>
          <span>数据</span>
          <span>书籍元数据 / 进度 / 封面 / 壁纸全部存于本地 IndexedDB，离线可用</span>
        </li>
      </ul>
    </section>
  )
}

export function SettingsPage() {
  const { ui, setUI } = useStore()
  const active = SECTIONS.find((s) => s.id === ui.settingsSection) ?? SECTIONS[0]

  return (
    <div className="settings-page">
      <nav className="settings-nav">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            className={`set-nav-btn${active.id === s.id ? ' active' : ''}`}
            onClick={() => setUI({ settingsSection: s.id })}
          >
            {active.id === s.id && (
              <motion.span layoutId="set-nav-pill" className="set-nav-pill" transition={{ type: 'spring', stiffness: 420, damping: 32 }} />
            )}
            <span className="set-nav-inner">
              <s.Icon size={15} />
              <span>{s.label}</span>
            </span>
          </button>
        ))}
      </nav>
      <div className="settings-content">
        {active.id === 'appearance' && <AppearanceSection />}
        {active.id === 'wallpaper' && <WallpaperSection />}
        {active.id === 'webdav' && <NetpanSection />}
        {active.id === 'shortcut' && <ShortcutSection />}
        {active.id === 'data' && <DataSection />}
        {active.id === 'about' && <AboutSection />}
      </div>
    </div>
  )
}
