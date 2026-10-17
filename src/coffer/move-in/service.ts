import { manager } from '../auth'
import { all, commit, date, event, fail, guard, one, optional, sha256, sql, type Context, type Row, type Stmt } from '../db'
import { parseExports } from './parse'
import { contentHash, planImport, type Plan } from './plan'
import { compare } from './reconcile'
import { stageParts } from './stage'
import { accumulate, emptyTotals } from './source-totals'
import { kinds, snapshot, tables, type Kind } from './tables'
import type { ParseInput, ParsedImport } from './types'

const APPLY_BUDGET_MS = 20_000
function authorize(c: Context) {if(!manager(c.actor))fail('manager_required','Only the owner or an admin moves records in.',403)}
export async function jobs(c: Context) {return all(c,'SELECT id,source,state,parts,applied_parts,created_at FROM cf_move_in_jobs ORDER BY created_at DESC LIMIT 20')}
const summary=(p:ParsedImport)=>Object.fromEntries(['donors','households','gifts','pledges','installments','relationships','softCredits','notes'].map(k=>[k,(p as any)[k].length]))

/** Coffer keeps one primary email per donor; two source records sharing one would merge silently across parts. */
function sharedEmails(parsed: ParsedImport) {
 const owner=new Map<string,string>()
 for(const d of parsed.donors){
  if(!d.email)continue
  const first=owner.get(d.email)
  if(first && first!==d.externalId)parsed.diagnostics.push({...d.location,severity:'error',code:'SHARED_EMAIL',message:`Constituents ${first} and ${d.externalId} have the same email ${d.email}. Coffer keeps one email per donor: clear it on one of them in your CRM (or delete that column value in the file) and upload again.`})
  else owner.set(d.email,d.externalId)
 }
}

/** Reads and checks the whole export, then stages it in parts. Donor records do not change. */
export async function preview(c: Context,input: ParseInput) {
 authorize(c)
 if(!input || !Array.isArray(input.files) || input.files.some(f=>!f||typeof f.name!=='string'||typeof f.base64!=='string'))fail('MOVE_IN_INPUT','Supply named CSV or XLSX files and their base64 contents.',400)
 const parsed=await parseExports(input)
 sharedEmails(parsed)
 const fileFingerprint=await contentHash({source:input.source,files:input.files.map(f=>f.base64).sort(),noGoodsOrServices:input.noGoodsOrServices===true})
 const id=fileFingerprint.slice(0,40), rows=compare(parsed), diagnostics=parsed.diagnostics
 const fingerprint=await contentHash({fileFingerprint,rows,diagnostics})
 const prior=await one(c,'SELECT id,state,fingerprint,parts,applied_parts FROM cf_move_in_jobs WHERE file_fingerprint=?',fileFingerprint)
 const canApply=!diagnostics.some(d=>d.severity==='error'), needsAcceptance=rows.some(r=>!r.matches)||parsed.unmapped.length>0
 const parts=canApply?stageParts(parsed):[]
 if(canApply && (!prior || ['reviewed','undone'].includes(prior.state))) {
  const report={counts:summary(parsed),reconciliation:rows,files:parsed.files,unmapped:parsed.unmapped.length,needsAcceptance,sourceTotals:parsed.sourceTotals,controlTotals:parsed.controlTotals,warnings:diagnostics.filter(d=>d.severity==='warning').slice(0,200)}
  await commit(c,[
   ...(prior?[guard("EXISTS(SELECT 1 FROM cf_move_in_jobs WHERE id=? AND state IN ('reviewed','undone'))",'MOVE_IN_CHANGED','This move-in started in another window. Open its journal.',id),
    sql('DELETE FROM cf_move_in_parts WHERE job_id=?',id),
    sql("UPDATE cf_move_in_jobs SET fingerprint=?,state='reviewed',report=?,accepted_reason=NULL,created_at=?,created_by=?,undone_at=NULL,redacted=0,parts=?,applied_parts=0,acknowledged_before=NULL,checked_at=NULL,check_report=NULL WHERE id=?",fingerprint,JSON.stringify(report),c.now,c.actor.name,parts.length,id)]
   :[sql("INSERT INTO cf_move_in_jobs(id,file_fingerprint,fingerprint,source,state,report,created_at,created_by,parts,applied_parts) VALUES(?,?,?,?,'reviewed',?,?,?,?,0)",id,fileFingerprint,fingerprint,input.source,JSON.stringify(report),c.now,c.actor.name,parts.length)]),
   ...parts.map((part,position)=>sql('INSERT INTO cf_move_in_parts(job_id,position,payload) VALUES(?,?,?)',id,position,JSON.stringify(part)))])
 }
 return { ...parsed, id, fingerprint, fileFingerprint, reconciliation:rows, diagnostics, counts:summary(parsed), parts:parts.length,
  prior:prior?.state==='completed'||prior?.state==='applying'?prior:null, canApply, needsAcceptance }
}

