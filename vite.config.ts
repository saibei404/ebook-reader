import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  root: '.',
  resolve: {
    alias: { '@': resolve(__dirname, 'src') }
  },
  plugins: [react()],
  server: { port: 5277, strictPort: true }
})
