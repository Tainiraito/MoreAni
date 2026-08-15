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
  const [scrollProgress, setScrollProgress] = useState(0)
  const [showLoginPrompt, setShowLoginPrompt] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  // 加载推荐内容（取前 8 个有封面的）
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

    let animFrame: number
    let scrollPos = 0
    const speed = 0.5 // 每帧滚动像素

    const animate = () => {
      scrollPos += speed
      const halfWidth = container.scrollWidth / 2
      
      // 无缝循环：滚动到一半时重置
      if (scrollPos >= halfWidth) {
        scrollPos = 0
      }
      
      container.scrollLeft = scrollPos
      animFrame = requestAnimationFrame(animate)
    }

    animFrame = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animFrame)
  }, [items])

  // 监听页面滚动
  useEffect(() => {
    const handleScroll = () => {
      if (user) return // 已登录不限制

      const scrollY = window.scrollY
      const maxScroll = window.innerHeight * 0.5
      
      const progress = Math.min(scrollY / maxScroll, 1)
      setScrollProgress(progress)

      // 滚动到 70% 时弹出登录框
      if (progress >= 0.7 && !showLoginPrompt) {
        setShowLoginPrompt(true)
        openAuth()
      }

      // 限制滚动
      if (scrollY > maxScroll) {
        window.scrollTo(0, maxScroll)
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [user, showLoginPrompt, openAuth])

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
      <div className="flex flex-col items-center text-center px-6 mb-8">
        {/* 大 icon */}
        <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden mb-6">
          <img src="/favicon.png" alt="MoreAni" className="w-full h-full object-cover" />
        </div>

        {/* 标题 */}
        <h1
          className="text-3xl sm:text-4xl font-bold tracking-tight mb-2"
          style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
        >
          又看一集
        </h1>

        {/* 副标题 */}
        <p className="text-sm sm:text-base mb-8" style={{ color: 'var(--text-muted)' }}>
          记录看过的番，看看朋友的评价
        </p>

        {/* 按钮区：登录注册 + 主题切换 */}
        {!user && (
          <div className="flex items-center gap-3">
            <button
              onClick={openAuth}
              className="px-6 py-2.5 text-sm font-semibold rounded-full transition-all duration-200 hover:opacity-90"
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

      {/* 滚动推荐卡片 — 水平铺满，自动循环 */}
      {items.length > 0 && (
        <div
          ref={scrollContainerRef}
          className="w-full overflow-hidden"
          style={{ scrollBehavior: 'auto' }}
        >
          <div className="flex gap-4 px-4" style={{ width: 'max-content' }}>
            {displayItems.map((item, index) => (
              <div
                key={`${item.id}-${index}`}
                className="flex-shrink-0 w-48 rounded-xl overflow-hidden"
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-line)',
                }}
              >
                <div className="aspect-[3/4]" style={{ background: 'var(--bg-card-warm)' }}>
                  <img
                    src={secureUrl(item.cover_url)}
                    alt={item.title}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="p-3">
                  <h3 className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                    {item.title}
                  </h3>
                  {item.avg_score && item.avg_score > 0 && (
                    <p className="text-xs mt-1" style={{ color: 'var(--brand)' }}>
                      ★ {(item.avg_score / 10).toFixed(1)}
                    </p>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 底部：滚动进度（未登录）/ 滚动提示（已登录） */}
      <div className="absolute bottom-8 left-1/2 -translate-x-1/2">
        {!user ? (
          <div
            className="w-12 h-12 rounded-full flex items-center justify-center"
            style={{
              background: 'var(--bg-card)',
              border: '2px solid var(--border-line)',
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" fill="none" stroke="var(--border-line)" strokeWidth="2" />
              <circle
                cx="12" cy="12" r="10"
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
