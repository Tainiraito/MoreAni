import { useUIStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'

export function HeroBrand() {
  const { openAuth } = useUIStore()
  const { user } = useAuthStore()

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

        {/* 登录后：个人名片卡片 / 未登录：登录注册按钮 */}
        {user ? (
          <div
            className="px-6 py-4 rounded-xl"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-line)',
            }}
          >
            <div className="flex items-center gap-4">
              <div
                className="w-12 h-12 rounded-full flex items-center justify-center text-lg font-semibold text-white flex-shrink-0"
                style={{ background: 'linear-gradient(135deg, var(--brand), var(--brand-deep))' }}
              >
                {user.username.charAt(0).toUpperCase()}
              </div>
              <div className="text-left">
                <p className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {user.username}
                </p>
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {user.role === 'admin' ? '管理员' : '成员'}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <button
            onClick={openAuth}
            className="px-6 py-2.5 text-sm font-medium rounded-full transition-all duration-200"
            style={{
              background: 'linear-gradient(135deg, var(--brand), var(--brand-deep))',
              color: '#fff',
              boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
            }}
          >
            登录 / 注册
          </button>
        )}
      </div>
    </div>
  )
}
