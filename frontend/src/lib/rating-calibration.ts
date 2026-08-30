import type { RatingCalibrationCandidate } from '@/types'

export interface RatingCalibrationRow {
  candidate: RatingCalibrationCandidate
  newScore: number | null
}

function sortableScore(row: RatingCalibrationRow): number {
  return row.newScore && row.newScore > 0 ? row.newScore : -1
}

export function sortCalibrationRows(rows: RatingCalibrationRow[]): RatingCalibrationRow[] {
  return [...rows].sort((left, right) => sortableScore(right) - sortableScore(left))
}

export function moveCalibrationRow(
  rows: RatingCalibrationRow[],
  fromIndex: number,
  toIndex: number,
): RatingCalibrationRow[] {
  if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= rows.length || toIndex >= rows.length) {
    return rows
  }

  const nextRows = [...rows]
  const [moved] = nextRows.splice(fromIndex, 1)
  nextRows.splice(toIndex, 0, moved)

  const sourceIndex = fromIndex > toIndex ? toIndex + 1 : toIndex - 1
  const source = nextRows[sourceIndex]
  const inheritedScore = source?.newScore && source.newScore > 0 ? source.newScore : null
  nextRows[toIndex] = { ...moved, newScore: inheritedScore }
  return nextRows
}

/** 根据作品 ID 和插入槽位移动作品，避免拖拽过程中依赖可能变化的数组索引。 */
export function moveCalibrationRowToSlot(
  rows: RatingCalibrationRow[],
  contentId: number,
  insertionSlot: number,
): RatingCalibrationRow[] {
  const fromIndex = rows.findIndex(row => row.candidate.content_id === contentId)
  if (fromIndex < 0 || insertionSlot < 0 || insertionSlot > rows.length) return rows

  const toIndex = insertionSlot > fromIndex ? insertionSlot - 1 : insertionSlot
  return moveCalibrationRow(rows, fromIndex, Math.min(rows.length - 1, toIndex))
}
