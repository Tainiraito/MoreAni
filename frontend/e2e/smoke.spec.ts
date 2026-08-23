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
