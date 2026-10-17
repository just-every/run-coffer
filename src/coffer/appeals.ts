import { all, choice, commit, date, event, fail, guard, id, integer, newId, one, sha256, sql, text, today, longText, type Context, type Row } from './db'
import { amount } from './money'
import { settings } from './settings'
import { csv } from './csv'

const MAX_RECIPIENTS = 10000
const CONSENT = `(SELECT k.id FROM cf_consents k WHERE k.donor_id=r.donor_id AND k.channel=? ORDER BY k.id DESC LIMIT 1)`
// Every frozen recipient still has the exact consent answer that admitted them.
const UNCHANGED = `NOT EXISTS(SELECT 1 FROM cf_appeal_recipients r WHERE r.appeal_id=? AND ${CONSENT} IS NOT r.consent_id)`
export const hashOf = (name: string, channel: string, recipients: Row[], message?: Row | null) => sha256(JSON.stringify([name, channel, recipients.map(r => [r.donor_id, r.consent_id, r.name, r.email, r.address, ...(message ? [r.total_cents,r.gift_count,r.last_gift] : [])]), ...(message ? [message.subject,message.body] : [])]))
const postal = (d: Row) => d.address_line1 && d.city && d.postal_code

/** Splits the segment into consenting recipients and counted exclusions. */
export async function audience(c: { db: D1Database }, channel: 'email' | 'mail', segment: { givenSince: string | null; minTotalCents: number; fund?: string | null }) {
 const rows = await all(c, `SELECT d.*,k.id AS consent_id,k.status AS consent,
  (SELECT COALESCE(SUM(amount_cents),0) FROM cf_contribution_ledger g WHERE g.donor_id=d.id) AS total_cents,
  (SELECT COUNT(*) FROM cf_gift_balances g WHERE g.donor_id=d.id AND net_cents>0) AS gift_count,
  (SELECT MAX(received_on) FROM cf_gift_balances g WHERE g.donor_id=d.id AND net_cents>0) AS last_gift FROM cf_donors d
  LEFT JOIN cf_consents k ON k.id=(SELECT id FROM cf_consents WHERE donor_id=d.id AND channel=? ORDER BY id DESC LIMIT 1)
  WHERE d.erased_at IS NULL AND (? IS NULL OR (SELECT COALESCE(SUM(amount_cents),0) FROM cf_gifts g WHERE g.donor_id=d.id AND g.received_on>=?)>=?)
  AND (? IS NULL OR EXISTS(SELECT 1 FROM cf_fund_ledger g WHERE g.donor_id=d.id AND g.fund=? GROUP BY g.fund HAVING SUM(g.amount_cents)>0))
  AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)
  ORDER BY lower(d.name),d.id`, channel, segment.givenSince, segment.givenSince, Math.max(1, segment.minTotalCents), segment.fund??null,segment.fund??null)
 const excluded = { 'no consent recorded': 0, 'consent withdrawn': 0, 'no email address': 0, 'no postal address': 0 }
 const recipients: Row[] = []
 for (const d of rows) {
  if (!d.consent) excluded['no consent recorded']++
  else if (d.consent !== 'granted') excluded['consent withdrawn']++
  else if (channel === 'email' && !d.email) excluded['no email address']++
  else if (channel === 'mail' && !postal(d)) excluded['no postal address']++
  else recipients.push({ donor_id: d.id, consent_id: d.consent_id, name: d.name, total_cents:d.total_cents,gift_count:d.gift_count,last_gift:d.last_gift, email: channel === 'email' ? d.email : null, address: channel === 'mail' ? JSON.stringify({ line1: d.address_line1, line2: d.address_line2, city: d.city, region: d.region, postalCode: d.postal_code, country: d.country }) : null })
 }
 return { recipients, excluded }
}

