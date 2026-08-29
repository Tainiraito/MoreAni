import { cleanup, fireEvent, render } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { TagWordCloud } from '@/components/analytics/TagWordCloud'
import { calculateCloudFontSize } from '@/components/analytics/tag-word-cloud-scale'
import type { AnalyticsTagStat } from '@/types'

vi.mock('@visx/wordcloud', () => ({
  useWordcloud: ({ words }: { words: Array<{ text: string; size: number; rank: number }> }) => (
    words.map((word, index) => ({ ...word, x: index * 40, y: 0, weight: 600 }))
  ),
}))

const CLOUD_ITEMS: AnalyticsTagStat[] = [
  { name: '恋爱', weight: 10, rating_count: 10, title_count: 8, average_score: 8.4 },
  { name: '校园', weight: 7, rating_count: 7, title_count: 6, average_score: 8.1 },
]

function ControlledWordCloud() {
  const [selectedNames, setSelectedNames] = useState<string[]>([])
  const toggleTag = (name: string): void => {
    setSelectedNames(current => (
      current.includes(name) ? current.filter(item => item !== name) : [...current, name]
    ))
  }
  return <TagWordCloud items={CLOUD_ITEMS} selectedNames={selectedNames} onToggleTag={toggleTag} />
}

afterEach(cleanup)

describe('calculateCloudFontSize', () => {
  it('使用字体面积表达标签权重占比', () => {
    const fullWeightSize = calculateCloudFontSize(100, 100)
    const quarterWeightSize = calculateCloudFontSize(25, 100)

    expect(fullWeightSize).toBe(48)
    expect(quarterWeightSize).toBe(24)
    expect((quarterWeightSize ** 2) / (fullWeightSize ** 2)).toBeCloseTo(0.25)
  })

  it('为极低或无效权重保留可读字号', () => {
    expect(calculateCloudFontSize(0, 100)).toBe(13)
    expect(calculateCloudFontSize(1, 1000)).toBe(13)
  })
})

describe('TagWordCloud', () => {
  it('点击和键盘都可多选或取消标签，并使用自定义高亮代替黑色焦点框', () => {
    const view = render(<ControlledWordCloud />)
    const loveTag = view.getByRole('button', { name: '恋爱' })
    const schoolTag = view.getByRole('button', { name: '校园' })

    expect(loveTag).toHaveAttribute('aria-pressed', 'false')
    expect(loveTag).toHaveStyle({ cursor: 'pointer', outline: 'none' })

    fireEvent.click(loveTag)
    expect(loveTag).toHaveAttribute('aria-pressed', 'true')
    expect(loveTag).toHaveStyle({ textDecoration: 'underline' })

    fireEvent.keyDown(schoolTag, { key: 'Enter' })
    expect(schoolTag).toHaveAttribute('aria-pressed', 'true')

    fireEvent.click(loveTag)
    expect(loveTag).toHaveAttribute('aria-pressed', 'false')
    expect(schoolTag).toHaveAttribute('aria-pressed', 'true')
  })
})
