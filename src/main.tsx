import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles/global.css'

/**
 * 自动化钩子（仅 ?testhooks=1 时生效）：把备份模块挂到 window，
 * 让端到端自检能直接调用导入/合并逻辑，而不必操作原生文件对话框。
 * 生产环境（默认 URL 无该参数）不会执行。
 */
if (typeof location !== 'undefined' && new URLSearchParams(location.search).get('testhooks') === '1') {
  void import('./lib/backup').then((m) => {
    ;(window as unknown as { __moyuBackup?: unknown }).__moyuBackup = m
  })
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
)
