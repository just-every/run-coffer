import { manager, person } from '../../auth'
import { all, commit, event, fail, guard, one, sha256, sql, text, CofferError, type Context, type Row, type Stmt } from '../../db'
import { erasureHash } from '../../imports/snapshots'
import { currentDonors, donorMatchView, emailCandidates, matchGuards } from '../donor-match'
import { paymentWrite } from '../write'
import { connection, decimal, home, observe, orderFacts, sourceId, type ShopEnv } from './provider'

function authorize(c:Context){if(!manager(c.actor)||!person(c.actor))fail('manager_required','Only a current owner or admin reviews shop money.',403)}
const keyFor=async(env:ShopEnv,orderId:string)=>'shop-'+await sha256(home(env)+'\n'+connection(env).shop+'\n'+orderId)
const sourceGuard=(r:Row)=>guard('EXISTS(SELECT 1 FROM cf_shop_orders WHERE id=? AND version=? AND state<>\'erased\')','SHOP_CHANGED','The order changed. Refresh its exact review.',r.id,r.version)
const candidatesGuard=(r:Row)=>guard(`(SELECT json_group_array(json_object('id',id,'version',version)) FROM (${currentDonors}))=?`,'MATCH_CHANGED','Matching donors changed.',r.email,r.candidates)
function bound(c:Context,r:Row){const env=c.env as ShopEnv,b=connection(env);if(r.installation_id!==home(env)||r.shop_domain!==b.domain||r.shop_id!==b.shop)fail('SHOP_BINDING','This source belongs to another installation or shop.')}

export async function shopOrder(c:Context,key:string):Promise<Row>{
 authorize(c)
 const r=await one(c,'SELECT * FROM cf_shop_orders WHERE id=?',key)
 if(!r)fail('NOT_FOUND','That order review is unavailable.',404)
 const review=await donorMatchView(c,key),facts=JSON.parse(r.facts),evidence=r.evidence?JSON.parse(r.evidence):null
 return {...r,facts,issues:JSON.parse(r.issues),review:r.review?JSON.parse(r.review):null,evidence,donorReview:review,
  reconciliation:r.gift_id&&r.state!=='erased'?{label:'Qualified contribution allocation; not the whole shop payout',gross_cents:review.facts.amount,fee_cents:JSON.parse(r.review).contributionFee,net_cents:review.facts.amount-JSON.parse(r.review).contributionFee,excluded_cents:facts.total-review.facts.amount,order_fee_cents:evidence?.fee,noncontribution_fee_cents:JSON.parse(r.review).noncontributionFee,order_net_cents:facts.total-(evidence?.fee??0),refunded:r.state==='refunded'}:null}
}
export async function shopOrders(c:Context){authorize(c);return {orders:await all(c,'SELECT id,order_id,state,created_at FROM cf_shop_orders ORDER BY created_at DESC,id')}}

