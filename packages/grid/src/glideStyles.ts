// Side-effect import of Glide Data Grid's base stylesheet. Importing this module
// (transitively, from TableGrid) makes Next include the grid's own CSS in the
// client bundle. The canvas is themed via the Glide `Theme` object (see
// useGlideTheme.ts) — this stylesheet only provides the host element layout,
// scrollbars, and the DOM overlay editor chrome.
import '@glideapps/glide-data-grid/dist/index.css'
