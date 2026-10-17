import { all, commit, event, fail, guard, newId, one, sql, type Context, type Row } from '../db'
import { usd } from '../money'
import { communicationsUnavailable, providerName, providerLabel, composeProviderCampaign, createProviderCampaign, providerResults } from './provider'
import { reconcileDonor } from './preferences'

export type MessageInput = { key:string; donorId:string; subject:string; body:string; sourceKind:'appeal'|'welcome'; sourceId:string; expectedEmail?:string; merge?:Row }
export function mergeMessage(template: string, values: Row) {
 const fields: Row = {donor_name:values.name,total_given:usd(values.total_cents??0),last_gift:values.last_gift||'No gift recorded',gift_count:String(values.gift_count??0)}
 return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (token,key) => { if (!(key in fields)) fail('MERGE_FIELD', `Unknown merge field ${token}.`,400); return fields[key] })
}
export async function submitMessage(c: Context,input:MessageInput):Promise<Row> {
 const previous=await one(c,'SELECT * FROM cf_communications WHERE message_key=?',input.key)
 if(previous) return previous
 const unavailable=communicationsUnavailable(c.env)
 if(unavailable) fail('MANGO_UNAVAILABLE',unavailable,503)
 const d=await one(c, `SELECT d.*,(SELECT COALESCE(SUM(amount_cents),0) FROM cf_contribution_ledger g WHERE g.donor_id=d.id) AS total_cents,
 (SELECT COUNT(*) FROM cf_gift_balances g WHERE g.donor_id=d.id AND net_cents>0) AS gift_count,
 (SELECT MAX(received_on) FROM cf_gift_balances g WHERE g.donor_id=d.id AND net_cents>0) AS last_gift FROM cf_donors d WHERE id=? AND erased_at IS NULL`,input.donorId)
 if(!d) fail('DONOR_CHANGED','This donor is no longer available.',409)
 if(input.expectedEmail!==undefined && input.expectedEmail!==d.email)fail('RECIPIENT_CHANGED','The donor’s email changed after approval. Prepare a new appeal audience.',409)
 const preference=await reconcileDonor(c,d.id,true)
 const row={id:newId(),email:d.email,subject:mergeMessage(input.subject,input.merge??d),body:mergeMessage(input.body,input.merge??d)}
 const replyTo=c.env?.COFFER_REPLY_ADDRESS?.trim().toLowerCase()??''
 const state=preference.allowed?'preparing':'suppressed'
 await commit(c,[...(preference.allowed?[guard(`EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=? AND d.email=? AND d.erased_at IS NULL AND (SELECT status FROM cf_consents WHERE donor_id=d.id AND channel='email' ORDER BY id DESC LIMIT 1)='granted')`,'CONSENT_CHANGED','The recipient’s email or consent changed before sending.',d.id,d.email)]:[]),sql(`INSERT OR IGNORE INTO cf_communications(id,message_key,donor_id,source_kind,source_id,provider,status,subject,body,reply_to,created_at,note)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,row.id,input.key,d.id,input.sourceKind,input.sourceId,providerName(c.env),state,row.subject,row.body,replyTo,c.now,preference.allowed?'Preparing an email campaign.':preference.note),
 event(c,'marketing.prepare',input.sourceKind,input.sourceId,d.id,{communicationId:row.id,state})])
 const claim=await one(c,'SELECT * FROM cf_communications WHERE message_key=?',input.key)
 if(claim?.id!==row.id) return claim!
 if(!preference.allowed) return {...claim,status:'suppressed'}
 try {
  // Persist the returned draft before composition/approval. A lost create answer
  // stays uncertain and is never submitted again automatically.
  const draft=await createProviderCampaign(c.env,row)
  await c.db.prepare('UPDATE cf_communications SET campaign_id=?,revision_id=? WHERE id=?').bind(draft.campaignId,draft.revisionId,row.id).run()
  const current=await reconcileDonor(c,d.id)
  if(!current.allowed) {
   await c.db.prepare("UPDATE cf_communications SET status='suppressed',note='Consent changed before Mango approval.' WHERE id=?").bind(row.id).run()
   return {id:row.id,status:'suppressed'}
  }
  await composeProviderCampaign(c.env,row,draft)
  await c.db.batch([
   c.db.prepare("UPDATE cf_communications SET status='submitted',submitted_at=?,note='Submitted to the email provider; email handoff is not yet confirmed.' WHERE id=?").bind(c.now,row.id),
   c.db.prepare(event(c,'marketing.submitted',input.sourceKind,input.sourceId,d.id,{communicationId:row.id,provider:providerName(c.env),campaignId:draft.campaignId}).sql).bind(...event(c,'marketing.submitted',input.sourceKind,input.sourceId,d.id,{communicationId:row.id,provider:providerName(c.env),campaignId:draft.campaignId}).params),
  ])
  return {id:row.id,status:'submitted',campaignId:draft.campaignId}
 }catch(error) {
  const detail=error as {code?:string;details?:{providerStatus?:number}}
  const rejected=['MANGO_REPLY','MAILCHIMP_REPLY'].includes(detail?.code??'') || ['MANGO_REFUSED','MAILCHIMP_REFUSED'].includes(detail?.code??'') && Number(detail.details?.providerStatus)>=400 && Number(detail.details?.providerStatus)<500
  const label=providerLabel(c.env),state=rejected?'rejected':'uncertain',note=rejected?`${label} refused this submission. Review the saved draft and sender checks. No email was scheduled by Coffer.`:`${label} submission was not confirmed. Review the saved campaign; no automatic resend.`
  await c.db.prepare('UPDATE cf_communications SET status=?,note=? WHERE id=?').bind(state,note,row.id).run()
  return {id:row.id,status:state}
 }
}
export async function refreshMessages(c:Context) {
 const rows=await all(c,`SELECT * FROM cf_communications WHERE campaign_id IS NOT NULL AND status IN ('submitted','uncertain') ORDER BY COALESCE(checked_at,''),created_at LIMIT 8`)
 for(const row of rows){
  const report=await providerResults(c.env,row)
  if(!Array.isArray(report.rows))fail('MANGO_RESPONSE','Mango did not return send results.',502)
  const donor=await one(c,'SELECT email FROM cf_donors WHERE id=? AND erased_at IS NULL',row.donor_id)
  const facts=report.rows.filter((r:Row)=>r.destination?.toLowerCase()===donor?.email?.toLowerCase())
  const disposition=facts[0]?.disposition??report.state??'unknown'
  const note=['accepted','handed-off','sent'].includes(disposition)?'The provider confirmed email handoff. Delivery is not confirmed.':disposition==='delivered'?'The provider confirmed delivery.':`Provider result: ${disposition}. Check the provider for delivery details.`
  await commit(c,[sql('UPDATE cf_communications SET remote_status=?,checked_at=?,note=? WHERE id=?',disposition,c.now,note,row.id),
   ...(disposition!==row.remote_status?[event(c,'marketing.result',row.source_kind,row.source_id,row.donor_id,{communicationId:row.id,disposition})]:[])])
  await reconcileDonor(c,row.donor_id)
 }
 return {checked:rows.length}
}
export const communicationHistory=(c:{db:D1Database},donorId:string)=>all(c,'SELECT * FROM cf_communications WHERE donor_id=? ORDER BY created_at DESC',donorId)
