import { addDays, all, guard, one, today, type Context, type Row, type Stmt } from '../db'
import { settings } from '../settings'

export const policyConfigured = async(c:Pick<Context,'db'>)=>!!(await one(c,'SELECT approved_at FROM cf_recovery_notice_policy WHERE id=1'))?.approved_at
/** Newly offered cadences and staff mutations never inherit legacy notice consent. */
export const recoveryPolicyRequired=async(c:Pick<Context,'db'>,subscriptionId:string)=>!!await one(c,`SELECT 1 FROM cf_subscriptions s WHERE s.id=? AND (EXISTS(SELECT 1 FROM cf_giving_intents i WHERE i.customer_id=s.customer_id AND i.billing_frequency IN ('quarterly','annually')) OR EXISTS(SELECT 1 FROM cf_portal_changes p WHERE p.subscription_id=s.id AND p.action LIKE 'staff.%'))`,subscriptionId)
export const portalStopSql = `EXISTS(SELECT 1 FROM cf_events WHERE action='portal.paymentMethodUpdated' AND subject_kind='subscription' AND subject_id=? AND at>=?)`
export async function noticeStop(c:Context,subscriptionId:string,caseKey:string,started:string,kind:string) {
 if(await one(c,'SELECT invoice_id FROM cf_recovery_closures WHERE invoice_id IN (?,?)',caseKey,'plan:'+subscriptionId))return 'Closed by a person'
 if((await one(c,`SELECT (${portalStopSql}) AS stopped`,subscriptionId,started))?.stopped)return 'Payment method updated in the donor portal'
 const sub=await one(c,'SELECT status FROM cf_subscriptions WHERE id=?',subscriptionId)
 if(!sub||['unpaid','canceled','incomplete_expired'].includes(sub.status))return 'Plan lapsed or stopped'
 if(kind==='failure') {
  const recovery=await one(c,'SELECT state FROM cf_agent_recovery WHERE invoice_id=?',caseKey)
  if(recovery?.state==='recovered')return 'Recovered at Stripe'
  if(recovery?.state==='lapsed')return 'Plan lapsed at Stripe'
 }
 return null
}
/** All contact attempts count across plans and warning kinds. Uncertain mail
 * consumes the interval too; these queries never infer that it was delivered. */
export async function lastRecoveryContact(c:Context,donorId:string) {
 return (await one(c,`SELECT MAX(at) AS at FROM (
 SELECT COALESCE(sent_at,claimed_at) AS at FROM cf_recovery_steps WHERE (donor_id=? OR subscription_id IN(SELECT id FROM cf_subscriptions WHERE donor_id=?)) AND claim_id IS NOT NULL
 UNION ALL SELECT notice_at FROM cf_agent_recovery r JOIN cf_subscriptions s ON s.id=r.subscription_id WHERE s.donor_id=? AND r.notice_state IN ('sent','sending','failed') AND COALESCE(r.notice_claim_id,'') NOT LIKE 'step:%'
 UNION ALL SELECT checked_at FROM cf_card_expiry_notices n JOIN cf_subscriptions s ON s.id=n.subscription_id WHERE s.donor_id=? AND n.state IN ('sent','sending','failed') AND n.claim_id NOT LIKE 'step:%')`,donorId,donorId,donorId,donorId))?.at??null
}
/** An uncertain submission holds later sequences for the same donor, including
 * a plan moved by merge. A person may close its plan after investigation. */
export const uncertainRecoveryContact = `EXISTS(SELECT 1 FROM cf_recovery_steps n JOIN cf_subscriptions s ON s.id=n.subscription_id
 WHERE (n.donor_id=? OR s.donor_id=?) AND n.id<>? AND n.state IN ('sending','uncertain')
 AND NOT EXISTS(SELECT 1 FROM cf_recovery_closures WHERE invoice_id IN (n.invoice_id,'plan:'||n.subscription_id)))`
