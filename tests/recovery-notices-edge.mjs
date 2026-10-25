import assert from 'node:assert/strict'
import {createHmac,randomUUID} from 'node:crypto'

export const recoveryForm=(values,as='',headers={})=>({method:'POST',as,headers:{'content-type':'application/x-www-form-urlencoded',...headers},raw:new URLSearchParams(values).toString()})
export function recoveryNoticeEdge(frequency='monthly') {
 const plans=['ana','ben','mira'].map(id=>({id,name:id==='mira'?'Mira Major':id==='ben'?'Ben Recovery':'Ana Recovery',email:`${id}.notices@example.test`,amount:2500,status:'past_due',paid:false,attempt:1,invoice:'in_notice_'+id,method:null,expiryOffset:2,intent:null,hostedReturn:null}))
 const secret='synthetic-coffer-3001',calls=[],invoices=new Map()
 const subscription=p=>({id:'sub_notice_'+p.id,customer:'cus_notice_'+p.id,metadata:{coffer_intent:p.intent},status:p.status,cancel_at_period_end:false,default_payment_method:null,items:{data:[{id:'si_notice_'+p.id,quantity:1,price:{id:'price_notice_'+p.id,product:'prod_notice_'+p.id,unit_amount:p.amount,currency:'usd',recurring:{interval:frequency==='annually'?'year':'month',interval_count:frequency==='quarterly'?3:1,usage_type:'licensed'}}}]},latest_invoice:p.invoice,created:Math.floor(Date.parse('2025-01-01T12:00:00Z')/1000)})
 const outbound=async request=>{
  const url=new URL(request.url),data=new URLSearchParams(await request.text());calls.push([request.method,url.pathname])
  assert.equal(url.hostname,'api.stripe.com')
  if(url.pathname==='/v1/customers'&&request.method==='POST')return Response.json({id:'cus_notice_'+plans.find(p=>p.email===data.get('email')).id})
  if(url.pathname==='/v1/checkout/sessions'){
   const p=plans.find(p=>'cus_notice_'+p.id===data.get('customer'));p.intent=data.get('subscription_data[metadata][coffer_intent]')
   return Response.json({id:'cs_notice_'+p.id,url:'https://checkout.stripe.com/c/pay/cs_notice_'+p.id})
  }
  const p=plans.find(p=>url.pathname.endsWith('/sub_notice_'+p.id)||url.pathname.endsWith('/cus_notice_'+p.id)||url.pathname.endsWith('/'+p.invoice)||url.pathname.endsWith('/'+p.method))
  if(p&&url.pathname.startsWith('/v1/subscriptions/')){assert.equal(request.method,'GET','Recovery never charges, retries or revises a plan');return Response.json(subscription(p))}
  if(p&&url.pathname.startsWith('/v1/customers/'))return Response.json({id:'cus_notice_'+p.id,invoice_settings:{default_payment_method:p.method}})
  if(p&&url.pathname.startsWith('/v1/invoices/')){const row={id:p.invoice,customer:'cus_notice_'+p.id,currency:'usd',parent:{type:'subscription_details',subscription_details:{subscription:'sub_notice_'+p.id}},status:p.paid?'paid':'open',amount_paid:p.paid?p.amount:0,attempt_count:p.attempt,next_payment_attempt:p.paid?null:1800000000,status_transitions:{paid_at:p.paid?Math.floor((p.paidAt??Date.now())/1000):null}};invoices.set(p.invoice,row);return Response.json(row)}
  if(url.pathname.startsWith('/v1/invoices/')&&invoices.has(url.pathname.split('/').at(-1)))return Response.json(invoices.get(url.pathname.split('/').at(-1)))
  if(p&&url.pathname.startsWith('/v1/payment_methods/')){
   const date=new Date(p.expiryBase??Date.now()),expiry=new Date(Date.UTC(date.getUTCFullYear(),date.getUTCMonth()+p.expiryOffset,1))
   return Response.json({id:p.method,customer:'cus_notice_'+p.id,type:'card',card:{exp_year:expiry.getUTCFullYear(),exp_month:expiry.getUTCMonth()+1,last4:'4242'}})
  }
  if(url.pathname==='/v1/billing_portal/configurations')return Response.json({id:'bpc_notices'})
  if(url.pathname==='/v1/billing_portal/configurations/bpc_notices')return Response.json({id:'bpc_notices',active:true,features:{payment_method_update:{enabled:true},customer_update:{enabled:false},invoice_history:{enabled:false},subscription_cancel:{enabled:false},subscription_update:{enabled:false}},login_page:{enabled:false}})
  if(url.pathname==='/v1/billing_portal/sessions'){
   const p=plans.find(p=>'cus_notice_'+p.id===data.get('customer'));p.hostedReturn=data.get('flow_data[after_completion][redirect][return_url]')
   return Response.json({url:'https://billing.stripe.com/p/session/synthetic-coffer-3002'})
  }
  assert.fail('Unexpected provider request '+request.method+' '+url.pathname)
 }
 const fail=async(h,p,id,at=new Date().toISOString(),type='invoice.payment_failed')=>{
  const timestamp=Math.floor(Date.parse(at)/1000),raw=JSON.stringify({id,type,data:{object:{id:p.invoice}}}),signature=createHmac('sha256',secret).update(`${timestamp}.${raw}`).digest('hex')
  const result=await h.request('/api/coffer/giving/webhook',{method:'POST',as:'',raw,headers:{'x-test-now':at,'stripe-signature':`t=${timestamp},v1=${signature}`}})
  assert.equal(result.status,200,await result.text())
 }
 return {plans,calls,fail,options:{entry:'tests/advancing-clock-worker.ts',bindings:{STRIPE_SECRET_KEY:'synthetic-coffer-3003',STRIPE_WEBHOOK_SECRET:secret},outbound},requestId:randomUUID}
}
