import React from 'react'
import ReactDOM from 'react-dom/client'
import { ReaderApp } from './ReaderApp'
import { ErrorBoundary } from '@/components/ErrorBoundary'
import { installErrorLogging } from '@/lib/error-log'

// 阅读窗口最容易因坏文件（异常 EPUB/DOCX、加密 PDF）在渲染阶段抛错，
// 这里同样必须早于 React 挂载安装全局监听。
installErrorLogging('reader')

/** 兜底页自检开关（`?crash=render|global|reject`），仅显式带参时触发 */
const crashMode =
  typeof location !== 'undefined' ? new URLSearchParams(location.search).get('crash') : null

if (crashMode === 'global') {
  window.setTimeout(() => {
    throw new Error('CRASH_TEST_GLOBAL: 全局错误自检（阅读窗口）')
  }, 300)
}

function Root(): React.ReactElement {
  if (crashMode === 'render') throw new Error('CRASH_TEST_RENDER: 渲染错误自检（阅读窗口）')
  return <ReaderApp />
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary scope="reader">
      <Root />
    </ErrorBoundary>
  </React.StrictMode>
)
