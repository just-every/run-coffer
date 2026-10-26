import { prepareGiftRecord } from './gifts'
import { amount } from './money'
import { settings } from './settings'
import { commit, date, event, fail, guard, id, integer, one, sql, text, today, type Context, type Row, type Stmt } from './db'
import { auctionAuthority, auctionJob, auctionRows, candidatesGuard, contactSnapshot, donorGuard, eventGuard, jobGuard, nativeSnapshot, rejectErased, rowKey } from './auction-core'

/** Use the public monetary business preparer inside the import transaction. */
async function payment(c:Context,job:Row,row:Row,receivedOn:string):Promise<{statements:Stmt[];status:string;giftId:string|null;propertyId:string|null}>{
 if(row.kind==='donated_item'){
  const propertyId='auction-property-'+row.id
  return {status:'property',giftId:null,propertyId,statements:[sql(`INSERT INTO cf_in_kind_gifts(id,donor_id,description,quantity,stated_value_cents,received_on,original_received_on,goods,goods_cents,form_8283,created_at,updated_at,created_by,fund)
   VALUES(?,?,?,?,?,?,?,?,0,'unknown',?,?,?,?)`,propertyId,row.donor_id,row.item,row.quantity,row.stated_value_cents,receivedOn,receivedOn,row.property_goods,c.now,c.now,c.actor.id,job.fund),event(c,'auction.property','inKindGift',propertyId,row.donor_id,{jobId:job.id,rowId:row.id,statedValueCents:row.stated_value_cents})]}
 }
 if(!row.paid)return {status:'open',giftId:null,propertyId:null,statements:[]}
 if(row.fair_value_cents===null)return {status:'held',giftId:null,propertyId:null,statements:[]}
 if(row.kind==='lot'&&row.amount_cents<=row.fair_value_cents)return {status:'purchase',giftId:null,propertyId:null,statements:[]}
 const giftId='auction-gift-'+row.id,goods=row.fair_value_cents>0?'provided':'none'
 const write=await prepareGiftRecord(c,{donorId:row.donor_id,amountCents:row.amount_cents,receivedOn,method:'other',reference:'auction:'+row.id,fund:job.fund,campaignId:job.campaign_id,appeal:job.appeal,channel:'event',goods,goodsValueCents:row.fair_value_cents,goodsDescription:row.item},giftId)
 return {status:'gift',giftId,propertyId:null,statements:write.statements}
}

export async function applyAuction(c:Context,p:Row){
 auctionAuthority(c)
 const job=await auctionJob(c,p.jobId),rows=(await auctionRows(c,job.id)).map(r=>r.decision==='create'?{...r,donor_id:r.planned_donor_id}:r)
 if(job.state==='applied')return {eventId:job.event_id,jobId:job.id,unchanged:true}
 if(job.state!=='preview'||p.fingerprint!==job.fingerprint)fail('AUCTION_CHANGED','Approve the exact current preview before importing.')
 if(job.received_on>today((await settings(c)).timezone,new Date(c.now)))fail('INPUT','The received date is now in the future for the organization. Preview with the correct date.',400)
 if(rows.some(r=>r.decision==='unreviewed'||!r.donor_id))fail('AUCTION_MATCH_REQUIRED','Decide every bidder match before importing.')
 const writes:Stmt[]=[jobGuard(job),eventGuard(job)],newDonors=new Map<string,Row>()
 for(const row of rows){
  writes.push(await rejectErased(c,row.bidder_key,row.bidder_email),candidatesGuard(row))
  if(row.decision==='create')newDonors.set(row.donor_id,row)
  else writes.push(donorGuard(row))
  writes.push(guard('NOT EXISTS(SELECT 1 FROM cf_auction_claims WHERE event_id=? AND source=? AND lot_key=?)','AUCTION_DUPLICATE','A lot was already imported. Nothing was imported.',job.event_id,job.source,rowKey(row)))
 }
 // Each source identity gets exactly the human-reviewed native donor. No
 // consent is inferred. The ingest flag is the existing imported-identity door.
 if(newDonors.size)writes.push(sql('INSERT INTO cf_identity_ingest VALUES(1)'))
 for(const [donorId,row] of newDonors){
  writes.push(guard('NOT EXISTS(SELECT 1 FROM cf_donors WHERE id=?)','AUCTION_CHANGED','The new bidder identity changed. Preview again.',donorId),
   sql("INSERT INTO cf_donors(id,version,name,email,source,source_ref,created_at) VALUES(?,1,?,?,'manual',?,?)",donorId,row.bidder_name,row.bidder_email,'auction:'+job.id+':'+row.bidder_key,c.now),event(c,'auction.donor','donor',donorId,donorId,{jobId:job.id}))
 }
 if(newDonors.size)writes.push(sql('DELETE FROM cf_identity_ingest'))
 const giftSnapshot=await nativeSnapshot(c,'cf_gifts'),propertySnapshot=await nativeSnapshot(c,'cf_in_kind_gifts')
 for(const row of rows){
  const recorded=await payment(c,job,row,job.received_on)
  writes.push(...recorded.statements,sql('UPDATE cf_auction_rows SET donor_id=?,status=?,gift_id=?,property_id=?,received_on=?,applied_version=version WHERE id=?',row.donor_id,recorded.status,recorded.giftId,recorded.propertyId,job.received_on,row.id),
   sql(`UPDATE cf_auction_rows SET gift_snapshot=(SELECT ${giftSnapshot} FROM cf_gifts n WHERE n.id=gift_id),property_snapshot=(SELECT ${propertySnapshot} FROM cf_in_kind_gifts n WHERE n.id=property_id) WHERE id=?`,row.id),
   sql('INSERT INTO cf_auction_claims(event_id,source,lot_key,row_id) VALUES(?,?,?,?)',job.event_id,job.source,rowKey(row),row.id))
 }
 if(newDonors.size){
  const donorSnapshot=await nativeSnapshot(c,'cf_donors','d'),contacts=await contactSnapshot(c)
  for(const donorId of newDonors.keys())writes.push(sql(`INSERT INTO cf_auction_donors(job_id,donor_id,snapshot,contacts_snapshot) SELECT ?,d.id,${donorSnapshot},${contacts} FROM cf_donors d WHERE d.id=?`,job.id,donorId))
 }
 writes.push(sql("UPDATE cf_auction_jobs SET state='applied',applied_at=? WHERE id=?",c.now,job.id),event(c,'auction.apply','auctionImport',job.id,null,{eventId:job.event_id,rows:rows.length}))
 await commit(c,writes)
 return {eventId:job.event_id,jobId:job.id,rows:rows.length,giftIds:rows.filter(r=>r.paid&&r.fair_value_cents!==null&&r.amount_cents>r.fair_value_cents&&r.kind!=='donated_item').map(r=>'auction-gift-'+r.id)}
}

