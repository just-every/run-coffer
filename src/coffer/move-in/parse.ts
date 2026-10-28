import { importSourceNames } from './sources'
import { reviewedCustomMappings, mapCustomColumns } from './custom-fields'
import { creditChecks, sharedEmails } from './checks'
import { inferHouseholds, validateHouseholdHeads } from './households'
import { pledgeChecks } from './pledge-checks'
import { readExports } from './parse-input'
import { columnFields, normalizeLabel } from './source-columns'
import { mapRow } from './source-mapping'
import { SourceRow, valueText } from './source-rows'
import { controlRow, emptyTotals, sourceTotals, validateImport } from './source-totals'
import type { ParsedImport, ParseInput } from './types'
export type { ParsedImport, ParseInput } from './types'

/** A bounded, pure preview: malformed rows remain visible as structured diagnostics. */
export async function parseExports(input: ParseInput): Promise<ParsedImport> {
 const out: ParsedImport = { source: input.source, solicitations: [], channelWithdrawals: [], solicitCodes: input.solicitCodes, donors: [], gifts: [], households: [], relationships: [], softCredits: [], pledges: [], installments: [], notes: [], unmapped: [], diagnostics: [], sourceTotals: emptyTotals(), mappedTotals: emptyTotals(), controlTotals: [], files: [] }
 if (!Object.hasOwn(importSourceNames,input.source)) {
  out.diagnostics.push({ severity: 'error', code: 'SOURCE', message: 'Choose a supported CRM or spreadsheet source.' }); return out
 }
 reviewedCustomMappings(input,out)
 const tables = await readExports(input.files, out), rows: SourceRow[] = []
 const aliases = columnFields(input.source)
 for (const table of tables) {
  if (!table.rows.length || !table.rows[0].some(v => valueText(v))) {
   out.diagnostics.push({ file: table.file, sheet: table.sheet, severity: 'error', code: 'HEADERS', message: 'The first row must contain unique column labels.' }); continue
  }
  for (let i = 0; i < table.rows[0].length; i++) {
   const column = valueText(table.rows[0][i])
   if (!aliases.has(normalizeLabel(column)) && !table.rows.slice(1).some(row => valueText(row[i]))) out.unmapped.push({ file: table.file, sheet: table.sheet, row: 1, column: column || `Column ${i + 1}`, value: '', reason: 'Unsupported column, including its empty values.' })
  }
  for (let i = 1; i < table.rows.length; i++) if (table.rows[i].some(v => valueText(v))) rows.push(new SourceRow(table, table.rows[i], i + 1, out))
 }
 sourceTotals(rows, out.sourceTotals)
 for (const row of rows) if (row.kind() === 'control') { mapRow(row, out, input); controlRow(row, out) } else mapRow(row, out, input)
 mapCustomColumns(rows,out)
 inferHouseholds(out)
 validateHouseholdHeads(out)
 sharedEmails(out)
 creditChecks(out)
 validateImport(out)
 pledgeChecks(out)
 if (!rows.length) out.diagnostics.push({ severity: 'error', code: 'EMPTY', message: 'No source records were found.' })
 return out
}
