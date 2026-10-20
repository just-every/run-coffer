import { date, fail, type Context } from './db'

export const TIMELINE_KINDS=['call','meeting','email','note','visit','gift','pledge','receipt','appeal','task','volunteering'] as const
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
  "SELECT 'task' AS kind,id,substr(created_at,1,10) AS day,created_at AS at,'Call task' AS title,reason||' · '||status||' · due '||due_on AS body FROM cf_call_tasks WHERE donor_id=?",
  "SELECT 'task' AS kind,t.id,substr(t.created_at,1,10) AS day,t.created_at AS at,'Repeating task' AS title,s.title||' · '||t.status||' · due '||t.due_on AS body FROM cf_recurring_tasks t JOIN cf_recurring_task_series s ON s.id=t.series_id WHERE s.donor_id=?",
  "SELECT 'task' AS kind,t.id,substr(t.created_at,1,10) AS day,t.created_at AS at,'Cultivation task' AS title,t.title||' · '||t.status||' · due '||t.due_on AS body FROM cf_cultivation_tasks t JOIN cf_prospects p ON p.id=t.prospect_id WHERE p.donor_id=?",
  "SELECT 'task' AS kind,t.id,substr(g.created_at,1,10) AS day,g.created_at AS at,'Grant reporting task' AS title,t.title||' · '||t.status||' · due '||t.due_on AS body FROM cf_grant_tasks t JOIN cf_grants g ON g.id=t.grant_id WHERE g.donor_id=?",
  "SELECT 'task' AS kind,t.id,substr(t.created_at,1,10) AS day,t.created_at AS at,'Receipt address task' AS title,CASE WHEN t.completed_at IS NULL THEN 'Fix email address · open' ELSE 'Address task completed' END AS body FROM cf_receipt_address_tasks t JOIN cf_acks a ON a.id=t.letter_id WHERE a.donor_id=?",
  "SELECT 'receipt' AS kind,e.id,substr(e.occurred_at,1,10) AS day,e.occurred_at AS at,CASE WHEN e.event='opened' THEN 'SendGrid provider-reported open' ELSE 'Receipt provider event' END AS title,CASE WHEN e.event='opened' THEN 'Provider-reported open, not proof of reading' ELSE e.event END AS body FROM cf_letter_events e JOIN cf_acks a ON a.id=e.letter_id WHERE a.donor_id=?",
  "SELECT 'appeal' AS kind,a.id,COALESCE(a.sent_on,substr(a.prepared_at,1,10)) AS day,a.prepared_at AS at,'Appeal' AS title,a.name||' · '||a.status AS body FROM cf_appeals a JOIN cf_appeal_recipients r ON r.appeal_id=a.id WHERE r.donor_id=? AND a.status<>'discarded'",
 ]
 const rows=await c.db.batch(queries.map(query=>c.db.prepare(query).bind(donorId)))
 return rows.flatMap(row=>row.results??[])
}
