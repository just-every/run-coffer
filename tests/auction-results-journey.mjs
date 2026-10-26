import assert from 'node:assert/strict'
import {run,donor,reviewed,archive,restore,installation} from './harness.mjs'

const quote=value=>'"'+String(value??'').replaceAll('"','""')+'"'
export const auctionCsvFixture=rows=>[['Lot','Item','Winning bidder','Bidder email','Winning bid','Fair market value','Paid status','Type','Quantity','Donor-stated value','Donor goods answer'],...rows].map(row=>row.map(quote).join(',')).join('\r\n')
export async function auctionPrerequisites(h,suffix='journey'){
 const campaign=await h.api('/api/coffer/giving/campaigns',{name:'Synthetic Coffer auction campaign '+suffix,slug:'synthetic-coffer-auction-'+suffix,description:'Synthetic Coffer auction fixture for literacy programs.',fund:'Synthetic Coffer Auction Fund',goal:'60000'})
 const appeal='SYNTHETIC-AUCTION-'+suffix.toUpperCase()
 await h.command('appealCode.define',{code:appeal,name:'Synthetic Coffer gala appeal '+suffix})
 const event=await h.command('event.create',{name:'Synthetic Coffer gala '+suffix,slug:'synthetic-coffer-gala-'+suffix,campaignId:campaign.id,appeal,startsOn:'2026-10-17'})
 return {event,campaign,appeal}
}
export async function auctionResultsJourney(){
 await run(async h=>{
  await reviewed(h)
  const {event,campaign,appeal}=await auctionPrerequisites(h),member=await h.person('synthetic-coffer-auction-member@example.test'),admin=await h.person('synthetic-coffer-auction-admin@example.test','admin')
  const bidder=await donor(h,'Synthetic Coffer Auction Bidder',{email:'synthetic-coffer-auction-bidder@example.test'}),other=await donor(h,'Synthetic Coffer Auction Bidder',{email:'synthetic-coffer-other-auction-bidder@example.test'}),itemDonor=await donor(h,'Synthetic Coffer Item Donor',{email:'synthetic-coffer-item-donor@example.test'})
  const bidderData=await h.get('/api/coffer/donors/'+bidder.id),name=bidderData.donor.name,email=bidderData.donor.email,itemData=(await h.get('/api/coffer/donors/'+itemDonor.id)).donor
  const csv=auctionCsvFixture([
   ['LOT-1','Synthetic Coffer, framed print',name,'','500','200','paid','lot','','',''],
   ['LOT-2','Synthetic Coffer dinner purchase',name,email,'150','300','paid','lot','','',''],
   ['PADDLE-1','Synthetic Coffer fund-a-need',name,email,'1000','0','paid','fund-a-need','','',''],
   ['LOT-3','Synthetic Coffer unknown-value experience',name,email,'700','','paid','lot','','',''],
   ['LOT-4','Synthetic Coffer unpaid weekend',name,email,'200','50','unpaid','lot','','',''],
   ['ITEM-1','Synthetic Coffer donated artwork',itemData.name,itemData.email,'','','','donated item','1','6000','none'],
  ])
  const input={eventId:event.id,source:'Synthetic Coffer Fixture',receivedOn:'2026-10-17',csv},state=jobId=>h.get('/api/coffer/auctions?eventId='+event.id+(jobId?'&jobId='+jobId:''))
  await h.command('auction.preview',input,{as:'',status:401});await h.command('auction.preview',input,{as:member.cookie,status:403})
  await h.get('/api/coffer/auctions?eventId='+event.id,{as:member.cookie,status:403});await h.get('/api/coffer/auctions?eventId='+event.id,{as:'',status:401})
  const preview=await h.command('auction.preview',input),initial=await state(preview.jobId)
  assert.equal((await h.get('/api/coffer/donors/'+bidder.id)).gifts.length,0,'Preview creates no contributions')
  assert.equal(initial.rows.length,6);assert.equal(initial.summary.unreviewed,1)
  const ambiguous=initial.rows.find(r=>r.lot==='LOT-1');assert.deepEqual(ambiguous.candidates.map(d=>d.id).sort(),[bidder.id,other.id].sort())
  await h.command('auction.apply',{jobId:preview.jobId,fingerprint:initial.job.fingerprint},{status:409})
  await h.command('auction.match',{jobId:preview.jobId,rowId:ambiguous.id,version:ambiguous.version,decision:'match',donorId:bidder.id,donorVersion:bidderData.donor.version,reason:'Synthetic Coffer bidder roster confirms this constituent.'},{as:member.cookie,status:403})
  await h.command('auction.match',{jobId:preview.jobId,rowId:ambiguous.id,version:ambiguous.version,decision:'match',donorId:bidder.id,donorVersion:bidderData.donor.version,reason:'Synthetic Coffer bidder roster confirms this constituent.'},{as:admin.cookie})
  await h.command('auction.match',{jobId:preview.jobId,rowId:ambiguous.id,version:ambiguous.version,decision:'create',reason:'Stale review'},{status:409})
  await h.command('auction.apply',{jobId:preview.jobId,fingerprint:initial.job.fingerprint},{status:409})
  const approved=await state(preview.jobId)
  await h.command('auction.apply',{jobId:preview.jobId,fingerprint:approved.job.fingerprint},{as:member.cookie,status:403})
  await h.command('auction.apply',{jobId:preview.jobId,fingerprint:approved.job.fingerprint},{as:admin.cookie})
  await h.command('auction.apply',{jobId:preview.jobId,fingerprint:approved.job.fingerprint})
  assert.equal((await h.command('auction.preview',input)).jobId,preview.jobId,'Re-uploading the same source returns its journal')
  const applied=await state(preview.jobId),lot=key=>applied.rows.find(r=>r.lot===key)
  assert.equal(lot('LOT-1').status,'gift');assert.equal(lot('LOT-1').amount_cents,50000);assert.equal(lot('LOT-1').fair_value_cents,20000);assert.equal(lot('LOT-1').deductibleCents,30000)
  assert.equal(applied.summary.purchaseRevenueCents,15000,'A below-value purchase remains separate event revenue')
  assert.equal(lot('LOT-2').status,'purchase');assert.equal(lot('LOT-2').gift_id,null);assert.equal(lot('LOT-2').deductibleCents,0)
  assert.equal(lot('PADDLE-1').status,'gift');assert.equal(lot('PADDLE-1').deductibleCents,100000)
  assert.equal(lot('LOT-3').status,'held');assert.equal(lot('LOT-3').gift_id,null)
  assert.equal(lot('LOT-4').status,'open');assert.equal(lot('LOT-4').openBalanceCents,20000)
  assert.equal(lot('ITEM-1').status,'property')
  const history=await h.get('/api/coffer/donors/'+bidder.id),gifts=history.gifts.filter(g=>g.kind==='gift')
  assert.deepEqual(gifts.map(g=>[g.amount_cents,g.goods_cents]).sort((a,b)=>a[0]-b[0]),[[50000,20000],[100000,0]])
  assert.equal(history.auctions.find(r=>r.lot==='LOT-4').status,'open','Unpaid lots belong to the bidder record')
  const ownFile=await h.api('/api/coffer/donors/'+bidder.id+'/data-request',{requestedOn:'2026-10-17',method:'letter',reference:'SYNTHETIC-COFFER-AUCTION'})
  assert.ok(!JSON.stringify(ownFile).includes('synthetic-coffer-other-auction-bidder@example.test'),'The donor file excludes other match candidates')
  assert.equal(history.letters.length,0,'Import does not send or prepare a receipt')
  const progress=await h.get('/api/coffer/giving/campaigns/'+campaign.id);assert.equal(progress.raisedCents,150000);assert.equal(progress.donorCount,1)
  const attribution=await h.get('/api/coffer/reports/attribution');assert.equal(attribution.channel.find(r=>r.key==='event').amountCents,150000);assert.equal(attribution.appeal.find(r=>r.key===appeal).amountCents,150000)
  const property=(await h.get('/api/coffer/donors/'+itemDonor.id)).inKind.gifts.find(g=>g.id===lot('ITEM-1').property_id)
  assert.equal(property.stated_value_cents,600000);assert.equal(property.reminders.form8283.form,'8283')
  assert.equal((await h.get('/api/coffer/donors/'+itemDonor.id)).gifts.find(g=>g.id===property.id).amount_cents,0)
  const ack=await h.command('inKind.acknowledge',{donorId:itemDonor.id,inKindId:property.id,version:property.version,acknowledgedOn:'2026-10-17'})
  const document=await (await h.request('/api/coffer/in-kind-acknowledgments/'+ack.acknowledgmentId+'/download')).text()
  assert.match(document,/Synthetic Coffer donated artwork/);assert.doesNotMatch(document,/\$6,000|\$6000/)
  if(process.env.COFFER_AUCTION_BROWSER){const {auctionResultsBrowser}=await import('./auction-results-browser.mjs');await auctionResultsBrowser(h,{event,jobId:preview.jobId,directory:process.env.COFFER_AUCTION_BROWSER})}
  const batch=await h.command('ack.prepare',{giftIds:gifts.map(g=>g.id)}),letters=(await h.get('/api/coffer/letters/'+batch.id)).letters
  const paidReceipt=letters.find(l=>l.gift_id===lot('LOT-1').gift_id),plainReceipt=letters.find(l=>l.gift_id===lot('PADDLE-1').gift_id)
  assert.match(paidReceipt.body,/\$500\.00/);assert.match(paidReceipt.body,/\$200\.00/);assert.match(paidReceipt.body,/\$300\.00 may be deductible/);assert.match(paidReceipt.body,/excess.*good-faith fair market value/s)
  assert.match(plainReceipt.body,/\$1,000\.00/);assert.match(plainReceipt.body,/No goods or services/)
  await h.command('auction.undo',{jobId:preview.jobId},{status:409})
  await h.command('ack.approve',{batchId:batch.id,version:1});await h.command('ack.export',{batchId:batch.id,version:2});await h.command('ack.markSent',{batchId:batch.id,version:3,sentOn:'2026-10-17',method:'mail'})
  const saved=await archive(h),fresh=await installation({entry:'tests/fixed-clock-worker.ts'})
  try{await restore(fresh,saved);const copy=await fresh.get('/api/coffer/auctions?eventId='+event.id+'&jobId='+preview.jobId);assert.equal(copy.rows.find(r=>r.lot==='LOT-2').status,'purchase');assert.equal(copy.rows.find(r=>r.lot==='LOT-4').openBalanceCents,20000);assert.equal((await fresh.get('/api/coffer/letters/'+batch.id)).letters.find(l=>l.id===paidReceipt.id).body,paidReceipt.body)}finally{await fresh.close()}
  const comparison=await h.get(`/api/coffer/duplicates/compare?source=${bidder.id}&target=${other.id}`),merged=await h.command('donor.merge',{sourceDonorId:bidder.id,donorId:other.id,sourceVersion:comparison.source.version,version:comparison.target.version,reason:'duplicate_record'})
  assert.equal((await state(preview.jobId)).rows.find(r=>r.lot==='LOT-2').donor_id,other.id,'Purchases follow bidder custody through merge')
  assert.equal((await state(preview.jobId)).rows.find(r=>r.lot==='LOT-4').donor_id,other.id,'Open balances follow bidder custody through merge')
  await h.command('donor.unmerge',{mergeId:merged.mergeId,reason:'incorrect_match'})
  assert.equal((await state(preview.jobId)).rows.find(r=>r.lot==='LOT-4').donor_id,bidder.id)
  const held=(await state(preview.jobId)).rows.find(r=>r.lot==='LOT-3')
  await h.command('auction.value',{jobId:preview.jobId,rowId:held.id,version:held.version,fairValue:'300',reason:'Synthetic Coffer signed valuation.'},{as:member.cookie,status:403})
  await h.command('auction.value',{jobId:preview.jobId,rowId:held.id,version:held.version,fairValue:'300',reason:'Synthetic Coffer signed valuation.'})
  await h.command('auction.value',{jobId:preview.jobId,rowId:held.id,version:held.version,fairValue:'200',reason:'Stale valuation.'},{status:409})
  assert.equal((await state(preview.jobId)).rows.find(r=>r.id===held.id).deductibleCents,40000)
  const open=(await state(preview.jobId)).rows.find(r=>r.lot==='LOT-4')
  await h.command('auction.settle',{jobId:preview.jobId,rowId:open.id,version:open.version,receivedOn:'2026-10-17',reason:'Synthetic Coffer payment ledger confirms settlement.'})
  assert.equal((await state(preview.jobId)).rows.find(r=>r.id===open.id).deductibleCents,15000)
  await undoUnusedAuction(h,event)
  await h.command('donor.erase',{donorId:bidder.id,confirm:'ERASE'})
  const erased=await state(preview.jobId);assert.equal(erased.job.source_csv,null);assert.equal(erased.job.state,'redacted')
  assert.equal(erased.rows.find(r=>r.id===lot('LOT-2').id).amount_cents,15000);assert.equal(erased.rows.find(r=>r.id===lot('LOT-2').id).bidder_name,null)
  await h.command('auction.undo',{jobId:preview.jobId},{status:409});await h.command('auction.preview',input,{status:409})
  const after=await archive(h);assert.ok(!JSON.stringify(after).includes(email),'Erasure removes bidder identity from source, candidates and snapshots')
  const refused=await installation({entry:'tests/fixed-clock-worker.ts'})
  try{await restore(refused,saved,{status:400,laterJournal:{sourceIdentity:after[0].sourceIdentity,epoch:after[0].epoch,journal:after[0].journal}})}finally{await refused.close()}
 },{entry:'tests/fixed-clock-worker.ts'})
}

