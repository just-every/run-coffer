import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'

// Only the paid Stripe edge is scripted; checkout, gifts, receipts and plan history are real.
export function dashboardStripe() {
 const sessions=new Map(),subscriptions=new Map();let sequence=0
 const paidAt=Math.floor(Date.parse('2024-09-15T16:00:00Z')/1000)
 const outbound=async request=>{
  const url=new URL(request.url),p=new URLSearchParams(await request.text());assert.equal(url.hostname,'api.stripe.com')
  if(url.pathname==='/v1/customers')return Response.json({id:'cus_dashboard_'+(++sequence)})
  if(url.pathname==='/v1/checkout/sessions'){
   const id='cs_dashboard_'+sequence,monthly=p.get('mode')==='subscription',intent=p.get('metadata[coffer_intent]'),customer=p.get('customer'),amount=Number(p.get('line_items[0][price_data][unit_amount]'))
   const session={id,url:'https://checkout.stripe.com/c/pay/'+id,metadata:{coffer_intent:intent},customer,currency:'usd',amount_total:amount,status:'complete',payment_status:'paid',payment_intent:'pi_dashboard_'+sequence,subscription:monthly?'sub_dashboard_'+sequence:null}
   sessions.set(id,session)
   if(monthly)subscriptions.set(session.subscription,{id:session.subscription,customer,created:paidAt,metadata:{coffer_intent:intent},status:'active',cancel_at_period_end:false,items:{data:[{price:{unit_amount:amount},quantity:1}]},latest_invoice:'in_dashboard_'+sequence})
   return Response.json(session)
  }
  const session=[...sessions.values()].find(s=>url.pathname.endsWith('/'+s.id)||url.pathname.endsWith('/'+s.payment_intent))
  if(session){if(url.pathname.includes('/payment_intents/'))return Response.json({id:session.payment_intent,status:'succeeded',currency:'usd',amount_received:session.amount_total,created:paidAt});return Response.json(session)}
  const sub=[...subscriptions.values()].find(s=>url.pathname.endsWith('/'+s.id)||url.pathname.endsWith('/'+s.latest_invoice))
  if(sub){if(url.pathname.includes('/invoices/'))return Response.json({id:sub.latest_invoice,customer:sub.customer,currency:'usd',parent:{subscription_details:{subscription:sub.id}},status:'paid',amount_paid:sub.items.data[0].price.unit_amount,attempt_count:1,status_transitions:{paid_at:paidAt}});return Response.json(sub)}
  assert.fail('Unexpected Stripe edge: '+url.pathname)
 }
 return {outbound,async give(h,slug,frequency='once',name='Online Dashboard Donor',amount='40'){
  const response=await h.request('/give/'+slug+'/checkout',{method:'POST',as:'',headers:{'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams({requestId:randomUUID(),name,email:name.toLowerCase().replaceAll(' ','.')+'@example.test',frequency,'cf-turnstile-response':'synthetic-coffer-security-token',amount,appeal:'SPRING'}).toString()})
  assert.equal(response.status,303,await response.text());const id=response.headers.get('location').split('/').at(-1)
  const thanks=await h.request('/giving/thanks?session_id='+id,{as:''});assert.equal(thanks.status,200,await thanks.text())
  return id
 }}
}
