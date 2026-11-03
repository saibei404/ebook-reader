import { defineConfig } from 'vitest/config'
import path from 'node:path'

/**
 * 单测配置：
 * - jsdom 提供 DOMParser / document（FB2 解析、Word/HTML 转章节、字符偏移换算都依赖 DOM）；
 * - alias 与 tsconfig/electron.vite 保持一致（@ → src），测试里可直接 import 业务模块。
 * 只测纯函数与数据层，不启动 Electron（渲染进程行为由 MOYU_TEST_* 自检覆盖）。
 */
export default defineConfig({
  // 缓存放到工程内，避免系统临时目录权限问题（沙箱环境下会 EPERM）
  cacheDir: '.vitest-cache',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    reporters: 'default',
    coverage: {
      // 只统计被设计为「可测」的纯函数模块，避免把 UI 组件算进覆盖率得出无意义数字
      include: ['src/lib/annotations.ts', 'src/lib/backup.ts', 'src/lib/db.ts', 'src/reader/text-utils.ts', 'src/reader/text-range.ts', 'src/reader/chapter-window.ts', 'src/types/book.ts'],
      reporter: ['text'],
    },
  },
})
