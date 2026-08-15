import { useUIStore } from '@/stores/ui-store'
import { useTheme } from '@/hooks/use-theme'

export function HeroBrand() {
  const { openAuth } = useUIStore()
  const { theme, toggleTheme } = useTheme()

  return (
    <div className="relative pt-16 pb-12 sm:pt-20 sm:pb-16">
      {/* 右上角主题切换 */}
      <div className="absolute top-4 right-4 sm:top-6 sm:right-6">
        <button
          onClick={toggleTheme}
          className="w-9 h-9 flex items-center justify-center rounded-lg transition-all duration-200 hover:opacity-70"
          style={{
            color: 'var(--text-muted)',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-line)',
          }}
          title={theme === 'light' ? '切换到暗色模式' : '切换到浅色模式'}
        >
          {theme === 'light' ? '🌙' : '☀️'}
        </button>
      </div>

      {/* 品牌区域 */}
      <div className="flex flex-col items-center text-center">
        {/* 大 icon — 无模糊投影 */}
        <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden mb-6">
          <img
            src="/favicon.png"
            alt="MoreAni"
            className="w-full h-full object-cover"
          />
        </div>

        {/* 标题 */}
        <h1
          className="text-3xl sm:text-4xl font-bold tracking-tight mb-2"
          style={{
            color: 'var(--text-primary)',
            fontFamily: 'var(--font-display)',
          }}
        >
          又看一集
        </h1>

        {/* 副标题 */}
        <p
          className="text-sm sm:text-base mb-8"
          style={{ color: 'var(--text-muted)' }}
        >
          记录看过的番，看看朋友的评价
        </p>

        {/* 登录按钮 */}
        <button
          onClick={openAuth}
          className="px-6 py-2.5 text-sm font-medium rounded-full transition-all duration-200"
          style={{
            background: 'linear-gradient(135deg, var(--brand), var(--brand-deep))',
            color: '#fff',
            boxShadow: theme === 'dark' ? '0 0 15px rgba(255, 140, 212, 0.2)' : '0 2px 8px rgba(0,0,0,0.1)',
          }}
        >
          开始使用
        </button>
      </div>

      {/* 装饰性渐变 — 仅暗色主题 */}
      {theme === 'dark' && (
        <div
          className="absolute inset-0 -z-10"
          style={{
            background: 'radial-gradient(ellipse at center top, rgba(255, 140, 212, 0.08) 0%, transparent 60%)',
          }}
        />
      )}
    </div>
  )
}
