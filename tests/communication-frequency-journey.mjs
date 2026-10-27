import assert from 'node:assert/strict'
import {prepareVerifiedMail} from './verified-mail-edge.mjs'

/** Exercise each channel's real durable claim, independently of email's slot. */
export async function channelFrequencyJourney(h,{donor,control,ranked,owner,at,prefs}){
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
