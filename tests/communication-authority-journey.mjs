import assert from 'node:assert/strict'
import {donor} from './harness.mjs'
import {signInPortal} from './portal-journey.mjs'

// Public preference doors preserve permission and every earlier sourced row.
export async function communicationAuthorityJourney(h,at){
 const recordedAt=new Date(at).toISOString()
 const unknown=await donor(h,'Synthetic Unknown Choice',{email:'synthetic-coffer-9401@example.test'})
 const withdrawn=await donor(h,'Synthetic Withdrawn Choice',{email:'synthetic-coffer-9402@example.test'})
 const get=d=>h.get('/api/coffer/donors/'+d.id+'/preferences')
 const file=d=>h.get('/api/coffer/donors/'+d.id)
 await h.command('consent.record',{donorIds:[withdrawn.id],channel:'email',status:'withdrawn',method:'paper form',evidence:'Donor declined email',capturedOn:'2026-10-01'})
 const admin=await h.person('synthetic-coffer-9403@example.test','admin')
 const agent=await h.command('agent.create',{label:'Synthetic preference assistant'})
 const save=async(d,extra={},options={})=>h.command('communication.preferences',{donorId:d.id,channel:'email',version:(await get(d)).channels.find(p=>p.channel==='email').version,topics:['newsletter'],frequency:'quarterly',confirm:'yes',...extra},options)
 const before=await get(unknown)
 const noConfirmation=await save(unknown,{confirm:''},{status:400})
 assert.equal(noConfirmation.error,'CONFIRMATION_REQUIRED')
 await save(unknown,{}, {as:'',headers:{authorization:'Bearer '+agent.token},status:403})
 assert.deepEqual(await get(unknown),before,'Refused writes append nothing')
 assert.equal((await file(unknown)).consents.filter(p=>p.channel==='email').length,0)
 await save(unknown,{}, {as:admin.cookie})
 const native=(await get(unknown)).history
 assert.deepEqual(native.map(p=>({channel:p.channel,version:p.version,topics:p.topics,frequency:p.frequency,source:p.source,recorded_at:p.recorded_at,recorded_by:p.recorded_by})),[
  {channel:'email',version:1,topics:['newsletter'],frequency:'quarterly',source:'person',recorded_at:recordedAt,recorded_by:'synthetic-coffer-9403'}
 ],'Admin confirmation appends the exact sourced choice')
 const adminConsent=(await file(unknown)).consents
 assert.equal(adminConsent.length,1)
 assert.deepEqual(adminConsent.map(p=>({channel:p.channel,status:p.status,method:p.method,evidence:p.evidence,captured_on:p.captured_on,recorded_at:p.recorded_at,recorded_by:p.recorded_by})),[
  {channel:'email',status:'withdrawn',method:'person',evidence:'Communication preferences version 1; channel permission retained',captured_on:'2026-10-15',recorded_at:recordedAt,recorded_by:'synthetic-coffer-9403'}
 ],'Unknown permission never becomes a grant')
 for(const d of [unknown,withdrawn]){
  const priorPreferences=await get(d),priorConsent=(await file(d)).consents
  const as=(await signInPortal(h,d===unknown?'synthetic-coffer-9401@example.test':'synthetic-coffer-9402@example.test')).cookie
  const post=confirm=>h.request('/giving/portal/communications',{method:'POST',as,headers:{'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams({action:'preferences',channel:'email',version:String(priorPreferences.channels.find(p=>p.channel==='email').version),topics:'appeals',frequency:'unlimited',confirm}).toString()})
  assert.equal((await post('')).status,400,'Portal also requires explicit confirmation')
  assert.deepEqual(await get(d),priorPreferences)
  assert.deepEqual((await file(d)).consents,priorConsent)
  assert.equal((await post('yes')).status,303,'Own portal can explicitly confirm a weaker topic and frequency choice')
  const next=await get(d),consents=(await file(d)).consents
  assert.deepEqual(next.history.slice(0,-1),priorPreferences.history,'Earlier preference rows remain byte-identical')
  assert.deepEqual(consents.slice(1),priorConsent,'Earlier consent rows remain byte-identical')
  const version=priorPreferences.channels.find(p=>p.channel==='email').version+1
  assert.deepEqual(next.history.at(-1),{donor_id:d.id,channel:'email',version,topics:['appeals'],frequency:'unlimited',source:'portal',recorded_at:recordedAt,recorded_by:'Authenticated donor portal'})
  const row=consents[0]
  assert.deepEqual({channel:row.channel,status:row.status,method:row.method,evidence:row.evidence,captured_on:row.captured_on,recorded_at:row.recorded_at,recorded_by:row.recorded_by},
   {channel:'email',status:'withdrawn',method:'portal',evidence:`Communication preferences version ${version}; channel permission retained`,captured_on:'2026-10-15',recorded_at:recordedAt,recorded_by:'Authenticated donor portal'})
  const audit=(await file(d)).events.find(e=>e.action==='communication.preferences'&&e.actor_role==='donor')
  assert.equal(audit.actor_id,'donor:'+d.id);assert.equal(audit.at,recordedAt)
  assert.equal(next.channels.find(p=>p.channel==='email').frequency,'unlimited')
  assert.deepEqual(next.channels.find(p=>p.channel==='email').topics,['appeals'])
 }
}
