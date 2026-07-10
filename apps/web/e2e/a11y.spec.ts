import AxeBuilder from '@axe-core/playwright'
import { expect, test } from '@playwright/test'

// Locks in the accessibility work: every product route must have zero serious
// or critical WCAG A/AA violations, in BOTH themes. Runs axe-core in-page.
const ROUTES = ['/sign-in', '/tables', '/members', '/audit', '/settings']
const THEMES = ['dark', 'light'] as const

for (const theme of THEMES) {
  for (const route of ROUTES) {
    test(`a11y: ${route} (${theme}) — no serious/critical violations`, async ({ page }) => {
      // Apply the theme before the app's no-flash script reads it.
      await page.addInitScript((t) => {
        try {
          localStorage.setItem('cascade-theme', t)
        } catch {
          /* ignore */
        }
      }, theme)

      await page.goto(route)
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(400) // let fonts settle so contrast is measured accurately

      const results = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
      const blocking = results.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')
      const summary = blocking
        .map((v) => `${v.id} [${v.impact}] x${v.nodes.length}: ${v.nodes[0]?.target?.join(' ')}`)
        .join('\n')

      expect(blocking, summary || 'no serious/critical violations').toEqual([])
    })
  }
}
