'use client'
// One Glide CustomRenderer per Cascade column type, plus the forward-compat
// StatusCell. Each renderer narrows to its own `data.kind` in `isMatch`, paints
// the cell surface on canvas via the shared painters, and (for editable types)
// hands back a DOM overlay editor. The renderers are pure with respect to the
// theme: they read the live `palette`, so a theme flip repaints on-brand.

import { GridCellKind } from '@glideapps/glide-data-grid'
import type { CustomRenderer } from '@glideapps/glide-data-grid'
import { palette, reducedMotion, statusColor } from '../gridPalette'
import type { CascadeCell, CascadeKind } from './types'
import { isCascade } from './types'
import {
  bodyFont,
  chipFont,
  monoFont,
  paintChip,
  paintCheckbox,
  paintProvenanceHint,
  paintOverflowChip,
  paintRunningBar,
  paintShimmer,
  paintStatusGlyph,
  paintText,
  CHIP_GAP,
} from './paint'
import { CascadeLongTextEditor, CascadeTextEditor } from './editors'

const H_PAD = 12

interface TextRendererOpts {
  numeric?: boolean
  link?: boolean
  multiline?: boolean
}

/** Build a text-like renderer (text/longText/number/currency/url/email/phone/date). */
function makeTextRenderer(kind: CascadeKind, opts: TextRendererOpts = {}): CustomRenderer<CascadeCell> {
  return {
    kind: GridCellKind.Custom,
    isMatch: (c): c is CascadeCell => isCascade(c, kind),
    draw: (args) => {
      const d = args.cell.data
      const color = d.muted ? palette.textMuted : opts.link ? palette.brand : palette.text
      paintText(args.ctx, args.rect, d.display, {
        font: opts.numeric ? monoFont() : bodyFont(),
        color,
        align: opts.numeric ? 'right' : 'left',
      })
    },
    provideEditor: () => ({
      editor: opts.multiline ? CascadeLongTextEditor : CascadeTextEditor,
      disablePadding: true,
      disableStyling: true,
    }),
    onDelete: (cell) => ({ ...cell, data: { ...cell.data, draft: '' }, copyData: '' }),
  }
}

export const textCellRenderer = makeTextRenderer('text')
export const longTextCellRenderer = makeTextRenderer('longText', { multiline: true })
export const numberCellRenderer = makeTextRenderer('number', { numeric: true })
export const currencyCellRenderer = makeTextRenderer('currency', { numeric: true })
export const urlCellRenderer = makeTextRenderer('url', { link: true })
export const emailCellRenderer = makeTextRenderer('email', { link: true })
export const phoneCellRenderer = makeTextRenderer('phone')
export const dateCellRenderer = makeTextRenderer('date')

/** Checkbox. Toggling is handled at the grid level (onCellClicked); Delete clears. */
export const booleanCellRenderer: CustomRenderer<CascadeCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is CascadeCell => isCascade(c, 'boolean'),
  draw: (args) => {
    const checked = args.cell.data.checked ?? null
    paintCheckbox(args.ctx, args.rect, checked)
  },
  onDelete: (cell) => ({ ...cell, data: { ...cell.data, draft: '' }, copyData: '' }),
}

/** Single select — one coloured chip (or a muted em-dash when empty). */
export const singleSelectCellRenderer: CustomRenderer<CascadeCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is CascadeCell => isCascade(c, 'singleSelect'),
  draw: (args) => {
    const d = args.cell.data
    const chip = d.chips?.[0]
    if (!chip) {
      paintText(args.ctx, args.rect, '—', { font: bodyFont(), color: palette.textMuted })
      return
    }
    const cy = args.rect.y + args.rect.height / 2
    paintChip(args.ctx, args.rect.x + H_PAD, cy, chip.label, chip.color, chipFont(), args.rect.width - H_PAD * 2)
  },
  provideEditor: () => ({ editor: CascadeTextEditor, disablePadding: true, disableStyling: true }),
  onDelete: (cell) => ({ ...cell, data: { ...cell.data, draft: '' }, copyData: '' }),
}

