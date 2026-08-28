import { expect, test } from '@playwright/test'

const currentUser = {
  id: 7,
  username: 'analytics-e2e',
  nickname: '分析测试用户',
  avatar_id: 0,
  avatar_url: null,
  avatar_crop: null,
  role: 'user',
  created_at: '2026-01-01T00:00:00Z',
}

const targetUser = {
  ...currentUser,
  id: 8,
  username: 'analytics-target',
  nickname: '目标成员',
}

const distribution = Array.from({ length: 20 }, (_, index) => ({
  score: (index + 1) / 2,
  count: index % 3 === 0 ? index + 1 : 0,
}))

test('统计分析支持默认全站、双端筛选、URL 状态和主题切换', async ({ page }) => {
  await page.addInitScript(({ auth }) => {
    window.localStorage.setItem('moreani-theme', 'dark')
    window.localStorage.setItem('moreani-auth', JSON.stringify({ state: auth, version: 0 }))
  }, { auth: { user: currentUser, token: 'analytics-e2e-token', isGuest: false } })

  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url())
    const path = url.pathname
    if (path.endsWith('/auth/me')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(currentUser) })
      return
    }
    if (path.endsWith('/user/list')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [currentUser, targetUser] }) })
      return
    }
    if (path.endsWith('/notifications/unread-count')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ total: 0, public: 0, private: 0 }) })
      return
    }
    if (path.endsWith('/analytics/overview')) {
      const userScope = url.searchParams.get('scope') === 'user'
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          scope: userScope ? { type: 'user', user: targetUser } : { type: 'global', user: null },
          min_score: Number(url.searchParams.get('min_score') ?? 0.5),
          max_score: Number(url.searchParams.get('max_score') ?? 10),
          rating_count: 18,
          title_count: 12,
          user_count: userScope ? 1 : 3,
          average_score: 8.2,
          score_distribution: distribution,
          frequency_tags: [
            { name: '恋爱', weight: 10, rating_count: 10, title_count: 8, average_score: 8.4 },
            { name: '奇幻', weight: 7, rating_count: 7, title_count: 6, average_score: 8.1 },
          ],
          weighted_tags: [
            { name: '恋爱', weight: 8.4, rating_count: 10, title_count: 8, average_score: 8.4 },
          ],
          favorites: [],
        }),
      })
      return
    }
    if (path.endsWith('/analytics/recommendations')) {
      const userScope = url.searchParams.get('scope') === 'user'
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          scope: userScope ? { type: 'user', user: targetUser } : { type: 'global', user: null },
          profile_rating_count: 18,
          confidence: 'medium',
          basis: userScope ? 'blended' : 'global',
          items: [],
        }),
      })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) })
  })

  await page.goto('/analytics')
  await expect(page.getByRole('heading', { name: '统计分析', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '全站分析' })).toBeVisible()
  await expect(page.getByRole('link', { name: '打开统计分析' })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByRole('button', { name: '评分加权' })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByText('查看标签明细')).toHaveCount(0)
  await expect(page).toHaveURL(/\/analytics$/)

  if ((page.viewportSize()?.width ?? 0) >= 1280) {
    const distributionPanel = await page.getByTestId('rating-distribution-panel').boundingBox()
    const cloudPanel = await page.getByTestId('tag-cloud-panel').boundingBox()
    expect(distributionPanel).not.toBeNull()
    expect(cloudPanel).not.toBeNull()
    expect(Math.abs(distributionPanel!.height - cloudPanel!.height)).toBeLessThanOrEqual(1)
  }

  const minimum = page.getByRole('slider', { name: '最低评分' })
  const maximum = page.getByRole('slider', { name: '最高评分' })
  const minimumResponse = page.waitForResponse(response => (
    response.url().includes('/analytics/overview')
    && response.url().includes('min_score=6')
  ))
  await minimum.focus()
  for (let step = 0; step < 11; step += 1) await page.keyboard.press('ArrowRight')
  await expect(page.getByText('6.0 – 10.0', { exact: true })).toBeVisible()
  await minimumResponse

  const maximumResponse = page.waitForResponse(response => (
    response.url().includes('/analytics/overview')
    && response.url().includes('max_score=8.5')
  ))
  await maximum.focus()
  for (let step = 0; step < 3; step += 1) await page.keyboard.press('ArrowLeft')
  await expect(page.getByText('6.0 – 8.5', { exact: true })).toBeVisible()
  await maximumResponse

  const tenPointColumn = page.getByRole('button', { name: '10.0 分，共 0 条评分，点击仅查看该评分' })
  const columnBounds = await tenPointColumn.boundingBox()
  const minimumColumnHeight = (page.viewportSize()?.width ?? 0) >= 1280 ? 150 : 80
  expect(columnBounds?.height).toBeGreaterThan(minimumColumnHeight)
  const singleScoreResponse = page.waitForResponse(response => (
    response.url().includes('/analytics/overview')
    && response.url().includes('min_score=10')
    && response.url().includes('max_score=10')
  ))
  await tenPointColumn.click()
  await expect(page.getByText('10.0 – 10.0', { exact: true })).toBeVisible()
  await singleScoreResponse

  const rangeTrack = page.getByTestId('score-range-track')
  const trackBounds = await rangeTrack.boundingBox()
  expect(trackBounds).not.toBeNull()
  const expandedRangeResponse = page.waitForResponse(response => (
    response.url().includes('/analytics/overview')
    && response.url().includes('min_score=8')
    && response.url().includes('max_score=10')
  ))
  const maximumX = trackBounds!.x + trackBounds!.width - 1
  const eightPointX = trackBounds!.x + ((8 - 0.5) / (10 - 0.5)) * trackBounds!.width
  const trackY = trackBounds!.y + trackBounds!.height / 2
  await page.mouse.move(maximumX, trackY)
  await page.mouse.down()
  await page.mouse.move(eightPointX, trackY, { steps: 4 })
  await page.mouse.up()
  await expect(page.getByText('8.0 – 10.0', { exact: true })).toBeVisible()
  await expandedRangeResponse

  await page.getByRole('button', { name: '全站分析' }).click()
  await page.getByRole('option', { name: '目标成员' }).click()
  await expect(page).toHaveURL(/scope=user&user_id=8/)
  await page.goBack()
  await expect(page.getByRole('button', { name: '全站分析' })).toBeVisible()

  await page.getByRole('button', { name: '打开用户菜单' }).click()
  await page.getByRole('button', { name: '浅色模式' }).click()
  await expect(page.locator('html')).not.toHaveClass(/dark/)

  const layout = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }))
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth)
})
