'use client'
// The CSV import wizard (FSD US-1.11). Four steps inside one Dialog:
//   1. Upload  — drag/drop or browse a .csv
//   2. Map     — preview the first rows, toggle "first row is a header", and map
//                each CSV column to a NEW or EXISTING table column with a target
//                type (defaulting to an inferred type)
//   3. Review  — per-column validation via the core registry; per-row error
//                report; choose to import valid rows only or go back
//   4. Import  — chunked record creation with a live progress bar → summary
// All record/column creation goes through getApi(); role-gating to writers is
// enforced by the trigger (see ImportButton) and again by the mock API.

import { useEffect, useMemo, useRef, useState } from 'react'
import { COLUMN_TYPES, getColumnType } from '@cascade/core'
import type { Column, ColumnType } from '@cascade/core'
import { Alert, Button, DialogClose, Dialog, Field, Input, Select, Switch, useToast } from '@cascade/ui'
import { errorMessage } from '../../../../../lib/ui'
import {
  dataRowsOf,
  describeColumns,
  deriveConfig,
  inferColumnType,
  parseCsvFile,
  runImport,
  validateImport,
} from './csvImport'
import type {
  CsvColumnInfo,
  ImportOutcome,
  ImportProgress,
  MappingChoice,
  ParsedCsv,
  ResolvedMapping,
  ValidationReport,
} from './csvImport'
import styles from './csv.module.css'

type Step = 'upload' | 'map' | 'review' | 'running' | 'done'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  tableId: string
  columns: Column[]
  /** Called once an import completes so the caller can refresh columns/rows. */
  onImported: (outcome: ImportOutcome) => void
}

// ---- default + resolved mapping helpers ------------------------------------

function defaultChoices(cols: CsvColumnInfo[], existing: Column[]): MappingChoice[] {
  return cols.map((c) => {
    const match = existing.find((e) => e.name.trim().toLowerCase() === c.header.trim().toLowerCase())
    const inferred = inferColumnType(c.samples)
    return {
      csvIndex: c.index,
      header: c.header,
      kind: match ? 'existing' : 'new',
      newName: c.header,
      newType: inferred,
      existingColumnId: match ? match.id : '',
    }
  })
}

function resolveChoices(
  choices: MappingChoice[],
  columnsById: Map<string, Column>,
  dataRows: string[][],
): ResolvedMapping[] {
  const out: ResolvedMapping[] = []
  for (const ch of choices) {
    if (ch.kind === 'skip') continue
    if (ch.kind === 'existing') {
      const col = columnsById.get(ch.existingColumnId)
      if (!col) continue
      out.push({
        csvIndex: ch.csvIndex,
        columnName: col.name,
        type: col.type,
        config: col.config,
        isNew: false,
        existingColumnId: col.id,
      })
    } else {
      const name = ch.newName.trim() || ch.header
      const values = dataRows.map((r) => r[ch.csvIndex] ?? '')
      out.push({
        csvIndex: ch.csvIndex,
        columnName: name,
        type: ch.newType,
        config: deriveConfig(ch.newType, values),
        isNew: true,
      })
    }
  }
  return out
}

// ---- icons -----------------------------------------------------------------

function UploadGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 16V4M7 9l5-5 5 5" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </svg>
  )
}
function ArrowGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  )
}
function CheckGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M20 6L9 17l-5-5" />
    </svg>
  )
}

// ---- step indicator --------------------------------------------------------

const STEP_ORDER: Step[] = ['upload', 'map', 'review', 'running']
const STEP_LABELS: Record<string, string> = { upload: 'Upload', map: 'Map', review: 'Review', running: 'Import' }

