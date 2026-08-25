import { expect, test } from '@playwright/test'

const content = {
  id: 198,
  title: '葬送的芙莉莲',
  title_alt: 'Sousou no Frieren',
  cover_url: '',
  description: '测试番剧',
  content_type: 'anime',
  episodes: 28,
  status: 'finished',
  release_date: '2023-09-29',
  platform: '',
  source_type: 'bangumi',
  source_id: '400602',
  source_url: 'https://bgm.tv/subject/400602',
  metadata: {},
  is_public: true,
  created_by: 1,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  avg_score: 88,
  rating_count: 0,
  review_count: 0,
  tags: [],
  recent_reviews: [],
}

function resource(source: 'mikan' | 'animegarden', title: string, fansubId: string | null, fansubName = 'LoliHouse') {
  return {
    id: 1,
    source,
    provider: source === 'mikan' ? 'mikan' : 'dmhy',
    provider_id: `${source}-resource-1`,
    title,
    href: 'https://example.com/resource',
    type: '动画',
    magnet: 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567',
    size: 1024,
    fansub: { id: fansubId, name: fansubName },
    publisher: null,
    subject_id: 400602,
    created_at: '2026-01-01T00:00:00Z',
    fetched_at: '2026-01-01T00:00:00Z',
  }
}

test('未登录用户不显示寻找资源入口', async ({ page }) => {
  await page.addInitScript(({ cachedContent }) => {
    window.sessionStorage.setItem('moreani-recommendations-v1:guest', JSON.stringify([cachedContent]))
  }, { cachedContent: content })
  await page.route('**/api/v1/content/recommendations**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ items: [content] }),
  }))
  await page.route('**/api/v1/content/198', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(content),
  }))
  await page.route('**/api/v1/rating/content/198**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ items: [], total: 0 }),
  }))
  await page.route('**/api/v1/notifications/unread-count', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ total: 0, public: 0, private: 0 }),
  }))

  await page.goto('/')
  await page.getByText(content.title, { exact: true }).last().click({ force: true })
  await expect(page.locator('h2').filter({ hasText: content.title })).toBeVisible()
  await expect(page.getByRole('button', { name: '寻找资源' })).toHaveCount(0)
})

