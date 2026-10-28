import assert from 'node:assert/strict'

export const mailbox = local => [local,'example.test'].join('@')
export const receiptDomain = 'riverbend.example.test'
export const receiptFrom = ['receipts',receiptDomain].join('@')
export const domainRecords = {
 mail_cname:{type:'cname',host:'em1.'+receiptDomain,data:'u123.wl.sendgrid.net'},
 dkim1:{type:'cname',host:'s1._domainkey.'+receiptDomain,data:'s1.domainkey.u123.wl.sendgrid.net'},
 dkim2:{type:'cname',host:'s2._domainkey.'+receiptDomain,data:'s2.domainkey.u123.wl.sendgrid.net'},
}

/** Only payment, mail and DNS networks are substituted. */
export function immediateReceiptsEdge() {
 const state={dns:false,missing:null,provider:true,mail:'accepted',messages:[],sessions:[],customers:0}
 const outbound=async request=>{
  const u=new URL(request.url)
  if(u.hostname==='cloudflare-dns.com') {
   const name=u.searchParams.get('name'),type=u.searchParams.get('type'),[key,record]=Object.entries(domainRecords).find(([,r])=>r.host===name)??[]
   assert.ok(record,'DNS lookup belongs to the configured authentication')
   return Response.json({Status:0,Answer:state.dns&&state.missing!==key?(type==='CNAME'?[{name,type:5,data:record.data+'.'}]:[{name:domainRecords.mail_cname.data,type:16,data:'"v=spf1 include:sendgrid.net -all"'}]):[]})
  }
  if(u.hostname==='api.sendgrid.com') {
   if(u.pathname==='/v3/whitelabel/domains/123')return Response.json({id:123,domain:receiptDomain,automatic_security:true,dns:domainRecords})
   if(u.pathname==='/v3/whitelabel/domains/123/validate')return Response.json({id:123,valid:state.provider,validation_results:Object.fromEntries(Object.keys(domainRecords).map(k=>[k,{valid:state.provider}]))})
   assert.equal(u.pathname,'/v3/mail/send')
   const message=await request.json();state.messages.push({message,at:Date.now()})
   if(state.mail==='uncertain')return new Response(null,{status:202})
   if(state.mail==='rejected')return new Response(null,{status:403})
   return new Response(null,{status:202,headers:{'x-message-id':'synthetic-coffer-'+state.messages.length}})
  }
  assert.equal(u.hostname,'api.stripe.com')
  const p=new URLSearchParams(await request.text())
  if(u.pathname==='/v1/customers'&&request.method==='POST')return Response.json({id:'cus_synthetic_'+(++state.customers)})
  if(u.pathname==='/v1/checkout/sessions'&&request.method==='POST') {
   const index=state.sessions.length+1,id='cs_synthetic_'+index
   const session={id,url:'https://checkout.stripe.com/c/pay/'+id,status:'complete',payment_status:'paid',currency:'usd',amount_total:Number(p.get('line_items[0][price_data][unit_amount]')),customer:p.get('customer'),metadata:{coffer_intent:p.get('metadata[coffer_intent]')},payment_intent:'pi_synthetic_'+index}
   state.sessions.push(session);return Response.json(session)
  }
  const session=state.sessions.find(s=>u.pathname==='/v1/checkout/sessions/'+s.id||u.pathname==='/v1/payment_intents/'+s.payment_intent)
  assert.ok(session,'Only a checkout created by this installation is read')
  if(u.pathname.includes('/payment_intents/'))return Response.json({id:session.payment_intent,status:'succeeded',currency:'usd',amount_received:session.amount_total,created:Math.floor(Date.now()/1000)})
  return Response.json(session)
 }
 return {state,outbound,bindings:{STRIPE_SECRET_KEY:'synthetic-coffer-1201',STRIPE_WEBHOOK_SECRET:'synthetic-coffer-1202',MAIL_PROVIDER:'sendgrid',MAIL_API_KEY:'synthetic-coffer-1203',MAIL_FROM:receiptFrom}}
}
