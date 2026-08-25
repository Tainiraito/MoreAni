import { Checkbox as CheckboxPrimitive } from '@base-ui/react/checkbox'
import { Check } from 'lucide-react'

import { cn } from '@/lib/utils'

interface CheckboxProps extends CheckboxPrimitive.Root.Props {
  checked?: boolean
  onCheckedChange?: (checked: boolean) => void
}

function Checkbox({ className, checked = false, onCheckedChange, ...props }: CheckboxProps) {
  return (
    <CheckboxPrimitive.Root
      {...props}
      checked={checked}
      onCheckedChange={onCheckedChange}
      className={cn(
        'inline-flex h-4 w-4 shrink-0 cursor-pointer items-center justify-center rounded-[4px] border outline-none transition-colors',
        'focus-visible:ring-2 focus-visible:ring-[#FB71A7]/40 focus-visible:ring-offset-1',
        'disabled:cursor-not-allowed disabled:opacity-50',
        'data-checked:border-[#FB71A7] data-checked:bg-[#FB71A7] data-unchecked:border-[var(--border-line)] data-unchecked:bg-transparent',
        className,
      )}
    >
      <CheckboxPrimitive.Indicator className="flex items-center justify-center text-white">
        <Check size={12} strokeWidth={3} />
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  )
}

export { Checkbox }
