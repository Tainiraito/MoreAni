import { expect, test } from '@playwright/test'

import type { CreateRedBlueComparisonResponse, RedBlueState } from '../src/types/red-blue'

interface RealE2EUser {
  id: number
  username: string
  nickname: string
  avatar_id: number
  avatar_url: string | null
  avatar_crop: Record<string, number> | null
  role: string
  created_at: string
}

interface LoginResponse {
  user: RealE2EUser
}

const frontendBaseUrl = process.env.MOREANI_REAL_E2E_BASE_URL
const backendBaseUrl = process.env.MOREANI_REAL_E2E_API_URL
const username = process.env.MOREANI_REAL_E2E_USERNAME
const password = process.env.MOREANI_REAL_E2E_PASSWORD
const enabled = Boolean(frontendBaseUrl && backendBaseUrl && username && password)

test.describe('红蓝合战真实后端烟测', () => {
  test.skip(!enabled, '设置 MOREANI_REAL_E2E_* 后运行；该测试只连接隔离 test DB。')

  test('真实页面连续提交四种选择并在刷新后保留事实', async ({ page, context }) => {
    if (!frontendBaseUrl || !backendBaseUrl || !username || !password) return

    const login = await context.request.post(`${backendBaseUrl}/api/v1/auth/login`, {
      data: { username, password },
    })
    expect(login.status()).toBe(200)
    const loginPayload = (await login.json()) as LoginResponse
    await page.addInitScript(({ user }) => {
      localStorage.setItem('moreani-auth', JSON.stringify({ state: { user, token: null }, version: 0 }))
    }, { user: loginPayload.user })

    const postResponses: CreateRedBlueComparisonResponse[] = []
    const postStatuses: number[] = []
    page.on('response', async response => {
      if (response.request().method() !== 'POST' || !response.url().endsWith('/api/v1/red-blue/comparisons')) return
      postStatuses.push(response.status())
      if (response.ok()) postResponses.push((await response.json()) as CreateRedBlueComparisonResponse)
    })

    await page.goto(`${frontendBaseUrl}/ratings/battle`)
    await expect(page.getByRole('heading', { name: '红蓝合战' })).toBeVisible()

    const outcomes = ['更喜欢红方', '更喜欢蓝方', '差不多', '跳过', '更喜欢红方', '更喜欢蓝方', '差不多', '跳过', '更喜欢红方', '更喜欢蓝方']
    const seenPairs = new Set<string>()

    for (const [index, label] of outcomes.entries()) {
      const pairCards = page.locator('[data-testid="battle-card-red"], [data-testid="battle-card-blue"]')
      const pairIds = await pairCards.evaluateAll(elements => elements.map(element => element.getAttribute('data-content-id') ?? ''))
      const pair = pairIds.map(Number).sort((left, right) => left - right).join(':')
      seenPairs.add(pair)

      await page.getByRole('button', { name: label, exact: true }).click()
      await expect.poll(() => postResponses.length).toBe(index + 1)
      const response = postResponses[index]
      expect(postStatuses[index]).toBe(200)
      expect(response.state_version).toBe(index + 1)
      expect(response.idempotent_replay).toBe(false)
      expect(response.next_pair).not.toBeNull()
      expect(response.pair_status).toBe('AVAILABLE')
      const nextPair = response.next_pair
      if (nextPair === null) return
      expect([nextPair.left.content_id, nextPair.right.content_id].sort((left, right) => left - right).join(':')).not.toBe(pair)
      await expect.poll(async () => (await page.locator('[data-testid^="battle-card-"] h3').allTextContents()).join(' vs ')).toBe(`${nextPair.left.title} vs ${nextPair.right.title}`)
    }

    expect(postStatuses).toEqual(Array.from({ length: outcomes.length }, () => 200))
    expect(seenPairs.size).toBeGreaterThan(1)

    await page.getByTestId('red-blue-ranking').evaluate(element => element.scrollIntoView({ block: 'start', behavior: 'instant' }))
    await expect(page.getByTestId('red-blue-sticky-battle')).toBeVisible()
    await page.screenshot({ path: '/tmp/moreani-red-blue-real-light-sticky.png', fullPage: false })

    const focusButton = page.locator('[data-testid^="focus-content-"]').first()
    const focusTestId = await focusButton.getAttribute('data-testid')
    expect(focusTestId).toMatch(/^focus-content-\d+$/)
    const focusContentId = Number(focusTestId?.replace('focus-content-', ''))
    await focusButton.click()
    await expect(page.getByTestId('red-blue-focus-status')).toBeVisible()
    await page.evaluate(() => document.documentElement.classList.add('dark'))
    await page.screenshot({ path: '/tmp/moreani-red-blue-real-dark-focus-sticky.png', fullPage: false })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.screenshot({ path: '/tmp/moreani-red-blue-real-mobile-focus-sticky.png', fullPage: false })
    await page.setViewportSize({ width: 1280, height: 720 })

    const stickyVoteCount = 5
    let focusedPairs = 0
    for (let index = 0; index < stickyVoteCount; index += 1) {
      const responseCountBefore = postResponses.length
      await page.getByTestId('sticky-battle-action-left_win').click()
      await expect.poll(() => postResponses.length).toBe(responseCountBefore + 1)
      const response = postResponses[responseCountBefore]
      expect(response.next_pair).not.toBeNull()
      if (response.next_pair !== null && [response.next_pair.left.content_id, response.next_pair.right.content_id].includes(focusContentId)) {
        focusedPairs += 1
      }
      const stickyIds = await page.locator('[data-testid="red-blue-sticky-battle"] [data-testid^="sticky-battle-card-"]').evaluateAll(elements => elements.map(element => Number(element.getAttribute('data-content-id'))).sort((left, right) => left - right))
      const mainIds = await page.locator('[data-testid="battle-pair"] [data-testid^="battle-card-"]').evaluateAll(elements => elements.map(element => Number(element.getAttribute('data-content-id'))).sort((left, right) => left - right))
      expect(stickyIds).toEqual(mainIds)
    }
    expect(focusedPairs).toBeGreaterThanOrEqual(2)

    await page.getByTestId('red-blue-focus-status').getByRole('button', { name: '结束重点校准' }).click()
    await expect(page.getByTestId('red-blue-focus-status')).toHaveCount(0)
    await page.evaluate(() => document.documentElement.classList.remove('dark'))

    const stateResponsePromise = page.waitForResponse(response => response.request().method() === 'GET' && new URL(response.url()).pathname === '/api/v1/red-blue/state')
    await page.reload()
    await expect(page.getByRole('heading', { name: '红蓝合战' })).toBeVisible()
    const stateResponse = await stateResponsePromise
    expect(stateResponse.status()).toBe(200)
    const refreshedState = (await stateResponse.json()) as RedBlueState
    expect(refreshedState.state_version).toBe(outcomes.length + stickyVoteCount)
    expect(refreshedState.ranking.some(item => item.comparison_count > 0)).toBe(true)
  })
})
