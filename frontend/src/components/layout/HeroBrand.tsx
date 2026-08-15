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

/** 随机打乱数组 */
function shuffleArray<T>(array: T[]): T[] {
  const shuffled = [...array]
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
  }
  return shuffled
}

export function HeroBrand() {
  const { openAuth, authOpen } = useUIStore()
  const { user } = useAuthStore()
  const { theme, toggleTheme } = useTheme()
  const [items, setItems] = useState<ContentItem[]>([])
  const [isPaused, setIsPaused] = useState(false)
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [scrollProgress, setScrollProgress] = useState(0)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const progressRef = useRef(0)
  const hasTriggeredRef = useRef(false)
  const cardWidth = 160
  const gap = 20
  const totalSteps = 10

  // 加载番剧内容并随机选取
  useEffect(() => {
    api.listContent({ type: 'anime' })
      .then(res => {
        const list = (res.items || []) as ContentItem[]
        const withCover = list.filter(i => i.cover_url)
        const shuffled = shuffleArray(withCover)
        const selected = shuffled.slice(0, Math.max(12, shuffled.length))
        setItems(selected)
      })
      .catch(() => {})
  }, [])

  // 监听鼠标滚轮事件（仅未登录时）
  useEffect(() => {
    if (user) return

    const handleWheel = (e: WheelEvent) => {
      // 如果登录框打开，不处理
      if (authOpen) return
      
      e.preventDefault()
      
      // 向下滚动增加进度
      if (e.deltaY > 0) {
        progressRef.current = Math.min(1, progressRef.current + (1 / totalSteps))
      } 
      // 向上滚动减少进度
      else if (e.deltaY < 0) {
        progressRef.current = Math.max(0, progressRef.current - (1 / totalSteps))
        // 向上滚动时重置触发标记
        if (progressRef.current < 0.8) {
          hasTriggeredRef.current = false
        }
      }
      
      setScrollProgress(progressRef.current)
      
      // 进度达到100%时显示登录提示（只触发一次）
      if (progressRef.current >= 1 && !hasTriggeredRef.current) {
        hasTriggeredRef.current = true
        openAuth()
      }
    }

    window.addEventListener('wheel', handleWheel, { passive: false })
    return () => window.removeEventListener('wheel', handleWheel)
  }, [user, openAuth, authOpen])

  // 登录框关闭时立即重置进度
  useEffect(() => {
    if (!authOpen && hasTriggeredRef.current) {
      progressRef.current = 0
      setScrollProgress(0)
      hasTriggeredRef.current = false
    }
  }, [authOpen])

  // 登录后重置进度
  useEffect(() => {
    if (user) {
      progressRef.current = 0
      setScrollProgress(0)
      hasTriggeredRef.current = false
    }
  }, [user])

  // 自动循环滚动 - 使用 CSS animation
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container || items.length === 0) return

    const singleSetWidth = items.length * (cardWidth + gap)
    const duration = singleSetWidth / 25
    container.style.animationDuration = `${duration}s`
  }, [items])

  // 生成足够的卡片用于无缝循环（4组）
  const minSets = 4
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

        {/* 滚动推荐卡片 */}
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
                const coverHeight = 210
                const infoMinHeight = 70
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

      {/* 底部进度条 — 仅未登录显示 */}
      {!user && (
        <div className="fixed bottom-6 left-0 right-0 flex flex-col items-center gap-2">
          {/* 进度条 */}
          <div className="w-48 h-1.5 rounded-full bg-gray-200 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300 ease-out"
              style={{
                width: `${scrollProgress * 100}%`,
                backgroundColor: '#FB71A7',
              }}
            />
          </div>
          
          {/* 提示文字 */}
          <span 
            className="text-xs transition-opacity duration-300"
            style={{ 
              color: 'var(--text-muted)',
              opacity: scrollProgress > 0 && scrollProgress < 1 ? 1 : 0.5,
            }}
          >
            {scrollProgress >= 1 
              ? '释放以查看更多 →' 
              : `向下滚动探索更多 (${Math.round(scrollProgress * 100)}%)`
            }
          </span>
        </div>
      )}

      {/* 已登录时显示向下箭头 */}
      {user && (
        <div className="fixed bottom-6 left-0 right-0 flex justify-center">
          <div
            className="animate-bounce cursor-pointer"
            style={{ color: 'var(--text-muted)' }}
            onClick={() => window.scrollTo({ top: window.innerHeight, behavior: 'smooth' })}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 5v14M19 12l-7 7-7-7" />
            </svg>
          </div>
        </div>
      )}
    </div>
  )
}
