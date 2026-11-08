import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {run,donor,reviewed,settings,archive,restore,installation} from './harness.mjs'
import {fixedNow} from './fixed-clock.mjs'
import {shopOrdersBrowser} from './shop-orders-browser.mjs'

const mail=n=>'synthetic-coffer-'+n+String.fromCharCode(64)+'example.test'
const secret='synthetic-coffer-3001',domain='synthetic-coffer-3002.myshopify.com',shopId='3003'
const paidTopic=['orders','paid'].join('/'),refundTopic=['refunds','create'].join('/')
const root='/api/coffer/payments/shops',match=id=>'/api/coffer/payments/donor-matches/'+id
const order=(id,email,{donation=true}={})=>({id,email,customer:{id:8000+id},currency:'USD',financial_status:'paid',cancelled_at:null,processed_at:'2026-09-01T12:00:00Z',total_price:'74.20',total_tax:'3.20',total_discounts:'0.00',total_shipping_price_set:{shop_money:{amount:'6.00',currency_code:'USD'}},line_items:[{id:id*10+1,quantity:1,price:'40.00',total_discount:'0.00',tax_lines:[{price:'3.20'}],properties:[{name:'_coffer_kind',value:'merchandise'}]},{id:id*10+2,quantity:1,price:'25.00',total_discount:'0.00',tax_lines:[],properties:[{name:'_coffer_kind',value:donation?'donation':'merchandise'},{name:'_coffer_fund',value:'Reading'},{name:'_coffer_campaign',value:'none'}]}]})
const capture=o=>({id:o.id*10+3,order_id:o.id,amount:'74.20',currency:'USD',status:'success',kind:'sale',gateway:'shopify_payments'})
const balance=(o,tx)=>({id:tx.id+10000,source_order_id:o.id,source_order_transaction_id:tx.id,source_type:tx.kind==='refund'?'refund':'charge',amount:tx.kind==='refund'?'-74.20':'74.20',fee:tx.kind==='refund'?'0.00':'2.50',net:tx.kind==='refund'?'-74.20':'71.70',currency:'USD',payout_id:3004,payout_status:'paid'})
const approval=r=>({version:r.version,fingerprint:r.fingerprint,confirm:'yes'})
const selection=(v,d)=>({version:v.version,donorId:d.id,donorVersion:v.candidates.find(c=>c.id===d.id)?.version??1,confirm:'yes'})
export async function shopOrdersJourney(){
 const orders=new Map(),transactions=new Map(),balances=[],stripeObjects=new Map();let pauseStripeId,pausedStripe,enterStripe,stripeReads=0;let calls=0,settlementAvailable=true,shop=shopId,paused,entered
 const put=o=>{orders.set(o.id,o);const t=capture(o);transactions.set(o.id,[t]);balances.push(balance(o,t));return o}
 const addRefund=o=>{o.financial_status='refunded';const t={...capture(o),id:o.id*10+4,kind:'refund',parent_id:o.id*10+3};transactions.get(o.id).push(t);balances.push(balance(o,t));return {id:o.id*10+5,order_id:o.id,transactions:[t]}}
 const edge=async request=>{
  calls++;assert.equal(request.method,'GET','Shop flows never initiate provider writes')
  const u=new URL(request.url)
  if(u.hostname==='api.stripe.com'){
   if(u.pathname==='/v1/charges/'+pauseStripeId&&++stripeReads===2){enterStripe();await pausedStripe}
   if(u.pathname==='/v1/account')return Response.json({id:'acct_synthetic_coffer_3005'})
   const o=stripeObjects.get(u.pathname);if(o)return Response.json(o)
  }
  assert.equal(u.hostname,domain)
  assert.equal(request.headers.get('x-shopify-access-token'),'synthetic-coffer-3006')
  const path=u.pathname.replace('/admin/api/2026-10/','')
  if(path==='shop.json')return Response.json({shop:{id:Number(shop),myshopify_domain:domain}})
  if(path==='shopify_payments/balance/transactions.json'){
   if(entered){const notify=entered;entered=null;notify();await paused}
   return Response.json({transactions:settlementAvailable?balances:[]})
  }
  const m=path.match(/^orders\/(\d+)(\/transactions)?\.json$/)
  assert.ok(m,'Only documented Shopify resource reads are used: '+path)
  return Response.json(m[2]?{transactions:transactions.get(Number(m[1]))}:{order:orders.get(Number(m[1]))})
 }
 const bindings={SHOPIFY_SHOP_DOMAIN:domain,SHOPIFY_SHOP_ID:shopId,SHOPIFY_WEBHOOK_SECRET:secret,SHOPIFY_ACCESS_TOKEN:'synthetic-coffer-3006',SHOPIFY_STRIPE_ACCOUNT:'acct_synthetic_coffer_3005',STRIPE_SECRET_KEY:'synthetic-coffer-3007',STRIPE_WEBHOOK_SECRET:'synthetic-coffer-3008'}
 const options={entry:'tests/fixed-clock-worker.ts',bindings,outbound:edge}
 await run(async h=>{
  await reviewed(h)
  await h.command('settings.update',{...settings,threshold:'20',version:(await h.get('/api/coffer/settings')).version})
  await h.command('fund.define',{name:'Reading',restriction:'purpose',detail:'Literacy instruction'})
  const first=await donor(h,'Synthetic Shop First',{email:mail(3010),household:'Synthetic shop household'}),chosen=await donor(h,'Synthetic Shop Chosen',{email:mail(3010),household:'Synthetic shop household'})
  const paid=put({...order(3011,mail(3010)),token:'synthetic-coffer-private-session-3050',order_status_url:'https://synthetic-coffer-shop.test/private-session'}),paidOriginal=structuredClone(paid)
  const send=async(payload,{topic=paidTopic,event='synthetic-coffer-event-'+payload.id,bad=false,shopDomain=domain}={})=>{
   const raw=JSON.stringify(payload),sig=createHmac('sha256',bad?'invalid':secret).update(raw).digest('base64')
   return h.request('/api/coffer/shops/shopify/webhook',{method:'POST',raw,as:'',headers:{'x-shopify-shop-domain':shopDomain,'x-shopify-topic':topic,'x-shopify-event-id':event,'x-shopify-hmac-sha256':sig}})
  }
  assert.equal((await send(paid,{bad:true})).status,400)
  assert.equal((await send(paid,{shopDomain:'other.myshopify.com'})).status,400)
  assert.equal((await h.get(root)).orders.length,0);assert.equal(calls,0)
  let response=await send(paid);assert.equal(response.status,200);const key=(await response.json()).id
  assert.equal((await send(paid)).status,200)
  assert.equal((await send({...paid,total_price:'75.20'})).status,409)
  const emptyMoney=async()=>{assert.equal((await h.get('/api/coffer/donors/'+chosen.id)).gifts.length,0);assert.deepEqual((await h.get('/api/coffer/payments/fees')).totals,{gross_cents:0,fee_cents:0,net_cents:0})}
  await emptyMoney()
  let r=await h.get(root+'/'+key)
  assert.equal(r.state,'held');assert.equal(r.donorReview.candidates.length,2);assert.ok(!JSON.stringify(r).includes('private-session'))
  await h.api(root+'/'+key+'/approve',approval(r),{status:409})
  const review={donationLineId:String(paid.id*10+2),fund:'Reading',campaign:'none',contributionFee:'1.00',noncontributionFee:'1.50',allocationReason:'Reviewed explicit allocation from actual order fee; not a provider donation fee.',confirm:'yes'}
  settlementAvailable=false
  r=await h.api(root+'/'+key+'/review',{...review,version:r.version})
  assert.equal(r.state,'held');assert.ok(r.issues.some(i=>/fee evidence/.test(i)));await emptyMoney()
  settlementAvailable=true
  await h.api(root+'/'+key+'/review',{...review,noncontributionFee:'1.49',version:r.version},{status:409})
  await h.api(root+'/'+key+'/review',{...review,fund:'Meals',version:r.version},{status:409})
  shop='99999';await h.api(root+'/'+key+'/review',{...review,version:r.version});await emptyMoney();shop=shopId
  r=await h.get(root+'/'+key)
  const member=await h.person(mail(3012)),admin=await h.person(mail(3013),'admin'),agent=await h.command('agent.create',{label:'Synthetic shop agent'})
  for(const access of [{as:'',status:401},{as:member.cookie,status:403},{as:'',headers:{authorization:'Bearer '+agent.token},status:403}]){
   await h.get(root+'/'+key,access);await h.api(root+'/'+key+'/review',{...review,version:r.version},access);await h.api(root+'/'+key+'/approve',approval(r),access);await h.api(root+'/'+key+'/refund',approval(r),access);await h.api(match(key)+'/approve',selection(r.donorReview,chosen),access)
  }
  r=await h.api(root+'/'+key+'/review',{...review,version:r.version})
  const old=r
  await h.api(match(key)+'/approve',selection(r.donorReview,chosen),{as:admin.cookie})
  await h.api('/auth/operator/status',{operatorId:admin.id,status:'inactive'})
  r=await h.get(root+'/'+key);await h.api(root+'/'+key+'/approve',approval(r),{status:409});await emptyMoney()
  await h.api(match(key)+'/refresh',{})
  const current=await h.get('/api/coffer/donors/'+chosen.id)
  await h.command('donor.update',{donorId:chosen.id,version:current.donor.version,name:'Synthetic Shop Reviewed',email:mail(3010),household:'Synthetic shop household'})
  await h.api(match(key)+'/approve',selection((await h.get(root+'/'+key)).donorReview,chosen),{status:409})
  await h.api(match(key)+'/refresh',{})
  await shopOrdersBrowser(h,{id:key,stage:'review',review,chosen:'Synthetic Shop Reviewed'})
  r=await h.get(root+'/'+key)
  await h.api(root+'/'+key+'/approve',approval(old),{status:409})
  const decision=approval(r),results=await Promise.all([h.request(root+'/'+key+'/approve',{method:'POST',body:decision}),h.request(root+'/'+key+'/approve',{method:'POST',body:decision})])
  assert.ok(results.some(r=>r.status===200));for(const result of results)assert.ok([200,409].includes(result.status),await result.text())
  await h.api(root+'/'+key+'/approve',decision)
  r=await h.get(root+'/'+key);assert.equal(r.state,'reconciled')
  const gifts=await h.get('/api/coffer/donors/'+chosen.id),gift=gifts.gifts[0]
  assert.equal(gifts.gifts.length,1);assert.equal(gift.amount_cents,2500);assert.equal(gift.source_provider,'Shopify contribution allocation');assert.equal(gift.source_fee_cents,100);assert.equal(gifts.totals.lifetimeCents,2500);assert.equal(gifts.consents.length,0)
  assert.equal((await h.get('/api/coffer/donors/'+first.id)).gifts.length,0)
  const fees=await h.get('/api/coffer/payments/fees')
  assert.deepEqual(fees.totals,{gross_cents:2500,fee_cents:100,net_cents:2400});assert.deepEqual(fees.byForm,[{id:null,name:'No recorded giving form',...fees.totals}]);assert.equal(fees.lines[0].provider,'shopify');assert.match(fees.lines[0].allocation_label,/allocation/)
  assert.equal((await h.get('/api/coffer/payments')).payouts.length,0,'Contribution allocation never invents a whole shop payout')
  assert.equal(r.reconciliation.excluded_cents,4920);assert.equal(r.reconciliation.order_fee_cents,250);assert.equal(r.reconciliation.noncontribution_fee_cents,150);assert.equal(r.reconciliation.order_net_cents,7170);assert.equal(2400+4920-150,7170)
  const receipt=await h.command('ack.prepare',{giftIds:[gift.id]}),letters=await h.get('/api/coffer/letters/'+receipt.id),letter=letters.letters[0]
  assert.equal(letter.amount_cents,2500);assert.match(letter.body,/25\.00/);assert.doesNotMatch(letter.body,/74\.20|49\.20|24\.00/)
  await h.command('ack.send',{batchId:receipt.id,version:1},{status:409})
  await h.command('ack.approve',{batchId:receipt.id,version:1})
  assert.equal(h.messages.filter(m=>/receipt/i.test(m.subject??'')).length,0)
  const file=await h.api('/api/coffer/donors/'+chosen.id+'/data-request',{requestedOn:'2026-09-04',method:'other',reference:'synthetic-coffer-3014'})
  assert.ok(!file.records.shop_orders);assert.ok(!file.records.shop_events);assert.ok(!file.records.payment_donor_matches);assert.ok(!JSON.stringify(file).includes('source_hash'));assert.ok(!JSON.stringify(file).includes('\"source_id\":\"'+String(paid.id*10+3)+'\"'))
  await shopOrdersBrowser(h,{id:key,stage:'reconciled'})
  const originalAfterReceipt=(await h.get('/api/coffer/donors/'+chosen.id)).gifts.find(g=>g.id===gift.id)
  const refund=addRefund(paid)
  assert.equal((await send(refund,{topic:refundTopic})).status,200)
  await h.command('ack.send',{batchId:receipt.id,version:2},{status:409})
  assert.ok((await h.get('/api/coffer/letters/'+receipt.id)).letters[0].void_reason)
  await h.command('ack.correct',{letterId:letter.id},{status:409})
  const refundTransaction=transactions.get(paid.id).pop();paid.financial_status='paid'
  let lagged=await h.get(root+'/'+key)
  lagged=await h.api(root+'/'+key+'/review',{...review,version:lagged.version})
  assert.equal(lagged.state,'refund-held');assert.equal(lagged.refund_pending,1);assert.equal(lagged.fingerprint,null)
  await h.command('ack.prepare',{giftIds:[gift.id]},{status:409})
  await h.api(root+'/'+key+'/approve',approval(lagged),{status:409})
  transactions.get(paid.id).push(refundTransaction);paid.financial_status='refunded'
  r=await h.get(root+'/'+key);assert.equal(r.state,'refund-held');await h.api(root+'/'+key+'/refund',approval(r),{status:409})
  assert.equal((await h.get('/api/coffer/donors/'+chosen.id)).totals.lifetimeCents,2500)
  await h.api(root+'/'+key+'/review',{...review,refundContributionFee:'1.00',refundNoncontributionFee:'-1.00',version:r.version},{status:409})
  r=await h.api(root+'/'+key+'/review',{...review,refundContributionFee:'0.00',refundNoncontributionFee:'0.00',version:r.version})
  await h.api(root+'/'+key+'/refund',approval(r))
  await h.api(root+'/'+key+'/refund',approval(r));assert.equal((await send(refund,{topic:refundTopic})).status,200)
  assert.equal((await send(refund,{topic:refundTopic,event:'synthetic-coffer-refund-redelivery'})).status,200)
  assert.equal((await h.get(root+'/'+key)).state,'refunded')
  const reversed=await h.get('/api/coffer/donors/'+chosen.id)
  assert.equal(reversed.gifts.filter(g=>g.kind==='reversal').length,1);assert.equal(reversed.gifts.find(g=>g.kind==='reversal').source_provider,'Shopify contribution allocation');assert.equal(reversed.totals.lifetimeCents,0)
  assert.deepEqual(reversed.gifts.find(g=>g.id===gift.id),originalAfterReceipt)
  assert.ok((await h.get('/api/coffer/letters/'+receipt.id)).letters[0].void_reason)
  await h.command('ack.correct',{letterId:letter.id},{status:409})
  assert.deepEqual((await h.get('/api/coffer/payments/fees')).totals,{gross_cents:0,fee_cents:100,net_cents:-100})
  const refundTotals=(await h.get(root+'/'+key)).reconciliation
  assert.equal(refundTotals.gross_cents,0);assert.equal(refundTotals.fee_cents,100);assert.equal(refundTotals.net_cents,-100);assert.equal(refundTotals.noncontribution_net_cents,-150);assert.equal(refundTotals.order_net_cents,-250)
  await shopOrdersBrowser(h,{id:key,stage:'refunded'})
  const merchandise=put(order(3020,mail(3010),{donation:false})),merchResponse=await send(merchandise),merchKey=(await merchResponse.json()).id
  let merch=await h.get(root+'/'+merchKey)
  await h.api(root+'/'+merchKey+'/review',{...review,donationLineId:String(merchandise.id*10+2),version:merch.version},{status:409})
  assert.equal((await h.get('/api/coffer/donors/'+chosen.id)).totals.lifetimeCents,0)
  const early=put(order(3021,mail(3010))),earlyRefund=addRefund(early)
  const earlyKey=(await (await send(earlyRefund,{topic:refundTopic})).json()).id
  assert.equal((await send({...early,financial_status:'paid'})).status,200)
  let er=await h.get(root+'/'+earlyKey)
  const earlyTransaction=transactions.get(early.id).pop();early.financial_status='paid'
  er=await h.api(root+'/'+earlyKey+'/review',{...review,donationLineId:String(early.id*10+2),version:er.version})
  assert.equal(er.state,'refund-held');assert.equal(er.gift_id,null);assert.equal(er.refund_pending,1)
  await h.api(root+'/'+earlyKey+'/approve',approval(er),{status:409})
  transactions.get(early.id).push(earlyTransaction);early.financial_status='refunded'
  er=await h.api(root+'/'+earlyKey+'/review',{...review,donationLineId:String(early.id*10+2),version:er.version,refundContributionFee:'0.00',refundNoncontributionFee:'0.00'})
  assert.equal(er.state,'refund-held');assert.equal(er.gift_id,null)
  await h.api(match(earlyKey)+'/approve',selection(er.donorReview,chosen))
  er=await h.get(root+'/'+earlyKey)
  await h.api(root+'/'+earlyKey+'/approve',approval(er),{status:409})
  await h.api(root+'/'+earlyKey+'/refund',approval(er))
  assert.equal((await h.get('/api/coffer/donors/'+chosen.id)).totals.lifetimeCents,0,'Refund-before-review needs separate exact full-refund approval')
  // Private evidence survives restore; installation and owner authority never do.
  const pending=put(order(3022,mail(3010))),pendingKey=(await (await send(pending)).json()).id
  let p=await h.get(root+'/'+pendingKey)
  p=await h.api(root+'/'+pendingKey+'/review',{...review,donationLineId:String(pending.id*10+2),version:p.version})
  await h.api(match(pendingKey)+'/approve',selection(p.donorReview,chosen));p=await h.get(root+'/'+pendingKey)
  const inFlightAdmin=await h.person(mail(3040),'admin'),beforeInFlight=(await h.get('/api/coffer/donors/'+chosen.id)).gifts.length
  let release,notify
  paused=new Promise(resolve=>{release=resolve})
  const reached=new Promise(resolve=>{notify=resolve});entered=notify
  const inFlight=h.request(root+'/'+pendingKey+'/approve',{method:'POST',body:approval(p),as:inFlightAdmin.cookie})
  await reached
  await h.api('/auth/operator/status',{operatorId:inFlightAdmin.id,status:'inactive'})
  release();assert.equal((await inFlight).status,401)
  assert.equal((await h.get('/api/coffer/donors/'+chosen.id)).gifts.length,beforeInFlight,'Revocation during provider reads cannot release money')
  const sendStripe=async (id,expected=200)=>{
   const raw=JSON.stringify({id:'synthetic-coffer-stripe-event-'+id,type:'charge.succeeded',data:{object:{id}}}),t=Date.parse(fixedNow)/1000
   const sig=createHmac('sha256',bindings.STRIPE_WEBHOOK_SECRET).update(`${t}.${raw}`).digest('hex')
   const response=await h.request('/api/coffer/giving/webhook',{method:'POST',raw,as:'',headers:{'stripe-signature':`t=${t},v1=${sig}`}})
   assert.equal(response.status,expected,await response.text())
  }
  const stripeCharge=(id,email,amount=7420)=>{
   const c={id,status:'succeeded',paid:true,amount,currency:'usd',created:Date.parse(fixedNow)/1000,amount_refunded:0,metadata:{fund:'Reading'},billing_details:{name:'Synthetic shop processor',email},balance_transaction:'txn_'+id}
   const b={id:c.balance_transaction,source:id,amount,fee:250,net:amount-250,currency:'usd',status:'available',type:'charge',created:c.created}
   stripeObjects.set('/v1/charges/'+id,c);stripeObjects.set('/v1/balance_transactions/'+b.id,b);return c
  }
  const campaign=await h.api('/api/coffer/giving/campaigns',{name:'Synthetic shop campaign',slug:'synthetic-shop-campaign',description:'Community support.',fund:'Reading',goal:'1000'})
  const linked=put(order(3041,mail(3010))),linkedCharge=stripeCharge('ch_synthetic_coffer_shop_3041',mail(3010))
  linked.line_items[1].properties.find(p=>p.name==='_coffer_campaign').value=campaign.id
  transactions.set(linked.id,[{...capture(linked),gateway:'stripe',authorization:linkedCharge.id}])
  const linkedKey=(await (await send(linked)).json()).id
  let linkedReview=await h.get(root+'/'+linkedKey)
  linkedReview=await h.api(root+'/'+linkedKey+'/review',{...review,donationLineId:String(linked.id*10+2),campaign:campaign.id,version:linkedReview.version})
  assert.equal(linkedReview.state,'review')
  await sendStripe(linkedCharge.id)
  assert.equal((await h.get('/api/coffer/donors/'+chosen.id)).gifts.length,beforeInFlight,'Bound processor observation cannot record a whole order as a gift')
  await h.api(match(linkedKey)+'/approve',selection(linkedReview.donorReview,chosen))
  linkedReview=await h.get(root+'/'+linkedKey)
  await h.api(root+'/'+linkedKey+'/approve',approval(linkedReview))
  await sendStripe(linkedCharge.id)
  assert.equal((await h.get('/api/coffer/donors/'+chosen.id)).totals.lifetimeCents,2500)
  assert.equal((await h.get('/api/coffer/giving/campaigns')).campaigns.find(c=>c.id===campaign.id).raised_cents,2500)
  assert.equal((await h.get('/api/coffer/payments/fees')).byCampaign.find(c=>c.id===campaign.id).gross_cents,2500)
  const unrelated=await donor(h,'Synthetic Shop Unrelated',{email:mail(3042)})
  const independent=stripeCharge('ch_synthetic_coffer_unrelated_3042',mail(3042),5000)
  await sendStripe(independent.id)
  assert.equal((await h.get('/api/coffer/donors/'+unrelated.id)).totals.lifetimeCents,5000,'Shop binding never suppresses unrelated Stripe payments')
  const conflicting=put(order(3043,mail(3010))),priorCharge=stripeCharge('ch_synthetic_coffer_prior_3043',mail(3042))
  await sendStripe(priorCharge.id)
  const originalPrior=(await h.get('/api/coffer/donors/'+unrelated.id)).gifts.find(g=>g.reference===priorCharge.id)
  transactions.set(conflicting.id,[{...capture(conflicting),gateway:'stripe',authorization:priorCharge.id}])
  const conflictKey=(await (await send(conflicting)).json()).id,conflictReview=await h.get(root+'/'+conflictKey)
  await h.api(root+'/'+conflictKey+'/review',{...review,donationLineId:String(conflicting.id*10+2),version:conflictReview.version},{status:409})
  assert.deepEqual((await h.get('/api/coffer/donors/'+unrelated.id)).gifts.find(g=>g.id===originalPrior.id),originalPrior,'Prior processor imports remain unchanged')
  const unsupported=put(order(3044,mail(3010)))
  transactions.set(unsupported.id,[{...capture(unsupported),gateway:'unsupported-shared-gateway'}])
  const unsupportedKey=(await (await send(unsupported)).json()).id
  let unsupportedReview=await h.get(root+'/'+unsupportedKey)
  unsupportedReview=await h.api(root+'/'+unsupportedKey+'/review',{...review,donationLineId:String(unsupported.id*10+2),version:unsupportedReview.version})
  assert.equal(unsupportedReview.state,'held');assert.match(unsupportedReview.issues.join(' '),/ownership is unsupported/)
  const changed=put(order(3045,mail(3010))),changedKey=(await (await send(changed)).json()).id
  assert.equal((await send({...changed,line_items:changed.line_items.map((l,i)=>i?{...l,price:'26.00'}:l),total_price:'75.20'},{event:'synthetic-coffer-source-change'})).status,200)
  const changedReview=await h.get(root+'/'+changedKey)
  await h.api(root+'/'+changedKey+'/review',{...review,donationLineId:String(changed.id*10+2),version:changedReview.version},{status:409})
  const racing=put(order(3051,mail(3010))),racingCharge=stripeCharge('ch_synthetic_coffer_race_3051',mail(3042))
  transactions.set(racing.id,[{...capture(racing),gateway:'stripe',authorization:racingCharge.id}])
  const racingKey=(await (await send(racing)).json()).id
  const racingReview=await h.get(root+'/'+racingKey)
  let releaseStripe,notifyStripe
  pausedStripe=new Promise(resolve=>{releaseStripe=resolve})
  const stripeReached=new Promise(resolve=>{notifyStripe=resolve});enterStripe=notifyStripe;pauseStripeId=racingCharge.id
  const genericInFlight=sendStripe(racingCharge.id,409)
  await stripeReached
  assert.equal((await h.api(root+'/'+racingKey+'/review',{...review,donationLineId:String(racing.id*10+2),version:racingReview.version})).state,'review')
  releaseStripe();await genericInFlight;pauseStripeId=null
  await sendStripe(racingCharge.id)
  assert.equal((await h.get('/api/coffer/donors/'+unrelated.id)).totals.lifetimeCents,12420,'A binding committed during generic recording wins before any whole-charge gift')
  const backup=await archive(h)
  assert.ok(!JSON.stringify(backup).includes('private-session'));assert.ok(!JSON.stringify(backup).includes(bindings.SHOPIFY_ACCESS_TOKEN))
  const fresh=await installation({...options,givingProtection:false})
  try{
   await restore(fresh,backup)
   assert.equal((await fresh.get(root+'/'+key)).state,'refunded')
   assert.deepEqual((await fresh.get('/api/coffer/payments/fees')).totals,(await h.get('/api/coffer/payments/fees')).totals)
   await fresh.api(root+'/'+pendingKey+'/approve',approval(p),{status:409})
   assert.ok((await fresh.get(root+'/'+pendingKey)).source)
  }finally{await fresh.close()}
  await h.command('ack.discard',{batchId:receipt.id,version:2})
  const merge=await h.get('/api/coffer/duplicates/compare?source='+first.id+'&target='+chosen.id)
  await h.command('donor.merge',{sourceDonorId:first.id,donorId:chosen.id,sourceVersion:merge.source.version,version:merge.target.version,reason:'duplicate_record'})
  await h.api(root+'/'+pendingKey+'/approve',approval(p),{status:409})
  await h.command('donor.erase',{donorId:chosen.id,confirm:'ERASE'})
  const erased=await h.get(root+'/'+key)
  assert.equal(erased.state,'erased');assert.equal(erased.source,null);assert.deepEqual(erased.facts,{});assert.equal(erased.evidence,null)
  assert.equal((await h.get(match(pendingKey))).state,'erased')
  assert.equal((await send(paidOriginal)).status,200)
  const later=put({...order(3023,mail(3099)),customer:paid.customer})
  const laterKey=(await (await send(later)).json()).id
  assert.equal((await h.get(root+'/'+laterKey)).state,'erased','Opaque shop customer custody blocks changed-email resurrection')
  assert.equal((await h.get('/api/coffer/donors')).total,1)
  assert.equal((await h.get('/api/coffer/donors/'+unrelated.id)).totals.lifetimeCents,12420)
  const after=await archive(h),copy=await installation({...options,givingProtection:false})
  try{await restore(copy,backup,{status:400,laterJournal:{sourceIdentity:after[0].sourceIdentity,epoch:after[0].epoch,journal:after[0].journal}})}finally{await copy.close()}
 },options)
}
