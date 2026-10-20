import { all, commit, event, fail, guard, newId, one, sql, type Context, type Row } from '../db'
import { usd } from '../money'
import { composeMailchimpCampaign, createMailchimpCampaign, listInMango, providerResults, providerTitle } from './provider'
import { requireConnection, savedConnection } from './connection'
import { settings } from '../settings'
import { reconcileDonor } from './preferences'

export type MessageInput = { key:string; donorId:string; subject:string; body:string; sourceKind:'appeal'|'welcome'; sourceId:string; listName:string; expectedEmail?:string; merge?:Row }
export function mergeMessage(template: string, values: Row) {
 const fields: Row = {donor_name:values.name,total_given:usd(values.total_cents??0),last_gift:values.last_gift||'No gift recorded',gift_count:String(values.gift_count??0)}
 return template.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (token,key) => { if (!(key in fields)) fail('MERGE_FIELD', `Unknown merge field ${token}.`,400); return fields[key] })
}
export async function submitMessage(c: Context,input:MessageInput):Promise<Row> {
 const previous=await one(c,'SELECT * FROM cf_communications WHERE message_key=?',input.key)
 if(previous) return previous
 const conn=await requireConnection(c)
 const d=await one(c, `SELECT d.*,(SELECT COALESCE(SUM(amount_cents),0) FROM cf_monetary_contributions g WHERE g.donor_id=d.id) AS total_cents,
 (SELECT COUNT(*) FROM cf_gift_balances g WHERE g.donor_id=d.id AND net_cents>0) AS gift_count,
 (SELECT MAX(received_on) FROM cf_gift_balances g WHERE g.donor_id=d.id AND net_cents>0) AS last_gift FROM cf_donors d WHERE id=? AND erased_at IS NULL`,input.donorId)
 if(!d) fail('DONOR_CHANGED','This donor is no longer available.',409)
 if(input.expectedEmail!==undefined && input.expectedEmail!==d.email)fail('RECIPIENT_CHANGED','The donor’s email changed after approval. Prepare a new appeal audience.',409)
 const preference=await reconcileDonor(c,d.id,conn.provider==='mailchimp')
 const row={id:newId(),email:d.email,name:d.name,subject:mergeMessage(input.subject,input.merge??d),body:mergeMessage(input.body,input.merge??d)}
 const replyTo=(conn.fromEmail??c.env?.COFFER_REPLY_ADDRESS??'').trim().toLowerCase()
 const allowed=preference.allowed||conn.provider==='mango'&&preference.state==='pending'
 const state=allowed?'preparing':'suppressed'
 await commit(c,[...(allowed?[guard(`EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=? AND d.email=? AND d.erased_at IS NULL AND (SELECT status FROM cf_consents WHERE donor_id=d.id AND channel='email' ORDER BY id DESC LIMIT 1)='granted')`,'CONSENT_CHANGED','The recipient’s email or consent changed before sending.',d.id,d.email)]:[]),sql(`INSERT OR IGNORE INTO cf_communications(id,message_key,donor_id,source_kind,source_id,provider,status,subject,body,reply_to,created_at,note,recipient_email)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,row.id,input.key,d.id,input.sourceKind,input.sourceId,conn.provider,state,row.subject,row.body,replyTo,c.now,allowed?'Preparing an email campaign.':preference.note,d.email),
 event(c,'marketing.prepare',input.sourceKind,input.sourceId,d.id,{communicationId:row.id,state})])
 const claim=await one(c,'SELECT * FROM cf_communications WHERE message_key=?',input.key)
 if(claim?.id!==row.id) return claim!
 if(!allowed) return {...claim,status:'suppressed'}
 if(conn.provider==='mango') return listMessage(c,conn,row,d,input)
 try {
  // Persist the returned draft before composition/approval. A lost create answer
  // stays uncertain and is never submitted again automatically.
  const draft=await createMailchimpCampaign(conn,row)
  await c.db.prepare('UPDATE cf_communications SET campaign_id=?,revision_id=? WHERE id=?').bind(draft.campaignId,draft.revisionId,row.id).run()
  const current=await reconcileDonor(c,d.id)
  if(!current.allowed) {
   await c.db.prepare("UPDATE cf_communications SET status='suppressed',note='Consent changed before Mailchimp sent it.' WHERE id=?").bind(row.id).run()
   return {id:row.id,status:'suppressed'}
  }
  await composeMailchimpCampaign(conn,row,draft)
  await c.db.batch([
   c.db.prepare("UPDATE cf_communications SET status='submitted',submitted_at=?,note='Submitted to the email provider; email handoff is not yet confirmed.' WHERE id=?").bind(c.now,row.id),
   c.db.prepare(event(c,'marketing.submitted',input.sourceKind,input.sourceId,d.id,{communicationId:row.id,provider:conn.provider,campaignId:draft.campaignId}).sql).bind(...event(c,'marketing.submitted',input.sourceKind,input.sourceId,d.id,{communicationId:row.id,provider:conn.provider,campaignId:draft.campaignId}).params),
  ])
  return {id:row.id,status:'submitted',campaignId:draft.campaignId}
 }catch(error) {
  const detail=error as {code?:string;details?:{providerStatus?:number}}
  const rejected=['MANGO_REPLY','MAILCHIMP_REPLY'].includes(detail?.code??'') || ['MANGO_REFUSED','MAILCHIMP_REFUSED'].includes(detail?.code??'') && Number(detail.details?.providerStatus)>=400 && Number(detail.details?.providerStatus)<500
  const label=providerTitle(conn.provider),state=rejected?'rejected':'uncertain',note=rejected?`${label} refused this submission. Review the saved draft and sender checks. No email was scheduled by Coffer.`:`${label} submission was not confirmed. Review the saved campaign; no automatic resend.`
  await c.db.prepare('UPDATE cf_communications SET status=?,note=? WHERE id=?').bind(state,note,row.id).run()
  return {id:row.id,status:state}
 }
}
/** Mango: the donor joins the appeal's list with Coffer's consent evidence; a person approves the campaign in Mango. */
async function listMessage(c:Context,conn:Awaited<ReturnType<typeof requireConnection>>,row:Row,d:Row,input:MessageInput):Promise<Row>{
 try {
  const donor=await one(c,`SELECT d.*,k.id AS consent_id,k.evidence,k.captured_on FROM cf_donors d JOIN cf_consents k ON k.id=(SELECT id FROM cf_consents WHERE donor_id=d.id AND channel='email' ORDER BY id DESC LIMIT 1) WHERE d.id=?`,d.id)
  const contact=await listInMango(conn,donor!,(await settings(c)).organisation,input.listName,{donorName:d.name,totalGiven:usd(d.total_cents??0),lastGift:d.last_gift||'',giftCount:Number(d.gift_count??0)})
  const listed=contact.emailStatus==='subscribed'
  const note=listed?`On the Mango list “${input.listName}”. Mango sends once a person approves a campaign for that list in Mango.`:`Mango keeps this address opted out (${contact.emailStatus}). No email will go to it.`
  await commit(c,[sql('UPDATE cf_communications SET status=?,campaign_id=?,submitted_at=?,note=? WHERE id=?',listed?'listed':'suppressed',(contact.segmentIds??[]).join(',')||null,c.now,note,row.id),
   event(c,'marketing.listed',input.sourceKind,input.sourceId,d.id,{communicationId:row.id,provider:'mango',list:input.listName,status:contact.emailStatus})])
  if(!listed)await reconcileDonor(c,d.id)
  return {id:row.id,status:listed?'listed':'suppressed'}
 } catch(error) {
  const detail=error as {message?:string}
  await c.db.prepare("UPDATE cf_communications SET status='uncertain',note=? WHERE id=?").bind(`Mango did not confirm this donor on the list: ${detail.message??'unknown error'}`,row.id).run()
  throw error
 }
}
export async function refreshMessages(c:Context,source?:{kind:string;id:string}) {
 const conn=await savedConnection(c)
 if(conn?.provider!=='mailchimp')return {checked:0}
 const rows=await all(c,`SELECT * FROM cf_communications WHERE provider='mailchimp' AND campaign_id IS NOT NULL AND status IN ('submitted','uncertain') AND (? IS NULL OR (source_kind=? AND source_id=?)) ORDER BY COALESCE(checked_at,''),created_at,id LIMIT 8`,source?.kind??null,source?.kind??null,source?.id??null)
 for(const row of rows){
  const report=await providerResults(conn,row)
  if(!Array.isArray(report.rows))fail('MAILCHIMP_RESPONSE','Mailchimp did not return send results.',502)
  const frozen=row.recipient_email ?? (row.source_kind==='appeal' ? (await one(c,'SELECT email FROM cf_appeal_recipients WHERE appeal_id=? AND donor_id=?',row.source_id,row.donor_id))?.email : null)
  const facts=report.rows.filter((r:Row)=>r.destination?.toLowerCase()===frozen?.toLowerCase())
  const disposition=facts[0]?.disposition??(report.state==='sent'&&report.rows.length===0?'not_sent':report.state==='sent'?'unknown':report.state??'unknown')
  const note=['accepted','handed-off','sent'].includes(disposition)?'The provider confirmed email handoff. Delivery is not confirmed.':disposition==='delivered'?'The provider confirmed delivery.':`Provider result: ${disposition}. Check the provider for delivery details.`
  await commit(c,[sql('UPDATE cf_communications SET remote_status=?,checked_at=?,note=? WHERE id=?',disposition,c.now,note,row.id),
   ...(disposition!==row.remote_status?[event(c,'marketing.result',row.source_kind,row.source_id,row.donor_id,{communicationId:row.id,disposition})]:[])])
  await reconcileDonor(c,row.donor_id)
 }
 return {checked:rows.length}
}
export const communicationHistory=(c:{db:D1Database},donorId:string)=>all(c,'SELECT * FROM cf_communications WHERE donor_id=? ORDER BY created_at DESC',donorId)
