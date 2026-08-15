import { useState, useEffect, useRef } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { useTheme } from '@/hooks/use-theme'
import { Sun, Moon, Users } from 'lucide-react'
import { api } from '@/lib/api'
import type { ContentItem } from '@/types'

/** Force HTTPS for external image URLs */
function secureUrl(url: string): string {
  if (!url) return ''
  if (url.includes('lain.bgm.tv') || url.includes('bgm.tv') || url.includes('bangumi.tv')) {
    return `/api/v1/proxy/image?url=${encodeURIComponent(url)}`
  }
  return url.replace(/^http:\/\//, 'https://')
}

/** 带占位的图片组件 */
function CoverImage({ src, alt }: {
  src: string
  alt: string
}) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)

  const imageSrc = (!error && src) ? secureUrl(src) : '/placeholder.png'
  const showPlaceholder = !loaded || error

  return (
    <div className="relative w-full h-full" style={{ background: 'var(--bg-card-warm)' }}>
      {/* 占位图 */}
      {showPlaceholder && (
        <img
          src="/placeholder.png"
          alt={alt}
          className="absolute inset-0 w-full h-full object-cover"
        />
      )}
      {/* 真实图片 */}
      {src && !error && (
        <img
          src={imageSrc}
          alt={alt}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${
            loaded ? 'opacity-100' : 'opacity-0'
          }`}
          onLoad={() => setLoaded(true)}
          onError={() => setError(true)}
        />
      )}
    </div>
  )
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
  const lastPromptProgress = useRef(0)
  const isFirstLogin = useRef(!sessionStorage.getItem('moreani-scrolled'))
  const cardWidth = 160
  const gap = 20
  const coverHeight = 210
  const infoMinHeight = 70

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

  // 自动循环滚动 - 使用 CSS animation 实现无缝循环
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container || items.length === 0) return

    // 计算一组卡片的宽度
    const singleSetWidth = items.length * (cardWidth + gap)
    
    // 设置动画
    const duration = singleSetWidth / 25 // 25px/s
    container.style.animationDuration = `${duration}s`
  }, [items])

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

  // 登录后自动滚动出首屏（仅首次登录）
  useEffect(() => {
    if (user && isFirstLogin.current) {
      isFirstLogin.current = false
      sessionStorage.setItem('moreani-scrolled', '1')
      setTimeout(() => {
        // 滚动到内容区域，留出导航栏和间距
        const scrollTarget = window.innerHeight - 120
        window.scrollTo({ top: scrollTarget, behavior: 'smooth' })
      }, 500)
    }
  }, [user])

  // 生成足够的卡片用于无缝循环（至少覆盖 2 倍屏幕宽度）
  const minSets = 4 // 确保足够多
  const displayItems = Array(minSets).fill(items).flat()

  return (
    <div className="relative min-h-screen" style={{ background: 'var(--bg-page)' }}>
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
      <div className="flex flex-col items-center text-center px-6 pt-[18vh]">
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
        <div className="flex items-center gap-3 mb-12">
          {user ? (
            <button
              onClick={() => {
                const scrollTarget = window.innerHeight - 120
                window.scrollTo({ top: scrollTarget, behavior: 'smooth' })
              }}
              className="px-8 py-3 text-sm font-semibold rounded-full transition-all duration-200 hover:opacity-90"
              style={{
                background: 'var(--btn-primary-bg)',
                color: 'var(--btn-primary-text)',
              }}
            >
              让我康康！
            </button>
          ) : (
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

        {/* 滚动推荐卡片 — 使用 CSS animation 实现无缝循环 */}
        {items.length > 0 && (
          <div
            className="w-screen overflow-hidden"
            style={{ padding: '48px 0 80px' }}
            onMouseEnter={() => setIsPaused(true)}
            onMouseLeave={() => { setIsPaused(false); setHoveredIndex(null) }}
          >
            <div
              ref={scrollContainerRef}
              className="flex items-end animate-scroll-left"
              style={{
                gap: `${gap}px`,
                width: 'max-content',
                animationPlayState: isPaused ? 'paused' : 'running',
              }}
            >
              {displayItems.map((item, index) => {
                const isHovered = hoveredIndex === index
                return (
                  <div
                    key={index}
                    className="flex-shrink-0 cursor-pointer"
                    style={{
                      width: `${cardWidth}px`,
                      height: `${coverHeight + infoMinHeight}px`,
                      transform: isHovered ? 'scale(1.08)' : 'scale(1)',
                      zIndex: isHovered ? 20 : 1,
                      transformOrigin: 'center bottom',
                      transition: 'transform 0.3s ease',
                    }}
                    onMouseEnter={() => setHoveredIndex(index)}
                    onMouseLeave={() => setHoveredIndex(null)}
                  >
                    {/* 卡片容器 */}
                    <div
                      className="relative w-full h-full rounded-xl overflow-hidden"
                      style={{
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border-line)',
                        boxShadow: isHovered
                          ? '0 12px 40px rgba(0,0,0,0.2)'
                          : '0 2px 8px rgba(0,0,0,0.05)',
                        transition: 'box-shadow 0.3s ease',
                      }}
                    >
                      {/* 封面 */}
                      <div
                        className="w-full overflow-hidden"
                        style={{ height: `${coverHeight}px` }}
                      >
                        <CoverImage
                          src={item.cover_url}
                          alt={item.title}
                        />
                      </div>

                      {/* 信息区 */}
                      <div
                        className="absolute left-0 right-0 bottom-0 overflow-hidden"
                        style={{
                          background: 'var(--bg-card)',
                          borderTop: '1px solid var(--border-line)',
                          height: isHovered ? '180px' : `${infoMinHeight}px`,
                          transition: 'height 0.3s ease',
                        }}
                      >
                        <div className="p-3 text-center">
                          <h3 className="text-xs font-semibold truncate mb-1.5" style={{ color: 'var(--text-primary)' }}>
                            {item.title}
                          </h3>

                          <div className="flex items-center justify-center gap-3">
                            {item.avg_score && item.avg_score > 0 && (
                              <div className="flex items-center gap-1">
                                <span className="text-xs" style={{ color: 'var(--brand)' }}>★</span>
                                <span className="text-xs font-semibold" style={{ color: 'var(--brand)' }}>
                                  {(item.avg_score / 10).toFixed(1)}
                                </span>
                              </div>
                            )}
                            {(item.rating_count ?? 0) > 0 && (
                              <div className="flex items-center gap-1">
                                <Users size={10} style={{ color: 'var(--text-muted)' }} />
                                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                                  {item.rating_count}
                                </span>
                              </div>
                            )}
                          </div>

                          <div
                            className="overflow-hidden transition-all duration-300"
                            style={{
                              maxHeight: isHovered ? '100px' : '0px',
                              opacity: isHovered ? 1 : 0,
                              marginTop: isHovered ? '8px' : '0px',
                            }}
                          >
                            {item.episodes > 0 && (
                              <p className="text-xs mb-1" style={{ color: 'var(--text-muted)' }}>
                                {item.episodes}集
                              </p>
                            )}
                            {item.description && (
                              <p className="text-xs line-clamp-3 text-center" style={{ color: 'var(--text-secondary)' }}>
                                {item.description}
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* 底部进度条 */}
      <div className="fixed bottom-3 left-0 right-0 flex justify-center">
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
          className="fixed inset-0 flex items-center justify-center"
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
