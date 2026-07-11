import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Component / interaction test runner for the web app. Kept strictly separate
// from the Playwright e2e suite: `include` only picks up *.test.{ts,tsx}, and
// `exclude` drops e2e/**, *.spec.ts, .next and node_modules so `vitest run`
// never mis-collects the Playwright accessibility spec (which requires the
// Playwright runner, not vitest).
//
// Workspace `@cascade/*` packages resolve through node_modules symlinks to their
// raw `src/index.ts`; Vite follows the symlinks to the real package sources and
// transforms them with the React (esbuild) plugin, so no manual aliasing is
// needed. `@glideapps/glide-data-grid` (pulled in transitively via
// `@cascade/grid`) is inlined so its ESM is transformed rather than externalised.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['app/**/*.test.{ts,tsx}', 'test/**/*.test.{ts,tsx}'],
    exclude: ['e2e/**', '**/*.spec.ts', 'node_modules/**', '.next/**'],
    // CSS Modules are not processed in tests — imports resolve to inert objects,
    // which is all the components need (class names are cosmetic here).
    css: false,
    server: {
      deps: {
        inline: [/@glideapps\//, /@cascade\//],
      },
    },
  },
  // esbuild handles the TSX in workspace package sources + tests.
  esbuild: {
    jsx: 'automatic',
  },
})
