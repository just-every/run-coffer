import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {run,donor,reviewed,settings,archive,restore,installation} from './harness.mjs'
import {platformDisbursementBrowser} from './platform-disbursement-browser.mjs'

const mail=n=>'synthetic-coffer-'+n+String.fromCharCode(64)+'example.test'
const root='/api/coffer/payments/platforms/benevity',match=id=>'/api/coffer/payments/donor-matches/'+id
const headers=['Organization','Disbursement','Transaction','Donor ID','Donor name','Email','Date','Currency','Contribution','Fees','Net','Fund','Campaign','Acknowledgment','Acknowledgment date','Acknowledgment method']
const mapping=Object.fromEntries(['organization','disbursement','transaction','donor','name','email','date','currency','gross','fee','net','fund','campaign','acknowledged','ackDate','ackMethod'].map((key,i)=>[key,headers[i]]))
const csv=rows=>[headers,...rows].map(row=>row.map(v=>'"'+String(v).replaceAll('"','""')+'"').join(',')).join('\r\n')
const row=(transaction,name,email,amount,fee,net,fund,campaign='none',ack='unknown',ackDate='',ackMethod='')=>['synthetic-coffer-2901','synthetic-coffer-2902',transaction,'source-'+transaction,name,email,'2026-09-01','USD',amount,fee,net,fund,campaign,ack,ackDate,ackMethod]
const selection=(view,d)=>({version:view.approved_version??view.version,donorId:d.id,donorVersion:view.candidates.find(c=>c.id===d.id)?.version??1,confirm:'yes'})
const approval=b=>({version:b.version,fingerprint:b.fingerprint,confirm:'yes'})
export async function platformDisbursementJourney(){
 let providerCalls=0
 const options={entry:'tests/fixed-clock-worker.ts',outbound:async()=>{providerCalls++;assert.fail('Uploaded disbursements require no provider calls')}}
 await run(async h=>{
  await reviewed(h)
  await h.command('settings.update',{...settings,threshold:'50',version:(await h.get('/api/coffer/settings')).version})
  await h.command('fund.define',{name:'Reading',restriction:'purpose',detail:'Literacy instruction'})
  await h.command('fund.define',{name:'Meals',restriction:'unrestricted'})
  const first=await donor(h,'Synthetic Platform First',{email:mail(2903),household:'Synthetic platform household'}),second=await donor(h,'Synthetic Platform Second',{email:mail(2903),household:'Synthetic platform household'}),third=await donor(h,'Synthetic Platform Third',{email:mail(2904)})
  const campaign=await h.api('/api/coffer/giving/campaigns',{name:'Synthetic platform campaign',slug:'synthetic-platform-campaign',description:'Community support.',fund:'Reading',goal:'1000'})
  const rows=[row('synthetic-coffer-2905','Synthetic Platform Second',mail(2903),'100.00','3.20','96.80','Literacy donations','synthetic-coffer-source-campaign'),row('synthetic-coffer-2906','Synthetic Platform Third',mail(2904),'50.00','1.25','48.75','Meals','none','acknowledged','2026-09-02','email')]
  const upload={csv:csv(rows),mapping,fundMap:{'Literacy donations':'Reading',Meals:'Meals'},campaignMap:{'synthetic-coffer-source-campaign':campaign.id,none:'none'},controls:{arrivalOn:'2026-09-03',gross:'150.00',fee:'4.45',net:'145.55'}}
  const preview=await h.api(root+'/preview',upload)
  assert.equal(preview.source_csv,upload.csv);assert.equal(preview.file_hash,createHash('sha256').update(upload.csv).digest('hex'))
  assert.equal(preview.state,'review');assert.equal(preview.rows.length,2);assert.equal(preview.issues.length,0)
  assert.equal(preview.rows[0].review.provider,'benevity');assert.deepEqual(preview.rows[0].review.candidates.map(c=>c.id).sort(),[first.id,second.id].sort())
  assert.equal((await h.get('/api/coffer/donors/'+second.id)).gifts.length,0)
  assert.equal((await h.get('/api/coffer/payments')).payouts.length,0)
  assert.deepEqual((await h.get('/api/coffer/payments/fees')).totals,{gross_cents:0,fee_cents:0,net_cents:0})
  await h.api(root+'/'+preview.id+'/approve',approval(preview),{status:409})
  const member=await h.person(mail(2907)),admin=await h.person(mail(2908),'admin'),key=await h.command('agent.create',{label:'Synthetic platform agent'})
  for(const access of [{as:'',status:401},{as:member.cookie,status:403},{as:'',headers:{authorization:'Bearer '+key.token},status:403}]){
   await h.get(root+'/'+preview.id,access);await h.api(root+'/preview',upload,access)
   await h.api(match(preview.rows[0].source_id)+'/approve',selection(preview.rows[0].review,second),access)
   await h.api(root+'/'+preview.id+'/approve',approval(preview),access)
  }
  assert.equal((await h.api(root+'/preview',upload)).id,preview.id,'Identical file returns the original review')
  await h.api(root+'/preview',{...upload,csv:csv(rows.map((r,i)=>i? r:r.map((v,j)=>j===8?'101.00':j===10?'97.80':v)))},{status:409})
  const missing=rows.map(r=>r.map((v,i)=>i===1?'synthetic-coffer-2991':i===2?v+'-incomplete':i===9?'':v))
  const held=await h.api(root+'/preview',{...upload,csv:csv(missing)})
  assert.equal(held.state,'held');assert.ok(held.issues.some(i=>i.includes('Actual fees')))
  await h.api(root+'/'+held.id+'/approve',approval(held),{status:409})
  for(const [reason,change] of [
   ['currency',r=>{r[0][7]='CAD'}],['net',r=>{r[0][10]='96.81'}],
   ['gross',r=>{r[0][8]=''}],['fund',r=>{r[0][11]=''}],['campaign',r=>{r[0][12]=''}],
   ['duplicate',r=>{r[1][2]=r[0][2]}],['organization',r=>{r[1][0]='synthetic-coffer-other-organization'}],
  ]){
   const bad=rows.map(r=>r.map((v,i)=>i===1?'synthetic-coffer-held-'+reason:i===2?v+'-'+reason:v));change(bad)
   const refused=await h.api(root+'/preview',{...upload,csv:csv(bad)})
   assert.equal(refused.state,'held',reason);assert.ok(refused.issues.length>0,reason)
   await h.api(root+'/'+refused.id+'/approve',approval(refused),{status:409})
  }
  assert.equal((await h.get('/api/coffer/donors/'+second.id)).gifts.length,0,'Incomplete or conflicting facts cannot create money')
  const sourcePath=match(preview.rows[0].source_id),otherPath=match(preview.rows[1].source_id)
  let view=await h.get(sourcePath)
  await h.api(sourcePath+'/approve',{...selection(view,second),donorVersion:99},{status:409})
  await h.api(sourcePath+'/approve',selection(view,second),{as:admin.cookie})
  await h.api('/auth/operator/status',{operatorId:admin.id,status:'inactive'})
  await h.api(sourcePath+'/approve',selection(view,second),{as:admin.cookie,status:401})
  await h.api(otherPath+'/approve',selection(await h.get(otherPath),third))
  let batch=await h.get(root+'/'+preview.id)
  await h.api(root+'/'+preview.id+'/approve',approval(batch),{status:409})
  assert.equal((await h.get('/api/coffer/donors/'+second.id)).gifts.length,0,'Revoked selector cannot release a gift')
  await h.api(sourcePath+'/refresh',{})
  view=await h.get(sourcePath)
  await h.api(sourcePath+'/approve',selection(view,second))
  await h.api(root+'/'+preview.id+'/approve',approval(preview),{status:409},'Changed selections invalidate old batch approval')
  const current=await h.get('/api/coffer/donors/'+second.id)
  await h.command('donor.update',{donorId:second.id,version:current.donor.version,name:'Synthetic Platform Reviewed',email:mail(2903),household:'Synthetic platform household'})
  batch=await h.get(root+'/'+preview.id)
  await h.api(root+'/'+preview.id+'/approve',approval(batch),{status:409})
  await h.api(sourcePath+'/refresh',{})
  view=await h.get(sourcePath)
  // The browser performs the native upload mapping and explicit donor selection.
  await platformDisbursementBrowser(h,{upload,preview,sourceId:preview.rows[0].source_id,chosen:'Synthetic Platform Reviewed'})
  batch=await h.get(root+'/'+preview.id)
  const decision=approval(batch)
  const concurrent=await Promise.all([h.request(root+'/'+preview.id+'/approve',{method:'POST',body:decision}),h.request(root+'/'+preview.id+'/approve',{method:'POST',body:decision})])
  for(const response of concurrent)assert.ok([200,409].includes(response.status),await response.text())
  assert.ok(concurrent.some(r=>r.status===200))
  const recorded=await h.get(root+'/'+preview.id)
  assert.equal(recorded.state,'recorded')
  await h.api(root+'/'+preview.id+'/approve',decision)
  assert.equal((await h.api(root+'/preview',upload)).state,'recorded')
  const conflicting=rows[0].map((v,i)=>i===1?'synthetic-coffer-conflicting-disbursement':v)
  await h.api(root+'/preview',{...upload,csv:csv([conflicting]),controls:{arrivalOn:'2026-09-03',gross:'100.00',fee:'3.20',net:'96.80'}},{status:409})
  const a=await h.get('/api/coffer/donors/'+second.id),b=await h.get('/api/coffer/donors/'+third.id)
  assert.equal(a.gifts.length,1);assert.equal(a.gifts[0].amount_cents,10000);assert.equal(a.gifts[0].source_provider,'Benevity');assert.equal(a.gifts[0].method,'bank transfer');assert.equal(a.totals.lifetimeCents,10000)
  assert.equal(b.gifts.length,1);assert.equal(b.gifts[0].amount_cents,5000);assert.equal(b.gifts[0].acknowledgment.status,'acknowledged');assert.equal(b.gifts[0].acknowledgment.acknowledged_on,'2026-09-02');assert.equal(b.gifts[0].acknowledgment.method,'email')
  assert.equal(a.consents.length,0);assert.equal(b.consents.length,0)
  assert.equal((await h.get('/api/coffer/donors/'+first.id)).gifts.length,0)
  const payout=await h.get('/api/coffer/payments/'+recorded.payout_id)
  assert.equal(payout.payout.provider,'benevity');assert.equal(payout.payout.complete,1);assert.equal(payout.payout.amount_cents,14555);assert.equal(payout.payout.matched_cents,14555)
  assert.equal(payout.lines.length,2);assert.ok(payout.lines.every(l=>l.charge_id===null&&l.provider==='benevity'))
  assert.deepEqual(payout.splits.map(s=>[s.fund,s.gross_cents,s.fee_cents,s.net_cents]),[['Meals',5000,125,4875],['Reading',10000,320,9680]])
  const fees=await h.get('/api/coffer/payments/fees?payoutId='+recorded.payout_id)
  assert.deepEqual(fees.totals,{gross_cents:15000,fee_cents:445,net_cents:14555});assert.deepEqual(fees.matched,fees.totals);assert.equal(fees.payouts[0].difference_cents,0)
  assert.deepEqual(fees.byForm,[{id:null,name:'No recorded giving form',...fees.totals}]);assert.equal(fees.byCampaign.find(g=>g.id===campaign.id).gross_cents,10000);assert.equal(fees.byCampaign.find(g=>g.id===null).gross_cents,5000)
  assert.equal((await h.get('/api/coffer/giving/campaigns')).campaigns.find(c=>c.id===campaign.id).raised_cents,10000)
  assert.equal(h.messages.filter(m=>/receipt/i.test(m.subject??'')).length,0,'Upload sends no automatic receipt')
  await h.command('ack.prepare',{giftIds:[a.gifts[0].id]},{status:409})
  await h.command('gift.classify',{giftId:a.gifts[0].id,version:a.gifts[0].version,goods:'none'})
  const receipt=await h.command('ack.prepare',{giftIds:[a.gifts[0].id]})
  const letters=await h.get('/api/coffer/letters/'+receipt.id)
  assert.equal(letters.letters.length,1);assert.equal(letters.letters[0].amount_cents,10000)
  assert.match(letters.letters[0].body,/100\.00/,'Receipt includes the full contribution')
  assert.doesNotMatch(letters.letters[0].body,/96\.80/)
  await h.command('ack.approve',{batchId:receipt.id,version:1})
  await h.command('ack.send',{batchId:receipt.id,version:2})
  // Private source originals and other candidate identities never enter donor files.
  const file=await h.api('/api/coffer/donors/'+second.id+'/data-request',{requestedOn:'2026-09-04',method:'other',reference:'synthetic-coffer-2910'})
  const bytes=JSON.stringify(file)
  assert.ok(!bytes.includes('source_csv'));assert.ok(!file.records.payment_donor_matches);assert.ok(!file.records.platform_sources);assert.ok(!bytes.includes(mail(2904)))
  await platformDisbursementBrowser(h,{recorded,payout:true})
  const pendingRow=row('synthetic-coffer-2920','Synthetic Platform First',mail(2903),'20.00','1.00','19.00','Meals');pendingRow[1]='synthetic-coffer-2921'
  const pendingUpload={...upload,csv:csv([pendingRow]),controls:{arrivalOn:'2026-09-03',gross:'20.00',fee:'1.00',net:'19.00'}}
  let pending=await h.api(root+'/preview',pendingUpload)
  await h.api(match(pending.rows[0].source_id)+'/approve',selection(pending.rows[0].review,first))
  pending=await h.get(root+'/'+pending.id)
  console.info('Benevity: exact ledger, fees, receipt, replay and browser states passed; checking restore and erasure')
  const backup=await archive(h),fresh=await installation({...options,givingProtection:false})
  try{
   await restore(fresh,backup)
   assert.equal((await fresh.get(root+'/'+preview.id)).state,'recorded')
   assert.deepEqual((await fresh.get('/api/coffer/payments/fees?payoutId='+recorded.payout_id)).totals,fees.totals)
   assert.equal((await fresh.get(root+'/'+pending.id)).source_csv,pendingUpload.csv)
   await fresh.api(root+'/'+pending.id+'/approve',approval(pending),{status:409})
   await fresh.api(match(pending.rows[0].source_id)+'/refresh',{},{status:409})
  }finally{await fresh.close()}
  const beforeMerge=await h.get('/api/coffer/duplicates/compare?source='+first.id+'&target='+second.id)
  await h.command('donor.merge',{sourceDonorId:first.id,donorId:second.id,sourceVersion:beforeMerge.source.version,version:beforeMerge.target.version,reason:'duplicate_record'})
  assert.equal((await h.get(sourcePath)).gift.donor_id,second.id)
  await h.api(root+'/'+pending.id+'/approve',approval(pending),{status:409})
  assert.equal((await h.get('/api/coffer/donors/'+second.id)).totals.lifetimeCents,10000)
  await h.command('donor.erase',{donorId:second.id,confirm:'ERASE'})
  const erased=await h.get(sourcePath)
  assert.equal(erased.state,'erased');assert.deepEqual(erased.facts,{});assert.deepEqual(erased.candidates,[])
  assert.equal((await h.get(root+'/'+preview.id)).source_csv,null)
  assert.equal((await h.get(root+'/'+preview.id)).rows[0].evidence,null)
  await h.api(sourcePath+'/approve',selection(view,second),{status:409})
  assert.equal((await h.api(root+'/preview',upload)).state,'erased')
  assert.equal((await h.get(root+'/'+pending.id)).state,'erased')
  const later=pendingRow.map((v,i)=>i===1?'synthetic-coffer-2922':i===2?'synthetic-coffer-2923':i===5?mail(2995):v)
  const suppressed=await h.api(root+'/preview',{...pendingUpload,csv:csv([later])})
  assert.equal(suppressed.state,'held');assert.ok(suppressed.issues.some(i=>i.includes('erased')))
  await h.api(root+'/'+suppressed.id+'/approve',approval(suppressed),{status:409})
  const after=await h.get('/api/coffer/payments/fees?payoutId='+recorded.payout_id);assert.deepEqual(after.totals,fees.totals)
  assert.equal((await h.get('/api/coffer/donors/'+third.id)).gifts.length,1)
  const afterErasure=await archive(h),protectedCopy=await installation({...options,givingProtection:false})
  try{
   await restore(protectedCopy,backup,{status:400,laterJournal:{sourceIdentity:afterErasure[0].sourceIdentity,epoch:afterErasure[0].epoch,journal:afterErasure[0].journal}})
   await protectedCopy.get(root+'/'+preview.id,{status:404})
   assert.equal((await protectedCopy.get('/api/coffer/donors')).total,0)
  }finally{await protectedCopy.close()}
  assert.equal(providerCalls,0)
 },options)
}
