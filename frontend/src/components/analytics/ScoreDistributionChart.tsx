import { useMemo, useState } from 'react'

import type { AnalyticsScoreBucket } from '@/types'
import type { ScoreRange } from '@/components/analytics/ScoreRangeSlider'

interface ScoreDistributionChartProps {
  buckets: AnalyticsScoreBucket[]
  range: ScoreRange
}

const CHART_WIDTH = 640
const CHART_HEIGHT = 250
const MARGIN = { top: 18, right: 12, bottom: 34, left: 34 }
const GRID_RATIOS = [0.25, 0.5, 0.75, 1]

export function ScoreDistributionChart({ buckets, range }: ScoreDistributionChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const maxCount = useMemo(() => Math.max(1, ...buckets.map(bucket => bucket.count)), [buckets])
  const innerWidth = CHART_WIDTH - MARGIN.left - MARGIN.right
  const innerHeight = CHART_HEIGHT - MARGIN.top - MARGIN.bottom
  const bandWidth = innerWidth / Math.max(1, buckets.length)
  const barWidth = Math.max(5, bandWidth - 6)
  const hovered = hoveredIndex === null ? null : buckets[hoveredIndex]

  return (
    <div className="relative" data-testid="score-distribution-chart">
      <svg
        className="h-auto w-full overflow-visible"
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        role="img"
        aria-labelledby="score-distribution-title score-distribution-description"
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
          return (
            <g key={bucket.score}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(1, height)}
                rx="3"
                fill="url(#analytics-bar-gradient)"
                opacity={inRange ? (isHovered ? 1 : 0.85) : (isHovered ? 0.45 : 0.2)}
                filter={isHovered ? 'url(#analytics-bar-glow)' : undefined}
                tabIndex={0}
                aria-label={`${bucket.score.toFixed(1)} 分，共 ${bucket.count} 条评分`}
                onPointerEnter={() => setHoveredIndex(index)}
                onPointerLeave={() => setHoveredIndex(null)}
                onFocus={() => setHoveredIndex(index)}
                onBlur={() => setHoveredIndex(null)}
                style={{ transition: 'opacity 150ms ease' }}
              />
              {index % 2 === 1 ? (
                <text
                  x={x + barWidth / 2}
                  y={CHART_HEIGHT - 12}
                  textAnchor="middle"
                  fontSize="10"
                  fill="var(--text-muted)"
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
          className="pointer-events-none absolute z-10 rounded-lg px-3 py-2 text-xs"
          style={{
            left: `${((hoveredIndex + 0.5) / Math.max(1, buckets.length)) * 100}%`,
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
