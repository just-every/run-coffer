import type { Bindings } from '../auth.server'
import { batchLetters, currentLetterGifts, letterHash } from './acknowledgements'
import { automaticGiftCurrent, automaticReceiptAuthority, automaticReceiptEnabled } from './automatic-receipt-queue'
import { prepareAutomaticReceipt } from './automatic-receipt-prepare'
import { all, commit, event, fail, guard, one, sql, type Context, type Row } from './db'
import { receiptAcceptance } from './gift-ack-receipt'
import { mailSuppressed, sendReceipt } from './receipt-mail'
import { assertVerifiedReceiptSender } from './sending-domain'
import { settings } from './settings'

const note = (env: Bindings, giftId: string, message: string, held = true) => env.DB.prepare("UPDATE cf_automatic_receipts SET state=CASE WHEN ? THEN 'held' ELSE state END,note=? WHERE gift_id=? AND state='queued'").bind(held?1:0,message,giftId).run()

/** Only unclaimed work can recover. A network attempt has permanent custody. */
export async function runAutomaticReceipts(env: Bindings, now = new Date(), giftIds?: string[]): Promise<void> {
 if(env.RER_INSTALLATION_ID||env.RER_MANAGEMENT_ORIGIN)return
 const jobs=await all({db:env.DB},`SELECT * FROM cf_automatic_receipts WHERE state='queued' ${giftIds?'AND gift_id IN (SELECT value FROM json_each(?))':''} ORDER BY created_at,gift_id LIMIT 100`,...(giftIds?[JSON.stringify(giftIds)]:[]))
 for(const job of jobs) {
  try { await submit(env,job,now) }
  catch(error: any) {
   // A racing claim is already durably owned. Never turn it into retryable work.
   const domainPending=['sending_domain_unverified','sending_domain_unavailable'].includes(error?.code)
   await note(env,job.gift_id,domainPending?'The sending domain is not verified. Check it in Settings.':`Receipt held for review (${error?.code??'preparation_failed'}).`,!domainPending)
  }
 }
}

