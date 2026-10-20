import { requireRole } from '../auth'
import { commit, event, fail, guard, one, sql, type Context, type Row } from '../db'
import { box, e, field, hidden } from '../ui/common'

function integer(value: unknown, label: string, max: number): number {
 if (!/^[0-9]+$/.test(String(value ?? '')) || !Number.isSafeInteger(Number(value)) || Number(value) > max) fail('INPUT', `Enter ${label} as a whole number from 0 to ${max}.`, 400)
 return Number(value)
}
export function feeCoverConfig(input: Row) {
 const enabled = input.feeCoverEnabled === 'yes' || input.feeCoverEnabled === true ? 1 : 0
 const blank = (value: unknown) => value === undefined || value === null || value === ''
 if (!enabled && blank(input.feeCoverRateBps) && blank(input.feeCoverFixedCents)) return { enabled, rate: null, fixed: null }
 return { enabled, rate: integer(input.feeCoverRateBps, 'the estimated rate in basis points', 9999), fixed: integer(input.feeCoverFixedCents, 'the estimated fixed fee in cents', 10000000) }
}

/** ceil((gift + fixed) / (1 - rate)), entirely in integer cents. */
export function feeCoverTotal(base: number, rate: number, fixed: number): number {
 const denominator = 10000n - BigInt(rate), numerator = (BigInt(base) + BigInt(fixed)) * 10000n
 const total = Number((numerator + denominator - 1n) / denominator)
 if (!Number.isSafeInteger(total)) fail('INPUT', 'The estimated total is too large. Enter a smaller gift.', 400)
 return total
}

export async function updateFeeCover(c: Context, campaignId: string, input: Row) {
 requireRole(c.actor, ['owner', 'admin'], 'publish campaigns')
 const config = feeCoverConfig(input), version = integer(input.version, 'the configuration version', Number.MAX_SAFE_INTEGER)
 await commit(c, [
  guard('EXISTS(SELECT 1 FROM cf_campaigns WHERE id=? AND fee_cover_version=?)', 'STALE', 'This campaign changed. Refresh before saving.', campaignId, version),
  sql('UPDATE cf_campaigns SET fee_cover_enabled=?,fee_cover_rate_bps=?,fee_cover_fixed_cents=?,fee_cover_version=fee_cover_version+1 WHERE id=?', config.enabled, config.rate, config.fixed, campaignId),
  event(c, 'campaign.fee-cover', 'campaign', campaignId, null, config),
 ])
 return one(c, 'SELECT id,fee_cover_enabled,fee_cover_rate_bps,fee_cover_fixed_cents,fee_cover_version FROM cf_campaigns WHERE id=?', campaignId)
}

export function feeCoverFields(row: Row = {}) {
 return `<label><input type="checkbox" name="feeCoverEnabled" value="yes"${row.fee_cover_enabled ? ' checked' : ''}> Offer optional donor fee cover</label><p class="muted">Your estimate, not a Stripe-verified rate. Set both amounts before enabling. The donor sees the exact total before checkout; reports use the actual Stripe balance transaction fee.</p><div class="fields">${field('Estimated rate (basis points; 290 = 2.90%)', 'feeCoverRateBps', 'number', row.fee_cover_rate_bps ?? '', 'min="0" max="9999" step="1"')}${field('Estimated fixed fee (cents; 30 = $0.30)', 'feeCoverFixedCents', 'number', row.fee_cover_fixed_cents ?? '', 'min="0" max="10000000" step="1"')}</div>`
}
export function feeCoverSettings(c: Context, row: Row) {
 if (!['owner', 'admin'].includes(c.actor.role)) return ''
 return box('Donor fee cover', `<p>${row.fee_cover_enabled ? 'Optional fee cover is enabled.' : 'Optional fee cover is disabled.'} Existing checkouts and monthly plans keep their agreed amounts.</p><form method="post" action="/app/giving/campaigns/${e(row.id)}/fee-cover">${hidden('version', row.fee_cover_version)}${feeCoverFields(row)}<button>Save fee cover</button></form>`)
}
