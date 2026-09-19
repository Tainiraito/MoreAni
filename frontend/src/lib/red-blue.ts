import type {
  CreateRedBlueComparisonResponse,
  RedBlueRankingChange,
  RedBlueRankingDelta,
  RedBlueRankingItem,
  RedBlueScoreSuggestion,
  RedBlueState,
  ScoreSuggestionActionResponse,
} from '@/types/red-blue'

export const RED_BLUE_STATE_QUERY_KEY = ['red-blue', 'state'] as const

function byDisplayOrder(left: RedBlueRankingItem, right: RedBlueRankingItem): number {
  return right.preference_mean - left.preference_mean
    || left.rank - right.rank
    || left.content.content_id - right.content.content_id
}

export function sortRedBlueRanking(ranking: RedBlueRankingItem[]): RedBlueRankingItem[] {
  return [...ranking]
    .sort(byDisplayOrder)
    .map((item, index) => ({ ...item, rank: index + 1 }))
}

export function normalizeRedBlueState(state: RedBlueState): RedBlueState {
  return {
    ...state,
    ranking: sortRedBlueRanking(state.ranking),
  }
}

export function buildRedBlueRankingChanges(
  deltas: RedBlueRankingDelta[],
): Record<number, RedBlueRankingChange> {
  const changes: Record<number, RedBlueRankingChange> = {}
  for (const delta of deltas) {
    if (delta.old_rank === null || delta.old_rank === delta.new_rank) continue
    const movedUp = delta.new_rank < delta.old_rank
    changes[delta.content_id] = {
      old_rank: delta.old_rank,
      new_rank: delta.new_rank,
      direction: movedUp ? 'UP' : 'DOWN',
      amount: Math.abs(delta.new_rank - delta.old_rank),
    }
  }
  return changes
}

function applySuggestionDelta(
  item: RedBlueRankingItem,
  response: CreateRedBlueComparisonResponse,
): RedBlueRankingItem {
  // 阶段 5.1 之前的开发后端可能仍在运行旧的响应契约，不会返回
  // score_suggestion_delta。评分建议增量只是当前排名的附属 patch，不能
  // 因为兼容旧服务而阻断更关键的 next_pair 状态推进。
  const { added, updated, removed } = response.score_suggestion_delta ?? {
    added: [],
    updated: [],
    removed: [],
  }
  const suggestion = [...added, ...updated].find(candidate => candidate.content_id === item.content.content_id)
  if (suggestion !== undefined) return { ...item, score_suggestion: suggestion }
  if (item.score_suggestion != null && removed.includes(item.score_suggestion.id)) {
    return { ...item, score_suggestion: null }
  }
  return item
}

export function patchRedBlueComparisonState(
  current: RedBlueState,
  response: CreateRedBlueComparisonResponse,
): RedBlueState | null {
  if (response.state_version < current.state_version) return current

  const deltasByContent = new Map(response.ranking_delta.map(delta => [delta.content_id, delta]))
  const ranking = current.ranking.map(item => {
    const delta = deltasByContent.get(item.content.content_id)
    const patched = delta
      ? {
        ...item,
        rank: delta.new_rank,
        preference_mean: delta.preference_mean,
        comparison_count: delta.comparison_count,
      }
      : item
    return applySuggestionDelta(patched, response)
  })

  const deltaIds = new Set(response.ranking_delta.map(delta => delta.content_id))
  if ([...deltaIds].some(contentId => !current.ranking.some(item => item.content.content_id === contentId))) {
    return null
  }

  return {
    ...current,
    state_version: response.state_version,
    model_freshness: response.model_freshness,
    pair_status: response.pair_status,
    current_pair: response.next_pair,
    full_recalibration_required: response.full_recalibration_required,
    full_recalibration_running: response.full_recalibration_running,
    ranking: sortRedBlueRanking(ranking),
  }
}

export function patchRedBlueSuggestionAction(
  current: RedBlueState,
  response: ScoreSuggestionActionResponse,
): RedBlueState {
  if (response.state_version < current.state_version || response.updated_ranking_item === null) return current

  const ranking = current.ranking.map(item =>
    item.content.content_id === response.updated_ranking_item?.content.content_id
      ? response.updated_ranking_item
      : item,
  )

  return {
    ...current,
    state_version: Math.max(current.state_version, response.state_version),
    ranking: sortRedBlueRanking(ranking),
  }
}

export function getSuggestionById(
  ranking: RedBlueRankingItem[],
  suggestionId: number,
): RedBlueScoreSuggestion | null {
  return ranking.find(item => item.score_suggestion?.id === suggestionId)?.score_suggestion ?? null
}
