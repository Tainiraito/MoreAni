import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, type LucideIcon } from 'lucide-react'

interface BattleKeyboardShortcut {
  letter: string
  direction: LucideIcon
  label: string
}

const SHORTCUTS: BattleKeyboardShortcut[] = [
  { letter: 'A', direction: ArrowLeft, label: '红方' },
  { letter: 'S', direction: ArrowDown, label: '差不多' },
  { letter: 'D', direction: ArrowRight, label: '蓝方' },
  { letter: 'W', direction: ArrowUp, label: '跳过' },
]

/** 以游戏键帽样式展示红蓝合战的键盘快捷键。 */
export function BattleKeyboardShortcuts() {
  return (
    <div
      className="flex flex-wrap items-center justify-end gap-x-2 gap-y-1 sm:flex-nowrap sm:gap-x-3"
      style={{ color: 'var(--text-muted)' }}
      aria-label="红蓝合战键盘快捷键"
      data-testid="battle-keyboard-shortcuts"
    >
      {SHORTCUTS.map(({ letter, direction: Direction, label }) => (
        <span key={letter} className="inline-flex shrink-0 items-center gap-1 text-[10px] sm:text-xs">
          <kbd
            className="inline-flex h-5 min-w-5 items-center justify-center rounded border px-1 font-mono font-semibold leading-none"
            style={{ background: 'var(--bg-card-warm)', borderColor: 'var(--border-line)', color: 'var(--text-secondary)', boxShadow: '0 1px 0 var(--border-line)' }}
          >
            {letter}
          </kbd>
          <kbd
            className="inline-flex h-5 w-5 items-center justify-center rounded border"
            style={{ background: 'var(--bg-card-warm)', borderColor: 'var(--border-line)', color: 'var(--text-secondary)', boxShadow: '0 1px 0 var(--border-line)' }}
          >
            <Direction size={12} strokeWidth={2.5} aria-hidden="true" />
          </kbd>
          <span>{label}</span>
        </span>
      ))}
    </div>
  )
}
