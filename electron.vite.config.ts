import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'
import pkg from './package.json'

export default defineConfig({
  main: {
    // @lingo-reader/* 是纯 ESM 包（package.json "type":"module"），而主进程产物是 CJS；
    // 外置会变成 require() 一个 ESM 文件 → 启动即报 "require is not defined"。
    // 这两个包没有原生依赖，直接打进 main.js 最稳。
    plugins: [externalizeDepsPlugin({ exclude: ['@lingo-reader/mobi-parser', '@lingo-reader/shared'] })],
    build: {
      outDir: 'out/main',
      lib: { entry: 'electron/main.ts', formats: ['cjs'] }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      lib: { entry: 'electron/preload.ts', formats: ['cjs'] }
    }
  },
  renderer: {
    root: '.',
    // 版本号单一真源：只改 package.json，关于页/日志/产物名一起跟着变
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version),
    },
    resolve: {
      alias: { '@': resolve(__dirname, 'src') }
    },
    build: {
      outDir: 'out/renderer',
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'index.html'),
          // 独立阅读窗口入口：epub.js / pdf.js 只在此入口按需加载
          reader: resolve(__dirname, 'reader.html'),
        }
      }
    },
    plugins: [react()]
  }
})
