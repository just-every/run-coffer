import { manager } from '../auth'
import { all, choice, commit, event, fail, guard, one, sha256, sql, type Context, type Row } from '../db'
import { totalsCheck } from './service'
import { kinds, snapshot, tables } from './tables'

const sources=['lgl','bloomerang','re-nxt','neon','givebutter','zeffy'] as const
const reviewSteps=['names','fields','reconciliation'] as const
export type ChecklistStep=typeof reviewSteps[number]
function authorize(c:Context) {if(!manager(c.actor))fail('manager_required','Only the owner or an admin reviews the installation checklist.',403)}
const sourceOf=(value:unknown)=>choice(value,sources,'the source CRM')

// Hash bounded pages rather than retaining every original and current record in
// Worker memory. The order comes from the stable source identity.
async function evidenceRows(c:Context,query:string,params:unknown[],visit:(rows:Row[])=>void) {
 const hashes:string[]=[]
 let after='',count=0
 while(true) {
  const rows=await all(c,query+' AND r.source_key>? ORDER BY r.source_key LIMIT 500',...params,after)
  if(!rows.length)break
  count+=rows.length;visit(rows)
  hashes.push(await sha256(JSON.stringify(rows)))
  after=rows.at(-1)!.source_key
  if(rows.length<500)break
 }
 return {count,hashes}
}


/** Historical approvals carry no authority and contain no donor text. Their
 * digest must still match the current installation before a step is complete. */
export async function installationChecklist(c:Context,source:unknown,jobId?:string) {
 authorize(c)
 const selected=sourceOf(source)
 const saved=await one(c,'SELECT * FROM cf_move_in_checklists WHERE source=?',selected)
 const job=await one(c,`SELECT * FROM cf_move_in_jobs WHERE source=? ${jobId?'AND id=?':''} ORDER BY created_at DESC,id DESC LIMIT 1`,selected,...(jobId?[jobId]:[]))
 if(jobId&&!job)fail('NOT_FOUND','That move-in does not belong to this source.',404)
 let complete=!!job&&job.state==='completed'&&!job.redacted&&job.parts>0&&job.parts===job.applied_parts
 const imports:Row[]=complete?await all(c,"SELECT id,fingerprint,state,redacted,parts,applied_parts,report FROM cf_move_in_jobs WHERE source=? AND state='completed' AND redacted=0 ORDER BY created_at,id",selected):[]
 const reports=imports.map(j=>JSON.parse(j.report))
 const active="r.source=? AND EXISTS(SELECT 1 FROM cf_move_in_jobs j WHERE j.id=r.job_id AND j.state='completed' AND j.redacted=0)"
 let records:Row={},definitions:Row[]=[],custom:Row={count:0,hashes:[]},reconciliation:Row={matches:false,rows:[]}
 const names:{original:Row|null;current:Row|null}[]=[]
 let nameCount=0,namesIntact=true,customIntact=true
 if(complete&&job) {
  // Identifiers come only from the server-owned table catalog.
  for(const kind of kinds) {
   const t=tables[kind]
   records[kind]=await evidenceRows(c,`SELECT r.kind,r.source_key,r.snapshot AS original,CASE WHEN n.${t.key} IS NULL THEN NULL ELSE ${snapshot(kind)} END AS current FROM cf_move_in_records r LEFT JOIN ${t.table} n ON n.${t.key}=r.native_id WHERE ${active} AND r.kind=?`,[selected,kind],rows=>{
    if(kind!=='donor')return
    nameCount+=rows.length
    for(const row of rows){
     if(!row.original||!row.current||JSON.parse(row.current).erased_at)namesIntact=false
     if(names.length<20)names.push({original:row.original?JSON.parse(row.original):null,current:row.current?JSON.parse(row.current):null})
    }
   })
  }
  custom=await evidenceRows(c,`SELECT r.source_key,r.snapshot AS original,v.field_key,v.record_id,v.value,v.version,v.source FROM cf_move_in_records r LEFT JOIN cf_custom_values v ON v.record_id=r.native_id AND v.field_key=json_extract(r.snapshot,'$.field_key') WHERE ${active} AND r.kind='customValue'`,[selected],rows=>{if(rows.some(v=>!v.field_key))customIntact=false})
  definitions=await all(c,`SELECT f.* FROM cf_custom_fields f WHERE f.key IN (SELECT json_extract(value,'$.key') FROM json_each(?)) ORDER BY f.key`,JSON.stringify(reports.flatMap(r=>r.customFields??[])))
  reconciliation=await totalsCheck(c,job)
 }
 if(!namesIntact){complete=false;names.length=0;definitions=[];reconciliation={matches:false,rows:[]}}
 const mappings:Row[]=complete?[...new Map(reports.flatMap(r=>r.customFields??[]).map(m=>[JSON.stringify([m.column,m.sheet,m.kind,m.key]),m])).values()]:[]
 const namesAvailable=complete&&nameCount>0&&namesIntact
 const fieldsAvailable=complete&&mappings.length>0&&!reports.some(r=>r.unmapped)&&definitions.length===new Set(mappings.map(m=>m.key)).size&&custom.count>0&&customIntact
 const fingerprint=await sha256(JSON.stringify({job:job?[job.id,job.fingerprint,job.state,job.redacted,job.parts,job.applied_parts,job.report]:null,imports,records,custom,definitions,reconciliation}))
 const same=saved?.job_id===job?.id
 const reviewed=(step:ChecklistStep)=>same&&saved?.[step+'_hash']===fingerprint
 const steps=[
  {id:'exports',done:complete,available:false,detail:complete?'Supported history import completed.':job?.redacted?'Import evidence was erased.':job?.state==='undone'?'The import was undone.':'Complete a supported reviewed import first.'},
  {id:'transfer',done:false,available:false,detail:'Unavailable: direct processor-to-Stripe vault transfer is not recorded here.'},
  {id:'payment-mapping',done:false,available:false,detail:'Unavailable: Stripe mapping-file upload and validation are unbuilt.'},
  {id:'names',done:namesAvailable&&reviewed('names'),available:namesAvailable,detail:namesAvailable?'Compare source names from the completed imports with current donor names below.':'No complete, unerased donor mapping is available.'},
  {id:'fields',done:fieldsAvailable&&reviewed('fields'),available:fieldsAvailable,detail:fieldsAvailable?'Review the supported mapped columns and current field definitions below.':'Import explicit supported field mappings and resolve every left-out value first. Full source-definition parity remains owed.'},
  {id:'reconciliation',done:complete&&reconciliation.matches&&reviewed('reconciliation'),available:complete&&reconciliation.matches,detail:complete?(reconciliation.matches?'Current supported gift and restriction controls match. Review the source inventory separately.':'Current controls differ. Inspect the journal and resolve every difference.'):'A completed import is required for a current comparison.'},
  {id:'source-stop',done:false,available:false,detail:'Unavailable: confirm each source plan is stopped before replacement charging; Coffer never cancels it.'},
  {id:'cutover',done:false,available:false,detail:'Unavailable: full owner cutover sign-off and replacement charging remain unbuilt.'},
  {id:'email',done:false,available:false,detail:'Incomplete: choose Mango or Mailchimp separately; no connection or send is established here.'},
 ]
 return {source:selected,imports:imports.map(j=>({id:j.id})),version:saved?.version??0,jobId:job?.id??null,jobState:job?.state??null,fingerprint,steps,names,nameCount,mappings,definitions,reconciliation,reviewedAt:same?saved?.reviewed_at??null:null}
}

