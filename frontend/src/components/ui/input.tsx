import * as React from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

interface InputProps extends React.ComponentProps<"input"> {
  clearable?: boolean
  onClear?: () => void
}

function Input({ className, type, clearable = false, onClear, ...props }: InputProps) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  const inputValue = props.value ?? props.defaultValue
  const hasValue = Array.isArray(inputValue)
    ? inputValue.length > 0
    : inputValue !== undefined && inputValue !== null && String(inputValue).length > 0

  const input = (
    <input
      ref={inputRef}
      type={type}
      data-slot="input"
      className={cn(
        "h-9 w-full min-w-0 rounded-lg px-3 py-1 text-sm outline-none transition-shadow",
        "file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium",
        "focus:ring-1 focus:ring-[#FB71A7]/50",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "placeholder:text-[var(--text-muted)]",
        clearable && "pr-9",
        className
      )}
      style={{
        background: 'transparent',
        border: '1px solid var(--border-line)',
        color: 'var(--text-primary)',
      }}
      {...props}
    />
  )

  if (!clearable) return input

  return (
    <div className="relative w-full">
      {input}
      {hasValue && (
        <button
          type="button"
          aria-label="清空输入内容"
          title="清空"
          onMouseDown={event => event.preventDefault()}
          onClick={() => {
            onClear?.()
            inputRef.current?.focus()
          }}
          className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full text-[var(--text-muted)] transition-colors hover:bg-black/[0.06] hover:text-[var(--text-primary)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 dark:hover:bg-white/[0.08]"
        >
          <X size={13} aria-hidden="true" />
        </button>
      )}
    </div>
  )
}

export { Input }
