import {test} from 'node:test'
import assert from 'node:assert/strict'
import {run} from './harness.mjs'

const at=Math.floor(Date.now()/1000)-3600
const saved={id:'ch_ReconcileA',object:'charge',amount:10000,amount_refunded:1000,currency:'usd',paid:true,status:'succeeded',created:at,customer:'cus_Reconcile',metadata:{fund:'Reading'},billing_details:{email:'reconcile@example.test',name:'River Donor'}}
const missing={id:'ch_ReconcileB',object:'charge',amount:4000,amount_refunded:0,currency:'usd',paid:true,status:'succeeded',created:at,metadata:{fund:'Meals'},billing_details:{email:'new@example.test',name:'New Donor'}}
const customer={id:'cus_Reconcile',object:'customer',name:'River Donor',email:'reconcile@example.test',created:at}

test('HTTP reconciliation corrects refunded amount and fund, syncs a missing charge, and undoes through immutable compensation',async()=>{
 let live={...saved,amount_refunded:2000,metadata:{fund:'Meals'}},calls=[],chargePages=0,payoutPages=0
 const outbound=async request=>{
  assert.equal(request.method,'GET','Reconciliation never charges, refunds or submits an external deposit')
  const u=new URL(request.url);calls.push(u.pathname)
  if(u.pathname==='/v1/charges') {
   chargePages++
   return Response.json(u.searchParams.has('starting_after')?{data:[missing],has_more:false}:{data:[live],has_more:true})
  }
  if(u.pathname==='/v1/payouts') {payoutPages++;return Response.json(u.searchParams.has('starting_after')?{data:[{id:'po_ReconcileB',amount:4000,currency:'usd',status:'paid'}],has_more:false}:{data:[{id:'po_ReconcileA',amount:8000,currency:'usd',status:'paid'}],has_more:true})}
  if(u.pathname==='/v1/charges/'+live.id)return Response.json(live)
  if(u.pathname==='/v1/charges/'+missing.id)return Response.json(missing)
  assert.fail(`Unexpected provider request ${request.url}`)
 }
 await run(async h=>{
  const input={customers:[{object:'list',data:[customer]}],charges:[{object:'list',data:[saved]}],noGoodsOrServices:true}
  const plan=await h.api('/api/coffer/imports/preview',input)
  let job=await h.api('/api/coffer/imports/apply',{...input,fingerprint:plan.fingerprint})
  while(job.state!=='completed')job=await h.api('/api/coffer/imports/resume',{id:job.id})
  const donor=(await h.get('/api/coffer/donors')).donors[0],before=await h.get('/api/coffer/donors/'+donor.id),original=before.gifts[0]
  assert.equal(before.totals.lifetimeCents,9000)
  await h.api('/api/coffer/agent/reconcile/run',{}, {as:'',status:401})
  const member=await h.person('member-reconcile@example.test')
  await h.api('/api/coffer/agent/reconcile/run',{}, {as:member.cookie,status:403})
  const result=await h.api('/api/coffer/agent/reconcile/run',{})
  assert.equal(result.checkedCharges,2);assert.equal(result.checkedPayouts,2)
  assert.equal(chargePages,2);assert.equal(payoutPages,2)
  const issue=result.issues.find(i=>i.kind==='contribution'),absent=result.issues.find(i=>i.kind==='missing_gift')
  assert.deepEqual(issue.proposed.changes,[{fund:'Meals',cents:8000},{fund:'Reading',cents:-9000}])
  assert.equal(issue.evidence.gift.id,original.id)
  assert.equal(JSON.stringify(result.issues).includes(customer.email),false,'Evidence stores source IDs and amounts without donor PII')
  const screen=await h.request('/app/agent/reconcile');assert.equal(screen.status,200)
  await h.api('/api/coffer/agent/reconcile/apply',{id:issue.id},{as:member.cookie,status:403})
  live={...live,amount_refunded:2500}
  await h.api('/api/coffer/agent/reconcile/apply',{id:issue.id},{status:409})
  assert.equal((await h.get('/api/coffer/donors/'+donor.id)).totals.lifetimeCents,9000)
  live={...live,amount_refunded:2000}
  await h.api('/api/coffer/agent/reconcile/apply',{id:issue.id})
  await h.api('/api/coffer/agent/reconcile/apply',{id:issue.id},{status:409})
  const corrected=await h.get('/api/coffer/donors/'+donor.id)
  assert.equal(corrected.totals.lifetimeCents,8000)
  assert.deepEqual(corrected.gifts.find(g=>g.id===original.id),{...original,reversed_by:null})
  const clean=await h.api('/api/coffer/agent/reconcile/run',{})
  assert.equal(clean.issues.filter(i=>i.kind==='contribution'&&i.state==='open').length,0)
  const synced=await h.api('/api/coffer/agent/reconcile/apply',{id:absent.id})
  const newDonor=(await h.get('/api/coffer/donors')).donors.find(d=>d.email==='new@example.test')
  assert.equal((await h.get('/api/coffer/donors/'+newDonor.id)).totals.lifetimeCents,4000)
  assert.ok(synced.giftId)
  await h.api('/api/coffer/agent/reconcile/undo',{id:absent.id})
  assert.equal((await h.get('/api/coffer/donors/'+newDonor.id)).totals.lifetimeCents,0)
  await h.api('/api/coffer/agent/reconcile/undo',{id:issue.id})
  await h.api('/api/coffer/agent/reconcile/undo',{id:issue.id},{status:409})
  assert.equal((await h.get('/api/coffer/donors/'+donor.id)).totals.lifetimeCents,9000)
  const final=(await h.api('/api/coffer/agent/reconcile/run',{})).issues.find(i=>i.kind==='contribution'&&i.state==='open'&&i.source_id===saved.id)
  assert.deepEqual(final.proposed.changes,issue.proposed.changes,'Undo restores the previous fund allocation as well as its amount')
  assert.equal(final.evidence.entries.length,4,'Corrections and their opposites remain as immutable lines')
 },{bindings:{STRIPE_SECRET_KEY:'synthetic-coffer-1501'},outbound})
 const beforeManaged=calls.length
 await run(async h=>{
  const result=await h.api('/api/coffer/agent/reconcile/run',{})
  assert.equal(result.unavailable.length,1);assert.match(result.unavailable[0],/not available yet on RER Managed/)
 },{bindings:{STRIPE_SECRET_KEY:'synthetic-coffer-1501',RER_INSTALLATION_ID:'managed-reconcile',RER_MANAGEMENT_ORIGIN:'https://runeditrun.com'},outbound})
 assert.equal(calls.length,beforeManaged)
})

