import { cleanup, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppHeader } from '@/components/layout/AppHeader'
import { useAuthStore } from '@/stores/auth-store'
import type { User } from '@/types'

vi.mock('@/components/notification/NotificationFab', () => ({
  NotificationCenter: () => <button type="button" aria-label="打开通知">通知</button>,
}))

const USER: User = {
  id: 7,
  username: 'header-user',
  nickname: '导航用户',
  avatar_id: 0,
  role: 'user',
  created_at: '2026-01-01T00:00:00Z',
}

function renderHeader(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppHeader />
    </MemoryRouter>,
  )
}

describe('AppHeader 统计分析入口', () => {
  afterEach(() => {
    cleanup()
    useAuthStore.setState({ user: null })
  })

  it('登录后在通知中心左侧显示统计分析入口', () => {
    useAuthStore.setState({ user: USER })
    const view = renderHeader('/')
    const analytics = view.getByRole('link', { name: '打开统计分析' })
    const notification = view.getByRole('button', { name: '打开通知' })

    expect(analytics).toHaveAttribute('href', '/analytics')
    expect(analytics.compareDocumentPosition(notification) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('未登录时隐藏统计分析入口', () => {
    useAuthStore.setState({ user: null })
    const view = renderHeader('/')

    expect(view.queryByRole('link', { name: '打开统计分析' })).not.toBeInTheDocument()
  })

  it('非首页在顶部直接显示导航栏', () => {
    useAuthStore.setState({ user: USER })
    const view = renderHeader('/analytics')
    const header = view.container.querySelector('header')

    expect(header).toHaveStyle({ opacity: '1', transform: 'translateY(0)' })
    expect(view.getByRole('link', { name: '打开统计分析' })).toHaveAttribute('aria-current', 'page')
  })
})
