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
  const [scrollProgress, setScrollProgress] = useState(0)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const animFrameRef = useRef<number>(0)
  const scrollPosRef = useRef(0)
  const lastPromptProgress = useRef(0)
  const cardWidth = 160
  const gap = 16

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

    let lastTime = performance.now()
    const speed = 25

    const animate = (currentTime: number) => {
      const delta = (currentTime - lastTime) / 1000
      lastTime = currentTime

      if (!isPaused) {
        scrollPosRef.current += speed * delta
        const singleSetWidth = items.length * (cardWidth + gap)
        if (scrollPosRef.current >= singleSetWidth) {
          scrollPosRef.current -= singleSetWidth
        }
        container.style.transform = `translateX(-${scrollPosRef.current}px)`
      }

      animFrameRef.current = requestAnimationFrame(animate)
    }

    animFrameRef.current = requestAnimationFrame(animate)
    return () => cancelAnimationFrame(animFrameRef.current)
  }, [items, isPaused])

  // 监听页面滚动
  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY
      const maxScroll = window.innerHeight
      const progress = Math.min(scrollY / maxScroll, 1)
      setScrollProgress(progress)

      if (!user) {
        if (scrollY > maxScroll) {
          window.scrollTo(0, maxScroll)
        }
        if (progress >= 1 && lastPromptProgress.current < 1) {
          lastPromptProgress.current = 1
          openAuth()
        }
        if (progress < 0.8) {
          lastPromptProgress.current = 0
        }
      }
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
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

  // 3组卡片用于无缝循环
  const displayItems = [...items, ...items, ...items]

  return (
    <div className="relative" style={{ height: '100vh', background: 'var(--bg-page)' }}>
      {/* 背景装饰 */}
      <div
        className="absolute inset-0 -z-10"
        style={{
          background: theme === 'dark'
            ? 'radial-gradient(ellipse at center top, rgba(251, 113, 167, 0.05) 0%, transparent 60%)'
            : 'radial-gradient(ellipse at center top, rgba(251, 113, 167, 0.03) 0%, transparent 60%)',
        }}
      />

      {/* 主内容区 */}
      <div
        className="absolute left-0 right-0 flex flex-col items-center text-center px-6"
        style={{ top: '18%' }}
      >
        {/* 大 icon */}
        <div className="w-28 h-28 sm:w-32 sm:h-32 rounded-2xl overflow-hidden mb-6">
          <img src="/favicon.png" alt="MoreAni" className="w-full h-full object-cover" />
        </div>

        {/* 标题 */}
        <h1
          className="text-4xl sm:text-5xl font-bold tracking-tight mb-2"
          style={{ color: 'var(--text-primary)', fontFamily: 'var(--font-display)' }}
        >
          又看一集
        </h1>

        {/* 副标题 */}
        <p className="text-base sm:text-lg mb-8" style={{ color: 'var(--text-muted)' }}>
          记录看过的番，看看朋友的评价
        </p>

        {/* 按钮区 */}
        <div className="flex items-center gap-3">
          {!user && (
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
          )}
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
      </div>

      {/* 滚动推荐卡片 */}
      {items.length > 0 && (
        <div
          className="absolute left-0 right-0"
          style={{ top: '58%', bottom: '48px', overflow: 'hidden', padding: '24px 0' }}
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => { setIsPaused(false); setHoveredIndex(null) }}
        >
          <div
            ref={scrollContainerRef}
            className="flex will-change-transform"
            style={{ gap: `${gap}px`, width: 'max-content' }}
          >
            {displayItems.map((item, index) => (
              <div
                key={index}
                className="flex-shrink-0 transition-all duration-300 cursor-pointer"
                style={{
                  background: 'var(--bg-card)',
                  border: '1px solid var(--border-line)',
                  borderRadius: '12px',
                  width: `${cardWidth}px`,
                  transform: hoveredIndex === index ? 'scale(1.08)' : 'scale(1)',
                  boxShadow: hoveredIndex === index
                    ? '0 12px 40px rgba(0,0,0,0.2)'
                    : 'none',
                  zIndex: hoveredIndex === index ? 10 : 1,
                  transformOrigin: 'center center',
                  overflow: 'hidden',
                }}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => setHoveredIndex(null)}
              >
                {/* 封面 */}
                <div
                  className="w-full"
                  style={{ 
                    background: 'var(--bg-card-warm)',
                    aspectRatio: '3/4',
                    borderRadius: '12px 12px 0 0',
                    overflow: 'hidden',
                  }}
                >
                  <img
                    src={secureUrl(item.cover_url)}
                    alt={item.title}
                    className="w-full h-full object-cover"
                  />
                </div>

                {/* 信息 */}
                <div className="p-2.5">
                  <h3 className="text-xs font-semibold truncate mb-1" style={{ color: 'var(--text-primary)' }}>
                    {item.title}
                  </h3>
                  <div className="flex items-center gap-1.5">
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

      {/* 底部进度条 */}
      <div className="absolute bottom-3 left-0 right-0 flex justify-center">
        {!user ? (
          <div className="flex flex-col items-center gap-1">
            <div
              className="w-48 h-1 rounded-full overflow-hidden"
              style={{ background: 'var(--border-line)' }}
            >
              <div
                className="h-full rounded-full transition-all duration-150"
                style={{
                  width: `${scrollProgress * 100}%`,
                  background: 'var(--brand)',
                }}
              />
            </div>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              登录后查看更多
            </span>
          </div>
        ) : (
          <div
            className="animate-bounce cursor-pointer"
            style={{ color: 'var(--text-muted)' }}
            onClick={() => window.scrollTo({ top: window.innerHeight, behavior: 'smooth' })}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M19 12l-7 7-7-7" />
            </svg>
          </div>
        )}
      </div>

      {/* 进度条满时的遮罩 */}
      {!user && scrollProgress >= 0.95 && (
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            background: 'rgba(0,0,0,0.3)',
            animation: 'fade-in 300ms ease-out',
          }}
          onClick={openAuth}
        >
          <div
            className="px-8 py-4 rounded-xl text-center"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-line)',
            }}
          >
            <p className="text-sm mb-3" style={{ color: 'var(--text-primary)' }}>
              登录后解锁完整内容
            </p>
            <button
              onClick={(e) => { e.stopPropagation(); openAuth() }}
              className="px-6 py-2 text-sm font-semibold rounded-full"
              style={{
                background: 'var(--btn-primary-bg)',
                color: 'var(--btn-primary-text)',
              }}
            >
              登录 / 注册
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
