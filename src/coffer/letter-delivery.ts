import { readReceiptDelivery } from './receipt-activity'
import type { Bindings } from '../auth.server'
import { batchLetters, letterHash, currentLetterGifts } from './acknowledgements'
import { all, commit, event, fail, guard, id, integer, newId, one, sql, type Context, type Row } from './db'
import { assertReceiptMailAvailable, mailSuppressed, sendReceipt, verifySendgridEvents } from './receipt-mail'

const eligible = `d.erased_at IS NULL AND d.email IS NOT NULL AND d.email=a.recipient_email
 AND NOT EXISTS(SELECT 1 FROM cf_acks bad WHERE bad.donor_id=d.id AND bad.recipient_email=d.email AND bad.delivery_status IN ('bounced','complained'))`

export async function deliveryCommand(c: Context, command: string, p: Row): Promise<Row | undefined> {
 if (!['ack.send', 'ack.printed', 'ack.checkDelivery'].includes(command)) return undefined
 const batchId = id(p.batchId, 'Batch'), version = integer(Number(p.version), 'Version', 1)
 const b = await one(c, 'SELECT * FROM cf_ack_batches WHERE id=?', batchId)
 if (!b) fail('NOT_FOUND', 'That letter batch does not exist.', 404)
 if (b.version !== version) fail('VERSION', 'This batch changed. Refresh before continuing.')
 if (!['approved', 'exported', 'sent'].includes(b.status)) fail('NOT_APPROVED', 'Approve the exact letters before sending or printing.')
 const at = () => guard("EXISTS(SELECT 1 FROM cf_ack_batches WHERE id=? AND version=? AND status IN ('approved','exported','sent'))", 'VERSION', 'This batch changed. Refresh before continuing.', batchId, version)
 if (command === 'ack.checkDelivery') {
  if (!c.env) fail('mail_unavailable', 'Email sending is not available yet.', 503)
  assertReceiptMailAvailable(c.env)
  const letters = await all(c, "SELECT * FROM cf_acks WHERE batch_id=? AND message_id IS NOT NULL AND delivery_status IN ('submitted','uncertain','sending') ORDER BY position LIMIT 8", batchId)
  for (const letter of letters) {
   const result = await readReceiptDelivery(c.env, letter)
   if (result) await recordDelivery(c.db, letter.id, letter.attempt_id, result.id, result.event, result.occurredAt)
  }
  return { id: batchId, version, ...await deliverySummary(c, batchId) }
 }
 if(b.status==='sent')fail('ALREADY_SENT','This batch was recorded as sent. Its frozen letters remain available as copies.')
 const frozen = await batchLetters(c, batchId)
 if (await letterHash(b.settings_version, frozen) !== b.content_hash) fail('CONTENT_CHANGED', 'These letters changed. Discard and prepare them again.')
 if (command === 'ack.printed') {
  await commit(c, [at(), currentLetterGifts(batchId), sql("UPDATE cf_acks SET route='print',delivery_status=CASE WHEN route='pending' THEN 'print' ELSE delivery_status END,printed_at=? WHERE batch_id=? AND route IN ('pending','print') AND printed_at IS NULL", c.now, batchId), sql('UPDATE cf_ack_batches SET version=version+1 WHERE id=?', batchId), event(c, command, 'acknowledgements', batchId, null)])
  return { id: batchId, version: version + 1 }
 }
 const letters = await batchLetters(c, batchId)
 if (await letterHash(b.settings_version, letters) !== b.content_hash) fail('CONTENT_CHANGED', 'These letters changed. Discard and prepare them again.')
 // Read availability before making any change; Managed never pretends to send.
 if (!c.env) fail('MAIL_UNAVAILABLE', 'Email sending is not available yet.', 503)
 // Local and demo mode switch email off (README): emailed letters are marked, never claimed as sent.
 const suppressed = mailSuppressed(c.env)
 if (!suppressed && (await one(c, `SELECT count(*) AS n FROM cf_acks a JOIN cf_donors d ON d.id=a.donor_id WHERE a.batch_id=? AND a.route='pending' AND ${eligible}`, batchId))!.n) assertReceiptMailAvailable(c.env)
 // Reserve this batch version, so simultaneous send clicks cannot duplicate mail.
 await commit(c, [at(), currentLetterGifts(batchId),
  guard('NOT EXISTS(SELECT 1 FROM cf_acks a JOIN cf_donors d ON d.id=a.donor_id WHERE a.batch_id=? AND (d.erased_at IS NOT NULL OR EXISTS(SELECT 1 FROM cf_gifts r WHERE r.reverses=a.gift_id)))', 'GIFT_CHANGED', 'A gift was reversed or its donor erased. Prepare a fresh batch.', batchId),
  sql('UPDATE cf_ack_batches SET version=version+1 WHERE id=?', batchId), event(c, 'ack.send', 'acknowledgements', batchId, null)])
 if (suppressed) {
  await commit(c, [sql(`UPDATE cf_acks AS a SET route=CASE WHEN EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=a.donor_id AND ${eligible}) THEN 'email' ELSE 'print' END,
   delivery_status=CASE WHEN EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=a.donor_id AND ${eligible}) THEN 'suppressed' ELSE 'print' END,
   delivery_note=CASE WHEN EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=a.donor_id AND ${eligible}) THEN 'Not emailed: email is switched off on this computer (local mode). Print this letter, or send it from your hosted Coffer.' ELSE NULL END
   WHERE batch_id=? AND route='pending'`, batchId)])
  return { id: batchId, version: version + 1, suppressedInLocal: true, ...await deliverySummary(c, batchId) }
 }
 const pending = await all(c, "SELECT id FROM cf_acks WHERE batch_id=? AND route='pending' ORDER BY position LIMIT 8", batchId)
 for (const l of pending) {
  const attempt = newId()
  // The current email and deliverability are rechecked in the transaction that
  // claims the letter. Once claimed it is never silently retried.
  await commit(c, [
   sql(`UPDATE cf_acks AS a SET route=CASE WHEN EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=a.donor_id AND ${eligible}) THEN 'email' ELSE 'print' END,
    delivery_status=CASE WHEN EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=a.donor_id AND ${eligible}) THEN 'sending' ELSE 'print' END,
    attempt_id=?,delivery_note=NULL WHERE id=? AND route='pending' AND void_reason IS NULL`, attempt, l.id)])
  const letter = await one(c, 'SELECT * FROM cf_acks WHERE id=?', l.id)
  if (!letter || letter.void_reason || letter.attempt_id !== attempt || letter.route !== 'email') continue
  try {
   const sent = await sendReceipt(c.env, letter)
   await c.db.prepare("UPDATE cf_acks SET message_id=?,submitted_at=?,delivery_status=CASE WHEN delivery_status='sending' THEN 'submitted' ELSE delivery_status END WHERE id=? AND attempt_id=?").bind(sent.messageId, c.now, l.id, attempt).run()
  } catch (error: any) {
   if (['mail_rejected','mail_rate_limited'].includes(error?.code)) {
    await c.db.prepare("UPDATE cf_acks SET route='print',delivery_status='rejected',delivery_note='The provider did not accept this email. This letter is in the print batch.' WHERE id=? AND attempt_id=? AND delivery_status='sending'").bind(l.id, attempt).run()
    continue
   }
   // A timeout can mean accepted by the provider. Keep an uncertain send for
   // investigation; automatically retrying could send the same receipt twice.
   await c.db.prepare("UPDATE cf_acks SET delivery_status='uncertain',delivery_note='Email submission could not be confirmed. Check the provider before printing; Coffer will not resend automatically.' WHERE id=? AND attempt_id=? AND delivery_status='sending'").bind(l.id, attempt).run()
  }
 }
 return { id: batchId, version: version + 1, ...await deliverySummary(c, batchId) }
}

