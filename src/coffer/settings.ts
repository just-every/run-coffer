import { commit, event, fail, guard, integer, longText, one, optional, sql, text, type Context, type Row } from './db'
import { amount, usd } from './money'

export type Settings = {
 version: number; organisation: string; ein: string; timezone: string; threshold_cents: number; target_days: number
 letter_subject: string; letter_template: string; none_statement: string; goods_statement: string; reviewed_at: string | null; reviewed_by: string | null
}
export async function settings(c: { db: D1Database }): Promise<Settings> {
 const row = await one<Settings>(c, 'SELECT * FROM cf_settings WHERE id=1')
 if (!row) fail('STORAGE', 'Coffer migrations have not been applied.', 503)
 return row
}

const LETTER = ['date', 'donor_name', 'amount', 'gift_date', 'fund', 'goods_statement', 'organization', 'ein', 'deductible_amount']
const GOODS = ['goods_value', 'goods_description', 'deductible_amount', 'amount']
const placeholders = (value: string) => [...value.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map(m => m[1])
function check(value: string, label: string, allowed: string[], required: string[]) {
 const used = placeholders(value), unknown = used.filter(x => !allowed.includes(x)), missing = required.filter(x => !used.includes(x))
 if (unknown.length) fail('TEMPLATE', `${label} uses unknown fields: ${unknown.map(x => `{{${x}}}`).join(', ')}.`, 400)
 if (missing.length) fail('TEMPLATE', `${label} must include ${missing.map(x => `{{${x}}}`).join(', ')}.`, 400)
 if (/\{\{|\}\}/.test(value.replace(/\{\{\s*[a-z_]+\s*\}\}/g, ''))) fail('TEMPLATE', `${label} has an unclosed {{field}}.`, 400)
}

/** The letter wording is the charity's own. Coffer only checks that the facts a
 * US written acknowledgement states (amount, date, goods or services) are present. */
export async function settingsCommand(c: Context, p: Row) {
 const version = integer(p.version, 'Version', 1), organisation = text(p.organisation, 'Organization name', 200), ein = optional(p.ein, 'EIN', 20) ?? ''
 if (ein && !/^\d{2}-\d{7}$/.test(ein)) fail('INPUT', 'EIN must look like 12-3456789.', 400)
 const timezone = text(p.timezone, 'Time zone', 60)
 try { new Intl.DateTimeFormat('en-US', { timeZone: timezone }) } catch { fail('INPUT', 'Choose a time zone such as America/New_York.', 400) }
 const threshold = amount(p, 'threshold', 'Acknowledgement threshold', { allowZero: true }), targetDays = integer(typeof p.targetDays === 'string' ? Number(p.targetDays) : p.targetDays, 'Days to send', 1, 365)
 const subject = text(p.letterSubject, 'Letter subject', 200), template = longText(p.letterTemplate, 'Letter', 8000)
 const none = longText(p.noneStatement, 'No goods or services statement', 1000), goods = longText(p.goodsStatement, 'Goods or services statement', 1000)
 check(subject, 'Letter subject', LETTER, [])
 check(template, 'Letter', LETTER, ['donor_name', 'amount', 'gift_date', 'goods_statement', 'organization'])
 check(none, 'No goods or services statement', [], [])
 check(goods, 'Goods or services statement', GOODS, ['goods_value', 'goods_description'])
 if (!ein && placeholders(subject + template).includes('ein')) fail('TEMPLATE', 'Add your EIN or remove {{ein}} from the letter.', 400)
 await commit(c, [guard('EXISTS(SELECT 1 FROM cf_settings WHERE id=1 AND version=?)', 'VERSION', 'Settings changed. Refresh before saving.', version),
  sql('UPDATE cf_settings SET version=version+1,organisation=?,ein=?,timezone=?,threshold_cents=?,target_days=?,letter_subject=?,letter_template=?,none_statement=?,goods_statement=?,reviewed_at=?,reviewed_by=? WHERE id=1',
   organisation, ein, timezone, threshold, targetDays, subject, template, none, goods, c.now, c.actor.name),
  event(c, 'settings.update', 'settings', '1', null, { version: version + 1, thresholdCents: threshold })])
 return { version: version + 1 }
}

export const longDate = (day: string) => new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`))
const fill = (value: string, fields: Record<string, string>) => value.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (_, name) => fields[name] ?? '')

export function renderLetter(s: Settings, gift: Row, donorName: string, day: string) {
 const deductible = usd(gift.amount_cents - gift.goods_cents)
 const goods = gift.goods === 'provided'
  ? fill(s.goods_statement, { goods_value: usd(gift.goods_cents), goods_description: gift.goods_description ?? '', deductible_amount: deductible, amount: usd(gift.amount_cents) })
  : s.none_statement
 const fields = { date: longDate(day), donor_name: donorName, amount: usd(gift.amount_cents), gift_date: longDate(gift.received_on), fund: gift.fund, goods_statement: goods, organization: s.organisation, ein: s.ein, deductible_amount: deductible }
 return { subject: fill(s.letter_subject, fields), body: fill(s.letter_template, fields) }
}
