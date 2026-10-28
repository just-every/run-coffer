import { all, guard, sha256, sql, type Context, type Stmt } from '../db'

/** Even an unapplied review of an existing donor participates in erasure custody. */
export async function customCustodyWrites(c:Context,jobId:string,source:string,{partial=false}={}):Promise<Stmt[]>{
 const donors=await all(c,`SELECT DISTINCT COALESCE(r.donor_id,r.native_id) AS donor_id FROM cf_move_in_source_records i JOIN cf_move_in_records r ON r.source=? AND r.kind='donor' AND r.source_key=i.donor_key AND r.snapshot IS NOT NULL WHERE i.job_id=?`,source,jobId)
 const rows=await Promise.all(donors.map(async d=>({donorId:d.donor_id,key:await sha256(JSON.stringify([jobId,d.donor_id]))}))),payload=JSON.stringify(rows)
 return [
  ...(!partial?[guard(`NOT EXISTS(SELECT 1 FROM cf_move_in_source_records i LEFT JOIN cf_move_in_records r ON r.source=? AND r.kind='donor' AND r.source_key=i.donor_key AND r.snapshot IS NOT NULL WHERE i.job_id=? AND r.native_id IS NULL)`,'MOVE_IN_CHANGED','A reviewed source donor is no longer current.',source,jobId)]:[]),
  guard(`NOT EXISTS(SELECT 1 FROM json_each(?) j LEFT JOIN cf_donors d ON d.id=json_extract(j.value,'$.donorId') WHERE d.id IS NULL OR d.erased_at IS NOT NULL OR EXISTS(SELECT 1 FROM cf_donor_merges m WHERE m.donor_id=d.id))`,'MOVE_IN_CHANGED','A reviewed source donor is no longer current.',payload),
  sql(`UPDATE cf_move_in_source_records SET donor_id=(SELECT COALESCE(r.donor_id,r.native_id) FROM cf_move_in_records r WHERE r.source=? AND r.kind='donor' AND r.source_key=cf_move_in_source_records.donor_key AND r.snapshot IS NOT NULL) WHERE job_id=?`,source,jobId),
  sql(`INSERT OR IGNORE INTO cf_move_in_records(source,kind,source_key,native_id,content_hash,job_id,owned,donor_id,snapshot) SELECT ?,'customCapture',json_extract(value,'$.key'),json_extract(value,'$.donorId'),json_extract(value,'$.key'),?,0,json_extract(value,'$.donorId'),json_object('donor_id',json_extract(value,'$.donorId')) FROM json_each(?)`,source,jobId,payload),
 ]
}
