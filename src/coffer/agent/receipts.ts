import { automationRecords, claimAutomation } from '../automation-grants'
import { UNRESOLVED_THANK_YOU } from '../gift-acknowledgments'
import { letterRecipient } from '../organizations'
import { withReceiptBenefits } from '../receipt-rules'
import { ackCommand, letterHash } from '../acknowledgements'
import { all, commit, event, fail, guard, newId, one, sql, today, type Context, type Row } from '../db'
import { settings } from '../settings'
import { giftTemplates, renderGiftLetter, templateRevision, templatesUnchanged } from '../letter-templates'
import { tributeReceiptText } from '../gift-depth'
import { activityStatement } from './activity'
import { receiptPolicy, receiptReasons } from './receipt-autonomy-policy'

export const MISSING_RECEIPT_ELIGIBLE=`g.kind='gift' AND d.erased_at IS NULL
 AND NOT EXISTS(SELECT 1 FROM cf_gifts r WHERE r.reverses=g.id)
 AND NOT EXISTS(SELECT 1 FROM cf_acks a WHERE a.gift_id=g.id AND a.live=1
  AND (a.delivery_status NOT IN ('bounced','rejected','complained') OR a.printed_at IS NOT NULL))
 AND NOT ${UNRESOLVED_THANK_YOU}
 AND g.received_on>=COALESCE((SELECT acknowledge_from FROM cf_receipt_autonomy WHERE id=1),'0001-01-01')
 AND g.received_on<date(?, '-'||(SELECT target_days FROM cf_settings WHERE id=1)||' days')
 AND NOT EXISTS(SELECT 1 FROM cf_prior_acknowledgements p WHERE p.gift_id=g.id)
 AND NOT EXISTS(SELECT 1 FROM cf_gift_acknowledgments k WHERE k.gift_id=g.id AND (k.status<>'not acknowledged' OR k.outcome_unknown=1))`
export async function missingReceipts(c:Context):Promise<Row[]> {
 const scope=automationRecords(c,'d.id'),s=await settings(c),policy=await receiptPolicy(c)
 const rows=await all(c,`SELECT g.*,g.net_cents AS amount_cents,d.name AS donor_name,d.email,d.address_line1,d.city,d.region,d.postal_code,d.household_id,d.constituent_kind,d.constituent_status,
 EXISTS(SELECT 1 FROM cf_relationships r WHERE r.donor_id=d.id OR r.related_donor_id=d.id) OR EXISTS(SELECT 1 FROM cf_soft_credits sc WHERE sc.donor_id=d.id) OR EXISTS(SELECT 1 FROM cf_gift_tributes t WHERE t.gift_id=g.id AND t.notification_donor_id IS NOT NULL) AS related_records,
 EXISTS(SELECT 1 FROM cf_acks bad WHERE bad.donor_id=d.id AND bad.recipient_email=d.email AND bad.delivery_status IN ('bounced','complained','rejected')) AS failed_email,
 (SELECT a.delivery_status FROM cf_acks a WHERE a.gift_id=g.id AND a.live=1 LIMIT 1) AS previous_status
 FROM cf_gift_balances g JOIN cf_donors d ON d.id=g.donor_id WHERE ${MISSING_RECEIPT_ELIGIBLE} AND g.net_cents>0 AND ${scope.sql} ORDER BY g.received_on,g.id LIMIT 500`,today(s.timezone,new Date(c.now)),...scope.params)
 return rows.map(g=>({...g,hold_reasons:receiptReasons(g,policy.max_standard_cents)}))
}
/** Default scheduled capability remains prepare-only. Explicit selection of a
 * standing-approved key activates the separately metered dispatch path. */
export async function queueMissingReceipts(c:Context) {
 if((await receiptPolicy(c)).selected_key_id)return (await import('./receipt-autonomy')).runReceiptAutonomy(c)
 const found=await missingReceipts(c),chosen=found.filter(g=>g.goods!=='unknown'&&g.net_cents>g.goods_cents)
 if(!chosen.length)return {queued:0,held:found.length,id:null}
 await claimAutomation(c,'receipts.prepare',chosen.length)
 const result=await prepareMissingReceiptBatch(c,chosen)
 return {...result,held:found.length-chosen.length}
}
/** Shared native freezer includes small overdue gifts without changing the
 * public acknowledgment threshold. Custody always belongs to the actual actor. */
