import { usd } from '../money'
import type { ParsedImport } from './types'

/** Rounded instalments can differ by up to one cent each. Keep both the promise
 * and every received cent, rather than changing cash to fit the promise. */
export function pledgeChecks(out: ParsedImport) {
 for (const pledge of out.pledges) {
  const schedule = out.installments.filter(i => i.pledgeExternalId === pledge.externalId)
  const payments = out.gifts.filter(g => g.pledgeExternalId === pledge.externalId)
  const scheduled = schedule.reduce((sum, i) => sum + i.amountCents, 0)
  const paid = payments.reduce((sum, g) => sum + g.amountCents, 0)
  if (schedule.length && Math.abs(scheduled - pledge.amountCents) > schedule.length)
   out.diagnostics.push({ ...pledge.location, severity: 'error', code: 'INSTALLMENT_TOTAL', column: 'Amount', message: `Pledge ${pledge.externalId} promises ${usd(pledge.amountCents)} but its installments total ${usd(scheduled)}. Correct the installment Amount values to total the promise, or correct the Pledge row's Amount to ${usd(scheduled)} if that is the actual promise.` })
  if (paid > pledge.amountCents + payments.length)
   out.diagnostics.push({ ...pledge.location, severity: 'error', code: 'PLEDGE_OVERPAID', column: 'Amount', message: `Pledge ${pledge.externalId} promises ${usd(pledge.amountCents)} but linked gifts total ${usd(paid)}, above the one-cent-per-payment rounding allowance. Check the payments' Parent Gift ID links and correct any linked to the wrong pledge. If an extra gift was a separate donation, clear Parent Gift ID on that gift. If the promise increased, set this Pledge row's Amount to ${usd(paid)} (and update any installment schedule). Keep the amounts of money actually received.` })
  else if (paid > pledge.amountCents)
   out.diagnostics.push({ ...pledge.location, severity: 'warning', code: 'PLEDGE_ROUNDING', column: 'Amount', message: `Pledge ${pledge.externalId}: ${payments.length} payments total ${usd(paid)} against a ${usd(pledge.amountCents)} promise. The difference is within one cent per payment. The promise stays ${usd(pledge.amountCents)} and the pledge records all ${usd(paid)} actually paid. No change is needed.` })
  for (const gift of payments) if (gift.donorExternalId !== pledge.donorExternalId || gift.fund !== pledge.fund)
   out.diagnostics.push({ ...gift.location, severity: 'error', code: 'PLEDGE_PAYMENT', column: 'Fund / Constituent ID', message: `Payment ${gift.externalId} must use pledge ${pledge.externalId}'s constituent ${pledge.donorExternalId} and fund “${pledge.fund}”. Set this row's Constituent ID and Fund to those values, or correct its Parent Gift ID if it pays another pledge.` })
 }
}
