import {test} from 'node:test'
import assert from 'node:assert/strict'
import {createHash,createHmac} from 'node:crypto'
import {run} from './harness.mjs'

const secret='whsec_payments_network_edge',at=Math.floor(Date.now()/1000)
const charge=(id,amount,fund,email,fee)=>({id,object:'charge',paid:true,status:'succeeded',amount,currency:'usd',created:at,metadata:{fund},billing_details:{name:email.split('@')[0],email},balance_transaction:'txn_'+id,amount_refunded:0,fee})
const a=charge('ch_reading',10000,'Reading','maria@example.test',320),b=charge('ch_meals',5000,'Meals','jonah@example.test',175)
const refund={id:'re_reading',object:'refund',status:'succeeded',charge:a.id,balance_transaction:'txn_refund'}
const transaction=(c)=>({id:c.balance_transaction,type:'charge',source:c.id,amount:c.amount,fee:c.fee,net:c.amount-c.fee,currency:'usd',created:at})
const entries=[transaction(a),transaction(b),{id:'txn_refund',type:'refund',source:refund,amount:-2500,fee:0,net:-2500,currency:'usd',created:at}]
const dispute={id:'dp_reading',charge:a.id,balance_transactions:[{id:'txn_dispute',type:'adjustment',source:'dp_reading',amount:-5000,fee:1500,net:-6500,currency:'usd',created:at}]}
const payout={id:'po_fund_split',status:'paid',arrival_date:at,amount:12005,currency:'usd',automatic:true,reconciliation_status:'completed'}
const manualCharge=charge('ch_manual',6000,'Reading','emily@example.test',210)
const manualEntry={...transaction(manualCharge),status:'available',available_on:at}
const manualPayout={id:'po_manual',status:'paid',created:at+1,arrival_date:at+1,amount:5790,currency:'usd',automatic:false}

async function deliver(h,id,type,objectId,{bad=false}={}) {
 const raw=JSON.stringify({id,type,data:{object:{id:objectId}}}),timestamp=Math.floor(Date.now()/1000)
 const sig=createHmac('sha256',bad?'invalid':secret).update(`${timestamp}.${raw}`).digest('hex')
 return h.mf.dispatchFetch(h.origin+'/api/coffer/giving/webhook',{method:'POST',headers:{host:new URL(h.origin).host,'stripe-signature':`t=${timestamp},v1=${sig}`},body:raw})
}

