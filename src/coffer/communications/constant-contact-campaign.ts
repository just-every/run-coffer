import { commit, fail, sql, today, type Context, type Row } from '../db'
import { settings } from '../settings'
import type { Connection } from './connection'
import { ccContact, ccPart, ccRequest, constantContactContact } from './constant-contact-api'

const escape=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
async function verifyAudience(conn:Connection,listId:string,email:string){
 const data=await ccRequest(conn,'/contacts?'+new URLSearchParams({lists:listId,status:'all',limit:'2'}))
 if(!Array.isArray(data.contacts)||data._links?.next||data.contacts.length!==1||ccContact(data.contacts[0],email).emailStatus!=='subscribed')fail('CONSTANT_CONTACT_RECIPIENT','Constant Contact did not confirm exactly the frozen recipient. Sending remains held.',409)
}
export async function createConstantContactCampaign(conn:Connection,row:Row,saveList?:(listId:string)=>Promise<void>):Promise<Row>{
 const contact=await constantContactContact(conn,row.email)
 if(contact?.emailStatus!=='subscribed')fail('CONSTANT_CONTACT_PREFERENCE','Constant Contact requires current email permission before sending.',409)
 const list=await ccRequest(conn,'/contact_lists','POST',{name:'Coffer '+row.id,favorite:false})
 ccPart(list.list_id)
 await saveList?.(list.list_id)
 const membership:Row={update_source:'Account',list_memberships:[...new Set([...(contact.list_memberships??[]),list.list_id])]}
 for(const key of ['first_name','last_name','job_title','company_name','birthday_month','birthday_day','anniversary'])if(contact[key]!==undefined)membership[key]=contact[key]
 const updated=await ccRequest(conn,'/contacts/'+ccPart(contact.contact_id),'PUT',membership)
 if(ccContact(updated,row.email).emailStatus!=='subscribed')fail('CONSTANT_CONTACT_PREFERENCE','The recipient withdrew before audience synchronization.',409)
 await verifyAudience(conn,list.list_id,row.email)
 if(typeof row.subject!=='string'||!row.subject.trim()||/[\r\n]/.test(row.subject)||typeof row.body!=='string'||!row.body.trim())fail('CONSTANT_CONTACT_CONTENT','A subject and message body are required.',400)
 const html='<html><body>'+row.body.split(/\n\s*\n/).map((part:string)=>'<p>'+escape(part).replaceAll('\n','<br>')+'</p>').join('')+'</body></html>'
 // Tracking is disabled account-wide by Support, separately confirmed by the
 // owner at connection time. No invented per-campaign tracking flag is sent.
 const campaign=await ccRequest(conn,'/emails','POST',{name:'Coffer '+row.id,email_campaign_activities:[{format_type:5,from_name:conn.fromName,from_email:conn.senderEmail,reply_to_email:conn.fromEmail,subject:row.subject,html_content:html}]})
 ccPart(campaign.campaign_id)
 const primary=campaign.campaign_activities?.filter((activity:Row)=>activity.role==='primary_email')
 if(primary?.length!==1)fail('CONSTANT_CONTACT_RESPONSE','Constant Contact did not return one primary campaign activity.',502)
 ccPart(primary[0].campaign_activity_id)
 return {campaignId:campaign.campaign_id,revisionId:primary[0].campaign_activity_id,listId:list.list_id,html}
}
export async function composeConstantContactCampaign(conn:Connection,row:Row,draft:Row,beforeSend?:()=>Promise<void>){
 const path='/emails/activities/'+ccPart(draft.revisionId),saved=await ccRequest(conn,path)
 if(saved.campaign_id!==draft.campaignId||saved.role!=='primary_email'||saved.current_status!=='DRAFT')fail('CONSTANT_CONTACT_CAMPAIGN','The saved Constant Contact campaign changed. Review it before sending.',409)
 await ccRequest(conn,path,'PUT',{...saved,from_name:conn.fromName,from_email:conn.senderEmail,reply_to_email:conn.fromEmail,subject:row.subject,html_content:draft.html,contact_list_ids:[draft.listId],segment_ids:[]})
 const final=await ccRequest(conn,path)
 if(final.campaign_id!==draft.campaignId||final.current_status!=='DRAFT'||final.contact_list_ids?.length!==1||final.contact_list_ids[0]!==draft.listId||final.segment_ids?.length||final.reply_to_email!==conn.fromEmail||final.subject!==row.subject||final.html_content!==draft.html)fail('CONSTANT_CONTACT_CAMPAIGN','Constant Contact did not preserve the approved content and audience.',409)
 await verifyAudience(conn,draft.listId,row.email)
 await conn.checkFields?.()
 await beforeSend?.()
 await ccRequest(conn,path+'/schedules','POST',{scheduled_date:'0'})
}
export async function constantContactResults(conn:Connection,row:Row):Promise<Row>{
 const activity=await ccRequest(conn,'/emails/activities/'+ccPart(row.revision_id))
 if(activity.campaign_id!==row.campaign_id)fail('CONSTANT_CONTACT_RESPONSE','Constant Contact returned a different campaign.',502)
 if(activity.current_status!=='DONE')return {rows:[],state:activity.current_status??'unknown'}
 const results:Row[]=[]
 for(const [kind,disposition] of [['sends','sent'],['bounces','bounced'],['optouts','unsubscribed']]){
  const data=await ccRequest(conn,'/reports/email_reports/'+ccPart(row.revision_id)+'/tracking/'+kind+'?limit=2')
  if(!Array.isArray(data.tracking_activities)||data._links?.next||data.tracking_activities.length>1)fail('CONSTANT_CONTACT_RESPONSE','Constant Contact did not return complete recipient results.',502)
  for(const result of data.tracking_activities){
   if(result.campaign_activity_id!==row.revision_id||result.email_address?.toLowerCase()!==row.recipient_email?.toLowerCase())fail('CONSTANT_CONTACT_RESPONSE','A provider result does not match the frozen recipient.',502)
   results.unshift({destination:result.email_address,disposition})
  }
 }
 return {rows:results,state:'sent'}
}

/** An opt-out report is withdrawal evidence even if the contact read lags it.
 * Historical recipient addresses cannot withdraw a changed or merged identity. */
export async function recordConstantContactOptout(c:Context,row:Row,email:string){
 const day=today((await settings(c)).timezone,new Date(c.now))
 await commit(c,[sql(`INSERT INTO cf_consents(donor_id,channel,status,method,evidence,captured_on,recorded_at,recorded_by)
  SELECT d.id,'email','withdrawn','constant-contact',?,?,?,'Constant Contact result sync'
  FROM cf_donors d JOIN cf_consents k ON k.id=(SELECT MAX(id) FROM cf_consents WHERE donor_id=d.id AND channel='email')
  WHERE d.id=? AND d.erased_at IS NULL AND k.status='granted'
  AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)
  AND (lower(d.email)=lower(?) OR EXISTS(SELECT 1 FROM cf_contact_points p WHERE p.id=? AND p.donor_id=d.id AND p.kind='email' AND p.active=1 AND p.version=? AND lower(p.value)=lower(?)))`,
  'Constant Contact campaign opt-out: '+row.id,day,c.now,row.donor_id,email,row.recipient_contact_id??null,row.recipient_contact_version??null,email)])
}
