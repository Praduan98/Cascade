// Global test setup, loaded by vitest before every test file (see
// vitest.config.ts → setupFiles). jsdom omits a handful of browser APIs that
// Radix primitives, the Glide grid, and the app itself reach for; we polyfill
// the minimal surface here so components mount without throwing.
//
// NOTE: `@testing-library/jest-dom` is intentionally NOT imported — it is not a
// dependency of this workspace. Tests use the plain `expect` matchers plus
// Testing Library's role/text queries (which throw on absence), so the extra
// DOM matchers aren't required.

import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Unmount React trees + reset jsdom between tests to keep them isolated.
afterEach(() => {
  cleanup()
})

// --- ResizeObserver (Radix Popover/Tooltip/DropdownMenu, Glide grid) ---------
if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverMock {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  ;(globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = ResizeObserverMock
}

// --- matchMedia (ThemeProvider reads the OS colour-scheme preference) ---------
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList
}

// --- scrollTo / scrollIntoView (Radix focus management) ----------------------
if (typeof window !== 'undefined' && !window.scrollTo) {
  window.scrollTo = (() => {}) as typeof window.scrollTo
}
if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {}
}

// --- Pointer capture (Radix Dialog / DropdownMenu call these on interaction) --
if (typeof Element !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false
  }
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {}
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {}
  }
}

// --- Canvas 2D context stub (Glide grid measures text at module scope) --------
// jsdom returns null from getContext without the native `canvas` package; a tiny
// stub lets `@cascade/grid` import cleanly even though we never render a canvas.
if (typeof HTMLCanvasElement !== 'undefined') {
  const proto = HTMLCanvasElement.prototype as unknown as {
    getContext: (id: string) => unknown
  }
  const original = proto.getContext
  proto.getContext = function getContext(id: string) {
    if (id === '2d') {
      return {
        measureText: (text: string) => ({ width: text.length * 6 }),
        fillText: () => {},
        fillRect: () => {},
        clearRect: () => {},
        beginPath: () => {},
        moveTo: () => {},
        lineTo: () => {},
        stroke: () => {},
        fill: () => {},
        save: () => {},
        restore: () => {},
        scale: () => {},
        translate: () => {},
        rect: () => {},
        clip: () => {},
        setLineDash: () => {},
        createLinearGradient: () => ({ addColorStop: () => {} }),
        canvas: { width: 0, height: 0 },
      }
    }
    return original ? original.call(this, id) : null
  }
}
