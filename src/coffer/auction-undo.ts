import { all, commit, event, fail, guard, sql, type Context, type Row, type Stmt } from './db'
import { auctionAuthority, auctionJob, auctionRows, contactSnapshot, jobGuard, nativeSnapshot } from './auction-core'

const owned=(column:string)=>`SELECT ${column} FROM cf_auction_rows WHERE job_id=? AND ${column} IS NOT NULL`
/** Follow real foreign keys, including cascade edges. Deletion must not silently
 * remove a later staff fact merely because that fact has ON DELETE CASCADE. */
async function dependencyGuards(c:Context,jobId:string):Promise<Stmt[]>{
 const tables=(await all(c,"SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'cf_%' ORDER BY name")).map(r=>String(r.name)).filter(n=>/^cf_[a-z0-9_]+$/.test(n))
 const schemas=await c.db.batch(tables.map(t=>c.db.prepare(`PRAGMA foreign_key_list(${t})`))),writes:Stmt[]=[]
 for(const [index,schema] of schemas.entries())for(const fk of schema.results as Row[]){
  const table=tables[index],parent=String(fk.table),column=String(fk.from)
  if(!['cf_gifts','cf_donors','cf_in_kind_gifts'].includes(parent)||!/^[a-z0-9_]+$/.test(column))continue
  if(parent==='cf_gifts'&&['cf_campaign_gifts','cf_gift_appeals','cf_gift_channels'].includes(table))continue
  if(parent==='cf_donors'&&['cf_contact_points','cf_contact_history'].includes(table))continue
  const target=parent==='cf_gifts'?owned('gift_id'):parent==='cf_in_kind_gifts'?owned('property_id'):'SELECT donor_id FROM cf_auction_donors WHERE job_id=?'
  const exception=table==='cf_auction_rows'||table==='cf_auction_donors'?' AND job_id<>?':parent==='cf_donors'&&table==='cf_gifts'?` AND id NOT IN(${owned('gift_id')})`:parent==='cf_donors'&&table==='cf_in_kind_gifts'?` AND id NOT IN(${owned('property_id')})`:''
  writes.push(guard(`NOT EXISTS(SELECT 1 FROM ${table} WHERE ${column} IN(${target})${exception})`,'AUCTION_USED','Someone has used an auction record. Nothing was undone.',jobId,...(exception?[jobId]:[])))
 }
 // Annual documents reference their itemized gifts inside frozen JSON.
 writes.push(guard(`NOT EXISTS(SELECT 1 FROM cf_acks a,json_each(a.statement_gifts) g WHERE json_extract(g.value,'$.id') IN(${owned('gift_id')}))`,'AUCTION_USED','An annual statement uses an auction gift. Nothing was undone.',jobId))
 // These native bridges deliberately use polymorphic identifiers rather than
 // foreign keys; they are still a later use of the imported record.
 for(const table of ['cf_gift_recognition','cf_gift_rule_arrivals','cf_gift_rule_firings'])writes.push(guard(`NOT EXISTS(SELECT 1 FROM ${table} WHERE gift_id IN(SELECT gift_id FROM cf_auction_rows WHERE job_id=? UNION SELECT property_id FROM cf_auction_rows WHERE job_id=?))`,'AUCTION_USED','A later gift action uses an auction result. Nothing was undone.',jobId,jobId))
 for(const table of ['cf_custom_values','cf_custom_value_history'])writes.push(guard(`NOT EXISTS(SELECT 1 FROM ${table} WHERE donor_id IN(SELECT donor_id FROM cf_auction_donors WHERE job_id=?) OR record_id IN(SELECT gift_id FROM cf_auction_rows WHERE job_id=? UNION SELECT property_id FROM cf_auction_rows WHERE job_id=?))`,'AUCTION_USED','Custom information was added to an auction record. Nothing was undone.',jobId,jobId,jobId))
 writes.push(guard(`NOT EXISTS(SELECT 1 FROM cf_move_in_records WHERE donor_id IN(SELECT donor_id FROM cf_auction_donors WHERE job_id=?) OR related_id IN(SELECT donor_id FROM cf_auction_donors WHERE job_id=?) OR native_id IN(SELECT gift_id FROM cf_auction_rows WHERE job_id=? UNION SELECT property_id FROM cf_auction_rows WHERE job_id=?))`,'AUCTION_USED','A later move-in uses an auction record. Nothing was undone.',jobId,jobId,jobId,jobId),
  guard(`NOT EXISTS(SELECT 1 FROM cf_import_revisions WHERE id IN(SELECT donor_id FROM cf_auction_donors WHERE job_id=? UNION SELECT gift_id FROM cf_auction_rows WHERE job_id=? UNION SELECT property_id FROM cf_auction_rows WHERE job_id=?))`,'AUCTION_USED','An import uses an auction record. Nothing was undone.',jobId,jobId,jobId))
 return writes
}

