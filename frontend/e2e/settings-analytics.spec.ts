import { expect, test } from '@playwright/test'

const currentUser = {
  id: 7,
  username: 'profile-analytics-e2e',
  nickname: '个人分析用户',
  avatar_id: 0,
  avatar_url: null,
  avatar_crop: null,
  role: 'user',
  created_at: '2026-01-01T00:00:00Z',
}

const distribution = Array.from({ length: 20 }, (_, index) => ({
  score: (index + 1) / 2,
  count: index % 4 === 0 ? index + 2 : 1,
}))

const tags = ['治愈', '日常', '恋爱', '校园', '奇幻', '青春', '搞笑', '冒险'].map((name, index) => ({
  name,
  weight: 18 - index,
  rating_count: 12 - index,
  title_count: 9 - index,
  average_score: 8.8 - index * 0.1,
}))

const activityItems = Array.from({ length: 12 }, (_, index) => ({
  type: index % 3 === 0 ? 'rating' : 'review',
  content_id: 300 + index,
  content_title: `动态番剧 ${index + 1}`,
  content_cover: '',
  content_type: 'anime',
  score: index % 3 === 0 ? 85 : null,
  review: index % 3 === 0 ? '' : `这是一条动态 ${index + 1}`,
  updated_at: '2026-08-27T00:00:00Z',
}))