/** Authentication covers the exact bytes, before parsing or observing anything. */
export async function shopWebhook(request:Request,env:ShopEnv):Promise<Response>{
 try{
  if(request.method!=='POST')fail('method_not_allowed','Use a signed Shopify webhook.',405)
  const b=connection(env)
  if(request.headers.get('x-shopify-shop-domain')!==b.domain)fail('SHOP_BINDING','The signed shop is not this connection.',400)
  const topic=request.headers.get('x-shopify-topic'),eventId=request.headers.get('x-shopify-event-id')
  if(!['orders/paid','refunds/create'].includes(topic??'')||!eventId||eventId.length>200)fail('SHOP_EVENT','A supported event identity and topic are required.',400)
  const bytes=await request.arrayBuffer();if(bytes.byteLength>200000)fail('SHOP_EVENT','This order requires manual source review.',413)
  let signature:Uint8Array<ArrayBuffer>;try{signature=Uint8Array.from(atob(request.headers.get('x-shopify-hmac-sha256')??''),c=>c.charCodeAt(0))}catch{fail('SHOP_SIGNATURE','Invalid Shopify signature.',400)}
  const cryptoKey=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.SHOPIFY_WEBHOOK_SECRET!),{name:'HMAC',hash:'SHA-256'},false,['verify'])
  if(!await crypto.subtle.verify('HMAC',cryptoKey,signature!,bytes))fail('SHOP_SIGNATURE','Invalid Shopify signature.',400)
  let raw:string;try{raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes)}catch{fail('SHOP_EVENT','Unreadable Shopify payload.',400)}
  let payload:Row;try{payload=JSON.parse(raw)}catch{fail('SHOP_EVENT','Unreadable Shopify payload.',400)}
  const orderId=sourceId(topic==='orders/paid'?payload.id:payload.order_id),key=await keyFor(env,orderId),hash=await sha256(raw),eventKey=await sha256(b.domain+'\n'+eventId)
  const c={db:env.DB},existing=await one(c,'SELECT * FROM cf_shop_orders WHERE id=?',key),prior=await one(c,'SELECT * FROM cf_shop_events WHERE id=?',eventKey)
  if(prior){if(prior.payload_hash!==hash||prior.order_key!==key||prior.topic!==topic)fail('SHOP_EVENT_CONFLICT','An event identity already has different source facts.');return Response.json({id:key,state:existing?.state})}
  if(existing?.state==='erased')return Response.json({id:key,state:'erased'})
  let facts:Row={},issues:string[]=[],sourceHash:string|null=null
  if(topic==='orders/paid'){
   try{facts=orderFacts(payload);sourceHash=await sha256(JSON.stringify(facts))}catch(e){if(!(e instanceof CofferError))throw e;issues.push(e.message)}
  }
  const identityHash=topic==='orders/paid'&&payload.customer?.id?erasureHash(b.shop+':'+String(payload.customer.id)):null
  const mail=String(facts.email??payload.email??'').trim().toLowerCase(),candidates=mail?await emailCandidates(c,mail):[],now=new Date().toISOString()
  const erased=await one(c,'SELECT hash FROM cf_erasures WHERE hash=? UNION SELECT hash FROM cf_shop_erased_identities WHERE hash=?',erasureHash(mail),identityHash??'')
  if(erased){issues=['The source identity was erased.'];facts={};sourceHash=null}
  const stmts:Stmt[]=[guard(`NOT EXISTS(SELECT 1 FROM cf_shop_orders WHERE id=? AND state='erased') AND NOT EXISTS(SELECT 1 FROM cf_erasures WHERE hash=?) AND NOT EXISTS(SELECT 1 FROM cf_shop_erased_identities WHERE hash=?)`,'SHOP_ERASED','This source identity was erased.',key,erasureHash(mail),identityHash??'')]
  if(erased)stmts.length=0
  if(!existing){
   stmts.push(sql("INSERT INTO cf_shop_orders(id,installation_id,shop_id,shop_domain,order_id,state,source_hash,source,facts,issues,created_at,identity_hash) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",key,home(env),b.shop,b.domain,orderId,erased?'erased':'held',sourceHash,erased?null:topic==='orders/paid'?raw:null,JSON.stringify(facts),JSON.stringify(issues),now,identityHash),
    sql("INSERT INTO cf_payment_donor_matches(charge_id,installation_id,account_id,state,email,facts,candidates,created_at,updated_at,provider) VALUES(?,?,?,?,?,?,?,?,?,'shopify')",key,home(env),b.shop,erased?'erased':'held',erased?null:mail||null,JSON.stringify({amount:0}),erased?'[]':JSON.stringify(candidates),now,now))
  }else if(topic==='orders/paid'&&!existing.source_hash&&sourceHash){
   stmts.push(sql("UPDATE cf_shop_orders SET source_hash=?,source=?,facts=?,issues='[]',version=version+1 WHERE id=?",sourceHash,raw,JSON.stringify(facts),key),sql("UPDATE cf_payment_donor_matches SET email=?,candidates=?,version=version+1 WHERE charge_id=?",mail,JSON.stringify(candidates),key))
  }else if(topic==='orders/paid'&&existing.source_hash!==sourceHash){
   stmts.push(sql("UPDATE cf_shop_orders SET state='held',issues=?,version=version+1,fingerprint=NULL WHERE id=?",JSON.stringify(['Conflicting source facts. Historical money remains unchanged.']),key))
  }else if(topic==='refunds/create')stmts.push(sql("UPDATE cf_shop_orders SET state='refund-held',version=version+1,fingerprint=NULL,issues=? WHERE id=?",JSON.stringify(['A refund was observed. Refresh exact payment and allocation evidence before human approval.']),key))
  stmts.push(sql('INSERT INTO cf_shop_events(id,order_key,topic,payload_hash,payload,created_at) VALUES(?,?,?,?,?,?)',eventKey,key,topic,hash,erased?null:raw,now))
  await paymentWrite(env,stmts)
  return Response.json({id:key,state:erased?'erased':'held'})
 }catch(e){if(e instanceof CofferError)return Response.json({error:e.code,message:e.message},{status:e.status});throw e}
}

