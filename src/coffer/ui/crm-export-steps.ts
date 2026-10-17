import { e } from './common'

type Export = { file: string; steps: string; columns: string; optional?: string }
/** What to export from each CRM, in its own menu words. The columns are the labels Coffer reads. */
const SOURCES: [string, string, Export[], string][] = [
 ['lgl', 'Little Green Light', [
  { file: 'constituents.csv', steps: 'Open the <strong>Constituents</strong> tab, then its <strong>Reports</strong> list. Start a new custom report, add the columns below, run it and choose <strong>Export → CSV</strong>.', columns: 'LGL Constituent ID, First Name, Last Name (or Name), Email Address, Phone Number, Address Line 1, Address Line 2, City, State, Postal Code, Country', optional: 'Note' },
  { file: 'gifts.csv', steps: 'Open the <strong>Fundraising</strong> tab, then its <strong>Reports</strong> list. Start from the <strong>Full Export -- CSV</strong> template, set the date range to all the years you are bringing over, check the columns below, run it and choose <strong>Export → CSV</strong>.', columns: 'LGL Gift ID, LGL Constituent ID, Gift Type, Gift Date, Amount, Fund, Campaign, Payment Type', optional: 'Gift Notes, LGL Parent Gift ID (pledge payments), Deductible Amount, Related Gift ID (soft credits)' },
  { file: 'relationships.csv (optional)', steps: 'Open <strong>Constituents → Reports</strong> and run a <strong>Relationships</strong> report with one relationship per row.', columns: 'LGL Constituent ID, Related Constituent ID, Relationship Type' },
 ], 'LGL’s Comprehensive Export is a ZIP file: open it and upload the CSV files inside, not the ZIP.'],
 ['bloomerang', 'Bloomerang', [
  { file: 'constituents.csv', steps: 'Open <strong>Reports</strong> and create a new <strong>Constituent</strong> report. Add the columns below, run it and choose <strong>Export</strong> (CSV or Excel).', columns: 'Account Number, Name, Email Address, Phone Number, Street, City, State, ZIP Code, Country', optional: 'Household Name, Household Account Number' },
  { file: 'transactions.csv', steps: 'In <strong>Reports</strong>, create a <strong>Transactions</strong> report covering all dates. Add the columns below, run it and <strong>Export</strong> it.', columns: 'Transaction Number, Account Number, Type, Date, Amount, Fund, Campaign, Method', optional: 'Note, Non-deductible Amount, Deductible Amount' },
  { file: 'notes.csv (optional)', steps: 'In <strong>Reports</strong>, create a <strong>Notes</strong> report and <strong>Export</strong> it.', columns: 'Account Number, Date, Note' },
 ], 'Use each split designation’s own Amount, never Payment Amount, which repeats the whole payment.'],
 ['re-nxt', "Raiser's Edge NXT", [
  { file: 'constituents.csv', steps: 'In the <strong>database view</strong>, open <strong>Export</strong> and choose <strong>New export</strong>. Pick the <strong>Constituent</strong> export type, one row per record, tick <strong>Include header</strong>, add the fields below and choose <strong>Export now</strong> as CSV.', columns: 'Constituent ID, Name, Email Address, Phone, Address, City, State, ZIP, Country' },
  { file: 'gifts.csv', steps: 'Make a second export with the <strong>Gift</strong> export type, the same settings and the fields below.', columns: 'Gift ID, Constituent ID, Gift Type, Gift Date, Gift Amount, Fund, Campaign, Pay Method', optional: 'Gift Reference, Pledge ID (pledge payments), Receipt Amount' },
 ], 'Use plain column titles, as listed. Web-view lists that leave out the Constituent ID or Gift ID cannot be imported.'],
]

export function exportSteps() {
 return SOURCES.map(([, name, exports, note]) => `<details class="card"><summary>Export from ${e(name)}</summary><ol class="steps">${exports.map(x => `<li><strong>${e(x.file)}</strong>: ${x.steps}<br>Columns: ${e(x.columns)}.${x.optional ? `<br><span class="muted">Also if you have them: ${e(x.optional)}.</span>` : ''}</li>`).join('')}</ol><p class="muted">${e(note)} Keep IDs and ZIP codes as text if you open the files in Excel. Upload all the files together.</p></details>`).join('')
}
