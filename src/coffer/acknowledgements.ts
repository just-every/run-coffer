import { receiptFundLabels } from './gift-splits'
import { addDays, all, choice, commit, date, daysBetween, event, fail, guard, id, integer, newId, one, sha256, sql, today, type Context, type Row } from './db'
import { renderLetter, settings } from './settings'
import { csv } from './csv'
import { tributeReceiptText } from './gift-depth'

const MAX_LETTERS = 500
// A gift is due for a letter when it reaches the threshold, has not been
// reversed, is in no live letter and its donor has not been erased.
export const DUE = `g.kind='gift' AND g.amount_cents>=? AND d.erased_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM cf_gifts r WHERE r.reverses=g.id)
 AND NOT EXISTS(SELECT 1 FROM cf_acks a WHERE a.gift_id=g.id AND a.live=1)
 AND NOT EXISTS(SELECT 1 FROM cf_prior_acknowledgements p WHERE p.gift_id=g.id)`

export async function dueGifts(c: { db: D1Database }) {
 const s = await settings(c), day = today(s.timezone)
 const rows = await all(c, `SELECT g.*,d.name AS donor_name,d.email AS donor_email FROM cf_gifts g JOIN cf_donors d ON d.id=g.donor_id WHERE ${DUE} ORDER BY g.received_on,g.id LIMIT 2000`, s.threshold_cents)
 await receiptFundLabels(c,rows)
 return {
  settings: s, today: day,
  gifts: rows.map((g): Row => { const due = addDays(g.received_on, s.target_days); return { ...g, due_on: due, overdue: day > due, age_days: daysBetween(g.received_on, day) } }),
 }
}

export const address = (d: Row) => JSON.stringify({ line1: d.address_line1, line2: d.address_line2, city: d.city, region: d.region, postalCode: d.postal_code, country: d.country })
export const letterHash = (s: number, letters: Row[]) => sha256(JSON.stringify([s, letters.map(l => [l.gift_id, l.donor_id, l.recipient_name, l.recipient_email, l.address, l.subject, l.body, l.amount_cents, l.received_on, ...(l.statement_gifts ? [l.statement_gifts] : [])])]))
export const batchLetters = (c: { db: D1Database }, batchId: string) => all(c, 'SELECT * FROM cf_acks WHERE batch_id=? ORDER BY position', batchId)

