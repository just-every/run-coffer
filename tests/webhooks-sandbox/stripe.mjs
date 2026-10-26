import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'

// Real Stripe test objects only. No event payloads are synthesized or signed here.
export async function stripeSandbox(key,prefix){
 assert.ok(typeof key==='string'&&/^(?:sk|rk)_test_/.test(key),'Inject a Stripe test-mode secret key')
 const source=await readFile('src/coffer/giving/stripe.ts','utf8')
 const version=/STRIPE_API_VERSION = '([^']+)'/.exec(source)?.[1]
 assert.ok(version,'Read the production Stripe API version')
 const owned={endpoint:null,customer:null,intent:null,charge:null,refundSubmitted:false,refunded:false}
 const safe=value=>typeof value==='string'&&/^[a-zA-Z0-9_[\].-]{1,100}$/.test(value)?value:'unspecified'
 const api=async(path,{method='GET',params,operation='read',timeout=30000}={})=>{
  const response=await fetch('https://api.stripe.com/v1'+path,{method,redirect:'manual',signal:AbortSignal.timeout(timeout),headers:{authorization:'Bearer '+key,'Stripe-Version':version,...(params?{'content-type':'application/x-www-form-urlencoded'}:{})},...(params?{body:new URLSearchParams(Object.entries(params).map(([name,value])=>[name,String(value)]))}:{})})
  let result;try{result=await response.json()}catch{throw Error('Stripe '+operation+' returned non-JSON HTTP '+response.status)}
  if(!response.ok)throw Error('Stripe '+operation+' refused HTTP '+response.status+' code='+safe(result.error?.code)+' type='+safe(result.error?.type)+' param='+safe(result.error?.param))
  if('livemode' in result)assert.equal(result.livemode,false,'Only Stripe test-mode objects are allowed')
  return result
 }
 const balance=await api('/balance',{operation:'test-mode preflight'})
 assert.equal(balance.livemode,false,'Stripe confirms test mode before any mutation')
 const endpoint=async origin=>{
  const result=await api('/webhook_endpoints',{method:'POST',operation:'create webhook endpoint',params:{url:origin+'/api/coffer/giving/webhook',description:prefix,api_version:version,'enabled_events[0]':'charge.succeeded','enabled_events[1]':'charge.refunded','enabled_events[2]':'refund.created','enabled_events[3]':'refund.updated'}})
  owned.endpoint=result.id
  assert.equal(result.livemode,false);assert.ok(result.secret,'Stripe returned this endpoint’s one-time signing secret')
  return {STRIPE_SECRET_KEY:key,STRIPE_WEBHOOK_SECRET:result.secret}
 }
 const charge=async()=>{
  const customer=await api('/customers',{method:'POST',operation:'create disposable customer',params:{email:'synthetic-coffer-3@example.test',name:'Coffer sandbox Stripe donor',description:prefix,'metadata[coffer_sandbox]':prefix}})
  owned.customer=customer.id
  const intent=await api('/payment_intents',{method:'POST',operation:'create disposable PaymentIntent',params:{amount:1234,currency:'usd',customer:customer.id,description:prefix,'metadata[coffer_sandbox]':prefix,'automatic_payment_methods[enabled]':true,'automatic_payment_methods[allow_redirects]':'never'}})
  owned.intent=intent.id
  // Record ownership before confirmation so cleanup can resolve ambiguity by GET.
  const paid=await api('/payment_intents/'+intent.id+'/confirm',{method:'POST',operation:'confirm disposable test payment',params:{payment_method:'pm_card_visa'}})
  assert.equal(paid.livemode,false);assert.equal(paid.status,'succeeded');assert.equal(paid.amount_received,1234)
  owned.charge=typeof paid.latest_charge==='string'?paid.latest_charge:paid.latest_charge?.id
  assert.ok(owned.charge,'Stripe returned the successful test charge')
  const current=await api('/charges/'+owned.charge,{operation:'read own test charge'})
  assert.equal(current.livemode,false);assert.equal(current.paid,true);assert.equal(current.amount,1234)
  return {customerId:owned.customer,intentId:owned.intent,chargeId:owned.charge}
 }
 const refund=async()=>{
  assert.ok(owned.charge,'Refund only the charge created by this run')
  assert.equal(owned.refundSubmitted,false,'Never retry an ambiguous Stripe mutation')
  owned.refundSubmitted=true
  const result=await api('/refunds',{method:'POST',operation:'refund own test charge',params:{charge:owned.charge,amount:1234,'metadata[coffer_sandbox]':prefix}})
  // A pending refund must never be submitted again by cleanup.
  owned.refunded=true
  assert.equal(result.status,'succeeded');assert.equal(result.amount,1234);assert.equal(result.charge,owned.charge)
  return result.id
 }
 const event=async(type,objectId)=>{
  const result=await api('/events?type='+encodeURIComponent(type)+'&limit=100',{operation:'read actual Stripe event'})
  const found=result.data.find(row=>row.data?.object?.id===objectId)
  assert.ok(found,'Stripe emitted the expected actual provider event');assert.equal(found.livemode,false)
  return found.id
 }
 const cleanup=async()=>{
  const failures=[]
  if(owned.endpoint)try{await api('/webhook_endpoints/'+owned.endpoint,{method:'DELETE',operation:'delete own webhook endpoint'});console.log(JSON.stringify({stage:'stripe-endpoint-deleted',id:owned.endpoint}))}catch(error){failures.push(error.message)}
  if(owned.intent&&!owned.refunded)try{
   const intent=await api('/payment_intents/'+owned.intent,{operation:'resolve own payment before cleanup'})
   if(intent.status==='succeeded'){
    owned.charge=typeof intent.latest_charge==='string'?intent.latest_charge:intent.latest_charge?.id
    const current=await api('/charges/'+owned.charge,{operation:'read own refund state'})
    if(!current.refunded&&current.amount_refunded===0){
     if(owned.refundSubmitted)throw Error('Own test refund outcome remains unresolved; no repeat submission')
     await refund()
    }
   }else if(intent.status!=='canceled')await api('/payment_intents/'+owned.intent+'/cancel',{method:'POST',params:{},operation:'cancel own unpaid intent'})
  }catch(error){failures.push(error.message)}
  if(owned.customer)try{await api('/customers/'+owned.customer,{method:'DELETE',operation:'delete own disposable customer'});console.log(JSON.stringify({stage:'stripe-customer-deleted',id:owned.customer}))}catch(error){failures.push(error.message)}
  if(failures.length)throw Error('Stripe cleanup incomplete: '+failures.join('; '))
 }
 return {endpoint,charge,refund,event,cleanup}
}
