import { useUIStore } from '@/stores/ui-store'

export function ContentDetailDialog() {
  const { detailOpen, detailContentId, closeDetail } = useUIStore()

  if (!detailOpen || !detailContentId) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={closeDetail}
      />

      {/* Panel */}
      <div className="relative z-10 w-full max-w-2xl max-h-[90vh] overflow-y-auto bg-white border-2 border-brand-dark">
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between border-b-2 border-brand-dark bg-white px-6 py-4">
          <h2 className="font-display text-lg font-bold">内容详情</h2>
          <button
            onClick={closeDetail}
            className="text-2xl leading-none hover:text-brand-pink"
          >
            ×
          </button>
        </div>

        {/* Body */}
        <div className="p-6">
          <p className="text-gray-500">Content ID: {detailContentId}</p>
          <p className="text-gray-500">TODO: 内容详情组件</p>
        </div>
      </div>
    </div>
  )
}
