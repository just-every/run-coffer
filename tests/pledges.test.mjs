import {test} from 'node:test'
import assert from 'node:assert/strict'
import {run,donor,reviewed,archive,restore} from './harness.mjs'

const day=offset=>new Date(Date.now()+offset*86400000).toISOString().slice(0,10)
const receivedOn='2025-08-10'

test('dated pledges remind once, match real gifts by fund and donor, and reopen balances on reversal',()=>{
 const messages=[]
 let uncertainNext=false
 return run(async h=>{
  await reviewed(h)
  const ana=await donor(h,'Ana Pledge')
  await h.command('consent.record',{donorIds:[ana.id],channel:'email',status:'granted',method:'paper form',evidence:'Synthetic donor requests email',capturedOn:'2025-01-01'})
  const schedule={donorId:ana.id,amount:'200',pledgedOn:'2025-01-01',fund:'Library',installments:[{dueOn:day(2),amount:'100'},{dueOn:day(30),amount:'100'}]}
  await h.command('pledge.create',{...schedule,amount:'300'},{status:400})
  const pledge=await h.command('pledge.create',schedule)
  const history=()=>h.get(`/api/coffer/donors/${ana.id}`)
  let p=(await history()).pledges.find(p=>p.id===pledge.id)
  assert.equal(p.remaining_cents,20000)
  const installmentId=p.installments[0].id
  await h.command('pledge.remind',{donorId:ana.id},{as:'',status:401})
  const [first,second]=await Promise.all([h.command('pledge.remind',{pledgeId:p.id}),h.command('pledge.remind',{pledgeId:p.id})])
  assert.equal(first.submitted+second.submitted,1)
  assert.equal(messages.length,1)
  assert.equal(messages[0].personalizations[0].to[0].email,'ana.pledge@example.org')
  assert.match(messages[0].content[0].value,/\$100\.00/)
  assert.match(messages[0].content[0].value,/Library/)
  const wrong=await h.command('gift.record',{donorId:ana.id,amount:'100',receivedOn,method:'check',goods:'none',fund:'Other'})
  await h.command('pledge.match',{giftId:wrong.id,installmentId},{status:409})
  const gift=await h.command('gift.record',{donorId:ana.id,amount:'60',receivedOn,method:'check',goods:'none',fund:'Library',installmentId})
  p=(await history()).pledges.find(p=>p.id===pledge.id)
  assert.equal(p.paid_cents,6000)
  assert.equal(p.installments[0].remaining_cents,4000)
  const final=await h.command('gift.record',{donorId:ana.id,amount:'40',receivedOn,method:'check',goods:'none',fund:'Library'})
  await h.command('pledge.match',{giftId:final.id,installmentId})
  await h.command('pledge.match',{giftId:final.id,installmentId},{status:409})
  p=(await history()).pledges.find(p=>p.id===pledge.id)
  assert.equal(p.paid_cents,10000)
  assert.equal(p.remaining_cents,10000)
  assert.equal(p.installments[0].remaining_cents,0)
  assert.equal((await h.command('pledge.remind',{pledgeId:p.id})).submitted,0)
  assert.equal(messages.length,1)
  await h.command('gift.reverse',{giftId:gift.id,reason:'Synthetic returned check'})
  p=(await history()).pledges.find(p=>p.id===pledge.id)
  assert.equal(p.paid_cents,4000)
  assert.equal(p.installments[0].remaining_cents,6000)
  // Payment before the reminder is due excludes it from mail entirely.
  const paid=await h.command('pledge.create',{...schedule,amount:'25',installments:[{dueOn:day(3),amount:'25'}]})
  const pending=(await history()).pledges.find(p=>p.id===paid.id)
  await h.command('gift.record',{donorId:ana.id,amount:'25',receivedOn,method:'check',goods:'none',fund:'Library',installmentId:pending.installments[0].id})
  assert.equal((await h.command('pledge.remind',{pledgeId:paid.id})).submitted,0)
  assert.equal(messages.length,1)
  const uncertainPledge=await h.command('pledge.create',{...schedule,amount:'10',installments:[{dueOn:day(4),amount:'10'}]})
  uncertainNext=true
  assert.equal((await h.command('pledge.remind',{pledgeId:uncertainPledge.id})).uncertain,1)
  assert.equal((await history()).pledges.find(p=>p.id===uncertainPledge.id).installments[0].reminder_status,'uncertain')
  assert.equal((await h.command('pledge.remind',{pledgeId:uncertainPledge.id})).submitted,0)
  assert.equal(messages.length,2)
  const page=await h.request(`/app/donors/${ana.id}`)
  assert.equal(page.status,200)
  const html=await page.text()
  assert.match(html,/name="schedule"/)
  assert.match(html,/name="installmentId"/)
 },{bindings:{MAIL_PROVIDER:'sendgrid'},outbound:async request=>{
  assert.equal(new URL(request.url).hostname,'api.sendgrid.com')
  assert.equal(new URL(request.url).pathname,'/v3/mail/send')
  messages.push(await request.json())
  if(uncertainNext){uncertainNext=false;return new Response(null,{status:202})}
  return new Response(null,{status:202,headers:{'x-message-id':`pledge-message-${messages.length}`}})
 }})
})

