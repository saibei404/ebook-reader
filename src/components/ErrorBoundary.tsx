import { Component, type ErrorInfo, type ReactNode } from 'react'
import { nativeApi } from '@/lib/native'
import { reportError, logsHint } from '@/lib/error-log'

interface Props {
  /** 出错来源，写进日志便于区分主窗口/阅读窗口 */
  scope: string
  children: ReactNode
}

interface State {
  error: Error | null
  /** 导出诊断的结果提示 */
  note: string
  /** 连续重载次数（持久的渲染错误会每次启动都崩，重载是死循环） */
  reloads: number
}

const RELOAD_KEY = 'moyu-crash-reloads'

/**
 * 渲染错误兜底页。
 *
 * 样式全部走内联 `<style>` + 系统字体，**不依赖 global.css / 主题变量**：
 * 崩溃可能发生在样式加载失败或主题切换中途，那时候任何外部依赖都不可信。
 * 深浅色用 `prefers-color-scheme` 跟随系统，不跟随应用主题（应用状态本身可能已坏）。
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, note: '', reloads: 0 }

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    reportError(this.props.scope, error, { componentStack: info.componentStack })
    let reloads = 0
    try {
      reloads = Number(sessionStorage.getItem(RELOAD_KEY) || 0)
    } catch {
      /* 隐私模式等场景 sessionStorage 不可用 */
    }
    this.setState({ reloads })
  }

  private reload = (): void => {
    try {
      sessionStorage.setItem(RELOAD_KEY, String(this.state.reloads + 1))
    } catch {
      /* ignore */
    }
    location.reload()
  }

  private exportDiag = async (): Promise<void> => {
    if (!nativeApi) {
      this.setState({ note: '浏览器预览模式不支持导出，请查看控制台。' })
      return
    }
    this.setState({ note: '正在打开保存对话框…' })
    try {
      const r = await nativeApi.exportDiagnostics()
      if (r.canceled) this.setState({ note: '已取消。' })
      else if (r.ok) this.setState({ note: `已保存到：${r.path}` })
      else this.setState({ note: `导出失败：${r.error ?? '未知错误'}` })
    } catch (e) {
      this.setState({ note: `导出失败：${String(e)}` })
    }
  }

  private closeWindow = (): void => {
    if (nativeApi) nativeApi.selfClose()
    else window.close()
  }

  render(): ReactNode {
    const { error, note, reloads } = this.state
    if (!error) return this.props.children

    const stack = (error.stack || `${error.name}: ${error.message}`).slice(0, 2000)

    return (
      <div className="moyu-crash">
        <style>{CRASH_CSS}</style>
        <div className="moyu-crash-card" role="alertdialog" aria-labelledby="moyu-crash-title">
          <div className="moyu-crash-badge" aria-hidden="true">
            !
          </div>
          <h1 id="moyu-crash-title">界面出了点问题</h1>
          <p className="moyu-crash-lede">
            你的书架和阅读进度都存在本地，没有丢失。可以先重新加载；如果反复出现，导出一份诊断报告发给开发者。
          </p>

          <div className="moyu-crash-msg">{error.message || String(error)}</div>

          {reloads >= 3 && (
            <p className="moyu-crash-warn">
              已经重载 {reloads} 次仍是同样的问题，重载大概率无效——建议直接导出诊断报告。
            </p>
          )}

          <details className="moyu-crash-details">
            <summary>技术详情</summary>
            <pre>{stack}</pre>
            <p className="moyu-crash-hint">完整日志：{logsHint()}</p>
          </details>

          <div className="moyu-crash-actions">
            <button type="button" className="moyu-crash-btn primary" onClick={this.reload}>
              重新加载
            </button>
            <button type="button" className="moyu-crash-btn" onClick={() => void this.exportDiag()}>
              导出诊断报告
            </button>
            <button type="button" className="moyu-crash-btn ghost" onClick={this.closeWindow}>
              {this.props.scope === 'reader' ? '关闭阅读窗口' : '隐藏到托盘'}
            </button>
          </div>

          {note && <p className="moyu-crash-note">{note}</p>}
        </div>
      </div>
    )
  }
}

