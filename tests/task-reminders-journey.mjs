import assert from 'node:assert/strict'
import {run,donor} from './harness.mjs'

export async function taskRemindersJourney(){
 await run(async h=>{
  const owner=(await h.get('/auth/session')).operator,assignee=await h.person('casey@example.test'),manager=await h.person('jordan@example.test','admin'),unmanaged=await h.person('alex@example.test')
  const d=await donor(h,'Rosa Morgan',{phone:'202-555-0172'}),other=await donor(h,'Erin Brooks')
  let now='2026-10-26T12:00:00Z'
  const get=(path,options={})=>h.get(path,{...options,headers:{'x-test-now':now,...options.headers}})
  const command=(name,input,options={})=>h.command(name,input,{...options,headers:{'x-test-now':now,...options.headers}})
  const tick=async()=>{const r=await h.mf.dispatchFetch(h.origin+'/cdn-cgi/local/scheduled?time='+Date.parse(now)+'&format=json');assert.equal(r.status,200,await r.text())}
  await command('task.teamSave',{operatorId:assignee.id,managerId:manager.id,version:0},{as:assignee.cookie,status:403})
  await command('task.teamSave',{operatorId:assignee.id,managerId:manager.id,version:0})
  await command('task.teamSave',{operatorId:assignee.id,managerId:owner.id,version:0},{status:409})
  await command('task.teamSave',{operatorId:manager.id,managerId:assignee.id,version:0},{status:409})
  for(const as of [undefined,assignee.cookie,manager.cookie,unmanaged.cookie])await command('task.reminders',{enabled:true},{...(as?{as}:{})})
  const thank=await command('task.create',{donorId:d.id,ownerId:assignee.id,kind:'call',title:'Thank Rosa for the reading-room gift',dueOn:'2026-10-27',isAsk:false})
  const overdue=await command('task.create',{donorId:d.id,ownerId:assignee.id,kind:'follow_up',title:'Confirm the reading-room proposal',dueOn:'2026-10-23'})
  const fallback=await command('task.create',{donorId:other.id,ownerId:unmanaged.id,kind:'data_fix',title:'Correct the returned address',dueOn:'2026-10-23'})
  await command('task.create',{donorId:d.id,ownerId:assignee.id,kind:'meeting',title:'Discuss library plans',dueOn:'2026-10-29'})
  await command('task.create',{donorId:d.id,ownerId:assignee.id,kind:'thank_you',title:'Write a personal thank-you',dueOn:'2026-10-29'})
  await command('task.policy',{version:1,escalationDays:2},{as:assignee.cookie,status:403})
  const before=h.messages.length
  await tick();await tick()
  let daily=await get('/api/coffer/tasks?owner='+assignee.id,{as:assignee.cookie})
  assert.equal(daily.notices.filter(n=>n.task_id===thank.id).length,1)
  assert.equal(daily.notices.find(n=>n.task_id===thank.id).status,'submitted')
  assert.ok(h.messages.slice(before).some(m=>JSON.stringify(m.to).includes('casey@example.test')&&m.subject==='Your daily task reminder'))
  assert.equal((await get('/api/coffer/tasks?owner='+manager.id,{as:manager.cookie})).tasks.length,0,'weekend and first business day do not trigger escalation')
  if(process.env.COFFER_TASK_BROWSER){const {taskRemindersBrowser}=await import('./task-reminders-browser.mjs');await taskRemindersBrowser(h,{d,owner,assignee,manager,unmanaged,thank,overdue,fallback,now,setNow:value=>{now=value},tick},process.env.COFFER_TASK_BROWSER)}
  else await command('task.complete',{taskId:thank.id,version:thank.version,outcome:'connected',notes:'Rosa appreciated the update and asked for the library photos.'},{as:assignee.cookie})
  const history=await get('/api/coffer/donors/'+d.id)
  assert.ok(history.depth.interactions.some(i=>i.notes.includes('Rosa appreciated the update')))
  now='2026-10-28T12:00:00Z'
  await tick();const sent=h.messages.length;await tick();assert.equal(h.messages.length,sent)
  const managed=await get('/api/coffer/tasks?owner='+manager.id,{as:manager.cookie}),owned=await get('/api/coffer/tasks?owner='+owner.id)
  assert.ok(managed.tasks.some(t=>t.id===overdue.id&&t.escalated_to===manager.id))
  assert.ok(managed.notices.some(n=>n.task_id===overdue.id&&n.kind==='escalation'&&n.status==='submitted'))
  assert.ok(owned.tasks.some(t=>t.id===fallback.id&&t.escalated_to===owner.id))
  assert.ok(owned.notices.some(n=>n.task_id===fallback.id&&n.kind==='escalation'&&n.status==='submitted'))
  assert.ok(h.messages.some(m=>JSON.stringify(m.to).includes('jordan@example.test')&&m.subject==='Overdue task needs your attention'))
  const finished=await command('task.complete',{taskId:fallback.id,version:fallback.version,notes:'Address corrected from the signed reply.'})
  assert.equal(finished.interaction_id,null)
  assert.match(await (await h.request('/app/donors/'+other.id,{headers:{'x-test-now':now}})).text(),/Address corrected from the signed reply/)
  await command('task.complete',{taskId:fallback.id,version:finished.version,notes:'Duplicate completion'},{status:409})
  await command('donor.erase',{donorId:other.id,confirm:'ERASE'})
  assert.ok(!(await get('/api/coffer/tasks')).notices.some(n=>n.task_id===fallback.id))
 },{entry:'tests/advancing-clock-worker.ts',triggerHandlers:true,bindings:{COFFER_TEST_NOW:'2026-10-26T12:00:00Z'}})
}
