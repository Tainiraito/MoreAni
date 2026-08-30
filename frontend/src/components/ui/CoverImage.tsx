import { useState, useEffect, useCallback, useRef } from 'react'
import { secureUrl } from '@/lib/image-url'

const MAX_RETRIES = 1
const RETRY_DELAY_MS = 800
const loadedCoverSources = new Set<string>()

interface CoverImageProps {
  src: string
  alt: string
  className?: string
  imgClassName?: string
  loading?: 'lazy' | 'eager'
  fetchPriority?: 'high' | 'low' | 'auto'
}

/** 带重试的封面图片组件 */
export function CoverImage({
  src,
  alt,
  className = '',
  imgClassName = '',
  loading = 'lazy',
  fetchPriority,
}: CoverImageProps) {
  const proxiedSrc = src ? secureUrl(src) : ''
  const [loaded, setLoaded] = useState(() => proxiedSrc !== '' && loadedCoverSources.has(proxiedSrc))
  const [error, setError] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const [currentSrc, setCurrentSrc] = useState(proxiedSrc)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Reset state when src changes
  useEffect(() => {
    if (retryTimerRef.current !== null) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }
    setLoaded(proxiedSrc !== '' && loadedCoverSources.has(proxiedSrc))
    setError(false)
    setRetryCount(0)
    setCurrentSrc(proxiedSrc)
    return () => {
      if (retryTimerRef.current !== null) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
    }
  }, [proxiedSrc])

  const handleError = useCallback(() => {
    if (retryCount < MAX_RETRIES) {
      const nextRetry = retryCount + 1
      setRetryCount(nextRetry)
      retryTimerRef.current = setTimeout(() => {
        retryTimerRef.current = null
        // Append cache-buster to force re-fetch
        const separator = proxiedSrc.includes('?') ? '&' : '?'
        setCurrentSrc(`${proxiedSrc}${separator}_retry=${nextRetry}`)
      }, RETRY_DELAY_MS * (2 ** retryCount))
    } else {
      setError(true)
    }
  }, [retryCount, proxiedSrc])

  const handleLoad = useCallback(() => {
    if (proxiedSrc) loadedCoverSources.add(proxiedSrc)
    setLoaded(true)
    setError(false)
  }, [proxiedSrc])

  return (
    <div className={`relative w-full h-full ${className}`} style={{ background: 'var(--bg-card-warm)' }}>
      {/* Placeholder — always present behind the real image */}
      <img
        src="/placeholder.png"
        alt=""
        aria-hidden="true"
        draggable={false}
        className="absolute inset-0 w-full h-full object-cover"
      />
      {/* Real image — fades in on load */}
      {currentSrc && !error && (
        <img
          key={currentSrc} // force remount on retry
          src={currentSrc}
          alt={alt}
          draggable={false}
          loading={loading}
          decoding="async"
          fetchPriority={fetchPriority}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'} ${imgClassName}`}
          onLoad={handleLoad}
          onError={handleError}
        />
      )}
    </div>
  )
}