export async function ackCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (command === 'ack.prepare') {
  const s = await settings(c)
  if (!s.reviewed_at || !s.organisation) fail('SETTINGS_UNREVIEWED', 'A person must review and save the organization name and letter wording in Settings before letters are prepared.')
  const wanted = Array.isArray(p.giftIds) ? new Set(p.giftIds.map((x: unknown) => id(x, 'Gift'))) : null
  const { gifts, today: day } = await dueGifts(c)
  const chosen = gifts.filter(g => g.goods !== 'unknown' && (!wanted || wanted.has(g.id))).slice(0, MAX_LETTERS)
  if (wanted && chosen.length !== wanted.size) fail('NOT_DUE', 'A selected gift is not waiting for a letter, or still needs its goods or services answer.')
  if (!chosen.length) fail('NOTHING_DUE', 'No gifts are waiting for an acknowledgement letter.')
  const donors = new Map((await all(c, 'SELECT * FROM cf_donors WHERE id IN (SELECT value FROM json_each(?))', JSON.stringify([...new Set(chosen.map(g => g.donor_id))]))).map(d => [d.id, d]))
  const tributes = new Map((await all(c, 'SELECT * FROM cf_gift_tributes WHERE gift_id IN (SELECT value FROM json_each(?))', JSON.stringify(chosen.map(g => g.id)))).map(t => [t.gift_id, t]))
  const batchId = newId()
  const letters = chosen.map((g, position) => {
   const d = donors.get(g.donor_id)!, rendered = renderLetter(s, g, d.name, day)
   return { id: newId(), batch_id: batchId, position, gift_id: g.id, donor_id: d.id, recipient_name: d.name, recipient_email: d.email, address: address(d), subject: rendered.subject, body: [rendered.body, tributeReceiptText(tributes.get(g.id))].filter(Boolean).join('\n\n'), amount_cents: g.amount_cents, received_on: g.received_on }
  })
  const hash = await letterHash(s.version, letters), total = letters.reduce((n, l) => n + l.amount_cents, 0)
  await commit(c, [
   guard('EXISTS(SELECT 1 FROM cf_settings WHERE id=1 AND version=?)', 'SETTINGS_CHANGED', 'Letter settings changed while preparing. Prepare again.', s.version),
   guard(`(SELECT count(*) FROM cf_gifts g JOIN cf_donors d ON d.id=g.donor_id WHERE g.id IN (SELECT value FROM json_each(?)) AND g.goods<>'unknown' AND ${DUE})=?`, 'NOT_DUE', 'A gift changed while preparing. Prepare again.', JSON.stringify(letters.map(l => l.gift_id)), s.threshold_cents, letters.length),
   guard("NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE COALESCE((SELECT version FROM cf_gift_tributes WHERE gift_id=json_extract(j.value,'$.giftId')),0)<>json_extract(j.value,'$.version'))", 'TRIBUTE_CHANGED', 'A tribute changed while preparing. Prepare the letters again.', JSON.stringify(chosen.map(g => ({ giftId: g.id, version: tributes.get(g.id)?.version ?? 0 })))),
   sql("INSERT INTO cf_ack_batches(id,version,status,content_hash,letters,total_cents,settings_version,prepared_by_id,prepared_by_name,prepared_by_role,prepared_at) VALUES(?,1,'prepared',?,?,?,?,?,?,?,?)", batchId, hash, letters.length, total, s.version, c.actor.id, c.actor.name, c.actor.role, c.now),
   sql(`INSERT INTO cf_acks(id,batch_id,position,gift_id,donor_id,live,recipient_name,recipient_email,address,subject,body,amount_cents,received_on)
    SELECT json_extract(value,'$.id'),json_extract(value,'$.batch_id'),json_extract(value,'$.position'),json_extract(value,'$.gift_id'),json_extract(value,'$.donor_id'),1,json_extract(value,'$.recipient_name'),json_extract(value,'$.recipient_email'),json_extract(value,'$.address'),json_extract(value,'$.subject'),json_extract(value,'$.body'),json_extract(value,'$.amount_cents'),json_extract(value,'$.received_on') FROM json_each(?)`, JSON.stringify(letters)),
   event(c, 'ack.prepare', 'acknowledgements', batchId, null, { letters: letters.length, totalCents: total })])
  return { id: batchId, version: 1, letters: letters.length, totalCents: total, contentHash: hash }
 }
 if (!['ack.approve', 'ack.discard', 'ack.export', 'ack.markSent'].includes(command)) return undefined
 const batchId = id(p.batchId, 'Acknowledgement batch'), version = integer(typeof p.version === 'string' ? Number(p.version) : p.version, 'Version', 1)
 const batch = await one(c, 'SELECT * FROM cf_ack_batches WHERE id=?', batchId)
 if (!batch) fail('NOT_FOUND', 'That acknowledgement batch does not exist.', 404)
 if (batch.version !== version) fail('VERSION', 'This batch changed. Refresh before continuing.')
 const at = (statuses: string[]) => guard(`EXISTS(SELECT 1 FROM cf_ack_batches WHERE id=? AND version=? AND status IN (${statuses.map(() => '?').join(',')}))`, 'VERSION', 'This batch changed. Refresh before continuing.', batchId, version, ...statuses)
 const bump = (status: string, extra = '', ...params: unknown[]) => sql(`UPDATE cf_ack_batches SET version=version+1,status=?${extra} WHERE id=?`, status, ...params, batchId)
 if (command === 'ack.approve') {
  if (batch.status !== 'prepared') fail('NOT_PREPARED', 'Only a prepared batch can be approved.')
  const letters = await batchLetters(c, batchId)
  if (await letterHash(batch.settings_version, letters) !== batch.content_hash) fail('CONTENT_CHANGED', 'These letters no longer match what was prepared. Discard the batch and prepare again.')
  await commit(c, [at(['prepared']),
   currentLetterGifts(batchId),
   guard("NOT EXISTS(SELECT 1 FROM cf_acks a WHERE a.batch_id=? AND (EXISTS(SELECT 1 FROM cf_gifts r WHERE r.reverses=a.gift_id) OR EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=a.donor_id AND d.erased_at IS NOT NULL)))", 'GIFT_CHANGED', 'A gift in this batch was reversed or its donor erased. Discard the batch and prepare again.', batchId),
   sql('INSERT INTO cf_approvals VALUES(?,?,?,?,?,?,?,?,?,?,?)', newId(), 'acknowledgements', batchId, batch.content_hash, batch.prepared_by_id, batch.prepared_by_name, batch.prepared_by_role, c.actor.id, c.actor.name, c.actor.role, c.now),
   bump('approved'), event(c, 'ack.approve', 'acknowledgements', batchId, null, { letters: batch.letters, preparedBy: batch.prepared_by_role })])
  return { id: batchId, version: version + 1, status: 'approved' }
 }
 if (command === 'ack.discard') {
  if ((await one(c, "SELECT count(*) AS n FROM cf_acks WHERE batch_id=? AND route<>'pending'", batchId))!.n) fail('ALREADY_SENT', 'Letters already routed for sending or printing must be kept.')
  if (!['prepared', 'approved'].includes(batch.status)) fail('ALREADY_EXPORTED', 'Exported letters are kept; record them as sent instead.')
  await commit(c, [at(['prepared', 'approved']), sql('UPDATE cf_acks SET live=0 WHERE batch_id=?', batchId), bump('discarded', ',discarded_at=?', c.now), event(c, 'ack.discard', 'acknowledgements', batchId, null)])
  return { id: batchId, version: version + 1, status: 'discarded' }
 }
 if (command === 'ack.export') {
  if (!['approved', 'exported', 'sent'].includes(batch.status)) fail('NOT_APPROVED', 'A person must approve these letters before they are exported.')
  if (batch.status !== 'approved') return { id: batchId, version, status: batch.status, exportHash: batch.export_hash }
  const file = lettersCsv(await batchLetters(c, batchId)), hash = await sha256(file)
  await commit(c, [at(['approved']), bump('exported', ',export_hash=?,exported_at=?,exported_by=?', hash, c.now, c.actor.name), event(c, 'ack.export', 'acknowledgements', batchId, null, { letters: batch.letters })])
  return { id: batchId, version: version + 1, status: 'exported', exportHash: hash }
 }
 const sentOn = date(p.sentOn, 'Sent on'), method = choice(p.method, ['mail', 'email', 'mail and email'] as const, 'how the letters went out')
 if (batch.status !== 'exported') fail('NOT_EXPORTED', 'Export the approved letters before recording them as sent.')
 const timezone = (await settings(c)).timezone
 // The export date is the organization's calendar day, like Sent on itself.
 if (sentOn > today(timezone) || sentOn < today(timezone, new Date(batch.exported_at))) fail('INPUT', 'Sent on must be between the export date and today.', 400)
 await commit(c, [at(['exported']), bump('sent', ',sent_on=?,sent_method=?,sent_recorded_by=?', sentOn, method, c.actor.name), event(c, 'ack.markSent', 'acknowledgements', batchId, null, { sentOn, method })])
 return { id: batchId, version: version + 1, status: 'sent' }
}