test('reconciliation verifies Pantry exact payload and posted journal without submitting twice',async()=>{
 const {createHash}=await import('node:crypto')
 const charge={...missing,id:'ch_PantryReconcile',amount:4000,balance_transaction:'txn_pantry_reconcile'}
 const txn={id:charge.balance_transaction,type:'charge',source:charge.id,amount:4000,fee:100,net:3900,currency:'usd',created:at}
 const payout={id:'po_PantryReconcile',amount:3900,status:'paid',currency:'usd',arrival_date:at,automatic:true,reconciliation_status:'completed'}
 let proposal=null,hash='',submissions=0,changed=false
 const outbound=async request=>{
  const u=new URL(request.url)
  if(u.hostname==='api.stripe.com') {
   if(u.pathname==='/v1/charges')return Response.json({data:[charge],has_more:false})
   if(u.pathname==='/v1/payouts')return Response.json({data:[payout],has_more:false})
   if(u.pathname==='/v1/charges/'+charge.id)return Response.json(charge)
   if(u.pathname==='/v1/payouts/'+payout.id)return Response.json(payout)
   if(u.pathname==='/v1/balance_transactions')return Response.json({data:[txn],has_more:false})
  }
  if(u.hostname==='pantry.example.test') {
   if(u.pathname==='/api/pantry/agent/context')return Response.json({accounts:['bank','fees','meals'].map(id=>({id,type:id==='bank'?'asset':id==='fees'?'expense':'income',subtype:id==='bank'?'bank':'other',active:1,revision:'r1'})),documents:[{id:'doc_reconcile',sha256:hash}],proposals:proposal?[proposal]:[]})
   if(u.pathname==='/api/pantry/agent/proposals' && request.method==='POST') {
    submissions++;proposal={...await request.json(),id:'proposal_reconcile',status:'proposed'};return Response.json(proposal)
   }
   if(u.pathname==='/api/pantry/agent/proposals/proposal_reconcile')return Response.json({...proposal,status:'approved',result_kind:'journal',result_id:'journal_reconcile',...(changed?{payload:{...proposal.payload,date:'2000-01-01'}}:{})})
  }
  assert.fail(`Unexpected provider request ${request.url}`)
 }
 await run(async h=>{
  await h.api('/api/coffer/payments/sync',{payoutId:payout.id})
  let result=await h.api('/api/coffer/agent/reconcile/run',{})
  assert.ok(result.issues.find(i=>i.kind==='pantry_posting'&&i.state==='open'))
  const csv=await (await h.request('/api/coffer/payments/'+payout.id+'/evidence.csv')).text()
  hash=createHash('sha256').update(csv).digest('hex')
  assert.equal((await h.api('/api/coffer/payments/'+payout.id+'/post',{documentId:'doc_reconcile'})).state,'proposed')
  result=await h.api('/api/coffer/agent/reconcile/run',{})
  assert.equal(result.issues.filter(i=>i.kind==='pantry_posting'&&i.state==='open').length,0)
  const posted=(await h.get('/api/coffer/payments/'+payout.id)).posting
  assert.equal(posted.state,'posted');assert.equal(posted.external_id,'journal_reconcile')
  changed=true
  result=await h.api('/api/coffer/agent/reconcile/run',{})
  assert.ok(result.issues.find(i=>i.kind==='pantry_posting'&&i.state==='open'),'A changed payload is surfaced even for a previously posted journal')
  assert.equal((await h.get('/api/coffer/payments/'+payout.id)).posting.external_id,'journal_reconcile')
  assert.equal(submissions,1)
 },{outbound,bindings:{STRIPE_SECRET_KEY:'synthetic-coffer-1502',PANTRY_ORIGIN:'https://pantry.example.test',PANTRY_AGENT_TOKEN:'pantry_agent_'+'a'.repeat(43),PANTRY_DEPOSIT_ACCOUNT:'bank',PANTRY_FEE_ACCOUNT:'fees',PANTRY_FUND_ACCOUNTS:JSON.stringify({Meals:'meals'})}})
})
