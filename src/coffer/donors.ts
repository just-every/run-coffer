import { withReceiptBenefits } from './receipt-rules'
import { volunteering } from './volunteering'
import { inKindState } from './in-kind'
import { donorEngagement } from './engagement'
import { plannedGiving } from './planned-giving'
import { givingSummary } from './giving-summary'
import { allGiftAllocations } from './gift-splits'
import { communicationHistory } from './communications/outbound'
import { all, choice, commit, date, email, event, fail, guard, id, integer, newId, one, optional, sql, text, today, type Context, type Row, type Stmt } from './db'
import { canonicalDonor } from './donor-merge'
import { donorDepth } from './donor-depth'
import { donorGiftDepth } from './gift-depth'
import { pledgeHistory } from './pledges'
import { subscriptions } from './giving/campaigns'
import { settings } from './settings'

export const CONSENT_METHODS = ['web form', 'paper form', 'verbal', 'email reply', 'event sign-up', 'other'] as const
const LIVE = 'erased_at IS NULL'

function address(p: Row) {
 return {
  phone: optional(p.phone, 'Phone', 40), line1: optional(p.addressLine1, 'Address line 1'), line2: optional(p.addressLine2, 'Address line 2'),
  city: optional(p.city, 'City', 100), region: optional(p.region, 'State', 100), postal: optional(p.postalCode, 'ZIP code', 20), country: optional(p.country, 'Country', 100) ?? 'United States',
 }
}
/** A household is found by name (any case) or created in the same batch. */
function household(name: string | null, c: Context): { statements: Stmt[]; value: string } {
 if (!name) return { statements: [], value: 'NULL' }
 return { statements: [sql('INSERT INTO cf_households(id,name,created_at) SELECT ?,?,? WHERE NOT EXISTS(SELECT 1 FROM cf_households WHERE lower(name)=lower(?))', newId(), name, c.now, name)], value: '(SELECT id FROM cf_households WHERE lower(name)=lower(?))' }
}

export async function donorCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (command === 'donor.create') {
  const donorId = newId(), name = text(p.name, 'Donor name'), mail = email(p.email), a = address(p), h = household(optional(p.household, 'Household'), c)
  await commit(c, [...h.statements,
   sql(`INSERT INTO cf_donors(id,version,name,email,phone,address_line1,address_line2,city,region,postal_code,country,household_id,source,source_ref,created_at,erased_at) VALUES(?,1,?,?,?,?,?,?,?,?,?,${h.value},'manual',NULL,?,NULL)`,
    donorId, name, mail, a.phone, a.line1, a.line2, a.city, a.region, a.postal, a.country, ...(h.value === 'NULL' ? [] : [optional(p.household, 'Household')]), c.now),
   event(c, 'donor.create', 'donor', donorId, donorId)])
  return { id: donorId, version: 1 }
 }
 if (command === 'donor.update') {
  const donorId = id(p.donorId, 'Donor'), version = integer(p.version, 'Version', 1), name = text(p.name, 'Donor name'), mail = email(p.email), a = address(p), h = household(optional(p.household, 'Household'), c)
  await commit(c, [guard(`EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND version=? AND ${LIVE})`, 'VERSION', 'This donor changed or was erased. Refresh before saving.', donorId, version), ...h.statements,
   sql(`UPDATE cf_donors SET version=version+1,name=?,email=?,phone=?,address_line1=?,address_line2=?,city=?,region=?,postal_code=?,country=?,household_id=${h.value} WHERE id=?`,
    name, mail, a.phone, a.line1, a.line2, a.city, a.region, a.postal, a.country, ...(h.value === 'NULL' ? [] : [optional(p.household, 'Household')]), donorId),
   event(c, 'donor.update', 'donor', donorId, donorId)])
  return { id: donorId, version: version + 1 }
 }
 if (command === 'consent.record') {
  const ids = Array.isArray(p.donorIds) ? p.donorIds : typeof p.donorIds === 'string' ? [p.donorIds] : p.donorId ? [p.donorId] : []
  if (!ids.length || ids.length > 500) fail('INPUT', 'Select 1–500 donors.', 400)
  const donors = [...new Set(ids.map((x: unknown) => id(x, 'Donor')))]
  const channel = choice(p.channel, ['email', 'mail'] as const, 'channel'), status = choice(p.status, ['granted', 'withdrawn'] as const, 'consent answer')
  const method = choice(p.method, CONSENT_METHODS, 'how consent was captured'), evidence = text(p.evidence, 'Evidence', 1000), captured = date(p.capturedOn, 'Captured on')
  if (captured > today((await settings(c)).timezone)) fail('INPUT', 'Consent cannot be captured in the future.', 400)
  await commit(c, [
   guard(`(SELECT count(*) FROM cf_donors WHERE ${LIVE} AND id IN (SELECT value FROM json_each(?)))=?`, 'NOT_FOUND', 'A selected donor no longer exists.', JSON.stringify(donors), donors.length),
   sql('INSERT INTO cf_consents(donor_id,channel,status,method,evidence,captured_on,recorded_at,recorded_by) SELECT value,?,?,?,?,?,?,? FROM json_each(?)', channel, status, method, evidence, captured, c.now, c.actor.name, JSON.stringify(donors)),
   ...donors.map(d => event(c, 'consent.record', 'donor', d, d, { channel, status, method }))])
  return { recorded: donors.length, channel, status }
 }
 return undefined
}

