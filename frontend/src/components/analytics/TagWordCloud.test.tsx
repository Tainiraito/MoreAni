import { describe, expect, it } from 'vitest'

import { calculateCloudFontSize } from '@/components/analytics/tag-word-cloud-scale'

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
