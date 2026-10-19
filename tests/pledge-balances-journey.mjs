import assert from 'node:assert/strict'
import {createHmac,randomUUID} from 'node:crypto'
import {run,donor,archive,restore,reviewed,settings} from './harness.mjs'
const secret='whsec_pledge_edge'
const form=values=>({method:'POST',as:'',headers:{'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams(values).toString()})

export async function pledgeBalancesJourney(){
 const edge={intent:null,invoice:'in_pledge_1',calls:0}
 const send=async(h,id,type,objectId)=>{
  const raw=JSON.stringify({id,type,data:{object:{id:objectId}}}),t=Math.floor(Date.now()/1000)
  const signature=createHmac('sha256',secret).update(`${t}.${raw}`).digest('hex')
  const response=await h.request('/api/coffer/giving/webhook',{method:'POST',as:'',raw,headers:{'stripe-signature':`t=${t},v1=${signature}`}})
  assert.equal(response.status,200,await response.text())
 }
 await run(async h=>{
  const ana=await donor(h,'Ana Quarterly Pledge'),other=await donor(h,'Other Pledge Donor')
  const campaign=await h.api('/api/coffer/giving/campaigns',{name:'Library expansion',slug:'library-pledge',description:'New shelves, tutoring and books for neighbors.',fund:'Library',goal:'60000'})
  const input={donorId:ana.id,amount:'12000',pledgedOn:'2025-01-01',fund:'Library',campaignId:campaign.id,installments:['2025-01-15','2025-04-15','2025-07-15','2025-10-15'].map(dueOn=>({dueOn,amount:'3000'}))}
  const created=await h.command('pledge.create',input)
  const current=async()=> (await h.get('/api/coffer/donors/'+ana.id)).pledges.find(p=>p.id===created.id)
  const pay=installmentId=>h.command('gift.record',{donorId:ana.id,amount:'3000',receivedOn:'2025-06-01',method:'check',goods:'none',fund:'Library',installmentId})
  let p=await current();assert.equal(p.amount_cents,1200000);assert.equal(p.campaign_id,campaign.id)
  await pay(p.installments[0].id);await pay(p.installments[1].id)
  p=await current();assert.deepEqual(p.installments.map(i=>[i.paid_cents,i.remaining_cents]),[[300000,0],[300000,0],[0,300000],[0,300000]])
  assert.equal(p.installments[2].overdue_cents,300000);assert.equal(p.installments[2].due_cents,300000)
  const page=await h.request('/app/donors/'+ana.id);assert.equal(page.status,200)
  const html=await page.text();assert.match(html,/Overdue/);assert.ok(html.includes('$6,000.00 still to come'))
  await reviewed(h)
  await h.command('settings.update',{...settings,version:(await h.get('/api/coffer/settings')).version,onlineReceipts:'review'})
  const receipt=await h.command('ack.prepare',{}),approved=await h.command('ack.approve',{batchId:receipt.id,version:1})
  const exported=await h.command('ack.export',{batchId:receipt.id,version:approved.version})
  await h.command('ack.markSent',{batchId:receipt.id,version:exported.version,sentOn:new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date()),method:'mail'})
  const issued=(await h.get('/api/coffer/letters/'+receipt.id)).letters
  const stale=p.version
  await h.command('pledge.reduce',{pledgeId:p.id,version:p.version,amount:'1500',reason:''},{status:400})
  await h.command('pledge.reduce',{pledgeId:p.id,version:p.version,amount:'6500',reason:'Too much'},{status:409})
  await h.command('pledge.reduce',{pledgeId:p.id,version:p.version,amount:'1500',reason:'Donor revised the building commitment.'},{as:'',status:401})
  await h.command('pledge.reduce',{pledgeId:p.id,version:p.version,amount:'1500',reason:'Donor revised the building commitment.'})
  await h.command('pledge.writeOff',{pledgeId:p.id,version:stale,reason:'Stale form'},{status:409})
  p=await current();assert.equal(p.amount_cents,1200000);assert.equal(p.reduced_cents,150000);assert.equal(p.remaining_cents,450000)
  assert.equal(p.installments[2].remaining_cents,300000);assert.equal(p.installments[3].remaining_cents,150000)
  assert.equal(p.adjustments[0].reason,'Donor revised the building commitment.');assert.equal(p.adjustments[0].created_by,'Morgan Lee')
  const report=await h.get('/api/coffer/giving/campaigns/'+campaign.id);assert.equal(report.pledgedOutstandingCents,450000);assert.equal(report.pledges[0].reduced_cents,150000)
  assert.equal((await h.get('/api/coffer/donors/'+ana.id)).summary.openPledgeCents,450000)
  assert.equal((await h.get('/api/coffer/tasks')).sources.filter(s=>s.kind==='pledge'&&s.donorId===ana.id).reduce((n,s)=>n+s.amountCents,0),450000)
  // All supported cadences are explicit dated schedules; no guessed period length.
  const member=await h.person('pledges.staff@example.test')
  for(const dates of [['2025-02-01'],['2025-02-01','2025-03-01'],['2025-02-01','2026-02-01']]){
   const more=await h.command('pledge.create',{donorId:other.id,amount:String(dates.length*10),pledgedOn:'2025-01-01',fund:'Library',installments:dates.map(dueOn=>({dueOn,amount:'10'}))})
   const old=(await h.get('/api/coffer/donors/'+other.id)).pledges.find(p=>p.id===more.id)
   await h.command('pledge.writeOff',{pledgeId:old.id,version:old.version,reason:'Written commitment canceled.'},{as:member.cookie})
   const after=(await h.get('/api/coffer/donors/'+other.id)).pledges.find(p=>p.id===more.id)
   assert.equal(after.remaining_cents,0);assert.equal(after.reduced_cents,dates.length*1000);assert.equal(after.adjustments.every(a=>a.kind==='write_off'),true)
  }
  const checkout=await h.request('/give/library-pledge/checkout',form({name:'Ana Quarterly Pledge',email:'ana.quarterly.pledge@example.org',amount:'2500',frequency:'monthly',requestId:randomUUID()}));assert.equal(checkout.status,303,await checkout.text())
  await send(h,'evt_pledge_sub','customer.subscription.created','sub_pledge')
  const key=await h.command('agent.create',{label:'Pledge reader'})
  await h.command('pledge.linkPlan',{pledgeId:p.id,version:p.version,subscriptionId:'sub_pledge'},{as:'',headers:{authorization:'Bearer '+key.token},status:403})
  const wrong=(await h.get('/api/coffer/donors/'+other.id)).pledges[0]
  await h.command('pledge.linkPlan',{pledgeId:wrong.id,version:wrong.version,subscriptionId:'sub_pledge'},{status:409})
  if(process.env.COFFER_PLEDGE_BROWSER){const {linkPledgeBrowser}=await import('./pledge-balances-browser.mjs');await linkPledgeBrowser(h,ana.id,campaign.id,process.env.COFFER_PLEDGE_BROWSER)}
  else await h.command('pledge.linkPlan',{pledgeId:p.id,version:p.version,subscriptionId:'sub_pledge'})
  await send(h,'evt_pledge_one','invoice.paid',edge.invoice)
  p=await current();assert.equal(p.remaining_cents,200000);assert.equal(p.installments[2].paid_cents,250000)
  await send(h,'evt_pledge_replay','invoice.paid',edge.invoice)
  assert.equal((await current()).remaining_cents,200000)
  edge.invoice='in_pledge_2';await send(h,'evt_pledge_two','invoice.paid',edge.invoice)
  p=await current();assert.equal(p.remaining_cents,0);assert.equal(p.paid_cents,1050000);assert.equal(p.allocations.reduce((n,a)=>n+a.amount_cents,0),1050000);assert.equal((await h.get('/api/coffer/giving/campaigns/'+campaign.id)).pledgedOutstandingCents,0)
  assert.deepEqual((await h.get('/api/coffer/letters/'+receipt.id)).letters,issued,'Pledge adjustments and payments never alter issued gift receipts')
  const cash=(await h.get('/api/coffer/donors/'+ana.id)).totals.lifetimeCents;assert.equal(cash,1100000)
  const saved=await archive(h)
  await run(async fresh=>{await restore(fresh,saved);const restored=(await fresh.get('/api/coffer/donors/'+ana.id)).pledges.find(x=>x.id===p.id);assert.deepEqual(restored,p)})
  const comparison=await h.get(`/api/coffer/duplicates/compare?source=${ana.id}&target=${other.id}`)
  const merge=await h.command('donor.merge',{sourceDonorId:ana.id,donorId:other.id,sourceVersion:comparison.source.version,version:comparison.target.version,reason:'duplicate_record'})
  assert.ok((await h.get('/api/coffer/donors/'+other.id)).pledges.some(x=>x.id===p.id&&x.reduced_cents===150000))
  await h.command('donor.unmerge',{mergeId:merge.mergeId,reason:'incorrect_match'})
  assert.equal((await current()).remaining_cents,0)
  const paidGift=(await h.get('/api/coffer/donors/'+ana.id)).gifts.find(g=>g.reference==='in_pledge_1')
  await h.command('gift.reverse',{giftId:paidGift.id,reason:'Returned recurring contribution'})
  assert.equal((await current()).remaining_cents,250000);assert.equal((await current()).reduced_cents,150000)
  if(process.env.COFFER_PLEDGE_BROWSER){const {pledgeBrowser}=await import('./pledge-balances-browser.mjs');await pledgeBrowser(h,process.env.COFFER_PLEDGE_BROWSER)}
  await h.command('donor.erase',{donorId:ana.id,confirm:'ERASE'})
  const erased=JSON.stringify(await archive(h));assert.ok(!erased.includes('Donor revised the building commitment.'))
 },{bindings:{STRIPE_SECRET_KEY:'sk_test_pledge_edge',STRIPE_WEBHOOK_SECRET:secret},outbound:async request=>{
  const url=new URL(request.url);assert.equal(url.hostname,'api.stripe.com');const params=new URLSearchParams(await request.text());edge.calls++
  if(url.pathname==='/v1/customers')return Response.json({id:'cus_pledge'})
  if(url.pathname==='/v1/checkout/sessions'){edge.intent=params.get('metadata[coffer_intent]');return Response.json({id:'cs_pledge',url:'https://checkout.stripe.com/c/pay/cs_pledge'})}
  if(url.pathname==='/v1/subscriptions/sub_pledge')return Response.json({id:'sub_pledge',customer:'cus_pledge',metadata:{coffer_intent:edge.intent},status:'active',cancel_at_period_end:false,items:{data:[{price:{unit_amount:250000}}]},latest_invoice:edge.invoice})
  if(url.pathname==='/v1/invoices/'+edge.invoice)return Response.json({id:edge.invoice,customer:'cus_pledge',currency:'usd',parent:{subscription_details:{subscription:'sub_pledge'}},status:'paid',amount_paid:250000,attempt_count:1,status_transitions:{paid_at:Date.parse('2025-08-15T12:00:00Z')/1000}})
  assert.fail('Unexpected Stripe edge '+url.pathname)
 }})
}
