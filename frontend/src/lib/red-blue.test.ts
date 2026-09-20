import { describe, expect, it } from 'vitest'

import { buildRedBlueRankingChanges, normalizeRedBlueState, patchRedBlueComparisonState, patchRedBlueSuggestionAction } from '@/lib/red-blue'
import type {
  CreateRedBlueComparisonResponse,
  RedBlueState,
  ScoreSuggestionActionResponse,
} from '@/types/red-blue'

function state(): RedBlueState {
  return {
    state_version: 4,
    model_freshness: 'FULL',
    candidate_count: 2,
    pair_status: 'AVAILABLE',
    current_pair: {
      left: { content_id: 1, title: '作品 1', description: '', cover_url: null, content_type: 'anime' },
      right: { content_id: 2, title: '作品 2', description: '', cover_url: null, content_type: 'anime' },
      selector_version: 'v1',
      selection_reason: 'uncertainty',
    },
    ranking: [
      {
        content: { content_id: 1, title: '作品 1', description: '', cover_url: null, content_type: 'anime' },
        rank: 1,
        current_score: 80,
        preference_mean: 1,
        comparison_count: 3,
        stability: 'STABLE',
        rank_low: 1,
        rank_high: 1,
        score_suggestion: null,
      },
      {
        content: { content_id: 2, title: '作品 2', description: '', cover_url: null, content_type: 'anime' },
        rank: 2,
        current_score: 85,
        preference_mean: 0.8,
        comparison_count: 3,
        stability: 'RELATIVELY_STABLE',
        rank_low: 1,
        rank_high: 2,
        score_suggestion: null,
      },
    ],
    full_recalibration_required: false,
    full_recalibration_running: false,
  }
}

function comparisonResponse(): CreateRedBlueComparisonResponse {
  return {
    comparison: {
      id: 9,
      left_content_id: 1,
      right_content_id: 2,
      outcome: 'LEFT_WIN',
      client_event_id: 'event-1',
      selector_version: 'v1',
      created_at: null,
      revoked_at: null,
    },
    state_version: 5,
    ranking_delta: [
      { content_id: 1, old_rank: 1, new_rank: 2, preference_mean: 0.9, comparison_count: 4, stability: 'ORDER_UNCERTAIN', rank_low: 1, rank_high: 3 },
      { content_id: 2, old_rank: 2, new_rank: 1, preference_mean: 1.1, comparison_count: 4, stability: 'STABLE', rank_low: 1, rank_high: 1 },
    ],
    score_suggestion_delta: {
      added: [{
        id: 20,
        content_id: 2,
        suggestion_key: '2:85:90:UP',
        current_score: 85,
        suggested_score_low: 85,
        suggested_score_high: 90,
        recommended_score: 90,
        direction: 'UP',
        confidence: 0.88,
        severity: 0.7,
        reason_code: 'PREFERENCE_HIGHER_THAN_SCORE',
      }],
      updated: [],
      removed: [],
    },
    next_pair: null,
    pair_status: 'COOLDOWN',
    model_freshness: 'FAST',
    full_recalibration_required: false,
    full_recalibration_running: false,
    idempotent_replay: false,
  }
}

