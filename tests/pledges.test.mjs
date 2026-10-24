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
  const reminder=(await history()).pledges.find(p=>p.id===pledge.id).installments[0],emailPoint=(await history()).contactPoints.find(p=>p.kind==='email'&&p.is_primary)
  assert.equal(reminder.recipient_contact_id,emailPoint.id);assert.equal(reminder.recipient_contact_version,emailPoint.version)
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

test('GIFT-005 / RCPT-007 / STEW-004: quarterly pledge payments, printable invoices, overdue balances, reasoned reductions, write-offs and recurring allocation retain history',async()=>{
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

test('RCPT-010 / DONOR-013: reviewed pledge templates hold blanks, freeze literal wording and use the chosen current email once',async()=>{
 const messages=[]
 const reminders=()=>messages.filter(m=>m.subject.startsWith('Reminder '))
 await run(async h=>{
  await reviewed(h)
  const {recognitionMember}=await import('./recognition-edge.mjs'),member=await recognitionMember(h,{messages},'synthetic-coffer-1402@example.test')
  await h.command('custom.define',{key:'pledge_phrase',label:'Pledge phrase',kind:'constituent',type:'text'})
  await h.command('custom.define',{key:'contact_reason',label:'Contact reason',kind:'interaction',type:'text'})
  const catalog=await h.get('/api/coffer/template-fields'),entry=catalog.messages.find(m=>m.kind==='pledge')
  for(const key of ['custom.pledge_phrase','installment_amount','due_date','email','pledge_balance'])assert.ok(entry.fields.includes(key))
  const current=await h.get('/api/coffer/pledge-template');assert.equal(current.version,1);assert.equal(current.reviewed_at,null)
  const body='Dear {{donor_name}}, {{installment_amount}} for {{fund}} is due {{due_date}} to {{organization}}. {{custom.pledge_phrase}} · {{custom.contact_reason|Your commitment}} · {{email}} · balance {{pledge_balance}}.'
  const input={version:1,subject:'Reminder {{custom.pledge_phrase}}',body}
  await h.command('pledgeTemplate.save',{...input,body:body+' {{unknown|fallback}}'},{status:400})
  await h.command('pledgeTemplate.save',{...input,body:body.replace('{{due_date}}','')},{status:400})
  await h.command('pledgeTemplate.save',input,{as:member,status:403})
  await h.get('/api/coffer/pledge-template',{as:'',status:401})
  const directory=process.env.COFFER_PLEDGE_MERGE_BROWSER
  if(directory){const {mkdir}=await import('node:fs/promises');const {withBrowserWorker}=await import('./browser-worker.mjs');await mkdir(directory,{recursive:true});await withBrowserWorker(h,async(context,origin)=>{const page=await context.newPage();for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/settings#pledge-template');const editor=page.locator('#pledge-template form');await editor.locator('select[name=fieldKey]').selectOption('custom.pledge_phrase');await editor.locator('select[name=fieldTarget]').selectOption('subject');await editor.getByRole('button',{name:'Insert merge field',exact:true}).click();await page.getByRole('heading',{name:'Pledge reminder draft',exact:true}).waitFor();assert.match(await page.locator('input[name=subject]').inputValue(),/\{\{custom\.pledge_phrase\}\}$/);assert.equal((await h.get('/api/coffer/pledge-template')).version,1);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:directory+'/RCPT-010-pledge-insert-'+width+'.png',fullPage:true})}await page.close()})}
  assert.equal((await h.command('pledgeTemplate.save',input)).version,2)
  await h.command('pledgeTemplate.save',input,{status:409})
  const d=await donor(h,'Synthetic Pledge Merge',{email:'synthetic-coffer-1404@example.test'})
  const work=await h.command('contact.save',{donorId:d.id,donorVersion:1,kind:'email',type:'work',value:'synthetic-coffer-1405@example.test',source:'synthetic-coffer-1406'})
  await h.command('consent.record',{donorId:d.id,channel:'email',status:'granted',method:'paper form',evidence:'synthetic-coffer-1407',capturedOn:'2025-01-01'})
  const interaction=await h.command('interaction.record',{donorId:d.id,kind:'call',occurredOn:'2025-08-10',notes:'Synthetic planning conversation'})
  await h.command('custom.set',{key:'contact_reason',recordId:interaction.id,value:'Planning call'})
  const create=amount=>h.command('pledge.create',{donorId:d.id,amount,pledgedOn:'2025-01-01',fund:'Library',installments:[{dueOn:day(2),amount}]})
  const pledge=await create('50'),history=()=>h.get('/api/coffer/donors/'+d.id)
  const held=await h.command('pledge.remind',{pledgeId:pledge.id,emailType:'work'})
  assert.equal(held.submitted,0);assert.deepEqual(held.held[0].fields,['custom.pledge_phrase']);assert.equal(reminders().length,0)
  let installment=(await history()).pledges.find(p=>p.id===pledge.id).installments[0]
  assert.equal(installment.reminder_status,'pending');assert.equal(installment.attempt_id,null);assert.equal(installment.reminder_body,null)
  const review=await h.get('/api/coffer/pledge-reminders/review');assert.equal(review.recipients[0].donorId,d.id);assert.deepEqual(review.recipients[0].fields,['custom.pledge_phrase'])
  if(directory){const {withBrowserWorker}=await import('./browser-worker.mjs');await withBrowserWorker(h,async(context,origin)=>{const page=await context.newPage();for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/settings#pledge-template');await page.getByRole('heading',{name:'Empty reminder fields',exact:true}).waitFor();assert.equal(await page.locator('#pledge-template').getByRole('link',{name:'Synthetic Pledge Merge',exact:true}).count(),1);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('#pledge-template').screenshot({path:directory+'/RCPT-010-pledge-held-'+width+'.png'})}await page.close()})}
  await h.command('custom.set',{key:'pledge_phrase',recordId:d.id,value:'Thank you {{literal}}',source:'synthetic-coffer-1408'})
  assert.equal((await h.command('pledge.remind',{pledgeId:pledge.id,emailType:'work',interactionId:interaction.id})).submitted,1)
  assert.equal(reminders().length,1);const sent=reminders()[0]
  installment=(await history()).pledges.find(p=>p.id===pledge.id).installments[0]
  assert.equal(installment.recipient_email,'synthetic-coffer-1405@example.test');assert.equal(installment.recipient_contact_id,work.id);assert.equal(installment.reminder_template_version,2)
  assert.equal(sent.personalizations[0].to[0].email,'synthetic-coffer-1405@example.test');assert.equal(sent.subject,installment.reminder_subject);assert.equal(sent.content[0].value,installment.reminder_body)
  assert.match(sent.subject,/Thank you \{\{literal\}\}/);assert.match(sent.content[0].value,/\$50\.00/);assert.match(sent.content[0].value,/Planning call · synthetic-coffer-1405@example.test · balance \$50\.00/)
  assert.equal((await history()).donor.email,'synthetic-coffer-1404@example.test')
  assert.equal((await h.command('pledge.remind',{pledgeId:pledge.id,emailType:'work'})).submitted,0)
  assert.deepEqual((await h.get('/api/coffer/pledge-reminders/review')).recipients,[])
  await h.command('custom.set',{key:'pledge_phrase',recordId:d.id,version:1,value:'After preparation'})
  const replacement={version:2,subject:'Reminder {{custom.pledge_phrase|Supporter}}',body:body.replaceAll('{{custom.pledge_phrase}}','{{custom.pledge_phrase|Supporter}}')}
  await h.command('pledgeTemplate.save',replacement)
  assert.equal((await history()).pledges.find(p=>p.id===pledge.id).installments[0].reminder_body,installment.reminder_body,'Later field and template changes preserve the exact submitted wording')
  await h.command('custom.clear',{key:'pledge_phrase',recordId:d.id,version:2})
  const second=await create('30');assert.equal((await h.command('pledge.remind',{pledgeId:second.id})).submitted,1)
  assert.equal(reminders().at(-1).subject,'Reminder Supporter');assert.equal(reminders().at(-1).personalizations[0].to[0].email,'synthetic-coffer-1404@example.test')
  if(directory){const {withBrowserWorker}=await import('./browser-worker.mjs');await withBrowserWorker(h,async(context,origin)=>{const page=await context.newPage();for(const width of [1440,390]){const native=await create('10');await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/donors/'+d.id+'#pledge-'+native.id);await page.reload();let panel=page.locator('#pledge-'+native.id);const send=panel.locator('form').filter({has:page.locator('input[name=command][value="pledge.remind"]')});await send.locator('select[name=emailType]').selectOption('work');await send.locator('select[name=interactionId]').selectOption(interaction.id);await send.getByRole('button',{name:'Send due reminders',exact:true}).click();await page.waitForURL('**/app/donors/**');panel=page.locator('#pledge-'+native.id);await panel.getByText('Read reminder wording · version 3',{exact:true}).click();assert.ok((await panel.innerText()).includes('Supporter · Planning call'));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('#pledges').screenshot({path:directory+'/DONOR-013-pledge-contact-'+width+'.png'});const saved=(await history()).pledges.find(p=>p.id===native.id).installments[0];assert.equal(saved.recipient_contact_id,work.id);assert.equal(saved.reminder_status,'submitted')}await page.close()})}
  const saved=await archive(h)
  await run(async fresh=>{await restore(fresh,saved);assert.equal((await fresh.get('/api/coffer/pledge-template')).version,3);const copy=(await fresh.get('/api/coffer/donors/'+d.id)).pledges.find(p=>p.id===pledge.id).installments[0];assert.equal(copy.reminder_body,installment.reminder_body);assert.equal(copy.reminder_template_version,2);await fresh.command('donor.erase',{donorId:d.id,confirm:'ERASE'});assert.doesNotMatch(JSON.stringify(await archive(fresh)),/synthetic-coffer-1404|synthetic-coffer-1405|Thank you \{\{literal\}\}|After preparation/)})
 },{bindings:{MAIL_PROVIDER:'sendgrid',MAIL_API_KEY:'synthetic-coffer-1401',MAIL_FROM:'reminders@example.test'},outbound:async request=>{const u=new URL(request.url);assert.equal(u.origin,'https://api.sendgrid.com');assert.equal(u.pathname,'/v3/mail/send');messages.push(await request.json());return new Response(null,{status:202,headers:{'x-message-id':'synthetic-coffer-1403-'+messages.length}})}})
})

test('STEW-004: scheduled follow-up is a non-ask sent once per unpaid installment under current email permission',async()=>{
 const messages=[]
 await run(async h=>{
  await reviewed(h)
  const d=await donor(h,'Synthetic Restricted Followup')
  await h.command('consent.record',{donorId:d.id,channel:'email',status:'granted',method:'paper form',evidence:'synthetic-coffer-1601',capturedOn:'2025-01-01'})
  await h.command('solicitation.set',{donorId:d.id,version:0,type:'stop',startsOn:'2025-01-01',source:'person',sourceRef:'synthetic-coffer-1602'})
  const pledge=await h.command('pledge.create',{donorId:d.id,amount:'400',pledgedOn:'2025-01-01',fund:'Library',installments:['2030-03-09','2030-06-09','2030-09-09','2030-12-09'].map(dueOn=>({dueOn,amount:'100'}))})
  const tick=async at=>{const r=await h.mf.dispatchFetch(h.origin+'/cdn-cgi/local/scheduled?time='+Date.parse(at)+'&format=json');assert.equal(r.status,200,await r.text())}
  await tick('2030-03-09T13:00:00Z');assert.equal(messages.length,0)
  await tick('2030-03-10T13:00:00Z');assert.equal(messages.length,1)
  assert.match(messages[0].content[0].value,/\$100\.00 remaining/)
  await tick('2030-03-11T13:00:00Z');assert.equal(messages.length,1)
  const history=()=>h.get('/api/coffer/donors/'+d.id)
  assert.equal((await history()).pledges[0].installments[0].followup_status,'submitted')
  assert.equal((await history()).solicitation.type,'stop')
  assert.equal((await h.get('/api/coffer/tasks')).tasks.filter(t=>t.source_key==='pledge:'+pledge.installments[0].id).length,1)
  if(process.env.COFFER_FOLLOWUP_BROWSER){const {withBrowserWorker}=await import('./browser-worker.mjs');const {mkdir}=await import('node:fs/promises');await mkdir(process.env.COFFER_FOLLOWUP_BROWSER,{recursive:true});await withBrowserWorker(h,async(context,origin)=>{const page=await context.newPage();for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/donors/'+d.id);await page.locator('#pledges').getByText('Follow-up submitted',{exact:true}).waitFor();await page.locator('#pledges').scrollIntoViewIfNeeded();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.locator('#pledges').screenshot({path:process.env.COFFER_FOLLOWUP_BROWSER+'/STEW-004-followup-'+width+'.png'})}await page.close()})}
  await h.command('consent.record',{donorId:d.id,channel:'email',status:'withdrawn',method:'email reply',evidence:'synthetic-coffer-1603',capturedOn:'2025-01-02'})
  await tick('2030-06-10T13:00:00Z');assert.equal(messages.length,1)
  await h.command('consent.record',{donorId:d.id,channel:'email',status:'granted',method:'paper form',evidence:'synthetic-coffer-1604',capturedOn:'2025-01-03'})
  await tick('2030-06-11T13:00:00Z');assert.equal(messages.length,2)
  assert.equal((await history()).pledges[0].installments[1].followup_status,'uncertain')
  await tick('2030-06-12T13:00:00Z');assert.equal(messages.length,2,'Uncertain submissions are never automatically repeated')
  const saved=await archive(h)
  await run(async fresh=>{await restore(fresh,saved);assert.equal((await fresh.get('/api/coffer/donors/'+d.id)).pledges[0].installments[0].followup_status,'submitted');await fresh.command('donor.erase',{donorId:d.id,confirm:'ERASE'});assert.doesNotMatch(JSON.stringify(await archive(fresh)),/synthetic\.restricted\.followup@example\.org|existing commitment/)})
 },{triggerHandlers:true,bindings:{MAIL_PROVIDER:'sendgrid',MAIL_API_KEY:'synthetic-coffer-1605',MAIL_FROM:'pledges@example.test'},outbound:async request=>{assert.equal(new URL(request.url).hostname,'api.sendgrid.com');messages.push(await request.json());return new Response(null,{status:202,headers:messages.length===1?{'x-message-id':'synthetic-coffer-1606'}:{}})}})
})

test('STEW-004: quarterly pledge reminder and printed invoice pay exactly the unpaid installment through hosted checkout',async()=>{
 const {createHmac}=await import('node:crypto'),messages=[]
 const secret='synthetic-coffer-1701',edge={sessions:[],payment:null}
 await run(async h=>{
  await reviewed(h)
  const d=await donor(h,'Synthetic Quarterly Checkout')
  await h.command('consent.record',{donorId:d.id,channel:'email',status:'granted',method:'paper form',evidence:'synthetic-coffer-1702',capturedOn:'2025-01-01'})
  await h.command('solicitation.set',{donorId:d.id,version:0,type:'stop',startsOn:'2025-01-01',source:'person',sourceRef:'synthetic-coffer-1703'})
  const dates=[0,1,2,3].map(n=>{const d=new Date();d.setUTCDate(d.getUTCDate()+7);d.setUTCMonth(d.getUTCMonth()+n*3);return d.toISOString().slice(0,10)})
  const pledge=await h.command('pledge.create',{donorId:d.id,amount:'400',pledgedOn:'2025-01-01',fund:'Library',installments:dates.map(dueOn=>({dueOn,amount:'100'}))})
  await h.command('gift.record',{donorId:d.id,amount:'25',receivedOn:'2025-08-10',method:'check',goods:'none',fund:'Library',installmentId:pledge.installments[0].id})
  assert.equal((await h.command('pledge.remind',{pledgeId:pledge.id})).submitted,1)
  const reminder=messages.find(m=>m.content[0].value.includes('Pay this installment: '));assert.ok(reminder)
  const payUrl=new URL(reminder.content[0].value.match(/Pay this installment: (https:\/\/\S+)/)[1]),payPath=payUrl.pathname+payUrl.search
  const invoice=await (await h.request('/app/pledges/'+pledge.id+'/invoice')).text();assert.ok(invoice.includes(payUrl.pathname));assert.match(invoice,/Pay installment due/)
  await h.request(payUrl.pathname,{as:''}).then(async r=>assert.equal(r.status,404,await r.text()))
  const expired=new URL(payUrl);expired.searchParams.set('expires','1');assert.equal((await h.request(expired.pathname+expired.search,{as:''})).status,404)
  const confirmation=await h.request(payPath,{as:''});assert.equal(confirmation.status,200);assert.match(await confirmation.text(),/Pay \$75\.00 with Stripe/)
  const start=()=>h.request(payPath,{method:'POST',as:''})
  const [first,replay]=await Promise.all([start(),start()]);assert.equal(first.status,303,await first.text());assert.equal(replay.status,303,await replay.text())
  assert.equal(first.headers.get('location'),'https://checkout.stripe.com/c/pay/synthetic-coffer-1704');assert.equal(edge.sessions.length,1)
  const session=edge.sessions[0];assert.equal(session.amount_total,7500);assert.equal(session.mode,'payment')
  assert.equal((await h.get('/api/coffer/donors/'+d.id)).pledges[0].installments[0].remaining_cents,7500,'Unpaid provider sessions never create gifts')
  if(process.env.COFFER_PLEDGE_PAY_BROWSER){const {withBrowserWorker}=await import('./browser-worker.mjs');const {mkdir}=await import('node:fs/promises');await mkdir(process.env.COFFER_PLEDGE_PAY_BROWSER,{recursive:true});await withBrowserWorker(h,async(context,origin)=>{const page=await context.newPage();for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/pledges/'+pledge.id+'/invoice');await page.getByRole('link',{name:/Pay installment due/}).first().waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:process.env.COFFER_PLEDGE_PAY_BROWSER+'/STEW-004-pay-invoice-'+width+'.png',fullPage:true});const target=new URL(await page.getByRole('link',{name:/Pay installment due/}).first().getAttribute('href'));await page.goto(origin+target.pathname+target.search);await page.getByRole('button',{name:'Pay $75.00 with Stripe',exact:true}).waitFor();assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:process.env.COFFER_PLEDGE_PAY_BROWSER+'/STEW-004-pay-confirm-'+width+'.png',fullPage:true})}await page.close()})}
  session.status='complete';session.payment_status='paid';session.payment_intent='pi_synthetic_coffer_1705'
  edge.payment={id:session.payment_intent,status:'succeeded',currency:'usd',amount_received:7500,created:Math.floor(Date.now()/1000),metadata:{coffer_pledge_checkout:session.metadata.coffer_pledge_checkout}}
  const chargeRaw=JSON.stringify({id:'synthetic-coffer-1712',type:'charge.succeeded',data:{object:{id:'ch_synthetic_coffer_1713'}}}),chargeTime=Math.floor(Date.now()/1000),chargeSig=createHmac('sha256',secret).update(`${chargeTime}.${chargeRaw}`).digest('hex')
  const chargeEvent=await h.request('/api/coffer/giving/webhook',{method:'POST',as:'',raw:chargeRaw,headers:{'stripe-signature':`t=${chargeTime},v1=${chargeSig}`}});assert.equal(chargeEvent.status,200,await chargeEvent.text())
  for(const id of ['synthetic-coffer-1706','synthetic-coffer-1707']){
   const raw=JSON.stringify({id,type:'checkout.session.completed',data:{object:{id:session.id}}}),t=Math.floor(Date.now()/1000),sig=createHmac('sha256',secret).update(`${t}.${raw}`).digest('hex')
   const response=await h.request('/api/coffer/giving/webhook',{method:'POST',as:'',raw,headers:{'stripe-signature':`t=${t},v1=${sig}`}});assert.equal(response.status,200,await response.text())
  }
  const after=await h.get('/api/coffer/donors/'+d.id)
  assert.equal(after.pledges[0].installments[0].remaining_cents,0);assert.equal(after.totals.lifetimeCents,10000)
  assert.equal(after.gifts.filter(g=>g.source==='stripe').length,1)
  assert.equal(after.pledges[0].installments[1].remaining_cents,10000)
  assert.equal((await start()).status,409)
  assert.match(await (await h.request(payPath,{as:''})).text(),/No payment is requested/)
  const thanks=await h.request('/giving/pledge/thanks?session_id='+session.id,{as:''});assert.equal(thanks.status,200)
  assert.equal((await h.get('/api/coffer/donors/'+d.id)).totals.lifetimeCents,10000)
  const next=new Date(dates[1]+'T13:00:00Z');next.setUTCDate(next.getUTCDate()+1)
  for(let replay=0;replay<2;replay++){const tick=await h.mf.dispatchFetch(h.origin+'/cdn-cgi/local/scheduled?time='+next.getTime()+'&format=json');assert.equal(tick.status,200,await tick.text())}
  const followups=messages.filter(m=>m.subject==='Follow-up on your pledge installment')
  assert.equal(followups.length,1);assert.match(followups[0].content[0].value,/\$100\.00 remaining/)
  assert.equal((await h.get('/api/coffer/tasks')).tasks.filter(t=>t.source_key==='pledge:'+pledge.installments[1].id).length,1)
  await h.command('donor.erase',{donorId:d.id,confirm:'ERASE'});assert.equal((await h.request(payPath,{as:''})).status,404)
 },{triggerHandlers:true,bindings:{MAIL_PROVIDER:'sendgrid',MAIL_API_KEY:'synthetic-coffer-1708',MAIL_FROM:'pledges@example.test',STRIPE_SECRET_KEY:'synthetic-coffer-1709',STRIPE_WEBHOOK_SECRET:secret},outbound:async request=>{
  const u=new URL(request.url)
  if(u.hostname==='api.sendgrid.com'){messages.push(await request.json());return new Response(null,{status:202,headers:{'x-message-id':'synthetic-coffer-1710'}})}
  assert.equal(u.hostname,'api.stripe.com')
  if(u.pathname==='/v1/checkout/sessions'&&request.method==='POST'){
   const p=new URLSearchParams(await request.text()),checkout=p.get('metadata[coffer_pledge_checkout]')
   let s=edge.sessions.find(s=>s.metadata.coffer_pledge_checkout===checkout)
   if(!s){s={id:'cs_synthetic_coffer_1711',mode:p.get('mode'),status:'open',payment_status:'unpaid',currency:'usd',amount_total:Number(p.get('line_items[0][price_data][unit_amount]')),metadata:{coffer_pledge_checkout:checkout},url:'https://checkout.stripe.com/c/pay/synthetic-coffer-1704'};edge.sessions.push(s)}return Response.json(s)
  }
  if(u.pathname.startsWith('/v1/checkout/sessions/'))return Response.json(edge.sessions[0])
  if(u.pathname.startsWith('/v1/payment_intents/'))return Response.json(edge.payment)
  if(u.pathname.startsWith('/v1/charges/'))return Response.json({id:'ch_synthetic_coffer_1713',paid:true,status:'succeeded',amount:7500,currency:'usd',created:edge.payment.created,payment_intent:edge.payment.id,metadata:edge.payment.metadata,amount_refunded:0})
  assert.fail('Unexpected pledge edge '+u.pathname)
 }})
})