/** Multi select — wrapped chips laid out left→right, overflowing to "+N". */
export const multiSelectCellRenderer: CustomRenderer<CascadeCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is CascadeCell => isCascade(c, 'multiSelect'),
  draw: (args) => {
    const { ctx, rect } = args
    const chips = args.cell.data.chips ?? []
    if (chips.length === 0) {
      paintText(ctx, rect, '—', { font: bodyFont(), color: palette.textMuted })
      return
    }
    const cy = rect.y + rect.height / 2
    const right = rect.x + rect.width - H_PAD
    let x = rect.x + H_PAD
    let i = 0
    for (const chip of chips) {
      const remaining = chips.length - i
      if (right - x < 40 && remaining > 0) {
        paintOverflowChip(ctx, x, cy, remaining, chipFont())
        break
      }
      const w = paintChip(ctx, x, cy, chip.label, chip.color, chipFont(), right - x)
      x += w + CHIP_GAP
      i += 1
      if (x >= right) break
    }
  },
  provideEditor: () => ({ editor: CascadeTextEditor, disablePadding: true, disableStyling: true }),
  onDelete: (cell) => ({ ...cell, data: { ...cell.data, draft: '' }, copyData: '' }),
}

/**
 * StatusCell — reproduces `td.enrich`: a --st-<status> mini-dot with value/muted
 * text, a shimmer bar for loading placeholders, and a sliding running-bar when
 * running. Used now for unloaded-row placeholders; fully wired to enrichment
 * provenance in Phase 2 (the `status`/`display`/`muted` seam already exists).
 */
export const statusCellRenderer: CustomRenderer<CascadeCell> = {
  kind: GridCellKind.Custom,
  isMatch: (c): c is CascadeCell => isCascade(c, 'status'),
  // Hover-tracked so resolved cells can fade in a "opens provenance" chevron.
  needsHover: true,
  draw: (args) => {
    const { ctx, rect } = args
    const d = args.cell.data
    const status = d.status ?? 'loading'
    // `loading` (unloaded rows) and `running` (enrichment in flight) both paint
    // the shimmer skeleton; `running` adds the sliding brand bar (matches the
    // design's `td.enrich` running cell).
    if (status === 'loading' || status === 'running') {
      paintShimmer(ctx, rect, args.frameTime)
      if (status === 'running') paintRunningBar(ctx, rect, args.frameTime, statusColor('running'))
      if (!reducedMotion()) args.requestAnimationFrame()
      return
    }
    const cy = rect.y + rect.height / 2
    const color = statusColor(status)
    // Only enrichment/AI/agent/HTTP status cells open a provenance popover — a
    // formula-error or forward-compat status cell has no metadata and must not
    // advertise an interaction it doesn't have.
    const hasProvenance = !!(d.enrichment || d.ai || d.agent || d.http)
    // A shape-bearing glyph (not just a coloured dot) so success/cached read
    // apart without relying on hue (WCAG 1.4.1).
    paintStatusGlyph(ctx, rect.x + H_PAD + 3.5, cy, status, color)
    // Reserve room on the right for the hover affordance so text width is stable
    // whether or not the cell is hovered (only when a chevron can actually appear).
    const hintPad = hasProvenance ? 14 : 0
    paintText(
      ctx,
      { x: rect.x + H_PAD + 13, y: rect.y, width: rect.width - H_PAD - 13 - hintPad, height: rect.height },
      d.display,
      { font: bodyFont(), color: d.muted ? palette.textMuted : palette.text, padX: 0 },
    )
    // A resolved provenance cell opens its popover on click; hint at it on hover.
    if (hasProvenance) {
      paintProvenanceHint(ctx, rect.x + rect.width - H_PAD, cy, palette.textMuted, args.hoverAmount)
    }
  },
}

/** The full renderer set, in `data.kind` priority order, for `customRenderers`. */
export const cascadeCellRenderers: CustomRenderer<CascadeCell>[] = [
  textCellRenderer,
  longTextCellRenderer,
  numberCellRenderer,
  currencyCellRenderer,
  booleanCellRenderer,
  singleSelectCellRenderer,
  multiSelectCellRenderer,
  dateCellRenderer,
  urlCellRenderer,
  emailCellRenderer,
  phoneCellRenderer,
  statusCellRenderer,
]