test('用户信息弹窗展示本人四个统计区域并可跳转全站分析', async ({ page }, testInfo) => {
  const browserErrors: string[] = []
  const analyticsRequests: URL[] = []
  page.on('pageerror', error => browserErrors.push(error.message))
  page.on('console', message => {
    if (message.type() === 'error') browserErrors.push(message.text())
  })
  await page.addInitScript(({ auth }) => {
    window.localStorage.setItem('moreani-theme', 'dark')
    window.localStorage.setItem('moreani-auth', JSON.stringify({ state: auth, version: 0 }))
  }, { auth: { user: currentUser, token: 'profile-analytics-token', isGuest: false } })
  if (testInfo.project.name === 'chromium') {
    await page.setViewportSize({ width: 1600, height: 1000 })
  }

  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url())
    const path = url.pathname
    if (path.endsWith('/auth/me')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(currentUser) })
      return
    }
    if (path.endsWith('/user/list')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [currentUser] }) })
      return
    }
    if (path.endsWith('/user/7/activity')) {
      const page = Number(url.searchParams.get('page') || '1')
      const start = (page - 1) * 10
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: activityItems.slice(start, start + 10), total: activityItems.length }),
      })
      return
    }
    if (path.endsWith('/user/7')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...currentUser, rating_count: 12, review_count: 4, favorite_count: 6, avg_score: 86 }),
      })
      return
    }
    if (path.endsWith('/notifications/unread-count')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ total: 0, public: 0, private: 0 }) })
      return
    }
    if (path.endsWith('/analytics/overview')) {
      analyticsRequests.push(url)
      const userScope = url.searchParams.get('scope') === 'user'
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          scope: userScope ? { type: 'user', user: currentUser } : { type: 'global', user: null },
          min_score: 0.5,
          max_score: 10,
          rating_count: 12,
          title_count: 12,
          user_count: 1,
          average_score: 8.6,
          score_distribution: distribution,
          frequency_tags: tags,
          weighted_tags: tags,
          favorites: Array.from({ length: 3 }, (_, index) => ({
            id: 100 + index,
            title: `个人代表作 ${index + 1}`,
            title_alt: `日本語标题 ${index + 1}`,
            cover_url: '',
            content_type: 'anime',
            score: 9.5 - index * 0.5,
            average_score: 8.8 - index * 0.2,
            rating_count: 10 + index,
          })),
        }),
      })
      return
    }
    if (path.endsWith('/analytics/recommendations')) {
      analyticsRequests.push(url)
      const userScope = url.searchParams.get('scope') === 'user'
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          scope: userScope ? { type: 'user', user: currentUser } : { type: 'global', user: null },
          profile_rating_count: 12,
          confidence: 'medium',
          basis: userScope ? 'blended' : 'global',
          items: Array.from({ length: 3 }, (_, index) => ({
            id: 200 + index,
            title: `可能喜欢 ${index + 1}`,
            title_alt: '',
            cover_url: '',
            content_type: 'anime',
            match_percent: 86 - index * 4,
            confidence: 'medium',
            matched_tags: ['治愈', '日常'],
            basis: userScope ? 'blended' : 'global',
            average_score: 8.7 - index * 0.1,
            rating_count: 20 + index,
          })),
        }),
      })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) })
  })

  await page.goto('/analytics?scope=user&user_id=7')
  await page.getByRole('button', { name: '打开用户菜单' }).click()
  await page.getByRole('button', { name: '用户信息' }).click()

  const dialog = page.getByRole('dialog', { name: '用户信息' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByTestId('settings-profile-left')).toContainText('个人分析用户')
  await expect(dialog.getByRole('heading', { name: '评分分布' })).toBeVisible()
  await expect(dialog.getByRole('heading', { name: '标签词云' })).toBeVisible()
  await expect(dialog.getByRole('heading', { name: '当前最喜欢' })).toBeVisible()
  await expect(dialog.getByRole('heading', { name: '可能喜欢' })).toBeVisible()
  await expect(dialog.getByText('个人代表作 1')).toBeVisible()
  await expect(dialog.getByText('可能喜欢 1')).toBeVisible()
  await expect(dialog.getByText('日本語标题 1')).toHaveCount(0)
  await expect(dialog.getByText('MoreAni v2.0 — 又看一集')).toHaveCount(0)
  expect(analyticsRequests.some(url => url.searchParams.get('scope') === 'user' && url.searchParams.get('user_id') === '7')).toBe(true)

  const dialogBeforeLoadMore = await dialog.boundingBox()
  const chartBeforeLoadMore = await dialog.getByTestId('settings-panel-score-distribution').boundingBox()
  const cloudBeforeLoadMore = await dialog.getByTestId('settings-panel-tag-cloud').boundingBox()
  await expect(dialog.getByRole('button', { name: '加载更多（10/12）' })).toBeVisible()
  await dialog.getByRole('button', { name: '加载更多（10/12）' }).click()
  await expect(dialog.getByRole('button', { name: '加载更多（12/12）' })).toHaveCount(0)
  const dialogAfterLoadMore = await dialog.boundingBox()
  const chartAfterLoadMore = await dialog.getByTestId('settings-panel-score-distribution').boundingBox()
  const cloudAfterLoadMore = await dialog.getByTestId('settings-panel-tag-cloud').boundingBox()
  expect(dialogAfterLoadMore).not.toBeNull()
  expect(chartAfterLoadMore).not.toBeNull()
  expect(cloudAfterLoadMore).not.toBeNull()
  expect(Math.abs(dialogBeforeLoadMore!.height - dialogAfterLoadMore!.height)).toBeLessThan(1)
  expect(Math.abs(chartBeforeLoadMore!.height - chartAfterLoadMore!.height)).toBeLessThan(1)
  expect(Math.abs(cloudBeforeLoadMore!.height - cloudAfterLoadMore!.height)).toBeLessThan(1)

  if ((page.viewportSize()?.width ?? 0) >= 1280) {
    const left = await dialog.getByTestId('settings-profile-left').boundingBox()
    const analytics = await dialog.getByTestId('settings-analytics-grid').boundingBox()
    expect(left).not.toBeNull()
    expect(analytics).not.toBeNull()
    expect(left!.x).toBeLessThan(analytics!.x)
    expect(Math.abs(left!.height - analytics!.height)).toBeLessThan(1)

    const score = await dialog.getByTestId('settings-panel-score-distribution').boundingBox()
    const tags = await dialog.getByTestId('settings-panel-tag-cloud').boundingBox()
    const favorites = await dialog.getByTestId('settings-panel-current-favorites').boundingBox()
    const recommendations = await dialog.getByTestId('settings-panel-recommendations').boundingBox()
    expect(score).not.toBeNull()
    expect(tags).not.toBeNull()
    expect(favorites).not.toBeNull()
    expect(recommendations).not.toBeNull()
    expect(score!.x).toBeLessThan(tags!.x)
    expect(score!.y).toBeLessThan(favorites!.y)
    expect(tags!.y).toBeLessThan(recommendations!.y)
  } else if ((page.viewportSize()?.width ?? 0) < 640) {
    const score = await dialog.getByTestId('settings-panel-score-distribution').boundingBox()
    const tags = await dialog.getByTestId('settings-panel-tag-cloud').boundingBox()
    const favorites = await dialog.getByTestId('settings-panel-current-favorites').boundingBox()
    const recommendations = await dialog.getByTestId('settings-panel-recommendations').boundingBox()
    expect(score).not.toBeNull()
    expect(tags).not.toBeNull()
    expect(favorites).not.toBeNull()
    expect(recommendations).not.toBeNull()
    expect(score!.x).toBeCloseTo(tags!.x, 0)
    expect(tags!.y).toBeLessThan(favorites!.y)
    expect(favorites!.y).toBeLessThan(recommendations!.y)
  }

  const grid = dialog.getByTestId('settings-profile-grid')
  await expect(grid).not.toHaveClass(/overflow-y-auto/)
  await expect(dialog).toHaveClass(/overflow-hidden/)
  await expect(dialog.getByTestId('settings-panel-score-distribution')).not.toHaveClass(/overflow-y-auto/)
  await expect(dialog.getByTestId('settings-panel-tag-cloud')).not.toHaveClass(/overflow-y-auto/)
  await expect(dialog.getByTestId('settings-current-favorites-scroll')).toHaveClass(/flex-1/)
  await expect(dialog.getByTestId('settings-current-favorites-scroll')).toHaveClass(/overflow-y-auto/)
  await expect(dialog.getByTestId('settings-recommendations-scroll')).toHaveClass(/flex-1/)
  await expect(dialog.getByTestId('settings-recommendations-scroll')).toHaveClass(/overflow-y-auto/)
  await expect(dialog.getByTestId('analytics-favorite-card')).toHaveCount(3)
  await expect(dialog.getByTestId('analytics-recommendation-card')).toHaveCount(3)
  if ((page.viewportSize()?.width ?? 0) < 640) {
    for (const listTestId of ['settings-current-favorites-scroll', 'settings-recommendations-scroll']) {
      const cardBounds = await dialog.getByTestId(listTestId).evaluate(list => {
        const listBounds = list.getBoundingClientRect()
        const cards = Array.from(list.querySelectorAll<HTMLElement>('[data-testid$="-card"]'))
        return {
          listBottom: listBounds.bottom,
          cardBottoms: cards.map(card => card.getBoundingClientRect().bottom),
        }
      })
      expect(cardBounds.cardBottoms).toHaveLength(3)
      expect(cardBounds.cardBottoms.every(bottom => bottom <= cardBounds.listBottom + 1)).toBe(true)
    }
  }

  await expect(page.locator('vite-error-overlay')).toHaveCount(0)
  expect(browserErrors).toEqual([])
  if (process.env.QA_SCREENSHOTS === '1') {
    await page.screenshot({ path: `/tmp/moreani-user-analytics-dialog-${testInfo.project.name}.png`, fullPage: false })
  }

  await dialog.getByRole('button', { name: '全站分析' }).click()
  await expect(page).toHaveURL(/\/analytics$/)
  await expect(dialog).toBeHidden()
})
