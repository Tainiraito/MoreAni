import type { ContentType } from '@/types'

const tabs: { key: ContentType | 'all'; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'anime', label: '番剧' },
  { key: 'movie', label: '电影' },
  { key: 'game', label: '游戏' },
  { key: 'software', label: '软件' },
  { key: 'website', label: '网站' },
  { key: 'book', label: '书籍' },
]

interface CategoryTabsProps {
  active: ContentType | 'all'
  onChange: (type: ContentType | 'all') => void
}

export function CategoryTabs({ active, onChange }: CategoryTabsProps) {
  return (
    <div
      className="mt-6 flex gap-6 overflow-x-auto"
      style={{ borderBottom: '1px solid var(--border-line)' }}
    >
      {tabs.map(tab => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className="relative min-h-[3.25rem] whitespace-nowrap pb-3 text-sm font-medium transition-colors duration-150"
          style={{
            color: active === tab.key ? 'var(--brand)' : 'var(--text-muted)',
            borderBottom: active === tab.key
              ? '2px solid var(--brand)'
              : '2px solid transparent',
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
