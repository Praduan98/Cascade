// Low-level canvas painters shared by the custom cell renderers. Everything
// reads colours/fonts from the live `palette` singleton, so a theme flip
// repaints on-brand without rebuilding the renderers. Faithful to the design
// system's data-grid section (.gcell-val / .mini-dot / .cell-shimmer / chips).

import { getMiddleCenterBias, measureTextCached, roundedRect, withAlpha } from '@glideapps/glide-data-grid'
import type { Rectangle } from '@glideapps/glide-data-grid'
import { palette } from '../gridPalette'
import type { CellStatus } from './types'

const TAU = Math.PI * 2
const H_PAD = 12
export const CHIP_HEIGHT = 20
export const CHIP_GAP = 6

/** Ellipsis-truncate `text` to fit `maxWidth` at the current ctx font. */
export function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (maxWidth <= 0) return ''
  if (measureTextCached(text, ctx).width <= maxWidth) return text
  const ellipsis = '…'
  let lo = 0
  let hi = text.length
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (measureTextCached(text.slice(0, mid) + ellipsis, ctx).width <= maxWidth) lo = mid
    else hi = mid - 1
  }
  return lo <= 0 ? ellipsis : text.slice(0, lo) + ellipsis
}

export interface TextOpts {
  font: string
  color: string
  align?: 'left' | 'right'
  padX?: number
}

/** Vertically-centred single-line text with ellipsis, honouring alignment. */
export function paintText(ctx: CanvasRenderingContext2D, rect: Rectangle, text: string, opts: TextOpts): void {
  const padX = opts.padX ?? H_PAD
  ctx.save()
  ctx.font = opts.font
  ctx.fillStyle = opts.color
  ctx.textBaseline = 'middle'
  const y = rect.y + rect.height / 2 + getMiddleCenterBias(ctx, opts.font)
  const maxW = rect.width - padX * 2
  const shown = fitText(ctx, text, maxW)
  if (opts.align === 'right') {
    ctx.textAlign = 'right'
    ctx.fillText(shown, rect.x + rect.width - padX, y)
  } else {
    ctx.textAlign = 'left'
    ctx.fillText(shown, rect.x + padX, y)
  }
  ctx.restore()
}

/** The 7px status dot from `.mini-dot`. */
export function paintDot(ctx: CanvasRenderingContext2D, cx: number, cy: number, color: string): void {
  ctx.save()
  ctx.beginPath()
  ctx.fillStyle = color
  ctx.arc(cx, cy, 3.5, 0, TAU)
  ctx.fill()
  ctx.restore()
}

/**
 * A single select chip (the `.tag`/select-pill look): soft tinted fill, a
 * colour-mixed border, and label text in the chip colour. Returns its width so
 * multi-select can lay chips out in a row.
 */
export function paintChip(
  ctx: CanvasRenderingContext2D,
  x: number,
  cy: number,
  label: string,
  color: string,
  font: string,
  maxWidth: number,
): number {
  ctx.save()
  ctx.font = font
  const innerPad = 8
  const fullTextW = measureTextCached(label, ctx).width
  const wantW = fullTextW + innerPad * 2
  const w = Math.min(wantW, Math.max(innerPad * 2 + 6, maxWidth))
  const textMaxW = w - innerPad * 2
  const shown = fitText(ctx, label, textMaxW)
  const y = cy - CHIP_HEIGHT / 2

  ctx.beginPath()
  roundedRect(ctx, x, y, w, CHIP_HEIGHT, 5)
  ctx.fillStyle = withAlpha(color, 0.14)
  ctx.fill()
  ctx.strokeStyle = withAlpha(color, 0.32)
  ctx.lineWidth = 1
  ctx.stroke()

  ctx.fillStyle = color
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText(shown, x + innerPad, cy + getMiddleCenterBias(ctx, font))
  ctx.restore()
  return w
}

