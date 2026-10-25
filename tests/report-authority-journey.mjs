import assert from 'node:assert/strict'
import {run,reviewed} from './harness.mjs'
import {reportSchedulesBrowser} from './report-schedules-browser.mjs'

const savedAt='2026-10-18T02:00:00.000Z',dueAt='2026-10-25T02:00:00.000Z'
const at=value=>({headers:{'x-test-now':value}})

// Use native invitations and sessions with the same SendGrid edge as the report.
async function inviteAdmin(h,messages){
 const email='synthetic-coffer-1606@example.test'
 const invited=await h.request('/app/people/invite',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams({email,role:'admin',displayName:'Report approver'}).toString()})
 assert.equal(invited.status,303)
 const mail=messages.findLast(m=>m.personalizations[0].to.some(p=>p.email===email))
 assert.ok(mail,'Native administrator invitation reached the provider')
 const link=mail.content.find(c=>c.type==='text/plain').value.match(/https?:\/\/[^\s<>]+\/auth\/confirm\?token=[^\s<>]+/)
 assert.ok(link,'Invitation includes its confirmation link')
 const confirmed=await h.request('/auth/confirm',{method:'POST',as:'',body:{token:new URL(link[0]).searchParams.get('token')}})
 assert.equal(confirmed.status,303)
 const cookie=confirmed.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ')
 const {operator}=await h.get('/auth/session',{as:cookie})
 assert.equal(operator.role,'admin')
 return {id:operator.id,cookie}
}

async function tick(h){
 const response=await h.request('/cdn-cgi/local/scheduled?cron=*+*+*+*+*&time='+Date.parse(dueAt),at(dueAt))
 assert.equal(response.status,200)
}

async function assertHeld(h,scheduleId,reason,subjectId=scheduleId){
 const audit=await h.get('/api/coffer/audit?action=reportSchedule.held')
 const held=audit.rows.find(row=>row.subject_id===subjectId&&JSON.parse(row.detail).scheduleId===scheduleId)
 assert.ok(held,'An authority refusal is recorded against this schedule or run')
 assert.equal(JSON.parse(held.detail).reason,reason)
}

