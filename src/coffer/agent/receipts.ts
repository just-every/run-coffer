import { letterRecipient } from '../organizations'
import { withReceiptBenefits } from '../receipt-rules'
import { ackCommand, letterHash } from '../acknowledgements'
import { all, commit, event, fail, guard, newId, one, sql, today, type Context, type Row } from '../db'
import { settings } from '../settings'
import { giftTemplates, renderGiftLetter, templateRevision, templatesUnchanged } from '../letter-templates'
import { tributeReceiptText } from '../gift-depth'
import { activityStatement } from './activity'

const ELIGIBLE=`g.kind='gift' AND d.erased_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM cf_gifts r WHERE r.reverses=g.id)
 AND NOT EXISTS(SELECT 1 FROM cf_acks a WHERE a.gift_id=g.id AND a.live=1
  AND (a.delivery_status NOT IN ('bounced','rejected','complained') OR a.printed_at IS NOT NULL))
 AND NOT EXISTS(SELECT 1 FROM cf_prior_acknowledgements p WHERE p.gift_id=g.id)
 AND NOT EXISTS(SELECT 1 FROM cf_gift_acknowledgments k WHERE k.gift_id=g.id AND k.status<>'not acknowledged')`
export async function missingReceipts(c:Context) {
 return all(c,`SELECT g.*,d.name AS donor_name,d.city,d.region,
 (SELECT a.delivery_status FROM cf_acks a WHERE a.gift_id=g.id AND a.live=1 LIMIT 1) AS previous_status
 FROM cf_gifts g JOIN cf_donors d ON d.id=g.donor_id WHERE ${ELIGIBLE} ORDER BY g.received_on,g.id LIMIT 500`)
}
/** Prepare fresh frozen letters. Prior bounced proof remains; sending always needs human approval. */
export async function queueMissingReceipts(c:Context) {
 const s=await settings(c)
 if (!s.reviewed_at || !s.organisation) fail('SETTINGS_UNREVIEWED','Review Letter settings before preparing receipts.')
 const found=await missingReceipts(c),chosen=found.filter(g=>g.goods!=='unknown')
 if (!chosen.length) return {queued:0,held:found.length,id:null}
 await withReceiptBenefits(c, chosen)
 const ids=JSON.stringify(chosen.map(g=>g.id)),batchId=newId(),revision=await templateRevision(c),templates=await giftTemplates(c,chosen)
 const donors=new Map((await all(c,'SELECT * FROM cf_donors WHERE id IN (SELECT value FROM json_each(?))',JSON.stringify([...new Set(chosen.map(g=>g.donor_id))]))).map(d=>[d.id,d]))
 for(const [key,d] of donors)donors.set(key,await letterRecipient(c,d))
 const tributes=new Map((await all(c,'SELECT * FROM cf_gift_tributes WHERE gift_id IN (SELECT value FROM json_each(?))',ids)).map(t=>[t.gift_id,t]))
 const letters=chosen.map((g,position)=>{
  const d=donors.get(g.donor_id)!,rendered=renderGiftLetter(s,g,d.letter_salutation,today(s.timezone,new Date(c.now)),templates.get(g.id))
  return {id:newId(),batch_id:batchId,position,gift_id:g.id,donor_id:d.id,recipient_name:d.letter_name,recipient_email:d.email,address:d.letter_address,subject:rendered.subject,body:[rendered.body,tributeReceiptText(tributes.get(g.id))].filter(Boolean).join('\n\n'),amount_cents:g.amount_cents,received_on:g.received_on,template_kind:rendered.template_kind,template_id:rendered.template_id,template_version:rendered.template_version}
 })
 const hash=await letterHash(s.version,letters),total=chosen.reduce((n,g)=>n+g.amount_cents,0)
 const a=activityStatement(c,{kind:'receipts.prepare',subjectId:batchId,summary:`Queued ${letters.length} missing or bounced receipts for approval.`,why:'No sent receipt was found, or delivery bounced. All gift amounts are included; goods/services answers must be known. Nothing has been sent.',undoKind:'receipts.discard',undoData:{batchId}})
 await commit(c,[
  guard('EXISTS(SELECT 1 FROM cf_settings WHERE id=1 AND version=?)','SETTINGS_CHANGED','Letter settings changed. Prepare again.',s.version),templatesUnchanged(revision),
  guard(`(SELECT count(*) FROM cf_gifts g JOIN cf_donors d ON d.id=g.donor_id WHERE g.id IN (SELECT value FROM json_each(?)) AND ${ELIGIBLE} AND g.goods<>'unknown')=?`,'RECEIPTS_CHANGED','A receipt changed. Refresh and prepare again.',ids,chosen.length),
  sql("UPDATE cf_acks SET live=0 WHERE gift_id IN (SELECT value FROM json_each(?)) AND live=1 AND delivery_status IN ('bounced','rejected','complained') AND printed_at IS NULL",ids),
  sql("INSERT INTO cf_ack_batches(id,version,status,content_hash,letters,total_cents,settings_version,prepared_by_id,prepared_by_name,prepared_by_role,prepared_at) VALUES(?,1,'prepared',?,?,?,?,?,?,?,?)",batchId,hash,letters.length,total,s.version,c.actor.id,c.actor.name,c.actor.role,c.now),
  sql(`INSERT INTO cf_acks(id,batch_id,position,gift_id,donor_id,live,recipient_name,recipient_email,address,subject,body,amount_cents,received_on,template_kind,template_id,template_version)
   SELECT json_extract(value,'$.id'),json_extract(value,'$.batch_id'),json_extract(value,'$.position'),json_extract(value,'$.gift_id'),json_extract(value,'$.donor_id'),1,json_extract(value,'$.recipient_name'),json_extract(value,'$.recipient_email'),json_extract(value,'$.address'),json_extract(value,'$.subject'),json_extract(value,'$.body'),json_extract(value,'$.amount_cents'),json_extract(value,'$.received_on'),json_extract(value,'$.template_kind'),json_extract(value,'$.template_id'),json_extract(value,'$.template_version') FROM json_each(?)`,JSON.stringify(letters)),
  a.statement,event(c,'agent.receipts.prepare','acknowledgements',batchId,null,{letters:letters.length})])
 return {queued:letters.length,held:found.length-chosen.length,id:batchId}
}
export async function undoReceiptQueue(c:Context,batchId:string) {
 const b=await one(c,'SELECT version FROM cf_ack_batches WHERE id=?',batchId)
 if (!b) fail('NOT_FOUND','That batch no longer exists.',404)
 return ackCommand(c,'ack.discard',{batchId,version:b.version})
}
