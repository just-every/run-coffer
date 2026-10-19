import { fail } from '../db'
import { managed, stripe, type GivingEnv } from '../giving/stripe'
import { signLiveStripeInput } from './live-review'
import { snapshotLimits } from './snapshots'
import type { SnapshotInput } from './types'

const id = (value: any): string => typeof value === 'string' ? value : value?.id ?? ''
const list = (data: any[]) => ({ object: 'list', data, has_more: false })
async function batches<T, R>(values: T[], read: (value: T) => Promise<R>): Promise<R[]> {
 const results: R[] = []
 for (let start = 0; start < values.length; start += 5) results.push(...await Promise.all(values.slice(start, start + 5).map(read)))
 return results
}

function date(value: unknown, label: string) {
 if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) fail('stripe_dates', `Choose ${label}.`, 400)
 const seconds = Date.parse(value + 'T00:00:00Z') / 1000
 if (!Number.isSafeInteger(seconds) || new Date(seconds * 1000).toISOString().slice(0, 10) !== value) fail('stripe_dates', `Choose a valid ${label}.`, 400)
 return seconds
}

/** Read-only Stripe calls. The optional restricted key lives only in this request. */
export async function readStripe(env: GivingEnv, input: Record<string, any>): Promise<SnapshotInput> {
 if (managed(env)) fail('not_available', 'Stripe move-in is not available on RER Managed yet.', 503)
 const key = String(input.readKey ?? '').trim()
 if (key && !/^rk_(test|live)_[A-Za-z0-9]+$/.test(key)) fail('stripe_read_key', 'Use a restricted key starting rk_test_ or rk_live_, or leave it empty to use Giving’s connection.', 400)
 const connection = key ? { ...env, STRIPE_SECRET_KEY: key } : env
 const start = date(input.start, 'the first gift date'), end = date(input.end, 'the last gift date') + 86400
 if (start >= end) fail('stripe_dates', 'The last gift date must be on or after the first.', 400)
 const range = `created[gte]=${start}&created[lt]=${end}`
 let calls = 0
 async function get(path: string): Promise<any> {
  if (++calls > 250) fail('stripe_import_size', 'This date range needs too many Stripe requests. Choose a shorter period; nothing has moved in.', 400)
  try { return await stripe(connection, path) } catch (error: any) {
   if (error.code === 'not_available') throw error
   fail('stripe_read_failed', 'Coffer could not read Stripe. Check that the key belongs to this account and has Read permission for Customers, Charges, Payment Intents, Subscriptions and Invoices. Nothing has moved in.', 502)
  }
 }
 async function pages(path: string, max = snapshotLimits.records) {
  const rows: any[] = [], seen = new Set<string>()
  let after = ''
  for (;;) {
   const page = await get(path + (path.includes('?') ? '&' : '?') + 'limit=100' + (after ? '&starting_after=' + encodeURIComponent(after) : ''))
   if (!Array.isArray(page.data) || typeof page.has_more !== 'boolean') fail('stripe_list', 'Stripe returned an incomplete list. Nothing has moved in.', 502)
   for (const row of page.data) {
    if (!id(row) || seen.has(id(row))) fail('stripe_list', 'Stripe repeated a record while reading. Preview again; nothing has moved in.', 502)
    seen.add(id(row)); rows.push(row)
   }
   if (rows.length > max) fail('stripe_import_size', 'This period is too large for one review. Choose a shorter period; Coffer will skip records already moved in.', 400)
   if (!page.has_more) return rows
   const next = id(page.data.at(-1))
   if (!next || next === after) fail('stripe_list', 'Stripe returned an incomplete page. Nothing has moved in.', 502)
   after = next
  }
 }
 const [charges, intents, invoices, subscriptions] = await Promise.all([
  pages('/charges?' + range), pages('/payment_intents?' + range), pages('/invoices?' + range), pages('/subscriptions?status=all&' + range),
 ])
 // Resolve successful intents to their actual charge; never invent a second gift
 // from an invoice amount or a PaymentIntent amount.
 const chargeIds = new Set(charges.map(c => c.id))
 for (const intent of intents) {
  const ref = id(intent.latest_charge)
  if (intent.status === 'succeeded' && ref && !chargeIds.has(ref)) {
   const charge = await get('/charges/' + encodeURIComponent(ref))
   if (charge.created >= start && charge.created < end) { charges.push(charge); chargeIds.add(ref) }
  }
 }
 // Modern Stripe invoice payments connect invoice references already used by
 // Coffer Giving to their PaymentIntent/charge, so those gifts also deduplicate.
 const invoiceForIntent = new Map<string,string>()
 const invoicePayments = await batches(invoices.filter(i => i.amount_paid > 0), async invoice => ({ invoice, payments: await pages('/invoice_payments?invoice=' + encodeURIComponent(invoice.id)) }))
 for (const { invoice, payments } of invoicePayments) for (const payment of payments) {
  const intent = id(payment.payment?.payment_intent)
  if (intent) invoiceForIntent.set(intent, invoice.id)
 }
 for (const charge of charges) {
  const invoice = invoiceForIntent.get(id(charge.payment_intent))
  if (invoice && !charge.invoice) charge.invoice = invoice
 }
 const relevant = new Set(charges.map(c => id(c.customer)).filter(Boolean))
 const subIds = new Set(subscriptions.map(s => s.id))
 const customerPlans = await batches([...relevant], customer => pages('/subscriptions?status=all&customer=' + encodeURIComponent(customer)))
 for (const sub of customerPlans.flat()) if (!subIds.has(sub.id)) { subscriptions.push(sub); subIds.add(sub.id) }
 const plans = subscriptions
 for (const sub of plans) relevant.add(id(sub.customer))
 const customers = await batches([...relevant].filter(Boolean), customer => get('/customers/' + encodeURIComponent(customer)))
 if (!charges.length && !plans.length) fail('stripe_import_empty', 'Stripe has no charges or subscriptions in this period. Choose another date range.', 400)
 // Context objects contain no client secrets or payment details. They are
 // retained with the approved review, but never become additional gifts.
 return signLiveStripeInput({
  customers: [list(customers)], charges: [list(charges)], subscriptions: [list(plans)],
  paymentIntents: [list(intents.map(p => ({ id: p.id, created: p.created, status: p.status, amount: p.amount, currency: p.currency, customer: id(p.customer), latest_charge: id(p.latest_charge) })))],
  invoices: [list(invoices.map(i => ({ id: i.id, created: i.created, status: i.status, amount_paid: i.amount_paid, currency: i.currency, customer: id(i.customer), subscription: id(i.parent?.subscription_details?.subscription ?? i.subscription), paid_out_of_band: i.paid_out_of_band === true })))],
  noGoodsOrServices: input.noGoodsOrServices === true || input.noGoodsOrServices === 'yes',
 }, env.SESSION_SECRET)
}
