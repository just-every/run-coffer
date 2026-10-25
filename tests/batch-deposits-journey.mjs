import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {run,donor,reviewed,archive,restore,installation} from './harness.mjs'

export async function batchDepositsJourney(){
 let evidenceHash='',proposal=null,submissions=0,approved=false
 const bindings={PANTRY_ORIGIN:'https://pantry.example.test',PANTRY_AGENT_TOKEN:'pantry_agent_'+Buffer.from('synthetic-coffer-1601').toString('hex'),PANTRY_DEPOSIT_ACCOUNT:'bank',PANTRY_FEE_ACCOUNT:'fees',PANTRY_FUND_ACCOUNTS:JSON.stringify({Housing:'housing'})}
 const outbound=async request=>{
  const u=new URL(request.url);assert.equal(u.hostname,'pantry.example.test')
  if(u.pathname==='/api/pantry/agent/context')return Response.json({accounts:['bank','housing'].map(id=>({id,type:id==='bank'?'asset':'income',subtype:id==='bank'?'bank':'other',active:1,revision:'synthetic-coffer-1602'})),documents:[{id:'synthetic-coffer-1603',sha256:evidenceHash}],proposals:proposal?[proposal]:[]})
  if(request.method==='POST'){
   submissions++
   proposal={...await request.json(),id:'synthetic-coffer-1604',status:'proposed'}
   assert.deepEqual(proposal.payload.lines.map(l=>[l.accountId,l.debit,l.credit]),[['bank','125.00','0.00'],['housing','0.00','125.00']])
   assert.match(proposal.payload.lines[1].memo,/Purpose restricted: Emergency housing/)
   // The provider accepted the proposal, but its success response was lost.
   return new Response('Unavailable',{status:502})
  }
  assert.equal(u.pathname,'/api/pantry/agent/proposals/'+proposal.id)
  return Response.json({...proposal,status:approved?'approved':'proposed',result_kind:approved?'journal':null,result_id:approved?'synthetic-coffer-1605':null})
 }
 await run(async h=>{
  await reviewed(h)
  await h.command('fund.define',{name:'Housing',restriction:'purpose',detail:'Emergency housing'})
  const d=await donor(h,'Ava Thompson'),batch=await h.command('giftBatch.create',{name:'Community housing checks',receivedOn:'2026-10-17',fund:'Housing',method:'check',expected:'125'})
  const path='/api/coffer/payments/batches/'+batch.id
  await h.api(path+'/post',{documentId:'synthetic-coffer-1603'},{status:409})
  const row=await h.command('giftBatch.add',{batchId:batch.id,version:1,donorId:d.id,amount:'125',reference:'4471',goods:'none'})
  await h.command('giftBatch.close',{batchId:batch.id,version:row.version})
  const member=await h.person('synthetic-coffer-1606@example.test'),admin=await h.person('synthetic-coffer-1607@example.test','admin')
  for(const as of ['',member.cookie]){
   const status=as?403:401
   await h.get(path,{as,status});await h.api(path+'/post',{}, {as,status})
   assert.equal((await h.request(path+'/evidence.csv',{as})).status,status)
  }
  const bad=await h.request(path+'/post',{method:'POST',body:{documentId:'synthetic-coffer-1603'},headers:{origin:'https://foreign.example.test'}});assert.equal(bad.status,403)
  const before=await h.get(path,{as:admin.cookie});assert.equal(before.batch.expected_cents,12500);assert.equal(before.posting,null)
  const csv=await (await h.request(path+'/evidence.csv')).text();assert.match(csv,/4471/);assert.match(csv,/125.00/)
  await h.api(path+'/post',{documentId:'synthetic-coffer-1603'},{status:409});assert.equal(submissions,0,'Wrong evidence cannot create a submission')
  evidenceHash=createHash('sha256').update(csv).digest('hex')
  const uncertain=await h.api(path+'/post',{documentId:'synthetic-coffer-1603'},{as:admin.cookie});assert.equal(uncertain.state,'uncertain');assert.equal(uncertain.external_id,null)
  const pending=await h.api(path+'/post',{});assert.equal(pending.state,'proposed');assert.equal(submissions,1,'Refresh recovers the saved claim without resending')
  await h.api(path+'/post',{});assert.equal(submissions,1)
  const reportPath='/api/coffer/payments/reconciliation?from=2026-10-01&to=2026-10-31'
  let report=await h.get(reportPath);assert.equal(report.funds[0].accounting_cents,0);assert.ok(report.differences.some(d=>d.sourceId===batch.id&&d.stage==='deposit_to_accounting'))
  approved=true
  const posted=await h.api(path+'/post',{});assert.equal(posted.state,'posted');assert.equal(posted.external_id,'synthetic-coffer-1605')
  await h.api(path+'/post',{});assert.equal(submissions,1)
  report=await h.get(reportPath);assert.equal(report.funds[0].accounting_cents,12500);assert.ok(!report.differences.some(d=>d.sourceId===batch.id&&d.stage==='deposit_to_accounting'))
  for(const f of report.funds)for(const [stage,left,right] of [['ledger_to_processor','ledger_cents','processor_cents'],['processor_to_deposit','processor_cents','deposited_cents'],['deposit_to_accounting','deposited_cents','accounting_cents']])assert.equal(report.differences.filter(d=>d.fund===f.fund&&d.stage===stage).reduce((n,d)=>n+d.amount_cents,0),f[left]-f[right])
  const fresh=await installation({entry:'tests/fixed-clock-worker.ts',bindings,outbound})
  try{await restore(fresh,await archive(h));assert.equal((await fresh.get(path)).posting.external_id,posted.external_id);await fresh.api(path+'/post',{});assert.equal(submissions,1)}finally{await fresh.close()}
 },{entry:'tests/fixed-clock-worker.ts',bindings,outbound})
}