/** Held values and later settlements use the same monetary classification. A
 * later human action is deliberately a dependency which fences import undo. */
export async function reviewAuctionValue(c:Context,command:string,p:Row){
 auctionAuthority(c)
 const job=await auctionJob(c,p.jobId),row=await one(c,'SELECT * FROM cf_auction_rows WHERE id=? AND job_id=?',id(p.rowId,'Auction row'),job.id),version=integer(Number(p.version),'Row version',1)
 if(!row||row.version!==version||job.state!=='applied')fail('AUCTION_CHANGED','This auction result changed. Refresh before reviewing.')
 if(command==='auction.value'&&row.status!=='held'&&!(row.status==='open'&&row.fair_value_cents===null))fail('AUCTION_CHANGED','Only a lot with an unknown value can receive a reviewed value.')
 if(command==='auction.settle'&&row.status!=='open')fail('AUCTION_CHANGED','Only an unpaid balance can be recorded as paid.')
 const reason=text(p.reason,'Reason and evidence for the review',1000),fairValue=command==='auction.value'?amount(p,'fairValue','Fair market value',{allowZero:true}):row.fair_value_cents
 const receivedOn=command==='auction.settle'?date(p.receivedOn,'Payment received on'):row.received_on
 if(receivedOn<job.received_on||receivedOn>today((await settings(c)).timezone,new Date(c.now)))fail('INPUT','A settlement date must be between the original import date and today.',400)
 const donor=await one(c,'SELECT version FROM cf_donors WHERE id=? AND erased_at IS NULL',row.donor_id)
 if(!donor)fail('AUCTION_DONOR_CHANGED','This bidder is no longer available.')
 const changed={...row,fair_value_cents:fairValue,paid:command==='auction.settle'?1:row.paid},recorded=await payment(c,job,changed,receivedOn)
 await commit(c,[jobGuard(job),eventGuard(job),donorGuard({...row,donor_version:donor.version}),guard('EXISTS(SELECT 1 FROM cf_auction_rows WHERE id=? AND version=? AND status=?)','AUCTION_CHANGED','This result changed during review.',row.id,version,row.status),...recorded.statements,
  sql('UPDATE cf_auction_rows SET fair_value_cents=?,paid=?,status=?,gift_id=?,property_id=?,version=version+1,received_on=?,reviewed_by=?,reviewed_at=? WHERE id=?',fairValue,changed.paid,recorded.status,recorded.giftId,recorded.propertyId,receivedOn,c.actor.id,c.now,row.id),
  sql('UPDATE cf_auction_jobs SET version=version+1 WHERE id=?',job.id),event(c,command,'auctionRow',row.id,row.donor_id,{jobId:job.id,fairValueCents:fairValue,paid:changed.paid,reasonRecorded:true}),
  // Review evidence stays private, beside the source decision, never in audit.
  sql('UPDATE cf_auction_rows SET match_reason=COALESCE(match_reason||char(10),\'\')||? WHERE id=?',reason,row.id)])
 return {eventId:job.event_id,jobId:job.id,rowId:row.id,status:recorded.status,version:version+1,giftId:recorded.giftId}
}
