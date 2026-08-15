import { useState, useEffect, useRef } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { useTheme } from '@/hooks/use-theme'
import { Sun, Moon } from 'lucide-react'
import { api } from '@/lib/api'
import type { ContentItem } from '@/types'

/** Force HTTPS for external image URLs */
function secureUrl(url: string): string {
  if (!url) return url
  if (url.includes('lain.bgm.tv') || url.includes('bgm.tv') || url.includes('bangumi.tv')) {
    return `/api/v1/proxy/image?url=${encodeURIComponent(url)}`
  }
  return url.replace(/^http:\/\//, 'https://')
}

export function HeroBrand() {
  const { openAuth } = useUIStore()
  const { user } = useAuthStore()
  const { theme, toggleTheme } = useTheme()
  const [hero, setHero] = useState<ContentItem | null>(null)
  const [scrollProgress, setScrollProgress] = useState(0)
  const [showLoginPrompt, setShowLoginPrompt] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  // 加载推荐内容
  useEffect(() => {
    api.listContent({ sort: 'rating', limit: '1' })
      .then(res => {
        const list = (res.items || []) as ContentItem[]
        if (list.length > 0) setHero(list[0])
      })
      .catch(() => {})
  }, [])

  // 监听滚动
  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY
      const windowHeight = window.innerHeight
      const maxScroll = windowHeight * 0.6 // 60% 屏幕高度为最大滚动
      
      const progress = Math.min(scrollY / maxScroll, 1)
      setScrollProgress(progress)

      // 未登录用户：滚动到 80% 时弹出登录框
      if (!user && progress >= 0.8 && !showLoginPrompt) {
        setShowLoginPrompt(true)
        openAuth()
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [user, showLoginPrompt, openAuth])

  // 未登录时阻止滚动超过首屏
  useEffect(() => {
    if (user) return // 已登录不限制

    const preventOverscroll = () => {
      const maxScroll = window.innerHeight * 0.7
      if (window.scrollY > maxScroll) {
        window.scrollTo(0, maxScroll)
      }
    }

    window.addEventListener('scroll', preventOverscroll, { passive: true })
    return () => window.removeEventListener('scroll', preventOverscroll)
  }, [user])

  return (
    <div ref={containerRef} className="relative min-h-screen flex flex-col items-center justify-center px-6">
      {/* 背景装饰 */}
      <div
        className="absolute inset-0 -z-10"
        style={{
          background: theme === 'dark'
            ? 'radial-gradient(ellipse at center, rgba(251, 113, 167, 0.05) 0%, transparent 70%)'
            : 'radial-gradient(ellipse at center, rgba(251, 113, 167, 0.03) 0%, transparent 70%)',
        }}
      />

      {/* 右上角主题切换 */}
      <div className="absolute top-6 right-6">
        <button
          onClick={toggleTheme}
          className="w-10 h-10 rounded-full flex items-center justify-center transition-all duration-200 hover:opacity-80"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-line)',
            color: 'var(--text-muted)',
          }}
          title={theme === 'light' ? '切换到深色模式' : '切换到浅色模式'}
        >
          {theme === 'light' ? <Moon size={18} /> : <Sun size={18} />}
        </button>
      </div>

      {/* 主内容区 — 视差效果 */}
      <div
        className="flex flex-col items-center text-center transition-transform duration-300 ease-out"
        style={{
          transform: `translateY(${scrollProgress * -30}px)`,
          opacity: 1 - scrollProgress * 0.3,
        }}
      >
        {/* 大 icon */}
        <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-2xl overflow-hidden mb-8">
          <img src="/favicon.png" alt="MoreAni" className="w-full h-full object-cover" />
        </div>

        {/* 标题 */}
        <h1
          className="text-4xl sm:text-5xl font-bold tracking-tight mb-3"
          style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
        >
          又看一集
        </h1>

        {/* 副标题 */}
        <p className="text-base sm:text-lg mb-10" style={{ color: 'var(--text-muted)' }}>
          记录看过的番，看看朋友的评价
        </p>

        {/* 推荐卡片 — 视差效果 */}
        {hero && (
          <div
            className="w-full max-w-md rounded-xl overflow-hidden transition-transform duration-500 ease-out"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-line)',
              transform: `translateY(${scrollProgress * 20}px) scale(${1 - scrollProgress * 0.05})`,
            }}
          >
            <div className="flex">
              {/* 封面 */}
              <div className="w-1/3 aspect-[3/4]" style={{ background: 'var(--bg-card-warm)' }}>
                {hero.cover_url ? (
                  <img
                    src={secureUrl(hero.cover_url)}
                    alt={hero.title}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-4xl opacity-30">📺</div>
                )}
              </div>
              
              {/* 信息 */}
              <div className="w-2/3 p-5 flex flex-col justify-center">
                <span
                  className="inline-block w-fit px-2.5 py-0.5 text-xs font-medium rounded-md mb-3"
                  style={{
                    background: 'rgba(251, 113, 167, 0.1)',
                    color: 'var(--brand)',
                  }}
                >
                  热门推荐
                </span>
                <h3 className="text-lg font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
                  {hero.title}
                </h3>
                {hero.title_alt && (
                  <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>{hero.title_alt}</p>
                )}
                {hero.avg_score && hero.avg_score > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold" style={{ color: 'var(--brand)' }}>
                      ★ {(hero.avg_score / 10).toFixed(1)}
                    </span>
                    <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                      {hero.rating_count || 0} 人评分
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* 登录按钮（未登录时显示） */}
        {!user && (
          <button
            onClick={openAuth}
            className="mt-10 px-8 py-3 text-sm font-semibold rounded-full transition-all duration-200 hover:opacity-90"
            style={{
              background: 'var(--btn-primary-bg)',
              color: 'var(--btn-primary-text)',
            }}
          >
            登录 / 注册
          </button>
        )}
      </div>

      {/* 滚动进度指示器（未登录时显示） */}
      {!user && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center"
            style={{
              background: 'var(--bg-card)',
              border: '2px solid var(--border-line)',
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24">
              <circle
                cx="12"
                cy="12"
                r="10"
                fill="none"
                stroke="var(--border-line)"
                strokeWidth="2"
              />
              <circle
                cx="12"
                cy="12"
                r="10"
                fill="none"
                stroke="var(--brand)"
                strokeWidth="2"
                strokeDasharray={`${scrollProgress * 63} 63`}
                strokeLinecap="round"
                transform="rotate(-90 12 12)"
                className="transition-all duration-300"
              />
            </svg>
          </div>
        </div>
      )}

      {/* 向下滚动提示（已登录时显示） */}
      {user && (
        <div
          className="absolute bottom-8 left-1/2 -translate-x-1/2 animate-bounce"
          style={{ color: 'var(--text-muted)' }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M19 12l-7 7-7-7" />
          </svg>
        </div>
      )}
    </div>
  )
}
