# Cascade — Design System & Architecture

Design deliverables for **Cascade**, the lean, operator-first GTM data-enrichment
platform specified in [`../All_phase_doc`](../All_phase_doc). Design language
codename: **Deep Current**.

## Deliverables (open directly in any browser)

| File | What it is |
|---|---|
| `cascade-design-system.html` | The visual language — brand, color & the async **status system** (Queued / Running / Success / Empty / Failed / Cached), typography, spacing, elevation, motion, and a working component gallery: buttons, typed fields, pills, the **data grid**, the **waterfall builder**, credit meter, AI/agent columns, alerts, run confirmation, roles. |
| `cascade-design-architecture.html` | The product & system blueprint — app-shell IA, screen inventory mapped to the 4 phases, the enrichment **waterfall flow**, the metered **operation pipeline**, the four-tier **system stack**, the phase-colored **data model** (with the `cell.meta_json` spine), and the phase roadmap (~2,158h). |

Both are fully **self-contained** — fonts, styles, and scripts are inlined, no
network or build step required to view. Both ship a dark-first and a fully
designed light theme (toggle, top-right), are responsive, keyboard-accessible,
and honor `prefers-reduced-motion`.

## Foundation

- **Type** (embedded as subset `woff2` data-URIs): Bricolage Grotesque (display),
  Hanken Grotesk (UI), JetBrains Mono (data / numerals).
- **Color**: deep blue-green ink base · luminous aqua `#2FE6C8` accent · amber
  `#F5B544` reserved for credits/spend/margin · semantic status hues.
- One shared token layer (`src/tokens.css`) drives both pages, so they read as
  one system.

## Editing / regenerating

Sources live in `src/`. The final HTML is assembled by inlining `fonts.css` and
`tokens.css` into the `*.src.html` files:

```bash
cd src
python3 build.py          # writes design-system.html + architecture.html into src/
```

Then copy the regenerated `design-system.html` → `cascade-design-system.html`
and `architecture.html` → `cascade-design-architecture.html` up into this folder.

- `src/tokens.css` — colors (both themes), type scale, spacing, radius, elevation,
  motion, and shared component primitives. **Edit design tokens here.**
- `src/*.src.html` — page markup + page-specific CSS, with `/*@@FONTS@@*/` and
  `/*@@TOKENS@@*/` injection markers.
- `src/fonts.css` — the embedded typefaces (generated once from the Google Fonts
  CSS API; regenerate only to change the font set).

---
SDTC Digital · InsightsTap — Design System v1.0 (Draft), July 2026.
