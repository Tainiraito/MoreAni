import { expect, test } from '@playwright/test'

const viewer = {
  id: 7,
  username: 'review-viewer',
  nickname: '评论查看者',
  avatar_id: 1,
  avatar_url: null,
  avatar_crop: null,
  role: 'user',
  created_at: '2026-01-01T00:00:00Z',
}

const content = {
  id: 88,
  title: '评论富文本验收番剧',
  title_alt: '',
  cover_url: '',
  description: '防剧透与轻量富文本验收场景',
  content_type: 'anime',
  episodes: 12,
  status: 'active',
  release_date: '2026-04-01',
  platform: 'TV',
  source_type: 'manual',
  source_id: '',
  source_url: '',
  metadata: {},
  is_public: true,
  created_by: 1,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  avg_score: 80,
  rating_count: 2,
  review_count: 2,
  activity_count: 2,
  my_score: 0,
  my_has_review: true,
  tags: [],
  recent_reviews: [{
    nickname: '评论作者',
    avatar_id: 2,
    avatar_url: null,
    avatar_crop: null,
    score: 80,
    review: '**关键剧情** ||隐藏细节||',
    created_at: '2026-01-02T00:00:00Z',
  }],
}

const reviews = [
  {
    id: 1,
    content_id: 88,
    user_id: 7,
    username: 'review-viewer',
    nickname: '评论查看者',
    avatar_id: 1,
    avatar_url: null,
    avatar_crop: null,
    score: 0,
    recommend: 0,
    review: '我的旧评论',
    created_at: '2026-01-01T00:00:00Z',
  },
  {
    id: 2,
    content_id: 88,
    user_id: 8,
    username: 'review-author',
    nickname: '评论作者',
    avatar_id: 2,
    avatar_url: null,
    avatar_crop: null,
    score: 80,
    recommend: 80,
    review: '**关键剧情** ||隐藏细节||',
    created_at: '2026-01-02T00:00:00Z',
  },
]

