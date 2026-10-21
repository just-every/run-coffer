import { NAME_MERGE_FIELDS, personNames } from './person-names'
import { CONTACT_MERGE_FIELDS, fieldPattern, fillFields, recipientMergeFields, renderTemplate, templateTokens } from './template-fields'
import { receiptRuleSettings } from './receipt-rules'
import { commit, event, fail, guard, integer, longText, one, optional, sql, text, type Context, type Row } from './db'
import { amount, usd } from './money'

export type Settings = {
 name_defaults: string; version: number; organisation: string; ein: string; timezone: string; threshold_cents: number; target_days: number
 letter_subject: string; letter_template: string; none_statement: string; goods_statement: string; reviewed_at: string | null; reviewed_by: string | null
 religious_organization: number; token_year: number | null; token_max_value_cents: number; token_min_gift_cents: number; token_max_cost_cents: number
 fiscal_year_start: string
 online_receipts: 'automatic' | 'review'
}
export async function settings(c: { db: D1Database }): Promise<Settings> {
 const row = await one<Settings>(c, 'SELECT * FROM cf_settings WHERE id=1')
 if (!row) fail('STORAGE', 'Coffer migrations have not been applied.', 503)
 return row
}

export const LETTER = [...NAME_MERGE_FIELDS, ...CONTACT_MERGE_FIELDS, 'date', 'donor_name', 'amount', 'gift_date', 'fund', 'goods_statement', 'organization', 'ein', 'deductible_amount']
export const LETTER_REQUIRED = ['donor_name', 'amount', 'gift_date', 'goods_statement', 'organization', 'ein']
const GOODS = ['goods_value', 'goods_description', 'deductible_amount', 'amount']
const placeholders = (value: string) => templateTokens(value).map(t => t.field)
export function checkTemplate(value: string, label: string, allowed: string[], required: string[]) {
 const tokens = templateTokens(value), used = tokens.map(t => t.field), unknown = used.filter(x => !allowed.includes(x)), missing = required.filter(x => !used.includes(x))
 if (unknown.length) fail('TEMPLATE', `${label} uses unknown fields: ${unknown.map(x => `{{${x}}}`).join(', ')}.`, 400)
 if (missing.length) fail('TEMPLATE', `${label} must include ${missing.map(x => `{{${x}}}`).join(', ')}.`, 400)
 if (tokens.some(t => t.fallback === '') || /\{\{|\}\}/.test(value.replace(fieldPattern(), ''))) fail('TEMPLATE', `${label} has an unclosed or malformed {{field}}.`, 400)
}

/** The letter wording is the charity's own. Coffer only checks that the facts a
 * US written acknowledgement states (amount, date, goods or services) are present. */
