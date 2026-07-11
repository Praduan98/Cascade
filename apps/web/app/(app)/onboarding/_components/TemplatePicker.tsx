'use client'
// The onboarding "pick a starting point" step. Renders the curated templates as
// selectable cards plus a distinct "Start blank" affordance (the blank template).
// Selection is lifted to the page — this component is presentational.

import type { Template } from '@cascade/core'
import { CheckIcon, Tag } from '@cascade/ui'
import styles from '../onboarding.module.css'

/** Readable ink (near-black or white) for a glyph on a data-driven accent, by
 *  WCAG relative luminance — legible on light *and* dark accents, either theme. */
function onAccentInk(accent: string): string {
  const hex = accent.trim().replace(/^#/, '')
  const full = hex.length === 3 ? hex.replace(/(.)/g, '$1$1') : hex
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return '#ffffff'
  const n = Number.parseInt(full, 16)
  const lin = (v: number) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const L = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255)
  return L > 0.179 ? '#0b0d12' : '#ffffff'
}

/** The blank starter is presented separately from the curated recipes. */
function isBlank(t: Template): boolean {
  return t.creditsPerRow === 0 || t.id.includes('blank')
}

export interface TemplatePickerProps {
  templates: Template[]
  /** Currently-selected template id, or null. */
  selectedId: string | null
  onSelect: (id: string) => void
}

export function TemplatePicker({ templates, selectedId, onSelect }: TemplatePickerProps) {
  const curated = templates.filter((t) => !isBlank(t))
  const blank = templates.find(isBlank) ?? null

  return (
    <>
      <div className={styles.grid}>
        {curated.map((t) => {
          const selected = t.id === selectedId
          return (
            <button
              key={t.id}
              type="button"
              className={[styles.tmpl, selected ? styles.selected : ''].filter(Boolean).join(' ')}
              aria-pressed={selected}
              onClick={() => onSelect(t.id)}
            >
              {selected && (
                <span className={styles.check}>
                  <CheckIcon />
                </span>
              )}
              <div className={styles.tmplTop}>
                <span className={styles.glyph} style={{ background: t.accent, color: onAccentInk(t.accent) }} aria-hidden="true">
                  {t.glyph}
                </span>
                <span className={styles.tmplName}>{t.name}</span>
              </div>
              <span className={styles.tmplSummary}>{t.summary}</span>
              <div className={styles.tmplMeta}>
                {(t.tags[0] != null) && (
                  <Tag mono tone="default">
                    {t.tags[0]}
                  </Tag>
                )}
                <Tag mono tone="gold">
                  {t.creditsPerRow} cr / row
                </Tag>
              </div>
            </button>
          )
        })}
      </div>

      {blank && (
        <>
          <div className={styles.divider}>or</div>
          <button
            type="button"
            className={[styles.blank, blank.id === selectedId ? styles.selected : ''].filter(Boolean).join(' ')}
            aria-pressed={blank.id === selectedId}
            onClick={() => onSelect(blank.id)}
          >
            <span className={styles.glyph} style={{ background: blank.accent, color: onAccentInk(blank.accent) }} aria-hidden="true">
              {blank.glyph}
            </span>
            <span className={styles.blankMain}>
              <span className={styles.blankName}>Start blank</span>
              <span className={styles.blankSummary}>{blank.summary}</span>
            </span>
            <Tag mono tone="default">
              Free
            </Tag>
          </button>
        </>
      )}
    </>
  )
}
