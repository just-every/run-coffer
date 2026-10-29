import assert from 'node:assert/strict'
import {createHmac,randomUUID} from 'node:crypto'
import {run,reviewed} from './harness.mjs'
import {recurringStripeEdge} from './recurring-stripe-edge.mjs'

// Exercise provider UTC periods through checkout, signed webhooks and member reads.
export async function membershipCalendarPayments(){
 for(const {months,start,end,renewalEnd,localEnd} of [
  {months:12,start:'2026-03-11T04:30:00Z',end:'2027-03-11T04:30:00Z',localEnd:'2027-03-10'},
  {months:1,start:'2026-01-31T12:00:00Z',end:'2026-02-28T12:00:00Z',renewalEnd:'2026-03-31T12:00:00Z',localEnd:'2026-02-28'},
 ]){
  const edge=recurringStripeEdge({initialPayment:true}),secret='synthetic-coffer-9401',seconds=value=>Date.parse(value)/1000
  edge.state.now=start
  await run(async h=>{
   const headers=()=>({'x-test-now':edge.state.now}),api=(p,b)=>h.api(p,b,{headers:headers()}),get=p=>h.get(p,{headers:headers()})
   await reviewed(h)
   const campaign=await api('/api/coffer/giving/campaigns',{name:'Calendar membership',slug:'calendar-members',description:'Reading membership',fund:'Reading',goal:'1000'})
   const level=await api('/api/coffer/memberships',{action:'create',name:'Calendar reader',slug:'calendar-reader',campaignId:campaign.id,price:'120',termMonths:months,benefit:'20',benefitDescription:'Reading events and journal',graceDays:30})
   const response=await h.request('/giving/memberships/calendar-reader/checkout',{method:'POST',as:'',headers:{...headers(),'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams({requestId:randomUUID(),levelVersion:'1',name:'Synthetic Calendar Member',email:['synthetic-coffer-9402','example.test'].join('@'),authorizeRenewal:'yes','cf-turnstile-response':'synthetic-coffer-security-token'}).toString()})
   assert.equal(response.status,303,await response.text())
   const sub=[...edge.state.plans.values()][0],initial=edge.state.invoices.get(sub.latest_invoice)
   Object.assign(initial,{period_start:seconds(start),period_end:seconds(end)})
   sub.current_period_end=seconds(end)
   const deliver=async bill=>{
    const raw=JSON.stringify({id:randomUUID(),type:'invoice.paid',data:{object:{id:bill.id}}}),timestamp=seconds(edge.state.now),signature=createHmac('sha256',secret).update(`${timestamp}.${raw}`).digest('hex')
    const result=await h.request('/api/coffer/giving/webhook',{method:'POST',as:'',raw,headers:{...headers(),'stripe-signature':`t=${timestamp},v1=${signature}`}})
    assert.equal(result.status,200,await result.text())
   }
   await deliver(initial)
   let state=await get('/api/coffer/memberships')
   assert.equal(state.memberships.length,1,'The full-price installment grants membership across the billing calendar')
   const membership=state.memberships[0]
   assert.equal(membership.expires_on,localEnd)
   assert.equal(membership.state,'active')
   assert.equal(state.counts.find(c=>c.levelId===level.id).active,1)
   if(renewalEnd){
    edge.state.now=end
    const renewed={...structuredClone(initial),id:'synthetic-coffer-9405',period_start:seconds(end),period_end:seconds(renewalEnd),status_transitions:{paid_at:seconds(end)}}
    edge.state.invoices.set(renewed.id,renewed);sub.latest_invoice=renewed.id;sub.current_period_end=renewed.period_end
    await deliver(renewed);await deliver(renewed)
    state=await get('/api/coffer/memberships')
    assert.equal(state.memberships[0].expires_on,'2026-03-31','February renewal retains the original month-end billing day')
    assert.equal(state.memberships[0].state,'active')
    assert.equal(state.counts.find(c=>c.levelId===level.id).active,1)
   }else await deliver(initial)
   const detail=await get('/api/coffer/donors/'+membership.donor_id),progress=await get('/api/coffer/giving/campaigns/'+campaign.id)
   assert.deepEqual(detail.gifts.map(g=>[g.amount_cents,g.goods_cents]),renewalEnd?[[12000,2000],[12000,2000]]:[[12000,2000]])
   assert.equal(progress.giftCount,renewalEnd?2:1)
   assert.equal(progress.raisedCents,renewalEnd?24000:12000)
  },{entry:'tests/advancing-clock-worker.ts',bindings:{STRIPE_SECRET_KEY:'synthetic-coffer-9403',STRIPE_WEBHOOK_SECRET:secret},outbound:edge.outbound})
 }
}
