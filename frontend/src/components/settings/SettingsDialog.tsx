import { useUIStore } from '@/stores/ui-store'

export function SettingsDialog() {
  const { settingsOpen, closeSettings } = useUIStore()

  if (!settingsOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
         onClick={closeSettings}>
      <div className="bg-white rounded-2xl w-[480px] max-w-[90vw] p-8 shadow-[0_8px_40px_rgba(0,0,0,0.12)]"
           onClick={e => e.stopPropagation()}
           style={{ animation: 'scale-in 200ms ease-out' }}>
        <div className="flex items-center justify-between mb-7">
          <h2 className="text-lg font-semibold text-ink">设置</h2>
          <button
            onClick={closeSettings}
            className="w-8 h-8 flex items-center justify-center border border-black/[0.08] rounded-full
                       text-muted hover:text-ink hover:bg-paper/60 transition-all duration-200"
          >
            ✕
          </button>
        </div>

        <div className="space-y-5">
          <div>
            <h3 className="text-sm font-semibold text-ink mb-3">头像</h3>
            <div className="grid grid-cols-6 gap-2.5">
              {Array.from({ length: 12 }, (_, i) => (
                <div
                  key={i}
                  className="w-12 h-12 rounded-full bg-brand-light/40 border border-brand/15
                             flex items-center justify-center cursor-pointer hover:border-brand/40 hover:bg-brand-light/60 transition-all duration-200"
                >
                  <span className="text-brand/80 font-medium text-sm">{String.fromCharCode(65 + i)}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold text-ink mb-2">修改密码</h3>
            <p className="text-xs text-muted">密码修改功能开发中...</p>
          </div>
        </div>
      </div>
    </div>
  )
}
