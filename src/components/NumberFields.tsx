/**
 * 数值控件：滑块 + 可直接输入的数字框 / 纯步进器。
 *
 * 为什么不用裸 `<input type="range">`：
 * - 滑块只能"拖个大概"，用户想精确设成 55% 时没有输入入口；
 * - 原生 range 的数值展示位置、字号各页面不一致，容易显得凌乱。
 *
 * 这里的数字框是「编辑中保留草稿、失焦/回车才提交」：
 * 直接把 `value` 绑到 number input 会在用户删空或输入 "0." 时被立刻规范化，
 * 表现为"打不进去字"。
 */
import { useEffect, useRef, useState } from 'react'
import '@/styles/number-field.css'

interface NumberFieldProps {
  value: number
  min: number
  max: number
  /** 步进；不传则按范围自动取 */
  step?: number
  /** 小数位，默认 0 */
  decimals?: number
  /** 后缀单位（% / px / ×） */
  unit?: string
  onChange: (v: number) => void
  /** 只显示输入框，不显示加减按钮 */
  compact?: boolean
  ariaLabel?: string
}

function autoStep(min: number, max: number): number {
  const span = Math.abs(max - min)
  if (span <= 5) return 0.1
  if (span <= 40) return 1
  if (span <= 200) return 5
  return 20
}

export function NumberField({
  value,
  min,
  max,
  step,
  decimals = 0,
  unit,
  onChange,
  compact = false,
  ariaLabel,
}: NumberFieldProps) {
  const clamp = (v: number) => Math.min(max, Math.max(min, v))
  const round = (v: number) => Number(v.toFixed(decimals))
  const fmt = (v: number) => v.toFixed(decimals)
  const [draft, setDraft] = useState(fmt(value))
  const focused = useRef(false)

  // 外部变化（拖动滑块、切书、重置）时同步显示，但不打断正在编辑的输入
  useEffect(() => {
    if (!focused.current) setDraft(fmt(value))
  }, [value, decimals])

  const commit = (raw: string) => {
    const n = Number(raw.replace(/[^\d.-]/g, ''))
    if (!Number.isFinite(n) || raw.trim() === '') {
      setDraft(fmt(value))
      return
    }
    const next = round(clamp(n))
    setDraft(fmt(next))
    if (next !== value) onChange(next)
  }

  const bump = (dir: 1 | -1) => {
    const s = step ?? autoStep(min, max)
    const next = round(clamp(value + dir * s))
    setDraft(fmt(next))
    if (next !== value) onChange(next)
  }

  return (
    <div className={`numfield${compact ? ' compact' : ''}`}>
      {!compact && (
        <button type="button" className="num-btn" onClick={() => bump(-1)} aria-label="减小">
          −
        </button>
      )}
      <input
        className="num-input"
        type="text"
        inputMode="decimal"
        value={draft}
        aria-label={ariaLabel}
        onFocus={(e) => {
          focused.current = true
          e.currentTarget.select()
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => {
          focused.current = false
          commit(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur()
          } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            bump(1)
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            bump(-1)
          }
        }}
      />
      {unit && <span className="num-unit">{unit}</span>}
      {!compact && (
        <button type="button" className="num-btn" onClick={() => bump(1)} aria-label="增大">
          +
        </button>
      )}
    </div>
  )
}

interface SliderFieldProps {
  label: string
  /** 真实值（0.55 / 19 / 720 …） */
  value: number
  min: number
  max: number
  step?: number
  /** 显示值 = value * scale（0.55 → 55） */
  scale?: number
  decimals?: number
  unit?: string
  onChange: (v: number) => void
  hint?: string
}

/** 一行三件套：标签 / 滑块 / 数字框（数字可直接输入） */
export function SliderField({
  label,
  value,
  min,
  max,
  step,
  scale = 1,
  decimals = 0,
  unit,
  onChange,
  hint,
}: SliderFieldProps) {
  const shown = Number((value * scale).toFixed(decimals))
  return (
    <div className="num-field-row">
      <div className="num-row">
        <span className="num-label">{label}</span>
        <input
          className="num-range"
          type="range"
          min={min}
          max={max}
          step={step ?? (scale === 100 ? 1 : 0.01)}
          value={shown}
          onChange={(e) => onChange(Number(e.target.value) / scale)}
          aria-label={label}
        />
        <NumberField
          value={shown}
          min={min}
          max={max}
          step={step ?? 1}
          decimals={decimals}
          unit={unit}
          ariaLabel={label}
          onChange={(v) => onChange(v / scale)}
        />
      </div>
      {hint && <p className="num-hint">{hint}</p>}
    </div>
  )
}