test('详情弹窗支持评论富文本和防剧透', async ({ page }, testInfo) => {
  const consoleErrors: string[] = []
  const pageErrors: string[] = []
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', error => pageErrors.push(error.message))

  await page.addInitScript(({ auth }) => {
    window.localStorage.setItem('moreani-auth', JSON.stringify({ state: auth, version: 0 }))
    window.localStorage.setItem('moreani-view', 'list')
  }, { auth: { user: viewer, token: 'review-e2e-token', isGuest: false } })

  await page.route('**/api/v1/**', async route => {
    const request = route.request()
    const url = new URL(request.url())
    const path = url.pathname

    if (path.endsWith('/auth/me')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(viewer) })
      return
    }
    if (path === '/api/v1/content' && request.method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [content], total: 1 }) })
      return
    }
    if (path === '/api/v1/content/88') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(content) })
      return
    }
    if (path.endsWith('/rating/content/88')) {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: reviews, total: reviews.length }) })
      return
    }
    if (path === '/api/v1/rating' && request.method() === 'POST') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ ...reviews[0], review: '**新的评论**', updated_at: '2026-01-03T00:00:00Z' }),
      })
      return
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [] }) })
  })

  await page.goto('/')
  await expect(page.getByText('评论富文本验收番剧')).toBeVisible()
  await page.getByText('评论富文本验收番剧').click()

  const dialog = page.locator('div.fixed.inset-0.z-50')
  await expect(dialog.getByText('关键剧情')).toBeVisible()
  await expect(dialog.locator('[tabindex="0"]')).toHaveClass(/bg-black/)
  if (process.env.QA_SCREENSHOTS === '1') {
    await dialog.locator('div.overflow-y-auto').first().evaluate(element => {
      element.scrollTop = element.scrollHeight
    })
    await expect(dialog.getByText('关键剧情')).toBeInViewport()
    await page.screenshot({ path: `/tmp/moreani-review-inline-spoiler-${testInfo.project.name}.png`, fullPage: false })
  }

  await dialog.getByText('点击编辑').click()
  const editor = dialog.getByRole('textbox', { name: '评论内容' })
  await editor.fill('')
  await editor.pressSequentially('*斜体* **加粗** __下划线__ ~~删除线~~ ||防剧透||')
  await expect(editor.locator('[data-review-format="italic"]')).toContainText('斜体')
  await expect(editor.locator('[data-review-format="bold"]')).toContainText('加粗')
  await expect(editor.locator('[data-review-format="underline"]')).toContainText('下划线')
  await expect(editor.locator('[data-review-format="strike"]')).toContainText('删除线')
  expect(await editor.locator('[data-review-format="bold"]').evaluate(element => getComputedStyle(element).fontWeight)).toBe('700')
  const editorSpoiler = editor.locator('[data-review-spoiler="true"]')
  await expect(editorSpoiler).not.toHaveAttribute('data-review-revealed')
  await editorSpoiler.click()
  await expect(editorSpoiler).toHaveAttribute('data-review-revealed', 'true')
  const spoilerBox = await editorSpoiler.boundingBox()
  expect(spoilerBox).not.toBeNull()
  if (!spoilerBox) throw new Error('未获取到剧透块的可选区域')
  await page.mouse.move(spoilerBox.x + 1, spoilerBox.y + spoilerBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(spoilerBox.x + spoilerBox.width + 4, spoilerBox.y + spoilerBox.height / 2, { steps: 6 })
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? '')).toContain('防剧透')
  await expect(editorSpoiler).toHaveAttribute('data-review-active', 'true')
  const spoilerTextColor = await editorSpoiler.evaluate(element => getComputedStyle(element).color)
  const spoilerBackgroundColor = await editorSpoiler.evaluate(element => getComputedStyle(element).backgroundColor)
  expect(spoilerTextColor).not.toBe('rgba(0, 0, 0, 0)')
  expect(spoilerTextColor).not.toBe('transparent')
  expect(spoilerBackgroundColor).not.toBe('rgb(0, 0, 0)')
  if (process.env.QA_SCREENSHOTS === '1') {
    await page.screenshot({ path: `/tmp/moreani-review-spoiler-edit-${testInfo.project.name}.png`, fullPage: false })
  }

  await editor.focus()
  await editor.press('End')
  const getVisibleEditorText = () => editor.evaluate(element => (element.textContent ?? '').replaceAll('\u200B', ''))
  const textBeforeBackspace = await getVisibleEditorText()
  await editor.press('Backspace')
  const textAfterBackspace = await getVisibleEditorText()
  expect(textAfterBackspace.length).toBeLessThan(textBeforeBackspace.length)
  let previousTextLength = textAfterBackspace.length
  for (let index = 0; index < 2; index += 1) {
    await editor.press('Backspace')
    const nextTextLength = (await getVisibleEditorText()).length
    expect(nextTextLength).toBeLessThan(previousTextLength)
    previousTextLength = nextTextLength
  }

  await editor.fill('')
  await editor.pressSequentially('**外层 *嵌套*外层**')
  const outerFormat = editor.locator('[data-review-format="bold"]')
  const nestedFormat = editor.locator('[data-review-format="italic"]')
  const nestedBox = await nestedFormat.boundingBox()
  expect(nestedBox).not.toBeNull()
  if (!nestedBox) throw new Error('未获取到嵌套格式的可选区域')
  await page.mouse.move(nestedBox.x + 1, nestedBox.y + nestedBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(nestedBox.x + nestedBox.width + 4, nestedBox.y + nestedBox.height / 2, { steps: 6 })
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? '')).toContain('嵌套')
  await expect(nestedFormat).toHaveAttribute('data-review-active', 'true')
  await expect(outerFormat).toHaveAttribute('data-review-active', 'true')
  const syntaxDecorations = await nestedFormat.evaluate(element => ({
    before: getComputedStyle(element, '::before').content,
    after: getComputedStyle(element, '::after').content,
  }))
  expect(syntaxDecorations).toEqual({ before: '"*"', after: '"*"' })
  if (process.env.QA_SCREENSHOTS === '1') {
    await page.screenshot({ path: `/tmp/moreani-review-preview-${testInfo.project.name}.png`, fullPage: false })
  }

  await editor.fill('')
  await editor.pressSequentially('**工具栏回退**')
  const toolbarToggleTarget = editor.locator('[data-review-format="bold"]')
  await toolbarToggleTarget.selectText()
  await editor.press('ArrowLeft')
  await toolbarToggleTarget.selectText()
  await dialog.getByRole('button', { name: '插入加粗' }).click()
  await expect(editor.locator('[data-review-format="bold"]')).toHaveCount(0)
  await expect(editor).toHaveText('工具栏回退')

  await editor.fill('')
  await editor.pressSequentially('**键盘回退**')
  const keyboardToggleTarget = editor.locator('[data-review-format="bold"]')
  await keyboardToggleTarget.selectText()
  await editor.press('Backspace')
  await expect(editor.locator('[data-review-format="bold"]')).toHaveCount(0)
  await expect(editor).toHaveText('键盘回退')

  await editor.fill('')
  await editor.pressSequentially('**直接删除**')
  const deleteToggleTarget = editor.locator('[data-review-format="bold"]')
  await deleteToggleTarget.selectText()
  await editor.press('Delete')
  await expect(editor.locator('[data-review-format="bold"]')).toHaveCount(0)
  await expect(editor).toHaveText('直接删除')

  await editor.fill('**父级开头**')
  await editor.press('Home')
  await editor.press('Backspace')
  await expect(editor.locator('[data-review-format="bold"]')).toHaveCount(0)
  await expect(editor).toHaveText('父级开头')

  await editor.fill('**父级结尾**')
  await editor.press('End')
  await editor.press('Delete')
  await expect(editor.locator('[data-review-format="bold"]')).toHaveCount(0)
  await expect(editor).toHaveText('父级结尾')

  await editor.fill('撤销前文本')
  await editor.fill('撤销后文本')
  await editor.press('Control+z')
  await expect(editor).toHaveText('撤销前文本')
  await editor.press('Control+y')
  await expect(editor).toHaveText('撤销后文本')

  await editor.fill('||||')
  const emptySpoiler = editor.locator('[data-review-spoiler="true"]')
  await expect(emptySpoiler).toHaveAttribute('data-review-empty', 'true')
  const emptySpoilerBox = await emptySpoiler.boundingBox()
  expect(emptySpoilerBox?.width ?? 0).toBeGreaterThan(0)
  const emptySyntax = await emptySpoiler.evaluate(element => ({
    before: getComputedStyle(element, '::before').content,
    after: getComputedStyle(element, '::after').content,
    visibleText: (element.textContent ?? '').replaceAll('\u200B', ''),
  }))
  expect(emptySyntax).toEqual({ before: '"||"', after: '"||"', visibleText: '' })

  await editor.fill('')
  await dialog.getByRole('button', { name: '插入加粗' }).click()
  const emptyBold = editor.locator('[data-review-format="bold"]')
  await expect(emptyBold).toHaveAttribute('data-review-empty', 'true')
  const boldCaretState = await editor.evaluate(element => {
    const selection = window.getSelection()
    const anchor = selection?.anchorNode ?? null
    return {
      collapsed: selection?.isCollapsed ?? false,
      insideEditor: anchor !== null && element.contains(anchor),
      insideBold: anchor instanceof Node && Boolean((anchor.parentElement ?? anchor).closest('[data-review-format="bold"]')),
    }
  })
  expect(boldCaretState).toEqual({ collapsed: true, insideEditor: true, insideBold: true })
  await editor.pressSequentially('直接输入')
  await expect(emptyBold).toContainText('直接输入')

  if (process.env.QA_SCREENSHOTS === '1') {
    await page.screenshot({ path: `/tmp/moreani-review-empty-format-${testInfo.project.name}.png`, fullPage: false })
  }

  await expect(dialog.getByRole('button', { name: '插入防剧透' })).toBeVisible()

  await dialog.getByRole('button', { name: '关闭详情' }).click()
  await expect(page.getByRole('dialog')).toContainText('评论内容未保存')
  if (process.env.QA_SCREENSHOTS === '1') {
    await page.screenshot({ path: `/tmp/moreani-review-discard-confirm-${testInfo.project.name}.png`, fullPage: false })
  }
  await page.getByRole('button', { name: '继续编辑' }).click()
  await expect(editor).toBeVisible()
  await editor.fill('未保存内容')
  await dialog.getByRole('button', { name: '关闭详情' }).click()
  await expect(page.getByRole('dialog')).toContainText('关闭弹窗将丢失本次评论编辑')
  await page.getByRole('button', { name: '放弃修改' }).click()
  await expect(dialog).toBeHidden()

  await page.getByText('评论富文本验收番剧').click()
  await expect(dialog.getByText('点击编辑')).toBeVisible()
  await dialog.getByText('点击编辑').click()

  const longReview = Array.from({ length: 18 }, (_, index) => `第${index + 1}行 可见文本`)
  await editor.fill('')
  await editor.pressSequentially(longReview[0])
  for (const line of longReview.slice(1)) {
    await editor.press('Enter')
    await editor.pressSequentially(line)
  }
  await editor.evaluate(element => {
    element.scrollTop = element.scrollHeight
  })
  await expect.poll(() => editor.evaluate(element => element.scrollTop)).toBeGreaterThan(0)
  await expect(editor).toContainText(longReview[17])
  const lastLineMetrics = await editor.evaluate((element, expectedText) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let textNode: Text | null = null
    while (walker.nextNode()) {
      const candidate = walker.currentNode as Text
      if (candidate.nodeValue?.includes(expectedText)) {
        textNode = candidate
        break
      }
    }
    if (!textNode) return { visible: false, reason: 'text-not-found' }

    const range = document.createRange()
    const textStart = textNode.nodeValue?.indexOf(expectedText) ?? -1
    if (textStart < 0) return { visible: false, reason: 'text-offset-not-found' }
    range.setStart(textNode, textStart)
    range.setEnd(textNode, textStart + expectedText.length)
    const textRect = range.getBoundingClientRect()
    const editorRect = element.getBoundingClientRect()
    return {
      visible: textRect.top >= editorRect.top && textRect.bottom <= editorRect.bottom,
      textRect: { top: textRect.top, bottom: textRect.bottom },
      editorRect: { top: editorRect.top, bottom: editorRect.bottom },
      scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
    }
  }, longReview[17])
  expect(lastLineMetrics.visible).toBe(true)
  const scrollMetrics = await editor.evaluate(element => {
    return {
      scrollTop: element.scrollTop,
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      nestedMirrorCount: element.querySelectorAll('[data-slot="review-preview"]').length,
    }
  })
  expect(scrollMetrics.scrollTop).toBeGreaterThan(0)
  expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight)
  expect(scrollMetrics.nestedMirrorCount).toBe(0)
  if (process.env.QA_SCREENSHOTS === '1') {
    await page.screenshot({ path: `/tmp/moreani-review-scroll-${testInfo.project.name}.png`, fullPage: false })
  }

  const longBoldReview = `**${'a'.repeat(176)}**`
  await editor.fill('')
  await editor.pressSequentially(longBoldReview)
  await expect(editor.locator('[data-review-format="bold"]')).toHaveText(/a{176}/)
  const boldMetrics = await editor.evaluate(element => ({
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
  }))
  expect(boldMetrics.scrollHeight).toBeGreaterThan(0)
  expect(boldMetrics.clientHeight).toBeGreaterThan(0)

  const longChineseReview = '中文'.repeat(120)
  await editor.fill('')
  await editor.pressSequentially(longChineseReview)
  expect(await editor.evaluate(element => element.textContent)).toBe(longChineseReview)

  await editor.fill('评论')
  await editor.selectText()
  await dialog.getByRole('button', { name: '插入加粗' }).click()
  await expect(editor.locator('[data-review-format="bold"]')).toHaveText('评论')
  await expect(dialog.getByRole('checkbox')).toHaveCount(0)

  const beforeUnloadPrevented = await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    return event.defaultPrevented
  })
  expect(beforeUnloadPrevented).toBe(true)

  if (process.env.QA_SCREENSHOTS === '1') {
    await page.screenshot({ path: `/tmp/moreani-review-inline-editor-${testInfo.project.name}.png`, fullPage: false })
  }

  const saveRequestPromise = page.waitForRequest(request => (
    request.url().endsWith('/api/v1/rating') && request.method() === 'POST'
  ))
  await dialog.getByRole('button', { name: '保存' }).click()
  const savePayload = JSON.parse((await saveRequestPromise).postData() || '{}') as { review?: string }
  expect(savePayload).toMatchObject({ review: '**评论**' })
  expect(consoleErrors).toEqual([])
  expect(pageErrors).toEqual([])
})
