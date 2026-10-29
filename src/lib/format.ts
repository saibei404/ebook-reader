/** 通用格式化工具 */

/** 字节数 → 人类可读体积（B/KB/MB/GB） */
export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GB`
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${Math.max(0.1, bytes / 1024).toFixed(1)} KB`
}
