import { fail, today } from '../db'
import { stripe, type GivingEnv } from '../giving/stripe'
export { stripeId } from '../giving/recording'

export function cents(value: unknown): number {
 if (!Number.isSafeInteger(value)) fail('invalid_payment', 'Stripe returned an invalid amount.', 409)
 return value as number
}
function stamp(seconds: number) {
 if (!Number.isSafeInteger(seconds) || seconds <= 0) fail('invalid_payment', 'Stripe returned an invalid date.', 409)
 return new Date(seconds * 1000)
}
/** A Stripe moment (charge or balance transaction) on the organization's calendar, as the Stripe move-in dates it. */
export const day = (seconds: number, timezone: string): string => today(timezone, stamp(seconds))
/** A Stripe calendar date (a payout's arrival date), which Stripe sends as midnight UTC. */
export const utcDay = (seconds: number): string => stamp(seconds).toISOString().slice(0, 10)
export async function* stripePages(env: GivingEnv, path: string): AsyncGenerator<any> {
 let after = ''
 for (;;) {
  const separator = path.includes('?') ? '&' : '?'
  const page = await stripe(env, path + separator + 'limit=100' + (after ? '&starting_after=' + encodeURIComponent(after) : ''))
  if (!Array.isArray(page.data)) fail('invalid_payment', 'Stripe returned an invalid list.', 502)
  for (const row of page.data) yield row
  if (!page.has_more) return
  const next = page.data.at(-1)?.id
  if (!next || next === after) fail('invalid_payment', 'Stripe returned an incomplete list.', 502)
  after = next
 }
}