/** A "+N" overflow chip (neutral surface), used when multi-select chips don't fit. */
export function paintOverflowChip(
  ctx: CanvasRenderingContext2D,
  x: number,
  cy: number,
  count: number,
  font: string,
): number {
  ctx.save()
  ctx.font = font
  const label = `+${count}`
  const innerPad = 7
  const w = measureTextCached(label, ctx).width + innerPad * 2
  const y = cy - CHIP_HEIGHT / 2
  ctx.beginPath()
  roundedRect(ctx, x, y, w, CHIP_HEIGHT, 5)
  ctx.fillStyle = palette.surface3
  ctx.fill()
  ctx.strokeStyle = palette.border
  ctx.lineWidth = 1
  ctx.stroke()
  ctx.fillStyle = palette.textMuted
  ctx.textBaseline = 'middle'
  ctx.textAlign = 'left'
  ctx.fillText(label, x + innerPad, cy + getMiddleCenterBias(ctx, font))
  ctx.restore()
  return w
}

/** A checkbox (rounded square) — filled with brand + a tick when checked. */
export function paintCheckbox(ctx: CanvasRenderingContext2D, rect: Rectangle, checked: boolean | null): void {
  const size = 16
  const x = rect.x + rect.width / 2 - size / 2
  const y = rect.y + rect.height / 2 - size / 2
  ctx.save()
  ctx.beginPath()
  roundedRect(ctx, x, y, size, size, 4)
  if (checked === true) {
    ctx.fillStyle = palette.brand
    ctx.fill()
    ctx.strokeStyle = palette.brandInk
    ctx.lineWidth = 2
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    ctx.beginPath()
    ctx.moveTo(x + 3.5, y + 8.5)
    ctx.lineTo(x + 6.8, y + 11.8)
    ctx.lineTo(x + 12.5, y + 4.8)
    ctx.stroke()
  } else {
    ctx.fillStyle = palette.surface3
    ctx.fill()
    ctx.strokeStyle = checked === false ? palette.borderStrong : palette.border
    ctx.lineWidth = 1.5
    ctx.stroke()
  }
  ctx.restore()
}

/**
 * The loading skeleton bar from `.cell-shimmer` — a pill with a gradient that
 * sweeps across it. `frameTime` (ms, monotonic) drives the sweep; the caller is
 * responsible for requesting the next animation frame.
 */
export function paintShimmer(ctx: CanvasRenderingContext2D, rect: Rectangle, frameTime: number): void {
  const h = 9
  const x = rect.x + H_PAD
  const w = Math.max(0, rect.width - H_PAD * 2)
  if (w <= 0) return
  const y = rect.y + rect.height / 2 - h / 2
  const phase = ((frameTime % 1400) / 1400) * 2 - 1 // -1 → 1 over 1.4s
  const sweep = phase * w
  const g = ctx.createLinearGradient(x + sweep - w, 0, x + sweep + w, 0)
  g.addColorStop(0, palette.surface3)
  g.addColorStop(0.5, palette.surface)
  g.addColorStop(1, palette.surface3)
  ctx.save()
  ctx.beginPath()
  roundedRect(ctx, x, y, w, h, 999)
  ctx.fillStyle = g
  ctx.fill()
  ctx.restore()
}

/** The 2px `.running-bar` that slides across the bottom of a running cell. */
export function paintRunningBar(ctx: CanvasRenderingContext2D, rect: Rectangle, frameTime: number, color: string): void {
  const barW = rect.width * 0.4
  const period = 1300
  const p = (frameTime % period) / period
  const start = rect.x - barW + p * (rect.width + barW)
  const clampedStart = Math.max(rect.x, start)
  const drawW = Math.min(barW, rect.x + rect.width - clampedStart)
  if (drawW <= 0) return
  ctx.save()
  ctx.fillStyle = color
  ctx.fillRect(clampedStart, rect.y + rect.height - 2, drawW, 2)
  ctx.restore()
}

/** Font string for the cell base (body) text at 13px. */
export function bodyFont(): string {
  return `13px ${palette.fontBody}`
}
/** Font string for numeric/tabular text (mono) at 13px. */
export function monoFont(): string {
  return `13px ${palette.fontMono}`
}
/** Small font for chip labels. */
export function chipFont(): string {
  return `500 12px ${palette.fontBody}`
}

/** Convenience: has this status a running animation? */
export function isAnimated(status: CellStatus | undefined): boolean {
  return status === 'running' || status === 'loading'
}