/** Approves the staged review and applies its first parts. */
export async function apply(c: Context,input:{id:string;fingerprint:string;acceptedReason?:string;acknowledged?:string;acknowledgedBefore?:string}) {
 authorize(c)
 const job=await one(c,'SELECT * FROM cf_move_in_jobs WHERE id=?',String(input.id??''))
 if(!job)fail('MOVE_IN_CHANGED','Upload the exports and review them again.',409)
 if(job.state==='completed')return {id:job.id,state:'completed',unchanged:true,parts:job.parts,appliedParts:job.applied_parts}
 if(job.state==='applying')return continueApply(c,job.id)
 if(job.state!=='reviewed' || input.fingerprint!==job.fingerprint)fail('MOVE_IN_CHANGED','The files changed after review. Upload them and review again.',409)
 const report=JSON.parse(job.report), acceptedReason=optional(input.acceptedReason,'Reason for accepting differences',2000)
 if(report.needsAcceptance && !acceptedReason)fail('MOVE_IN_TOTALS','Say why the differences or unused columns are acceptable before moving in, or fix the files and upload again.')
 const acknowledgedBefore=input.acknowledged==='no'?null:date(input.acknowledgedBefore||c.now.slice(0,10),'Thanked before')
 await commit(c,[guard("EXISTS(SELECT 1 FROM cf_move_in_jobs WHERE id=? AND state='reviewed' AND fingerprint=?)",'MOVE_IN_CHANGED','This move-in changed. Review it again.',job.id,job.fingerprint),
  sql("UPDATE cf_move_in_jobs SET state='applying',accepted_reason=?,acknowledged_before=?,created_at=?,created_by=? WHERE id=?",acceptedReason,acknowledgedBefore,c.now,c.actor.name,job.id),
  event(c,'move-in.apply','move-in',job.id,null,{source:job.source,counts:report.counts,parts:job.parts,acceptedDifferences:!!acceptedReason,acknowledgedBefore})])
 return continueApply(c,job.id)
}

/** Applies parts in order until the time budget runs out. Safe to repeat: each part applies once. */
export async function continueApply(c: Context,id:string) {
 authorize(c)
 const started=Date.now()
 for(;;) {
  const job=await one(c,'SELECT * FROM cf_move_in_jobs WHERE id=?',id)
  if(!job)fail('NOT_FOUND','That move-in does not exist.',404)
  if(job.state!=='applying')return {id,state:job.state,parts:job.parts,appliedParts:job.applied_parts,unchanged:true}
  const next=await one(c,'SELECT position,payload FROM cf_move_in_parts WHERE job_id=? AND applied_at IS NULL ORDER BY position LIMIT 1',id)
  if(!next){await finish(c,job);return {id,state:'completed',parts:job.parts,appliedParts:job.parts,unchanged:false}}
  if(Date.now()-started>APPLY_BUDGET_MS)return {id,state:'applying',parts:job.parts,appliedParts:job.applied_parts,unchanged:false}
  const part=JSON.parse(next.payload) as ParsedImport, plan=await planImport(c,part)
  if(plan.diagnostics.length)fail('MOVE_IN_ERRORS',`Part ${next.position+1} of ${job.parts} could not be applied: ${plan.diagnostics[0].message} Parts already applied stay; fix the record in Coffer, then press Continue, or undo the whole move-in.`,409,plan.diagnostics.slice(0,20))
  const writes:Stmt[]=[...plan.checks,guard('EXISTS(SELECT 1 FROM cf_move_in_parts WHERE job_id=? AND position=? AND applied_at IS NULL)','MOVE_IN_CHANGED','This part was applied in another window. Refresh the journal.',id,next.position)]
  for(const kind of kinds)writeKind(writes,plan,kind,job.source,id)
  if(job.acknowledged_before)writes.push(sql(`INSERT OR IGNORE INTO cf_prior_acknowledgements(gift_id,job_id,acknowledged_before) SELECT json_extract(value,'$.id'),?,? FROM json_each(?) WHERE json_extract(value,'$.received_on')<?`,id,job.acknowledged_before,JSON.stringify(plan.effects.filter(e=>e.kind==='gift'&&e.owned).map(e=>({id:e.nativeId,received_on:e.row.received_on}))),job.acknowledged_before))
  writes.push(sql('UPDATE cf_move_in_parts SET applied_at=? WHERE job_id=? AND position=?',c.now,id,next.position),sql('UPDATE cf_move_in_jobs SET applied_parts=applied_parts+1 WHERE id=?',id))
  await commit(c,writes)
 }
}