const CURRENT = (channel: string) => `(SELECT status FROM cf_consents k WHERE k.donor_id=d.id AND k.channel='${channel}' ORDER BY k.id DESC LIMIT 1)`
export const PAGE = 50
export async function listDonors(c: { db: D1Database }, query: { q?: string | null; page?: number; relationship?: string | null; relatedTo?: string | null; volunteer?: string | null } = {}) {
 const q = (query.q ?? '').trim().toLowerCase().slice(0, 100), page = Math.max(0, Math.min(query.page ?? 0, 10000))
 const pattern = (value: string) => `%${value.replace(/[%_\\]/g, x => `\\${x}`)}%`
 const like = pattern(q), nameTerms = q.split(/\s+/).map(pattern)
 const nameSearch = nameTerms.map(() => "lower(d.name) LIKE ? ESCAPE '\\'").join(' AND ')
 const relationship = query.relationship ?? '', relatedTo = query.relatedTo ?? '', volunteer=query.volunteer??''
 if(!['','all','never-given'].includes(volunteer))fail('INPUT','Choose all volunteers or volunteers who have never given.',400)
 const rows = await all(c, `SELECT d.id,d.version,d.name,d.email,d.city,d.region,d.source,d.erased_at,h.name AS household,
   (SELECT COALESCE(SUM(amount_cents),0) FROM cf_monetary_contributions g WHERE g.donor_id=d.id) AS total_cents,
   (SELECT MAX(received_on) FROM cf_monetary_contributions g WHERE g.donor_id=d.id AND g.kind='gift') AS last_gift,
   ${CURRENT('email')} AS email_consent, ${CURRENT('mail')} AS mail_consent
  FROM cf_donors d LEFT JOIN cf_households h ON h.id=d.household_id
  WHERE NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id) AND (?='' OR (${nameSearch}) OR d.email LIKE ? ESCAPE '\\' OR lower(h.name) LIKE ? ESCAPE '\\')
  AND (?='' OR EXISTS(SELECT 1 FROM cf_relationships r WHERE (r.donor_id=d.id OR r.related_donor_id=d.id) AND r.type=?))
  AND (?='' OR EXISTS(SELECT 1 FROM cf_relationships r WHERE (r.donor_id=d.id AND r.related_donor_id=?) OR (r.related_donor_id=d.id AND r.donor_id=?)))
  AND (?='' OR (d.erased_at IS NULL AND EXISTS(SELECT 1 FROM cf_volunteering v WHERE v.donor_id=d.id) AND (?<>'never-given' OR NOT EXISTS(SELECT 1 FROM cf_contribution_ledger g WHERE g.donor_id=d.id AND g.kind IN ('gift','in_kind')))))
  ORDER BY d.erased_at IS NOT NULL, lower(d.name), d.id LIMIT ? OFFSET ?`, q, ...nameTerms, like, like, relationship, relationship, relatedTo, relatedTo, relatedTo, volunteer, volunteer, PAGE + 1, page * PAGE)
 const count = await one<{ n: number }>(c, `SELECT count(*) AS n FROM cf_donors WHERE ${LIVE} AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=cf_donors.id)`)
 return { donors: rows.slice(0, PAGE), more: rows.length > PAGE, page, q, total: count?.n ?? 0 }
}

