import assert from 'node:assert/strict'
import {run,donor,reviewed,archive,restore,installation} from './harness.mjs'
import {quickbooksEdge} from './quickbooks/edge.mjs'
import {connectQuickbooks} from './quickbooks/journey.mjs'
import {agentQuickbooksBrowser} from './agent-quickbooks-browser.mjs'

const root='/api/coffer/payments/quickbooks',check='/api/coffer/agent/reconcile/quickbooks/run'
const mapping={version:0,bank:'checking',stripe:'stripe',fees:'fees',funds:{Housing:{accountId:'housing',classId:'housing-class',locationId:'shared-location'},Meals:{accountId:'meals',classId:'meals-class',locationId:'shared-location'},Reading:{accountId:'reading',classId:'reading-class',locationId:'shared-location'}}}
const open=result=>result.issues.filter(i=>i.kind.startsWith('quickbooks_')&&i.state==='open')
export async function agentQuickbooksJourney(){
 const edge=quickbooksEdge(),bindings={QBO_CLIENT_ID:'synthetic-coffer-1701',QBO_CLIENT_SECRET:'synthetic-coffer-1702',QBO_SANDBOX:'true',STRIPE_SECRET_KEY:'synthetic-coffer-1801'}
 edge.expiresIn=3600
 const mutations=new Map(),reads=[]
 let readFailure=null,readOverride=null,readonly=false
 const outbound=async request=>{
  const u=new URL(request.url),accounting=u.hostname==='sandbox-quickbooks.api.intuit.com'
  if(accounting){
   if(readonly)assert.equal(request.method,'GET','The agent must never submit accounting entries')
   if(request.method==='GET'&&/\/(deposit|journalentry)\//.test(u.pathname)){
    reads.push(u.pathname)
    if(readFailure)return Response.json({Fault:{Error:[{code:readFailure===404?'610':'synthetic-coffer-unavailable'}]}},{status:readFailure})
    if(readOverride)return Response.json(readOverride)
    const response=await edge.outbound(request),body=await response.json(),entity=u.pathname.includes('journalentry')?'JournalEntry':'Deposit'
    const mutation=mutations.get(body[entity].Id)
    body[entity].PrivateNote='Synthetic private supporter note'
    if(mutation)mutation(body[entity])
    return Response.json(body)
   }
  }
  return edge.outbound(request)
 }
 await run(async h=>{
  await reviewed(h)
  assert.equal((await h.api(check,{})).complete,false,'An unconnected read is incomplete')
  await h.api('/api/coffer/payments/sync',{payoutId:edge.payout.id})
  const d=await donor(h,'Synthetic Coffer Accounting',{email:null})
  const batch=await h.command('giftBatch.create',{name:'Synthetic coffer checks',receivedOn:'2026-10-17',fund:'Reading',method:'check',expected:'600'})
  let version=1
  for(const [fund,amount] of [['Reading','100'],['Meals','200'],['Housing','300']])version=(await h.command('giftBatch.add',{batchId:batch.id,version,donorId:d.id,amount,reference:'synthetic-coffer-check-'+fund,goods:'none',fund})).version
  await h.command('giftBatch.close',{batchId:batch.id,version})
  const member=await h.person(['synthetic-coffer-member','example.test'].join('@'))
  const admin=await h.person(['synthetic-coffer-admin','example.test'].join('@'),'admin')
  const key=await h.command('agent.create',{label:'Synthetic accounting preparation'})
  for(const options of [{as:'',status:401},{as:member.cookie,status:403},{as:admin.cookie,status:403},{as:'',headers:{authorization:'Bearer '+key.token},status:403}])await h.api(check,{},options)
  const foreign=await h.request(check,{method:'POST',body:{},headers:{origin:'https://synthetic-coffer-foreign.test'}})
  assert.equal(foreign.status,403)
  assert.equal(reads.length,0);assert.equal(edge.requests.length,0)
  assert.equal((await connectQuickbooks(h,edge)).response.status,303)
  await h.api(root+'/mapping',mapping)
  const payoutPath=root+'/payout/'+edge.payout.id,batchPath=root+'/batch/'+batch.id
  readonly=true
  let result=await h.api(check,{})
  assert.equal(result.complete,false);assert.equal(result.checkedSources,2);assert.equal(result.checkedDocuments,4)
  assert.equal(open(result).filter(i=>i.kind==='quickbooks_missing').length,4,'Absent payout, batch, refund and dispute claims are review-only')
  const absent=open(result)[0]
  await h.api('/api/coffer/agent/reconcile/apply',{id:absent.id},{status:409})
  await h.api('/api/coffer/agent/reconcile/approve',{id:absent.id,action:'apply',fingerprint:absent.fingerprint,financeLead:'yes'},{status:409})
  assert.equal(edge.requests.length,0)
  readonly=false;edge.refuse=true
  let attempt=await h.api(payoutPath+'/post',{confirm:'yes'})
  readonly=true
  result=await h.api(check,{})
  const failed=open(result).find(i=>i.kind==='quickbooks_failed')
  assert.equal(failed.evidence.posting.state,'failed');assert.equal(failed.evidence.posting.requestId,attempt.postings.find(p=>p.state==='failed').request_id)
  const submissions=edge.requests.length
  await h.api(check,{});assert.equal(edge.requests.length,submissions,'An agent run never retries a failed posting')
  readonly=false;edge.refuse=false;edge.lose=true
  attempt=await h.api(payoutPath+'/post',{confirm:'yes'})
  readonly=true
  result=await h.api(check,{})
  const uncertain=open(result).find(i=>i.kind==='quickbooks_uncertain')
  assert.equal(uncertain.evidence.posting.state,'uncertain');assert.equal(uncertain.evidence.posting.requestId,attempt.postings.find(p=>p.state==='uncertain').request_id)
  await h.api(check,{});assert.equal(edge.requests.length,submissions+1,'Uncertainty is never recovered by the agent')
  readonly=false
  await h.api(payoutPath+'/post',{confirm:'yes'});await h.api(batchPath+'/post',{confirm:'yes'})
  const writes=edge.requests.length,claims=[...(await h.get(payoutPath)).postings,...(await h.get(batchPath)).postings]
  const moneyBefore=await h.get('/api/coffer/payments/reconciliation?from=2026-10-01&to=2026-10-31')
  const find=kind=>claims.find(p=>p.kind===kind),refund=claims.find(p=>p.source_id==='txn_qbo_refund'),dispute=claims.find(p=>p.source_id==='txn_qbo_dispute')
  // Four independent remote facts: bank, batch fund, refund cents, dispute fees.
  mutations.set(find('payout').external_id,record=>{record.DepositToAccountRef.value='synthetic-coffer-other-bank'})
  mutations.set(find('batch').external_id,record=>{record.Line[0].DepositLineDetail.ClassRef.value='synthetic-coffer-other-fund'})
  mutations.set(refund.external_id,record=>{record.Line[0].Amount=24.99})
  mutations.set(dispute.external_id,record=>{record.Line.find(l=>l.JournalEntryLineDetail.AccountRef.value==='fees').Amount=14.99})
  readonly=true
  result=await h.api(check,{})
  const changed=open(result).filter(i=>i.kind==='quickbooks_changed')
  assert.equal(result.complete,true,'A completed comparison can contain discrepancies')
  assert.equal(changed.length,4)
  assert.equal(JSON.stringify(changed).includes('Synthetic private supporter note'),false,'Unrelated private remote content is not retained')
  assert.deepEqual(changed.map(i=>i.evidence.document.sourceId).sort(),[edge.payout.id,batch.id,'txn_qbo_refund','txn_qbo_dispute'].sort())
  assert.deepEqual(changed.find(i=>i.evidence.document.kind==='payout').evidence.differences,['bank'])
  assert.equal(changed.find(i=>i.evidence.document.kind==='payout').evidence.expected.totalCents,49170)
  assert.equal(changed.find(i=>i.evidence.document.sourceId==='txn_qbo_refund').evidence.remote.lines.find(l=>l.account==='reading').cents,2499)
  for(const issue of changed){
   assert.equal(issue.proposed.action,'review');assert.ok(issue.why.length);assert.ok(issue.evidence.posting.requestId)
   assert.ok(issue.evidence.remote.id);assert.equal(issue.evidence.document.entity,issue.evidence.document.kind==='adjustment'?'JournalEntry':'Deposit')
   const source=await h.get(issue.evidence.source.url);assert.ok(source)
   assert.equal((await h.request(issue.evidence.source.reviewUrl)).status,200)
   await h.api('/api/coffer/agent/reconcile/apply',{id:issue.id},{status:409})
   await h.api('/api/coffer/agent/reconcile/approve',{id:issue.id,action:'apply',fingerprint:issue.fingerprint,financeLead:'yes'},{status:409})
  }
  const ids=changed.map(i=>i.id).sort()
  assert.deepEqual(open(await h.api(check,{})).filter(i=>i.kind==='quickbooks_changed').map(i=>i.id).sort(),ids,'Replay updates the same open findings')
  const adminView=await h.get('/api/coffer/agent/reconcile',{as:admin.cookie})
  assert.equal(adminView.quickbooksRun,null);assert.equal(adminView.issues.some(i=>i.kind.startsWith('quickbooks_')),false)
  await agentQuickbooksBrowser(h,{phase:'changed',expected:/complete: 2 sources and 4 documents/})
  mutations.clear()
  for(const unavailable of [503,404]){
   readFailure=unavailable;result=await h.api(check,{})
   assert.equal(result.complete,false)
   assert.deepEqual(open(result).filter(i=>i.kind==='quickbooks_changed').map(i=>i.id).sort(),ids,'An unavailable or absent read never resolves an earlier exception')
  }
  readFailure=null;readOverride={Deposit:{Id:find('payout').external_id,Line:[]}}
  result=await h.api(check,{})
  assert.equal(result.complete,false);assert.equal(open(result).filter(i=>i.kind==='quickbooks_changed').length,4)
  await agentQuickbooksBrowser(h,{phase:'incomplete',expected:/incomplete: 2 sources and 4 documents/})
  readOverride=null
  result=await h.api(check,{})
  assert.equal(result.complete,true);assert.equal(open(result).length,0,'Only corrected complete independent reads resolve earlier findings')
  mutations.set(find('payout').external_id,record=>{record.DocNumber='synthetic-coffer-other-source'})
  const wrongSource=open(await h.api(check,{})).find(i=>i.kind==='quickbooks_changed')
  assert.deepEqual(wrongSource.evidence.differences,['source'],'Remote source identity must match the approved request')
  mutations.clear()
  assert.equal(open(await h.api(check,{})).length,0)
  assert.equal(edge.requests.length,writes)
  assert.deepEqual([...(await h.get(payoutPath)).postings,...(await h.get(batchPath)).postings],claims,'The agent never rewrites posting claims')
  assert.deepEqual(await h.get('/api/coffer/payments/reconciliation?from=2026-10-01&to=2026-10-31'),moneyBefore,'The agent never changes ledger or accounting totals')
  await agentQuickbooksBrowser(h,{phase:'recovered',expected:/complete: 2 sources and 4 documents/})
  const qboReads=reads.length
  await h.api('/api/coffer/agent/reconcile/run',{})
  assert.equal(reads.length,qboReads,'Existing reconciliation does not acquire background QuickBooks access')
  const saved=await archive(h),fresh=await installation({entry:'tests/fixed-clock-worker.ts',bindings,outbound,givingProtection:false})
  try{
   await restore(fresh,saved)
   result=await fresh.api(check,{})
   assert.equal(result.complete,false,'Restored archives have no connection authority')
   assert.equal((await connectQuickbooks(fresh,edge)).response.status,303)
   assert.equal((await fresh.api(check,{})).complete,true)
   assert.equal(edge.requests.length,writes,'Restore reads never resubmit accounting entries')
  }finally{await fresh.close()}
  await h.command('donor.erase',{donorId:d.id,confirm:'ERASE'})
  assert.equal((await h.api(check,{})).complete,true)
  assert.equal(JSON.stringify((await h.get('/api/coffer/agent/reconcile')).issues).includes('Synthetic Coffer Accounting'),false,'Replayed accounting observations cannot resurrect erased donor identity')
  assert.equal(edge.requests.length,writes)
  await h.api(root+'/disconnect',{})
  const beforeRevoked=reads.length
  result=await h.api(check,{})
  assert.equal(result.complete,false);assert.equal(reads.length,beforeRevoked,'Revoked connection makes no provider read')
  await h.api(payoutPath+'/post',{confirm:'yes'},{status:409})
  assert.equal(edge.requests.length,writes)
  assert.equal((await connectQuickbooks(h,edge)).response.status,303)
  const beforeSignout=reads.length
  assert.equal((await h.request('/auth/signout',{method:'POST',body:{}})).status,204)
  await h.api(check,{}, {status:401})
  assert.equal(reads.length,beforeSignout,'A revoked owner session has no QuickBooks read authority')
 },{entry:'tests/fixed-clock-worker.ts',bindings,outbound})
}
