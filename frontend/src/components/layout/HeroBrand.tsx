import { useUIStore } from '@/stores/ui-store'

export function HeroBrand() {
  const { openAuth } = useUIStore()

  return (
    <div className="relative pt-16 pb-12 sm:pt-20 sm:pb-16">
      {/* 品牌区域 */}
      <div className="flex flex-col items-center text-center">
        {/* 大 icon */}
        <div
          className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden mb-6"
          style={{
            boxShadow: '0 0 30px rgba(255, 140, 212, 0.3), 0 0 60px rgba(255, 140, 212, 0.1)',
          }}
        >
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
            textShadow: '0 0 20px rgba(255, 140, 212, 0.2)',
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
          className="px-6 py-2.5 text-sm font-medium rounded-full transition-all duration-200 hover:shadow-neon"
          style={{
            background: 'linear-gradient(135deg, var(--brand), var(--brand-deep))',
            color: '#fff',
            boxShadow: '0 0 15px rgba(255, 140, 212, 0.2)',
          }}
        >
          开始使用
        </button>
      </div>

      {/* 装饰性渐变 */}
      <div
        className="absolute inset-0 -z-10"
        style={{
          background: 'radial-gradient(ellipse at center top, rgba(255, 140, 212, 0.08) 0%, transparent 60%)',
        }}
      />
    </div>
  )
}
