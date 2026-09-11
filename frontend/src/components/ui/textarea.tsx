import * as React from "react"
import { cn } from "@/lib/utils"

const Textarea = React.forwardRef<HTMLTextAreaElement, React.ComponentProps<"textarea">>(function Textarea({ className, ...props }, ref) {
  return (
    <textarea
      ref={ref}
      data-slot="textarea"
      className={cn(
        "flex min-h-16 w-full rounded-lg px-3 py-2 text-sm outline-none transition-shadow resize-none",
        "focus:ring-1 focus:ring-[#FB71A7]/50",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "placeholder:text-[var(--text-muted)]",
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
})

Textarea.displayName = 'Textarea'

export { Textarea }
