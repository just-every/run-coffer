import assert from 'node:assert/strict'
import {run,donor,reviewed,archive,restore,installation} from '../harness.mjs'
import {quickbooksEdge} from './edge.mjs'
import {quickbooksBrowser,postCheckInBrowser} from './browser.mjs'

const root='/api/coffer/payments/quickbooks'
const mapping={version:0,bank:'checking',stripe:'stripe',fees:'fees',funds:{Housing:{accountId:'housing',classId:'housing-class',locationId:'shared-location'},Meals:{accountId:'meals',classId:'meals-class',locationId:'shared-location'},Reading:{accountId:'reading',classId:'reading-class',locationId:'shared-location'}}}
export async function connectQuickbooks(h,edge,realm=edge.realm){
 const start=await h.api(root+'/connect',{}),url=new URL(start.url)
 assert.equal(url.origin,'https://appcenter.intuit.com');assert.equal(url.searchParams.get('scope'),'com.intuit.quickbooks.accounting')
 const callback='/app/settings/quickbooks/callback?'+new URLSearchParams({code:'synthetic-coffer-1703',realmId:realm,state:url.searchParams.get('state')})
 return {callback,response:await h.request(callback,{headers:{'sec-fetch-site':'cross-site'}})}
}
export async function quickbooksJourney(){
 const edge=quickbooksEdge(),bindings={QBO_CLIENT_ID:'synthetic-coffer-1701',QBO_CLIENT_SECRET:'synthetic-coffer-1702',QBO_SANDBOX:'true',STRIPE_SECRET_KEY:'synthetic-coffer-1704'}
 await run(async h=>{
  await reviewed(h)
  const payoutPath=root+'/payout/'+edge.payout.id
  const member=await h.person('synthetic-coffer-1705@example.test'),admin=await h.person('synthetic-coffer-1706@example.test','admin')
  for(const as of ['',member.cookie,admin.cookie]){
   const status=as?403:401
   await h.api(root+'/disconnect',{}, {as,status});await h.get(payoutPath+'/remote',{as,status});await h.get(root,{as,status});await h.api(root+'/connect',{}, {as,status});await h.api(root+'/mapping',mapping,{as,status});await h.api(payoutPath+'/post',{confirm:'yes'},{as,status})
  }
  const invalid=await h.request(root+'/connect',{method:'POST',body:{},headers:{origin:'https://foreign.example.test'}});assert.equal(invalid.status,403)
  assert.equal((await h.request('/api/coffer/payments',{headers:{'sec-fetch-site':'cross-site'}})).status,403)
  await h.api(payoutPath+'/post',{confirm:'yes'},{status:409});assert.equal(edge.requests.length,0)
  const tampered=await h.request('/app/settings/quickbooks/callback?state=synthetic-coffer-invalid&realmId=1234567890&code=synthetic-coffer-1703');assert.equal(tampered.status,409);assert.equal(edge.exchanges,0)
  const {callback,response}=await connectQuickbooks(h,edge);assert.equal(response.status,303,(await response.text()).match(/role="alert"[^>]*>([^<]+)/)?.[1])
  assert.equal((await h.request(callback)).status,409);assert.equal(edge.exchanges,1,'The authorization code is exchanged only once')
  const connected=await h.get(root);assert.deepEqual(connected.connection,{realm_id:'1234567890',sandbox:1,connected_at:'2026-10-18T02:00:00.000Z'});assert.ok(!JSON.stringify(connected).includes('synthetic-coffer-access'))
  await h.api('/api/coffer/payments/sync',{payoutId:edge.payout.id})
  const source=await h.get('/api/coffer/payments/'+edge.payout.id)
  assert.equal(source.payout.amount_cents,49170);assert.equal(source.payout.matched_cents,49170);assert.equal(source.lines.length,5)
  const d=await donor(h,'Rowan Kim'),batch=await h.command('giftBatch.create',{name:'Community program checks',receivedOn:'2026-10-17',fund:'Reading',method:'check',expected:'600'})
  const batchPath=root+'/batch/'+batch.id
  let version=1
  for(const [fund,amount] of [['Reading','100'],['Meals','200'],['Housing','300']])version=(await h.command('giftBatch.add',{batchId:batch.id,version,donorId:d.id,amount,reference:'synthetic-coffer-check-'+fund,goods:'none',fund})).version
  await h.api(root+'/mapping',{...mapping,bank:'reading'},{status:409})
  await h.api(root+'/mapping',{...mapping,fees:'checking'},{status:409})
  await h.api(root+'/mapping',{...mapping,funds:{...mapping.funds,Meals:{accountId:'meals',classId:'unknown'}}},{status:409})
  const mapped=await h.api(root+'/mapping',mapping)
  assert.deepEqual(mapped,{version:1,bank:'checking',stripe:'stripe',fees:'fees',funds:mapping.funds});assert.ok(edge.refreshes>0,'Expired access refreshes with the rotating refresh token')
  await h.api(root+'/mapping',mapping,{status:409})
  await h.api(batchPath+'/post',{confirm:'yes'},{status:409});assert.equal(edge.records.size,0,'An open batch never posts')
  await h.command('giftBatch.close',{batchId:batch.id,version})
  await h.api(payoutPath+'/post',{}, {status:400});assert.equal(edge.records.size,0,'No financial write without explicit authorization')
  await quickbooksBrowser(h,{payoutId:edge.payout.id,batchId:batch.id,phase:'review'})
  // The native owner sees the exact preview and a structured closed-period failure.
  edge.refuse=true
  let attempt=await h.api(payoutPath+'/post',{confirm:'yes'})
  assert.equal(attempt.postings.length,3);assert.equal(attempt.postings.find(p=>p.kind==='adjustment').state,'failed');assert.match(attempt.postings.find(p=>p.state==='failed').error,/6210/)
  assert.equal(edge.records.size,0,'A provider refusal creates no accounting entry')
  assert.match(await (await h.request('/app/payouts/quickbooks/payout/'+edge.payout.id)).text(),/6210/)
  await quickbooksBrowser(h,{payoutId:edge.payout.id,batchId:batch.id,phase:'failed'})
  edge.refuse=false;edge.lose=true
  attempt=await h.api(payoutPath+'/post',{confirm:'yes'})
  assert.equal(attempt.postings.filter(p=>p.state==='uncertain').length,1);assert.equal(edge.records.size,1)
  const uncertainId=attempt.postings.find(p=>p.state==='uncertain').request_id
  const posted=await h.api(payoutPath+'/post',{confirm:'yes'})
  assert.deepEqual(posted.postings.map(p=>p.state),['posted','posted','posted']);assert.equal(edge.records.size,3)
  assert.equal(edge.requests.filter(r=>r.requestId===uncertainId).length,3,'Refusal and interrupted acceptance recover with the same provider request ID')
  await h.api(payoutPath+'/post',{confirm:'yes'});assert.equal(edge.records.size,3);assert.equal(edge.requests.length,5,'A confirmed post never sends again')
  const remote=await h.get(payoutPath+'/remote')
  assert.deepEqual(remote.documents.map(d=>d.entity),['JournalEntry','JournalEntry','Deposit'])
  const deposit=remote.documents.find(d=>d.entity==='Deposit').record
  const amounts=deposit.Line.map(l=>[l.DepositLineDetail.AccountRef.value,Math.round(l.Amount*100),l.DepositLineDetail.ClassRef?.value])
  assert.deepEqual(amounts,[['housing',30000,'housing-class'],['fees',-900,'housing-class'],['meals',20000,'meals-class'],['fees',-610,'meals-class'],['reading',10000,'reading-class'],['fees',-320,'reading-class'],['stripe',-6500,'meals-class'],['stripe',-2500,'reading-class']])
  assert.equal(deposit.TxnDate,'2026-10-18');assert.deepEqual(remote.documents.filter(d=>d.entity==='JournalEntry').map(d=>d.record.TxnDate),['2026-10-17','2026-10-17']);assert.equal(deposit.DepositToAccountRef.value,'checking');assert.equal(deposit.DepartmentRef.value,'shared-location');assert.equal(Math.round(deposit.TotalAmt*100),49170)
  const journal=(id)=>remote.documents.find(d=>d.sourceId===id).record.Line.map(l=>[l.JournalEntryLineDetail.AccountRef.value,l.JournalEntryLineDetail.PostingType,Math.round(l.Amount*100),l.JournalEntryLineDetail.ClassRef.value,l.JournalEntryLineDetail.DepartmentRef.value])
  assert.deepEqual(journal('txn_qbo_refund'),[['reading','Debit',2500,'reading-class','shared-location'],['stripe','Credit',2500,'reading-class','shared-location']])
  assert.deepEqual(journal('txn_qbo_dispute'),[['meals','Debit',5000,'meals-class','shared-location'],['fees','Debit',1500,'meals-class','shared-location'],['stripe','Credit',6500,'meals-class','shared-location']])
  await h.command('fund.define',{name:'Meals',restriction:'purpose',detail:'Changed after QuickBooks submission'},{status:409})
  edge.corrupt=true;await h.get(payoutPath+'/remote',{status:502});edge.corrupt=false
  await postCheckInBrowser(h,batch.id)
  const batchPost=await h.api(batchPath+'/post',{confirm:'yes'});assert.equal(batchPost.postings.length,1);assert.equal(batchPost.postings[0].state,'posted')
  const checks=(await h.get(batchPath+'/remote')).documents
  assert.equal(checks.length,1);assert.equal(checks[0].record.TxnDate,'2026-10-17');assert.equal(Math.round(checks[0].record.TotalAmt*100),60000)
  assert.deepEqual(checks[0].record.Line.map(l=>[l.DepositLineDetail.AccountRef.value,Math.round(l.Amount*100),l.DepositLineDetail.ClassRef.value]),[['housing',30000,'housing-class'],['meals',20000,'meals-class'],['reading',10000,'reading-class']])
  await h.api(batchPath+'/post',{confirm:'yes'});assert.equal(edge.records.size,4);assert.equal(edge.requests.length,6)
  const report=await h.get('/api/coffer/payments/reconciliation?from=2026-10-01&to=2026-10-31')
  assert.deepEqual(report.funds.map(f=>[f.fund,f.accounting_cents]),[['Housing',59100],['Meals',32890],['Reading',17180]])
  await quickbooksBrowser(h,{payoutId:edge.payout.id,batchId:batch.id})
  const archived=await archive(h),raw=JSON.stringify(archived)
  assert.ok(!raw.includes('synthetic-coffer-access'));assert.ok(!raw.includes('synthetic-coffer-refresh'));assert.ok(!raw.includes('synthetic-coffer-1702'))
  const fresh=await installation({entry:'tests/fixed-clock-worker.ts',bindings,outbound:edge.outbound,givingProtection:false})
  try{
   await restore(fresh,archived)
   assert.equal((await fresh.get(root)).connection,null)
   assert.equal((await connectQuickbooks(fresh,edge,'9999999999')).response.status,409,'A restored claim cannot post into another company')
   assert.equal((await connectQuickbooks(fresh,edge)).response.status,303)
   await fresh.api(payoutPath+'/post',{confirm:'yes'});await fresh.api(batchPath+'/post',{confirm:'yes'})
   assert.equal(edge.records.size,4);assert.equal(edge.requests.length,6,'Restored confirmations never re-submit')
   assert.equal((await fresh.get(payoutPath+'/remote')).documents.length,3)
  }finally{await fresh.close()}
  const audit=await h.get('/api/coffer/audit?action=quickbooks.authorized')
  assert.equal(audit.total,2);assert.deepEqual(audit.rows.map(r=>[r.subject_id,r.actor_role,JSON.parse(r.detail).amountCents]).sort((a,b)=>a[2]-b[2]),[[edge.payout.id,'owner',49170],[batch.id,'owner',60000]])
  assert.equal((await h.get('/api/coffer/audit?action=quickbooks.posted')).total,4)
  await h.api(root+'/disconnect',{});assert.equal((await h.get(root)).connection,null)
 },{entry:'tests/fixed-clock-worker.ts',bindings,outbound:edge.outbound})
}
