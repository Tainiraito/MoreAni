import { useRef } from 'react'

/**
 * 弹窗遮罩「点击关闭」优化：
 * 防止「在弹窗内选中文字 → 拖到遮罩上松开」误触发关闭（mousedown 在内容、mouseup 在遮罩）。
 * 只有 mousedown 与 mouseup 都发生在遮罩自身（e.target === currentTarget）才关闭。
 */
export function useMaskClose(onClose: () => void, opts?: { stopPropagation?: boolean }) {
  const downOnMaskRef = useRef(false)

  const maskProps = {
    onMouseDown: (e: React.MouseEvent) => {
      downOnMaskRef.current = e.target === e.currentTarget
    },
    onClick: (e: React.MouseEvent) => {
      if (opts?.stopPropagation) e.stopPropagation()
      if (downOnMaskRef.current && e.target === e.currentTarget) {
        onClose()
      }
    },
  }

  return maskProps
}
