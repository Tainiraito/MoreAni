import { useEffect } from 'react'

/** 弹窗打开时锁定页面滚动（防滚动穿透：body + html 双锁） */
export function useLockBodyScroll(locked: boolean) {
  useEffect(() => {
    if (!locked) return
    const prevBody = document.body.style.overflow
    const prevHtml = document.documentElement.style.overflow
    // Chrome 中滚动发生在 html/viewport 上，只锁 body 会被 html 穿透，必须双锁
    document.body.style.overflow = 'hidden'
    document.documentElement.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevBody
      document.documentElement.style.overflow = prevHtml
    }
  }, [locked])
}
