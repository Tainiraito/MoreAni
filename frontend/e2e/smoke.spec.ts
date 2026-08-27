import { expect, test } from '@playwright/test'

test('首页可以在 Chromium 中加载', async ({ page }) => {
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.route('**/api/v1/content/recommendations**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ items: [] }),
  }))

  await page.goto('/')
  await expect(page).toHaveTitle(/MoreAni/)
  await expect(page.locator('#root')).not.toBeEmpty()
  expect(pageErrors).toEqual([])
})

test('顶部通知入口可以打开公共通知面板', async ({ page }) => {
  await page.route('**/api/v1/content/recommendations**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ items: [] }),
  }))
  await page.route('**/api/v1/notifications/unread-count', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ total: 1, public: 1, private: 0 }),
  }))
  await page.route('**/api/v1/notifications?**', async route => {
    await new Promise(resolve => setTimeout(resolve, 800))
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        items: [{
          id: 1,
          scope: 'public',
          kind: 'announcement',
          title: '测试公告',
          body: '通知面板已上线',
          payload: {},
          created_at: new Date().toISOString(),
          published_at: new Date().toISOString(),
          expires_at: null,
          is_read: false,
        }, {
          id: 2,
          scope: 'public',
          kind: 'announcement',
          title: '长公告',
          body: '这是一个很长的公告正文，用于验证通知中心只对长公告提供折叠展开能力。\n第二行内容。\n第三行内容。\n第四行内容。\n第五行内容。',
          payload: {},
          created_at: new Date().toISOString(),
          published_at: new Date().toISOString(),
          expires_at: null,
          is_read: false,
        }],
        total: 1,
        unread_count: 1,
        page: 1,
        size: 30,
      }),
    })
  })

  await page.goto('/')
  await page.evaluate(() => {
    document.body.style.minHeight = '200vh'
    window.scrollTo(0, 200)
  })
  const fab = page.getByRole('button', { name: '打开通知' })
  await expect(fab).toBeVisible()
  await expect(fab.locator('span')).toHaveText('1')
  await fab.click()
  const panel = page.getByRole('dialog', { name: '通知中心' })
  const initialHeight = (await panel.boundingBox())?.height
  await expect(panel.getByLabel('通知加载中')).toBeVisible()
  await expect(panel.locator('[data-slot="skeleton"]')).toHaveCount(12)
  await expect(panel).toContainText('测试公告')
  await expect(panel.getByText('展开公告')).toHaveCount(1)
  await expect(panel.getByRole('button', { name: /测试公告/ })).not.toHaveAttribute('aria-expanded', 'true')
  await panel.getByText('展开公告').click()
  await expect(panel.getByText('收起公告')).toBeVisible()
  await expect(panel.getByRole('button', { name: '公共' })).toBeVisible()
  await expect(panel.getByRole('button', { name: '私人' })).toBeVisible()
  await expect(panel.getByRole('button', { name: '全部' })).toHaveCount(0)
  expect((await panel.boundingBox())?.height).toBe(initialHeight)
  if (process.env.QA_SCREENSHOTS === '1') {
    await page.screenshot({ path: '/tmp/moreani-notification-panel.png', fullPage: false })
  }
  await panel.getByRole('button', { name: '私人' }).click()
  await expect(panel).toContainText('登录后可以关注字幕组并接收资源更新通知')
  await expect(panel.getByRole('button', { name: '关闭通知' })).toHaveCount(0)
  await fab.click()
  await expect(panel).toBeHidden()
})

test('私人番剧动态通知可以打开对应详情', async ({ page }) => {
  const user = {
    id: 7,
    username: 'activity-e2e',
    nickname: '动态测试用户',
    avatar_id: 1,
    avatar_url: null,
    avatar_crop: null,
    role: 'user',
    created_at: '2026-01-01T00:00:00Z',
  }
  const detailContent = {
    id: 88,
    title: '通知目标番剧',
    title_alt: '',
    cover_url: '',
    description: '动态通知跳转测试',
    content_type: 'anime',
    episodes: 12,
    status: 'active',
    release_date: '2026-04-01',
    platform: 'TV',
    source_type: 'bangumi',
    source_id: '1002',
    source_url: 'https://bgm.tv/subject/1002',
    metadata: {},
    is_public: true,
    created_by: 1,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    avg_score: 0,
    rating_count: 0,
    review_count: 0,
    tags: [],
    recent_reviews: [],
  }

  await page.addInitScript(({ auth }) => {
    window.localStorage.setItem('moreani-auth', JSON.stringify({ state: auth, version: 0 }))
  }, { auth: { user, token: 'activity-e2e-token', isGuest: false } })

  await page.route('**/api/v1/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname

    if (path.endsWith('/auth/me')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) })
      return
    }
    if (path.endsWith('/content/recommendations')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) })
      return
    }
    if (path === '/api/v1/content/88') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(detailContent) })
      return
    }
    if (path.endsWith('/rating/content/88')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0 }) })
      return
    }
    if (path.endsWith('/notifications/unread-count')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ total: 1, public: 0, private: 1 }) })
      return
    }
    if (path.endsWith('/notifications/refresh')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ created: 0 }) })
      return
    }
    if (path === '/api/v1/notifications') {
      const isPrivate = url.searchParams.get('scope') === 'private'
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: isPrivate ? [{
            id: 31,
            scope: 'private',
            kind: 'content_activity',
            title: '通知目标番剧有新的动态',
            body: '另一位用户对《通知目标番剧》进行了评论',
            payload: { content_id: 88, rating_id: 12 },
            created_at: new Date().toISOString(),
            published_at: new Date().toISOString(),
            expires_at: null,
            is_read: false,
          }] : [],
          total: isPrivate ? 1 : 0,
          unread_count: isPrivate ? 1 : 0,
          page: 1,
          size: 30,
        }),
      })
      return
    }
    if (path.endsWith('/status')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) })
  })

  await page.goto('/')
  await page.evaluate(() => {
    document.body.style.minHeight = '200vh'
    window.scrollTo(0, 200)
  })
  const fab = page.getByRole('button', { name: '打开通知' })
  await fab.click()
  const panel = page.getByRole('dialog', { name: '通知中心' })
  await panel.getByRole('button', { name: '私人' }).click()
  const activity = panel.getByRole('button', { name: /通知目标番剧有新的动态/ })
  await expect(activity).toBeVisible()
  await activity.click()
  await expect(page.getByRole('heading', { name: '通知目标番剧' })).toBeVisible()
  await expect(panel).toHaveCount(0)
})
