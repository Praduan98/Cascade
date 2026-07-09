// @cascade/grid — Glide Data Grid integration: token→canvas theme mapper, the
// 11 typed cell renderers + forward-compat StatusCell, the windowed data
// provider, and optimistic inline editing. The grid renders to <canvas>, so it
// is themed via Glide's `Theme` object (mapped from the CSS token layer), not
// CSS Modules.

export const GRID_VERSION = '0.1.0'

// Host components
export { TableGrid } from './TableGrid'
export type { TableGridProps, TableGridHandle } from './TableGrid'
export { TableGridDynamic } from './TableGridDynamic'

// Interaction layer — undo/redo history + the visible control strip
export { useUndoRedo, MAX_HISTORY } from './history'
export type { GridCommand, HistoryState, UndoRedoApi } from './history'
export { HistoryControls } from './HistoryControls'
export type { HistoryControlsProps } from './HistoryControls'

// Clipboard helpers (copy/paste mapping)
export { planPaste, cellsToStringGrid } from './gridClipboard'
export type { PasteRange, PastePlan } from './gridClipboard'

// Theme + palette
export { useGlideTheme } from './useGlideTheme'
export { palette, syncPalette, statusColor } from './gridPalette'
export type { GridPalette, StatusColor, StatusKey, CssVarReader } from './gridPalette'

// Windowed data provider
export { useTableData, PAGE_SIZE } from './dataProvider'
export type { TableData } from './dataProvider'

// Cells (renderers, factory, typed data)
export * from './cells'