export function lettersCsv(letters: Row[]) {
 return csv(['letter', 'donor_name', 'email', 'address_line1', 'address_line2', 'city', 'state', 'zip', 'country', 'gift_date', 'amount', 'subject', 'letter_text'],
  letters.map(l => { const a = l.address ? JSON.parse(l.address) : {}; return [l.position + 1, l.recipient_name, l.recipient_email, a.line1, a.line2, a.city, a.region, a.postalCode, a.country, l.received_on, (l.amount_cents / 100).toFixed(2), l.subject, l.body] }))
}

export async function batches(c: { db: D1Database }) {
 return all(c, "SELECT b.*,(SELECT count(*) FROM cf_acks a WHERE a.batch_id=b.id AND a.delivery_status='delivered') AS delivered,(SELECT count(*) FROM cf_acks a WHERE a.batch_id=b.id AND a.route='print' AND a.printed_at IS NULL) AS to_print FROM cf_ack_batches b ORDER BY CASE status WHEN 'prepared' THEN 0 WHEN 'approved' THEN 1 WHEN 'exported' THEN 2 ELSE 3 END, prepared_at DESC LIMIT 100")
}
export async function batchDetail(c: { db: D1Database }, batchId: string) {
 const batch = await one(c, 'SELECT * FROM cf_ack_batches WHERE id=?', batchId)
 if (!batch) fail('NOT_FOUND', 'That acknowledgement batch does not exist.', 404)
 const [letters, approval, events, deliveryEvents] = await Promise.all([batchLetters(c, batchId), one(c, "SELECT * FROM cf_approvals WHERE subject_kind='acknowledgements' AND subject_id=?", batchId), all(c, "SELECT * FROM cf_events WHERE subject_kind='acknowledgements' AND subject_id=? ORDER BY id", batchId), all(c, 'SELECT e.* FROM cf_letter_events e JOIN cf_acks a ON a.id=e.letter_id WHERE a.batch_id=? ORDER BY e.occurred_at', batchId)])
 return { batch, letters, approval, events, deliveryEvents }
}

/** Annual statements freeze the complete calendar year, including late gifts. */
export const currentLetterGiftsCondition = `NOT EXISTS(SELECT 1 FROM cf_acks a JOIN cf_ack_batches b ON b.id=a.batch_id WHERE a.batch_id=? AND b.kind='statement' AND (
 (SELECT count(*) FROM cf_gifts g WHERE g.donor_id=a.donor_id AND g.kind='gift' AND substr(g.received_on,1,4)=CAST(b.statement_year AS TEXT) AND NOT EXISTS(SELECT 1 FROM cf_gifts r WHERE r.reverses=g.id))<>json_array_length(a.statement_gifts)
 OR EXISTS(SELECT 1 FROM json_each(a.statement_gifts) j WHERE NOT EXISTS(SELECT 1 FROM cf_gifts g WHERE g.id=json_extract(j.value,'$.id') AND g.version=json_extract(j.value,'$.version') AND NOT EXISTS(SELECT 1 FROM cf_gifts r WHERE r.reverses=g.id)))))`
export const currentLetterGifts = (batchId: string) => guard(currentLetterGiftsCondition, 'GIFT_CHANGED', 'A statement gift changed. Discard this batch and prepare it again.', batchId)
