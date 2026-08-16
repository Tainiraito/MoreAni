import { Listbox, ListboxButton, ListboxOption, ListboxOptions } from "@headlessui/react"
import { cn } from "@/lib/utils"
import { ChevronDown, Check } from "lucide-react"

interface SelectOption {
  value: string
  label: string
}

interface SelectGroup {
  label: string
  options: SelectOption[]
}

interface SelectProps {
  value: string
  onChange: (value: string) => void
  options?: SelectOption[]
  groups?: SelectGroup[]
  placeholder?: string
  className?: string
}

export function Select({ value, onChange, options = [], groups, placeholder, className }: SelectProps) {
  const allOptions = groups ? groups.flatMap(g => g.options) : options
  const selected = allOptions.find(o => o.value === value)

  return (
    <Listbox value={value} onChange={onChange}>
      <div className={cn("relative inline-flex", className)}>
        <ListboxButton
          className="relative h-9 w-full cursor-pointer rounded-lg border py-2 pl-3 pr-8 text-left text-xs outline-none transition-colors"
          style={{
            background: 'transparent',
            borderColor: 'var(--border-line)',
            color: selected ? 'var(--text-primary)' : 'var(--text-muted)',
          }}
        >
          <span className="block truncate">{selected?.label ?? placeholder}</span>
          <ChevronDown
            size={14}
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2"
            style={{ color: 'var(--text-muted)' }}
          />
        </ListboxButton>

        <ListboxOptions
          anchor="bottom start"
          className="z-50 mt-1 max-h-60 w-[var(--button-width)] overflow-auto rounded-lg py-1 shadow-lg outline-none"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-line)',
          }}
        >
          {groups
            ? groups.map(group => (
                <div key={group.label}>
                  <div
                    className="px-3 pt-2 pb-1 text-[11px] font-medium"
                    style={{ color: 'var(--text-muted)' }}
                  >
                    {group.label}
                  </div>
                  {group.options.map(option => (
                    <SelectOptionItem key={option.value} option={option} value={value} />
                  ))}
                </div>
              ))
            : options.map(option => (
                <SelectOptionItem key={option.value} option={option} value={value} />
              ))}
        </ListboxOptions>
      </div>
    </Listbox>
  )
}

function SelectOptionItem({ option, value }: { option: SelectOption; value: string }) {
  return (
    <ListboxOption
      value={option.value}
      className="relative cursor-pointer select-none py-2 pl-8 pr-3 text-xs transition-colors data-[focus]:opacity-80"
      style={{ color: 'var(--text-primary)' }}
    >
      <span className="block truncate">{option.label}</span>
      {option.value === value && (
        <span
          className="absolute inset-y-0 left-2 flex items-center"
          style={{ color: '#FB71A7' }}
        >
          <Check size={12} />
        </span>
      )}
    </ListboxOption>
  )
}
