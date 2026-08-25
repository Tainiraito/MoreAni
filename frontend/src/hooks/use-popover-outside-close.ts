import { useEffect, type RefObject } from 'react'

export function usePopoverOutsideClose(
  open: boolean,
  onClose: () => void,
  contentRef: RefObject<HTMLElement | null>,
): void {
  useEffect(() => {
    if (!open) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Node) || !contentRef.current?.contains(target)) {
        onClose()
      }
    }

    document.addEventListener('pointerdown', handlePointerDown, true)
    return () => document.removeEventListener('pointerdown', handlePointerDown, true)
  }, [contentRef, onClose, open])
}
