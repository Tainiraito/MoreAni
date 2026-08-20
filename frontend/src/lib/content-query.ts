import type { ContentItem, ContentType } from '@/types'

export interface ContentQueryFilters {
  activeType: ContentType | 'all'
  searchQuery: string
  myFilter: '' | 'rated' | 'unrated' | 'reviewed' | 'unreviewed' | 'favorited' | 'unfavorited'
  sortBy: string
  seasonFilter: string
  userFilter: string
}

export function buildContentListParams(
  filters: ContentQueryFilters,
  page: number,
  size: number,
): Record<string, string> {
  const params: Record<string, string> = {
    page: String(page),
    size: String(size),
    type: filters.activeType,
  }
  if (filters.searchQuery) params.q = filters.searchQuery
  if (filters.myFilter === 'rated' || filters.myFilter === 'unrated') params.rated = filters.myFilter
  if (filters.myFilter === 'reviewed' || filters.myFilter === 'unreviewed') params.reviewed = filters.myFilter
  if (filters.myFilter === 'favorited' || filters.myFilter === 'unfavorited') params.favorited = filters.myFilter
  if (filters.sortBy !== 'updated_desc') params.sort = filters.sortBy
  if (filters.seasonFilter) params.season = filters.seasonFilter
  if (filters.userFilter) params.rated_by = filters.userFilter
  return params
}

export function getRecommendationSize(viewportWidth: number): number {
  return Math.max(12, Math.min(30, Math.ceil(viewportWidth / 180) + 4))
}

export function normalizeRecommendationItems(items: ContentItem[]): ContentItem[] {
  return [...new Map(items.map(item => [item.id, item])).values()]
}

export function buildLoopItems(items: ContentItem[]): ContentItem[] {
  const unique = normalizeRecommendationItems(items)
  return [...unique, ...unique]
}

export function getRecommendationSequenceWidth(
  itemCount: number,
  cardWidth = 160,
  gap = 20,
): number {
  return itemCount === 0 ? 0 : itemCount * cardWidth + (itemCount - 1) * gap
}

export class LatestRequestGate {
  private current = 0

  begin(): number {
    this.current += 1
    return this.current
  }

  isCurrent(requestId: number): boolean {
    return requestId === this.current
  }
}
