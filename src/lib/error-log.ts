import { nativeApi } from './native'

/**
 * 渲染进程全局错误采集。
 *
 * 目标不是「修好每个异常」，而是**让用户手里有可发的东西**：
 * 以前渲染进程一抛错就是白屏，用户只能说「打不开」，我们只能猜。
 * 现在所有未捕获异常都会带着堆栈落到 `%APPDATA%/moyu-reader/logs/app.log`。
 *
 * 三条约束：
 * 1. 采集器自己绝不能抛错（否则会形成「记录失败 → 再抛错 → 再记录」的死循环）；
 * 2. 必须去重 + 限流（一个渲染循环的报错能瞬间刷出上万条）；
 * 3. Web 预览（无 Electron）下退化为 console，不报错。
 */

export type ErrorScope = 'main' | 'reader' | 'render'

interface Report {
  scope: string
  level?: 'error' | 'warn' | 'info'
  message: string
  stack?: string
  extra?: unknown
}

/** 同一指纹（消息 + 栈前若干字符）在该窗口内只上报一次 */
const seen = new Set<string>()
/** 硬上限：一次会话最多上报 40 条，防止循环把日志写满 */
const MAX_REPORTS = 40
let reported = 0
let installed = false

function fingerprint(message: string, stack: string): string {
  return `${message}::${stack.slice(0, 240)}`
}

/** 直接把一条记录送到主进程（不做去重，供 ErrorBoundary 主动调用） */
export function report(payload: Report): void {
  try {
    if (nativeApi?.reportLog) {
      nativeApi.reportLog(payload)
      return
    }
    // Web 预览 / 测试环境
    console.error(`[${payload.scope}] ${payload.message}`, payload.stack ?? '')
  } catch {
    /* 上报链路自身失败时静默 */
  }
}

/** 上报一个异常对象（带指纹去重） */
export function reportError(scope: string, err: unknown, extra?: unknown): void {
  try {
    if (reported >= MAX_REPORTS) {
      if (reported === MAX_REPORTS) {
        reported += 1
        report({ scope, message: '[error-log] 本次会话上报已达上限，后续错误不再记录' })
      }
      return
    }
    const isErr = err instanceof Error
    const message = isErr ? `${err.name}: ${err.message}` : String(err ?? 'unknown error')
    const stack = isErr ? (err.stack ?? '') : ''
    const key = fingerprint(message, stack)
    if (seen.has(key)) return
    seen.add(key)
    reported += 1
    report({ scope, level: 'error', message, stack, extra })
  } catch {
    /* ignore */
  }
}

/**
 * 安装全局监听。每个窗口调用一次（重复调用无副作用）。
 * 必须在 React 挂载**之前**调用，否则首屏渲染阶段的异常会漏掉。
 */
export function installErrorLogging(scope: ErrorScope): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  window.addEventListener(
    'error',
    (event: ErrorEvent) => {
      // 资源加载失败（img/script 的 target 是元素）单独归类，堆栈信息价值低
      const target = event.target as (HTMLElement & { src?: string; href?: string }) | null
      if (target && target !== (window as unknown as EventTarget) && target.tagName) {
        const url = target.src || target.href || ''
        report({
          scope,
          level: 'warn',
          message: `资源加载失败: <${target.tagName.toLowerCase()}> ${url.slice(0, 300)}`,
        })
        return
      }
      const err = event.error ?? new Error(event.message || 'unknown error')
      reportError(scope, err, {
        filename: event.filename,
        line: event.lineno,
        col: event.colno,
      })
    },
    true
  )

  window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
    reportError(scope, event.reason, { kind: 'unhandledrejection' })
  })
}

/** 供兜底页展示：日志所在目录（Electron 下可用） */
export function logsHint(): string {
  return nativeApi ? '%APPDATA%\\moyu-reader\\logs\\app.log' : '浏览器控制台'
}
