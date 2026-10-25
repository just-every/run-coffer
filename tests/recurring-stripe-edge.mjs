import assert from 'node:assert/strict'

// Stripe test clock, billing and ledger observations are faked only here.
export function recurringStripeEdge() {
 const state={now:'2026-01-10T12:00:00.000Z',plans:new Map(),invoices:new Map(),charges:new Map(),entries:[],sequence:0,mutations:[],uncertain:false}
 const outbound=async request=>{
  const u=new URL(request.url),p=new URLSearchParams(await request.text()),path=u.pathname
  assert.equal(u.hostname,'api.stripe.com')
  if(path==='/v1/test_helpers/test_clocks/synthetic-coffer-7100/advance') {
   state.now=new Date(Number(p.get('frozen_time'))*1000).toISOString()
   const bills=[]
   for(const sub of state.plans.values()) {
    if(sub.cancel_at_period_end||sub.pause_collection||sub.status==='canceled')continue
    if(Date.parse(state.now)<sub.nextBilling)continue
    const number=state.invoices.size+1,id='in_recurring_'+number,paidAt=Date.parse(state.now)/1000
    const bill={id,customer:sub.customer,currency:'usd',parent:{subscription_details:{subscription:sub.id}},status:'paid',amount_paid:sub.items.data[0].price.unit_amount,attempt_count:1,next_payment_attempt:null,status_transitions:{paid_at:paidAt}}
    const charge={id:'ch_recurring_'+number,paid:true,status:'succeeded',amount:bill.amount_paid,currency:'usd',created:paidAt,customer:sub.customer,payment_intent:'pi_recurring_'+number,invoice:id,balance_transaction:'txn_recurring_'+number,amount_refunded:0}
    state.invoices.set(id,bill);state.charges.set(charge.id,charge)
    state.entries.push({id:charge.balance_transaction,type:'charge',source:charge.id,amount:charge.amount,fee:103,net:charge.amount-103,currency:'usd',created:paidAt})
    sub.latest_invoice=id
    const date=new Date(sub.nextBilling),recurring=sub.items.data[0].price.recurring
    date.setUTCMonth(date.getUTCMonth()+(recurring.interval==='year'?12:recurring.interval_count));sub.nextBilling=date.getTime()
    bills.push(id)
   }
   return Response.json({id:'synthetic-coffer-7100',status:'ready',frozen_time:Date.parse(state.now)/1000,bills})
  }
  if(path==='/v1/customers'&&request.method==='POST')return Response.json({id:'cus_recurring_'+(++state.sequence)})
  if(path.startsWith('/v1/checkout/sessions/'))return Response.json({id:path.split('/').at(-1),url:'https://checkout.stripe.com/c/pay/'+path.split('/').at(-1)})
  if(path==='/v1/checkout/sessions') {
   assert.equal(p.get('mode'),'subscription')
   const n=state.sequence,interval=p.get('line_items[0][price_data][recurring][interval]'),count=Number(p.get('line_items[0][price_data][recurring][interval_count]'))
   const next=new Date(state.now);next.setUTCMonth(next.getUTCMonth()+(interval==='year'?12:count))
   const sub={id:'sub_recurring_'+n,customer:p.get('customer'),metadata:{coffer_intent:p.get('subscription_data[metadata][coffer_intent]')},created:Date.parse(state.now)/1000,status:'active',collection_method:'charge_automatically',billing_cycle_anchor:next.getTime()/1000,current_period_end:next.getTime()/1000,cancel_at_period_end:false,pause_collection:null,default_payment_method:null,nextBilling:next.getTime(),items:{data:[{id:'si_recurring_'+n,quantity:1,price:{currency:'usd',product:'prod_recurring',unit_amount:Number(p.get('line_items[0][price_data][unit_amount]')),recurring:{interval,interval_count:count,usage_type:'licensed'}}}]}}
   state.plans.set(sub.id,sub)
   return Response.json({id:'cs_recurring_'+n,url:'https://checkout.stripe.com/c/pay/cs_recurring_'+n})
  }
  const sub=state.plans.get(path.split('/').at(-1))
  if(path.startsWith('/v1/subscriptions/')&&sub) {
   if(request.method==='POST') {
    assert.ok(request.headers.get('idempotency-key'));state.mutations.push(Object.fromEntries(p))
    if(state.uncertain)throw Error('Synthetic unknown provider outcome')
    if(p.has('pause_collection[behavior]')){assert.equal(p.get('pause_collection[behavior]'),'void');sub.pause_collection={behavior:'void'}}
    if(p.has('pause_collection'))sub.pause_collection=null
    if(p.has('cancel_at_period_end'))sub.cancel_at_period_end=p.get('cancel_at_period_end')==='true'
    if(p.has('items[0][price_data][unit_amount]')) {
     assert.equal(p.get('proration_behavior'),'none')
     sub.items.data[0].price.unit_amount=Number(p.get('items[0][price_data][unit_amount]'))
     sub.items.data[0].price.recurring={interval:p.get('items[0][price_data][recurring][interval]'),interval_count:Number(p.get('items[0][price_data][recurring][interval_count]')),usage_type:'licensed'}
    }
    if(p.has('trial_end')){sub.trial_end=Number(p.get('trial_end'));sub.status='trialing';sub.nextBilling=sub.trial_end*1000;sub.billing_cycle_anchor=sub.trial_end}
   }
   return Response.json(sub)
  }
  if(path.startsWith('/v1/invoices/'))return Response.json(state.invoices.get(path.split('/').at(-1)))
  if(path.startsWith('/v1/customers/'))return Response.json({id:path.split('/').at(-1),invoice_settings:{default_payment_method:'synthetic-coffer-7101'}})
  if(path.startsWith('/v1/payment_methods/'))return Response.json({id:'synthetic-coffer-7101',type:'card',card:{exp_month:12,exp_year:2028}})
  if(path==='/v1/invoice_payments')return Response.json({data:[],has_more:false})
  if(path.startsWith('/v1/charges/'))return Response.json(state.charges.get(path.split('/').at(-1)))
  if(path==='/v1/payouts/po_recurring')return Response.json({id:'po_recurring',status:'paid',arrival_date:Date.parse(state.now)/1000,amount:state.entries.reduce((s,e)=>s+e.net,0),currency:'usd',automatic:true,reconciliation_status:'completed'})
  if(path==='/v1/balance_transactions')return Response.json({data:state.entries,has_more:false})
  assert.fail('Unexpected recurring provider request '+request.method+' '+path)
 }
 return {state,outbound,async advance(now){return (await outbound(new Request('https://api.stripe.com/v1/test_helpers/test_clocks/synthetic-coffer-7100/advance',{method:'POST',body:new URLSearchParams({frozen_time:String(Date.parse(now)/1000)})}))).json()}}
}
