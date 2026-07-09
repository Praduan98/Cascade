// @cascade/grid — Glide Data Grid integration: token→canvas theme mapper, the
// 11 typed cell renderers + forward-compat StatusCell, the windowed data
// provider, and optimistic inline editing. The grid renders to <canvas>, so it
// is themed via Glide's `Theme` object (mapped from the CSS token layer), not
// CSS Modules.

export const GRID_VERSION = '0.1.0'

// Host components
export { TableGrid } from './TableGrid'
export type { TableGridProps } from './TableGrid'
export { TableGridDynamic } from './TableGridDynamic'

// Theme + palette
export { useGlideTheme } from './useGlideTheme'
export { palette, syncPalette, statusColor } from './gridPalette'
export type { GridPalette, StatusColor, StatusKey, CssVarReader } from './gridPalette'

// Windowed data provider
export { useTableData, PAGE_SIZE } from './dataProvider'
export type { TableData } from './dataProvider'

// Cells (renderers, factory, typed data)
export * from './cells'
