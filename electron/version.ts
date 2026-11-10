/**
 * 纯版本号工具（无 electron / node 依赖，可单测）。
 * 从 update.ts 抽出：更新检查的「是否有新版」判定是纯逻辑，应与网络 IO 分离，
 * 便于 vitest 直接覆盖（tests/version.test.ts），不启动 Electron。
 */

/** 解析 major.minor.patch；忽略 v 前缀与 -beta 等预发布后缀；非法值按 0.0.0 */
export function parseVer(v: string): [number, number, number] {
  const m = String(v ?? '')
    .trim()
    .replace(/^v/i, '')
    .match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!m) return [0, 0, 0]
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

/** 语义化比较：a>b → 1，a<b → -1，相等 → 0（只比三段数字，逐段从左到右） */
export function compareVersions(a: string, b: string): number {
  const pa = parseVer(a)
  const pb = parseVer(b)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1
  }
  return 0
}