import '@testing-library/jest-dom/vitest'

Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: () => ({
    matches: false,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  }),
})

// jsdom does not expose AnimationEvent, so React cannot register
// onAnimationIteration during component tests without this lightweight shim.
if (!('AnimationEvent' in window)) {
  class TestAnimationEvent extends Event {
    readonly animationName: string
    readonly elapsedTime: number

    constructor(type: string, init: EventInit & { animationName?: string; elapsedTime?: number } = {}) {
      super(type, init)
      this.animationName = init.animationName || ''
      this.elapsedTime = init.elapsedTime || 0
    }
  }

  Object.defineProperty(window, 'AnimationEvent', {
    configurable: true,
    value: TestAnimationEvent,
  })
}

// Headless UI 的 Listbox 在关闭时会测量元素移动，jsdom 未提供 ResizeObserver。
if (!('ResizeObserver' in window)) {
  class TestResizeObserver implements ResizeObserver {
    private readonly handleResize = (): void => {
      this.callback([], this)
    }

    constructor(private readonly callback: ResizeObserverCallback) {}

    disconnect(): void {
      window.removeEventListener('resize', this.handleResize)
    }

    observe(_target: Element): void {
      window.addEventListener('resize', this.handleResize)
    }

    unobserve(_target: Element): void {
      window.removeEventListener('resize', this.handleResize)
    }
  }

  Object.defineProperty(window, 'ResizeObserver', {
    configurable: true,
    value: TestResizeObserver,
  })
  Object.defineProperty(globalThis, 'ResizeObserver', {
    configurable: true,
    value: TestResizeObserver,
  })
}
