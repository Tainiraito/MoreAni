import { useState, useEffect, useCallback } from 'react'

/** Force HTTPS for external image URLs, proxy Bangumi CDN */
export function secureUrl(url: string): string {
  if (!url) return ''
  // 本地化封面（/api/covers/...）直接使用，不走代理
  if (url.startsWith('/api/covers/')) return url
  if (url.includes('lain.bgm.tv') || url.includes('bgm.tv') || url.includes('bangumi.tv')) {
    return `/api/v1/proxy/image?url=${encodeURIComponent(url)}`
  }
  return url.replace(/^http:\/\//, 'https://')
}

const MAX_RETRIES = 2
const RETRY_DELAY = 1500 // ms

interface CoverImageProps {
  src: string
  alt: string
  className?: string
  imgClassName?: string
}

/** 带重试的封面图片组件 */
export function CoverImage({ src, alt, className = '', imgClassName = '' }: CoverImageProps) {
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState(false)
  const [retryCount, setRetryCount] = useState(0)
  const [currentSrc, setCurrentSrc] = useState('')

  // Compute the proxied URL
  const proxiedSrc = (!error && src) ? secureUrl(src) : ''

  // Reset state when src changes
  useEffect(() => {
    setLoaded(false)
    setError(false)
    setRetryCount(0)
    setCurrentSrc(proxiedSrc)
  }, [src])

  const handleError = useCallback(() => {
    if (retryCount < MAX_RETRIES) {
      // Retry after delay — CDN 502 is transient
      const nextRetry = retryCount + 1
      setRetryCount(nextRetry)
      setTimeout(() => {
        // Append cache-buster to force re-fetch
        const separator = proxiedSrc.includes('?') ? '&' : '?'
        setCurrentSrc(`${proxiedSrc}${separator}_retry=${nextRetry}`)
      }, RETRY_DELAY * nextRetry)
    } else {
      setError(true)
    }
  }, [retryCount, proxiedSrc])

  const handleLoad = useCallback(() => {
    setLoaded(true)
    setError(false)
  }, [])

  return (
    <div className={`relative w-full h-full ${className}`} style={{ background: 'var(--bg-card-warm)' }}>
      {/* Placeholder — always present behind the real image */}
      <img
        src="/placeholder.png"
        alt={alt}
        className="absolute inset-0 w-full h-full object-cover"
      />
      {/* Real image — fades in on load */}
      {currentSrc && !error && (
        <img
          key={currentSrc} // force remount on retry
          src={currentSrc}
          alt={alt}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-300 ${loaded ? 'opacity-100' : 'opacity-0'} ${imgClassName}`}
          onLoad={handleLoad}
          onError={handleError}
        />
      )}
    </div>
  )
}
