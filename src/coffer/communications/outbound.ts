import { journeySendGuards } from './journey-guards'
import { fillFields } from '../template-fields'
import { profileRecipient, selectedProfileFields } from './profile-fields'
import { solicitationAskStatements, solicitationRunGuards } from '../solicitation'
import { nameMergeFields, frozenNameFields } from '../person-names'
import { letterRecipient } from '../organizations'
import { all, commit, event, fail, guard, newId, one, sql, type Context, type Row } from '../db'
import { usd } from '../money'
import { composeProviderCampaign, createProviderCampaign, listInMango, providerResults, providerTitle } from './provider'
import { requireConnection, savedConnection } from './connection'
import { settings } from '../settings'
import { reconcileDonor } from './preferences'
import { communicationAcknowledgment } from '../gift-acknowledgments'
import { recordConstantContactOptout } from './constant-contact-campaign'

async function savedResult(c: Context, messageId: string, disposition: string) {
 const message = (await one(c, 'SELECT * FROM cf_communications WHERE id=?', messageId))!
 await communicationAcknowledgment(c, message, disposition)
 return message
}

export type MessageInput = { key:string; donorId:string; subject:string; body:string; sourceKind:'appeal'|'welcome'; sourceId:string; listName:string; expectedEmail?:string;emailType?:string;expectedContactId?:string;expectedContactVersion?:number; merge?:Row; rendered?:{subject:string;body:string} }
export function mergeMessage(template: string, values: Row) {
 const fields: Row = {...(values.name_fields ? JSON.parse(values.name_fields) : nameMergeFields(values)),donor_name:values.name,total_given:usd(values.total_cents??0),last_gift:values.last_gift||'No gift recorded',gift_count:String(values.gift_count??0)}
 return fillFields(template,{...fields,...(typeof values.merge_fields==='string'?JSON.parse(values.merge_fields):values.merge_fields??{})})
}
async function handoffGuards(c:Context,input:MessageInput,donorId:string,recipient:Row){
 const donor=await one(c,'SELECT * FROM cf_donors WHERE id=?',donorId)
 if(!donor)fail('DONOR_CHANGED','This donor is no longer available.',409)
 const current=await profileRecipient(c,donor!,{emailType:input.emailType})
 if(current.email!==recipient.email||current.selected_email_contact_id!==recipient.selected_email_contact_id||current.selected_email_contact_version!==recipient.selected_email_contact_version)fail('CONTACT_CHANGED','The email contact changed before handoff.',409)
 await commit(c,[...await solicitationRunGuards(c,input.sourceKind,input.sourceId,[donorId]),...(input.sourceKind==='welcome'?await journeySendGuards(c,input.sourceId):[]),
  guard(`EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=? AND d.erased_at IS NULL AND d.constituent_status='active' AND (SELECT status FROM cf_consents WHERE donor_id=d.id AND channel='email' ORDER BY id DESC LIMIT 1)='granted')`,'CONSENT_CHANGED','The recipient’s consent or status changed before handoff.',donorId),
  ...(current.selected_email_contact_id?[guard(`EXISTS(SELECT 1 FROM cf_contact_points WHERE id=? AND donor_id=? AND kind='email' AND active=1 AND value=? AND version=?)`,'CONTACT_CHANGED','The email contact changed before handoff.',current.selected_email_contact_id,donorId,current.email,current.selected_email_contact_version)]:[]),
 ])
}
export async function submitMessage(c: Context,input:MessageInput):Promise<Row> {
 const previous=await one(c,'SELECT * FROM cf_communications WHERE message_key=?',input.key)
 if(previous) return previous
 const conn=await requireConnection(c)
 if(conn.provider==='constant-contact'&&conn.fromEmail!==String(c.env?.COFFER_REPLY_ADDRESS??'').trim().toLowerCase())fail('CONSTANT_CONTACT_REPLY','The installed reply address changed. Reconnect Constant Contact before sending.',409)
 const d=await one(c, `SELECT d.*,(SELECT COALESCE(SUM(amount_cents),0) FROM cf_monetary_contributions g WHERE g.donor_id=d.id) AS total_cents,
 (SELECT COUNT(*) FROM cf_gift_balances g WHERE g.donor_id=d.id AND net_cents>0) AS gift_count,
 (SELECT MAX(received_on) FROM cf_gift_balances g WHERE g.donor_id=d.id AND net_cents>0) AS last_gift FROM cf_donors d WHERE id=? AND erased_at IS NULL`,input.donorId)
 if(!d) fail('DONOR_CHANGED','This donor is no longer available.',409)
 const currentNames=await profileRecipient(c,d,{emailType:input.emailType})
 if(input.expectedContactId&&(currentNames.selected_email_contact_id!==input.expectedContactId||currentNames.selected_email_contact_version!==input.expectedContactVersion))fail('CONTACT_CHANGED','The approved email contact changed. Prepare a new audience.',409)
 const excludedStatus=d.constituent_status!=='active'?d.constituent_status:null
 if(input.expectedEmail!==undefined && input.expectedEmail!==currentNames.email)fail('RECIPIENT_CHANGED','The donor’s email changed after approval. Prepare a new appeal audience.',409)
 const preference=excludedStatus?{allowed:false,state:'excluded',note:`The constituent is ${excludedStatus}; no email was sent.`}:await reconcileDonor(c,d.id,conn.provider!=='mango',{emailType:input.emailType})
 if(preference.allowed||conn.provider==='mango'&&preference.state==='pending')selectedProfileFields(conn,currentNames)
 const row={id:newId(),email:currentNames.email,name:d.name,subject:input.rendered?.subject??mergeMessage(input.subject,input.merge??currentNames),body:input.rendered?.body??mergeMessage(input.body,input.merge??currentNames)}
 const replyTo=(conn.fromEmail??c.env?.COFFER_REPLY_ADDRESS??'').trim().toLowerCase()
 const allowed=preference.allowed||conn.provider==='mango'&&preference.state==='pending'
 const state=allowed?'preparing':'suppressed'
 await commit(c,[...(input.sourceKind==='welcome'?await journeySendGuards(c,input.sourceId):[]),...(currentNames.selected_email_contact_id?[guard(`EXISTS(SELECT 1 FROM cf_contact_points WHERE id=? AND donor_id=? AND kind='email' AND active=1 AND value=? AND version=?)`,'CONTACT_CHANGED','The email contact changed before preparing the message.',currentNames.selected_email_contact_id,d.id,currentNames.email,currentNames.selected_email_contact_version)]:[]),...(allowed?await solicitationAskStatements(c,input.sourceKind,input.sourceId,[d.id]):[]),...(allowed?[guard(`EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=? AND (d.email=? OR EXISTS(SELECT 1 FROM cf_contact_points p WHERE p.donor_id=d.id AND p.kind='email' AND p.active=1 AND p.value=?)) AND d.erased_at IS NULL AND d.constituent_status='active' AND (SELECT status FROM cf_consents WHERE donor_id=d.id AND channel='email' ORDER BY id DESC LIMIT 1)='granted')`,'CONSENT_CHANGED','The recipient’s email or consent changed before sending.',d.id,currentNames.email,currentNames.email)]:[]),sql(`INSERT OR IGNORE INTO cf_communications(id,message_key,donor_id,source_kind,source_id,provider,status,subject,body,reply_to,created_at,note,recipient_email,name_fields,recipient_contact_id,recipient_contact_version)
 VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,row.id,input.key,d.id,input.sourceKind,input.sourceId,conn.provider,state,row.subject,row.body,replyTo,c.now,allowed?'Preparing an email campaign.':preference.note,currentNames.email,input.merge?.name_fields??frozenNameFields(currentNames),currentNames.selected_email_contact_id,currentNames.selected_email_contact_version),
 event(c,'marketing.prepare',input.sourceKind,input.sourceId,d.id,{communicationId:row.id,state})])
 const claim=await one(c,'SELECT * FROM cf_communications WHERE message_key=?',input.key)
 if(claim?.id!==row.id) return claim!
 if(!allowed) return savedResult(c,row.id,'suppressed')
 if(conn.provider==='mango') return listMessage(c,conn,row,d,input,preference.contact?.fields)
 try {
  // Persist the returned draft before composition/approval. A lost create answer
  // stays uncertain and is never submitted again automatically.
  const draft=await createProviderCampaign(conn,row)
  await c.db.prepare('UPDATE cf_communications SET campaign_id=?,revision_id=? WHERE id=?').bind(draft.campaignId,draft.revisionId,row.id).run()
  const checked=await profileRecipient(c,d,{emailType:input.emailType});if(checked.email!==row.email||checked.selected_email_contact_id!==currentNames.selected_email_contact_id||checked.selected_email_contact_version!==currentNames.selected_email_contact_version)fail('CONTACT_CHANGED','The email contact changed before sending.',409)
  const current=await reconcileDonor(c,d.id,false,{emailType:input.emailType})
  if(!current.allowed) {
   await c.db.prepare("UPDATE cf_communications SET status='suppressed',note='Consent changed before Mailchimp sent it.' WHERE id=?").bind(row.id).run()
   return savedResult(c,row.id,'suppressed')
  }
  await commit(c,[...await solicitationRunGuards(c,input.sourceKind,input.sourceId,[d.id]),...(input.sourceKind==='welcome'?await journeySendGuards(c,input.sourceId):[])])
  await composeProviderCampaign(conn,row,draft,()=>handoffGuards(c,input,d.id,currentNames))
  await c.db.batch([
   c.db.prepare("UPDATE cf_communications SET status='submitted',submitted_at=?,note='Submitted to the email provider; email handoff is not yet confirmed.' WHERE id=?").bind(c.now,row.id),
   c.db.prepare(event(c,'marketing.submitted',input.sourceKind,input.sourceId,d.id,{communicationId:row.id,provider:conn.provider,campaignId:draft.campaignId}).sql).bind(...event(c,'marketing.submitted',input.sourceKind,input.sourceId,d.id,{communicationId:row.id,provider:conn.provider,campaignId:draft.campaignId}).params),
  ])
  // The exact message was accepted by the sender. This acknowledges a thank-you;
  // it does not claim a provider delivery result.
  return savedResult(c,row.id,'accepted')
 }catch(error) {
  const detail=error as {code?:string;details?:{providerStatus?:number}}
  const rejected=['MANGO_REPLY','MAILCHIMP_REPLY','CONSTANT_CONTACT_REPLY'].includes(detail?.code??'') || ['MANGO_REFUSED','MAILCHIMP_REFUSED','CONSTANT_CONTACT_REFUSED'].includes(detail?.code??'') && Number(detail.details?.providerStatus)>=400 && Number(detail.details?.providerStatus)<500
  const label=providerTitle(conn.provider),state=rejected?'rejected':'uncertain',note=rejected?`${label} refused this submission. Review the saved draft and sender checks. No email was scheduled by Coffer.`:`${label} submission was not confirmed. Review the saved campaign; no automatic resend.`
  await c.db.prepare('UPDATE cf_communications SET status=?,note=? WHERE id=?').bind(state,note,row.id).run()
  return savedResult(c,row.id,rejected?'not_sent':'unknown')
 }
}
/** Mango: the donor joins the appeal's list with Coffer's consent evidence; a person approves the campaign in Mango. */
async function listMessage(c:Context,conn:Awaited<ReturnType<typeof requireConnection>>,row:Row,d:Row,input:MessageInput,existingFields?:Row):Promise<Row>{
 try {
  const donor=await one(c,`SELECT d.*,k.id AS consent_id,k.evidence,k.captured_on FROM cf_donors d JOIN cf_consents k ON k.id=(SELECT id FROM cf_consents WHERE donor_id=d.id AND channel='email' ORDER BY id DESC LIMIT 1) WHERE d.id=? AND k.status='granted' AND d.constituent_status='active' AND d.erased_at IS NULL`,d.id)
  if(!donor)fail('CONSENT_CHANGED','The recipient’s consent or status changed before handoff.',409)
  await commit(c,[...await solicitationRunGuards(c,input.sourceKind,input.sourceId,[d.id]),...(input.sourceKind==='welcome'?await journeySendGuards(c,input.sourceId):[])])
  const selected=await profileRecipient(c,donor!,{emailType:input.emailType});if(selected.email!==row.email||input.expectedContactId&&(selected.selected_email_contact_id!==input.expectedContactId||selected.selected_email_contact_version!==input.expectedContactVersion))fail('CONTACT_CHANGED','The email contact changed before handoff.',409)
  const contact=await listInMango(conn,{...selected,remote_profile_fields:existingFields},(await settings(c)).organisation,input.listName,{donorName:d.name,totalGiven:usd(d.total_cents??0),lastGift:d.last_gift||'',giftCount:Number(d.gift_count??0)},()=>handoffGuards(c,input,d.id,selected))
  const listed=contact.emailStatus==='subscribed'
  const note=listed?`On the Mango list “${input.listName}”. Mango sends once a person approves a campaign for that list in Mango.`:`Mango keeps this address opted out (${contact.emailStatus}). No email will go to it.`
  await commit(c,[sql('UPDATE cf_communications SET status=?,campaign_id=?,submitted_at=?,note=? WHERE id=?',listed?'listed':'suppressed',(contact.segmentIds??[]).join(',')||null,c.now,note,row.id),
   event(c,'marketing.listed',input.sourceKind,input.sourceId,d.id,{communicationId:row.id,provider:'mango',list:input.listName,status:contact.emailStatus})])
  if(!listed)await reconcileDonor(c,d.id,false,{emailType:input.emailType})
  return savedResult(c,row.id,listed?'handed-off':'suppressed')
 } catch(error) {
  const detail=error as {message?:string}
  await c.db.prepare("UPDATE cf_communications SET status='uncertain',note=? WHERE id=?").bind(`Mango did not confirm this donor on the list: ${detail.message??'unknown error'}`,row.id).run()
  await savedResult(c,row.id,'unknown')
  throw error
 }
}
export async function refreshMessages(c:Context,source?:{kind:string;id:string}) {
 const conn=await savedConnection(c)
 if(!conn||!['mailchimp','constant-contact'].includes(conn.provider))return {checked:0,...(conn?.provider==='mango'?{unavailable:'Mango has no send or delivery result for these saved messages. Check the campaign in Mango.'}:{})}
 const rows=await all(c,`SELECT * FROM cf_communications WHERE provider=? AND campaign_id IS NOT NULL AND status IN ('submitted','uncertain') AND (? IS NULL OR (source_kind=? AND source_id=?)) ORDER BY COALESCE(checked_at,''),created_at,id LIMIT 8`,conn.provider,source?.kind??null,source?.kind??null,source?.id??null)
 for(const row of rows){
  const report=await providerResults(conn,row)
  if(!Array.isArray(report.rows))fail('MAILCHIMP_RESPONSE','Mailchimp did not return send results.',502)
  const frozen=row.recipient_email ?? (row.source_kind==='appeal' ? (await one(c,'SELECT email FROM cf_appeal_recipients WHERE appeal_id=? AND donor_id=?',row.source_id,row.donor_id))?.email : null)
  const facts=report.rows.filter((r:Row)=>r.destination?.toLowerCase()===frozen?.toLowerCase())
  if(conn.provider==='constant-contact'&&row.remote_status!=='unsubscribed'&&facts.some((fact:Row)=>fact.disposition==='unsubscribed'))await recordConstantContactOptout(c,row,frozen)
  const disposition=facts[0]?.disposition??(report.state==='sent'&&report.rows.length===0?'not_sent':report.state==='sent'?'unknown':report.state??'unknown')
  const note=disposition==='sent'?'The provider reports sending this message to the frozen recipient. Delivery is not confirmed.':['accepted','handed-off'].includes(disposition)?'The provider accepted the request. Sending and delivery are unconfirmed.':disposition==='delivered'?'The provider reports acceptance by the recipient’s mail server; this is not proof of reading.':`Provider result: ${disposition}. Check the provider for delivery details.`
  await commit(c,[sql('UPDATE cf_communications SET remote_status=?,checked_at=?,note=? WHERE id=?',disposition,c.now,note,row.id),
   ...(disposition!==row.remote_status?[event(c,'marketing.result',row.source_kind,row.source_id,row.donor_id,{communicationId:row.id,disposition})]:[])])
  await savedResult(c,row.id,disposition)
  await reconcileDonor(c,row.donor_id)
 }
 return {checked:rows.length}
}
export const communicationHistory=(c:{db:D1Database},donorId:string)=>all(c,'SELECT * FROM cf_communications WHERE donor_id=? ORDER BY created_at DESC',donorId)