export async function deliverySummary(c: { db: D1Database }, batchId: string) {
 const letters = await batchLetters(c, batchId)
 return {
  remaining: letters.filter(l => l.route === 'pending').length,
  submitted: letters.filter(l => ['submitted', 'delivered'].includes(l.delivery_status)).length,
  delivered: letters.filter(l => l.delivery_status === 'delivered').length,
  print: letters.filter(l => l.route === 'print' && !l.printed_at).length,
  bounced: letters.filter(l => l.delivery_status === 'bounced').length,
 }
}

/** This route is public only to signed provider requests, never owner assertions. */
export async function receiptEvents(request: Request, env: Bindings): Promise<Response> {
 try {
  const events = await verifySendgridEvents(request, env)
  const incoming: Row[] = []
  for (const e of events) {
   if (typeof e.coffer_letter_id !== 'string' || typeof e.coffer_attempt_id !== 'string' || typeof e.sg_event_id !== 'string' || e.sg_event_id.length > 250) continue
   if (!['delivered', 'bounce', 'dropped', 'spamreport', 'open'].includes(e.event) || !Number.isSafeInteger(e.timestamp) || e.timestamp < 0 || e.timestamp > 8640000000000) continue
   incoming.push({ id: e.sg_event_id, letterId: e.coffer_letter_id, attempt: e.coffer_attempt_id,
    state: e.event === 'open' ? 'opened' : e.event === 'delivered' ? 'delivered' : e.event === 'spamreport' ? 'complained' : 'bounced', occurred: new Date(e.timestamp * 1000).toISOString() })
  }
  if (incoming.length) await recordDeliveryEvents(env.DB, incoming)
  return Response.json({ ok: true }, { headers: { 'cache-control': 'no-store' } })
 } catch (error: any) {
  return Response.json({ error: error.code ?? 'INVALID_EVENT', message: error.code ? error.message : 'Invalid delivery event.' }, { status: error.status ?? 400 })
 }
}