export async function noticeFacts(c:Context,subscriptionId:string,kind:'failure'|'expiry',caseKey:string,baseline:number,started:string) {
 const plan=await one(c,`SELECT s.*,d.name,d.email,d.version AS donor_version,d.constituent_status,d.erased_at FROM cf_subscriptions s JOIN cf_donors d ON d.id=s.donor_id WHERE s.id=?`,subscriptionId)
 if(!plan)return null
 const [policy,permission,gifts,notes,prospects,pastNotices]=await Promise.all([
  one(c,'SELECT * FROM cf_recovery_notice_policy WHERE id=1'),one(c,'SELECT * FROM cf_recovery_permissions WHERE donor_id=?',plan.donor_id),
  all(c,"SELECT id,kind,amount_cents,received_on FROM cf_contribution_ledger WHERE donor_id=? AND kind IN ('gift','reversal') ORDER BY received_on DESC,id LIMIT 50",plan.donor_id),
  all(c,'SELECT id,kind,occurred_on,notes,next_step FROM cf_interactions WHERE donor_id=? ORDER BY occurred_on DESC,recorded_at DESC LIMIT 10',plan.donor_id),
  all(c,'SELECT id,stage FROM cf_prospects WHERE donor_id=?',plan.donor_id),
  all(c,'SELECT id,ordinal,kind,state,channel,sent_at,amount_cents FROM cf_recovery_steps WHERE subscription_id=? AND claim_id IS NOT NULL ORDER BY COALESCE(sent_at,claimed_at) DESC,id DESC LIMIT 10',subscriptionId),
 ])
 const standingCurrent=policy?.approved_by?await one(c,"SELECT id FROM oa_operators WHERE id=? AND version=? AND status='active' AND role IN ('owner','admin')",policy.approved_by,policy.approver_version):null
 const consent=permission?await one(c,'SELECT id,status FROM cf_consents WHERE donor_id=? AND channel=? ORDER BY id DESC LIMIT 1',plan.donor_id,permission.channel):null
 const total=(await one(c,'SELECT COALESCE(SUM(amount_cents),0) AS cents FROM cf_monetary_contributions WHERE donor_id=?',plan.donor_id))!.cents,major=prospects.length>0||total>=policy!.major_cents||plan.amount_cents>=policy!.major_cents,changed=plan.amount_cents!==baseline||(pastNotices.some(n=>n.sent_at)&&pastNotices.find(n=>n.sent_at)!.amount_cents!==plan.amount_cents)
 const last=await lastRecoveryContact(c,plan.donor_id),day=today((await settings(c)).timezone,new Date(c.now)),due=last&&permission?addDays(today((await settings(c)).timezone,new Date(last)),permission.interval_days):day
 const uncertain=(await one(c,`SELECT ${uncertainRecoveryContact} AS held`,plan.donor_id,plan.donor_id,''))?.held
 const reason=await noticeStop(c,subscriptionId,caseKey,started,kind)??(uncertain?'An earlier recovery submission is uncertain; a person must investigate':!policy?.enabled?'Standing notice approval is off':!standingCurrent?'The named development lead’s standing authority changed':!permission?.enabled?'Explicit donor recovery permission is required':plan.erased_at||plan.constituent_status!=='active'?'Donor is not active':consent?.status!=='granted'?'Current permission for the selected channel is required':permission.channel==='email'&&!plan.email?'Current email address is missing':null)
 const sources:Row[]=[{kind:'giving-history',id:plan.donor_id,url:'/api/coffer/donors/'+plan.donor_id,pointer:'/totals/lifetimeCents',facts:{lifetimeCents:total}},{kind:'subscription',id:subscriptionId,url:'/api/coffer/donors/'+plan.donor_id,pointer:'/subscriptions',facts:{amountCents:plan.amount_cents,status:plan.status}},{kind:'recovery-permission',id:plan.donor_id,url:'/api/coffer/agent/recovery/notices',pointer:'/permissions',facts:permission?{version:permission.version,channel:permission.channel,sourceOn:permission.source_on,evidence:permission.evidence}:null},{kind:'channel-consent',id:consent?.id??null,url:'/api/coffer/donors/'+plan.donor_id,pointer:'/consents',facts:consent},...gifts.map(g=>({kind:'gift',id:g.id,url:'/api/coffer/donors/'+plan.donor_id,pointer:'/gifts',facts:g})),...notes.map(n=>({kind:'interaction',id:n.id,url:'/api/coffer/donors/'+plan.donor_id,pointer:'/depth/interactions',facts:n})),...pastNotices.map(n=>({kind:'recovery-notice',id:n.id,url:'/api/coffer/agent/recovery/notices',pointer:'/steps',facts:n})),...prospects.map(p=>({kind:'prospect',id:p.id,url:'/api/coffer/pipeline',pointer:'/prospects',facts:p}))]
 return {plan,policy:policy!,permission,consent,major,changed,reason,due,day,sources}
}
/** Repeated in the exact native transaction that claims contact. A human
 * approval never overrides live permission, frequency or stop requests. */
