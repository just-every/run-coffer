import { portalTimeline } from './giving/portal-timeline'
import { settings } from './settings'
import { date, fail, today, type Context, type Row } from './db'

export const TIMELINE_KINDS=['call','meeting','email','note','visit','gift','pledge','receipt','appeal','task','volunteering','event','portal'] as const
export function timelineFilter(url?:URL){
 const kind=url?.searchParams.get('timelineKind')??'',from=url?.searchParams.get('timelineFrom')??'',to=url?.searchParams.get('timelineTo')??''
 if(kind && !TIMELINE_KINDS.includes(kind as any))fail('INPUT','Choose a timeline activity type.',400)
 if(from)date(from,'Timeline from');if(to)date(to,'Timeline to')
 if(from&&to&&from>to)fail('INPUT','The timeline end must follow its start.',400)
 return {kind,from,to}
}
/** Current task and delivery sources augment the donor's existing history. */
export async function timelineSources(c:Context,donorId:string){
 const queries=[
  "SELECT 'meeting' AS kind,id,substr(starts_at,1,10) AS day,starts_at AS at,CASE WHEN source='calendly' THEN 'Calendly meeting' WHEN source='google' THEN 'Google Calendar meeting' ELSE 'Scheduled meeting' END AS title,starts_at||CASE WHEN cancelled_at IS NULL THEN '' ELSE ' · cancelled' END AS body FROM cf_donor_meetings WHERE donor_id=?",
  "SELECT 'receipt' AS kind,id,substr(prepared_at,1,10) AS day,prepared_at AS at,'Single letter produced' AS title,subject||' · '||status AS body FROM cf_single_letters WHERE donor_id=?",
  "SELECT 'event' AS kind,r.id,substr(r.checked_in_at,1,10) AS day,r.checked_in_at AS at,e.name AS title,'Checked in to event' AS body FROM cf_event_registrations r JOIN cf_fundraising_events e ON e.id=r.event_id WHERE r.donor_id=? AND r.checked_in_at IS NOT NULL",
  "SELECT 'appeal' AS kind,run_id AS id,substr(recorded_at,1,10) AS day,recorded_at AS at,'Deliberate solicitation inclusion' AS title,reason||' · chosen by '||actor_name AS body FROM cf_solicitation_inclusions WHERE donor_id=?",
  "SELECT 'email' AS kind,r.run_id AS id,substr(r.claimed_at,1,10) AS day,r.claimed_at AS at,'Text message' AS title,u.name||' · '||u.purpose||' · '||r.state AS body FROM cf_sms_recipients r JOIN cf_sms_runs u ON u.id=r.run_id WHERE r.donor_id=? AND r.claimed_at IS NOT NULL",
  "SELECT 'task' AS kind,id,substr(created_at,1,10) AS day,created_at AS at,'Task' AS title,reason||' · '||status||' · due '||due_on||CASE WHEN completion_notes IS NULL THEN '' ELSE ' · '||completion_notes END AS body FROM cf_call_tasks WHERE donor_id=?",
  "SELECT 'task' AS kind,t.id,substr(t.created_at,1,10) AS day,t.created_at AS at,'Repeating task' AS title,s.title||' · '||t.status||' · due '||t.due_on AS body FROM cf_recurring_tasks t JOIN cf_recurring_task_series s ON s.id=t.series_id WHERE s.donor_id=?",
  "SELECT 'task' AS kind,t.id,substr(t.created_at,1,10) AS day,t.created_at AS at,'Cultivation task' AS title,t.title||' · '||t.status||' · due '||t.due_on AS body FROM cf_cultivation_tasks t JOIN cf_prospects p ON p.id=t.prospect_id WHERE p.donor_id=?",
  "SELECT 'task' AS kind,t.id,substr(g.created_at,1,10) AS day,g.created_at AS at,'Grant reporting task' AS title,t.title||' · '||t.status||' · due '||t.due_on AS body FROM cf_grant_tasks t JOIN cf_grants g ON g.id=t.grant_id WHERE g.donor_id=?",
  "SELECT 'task' AS kind,t.id,substr(t.created_at,1,10) AS day,t.created_at AS at,'Receipt address task' AS title,CASE WHEN t.completed_at IS NULL THEN CASE WHEN EXISTS(SELECT 1 FROM cf_letter_events e WHERE e.letter_id=a.id AND e.provider='Lob' AND e.event='bounced') THEN 'Fix postal address · open' ELSE 'Fix email address · open' END ELSE 'Address task completed' END AS body FROM cf_receipt_address_tasks t JOIN cf_acks a ON a.id=t.letter_id WHERE a.donor_id=?",
  "SELECT 'receipt' AS kind,e.id,substr(e.occurred_at,1,10) AS day,e.occurred_at AS at,CASE WHEN e.event='opened' THEN 'SendGrid provider-reported open' ELSE e.provider||' receipt provider event' END AS title,CASE WHEN e.event='opened' THEN 'Provider-reported open, not proof of reading' ELSE COALESCE(e.provider_event,e.event)||' · '||e.event END AS body FROM cf_letter_events e JOIN cf_acks a ON a.id=e.letter_id WHERE a.donor_id=?",
  "SELECT 'appeal' AS kind,a.id,COALESCE(a.sent_on,substr(a.prepared_at,1,10)) AS day,a.prepared_at AS at,'Appeal' AS title,a.name||' · '||a.status AS body FROM cf_appeals a JOIN cf_appeal_recipients r ON r.appeal_id=a.id WHERE r.donor_id=? AND a.status<>'discarded'",
 ]
 const rows=await c.db.batch<Row>(queries.map(query=>c.db.prepare(query).bind(donorId)))
 const zone=(await settings(c)).timezone
 const sources=rows.flatMap(row=>row.results??[]).map(row=>row.kind==='event'||row.kind==='meeting'?{...row,day:today(zone,new Date(String(row.at)))}:row)
 return [...sources,...await portalTimeline(c,donorId)]
}
