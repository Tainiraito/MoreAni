import { expect, test, type Page } from '@playwright/test'

interface BattleMockState {
  stateVersion: number
  comparisons: number
  suggestionVisible: boolean
  currentScore: number
  history: Array<Record<string, unknown>>
}

const user = {
  id: 7,
  username: 'red-blue-e2e',
  nickname: '红蓝测试用户',
  avatar_id: 1,
  avatar_url: null,
  avatar_crop: null,
  role: 'user',
  created_at: '2026-01-01T00:00:00Z',
}

function content(id: number, title: string) {
  return { content_id: id, title, cover_url: null, content_type: 'anime' }
}

function getState(mock: BattleMockState) {
  return {
    state_version: mock.stateVersion,
    model_freshness: mock.comparisons === 0 ? 'BOOTSTRAP' : 'FAST',
    candidate_count: 2,
    pair_status: 'AVAILABLE',
    current_pair: {
      left: content(1, `左作品 ${mock.comparisons + 1}`),
      right: content(2, `右作品 ${mock.comparisons + 1}`),
      selector_version: 'v1',
      selection_reason: 'e2e',
    },
    ranking: [
      {
        content: content(1, '左作品'),
        rank: 1,
        current_score: 80,
        preference_mean: 1.2,
        comparison_count: mock.comparisons,
        stability: 'STABLE',
        rank_low: 1,
        rank_high: 1,
        score_suggestion: null,
      },
      {
        content: content(2, '右作品'),
        rank: 2,
        current_score: mock.currentScore,
        preference_mean: 0.8,
        comparison_count: mock.comparisons,
        stability: 'ORDER_UNCERTAIN',
        rank_low: 1,
        rank_high: 2,
        score_suggestion: mock.suggestionVisible ? {
          id: 22,
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
        } : null,
      },
    ],
    full_recalibration_required: false,
    full_recalibration_running: false,
  }
}

async function mockBattleApi(page: Page): Promise<BattleMockState> {
  const mock: BattleMockState = {
    stateVersion: 1,
    comparisons: 0,
    suggestionVisible: false,
    currentScore: 85,
    history: [],
  }

  await page.addInitScript(({ auth }) => {
    window.localStorage.setItem('moreani-auth', JSON.stringify({ state: auth, version: 0 }))
  }, { auth: { user, token: 'red-blue-e2e-token' } })

  await page.route('**/api/v1/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname
    if (path.endsWith('/auth/me')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) })
      return
    }
    if (path.endsWith('/status') && request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) })
      return
    }
    if (path === '/api/v1/red-blue/state' && request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(getState(mock)) })
      return
    }
    if (path === '/api/v1/red-blue/comparisons' && request.method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: mock.history, total: mock.history.length, page: 1, size: 100 }),
      })
      return
    }
    if (path === '/api/v1/red-blue/comparisons' && request.method() === 'POST') {
      const body = JSON.parse(request.postData() ?? '{}') as { outcome?: string; client_event_id?: string }
      mock.comparisons += 1
      mock.stateVersion += 1
      mock.suggestionVisible = mock.comparisons >= 3
      mock.history.unshift({
        id: mock.comparisons,
        left_content: { content_id: 1, title: '左作品' },
        right_content: { content_id: 2, title: '右作品' },
        left_content_id: 1,
        right_content_id: 2,
        outcome: body.outcome ?? 'SKIP',
        client_event_id: body.client_event_id ?? `event-${mock.comparisons}`,
        selector_version: 'v1',
        created_at: '2026-01-01T00:00:00Z',
        revoked_at: null,
      })
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          comparison: {
            id: mock.comparisons,
            left_content_id: 1,
            right_content_id: 2,
            outcome: body.outcome,
            client_event_id: body.client_event_id,
            selector_version: 'v1',
            created_at: '2026-01-01T00:00:00Z',
            revoked_at: null,
          },
          state_version: mock.stateVersion,
          ranking_delta: [
            { content_id: 1, old_rank: 1, new_rank: 1, preference_mean: 1.2, comparison_count: mock.comparisons },
            { content_id: 2, old_rank: 2, new_rank: 2, preference_mean: 0.8, comparison_count: mock.comparisons },
          ],
          score_suggestion_delta: {
            added: mock.suggestionVisible ? [getState(mock).ranking[1].score_suggestion] : [],
            updated: [],
            removed: [],
          },
          next_pair: getState(mock).current_pair,
          pair_status: 'AVAILABLE',
          model_freshness: 'FAST',
          full_recalibration_required: false,
          full_recalibration_running: false,
          idempotent_replay: false,
        }),
      })
      return
    }
    if (path === '/api/v1/red-blue/score-suggestions/22/actions' && request.method() === 'POST') {
      mock.suggestionVisible = false
      mock.currentScore = 90
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          suggestion_id: 22,
          action: 'ACCEPTED',
          current_score: 85,
          updated_score: 90,
          state_version: mock.stateVersion,
          updated_ranking_item: getState(mock).ranking[1],
          idempotent_replay: false,
        }),
      })
      return
    }
    if (path.includes('/red-blue/comparisons/') && path.endsWith('/revoke') && request.method() === 'POST') {
      mock.history = []
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ comparison: { id: 1, left_content_id: 1, right_content_id: 2, outcome: 'LEFT_WIN', client_event_id: 'e1', selector_version: 'v1', created_at: null, revoked_at: '2026-01-01T00:00:00Z' }, revoked: true, state_version: mock.stateVersion, model_freshness: 'STALE_REQUIRES_FULL', full_recalibration_required: true, full_recalibration_running: true }),
      })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) })
  })
  return mock
}