export async function appealCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (command === 'appeal.prepare') {
  const name = text(p.name, 'Appeal name', 200), channel = choice(p.channel, ['email', 'mail'] as const, 'channel')
  const givenSince = p.givenSince ? date(p.givenSince, 'Gave since') : null
  const minTotalCents = givenSince && (p.minTotal || p.minTotalCents) ? amount(p, 'minTotal', 'Minimum given') : 0
  if (givenSince && givenSince > today((await settings(c)).timezone)) fail('INPUT', 'Gave since cannot be in the future.', 400)
  const fund = p.fund ? text(p.fund,'Fund',100) : null
  const written = channel === 'email' && Boolean(String(p.subject ?? '').trim() || String(p.body ?? '').trim())
 if (written && !String(p.subject ?? '').trim()) fail('INPUT', 'Add an email subject. Donors see it in their inbox before they open the appeal.', 400)
 if (written && !String(p.body ?? '').trim()) fail('INPUT', 'Write the email message donors will receive, or clear the subject to export the list instead.', 400)
 const message = written ? {subject:text(p.subject,'Email subject',250),body:longText(p.body,'Email message',12000)} : null
  if(message){ const {mergeMessage}=await import('./communications/outbound'); mergeMessage(message.subject,{name:'Donor'});mergeMessage(message.body,{name:'Donor'}) }
  const { recipients, excluded } = await audience(c, channel, { givenSince, minTotalCents, fund })
  if (!recipients.length) fail('NO_RECIPIENTS', 'No donor in this segment has current consent for this channel.', 409, excluded)
  if (recipients.length > MAX_RECIPIENTS) fail('TOO_MANY', `An appeal holds at most ${MAX_RECIPIENTS} recipients. Narrow the segment.`, 400)
  const appealId = newId(), hash = await hashOf(name, channel, recipients,message), list = JSON.stringify(recipients)
  await commit(c, [
   guard(`NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE (SELECT k.id FROM cf_consents k WHERE k.donor_id=json_extract(j.value,'$.donor_id') AND k.channel=? ORDER BY k.id DESC LIMIT 1) IS NOT json_extract(j.value,'$.consent_id'))`, 'CONSENT_CHANGED', 'A donor’s consent changed while preparing. Prepare again.', list, channel),
   sql("INSERT INTO cf_appeals(id,version,name,channel,segment,excluded,status,content_hash,recipients,prepared_by_id,prepared_by_name,prepared_by_role,prepared_at) VALUES(?,1,?,?,?,?,'prepared',?,?,?,?,?,?)",
    appealId, name, channel, JSON.stringify({ givenSince, minTotalCents, fund }), JSON.stringify(excluded), hash, recipients.length, c.actor.id, c.actor.name, c.actor.role, c.now),
   sql(`INSERT INTO cf_appeal_recipients(appeal_id,donor_id,consent_id,name,email,address,total_cents,gift_count,last_gift) SELECT ?,json_extract(value,'$.donor_id'),json_extract(value,'$.consent_id'),json_extract(value,'$.name'),json_extract(value,'$.email'),json_extract(value,'$.address'),json_extract(value,'$.total_cents'),json_extract(value,'$.gift_count'),json_extract(value,'$.last_gift') FROM json_each(?)`, appealId, list),
   ...(message ? [sql('INSERT INTO cf_appeal_messages VALUES(?,?,?)',appealId,message.subject,message.body)] : []),
   event(c, 'appeal.prepare', 'appeal', appealId, null, { channel, recipients: recipients.length, excluded })])
  return { id: appealId, version: 1, recipients: recipients.length, excluded, contentHash: hash }
 }
 if (!['appeal.approve', 'appeal.discard', 'appeal.export', 'appeal.markSent'].includes(command)) return undefined
 const appealId = id(p.appealId, 'Appeal'), version = integer(typeof p.version === 'string' ? Number(p.version) : p.version, 'Version', 1)
 const appeal = await one(c, 'SELECT * FROM cf_appeals WHERE id=?', appealId)
 if (!appeal) fail('NOT_FOUND', 'That appeal does not exist.', 404)
 if (appeal.version !== version) fail('VERSION', 'This appeal changed. Refresh before continuing.')
 const at = (statuses: string[]) => guard(`EXISTS(SELECT 1 FROM cf_appeals WHERE id=? AND version=? AND status IN (${statuses.map(() => '?').join(',')}))`, 'VERSION', 'This appeal changed. Refresh before continuing.', appealId, version, ...statuses)
 const consent = guard(UNCHANGED, 'CONSENT_CHANGED', 'A recipient’s consent changed or their record was erased since this audience was prepared. Discard the appeal and prepare it again.', appealId, appeal.channel)
 const bump = (status: string, extra = '', ...params: unknown[]) => sql(`UPDATE cf_appeals SET version=version+1,status=?${extra} WHERE id=?`, status, ...params, appealId)
 if (command === 'appeal.approve') {
  if (appeal.status !== 'prepared') fail('NOT_PREPARED', 'Only a prepared appeal can be approved.')
  if (await hashOf(appeal.name, appeal.channel, await recipientsOf(c, appealId),await one(c,'SELECT * FROM cf_appeal_messages WHERE appeal_id=?',appealId)) !== appeal.content_hash) fail('CONTENT_CHANGED', 'This audience no longer matches what was prepared. Discard it and prepare again.')
  await commit(c, [at(['prepared']), consent,
   sql('INSERT INTO cf_approvals VALUES(?,?,?,?,?,?,?,?,?,?,?)', newId(), 'appeal', appealId, appeal.content_hash, appeal.prepared_by_id, appeal.prepared_by_name, appeal.prepared_by_role, c.actor.id, c.actor.name, c.actor.role, c.now),
   bump('approved'), event(c, 'appeal.approve', 'appeal', appealId, null, { recipients: appeal.recipients, preparedBy: appeal.prepared_by_role })])
  return { id: appealId, version: version + 1, status: 'approved' }
 }
 if (command === 'appeal.discard') {
  if(await one(c,"SELECT id FROM cf_communications WHERE source_kind='appeal' AND source_id=? LIMIT 1",appealId)) fail('SUBMISSION_EXISTS','This appeal has saved Mango submissions. Keep its history and cancel any scheduled campaign in Mango.',409)
  if (!['prepared', 'approved'].includes(appeal.status)) fail('ALREADY_EXPORTED', 'An exported audience is kept; record the appeal as sent instead.')
  await commit(c, [at(['prepared', 'approved']), bump('discarded', ',discarded_at=?', c.now), event(c, 'appeal.discard', 'appeal', appealId, null)])
  return { id: appealId, version: version + 1, status: 'discarded' }
 }
 if (command === 'appeal.export') {
  if (!['approved', 'exported', 'sent'].includes(appeal.status)) fail('NOT_APPROVED', 'A person must approve this audience before it is exported.')
  if (appeal.status !== 'approved') return { id: appealId, version, status: appeal.status, exportHash: appeal.export_hash }
  const hash = await sha256(recipientsCsv(appeal, await recipientsOf(c, appealId)))
  await commit(c, [at(['approved']), consent, bump('exported', ',export_hash=?,exported_at=?,exported_by=?', hash, c.now, c.actor.name), event(c, 'appeal.export', 'appeal', appealId, null, { recipients: appeal.recipients })])
  return { id: appealId, version: version + 1, status: 'exported', exportHash: hash }
 }
 const sentOn = date(p.sentOn, 'Sent on')
 if (appeal.status !== 'exported') fail('NOT_EXPORTED', 'Export the approved audience before recording the appeal as sent.')
 const timezone = (await settings(c)).timezone
 // The export date is the organization's calendar day, like Sent on itself.
 if (sentOn > today(timezone) || sentOn < today(timezone, new Date(appeal.exported_at))) fail('INPUT', 'Sent on must be between the export date and today.', 400)
 await commit(c, [at(['exported']), bump('sent', ',sent_on=?,sent_recorded_by=?', sentOn, c.actor.name), event(c, 'appeal.markSent', 'appeal', appealId, null, { sentOn })])
 return { id: appealId, version: version + 1, status: 'sent' }
}

