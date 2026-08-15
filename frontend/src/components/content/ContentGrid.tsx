import { ContentCard } from './ContentCard'
import type { ContentItem } from '@/types'

interface ContentGridProps {
  items: ContentItem[]
  onSelect: (id: number) => void
}

export function ContentGrid({ items, onSelect }: ContentGridProps) {
  if (items.length === 0) {
    return (
      <div className="py-20 text-center">
        <p className="text-5xl mb-4 opacity-40">📭</p>
        <p className="text-muted text-sm">还没有内容呢~</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-5">
      {items.map(item => (
        <ContentCard key={item.id} content={item} onSelect={onSelect} />
      ))}
    </div>
  )
}
