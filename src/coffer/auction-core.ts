import { requireRole } from './auth'
import { all, fail, guard, id, one, sha256, type Context, type Row } from './db'
import { erasureHash } from './imports/snapshots'

export const auctionAuthority=(c:Context)=>requireRole(c.actor,['owner','admin'],'manage auction results')
export const rowKey=(r:Row)=>erasureHash('auction-lot:'+r.kind+':'+String(r.lot).toLowerCase())
export async function auctionEvent(c:Context,eventId:string){
 const e=await one(c,'SELECT e.*,c.fund,c.active FROM cf_fundraising_events e JOIN cf_campaigns c ON c.id=e.campaign_id WHERE e.id=?',id(eventId,'Event'))
 if(!e)fail('NOT_FOUND','Choose a fundraising event.',404)
 return e
}
export async function auctionJob(c:Context,jobId:unknown){
 const job=await one(c,'SELECT * FROM cf_auction_jobs WHERE id=?',id(jobId,'Auction import'))
 if(!job)fail('NOT_FOUND','That auction import is unavailable.',404)
 return job
}
export const auctionRows=(c:Context,jobId:string)=>all(c,'SELECT * FROM cf_auction_rows WHERE job_id=? ORDER BY position',jobId)
export const jobGuard=(j:Row)=>guard('EXISTS(SELECT 1 FROM cf_auction_jobs WHERE id=? AND version=? AND state=?)','AUCTION_CHANGED','The auction review changed. Refresh before saving.',j.id,j.version,j.state)
export const eventGuard=(j:Row)=>guard('EXISTS(SELECT 1 FROM cf_fundraising_events e JOIN cf_campaigns c ON c.id=e.campaign_id WHERE e.id=? AND e.campaign_id=? AND e.appeal_id=? AND c.fund=? AND c.active=1)','AUCTION_CHANGED','The event campaign or fund changed. Preview the source again.',j.event_id,j.campaign_id,j.appeal,j.fund)
export const donorGuard=(r:Row)=>guard('EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND version=? AND erased_at IS NULL) AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=?)','AUCTION_DONOR_CHANGED','A reviewed donor changed. Review the bidder again.',r.donor_id,r.donor_version,r.donor_id)

function candidateQuery(name:string,email:string|null){
 return {query:`SELECT DISTINCT owner.id,owner.version,owner.name,owner.email FROM cf_donors d
 LEFT JOIN cf_donor_merges m ON m.donor_id=d.id JOIN cf_donors owner ON owner.id=COALESCE(m.into_id,d.id)
 WHERE owner.erased_at IS NULL AND (lower(trim(owner.name))=? OR (? IS NOT NULL AND
 (d.email=? OR EXISTS(SELECT 1 FROM cf_donor_aliases a WHERE a.donor_id=d.id AND a.email=?)
 OR EXISTS(SELECT 1 FROM cf_contact_points p WHERE p.donor_id=d.id AND p.kind='email' AND p.active=1 AND p.value=?)))) ORDER BY owner.id`,params:[name.trim().toLowerCase(),email,email,email,email]}
}
export async function candidates(c:Context,name:string,email:string|null){const q=candidateQuery(name,email);return all(c,q.query,...q.params)}
export function candidatesGuard(row:Row){
 const q=candidateQuery(row.bidder_name,row.bidder_email)
 return guard(`(SELECT json_group_array(json_object('id',id,'version',version,'name',name,'email',email)) FROM (${q.query}))=?`,'AUCTION_MATCH_CHANGED','Possible bidder matches changed. Review the bidder again.',...q.params,row.candidates)
}
export async function rejectErased(c:Context,key:string,email:string|null){
 const hashes=[erasureHash('auction:'+key),...(email?[erasureHash(email)]:[])]
 if(await one(c,'SELECT 1 FROM cf_erasures WHERE hash IN(SELECT value FROM json_each(?))',JSON.stringify(hashes)))fail('AUCTION_ERASED','A source bidder was erased. This import cannot restore their identity.')
 return guard('NOT EXISTS(SELECT 1 FROM cf_erasures WHERE hash IN(SELECT value FROM json_each(?)))','AUCTION_ERASED','A source bidder was erased during review.',JSON.stringify(hashes))
}
/** A fingerprint includes every reviewed identity, row version and event fact. */
export async function auctionFingerprint(job:Row,rows:Row[]){
 return sha256(JSON.stringify([job.id,job.version,job.event_id,job.campaign_id,job.fund,job.appeal,job.received_on,rows.map(r=>[r.id,r.version,r.kind,r.lot,r.item,r.bidder_key,r.bidder_name,r.bidder_email,r.amount_cents,r.fair_value_cents,r.paid,r.quantity,r.stated_value_cents,r.property_goods,r.donor_id,r.donor_version,r.planned_donor_id??null,r.decision,r.candidates,r.match_reason])]))
}
export async function nativeSnapshot(c:Context,table:'cf_gifts'|'cf_donors'|'cf_in_kind_gifts'|'cf_contact_points'|'cf_contact_history',alias='n'){
 const columns=await all(c,`PRAGMA table_info(${table})`)
 return `json_object(${columns.map(column=>`'${column.name}',${alias}.${column.name}`).join(',')})`
}
export async function contactSnapshot(c:Context){
 const point=await nativeSnapshot(c,'cf_contact_points'),history=await nativeSnapshot(c,'cf_contact_history')
 return `json_object('points',json((SELECT json_group_array(json(value)) FROM (SELECT ${point} AS value FROM cf_contact_points n WHERE n.donor_id=d.id ORDER BY n.id))),'history',json((SELECT json_group_array(json(value)) FROM (SELECT ${history} AS value FROM cf_contact_history n WHERE n.donor_id=d.id ORDER BY n.point_id,n.version))))`
}
