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
  const [items, setItems] = useState<ContentItem[]>([])
  const [isPaused, setIsPaused] = useState(false)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const animFrameRef = useRef<number>(0)
  const scrollPosRef = useRef(0)
  const lastLoginPromptRef = useRef(0) // 上次提示时的滚动进度

  // 加载推荐内容
  useEffect(() => {
    api.listContent({ sort: 'rating', limit: '20' })
      .then(res => {
        const list = (res.items || []) as ContentItem[]
        const withCover = list.filter(i => i.cover_url).slice(0, 8)
        setItems(withCover)
      })
      .catch(() => {})
  }, [])

  // 自动循环滚动
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container || items.length === 0) return

    const speed = 0.3 // 每帧滚动像素（调慢）

    const animate = () => {
      if (!isPaused) {
        scrollPosRef.current += speed
        const halfWidth = container.scrollWidth / 2

        if (scrollPosRef.current >= halfWidth) {
          scrollPosRef.current = 0
        }

        container.scrollLeft = scrollPosRef.current
      }
      animFrameRef.current = requestAnimationFrame(animate)
    }

    animFrameRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animFrameRef.current)
  }, [items, isPaused])

  // 监听页面滚动（未登录限制）
  useEffect(() => {
    if (user) return

    const handleScroll = () => {
      const scrollY = window.scrollY
      const maxScroll = window.innerHeight * 0.35 // 只允许滚动 35%

      // 限制滚动
      if (scrollY > maxScroll) {
        window.scrollTo(0, maxScroll)
      }

      // 计算进度
      const progress = Math.min(scrollY / maxScroll, 1)

      // 滚动满时弹出登录框（每次满都提示，不只是第一次）
      if (progress >= 1 && lastLoginPromptRef.current < 1) {
        lastLoginPromptRef.current = 1
        openAuth()
      }

      // 滚回时重置标记
      if (progress < 0.5) {
        lastLoginPromptRef.current = 0
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: false })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [user, openAuth])

  // 登录后自动滚动出首屏
  useEffect(() => {
    if (user) {
      setTimeout(() => {
        window.scrollTo({ top: window.innerHeight, behavior: 'smooth' })
      }, 500)
    }
  }, [user])

  // 双倍卡片用于无缝循环
  const displayItems = [...items, ...items]

  return (
    <div className="relative h-screen flex flex-col items-center justify-center overflow-hidden">
      {/* 背景装饰 */}
      <div
        className="absolute inset-0 -z-10"
        style={{
          background: theme === 'dark'
            ? 'radial-gradient(ellipse at center, rgba(251, 113, 167, 0.05) 0%, transparent 70%)'
            : 'radial-gradient(ellipse at center, rgba(251, 113, 167, 0.03) 0%, transparent 70%)',
        }}
      />

      {/* 主内容区 */}
      <div className="flex flex-col items-center text-center px-6 mb-12">
        {/* 大 icon */}
        <div className="w-28 h-28 sm:w-32 sm:h-32 rounded-2xl overflow-hidden mb-8">
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

        {/* 按钮区 */}
        {!user && (
          <div className="flex items-center gap-3">
            <button
              onClick={openAuth}
              className="px-8 py-3 text-sm font-semibold rounded-full transition-all duration-200 hover:opacity-90"
              style={{
                background: 'var(--btn-primary-bg)',
                color: 'var(--btn-primary-text)',
              }}
            >
              登录 / 注册
            </button>
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
        )}
      </div>

      {/* 滚动推荐卡片 — 撑满窗口，横向卡片 */}
      {items.length > 0 && (
        <div
          ref={scrollContainerRef}
          className="absolute bottom-16 left-0 right-0 overflow-hidden"
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => { setIsPaused(false); setHoveredIndex(null) }}
          style={{ scrollBehavior: 'auto' }}
        >
          <div className="flex gap-4 px-4" style={{ width: 'max-content' }}>
            {displayItems.map((item, index) => (
              <div
                key={`${item.id}-${index}`}
                className="flex-shrink-0 flex rounded-xl overflow-hidden transition-all duration-300 cursor-pointer"
                style={{
                  background: 'var(--bg-card)',
                  border: hoveredIndex === index
                    ? '2px solid var(--brand)'
                    : '1px solid var(--border-line)',
                  width: hoveredIndex === index ? '280px' : '260px',
                  boxShadow: hoveredIndex === index
                    ? '0 4px 20px rgba(251, 113, 167, 0.15)'
                    : 'none',
                }}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                {/* 封面 */}
                <div className="w-20 h-28 flex-shrink-0" style={{ background: 'var(--bg-card-warm)' }}>
                  <img
                    src={secureUrl(item.cover_url)}
                    alt={item.title}
                    className="w-full h-full object-cover"
                  />
                </div>

                {/* 信息 */}
                <div className="flex-1 p-3 flex flex-col justify-center min-w-0">
                  <h3 className="text-sm font-semibold truncate mb-1" style={{ color: 'var(--text-primary)' }}>
                    {item.title}
                  </h3>
                  {item.title_alt && (
                    <p className="text-xs truncate mb-2" style={{ color: 'var(--text-muted)' }}>
                      {item.title_alt}
                    </p>
                  )}
                  <div className="flex items-center gap-2">
                    {item.avg_score && item.avg_score > 0 && (
                      <span className="text-xs font-medium" style={{ color: 'var(--brand)' }}>
                        ★ {(item.avg_score / 10).toFixed(1)}
                      </span>
                    )}
                    {item.episodes > 0 && (
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {item.episodes}集
                      </span>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 底部：滚动进度 / 滚动提示 */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2">
        {!user ? (
          <div className="flex flex-col items-center gap-2">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center"
              style={{
                background: 'var(--bg-card)',
                border: '2px solid var(--border-line)',
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="10" fill="none" stroke="var(--border-line)" strokeWidth="2" />
                <circle
                  cx="12" cy="12" r="10"
                  fill="none"
                  stroke="var(--brand)"
                  strokeWidth="2"
                  strokeDasharray="0 63"
                  strokeLinecap="round"
                  transform="rotate(-90 12 12)"
                />
              </svg>
            </div>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              登录后查看更多
            </span>
          </div>
        ) : (
          <div className="animate-bounce" style={{ color: 'var(--text-muted)' }}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M19 12l-7 7-7-7" />
            </svg>
          </div>
        )}
      </div>
    </div>
  )
}
