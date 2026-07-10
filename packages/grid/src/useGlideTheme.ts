'use client'
// useGlideTheme — maps the Deep Current CSS token layer onto Glide Data Grid's
// canvas `Theme`. The grid draws to a <canvas>, so it can't read CSS variables
// itself: we resolve them once via getComputedStyle(document.documentElement)
// and hand Glide concrete values. The theme is recomputed whenever it can
// change — the `data-theme` attribute flips, the OS colour scheme changes, or
// web fonts finish loading — and each recompute also refreshes the shared
// `palette` the custom renderers paint with, so the whole grid recolours live.

import { useEffect, useState } from 'react'
import type { Theme } from '@glideapps/glide-data-grid'
import { syncPalette, palette, setReducedMotion } from './gridPalette'

const CELL_H_PADDING = 12
const CELL_V_PADDING = 9
const BASE_FONT = '13px'
const HEADER_FONT = '600 12px'

function readVar(cs: CSSStyleDeclaration, name: string, fallback: string): string {
  const raw = cs.getPropertyValue(name).trim()
  return raw === '' ? fallback : raw
}

/** Build the Glide theme from the live CSS variables (and sync the paint palette). */
function computeTheme(): Partial<Theme> {
  if (typeof document === 'undefined') {
    // SSR / first paint: fall back to the palette defaults (dark).
    return baseTheme(palette.text, palette.textMuted, palette.textFaint, palette.brand, palette.brandInk, palette.brandSoft, palette.brandLine, palette.surface, palette.surface2, palette.surface3, palette.hairline, palette.border, palette.fontBody)
  }
  const cs = getComputedStyle(document.documentElement)
  const read = (name: string) => cs.getPropertyValue(name)
  syncPalette(read)

  return baseTheme(
    palette.text,
    palette.textMuted,
    palette.textFaint,
    palette.brand,
    palette.brandInk,
    palette.brandSoft,
    palette.brandLine,
    palette.surface,
    readVar(cs, '--surface-2', palette.surface2),
    readVar(cs, '--surface-3', palette.surface3),
    readVar(cs, '--hairline', palette.hairline),
    readVar(cs, '--border', palette.border),
    palette.fontBody,
  )
}

function baseTheme(
  text: string,
  textMedium: string,
  textLight: string,
  brand: string,
  brandInk: string,
  brandSoft: string,
  brandLine: string,
  surface: string,
  surface2: string,
  surface3: string,
  hairline: string,
  border: string,
  fontFamily: string,
): Partial<Theme> {
  return {
    accentColor: brand,
    accentFg: brandInk,
    accentLight: brandSoft,
    textDark: text,
    textMedium,
    textLight,
    textBubble: text,
    bgIconHeader: textMedium,
    fgIconHeader: surface,
    textHeader: textMedium,
    textHeaderSelected: text,
    bgCell: surface,
    bgCellMedium: surface2,
    bgHeader: surface2,
    bgHeaderHasFocus: surface3,
    bgHeaderHovered: surface3,
    bgBubble: surface3,
    bgBubbleSelected: surface3,
    bgSearchResult: brandSoft,
    borderColor: hairline,
    horizontalBorderColor: hairline,
    drilldownBorder: border,
    linkColor: brand,
    resizeIndicatorColor: brandLine,
    cellHorizontalPadding: CELL_H_PADDING,
    cellVerticalPadding: CELL_V_PADDING,
    headerFontStyle: HEADER_FONT,
    baseFontStyle: BASE_FONT,
    editorFontSize: BASE_FONT,
    fontFamily,
    lineHeight: 1.4,
  }
}

/**
 * The Glide theme, kept in sync with the CSS token layer. Recomputes on
 * `data-theme` changes, OS scheme changes, and `document.fonts.ready`.
 */
export function useGlideTheme(): Partial<Theme> {
  const [theme, setTheme] = useState<Partial<Theme>>(() => computeTheme())

  useEffect(() => {
    let raf = 0
    const recompute = () => {
      // Coalesce bursts (attribute + media flips arriving together) into one frame.
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => setTheme(computeTheme()))
    }

    // Run once on mount so we pick up the real resolved fonts/colours.
    recompute()

    const observer = new MutationObserver(recompute)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'class'] })

    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    mq.addEventListener('change', recompute)

    // Keep the canvas reduced-motion flag in sync (the CSS reset can't reach it).
    const rm = window.matchMedia('(prefers-reduced-motion: reduce)')
    const syncReducedMotion = () => setReducedMotion(rm.matches)
    syncReducedMotion()
    rm.addEventListener('change', syncReducedMotion)

    // Fonts changing family after load would otherwise leave the canvas on the
    // fallback stack until the next redraw.
    let fontsCancelled = false
    if (typeof document !== 'undefined' && 'fonts' in document) {
      document.fonts.ready.then(() => {
        if (!fontsCancelled) recompute()
      })
    }

    return () => {
      cancelAnimationFrame(raf)
      observer.disconnect()
      mq.removeEventListener('change', recompute)
      rm.removeEventListener('change', syncReducedMotion)
      fontsCancelled = true
    }
  }, [])

  return theme
}
