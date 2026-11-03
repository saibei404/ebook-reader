import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { ErrorBoundary } from './components/ErrorBoundary'
import { installErrorLogging } from './lib/error-log'
import { useStore } from './store/useStore'
import './styles/global.css'

// 必须早于 React 挂载：首屏渲染阶段的异常也要能落到日志
installErrorLogging('main')

/**
 * 自动化钩子（仅 ?testhooks=1 时生效）：把备份模块挂到 window，
 * 让端到端自检能直接调用导入/合并逻辑，而不必操作原生文件对话框。
 * 生产环境（默认 URL 无该参数）不会执行。
 */
if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('testhooks') === '1') {
  void import('./lib/backup').then((m) => {
    ;(window as unknown as { __moyuBackup?: unknown }).__moyuBackup = m
  })
  // 端到端自检需要直接驱动导入流程（拖拽是浏览器事件，自动化里只能造 DOM 事件）
  ;(window as unknown as { __moyuStore?: unknown }).__moyuStore = useStore
}

/**
 * 兜底页自检开关（`?crash=render|global|reject`）。
 * 只有显式带参数才会触发，正常启动完全不受影响。
 */
const crashMode =
  typeof location !== 'undefined' ? new URLSearchParams(location.search).get('crash') : null

if (crashMode === 'global') {
  window.setTimeout(() => {
    throw new Error('CRASH_TEST_GLOBAL: 全局错误自检')
  }, 300)
} else if (crashMode === 'reject') {
  void Promise.reject(new Error('CRASH_TEST_REJECT: 未处理 Promise 自检'))
}

function Root(): React.ReactElement {
  if (crashMode === 'render') throw new Error('CRASH_TEST_RENDER: 渲染错误自检')
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary scope="main">
      <Root />
    </ErrorBoundary>
  </React.StrictMode>
)
