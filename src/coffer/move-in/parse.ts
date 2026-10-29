import { neonPledgeAdjustmentRow } from './neon-pledge-adjustments'
import { neonEventRow } from './neon-events'
import { neonMembershipRow } from './neon-records'
import { platformTables, platformRow } from './platform-export'
import { reviewedCustomMappings, mapCustomColumns } from './custom-fields'
import { reviewedSpreadsheet } from './spreadsheet-mapping'
import { includeMatchedDonors } from './spreadsheet-matches'
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
 if (!['lgl', 'bloomerang', 're-nxt', 'spreadsheet', 'givebutter', 'zeffy', 'neon'].includes(input.source)) {
  out.diagnostics.push({ severity: 'error', code: 'SOURCE', message: 'Choose an available CRM or spreadsheet.' }); return out
 }
 if(input.source==='spreadsheet')out.spreadsheet=reviewedSpreadsheet(input.spreadsheet,out)
 reviewedCustomMappings(input,out)
 const tables = platformTables(await readExports(input.files, out),out), rows: SourceRow[] = []
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
 for (const row of rows) if (neonPledgeAdjustmentRow(row,out)||neonEventRow(row,out)||neonMembershipRow(row,out)||platformRow(row,out)) continue; else if (row.kind() === 'control') { mapRow(row, out, input); controlRow(row, out) } else mapRow(row, out, input)
 if(out.source==='spreadsheet')includeMatchedDonors(input,out)
 if(out.spreadsheet?.donorMatches)for(const donor of out.donors)if(Object.hasOwn(out.spreadsheet.donorMatches,donor.externalId))donor.match=out.spreadsheet.donorMatches[donor.externalId]
 if(out.spreadsheet?.donorMatches)for(const id of Object.keys(out.spreadsheet.donorMatches))if(!out.donors.some(d=>d.externalId===id))out.diagnostics.push({severity:'error',code:'DONOR_MATCH',message:`Source constituent ${id} has no mapped constituent row. Include its identity before choosing a match.`})
 mapCustomColumns(rows,out)
 for(const r of out.recurringReferences??[])if(!out.donors.some(d=>d.externalId===r.donorExternalId))out.diagnostics.push({...r.location,severity:'error',code:'MISSING_REFERENCE',message:'Source plan needs its contact row.'})
 inferHouseholds(out)
 validateHouseholdHeads(out)
 sharedEmails(out)
 creditChecks(out)
 validateImport(out)
 pledgeChecks(out)
 if (!rows.length) out.diagnostics.push({ severity: 'error', code: 'EMPTY', message: 'No source records were found.' })
 return out
}
