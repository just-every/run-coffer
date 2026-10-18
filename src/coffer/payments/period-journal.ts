import { all, choice, date, fail, type Context } from '../db'
import { journalsCsv, journalsIif } from './exports'
import type { PaymentsEnv } from './pantry'
import { payoutDetail } from './payouts'

/** Select the whole period, independently of the latest-100 on-screen list.
 * Every selected deposit passes the same balanced-journal checks as a single
 * export; an unmatched deposit refuses the download rather than vanishing. */
export async function periodJournal(c: Context, env: PaymentsEnv, url: URL) {
 let from: string, to: string
 try {
  from = date(url.searchParams.get('from'), 'From')
  to = date(url.searchParams.get('to'), 'To')
 } catch { fail('INPUT', 'Choose valid From and To dates for the journal.', 400) }
 if (from > to) fail('INPUT', 'From must be on or before To.', 400)
 const format = choice(url.searchParams.get('format') ?? 'csv', ['csv', 'iif'] as const, 'CSV or IIF')
 const payouts = await all(c, 'SELECT id FROM cf_payouts WHERE arrival_on>=? AND arrival_on<=? ORDER BY arrival_on,id', from, to)
 const views = []
 for (const payout of payouts) views.push(await payoutDetail(c, payout.id))
 const body = await (format === 'csv' ? journalsCsv(views, env) : journalsIif(views, env))
 return new Response(body, { headers: {
  'content-type': format === 'csv' ? 'text/csv; charset=utf-8' : 'text/plain; charset=utf-8',
  'content-disposition': `attachment; filename="coffer-journal-${from}-${to}.${format}"`,
  'cache-control': 'no-store',
 } })
}
