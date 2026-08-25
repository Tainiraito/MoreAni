import { useRef, useState } from 'react'
import { CalendarClock } from 'lucide-react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { SimpleCalendar } from '@/components/ui/date-picker'
import { usePopoverOutsideClose } from '@/hooks/use-popover-outside-close'

interface DateTimePickerProps {
  label?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
}

function localDateLabel(value: string): string {
  if (!value) return ''
  const [date, time] = value.split('T')
  return time ? `${date} ${time}` : date
}

function selectedDate(value: string): Date | undefined {
  if (!value) return undefined
  const date = new Date(`${value}:00`)
  return Number.isNaN(date.getTime()) ? undefined : date
}

export function DateTimePicker({ label, value, onChange, placeholder = '选择日期和时间', disabled = false }: DateTimePickerProps) {
  const [open, setOpen] = useState(false)
  const contentRef = useRef<HTMLDivElement>(null)
  const selected = selectedDate(value)
  const time = value.slice(11, 16) || '00:00'
  usePopoverOutsideClose(open, () => setOpen(false), contentRef)

  const handleSelect = (date: Date) => {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    onChange(`${year}-${month}-${day}T${time}`)
  }

  const handleTimeChange = (nextTime: string) => {
    const date = value.slice(0, 10) || (() => {
      const now = new Date()
      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    })()
    onChange(`${date}T${nextTime}`)
  }

  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>{label}</span>}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-haspopup="dialog"
            aria-expanded={open}
            className="flex h-9 w-full cursor-pointer items-center rounded-lg px-3 text-left text-sm outline-none transition-shadow hover:border-[rgba(251,113,167,0.45)] focus:ring-1 focus:ring-[#FB71A7]/50 disabled:cursor-not-allowed disabled:opacity-50"
            style={{ background: 'transparent', border: '1px solid var(--border-line)', color: value ? 'var(--text-primary)' : 'var(--text-muted)' }}
          >
            <CalendarClock size={14} className="mr-2 shrink-0" style={{ color: 'var(--text-muted)' }} />
            {value ? localDateLabel(value) : placeholder}
          </button>
        </PopoverTrigger>
        <PopoverContent ref={contentRef} className="w-[286px] p-3" align="start" onInteractOutside={() => setOpen(false)}>
          <SimpleCalendar selected={selected} onSelect={handleSelect} />
          <div className="mt-3 border-t pt-3" style={{ borderColor: 'var(--border-line)' }}>
            <label className="flex items-center justify-between gap-3 text-xs" style={{ color: 'var(--text-secondary)' }}>
              时间
              <input
                type="time"
                value={time}
                onChange={event => handleTimeChange(event.target.value)}
                className="h-8 rounded-lg px-2 text-sm outline-none focus:ring-1 focus:ring-[#FB71A7]/50"
                style={{ background: 'transparent', border: '1px solid var(--border-line)', color: 'var(--text-primary)' }}
              />
            </label>
          </div>
        </PopoverContent>
      </Popover>
    </label>
  )
}
