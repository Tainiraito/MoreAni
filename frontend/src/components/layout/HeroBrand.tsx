import { useState, useEffect, useRef } from 'react'
import { useUIStore } from '@/stores/ui-store'
import { useAuthStore } from '@/stores/auth-store'
import { useTheme } from '@/hooks/use-theme'
import { Sun, Moon } from 'lucide-react'
import { api } from '@/lib/api'
import { AnimeCard } from '@/components/content/AnimeCard'
import type { ContentItem } from '@/types'

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
  const { openAuth, authOpen, detailOpen } = useUIStore()
  const { user } = useAuthStore()
  const { theme, toggleTheme } = useTheme()
  const { openDetail } = useUIStore()
  const [items, setItems] = useState<ContentItem[]>([])
  const [isPaused, setIsPaused] = useState(false)
  const [scrollProgress, setScrollProgress] = useState(0)
  const [isOnHero, setIsOnHero] = useState(true) // 是否在首屏
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const progressRef = useRef(0)
  const hasTriggeredRef = useRef(false)
  const cardWidth = 160
  const gap = 20

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

  // 监听页面滚动（通用，用于判断是否在首屏）
  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY
      setIsOnHero(scrollY < window.innerHeight * 0.8)
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // 监听鼠标滚轮事件（仅未登录时）
  useEffect(() => {
    if (user) return

    const handleWheel = (e: WheelEvent) => {
      // 如果登录框或详情弹窗打开，不处理
      if (authOpen || detailOpen) return
      
      e.preventDefault()
      
      if (e.deltaY > 0) {
        progressRef.current = Math.min(1, progressRef.current + (1 / 10))
      } else if (e.deltaY < 0) {
        progressRef.current = Math.max(0, progressRef.current - (1 / 10))
        if (progressRef.current < 0.8) {
          hasTriggeredRef.current = false
        }
      }
      
      setScrollProgress(progressRef.current)
      
      if (progressRef.current >= 1 && !hasTriggeredRef.current) {
        hasTriggeredRef.current = true
        openAuth()
      }
    }

    window.addEventListener('wheel', handleWheel, { passive: false })
    return () => window.removeEventListener('wheel', handleWheel)
  }, [user, openAuth, authOpen, detailOpen])

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

  // 自动循环滚动
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container || items.length === 0) return

    const singleSetWidth = items.length * (cardWidth + gap)
    const duration = singleSetWidth / 25
    container.style.animationDuration = `${duration}s`
  }, [items])

  // 生成足够的卡片用于无缝循环（4组）
  const displayItems = Array(4).fill(items).flat()

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
            onMouseLeave={() => setIsPaused(false)}
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
              {displayItems.map((item, index) => (
                <AnimeCard
                  key={index}
                  content={item}
                  mode="scroll"
                  onSelect={openDetail}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 底部进度条 — 仅未登录显示 */}
      {!user && (
        <div className="fixed bottom-6 left-0 right-0 flex flex-col items-center gap-2">
          <div className="w-48 h-1.5 rounded-full bg-gray-200 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300 ease-out"
              style={{
                width: `${scrollProgress * 100}%`,
                backgroundColor: '#FB71A7',
              }}
            />
          </div>
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

      {/* 已登录时显示向下箭头 — 仅在首屏显示 */}
      {user && isOnHero && (
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
