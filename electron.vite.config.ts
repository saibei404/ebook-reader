import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
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
