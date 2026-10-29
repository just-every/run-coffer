import { commit, event, fail, guard, one, sha256, sql, text, type Context, type Row } from '../db'
import { donorMailUnavailable, sendDonorMail } from '../outbound-mail'
import { prepareSolicitationRun, solicitationAskStatements } from '../solicitation'
import { settings } from '../settings'
import { usd } from '../money'
import { membershipState, membershipStaff } from './service'

/** Renewal requests are asks. An owner must approve this exact recipient and
 * wording; current permission and limits still apply at the submission claim. */
export async function membershipReminder(c:Context,id:string){
 const state=await membershipState(c),reminder=state.reminders.find(r=>r.id===id),member=state.memberships.find(m=>m.id===reminder?.membership_id)
 if(!reminder||!member)fail('NOT_FOUND','This renewal reminder is no longer available.',404)
 if(member.state==='review'||member.expires_on!==reminder.expires_on||!state.levels.find(l=>l.id===member.level_id)?.active)fail('REMINDER_CHANGED','This member has renewed, needs review, or the level is retired. Prepare current reminders.',409)
 const donor=await one(c,'SELECT id,version,name,email FROM cf_donors WHERE id=? AND erased_at IS NULL',member.donor_id)
 if(!donor?.email)fail('RECIPIENT_UNAVAILABLE','This member needs a current email address.',409)
 const organisation=(await settings(c)).organisation,subject='Renew your '+member.level_name+' membership'
 const body=`Dear ${donor.name},\n\nYour ${member.level_name} membership with ${organisation} expires on ${member.expires_on}. Renew for ${usd(member.price_cents)} for ${member.term_months} months. Benefits: ${member.benefit_description} (${usd(member.benefit_cents)} value). The contribution part is ${usd(member.price_cents-member.benefit_cents)}.\n\nReview the current membership terms: ${c.env!.AUTH_ORIGIN}/giving/memberships/${encodeURIComponent(state.levels.find(l=>l.id===member.level_id)!.slug)}\n\nContact us if you do not want renewal requests.`
 const contentHash=await sha256(JSON.stringify({donorId:donor.id,donorVersion:donor.version,email:donor.email,subject,body,from:c.env!.MAIL_FROM,expiresOn:member.expires_on}))
 return {reminder,member,donor,subject,body,contentHash}
}
export async function sendMembershipReminder(c:Context,p:Row){
 membershipStaff(c)
 const id=text(p.id,'Reminder',100),current=await membershipReminder(c,id)
 const {reminder,member,donor,subject,body,contentHash}=current
 if(p.confirm!=='yes'||p.contentHash!==contentHash)fail('APPROVAL_CHANGED','Review and confirm the exact current renewal request.',409)
 const prior=await one(c,'SELECT * FROM cf_membership_notices WHERE reminder_id=?',id)
 if(prior){
  if(prior.status==='accepted'&&prior.content_hash===contentHash){await commit(c,[]);return {id,status:'accepted'}}
  fail('REMINDER_HELD','This notice already has a submission. Investigate its provider result; it cannot be resent.',409)
 }
 const unavailable=donorMailUnavailable(c.env)
 if(unavailable)fail('MAIL_UNAVAILABLE',unavailable,503)
 const run=await prepareSolicitationRun(c,{kind:'membership',id,channel:'email',isAsk:true,donorIds:[donor.id]})
 if(run.excluded.length)fail('MEMBER_RESTRICTED','This member is excluded from renewal requests by current solicitation, topic or frequency preferences.',409)
 const consent=await one(c,"SELECT id,status FROM cf_consents WHERE donor_id=? AND channel='email' ORDER BY id DESC LIMIT 1",donor.id)
 if(consent?.status!=='granted')fail('CONSENT_REQUIRED','Current email permission is required for a renewal request.',409)
 await commit(c,[...run.statements,...await solicitationAskStatements(c,'membership',id,[donor.id],run),
  guard("EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND version=? AND email=? AND erased_at IS NULL AND constituent_status='active') AND (SELECT id FROM cf_consents WHERE donor_id=? AND channel='email' ORDER BY id DESC LIMIT 1)=?",'RECIPIENT_CHANGED','The member or current email permission changed.',donor.id,donor.version,donor.email,donor.id,consent.id),
  guard('NOT EXISTS(SELECT 1 FROM cf_membership_notices WHERE reminder_id=?)','REMINDER_HELD','This renewal notice is already claimed.',id),
  sql("INSERT INTO cf_membership_notices VALUES(?,?,?,?,'sending',NULL)",id,contentHash,c.now,c.actor.id),
  event(c,'membership.reminderApproved','membershipReminder',id,donor.id,{contentHash,expiresOn:reminder.expires_on})])
 let messageId:string|null=null
 try{
  // Re-read the exact member and content after the durable claim, before the edge.
  if((await membershipReminder(c,id)).contentHash!==contentHash)fail('REMINDER_CHANGED','Membership facts changed before submission.',409)
  await commit(c,[])
  const result=await sendDonorMail(c.env!,{deliveryId:'membership-'+id,from:c.env!.MAIL_FROM!,to:[donor.email],subject,text:body})
  messageId=result.providerMessageId
 }catch{ /* Unknown outcomes retain their once-only claim. */ }
 await commit(c,[sql('UPDATE cf_membership_notices SET status=?,message_id=? WHERE reminder_id=?',messageId?'accepted':'uncertain',messageId,id),event(c,messageId?'membership.reminderAccepted':'membership.reminderUncertain','membershipReminder',id,member.donor_id,{contentHash})])
 return {id,status:messageId?'accepted':'uncertain'}
}
