/**
 * 轻量阶段打点：只记录毫秒时间戳与计数，供自动化自检读取（`window.__moyuPerf`）。
 * 生产环境同样写入，但只有一个普通对象，开销可忽略；不打印日志以免污染控制台。
 */
export type PerfSample = Record<string, number>

declare global {
  interface Window {
    __moyuPerf?: PerfSample
  }
}

export function perfMark(name: string, extra?: Record<string, number>): void {
  try {
    const w = window as Window
    const target = (w.__moyuPerf ??= {})
    const now = Math.round(performance.now())
    target[name] = now
    if (extra) {
      for (const [k, v] of Object.entries(extra)) target[k] = v
    }
  } catch {
    /* 无 window（单测/SSR）时忽略 */
  }
}

/** 读取打点快照（自检用） */
export function perfRead(): PerfSample {
  try {
    return { ...((window as Window).__moyuPerf ?? {}) }
  } catch {
    return {}
  }
}
