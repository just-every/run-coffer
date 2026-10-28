import { all, commit, fail, guard, one, sha256, sql, type Context } from '../db'
import { customCustodyWrites } from './custom-custody'
import type { SourceRecord } from './custom-review-types'

/** The full CSV index is staged in bounded rows, independently of the review JSON. */
export async function stageSourceIndex(c:Context,jobId:string,source:string,records:SourceRecord[]){
 const unique=[...new Map(records.map(r=>[JSON.stringify([r.kind,r.externalId]),r])).values()]
 await commit(c,[guard('EXISTS(SELECT 1 FROM cf_move_in_jobs WHERE id=? AND redacted=0)','MOVE_IN_CHANGED','This import was erased or changed.',jobId),sql('DELETE FROM cf_move_in_source_records WHERE job_id=?',jobId),sql("UPDATE cf_move_in_jobs SET report=json_set(json_remove(report,'$.sourceRecords'),'$.sourceIndexComplete',json('false'),'$.sourceIndexCount',?) WHERE id=?",unique.length,jobId)])
 for(let start=0;start<unique.length;start+=250){
  const rows=await Promise.all(unique.slice(start,start+250).map(async r=>({...r,sourceKey:await sha256(r.externalId),donorKey:await sha256(r.donorExternalId)})))
  await commit(c,[guard('EXISTS(SELECT 1 FROM cf_move_in_jobs WHERE id=? AND redacted=0)','MOVE_IN_CHANGED','This import was erased or changed.',jobId),sql(`INSERT INTO cf_move_in_source_records(job_id,kind,external_id,donor_external_id,source_key,donor_key,source_object,donor_id)
   SELECT ?,json_extract(value,'$.kind'),json_extract(value,'$.externalId'),json_extract(value,'$.donorExternalId'),json_extract(value,'$.sourceKey'),json_extract(value,'$.donorKey'),json_extract(value,'$.sourceObject'),
   (SELECT COALESCE(r.donor_id,r.native_id) FROM cf_move_in_records r WHERE r.source=? AND r.kind='donor' AND r.source_key=json_extract(value,'$.donorKey')) FROM json_each(?)`,jobId,source,JSON.stringify(rows))])
 }
 await commit(c,[sql("UPDATE cf_move_in_jobs SET report=json_set(report,'$.sourceIndexComplete',json('true')) WHERE id=? AND redacted=0",jobId),
  sql("UPDATE cf_move_in_jobs SET report='{}',redacted=1,accepted_reason=NULL,check_report=NULL WHERE id=? AND EXISTS(SELECT 1 FROM cf_move_in_source_records i JOIN cf_move_in_records r ON r.source=? AND r.kind='donor' AND r.source_key=i.donor_key WHERE i.job_id=? AND r.snapshot IS NULL)",jobId,source,jobId),
  sql('DELETE FROM cf_move_in_source_records WHERE job_id=? AND EXISTS(SELECT 1 FROM cf_move_in_jobs WHERE id=? AND redacted=1)',jobId,jobId)])
 const job=await one(c,'SELECT redacted FROM cf_move_in_jobs WHERE id=?',jobId)
 if(!job?.redacted)await commit(c,await customCustodyWrites(c,jobId,source,{partial:true}))
}
export async function readSourceIndex(c:Context,jobId:string):Promise<SourceRecord[]>{
 const job=await one(c,'SELECT report,redacted FROM cf_move_in_jobs WHERE id=?',jobId),report=job?JSON.parse(job.report):{}
 if(!job||job.redacted||report.sourceIndexComplete!==true)fail('CUSTOM_SOURCE','Re-upload the original exports to complete this source index.',409)
 if(report.sourceIndexCount>10000)fail('CUSTOM_SOURCE_LIMIT','Custom enrichment supports up to 10,000 source records per review. The imported records remain unchanged.',413)
 const rows=await all(c,'SELECT kind,external_id AS externalId,donor_external_id AS donorExternalId,source_object AS sourceObject FROM cf_move_in_source_records WHERE job_id=? ORDER BY kind,external_id',jobId)
 if(rows.length!==report.sourceIndexCount)fail('MOVE_IN_CHANGED','The source index changed. Review the original exports again.',409)
 return rows.map(r=>({...r,sourceObject:r.sourceObject??undefined})) as SourceRecord[]
}
