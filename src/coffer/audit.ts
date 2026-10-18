import { all, commit, date, event, fail, one, type Context } from './db'
import { manager } from './auth'
import { csv } from './csv'

const PAGE_SIZE = 50
// Auth policy changes retain their native audit source. Session triggers retain
// sign-ins after the credential/session has expired or been removed.
const SOURCE = `SELECT 'event:'||id AS id,at,actor_id,actor_name,actor_role,action,subject_kind,subject_id,donor_id,detail FROM cf_events
 UNION ALL SELECT 'auth:'||a.id,strftime('%Y-%m-%dT%H:%M:%fZ',a.created_at/1000.0,'unixepoch'),a.actor_id,
 COALESCE(o.display_name,'Former operator'),COALESCE(o.role,'staff'),'auth.'||a.action,'identity','policy',NULL,'{}'
 FROM oa_auth_audit a LEFT JOIN oa_operators o ON o.id=a.actor_id
 UNION ALL SELECT 'mail:'||e.id,e.recorded_at,'mail-provider','Mail provider','agent','mail.'||e.event,'letter',e.letter_id,a.donor_id,'{}'
 FROM cf_letter_events e JOIN cf_acks a ON a.id=e.letter_id
 UNION ALL SELECT 'stripe:'||id,processed_at,'stripe','Stripe','agent','stripe.'||type,'provider-event',id,NULL,'{}' FROM cf_giving_events`

export function auditAccess(c: Context) {
 if (!manager(c.actor)) fail('manager_required', 'Only the owner or an admin reads the audit log.', 403)
}
function filter(url: URL) {
 const conditions: string[] = [], params: unknown[] = []
 for (const [key, column] of [['person','actor_id'],['action','action']] as const) {
  const value = url.searchParams.get(key)
  if (value) { conditions.push(`${column}=?`); params.push(value) }
 }
 const record = url.searchParams.get('record')
 if (record) { conditions.push('(subject_id=? OR donor_id=?)'); params.push(record,record) }
 for (const [key, sign] of [['from','>='],['to','<=']] as const) {
  const value = url.searchParams.get(key)
  if (value) { conditions.push(`substr(at,1,10)${sign}?`); params.push(date(value,key === 'from' ? 'From' : 'To')) }
 }
 return { where: conditions.length ? ' WHERE '+conditions.join(' AND ') : '', params }
}
export async function auditLog(c: Context, url: URL, offset?: number) {
 auditAccess(c)
 const f = filter(url), page = Math.max(0, Math.floor(Number(url.searchParams.get('page')) || 0))
 const start = offset ?? page*PAGE_SIZE
 const [rows, count] = await Promise.all([
  all(c,`SELECT * FROM (${SOURCE})${f.where} ORDER BY at DESC,id DESC LIMIT ? OFFSET ?`,...f.params,PAGE_SIZE,start),
  one(c,`SELECT count(*) AS total FROM (${SOURCE})${f.where}`,...f.params),
 ])
 return { rows, total: Number(count?.total ?? 0), page, more: start+rows.length < Number(count?.total ?? 0) }
}
export async function auditChoices(c: Context) {
 auditAccess(c)
 return {
  people: await all(c,`SELECT actor_id AS id,max(actor_name) AS name FROM (${SOURCE}) GROUP BY actor_id ORDER BY lower(name)`),
  actions: await all(c,`SELECT DISTINCT action FROM (${SOURCE}) ORDER BY action`),
 }
}
export async function auditCsv(c: Context, url: URL) {
 auditAccess(c)
 const f = filter(url)
 // One read snapshot, so a new event cannot move rows between export pages.
 const rows = await all(c,`SELECT * FROM (${SOURCE})${f.where} ORDER BY at DESC,id DESC`,...f.params)
 return csv(['Event ID','Time (UTC)','Person ID','Person','Role','Action','Record type','Record ID','Donor ID','Details'],
  rows.map(r=>[r.id,r.at,r.actor_id,r.actor_name,r.actor_role,r.action,r.subject_kind,r.subject_id,r.donor_id,r.detail]))
}

/** Record public-door actions that do not already have a domain transaction:
 * downloads, portability jobs, import jobs and agent reads. No body, query,
 * credential or contact details enter these rows. */
export async function recordRequest(c: Context, request: Request, response: Response) {
 if (response.status >= 400 || request.method === 'HEAD') return
 const path = new URL(request.url).pathname
 const exported = response.headers.has('content-disposition')
 if (!exported && request.method === 'GET' && c.actor.role !== 'agent') return
 await commit(c,[event(c,exported ? 'export.download' : c.actor.role === 'agent' && request.method === 'GET' ? 'agent.read' : 'request.change',
  'route',path,null,{method:request.method,status:response.status})])
}