export async function refreshShopDonor(c:Context,key:string){
 authorize(c);const r=await shopOrder(c,key);bound(c,r)
 if(r.state==='erased')fail('SHOP_ERASED','This source was erased.')
 if(r.donorReview.state==='resolved')return r.donorReview
 const candidates=await emailCandidates(c,r.donorReview.email??'')
 await commit(c,[sourceGuard(r),sql('UPDATE cf_shop_orders SET version=version+1 WHERE id=?',key),sql("UPDATE cf_payment_donor_matches SET state='held',candidates=?,version=version+1,donor_id=NULL,donor_version=NULL,approved_by=NULL,approved_actor_version=NULL,approved_version=NULL,approved_at=NULL WHERE charge_id=?",JSON.stringify(candidates),key)])
 return donorMatchView(c,key)
}
export async function selectShopDonor(c:Context,key:string,input:Row){
 authorize(c);const r=await shopOrder(c,key);bound(c,r);const row=r.donorReview
 if(r.state==='erased')fail('SHOP_ERASED','This source was erased.')
 if(input.confirm!=='yes'||Number(input.version)!==row.version||!row.candidates.some((d:Row)=>d.id===input.donorId&&d.version===Number(input.donorVersion)))fail('MATCH_CHANGED','Select an exact current donor candidate.')
 const candidates=await emailCandidates(c,row.email??'')
 if(JSON.stringify(candidates)!==JSON.stringify(row.candidates.map((d:Row)=>({id:d.id,version:d.version})).sort((a:Row,b:Row)=>a.id.localeCompare(b.id))))fail('MATCH_CHANGED','The donor candidates changed. Refresh first.')
 const actor=await one(c,'SELECT version FROM oa_operators WHERE id=?',c.actor.id),stored=await one(c,'SELECT * FROM cf_payment_donor_matches WHERE charge_id=?',key)
 if(row.state!=='held')fail('MATCH_CHANGED','Refresh this donor selection before changing it.')
 await commit(c,[sourceGuard(r),candidatesGuard(stored!),sql('UPDATE cf_shop_orders SET version=version+1 WHERE id=?',key),sql("UPDATE cf_payment_donor_matches SET state='approved',donor_id=?,donor_version=?,approved_by=?,approved_actor_version=?,approved_version=?,approved_at=?,version=version+1 WHERE charge_id=?",input.donorId,Number(input.donorVersion),c.actor.id,actor?.version,row.version,c.now,key),event(c,'payments.shopDonorSelected','shopOrder',key,input.donorId)])
 return donorMatchView(c,key)
}

