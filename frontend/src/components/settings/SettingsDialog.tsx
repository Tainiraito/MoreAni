import { useUIStore } from '@/stores/ui-store'

export function SettingsDialog() {
  const { settingsOpen, closeSettings } = useUIStore()

  if (!settingsOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={closeSettings} />

      <div className="relative z-10 w-full max-w-md bg-white border-2 border-brand-dark">
        <div className="flex items-center justify-between border-b-2 border-brand-dark px-6 py-4">
          <h2 className="font-display text-lg font-bold">设置</h2>
          <button
            onClick={closeSettings}
            className="text-2xl leading-none hover:text-brand-pink"
          >
            ×
          </button>
        </div>

        <div className="p-6">
          <p className="text-gray-500">TODO: 头像选择 + 密码修改</p>
        </div>
      </div>
    </div>
  )
}
