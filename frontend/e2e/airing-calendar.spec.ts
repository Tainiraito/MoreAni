import { expect, test } from '@playwright/test'

test('未关联周历条目可以添加番剧或前往 Bangumi', async ({ page }) => {
  const user = {
    id: 7,
    username: 'calendar-e2e',
    nickname: '周历测试用户',
    avatar_id: 1,
    avatar_url: null,
    avatar_crop: null,
    role: 'user',
    created_at: '2026-01-01T00:00:00Z',
  }
  const calendarItem = {
    subject_id: 1002,
    content_id: null,
    matched: false,
    title: '未关联周历番剧',
    title_alt: 'Unmatched Weekly Anime',
    cover_url: '',
    bangumi_url: 'https://bgm.tv/subject/1002',
  }
  let createPayload: Record<string, unknown> | null = null
  let detailShouldFail = false

  await page.addInitScript(({ auth }) => {
    window.localStorage.setItem('moreani-auth', JSON.stringify({ state: auth, version: 0 }))
  }, { auth: { user, token: 'calendar-e2e-token', isGuest: false } })

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
    if (path.endsWith('/content/random')) {
      await route.fulfill({ status: 204 })
      return
    }
    if (path === '/api/v1/content' && request.method() === 'POST') {
      createPayload = request.postDataJSON() as Record<string, unknown>
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 88 }) })
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
    if (path.endsWith('/airing/week')) {
      const days = Array.from({ length: 7 }, (_, index) => ({
        date: `2026-08-${24 + index}`,
        weekday: index + 1,
        label: `星期${index + 1}`,
        is_today: index === 2,
        items: [calendarItem],
      }))
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          timezone: 'Asia/Shanghai',
          week_start: '2026-08-24',
          last_synced_at: '2026-08-25T04:10:00Z',
          sync_status: 'success',
          days,
        }),
      })
      return
    }
    if (path.endsWith('/bangumi/detail/1002')) {
      if (detailShouldFail) {
        await route.fulfill({
          status: 502,
          contentType: 'application/json',
          body: JSON.stringify({ detail: 'Bangumi 服务暂时不可用，请稍后重试' }),
        })
        return
      }
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          bgm_id: 1002,
          name: 'Unmatched Weekly Anime',
          name_cn: '精确周历番剧',
          cover_url: 'https://img.example/weekly.jpg',
          summary: '通过周历 subject_id 获取的简介',
          eps: 12,
          air_date: '2026-04-01',
          platform: 'TV',
          tags: ['奇幻'],
        }),
      })
      return
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) })
  })

  await page.goto('/')
  await page.getByRole('button', { name: '新番周历' }).click()
  await expect(page.getByTestId('airing-calendar')).toBeVisible()
  if (process.env.QA_SCREENSHOTS === '1') {
    await page.screenshot({ path: '/tmp/moreani-airing-calendar.png', fullPage: false })
  }

  await expect(page.getByRole('link', { name: '前往 Bangumi 未关联周历番剧' })).toHaveCount(0)
  await page.getByRole('button', { name: '打开 未关联周历番剧 的操作' }).first().click()
  const addAnimeButton = page.getByRole('button', { name: '添加番剧 未关联周历番剧' }).first()
  await expect(addAnimeButton).toBeVisible()
  await expect(page.getByRole('link', { name: '前往 Bangumi 未关联周历番剧' }).first()).toHaveAttribute('target', '_blank')
  if (process.env.QA_SCREENSHOTS === '1') {
    await addAnimeButton.scrollIntoViewIfNeeded()
    await page.waitForTimeout(280)
    await page.screenshot({ path: '/tmp/moreani-airing-calendar-actions.png', fullPage: false })
  }

  await addAnimeButton.click()
  await expect(page.getByRole('heading', { name: '添加番剧' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: '标题 *' })).toHaveValue('精确周历番剧')
  await page.getByRole('button', { name: '添加', exact: true }).click()
  await expect.poll(() => createPayload).not.toBeNull()
  expect(createPayload).toEqual(expect.objectContaining({
    title: '精确周历番剧',
    source_type: 'bangumi',
    source_id: '1002',
    source_url: 'https://bangumi.tv/subject/1002',
  }))

  detailShouldFail = true
  await page.getByRole('button', { name: '打开 未关联周历番剧 的操作' }).first().click()
  await page.getByRole('button', { name: '添加番剧 未关联周历番剧' }).first().click()
  await expect(page.getByRole('heading', { name: '添加番剧' })).toBeVisible()
  await expect(page.getByRole('textbox', { name: '标题 *' })).toHaveValue('未关联周历番剧')
  await expect(page.getByText('Bangumi 信息获取失败，请手动搜索或补充内容')).toBeVisible()
  await expect(page.getByText('服务器错误，请稍后再试')).toHaveCount(0)
  await page.getByRole('heading', { name: '添加番剧' }).locator('..').getByRole('button').click()

  await page.getByRole('button', { name: '打开 未关联周历番剧 的操作' }).first().click()
  const bangumiPagePromise = page.waitForEvent('popup')
  await page.getByRole('link', { name: '前往 Bangumi 未关联周历番剧' }).first().click()
  const bangumiPage = await bangumiPagePromise
  expect(bangumiPage.url()).toBe('https://bgm.tv/subject/1002')
  await bangumiPage.close()
})
