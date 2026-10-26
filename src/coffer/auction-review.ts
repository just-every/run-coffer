import { choice, commit, event, fail, guard, id, integer, newId, one, sha256, sql, text, today, type Context, type Row } from './db'
import { auctionCsv } from './auction-csv'
import { auctionAuthority, auctionEvent, auctionFingerprint, auctionJob, auctionRows, candidates, jobGuard, rejectErased, rowKey } from './auction-core'
import { settings } from './settings'

export async function previewAuction(c:Context,p:Row){
 auctionAuthority(c)
 const input=auctionCsv(p),e=await auctionEvent(c,id(p.eventId,'Event'))
 if(!e.active)fail('AUCTION_EVENT','Choose an active event campaign.')
 if(input.receivedOn>today((await settings(c)).timezone,new Date(c.now)))fail('INPUT','Payment received on cannot be in the future.',400)
 const sourceHash=await sha256(JSON.stringify([input.csv,input.receivedOn]))
 const prior=await one(c,"SELECT id,state FROM cf_auction_jobs WHERE event_id=? AND source=? AND source_hash=? AND state<>'undone'",e.id,input.source,sourceHash)
 if(prior?.state==='redacted')fail('AUCTION_ERASED','An erased bidder belongs to this source. This import cannot restore their identity.')
 if(prior)return {eventId:e.id,jobId:prior.id,unchanged:true}
 const job:Row={id:newId(),event_id:e.id,source:input.source,source_hash:sourceHash,source_csv:input.csv,received_on:input.receivedOn,campaign_id:e.campaign_id,fund:e.fund,appeal:e.appeal_id,state:'preview',version:1},rows:Row[]=[],checks=[]
 for(const [position,r] of input.rows.entries()){
  checks.push(await rejectErased(c,r.bidderKey,r.bidderEmail))
  const choices=await candidates(c,r.bidderName,r.bidderEmail),exact=choices.filter(d=>d.email===r.bidderEmail&&r.bidderEmail&&d.name.trim().toLowerCase()===r.bidderName.toLowerCase()),match=exact.length===1&&choices.filter(d=>d.email===r.bidderEmail).length===1?exact[0]:null
  const row={id:newId(),job_id:job.id,position,source_row:r.sourceRow,lot:r.lot,item:r.item,kind:r.kind,bidder_key:r.bidderKey,bidder_name:r.bidderName,bidder_email:r.bidderEmail,amount_cents:r.amountCents,fair_value_cents:r.fairValueCents,paid:r.paid,quantity:r.quantity,stated_value_cents:r.statedValueCents,property_goods:r.propertyGoods,donor_id:match?.id??null,donor_version:match?.version??null,decision:match?'match':'unreviewed',candidates:JSON.stringify(choices),match_reason:null,status:'preview',version:1}
  if(await one(c,'SELECT 1 FROM cf_auction_claims WHERE event_id=? AND source=? AND lot_key=?',e.id,input.source,rowKey(row)))fail('AUCTION_DUPLICATE',`Lot ${r.lot} is already imported for this event and platform. Nothing was imported.`)
  rows.push(row)
 }
 const fingerprint=await auctionFingerprint(job,rows)
 await commit(c,[...checks,guard("NOT EXISTS(SELECT 1 FROM cf_auction_jobs WHERE event_id=? AND source=? AND source_hash=? AND state<>'undone')",'AUCTION_CHANGED','This source was previewed in another window. Open its existing review.',e.id,input.source,sourceHash),guard('EXISTS(SELECT 1 FROM cf_fundraising_events e JOIN cf_campaigns c ON c.id=e.campaign_id WHERE e.id=? AND e.campaign_id=? AND e.appeal_id=? AND c.fund=? AND c.active=1)','AUCTION_CHANGED','The event changed during preview.',e.id,e.campaign_id,e.appeal_id,e.fund),
  sql('INSERT INTO cf_auction_jobs(id,event_id,source,source_hash,source_csv,received_on,campaign_id,fund,appeal,state,version,fingerprint,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)',job.id,e.id,input.source,sourceHash,input.csv,input.receivedOn,e.campaign_id,e.fund,e.appeal_id,'preview',1,fingerprint,c.now,c.actor.id),
  ...rows.map(r=>{const keys=Object.keys(r);return sql(`INSERT INTO cf_auction_rows(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`,...keys.map(k=>(r as Row)[k]))}),event(c,'auction.preview','auctionImport',job.id,null,{eventId:e.id,rows:rows.length})])
 return {eventId:e.id,jobId:job.id,fingerprint,version:1}
}

/** One explicit bidder decision applies to all that source bidder's lots. */
export async function matchAuctionBidder(c:Context,p:Row){
 auctionAuthority(c)
 const job=await auctionJob(c,p.jobId),rows=await auctionRows(c,job.id),row=rows.find(r=>r.id===id(p.rowId,'Auction row'))
 if(job.state!=='preview'||!row)fail('AUCTION_CHANGED','Only a current preview can change bidder matches.')
 const version=integer(Number(p.version),'Row version',1),reason=text(p.reason,'Reason for the bidder decision',500)
 if(row.version!==version)fail('AUCTION_CHANGED','The bidder review changed. Refresh before deciding.')
 const create=choice(p.decision,['create','match'] as const,'a bidder decision')==='create',donor=create?null:await one(c,'SELECT id,version,name,email FROM cf_donors WHERE id=? AND erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=cf_donors.id)',id(p.donorId,'Matched donor'))
 if(!create&&!donor)fail('AUCTION_DONOR_CHANGED','Choose a current donor.')
 if(donor&&Number(p.donorVersion)!==donor.version)fail('AUCTION_DONOR_CHANGED','That donor changed. Refresh the match review.')
 const donorId=donor?.id??'auction-donor-'+(await sha256(job.id+'|'+row.bidder_key)).slice(0,36)
 const choices=await candidates(c,row.bidder_name,row.bidder_email),nextRows=rows.map(r=>r.bidder_key===row.bidder_key?{...r,donor_id:create?null:donorId,planned_donor_id:create?donorId:null,donor_version:donor?.version??1,decision:create?'create':'match',candidates:JSON.stringify(choices),match_reason:reason,version:r.version+1}:r),fingerprint=await auctionFingerprint({...job,version:job.version+1},nextRows)
 await commit(c,[jobGuard(job),await rejectErased(c,row.bidder_key,row.bidder_email),guard('EXISTS(SELECT 1 FROM cf_auction_rows WHERE id=? AND version=?)','AUCTION_CHANGED','The bidder review changed.',row.id,version),
  ...(donor?[guard('EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND version=? AND erased_at IS NULL)','AUCTION_DONOR_CHANGED','The matched donor changed.',donor.id,donor.version)]:[]),
  sql('UPDATE cf_auction_rows SET donor_id=?,planned_donor_id=?,donor_version=?,decision=?,candidates=?,match_reason=?,version=version+1,reviewed_by=?,reviewed_at=? WHERE job_id=? AND bidder_key=?',create?null:donorId,create?donorId:null,donor?.version??1,create?'create':'match',JSON.stringify(choices),reason,c.actor.id,c.now,job.id,row.bidder_key),
  sql('UPDATE cf_auction_jobs SET version=version+1,fingerprint=? WHERE id=?',fingerprint,job.id),event(c,'auction.match','auctionImport',job.id,donor?.id??null,{rowId:row.id,decision:create?'create':'match'})])
 return {eventId:job.event_id,jobId:job.id,fingerprint,version:job.version+1}
}
