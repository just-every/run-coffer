import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {run, reviewed} from './harness.mjs'

const secret=randomUUID()
const form=values=>({method:'POST',as:'',headers:{'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams(values).toString()})
const sum=rows=>rows.reduce((s,r)=>({gross_cents:s.gross_cents+r.gross_cents,fee_cents:s.fee_cents+r.fee_cents,net_cents:s.net_cents+r.net_cents}),{gross_cents:0,fee_cents:0,net_cents:0})

// Only Stripe and the mail edge are scripted. Every product read/write is HTTP.
export async function feeCoverJourney() {
 const sessions=new Map(),charges=new Map(),entries=[],messages=[]
 let sequence=0,returnedAmount=null,piAmount=null
 const now=Math.floor(Date.now()/1000)
 const outbound=async request=>{
  const u=new URL(request.url),p=new URLSearchParams(await request.text()),path=u.pathname
  assert.equal(u.hostname,'api.stripe.com')
  if(path==='/v1/customers')return Response.json({id:'cus_fee_'+(++sequence)})
  if(path==='/v1/checkout/sessions') {
   const id='cs_fee_'+sequence,total=Number(p.get('line_items[0][price_data][unit_amount]')),intent=p.get('metadata[coffer_intent]'),customer=p.get('customer')
   const session={id,url:'https://checkout.stripe.com/c/pay/'+id,metadata:{coffer_intent:intent},customer,currency:'usd',amount_total:total,status:'complete',payment_status:'paid',payment_intent:'pi_fee_'+sequence}
   const monthly=p.get('mode')==='subscription'
   assert.equal(intent,p.get(monthly?'subscription_data[metadata][coffer_intent]':'payment_intent_data[metadata][coffer_intent]'))
   if(monthly)assert.equal(p.get('line_items[0][price_data][recurring][interval]'),'month')
   sessions.set(id,session)
   if(monthly)return Response.json(session)
   const charge={id:'ch_fee_'+sequence,paid:true,status:'succeeded',amount:total,currency:'usd',created:now,metadata:{coffer_intent:intent},customer,payment_intent:session.payment_intent,balance_transaction:'txn_fee_'+sequence,amount_refunded:0}
   charges.set(charge.id,charge)
   entries.push({id:charge.balance_transaction,type:'charge',source:charge.id,amount:total,fee:345,net:total-345,currency:'usd',created:now})
   return Response.json(session)
  }
  const session=[...sessions.values()].find(s=>path==='/v1/checkout/sessions/'+s.id||path==='/v1/payment_intents/'+s.payment_intent)
  if(session) {
   if(path.includes('/payment_intents/'))return Response.json({id:session.payment_intent,status:'succeeded',currency:'usd',amount_received:piAmount??session.amount_total,created:now})
   return Response.json({...session,amount_total:returnedAmount??session.amount_total})
  }
  if(path==='/v1/invoice_payments')return Response.json({data:[],has_more:false})
  const charge=charges.get(path.slice('/v1/charges/'.length));if(path.startsWith('/v1/charges/')&&charge)return Response.json(charge)
  if(path==='/v1/payouts/po_fee_cover')return Response.json({id:'po_fee_cover',status:'paid',arrival_date:now,amount:entries.reduce((s,e)=>s+e.net,0),currency:'usd',automatic:true,reconciliation_status:'completed'})
  if(path==='/v1/balance_transactions')return Response.json({data:entries,has_more:false})
  assert.fail('Unexpected PAY-004 edge '+path)
 }
 // Read the mail JSON before the generic URL-encoded Stripe parser consumes it.
 const edge=async request=>{
  if(new URL(request.url).hostname==='api.sendgrid.com') {messages.push(await request.json());return new Response(null,{status:202,headers:{'x-message-id':'pay004-receipt-'+messages.length}})}
  return outbound(request)
 }
 await run(async h=>{
  await reviewed(h)
  const create=(name,slug,fund)=>h.api('/api/coffer/giving/campaigns',{name,slug,description:'Support our community.',fund,goal:'1000'})
  const a=await create('Reading fee cover','reading-fee-cover','Reading'),b=await create('Meals fee cover','meals-fee-cover','Meals')
  const list=async id=>(await h.get('/api/coffer/giving/campaigns')).campaigns.find(c=>c.id===id)
  assert.equal((await list(a.id)).fee_cover_enabled,0)
  assert.doesNotMatch(await (await h.request('/give/reading-fee-cover',{as:''})).text(),/name="feeCover"/)
  const configPath='/api/coffer/giving/campaigns/'+a.id+'/fee-cover',config={version:1,feeCoverEnabled:'yes',feeCoverRateBps:290,feeCoverFixedCents:30}
  const invited=await h.request('/app/people/invite',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams({email:'fee.entry@example.test',role:'member',displayName:'Fee Entry'}).toString()})
  assert.equal(invited.status,303,await invited.text())
  const invitation=messages.find(m=>m.personalizations?.[0]?.to?.[0]?.email==='fee.entry@example.test')
  const invitationText=invitation?.content?.find(c=>c.type==='text/plain')?.value
  assert.ok(invitationText)
  const token=new URL(invitationText.match(/https?:\/\/[^\s<>]+\/auth\/confirm\?token=[^\s<>]+/)[0]).searchParams.get('token')
  const confirmed=await h.request('/auth/confirm',{method:'POST',as:'',body:{token}});assert.equal(confirmed.status,303)
  const member={cookie:confirmed.headers.getSetCookie().map(v=>v.split(';')[0]).join('; ')}
  messages.length=0
  await h.api(configPath,config,{as:'',status:401});await h.api(configPath,config,{as:member.cookie,status:403})
  await h.api(configPath,{...config,feeCoverRateBps:10000},{status:400})
  await h.api(configPath,{...config,feeCoverFixedCents:0.5},{status:400})
  await h.api(configPath,config)
  const publicPage=await h.request('/give/reading-fee-cover',{as:''}),markup=await publicPage.text()
  const nonce=markup.match(/<script nonce="([^"]+)" src="\/giving\/fee-cover.js" defer>/)?.[1]
  assert.ok(nonce,'The fee estimator is explicitly nonce-authorized')
  assert.ok(publicPage.headers.get('content-security-policy').includes("script-src 'nonce-"+nonce+"'"))
  assert.doesNotMatch(publicPage.headers.get('content-security-policy'),/unsafe-inline/)
  const nextPage=await (await h.request('/give/reading-fee-cover',{as:''})).text()
  assert.notEqual(nextPage.match(/<script nonce="([^"]+)"/)?.[1],nonce,'Every response has a fresh nonce')
  await h.api(configPath,config,{status:409})
  const values={requestId:randomUUID(),name:'Cover Donor',email:'cover@example.test',frequency:'once','cf-turnstile-response':'synthetic-coffer-security-token',amount:'100.00',feeCover:'yes',quotedAmountCents:'10330'}
  const submit=(v=values,slug='reading-fee-cover')=>h.request('/give/'+slug+'/checkout',form(v))
  assert.equal((await submit(values,'meals-fee-cover')).status,409,'Unconfigured fee cover is refused')
  assert.equal((await submit({...values,quotedAmountCents:'10329'})).status,409,'The exact reviewed total is required')
  const checkout=await submit();assert.equal(checkout.status,303,await checkout.text())
  const sessionId=checkout.headers.get('location').split('/').at(-1),session=sessions.get(sessionId)
  assert.equal(session.amount_total,10330,'PAY-004: $100 + 2.90% + 30 cents uses integer-cent ceiling gross-up')
  const revised=await h.api(configPath,{...config,version:2,feeCoverRateBps:300})
  assert.equal(revised.fee_cover_version,3)
  const replay=await submit();assert.equal(replay.status,303,await replay.text());assert.equal(sessions.size,1,'A replay returns the frozen checkout')
  assert.equal((await submit({...values,amount:'101.00'})).status,409)
  assert.equal((await submit({...values,feeCover:'no'})).status,409)
  returnedAmount=10000
  assert.equal((await h.request('/giving/thanks?session_id='+sessionId,{as:''})).status,409,'Checkout confirmation still verifies the final charged amount')
  returnedAmount=null;piAmount=10000
  assert.equal((await h.request('/giving/thanks?session_id='+sessionId,{as:''})).status,409,'PaymentIntent confirmation verifies the grossed-up amount')
  piAmount=null
  const thanks=await h.request('/giving/thanks?session_id='+sessionId,{as:''});assert.equal(thanks.status,200,await thanks.text())
  const donor=(await h.get('/api/coffer/donors')).donors.find(d=>d.email==='cover@example.test'),history=await h.get('/api/coffer/donors/'+donor.id)
  assert.equal(history.gifts.length,1);assert.equal(history.gifts[0].amount_cents,10330)
  assert.equal(history.letters[0].amount_cents,10330,'The paid gift receipt includes the full fee-covered payment')
  const receipt=await h.get('/api/coffer/letters/'+history.letters[0].batch_id)
  assert.match(receipt.letters[0].body,/\$103\.30/)
  assert.equal(messages.length,1);assert.match(messages[0].content[0].value,/\$103\.30/)
  assert.equal((await h.request('/giving/thanks?session_id='+sessionId,{as:''})).status,200);assert.equal(messages.length,1)
  // A second actual giving form contributes to the same payout without fee cover.
  const other=await submit({requestId:randomUUID(),name:'Meals Donor',email:'meals@example.test',frequency:'once','cf-turnstile-response':'synthetic-coffer-security-token',amount:'25.00'},'meals-fee-cover')
  assert.equal(other.status,303,await other.text())
  assert.equal((await h.request('/giving/thanks?session_id='+other.headers.get('location').split('/').at(-1),{as:''})).status,200)
  const firstCharge=[...charges.values()][0]
  entries.push({id:'txn_fee_refund',type:'refund',source:{id:'re_fee',charge:firstCharge.id},amount:-2500,fee:-50,net:-2450,currency:'usd',created:now+1})
  await h.api('/api/coffer/payments/sync',{payoutId:'po_fee_cover'})
  const report=await h.get('/api/coffer/payments/fees?payoutId=po_fee_cover'),payout=await h.get('/api/coffer/payments/po_fee_cover')
  assert.deepEqual(report.totals,{gross_cents:10330,fee_cents:640,net_cents:9690})
  for(const group of [report.byFund,report.byForm,report.byCampaign])assert.deepEqual(sum(group),report.totals)
  assert.equal(report.byForm.length,2)
  assert.deepEqual(report.byForm.map(r=>[r.id,r.gross_cents,r.fee_cents,r.net_cents]).sort(),[[a.id,7830,295,7535],[b.id,2500,345,2155]].sort())
  assert.deepEqual(report.byCampaign.map(r=>[r.id,r.gross_cents]).sort(),[[a.id,7830],[b.id,2500]].sort())
  assert.deepEqual(report.byFund.map(r=>[r.id,r.gross_cents,r.fee_cents,r.net_cents]),payout.splits.map(r=>[r.fund,r.gross_cents,r.fee_cents,r.net_cents]))
  assert.equal(report.lines.find(r=>r.kind==='charge'&&r.gift_id===history.gifts[0].id).fee_cents,345,'Actual Stripe fee remains distinct from the $3.30 estimate')
  assert.equal(report.payouts[0].difference_cents,0);assert.equal(report.totals.net_cents,payout.payout.amount_cents)
  assert.deepEqual(report.matched,report.totals);assert.deepEqual(report.unmatched,{gross_cents:0,fee_cents:0,net_cents:0})
  await h.get('/api/coffer/payments/fees',{as:'',status:401});await h.get('/api/coffer/payments/fees',{as:member.cookie,status:403})
  assert.equal((await h.request('/app/payouts/fees')).status,200)
  const monthly=await submit({requestId:randomUUID(),name:'Monthly Cover Donor',email:'monthly.cover@example.test',frequency:'monthly','cf-turnstile-response':'synthetic-coffer-security-token',amount:'100.00',feeCover:'yes',quotedAmountCents:'10341'})
  assert.equal(monthly.status,303,await monthly.text())
  assert.equal([...sessions.values()].at(-1).amount_total,10341,'A new monthly plan starts with the currently configured gross-up total')
  if(process.env.COFFER_PAY004_BROWSER){const {feeCoverBrowser}=await import('./fee-cover-browser.mjs');await feeCoverBrowser(h,{campaignId:a.id,directory:process.env.COFFER_PAY004_BROWSER})}
 },{bindings:{STRIPE_SECRET_KEY:'synthetic-coffer-6000',STRIPE_WEBHOOK_SECRET:secret,MAIL_PROVIDER:'sendgrid'},outbound:edge})
}
