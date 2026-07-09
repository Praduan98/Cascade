// Decode the embedded woff2 faces from the design system's fonts.css (base64
// data-URIs) into real .woff2 files that next/font/local can consume.
// Run from repo root: `node apps/web/fonts/extract.mjs`  (or `make fonts`).
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url)) // apps/web/fonts
const root = resolve(here, '../../..') // repo root
const srcCss = resolve(root, 'design/src/fonts.css')
const outDir = here

const SLUG = {
  'Bricolage Grotesque': 'bricolage',
  'Hanken Grotesk': 'hanken',
  'JetBrains Mono': 'jetbrains',
}

const css = readFileSync(srcCss, 'utf8')
const faceRe = /@font-face\s*\{([^}]*)\}/g
mkdirSync(outDir, { recursive: true })

let m
let count = 0
while ((m = faceRe.exec(css))) {
  const body = m[1]
  const fam = /font-family:\s*'([^']+)'/.exec(body)?.[1]
  const wght = /font-weight:\s*(\d+)/.exec(body)?.[1]
  const b64 = /base64,([A-Za-z0-9+/=]+)\)/.exec(body)?.[1]
  const slug = fam ? SLUG[fam] : undefined
  if (!slug || !wght || !b64) continue
  const buf = Buffer.from(b64, 'base64')
  writeFileSync(resolve(outDir, `${slug}-${wght}.woff2`), buf)
  console.log(`  ${slug}-${wght}.woff2  ${Math.round(buf.length / 1024)}KB`)
  count++
}
console.log(`wrote ${count} woff2 files to ${outDir}`)
if (count < 10) {
  console.error(`expected at least 10 faces, got ${count}`)
  process.exit(1)
}
