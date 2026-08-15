import { useState } from "react"
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

interface DatePickerProps {
  label?: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
}

function SimpleCalendar({ selected, onSelect }: { selected?: Date; onSelect: (d: Date) => void }) {
  const [viewDate, setViewDate] = useState(selected || new Date())

  const year = viewDate.getFullYear()
  const month = viewDate.getMonth()

  const firstDay = new Date(year, month, 1).getDay()
  const daysInMonth = new Date(year, month + 1, 0).getDate()

  const weeks: (number | null)[][] = []
  let week: (number | null)[] = Array(firstDay).fill(null)
  for (let d = 1; d <= daysInMonth; d++) {
    week.push(d)
    if (week.length === 7) {
      weeks.push(week)
      week = []
    }
  }
  if (week.length > 0) {
    while (week.length < 7) week.push(null)
    weeks.push(week)
  }

  const isSelected = (d: number) =>
    selected &&
    selected.getFullYear() === year &&
    selected.getMonth() === month &&
    selected.getDate() === d

  const isToday = (d: number) => {
    const t = new Date()
    return t.getFullYear() === year && t.getMonth() === month && t.getDate() === d
  }

  const prevMonth = () => setViewDate(new Date(year, month - 1, 1))
  const nextMonth = () => setViewDate(new Date(year, month + 1, 1))

  const weekDays = ["日", "一", "二", "三", "四", "五", "六"]
  const monthLabel = `${year}年${month + 1}月`

  return (
    <div style={{ background: 'var(--bg-card)', color: 'var(--text-primary)' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-1 py-2">
        <button
          onClick={prevMonth}
          className="w-7 h-7 flex items-center justify-center rounded-md transition-all duration-150"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-card-warm)'; e.currentTarget.style.color = '#FB71A7' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' }}
        >
          <ChevronLeft size={16} />
        </button>
        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          {monthLabel}
        </span>
        <button
          onClick={nextMonth}
          className="w-7 h-7 flex items-center justify-center rounded-md transition-all duration-150"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--bg-card-warm)'; e.currentTarget.style.color = '#FB71A7' }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)' }}
        >
          <ChevronRight size={16} />
        </button>
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 mb-1">
        {weekDays.map(d => (
          <div key={d} className="text-center text-xs py-1" style={{ color: 'var(--text-muted)' }}>
            {d}
          </div>
        ))}
      </div>

      {/* Days */}
      {weeks.map((w, wi) => (
        <div key={wi} className="grid grid-cols-7">
          {w.map((d, di) => (
            <div key={di} className="flex items-center justify-center py-0.5">
              {d !== null ? (
                <button
                  onClick={() => onSelect(new Date(year, month, d))}
                  className="w-8 h-8 flex items-center justify-center rounded-full text-sm transition-all duration-150"
                  style={{
                    background: isSelected(d) ? '#FB71A7' : isToday(d) ? 'var(--bg-card-warm)' : 'transparent',
                    color: isSelected(d) ? 'white' : isToday(d) ? '#FB71A7' : 'var(--text-primary)',
                    fontWeight: isToday(d) || isSelected(d) ? '600' : '400',
                  }}
                  onMouseEnter={e => {
                    if (!isSelected(d)) {
                      e.currentTarget.style.background = 'rgba(251,113,167,0.15)'
                      e.currentTarget.style.color = '#FB71A7'
                    }
                  }}
                  onMouseLeave={e => {
                    if (!isSelected(d)) {
                      e.currentTarget.style.background = isToday(d) ? 'var(--bg-card-warm)' : 'transparent'
                      e.currentTarget.style.color = isToday(d) ? '#FB71A7' : 'var(--text-primary)'
                    }
                  }}
                >
                  {d}
                </button>
              ) : (
                <div className="w-8 h-8" />
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

export function DatePicker({ label, value, onChange, placeholder }: DatePickerProps) {
  const [open, setOpen] = useState(false)
  const selectedDate = value ? new Date(value + "T00:00:00") : undefined

  const handleSelect = (date: Date) => {
    const y = date.getFullYear()
    const m = String(date.getMonth() + 1).padStart(2, '0')
    const d = String(date.getDate()).padStart(2, '0')
    onChange(`${y}-${m}-${d}`)
    setOpen(false)
  }

  return (
    <label className="block">
      {label && (
        <span className="text-xs font-medium mb-1.5 block" style={{ color: 'var(--text-secondary)' }}>
          {label}
        </span>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="w-full flex items-center h-9 px-3 rounded-lg text-sm outline-none transition-shadow cursor-pointer text-left"
            style={{
              background: 'transparent',
              border: '1px solid var(--border-line)',
              color: value ? 'var(--text-primary)' : 'var(--text-muted)',
            }}
            onClick={() => setOpen(!open)}
          >
            <CalendarIcon size={14} className="mr-2 flex-shrink-0" style={{ color: 'var(--text-muted)' }} />
            {selectedDate ? `${selectedDate.getFullYear()}-${String(selectedDate.getMonth() + 1).padStart(2, '0')}-${String(selectedDate.getDate()).padStart(2, '0')}` : (placeholder || "选择日期")}
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-2" align="start">
          <SimpleCalendar selected={selectedDate} onSelect={handleSelect} />
        </PopoverContent>
      </Popover>
    </label>
  )
}
