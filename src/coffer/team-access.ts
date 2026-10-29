import { requireRole } from './auth'
import { all, choice, commit, event, fail, guard, id, integer, one, sql, type Context, type Row } from './db'

export async function teamAccessState(c: Context) {
 requireRole(c.actor, ['owner','admin'], 'manage team access')
 return {people: await all(c,`SELECT o.id,o.display_name AS name,o.version AS operator_version,
  COALESCE(t.read_only,0) AS read_only,COALESCE(t.version,0) AS version
  FROM oa_operators o LEFT JOIN cf_team_access t ON t.operator_id=o.id
  WHERE o.status='active' AND o.role='member' ORDER BY lower(o.display_name),o.id`)}
}

export async function teamAccessCommand(c: Context, command: string, p: Row): Promise<Row|undefined> {
 if(command!=='team.access')return
 requireRole(c.actor,['owner','admin'],'manage team access')
 if(c.actor.apiKey)fail('SESSION_REQUIRED','Use your native session to manage team access.',403)
 const operatorId=id(p.operatorId,'Member'),version=integer(Number(p.version),'Access version'),
  operatorVersion=integer(Number(p.operatorVersion),'Account version',1),
  readOnly=choice(String(p.readOnly),['0','1'],'member access')==='1'
 await commit(c,[
  guard("EXISTS(SELECT 1 FROM oa_operators WHERE id=? AND status='active' AND role='member' AND version=?)",
   'TEAM_CHANGED','Choose a current active native member.',operatorId,operatorVersion),
  guard('COALESCE((SELECT version FROM cf_team_access WHERE operator_id=?),0)=?',
   'VERSION','This access changed. Refresh before saving.',operatorId,version),
  sql(`INSERT INTO cf_team_access VALUES(?,?,?,?,?) ON CONFLICT(operator_id) DO UPDATE SET
   read_only=excluded.read_only,version=excluded.version,updated_at=excluded.updated_at,updated_by=excluded.updated_by`,
   operatorId,readOnly?1:0,version+1,c.now,c.actor.id),
  event(c,command,'team_access',operatorId,null,{readOnly,version:version+1}),
 ])
 return {operatorId,readOnly,version:version+1}
}

const live="d.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id)"
const resources={
 donors:{table:'cf_donors',columns:'r.id,r.version,r.name,r.email,r.phone,r.address_line1,r.address_line2,r.city,r.region,r.postal_code,r.country,r.constituent_status',parent:'id'},
 gifts:{table:'cf_contribution_ledger',columns:'r.id,r.donor_id,r.received_on,r.amount_cents,r.method,r.fund,r.kind,r.reverses',parent:'donor_id'},
 pledges:{table:'cf_pledges',columns:'r.id,r.donor_id,r.amount_cents,r.pledged_on,r.due_by,r.fund',parent:'donor_id'},
 tasks:{table:'cf_call_tasks',columns:'r.id,r.donor_id,r.reason,r.owner_id,r.due_on,r.status,r.version',parent:'donor_id'},
 opportunities:{table:'cf_prospects',columns:'r.id,r.donor_id,r.label,r.stage,r.owner_id,r.ask_amount_cents,r.expected_close_on,r.next_step,r.version',parent:'donor_id'},
 interactions:{table:'cf_interactions',columns:'r.id,r.donor_id,r.kind,r.occurred_on,r.who,r.notes,r.next_step',parent:'donor_id'},
} as const
export type ReadResource=keyof typeof resources
export const readOnlyRefusal=()=>fail('READ_ONLY','Your Coffer access is read-only. Ask an owner or admin to change it.',403)

/** An explicit projection: no document, confidential note, research, provider
 * identifier, export, or preparation service is invoked by a restricted read. */
export async function readOnlyRecords(c:Context,resource:string,url:URL,recordId?:string):Promise<Row> {
 if(!Object.hasOwn(resources,resource))return readOnlyRefusal()
 const def=resources[resource as ReadResource],limit=integer(Number(url.searchParams.get('limit')??50),'Limit',1,50),
  after=url.searchParams.get('after')??'',donorId=url.searchParams.get('donorId')
 const rows=await all(c,`SELECT ${def.columns},d.name AS donor_name FROM ${def.table} r
  JOIN cf_donors d ON d.id=r.${def.parent} WHERE ${live}
  AND (? IS NULL OR d.id=?) AND r.id${recordId?'=':'>'}? AND (?='' OR d.name LIKE ?)
  ORDER BY r.id LIMIT ?`,donorId,donorId,recordId??after,url.searchParams.get('q')??'','%'+(url.searchParams.get('q')??'')+'%',recordId?1:limit+1)
 if(recordId&&!rows.length)fail('NOT_FOUND','That current record is unavailable.',404)
 const result:Row=recordId?{data:rows[0]}:{data:rows.slice(0,limit),page:{next:rows.length>limit?rows[limit-1].id:null}}
 if(resource==='donors'&&recordId){
  result.timeline=await all(c,`SELECT id,kind,occurred_on,body FROM cf_donor_notes WHERE donor_id=? AND confidential=0
   UNION ALL SELECT id,kind,occurred_on,notes AS body FROM cf_interactions WHERE donor_id=? ORDER BY occurred_on DESC,id LIMIT 50`,recordId,recordId)
 }
 // Check the captured restriction and native session before disclosing reads.
 await commit(c,[event(c,'team.read',resource,recordId??'list',resource==='donors'?recordId??null:null,{},'cf_access_events')])
 return result
}

/** Every unlisted route, including GET routes with effects, fails closed. */
export async function restrictedRead(c:Context,request:Request):Promise<{resource:ReadResource;result:Row}> {
 if(request.method!=='GET')return readOnlyRefusal()
 const url=new URL(request.url),path=url.pathname
 const aliases:Record<string,ReadResource>={'/app':'donors','/app/calls':'tasks','/app/pipeline':'opportunities',
  '/api/coffer/prospects':'opportunities','/api/coffer/tasks':'tasks'}
 const match=path.match(/^\/(?:app|api\/coffer)\/(donors|gifts|pledges|tasks|opportunities)(?:\/([^/]+))?$/)
 const resource=aliases[path]??match?.[1]
 if(!resource)return readOnlyRefusal()
 const result=await readOnlyRecords(c,resource,url,match?.[2]?decodeURIComponent(match[2]):undefined)
 return {resource:resource as ReadResource,result}
}
