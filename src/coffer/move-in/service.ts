import { manager } from '../auth'
import { all, commit, event, fail, guard, one, optional, sql, type Context, type Row, type Stmt } from '../db'
import { parseExports } from './parse'
import { contentHash, planImport, type Plan } from './plan'
import { compare } from './reconcile'
import { kinds, snapshot, tables, type Kind } from './tables'
import type { ParseInput, ParsedImport } from './types'

function authorize(c: Context) {if(!manager(c.actor))fail('manager_required','Only the owner or an admin moves records in.',403)}
export async function jobs(c: Context) {return all(c,'SELECT id,source,state,created_at FROM cf_move_in_jobs ORDER BY created_at DESC LIMIT 20')}
const summary=(p:ParsedImport)=>Object.fromEntries(['donors','households','gifts','pledges','installments','relationships','softCredits','notes'].map(k=>[k,(p as any)[k].length]))

async function prepare(c: Context,input: ParseInput) {
 authorize(c)
 if(!input || !Array.isArray(input.files) || input.files.some(f=>!f||typeof f.name!=='string'||typeof f.base64!=='string'))fail('MOVE_IN_INPUT','Supply named CSV or XLSX files and their base64 contents.',400)
 const parsed=await parseExports(input), plan=await planImport(c,parsed)
 const fileFingerprint=await contentHash({source:input.source,files:input.files.map(f=>f.base64).sort(),noGoodsOrServices:input.noGoodsOrServices===true})
 const prior=await one(c,'SELECT id,state,fingerprint FROM cf_move_in_jobs WHERE file_fingerprint=?',fileFingerprint)
 const rows=compare(parsed,plan.totals), diagnostics=[...parsed.diagnostics,...plan.diagnostics]
 const fingerprint=await contentHash({fileFingerprint,state:plan.state,rows,diagnostics})
 return {parsed,plan,fileFingerprint,prior,rows,diagnostics,fingerprint}
}

export async function preview(c: Context,input: ParseInput) {
 const p=await prepare(c,input)
 return { ...p.parsed, fingerprint:p.fingerprint, fileFingerprint:p.fileFingerprint, reconciliation:p.rows, diagnostics:p.diagnostics,
  counts:summary(p.parsed),newRecords:p.plan.effects.filter(e=>e.owned).length,matchedRecords:p.plan.effects.filter(e=>!e.owned).length,alreadyImported:p.plan.already,prior:p.prior,
  canApply:!p.diagnostics.some(d=>d.severity==='error'),needsAcceptance:p.rows.some(r=>!r.matches)||p.parsed.unmapped.length>0 }
}

export async function apply(c: Context,input: ParseInput & {fingerprint:string;acceptedReason?:string}) {
 const p=await prepare(c,input)
 if(input.fingerprint!==p.fingerprint && !(p.prior?.state==='completed' && input.fingerprint===p.prior.fingerprint))fail('MOVE_IN_CHANGED','The files or Coffer changed after preview. Preview again.',409)
 if(p.diagnostics.some(d=>d.severity==='error'))fail('MOVE_IN_ERRORS','Resolve the named rows and mapping errors before applying.',409,p.diagnostics)
 const acceptedReason=optional(input.acceptedReason,'Reason for accepting differences',2000)
 if((p.rows.some(r=>!r.matches)||p.parsed.unmapped.length) && !acceptedReason)fail('MOVE_IN_TOTALS','Resolve the differences and unmapped values, or give a reason for accepting them before applying.')
 if(p.prior?.state==='completed')return {id:p.prior.id,state:'completed',unchanged:true}
 const id=p.fileFingerprint.slice(0,40), report={counts:summary(p.parsed),reconciliation:p.rows,files:p.parsed.files,unmapped:p.parsed.unmapped.map(({value:_,...v})=>v),newRecords:p.plan.effects.filter(e=>e.owned).length,matchedRecords:p.plan.effects.filter(e=>!e.owned).length}
 const writes:Stmt[]=[...p.plan.checks]
 if(p.prior)writes.push(guard("EXISTS(SELECT 1 FROM cf_move_in_jobs WHERE id=? AND state='undone')",'MOVE_IN_CHANGED','This import changed. Refresh its journal.',id),sql("UPDATE cf_move_in_jobs SET fingerprint=?,state='completed',report=?,accepted_reason=?,created_at=?,created_by=?,undone_at=NULL,redacted=0 WHERE id=?",p.fingerprint,JSON.stringify(report),acceptedReason,c.now,c.actor.name,id))
 else writes.push(sql("INSERT INTO cf_move_in_jobs(id,file_fingerprint,fingerprint,source,state,report,accepted_reason,created_at,created_by) VALUES(?,?,?,?,'completed',?,?,?,?)",id,p.fileFingerprint,p.fingerprint,input.source,JSON.stringify(report),acceptedReason,c.now,c.actor.name))
 for(const kind of kinds)writeKind(writes,p.plan,kind,input.source,id)
 writes.push(event(c,'move-in.apply','move-in',id,null,{source:input.source,counts:summary(p.parsed),acceptedDifferences:!!acceptedReason}))
 try {await commit(c,writes)} catch(error) {
  if(/UNIQUE constraint failed: cf_move_in_jobs\.(file_fingerprint|id)/.test(String(error)) && (await one(c,"SELECT id FROM cf_move_in_jobs WHERE id=? AND state='completed'",id)))return {id,state:'completed',unchanged:true}
  throw error
 }
 return {id,state:'completed',unchanged:false}
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
 return {job:{...job,report:JSON.parse(job.report)},records:await all(c,'SELECT kind,native_id,owned FROM cf_move_in_records WHERE job_id=? ORDER BY kind,native_id',id)}
}

/** Every guard and every deletion share one transaction. Any new use blocks it. */
export async function undo(c: Context,id:string) {
 authorize(c)
 const result=await journal(c,id)
 if(result.job.state==='undone')return {id,state:'undone',unchanged:true}
 if(result.job.redacted)fail('MOVE_IN_USED','An imported donor was erased. This import can no longer be undone.')
 const writes:Stmt[]=[guard("EXISTS(SELECT 1 FROM cf_move_in_jobs WHERE id=? AND state='completed' AND redacted=0)",'MOVE_IN_CHANGED','This import changed. Refresh its journal.',id)]
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
 for(const kind of [...kinds].reverse()) {const t=tables[kind];writes.push(sql(`DELETE FROM ${t.table} WHERE ${t.key} IN (${owned(kind)})`,id))}
 writes.push(sql('DELETE FROM cf_move_in_records WHERE job_id=?',id),sql("UPDATE cf_move_in_jobs SET state='undone',undone_at=? WHERE id=?",c.now,id),event(c,'move-in.undo','move-in',id,null))
 try {await commit(c,writes)} catch(error) {
  if(/FOREIGN KEY constraint failed/i.test(String(error)))fail('MOVE_IN_USED','Other records now use this import. Nothing was undone.')
  throw error
 }
 return {id,state:'undone',unchanged:false}
}
