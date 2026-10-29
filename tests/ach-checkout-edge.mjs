import assert from 'node:assert/strict'
// Shapes follow Checkout, PaymentIntent, Charge, Mandate and Dispute at Stripe's
// pinned Endive API. Only Stripe's HTTP boundary is replaced.
export function achEdge(){
 const state={sessions:new Map(),writes:[],reads:[],uncertain:false,unavailable:false,mismatch:false,sequence:0,customers:new Map()}
 const now=Date.parse('2026-09-15T12:00:00Z')/1000
 const outbound=async request=>{
  const u=new URL(request.url),path=u.pathname,p=new URLSearchParams(await request.text())
  assert.equal(u.hostname,'api.stripe.com');assert.equal(request.headers.get('stripe-version'),'2026-09-30.endive')
  if(request.method==='POST')state.writes.push({path,params:Object.fromEntries(p),key:request.headers.get('idempotency-key')})
  else state.reads.push(path)
  assert.ok(![...p.keys()].some(key=>/account_number|routing_number|card\[number\]/.test(key)))
  if(state.unavailable)return Response.json({error:{type:'api_error'}},{status:503})
  if(path==='/v1/customers'&&request.method==='POST'){const key=request.headers.get('idempotency-key');if(!state.customers.has(key))state.customers.set(key,'cus_ach_'+(++state.sequence));return Response.json({id:state.customers.get(key)})}
  if(path==='/v1/checkout/sessions'&&request.method==='POST'){
   assert.equal(p.get('allowed_payment_method_types[0]'),'us_bank_account');assert.equal(p.has('allowed_payment_method_types[1]'),false)
   assert.equal(p.get('payment_method_options[us_bank_account][verification_method]'),'instant')
   assert.equal(p.get('payment_method_options[us_bank_account][financial_connections][permissions][0]'),'payment_method')
   assert.equal(p.get('mode'),'payment');assert.equal(p.has('subscription_data[metadata][coffer_intent]'),false)
   const n=state.sequence,id='cs_ach_'+n,amount=Number(p.get('line_items[0][price_data][unit_amount]')),intent=p.get('metadata[coffer_intent]'),customer=p.get('customer')
   assert.equal(intent,p.get('payment_intent_data[metadata][coffer_intent]'))
   const item={n,status:'processing',amount,customer,intent,returned:false,
    session:{id,url:'https://checkout.stripe.com/c/pay/'+id,mode:'payment',status:'complete',payment_status:'unpaid',amount_total:amount,currency:'usd',customer,metadata:{coffer_intent:intent},payment_method_types:['us_bank_account'],payment_intent:'pi_ach_'+n}}
   state.sessions.set(id,item)
   if(state.uncertain){state.uncertain=false;return Response.json({error:{type:'api_error'}},{status:503})}
   return Response.json(item.session)
  }
  if(path==='/v1/invoice_payments')return Response.json({data:[],has_more:false})
  for(const item of state.sessions.values()){
   const {n,amount,customer,intent,status}=item,paid=status==='succeeded'
   if(path==='/v1/checkout/sessions/'+item.session.id)return Response.json({...item.session,payment_status:paid?'paid':'unpaid',amount_total:state.mismatch?amount-1:amount})
   if(path==='/v1/payment_intents/pi_ach_'+n)return Response.json({id:'pi_ach_'+n,customer,metadata:{coffer_intent:intent},currency:'usd',amount,amount_received:paid?amount:0,status,created:now,payment_method_types:['us_bank_account'],payment_method:'pm_ach_'+n,latest_charge:'ch_ach_'+n})
   if(path==='/v1/charges/ch_ach_'+n)return Response.json({id:'ch_ach_'+n,customer,metadata:{coffer_intent:intent},currency:'usd',amount,amount_refunded:0,paid,status:paid?'succeeded':status==='processing'?'pending':'failed',created:now,payment_intent:'pi_ach_'+n,payment_method:'pm_ach_'+n,payment_method_details:{type:'us_bank_account',us_bank_account:{mandate:'mandate_ach_'+n}},balance_transaction:paid?'txn_ach_'+n:null})
   if(path==='/v1/mandates/mandate_ach_'+n)return Response.json({id:'mandate_ach_'+n,status:item.returned?'inactive':'active',type:'multi_use',payment_method:'pm_ach_'+n,payment_method_details:{type:'us_bank_account',us_bank_account:{}},customer_acceptance:{type:'online',accepted_at:now}})
   if(path==='/v1/balance_transactions/txn_ach_'+n)return Response.json({id:'txn_ach_'+n,type:'charge',source:'ch_ach_'+n,currency:'usd',amount,fee:83,net:amount-83,created:now})
   if(path==='/v1/disputes/dp_ach_'+n)return Response.json({id:'dp_ach_'+n,charge:'ch_ach_'+n,payment_intent:'pi_ach_'+n,currency:'usd',amount,reason:'insufficient_funds',status:'lost',balance_transactions:['txn_return_'+n],evidence_details:{has_evidence:false,past_due:true}})
   if(path==='/v1/balance_transactions/txn_return_'+n)return Response.json({id:'txn_return_'+n,type:'adjustment',source:'dp_ach_'+n,currency:'usd',amount:-amount,fee:400,net:-amount-400,created:now+86400})
  }
  assert.fail('Unexpected ACH provider request: '+request.method+' '+path)
 }
 return {...state,state,outbound}
}