test('资源弹窗默认查询 Mikan，切换后按来源缓存结果', async ({ page }) => {
  const resourceSources: string[] = []
  const resourcePages: number[] = []
  let detailRequests = 0
  const pageErrors: string[] = []
  page.on('pageerror', error => pageErrors.push(error.message))
  const user = {
    id: 1,
    username: 'e2e',
    nickname: 'E2E',
    avatar_id: 1,
    avatar_url: null,
    avatar_crop: null,
    role: 'user',
    created_at: '2026-01-01T00:00:00Z',
  }

  await page.addInitScript(({ auth }) => {
    window.localStorage.setItem('moreani-auth', JSON.stringify({ state: auth, version: 0 }))
  }, { auth: { user, token: 'e2e-token', isGuest: false } })

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
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(content) })
      return
    }
    if (path === '/api/v1/content') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [content], total: 1, page: 1, size: 20 }) })
      return
    }
    if (path === '/api/v1/content/198') {
      detailRequests += 1
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(content) })
      return
    }
    if (path.endsWith('/rating/content/198')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], total: 0 }) })
      return
    }
    if (path.endsWith('/status')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) })
      return
    }
    if (path.endsWith('/content/seasons') || path.endsWith('/user/list')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) })
      return
    }
    if (path.endsWith('/resource-subscriptions')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([]) })
      return
    }
    if (path.endsWith('/content/198/resources')) {
      const source = url.searchParams.get('source') || 'mikan'
      const pageNumber = Number(url.searchParams.get('page') || '1')
      resourceSources.push(source)
      resourcePages.push(pageNumber)
      const item = source === 'mikan'
        ? resource('mikan', 'Mikan 资源 01', '1234')
        : resource('animegarden', 'AnimeGarden 资源 01', null)
      const extra = source === 'mikan'
        ? { ...item, provider_id: 'mikan-resource-2', title: '[简][1080p] Mikan 资源 02' }
        : null
      const other = source === 'mikan'
        ? { ...item, provider_id: 'mikan-resource-3', title: 'OtherSub 资源 03', fansub: { id: '5678', name: 'OtherSub' } }
        : null
      const resources = source === 'mikan' && pageNumber === 2 ? [extra, other] : [item]
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          source,
          available: true,
          matched: true,
          match_method: 'bangumi',
          subject_id: 400602,
          resources,
          pagination: { page: pageNumber, page_size: 50, complete: source !== 'mikan' || pageNumber >= 2 },
          message: null,
        }),
      })
      return
    }
    if (path.endsWith('/notifications/unread-count')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ total: 0, public: 0, private: 0 }) })
      return
    }

    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) })
  })

  await page.goto('/')
  await page.getByText(content.title, { exact: true }).last().click()
  await page.getByRole('button', { name: '寻找资源' }).click()

  const dialog = page.getByRole('dialog', { name: `${content.title}资源` })
  await expect(dialog).toContainText(content.title)
  await expect(dialog).toContainText('放送：2023-09-29 · 28 集')
  await expect.poll(() => resourceSources.filter(source => source === 'mikan').length).toBe(2)
  await expect.poll(() => resourceSources.filter(source => source === 'animegarden').length).toBe(1)
  const dialogHeight = await dialog.evaluate(element => Math.round(element.getBoundingClientRect().height))
  const fansubSelect = dialog.getByRole('button', { name: '全部 (3)' })
  await fansubSelect.click()
  await page.getByRole('option', { name: 'OtherSub (1)' }).click()
  await dialog.getByRole('button', { name: /OtherSub.*1 条/ }).click()
  await expect(dialog).toContainText('OtherSub 资源 03')
  await expect(dialog).not.toContainText('Mikan 资源 01')
  await dialog.getByRole('button', { name: 'OtherSub (1)' }).click()
  await page.getByRole('option', { name: '全部 (3)' }).click()
  await dialog.getByRole('button', { name: /LoliHouse/ }).click()
  await expect(dialog).toContainText('Mikan 资源 01')
  const softsubFilter = dialog.getByRole('radio', { name: '内封' })
  const hardsubFilter = dialog.getByRole('radio', { name: '内嵌' })
  await softsubFilter.click()
  await expect(softsubFilter).toHaveAttribute('aria-checked', 'true')
  await hardsubFilter.click()
  await expect(softsubFilter).toHaveAttribute('aria-checked', 'false')
  await expect(hardsubFilter).toHaveAttribute('aria-checked', 'true')
  await dialog.getByRole('button', { name: '清除筛选' }).click()
  await dialog.getByRole('button', { name: '简', exact: true }).click()
  await expect(dialog).toContainText('Mikan 资源 02')
  await expect(dialog).not.toContainText('Mikan 资源 01')
  await dialog.getByRole('radio', { name: '1080p', exact: true }).click()
  await expect(dialog).toContainText('Mikan 资源 02')
  await dialog.getByRole('textbox', { name: '筛选资源名称' }).fill('Mikan 资源 02')
  await expect(dialog).toContainText('Mikan 资源 02')
  await expect(dialog.getByRole('button', { name: '复制磁链' })).toBeVisible()
  await expect(dialog.getByRole('link', { name: '前往来源' })).toBeVisible()
  await page.evaluate(() => document.documentElement.classList.add('dark'))
  await expect.poll(() => dialog.locator('section').first().evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(20, 20, 20)')
  await expect.poll(() => dialog.locator('[data-resource-key]').first().evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(26, 26, 26)')
  await expect.poll(() => dialog.getByRole('button', { name: '繁', exact: true }).evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(26, 26, 26)')
  if (process.env.QA_SCREENSHOTS === '1') {
    await page.screenshot({ path: '/tmp/moreani-resource-dark.png', fullPage: false })
  }
  await page.evaluate(() => document.documentElement.classList.remove('dark'))
  await expect.poll(() => dialog.getByRole('button', { name: '繁', exact: true }).evaluate(element => getComputedStyle(element).backgroundColor)).toBe('rgb(245, 242, 238)')
  expect(resourcePages.filter(pageNumber => pageNumber === 1).length).toBe(2)
  expect(resourcePages.filter(pageNumber => pageNumber === 2).length).toBe(1)
  await expect(dialog.getByText('加载更多资源')).toHaveCount(0)
  if (process.env.QA_SCREENSHOTS === '1') {
    await page.screenshot({ path: '/tmp/moreani-resource-mikan.png', fullPage: false })
  }

  await dialog.getByRole('button', { name: /^AnimeGarden/ }).click()
  await expect(dialog).toContainText('AnimeGarden')
  await expect(dialog.getByRole('textbox', { name: '筛选资源名称' })).toHaveValue('Mikan 资源 02')
  await dialog.getByRole('button', { name: '清除筛选' }).click()
  expect(await dialog.evaluate(element => Math.round(element.getBoundingClientRect().height))).toBe(dialogHeight)
  await dialog.getByRole('button', { name: /LoliHouse/ }).click()
  await expect(dialog).toContainText('AnimeGarden 资源 01')
  expect(resourceSources.filter(source => source === 'mikan').length).toBe(2)
  expect(resourceSources.filter(source => source === 'animegarden').length).toBe(1)
  if (process.env.QA_SCREENSHOTS === '1') {
    await page.screenshot({ path: '/tmp/moreani-resource-animegarden.png', fullPage: false })
  }

  await dialog.getByRole('button', { name: /^Mikan/ }).click()
  await expect(dialog).toContainText('Mikan 资源 01')
  expect(resourceSources.filter(source => source === 'mikan').length).toBe(2)
  expect(resourceSources.filter(source => source === 'animegarden').length).toBe(1)
  expect(detailRequests).toBe(1)
  expect(pageErrors).toEqual([])
})