export async function reviewShopOrder(c:Context,key:string,input:Row){
 authorize(c);const r=await shopOrder(c,key);bound(c,r)
 if(r.state==='erased'||Number(input.version)!==r.version)fail('SHOP_CHANGED','Review the current order version.')
 let o:Awaited<ReturnType<typeof observe>>
 try{o=await observe(c.env as ShopEnv,r.order_id)}catch(e){if(!(e instanceof CofferError))throw e;await commit(c,[sourceGuard(r),sql("UPDATE cf_shop_orders SET state='held',issues=?,fingerprint=NULL,version=version+1 WHERE id=?",JSON.stringify([e.message]),key)]);return shopOrder(c,key)}
 if(await sha256(JSON.stringify(o.facts))!==r.source_hash)fail('SHOP_CHANGED','Current Shopify order facts conflict with the signed paid order. Money stays held.')
 const donation=o.facts.lines.find((l:Row)=>l.id===String(input.donationLineId))
 if(!donation||donation.price<=0||donation.quantity!==1||donation.tax!==0||donation.properties._coffer_kind!=='donation'||o.facts.lines.some((l:Row)=>l.id!==donation.id&&l.properties._coffer_kind!=='merchandise'))fail('SHOP_CLASSIFICATION','Explicit source donation and merchandise classification is required; unsupported lines stay held.')
 if(input.confirm!=='yes'||input.fund!==donation.properties._coffer_fund||input.campaign!==donation.properties._coffer_campaign||!input.campaign)fail('SHOP_PROVENANCE','Confirm exact source fund and campaign provenance, including explicit none.')
 const fund=await one(c,'SELECT name FROM cf_funds WHERE name=?',input.fund)
 if(!fund||input.campaign!=='none'&&!await one(c,'SELECT id FROM cf_campaigns WHERE id=? AND fund=?',input.campaign,input.fund))fail('SHOP_PROVENANCE','Choose the existing source fund and campaign.')
 const contributionFee=decimal(input.contributionFee),noncontributionFee=decimal(input.noncontributionFee),refundContributionFee=o.refundId?decimal(input.refundContributionFee,true):0,refundNoncontributionFee=o.refundId?decimal(input.refundNoncontributionFee,true):0
 if(contributionFee>donation.price||noncontributionFee>o.facts.total-donation.price||contributionFee+noncontributionFee!==o.fee||refundContributionFee+refundNoncontributionFee!==o.refundFee)fail('SHOP_ALLOCATION','Supply an explicit contribution and noncontribution allocation equal to the actual fees.')
 const review={donationLineId:donation.id,amount:donation.price,fund:input.fund,campaign:input.campaign,contributionFee,noncontributionFee,refundContributionFee,refundNoncontributionFee,allocationReason:text(input.allocationReason,'Allocation explanation',500),classification:o.facts.lines.map((l:Row)=>({lineId:l.id,kind:l.id===donation.id?'donation':'merchandise'}))}
 if(r.gift_id&&['donationLineId','amount','fund','campaign','contributionFee','noncontributionFee','classification'].some(k=>JSON.stringify(review[k as keyof typeof review])!==JSON.stringify(r.review[k])))fail('SHOP_FROZEN','Recorded contribution facts cannot be reclassified.')
 const stmts:Stmt[]=[sourceGuard(r)]
 if(o.chargeId){
  const prior=await one(c,"SELECT id FROM cf_stripe_charges WHERE id=? UNION SELECT id FROM cf_gifts WHERE source='stripe' AND reference=?",o.chargeId,o.chargeId)
  const binding=await one(c,'SELECT * FROM cf_shop_processor_bindings WHERE charge_id=?',o.chargeId)
  if(prior||binding&&binding.order_key!==key)fail('SHOP_PROCESSOR_CONFLICT','This processor payment has conflicting prior custody. Historical gifts are unchanged.')
  stmts.push(guard('NOT EXISTS(SELECT 1 FROM cf_stripe_charges WHERE id=?) AND NOT EXISTS(SELECT 1 FROM cf_gifts WHERE source=\'stripe\' AND reference=?)','SHOP_PROCESSOR_CONFLICT','This charge already has conflicting custody.',o.chargeId,o.chargeId),sql('INSERT OR IGNORE INTO cf_shop_processor_bindings(charge_id,account_id,order_key) VALUES(?,?,?)',o.chargeId,o.account,key))
 }
 const fingerprint=await sha256(JSON.stringify({review,o}))
 stmts.push(sql("UPDATE cf_shop_orders SET review=?,evidence=?,fingerprint=?,state=?,issues='[]',version=version+1 WHERE id=?",JSON.stringify(review),JSON.stringify(o),fingerprint,o.refundId?'refund-held':'review',key),sql("UPDATE cf_payment_donor_matches SET facts=? WHERE charge_id=?",JSON.stringify({amount:donation.price,fund:input.fund,order:r.order_id}),key),event(c,'payments.shopReviewed','shopOrder',key,null,{amountCents:donation.price,excludedCents:o.facts.total-donation.price}))
 await commit(c,stmts);return shopOrder(c,key)
}