describe('red-blue query cache patching', () => {
  it('derives UP/DOWN/UNCHANGED from backend old_rank and new_rank', () => {
    const changes = buildRedBlueRankingChanges([
      { content_id: 1, old_rank: 10, new_rank: 4, preference_mean: 1, comparison_count: 4 },
      { content_id: 2, old_rank: 4, new_rank: 10, preference_mean: 0.8, comparison_count: 4 },
      { content_id: 3, old_rank: 4, new_rank: 4, preference_mean: 0.7, comparison_count: 4 },
    ])

    expect(changes[1]).toEqual({ old_rank: 10, new_rank: 4, direction: 'UP', amount: 6 })
    expect(changes[2]).toEqual({ old_rank: 4, new_rank: 10, direction: 'DOWN', amount: 6 })
    expect(changes[3]).toEqual({ old_rank: 4, new_rank: 4, direction: 'UNCHANGED', amount: 0 })
  })

  it('normalizes any legacy/fractional ranks into mean-ordered display ranks', () => {
    const current = state()
    const normalized = normalizeRedBlueState({
      ...current,
      ranking: [
        { ...current.ranking[0], rank: 1.5, preference_mean: 0.8 },
        { ...current.ranking[1], rank: 2.37, preference_mean: 1.0 },
      ],
    })

    expect(normalized.ranking.map(item => item.content.content_id)).toEqual([2, 1])
    expect(normalized.ranking.map(item => item.rank)).toEqual([1, 2])
  })

  it('keeps global display ranks when normalizing a later ranking page', () => {
    const current = state()
    const normalized = normalizeRedBlueState({
      ...current,
      ranking_page: 2,
      ranking_size: 100,
      ranking_total: 102,
      ranking: [
        { ...current.ranking[0], rank: 101, preference_mean: 0.8 },
        { ...current.ranking[1], rank: 102, preference_mean: 1.0 },
      ],
    })

    expect(normalized.ranking.map(item => item.content.content_id)).toEqual([2, 1])
    expect(normalized.ranking.map(item => item.rank)).toEqual([101, 102])
  })

  it('patches ranking delta and suggestion additions, then sorts by rank', () => {
    const next = patchRedBlueComparisonState(state(), comparisonResponse())
    expect(next?.state_version).toBe(5)
    expect(next?.ranking.map(item => item.content.content_id)).toEqual([2, 1])
    expect(next?.ranking[0].score_suggestion?.id).toBe(20)
    expect(next?.ranking.find(item => item.content.content_id === 1)?.stability).toBe('ORDER_UNCERTAIN')
    expect(next?.ranking.find(item => item.content.content_id === 1)?.rank_low).toBe(1)
    expect(next?.ranking.find(item => item.content.content_id === 1)?.rank_high).toBe(3)
    expect(next?.current_pair).toBeNull()
  })

  it('keeps advancing when an older backend omits score suggestion delta', () => {
    const current = state()
    const response = comparisonResponse()
    const next = patchRedBlueComparisonState(current, {
      ...response,
      score_suggestion_delta: undefined,
      next_pair: {
        left: { content_id: 3, title: '作品 3', description: '', cover_url: null, content_type: 'anime' },
        right: { content_id: 4, title: '作品 4', description: '', cover_url: null, content_type: 'anime' },
        selector_version: 'v1',
        selection_reason: 'uncertainty',
      },
    })

    expect(next?.current_pair?.left.content_id).toBe(3)
    expect(next?.current_pair?.right.content_id).toBe(4)
    expect(next?.state_version).toBe(response.state_version)
  })

  it('does not allow an older response to overwrite the cache', () => {
    const current = state()
    const response = { ...comparisonResponse(), state_version: 3 }
    expect(patchRedBlueComparisonState(current, response)).toBe(current)
  })

  it('accepts an equal state version because only a lower version is stale', () => {
    const current = state()
    const response = {
      ...comparisonResponse(),
      state_version: current.state_version,
      next_pair: {
        left: { content_id: 3, title: '作品 3', description: '', cover_url: null, content_type: 'anime' },
        right: { content_id: 4, title: '作品 4', description: '', cover_url: null, content_type: 'anime' },
        selector_version: 'v1',
        selection_reason: 'uncertainty',
      },
    }
    const next = patchRedBlueComparisonState(current, response)
    expect(next?.current_pair?.left.content_id).toBe(3)
    expect(next?.state_version).toBe(current.state_version)
  })

  it('removes a suggestion from the ranking patch when the delta marks it removed', () => {
    const current = state()
    const response = comparisonResponse()
    current.ranking[1].score_suggestion = response.score_suggestion_delta?.added[0] ?? null
    const next = patchRedBlueComparisonState(current, {
      ...response,
      score_suggestion_delta: { added: [], updated: [], removed: [20] },
    })

    expect(next?.ranking[1].score_suggestion).toBeNull()
  })

  it('patches an accepted suggestion row without refetching the full ranking', () => {
    const current = state()
    current.ranking[1].score_suggestion = comparisonResponse().score_suggestion_delta?.added[0] ?? null
    const response: ScoreSuggestionActionResponse = {
      suggestion_id: 20,
      action: 'ACCEPTED',
      current_score: 85,
      updated_score: 90,
      state_version: 4,
      updated_ranking_item: {
        ...current.ranking[1],
        current_score: 90,
        score_suggestion: null,
      },
      idempotent_replay: false,
    }
    const next = patchRedBlueSuggestionAction(current, response)
    expect(next.ranking[1].current_score).toBe(90)
    expect(next.ranking[1].score_suggestion).toBeNull()
  })
})
