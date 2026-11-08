import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {run,donor,reviewed,settings,archive,restore,installation} from './harness.mjs'
import {shopOrdersBrowser} from './shop-orders-browser.mjs'

const mail=n=>'synthetic-coffer-'+n+String.fromCharCode(64)+'example.test'
const secret='synthetic-coffer-3001',domain='synthetic-coffer-3002.myshopify.com',shopId='3003'
const root='/api/coffer/payments/shops',match=id=>'/api/coffer/payments/donor-matches/'+id
const order=(id,email,{donation=true}={})=>({id,email,customer:{id:8000+id},currency:'USD',financial_status:'paid',cancelled_at:null,processed_at:'2026-09-01T12:00:00Z',total_price:'74.20',total_tax:'3.20',total_discounts:'0.00',total_shipping_price_set:{shop_money:{amount:'6.00',currency_code:'USD'}},line_items:[{id:id*10+1,quantity:1,price:'40.00',total_discount:'0.00',tax_lines:[{price:'3.20'}],properties:[{name:'_coffer_kind',value:'merchandise'}]},{id:id*10+2,quantity:1,price:'25.00',total_discount:'0.00',tax_lines:[],properties:[{name:'_coffer_kind',value:donation?'donation':'merchandise'},{name:'_coffer_fund',value:'Reading'},{name:'_coffer_campaign',value:'none'}]}]})
const capture=o=>({id:o.id*10+3,order_id:o.id,amount:'74.20',currency:'USD',status:'success',kind:'sale',gateway:'shopify_payments'})
const balance=(o,tx)=>({id:tx.id+10000,source_order_id:o.id,source_order_transaction_id:tx.id,source_type:tx.kind==='refund'?'refund':'charge',amount:tx.kind==='refund'?'-74.20':'74.20',fee:tx.kind==='refund'?'0.00':'2.50',net:tx.kind==='refund'?'-74.20':'71.70',currency:'USD',payout_id:3004,payout_status:'paid'})
const approval=r=>({version:r.version,fingerprint:r.fingerprint,confirm:'yes'})
const selection=(v,d)=>({version:v.version,donorId:d.id,donorVersion:v.candidates.find(c=>c.id===d.id)?.version??1,confirm:'yes'})
export async function shopOrdersJourney(){
 const orders=new Map(),transactions=new Map(),balances=[],stripeObjects=new Map();let calls=0,settlementAvailable=true,shop=shopId,paused,entered
 const put=o=>{orders.set(o.id,o);const t=capture(o);transactions.set(o.id,[t]);balances.push(balance(o,t));return o}
 const addRefund=o=>{o.financial_status='refunded';const t={...capture(o),id:o.id*10+4,kind:'refund',parent_id:o.id*10+3};transactions.get(o.id).push(t);balances.push(balance(o,t));return {id:o.id*10+5,order_id:o.id,transactions:[t]}}
 const edge=async request=>{
  calls++;assert.equal(request.method,'GET','Shop flows never initiate provider writes')
  const u=new URL(request.url)
  if(u.hostname==='api.stripe.com'){
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
  const paid=put(order(3011,mail(3010)))
  const send=async(payload,{topic='orders/paid',event='synthetic-coffer-event-'+payload.id,bad=false,shopDomain=domain}={})=>{
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
  assert.equal(r.state,'held');assert.equal(r.donorReview.candidates.length,2)
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
  assert.equal(gifts.gifts.length,1);assert.equal(gift.amount_cents,2500);assert.equal(gifts.totals.lifetimeCents,2500);assert.equal(gifts.consents.length,0)
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
  assert.ok(!file.records.shop_orders);assert.ok(!file.records.shop_events);assert.ok(!file.records.payment_donor_matches);assert.ok(!JSON.stringify(file).includes('source_hash'))
  await shopOrdersBrowser(h,{id:key,stage:'reconciled'})
  const originalAfterReceipt=(await h.get('/api/coffer/donors/'+chosen.id)).gifts.find(g=>g.id===gift.id)
  const refund=addRefund(paid)
  assert.equal((await send(refund,{topic:'refunds/create'})).status,200)
  r=await h.get(root+'/'+key);assert.equal(r.state,'refund-held');await h.api(root+'/'+key+'/refund',approval(r),{status:409})
  assert.equal((await h.get('/api/coffer/donors/'+chosen.id)).totals.lifetimeCents,2500)
  r=await h.api(root+'/'+key+'/review',{...review,refundContributionFee:'0.00',refundNoncontributionFee:'0.00',version:r.version})
  await h.api(root+'/'+key+'/refund',approval(r))
  await h.api(root+'/'+key+'/refund',approval(r));assert.equal((await send(refund,{topic:'refunds/create'})).status,200)
  const reversed=await h.get('/api/coffer/donors/'+chosen.id)
  assert.equal(reversed.gifts.filter(g=>g.kind==='reversal').length,1);assert.equal(reversed.totals.lifetimeCents,0)
  assert.deepEqual(reversed.gifts.find(g=>g.id===gift.id),originalAfterReceipt)
  assert.ok((await h.get('/api/coffer/letters/'+receipt.id)).letters[0].void_reason)
  await h.command('ack.correct',{letterId:letter.id},{status:409})
  assert.deepEqual((await h.get('/api/coffer/payments/fees')).totals,{gross_cents:0,fee_cents:100,net_cents:-100})
  await shopOrdersBrowser(h,{id:key,stage:'refunded'})
  const merchandise=put(order(3020,mail(3010),{donation:false})),merchResponse=await send(merchandise),merchKey=(await merchResponse.json()).id
  let merch=await h.get(root+'/'+merchKey)
  await h.api(root+'/'+merchKey+'/review',{...review,donationLineId:String(merchandise.id*10+2),version:merch.version},{status:409})
  assert.equal((await h.get('/api/coffer/donors/'+chosen.id)).totals.lifetimeCents,0)
  const early=put(order(3021,mail(3010))),earlyRefund=addRefund(early)
  const earlyKey=(await (await send(earlyRefund,{topic:'refunds/create'})).json()).id
  assert.equal((await send({...early,financial_status:'paid'})).status,200)
  let er=await h.get(root+'/'+earlyKey)
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
  const backup=await archive(h),fresh=await installation({...options,givingProtection:false})
  try{
   await restore(fresh,backup)
   assert.equal((await fresh.get(root+'/'+key)).state,'refunded')
   assert.deepEqual((await fresh.get('/api/coffer/payments/fees')).totals,(await h.get('/api/coffer/payments/fees')).totals)
   await fresh.api(root+'/'+pendingKey+'/approve',approval(p),{status:409})
   assert.ok((await fresh.get(root+'/'+pendingKey)).source)
  }finally{await fresh.close()}
  const merge=await h.get('/api/coffer/duplicates/compare?source='+first.id+'&target='+chosen.id)
  await h.command('donor.merge',{sourceDonorId:first.id,donorId:chosen.id,sourceVersion:merge.source.version,version:merge.target.version,reason:'duplicate_record'})
  await h.api(root+'/'+pendingKey+'/approve',approval(p),{status:409})
  await h.command('donor.erase',{donorId:chosen.id,confirm:'ERASE'})
  const erased=await h.get(root+'/'+key)
  assert.equal(erased.state,'erased');assert.equal(erased.source,null);assert.deepEqual(erased.facts,{});assert.equal(erased.evidence,null)
  assert.equal((await h.get(match(pendingKey))).state,'erased')
  assert.equal((await send(paid)).status,200)
  const later=put({...order(3023,mail(3099)),customer:paid.customer})
  const laterKey=(await (await send(later)).json()).id
  assert.equal((await h.get(root+'/'+laterKey)).state,'erased','Opaque shop customer custody blocks changed-email resurrection')
  assert.equal((await h.get('/api/coffer/donors')).total,0)
  const after=await archive(h),copy=await installation({...options,givingProtection:false})
  try{await restore(copy,backup,{status:400,laterJournal:{sourceIdentity:after[0].sourceIdentity,epoch:after[0].epoch,journal:after[0].journal}})}finally{await copy.close()}
 },options)
}
