import { paymentFundLines } from '../gift-splits'
import { all, fail, guard, one, sql, text, type Context } from '../db'
import { stripe, type GivingEnv } from '../giving/stripe'
import { syncEntry } from './entries'
import { cents, stripePages, utcDay } from './stripe-data'
import { paymentWrite } from './write'

export async function payoutDetail(c: { db: D1Database }, id: string) {
 const payout = await one(c, `SELECT p.*,COALESCE((SELECT SUM(e.net_cents) FROM cf_payout_entries x JOIN cf_payment_entries e ON e.id=x.entry_id WHERE x.payout_id=p.id),0) AS matched_cents FROM cf_payouts p WHERE id=?`, id)
 if (!payout) fail('not_found', 'That payout is not available.', 404)
 const lines = await all(c, `SELECT e.*,d.name AS donor_name FROM cf_payout_entries x JOIN cf_payment_entries e ON e.id=x.entry_id LEFT JOIN cf_gifts g ON g.id=e.gift_id LEFT JOIN cf_donors d ON d.id=g.donor_id WHERE x.payout_id=? ORDER BY e.received_on,e.id`, id)
 const definitions=await all(c,'SELECT * FROM cf_funds')
 const withRestriction=(line:Record<string,any>):Record<string,any>=>{const f=definitions.find(f=>f.name===line.fund);return {...line,restriction:f?.restriction??'unrestricted',detail:f?.detail??null,release_on:f?.release_on??null}}
 const accountingLines=(await paymentFundLines(c,lines)).map(withRestriction), funds=new Map<string,{fund:string;gross_cents:number;fee_cents:number;net_cents:number}>()
 for(const line of accountingLines){const total=funds.get(line.fund)??{fund:line.fund,gross_cents:0,fee_cents:0,net_cents:0};total.gross_cents+=line.amount_cents;total.fee_cents+=line.fee_cents;total.net_cents+=line.net_cents;funds.set(line.fund,total)}
 const splits=[...funds.values()].sort((a,b)=>a.fund.localeCompare(b.fund)).map(withRestriction)
 return { payout, lines, accountingLines, splits, posting: await one(c, 'SELECT * FROM cf_payout_postings WHERE payout_id=?', id), qboPosting: await one(c, "SELECT * FROM cf_qbo_postings WHERE kind='payout' AND source_id=?", id) }
}
export async function payoutList(c: { db: D1Database }) {
 const postings = await all(c, 'SELECT * FROM cf_payout_postings'), qboPostings = await all(c, "SELECT * FROM cf_qbo_postings WHERE kind='payout'")
 return {
  payouts: (await all(c, 'SELECT p.*,COALESCE((SELECT SUM(e.net_cents) FROM cf_payout_entries x JOIN cf_payment_entries e ON e.id=x.entry_id WHERE x.payout_id=p.id),0) AS matched_cents FROM cf_payouts p ORDER BY arrival_on DESC,id DESC LIMIT 100')).map(p => ({ ...p, posting: postings.find(x => x.payout_id === p.id) ?? null, qboPosting: qboPostings.find(x => x.source_id === p.id) ?? null })),
  failures: await all(c, 'SELECT * FROM cf_payment_failures ORDER BY created_at DESC LIMIT 30'),
 }
}
/** Manual payouts have no provider-defined membership. A finance user must
 * select the exact Stripe balance IDs; every cent and eligibility is verified. */
