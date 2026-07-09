// Spreadsheet clipboard interchange. Handles the two shapes that show up when
// copying out of Excel / Google Sheets or a CSV file:
//   • TSV (tab-delimited) — the default when copying a range from a spreadsheet
//   • CSV (comma-delimited) — with RFC-4180 quoting, including quoted fields
//     that contain embedded delimiters, quotes ("" escape), and newlines.
// A single state-machine parser covers both, so multi-line quoted cells round
// trip correctly in either dialect.

/** Parse clipboard/CSV text into a 2-D grid of raw string cells. */
export function parseClipboard(text: string): string[][] {
  if (text === '') return []
  const delimiter = detectDelimiter(text)
  return parseDelimited(text, delimiter)
}

function detectDelimiter(text: string): string {
  // Inspect the first physical line that isn't inside a quoted field.
  let inQuotes = false
  let tabs = 0
  let commas = 0
  for (let i = 0; i < text.length; i++) {
    const ch = text.charAt(i)
    if (ch === '"') {
      if (inQuotes && text.charAt(i + 1) === '"') {
        i++
        continue
      }
      inQuotes = !inQuotes
      continue
    }
    if (inQuotes) continue
    if (ch === '\t') tabs++
    else if (ch === ',') commas++
    else if (ch === '\n' || ch === '\r') {
      if (tabs > 0 || commas > 0) break
    }
  }
  return tabs >= commas && tabs > 0 ? '\t' : ','
}

function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  const n = text.length

  const endField = () => {
    row.push(field)
    field = ''
  }
  const endRow = () => {
    row.push(field)
    field = ''
    rows.push(row)
    row = []
  }

  for (let i = 0; i < n; i++) {
    const ch = text.charAt(i)

    if (inQuotes) {
      if (ch === '"') {
        if (text.charAt(i + 1) === '"') {
          field += '"'
          i++
        } else {
          inQuotes = false
        }
      } else {
        field += ch
      }
      continue
    }

    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === delimiter) {
      endField()
      continue
    }
    if (ch === '\r') {
      endRow()
      if (text.charAt(i + 1) === '\n') i++
      continue
    }
    if (ch === '\n') {
      endRow()
      continue
    }
    field += ch
  }

  // Flush the trailing field/row unless the text ended exactly on a row break
  // (which would otherwise append a spurious empty row).
  if (field !== '' || row.length > 0) {
    row.push(field)
    rows.push(row)
  }

  return rows
}

/**
 * Serialise a 2-D grid to clipboard text (TSV). Cells containing a tab, newline,
 * or double-quote are wrapped in quotes with `"` doubled, so the result also
 * parses cleanly back through `parseClipboard`.
 */
export function toClipboard(rows: string[][]): string {
  return rows
    .map((row) => row.map(escapeCell).join('\t'))
    .join('\n')
}

function escapeCell(cell: string): string {
  if (/[\t\n\r"]/.test(cell)) {
    return `"${cell.replace(/"/g, '""')}"`
  }
  return cell
}

/**
 * Serialise a grid as RFC-4180 CSV (comma-delimited, CRLF rows). Used for the
 * "export current view" flow.
 */
export function toCsv(rows: string[][]): string {
  return rows
    .map((row) => row.map(escapeCsvCell).join(','))
    .join('\r\n')
}

function escapeCsvCell(cell: string): string {
  if (/[",\n\r]/.test(cell)) {
    return `"${cell.replace(/"/g, '""')}"`
  }
  return cell
}