test('GIFT-005 / RCPT-007: quarterly pledge payments, overdue balances, reasoned reductions, write-offs and recurring allocation retain history',async()=>{
 const {pledgeBalancesJourney}=await import('./pledge-balances-journey.mjs')
 await pledgeBalancesJourney()
})


test('STEW-004: scheduled overdue pledge tasks use local dates, current managers, unpaid balances and replay-safe public task custody',()=>run(async h=>{
 await reviewed(h)
 const owner=(await h.get('/auth/session')).operator,manager=await h.person('pledge-manager@example.test')
 const main=await donor(h,'Synthetic Quarterly Pledge',{phone:'202-555-0199'}),reduced=await donor(h,'Synthetic Reduced Pledge')
 const paid=await donor(h,'Synthetic Paid Pledge'),off=await donor(h,'Synthetic Written Off Pledge')
 const inactive=await donor(h,'Synthetic Inactive Pledge'),deceased=await donor(h,'Synthetic Deceased Pledge')
 const manual=await donor(h,'Synthetic Manual Pledge'),future=await donor(h,'Synthetic Future Pledge')
 const erased=await donor(h,'Synthetic Erased Pledge')
 const create=(d,amount='100',dueOn='2030-03-09')=>h.command('pledge.create',{donorId:d.id,amount,pledgedOn:'2025-01-01',fund:'Library',installments:[{dueOn,amount}]})
 const pledge=await h.command('pledge.create',{donorId:main.id,amount:'400',pledgedOn:'2025-01-01',fund:'Library',installments:['2030-03-09','2030-06-09','2030-09-09','2030-12-09'].map(dueOn=>({dueOn,amount:'100'}))})
 const first=pledge.installments[0],second=pledge.installments[1]
 const partialGift=await h.command('gift.record',{donorId:main.id,amount:'40',receivedOn:'2025-08-10',method:'check',goods:'none',fund:'Library',installmentId:first.id})
 const reducedPledge=await create(reduced)
 await h.command('pledge.reduce',{pledgeId:reducedPledge.id,version:1,amount:'30',reason:'Synthetic donor reduced the commitment.'})
 const paidPledge=await create(paid,'30')
 await h.command('gift.record',{donorId:paid.id,amount:'30',receivedOn:'2025-08-10',method:'check',goods:'none',fund:'Library',installmentId:paidPledge.installments[0].id})
 const offPledge=await create(off,'20')
 await h.command('pledge.writeOff',{pledgeId:offPledge.id,version:1,reason:'Synthetic donor canceled the pledge.'})
 await create(inactive);await create(deceased);await create(erased)
 await h.command('donor.profile',{donorId:inactive.id,version:1,constituentStatus:'inactive',statusReason:'Synthetic pause requested'})
 await h.command('donor.profile',{donorId:deceased.id,version:1,constituentStatus:'deceased',deceasedOn:'2025-01-01'})
 await h.command('donor.erase',{donorId:erased.id,confirm:'ERASE'})
 const manualPledge=await create(manual,'20','2025-08-10'),futurePledge=await create(future,'50','2030-03-10')
 const existing=await h.command('task.generate',{sourceKey:'pledge:'+manualPledge.installments[0].id,ownerId:owner.id,dueOn:'2030-03-11'})
 const portfolio=await h.command('portfolio.save',{name:'Synthetic pledge relationships',managerId:owner.id,untouchedDays:30})
 await h.command('portfolio.assign',{donorId:main.id,portfolioId:portfolio.id})
 await h.command('portfolio.save',{portfolioId:portfolio.id,version:1,name:'Synthetic pledge relationships',managerId:manager.id,untouchedDays:30})
 const tick=async(h,at)=>{
  const response=await h.mf.dispatchFetch(h.origin+'/cdn-cgi/local/scheduled?time='+Date.parse(at)+'&format=json')
  assert.equal(response.status,200,await response.text())
 }
 const tasks=async(h)=>(await h.get('/api/coffer/tasks')).tasks
 const forInstallment=(rows,id)=>rows.filter(t=>t.source_key==='pledge:'+id)
 // New York is still March 9 even though UTC is March 10. Due today is not overdue.
 await tick(h,'2030-03-10T04:59:00Z')
 assert.deepEqual((await tasks(h)).map(t=>t.id),[existing.id])
 const mailCount=h.messages.length
 await Promise.all([tick(h,'2030-03-10T05:00:00Z'),tick(h,'2030-03-10T05:00:00Z')])
 let rows=await tasks(h),task=forInstallment(rows,first.id)[0]
 assert.equal(rows.length,3,'Only the existing manual task and two unpaid active installments need calls')
 assert.equal(forInstallment(rows,first.id).length,1)
 assert.deepEqual([task.owner_id,task.amount_cents,task.due_on,task.source_kind],[manager.id,6000,'2030-03-10','pledge'])
 assert.equal(task.status,'open');assert.match(task.reason,/Library pledge installment due 2030-03-09/)
 const reducedTask=forInstallment(rows,reducedPledge.installments[0].id)[0]
 assert.deepEqual([reducedTask.owner_id,reducedTask.amount_cents],[owner.id,7000])
 assert.equal(forInstallment(rows,manualPledge.installments[0].id)[0].id,existing.id)
 assert.equal(forInstallment(rows,manualPledge.installments[0].id)[0].due_on,'2030-03-11')
 assert.equal(forInstallment(rows,futurePledge.installments[0].id).length,0)
 assert.equal(h.messages.length,mailCount,'Opening a task does not contact the donor or require a mail provider')
 const audit=await h.get('/api/coffer/audit?action=pledge.overdueTask&record='+task.id)
 assert.equal(audit.rows.length,1)
 assert.equal(audit.rows[0].actor_name,'Pledge scheduler')
 assert.equal(JSON.parse(audit.rows[0].detail).installmentId,first.id)
 await h.get('/api/coffer/tasks',{as:'',status:401})
 assert.ok((await h.get('/api/coffer/tasks?owner='+manager.id,{as:manager.cookie})).tasks.some(t=>t.id===task.id))
 if(process.env.COFFER_PLEDGE_TASK_BROWSER){const {overduePledgeBrowser}=await import('./pledge-balances-browser.mjs');await overduePledgeBrowser(h,task,process.env.COFFER_PLEDGE_TASK_BROWSER)}
 else task=await h.command('task.complete',{taskId:task.id,version:task.version,outcome:'connected',notes:'Synthetic overdue pledge follow-up completed.'},{as:manager.cookie})
 const completed=(await tasks(h)).find(t=>t.id===task.id)
 assert.equal(completed.status,'done')
 const history=await h.get('/api/coffer/donors/'+main.id)
 assert.ok(history.depth.interactions.some(i=>i.id===completed.interaction_id&&i.notes.includes('Synthetic overdue pledge follow-up completed.')))
 await h.command('gift.reverse',{giftId:partialGift.id,reason:'Synthetic returned check after completed follow-up'})
 await tick(h,'2030-03-11T03:59:00Z')
 assert.equal(forInstallment(await tasks(h),futurePledge.installments[0].id).length,0,'DST: before New York midnight, the next installment is still due today')
 await tick(h,'2030-03-11T04:00:00Z')
 assert.equal(forInstallment(await tasks(h),futurePledge.installments[0].id).length,1)
 assert.equal(forInstallment(await tasks(h),first.id).length,1,'Completed tasks never regenerate')
 // A later scheduler start catches up using the original first overdue day.
 await h.api('/auth/operator/status',{operatorId:manager.id,status:'inactive'})
 await tick(h,'2030-06-20T12:00:00Z')
 rows=await tasks(h)
 const caughtUp=forInstallment(rows,second.id)[0]
 assert.deepEqual([caughtUp.owner_id,caughtUp.due_on,caughtUp.amount_cents],[owner.id,'2030-06-10',10000])
 const saved=await archive(h)
 await run(async fresh=>{
  await restore(fresh,saved)
  const before=await tasks(fresh)
  await tick(fresh,'2030-06-20T12:00:00Z')
  assert.deepEqual((await tasks(fresh)).map(t=>[t.id,t.status,t.due_on,t.amount_cents,t.owner_id]),before.map(t=>[t.id,t.status,t.due_on,t.amount_cents,t.owner_id]))
 },{triggerHandlers:true})
 // Existing merge/undo custody preserves task sources; replay does not add another call.
 const alias=await donor(h,'Synthetic Pledge Duplicate')
 const pair=await h.get('/api/coffer/duplicates/compare?source='+main.id+'&target='+alias.id)
 const merged=await h.command('donor.merge',{sourceDonorId:main.id,donorId:alias.id,sourceVersion:pair.source.version,version:pair.target.version,reason:'duplicate_record'})
 await tick(h,'2030-06-20T12:00:00Z')
 assert.equal(forInstallment(await tasks(h),first.id)[0].donor_id,alias.id)
 await h.command('donor.unmerge',{mergeId:merged.mergeId,reason:'incorrect_match'})
 assert.equal(forInstallment(await tasks(h),first.id)[0].donor_id,main.id)
 await h.command('donor.erase',{donorId:main.id,confirm:'ERASE'})
 await tick(h,'2030-06-20T12:00:00Z')
 assert.equal((await tasks(h)).some(t=>t.donor_id===main.id),false)
},{triggerHandlers:true}))