async function recordDelivery(db: D1Database, letterId: string, attempt: string, eventId: string, state: string, occurred: string) {
 await recordDeliveryEvents(db, [{ id: eventId, letterId, attempt, state, occurred }])
}

// Bulk intake stays within the free Worker subrequest budget even for a large
// provider event batch. The actual event rows, rather than arrival order, decide.
async function recordDeliveryEvents(db: D1Database, incoming: Row[]) {
 const payload = JSON.stringify(incoming)
 await db.batch([
  db.prepare(`INSERT OR IGNORE INTO cf_letter_events(id,letter_id,event,occurred_at,recorded_at)
   SELECT json_extract(j.value,'$.id'),a.id,json_extract(j.value,'$.state'),json_extract(j.value,'$.occurred'),?
   FROM json_each(?) j JOIN cf_acks a ON a.id=json_extract(j.value,'$.letterId') AND a.attempt_id=json_extract(j.value,'$.attempt') AND a.route IN ('email','print')`).bind(new Date().toISOString(), payload),
  db.prepare(`INSERT OR IGNORE INTO cf_receipt_address_tasks(id,letter_id,created_at)
   SELECT 'receipt-address:'||a.id,a.id,min(e.recorded_at) FROM cf_acks a
   JOIN cf_letter_events e ON e.letter_id=a.id AND e.event='bounced'
   JOIN cf_donors d ON d.id=a.donor_id AND d.erased_at IS NULL
   WHERE a.id IN (SELECT json_extract(value,'$.letterId') FROM json_each(?)) GROUP BY a.id`).bind(payload),
  db.prepare(`UPDATE cf_acks AS a SET
   delivery_status=CASE WHEN EXISTS(SELECT 1 FROM cf_letter_events e WHERE e.letter_id=a.id AND e.event='complained') THEN 'complained'
    WHEN EXISTS(SELECT 1 FROM cf_letter_events e WHERE e.letter_id=a.id AND e.event='bounced') THEN 'bounced'
    WHEN EXISTS(SELECT 1 FROM cf_letter_events e WHERE e.letter_id=a.id AND e.event='delivered') THEN 'delivered' ELSE delivery_status END,
   route=CASE WHEN EXISTS(SELECT 1 FROM cf_letter_events e WHERE e.letter_id=a.id AND e.event IN ('bounced','complained')) THEN 'print' ELSE route END,
   delivered_at=COALESCE(delivered_at,(SELECT min(occurred_at) FROM cf_letter_events e WHERE e.letter_id=a.id AND e.event='delivered')),
   delivery_note=CASE WHEN EXISTS(SELECT 1 FROM cf_letter_events e WHERE e.letter_id=a.id AND e.event IN ('bounced','complained')) THEN 'Email did not reach the donor. Correct the email address; this letter is in the print batch.' ELSE delivery_note END
   WHERE id IN (SELECT json_extract(value,'$.letterId') FROM json_each(?))`).bind(payload),
 ])
}