export function noticeChecks(c:Context,step:Row):Stmt[] {
 const out=[guard(`NOT (${uncertainRecoveryContact})`,'RECOVERY_UNCERTAIN','An earlier recovery submission is uncertain; a person must investigate.',step.donor_id,step.donor_id,step.id),guard(`EXISTS(SELECT 1 FROM cf_recovery_notice_policy p JOIN oa_operators o ON o.id=p.approved_by WHERE p.id=1 AND p.enabled=1 AND p.version=? AND o.status='active' AND o.version=p.approver_version AND o.role IN ('owner','admin'))`,'POLICY_CHANGED','Standing recovery approval changed.',step.policy_version),
  guard(`EXISTS(SELECT 1 FROM cf_recovery_permissions WHERE donor_id=? AND enabled=1 AND version=? AND channel=?)`,'PERMISSION_CHANGED','Donor recovery permission changed.',step.donor_id,step.permission_version,step.channel),
  guard(`EXISTS(SELECT 1 FROM cf_subscriptions s JOIN cf_donors d ON d.id=s.donor_id WHERE s.id=? AND s.donor_id=? AND s.amount_cents=? AND s.status NOT IN ('unpaid','canceled','incomplete_expired') AND d.version=? AND d.erased_at IS NULL AND d.constituent_status='active' AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id))`,'PLAN_CHANGED','Plan, donor or amount changed.',step.subscription_id,step.donor_id,step.amount_cents,step.donor_version),
  guard(`(SELECT id FROM cf_consents WHERE donor_id=? AND channel=? ORDER BY id DESC LIMIT 1)=? AND (SELECT status FROM cf_consents WHERE donor_id=? AND channel=? ORDER BY id DESC LIMIT 1)='granted'`,'CONSENT_CHANGED','Current channel permission changed.',step.donor_id,step.channel,step.consent_id,step.donor_id,step.channel),
  guard(`NOT EXISTS(SELECT 1 FROM cf_recovery_closures WHERE invoice_id IN (?,?)) AND NOT (${portalStopSql})`,'RECOVERY_STOPPED','Recovery contact was stopped.',step.invoice_id,'plan:'+step.subscription_id,step.subscription_id,step.case_started_at)]
 if(step.kind==='failure')out.push(guard("EXISTS(SELECT 1 FROM cf_agent_recovery WHERE invoice_id=? AND state='waiting')",'RECOVERY_STOPPED','This failure is no longer waiting.',step.invoice_id))
 if(step.channel==='email')out.push(guard(`EXISTS(SELECT 1 FROM cf_donors d WHERE d.id=? AND d.email=? AND NOT EXISTS(SELECT 1 FROM cf_acks a WHERE a.donor_id=d.id AND a.recipient_email=d.email AND a.delivery_status IN ('bounced','complained')))`,'EMAIL_CHANGED','Email changed or is undeliverable.',step.donor_id,step.recipient_email))
 if(step.approved_by)out.push(guard("EXISTS(SELECT 1 FROM oa_operators o JOIN cf_recovery_notice_policy p ON p.approved_by=o.id AND p.approver_version=o.version WHERE o.id=? AND o.version=? AND o.status='active' AND o.role IN ('owner','admin'))",'APPROVAL_CHANGED','The notice approver no longer has authority.',step.approved_by,step.approver_version))
 else out.push(guard(`NOT EXISTS(SELECT 1 FROM cf_prospects WHERE donor_id=?) AND (SELECT COALESCE(SUM(amount_cents),0) FROM cf_monetary_contributions WHERE donor_id=?)<(SELECT major_cents FROM cf_recovery_notice_policy WHERE id=1) AND ?<(SELECT major_cents FROM cf_recovery_notice_policy WHERE id=1) AND ?=?`,'HUMAN_APPROVAL','A major donor or revised amount requires a person’s approval.',step.donor_id,step.donor_id,step.amount_cents,step.amount_cents,step.baseline_cents))
 // ISO UTC timestamps are compared at the exact elapsed-day boundary. All
 // concurrent claims for this donor serialize in the D1 write transaction.
 out.push(guard(`NOT EXISTS(SELECT 1 FROM cf_recovery_steps n WHERE (n.donor_id=? OR EXISTS(SELECT 1 FROM cf_subscriptions s WHERE s.id=n.subscription_id AND s.donor_id=?)) AND n.id<>? AND n.claim_id IS NOT NULL AND julianday(COALESCE(n.sent_at,n.claimed_at))>julianday(?)-(SELECT interval_days FROM cf_recovery_permissions WHERE donor_id=?)) AND NOT EXISTS(SELECT 1 FROM cf_agent_recovery r JOIN cf_subscriptions s ON s.id=r.subscription_id WHERE s.donor_id=? AND r.notice_state IN ('sent','sending','failed') AND COALESCE(r.notice_claim_id,'') NOT LIKE 'step:%' AND julianday(r.notice_at)>julianday(?)-(SELECT interval_days FROM cf_recovery_permissions WHERE donor_id=?)) AND NOT EXISTS(SELECT 1 FROM cf_card_expiry_notices n JOIN cf_subscriptions s ON s.id=n.subscription_id WHERE s.donor_id=? AND n.state IN ('sent','sending','failed') AND n.claim_id NOT LIKE 'step:%' AND julianday(n.checked_at)>julianday(?)-(SELECT interval_days FROM cf_recovery_permissions WHERE donor_id=?))`,'NOTICE_FREQUENCY','The donor’s minimum notice interval has not elapsed.',step.donor_id,step.donor_id,step.id,c.now,step.donor_id,step.donor_id,c.now,step.donor_id,step.donor_id,c.now,step.donor_id))
 return out
}