async function undoUnusedAuction(h,event){
 const name='Synthetic Coffer New Auction Donor',email='synthetic-coffer-new-auction-donor@example.test',input={eventId:event.id,source:'Synthetic Coffer Undo',receivedOn:'2026-10-17',csv:auctionCsvFixture([
  ['UNDO-GIFT','Synthetic Coffer untouched winning lot',name,email,'400','100','paid','lot','','',''],
  ['UNDO-PURCHASE','Synthetic Coffer untouched purchase',name,email,'150','300','paid','lot','','',''],
  ['UNDO-PROPERTY','Synthetic Coffer untouched property',name,email,'','','','donated item','1','50','none'],
 ])}
 const preview=await h.command('auction.preview',input),get=()=>h.get('/api/coffer/auctions?eventId='+event.id+'&jobId='+preview.jobId),before=await get(),row=before.rows[0]
 await h.command('auction.match',{jobId:preview.jobId,rowId:row.id,version:row.version,decision:'create',reason:'Synthetic Coffer roster confirms a new donor.'})
 const review=await get();await h.command('auction.apply',{jobId:preview.jobId,fingerprint:review.job.fingerprint})
 const applied=await get(),donorId=applied.rows[0].donor_id
 assert.equal((await h.get('/api/coffer/donors/'+donorId)).gifts.length,2,'New donor owns one monetary and one property original')
 await h.command('auction.undo',{jobId:preview.jobId});await h.command('auction.undo',{jobId:preview.jobId})
 assert.equal((await get()).job.state,'undone');assert.ok((await get()).rows.every(r=>!r.gift_id&&!r.property_id&&!r.donor_id))
 await h.get('/api/coffer/donors/'+donorId,{status:404})
 const duplicate=auctionCsvFixture([['DUP','Synthetic Coffer duplicate',name,email,'1','0','paid','lot','','',''],['DUP','Synthetic Coffer duplicate',name,email,'1','0','paid','lot','','','']])
 await h.command('auction.preview',{...input,csv:duplicate},{status:400})
 await h.command('auction.preview',{...input,csv:input.csv.replace('"400"','"400.001"')},{status:400})
}
