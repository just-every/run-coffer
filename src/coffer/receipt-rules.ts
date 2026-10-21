import { withContributionTypes } from './contribution-receipts'
import { all, choice, fail, guard, integer, one, sql, text, type Row } from './db'
import { amount, usd } from './money'
import type { Settings } from './settings'

/** Benefits are assessed on receipt and retained beside the immutable gift.
 * Ledger goods_cents is the deductible reduction; the actual benefit facts
 * and the reviewed year's limits remain in the separate frozen record. */
export function receiptBenefit(p: Row, cents: number, received: string, s: Settings) {
 if (!['token', 'religious'].includes(p.goods)) return null
 const description = text(p.goodsDescription, 'Benefit description', 300)
 if (p.goods === 'religious') {
  if (!s.religious_organization) fail('RELIGIOUS_ORGANIZATION', 'Review the exclusively religious organization setting before recording intangible religious benefits.', 409)
  return { kind: 'religious', description, fairValueCents: null, costCents: null, basis: 'religious', settingsVersion: s.version,
   statement: 'The only goods or services provided in exchange for this contribution consisted entirely of intangible religious benefits. These benefits are not generally sold in commercial transactions outside the donative context.' }
 }
 if (!s.token_year || Number(received.slice(0, 4)) !== s.token_year) fail('TOKEN_YEAR', 'Review the IRS token-benefit limits for the gift’s calendar year before using this exception.', 409)
 const basis = choice(p.tokenBasis, ['fair_value', 'logo_cost'] as const, 'token-benefit rule')
 const fairValueCents = amount(p, 'goodsValue', 'Good-faith fair market value', { allowZero: true })
 const costCents = basis === 'logo_cost' ? amount(p, 'tokenCost', 'Aggregate cost of logo items', { allowZero: true }) : null
 if (p.onlyBenefit !== true && p.onlyBenefit !== 'yes') fail('TOKEN_CONFIRMATION', 'Confirm these are the only goods or services received.', 400)
 if (basis === 'fair_value') {
  if (p.fundraisingCampaign !== true && p.fundraisingCampaign !== 'yes') fail('TOKEN_CONFIRMATION', 'Confirm the benefit was provided in a charitable fundraising campaign.', 400)
  if (fairValueCents * 100 > cents * 2 || fairValueCents > s.token_max_value_cents) fail('TOKEN_LIMIT', 'The benefit exceeds the reviewed 2%-or-dollar limit. Record its actual goods value instead.', 400)
 } else {
  if (p.charityLogo !== true && p.charityLogo !== 'yes') fail('TOKEN_CONFIRMATION', 'Confirm all the items bear the charity’s name or logo.', 400)
  if (cents < s.token_min_gift_cents || costCents! > s.token_max_cost_cents) fail('TOKEN_LIMIT', 'The gift or aggregate logo-item cost does not meet the reviewed limits. Record actual goods instead.', 400)
 }
 return { kind: 'token', description, fairValueCents, costCents, basis, year: s.token_year, settingsVersion: s.version,
  limits: { maximumValueCents: s.token_max_value_cents, minimumGiftCents: s.token_min_gift_cents, maximumCostCents: s.token_max_cost_cents },
  statement: `The only benefit provided was ${description}, treated as insubstantial under the organization’s reviewed ${s.token_year} IRS token-benefit ${basis === 'fair_value' ? 'fair-market-value' : 'name-or-logo cost'} rule. No goods or services other than this insubstantial benefit were provided in exchange for this contribution.` }
}

export function benefitStatements(giftId: string, benefit: Row | null, s: Settings) {
 return benefit ? [guard('EXISTS(SELECT 1 FROM cf_settings WHERE id=1 AND version=?)', 'SETTINGS_CHANGED', 'Receipt rules changed. Review the gift again.', s.version),
  sql('INSERT INTO cf_receipt_benefits(gift_id,kind,snapshot,statement) VALUES(?,?,?,?)', giftId, benefit.kind, JSON.stringify(benefit), benefit.statement)] : []
}

export async function withReceiptBenefits(c: { db: D1Database }, gifts: Row[]) {
 if (!gifts.length) return gifts
 await withContributionTypes(c, gifts)
 const rows = await all(c, 'SELECT * FROM cf_receipt_benefits WHERE gift_id IN (SELECT value FROM json_each(?))', JSON.stringify(gifts.map(g => g.id)))
 for (const gift of gifts) {
  const benefit = rows.find(r => r.gift_id === gift.id)
  if (benefit) { gift.receipt_benefit = JSON.parse(benefit.snapshot); gift.receipt_statement = benefit.statement }
 }
 return gifts
}

export async function receiptRuleSettings(c: { db: D1Database }, p: Row) {
 const old = await one<Settings>(c, 'SELECT * FROM cf_settings WHERE id=1')
 const religious = p.religiousOrganization === undefined ? old!.religious_organization : ['yes', true, 1, '1'].includes(p.religiousOrganization) ? 1 : ['no', false, 0, '0'].includes(p.religiousOrganization) ? 0 : fail('INPUT', 'Choose whether the organization is exclusively religious.', 400)
 if (p.tokenYear === undefined || p.tokenYear === '') return { religious, year: old!.token_year, maxValue: old!.token_max_value_cents, minGift: old!.token_min_gift_cents, maxCost: old!.token_max_cost_cents }
 const year = integer(Number(p.tokenYear), 'IRS limits calendar year', 1900, 9999)
 if (p.tokenReviewed !== true && p.tokenReviewed !== 'yes') fail('TOKEN_REVIEW', 'Confirm the year’s IRS limits have been reviewed.', 400)
 return { religious, year, maxValue: amount(p, 'tokenMaxValue', 'Maximum insubstantial fair value'), minGift: amount(p, 'tokenMinGift', 'Minimum gift for logo items'), maxCost: amount(p, 'tokenMaxCost', 'Maximum aggregate logo-item cost') }
}
