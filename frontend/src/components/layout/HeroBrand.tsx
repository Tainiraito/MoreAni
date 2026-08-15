import { useUIStore } from '@/stores/ui-store'

export function HeroBrand() {
  const { openAuth } = useUIStore()

  return (
    <div className="relative pt-16 pb-12 sm:pt-20 sm:pb-16">
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
            boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
          }}
        >
          开始使用
        </button>
      </div>
    </div>
  )
}