const CRASH_CSS = `
.moyu-crash {
  position: fixed;
  inset: 0;
  z-index: 2147483000;
  display: grid;
  place-items: center;
  padding: 32px;
  background: #0e0e10;
  color: #f5f5f7;
  font-family: -apple-system, "PingFang SC", "Microsoft YaHei", "Segoe UI", system-ui, sans-serif;
  font-size: 14px;
  line-height: 1.6;
  -webkit-font-smoothing: antialiased;
  overflow: auto;
}
.moyu-crash-card {
  width: min(560px, 100%);
  padding: 26px 26px 20px;
  border-radius: 16px;
  background: #1a1a1d;
  border: 1px solid rgba(255,255,255,.09);
  box-shadow: 0 24px 64px rgba(0,0,0,.45);
}
.moyu-crash-badge {
  width: 30px; height: 30px;
  display: grid; place-items: center;
  border-radius: 50%;
  background: rgba(255,159,10,.16);
  color: #ff9f0a;
  font-weight: 700; font-size: 16px;
  margin-bottom: 14px;
}
.moyu-crash-card h1 { font-size: 19px; font-weight: 600; margin: 0 0 8px; letter-spacing: .2px; }
.moyu-crash-lede { margin: 0 0 14px; font-size: 13px; opacity: .72; }
.moyu-crash-msg {
  padding: 9px 11px;
  border-radius: 9px;
  background: rgba(255,255,255,.05);
  border: 1px solid rgba(255,255,255,.08);
  font-family: "Cascadia Code", Consolas, monospace;
  font-size: 12px;
  word-break: break-word;
  max-height: 96px;
  overflow: auto;
}
.moyu-crash-warn { margin: 10px 0 0; font-size: 12.5px; color: #ff9f0a; }
.moyu-crash-details { margin: 14px 0 0; font-size: 12.5px; }
.moyu-crash-details summary { cursor: pointer; opacity: .65; user-select: none; }
.moyu-crash-details summary:hover { opacity: .9; }
.moyu-crash-details pre {
  margin: 8px 0 0;
  padding: 10px;
  border-radius: 8px;
  background: rgba(0,0,0,.28);
  font-family: "Cascadia Code", Consolas, monospace;
  font-size: 11.5px;
  line-height: 1.55;
  white-space: pre-wrap;
  word-break: break-word;
  max-height: 220px;
  overflow: auto;
}
.moyu-crash-hint { margin: 8px 0 0; font-size: 11.5px; opacity: .5; word-break: break-all; }
.moyu-crash-actions { display: flex; gap: 8px; margin-top: 18px; flex-wrap: wrap; }
.moyu-crash-btn {
  height: 32px;
  padding: 0 14px;
  border-radius: 8px;
  border: 1px solid rgba(255,255,255,.12);
  background: rgba(255,255,255,.06);
  color: inherit;
  font-size: 13px;
  cursor: pointer;
  transition: background .15s ease, opacity .15s ease;
}
.moyu-crash-btn:hover { background: rgba(255,255,255,.12); }
.moyu-crash-btn.primary { background: #0a84ff; border-color: transparent; color: #fff; font-weight: 500; }
.moyu-crash-btn.primary:hover { background: #0070e0; }
.moyu-crash-btn.ghost { background: transparent; border-color: transparent; opacity: .75; }
.moyu-crash-btn.ghost:hover { opacity: 1; background: rgba(255,255,255,.06); }
.moyu-crash-note { margin: 10px 0 0; font-size: 12px; opacity: .6; word-break: break-all; }

/* 浅色模式必须写在所有基础规则**之后**：
 * 同特异性下后写的胜出，之前放在前面会被下面的深色规则整体覆盖
 * （表现为白底黑卡、深字黑底，几乎不可读）。选择器再加 .moyu-crash 前缀双保险。 */
@media (prefers-color-scheme: light) {
  .moyu-crash.moyu-crash { background: #f5f5f7; color: #1c1c1e; }
  .moyu-crash .moyu-crash-card {
    background: #ffffff;
    border-color: rgba(0,0,0,.08);
    box-shadow: 0 18px 48px rgba(0,0,0,.10);
  }
  .moyu-crash .moyu-crash-msg {
    background: rgba(0,0,0,.04);
    border-color: rgba(0,0,0,.08);
  }
  .moyu-crash .moyu-crash-btn {
    background: rgba(0,0,0,.05);
    border-color: rgba(0,0,0,.10);
  }
  .moyu-crash .moyu-crash-btn:hover { background: rgba(0,0,0,.09); }
  .moyu-crash .moyu-crash-btn.primary { background: #0a84ff; color: #fff; border-color: transparent; }
  .moyu-crash .moyu-crash-btn.ghost {
    color: rgba(0,0,0,.62);
    background: transparent;
    border-color: transparent;
  }
  .moyu-crash .moyu-crash-btn.ghost:hover { background: rgba(0,0,0,.05); }
  .moyu-crash .moyu-crash-details pre { background: rgba(0,0,0,.04); }
}
`
