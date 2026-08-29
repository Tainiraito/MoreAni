const MIN_FONT_SIZE = 13
const MAX_FONT_SIZE = 48

export function calculateCloudFontSize(weight: number, maxWeight: number): number {
  if (weight <= 0 || maxWeight <= 0) return MIN_FONT_SIZE
  return Math.max(MIN_FONT_SIZE, MAX_FONT_SIZE * Math.sqrt(weight / maxWeight))
}
