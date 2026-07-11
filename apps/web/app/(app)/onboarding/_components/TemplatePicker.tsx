'use client'
// The onboarding "pick a starting point" step. Renders the curated templates as
// selectable cards plus a distinct "Start blank" affordance (the blank template).
// Selection is lifted to the page — this component is presentational.

import type { Template } from '@cascade/core'
import { Tag } from '@cascade/ui'
import styles from '../onboarding.module.css'

function Check() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  )
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
                  <Check />
                </span>
              )}
              <div className={styles.tmplTop}>
                <span className={styles.glyph} style={{ background: t.accent }}>
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
            <span className={styles.glyph} style={{ background: blank.accent }}>
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
