import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Wordcloud } from '@visx/wordcloud'

import type { AnalyticsTagStat } from '@/types'

interface TagWordCloudProps {
  items: AnalyticsTagStat[]
}

interface CloudDatum {
  text: string
  size: number
  rank: number
}

const MIN_CLOUD_WIDTH = 280
const MIN_FONT_SIZE = 15
const MAX_FONT_SIZE = 56
const WORD_CLOUD_RANDOM = (): number => 0.5
const WORD_FONT_SIZE = (word: CloudDatum): number => word.size

function cloudTextColor(rank: number, total: number, hovered: boolean): string {
  if (hovered || rank < Math.max(1, Math.ceil(total / 3))) return 'var(--brand)'
  if (rank < Math.max(2, Math.ceil((total * 2) / 3))) return 'var(--text-secondary)'
  return 'var(--text-muted)'
}

export function TagWordCloud({ items }: TagWordCloudProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(MIN_CLOUD_WIDTH)
  const [hoveredName, setHoveredName] = useState<string | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const updateWidth = (): void => {
      setWidth(Math.max(MIN_CLOUD_WIDTH, container.clientWidth || MIN_CLOUD_WIDTH))
    }
    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(container)
    return () => observer.disconnect()
  }, [])

  const words = useMemo<CloudDatum[]>(() => {
    if (items.length === 0) return []
    const weights = items.map(item => item.weight)
    const minWeight = Math.min(...weights)
    const maxWeight = Math.max(...weights)
    const spread = Math.max(0.001, Math.sqrt(maxWeight) - Math.sqrt(minWeight))
    return items.map((item, rank) => ({
      text: item.name,
      rank,
      size: MIN_FONT_SIZE
        + ((Math.sqrt(item.weight) - Math.sqrt(minWeight)) / spread) * (MAX_FONT_SIZE - MIN_FONT_SIZE),
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
  const height = Math.max(300, Math.min(420, width * 0.62))
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
    <div ref={containerRef} className="relative min-w-0 overflow-hidden" data-testid="tag-word-cloud">
      <div role="img" aria-label="番剧标签词云" onPointerLeave={handleLeave}>
        <Wordcloud<CloudDatum>
          width={width}
          height={height}
          words={words}
          font="Space Grotesk"
          fontSize={WORD_FONT_SIZE}
          fontWeight={600}
          padding={3}
          rotate={0}
          spiral="rectangular"
          random={WORD_CLOUD_RANDOM}
        >
          {cloudWords => cloudWords.map(word => {
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
        </Wordcloud>
      </div>

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
            权重 {hoveredItem.weight.toFixed(2)} · {hoveredItem.rating_count} 条评分
          </p>
          <p style={{ color: 'var(--text-muted)' }}>
            {hoveredItem.title_count} 部番剧 · 均分 {hoveredItem.average_score.toFixed(1)}
          </p>
        </div>
      ) : null}

      <details className="mt-3 rounded-lg px-3 py-2 text-xs" style={{ background: 'var(--bg-card-warm)' }}>
        <summary className="font-medium" style={{ color: 'var(--text-secondary)' }}>查看标签明细</summary>
        <ol className="mt-3 grid gap-2 sm:grid-cols-2">
          {items.slice(0, 20).map(item => (
            <li key={item.name} className="flex items-center justify-between gap-3">
              <span style={{ color: 'var(--text-primary)' }}>{item.name}</span>
              <span className="tabular-nums" style={{ color: 'var(--text-muted)' }}>{item.weight.toFixed(2)}</span>
            </li>
          ))}
        </ol>
      </details>
    </div>
  )
}
