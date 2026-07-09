import { chromium } from '@playwright/test'

const BASE = 'http://localhost:3100'
const msgs = []
const browser = await chromium.launch()
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } })
await ctx.addInitScript(() => { try { localStorage.setItem('cascade-theme', 'dark') } catch(e){} })
const page = await ctx.newPage()
page.on('pageerror', (e) => msgs.push(`PAGEERROR: ${e.message}\n${(e.stack||'').split('\n').slice(0,8).join('\n')}`))
page.on('console', (m) => { if (m.type() === 'error') msgs.push(`CONSOLE.error: ${m.text()}`) })
page.on('response', (r) => { if (r.status() >= 500) msgs.push(`HTTP ${r.status()}: ${r.url()}`) })

async function report(label) {
  await page.waitForTimeout(2500)
  const bodyText = (await page.locator('body').innerText().catch(()=> '')).replace(/\n+/g,' | ').slice(0, 400)
  const spinner = await page.locator('[role="status"]').count()
  console.log(`\n########## ${label} ##########`)
  console.log('url:', page.url())
  console.log('spinner elems:', spinner)
  console.log('body:', JSON.stringify(bodyText))
}

await page.goto(`${BASE}/tables`, { waitUntil: 'load', timeout: 20000 }).catch(e=>msgs.push('GOTO '+e.message))
await report('LIST /tables')

const link = page.locator('a[href^="/tables/tbl"]').first()
if (await link.count()) {
  const href = await link.getAttribute('href')
  console.log('\nclicking into:', href)
  await link.click().catch(e=>msgs.push('click '+e.message))
  await page.waitForLoadState('load').catch(()=>{})
  await report('DETAIL (via click)')
}

await page.goto(`${BASE}/tables/tbl_companies`, { waitUntil: 'load', timeout: 20000 }).catch(e=>msgs.push('GOTO2 '+e.message))
await report('DETAIL /tables/tbl_companies (direct)')

console.log('\n=== MESSAGES ===')
console.log(msgs.length ? msgs.join('\n---\n') : 'NONE')
await ctx.close(); await browser.close()
