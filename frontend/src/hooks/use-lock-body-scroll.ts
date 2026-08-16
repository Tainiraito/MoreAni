import { useEffect } from 'react'

/** 弹窗打开时锁定 body 滚动（防止滚动穿透到背景页面） */
export function useLockBodyScroll(locked: boolean) {
  useEffect(() => {
    if (!locked) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [locked])
}