export async function prepareMissingReceiptBatch(c:Context,chosen:Row[]) {
 const s=await settings(c)
 if (!s.reviewed_at || !s.organisation) fail('SETTINGS_UNREVIEWED','Review Letter settings before preparing receipts.')
 await withReceiptBenefits(c, chosen)
 const ids=JSON.stringify(chosen.map(g=>g.id)),batchId=newId(),revision=await templateRevision(c),templates=await giftTemplates(c,chosen)
 const donors=new Map((await all(c,'SELECT * FROM cf_donors WHERE id IN (SELECT value FROM json_each(?))',JSON.stringify([...new Set(chosen.map(g=>g.donor_id))]))).map(d=>[d.id,d]))
 for(const [key,d] of donors)donors.set(key,await letterRecipient(c,d))
 const tributes=new Map((await all(c,'SELECT * FROM cf_gift_tributes WHERE gift_id IN (SELECT value FROM json_each(?))',ids)).map(t=>[t.gift_id,t]))
 const letters=chosen.map((g,position)=>{
  const d=donors.get(g.donor_id)!,rendered=renderGiftLetter(s,g,d,today(s.timezone,new Date(c.now)),templates.get(g.id))
  return {id:newId(),batch_id:batchId,position,gift_id:g.id,donor_id:d.id,recipient_name:d.letter_name,recipient_email:d.email,address:d.letter_address,subject:rendered.subject,body:[rendered.body,tributeReceiptText(tributes.get(g.id))].filter(Boolean).join('\n\n'),amount_cents:g.amount_cents,received_on:g.received_on,template_kind:rendered.template_kind,template_id:rendered.template_id,template_version:rendered.template_version,merge_blanks:rendered.merge_blanks}
 })
 const hash=await letterHash(s.version,letters),total=chosen.reduce((n,g)=>n+g.amount_cents,0)
 const a=activityStatement(c,{kind:'receipts.prepare',subjectId:batchId,summary:`Queued ${letters.length} missing or bounced receipts for approval.`,why:'No sent receipt was found, or delivery bounced. All gift amounts are included; goods/services answers must be known. Nothing has been sent.',undoKind:'receipts.discard',undoData:{batchId}})
 await commit(c,[
  guard('EXISTS(SELECT 1 FROM cf_settings WHERE id=1 AND version=?)','SETTINGS_CHANGED','Letter settings changed. Prepare again.',s.version),templatesUnchanged(revision),
  guard(`(SELECT count(*) FROM cf_gifts g JOIN cf_donors d ON d.id=g.donor_id WHERE g.id IN (SELECT value FROM json_each(?)) AND ${MISSING_RECEIPT_ELIGIBLE} AND g.goods<>'unknown')=?`,'RECEIPTS_CHANGED','A receipt changed. Refresh and prepare again.',ids,today(s.timezone,new Date(c.now)),chosen.length),
  guard("NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE NOT EXISTS(SELECT 1 FROM cf_gift_balances g JOIN cf_donors d ON d.id=g.donor_id WHERE g.id=json_extract(j.value,'$.id') AND g.version=json_extract(j.value,'$.version') AND g.net_cents=json_extract(j.value,'$.amount_cents') AND d.version=json_extract(j.value,'$.donor_version')))",'GIFT_CHANGED','Gift or recipient changed. Prepare again.',JSON.stringify(chosen.map(g=>({...g,donor_version:donors.get(g.donor_id)!.version})))),
  guard("NOT EXISTS(SELECT 1 FROM json_each(?) j WHERE COALESCE((SELECT version FROM cf_gift_tributes WHERE gift_id=json_extract(j.value,'$.giftId')),0)<>json_extract(j.value,'$.version'))",'TRIBUTE_CHANGED','Tribute changed. Prepare again.',JSON.stringify(chosen.map(g=>({giftId:g.id,version:tributes.get(g.id)?.version??0})))),
  sql("UPDATE cf_acks SET live=0 WHERE gift_id IN (SELECT value FROM json_each(?)) AND live=1 AND delivery_status IN ('bounced','rejected','complained') AND printed_at IS NULL",ids),
  sql("INSERT INTO cf_ack_batches(id,version,status,content_hash,letters,total_cents,settings_version,prepared_by_id,prepared_by_name,prepared_by_role,prepared_at) VALUES(?,1,'prepared',?,?,?,?,?,?,?,?)",batchId,hash,letters.length,total,s.version,c.actor.id,c.actor.name,c.actor.role,c.now),
  sql(`INSERT INTO cf_acks(id,batch_id,position,gift_id,donor_id,live,recipient_name,recipient_email,address,subject,body,amount_cents,received_on,template_kind,template_id,template_version,merge_blanks)
   SELECT json_extract(value,'$.id'),json_extract(value,'$.batch_id'),json_extract(value,'$.position'),json_extract(value,'$.gift_id'),json_extract(value,'$.donor_id'),1,json_extract(value,'$.recipient_name'),json_extract(value,'$.recipient_email'),json_extract(value,'$.address'),json_extract(value,'$.subject'),json_extract(value,'$.body'),json_extract(value,'$.amount_cents'),json_extract(value,'$.received_on'),json_extract(value,'$.template_kind'),json_extract(value,'$.template_id'),json_extract(value,'$.template_version'),json_extract(value,'$.merge_blanks') FROM json_each(?)`,JSON.stringify(letters)),
  event(c,'ack.prepare','acknowledgements',batchId,null,{letters:letters.length,totalCents:total}),a.statement,event(c,'agent.receipts.prepare','acknowledgements',batchId,null,{letters:letters.length})])
 return {queued:letters.length,id:batchId,version:1}
}
export async function undoReceiptQueue(c:Context,batchId:string) {
 const b=await one(c,'SELECT version FROM cf_ack_batches WHERE id=?',batchId)
 if (!b) fail('NOT_FOUND','That batch no longer exists.',404)
 return ackCommand(c,'ack.discard',{batchId,version:b.version})
}