async function authorityCase(authority,stage){
 const messages=[],reason=authority==='approver'?'Approver authority changed':'Recipient approval revoked'
 let onReport=async()=>{}
 await run(async h=>{
  await reviewed(h)
  const admin=await inviteAdmin(h,messages)
  const recipients=stage==='between sends'?['synthetic-coffer-1607@example.test','synthetic-coffer-1608@example.test']:['synthetic-coffer-1609@example.test']
  const recipient=recipients.at(-1)
  const input={name:`${authority} revoked ${stage}`,reportPath:'/app/reports/dashboard?year=2025',recipients:recipients.join(','),cadence:'weekly',startsAt:dueAt,reviewed:'yes'}
  const schedule=await h.command('reportSchedule.save',input,{...at(savedAt),as:admin.cookie})
  const reports=()=>messages.filter(m=>m.attachments)
  const state=()=>h.get('/api/coffer/report-schedules',at(dueAt))
  const revoke=()=>authority==='approver'
   ?h.api('/auth/operator/status',{operatorId:admin.id,status:'inactive'},at(dueAt))
   :h.command('reportSchedule.revokeRecipient',{scheduleId:schedule.id,recipient},at(dueAt))
  const before=await state(),approved=before.schedules.find(s=>s.id===schedule.id)
  assert.equal(approved.approved_by,admin.id)
  assert.deepEqual(approved.approvals.filter(a=>!a.revoked_at).map(a=>a.recipient).sort(),[...recipients].sort())

  if(stage==='before due'){
   await revoke()
   await tick(h)
   assert.equal(reports().length,0,'Revocation before the due tick prevents every provider submission')
  }else if(stage==='between sends'){
   // The scheduler has claimed both runs when it submits the first envelope.
   // Revoke through the real owner HTTP door before releasing that submission.
   let revoked=false
   onReport=async()=>{
    if(revoked)return
    revoked=true
    const claimed=(await state()).runs.filter(r=>r.schedule_id===schedule.id)
    assert.equal(claimed.length,recipients.length)
    assert.ok(claimed.every(r=>r.status==='sending'),'The authority change happens after the occurrence claim')
    await revoke()
   }
   await tick(h)
   assert.equal(revoked,true,'First recipient submission crossed the network boundary')
   assert.deepEqual(reports().flatMap(m=>m.personalizations[0].to.map(p=>p.email)),[recipients[0]],'No envelope is submitted for the recipient held after revocation')
  }else{
   await tick(h)
   const original=(await state()).runs.find(r=>r.schedule_id===schedule.id)
   assert.ok(original)
   assert.equal(original.status,'uncertain','A provider failure creates a real delivery-unconfirmed run')
   assert.equal(reports().length,1)
   await revoke()
   const refused=await h.command('reportSchedule.resend',{runId:original.id,reviewed:'yes'},{...at(dueAt),status:409})
   assert.equal(refused.error,'REPORT_HELD')
   assert.equal(refused.message,reason)
   assert.equal(reports().length,1,'Explicit duplicate approval cannot bypass revoked disclosure authority')
   const runs=(await state()).runs.filter(r=>r.schedule_id===schedule.id)
   assert.equal(runs.some(r=>r.retry_of===original.id),false,'A refused resend creates no retry run')
   assert.equal(runs.find(r=>r.id===original.id).status,'uncertain')
   assert.ok(runs.filter(r=>r.id!==original.id).every(r=>r.status==='held'),'Pausing may record held future recipients, never a new delivery attempt')
  }

  const after=await state(),current=after.schedules.find(s=>s.id===schedule.id)
  const runs=after.runs.filter(r=>r.schedule_id===schedule.id)
  if(stage==='between sends'){
   const first=runs.find(r=>r.recipient===recipients[0]),held=runs.find(r=>r.recipient===recipient)
   assert.equal(first.status,'submitted')
   assert.equal(held.status,'held')
   assert.equal(held.detail,reason)
   await assertHeld(h,schedule.id,reason,held.id)
  }else{
   assert.equal(current.enabled,0,'The refused schedule is visibly paused in the owner schedule listing')
   if(stage==='before due'){
    assert.equal(runs.length,recipients.length)
    assert.ok(runs.every(r=>r.status==='held'&&r.detail===reason),'Preclaim refusal records held recipients without attempting delivery')
   }
   await assertHeld(h,schedule.id,reason)
  }
  if(stage==='before due'&&authority==='approver'&&process.env.COFFER_REPORT_SCHEDULE_BROWSER)await reportSchedulesBrowser(h,process.env.COFFER_REPORT_SCHEDULE_BROWSER,'held')
  if(authority==='recipient')assert.ok(current.approvals.find(a=>a.recipient===recipient).revoked_at)
  const submissions=reports().length
  await tick(h)
  assert.equal(reports().length,submissions,'Another tick cannot resubmit a refused occurrence')
 },{entry:'tests/advancing-clock-worker.ts',triggerHandlers:true,bindings:{MAIL_PROVIDER:'sendgrid',MAIL_API_KEY:'synthetic-coffer-1611'},outbound:async request=>{
  assert.equal(new URL(request.url).origin,'https://api.sendgrid.com')
  const mail=await request.json();messages.push(mail)
  if(mail.attachments)await onReport()
  const uncertain=mail.attachments&&stage==='manual resend'
  return new Response(null,{status:uncertain?500:202,headers:uncertain?{}:{'x-message-id':'synthetic-coffer-1610'}})
 }})
}

export async function reportAuthorityJourney(){
 for(const stage of ['before due','between sends','manual resend']){
  for(const authority of ['approver','recipient'])await authorityCase(authority,stage)
 }
}