export async function approveShopOrder(c:Context,key:string,input:Row,refund=false){
 authorize(c);const r=await shopOrder(c,key);bound(c,r)
 if(r.state==='erased')fail('SHOP_ERASED','This source was erased.')
 if(r.state===(refund?'refunded':'reconciled')){await commit(c,[]);return r}
 if(input.confirm!=='yes'||Number(input.version)!==r.version||input.fingerprint!==r.fingerprint||!r.fingerprint||!r.review)fail('SHOP_CHANGED','Approve the exact current reviewed contribution and allocation.')
 const o=await observe(c.env as ShopEnv,r.order_id),v=r.review
 if(JSON.stringify(o)!==JSON.stringify(r.evidence)||Boolean(o.refundId)!==refund)fail('SHOP_CHANGED','Payment or refund facts changed. Refresh the review before money.')
 const row=await one(c,'SELECT * FROM cf_payment_donor_matches WHERE charge_id=?',key)
 if(!row||!r.gift_id&&row.state!=='approved')fail('MATCH_CHANGED','Select a current donor before money approval.')
 const donor=r.gift_id?await one(c,'SELECT d.* FROM cf_gifts g JOIN cf_donors d ON d.id=g.donor_id WHERE g.id=? AND d.erased_at IS NULL',r.gift_id):await one(c,'SELECT * FROM cf_donors WHERE id=? AND erased_at IS NULL',row.donor_id)
 if(!donor)fail('MATCH_CHANGED','The original donor is unavailable.')
 const giftId=r.gift_id??'shop-gift-'+key,stmts:Stmt[]=[sourceGuard(r),guard('EXISTS(SELECT 1 FROM cf_donors WHERE id=? AND version=? AND erased_at IS NULL) AND NOT EXISTS(SELECT 1 FROM cf_donor_merges WHERE donor_id=?)','MATCH_CHANGED','The donor changed.',donor.id,donor.version,donor.id)]
 if(!r.gift_id){
  if(row.candidates!==JSON.stringify(await emailCandidates(c,row.email??'')))fail('MATCH_CHANGED','Matching identities changed. Refresh donor selection.')
  stmts.push(...matchGuards(row),candidatesGuard(row),guard('EXISTS(SELECT 1 FROM cf_funds WHERE name=?)','SHOP_PROVENANCE','The fund changed.',v.fund))
  if(v.campaign!=='none')stmts.push(guard('EXISTS(SELECT 1 FROM cf_campaigns WHERE id=? AND fund=?)','SHOP_PROVENANCE','The campaign changed.',v.campaign,v.fund),sql('INSERT INTO cf_campaign_gifts(gift_id,campaign_id) VALUES(?,?)',giftId,v.campaign))
  // Insert the gift before its foreign-key campaign link.
  const gift=sql("INSERT INTO cf_gifts(id,version,donor_id,kind,received_on,amount_cents,method,reference,fund,goods,goods_cents,source,created_at,created_by) VALUES(?,1,?,'gift',?,?,'card',?,?,'none',0,'manual',?,?)",giftId,donor.id,o.facts.date,v.amount,key,v.fund,c.now,c.actor.name)
  stmts.splice(1,0,gift)
  stmts.push(sql("INSERT INTO cf_payment_entries(id,source_id,kind,amount_cents,fee_cents,net_cents,fund,gift_id,currency,received_on,created_at) VALUES(?,?,'charge',?,?,?,?,?,'usd',?,?)",'shop-charge-'+key,o.payment,v.amount,v.contributionFee,v.amount-v.contributionFee,v.fund,giftId,o.facts.date,c.now),sql("UPDATE cf_payment_donor_matches SET state='resolved',version=version+1 WHERE charge_id=?",key))
 }
 if(refund){
  stmts.push(sql("INSERT INTO cf_payment_entries(id,source_id,kind,amount_cents,fee_cents,net_cents,fund,gift_id,contribution_cents,currency,received_on,created_at) VALUES(?,?,'refund',?,?,?,?,?,?,'usd',?,?)",'shop-refund-'+key,o.refundId,-v.amount,v.refundContributionFee,-v.amount-v.refundContributionFee,v.fund,giftId,-v.amount,c.now.slice(0,10),c.now))
 }
 stmts.push(sql('UPDATE cf_shop_orders SET gift_id=?,state=?,approved_by=?,approved_at=?,version=version+1 WHERE id=?',giftId,refund?'refunded':'reconciled',c.actor.id,c.now,key),event(c,refund?'payments.shopRefundApproved':'payments.shopMoneyApproved','gift',giftId,donor.id,{orderKey:key,contributionCents:v.amount,feeCents:v.contributionFee}))
 await commit(c,stmts);return shopOrder(c,key)
}

/** A bound shop charge never enters the generic whole-charge donation recorder.
 * Unrelated processor payments remain eligible for their existing paths. */
export async function shopStripeBound(env:ShopEnv,chargeId:string){
 const r=await one({db:env.DB},'SELECT account_id FROM cf_shop_processor_bindings WHERE charge_id=?',chargeId)
 if(!r)return false
 const account=await (await import('../../giving/stripe')).stripe(env,'/account')
 if(account.id!==r.account_id)fail('SHOP_BINDING','The shop processor observation belongs to another account.')
 return true
}
