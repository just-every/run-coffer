import { one, guard, sql, type Context, type Row, type Stmt } from './db'
import { erasureHash } from './imports/snapshots'

export function auctionMergeStatements(source:string,target:string):Stmt[]{
 return [sql(`UPDATE cf_auction_jobs SET version=version+1 WHERE id IN(SELECT job_id FROM cf_auction_rows WHERE donor_id IN (?,?))`,source,target),
  sql(`UPDATE cf_auction_rows SET donor_id=CASE WHEN donor_id=? THEN ? ELSE donor_id END,version=version+1,
   decision=CASE WHEN status='preview' THEN 'unreviewed' ELSE decision END,
   donor_version=CASE WHEN status='preview' THEN NULL ELSE donor_version END
   WHERE donor_id IN (?,?)`,source,target,source,target)]
}

/** Read source identities while the donor still exists. The exact read is
 * fenced in the erasure transaction before any source artifact is redacted. */
export async function auctionErasureStatements(c:Context,donorId:string,placeholder:string):Promise<Stmt[]>{
 const contacts=`SELECT lower(value) FROM cf_contact_points WHERE donor_id=? AND kind='email'
  UNION SELECT lower(email) FROM cf_donors WHERE id=? AND email IS NOT NULL`
 const own=`r.donor_id=? OR r.planned_donor_id=? OR lower(r.bidder_email) IN (${contacts})`
 const candidate=`EXISTS(SELECT 1 FROM json_each(r.candidates) candidate WHERE json_extract(candidate.value,'$.id')=? OR lower(json_extract(candidate.value,'$.email')) IN (${contacts}))`
 const ownParams=[donorId,donorId,donorId,donorId],candidateParams=[donorId,donorId,donorId]
 const selection=`SELECT r.id,r.job_id,r.version,r.bidder_key,r.bidder_email,r.candidates,CASE WHEN (${own}) THEN 1 ELSE 0 END AS selected
  FROM cf_auction_rows r WHERE (${own}) OR ${candidate} ORDER BY r.id`
 const params=[...ownParams,...ownParams,...candidateParams]
 const snapshot=`SELECT json_group_array(json_object('id',id,'jobId',job_id,'version',version,'bidderKey',bidder_key,'email',bidder_email,'candidates',json(candidates),'selected',selected)) AS value FROM (${selection})`
 const value=(await one(c,snapshot,...params))!.value as string,rows=JSON.parse(value) as Row[]
 const affectedJobs=JSON.stringify([...new Set(rows.map(r=>r.jobId))])
 const selected=rows.filter(r=>r.selected),rowIds=JSON.stringify(selected.map(r=>r.id)),jobs=JSON.stringify([...new Set(selected.map(r=>r.jobId))])
 const hashes=[...new Set(selected.flatMap(r=>[erasureHash('auction:'+r.bidderKey),...(r.email?[erasureHash(r.email)]:[])]))]
 return [guard(`(${snapshot.replace(' AS value','')})=?`,'AUCTION_CHANGED','Auction sources changed during erasure. Refresh before erasing.',...params,value),
  sql(`UPDATE cf_donor_merge_journal SET status='erased',erased_at=? WHERE id IN(SELECT merge_id FROM cf_donor_merge_rows WHERE table_name='cf_auction_jobs' AND json_extract(value,'$.id') IN(SELECT value FROM json_each(?)))`,c.now,affectedJobs),
  sql("DELETE FROM cf_donor_merge_rows WHERE merge_id IN(SELECT id FROM cf_donor_merge_journal WHERE status='erased')"),
  ...hashes.map(hash=>sql('INSERT OR IGNORE INTO cf_erasures(hash,erased_at) VALUES(?,?)',hash,c.now)),
  sql("UPDATE cf_auction_jobs SET source_csv=NULL,state='redacted',version=version+1 WHERE id IN(SELECT value FROM json_each(?))",jobs),
  sql('DELETE FROM cf_auction_donors WHERE donor_id=? OR job_id IN(SELECT value FROM json_each(?))',donorId,jobs),
  sql(`UPDATE cf_auction_rows SET donor_id=CASE WHEN donor_id=? THEN ? ELSE donor_id END,
   donor_version=NULL,planned_donor_id=NULL,bidder_key='erased:'||id,bidder_name=NULL,bidder_email=NULL,
   lot='Erased lot '||position,item=NULL,candidates='[]',match_reason=NULL,gift_snapshot=NULL,property_snapshot=NULL,version=version+1
   WHERE id IN(SELECT value FROM json_each(?))`,donorId,placeholder,rowIds),
  ...rows.filter(r=>!r.selected).flatMap(r=>[
   sql(`UPDATE cf_auction_rows SET candidates=?,version=version+1,
    decision=CASE WHEN status='preview' THEN 'unreviewed' ELSE decision END WHERE id=?`,
    JSON.stringify(r.candidates.filter((candidate:Row)=>candidate.id!==donorId)),r.id),
   sql('UPDATE cf_auction_jobs SET version=version+1 WHERE id=?',r.jobId),
  ])]
}