export async function matchManualPayout(env: GivingEnv, c: Context, id: string, input: any) {
 if (input.confirm !== 'yes') fail('confirmation_required', 'Confirm the selected transactions belong to this manual payout.', 400)
 const ids = [...new Set(text(input.entryIds, 'Balance transaction IDs', 12000).split(/[\s,]+/).filter(Boolean))]
 if (!ids.length || ids.length > 100 || ids.some(id => !/^txn_[a-zA-Z0-9_]+$/.test(id))) fail('INPUT', 'Select 1–100 Stripe balance transaction IDs.', 400)
 const payout = await stripe(env, '/payouts/' + encodeURIComponent(id))
 if (payout.automatic || payout.currency !== 'usd' || payout.status !== 'paid') fail('PAYOUT_NOT_READY', 'Only paid manual USD payouts use a reviewed transaction match.')
 const entries: any[] = []
 for (const entryId of ids) {
  const txn = await stripe(env, '/balance_transactions/' + encodeURIComponent(entryId))
  if (txn.id !== entryId || txn.currency !== 'usd' || txn.status !== 'available' || txn.created > payout.created || txn.available_on > payout.created || txn.type === 'payout') fail('PAYOUT_NOT_READY', 'A selected transaction was not available when this payout was created.')
  entries.push(txn)
 }
 if (entries.reduce((sum, txn) => sum + cents(txn.net), 0) !== payout.amount) fail('PAYOUT_NOT_READY', 'The selected transactions do not equal this payout.')
 await syncPayout(env, id, c)
 for (const txn of entries) await syncEntry(env, txn, c)
 const view = await payoutDetail(c, id)
 if (view.payout.complete) {
  if (view.lines.length !== ids.length || view.lines.some(line => !ids.includes(line.id))) fail('PAYOUT_CHANGED', 'This payout already has a different match.')
  return view
 }
 await paymentWrite(env, [
  guard('NOT EXISTS(SELECT 1 FROM cf_payout_entries WHERE entry_id IN (SELECT value FROM json_each(?)))', 'PAYOUT_CHANGED', 'A selected transaction already belongs to a payout.', JSON.stringify(ids)),
  ...ids.map(entryId => sql('INSERT INTO cf_payout_entries(entry_id,payout_id) VALUES(?,?)', entryId, id)),
  sql('UPDATE cf_payouts SET complete=1 WHERE id=?', id),
 ], c)
 return payoutDetail(c, id)
}
export async function syncPayout(env: GivingEnv, id: string, authority?: Context) {
 const payout = await stripe(env, '/payouts/' + encodeURIComponent(id))
 if (payout.currency !== 'usd') fail('currency', 'Only USD payouts can be reconciled.', 409)
 const existing = await one({ db: env.DB }, 'SELECT * FROM cf_payouts WHERE id=?', id)
 if (existing && existing.amount_cents !== payout.amount) fail('payout_changed', 'The payout amount changed at Stripe. No deposit was changed.', 409)
 await paymentWrite(env, [sql(`INSERT INTO cf_payouts(id,status,arrival_on,amount_cents,currency,automatic,updated_at) VALUES(?,?,?,?,?,?,?)
  ON CONFLICT(id) DO UPDATE SET status=excluded.status,updated_at=excluded.updated_at`, id, payout.status, utcDay(payout.arrival_date), cents(payout.amount), payout.currency, payout.automatic ? 1 : 0, new Date().toISOString())], authority)
 // Stripe only provides exact payout membership for automatic payouts.
 // Manual payouts remain unmatched instead of guessing by date or amount.
 if (!payout.automatic || payout.reconciliation_status === 'in_progress') return payoutDetail({ db: env.DB }, id)
 for await (const txn of stripePages(env, '/balance_transactions?payout=' + encodeURIComponent(id) + '&expand[]=data.source')) {
  if (txn.type === 'payout') continue
  await syncEntry(env, txn, authority)
  const member = await one({ db: env.DB }, 'SELECT payout_id FROM cf_payout_entries WHERE entry_id=?', txn.id)
  if (member && member.payout_id !== id) fail('payout_changed', 'A transaction is already matched to another payout.', 409)
  if (!member) await paymentWrite(env, [sql('INSERT OR IGNORE INTO cf_payout_entries(entry_id,payout_id) VALUES(?,?)', txn.id, id)], authority)
 }
 await paymentWrite(env, [sql('UPDATE cf_payouts SET complete=1 WHERE id=?', id)], authority)
 return payoutDetail({ db: env.DB }, id)
}
export async function syncPayouts(env: GivingEnv, id?: string, authority?: Context) {
 if (id) return syncPayout(env, id, authority)
 for await (const payout of stripePages(env, '/payouts')) await syncPayout(env, payout.id, authority)
 return payoutList({ db: env.DB })
}
