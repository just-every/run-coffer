import { claimAutomation } from '../automation-grants'
import { commit, event, guard, newId, one, sha256, sql, type Context, type Row } from '../db'
import { emailPortalLink } from '../giving/portal'
import type { GivingEnv } from '../giving/stripe'
import { noticeChecks, noticeFacts, noticeStop, lastRecoveryContact } from './recovery-notices-rules'

export async function settleRecoveryNotices(c:Context,subscriptionId:string,invoiceId:string,state:string,recoveredAt=c.now) {
 if(state==='recovered') {
  // Attribution is temporal custody, not a claim that mail caused recovery.
  await commit(c,[sql(`UPDATE cf_recovery_steps SET recovered_at=COALESCE(recovered_at,?) WHERE id=(SELECT id FROM cf_recovery_steps WHERE subscription_id=? AND sent_at IS NOT NULL AND state IN ('sent','completed') AND sent_at<=? ORDER BY sent_at DESC,ordinal DESC,id DESC LIMIT 1)`,recoveredAt,subscriptionId,recoveredAt)])
 }
 const rows=(await c.db.prepare("SELECT * FROM cf_recovery_steps WHERE subscription_id=? AND state IN ('prepared','held','awaiting_approval')").bind(subscriptionId).all<Row>()).results
 for(const step of rows) {
  const stop=await noticeStop(c,subscriptionId,step.invoice_id,step.case_started_at,step.kind)
  if(stop)await commit(c,[sql("UPDATE cf_recovery_steps SET state='stopped',reason=?,version=version+1 WHERE id=? AND claim_id IS NULL",stop,step.id),event(c,'recovery.noticeStopped','recovery_step',step.id,step.donor_id,{reason:stop})])
 }
}

