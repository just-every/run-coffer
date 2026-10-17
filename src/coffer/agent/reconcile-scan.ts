import { all, one, sha256, type Context, type Row } from '../db'
import type { GivingEnv } from '../giving/stripe'
import { stripePages, stripeId } from '../payments/stripe-data'

export type Correction = { fund: string; cents: number }
export type Finding = { sourceId: string; kind: string; summary: string; why: string; evidence: Row; proposed: Row }
export const fingerprint = (finding: Finding) => sha256(JSON.stringify(finding))
export const chargeEvidence = (charge: Row) => ({ id: charge.id, currency: charge.currency, amount: charge.amount, refunded: charge.amount_refunded ?? 0, paid: charge.paid, status: charge.status, fund: charge.metadata?.fund ?? null })

/** Provider facts and immutable contribution lines only. No donor PII is retained. */
export async function chargeFinding(c: Context, charge: Row, env?: GivingEnv): Promise<Finding | null> {
 if (!charge.paid || charge.status !== 'succeeded') return null
 const base = { sourceId: charge.id, evidence: { stripe: chargeEvidence(charge) } }
 if (charge.currency !== 'usd') return { ...base, kind: 'currency', summary: 'Stripe charge uses an unsupported currency.', why: 'Coffer’s contribution ledger supports USD. Currency conversion needs reviewed accounting evidence.', proposed: { action: 'review', detail: 'Review this charge in Stripe; no conversion or deposit will be invented.' } }
 if (!Number.isSafeInteger(charge.amount) || charge.amount <= 0 || !Number.isSafeInteger(charge.amount_refunded ?? 0) || (charge.amount_refunded ?? 0) < 0 || (charge.amount_refunded ?? 0) > charge.amount) return { ...base, kind:'invalid_charge', summary:'Stripe charge amounts need review.', why:'Gross and refunded cents must be valid nonnegative USD amounts.', proposed:{action:'review',detail:'Review the processor facts; no ledger correction is available.'} }
 const refs = [charge.id, stripeId(charge.payment_intent), stripeId(charge.invoice)].filter(Boolean)
 const customerId=stripeId(charge.customer),pi=stripeId(charge.payment_intent)
 if(env && customerId && pi && (await one(c,'SELECT 1 FROM cf_giving_customers WHERE customer_id=?',customerId) || await one(c,'SELECT 1 FROM cf_giving_intents WHERE customer_id=?',customerId))) {
  for await(const payment of stripePages(env,'/invoice_payments?payment[type]=payment_intent&payment[payment_intent]='+encodeURIComponent(pi))) {
   const invoice=stripeId(payment.invoice);if(invoice) refs.push(invoice)
  }
 }
 const gift = await one(c, `SELECT g.* FROM cf_gifts g WHERE g.kind='gift' AND
  (g.id=(SELECT gift_id FROM cf_stripe_charges WHERE id=?) OR (g.source='stripe' AND g.reference IN (SELECT value FROM json_each(?))))
  ORDER BY CASE WHEN g.id=(SELECT gift_id FROM cf_stripe_charges WHERE id=?) THEN 0 ELSE 1 END,g.id LIMIT 1`, charge.id, JSON.stringify(refs), charge.id)
 if (!gift && stripeId(charge.customer) && await one(c,'SELECT 1 FROM cf_erased_stripe_customers WHERE customer_id=?',stripeId(charge.customer))) return null
 if (!gift && (charge.amount_refunded ?? 0)>0) return {...base,kind:'missing_gift',summary:'Refunded Stripe charge has no linked Coffer gift.',why:'A missing gift and its refund must be recorded together without losing the processor refund baseline.',proposed:{action:'review',detail:'Sync this charge and its exact refund balance transactions in Payments before reconciling its contribution.'}}
 if (!gift) return { ...base, kind: 'missing_gift', summary: 'Successful Stripe charge has no linked Coffer gift.', why: 'No gift matched the charge, payment intent or invoice reference. A reviewed sync must preserve donor and erasure matching.', proposed: { action: 'missing_gift', detail: 'Sync this verified charge through the existing Stripe donor matching flow. Undo records a normal gift reversal; it never refunds the charge.' } }
 const donor = await one(c, 'SELECT erased_at FROM cf_donors WHERE id=?', gift.donor_id)
 if (donor?.erased_at) return null
 const entries = await all(c, 'SELECT id,kind,fund,contribution_cents FROM cf_payment_entries WHERE gift_id=? ORDER BY id', gift.id)
 const reversals = await all(c, 'SELECT id,fund,amount_cents FROM cf_gifts WHERE reverses=? ORDER BY id', gift.id)
 const campaign = await one(c, 'SELECT c.fund FROM cf_campaign_gifts x JOIN cf_campaigns c ON c.id=x.campaign_id WHERE x.gift_id=? ORDER BY c.id LIMIT 1', gift.id)
 const fund = String(campaign?.fund ?? charge.metadata?.fund ?? gift.fund).trim().slice(0,100) || gift.fund
 // A dispute remains a separate processor fact, independent of refunds.
 const disputes = entries.filter(e => ['dispute','dispute_reversal'].includes(e.kind)).reduce((n,e) => n + e.contribution_cents, 0)
 const expected = charge.amount - (charge.amount_refunded ?? 0) + disputes
 if (!Number.isSafeInteger(expected) || expected < 0 || !Number.isSafeInteger(charge.amount) || !Number.isSafeInteger(charge.amount_refunded ?? 0)) return { ...base, kind:'invalid_charge', summary:'Stripe charge amounts need review.', why:'Amounts do not form a valid nonnegative USD contribution.', proposed:{action:'review',detail:'Review the processor facts; no ledger correction is available.'} }
 const allocation = new Map<string,number>([[gift.fund, gift.amount_cents]])
 for (const row of [...reversals.map(r => ({fund:r.fund, contribution_cents:r.amount_cents})), ...entries]) allocation.set(row.fund,(allocation.get(row.fund) ?? 0)+row.contribution_cents)
 const changes: Correction[] = [...new Set([...allocation.keys(), fund])].sort().map(key => ({ fund:key, cents:(key === fund ? expected : 0)-(allocation.get(key) ?? 0) })).filter(row => row.cents)
 if (!changes.length) return null
 const total = [...allocation.values()].reduce((n,v)=>n+v,0)
 return { sourceId:charge.id, kind:'contribution', summary: total !== expected ? 'Stripe and Coffer contribution amounts differ.' : 'Stripe and Coffer fund allocations differ.',
  why:'Compare the charge less all refunded cents, preserving dispute adjustments, against the original gift, manual reversals and every contribution adjustment. Fees do not reduce donor giving.',
  evidence:{stripe:chargeEvidence(charge),gift:{id:gift.id,fund:gift.fund,amount:gift.amount_cents,receivedOn:gift.received_on},entries,reversals,actual:Object.fromEntries([...allocation].sort()),expected:{fund,cents:expected}},
  proposed:{action:'contribution',giftId:gift.id,chargeId:charge.id,receivedOn:gift.received_on,changes,detail:'Append contribution corrections by fund. Stripe charges, fees, payout deposits and original gifts remain immutable.'} }
}