export async function reviewChecklist(c:Context,input:Row) {
 authorize(c)
 if(!input||typeof input!=='object'||Object.keys(input).some(k=>!['source','id','step','version','fingerprint'].includes(k)))fail('CHECKLIST_INPUT','Review current installation evidence; completion flags are not accepted.',400)
 const step=choice(input.step,reviewSteps,'a supported evidence review')
 if(typeof input.id!=='string'||!input.id)fail('CHECKLIST_INPUT','Choose the import to review.',400)
 const current=await installationChecklist(c,input.source,input.id)
 if(!current.steps.find(s=>s.id===step)?.available)fail('CHECKLIST_INCOMPLETE','This step has no complete supported evidence to approve.',409)
 if(input.fingerprint!==current.fingerprint||input.version!==current.version)fail('CHECKLIST_CHANGED','Installation evidence changed. Reload and review it again.',409)
 const field=step+'_hash'
 await commit(c,[
  guard('COALESCE((SELECT version FROM cf_move_in_checklists WHERE source=?),0)=?','CHECKLIST_CHANGED','This checklist changed. Reload and review it again.',current.source,current.version),
  guard("EXISTS(SELECT 1 FROM cf_move_in_jobs WHERE id=? AND source=? AND state='completed' AND redacted=0 AND parts=applied_parts)",'CHECKLIST_CHANGED','This import is no longer complete.',input.id,current.source),
  sql(`INSERT INTO cf_move_in_checklists(source,version,job_id,${field},reviewed_at,reviewed_by) VALUES(?,1,?,?,?,?) ON CONFLICT(source) DO UPDATE SET version=cf_move_in_checklists.version+1,job_id=excluded.job_id,${reviewSteps.map(s=>{const key=s+'_hash';return key+'='+(s===step?'excluded.'+key:'CASE WHEN cf_move_in_checklists.job_id=excluded.job_id THEN cf_move_in_checklists.'+key+' ELSE NULL END')}).join(',')},reviewed_at=excluded.reviewed_at,reviewed_by=excluded.reviewed_by`,current.source,input.id,current.fingerprint,c.now,c.actor.id),
  event(c,'move-in.checklist.review','move-in',input.id,null,{source:current.source,step,evidenceHash:current.fingerprint}),
 ])
 return installationChecklist(c,current.source,input.id)
}
