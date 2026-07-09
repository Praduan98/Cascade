// Public surface of the cell layer: the typed cell data, the renderer set, the
// (column,value)→cell factory + StatusCell builder, and the edit-string bridge.

export type { CascadeCell, CascadeCellData, CascadeKind, CellStatus, Chip } from './types'
export { isCascade } from './types'
export {
  cascadeCellRenderers,
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
} from './renderers'
export { makeCell, makeStatusCell } from './factory'
export type { StatusCellOptions } from './factory'
export { editStringFor, rawFromCell } from './values'
export { CascadeTextEditor, CascadeLongTextEditor } from './editors'
