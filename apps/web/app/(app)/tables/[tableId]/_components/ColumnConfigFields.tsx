'use client'
// Per-type configuration editor, shared by the add- and edit-column dialogs.
// Renders exactly the config a given column type needs (number/currency
// precision, currency code, date format, and the label+colour options list for
// single/multi-select) and reports changes back as a fully-typed ColumnConfig.

import { newId } from '@cascade/core'
import type {
  ColumnConfig,
  ColumnType,
  CurrencyConfig,
  DateConfig,
  MultiSelectConfig,
  NumberConfig,
  SelectOption,
  SingleSelectConfig,
} from '@cascade/core'
import { Field, Input, Select, Popover, PopoverTrigger, PopoverContent, PopoverClose, TrashIcon } from '@cascade/ui'
import styles from '../column-tools.module.css'

// Curated option palette drawn from the Deep Current accents. Gold is reserved
// for money in the design language, so it is intentionally excluded here.
export const OPTION_COLORS = [
  '#2fe6c8',
  '#5b8cff',
  '#a78bfa',
  '#f472b6',
  '#34d399',
  '#38bdf8',
  '#fb7185',
  '#fb923c',
  '#c084fc',
  '#94a3b8',
] as const

const DATE_FORMATS: { value: string; label: string }[] = [
  { value: 'YYYY-MM-DD', label: '2026-07-09' },
  { value: 'MMM D, YYYY', label: 'Jul 9, 2026' },
  { value: 'MMMM D, YYYY', label: 'July 9, 2026' },
  { value: 'D MMM YYYY', label: '9 Jul 2026' },
  { value: 'MM/DD/YYYY', label: '07/09/2026' },
  { value: 'DD/MM/YYYY', label: '09/07/2026' },
]

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'CAD', 'AUD', 'INR', 'CHF']

export function newOption(index: number): SelectOption {
  return { id: newId(), label: '', color: OPTION_COLORS[index % OPTION_COLORS.length] as string }
}

/** Drop options whose label is blank (so a half-filled row never persists). */
export function cleanOptions(options: SelectOption[]): SelectOption[] {
  return options.filter((o) => o.label.trim() !== '').map((o) => ({ ...o, label: o.label.trim() }))
}

interface Props {
  type: ColumnType
  value: ColumnConfig
  onChange: (config: ColumnConfig) => void
  disabled?: boolean
}

export function ColumnConfigFields({ type, value, onChange, disabled }: Props) {
  if (type === 'number') {
    const cfg = value as NumberConfig
    return (
      <div className={styles.config}>
        <Field label="Decimal places" hint="How many digits show after the decimal point.">
          <Select
            value={String(cfg.precision)}
            disabled={disabled}
            onChange={(e) => onChange({ type: 'number', precision: Number(e.target.value) })}
          >
            {[0, 1, 2, 3, 4].map((p) => (
              <option key={p} value={p}>
                {p === 0 ? '0 (whole numbers)' : p}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    )
  }

  if (type === 'currency') {
    const cfg = value as CurrencyConfig
    return (
      <div className={styles.config}>
        <div className={styles.row2}>
          <Field label="Currency">
            <Select
              value={cfg.currencyCode}
              disabled={disabled}
              onChange={(e) => onChange({ type: 'currency', currencyCode: e.target.value, precision: cfg.precision })}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Decimal places">
            <Select
              value={String(cfg.precision)}
              disabled={disabled}
              onChange={(e) =>
                onChange({ type: 'currency', currencyCode: cfg.currencyCode, precision: Number(e.target.value) })
              }
            >
              {[0, 2, 3, 4].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>
    )
  }

  if (type === 'date') {
    const cfg = value as DateConfig
    return (
      <div className={styles.config}>
        <Field label="Date format">
          <Select
            value={cfg.format}
            disabled={disabled}
            onChange={(e) => onChange({ type: 'date', format: e.target.value })}
          >
            {DATE_FORMATS.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label} — {f.value}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    )
  }

  if (type === 'singleSelect' || type === 'multiSelect') {
    const cfg = value as SingleSelectConfig | MultiSelectConfig
    const setOptions = (options: SelectOption[]) =>
      onChange({ type, options } as SingleSelectConfig | MultiSelectConfig)
    return (
      <div className={styles.config}>
        <Field label="Options" hint="Give each choice a label and colour. Add as many as you need.">
          <OptionsEditor options={cfg.options} onChange={setOptions} disabled={disabled} />
        </Field>
      </div>
    )
  }

  return null
}

function OptionsEditor({
  options,
  onChange,
  disabled,
}: {
  options: SelectOption[]
  onChange: (options: SelectOption[]) => void
  disabled?: boolean
}) {
  function update(id: string, patch: Partial<SelectOption>) {
    onChange(options.map((o) => (o.id === id ? { ...o, ...patch } : o)))
  }
  function remove(id: string) {
    onChange(options.filter((o) => o.id !== id))
  }
  function add() {
    onChange([...options, newOption(options.length)])
  }

  return (
    <div className={styles.options}>
      {options.length === 0 && <span className={styles.optHint}>No options yet — add the first one below.</span>}
      {options.map((opt) => (
        <div key={opt.id} className={styles.optionRow}>
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={styles.swatch}
                style={{ background: opt.color }}
                disabled={disabled}
                aria-label="Choose colour"
              />
            </PopoverTrigger>
            <PopoverContent align="start">
              <div className={styles.swatchGrid}>
                {OPTION_COLORS.map((c) => (
                  <PopoverClose asChild key={c}>
                    <button
                      type="button"
                      className={[styles.swatchDot, opt.color === c ? styles.sel : ''].filter(Boolean).join(' ')}
                      style={{ background: c }}
                      onClick={() => update(opt.id, { color: c })}
                      aria-label={c}
                    />
                  </PopoverClose>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          <Input
            value={opt.label}
            placeholder="Option label"
            disabled={disabled}
            onChange={(e) => update(opt.id, { label: e.target.value })}
          />
          <button
            type="button"
            className="iconBtn"
            onClick={() => remove(opt.id)}
            disabled={disabled}
            aria-label="Remove option"
          >
            <TrashIcon />
          </button>
        </div>
      ))}
      <button type="button" className={['btn', 'btn-ghost', 'btn-sm', styles.optAdd].join(' ')} onClick={add} disabled={disabled}>
        + Add option
      </button>
    </div>
  )
}
