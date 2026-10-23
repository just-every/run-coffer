import { all, today, type Row } from './db'
import { settings } from './settings'

/** Fiscal years are labelled by their start date, including a short current year. */
export function fiscalPeriod(day: string, start: string) {
 const year = Number(day.slice(0, 4)) - (day.slice(5) < start ? 1 : 0)
 return { start: `${year}-${start}`, end: `${year + 1}-${start}`, previousStart: `${year - 1}-${start}` }
}

export async function givingSummary(c: { db: D1Database; now?: string }, donorId: string, history: {
 gifts: Row[]; pledges: Row[]; subscriptions: Row[]; recognitionCents: number
}) {
 const [s, balances] = await Promise.all([
  settings(c),
  all(c, 'SELECT * FROM cf_gift_balances WHERE donor_id=? AND net_cents>0 ORDER BY received_on,created_at,id', donorId),
 ])
 const day = today(s.timezone,c.now?new Date(c.now):new Date()), period = fiscalPeriod(day, s.fiscal_year_start)
 const total = (from: string, to: string) => history.gifts.filter(g => g.received_on >= from && g.received_on < to).reduce((n, g) => n + g.amount_cents, 0)
 const years = new Map<number, number>()
 for (const gift of history.gifts) {
  const year = Number(fiscalPeriod(gift.received_on, s.fiscal_year_start).start.slice(0, 4))
  years.set(year, (years.get(year) ?? 0) + gift.amount_cents)
 }
 let year = Number(period.start.slice(0, 4)), streak = 0
 // A donor keeps last year's streak while this year's gift is still to come.
 if ((years.get(year) ?? 0) <= 0) year--
 while ((years.get(year) ?? 0) > 0) { streak++; year-- }
 const largest = balances.reduce<Row | null>((best, gift) => !best || gift.net_cents > best.net_cents ? gift : best, null)
 const gift = (g: Row | null | undefined) => g ? { id: g.id, receivedOn: g.received_on, amountCents: g.net_cents, originalAmountCents: g.amount_cents, fund: g.fund } : null
 const recurring = history.subscriptions.map(plan => ({ id: plan.id, status: plan.status, amountCents: plan.amount_cents, cancelAtPeriodEnd: !!plan.cancel_at_period_end,interval:plan.interval??null,intervalCount:plan.interval_count??null,collectionsPaused:!!plan.collection_paused }))
 return {
  lifetimeCents: history.gifts.reduce((n, g) => n + g.amount_cents, 0),
  firstGift: gift(balances[0]), largestGift: gift(largest), lastGift: gift(balances.at(-1)), giftCount: balances.length,
  consecutiveGivingYears: streak, recurring,
  openPledgeCents: history.pledges.reduce((n, pledge) => n + pledge.remaining_cents, 0),
  softCreditCents: history.recognitionCents,
  fiscalYear: { ...period, asOf: day, startMonthDay: s.fiscal_year_start, currentCents: total(period.start, period.end), previousCents: total(period.previousStart, period.start) },
 }
}