export async function donorHistory(c: Context, donorId: string) {
 donorId = await canonicalDonor(c, donorId)
 const donor = await one(c, 'SELECT d.*,h.name AS household FROM cf_donors d LEFT JOIN cf_households h ON h.id=d.household_id WHERE d.id=?', donorId)
 if (!donor) fail('NOT_FOUND', 'That donor does not exist.', 404)
 const [household, gifts, pledges, consents, letters, appeals, events] = await Promise.all([
  donor.household_id ? all(c, 'SELECT id,name,erased_at FROM cf_donors WHERE household_id=? AND id<>? ORDER BY lower(name)', donor.household_id, donorId) : Promise.resolve([]),
  all(c, `SELECT g.*,COALESCE((SELECT appeal FROM cf_gift_appeals WHERE gift_id=g.id),(SELECT c.name FROM cf_campaign_gifts cg JOIN cf_campaigns c ON c.id=cg.campaign_id WHERE cg.gift_id=g.id)) AS appeal,(SELECT r.id FROM cf_gifts r WHERE r.reverses=g.id) AS reversed_by,
    (SELECT CASE WHEN a.printed_at IS NOT NULL THEN 'printed' ELSE COALESCE(NULLIF(a.delivery_status,'pending'),b.status) END FROM cf_acks a JOIN cf_ack_batches b ON b.id=a.batch_id WHERE a.gift_id=g.id AND a.live=1) AS ack_status,
    (SELECT b.sent_on FROM cf_acks a JOIN cf_ack_batches b ON b.id=a.batch_id WHERE a.gift_id=g.id AND a.live=1) AS ack_sent_on,
    (SELECT a.batch_id FROM cf_acks a WHERE a.gift_id=g.id AND a.live=1) AS ack_batch
   FROM cf_contribution_ledger g WHERE g.donor_id=? ORDER BY g.received_on DESC, g.created_at DESC`, donorId),
  pledgeHistory(c, donorId),
  all(c, 'SELECT * FROM cf_consents WHERE donor_id=? ORDER BY id DESC', donorId),
  all(c, `SELECT a.id,a.batch_id,a.gift_id,a.amount_cents,a.received_on,a.delivery_status,a.route,a.printed_at,a.delivered_at,a.delivery_note,b.kind,b.statement_year,b.status,b.sent_on FROM cf_acks a JOIN cf_ack_batches b ON b.id=a.batch_id WHERE a.donor_id=? AND (a.live=1 OR b.kind='statement') AND b.status<>'discarded' ORDER BY a.received_on DESC`, donorId),
  all(c, 'SELECT p.id,p.name,p.channel,p.status,p.sent_on,p.prepared_at FROM cf_appeal_recipients r JOIN cf_appeals p ON p.id=r.appeal_id WHERE r.donor_id=? AND p.status<>\'discarded\' ORDER BY p.prepared_at DESC', donorId),
  all(c, 'SELECT * FROM cf_events WHERE donor_id=? ORDER BY id DESC LIMIT 100', donorId),
 ])
 await withReceiptBenefits(c, gifts)
 const byYear = new Map<string, number>()
 const monetaryGifts=gifts.filter(g=>g.kind==='gift'||g.kind==='reversal')
 for (const g of monetaryGifts) byYear.set(g.received_on.slice(0, 4), (byYear.get(g.received_on.slice(0, 4)) ?? 0) + g.amount_cents)
 const [plans, depth, giftDepth] = await Promise.all([subscriptions(c, donorId), donorDepth(c, donorId), donorGiftDepth(c, donorId)])
 const summary = await givingSummary(c, donorId, { gifts:monetaryGifts, pledges, subscriptions: plans, recognitionCents: giftDepth.recognitionCents })
 const allocations=await allGiftAllocations(c,gifts.map(g=>g.id))
 for(const gift of gifts)gift.allocations=allocations.filter(a=>a.gift_id===(gift.reverses??gift.id))
 const consent = (channel: string) => consents.find(x => x.channel === channel) ?? null
 return {
  engagement: await donorEngagement(c,donorId), donor, household, gifts, pledges, consents, letters, appeals, events, communications:await communicationHistory(c,donorId),welcome:await one(c,'SELECT * FROM cf_welcome_enrollments WHERE donor_id=?',donorId),marketingPreference:await one(c,'SELECT * FROM cf_preference_sync WHERE donor_id=?',donorId), subscriptions: plans, summary,
  volunteering:await volunteering(c,donorId), inKind:await inKindState(c,donorId), depth, giftDepth, plannedGiving:await plannedGiving(c,donorId),
  notes: await all(c, 'SELECT * FROM cf_donor_notes WHERE donor_id=? ORDER BY occurred_on DESC,recorded_at DESC', donorId),
  firstGift: await one(c, `SELECT g.*,COALESCE((SELECT appeal FROM cf_gift_appeals WHERE gift_id=g.id),(SELECT c.name FROM cf_campaign_gifts cg JOIN cf_campaigns c ON c.id=cg.campaign_id WHERE cg.gift_id=g.id)) AS appeal FROM cf_gift_balances g WHERE g.donor_id=? AND g.net_cents>0 ORDER BY g.received_on,g.created_at,g.id LIMIT 1`,donorId),
  totals: { lifetimeCents: monetaryGifts.reduce((s, g) => s + g.amount_cents, 0), byYear: [...byYear].sort((a, b) => b[0].localeCompare(a[0])).map(([year, cents]) => ({ year, cents })) },
  current: { email: consent('email'), mail: consent('mail') },
 }
}
