const { spawn } = require('child_process')
const path = require('path')
const os = require('os')

function cleanEnv() {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  return env
}

function run(cmd, args) {
  const child = spawn(cmd, args, { stdio: 'inherit', env: cleanEnv(), shell: process.platform === 'win32' })
  child.on('close', (code) => process.exit(code ?? 1))
}

const mode = process.argv[2] || 'dev'
if (mode === 'dev') run('electron-vite', ['dev'])
else if (mode === 'shot') {
  // 独立 profile：避免与便携 exe 共用 userData 导致 IndexedDB 冲突
  const profile = path.join(os.tmpdir(), 'moyu-shot-profile')
  run('electron', ['.', '--shot', `--user-data-dir=${profile}`])
}
else {
  console.error('usage: node scripts/run.cjs <dev|shot>')
  process.exit(1)
}
