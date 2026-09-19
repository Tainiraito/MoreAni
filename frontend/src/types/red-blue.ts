import type { ContentType } from '@/types'

export type RedBlueOutcome = 'LEFT_WIN' | 'RIGHT_WIN' | 'TIE' | 'SKIP'
export type RedBluePairStatus = 'AVAILABLE' | 'INSUFFICIENT_CANDIDATES' | 'COOLDOWN'
export type RedBlueModelFreshness = 'FULL' | 'FAST' | 'BOOTSTRAP' | 'STALE_REQUIRES_FULL'
export type RedBlueStability =
  | 'UNCALIBRATED'
  | 'CALIBRATING'
  | 'RELATIVELY_STABLE'
  | 'STABLE'
  | 'ORDER_UNCERTAIN'

export type RedBlueSuggestionDirection = 'UP' | 'DOWN'
export type RedBlueSuggestionAction = 'ACCEPTED' | 'DISMISSED' | 'REJECTED'

export interface RedBlueContentSummary {
  content_id: number
  title: string
  cover_url: string | null
  content_type: ContentType | string
}

export interface RedBluePair {
  left: RedBlueContentSummary
  right: RedBlueContentSummary
  selector_version: string
  selection_reason: string
}

export interface RedBlueScoreSuggestion {
  id: number
  content_id: number
  suggestion_key: string
  current_score: number
  suggested_score_low: number
  suggested_score_high: number
  recommended_score: number
  direction: RedBlueSuggestionDirection
  confidence: number
  severity: number
  reason_code: string
}

export interface RedBlueRankingItem {
  content: RedBlueContentSummary
  rank: number
  current_score: number
  preference_mean: number
  comparison_count: number
  stability: RedBlueStability | string
  rank_low: number | null
  rank_high: number | null
  score_suggestion: RedBlueScoreSuggestion | null
}

export interface RedBlueState {
  state_version: number
  model_freshness: RedBlueModelFreshness | string
  candidate_count: number
  pair_status: RedBluePairStatus | string
  current_pair: RedBluePair | null
  ranking: RedBlueRankingItem[]
  full_recalibration_required: boolean
  full_recalibration_running: boolean
}

export interface RedBlueRankingDelta {
  content_id: number
  old_rank: number | null
  new_rank: number
  preference_mean: number
  comparison_count: number
}

export type RedBlueRankingChangeDirection = 'UP' | 'DOWN'

export interface RedBlueRankingChange {
  old_rank: number
  new_rank: number
  direction: RedBlueRankingChangeDirection
  amount: number
}

export interface RedBlueScoreSuggestionDelta {
  added: RedBlueScoreSuggestion[]
  updated: RedBlueScoreSuggestion[]
  /** 这里是被移除的 suggestion id，而不是 content id。 */
  removed: number[]
}

export interface CreateRedBlueComparisonRequest {
  left_content_id: number
  right_content_id: number
  outcome: RedBlueOutcome
  client_event_id: string
  /** 只影响本次响应的下一组 Pair，不是可恢复的排名事实。 */
  focus_content_id?: number
}

export interface RedBlueComparison {
  id: number
  left_content_id: number
  right_content_id: number
  outcome: RedBlueOutcome
  client_event_id: string
  selector_version: string
  created_at: string | null
  revoked_at: string | null
}

export interface CreateRedBlueComparisonResponse {
  comparison: RedBlueComparison
  state_version: number
  ranking_delta: RedBlueRankingDelta[]
  /** 兼容仍在运行的阶段 5.1 旧开发服务；缺失时按空增量处理。 */
  score_suggestion_delta?: RedBlueScoreSuggestionDelta
  next_pair: RedBluePair | null
  pair_status: RedBluePairStatus | string
  model_freshness: RedBlueModelFreshness | string
  full_recalibration_required: boolean
  full_recalibration_running: boolean
  idempotent_replay: boolean
}

export interface RevokeRedBlueComparisonResponse {
  comparison: RedBlueComparison
  revoked: boolean
  state_version: number
  model_freshness: RedBlueModelFreshness | string
  full_recalibration_required: boolean
  full_recalibration_running: boolean
}

export interface ScoreSuggestionActionRequest {
  action: RedBlueSuggestionAction
  suggestion_key: string
  client_event_id: string
}

export interface ScoreSuggestionActionResponse {
  suggestion_id: number
  action: RedBlueSuggestionAction
  current_score: number
  updated_score: number
  state_version: number
  updated_ranking_item: RedBlueRankingItem | null
  idempotent_replay: boolean
}