async function submit(env: Bindings, job: Row, now: Date) {
 const s=await settings({db:env.DB}),authorizer=await one({db:env.DB},`SELECT o.* FROM oa_operators o WHERE o.id=? AND o.version=? AND o.status='active' AND o.role IN ('owner','admin')`,s.receipt_authorizer_id,s.receipt_authorizer_version)
 if(!authorizer||s.version!==job.settings_version||(job.source==='online'?s.online_receipts!=='automatic':!s.offline_receipts)) {
  await note(env,job.gift_id,'Standing receipt approval changed. Review this gift in Letters.');return
 }
 const c:Context={db:env.DB,env,now:now.toISOString(),actor:{id:authorizer.id,name:authorizer.display_name,role:authorizer.role},authority:{sql:automaticReceiptAuthority,params:[]}}
 const letter=await prepareAutomaticReceipt(c,job,s)
 if(!letter){await note(env,job.gift_id,'The recipient is unavailable or has no email address. Review this gift in Letters.');return}
 if(letter.route!=='pending') {
  await env.DB.prepare("UPDATE cf_automatic_receipts SET state='complete' WHERE gift_id=? AND state='queued'").bind(job.gift_id).run();return
 }
 const batch=await one(c,'SELECT * FROM cf_ack_batches WHERE id=?',letter.batch_id)
 if(!batch||batch.status!=='approved'||JSON.parse(letter.merge_blanks).length)fail('NOT_APPROVED','This receipt needs review in Letters.')
 if(await letterHash(batch.settings_version,await batchLetters(c,batch.id))!==batch.content_hash)fail('CONTENT_CHANGED','The frozen receipt changed.')
 // Suppression is an outcome, never evidence of provider submission.
 const suppressed=mailSuppressed(env),domain=suppressed?null:await assertVerifiedReceiptSender(c,env),attempt=crypto.randomUUID()
 await commit(c,[guard("EXISTS(SELECT 1 FROM cf_automatic_receipts WHERE gift_id=? AND state='queued')",'ALREADY_SENT','This receipt has already been claimed.',job.gift_id),
  guard(`EXISTS(SELECT 1 FROM cf_settings s WHERE s.id=1 AND s.version=? AND ${automaticReceiptEnabled(job)})`,'SETTINGS_CHANGED','Standing receipt approval changed.',job.settings_version),
  currentLetterGifts(batch.id),guard(automaticGiftCurrent,'GIFT_CHANGED','The gift or recipient changed.',job.gift_id),
  guard(`EXISTS(SELECT 1 FROM cf_acks a JOIN cf_donors d ON d.id=a.donor_id WHERE a.id=? AND a.route='pending' AND a.void_reason IS NULL AND d.erased_at IS NULL
   AND (d.email=a.recipient_email OR EXISTS(SELECT 1 FROM cf_contact_points p WHERE p.id=json_extract(a.address,'$.emailContactId') AND p.donor_id=d.id AND p.active=1 AND p.value=a.recipient_email AND p.version=json_extract(a.address,'$.emailContactVersion')))
   AND NOT EXISTS(SELECT 1 FROM cf_acks bad WHERE bad.donor_id=d.id AND bad.recipient_email=a.recipient_email AND bad.delivery_status IN ('bounced','complained')))`, 'RECIPIENT_CHANGED','The current email address needs review.',letter.id),
  guard(`EXISTS(SELECT 1 FROM cf_ack_batches b JOIN cf_approvals a ON a.subject_id=b.id AND a.subject_kind='acknowledgements' AND a.content_hash=b.content_hash WHERE b.id=? AND b.status='approved' AND b.content_hash=?)`,'NOT_APPROVED','This exact receipt is not approved.',batch.id,batch.content_hash),
  ...(domain?[guard("EXISTS(SELECT 1 FROM cf_sending_domain WHERE id=1 AND version=? AND status='verified')",'DOMAIN_CHANGED','The sending domain changed.',domain.version)]:[]),
  sql("UPDATE cf_automatic_receipts SET state=?,attempted_at=?,attempt_id=?,note=NULL WHERE gift_id=?",suppressed?'complete':'sending',c.now,attempt,job.gift_id),
  sql("UPDATE cf_acks SET route='email',delivery_status=?,attempt_id=?,delivery_note=? WHERE id=?",suppressed?'suppressed':'sending',attempt,suppressed?'Not emailed: email is suppressed on this installation. No provider submission.':null,letter.id),
  event(c,'receipt.automatic.claim','acknowledgements',batch.id,letter.donor_id,{source:job.source,suppressed})])
 if(suppressed)return
 try {
  const sent=await sendReceipt(env,{...letter,attempt_id:attempt})
  const accepted={...c,now:new Date().toISOString()}
  await env.DB.batch([...(await receiptAcceptance(accepted,{...letter,attempt_id:attempt},sent.messageId)),sql("UPDATE cf_automatic_receipts SET state='complete' WHERE gift_id=? AND attempt_id=?",job.gift_id,attempt)].map(s=>env.DB.prepare(s.sql).bind(...s.params)))
 } catch(error:any) {
  const refused=['mail_rejected','mail_rate_limited','mail_unavailable'].includes(error?.code)
  await env.DB.batch([
   env.DB.prepare("UPDATE cf_acks SET route=CASE WHEN ? THEN 'print' ELSE route END,delivery_status=?,delivery_note=? WHERE id=? AND attempt_id=? AND delivery_status='sending'").bind(refused?1:0,refused?'rejected':'uncertain',refused?'The email was not accepted. This receipt is in the print batch.':'Email submission could not be confirmed. Check the provider; Coffer will not resend automatically.',letter.id,attempt),
   env.DB.prepare("UPDATE cf_automatic_receipts SET state='held',note=? WHERE gift_id=? AND attempt_id=?").bind(refused?'Provider rejected the receipt; review its print copy.':'Submission uncertain; never retry automatically.',job.gift_id,attempt),
  ])
 }
}
