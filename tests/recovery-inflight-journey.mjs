import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {run,donor} from './harness.mjs'
import {recoveryForm,recoveryNoticeEdge} from './recovery-notices-edge.mjs'

/** A deferred provider response exercises the durable sending claim. */
export async function inflightRecoveryJourney(){
 const edge=recoveryNoticeEdge(),base='2026-10-27T12:00:00.000Z',later='2026-10-30T12:00:00.000Z'
 let release,submitted,count=0
 const response=new Promise(resolve=>{release=resolve}),started=new Promise(resolve=>{submitted=resolve})
 const options={...edge.options,bindings:{...edge.options.bindings,COFFER_TEST_NOW:base},outbound:async request=>{
  if(new URL(request.url).hostname==='api.sendgrid.com'){
   await request.json();count++
   if(count===1){submitted();await response}
   return new Response(null,{status:202})
  }
  return edge.options.outbound(request)
 }}
 await run(async h=>{
  const state=()=>h.get('/api/coffer/agent/recovery/notices'),action=p=>h.api('/api/coffer/agent/recovery/notice-action',p)
  const [ana,ben]=edge.plans
  await h.replaceBindings({MAIL_PROVIDER:'sendgrid'})
  await h.api('/api/coffer/giving/campaigns',{name:'In-flight recovery',slug:'inflight-recovery',description:'Recovery contact',fund:'Reading',goal:'10000'})
  await action({action:'policy',version:1,enabled:true,standingApproval:true,developmentLead:true,majorAmount:'1000'})
  const permission=async(p,channel='email')=>{const prior=(await state()).permissions.find(n=>n.donor_id===p.donor.id);await action({action:'permission',donorId:p.donor.id,version:prior?.version??0,enabled:true,channel,intervalDays:1,maxNotices:3,sourceOn:'2026-10-27',evidence:'synthetic-coffer-4500'})}
  for(const p of [ana,ben]){
   p.donor=await donor(h,p.name,{email:p.email})
   for(const channel of ['email','phone','mail'])await h.command('consent.record',{donorIds:[p.donor.id],channel,status:'granted',method:'paper form',evidence:'synthetic-coffer-4501',capturedOn:'2026-10-27'})
   await permission(p)
   const checkout=await h.request('/give/inflight-recovery/checkout',recoveryForm({name:p.name,email:p.email,amount:'25',frequency:'monthly','cf-turnstile-response':'synthetic-coffer-security-token',requestId:randomUUID()}))
   assert.equal(checkout.status,303,await checkout.text())
  }
  const pending=edge.fail(h,ana,'synthetic-coffer-4502',base)
  try{
   await Promise.race([started,pending.then(()=>{throw new Error('Expected a deferred provider submission')})])
   const original=(await state()).steps.find(n=>n.subscription_id==='sub_notice_ana')
   assert.equal(original.state,'sending');assert.ok(original.claim_id)
   ana.invoice='synthetic-coffer-4503'
   for(const channel of ['email','phone','mail']){
    await permission(ana,channel)
    await edge.fail(h,ana,'synthetic-coffer-4504-'+channel,later)
    const current=(await state()).steps.find(n=>n.invoice_id===ana.invoice)
    assert.equal(current.state,'held','An in-flight submission holds later same-donor contact on '+channel)
    assert.equal(current.channel,channel);assert.match(current.reason,/earlier recovery submission is uncertain/)
    assert.equal(count,1,'The original request is still the only provider submission')
   }
   await edge.fail(h,ben,'synthetic-coffer-4505',later)
   assert.equal((await state()).steps.find(n=>n.subscription_id==='sub_notice_ben').state,'sent','In-flight contact does not block an unrelated donor')
   assert.equal(count,2)
  }finally{release();await pending}
  assert.equal((await state()).steps.find(n=>n.invoice_id==='in_notice_ana').state,'sent','The original provider result settles only its own submission')
 },options)
}
