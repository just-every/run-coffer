import { requireRole } from './auth'
import { addDays, all, choice, commit, date, event, fail, guard, id, integer, longText, newId, one, sql, text, today, type Context, type Row, type Stmt } from './db'
import { donorMailUnavailable, DonorMailError, sendDonorMail } from './outbound-mail'
import { settings } from './settings'
import { businessDue } from './call-tasks'
import { usd } from './money'

const staff = (c: Context) => requireRole(c.actor, ['owner','admin'], 'manage development follow-ups')
const source = (c: Context, f: Row) => one(c,'SELECT * FROM cf_development_sources WHERE kind=? AND source_id=?',f.kind,f.source_id)
const currentSource = (s: Row) => guard('EXISTS(SELECT 1 FROM cf_development_sources WHERE kind=? AND source_id=? AND donor_id=? AND source_token=?)','SOURCE_CHANGED','The source changed. Run the agent again before saving.',s.kind,s.source_id,s.donor_id,s.source_token)
const relationshipOwner = `COALESCE((SELECT o.id FROM cf_portfolio_members m JOIN cf_portfolios p ON p.id=m.portfolio_id JOIN oa_operators o ON o.id=p.manager_id AND o.status='active' AND o.role IN ('owner','admin','member') WHERE m.donor_id=?),(SELECT id FROM oa_operators WHERE status='active' AND role='owner' ORDER BY id LIMIT 1))`
const currentFinding = (f: Row) => guard('EXISTS(SELECT 1 FROM cf_development_followups WHERE id=? AND version=?)','VERSION','This follow-up changed. Refresh before saving.',f.id,f.version)
async function finding(c: Context, p: Row) {
 const f=await one(c,'SELECT * FROM cf_development_followups WHERE id=?',id(p.id,'Follow-up'))
 if(!f)fail('NOT_FOUND','That follow-up no longer exists.',404)
 if(f.version!==integer(Number(p.version),'Follow-up version',1))fail('VERSION','This follow-up changed. Refresh before saving.')
 return f
}
function reminderBody(s: Row, organisation: string) {
 return s.kind==='report'
  ? `${s.title} for ${organisation} was due ${s.due_on}. Please record the completed report or agree a revised deadline with an owner or administrator.`
  : `Thank you for supporting ${organisation}. Your ${s.title.toLowerCase()} due ${s.due_on} has ${usd(s.amount_cents)} remaining. Please let us know about payment or contact us to discuss the existing commitment.`
}
export async function developmentFollowups(c: Context) {
 staff(c)
 const [findings,reminders,escalations]=await Promise.all([
  all(c,`SELECT f.*,d.name AS donor_name,s.title,s.settled AS source_settled,s.outstanding AS source_outstanding,
   s.amount_cents AS source_remaining_cents,s.hold,s.recipient_email AS current_recipient_email,
   legacy.status AS legacy_reminder_status,legacy.attempted_at AS legacy_reminder_attempted_at,legacy.message_id AS legacy_reminder_message_id,
   CASE WHEN f.resolution='written_off' THEN 'followup_disposition' ELSE 'native_source' END AS resolution_scope
   FROM cf_development_followups f JOIN cf_donors d ON d.id=f.donor_id LEFT JOIN cf_development_sources s ON s.kind=f.kind AND s.source_id=f.source_id
   LEFT JOIN cf_pledge_followups legacy ON f.kind='installment' AND legacy.installment_id=f.source_id AND legacy.status<>'development_managed'
   WHERE d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=d.id) ORDER BY f.resolved_at IS NOT NULL,f.due_on,f.id`),
  all(c,'SELECT * FROM cf_development_reminders ORDER BY approved_at,id'),
  all(c,"SELECT t.* FROM cf_call_tasks t WHERE t.source_kind='development' ORDER BY t.created_at,t.id"),
 ])
 return {findings,reminders,escalations}
}
export async function runDevelopmentFollowups(c: Context) {
 staff(c)
 const s=await settings(c),day=today(s.timezone,new Date(c.now))
 await commit(c,[sql("UPDATE cf_development_reminders SET status='uncertain' WHERE status='sending' AND attempted_at<=?",new Date(Date.parse(c.now)-15*60_000).toISOString())])
 const due=await all(c,'SELECT * FROM cf_development_sources WHERE due_on<? AND outstanding=1 AND active=1 ORDER BY due_on,kind,source_id',day)
 for(const row of due){
  const existing=await one(c,'SELECT * FROM cf_development_followups WHERE kind=? AND source_id=?',row.kind,row.source_id),body=reminderBody(row,s.organisation)
  if(existing?.resolution==='written_off')continue
  if(existing && await one(c,"SELECT id FROM cf_development_reminders WHERE followup_id=? AND status IN ('sending','uncertain')",existing.id))continue
  if(!existing){
   const key=newId()
   await commit(c,[currentSource(row),sql(`INSERT OR IGNORE INTO cf_development_followups(id,kind,source_id,donor_id,installment_id,report_id,match_id,source_token,due_on,amount_cents,recipient_email,body,created_at,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,key,row.kind,row.source_id,row.donor_id,row.kind==='installment'?row.source_id:null,row.kind==='report'?row.source_id:null,row.kind==='match'?row.source_id:null,row.source_token,row.due_on,row.amount_cents,row.recipient_email,body,c.now,c.now),event(c,'development.prepare','followup',key,row.donor_id,{kind:row.kind,sourceId:row.source_id})])
  }else if(existing.source_token!==row.source_token||existing.recipient_email!==row.recipient_email||existing.body!==body||existing.resolution){
   await commit(c,[currentFinding(existing),currentSource(row),sql("UPDATE cf_development_reminders SET status='invalidated' WHERE followup_id=? AND status='approved'",existing.id),
    sql(`UPDATE cf_development_followups SET version=version+1,donor_id=?,source_token=?,due_on=?,amount_cents=?,recipient_email=?,body=?,updated_at=?,reply_at=NULL,reply_note=NULL,resolution=NULL,resolution_note=NULL,resolved_at=NULL,resolved_by=NULL WHERE id=?`,row.donor_id,row.source_token,row.due_on,row.amount_cents,row.recipient_email,body,c.now,existing.id),event(c,'development.refresh','followup',existing.id,row.donor_id,{kind:row.kind})])
  }
 }
 const approved=await all(c,"SELECT r.*,f.kind,f.source_id,f.donor_id FROM cf_development_reminders r JOIN cf_development_followups f ON f.id=r.followup_id AND f.version=r.version WHERE r.status='approved' AND f.resolution IS NULL AND f.reply_at IS NULL")
 if(!donorMailUnavailable(c.env))for(const r of approved)await submit(c,r,day)
 const waiting=await all(c,`SELECT f.*,r.submitted_at,r.id AS reminder_id FROM cf_development_followups f JOIN cf_development_reminders r ON r.followup_id=f.id AND r.version=f.version
  WHERE r.status='submitted' AND f.resolution IS NULL AND f.reply_at IS NULL`)
 for(const f of waiting){
  if(businessDue(today(s.timezone,new Date(f.submitted_at)),2)>day)continue
  const native=await source(c,f)
  if(!native||!native.outstanding||!native.active||native.due_on>=day)continue
  const owner=await one(c,`SELECT ${relationshipOwner} AS id`,f.donor_id)
  if(!owner?.id)continue
  const taskId=newId()
  await commit(c,[currentFinding(f),currentSource(native),guard(`(${relationshipOwner})=?`,'OWNER_CHANGED','The relationship manager changed.',f.donor_id,owner.id),guard("EXISTS(SELECT 1 FROM cf_development_followups WHERE id=? AND reply_at IS NULL AND resolution IS NULL)",'FOLLOWUP_CHANGED','This follow-up received a reply or was resolved.',f.id),
   sql(`INSERT OR IGNORE INTO cf_call_tasks(id,donor_id,source_key,source_kind,reason,amount_cents,owner_id,due_on,created_at,is_ask,task_kind)
    VALUES(?,?,?,'development',?,?,?,?,?,0,'follow_up')`,taskId,f.donor_id,`development:${f.id}:${f.version}`,`No reply to the approved ${f.kind} reminder submitted ${f.submitted_at.slice(0,10)}. Contact the relationship manager and record the outcome.`,native.amount_cents,owner.id,day,c.now),
   sql(`INSERT INTO cf_events(at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail)
    SELECT ?,?,?,?,'development.escalate','task',id,donor_id,'{}' FROM cf_call_tasks WHERE id=?`,c.now,c.actor.id,c.actor.name,c.actor.role,taskId)])
 }
 return developmentFollowups(c)
}
function approvalPredicate() {
 return `EXISTS(SELECT 1 FROM cf_development_reminders r JOIN cf_development_followups f ON f.id=r.followup_id
  JOIN cf_development_sources s ON s.kind=f.kind AND s.source_id=f.source_id
  JOIN oa_operators o ON o.id=r.approved_by AND o.version=r.approver_version AND o.status='active' AND o.role IN ('owner','admin')
  WHERE r.id=? AND r.status=? AND r.version=f.version AND f.source_token=r.source_token AND s.source_token=r.source_token
  AND s.donor_id=f.donor_id AND s.recipient_email=r.recipient_email AND f.recipient_email=r.recipient_email AND f.body=r.body
  AND s.hold IS NULL AND s.outstanding=1 AND s.active=1 AND s.due_on<? AND f.resolution IS NULL AND f.reply_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM cf_development_reminders uncertain WHERE uncertain.followup_id=f.id AND uncertain.status='uncertain'))`
}
async function submit(c: Context,r: Row,day: string) {
 const eligible=approvalPredicate(),claim=newId()
 await commit(c,[sql(`UPDATE cf_development_reminders SET status='sending',attempted_at=?,claim_id=? WHERE id=? AND (${eligible})`,c.now,claim,r.id,r.id,'approved',day)])
 const ready=await one(c,`SELECT 1 AS ok WHERE (${eligible}) AND EXISTS(SELECT 1 FROM cf_development_reminders WHERE id=? AND claim_id=?) AND (${c.authority.sql})`,r.id,'sending',day,r.id,claim,...c.authority.params)
 if(!ready){await commit(c,[sql("UPDATE cf_development_reminders SET status='invalidated' WHERE id=? AND (status='approved' OR (status='sending' AND claim_id=?))",r.id,claim)]);return}
 let status='uncertain',messageId:string|null=null
 try{
  const result=await sendDonorMail(c.env!,{deliveryId:r.id,from:c.env!.MAIL_FROM!,to:[r.recipient_email],subject:r.kind==='report'?'Grant report follow-up':'Follow-up on your commitment',text:r.body,customArgs:{coffer_development_reminder:r.id}})
  messageId=result.providerMessageId;status=messageId?'submitted':'uncertain'
 }catch(error){if(error instanceof DonorMailError&&['rejected','rate_limited'].includes(error.outcome))status='rejected'}
 await commit(c,[sql("UPDATE cf_development_reminders SET status=?,message_id=?,submitted_at=? WHERE id=? AND status='sending'",status,messageId,status==='submitted'?c.now:null,r.id),event(c,'development.submit','followup',r.followup_id,r.donor_id,{reminderId:r.id,status})])
}
export async function approveDevelopmentReminder(c: Context,p: Row) {
 staff(c)
 const f=await finding(c,p),native=await source(c,f),note=longText(p.authorityNote,'Approval authority and purpose',2000)
 const body=longText(p.body,'Exact reminder body',8000),recipient=text(p.recipientEmail,'Exact recipient email',254)
 if(!native||native.source_token!==f.source_token||native.recipient_email!==recipient||f.recipient_email!==recipient||body!==f.body||!native.outstanding||!native.active||native.hold||f.resolution||f.reply_at)fail('APPROVAL_CHANGED','Run the agent again and approve the current eligible recipient and exact reminder.')
 const day=today((await settings(c)).timezone,new Date(c.now))
 if(native.due_on>=day)fail('NOT_OVERDUE','This source is no longer overdue.')
 const operator=await one(c,"SELECT version FROM oa_operators WHERE id=? AND status='active' AND role IN ('owner','admin')",c.actor.id)
 if(!operator)fail('FORBIDDEN','Approval requires a current owner or administrator.',403)
 const reminderId=newId()
 await commit(c,[currentFinding(f),currentSource(native),guard('EXISTS(SELECT 1 FROM cf_development_followups WHERE id=? AND resolution IS NULL AND reply_at IS NULL)','FOLLOWUP_CHANGED','This follow-up received a reply or was resolved.',f.id),guard('EXISTS(SELECT 1 FROM cf_development_sources WHERE kind=? AND source_id=? AND hold IS NULL AND active=1 AND outstanding=1 AND due_on<? AND recipient_email=?)','SOURCE_CHANGED','The source or its email permission changed.',f.kind,f.source_id,day,recipient),guard("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND version=? AND status='active' AND role IN ('owner','admin'))",'APPROVER_CHANGED','Your approval authority changed.',c.actor.id,operator.version),
  guard('NOT EXISTS(SELECT 1 FROM cf_development_reminders WHERE followup_id=? AND (version=? OR status=\'uncertain\'))','ALREADY_APPROVED','This version already has an approval or an uncertain submission. Do not retry.',f.id,f.version),
  sql(`INSERT INTO cf_development_reminders(id,followup_id,version,source_token,recipient_email,body,approved_by,approver_version,approved_at,authority_note,status)
   VALUES(?,?,?,?,?,?,?,?,?,?,'approved')`,reminderId,f.id,f.version,f.source_token,recipient,body,c.actor.id,operator.version,c.now,note),event(c,'development.approve','followup',f.id,f.donor_id,{reminderId,version:f.version})])
 return developmentFollowups(c)
}
export async function recordDevelopmentReply(c: Context,p: Row) {
 staff(c)
 const f=await finding(c,p),note=longText(p.note,'Reply evidence',4000)
 if(f.resolution)fail('RESOLVED','This follow-up is already resolved.')
 await commit(c,[currentFinding(f),guard('EXISTS(SELECT 1 FROM cf_development_followups WHERE id=? AND resolution IS NULL)','RESOLVED','This follow-up is already resolved.',f.id),sql('UPDATE cf_development_followups SET reply_at=?,reply_note=?,updated_at=? WHERE id=?',c.now,note,c.now,f.id),
  sql("UPDATE cf_development_reminders SET status='invalidated' WHERE followup_id=? AND status='approved'",f.id),event(c,'development.reply','followup',f.id,f.donor_id,{version:f.version})])
 return developmentFollowups(c)
}
export async function resolveDevelopmentFollowup(c: Context,p: Row) {
 staff(c)
 const f=await finding(c,p),native=await source(c,f),resolution=choice(p.resolution,['paid','revised','written_off'] as const,'resolution'),note=longText(p.note,'Resolution evidence and approval',4000)
 if(!native)fail('SOURCE_CHANGED','The source is no longer available.')
 if(f.resolution)fail('RESOLVED','This follow-up is already resolved.')
 const changes:Stmt[]=[currentFinding(f),currentSource(native),guard('EXISTS(SELECT 1 FROM cf_development_followups WHERE id=? AND resolution IS NULL)','RESOLVED','This follow-up is already resolved.',f.id)]
 if(resolution==='paid'&&!native.settled)fail('SOURCE_UNSETTLED','Record actual pledge payment, complete the grant report, or link the received employer gift first.')
 if(resolution==='revised'){
  const due=date(p.dueOn,'Approved revised deadline'),day=today((await settings(c)).timezone,new Date(c.now))
  if(due<=day||due===native.due_on)fail('INPUT','Choose a genuinely revised deadline after today.',400)
  if(p.approveRevision!==true&&p.approveRevision!=='1')fail('APPROVAL_REQUIRED','Explicitly approve this revised deadline.',400)
  if(f.kind==='installment')changes.push(sql('UPDATE cf_pledge_installments SET due_on=?,remind_on=? WHERE id=?',due,addDays(due,-7),f.source_id),sql('UPDATE cf_pledges SET version=version+1,due_by=(SELECT MAX(due_on) FROM cf_pledge_installments WHERE pledge_id=cf_pledges.id) WHERE id=(SELECT pledge_id FROM cf_pledge_installments WHERE id=?)',f.source_id))
  else if(f.kind==='report')changes.push(sql('UPDATE cf_grant_tasks SET due_on=?,version=version+1 WHERE id=?',due,f.source_id))
  else changes.push(sql('UPDATE cf_employer_matches SET due_by=? WHERE id=?',due,f.source_id))
 }
 changes.push(sql(`UPDATE cf_development_followups SET resolution=?,resolution_note=?,resolved_at=?,resolved_by=?,updated_at=?,
  source_token=(SELECT source_token FROM cf_development_sources WHERE kind=? AND source_id=?) WHERE id=?`,resolution,note,c.now,c.actor.id,c.now,f.kind,f.source_id,f.id),
  sql("UPDATE cf_development_reminders SET status='invalidated' WHERE followup_id=? AND status='approved'",f.id),
  sql("UPDATE cf_call_tasks SET status='done',completed_at=?,closed_reason='Development follow-up resolved',version=version+1 WHERE source_key=? AND status<>'done'",c.now,`development:${f.id}:${f.version}`),
  event(c,'development.resolve','followup',f.id,f.donor_id,{resolution,scope:resolution==='written_off'?'followup_disposition':'native_source',version:f.version}))
 await commit(c,changes)
 return developmentFollowups(c)
}
