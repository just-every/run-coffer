import assert from 'node:assert/strict'
import {prepareVerifiedMail} from './verified-mail-edge.mjs'
import {run,donor,reviewed} from './harness.mjs'

/** Exercise each channel's real durable claim, independently of email's slot. */
export async function channelFrequencyJourney(h,{donor,control,ranked,owner,at,prefs,registration}){
 await prefs(donor,'phone',undefined,'monthly')
 const task=(await h.get('/api/coffer/tasks')).tasks.find(t=>t.id===ranked.entries[0].task_id)
 assert.ok(task);assert.equal(task.donor_id,donor.id);assert.equal(task.is_ask,1)
 await h.command('task.complete',{taskId:task.id,version:task.version,outcome:'connected',notes:'Discussed renewing the reading-room contribution.'})
 const held=await h.command('task.create',{donorId:donor.id,ownerId:owner,dueOn:'2026-10-16',kind:'call',title:'Second monthly ask call',isAsk:true},{status:409})
 assert.equal(held.message,'frequency')
 assert.deepEqual((await h.command('calls.rank',{managerId:owner})).entries.map(row=>row.task_id),[task.id],'A completed call stays in its historical weekly list')

 await h.command('sms.preference',{donorId:donor.id,status:'granted',phone:'+12025550112',timezone:'America/New_York',evidence:'Signed text permission for the reading room',capturedOn:'2026-10-01'})
 await prefs(donor,'sms',undefined,'monthly')
 const first=await h.command('sms.prepare',{name:'First monthly text appeal',purpose:'appeal',donorIds:[donor.id],body:'Would you renew your reading-room support?'})
 assert.equal(first.recipients,1)
 const approved=await h.command('sms.approve',{runId:first.id,version:1})
 const registrationOptions={headers:{'x-test-now':at}}
 assert.equal((await registration.refresh(h,registrationOptions)).approved,0)
 assert.equal((await registration.receipt(h,{when:at})).recorded,1)
 assert.equal((await registration.refresh(h,registrationOptions)).approved,1)
 assert.equal((await h.command('sms.send',{runId:first.id,version:approved.version})).submitted,1)
 const second=await h.command('sms.prepare',{name:'Second monthly text appeal',purpose:'appeal',donorIds:[donor.id],body:'Another reading-room appeal.'})
 assert.equal(second.recipients,0);assert.deepEqual(second.excluded.map(row=>row.reason),['frequency'])

 await prefs(donor,'mail',undefined,'monthly')
 const pass=()=>prepareVerifiedMail(h,{headers:{'x-test-now':at}})
 await pass()
 const firstMail=await h.command('appeal.prepare',{name:'First monthly postal appeal',channel:'mail'})
 assert.equal(firstMail.recipients,2)
 await h.command('appeal.approve',{appealId:firstMail.id,version:1})
 await h.command('appeal.export',{appealId:firstMail.id,version:2})
 await pass()
 const secondMail=await h.command('appeal.prepare',{name:'Second monthly postal appeal',channel:'mail'})
 assert.equal(secondMail.excluded.frequency,1)
 assert.deepEqual((await h.get('/api/coffer/appeals/'+secondMail.id)).recipients.map(row=>row.donor_id),[control.id])
 await pass()
 const newsletter=await h.command('appeal.prepare',{name:'Postal newsletter after the appeal',channel:'mail',purpose:'newsletter'})
 assert.equal(newsletter.recipients,3,'Newsletter subscriptions remain independent of the postal appeal slot')
 const document=await h.get('/api/coffer/appeals/'+newsletter.id);assert.equal(document.mailPieces.length,3);assert.deepEqual(document.mailPieces.map(piece=>piece.name).sort(),['Amelia Torres','Jordan Lee','Nora Clarke']);assert.ok(document.mailPieces.every(piece=>piece.ask_cents===null),'A non-ask newsletter never exports a suggested ask')
 await h.command('appeal.approve',{appealId:newsletter.id,version:1});await h.command('appeal.export',{appealId:newsletter.id,version:2})
 return newsletter.id
}

/** UTC has changed dates while the organization's calendar is still yesterday. */
export async function organizationCalendarJourney(){
 const at='2026-10-31T16:00:00Z'
 await run(async h=>{
  await reviewed(h)
  const monthly=await donor(h,'Synthetic Calendar Monthly',{email:'synthetic-coffer-9601@example.test'}),quarterly=await donor(h,'Synthetic Calendar Quarterly',{email:'synthetic-coffer-9602@example.test'}),control=await donor(h,'Synthetic Calendar Control',{email:'synthetic-coffer-9603@example.test'})
  for(const d of [monthly,quarterly,control])await h.command('consent.record',{donorIds:[d.id],channel:'email',status:'granted',method:'paper form',evidence:'Synthetic calendar permission',capturedOn:'2026-10-01'})
  for(const [d,frequency] of [[monthly,'monthly'],[quarterly,'quarterly']]){
   const current=(await h.get('/api/coffer/donors/'+d.id+'/preferences')).channels.find(p=>p.channel==='email')
   await h.command('communication.preferences',{donorId:d.id,channel:'email',version:current.version,topics:['newsletter','appeals','events'],frequency,confirm:'yes'})
  }
  const first=await h.command('appeal.prepare',{name:'Synthetic October calendar ask',channel:'email'})
  await h.command('appeal.approve',{appealId:first.id,version:1});await h.command('appeal.export',{appealId:first.id,version:2})
  const check=async(instant,expected,frequency)=>{
   const headers={'x-test-now':instant}
   // Authenticate at the pinned instant so later calendar cases do not depend
   // on an old session's expiry, and never change the application clock itself.
   const sent=await h.request('/auth/magic-link',{method:'POST',as:'',body:{email:'owner@example.test'},headers});assert.equal(sent.status,202)
   const message=h.messages.findLast(m=>JSON.stringify(m.to).includes('owner@example.test'))
   const link=message.text.match(/https?:\/\/[^\s<>]+\/auth\/confirm\?token=[^\s<>]+/)[0]
   const confirmed=await h.request('/auth/confirm',{method:'POST',as:'',body:{token:new URL(link).searchParams.get('token')},headers});assert.equal(confirmed.status,303)
   const as=confirmed.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ')
   const r=await h.command('appeal.prepare',{name:'Synthetic calendar '+instant,channel:'email'},{headers,as})
   assert.equal(r.excluded.frequency??0,frequency)
   const detail=await h.get('/api/coffer/appeals/'+r.id,{headers,as})
   assert.deepEqual(detail.recipients.map(d=>d.donor_id).sort(),expected.map(d=>d.id).sort(),instant)
  }
  await check('2026-11-01T00:01:00Z',[control],2)
  await check('2026-11-01T04:01:00Z',[monthly,control],1)
  await check('2027-01-01T00:01:00Z',[monthly,control],1)
  await check('2027-01-01T05:01:00Z',[monthly,quarterly,control],0)
 },{entry:'tests/engagement-worker.ts',bindings:{COFFER_TEST_NOW:at}})
}