export async function undoAuction(c:Context,p:Row){
 auctionAuthority(c)
 const job=await auctionJob(c,p.jobId),rows=await auctionRows(c,job.id)
 if(job.state==='undone')return {eventId:job.event_id,jobId:job.id,unchanged:true}
 if(job.state!=='applied')fail('AUCTION_USED','Only an applied, unredacted auction import can be undone.')
 if(rows.some(r=>r.version!==r.applied_version))fail('AUCTION_USED','An auction result was reviewed or settled after import. Nothing was undone.')
 const gift=await nativeSnapshot(c,'cf_gifts'),property=await nativeSnapshot(c,'cf_in_kind_gifts'),donor=await nativeSnapshot(c,'cf_donors','d'),contacts=await contactSnapshot(c)
 const writes:Stmt[]=[jobGuard(job),guard('NOT EXISTS(SELECT 1 FROM cf_auction_rows WHERE job_id=? AND version<>applied_version)','AUCTION_USED','An auction result changed. Nothing was undone.',job.id),
  guard(`NOT EXISTS(SELECT 1 FROM cf_auction_rows r LEFT JOIN cf_gifts n ON n.id=r.gift_id WHERE r.job_id=? AND r.gift_id IS NOT NULL AND (n.id IS NULL OR r.gift_snapshot IS NULL OR ${gift}<>r.gift_snapshot))`,'AUCTION_USED','An auction gift changed. Nothing was undone.',job.id),
  guard(`NOT EXISTS(SELECT 1 FROM cf_auction_rows r LEFT JOIN cf_in_kind_gifts n ON n.id=r.property_id WHERE r.job_id=? AND r.property_id IS NOT NULL AND (n.id IS NULL OR r.property_snapshot IS NULL OR ${property}<>r.property_snapshot))`,'AUCTION_USED','Donated auction property changed. Nothing was undone.',job.id),
  guard(`NOT EXISTS(SELECT 1 FROM cf_auction_donors r LEFT JOIN cf_donors d ON d.id=r.donor_id WHERE r.job_id=? AND (d.id IS NULL OR ${donor}<>r.snapshot OR ${contacts}<>r.contacts_snapshot))`,'AUCTION_USED','An imported bidder or their contacts changed. Nothing was undone.',job.id),
  ...await dependencyGuards(c,job.id),
  guard(`NOT EXISTS(SELECT 1 FROM cf_auction_rows r JOIN cf_gifts g ON g.id=r.gift_id WHERE r.job_id=? AND (NOT EXISTS(SELECT 1 FROM cf_campaign_gifts WHERE gift_id=g.id AND campaign_id=?) OR NOT EXISTS(SELECT 1 FROM cf_gift_appeals WHERE gift_id=g.id AND appeal=?) OR NOT EXISTS(SELECT 1 FROM cf_gift_channels WHERE gift_id=g.id AND channel='event')))`,'AUCTION_USED','Auction gift attribution changed. Nothing was undone.',job.id,job.campaign_id,job.appeal),
  sql("UPDATE cf_auction_jobs SET state='undoing' WHERE id=?",job.id),
  // Keep owned references until property deletion has checked its narrow gate.
  sql(`DELETE FROM cf_in_kind_gifts WHERE id IN(${owned('property_id')})`,job.id),
 ]
 // Property deletion clears its live FK after the immutability gate runs.
 writes.push(sql('UPDATE cf_auction_rows SET gift_id=NULL,property_id=NULL WHERE job_id=?',job.id))
 // IDs remain available in snapshots after detaching their live references.
 writes.push(sql("DELETE FROM cf_campaign_gifts WHERE gift_id IN(SELECT json_extract(gift_snapshot,'$.id') FROM cf_auction_rows WHERE job_id=?)",job.id),
  sql("DELETE FROM cf_gift_appeals WHERE gift_id IN(SELECT json_extract(gift_snapshot,'$.id') FROM cf_auction_rows WHERE job_id=?)",job.id),
  sql("DELETE FROM cf_gift_channels WHERE gift_id IN(SELECT json_extract(gift_snapshot,'$.id') FROM cf_auction_rows WHERE job_id=?)",job.id),
  sql("DELETE FROM cf_gifts WHERE id IN(SELECT json_extract(gift_snapshot,'$.id') FROM cf_auction_rows WHERE job_id=?)",job.id),
  sql('DELETE FROM cf_auction_claims WHERE row_id IN(SELECT id FROM cf_auction_rows WHERE job_id=?)',job.id),
  sql("UPDATE cf_auction_rows SET status='undone',donor_id=NULL WHERE job_id=?",job.id))
 const ownedDonors='SELECT donor_id FROM cf_auction_donors WHERE job_id=?'
 writes.push(sql(`DELETE FROM cf_contact_history WHERE donor_id IN(${ownedDonors})`,job.id),sql(`DELETE FROM cf_contact_points WHERE donor_id IN(${ownedDonors})`,job.id))
 const donorIds=(await all(c,'SELECT donor_id FROM cf_auction_donors WHERE job_id=?',job.id)).map(r=>r.donor_id)
 writes.push(sql('DELETE FROM cf_auction_donors WHERE job_id=?',job.id),sql('DELETE FROM cf_donors WHERE id IN(SELECT value FROM json_each(?))',JSON.stringify(donorIds)),
  sql("UPDATE cf_auction_jobs SET state='undone',undone_at=?,version=version+1 WHERE id=?",c.now,job.id),event(c,'auction.undo','auctionImport',job.id,null,{eventId:job.event_id,rows:rows.length}))
 await commit(c,writes)
 return {eventId:job.event_id,jobId:job.id,undone:true}
}