export const recipientsOf = (c: { db: D1Database }, appealId: string) => all(c, `SELECT r.*,(SELECT id FROM cf_communications m WHERE m.message_key='appeal:'||r.appeal_id||':'||r.donor_id) AS communication_id FROM cf_appeal_recipients r WHERE appeal_id=? ORDER BY lower(name),donor_id`, appealId)
export function recipientsCsv(appeal: Row, recipients: Row[]) {
 if (appeal.channel === 'email') return csv(['name', 'email'], recipients.map(r => [r.name, r.email]))
 return csv(['name', 'address_line1', 'address_line2', 'city', 'state', 'zip', 'country'], recipients.map(r => { const a = r.address ? JSON.parse(r.address) : {}; return [r.name, a.line1, a.line2, a.city, a.region, a.postalCode, a.country] }))
}
export async function appeals(c: { db: D1Database }) {
 return all(c, "SELECT * FROM cf_appeals ORDER BY CASE status WHEN 'prepared' THEN 0 WHEN 'approved' THEN 1 WHEN 'exported' THEN 2 ELSE 3 END, prepared_at DESC LIMIT 100")
}
export async function appealDetail(c: { db: D1Database }, appealId: string) {
 const appeal = await one(c, 'SELECT * FROM cf_appeals WHERE id=?', appealId)
 if (!appeal) fail('NOT_FOUND', 'That appeal does not exist.', 404)
 const [recipients, approval, changed] = await Promise.all([recipientsOf(c, appealId), one(c, "SELECT * FROM cf_approvals WHERE subject_kind='appeal' AND subject_id=?", appealId),
  one<{ n: number }>(c, `SELECT count(*) AS n FROM cf_appeal_recipients r WHERE r.appeal_id=? AND ${CONSENT} IS NOT r.consent_id`, appealId, appeal.channel)])
 return { appeal, recipients, approval, message:await one(c,'SELECT * FROM cf_appeal_messages WHERE appeal_id=?',appealId),messages:await all(c,"SELECT m.*,d.name FROM cf_communications m JOIN cf_donors d ON d.id=m.donor_id WHERE m.source_kind='appeal' AND m.source_id=? ORDER BY m.created_at",appealId), consentChanged: changed?.n ?? 0 }
}