function StepBar({ step }: { step: Step }) {
  const current = step === 'done' ? 'running' : step
  const activeIdx = STEP_ORDER.indexOf(current)
  return (
    <div className={styles.steps}>
      {STEP_ORDER.map((s, i) => {
        const state = i < activeIdx || step === 'done' ? 'done' : i === activeIdx ? 'active' : ''
        return (
          <span key={s} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            {i > 0 && <span className={styles.stepSep} />}
            <span className={[styles.stepDot, state ? styles[state] : ''].filter(Boolean).join(' ')}>
              <b>{state === 'done' ? '✓' : i + 1}</b>
              {STEP_LABELS[s]}
            </span>
          </span>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------

export function ImportWizard({ open, onOpenChange, tableId, columns, onImported }: Props) {
  const { toast } = useToast()

  const [step, setStep] = useState<Step>('upload')
  const [parsed, setParsed] = useState<ParsedCsv | null>(null)
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState<string | null>(null)
  const [hasHeader, setHasHeader] = useState(true)
  const [dragOver, setDragOver] = useState(false)
  const [choices, setChoices] = useState<MappingChoice[]>([])
  const [resolved, setResolved] = useState<ResolvedMapping[]>([])
  const [report, setReport] = useState<ValidationReport | null>(null)
  const [progress, setProgress] = useState<ImportProgress | null>(null)
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const cancelRef = useRef(false)
  const columnsRef = useRef(columns)
  columnsRef.current = columns

  const columnsById = useMemo(() => new Map(columns.map((c) => [c.id, c])), [columns])

  // Fresh state each time the wizard opens.
  useEffect(() => {
    if (!open) return
    setStep('upload')
    setParsed(null)
    setParsing(false)
    setParseError(null)
    setHasHeader(true)
    setDragOver(false)
    setChoices([])
    setResolved([])
    setReport(null)
    setProgress(null)
    setOutcome(null)
    cancelRef.current = false
  }, [open])

  const csvCols = useMemo<CsvColumnInfo[]>(
    () => (parsed ? describeColumns(parsed.rows, hasHeader) : []),
    [parsed, hasHeader],
  )

  // (Re)build the default mapping whenever the parsed file or header choice changes.
  useEffect(() => {
    if (!parsed) return
    setChoices(defaultChoices(csvCols, columnsRef.current))
  }, [parsed, csvCols])

  const dataRows = useMemo(() => (parsed ? dataRowsOf(parsed.rows, hasHeader) : []), [parsed, hasHeader])
  const previewRows = useMemo(() => dataRows.slice(0, 10), [dataRows])

  async function handleFile(file: File | undefined | null) {
    if (!file) return
    if (!/\.csv$/i.test(file.name) && file.type !== 'text/csv') {
      setParseError('Please choose a .csv file.')
      return
    }
    setParsing(true)
    setParseError(null)
    try {
      const result = await parseCsvFile(file)
      if (result.rows.length === 0) {
        setParseError('That file appears to be empty.')
        setParsing(false)
        return
      }
      setParsed(result)
      setStep('map')
    } catch (err) {
      setParseError(errorMessage(err, 'Could not read that file.'))
    } finally {
      setParsing(false)
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragOver(false)
    void handleFile(e.dataTransfer.files?.[0])
  }

  function updateChoice(csvIndex: number, patch: Partial<MappingChoice>) {
    setChoices((prev) => prev.map((c) => (c.csvIndex === csvIndex ? { ...c, ...patch } : c)))
  }

  function setTarget(csvIndex: number, value: string) {
    if (value === 'new') updateChoice(csvIndex, { kind: 'new' })
    else if (value === 'skip') updateChoice(csvIndex, { kind: 'skip' })
    else if (value.startsWith('col:')) updateChoice(csvIndex, { kind: 'existing', existingColumnId: value.slice(4) })
  }

  const activeCount = choices.filter((c) => c.kind !== 'skip').length

  function goReview() {
    const list = resolveChoices(choices, columnsById, dataRows)
    if (list.length === 0) {
      toast('Map at least one column to import.', { variant: 'warn' })
      return
    }
    setResolved(list)
    setReport(validateImport(dataRows, list))
    setStep('review')
  }

  async function startImport() {
    if (!report) return
    cancelRef.current = false
    setProgress({ phase: 'columns', created: 0, total: 0 })
    setStep('running')
    try {
      const result = await runImport({
        tableId,
        resolved,
        report,
        onProgress: setProgress,
        shouldCancel: () => cancelRef.current,
      })
      setOutcome(result)
      setStep('done')
      onImported(result)
      const noun = result.imported === 1 ? 'row' : 'rows'
      toast(
        `Imported ${result.imported.toLocaleString('en-US')} ${noun}${
          result.skipped > 0 ? ` · skipped ${result.skipped.toLocaleString('en-US')}` : ''
        }`,
        { variant: result.imported > 0 ? 'success' : 'warn' },
      )
    } catch (err) {
      toast(errorMessage(err, 'Import failed'), { variant: 'error' })
      setStep('review')
    }
  }

  function requestClose() {
    cancelRef.current = true
    onOpenChange(false)
  }

  // ---- footers per step ----
  let footer: React.ReactNode = null
  if (step === 'upload') {
    footer = (
      <DialogClose asChild>
        <Button variant="ghost">Cancel</Button>
      </DialogClose>
    )
  } else if (step === 'map') {
    footer = (
      <>
        <Button variant="ghost" onClick={() => setStep('upload')}>
          Back
        </Button>
        <Button variant="primary" onClick={goReview} disabled={activeCount === 0}>
          Continue
        </Button>
      </>
    )
  } else if (step === 'review') {
    const validCount = report?.validRowIndices.length ?? 0
    footer = (
      <>
        <Button variant="ghost" onClick={() => setStep('map')}>
          Back
        </Button>
        <Button variant="primary" onClick={startImport} disabled={validCount === 0}>
          {report && report.errorRowCount > 0
            ? `Import ${validCount.toLocaleString('en-US')} valid ${validCount === 1 ? 'row' : 'rows'}`
            : `Import ${validCount.toLocaleString('en-US')} ${validCount === 1 ? 'row' : 'rows'}`}
        </Button>
      </>
    )
  } else if (step === 'running') {
    footer = (
      <Button variant="ghost" onClick={() => (cancelRef.current = true)}>
        Cancel
      </Button>
    )
  } else if (step === 'done') {
    footer = (
      <Button variant="primary" onClick={() => onOpenChange(false)}>
        Done
      </Button>
    )
  }

  const title =
    step === 'upload'
      ? 'Import CSV'
      : step === 'map'
        ? 'Map columns'
        : step === 'review'
          ? 'Review & validate'
          : step === 'running'
            ? 'Importing…'
            : 'Import complete'

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) requestClose()
        else onOpenChange(o)
      }}
      title={title}
      className={styles.wide}
      footer={footer}
    >
      {step !== 'done' && <StepBar step={step} />}

      {/* Keyed on `step` so React remounts the body on each step change, replaying
          the subtle stepIn entrance (transform/opacity only). */}
      <div key={step} className={styles.stepBody}>
      {/* -------------------- Upload -------------------- */}
      {step === 'upload' && (
        <div>
          <div
            className={[styles.drop, dragOver ? styles.dropOver : ''].filter(Boolean).join(' ')}
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                fileInputRef.current?.click()
              }
            }}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <span className={styles.dropIcon}>
              <UploadGlyph />
            </span>
            <span className={styles.dropTitle}>{parsing ? 'Reading file…' : 'Drop a CSV here'}</span>
            <span className={styles.dropHint}>
              or <span className={styles.browse}>browse</span> to choose a file
            </span>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              style={{ display: 'none' }}
              onChange={(e) => {
                void handleFile(e.target.files?.[0])
                e.target.value = ''
              }}
            />
          </div>
          {parseError && (
            <div style={{ marginTop: 12 }}>
              <Alert variant="error" title="Couldn’t read that file">
                {parseError}
              </Alert>
            </div>
          )}
        </div>
      )}

      {/* -------------------- Map -------------------- */}
      {step === 'map' && parsed && (
        <div>
          <div className={styles.fileBar}>
            <span className={styles.fileName} title={parsed.fileName}>
              {parsed.fileName}
            </span>
            <span className={styles.fileMeta}>
              {dataRows.length.toLocaleString('en-US')} rows · {csvCols.length} cols
            </span>
          </div>

          <div className={styles.toggleRow}>
            <Switch checked={hasHeader} onCheckedChange={setHasHeader} aria-label="First row is a header" id="csv-has-header" />
            <label htmlFor="csv-has-header" className={styles.toggleLabel}>
              First row is a header
            </label>
          </div>

          <div className={styles.sectionLabel}>Preview</div>
          <div className={styles.previewWrap}>
            <table className={styles.previewTable}>
              <thead>
                <tr>
                  <th className={styles.previewIdx}>#</th>
                  {csvCols.map((c) => (
                    <th key={c.index}>{c.header}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row, r) => (
                  <tr key={r}>
                    <td className={styles.previewIdx}>{r + 1}</td>
                    {csvCols.map((c) => {
                      const v = row[c.index] ?? ''
                      return (
                        <td key={c.index} title={v}>
                          {v === '' ? <span className={styles.emptyCell}>empty</span> : v}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className={styles.sectionLabel}>Map {csvCols.length} columns</div>
          <div className={styles.mapList}>
            {choices.map((ch) => {
              const info = csvCols.find((c) => c.index === ch.csvIndex)
              const sample = info?.samples[0]
              const existingCol = ch.kind === 'existing' ? columnsById.get(ch.existingColumnId) : undefined
              const selectValue =
                ch.kind === 'new' ? 'new' : ch.kind === 'skip' ? 'skip' : `col:${ch.existingColumnId}`
              return (
                <div
                  key={ch.csvIndex}
                  className={[styles.mapRow, ch.kind === 'skip' ? styles.skipped : ''].filter(Boolean).join(' ')}
                >
                  <div className={styles.mapSource}>
                    <div className={styles.mapHeader} title={ch.header}>
                      {ch.header}
                    </div>
                    {sample != null && (
                      <div className={styles.mapSample} title={sample}>
                        e.g. {sample}
                      </div>
                    )}
                  </div>

                  <span className={styles.mapArrow} aria-hidden="true">
                    <ArrowGlyph />
                  </span>

                  <div className={styles.mapTarget}>
                    <Select
                      className={styles.mapGrow}
                      value={selectValue}
                      onChange={(e) => setTarget(ch.csvIndex, e.target.value)}
                      aria-label={`Target for ${ch.header}`}
                    >
                      <option value="new">Create new column</option>
                      {columns.length > 0 && (
                        <optgroup label="Map to existing">
                          {columns.map((col) => (
                            <option key={col.id} value={`col:${col.id}`}>
                              {col.name}
                            </option>
                          ))}
                        </optgroup>
                      )}
                      <option value="skip">Don’t import</option>
                    </Select>

                    {ch.kind === 'new' && (
                      <Select
                        className={styles.typeSelect}
                        value={ch.newType}
                        onChange={(e) => updateChoice(ch.csvIndex, { newType: e.target.value as ColumnType })}
                        aria-label={`Type for ${ch.header}`}
                      >
                        {COLUMN_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {getColumnType(t).label}
                          </option>
                        ))}
                      </Select>
                    )}
                    {ch.kind === 'existing' && existingCol && (
                      <span className={styles.existingType}>
                        <span className={styles.badge}>{getColumnType(existingCol.type).typeBadge}</span>
                        {getColumnType(existingCol.type).label}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {choices.some((c) => c.kind === 'new') && (
            <div style={{ marginTop: 12 }}>
              <div className={styles.sectionLabel}>New column names</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {choices
                  .filter((c) => c.kind === 'new')
                  .map((ch) => (
                    <Field key={ch.csvIndex} label={ch.header} htmlFor={`newname-${ch.csvIndex}`}>
                      <Input
                        id={`newname-${ch.csvIndex}`}
                        value={ch.newName}
                        placeholder={ch.header}
                        onChange={(e) => updateChoice(ch.csvIndex, { newName: e.target.value })}
                      />
                    </Field>
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* -------------------- Review -------------------- */}
      {step === 'review' && report && (
        <div>
          <div className={styles.statRow}>
            <div className={styles.stat}>
              <div className={[styles.statNum, styles.good].join(' ')}>
                {report.validRowIndices.length.toLocaleString('en-US')}
              </div>
              <div className={styles.statLabel}>Valid rows</div>
            </div>
            <div className={styles.stat}>
              <div className={[styles.statNum, report.errorRowCount > 0 ? styles.bad : ''].filter(Boolean).join(' ')}>
                {report.errorRowCount.toLocaleString('en-US')}
              </div>
              <div className={styles.statLabel}>Rows with errors</div>
            </div>
            <div className={styles.stat}>
              <div className={styles.statNum}>{report.totalRows.toLocaleString('en-US')}</div>
              <div className={styles.statLabel}>Total rows</div>
            </div>
          </div>

          {report.errorRowCount > 0 ? (
            <Alert variant="warn" title={`${report.errorRowCount.toLocaleString('en-US')} rows will be skipped`}>
              These rows have values that don’t fit their target column type. Import the valid rows, or go back to
              adjust the mapping.
            </Alert>
          ) : (
            <Alert variant="success" title="Everything checks out">
              All {report.totalRows.toLocaleString('en-US')} rows are valid and ready to import.
            </Alert>
          )}

          {report.errors.length > 0 && (
            <>
              <div className={styles.sectionLabel} style={{ marginTop: 14 }}>
                First {report.errors.length} issues
              </div>
              <div className={styles.errList}>
                {report.errors.map((err, i) => (
                  <div key={i} className={styles.errItem}>
                    <span className={styles.errRow}>row {err.rowNumber}</span>
                    <span className={styles.errCol} title={err.column}>
                      {err.column}
                    </span>
                    <span className={styles.errReason}>
                      {err.reason}
                      {err.value !== '' && (
                        <>
                          {' — '}
                          <b>“{err.value.length > 40 ? `${err.value.slice(0, 40)}…` : err.value}”</b>
                        </>
                      )}
                    </span>
                  </div>
                ))}
                {report.errorRowCount > report.errors.length && (
                  <div className={styles.errMore}>
                    …and more. {report.errors.length} of {report.errorRowCount.toLocaleString('en-US')} error rows shown.
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* -------------------- Running -------------------- */}
      {step === 'running' && (
        <div className={styles.progressWrap}>
          <div className={styles.progressHead}>
            <span className={styles.progressPhase}>
              {progress?.phase === 'columns' ? 'Creating columns…' : 'Writing rows…'}
            </span>
            {progress && progress.phase === 'rows' && (
              <span className={styles.progressCount}>
                {progress.created.toLocaleString('en-US')} / {progress.total.toLocaleString('en-US')}
              </span>
            )}
          </div>
          <div className={styles.bar}>
            {progress && progress.phase === 'rows' && progress.total > 0 ? (
              <div
                className={styles.fill}
                style={{ width: `${Math.round((progress.created / progress.total) * 100)}%` }}
              />
            ) : (
              <div className={[styles.fill, styles.indeterminate].join(' ')} />
            )}
          </div>
          <div className={styles.progressHint}>Keep this dialog open until the import finishes.</div>
        </div>
      )}

      {/* -------------------- Done -------------------- */}
      {step === 'done' && outcome && (
        <div className={styles.summary}>
          <span className={styles.summaryIcon}>
            <CheckGlyph />
          </span>
          <div className={styles.summaryTitle}>
            {outcome.cancelled ? 'Import stopped' : 'Import complete'}
          </div>
          <div className={styles.summaryStats}>
            <div className={styles.summaryStat}>
              <b>{outcome.imported.toLocaleString('en-US')}</b>
              <span>Imported</span>
            </div>
            <div className={styles.summaryStat}>
              <b>{outcome.skipped.toLocaleString('en-US')}</b>
              <span>Skipped</span>
            </div>
            {outcome.columnsCreated > 0 && (
              <div className={styles.summaryStat}>
                <b>{outcome.columnsCreated.toLocaleString('en-US')}</b>
                <span>New columns</span>
              </div>
            )}
          </div>
        </div>
      )}
      </div>
    </Dialog>
  )
}
