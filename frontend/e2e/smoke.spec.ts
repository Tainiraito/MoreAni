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
  await page.mouse.click(20, 300)
  await expect(panel).toBeHidden()
})
