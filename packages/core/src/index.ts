// @cascade/core — domain model, the 11 column-type registry (validation /
// coercion / CSV / filter operators), typed filters + sorting, and the
// clipboard parser. Framework-agnostic (no React, no DOM beyond `crypto`).

export const CORE_VERSION = '1.0.0'

export * from './types'
export * from './ids'
export * from './roles'
export * from './columnTypes'
export * from './filters'
export * from './sort'
export * from './clipboard'
export * from './templating'
export * from './structuredOutput'
