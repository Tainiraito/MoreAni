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
