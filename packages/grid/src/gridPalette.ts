// The canvas paint palette — the subset of the design tokens the custom cell
// renderers need to draw with. Glide only hands a renderer its `Theme` object
// at draw time, so anything the theme doesn't carry (the enrichment status
// colours, chip alpha bases, the resolved mono font) lives here instead.
//
// The object is MUTATED in place by `syncPalette` (called from useGlideTheme on
// every recompute) so the render functions — which import the same singleton —
// always paint with the live theme. Defaults below are the dark-theme values so
// the very first client frame (before the effect runs) is already on-brand.

export type StatusKey = 'queued' | 'running' | 'success' | 'empty' | 'failed' | 'cached'

export interface StatusColor {
  fg: string
  soft: string
}

export interface GridPalette {
  text: string
  textMuted: string
  textFaint: string
  brand: string
  brandInk: string
  brandSoft: string
  brandLine: string
  surface: string
  surface2: string
  surface3: string
  border: string
  borderStrong: string
  hairline: string
  /** Resolved body font stack (next/font --font-hanken + fallbacks). */
  fontBody: string
  /** Resolved mono font stack (next/font --font-jetbrains + fallbacks) — numerics. */
  fontMono: string
  status: Record<StatusKey, StatusColor>
}

/** Live singleton read by every render function. Mutated by `syncPalette`. */
export const palette: GridPalette = {
  text: '#e9f1f3',
  textMuted: '#607783',
  textFaint: '#3f5460',
  brand: '#2fe6c8',
  brandInk: '#052620',
  brandSoft: 'rgba(47, 230, 200, .12)',
  brandLine: 'rgba(47, 230, 200, .32)',
  surface: '#0f1a23',
  surface2: '#14212c',
  surface3: '#1a2a36',
  border: '#263a49',
  borderStrong: '#375366',
  hairline: '#1b2b37',
  fontBody: "'Hanken Grotesk', system-ui, -apple-system, sans-serif",
  fontMono: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace",
  status: {
    queued: { fg: '#8698a4', soft: 'rgba(134, 152, 164, .14)' },
    running: { fg: '#2fe6c8', soft: 'rgba(47, 230, 200, .14)' },
    success: { fg: '#38d08c', soft: 'rgba(56, 208, 140, .14)' },
    empty: { fg: '#f5b544', soft: 'rgba(245, 181, 68, .14)' },
    failed: { fg: '#f2666b', soft: 'rgba(242, 102, 107, .14)' },
    cached: { fg: '#ab8cfb', soft: 'rgba(171, 140, 251, .15)' },
  },
}

const STATUS_KEYS: StatusKey[] = ['queued', 'running', 'success', 'empty', 'failed', 'cached']

/** A reader over CSS custom properties, e.g. `(name) => getPropertyValue(name)`. */
export type CssVarReader = (name: string) => string

/**
 * Refresh the singleton palette from a CSS-variable reader. Called by
 * useGlideTheme whenever the theme changes (data-theme flip, OS scheme change,
 * or fonts becoming ready). Empty reads fall back to the current value so a
 * missing variable never blanks a colour.
 */
export function syncPalette(read: CssVarReader): void {
  const v = (name: string, fallback: string): string => {
    const raw = read(name).trim()
    return raw === '' ? fallback : raw
  }

  palette.text = v('--text', palette.text)
  palette.textMuted = v('--text-faint', palette.textMuted)
  palette.textFaint = v('--text-faint', palette.textFaint)
  palette.brand = v('--brand', palette.brand)
  palette.brandInk = v('--brand-ink', palette.brandInk)
  palette.brandSoft = v('--brand-soft', palette.brandSoft)
  palette.brandLine = v('--brand-line', palette.brandLine)
  palette.surface = v('--surface', palette.surface)
  palette.surface2 = v('--surface-2', palette.surface2)
  palette.surface3 = v('--surface-3', palette.surface3)
  palette.border = v('--border', palette.border)
  palette.borderStrong = v('--border-strong', palette.borderStrong)
  palette.hairline = v('--hairline', palette.hairline)

  // next/font exposes its resolved family under these variables on <html>.
  const hanken = read('--font-hanken').trim()
  palette.fontBody = `${hanken ? `${hanken}, ` : ''}'Hanken Grotesk', system-ui, -apple-system, sans-serif`
  const jet = read('--font-jetbrains').trim()
  palette.fontMono = `${jet ? `${jet}, ` : ''}'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, monospace`

  for (const key of STATUS_KEYS) {
    palette.status[key] = {
      fg: v(`--st-${key}`, palette.status[key].fg),
      soft: v(`--st-${key}-soft`, palette.status[key].soft),
    }
  }
}

/** Resolve a status key's foreground colour from the live palette. */
export function statusColor(key: StatusKey): string {
  return palette.status[key].fg
}

// The global CSS `prefers-reduced-motion` reset cannot reach the canvas RAF
// loop, so the renderers consult this flag directly. useGlideTheme keeps it in
// sync with the media query.
let reducedMotionFlag = false

/** Whether animations (shimmer / running-bar) should be frozen on canvas. */
export function reducedMotion(): boolean {
  return reducedMotionFlag
}

export function setReducedMotion(value: boolean): void {
  reducedMotionFlag = value
}
