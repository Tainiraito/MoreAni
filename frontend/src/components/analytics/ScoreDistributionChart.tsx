import { useMemo, useState } from 'react'

import type { AnalyticsScoreBucket } from '@/types'
import type { ScoreRange } from '@/components/analytics/ScoreRangeSlider'
import type { KeyboardEvent } from 'react'

interface ScoreDistributionChartProps {
  buckets: AnalyticsScoreBucket[]
  range: ScoreRange
  onSelectScore?: (score: number) => void
}

const CHART_WIDTH = 640
const CHART_HEIGHT = 250
const MARGIN = { top: 18, right: 12, bottom: 34, left: 34 }
const GRID_RATIOS = [0.25, 0.5, 0.75, 1]

export function ScoreDistributionChart({ buckets, range, onSelectScore }: ScoreDistributionChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const maxCount = useMemo(() => Math.max(1, ...buckets.map(bucket => bucket.count)), [buckets])
  const innerWidth = CHART_WIDTH - MARGIN.left - MARGIN.right
  const innerHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom
  const bandWidth = innerWidth / Math.max(1, buckets.length)
  const barWidth = Math.max(5, bandWidth - 6)
  const hovered = hoveredIndex === null ? null : buckets[hoveredIndex]

  const handleColumnKeyDown = (event: KeyboardEvent<SVGGElement>, score: number): void => {
    if (!onSelectScore || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    onSelectScore(score)
  }

  return (
    <div className="relative" data-testid="score-distribution-chart">
      <svg
        className="h-auto w-full select-none overflow-visible"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        role="img"
        aria-labelledby="score-distribution-title score-distribution-description"
        style={{ userSelect: 'none' }}
      >
        <title id="score-distribution-title">评分分布柱状图</title>
        <desc id="score-distribution-description">显示从 0.5 到 10 分各评分档的番剧评分数量</desc>
        <defs>
          <linearGradient id="analytics-bar-gradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" />
            <stop offset="100%" stopColor="var(--brand-deep)" />
          </linearGradient>
          <filter id="analytics-bar-glow" x="-50%" y="-30%" width="200%" height="180%">
            <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#FB71A7" floodOpacity="0.35" />
          </filter>
        </defs>

        {GRID_RATIOS.map(ratio => {
          const y = MARGIN.top + innerHeight * (1 - ratio)
          return (
            <g key={ratio}>
              <line
                x1={MARGIN.left}
                x2={CHART_WIDTH - MARGIN.right}
                y1={y}
                y2={y}
                stroke="var(--border-line)"
                strokeWidth="1"
              />
              <text
                x={MARGIN.left - 7}
                y={y + 4}
                textAnchor="end"
                fontSize="10"
                fill="var(--text-muted)"
              >
                {Math.round(maxCount * ratio)}
              </text>
            </g>
          )
        })}

        {buckets.map((bucket, index) => {
          const height = (bucket.count / maxCount) * innerHeight
          const x = MARGIN.left + index * bandWidth + (bandWidth - barWidth) / 2
          const y = MARGIN.top + innerHeight - height
          const inRange = bucket.score >= range.min && bucket.score <= range.max
          const isHovered = hoveredIndex === index
          const isSelected = range.min === bucket.score && range.max === bucket.score
          const interactive = onSelectScore !== undefined
          return (
            <g
              key={bucket.score}
              role={interactive ? 'button' : undefined}
              tabIndex={interactive ? 0 : undefined}
              aria-label={`${bucket.score.toFixed(1)} 分，共 ${bucket.count} 条评分${interactive ? '，点击仅查看该评分' : ''}`}
              aria-pressed={interactive ? isSelected : undefined}
              onPointerDown={interactive ? event => event.preventDefault() : undefined}
              onClick={interactive ? () => onSelectScore?.(bucket.score) : undefined}
              onKeyDown={event => handleColumnKeyDown(event, bucket.score)}
              onPointerEnter={() => setHoveredIndex(index)}
              onPointerLeave={() => setHoveredIndex(null)}
              onFocus={() => setHoveredIndex(index)}
              onBlur={() => setHoveredIndex(null)}
              style={{ cursor: interactive ? 'pointer' : 'default', outline: 'none', userSelect: 'none' }}
            >
              <rect
                x={MARGIN.left + index * bandWidth}
                y={0}
                width={bandWidth}
                height={CHART_HEIGHT}
                fill="transparent"
                data-testid={`score-column-hit-area-${bucket.score}`}
              />
              <rect
                x={MARGIN.left + index * bandWidth}
                y={MARGIN.top}
                width={bandWidth}
                height={innerHeight}
                fill="var(--brand)"
                opacity={isSelected ? 0.1 : (isHovered ? 0.05 : 0)}
                rx="3"
                pointerEvents="none"
                style={{ transition: 'opacity 150ms ease' }}
              />
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(1, height)}
                rx="3"
                fill="url(#analytics-bar-gradient)"
                opacity={inRange ? (isHovered ? 1 : 0.85) : (isHovered ? 0.45 : 0.2)}
                filter={isHovered || isSelected ? 'url(#analytics-bar-glow)' : undefined}
                pointerEvents="none"
                style={{ transition: 'opacity 150ms ease' }}
              />
              {index % 2 === 1 ? (
                <text
                  x={x + barWidth / 2}
                  y={CHART_HEIGHT - 12}
                  textAnchor="middle"
                  fontSize="10"
                  fill="var(--text-muted)"
                  pointerEvents="none"
                >
                  {bucket.score.toFixed(0)}
                </text>
              ) : null}
            </g>
          )
        })}
      </svg>

      {hovered && hoveredIndex !== null ? (
        <div
          className="pointer-events-none absolute z-10 whitespace-nowrap rounded-lg px-3 py-2 text-xs"
          style={{
            left: `clamp(4rem, ${((hoveredIndex + 0.5) / Math.max(1, buckets.length)) * 100}%, calc(100% - 4rem))`,
            top: '8px',
            transform: 'translateX(-50%)',
            background: 'var(--bg-card)',
            border: '1px solid var(--border-line)',
            boxShadow: 'var(--shadow-popup)',
            color: 'var(--text-primary)',
          }}
          role="tooltip"
        >
          <span className="font-semibold" style={{ color: 'var(--brand)' }}>{hovered.score.toFixed(1)} 分</span>
          <span className="ml-2" style={{ color: 'var(--text-secondary)' }}>{hovered.count} 条评分</span>
        </div>
      ) : null}

      <ul className="sr-only">
        {buckets.map(bucket => (
          <li key={bucket.score}>{bucket.score.toFixed(1)} 分：{bucket.count} 条评分</li>
        ))}
      </ul>
    </div>
  )
}
