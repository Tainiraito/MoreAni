import { describe, expect, it } from 'vitest'

import type { RatingCalibrationCandidate } from '@/types'
import { moveCalibrationRow, moveCalibrationRowToSlot, sortCalibrationRows, type RatingCalibrationRow } from '@/lib/rating-calibration'

function row(contentId: number, score: number | null): RatingCalibrationRow {
  const candidate: RatingCalibrationCandidate = {
    rating_id: contentId,
    content_id: contentId,
    title: `作品 ${contentId}`,
    title_alt: '',
    cover_url: null,
    content_type: 'anime',
    old_score: score || 60,
    rated_at: '2026-01-01T00:00:00Z',
    last_rated_at: '2026-01-01T00:00:00Z',
  }
  return { candidate, newScore: score }
}

function ids(rows: RatingCalibrationRow[]): number[] {
  return rows.map(item => item.candidate.content_id)
}

describe('rating calibration ordering', () => {
  it('moves C to the top and only inherits A score', () => {
    const next = moveCalibrationRow([row(1, 80), row(2, 70), row(3, 60)], 2, 0)

    expect(ids(next)).toEqual([3, 1, 2])
    expect(next.map(item => item.newScore)).toEqual([80, 80, 70])
  })

  it('moves C to the middle and only inherits B score', () => {
    const next = moveCalibrationRow([row(1, 80), row(2, 70), row(3, 60)], 2, 1)

    expect(ids(next)).toEqual([1, 3, 2])
    expect(next.map(item => item.newScore)).toEqual([80, 70, 70])
  })

  it('moves A down and only inherits B score', () => {
    const next = moveCalibrationRow([row(1, 80), row(2, 70), row(3, 60)], 0, 1)

    expect(ids(next)).toEqual([2, 1, 3])
    expect(next.map(item => item.newScore)).toEqual([70, 70, 60])
  })

  it('clears the moved score when the source position is empty', () => {
    const next = moveCalibrationRow([row(1, 80), row(2, null), row(3, 60)], 0, 1)

    expect(ids(next)).toEqual([2, 1, 3])
    expect(next.map(item => item.newScore)).toEqual([null, null, 60])
  })

  it('sorts numeric scores first and preserves stable order for ties and blanks', () => {
    const next = sortCalibrationRows([row(1, null), row(2, 70), row(3, 70), row(4, 0)])

    expect(ids(next)).toEqual([2, 3, 1, 4])
  })

  it('moves by stable content ID and insertion slot', () => {
    const next = moveCalibrationRowToSlot([row(1, 80), row(2, 70), row(3, 60)], 3, 1)

    expect(ids(next)).toEqual([1, 3, 2])
    expect(next.map(item => item.newScore)).toEqual([80, 70, 70])
  })
})