test('signed Stripe gifts, fees, refunds and payout reconcile by fund and post once to Pantry after approval',async()=>{
 let proposal=null,submissions=0,evidenceHash='',approved=false,providerCalls=0
 const outbound=async request=>{
  providerCalls++
  const u=new URL(request.url),path=u.pathname
  if(u.hostname==='api.stripe.com') {
   if(path==='/v1/charges/'+a.id)return Response.json(a)
   if(path==='/v1/charges/'+b.id)return Response.json(b)
   if(path==='/v1/charges/'+manualCharge.id)return Response.json(manualCharge)
   if(path==='/v1/refunds/'+refund.id)return Response.json(refund)
   if(path==='/v1/disputes/'+dispute.id)return Response.json(dispute)
   if(path==='/v1/payouts/'+payout.id)return Response.json(payout)
   if(path==='/v1/payouts/'+manualPayout.id)return Response.json(manualPayout)
   if(path==='/v1/balance_transactions/'+manualEntry.id)return Response.json(manualEntry)
   if(path==='/v1/balance_transactions') {
    assert.equal(u.searchParams.get('payout'),payout.id)
    // Exercise the provider pagination cursor rather than truncating at page 1.
    return Response.json(u.searchParams.has('starting_after')?{data:entries.slice(1),has_more:false}:{data:entries.slice(0,1),has_more:true})
   }
   const txn=entries.find(row=>path==='/v1/balance_transactions/'+row.id)
   if(txn)return Response.json(txn)
  } else if(u.hostname==='pantry.example.test') {
   assert.match(request.headers.get('authorization'),/^Bearer pantry_agent_/)
   if(path==='/api/pantry/agent/context')return Response.json({accounts:['bank','fees','reading','meals'].map(id=>({id,type:id==='bank'?'asset':id==='fees'?'expense':'income',subtype:id==='bank'?'bank':'other',active:1,revision:'revision-1'})),documents:[{id:'doc_payout',sha256:evidenceHash}],proposals:proposal?[proposal]:[]})
   if(path==='/api/pantry/agent/proposals'&&request.method==='POST') {
    submissions++
    const input=await request.json(),lines=input.payload.lines
    const value=x=>Math.round(Number(x)*100)
    assert.equal(lines.reduce((s,l)=>s+value(l.debit)-value(l.credit),0),0)
    assert.deepEqual(lines.filter(l=>['reading','meals'].includes(l.accountId)).map(l=>[l.accountId,l.credit]),[['meals','50.00'],['reading','75.00']])
    assert.equal(lines.find(l=>l.accountId==='bank').debit,'120.05')
    assert.equal(lines.filter(l=>l.accountId==='fees').reduce((s,l)=>s+value(l.debit),0),495)
    proposal={...input,id:'proposal_coffer',status:'proposed'}
    return Response.json(proposal)
   }
   if(path==='/api/pantry/agent/proposals/proposal_coffer')return Response.json({...proposal,status:approved?'approved':'proposed',result_kind:approved?'journal':null,result_id:approved?'journal_posted':null})
  }
  assert.fail(`Unexpected provider request ${request.method} ${u.origin}${path}`)
 }
 const bindings={STRIPE_SECRET_KEY:'sk_test_payments_edge',STRIPE_WEBHOOK_SECRET:secret,PANTRY_ORIGIN:'https://pantry.example.test',PANTRY_AGENT_TOKEN:'pantry_agent_'+'a'.repeat(43),PANTRY_DEPOSIT_ACCOUNT:'bank',PANTRY_FEE_ACCOUNT:'fees',PANTRY_FUND_ACCOUNTS:JSON.stringify({Reading:'reading',Meals:'meals'}),QBO_ACCOUNT_NAMES:JSON.stringify({bank:'Checking',fees:'Stripe fees',reading:'Reading donations',meals:'Meals donations'})}
 await run(async h=>{
  assert.equal((await deliver(h,'evt_bad','charge.succeeded',a.id,{bad:true})).status,400)
  assert.equal((await h.get('/api/coffer/donors')).total,0)
  for(const c of [a,b])assert.equal((await deliver(h,'evt_'+c.id,'charge.succeeded',c.id)).status,200)
  const donors=(await h.get('/api/coffer/donors')).donors,maria=donors.find(d=>d.email==='maria@example.test')
  const before=await h.get('/api/coffer/donors/'+maria.id),original=before.gifts[0]
  assert.equal(original.amount_cents,10000)
  for(const event of ['evt_refund','evt_refund','evt_refund_other_id'])assert.equal((await deliver(h,event,'refund.created',refund.id)).status,200)
  const after=await h.get('/api/coffer/donors/'+maria.id)
  assert.equal(after.totals.lifetimeCents,7500)
  assert.deepEqual(after.gifts.find(g=>g.id===original.id),{...original,reversed_by:null},'The original gift is immutable')
  assert.equal(after.gifts.filter(g=>g.kind==='reversal').length,1)
  assert.match(await (await h.request('/app')).text(),/\$125\.00/,'Today includes contribution refunds and leaves processing fees separate')
  await h.command('gift.reverse',{giftId:original.id,reason:'Refund already recorded by Stripe'},{status:409})
  assert.equal((await deliver(h,'evt_failed','charge.failed','ch_failed')).status,200)
  assert.equal((await deliver(h,'evt_payout','payout.paid',payout.id)).status,200)
  const view=await h.get('/api/coffer/payments/'+payout.id)
  assert.equal(view.payout.matched_cents,12005)
  assert.equal(view.payout.amount_cents,12005)
  assert.equal(view.lines.length,3)
  assert.deepEqual(view.splits.map(s=>[s.fund,s.gross_cents,s.fee_cents,s.net_cents]),[['Meals',5000,175,4825],['Reading',7500,320,7180]])
  assert.equal((await h.get('/api/coffer/payments')).failures.length,1)
  for(const endpoint of ['/app/payouts','/app/payouts/'+payout.id])assert.equal((await h.request(endpoint)).status,200)
  assert.equal((await h.request('/api/coffer/payments/'+payout.id,{as:''})).status,401)
  const member=await h.person('bookkeeper@example.test')
  await h.api('/api/coffer/payments/sync',{payoutId:payout.id},{as:member.cookie,status:403})
  const badOrigin=await h.request('/api/coffer/payments/sync',{method:'POST',body:{payoutId:payout.id},headers:{origin:'https://evil.example'}})
  assert.equal(badOrigin.status,403)
  const csv=await (await h.request('/api/coffer/payments/'+payout.id+'/evidence.csv')).text()
  evidenceHash=createHash('sha256').update(csv).digest('hex')
  const pending=await h.api('/api/coffer/payments/'+payout.id+'/post',{documentId:'doc_payout'})
  assert.equal(pending.state,'proposed')
  assert.equal(pending.external_id,null)
  const pendingAgain=await h.api('/api/coffer/payments/'+payout.id+'/post',{})
  assert.equal(pendingAgain.state,'proposed')
  assert.equal(submissions,1)
  approved=true
  const posted=await h.api('/api/coffer/payments/'+payout.id+'/post',{})
  assert.equal(posted.state,'posted')
  assert.equal(posted.external_id,'journal_posted')
  await h.api('/api/coffer/payments/'+payout.id+'/post',{})
  await h.api('/api/coffer/payments/sync',{payoutId:payout.id})
  assert.equal(submissions,1)
  const qbo=await h.request('/api/coffer/payments/'+payout.id+'/qbo.csv')
  assert.equal(qbo.status,200)
  assert.match(await qbo.text(),/Reading donations/)
  assert.equal((await h.request('/api/coffer/payments/'+payout.id+'/journal.iif')).status,200)
  await h.api('/api/coffer/payments/sync',{payoutId:manualPayout.id})
  assert.equal((await h.get('/api/coffer/payments/'+manualPayout.id)).payout.complete,0)
  await h.api('/api/coffer/payments/'+manualPayout.id+'/match',{entryIds:manualEntry.id,confirm:'no'},{status:400})
  const manual=await h.api('/api/coffer/payments/'+manualPayout.id+'/match',{entryIds:manualEntry.id,confirm:'yes'})
  assert.equal(manual.payout.complete,1)
  assert.equal(manual.payout.matched_cents,5790)
  const sameManual=await h.api('/api/coffer/payments/'+manualPayout.id+'/match',{entryIds:manualEntry.id,confirm:'yes'})
  assert.equal(sameManual.lines.length,1)
  // A dispute and its win are new financial lines, even after an older payout.
  assert.equal((await deliver(h,'evt_disputed','charge.dispute.created',dispute.id)).status,200)
  dispute.balance_transactions.push({id:'txn_dispute_won',type:'adjustment',source:'dp_reading',amount:5000,fee:-1500,net:6500,currency:'usd',created:at})
  assert.equal((await deliver(h,'evt_won','charge.dispute.closed',dispute.id)).status,200)
  assert.equal((await h.get('/api/coffer/donors/'+maria.id)).totals.lifetimeCents,7500)
  assert.equal((await h.get('/api/coffer/payments/'+payout.id)).payout.matched_cents,12005)
 },{bindings,outbound})
 const callsBeforeManaged=providerCalls
 await run(async h=>{
  const reply=await h.api('/api/coffer/payments/sync',{payoutId:payout.id},{status:503})
  assert.equal(reply.error,'not_available')
  assert.match(reply.message,/not available yet/)
  assert.equal((await deliver(h,'evt_managed','charge.succeeded',a.id)).status,503)
  const screen=await h.request('/app/payouts')
  assert.equal(screen.status,200)
  assert.match(await screen.text(),/Stripe and Pantry are not available yet on RER Managed/)
 },{bindings:{...bindings,RER_INSTALLATION_ID:'managed-test',RER_MANAGEMENT_ORIGIN:'https://runeditrun.com'},outbound})
 assert.equal(providerCalls,callsBeforeManaged)
})
