import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import App from '@/App'
import { useUIStore } from '@/stores/ui-store'

const lazyModuleState = vi.hoisted(() => ({
  detailLoaded: false,
  authLoaded: false,
}))

vi.mock('@/pages/HomePage', () => ({
  HomePage: () => <div data-testid="home-page">首页</div>,
}))

vi.mock('@/components/layout/AppHeader', () => ({
  AppHeader: () => <div data-testid="app-header">导航</div>,
}))

vi.mock('@/components/ui/toast', () => ({
  ToastContainer: () => null,
}))

vi.mock('@/components/admin/admin-dialog-loader', () => ({
  AdminDialog: () => null,
}))

vi.mock('@/components/content/ContentDetailDialog', () => {
  lazyModuleState.detailLoaded = true
  return {
    ContentDetailDialog: () => <div data-testid="content-detail-dialog">详情</div>,
  }
})

vi.mock('@/components/auth/AuthDialog', () => {
  lazyModuleState.authLoaded = true
  return {
    AuthDialog: () => <div data-testid="auth-dialog">认证</div>,
  }
})

describe('App 按需加载全局弹窗', () => {
  beforeEach(() => {
    lazyModuleState.detailLoaded = false
    lazyModuleState.authLoaded = false
    useUIStore.setState({ detailOpen: false, detailContentId: null, authOpen: false })
  })

  afterEach(() => {
    cleanup()
    useUIStore.setState({ detailOpen: false, detailContentId: null, authOpen: false })
  })

  it('关闭时不加载弹窗，打开对应状态后才加载并挂载', async () => {
    render(<App />)

    expect(lazyModuleState.detailLoaded).toBe(false)
    expect(lazyModuleState.authLoaded).toBe(false)
    expect(screen.queryByTestId('content-detail-dialog')).not.toBeInTheDocument()
    expect(screen.queryByTestId('auth-dialog')).not.toBeInTheDocument()

    act(() => useUIStore.getState().openDetail(88))
    await waitFor(() => expect(screen.getByTestId('content-detail-dialog')).toBeInTheDocument())
    expect(lazyModuleState.detailLoaded).toBe(true)
    expect(lazyModuleState.authLoaded).toBe(false)

    act(() => useUIStore.getState().openAuth())
    await waitFor(() => expect(screen.getByTestId('auth-dialog')).toBeInTheDocument())
    expect(lazyModuleState.authLoaded).toBe(true)
  })
})