async function finish(c: Context,job: Row) {
 const check=await totalsCheck(c,job)
 await commit(c,[sql("UPDATE cf_move_in_jobs SET state='completed',checked_at=?,check_report=? WHERE id=? AND state='applying'",c.now,JSON.stringify(check),job.id),sql('DELETE FROM cf_move_in_parts WHERE job_id=?',job.id),
  event(c,'move-in.complete','move-in',job.id,null,{parts:job.parts,totalsMatch:check.matches})])
}
/** Source totals from the files against the gifts now in Coffer for this move-in. */
async function totalsCheck(c: Context,job: Row) {
 const report=JSON.parse(job.report)
 if(!report.sourceTotals)return {matches:false,rows:[]}
 const donorKeys=await all(c,"SELECT source_key,native_id FROM cf_move_in_records WHERE job_id=? AND kind='donor'",job.id)
 const byNative=new Map(donorKeys.map(r=>[r.native_id,r.source_key])), external=new Map<string,string>()
 for(const id of Object.keys(report.sourceTotals.byDonor))external.set(await sha256(id),id)
 const destination=emptyTotals()
 for(const g of await all(c,"SELECT g.received_on,g.fund,g.donor_id,b.net_cents FROM cf_move_in_records r JOIN cf_gifts g ON g.id=r.native_id JOIN cf_gift_balances b ON b.id=g.id WHERE r.job_id=? AND r.kind='gift'",job.id))
  if(g.net_cents>0)accumulate(destination,g.net_cents,g.received_on,g.fund??'',external.get(byNative.get(g.donor_id)??'')??g.donor_id)
 const rows=compare({sourceTotals:report.sourceTotals,controlTotals:report.controlTotals??[]} as ParsedImport,destination)
 return {matches:rows.every(r=>r.matches),rows}
}
export async function recheck(c: Context,id:string) {
 authorize(c)
 const job=await one(c,"SELECT * FROM cf_move_in_jobs WHERE id=? AND state='completed'",id)
 if(!job)fail('NOT_FOUND','Only a finished move-in can be checked.',404)
 const check=await totalsCheck(c,job)
 await c.db.prepare('UPDATE cf_move_in_jobs SET checked_at=?,check_report=? WHERE id=?').bind(c.now,JSON.stringify(check),id).run()
 return {id,...check}
}

function writeKind(writes:Stmt[],plan:Plan,kind:Kind,source:string,jobId:string) {
 const effects=plan.effects.filter(e=>e.kind===kind);if(!effects.length)return
 const t=tables[kind], rows=JSON.stringify(effects.map(e=>({...e.row,_owned:e.owned?1:0})))
 writes.push(sql(`INSERT INTO ${t.table}(${t.columns.join(',')}) SELECT ${t.columns.map(k=>`json_extract(value,'$.${k}')`).join(',')} FROM json_each(?) WHERE json_extract(value,'$._owned')=1`,rows))
 const records=JSON.stringify(effects.map(e=>({sourceKey:e.sourceKey,contentHash:e.contentHash,nativeId:e.nativeId,owned:e.owned?1:0,donorId:e.donorId,relatedId:e.relatedId})))
 writes.push(sql(`INSERT INTO cf_move_in_records(source,kind,source_key,native_id,content_hash,job_id,owned,donor_id,related_id,snapshot)
 SELECT ?,?,json_extract(j.value,'$.sourceKey'),n.${t.key},json_extract(j.value,'$.contentHash'),?,json_extract(j.value,'$.owned'),json_extract(j.value,'$.donorId'),json_extract(j.value,'$.relatedId'),${snapshot(kind)}
 FROM json_each(?) j JOIN ${t.table} n ON n.${t.key}=json_extract(j.value,'$.nativeId')`,source,kind,jobId,records))
}

