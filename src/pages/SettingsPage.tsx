import { useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { useStore } from '@/store/useStore'
import { ANIM_MODES, MATERIALS, WALLPAPER_FITS } from '@/types/book'
import { nativeApi } from '@/lib/native'
import { SliderField } from '@/components/NumberFields'
import { formatSize } from '@/lib/format'
import { exportBackup, importBackup } from '@/lib/backup'
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
          内置两张系统壁纸（一张偏白、一张偏深），开箱即用；也可以导入本地图片或视频作为底纹。
          壁纸会自动适配当前模式的亮度：浅色叠加白色提亮罩，深色叠加黑色压暗罩。
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
        <SliderField
          label="底纹适配强度"
          value={settings.wallpaperDim}
          min={0}
          max={80}
          scale={100}
          unit="%"
          onChange={setWallpaperDimValue}
        />
        <SliderField
          label="背景透明度"
          value={settings.contentOpacity}
          min={20}
          max={100}
          scale={100}
          unit="%"
          onChange={(v) => void setSettings({ contentOpacity: v })}
        />
        <p className="set-desc">背景透明度控制书架区域衬底的不透明度：数值越低壁纸越清晰，越高文字对比越强（浅色模式默认已调低）。</p>
        <SliderField
          label="Dock 栏透明度"
          value={settings.dockOpacity}
          min={20}
          max={90}
          scale={100}
          unit="%"
          onChange={(v) => void setSettings({ dockOpacity: v })}
        />
        <p className="set-desc">
          Dock 栏（侧栏 + 顶栏）为半透明毛玻璃底纹，透明度默认显著低于书架栏，壁纸在所有界面层级均可见；该滑块也可在顶栏「壁纸」弹层中调节。
        </p>
      </section>

      <section className="set-block">
        <h3>我的壁纸</h3>
        <p className="set-desc">「系统」标记的两张随包内置，不可删除；其余为你导入的本地文件。</p>
        {wallpapers.map((w) => (
          <div key={w.id} className={`wp-item${settings.wallpaperId === w.id ? ' active' : ''}`}>
            <button className="wp-item-main" onClick={() => void setSettings({ wallpaperId: w.id })}>
              <span className="wp-item-name">{w.name}</span>
              {w.builtin && <span className="wp-badge">系统</span>}
              {settings.wallpaperId === w.id && <IconCheck size={13} />}
            </button>
            {!w.builtin && (
              <button className="wp-item-del" onClick={() => void removeWallpaper(w.id)} title="删除">
                <IconTrash size={13} />
              </button>
            )}
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
        <SliderField
          label="缩放"
          value={settings.wallpaperZoom}
          min={25}
          max={300}
          scale={100}
          unit="%"
          onChange={setWallpaperZoom}
        />
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

const BOOK_EXTS = ['epub', 'pdf', 'mobi', 'azw3', 'azw', 'fb2', 'txt', 'md', 'docx', 'doc', 'cbz', 'cbr']

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
    if (!window.confirm('确定清空全部书籍、封面、壁纸、书签与笔记？此操作不可恢复。')) return
    const db = await getDB()
    await db.clear('books')
    await db.clear('covers')
    await db.clear('wallpapers')
    // 书签/笔记是 v2/v3 才有的表，旧库不存在时忽略
    for (const store of ['bookmarks', 'annotations'] as const) {
      if (db.objectStoreNames.contains(store)) await db.clear(store)
    }
    toast('已清空，正在重新初始化…', 'info')
    setTimeout(() => {
      void hydrate()
    }, 400)
  }

  /** 导入备份：合并去重（不覆盖用户已读得更远的进度） */
  const onImport = async () => {
    let text = ''
    if (nativeApi?.openTextFile) {
      const r = await nativeApi.openTextFile()
      if (!r.ok) {
        if (!r.canceled) toast(`读取备份失败：${r.error ?? '未知错误'}`, 'err')
        return
      }
      text = r.content ?? ''
    } else {
      text = await new Promise<string>((resolve) => {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = '.json,application/json'
        input.onchange = () => {
          const f = input.files?.[0]
          if (!f) {
            resolve('')
            return
          }
          const rd = new FileReader()
          rd.onload = () => resolve(String(rd.result ?? ''))
          rd.onerror = () => resolve('')
          rd.readAsText(f)
        }
        input.click()
      })
      if (!text) return
    }

    const res = await importBackup(text)
    if (!res.ok) {
      toast(`导入失败：${res.error ?? '未知错误'}`, 'err')
      return
    }
    await hydrate()
    const s = res.stats
    toast(
      `导入完成：新增 ${s?.addedBooks ?? 0} 本 / 合并 ${s?.mergedBooks ?? 0} 本 · 书签 +${s?.addedBookmarks ?? 0} · 笔记 +${s?.addedAnnotations ?? 0}`,
      'ok'
    )
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
              input.accept = '.epub,.pdf,.mobi,.azw3,.azw,.fb2,.txt,.md,.docx,.doc,.cbz,.cbr'
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
        <div className="backup-actions">
          <button
            className="tbtn"
            onClick={async () => {
              const r = await exportBackup()
              if (r.ok) {
                const size = r.counts ? Math.max(1, Math.round(r.counts.bytes / 1024)) : 0
                toast(
                  `已导出：${r.counts?.books ?? 0} 本书 · ${r.counts?.kv ?? 0} 项设置 · ${size}KB`,
                  'ok'
                )
              } else if (!r.canceled) {
                toast(`导出失败：${r.error ?? '未知错误'}`, 'err')
              }
            }}
          >
            <IconDatabase size={14} />
            <span>导出备份</span>
          </button>
          <button className="tbtn" onClick={() => void onImport()}>
            <IconDatabase size={14} />
            <span>导入备份</span>
          </button>
          <button className="tbtn danger" onClick={clearAll}>
            <IconTrash size={14} />
            <span>清空全部数据</span>
          </button>
        </div>
        <p className="set-desc">
          备份为单个 JSON：含书架元数据、阅读位置、书签、笔记与全部设置；不含壁纸与封面图片（封面可按种子重建，
          壁纸体积大）。导入采用「合并去重」：同一本书只保留一份，读到更晚的位置不会被覆盖。
        </p>
      </section>
    </>
  )
}

function AboutSection() {
  const { toast } = useStore()
  return (
    <>
      <section className="set-block">
        <h3>关于墨鱼阅读器</h3>
        <p className="set-desc">
          本地优先的桌面阅读器：书籍、进度、书签与笔记都只存在这台电脑上，不需要账号，也不上传任何内容。
        </p>
        <ul className="kv-list">
          <li>
            <span>版本</span>
            <span>{__APP_VERSION__}（功能完整版 · v32 基线）</span>
          </li>
          <li>
            <span>支持格式</span>
            <span>
              EPUB / PDF / TXT / MD / FB2 / DOCX / CBZ 七种可直接阅读；MOBI / AZW3 / CBR 导入时会提示转换
            </span>
          </li>
          <li>
            <span>阅读能力</span>
            <span>位置记忆（精确到章内文字）、书签、四色高亮与备注、全篇搜索、排版面板、目录跳转</span>
          </li>
          <li>
            <span>数据位置</span>
            <span>
              书籍元数据与笔记存于本机 IndexedDB（Windows 下为 %APPDATA%\墨鱼阅读器）；书籍原文件留在你导入时的位置
            </span>
          </li>
          <li>
            <span>隐私</span>
            <span>无账号、无遥测、无后台请求；只有你主动使用「网盘导入」时才会连接你填写的服务器</span>
          </li>
          <li>
            <span>备份与迁移</span>
            <span>「数据」分区可导出单个 JSON（含进度、书签、笔记与全部设置），换机器时导入即可</span>
          </li>
          <li>
            <span>技术栈</span>
            <span>Electron 45 · React 18 · TypeScript · Vite · epub.js · pdf.js · IndexedDB</span>
          </li>
        </ul>
        <div className="wp-actions">
          <button
            className="tbtn"
            onClick={async () => {
              const r = await nativeApi?.exportDiagnostics?.()
              if (r?.ok) toast('诊断报告已保存，可在反馈时一并提供', 'ok')
              else if (r && !r.canceled) toast(`导出失败：${r.error ?? '未知错误'}`, 'err')
            }}
          >
            <IconDatabase size={14} />
            <span>导出诊断报告</span>
          </button>
        </div>
        <p className="set-desc">
          诊断报告只含版本、系统环境与最近日志，不含书籍正文、笔记内容或任何个人信息；遇到打不开、闪退等问题时可先导出一份。
        </p>
      </section>

      <section className="set-block">
        <h3>为什么用 Electron</h3>
        <p className="set-desc">
          前端是 shell 无关的纯 Web 实现（阅读内核、排版、标注都在渲染层）。原计划用 Tauri 2，但本机缺少 Rust / MSVC
          工具链无法编译其 Rust 核心，因此以 Electron 交付；前端代码可平移到 Tauri，不需要重写业务逻辑。
        </p>
      </section>
    </>
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
