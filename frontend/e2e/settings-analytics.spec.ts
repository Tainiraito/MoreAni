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

test('用户信息弹窗展示本人三列统计并可跳转全站分析', async ({ page }, testInfo) => {
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
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0 }) })
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
            title_alt: '',
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
  expect(analyticsRequests.some(url => url.searchParams.get('scope') === 'user' && url.searchParams.get('user_id') === '7')).toBe(true)

  if ((page.viewportSize()?.width ?? 0) >= 1280) {
    const left = await dialog.getByTestId('settings-profile-left').boundingBox()
    const middle = await dialog.getByTestId('settings-analytics-middle').boundingBox()
    const right = await dialog.getByTestId('settings-analytics-right').boundingBox()
    expect(left).not.toBeNull()
    expect(middle).not.toBeNull()
    expect(right).not.toBeNull()
    expect(left!.x).toBeLessThan(middle!.x)
    expect(middle!.x).toBeLessThan(right!.x)
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
