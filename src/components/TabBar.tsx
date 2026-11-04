import { motion } from 'motion/react'
import { useStore } from '@/store/useStore'
import { withViewTransition } from '@/lib/vt'
import { IconLibrary, IconNote, IconUser } from './Icons'

const TABS = [
  { id: 'library' as const, label: '书架', Icon: IconLibrary },
  { id: 'notes' as const, label: '笔记', Icon: IconNote },
  { id: 'profile' as const, label: '我的', Icon: IconUser },
]

export function TabBar() {
  const { ui, settings, setUI } = useStore()

  return (
    <div className={`tabbar mat-${settings.material}`}>
      {/* 左上角不再单独占一栏放 logo + 软件名：窗口标题区在顶栏，侧栏直接从导航开始 */}
      <nav className="tabbar-nav">
        {TABS.map((t) => {
          const active = ui.tab === t.id
          return (
            <button
              key={t.id}
              className={`tab-btn${active ? ' active' : ''}`}
              onClick={() => withViewTransition(() => setUI({ tab: t.id }))}
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
        {/* 深浅模式只在顶栏留一个入口：以前侧栏底部还有一个，图标语义还相反
            （深色下这里显示太阳=「点我切浅色」，顶栏显示月亮=「当前是深色」），
            两个按钮叠在一起容易误判状态。 */}
        {/* 版本号常驻：截图/反馈时不用去「关于」确认跑的是哪个包（多次遇到拿旧 exe 报同一个问题） */}
        <span className="tabbar-ver" title="当前版本">
          v{__APP_VERSION__}
        </span>
      </div>
    </div>
  )
}