test.describe('红蓝合战页面', () => {
  test('可连续 PK、实时出现建议并接受建议', async ({ page }, testInfo) => {
    const mock = await mockBattleApi(page)
    await page.goto('/ratings/battle')
    await expect(page.getByRole('heading', { name: '红蓝合战' })).toBeVisible()

    for (let index = 0; index < 10; index += 1) {
      await page.getByRole('button', { name: index % 2 === 0 ? '更喜欢红方' : '更喜欢蓝方' }).click()
      await expect.poll(() => mock.comparisons).toBe(index + 1)
    }
    await expect(page.getByTestId('ranking-row-1')).toContainText('PK 10 次')

    await expect(page.getByTestId('score-suggestion-22')).toBeVisible()
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await page.screenshot({ path: `/tmp/moreani-red-blue-${testInfo.project.name}-dark-top.png`, fullPage: false })
    await page.getByTestId('red-blue-ranking').scrollIntoViewIfNeeded()
    await page.screenshot({ path: `/tmp/moreani-red-blue-${testInfo.project.name}-dark-suggestion.png`, fullPage: false })
    await page.getByRole('button', { name: '确定' }).click()
    await expect(page.getByTestId('score-suggestion-22')).toHaveCount(0)
    await expect(page.getByTestId('ranking-row-2')).toContainText('9.0')

    await page.reload()
    await expect(page.getByTestId('ranking-row-2')).toContainText('9.0')

    await page.evaluate(() => document.documentElement.classList.remove('dark'))
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: `/tmp/moreani-red-blue-${testInfo.project.name}-light-top.png`, fullPage: false })
  })

  test('可撤销上一票并在窄屏保持双列 PK 关系', async ({ page }, testInfo) => {
    await mockBattleApi(page)
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('/ratings/battle')
    await page.getByRole('button', { name: '差不多' }).click()
    await expect(page.getByTestId('red-blue-history-tab')).toHaveText('PK 历史')
    await page.getByTestId('red-blue-history-tab').click()
    await expect(page.getByTestId('comparison-history-item-1')).toBeVisible()
    await page.getByRole('button', { name: /撤销/ }).click()
    await expect(page.getByTestId('red-blue-history-empty')).toBeVisible()
    await page.getByTestId('red-blue-ranking-tab').click()
    await expect(page.getByTestId('battle-card-red')).toBeVisible()
    await expect(page.getByTestId('battle-card-blue')).toBeVisible()
    await page.screenshot({ path: `/tmp/moreani-red-blue-${testInfo.project.name}-mobile.png`, fullPage: false })
  })
})
