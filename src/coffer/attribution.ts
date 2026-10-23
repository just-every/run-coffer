import { all, choice, commit, date, event, fail, guard, one, optional, sql, text, today, type Context, type Row, type Stmt } from './db'
import { settings } from './settings'

/** GIFT-003: a gift's fund, campaign, appeal and channel as structured references.
 *
 * Fund is the ledger fund (`FIN-003` names), campaign a `cf_campaigns` id (split
 * parts carry their own), appeal a defined `cf_appeal_codes` code and channel one
 * of CHANNELS. Totals by each dimension come from the fund ledger, so every
 * dimension sums to the ledger for the same dates. */
export const CHANNELS = ['form', 'event', 'mail', 'email', 'text'] as const
export const CHANNEL_LABELS: Record<string, string> = { form: 'Giving form', event: 'Event', mail: 'Mail piece', email: 'Email', text: 'Text-to-give' }
export const NO_CAMPAIGN = 'No campaign', NO_APPEAL = 'No appeal', NO_CHANNEL = 'Channel not recorded'
const CODE = /^[A-Za-z0-9][A-Za-z0-9 ._:#/&'-]{0,79}$/

export async function attributionCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (command !== 'appealCode.define') return undefined
 const code = text(p.code, 'Appeal code', 80), name = text(p.name, 'Appeal name', 200)
 if (!CODE.test(code)) fail('INPUT', 'Use letters, digits, spaces and . _ : # / & \' - for the appeal code, starting with a letter or digit.', 400)
 await commit(c, [
  guard('NOT EXISTS(SELECT 1 FROM cf_appeal_codes WHERE code=?)', 'APPEAL_DEFINED', 'An appeal with this code already exists. Codes are permanent so gifts keep their attribution.', code),
  sql("INSERT INTO cf_appeal_codes(code,name,origin,created_at) VALUES(?,?,'staff',?)", code, name, c.now),
  event(c, 'appealCode.define', 'appealCode', code, null),
 ])
 return { code, name }
}

/** A defined appeal's stored code, or null when none was given. Unknown codes are refused. */
export async function definedAppeal(c: { db: D1Database }, value: unknown): Promise<string | null> {
 const code = optional(value, 'Appeal', 200)
 if (!code) return null
 const row = await one<{ code: string }>(c, 'SELECT code FROM cf_appeal_codes WHERE code=?', code)
 if (!row) fail('APPEAL', 'Choose a defined appeal. An owner or admin defines appeals under Gift attribution.', 400)
 return row.code
}

/** Entry-door attribution: an optional single-gift campaign (on the gift's own fund), appeal and channel. */
export async function entryAttribution(c: Context, p: Row, fund: string, split: boolean) {
 const campaignId = optional(p.campaignId, 'Campaign', 100), appeal = await definedAppeal(c, p.appeal)
 const channel = p.channel ? choice(p.channel, CHANNELS, 'gift channel') : null
 if (campaignId && split) fail('INPUT', 'A split gift names a campaign on each part.', 400)
 const statements = (giftId: string): Stmt[] => [
  ...(campaignId ? [guard('EXISTS(SELECT 1 FROM cf_campaigns WHERE id=? AND fund=?)', 'CAMPAIGN_FUND', 'Choose a campaign raising for this gift’s fund.', campaignId, fund),
   sql('INSERT INTO cf_campaign_gifts(gift_id,campaign_id) VALUES(?,?)', giftId, campaignId)] : []),
  ...(appeal ? [sql('INSERT INTO cf_gift_appeals(gift_id,appeal) VALUES(?,?)', giftId, appeal)] : []),
  ...(channel ? [sql('INSERT INTO cf_gift_channels(gift_id,channel) VALUES(?,?)', giftId, channel)] : []),
 ]
 return { campaignId, appeal, channel, statements }
}

/** Online gifts: the giving form is the channel and the tracked link's appeal travels on the intent. */
export function onlineAttribution(intent: Row, reference: string): Stmt[] {
 const gift = "SELECT id FROM cf_gifts WHERE source='stripe' AND reference=? AND kind='gift'"
 return [
  sql(`INSERT OR IGNORE INTO cf_gift_channels(gift_id,channel) SELECT id,? FROM (${gift})`, intent.giving_channel === 'text' ? 'text' : 'form', reference),
  ...(intent.appeal ? [sql(`INSERT OR IGNORE INTO cf_gift_appeals(gift_id,appeal) SELECT id,? FROM (${gift})`, intent.appeal, reference)] : []),
 ]
}

export const appealCodes = (c: { db: D1Database }) => all(c, `SELECT a.*,(SELECT COUNT(*) FROM cf_gift_appeals g WHERE g.appeal=a.code) AS gifts FROM cf_appeal_codes a ORDER BY lower(a.code)`)

/** Ledger totals by fund, campaign, appeal and channel for inclusive organization-calendar days. */
export async function attributionReport(c: Context, url: URL) {
 const asOf = today((await settings(c)).timezone, new Date(c.now)), q = url.searchParams
 const from = q.get('from') ? date(q.get('from'), 'From') : `${asOf.slice(0, 4)}-01-01`, to = q.get('to') ? date(q.get('to'), 'To') : asOf
 if (from > to) fail('INPUT', 'The start date must be on or before the end date.', 400)
 const entries = await all(c, `SELECT l.gift_id,l.amount_cents,l.kind,l.source,l.fund,l.campaign_id,cm.name AS campaign,a.code AS appeal,a.name AS appeal_name,ch.channel
  FROM cf_fund_ledger l LEFT JOIN cf_campaigns cm ON cm.id=l.campaign_id
  LEFT JOIN cf_gift_appeals ga ON ga.gift_id=l.gift_id LEFT JOIN cf_appeal_codes a ON a.code=ga.appeal
  LEFT JOIN cf_gift_channels ch ON ch.gift_id=l.gift_id
  WHERE l.received_on>=? AND l.received_on<=?`, from, to)
 const group = (key: (e: Row) => [string | null, string]) => {
  const rows = new Map<string, { key: string | null; label: string; gifts: Set<string>; amountCents: number }>()
  for (const e of entries) {
   const [k, label] = key(e), row = rows.get(k ?? '') ?? { key: k, label, gifts: new Set(), amountCents: 0 }
   if (e.kind === 'gift' && e.source !== 'stripe-adjustment') row.gifts.add(e.gift_id)
   row.amountCents += Number(e.amount_cents); rows.set(k ?? '', row)
  }
  return [...rows.values()].sort((a, b) => (a.key === null ? 1 : 0) - (b.key === null ? 1 : 0) || a.label.localeCompare(b.label))
   .map(r => ({ key: r.key, label: r.label, gifts: r.gifts.size, amountCents: r.amountCents }))
 }
 return {
  from, to, ledgerCents: entries.reduce((sum, e) => sum + Number(e.amount_cents), 0),
  fund: group(e => [e.fund, e.fund]),
  campaign: group(e => e.campaign_id ? [e.campaign_id, e.campaign] : [null, NO_CAMPAIGN]),
  appeal: group(e => e.appeal ? [e.appeal, e.appeal_name === e.appeal ? e.appeal : `${e.appeal_name} (${e.appeal})`] : [null, NO_APPEAL]),
  channel: group(e => e.channel ? [e.channel, CHANNEL_LABELS[e.channel]] : [null, NO_CHANNEL]),
 }
}
