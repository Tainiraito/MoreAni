import { useLayoutEffect, useMemo, useRef, useState } from 'react'

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

interface ChartViewport {
  width: number
  height: number
}

export function ScoreDistributionChart({ buckets, range, onSelectScore }: ScoreDistributionChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const chartRef = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState<ChartViewport>({ width: CHART_WIDTH, height: CHART_HEIGHT })
  useLayoutEffect(() => {
    const element = chartRef.current
    if (!element || typeof ResizeObserver === 'undefined') return

    const updateViewport = (): void => {
      const { width, height } = element.getBoundingClientRect()
      if (width <= 0 || height <= 0) return
      const nextViewport = { width: Math.round(width), height: Math.round(height) }
      setViewport(current => (
        current.width === nextViewport.width && current.height === nextViewport.height
          ? current
          : nextViewport
      ))
    }

    updateViewport()
    const observer = new ResizeObserver(updateViewport)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const chartWidth = viewport.width
  const chartHeight = viewport.height
  const margin = {
    top: Math.min(MARGIN.top, Math.max(8, chartHeight * 0.12)),
    right: Math.min(MARGIN.right, Math.max(8, chartWidth * 0.04)),
    bottom: Math.min(MARGIN.bottom, Math.max(22, chartHeight * 0.22)),
    left: Math.min(MARGIN.left, Math.max(26, chartWidth * 0.1)),
  }
  const maxCount = useMemo(() => Math.max(1, ...buckets.map(bucket => bucket.count)), [buckets])
  const innerWidth = Math.max(1, chartWidth - margin.left - margin.right)
  const innerHeight = Math.max(1, chartHeight - margin.top - margin.bottom)
  const bandWidth = innerWidth / Math.max(1, buckets.length)
  const barWidth = Math.max(5, bandWidth - 6)
  const hovered = hoveredIndex === null ? null : buckets[hoveredIndex]

  const handleColumnKeyDown = (event: KeyboardEvent<SVGGElement>, score: number): void => {
    if (!onSelectScore || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    onSelectScore(score)
  }

  return (
    <div ref={chartRef} className="relative h-full min-h-0 xl:min-h-[13rem]" data-testid="score-distribution-chart">
      <svg
        className="block h-full min-h-0 w-full select-none overflow-visible"
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
        preserveAspectRatio="none"
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
          const y = margin.top + innerHeight * (1 - ratio)
          return (
            <g key={ratio}>
              <line
                x1={margin.left}
                x2={chartWidth - margin.right}
                y1={y}
                y2={y}
                stroke="var(--border-line)"
                strokeWidth="1"
              />
              <text
                x={margin.left - 7}
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
          const x = margin.left + index * bandWidth + (bandWidth - barWidth) / 2
          const y = margin.top + innerHeight - height
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
                x={margin.left + index * bandWidth}
                y={0}
                width={bandWidth}
                height={chartHeight}
                fill="transparent"
                data-testid={`score-column-hit-area-${bucket.score}`}
              />
              <rect
                x={margin.left + index * bandWidth}
                y={margin.top}
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
                  y={chartHeight - 12}
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
