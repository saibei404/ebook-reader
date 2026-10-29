import { motion } from 'motion/react'
import { useStore } from '@/store/useStore'
import { IconLibrary, IconNote, IconUser, IconMoon, IconSun } from './Icons'

const TABS = [
  { id: 'library' as const, label: '书架', Icon: IconLibrary },
  { id: 'notes' as const, label: '笔记', Icon: IconNote },
  { id: 'profile' as const, label: '我的', Icon: IconUser },
]

export function TabBar() {
  const { ui, settings, setUI, setSettings } = useStore()

  return (
    <div className={`tabbar mat-${settings.material}`}>
      <div className="tabbar-brand">
        <img className="brand-icon" src={`${import.meta.env.BASE_URL}assets/icon.png`} alt="logo" />
        <div className="brand-text">
          <span className="brand-name">墨鱼阅读</span>
          <span className="brand-sub">本地书架</span>
        </div>
      </div>

      <nav className="tabbar-nav">
        {TABS.map((t) => {
          const active = ui.tab === t.id
          return (
            <button
              key={t.id}
              className={`tab-btn${active ? ' active' : ''}`}
              onClick={() => setUI({ tab: t.id })}
            >
              {active && (
                <motion.span
                  layoutId="tab-pill"
                  className="tab-pill"
                  transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                />
              )}
              <span className="tab-btn-inner">
                <t.Icon size={17} />
                <span>{t.label}</span>
              </span>
            </button>
          )
        })}
      </nav>

      <div className="tabbar-foot">
        {/* 材质切换已收纳至「我的 → 外观」，此处仅保留主题快捷切换 */}
        <button
          className="foot-btn icon-only"
          onClick={() => void setSettings({ theme: settings.theme === 'dark' ? 'light' : 'dark' })}
          title={settings.theme === 'dark' ? '切换到浅色' : '切换到深色'}
        >
          {settings.theme === 'dark' ? <IconSun size={16} /> : <IconMoon size={16} />}
        </button>
      </div>
    </div>
  )
}
