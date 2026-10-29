import type { Book } from '@/types/book'

interface SeedInput {
  title: string
  author: string
  format: Book['format']
  progress: number
  lastReadDaysAgo: number | null
  description: string
}

const SEEDS: SeedInput[] = [
  { title: '深海与星辰', author: '林望潮', format: 'epub', progress: 0.62, lastReadDaysAgo: 0, description: '一部关于海洋探索与人类勇气的长篇纪实。' },
  { title: '墨鱼街的夏天', author: '苏默', format: 'epub', progress: 0.18, lastReadDaysAgo: 1, description: '小城夏日，少年与一只会写字的老猫。' },
  { title: '代码之外的漫步', author: '陈序', format: 'pdf', progress: 0.35, lastReadDaysAgo: 3, description: '技术人的人文随笔集。' },
  { title: '月光下的翻译官', author: '阿澜', format: 'mobi', progress: 0, lastReadDaysAgo: null, description: '战火中传递情报的语言学家。' },
  { title: '山海食记', author: '顾小满', format: 'epub', progress: 0.91, lastReadDaysAgo: 0, description: '跟着山海经吃遍神州。' },
  { title: '硅谷谜案', author: 'K. 罗森', format: 'azw3', progress: 0.47, lastReadDaysAgo: 2, description: '一桩发生在创业公司的完美谋杀。' },
  { title: '时间的褶皱', author: '沈泊', format: 'fb2', progress: 0.73, lastReadDaysAgo: 5, description: '物理学家写给所有人的时间简史别传。' },
  { title: '旧书店疗法', author: '米娅', format: 'epub', progress: 0.05, lastReadDaysAgo: 8, description: '每一本旧书都藏着一段人生。' },
  { title: '雾中列车', author: '北原', format: 'txt', progress: 0.28, lastReadDaysAgo: 4, description: '一列永不到站的夜行列车。' },
  { title: '城市植物图鉴', author: '方棠', format: 'pdf', progress: 1, lastReadDaysAgo: 12, description: '钢筋森林里的绿色居民。' },
  { title: '猫与量子力学', author: '薛定谔的房东', format: 'cbz', progress: 0.5, lastReadDaysAgo: 6, description: '用漫画讲懂量子世界。' },
  { title: '晚风驿站', author: '江离', format: 'txt', progress: 0.12, lastReadDaysAgo: 9, description: '一封封没有寄出的信。' },
  { title: '北纬四十度', author: '骆一禾', format: 'epub', progress: 0.66, lastReadDaysAgo: 1, description: '沿着纬线旅行的地理笔记。' },
  { title: '电子羊的梦', author: 'P. K. 迪克', format: 'cbr', progress: 0.4, lastReadDaysAgo: 7, description: '科幻经典的漫画改编。' },
]

const DAY = 86400000

export function seedBooks(now: number): Book[] {
  return SEEDS.map((s, i) => ({
    id: `seed-${String(i + 1).padStart(2, '0')}`,
    title: s.title,
    author: s.author,
    format: s.format,
    addedAt: now - (SEEDS.length - i) * DAY,
    lastReadAt: s.lastReadDaysAgo === null ? null : now - s.lastReadDaysAgo * DAY,
    progress: s.progress,
    coverId: null,
    coverSeed: 1000 + i * 37,
    shelfId: null,
    size: 480000 + i * 91337,
    sourcePath: null,
    description: s.description,
  }))
}
