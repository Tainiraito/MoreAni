import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { BattleAnimeCard } from '@/components/red-blue/BattleAnimeCard'
import type { RedBlueContentSummary } from '@/types/red-blue'

const content: RedBlueContentSummary = {
  content_id: 1,
  title: '测试番剧',
  description: '这是一段用于确认卡片简介展示的作品简介。',
  cover_url: null,
  content_type: 'anime',
}

describe('BattleAnimeCard', () => {
  it('在整张卡片上展示番剧简介，并通过点击卡片打开详情', () => {
    const onOpen = vi.fn()
    const view = render(<BattleAnimeCard content={content} side="red" onOpen={onOpen} />)

    const card = view.getByTestId('battle-card-red')
    expect(card.tagName).toBe('BUTTON')
    expect(card).toHaveTextContent(content.description)
    expect(view.queryByText('详情')).not.toBeInTheDocument()
    expect(view.queryByText('红方')).not.toBeInTheDocument()
    expect(card.querySelector('.absolute.left-3.top-3')).not.toBeInTheDocument()

    fireEvent.click(card)
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('缺少简介时显示占位文案', () => {
    const view = render(
      <BattleAnimeCard content={{ ...content, description: '  ' }} side="blue" onOpen={() => undefined} />,
    )

    expect(view.getByText('暂无简介')).toBeInTheDocument()
    expect(view.queryByText('蓝方')).not.toBeInTheDocument()
  })
})
