import { manager } from '../auth'
import { all, commit, date, event, fail, guard, id, integer, newId, one, sql, text, today, type Context, type Row } from '../db'
import { amount } from '../money'
import { settings } from '../settings'
import { noticeChecks } from './recovery-notices-rules'

export async function recoveryNoticeState(c:Context) {
 if(!manager(c.actor))fail('FORBIDDEN','Only an owner or admin reads recovery notice permissions.',403)
 return {policy:await one(c,'SELECT * FROM cf_recovery_notice_policy WHERE id=1'),permissions:await all(c,'SELECT p.*,d.name AS donor_name FROM cf_recovery_permissions p JOIN cf_donors d ON d.id=p.donor_id WHERE d.erased_at IS NULL ORDER BY d.name'),steps:await all(c,`SELECT n.*,d.name AS donor_name FROM cf_recovery_steps n JOIN cf_donors d ON d.id=n.donor_id WHERE d.erased_at IS NULL ORDER BY n.created_at DESC,n.ordinal DESC LIMIT 200`),donors:await all(c,'SELECT id,name FROM cf_donors WHERE erased_at IS NULL ORDER BY name')}
}
export async function recoveryNoticeAction(c:Context,p:Row) {
 if(!manager(c.actor))fail('FORBIDDEN','Only an owner or admin approves recovery notices.',403)
 const action=String(p.action)
 if(action==='policy') {
  const version=integer(Number(p.version),'Version',1),major=amount(p,'majorAmount','Major-donor review threshold'),operator=await one(c,'SELECT version FROM oa_operators WHERE id=?',c.actor.id),enabled=p.enabled==='yes'||p.enabled===true
  if(enabled&&p.developmentLead!==true&&p.developmentLead!=='yes')fail('DEVELOPMENT_LEAD','The standing approver must explicitly accept named development-lead responsibility.',400)
  if(enabled&&p.standingApproval!==true&&p.standingApproval!=='yes')fail('STANDING_APPROVAL','Explicitly approve standard recovery notices before enabling this policy.',400)
  await commit(c,[guard('EXISTS(SELECT 1 FROM cf_recovery_notice_policy WHERE id=1 AND version=?)','VERSION','Notice policy changed. Refresh.',version),sql('UPDATE cf_recovery_notice_policy SET version=version+1,enabled=?,major_cents=?,approved_by=?,approver_version=?,approved_at=? WHERE id=1',enabled?1:0,major,c.actor.id,operator!.version,c.now),event(c,'recovery.standingApproval','recovery_policy','1',null,{version:version+1,majorCents:major,enabled})])
  return {version:version+1}
 }
 if(action==='permission') {
  const donor=id(p.donorId,'Donor'),version=integer(Number(p.version??0),'Version',0),channel=String(p.channel),days=integer(Number(p.intervalDays),'Minimum days between notices',1,365),max=integer(Number(p.maxNotices),'Maximum notices per failure',1,12),on=date(p.sourceOn,'Permission date'),evidence=text(p.evidence,'Evidence of donor recovery-contact permission',1000)
  if(!['email','mail','phone'].includes(channel))fail('INPUT','Choose email, mail or phone.',400)
  if(on>today((await settings(c)).timezone,new Date(c.now)))fail('INPUT','Permission cannot be future dated.',400)
  await commit(c,[guard('EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND erased_at IS NULL)','NOT_FOUND','Choose a current donor.',donor),guard('COALESCE((SELECT version FROM cf_recovery_permissions WHERE donor_id=?),0)=?','VERSION','Permission changed. Refresh.',donor,version),sql('INSERT INTO cf_recovery_permissions VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(donor_id) DO UPDATE SET version=excluded.version,enabled=excluded.enabled,channel=excluded.channel,interval_days=excluded.interval_days,max_notices=excluded.max_notices,source_on=excluded.source_on,evidence=excluded.evidence,recorded_by=excluded.recorded_by,recorded_at=excluded.recorded_at',donor,version+1,p.enabled==='yes'||p.enabled===true?1:0,channel,days,max,on,evidence,c.actor.id,c.now),event(c,'recovery.permission','donor',donor,donor,{version:version+1,channel,intervalDays:days,maxNotices:max,enabled:p.enabled==='yes'||p.enabled===true})])
  return {donorId:donor,version:version+1}
 }
 const stepId=id(p.stepId,'Notice'),step=await one(c,'SELECT * FROM cf_recovery_steps WHERE id=?',stepId)
 if(!step)fail('NOT_FOUND','That notice does not exist.',404)
 if(action==='close') {
  const reason=text(p.reason,'Reason for closing recovery contact',1000)
  await commit(c,[sql('INSERT OR IGNORE INTO cf_recovery_closures VALUES(?,?,?,?)','plan:'+step.subscription_id,c.now,reason,c.actor.id),sql('INSERT OR IGNORE INTO cf_recovery_closures VALUES(?,?,?,?)',step.invoice_id,c.now,reason,c.actor.id),sql("UPDATE cf_recovery_steps SET state='closed',reason=?,version=version+1 WHERE subscription_id=? AND state IN ('prepared','held','awaiting_approval')",reason,step.subscription_id),event(c,'recovery.closed','recovery_step',stepId,step.donor_id,{reason})])
  return {closed:step.invoice_id}
 }
 if(!['approve','complete'].includes(action))fail('INPUT','Choose a notice action.',400)
 const version=integer(Number(p.version),'Version',1),operator=await one(c,'SELECT version FROM oa_operators WHERE id=?',c.actor.id)
 const current=guard("EXISTS(SELECT 1 FROM cf_recovery_steps WHERE id=? AND version=? AND state IN ('prepared','held','awaiting_approval') AND claim_id IS NULL)",'VERSION','This notice changed or was already claimed.',stepId,version)
 if(action==='approve') {
  const policy=await one(c,'SELECT approved_by,approver_version FROM cf_recovery_notice_policy WHERE id=1')
  if(policy?.approved_by!==c.actor.id||policy.approver_version!==operator!.version)fail('FORBIDDEN','The currently designated development lead must approve this notice.',403)
  await commit(c,[current,...noticeChecks(c,{...step,approved_by:c.actor.id,approver_version:operator!.version}),sql("UPDATE cf_recovery_steps SET approved_by=?,approver_version=?,approved_at=?,state='prepared',reason=NULL,version=version+1 WHERE id=?",c.actor.id,operator!.version,c.now,stepId),event(c,'recovery.noticeApproved','recovery_step',stepId,step.donor_id,{amountCents:step.amount_cents,contentHash:step.content_hash,version:version+1})])
  return {id:stepId,version:version+1}
 }
 if(step.channel==='email')fail('INPUT','Email delivery is recorded by the real sending flow; use Check Stripe now.',400)
 const evidence=text(p.evidence,'Evidence of the completed contact',1000)
 await commit(c,[current,...noticeChecks(c,step),guard('(SELECT max_notices FROM cf_recovery_permissions WHERE donor_id=?)>=?','NOTICE_LIMIT','The donor’s maximum notices have been reached.',step.donor_id,step.ordinal),sql("UPDATE cf_recovery_steps SET state='completed',sent_at=?,claimed_at=?,claim_id=?,completion_evidence=?,version=version+1 WHERE id=?",c.now,c.now,'manual:'+newId(),evidence,stepId),event(c,'recovery.noticeCompleted','recovery_step',stepId,step.donor_id,{channel:step.channel,contentHash:step.content_hash,evidence})])
 return {id:stepId,version:version+1}
}
