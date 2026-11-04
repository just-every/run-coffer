import assert from 'node:assert/strict'
import {nativeFixture} from './native-installments-journey.mjs'
const address=n=>'synthetic-coffer-'+n+String.fromCharCode(64)+'example.test'

export async function nativeRecoveryJourney(){
 return nativeFixture(async({h,edge,state,get,api,command,root,prepare,instruction})=>{
  const notices='/api/coffer/agent/recovery/notices',action=(b,o={})=>api('/api/coffer/agent/recovery/notice-action',b,o),read=()=>get(notices)
  const run=at=>{edge.state.now=at;return api('/api/coffer/agent/recovery/run',{})}
  const messages=()=>h.messages.filter(m=>m.subject?.includes('Update your payment method')||m.subject?.includes('monthly gift card expires')||m.subject?.includes('Follow-up:'))
  const donor=await prepare(),id=(await api(root,donor.body)).id
  state.mode='failed';await instruction(id,'approve')
  const claim=(await get(root+'/'+id)).installments[0]
  assert.equal(messages().length,0,'A new native schedule never inherits legacy permission to send recovery mail')
  await action({action:'policy',version:1,enabled:true,standingApproval:true,developmentLead:true,majorAmount:'10'})
  await run('2026-01-10T12:00:00.000Z')
  assert.match((await read()).steps.find(s=>s.subscription_id===id).reason,/permission/i)
  await command('consent.record',{donorId:donor.person.id,channel:'email',status:'granted',method:'paper form',evidence:'Donor permits email recovery notices separately from saved-card charging.',capturedOn:'2026-01-10'})
  await action({action:'permission',donorId:donor.person.id,version:0,enabled:true,channel:'email',intervalDays:2,maxNotices:2,sourceOn:'2026-01-10',evidence:'Donor permits two recovery notices with at least two elapsed days between them.'})
  await run('2026-01-10T12:00:00.000Z')
  let step=(await read()).steps.find(s=>s.subscription_id===id)
  assert.equal(step.state,'awaiting_approval');assert.equal(messages().length,0)
  const admin=await h.person(address(8300),'admin')
  await action({action:'approve',stepId:step.id,version:step.version},{as:admin.cookie,status:403})
  await action({action:'approve',stepId:step.id,version:step.version})
  await run('2026-01-10T12:00:00.000Z')
  let steps=(await read()).steps.filter(s=>s.subscription_id===id)
  assert.equal(steps[0].state,'sent');assert.equal(messages().length,1)
  await run('2026-01-11T12:00:00.000Z')
  assert.equal((await read()).steps.filter(s=>s.subscription_id===id).length,1,'The exact elapsed interval is enforced')
  await run('2026-01-12T12:00:00.000Z')
  step=(await read()).steps.find(s=>s.subscription_id===id&&s.ordinal===2)
  assert.equal(step.state,'awaiting_approval','Each subsequent major notice needs fresh named-lead review')
  await action({action:'approve',stepId:step.id,version:step.version})
  state.mailUncertain=true
  await run('2026-01-12T12:00:00.000Z');state.mailUncertain=false
  step=(await read()).steps.find(s=>s.id===step.id)
  assert.equal(step.state,'uncertain')
  const submissions=messages().length,debits=state.debits
  await run('2026-01-20T12:00:00.000Z')
  assert.equal(messages().length,submissions);assert.equal(state.debits,debits,'Recovery only reads provider state and never retries native debits')
  await action({action:'close',stepId:step.id,version:step.version,reason:'The donor requested no further recovery contact.'},{status:400})
  await action({action:'close',stepId:step.id,version:step.version,reason:'The donor requested no further recovery contact.',finding:'Mail delivery remains unknown; the original submission will not be repeated.'})
  assert.ok((await read()).investigations.some(i=>i.step_id===step.id))
  await run('2026-01-22T12:00:00.000Z')
  assert.equal(messages().length,submissions,'Investigated closure stops later notices')
  assert.equal((await get(root+'/'+id)).installments[0].state,'failed')
  assert.equal((await get('/api/coffer/tasks')).tasks.filter(t=>t.source_key==='recovery:'+claim.id).length,1)
  // Expiry notices use the same explicit permission, lead and once-only guards.
  state.mode='paid'
  const expiry=await prepare(),expiryId=(await api(root,expiry.body)).id;await instruction(expiryId,'approve')
  await command('consent.record',{donorId:expiry.person.id,channel:'email',status:'granted',method:'paper form',evidence:'Explicit transactional recovery contact permission.',capturedOn:'2026-01-22'})
  await action({action:'permission',donorId:expiry.person.id,version:0,enabled:true,channel:'email',intervalDays:2,maxNotices:1,sourceOn:'2026-01-22',evidence:'One warning for the current saved card expiry.'})
  edge.state.expiryYear=2026;edge.state.expiryMonth=3
  await run('2026-01-22T12:00:00.000Z')
  assert.ok(!(await read()).steps.some(s=>s.subscription_id===expiryId),'Two months away is not next-month expiry')
  edge.state.expiryMonth=2
  await run('2026-01-22T12:00:00.000Z')
  const warning=(await read()).steps.find(s=>s.subscription_id===expiryId&&s.kind==='expiry')
  assert.equal(warning.state,'awaiting_approval')
  await action({action:'approve',stepId:warning.id,version:warning.version})
  await Promise.all([run('2026-01-22T12:00:00.000Z'),run('2026-01-22T12:00:00.000Z')])
  const warnings=(await read()).steps.filter(s=>s.subscription_id===expiryId)
  assert.equal(warnings.length,1);assert.equal(warnings[0].state,'sent')
  await run('2026-01-25T12:00:00.000Z')
  assert.equal((await read()).steps.filter(s=>s.subscription_id===expiryId).length,1,'The per-case notice maximum holds after another interval')
  await instruction(expiryId,'cancel')
  await run('2026-01-27T12:00:00.000Z')
  assert.equal((await read()).steps.filter(s=>s.subscription_id===expiryId).length,1,'Cancellation stops recovery without reviving billing')
  return {failureNotices:2,expiryWarnings:1,automaticRetries:0}
 })
}