export async function journal(c: Context,id:string):Promise<{job:Row;records:Row[]}> {
 authorize(c)
 const job=await one(c,'SELECT * FROM cf_move_in_jobs WHERE id=?',id)
 if(!job)fail('NOT_FOUND','That import does not exist.',404)
 const records=await all(c,'SELECT kind,count(*) AS n,sum(owned) AS added FROM cf_move_in_records WHERE job_id=? GROUP BY kind ORDER BY kind',id)
 return {job:{...job,report:JSON.parse(job.report),check_report:job.check_report?JSON.parse(job.check_report):null},records}
}

/** Every guard and every deletion share one transaction. Any new use blocks it. */
export async function undo(c: Context,id:string) {
 authorize(c)
 const result=await journal(c,id)
 if(result.job.state==='undone')return {id,state:'undone',unchanged:true}
 if(result.job.state==='reviewed')fail('MOVE_IN_CHANGED','Nothing from this review has been moved in yet.',409)
 if(result.job.redacted)fail('MOVE_IN_USED','An imported donor was erased. This import can no longer be undone.')
 const writes:Stmt[]=[guard("EXISTS(SELECT 1 FROM cf_move_in_jobs WHERE id=? AND state IN ('applying','completed') AND redacted=0)",'MOVE_IN_CHANGED','This import changed. Refresh its journal.',id)]
 for(const kind of kinds) {
  const t=tables[kind]
  writes.push(guard(`NOT EXISTS(SELECT 1 FROM cf_move_in_records r LEFT JOIN ${t.table} n ON n.${t.key}=r.native_id WHERE r.job_id=? AND r.kind=? AND (n.${t.key} IS NULL OR r.snapshot IS NULL OR ${snapshot(kind)}<>r.snapshot))`,'MOVE_IN_USED','Imported records changed since the move-in. Nothing was undone.',id,kind))
 }
 const owned=(kind:Kind)=>`SELECT native_id FROM cf_move_in_records WHERE job_id=? AND kind='${kind}' AND owned=1`
 const dependencies:[string,string,Kind,Kind|null,string][]=[
  ['cf_gifts','donor_id','donor','gift','id'],['cf_pledges','donor_id','donor','pledge','id'],['cf_relationships','donor_id','donor','relationship','id'],['cf_relationships','related_donor_id','donor','relationship','id'],
  ['cf_soft_credits','donor_id','donor','softCredit','id'],['cf_soft_credits','gift_id','gift','softCredit','id'],['cf_donor_notes','donor_id','donor','note','id'],['cf_interactions','donor_id','donor','interaction','id'],
  ['cf_donors','household_id','household','donor','id'],['cf_pledge_installments','pledge_id','pledge','installment','id'],['cf_pledge_allocations','installment_id','installment','allocation','id'],['cf_pledge_allocations','gift_id','gift','allocation','id'],
  ['cf_consents','donor_id','donor',null,'id'],['cf_acks','gift_id','gift',null,'id'],['cf_appeal_recipients','donor_id','donor',null,'donor_id'],['cf_gift_tributes','gift_id','gift',null,'gift_id'],['cf_employer_matches','gift_id','gift',null,'id'],['cf_gifts','reverses','gift',null,'id'],
  ['cf_prospects','donor_id','donor',null,'id'],['cf_call_tasks','donor_id','donor',null,'id'],['cf_call_tasks','interaction_id','interaction',null,'id'],
 ]
 for(const [table,fk,parent,child,key] of dependencies)writes.push(guard(`NOT EXISTS(SELECT 1 FROM ${table} WHERE ${fk} IN (${owned(parent)})${child?` AND ${key} NOT IN (${owned(child)})`:''})`,'MOVE_IN_USED','Someone has used these imported records. Nothing was undone.',id,...(child?[id]:[])))
 writes.push(sql('DELETE FROM cf_prior_acknowledgements WHERE job_id=?',id))
 for(const kind of [...kinds].reverse()) {const t=tables[kind];writes.push(sql(`DELETE FROM ${t.table} WHERE ${t.key} IN (${owned(kind)})`,id))}
 writes.push(sql('DELETE FROM cf_move_in_records WHERE job_id=?',id),sql('DELETE FROM cf_move_in_parts WHERE job_id=?',id),sql("UPDATE cf_move_in_jobs SET state='undone',undone_at=?,applied_parts=0 WHERE id=?",c.now,id),event(c,'move-in.undo','move-in',id,null))
 try {await commit(c,writes)} catch(error) {
  if(/FOREIGN KEY constraint failed/i.test(String(error)))fail('MOVE_IN_USED','Other records now use this import. Nothing was undone.')
  throw error
 }
 return {id,state:'undone',unchanged:false}
}
