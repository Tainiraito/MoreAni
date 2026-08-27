import { expect, test } from '@playwright/test'

test('首次打开后台管理不刷新页面并正确显示公告内容', async ({ page }) => {
  const user = {
    id: 1,
    username: 'admin-e2e',
    nickname: '管理员',
    avatar_id: 1,
    avatar_url: null,
    avatar_crop: null,
    role: 'super_admin',
    created_at: '2026-01-01T00:00:00Z',
  }
  const longBody = 'A'.repeat(280)
  let adminUserRequests = 0

  await page.addInitScript(({ auth }) => {
    window.localStorage.setItem('moreani-auth', JSON.stringify({ state: auth, version: 0 }))
  }, { auth: { user, token: 'admin-e2e-token', isGuest: false } })

  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url())
    const path = url.pathname

    if (path.endsWith('/auth/me')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(user) })
      return
    }
    if (path.endsWith('/content/recommendations')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) })
      return
    }
    if (path.endsWith('/content/random')) {
      await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ detail: 'No content available' }) })
      return
    }
    if (path === '/api/v1/content') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, page: 1, size: 20 }) })
      return
    }
    if (path.endsWith('/content/seasons') || path.endsWith('/user/list')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) })
      return
    }
    if (path.endsWith('/status')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) })
      return
    }
    if (path.endsWith('/notifications/unread-count')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ total: 0, public: 0, private: 0 }) })
      return
    }
    if (path.endsWith('/admin/users')) {
      adminUserRequests += 1
      await new Promise(resolve => setTimeout(resolve, 150))
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0, page: 1, size: 15 }) })
      return
    }
    if (path.endsWith('/admin/announcements')) {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [{
            id: 1,
            title: '超长公告',
            body: longBody,
            is_published: true,
            published_at: '2026-08-25T12:53:00Z',
            expires_at: null,
            created_at: '2026-08-25T12:53:00Z',
          }],
          total: 1,
          page: 1,
          size: 50,
        }),
      })
      return
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) })
  })

  await page.goto('/')
  let navigations = 0
  page.on('framenavigated', frame => {
    if (frame === page.mainFrame()) navigations += 1
  })
  await page.evaluate(() => window.scrollTo(0, 200))
  await page.getByRole('button', { name: '打开用户菜单' }).click()
  await page.getByRole('button', { name: '后台管理' }).click()

  await expect(page.getByRole('heading', { name: '后台管理' })).toBeVisible()
  expect(navigations).toBe(0)
  expect(adminUserRequests).toBe(1)

  await page.getByRole('button', { name: '公共通知' }).click()
  await expect(page.getByText('超长公告')).toBeVisible()
  await expect(page.getByText('发布于 2026/08/25 20:53')).toBeVisible()
  await expect(page.getByText(/创建于/)).toHaveCount(0)

  const bodyMetrics = await page.getByText(longBody).evaluate(element => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }))
  expect(bodyMetrics.scrollWidth).toBeLessThanOrEqual(bodyMetrics.clientWidth)

  await page.getByRole('button', { name: '新建通知' }).click()
  await page.getByText('留空立即发布').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  await page.getByText('选择日期').click()
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
