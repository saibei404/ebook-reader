/**
 * 原生 View Transitions 的最小封装（Chromium 111+，本项目 Electron 45 = Chromium 156）。
 *
 * 放在这里而不是和「打开详情」写在一起，是为了让**阅读窗口**也能用：
 * 阅读器是独立入口，不该因为想用一个过渡就把整个 zustand store 打进它的包里。
 * 所以这个模块不 import 任何应用状态，只依赖浏览器 API。
 *
 * 三条降级路径（任一命中就退回同步更新，功能完全不受影响）：
 *   1. 环境不支持 startViewTransition；
 *   2. 用户开了系统「减少动态效果」（prefers-reduced-motion）；
 *   3. 过渡启动时抛异常。
 */

import { flushSync } from 'react-dom'

type DocWithVT = Document & {
  startViewTransition?: (cb: () => void | Promise<void>) => {
    ready: Promise<void>
    finished: Promise<void>
    updateCallbackDone: Promise<void>
    skipTransition: () => void
  }
}

export function viewTransitionSupported(): boolean {
  return typeof document !== 'undefined' && typeof (document as DocWithVT).startViewTransition === 'function'
}

export function motionAllowed(): boolean {
  if (!viewTransitionSupported() || typeof window === 'undefined') return false
  return !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
}

/**
 * 等 React 提交 + 浏览器绘制：异步过渡里必须靠它保证「新快照」拿到的是新 DOM。
 *
 * 必须有 setTimeout 兜底：窗口最小化 / 隐藏 / 后台标签页时 Chromium 会暂停 rAF，
 * 纯 rAF 版本会让 startViewTransition 的回调 Promise 永远 pending，
 * 过渡不结束、finished 不 resolve，调用方 finally 里的清理也就永远不跑。
 */
export function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }
    requestAnimationFrame(() => requestAnimationFrame(finish))
    window.setTimeout(finish, 120)
  })
}

/**
 * 同步更新包进视图过渡。`flushSync` 是必须的：
 * zustand 的通知是异步批处理的，不强制同步提交的话浏览器拍到的新快照仍是旧 DOM，
 * 结果为「完全没动画，也不报错」。
 */
type VT = ReturnType<NonNullable<DocWithVT['startViewTransition']>>
/** 上一段尚未提交 update 的过渡（update callback 是下一帧才调用的） */
let pending: { t: VT; run: () => void } | null = null

export function withViewTransition(update: () => void): void {
  if (!motionAllowed()) {
    update()
    return
  }
  // startViewTransition 的 update callback 下一帧才跑。这期间又来一次点击时，
  // 浏览器会 skip 上一段、且它的 callback 可能压根不被调用 → 状态更新凭空丢失
  // （快速连点按钮会卡在打开/关闭的某一态）。所以主动 skip 并立刻补上那次更新。
  // run() 里有 called 去重，浏览器稍后即便又调一次 callback 也不会重复执行。
  if (pending) {
    pending.t.skipTransition()
    pending.run()
    pending = null
  }
  let called = false
  const run = () => {
    if (called) return
    called = true
    flushSync(update)
  }
  try {
    const t = (document as DocWithVT).startViewTransition!(run)
    catchAbort(t)
    pending = { t, run }
    // update 提交完就不再是 pending；若被 skip 则兜底再跑一次 run
    t.updateCallbackDone?.then(
      () => { if (pending?.t === t) pending = null },
      () => { run(); if (pending?.t === t) pending = null },
    )
    // 最后的保险：被 skip 的过渡里，callback 可能既不执行、promise 也一直 pending
    // （实测同一 tick 连点两次就有一个 callback 消失）。一帧后强制提交，
    // 视觉上退化成硬切，但功能绝不能丢。run 有 called 去重，正常路径下是 no-op。
    window.setTimeout(run, 32)
  } catch {
    run()
  }
}

/**
 * 异步更新包进视图过渡（换封面这种要读文件/写库的场景）。
 *
 * 关键：给 startViewTransition 的回调返回 Promise。浏览器会等它 resolve 之后再拍
 * 「新快照」——所以可以先 await 真正的异步动作，再用 nextPaint 等 React 把 DOM 更新完。
 */
export async function withAsyncViewTransition(run: () => Promise<void> | void): Promise<void> {
  if (!motionAllowed()) {
    await run()
    return
  }
  // 与同步版同理：被 skip 时 callback 可能永远不被调用。去重 + 定时器兜底，
  // 保证「换封面」这个业务动作不会因为动画被抢而丢失。
  let called = false
  const doRun = async () => {
    if (called) return
    called = true
    await run()
  }
  try {
    const t = (document as DocWithVT).startViewTransition!(async () => {
      await doRun()
      await nextPaint()
    })
    catchAbort(t)
    const guard = window.setTimeout(() => { void doRun() }, 32)
    // finished 也可能因为过渡被 skip / 窗口不可见而一直 pending，加超时兜底：
    // 调用方常把「清理 view-transition-name」放在 finally 里，卡住就会留下脏名字。
    await Promise.race([
      t.finished.catch(() => {}),
      new Promise<void>((resolve) => window.setTimeout(resolve, 600)),
    ])
    window.clearTimeout(guard)
  } catch {
    await doRun()
  }
}

/** 连续快速触发会让上一段过渡被 skip，ready/finished 以 AbortError reject；不接住会刷控制台 */
export function catchAbort(t: { ready: Promise<void>; finished: Promise<void> } | undefined): void {
  t?.ready.catch(() => {})
  t?.finished.catch(() => {})
}