export type ExpiryProof={methodId:string;year:number;month:number}
/** Only called after current Stripe invoice/default-method reconciliation. */
export async function advanceRecoveryNotices(c:Context,env:GivingEnv,subscriptionId:string,caseKey:string,kind:'failure'|'expiry',baseline:number,started:string,expiry?:ExpiryProof) {
 let latest=await one(c,'SELECT * FROM cf_recovery_steps WHERE invoice_id=? ORDER BY ordinal DESC LIMIT 1',caseKey)
 if(latest&&['sending','uncertain','stopped','closed'].includes(latest.state))return
 if(latest?.claim_id&&!['sent','completed'].includes(latest.state))return
 const facts=await noticeFacts(c,subscriptionId,kind,caseKey,latest?.baseline_cents??baseline,started)
 if(!facts||!facts.policy.approved_at)return
 if(expiry)facts.sources.push({kind:'current-card-expiry',id:caseKey,url:'/api/coffer/agent/recovery/notices',pointer:'/steps',facts:{subscriptionId,expiryYear:expiry.year,expiryMonth:expiry.month}})
 const {plan,policy,permission,consent}=facts
 const terminal=await noticeStop(c,subscriptionId,caseKey,started,kind)
 if(terminal) {
  if(latest&&!latest.claim_id)await commit(c,[sql("UPDATE cf_recovery_steps SET state='stopped',reason=?,version=version+1 WHERE id=?",terminal,latest.id)])
  return
 }
 // Do not create the next step until the actual elapsed interval has passed.
 const lastContact=await lastRecoveryContact(c,plan.donor_id)
 if(latest?.sent_at&&(!permission||Date.parse(c.now)<Date.parse(lastContact??latest.sent_at)+permission.interval_days*86400000))return
 const legacy=kind==='failure'?await one(c,'SELECT notice_state AS state,notice_claim_id AS claim FROM cf_agent_recovery WHERE invoice_id=?',caseKey):await one(c,'SELECT state,claim_id AS claim FROM cf_card_expiry_notices WHERE subscription_id=?',subscriptionId)
 const legacyCount=legacy&&['sent','sending','failed'].includes(legacy.state)&&!String(legacy.claim??'').startsWith('step:')?1:0
 if(legacyCount&&['sending','failed'].includes(legacy!.state))return // Never resend an uncertain legacy invitation.
 const ordinal=latest&&!latest.claim_id?latest.ordinal:(latest?.ordinal??legacyCount)+1
 if(permission&&ordinal>permission.max_notices)return
 if(lastContact&&permission&&Date.parse(c.now)<Date.parse(lastContact)+permission.interval_days*86400000)return
 const majorReview=facts.major||facts.changed,channel=permission?.channel??'email'
 const subject=kind==='expiry'?'Your monthly gift card expires next month':ordinal===1?'Update your payment method for your monthly gift':'Follow-up: update payment for your monthly gift'
 const manualBody=`${plan.name}, your monthly gift of $${(plan.amount_cents/100).toFixed(2)} ${kind==='expiry'?'uses a card expiring next month':'needs a payment-method check'}. Open ${env.AUTH_ORIGIN}/giving/portal to request your private giving link. Stripe controls payment retries. No new charge or revised gift amount is requested.`
 const body=channel==='email'?'Open your private giving portal to view your monthly gifts, update your card, or cancel monthly giving:\n\n{{private_giving_portal_link}}\n\nThis one-use link expires in 30 minutes. If you did not request it, you can ignore this email.':manualBody
 const contentHash=await sha256(JSON.stringify([subject,body,channel,plan.amount_cents,plan.email,policy.version,permission?.version??0,consent?.id??null,facts.sources]))
 const same=latest&&!latest.claim_id&&latest.content_hash===contentHash&&latest.donor_version===plan.donor_version
 const approved=same&&latest.approved_by
 const state=facts.reason?'held':majorReview&&!approved?'awaiting_approval':'prepared'
 const reason=facts.reason??(majorReview&&!approved?facts.changed?'Revised plan amount requires a person’s approval':'Major-donor notice requires a person’s approval':channel!=='email'?'Prepared for a person on the permitted channel':null)
 let step:Row
 if(same) {
  step={...latest,state,reason,major_review:majorReview?1:0}
  await commit(c,[sql('UPDATE cf_recovery_steps SET state=?,reason=?,major_review=? WHERE id=? AND claim_id IS NULL',state,reason,step.major_review,step.id)])
 } else {
  const stepId=latest&&!latest.claim_id?latest.id:newId(),version=latest&&!latest.claim_id?latest.version+1:1
  await commit(c,[sql(`INSERT INTO cf_recovery_steps(id,invoice_id,subscription_id,donor_id,kind,ordinal,version,state,reason,channel,amount_cents,baseline_cents,due_on,created_at,case_started_at,subject,body,content_hash,policy_version,permission_version,consent_id,recipient_email,donor_version,major_review,evidence)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(invoice_id,ordinal) DO UPDATE SET version=excluded.version,state=excluded.state,reason=excluded.reason,channel=excluded.channel,amount_cents=excluded.amount_cents,due_on=excluded.due_on,subject=excluded.subject,body=excluded.body,content_hash=excluded.content_hash,policy_version=excluded.policy_version,permission_version=excluded.permission_version,consent_id=excluded.consent_id,recipient_email=excluded.recipient_email,donor_version=excluded.donor_version,major_review=excluded.major_review,evidence=excluded.evidence,approved_by=NULL,approver_version=NULL,approved_at=NULL
   WHERE cf_recovery_steps.claim_id IS NULL`,stepId,caseKey,subscriptionId,plan.donor_id,kind,ordinal,version,state,reason,channel,plan.amount_cents,latest?.baseline_cents??baseline,facts.due,c.now,started,subject,body,contentHash,policy.version,permission?.version??0,consent?.id??null,plan.email,plan.donor_version,majorReview?1:0,JSON.stringify(facts.sources)),event(c,'recovery.noticePrepared','recovery_step',stepId,plan.donor_id,{kind,ordinal,channel,state,contentHash})])
  step=(await one(c,'SELECT * FROM cf_recovery_steps WHERE invoice_id=? AND ordinal=?',caseKey,ordinal))!
 }
 if(step.state!=='prepared'||step.channel!=='email'||step.claim_id)return
 // A claim never silently authorizes changed content or an extra notice.
 await claimAutomation(c,kind==='expiry'?'recovery.expiry':'recovery.notice',1,plan.donor_id)
 const claim=newId(),checks=noticeChecks(c,step)
 if(expiry)checks.push(guard('NOT EXISTS(SELECT 1 FROM cf_card_expiry_notices WHERE subscription_id=?) OR EXISTS(SELECT 1 FROM cf_card_expiry_notices WHERE subscription_id=? AND payment_method_id=? AND expiry_year=? AND expiry_month=?)','CARD_CHANGED','The current default card changed.',subscriptionId,subscriptionId,expiry.methodId,expiry.year,expiry.month))
 await commit(c,[...checks,guard('EXISTS(SELECT 1 FROM cf_recovery_steps WHERE id=? AND version=? AND claim_id IS NULL AND content_hash=?)','VERSION','The prepared notice changed.',step.id,step.version,contentHash),
  guard('(SELECT max_notices FROM cf_recovery_permissions WHERE donor_id=?)>=?','NOTICE_LIMIT','The donor’s maximum notices have been reached.',plan.donor_id,ordinal),
  sql("UPDATE cf_recovery_steps SET state='sending',claimed_at=?,claim_id=?,version=version+1 WHERE id=?",c.now,claim,step.id),
  ...(kind==='failure'?[sql("UPDATE cf_agent_recovery SET notice_state='sending',notice_claim_id=?,notice_at=? WHERE invoice_id=?",'step:'+step.id,c.now,caseKey)]:expiry?[sql(`INSERT INTO cf_card_expiry_notices VALUES(?,?,?,?,?,'sending',?) ON CONFLICT(subscription_id) DO UPDATE SET payment_method_id=excluded.payment_method_id,expiry_year=excluded.expiry_year,expiry_month=excluded.expiry_month,claim_id=excluded.claim_id,state='sending',checked_at=excluded.checked_at`,subscriptionId,expiry.methodId,expiry.year,expiry.month,'step:'+step.id,c.now)]:[]),event(c,'recovery.noticeClaimed','recovery_step',step.id,plan.donor_id,{kind,ordinal,contentHash,policyVersion:policy.version,permissionVersion:permission!.version})])
 let outcome='uncertain',authorized=false,failureReason='Submission failed or is uncertain; investigate before further contact'
 try{outcome=await emailPortalLink(env,plan.donor_id,subject,{body:step.body,authorize:async()=>{
  await commit(c,[...checks,...(expiry?[guard('EXISTS(SELECT 1 FROM cf_card_expiry_notices WHERE subscription_id=? AND claim_id=? AND payment_method_id=? AND expiry_year=? AND expiry_month=?)','CARD_CHANGED','The current default card claim changed.',subscriptionId,'step:'+step.id,expiry.methodId,expiry.year,expiry.month)]:[]),guard("EXISTS(SELECT 1 FROM cf_recovery_steps WHERE id=? AND state='sending' AND claim_id=?)",'VERSION','This notice claim changed.',step.id,claim),guard('(SELECT max_notices FROM cf_recovery_permissions WHERE donor_id=?)>=?','NOTICE_LIMIT','The donor’s maximum notices have been reached.',plan.donor_id,ordinal)])
  authorized=true
 }})?'sent':'held';if(outcome==='held')failureReason='No deliverable donor account'}catch(error){
  if(!authorized){outcome='held';failureReason=error instanceof Error?error.message:'Stopped before mail submission'}
  // Once submission begins, a lost response may have reached the provider.
  // Neither a refused nor an uncertain claim is automatically retried.
 }
 const result=[sql('UPDATE cf_recovery_steps SET state=?,sent_at=?,reason=?,version=version+1 WHERE id=? AND claim_id=?',outcome,outcome==='sent'?c.now:null,outcome==='sent'?null:failureReason,step.id,claim),
  ...(kind==='failure'?[sql('UPDATE cf_agent_recovery SET notice_state=?,notice_at=? WHERE invoice_id=? AND notice_claim_id=?',outcome==='sent'?'sent':outcome==='held'?'skipped':'failed',c.now,caseKey,'step:'+step.id)]:expiry?[sql('UPDATE cf_card_expiry_notices SET state=?,checked_at=? WHERE subscription_id=? AND claim_id=?',outcome==='sent'?'sent':outcome==='held'?'skipped':'failed',c.now,subscriptionId,'step:'+step.id)]:[]),event(c,'recovery.notice'+(outcome==='sent'?'Accepted':outcome==='held'?'Held':'Uncertain'),'recovery_step',step.id,plan.donor_id,{kind,ordinal,contentHash})]
 // Recording the result of an already-authorized provider submission is not a
 // new send: retain its truthful outcome even if authority changes in flight.
 await c.db.batch(result.map(s=>c.db.prepare(s.sql).bind(...s.params)))
}
