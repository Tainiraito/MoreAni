/** 强制外链使用 HTTPS，并将 Bangumi CDN 地址交给后端代理。 */
export function secureUrl(url: string): string {
  if (!url) return ''
  if (url.startsWith('/api/covers/')) return url
  if (url.includes('lain.bgm.tv') || url.includes('bgm.tv') || url.includes('bangumi.tv')) {
    return `/api/v1/proxy/image?url=${encodeURIComponent(url)}`
  }
  return url.replace(/^http:\/\//, 'https://')
}