export async function settingsCommand(c: Context, p: Row) {
 const version = integer(p.version, 'Version', 1), organisation = text(p.organisation, 'Organization name', 200), ein = text(p.ein, 'EIN', 20)
 if (ein && !/^\d{2}-\d{7}$/.test(ein)) fail('INPUT', 'EIN must look like 12-3456789.', 400)
 const timezone = text(p.timezone, 'Time zone', 60)
 try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }) } catch { fail('INPUT', 'Choose a time zone such as America/New_York.', 400) }
 const threshold = amount(p, 'threshold', 'Acknowledgement threshold', { allowZero: true }), targetDays = integer(typeof p.targetDays === 'string' ? Number(p.targetDays) : p.targetDays, 'Days to send', 1, 365)
 const subject = text(p.letterSubject, 'Letter subject', 200), template = longText(p.letterTemplate, 'Letter', 8000)
 const none = longText(p.noneStatement, 'No goods or services statement', 1000), goods = longText(p.goodsStatement, 'Goods or services statement', 1000)
 checkTemplate(subject, 'Letter subject', LETTER, [])
 checkTemplate(template, 'Letter', LETTER, LETTER_REQUIRED)
 checkTemplate(none, 'No goods or services statement', [], [])
 checkTemplate(goods, 'Goods or services statement', GOODS, ['goods_value', 'goods_description'])
 if (!ein && placeholders(subject + template).includes('ein')) fail('TEMPLATE', 'Add your EIN or remove {{ein}} from the letter.', 400)
 const fiscalStart = p.fiscalYearStart === undefined ? null : text(p.fiscalYearStart, 'Fiscal year start', 5)
 if (fiscalStart && (!/^\d{2}-\d{2}$/.test(fiscalStart) || Number.isNaN(Date.parse(`2001-${fiscalStart}T00:00:00Z`)) || new Date(`2001-${fiscalStart}T00:00:00Z`).toISOString().slice(5, 10) !== fiscalStart)) fail('INPUT', 'Fiscal year start must be a month and day such as 07-01 (not February 29).', 400)
 const onlineReceipts = p.onlineReceipts === undefined || p.onlineReceipts === '' ? null : p.onlineReceipts === 'review' ? 'review' : p.onlineReceipts === 'automatic' ? 'automatic' : fail('INPUT', 'Choose when online gift receipts go out.', 400)
 const rules = await receiptRuleSettings(c, p)
 await commit(c, [guard('EXISTS(SELECT 1 FROM cf_settings WHERE id=1 AND version=?)', 'VERSION', 'Settings changed. Refresh before saving.', version),
  sql('UPDATE cf_settings SET version=version+1,organisation=?,ein=?,timezone=?,threshold_cents=?,target_days=?,letter_subject=?,letter_template=?,none_statement=?,goods_statement=?,online_receipts=COALESCE(?,online_receipts),fiscal_year_start=COALESCE(?,fiscal_year_start),reviewed_at=?,reviewed_by=? WHERE id=1',
   organisation, ein, timezone, threshold, targetDays, subject, template, none, goods, onlineReceipts, fiscalStart, c.now, c.actor.name),
  sql('UPDATE cf_settings SET religious_organization=?,token_year=?,token_max_value_cents=?,token_min_gift_cents=?,token_max_cost_cents=? WHERE id=1', rules.religious, rules.year, rules.maxValue, rules.minGift, rules.maxCost),
  event(c, 'settings.update', 'settings', '1', null, { version: version + 1, thresholdCents: threshold })])
 return { version: version + 1 }
}

export const longDate = (day: string) => new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`))
export const fill = fillFields

/** The charity's reviewed goods-or-services wording for one gift. */
export const goodsStatement = (s: Settings, gift: Row) => gift.receipt_statement ?? (gift.goods === 'provided'
 ? fill(s.goods_statement, { goods_value: usd(gift.goods_cents), goods_description: gift.goods_description ?? '', deductible_amount: usd(gift.amount_cents - gift.goods_cents), amount: usd(gift.amount_cents) }) + `\nThe deductible contribution for federal income tax purposes is limited to the excess of the payment over the good-faith fair market value of the goods or services: ${usd(gift.amount_cents - gift.goods_cents)}.`
 : s.none_statement)

/** Renders the settings letter, or a reviewed RCPT-007 template chosen for this gift. */
export function renderLetter(s: Settings, gift: Row, recipient: Row, day: string, template?: { subject: string; body: string } | null) {
 const wording = template ?? { subject: s.letter_subject, body: s.letter_template }
 if (!s.ein || !placeholders(wording.body).includes('ein')) fail('RECEIPT_FACTS', 'Review letter settings: a receipt must include the organization’s EIN.', 409)
 const deductible = usd(gift.amount_cents - gift.goods_cents), goods = goodsStatement(s, gift)
 const fields = { date: longDate(day), ...recipientMergeFields(recipient), donor_name: recipient.letter_salutation ?? personNames(recipient).informal, amount: usd(gift.amount_cents), gift_date: longDate(gift.received_on), fund: gift.receipt_fund ?? gift.fund, goods_statement: goods, organization: s.organisation, ein: s.ein, deductible_amount: deductible }
 return renderTemplate(wording, fields)
}
