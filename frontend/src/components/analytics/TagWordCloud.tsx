import { useCallback, useMemo, useState } from 'react'
import { useWordcloud } from '@visx/wordcloud'

import { calculateCloudFontSize } from '@/components/analytics/tag-word-cloud-scale'
import type { AnalyticsTagStat } from '@/types'

interface TagWordCloudProps {
  items: AnalyticsTagStat[]
}

interface CloudDatum {
  text: string
  size: number
  rank: number
}

const CLOUD_LAYOUT_WIDTH = 520
const CLOUD_LAYOUT_HEIGHT = 340
const WORD_CLOUD_RANDOM = (): number => 0.5
const WORD_FONT_SIZE = (word: CloudDatum): number => word.size

function cloudTextColor(rank: number, total: number, hovered: boolean): string {
  if (hovered || rank < Math.max(1, Math.ceil(total / 3))) return 'var(--brand)'
  if (rank < Math.max(2, Math.ceil((total * 2) / 3))) return 'var(--text-secondary)'
  return 'var(--text-muted)'
}

export function TagWordCloud({ items }: TagWordCloudProps) {
  const [hoveredName, setHoveredName] = useState<string | null>(null)

  const words = useMemo<CloudDatum[]>(() => {
    if (items.length === 0) return []
    const maxWeight = Math.max(...items.map(item => item.weight))
    return items.map((item, rank) => ({
      text: item.name,
      rank,
      size: calculateCloudFontSize(item.weight, maxWeight),
    }))
  }, [items])
  const itemByName = useMemo(
    () => new Map(items.map(item => [item.name, item])),
    [items],
  )
  const rankByName = useMemo(
    () => new Map(words.map(word => [word.text, word.rank])),
    [words],
  )
  const hoveredItem = hoveredName ? itemByName.get(hoveredName) ?? null : null
  const totalWeight = useMemo(
    () => items.reduce((sum, item) => sum + item.weight, 0),
    [items],
  )
  const cloudWords = useWordcloud<CloudDatum>({
    width: CLOUD_LAYOUT_WIDTH,
    height: CLOUD_LAYOUT_HEIGHT,
    words,
    font: 'Space Grotesk',
    fontSize: WORD_FONT_SIZE,
    fontWeight: 600,
    padding: 2,
    rotate: 0,
    spiral: 'archimedean',
    random: WORD_CLOUD_RANDOM,
  })
  const handleLeave = useCallback(() => setHoveredName(null), [])

  if (items.length === 0) {
    return (
      <div
        className="flex min-h-[300px] items-center justify-center rounded-xl text-sm"
        style={{ background: 'var(--bg-card-warm)', color: 'var(--text-muted)' }}
      >
        当前评分区间暂无可分析标签
      </div>
    )
  }

  return (
    <div className="relative w-full min-w-0 flex-1 overflow-hidden" data-testid="tag-word-cloud">
      <svg
        role="img"
        aria-label="番剧标签词云"
        viewBox={`0 0 ${CLOUD_LAYOUT_WIDTH} ${CLOUD_LAYOUT_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        className="block min-h-[300px] w-full"
        onPointerLeave={handleLeave}
      >
        <g transform={`translate(${CLOUD_LAYOUT_WIDTH / 2}, ${CLOUD_LAYOUT_HEIGHT / 2})`}>
          {cloudWords.map(word => {
            const name = word.text ?? ''
            const rank = rankByName.get(name) ?? items.length
            const hovered = hoveredName === name
            return (
              <text
                key={name}
                transform={`translate(${word.x ?? 0}, ${word.y ?? 0})`}
                textAnchor="middle"
                fontSize={word.size}
                fontWeight={word.weight}
                fontFamily="var(--font-sans)"
                fill={cloudTextColor(rank, items.length, hovered)}
                opacity={hovered ? 1 : Math.max(0.52, 1 - rank / Math.max(items.length * 1.8, 1))}
                tabIndex={0}
                aria-label={name}
                onPointerEnter={() => setHoveredName(name)}
                onFocus={() => setHoveredName(name)}
                onBlur={() => setHoveredName(null)}
                style={{
                  cursor: 'default',
                  filter: hovered ? 'drop-shadow(0 0 6px rgba(251, 113, 167, 0.45))' : 'none',
                  transition: 'fill 150ms ease, opacity 150ms ease, filter 150ms ease',
                }}
              >
                {name}
              </text>
            )
          })}
        </g>
      </svg>

      {hoveredItem ? (
        <div
          className="pointer-events-none absolute right-3 top-3 z-10 rounded-lg px-3 py-2 text-xs"
          style={{
            background: 'var(--bg-card)',
            border: '1px solid var(--border-line)',
            boxShadow: 'var(--shadow-popup)',
          }}
          role="tooltip"
        >
          <p className="font-semibold" style={{ color: 'var(--brand)' }}>{hoveredItem.name}</p>
          <p style={{ color: 'var(--text-secondary)' }}>
            当前词云占比 {totalWeight > 0 ? ((hoveredItem.weight / totalWeight) * 100).toFixed(1) : '0.0'}%
          </p>
          <p style={{ color: 'var(--text-muted)' }}>
            权重 {hoveredItem.weight.toFixed(2)} · {hoveredItem.rating_count} 条评分
          </p>
          <p style={{ color: 'var(--text-muted)' }}>
            {hoveredItem.title_count} 部番剧 · 均分 {hoveredItem.average_score.toFixed(1)}
          </p>
        </div>
      ) : null}

      <ol className="sr-only">
        {items.map(item => (
          <li key={item.name}>
            {item.name}：当前词云占比 {totalWeight > 0 ? ((item.weight / totalWeight) * 100).toFixed(1) : '0.0'}%，
            权重 {item.weight.toFixed(2)}，{item.rating_count} 条评分，
            {item.title_count} 部番剧，平均分 {item.average_score.toFixed(1)}
          </li>
        ))}
      </ol>
    </div>
  )
}
