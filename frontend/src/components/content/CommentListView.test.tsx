import { render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { CommentListView } from '@/components/content/CommentListView'
import type { ContentItem } from '@/types'

const baseItem = {
  id: 1,
  title: '纯评分测试番剧',
  content_type: 'anime',
  cover_url: '',
  avg_score: 85,
  rating_count: 1,
  review_count: 0,
  activity_count: 1,
  recent_reviews: [
    {
      nickname: '评分用户',
      avatar_id: 0,
      score: 85,
      review: '',
      created_at: null,
    },
  ],
} as ContentItem

describe('CommentListView', () => {
  it('renders a score-only activity without showing an empty review state', () => {
    const { getByText, queryByText } = render(
      <CommentListView items={[baseItem]} onSelect={vi.fn()} />,
    )

    expect(getByText('评分用户')).toBeInTheDocument()
    expect(getByText('★8.5')).toBeInTheDocument()
    expect(queryByText('暂无评论')).not.toBeInTheDocument()
    expect(queryByText('暂无评分或评论')).not.toBeInTheDocument()
  })

  it('uses activity_count for the additional activity hint', () => {
    const item = {
      ...baseItem,
      activity_count: 7,
    } as ContentItem
    const { getByText } = render(
      <CommentListView items={[item]} onSelect={vi.fn()} />,
    )

    expect(getByText('+6 条动态 ›')).toBeInTheDocument()
  })
})
