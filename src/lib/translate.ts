/**
 * 大模型翻译：用户自备 OpenAI 兼容 API（baseURL + key + model）。
 *
 * 设计约束：
 * - 配置存 IndexedDB kv（'translator-config'），阅读窗口与主窗口同源共享；
 * - 请求直接从渲染进程 fetch 用户填写的 endpoint（CSP 已放行 connect-src https:）；
 * - 不经任何中间服务器；key 只落本机 IndexedDB。
 */
import { getKV, setKV } from '@/lib/db'

export type TransTarget = 'zh-CN' | 'zh-TW' | 'en' | 'ja' | 'ko'

export const TRANS_TARGETS: { id: TransTarget; label: string }[] = [
  { id: 'zh-CN', label: '简体中文' },
  { id: 'zh-TW', label: '繁體中文' },
  { id: 'en', label: 'English' },
  { id: 'ja', label: '日本語' },
  { id: 'ko', label: '한국어' },
]

export interface TranslateConfig {
  /** OpenAI 兼容 base URL，如 https://api.openai.com/v1 */
  baseUrl: string
  apiKey: string
  model: string
  target: TransTarget
}

export const DEFAULT_TRANSLATE_CONFIG: TranslateConfig = {
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  target: 'zh-CN',
}

const KEY = 'translator-config'

export async function loadTranslateConfig(): Promise<TranslateConfig> {
  try {
    const saved = await getKV<Partial<TranslateConfig>>(KEY)
    return { ...DEFAULT_TRANSLATE_CONFIG, ...(saved ?? {}) }
  } catch {
    return DEFAULT_TRANSLATE_CONFIG
  }
}

export async function saveTranslateConfig(cfg: TranslateConfig): Promise<void> {
  try {
    await setKV(KEY, cfg)
  } catch {
    /* 配置保存失败不阻断使用，仅本次会话内生效 */
  }
}

const TARGET_NAME: Record<TransTarget, string> = {
  'zh-CN': 'Simplified Chinese (简体中文)',
  'zh-TW': 'Traditional Chinese (繁體中文)',
  en: 'English',
  ja: 'Japanese (日本語)',
  ko: 'Korean (한국어)',
}

/** 单次翻译上限：选区翻译足够；防止误把超长文本一次性发出去 */
const MAX_CHARS = 6000

/**
 * 调用 OpenAI 兼容 /chat/completions 做翻译。
 * 抛出的 Error message 已是可直接展示的中文描述。
 */
export async function translateText(text: string, cfg: TranslateConfig, signal?: AbortSignal): Promise<string> {
  const trimmed = text.trim()
  if (!trimmed) return ''
  if (!cfg.apiKey.trim()) throw new Error('未配置 API Key：请在阅读器设置 → 翻译 中填写')
  if (trimmed.length > MAX_CHARS) throw new Error(`选区过长（${trimmed.length} 字符），一次最多翻译 ${MAX_CHARS} 字符`)

  const base = cfg.baseUrl.trim().replace(/\/+$/, '')
  const url = /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`

  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: cfg.model.trim() || DEFAULT_TRANSLATE_CONFIG.model,
        temperature: 0.3,
        messages: [
          {
            role: 'system',
            content:
              `You are a professional translator. Translate the user's text into ${TARGET_NAME[cfg.target]}. ` +
              'Preserve paragraph breaks. Output ONLY the translation, without explanations, quotes or the original text.',
          },
          { role: 'user', content: trimmed },
        ],
      }),
    })
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') throw e
    throw new Error('网络请求失败：请检查 Base URL 与网络连接')
  }

  if (!res.ok) {
    let detail = ''
    try {
      const body = (await res.json()) as { error?: { message?: string } }
      detail = body?.error?.message ?? ''
    } catch {
      /* 非 JSON 错误体，忽略 */
    }
    throw new Error(`API 返回 ${res.status}${detail ? `：${detail}` : ''}`)
  }

  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const out = body?.choices?.[0]?.message?.content?.trim()
  if (!out) throw new Error('API 返回了空结果')
  return out
}
