import { readExports } from './parse-input'
import { columnFields, normalizeLabel } from './source-columns'
import { mapRow } from './source-mapping'
import { SourceRow, valueText } from './source-rows'
import { controlRow, emptyTotals, sourceTotals, validateImport } from './source-totals'
import type { ParsedImport, ParseInput } from './types'
export type { ParsedImport, ParseInput } from './types'

/** A bounded, pure preview: malformed rows remain visible as structured diagnostics. */
export async function parseExports(input: ParseInput): Promise<ParsedImport> {
 const out: ParsedImport = { source: input.source, donors: [], gifts: [], households: [], relationships: [], softCredits: [], pledges: [], installments: [], notes: [], unmapped: [], diagnostics: [], sourceTotals: emptyTotals(), mappedTotals: emptyTotals(), controlTotals: [], files: [] }
 if (!['lgl', 'bloomerang', 're-nxt'].includes(input.source)) {
  out.diagnostics.push({ severity: 'error', code: 'SOURCE', message: 'Choose Little Green Light, Bloomerang, or Raiser’s Edge NXT.' }); return out
 }
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
 spouseHouseholds(out)
 validateImport(out)
 if (!rows.length) out.diagnostics.push({ severity: 'error', code: 'EMPTY', message: 'No source records were found.' })
 return out
}

/** CRMs such as Little Green Light record a couple as a spouse relationship, not a household.
 * A spouse pair with no household from the export becomes one household. */
function spouseHouseholds(out: ParsedImport) {
 const donors = new Map(out.donors.map(d => [d.externalId, d]))
 for (const r of out.relationships) {
  const a = donors.get(r.donorExternalId), b = donors.get(r.relatedDonorExternalId)
  if (r.type !== 'spouse' || !a || !b || a.householdKey || b.householdKey) continue
  const [first, second] = [a, b].sort((x, y) => x.externalId.localeCompare(y.externalId))
  const surname = first.name.trim().split(/\s+/).at(-1)
  const household = { externalId: `spouses:${first.externalId}:${second.externalId}`, name: `${surname} household`, location: r.location }
  out.households.push(household)
  for (const d of [first, second]) { d.householdKey = household.externalId; d.householdName = household.name }
 }
}
