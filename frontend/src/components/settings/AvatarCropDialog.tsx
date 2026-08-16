import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useMaskClose } from '@/hooks/use-mask-close'

const VIEW_SIZE = 320 // 裁切框/预览容器（正方形）

interface AvatarCropDialogProps {
  file: File
  onConfirm: (processed: File) => void
  onCancel: () => void
}

/**
 * 头像手动裁切弹窗：1:1 裁切框固定居中，图片可拖拽 + 滑杆缩放。
 * 确认后按裁切区域生成 256×256 JPEG。
 */
export function AvatarCropDialog({ file, onConfirm, onCancel }: AvatarCropDialogProps) {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  const [scale, setScale] = useState(1) // 相对初始 fit 的缩放倍数（1-4）
  const [offset, setOffset] = useState({ x: 0, y: 0 }) // 图片左上角相对容器的偏移
  const dragRef = useRef<{ startX: number; startY: number; offX: number; offY: number } | null>(null)
  // 遮罩点击 = 取消裁切；stopPropagation 防止冒泡关闭下层设置弹窗；选中文字拖出不误关
  const maskProps = useMaskClose(onCancel, { stopPropagation: true })
  // onCancel 经 ref 引用：避免父组件重渲染传入新函数导致 effect 反复执行（revoke URL 打断图片加载）
  const onCancelRef = useRef(onCancel)
  onCancelRef.current = onCancel

  // 加载图片 —— 依赖只含 file；cancelled 标志隔离 StrictMode 双执行时旧 img 的 onerror
  // （开发模式 effect 跑两遍：第一次的 blob URL 被 cleanup revoke → 旧 img 加载失败触发
  //   onerror → 若直接 onCancel 会把弹窗关掉，表现为「闪一下消失」）
  useEffect(() => {
    let cancelled = false
    const el = new Image()
    el.onload = () => {
      if (!cancelled) setImg(el)
    }
    el.onerror = () => {
      if (!cancelled) onCancelRef.current()
    }
    el.src = URL.createObjectURL(file)
    return () => {
      cancelled = true
      URL.revokeObjectURL(el.src)
    }
  }, [file])

  const baseScale = img ? VIEW_SIZE / Math.min(img.naturalWidth, img.naturalHeight) : 1
  const dw = img ? img.naturalWidth * baseScale * scale : VIEW_SIZE
  const dh = img ? img.naturalHeight * baseScale * scale : VIEW_SIZE

  const clampOffset = (x: number, y: number) => ({
    x: Math.min(0, Math.max(Math.min(0, VIEW_SIZE - dw), x)),
    y: Math.min(0, Math.max(Math.min(0, VIEW_SIZE - dh), y)),
  })

  const onPointerDown = (e: React.PointerEvent) => {
    dragRef.current = { startX: e.clientX, startY: e.clientY, offX: offset.x, offY: offset.y }
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return
    const dx = dragRef.current.offX + (e.clientX - dragRef.current.startX)
    const dy = dragRef.current.offY + (e.clientY - dragRef.current.startY)
    setOffset(clampOffset(dx, dy))
  }
  const onPointerUp = () => {
    dragRef.current = null
  }

  // 滑杆缩放（保持中心点不动）
  const handleZoom = (nextScale: number) => {
    setScale(prev => {
      const ns = Math.min(4, Math.max(1, nextScale))
      if (ns === prev || !img) return prev
      const cx = VIEW_SIZE / 2 - offset.x
      const cy = VIEW_SIZE / 2 - offset.y
      const base = VIEW_SIZE / Math.min(img.naturalWidth, img.naturalHeight)
      const oldW = img.naturalWidth * base * prev
      const newW = img.naturalWidth * base * ns
      const ratio = newW / oldW
      setOffset(clampOffset(VIEW_SIZE / 2 - cx * ratio, VIEW_SIZE / 2 - cy * ratio))
      return ns
    })
  }

  const confirm = () => {
    if (!img) return
    const canvas = document.createElement('canvas')
    canvas.width = 256
    canvas.height = 256
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.imageSmoothingQuality = 'high'
    // 显示坐标 → 原图坐标（裁切区域 = 容器可视方框）
    const px = baseScale * scale
    const sx = (0 - offset.x) / px
    const sy = (0 - offset.y) / px
    const cropSize = VIEW_SIZE / px
    ctx.drawImage(img, sx, sy, cropSize, cropSize, 0, 0, 256, 256)
    canvas.toBlob(blob => {
      if (blob) onConfirm(new File([blob], 'avatar.jpg', { type: 'image/jpeg' }))
    }, 'image/jpeg', 0.9)
  }

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-[2px]"
      {...maskProps}
    >
      <div
        className="rounded-2xl p-6 w-[400px]"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-line)' }}
        onClick={e => e.stopPropagation()}
      >
        <h3 className="text-base font-bold mb-1" style={{ color: 'var(--text-primary)' }}>裁剪头像</h3>
        <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
          拖动图片调整位置，滑杆缩放；裁切区域为 1:1 正方形
        </p>

        {/* 裁切预览区 */}
        <div
          className="relative w-[320px] h-[320px] mx-auto rounded-xl overflow-hidden cursor-move touch-none select-none"
          style={{ background: '#111' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
        >
          {img && (
            <img
              src={img.src}
              alt="头像预览"
              draggable={false}
              style={{
                position: 'absolute',
                left: offset.x,
                top: offset.y,
                width: dw,
                height: dh,
                maxWidth: 'none',
                userSelect: 'none',
              }}
            />
          )}
          {/* 裁切框边框（品牌色） */}
          <div
            className="absolute inset-0 pointer-events-none rounded-xl"
            style={{ boxShadow: 'inset 0 0 0 2px var(--brand)' }}
          />
          {/* 三分线网格 */}
          <div className="absolute inset-0 pointer-events-none opacity-40">
            <div className="absolute left-1/3 top-0 bottom-0 w-px bg-white/40" />
            <div className="absolute left-2/3 top-0 bottom-0 w-px bg-white/40" />
            <div className="absolute top-1/3 left-0 right-0 h-px bg-white/40" />
            <div className="absolute top-2/3 left-0 right-0 h-px bg-white/40" />
          </div>
        </div>

        {/* 缩放滑杆 */}
        <div className="flex items-center gap-3 mt-4 px-1">
          <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>缩小</span>
          <input
            type="range"
            min={1}
            max={4}
            step={0.05}
            value={scale}
            className="flex-1 accent-[#FB71A7]"
            onChange={e => handleZoom(Number(e.target.value))}
          />
          <span className="text-xs shrink-0" style={{ color: 'var(--text-muted)' }}>放大</span>
        </div>

        <div className="flex gap-2 mt-5">
          <Button variant="outline" className="flex-1" onClick={onCancel}>
            取消
          </Button>
          <Button className="flex-1" onClick={confirm} disabled={!img}>
            确认
          </Button>
        </div>
      </div>
    </div>
  )
}
