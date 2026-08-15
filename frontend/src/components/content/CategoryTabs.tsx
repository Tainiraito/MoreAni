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
      className="mt-6 flex gap-6 overflow-x-auto border-b"
      style={{ borderColor: 'rgba(44,42,48,0.11)' }}
    >
      {tabs.map(tab => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className="relative min-h-[3.25rem] whitespace-nowrap pb-3 text-sm font-medium transition-colors duration-150"
          style={{
            color: active === tab.key
              ? 'var(--accent-amber, #c4956a)'
              : 'var(--text-secondary, #4a4550)',
            borderBottom: active === tab.key
              ? '2px solid var(--accent-amber, #c4956a)'
              : '2px solid transparent',
          }}
        >
          {tab.label}
        </button>
      ))}
    </div>
  )
}
