import localFont from 'next/font/local'

// Self-hosted via next/font/local (files extracted from design/src/fonts.css).
// Each exposes a CSS variable the design tokens reference (--font-bricolage etc.).
export const bricolage = localFont({
  variable: '--font-bricolage',
  display: 'swap',
  src: [
    { path: '../fonts/bricolage-500.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/bricolage-700.woff2', weight: '700', style: 'normal' },
    { path: '../fonts/bricolage-800.woff2', weight: '800', style: 'normal' },
  ],
})

export const hanken = localFont({
  variable: '--font-hanken',
  display: 'swap',
  preload: true,
  src: [
    { path: '../fonts/hanken-400.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/hanken-500.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/hanken-600.woff2', weight: '600', style: 'normal' },
    { path: '../fonts/hanken-700.woff2', weight: '700', style: 'normal' },
  ],
})

export const jetbrains = localFont({
  variable: '--font-jetbrains',
  display: 'swap',
  preload: true,
  src: [
    { path: '../fonts/jetbrains-400.woff2', weight: '400', style: 'normal' },
    { path: '../fonts/jetbrains-500.woff2', weight: '500', style: 'normal' },
    { path: '../fonts/jetbrains-700.woff2', weight: '700', style: 'normal' },
  ],
})
