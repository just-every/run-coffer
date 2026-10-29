import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {run,donor,reviewed,archive,restore} from './harness.mjs'
import {fixedNow} from './fixed-clock.mjs'
import {withBrowserWorker} from './browser-worker.mjs'

const route=action=>'/api/coffer/agent/stewardship/'+action
const address=n=>['synthetic-coffer-'+n,'example.test'].join(String.fromCharCode(64))

export async function stewardshipTouchesJourney(){
 const calls=[],bindings={COFFER_TEST_NOW:fixedNow}
 let beforeReviewResponse
 const outbound=async request=>{
  assert.equal(new URL(request.url).hostname,'api.anthropic.com')
  const input=JSON.parse((await request.json()).messages[0].content);calls.push(input)
  assert.ok(!JSON.stringify(input).includes('CONFIDENTIAL PRIVATE SOURCE'))
  if(input.subject&&beforeReviewResponse){const change=beforeReviewResponse;beforeReviewResponse=null;await change()}
  const gift=input.sources.find(s=>s.kind==='gift')
  const output=input.subject?{assessment:'The recorded gift supports this touch.',supported:true,isAsk:false,sourceIds:[gift.id]}:
   {subject:'A personal thank-you',body:`${input.format}: Thank you for your $${gift.facts.current_amount_usd} gift to ${gift.facts.original_fund}.`,citations:[{sourceId:gift.id}]}
  return Response.json({stop_reason:'end_turn',content:[{type:'text',text:JSON.stringify(output)}]})
 }
 await run(async h=>{
  await reviewed(h)
  const admin=await h.person(address('touch-admin'),'admin'),member=await h.person(address('touch-member'))
  const portfolio=await h.command('portfolio.save',{name:'Stewardship relationships',managerId:admin.id,untouchedDays:30})
  const people=[]
  for(const [i,name] of ['Email Touch','Call Touch','Card Touch'].entries()){
   const p=await donor(h,name,{email:address('touch-'+i)});people.push(p)
   await h.command('gift.record',{donorId:p.id,amount:String(50+i*25),receivedOn:'2026-10-01',method:'check',goods:'none',fund:'Reading'})
   await h.command('interaction.record',{donorId:p.id,kind:'note',occurredOn:'2026-10-02',notes:'CONFIDENTIAL PRIVATE SOURCE '+i,confidential:true})
   await h.command('portfolio.assign',{donorId:p.id,portfolioId:portfolio.id})
  }
  await h.api(route('setup'),{version:(await h.get('/api/coffer/agent/stewardship')).setup.version,key:'synthetic-coffer-9200'})
  const state=p=>h.get('/api/coffer/agent/stewardship?donorId='+p.id)
  const getDraft=async(p,format)=>{
   const draft=await h.api(route('draft'),{donorId:p.id,kind:'thank_you',format})
   return {...draft,row:(await state(p)).drafts.find(d=>d.id===draft.id)}
  }
  const taskList=()=>h.get('/api/coffer/tasks')
  const touches=[],initialMail=h.messages.length
  for(const [i,format] of ['email','call','card'].entries()){
   const p=people[i],draft=await getDraft(p,format)
   assert.equal(draft.row.format,format);assert.match(draft.row.body,new RegExp('^'+format+':'))
   assert.equal(calls.findLast(c=>!c.subject).format,format,'The requested medium reaches the model boundary')
   assert.ok(!JSON.stringify(draft.row).includes('CONFIDENTIAL PRIVATE SOURCE'))
   await h.api(route('schedule'),{...draft,dueOn:'2026-10-30',confirm:'SCHEDULE'},{status:409})
   assert.equal((await taskList()).tasks.length,i)
   const saved=await h.api(route('save'),{...draft,subject:draft.row.subject,body:draft.row.body+' With gratitude.'})
   await h.api(route('schedule'),{...saved,dueOn:'2026-10-30'},{status:400})
   await h.api(route('schedule'),{...saved,dueOn:'2026-10-01',confirm:'SCHEDULE'},{status:400})
   if(format==='email')await h.command('consent.record',{donorIds:[p.id],channel:'email',status:'granted',method:'paper form',evidence:'Synthetic permission',capturedOn:'2026-10-17'})
   await h.api(route('schedule'),{...saved,dueOn:'2026-10-30',confirm:'SCHEDULE'},{as:member.cookie,status:403})
   const scheduled=await h.api(route('schedule'),{...saved,dueOn:'2026-10-30',confirm:'SCHEDULE'},{as:admin.cookie})
   assert.equal(scheduled.ownerId,admin.id);assert.equal(h.messages.length,initialMail)
   const task=(await taskList()).tasks.find(t=>t.id===scheduled.taskId)
   assert.equal(task.donor_id,p.id);assert.equal(task.owner_id,admin.id);assert.equal(task.due_on,'2026-10-30');assert.equal(task.is_ask,0)
   assert.equal(task.task_kind,format==='call'?'call':'thank_you');assert.equal(task.stewardship_version,saved.version)
   assert.ok(!JSON.stringify(task).includes(draft.row.body),'Ordinary tasks hold no private draft text')
   await h.api(route('schedule'),{...saved,dueOn:'2026-10-31',confirm:'SCHEDULE'},{status:409})
   await h.api(route('save'),{...saved,subject:draft.row.subject,body:'Changed scheduled text'},{status:409})
   await h.api(route('discard'),saved,{status:409})
   await h.command('task.assign',{taskId:task.id,version:task.version,ownerId:member.id,dueOn:task.due_on},{status:409})
   const completion={taskId:task.id,version:task.version,outcome:'connected',notes:'A personal thank-you completed by the relationship manager.'}
   await h.command('task.complete',completion,{as:member.cookie,status:403})
   if(format!=='email')await h.api(route('send'),{...saved,confirm:'SEND'},{status:409})
   else await h.command('task.complete',completion,{status:409})
   touches.push({p,draft,saved,scheduled,task,completion,format})
  }
  // Use the native review and scheduling form on the call variant; the first
  // scheduled call remains fixed while this second reviewed touch is prepared.
  const directory=process.env.COFFER_STEWARDSHIP_BROWSER??'.cache/stewardship-touches'
  await mkdir(directory,{recursive:true})
  await withBrowserWorker(h,async(context,origin)=>{
   const page=await context.newPage();page.setDefaultTimeout(15000)
   await page.goto(origin+'/app/agent/stewardship?donorId='+people[1].id)
   await page.getByLabel('Touch format').selectOption('call')
   await page.getByRole('button',{name:'Create draft',exact:true}).click()
   const drafted=(await state(people[1])).drafts.find(d=>!d.task_id&&d.format==='call')
   assert.ok(drafted)
   let card=page.locator('#draft-'+drafted.id)
   await card.waitFor()
   assert.equal(await card.locator('textarea[name=body]').count(),1,await card.innerText())
   await card.locator('textarea[name=body]').fill(drafted.body+' With appreciation.')
   await card.getByRole('button',{name:'Save reviewed note',exact:true}).click()
   card=page.locator('#draft-'+drafted.id)
   assert.equal(await card.getByRole('button',{name:'Send reviewed email',exact:true}).count(),0)
   await card.getByLabel('Touch due date').fill('2026-10-31')
   await card.getByLabel('Schedule this exact approved touch.').check()
   await card.getByRole('button',{name:'Schedule reviewed touch',exact:true}).click()
   assert.equal(h.messages.length,initialMail,'Native scheduling makes no donor contact')
   const native=(await state(people[1])).drafts.find(d=>d.id===drafted.id)
   assert.equal(native.task_due_on,'2026-10-31');assert.equal(native.task_owner_name,admin.session.operator.displayName)
   await page.goto(origin+'/app/agent/stewardship')
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000})
    await page.screenshot({path:`${directory}/DEV-004-reviewed-touches-${width}.png`,fullPage:true})
   }
   await page.setViewportSize({width:1440,height:1000})
   await page.goto(origin+'/app/calls?owner='+admin.id)
   assert.match(await page.locator('main').innerText(),/Review the approved stewardship/)
   assert.ok((await page.getByRole('link',{name:'Review approved touch',exact:true}).count())>=3)
   const sizes=await page.locator('main button,main label,main p,main summary').evaluateAll(els=>els.filter(e=>e.getClientRects().length).map(e=>parseFloat(getComputedStyle(e).fontSize)))
   assert.ok(sizes.every(s=>s>=13),'Touched task controls use readable text')
   for(const width of [1440,390]){
    await page.setViewportSize({width,height:1000})
    await page.screenshot({path:`${directory}/DEV-004-manager-tasks-${width}.png`,fullPage:true})
   }
   const task=(await taskList()).tasks.find(t=>t.id===native.task_id)
   await h.api(route('cancel'),{id:native.id,version:native.version,taskVersion:task.version,confirm:'CANCEL'})
  })
  const snapshot=await archive(h)
  await run(async restored=>{
   await restore(restored,snapshot)
   const tasks=(await restored.get('/api/coffer/tasks')).tasks
   for(const t of touches){assert.equal(tasks.find(r=>r.id===t.task.id).stewardship_draft_id,t.draft.id)}
   const restoredDraft=(await restored.get('/api/coffer/agent/stewardship?donorId='+people[2].id)).drafts.find(d=>d.id===touches[2].draft.id)
   assert.equal(restoredDraft.format,'card');assert.equal(restoredDraft.task_due_on,'2026-10-30')
   await restored.command('task.complete',touches[2].completion,{status:409})
  },{bindings})
  // Withdrawals are checked when scheduling and again on the ordinary completion door.
  const card=touches[2]
  await h.command('consent.record',{donorIds:[card.p.id],channel:'mail',status:'withdrawn',method:'verbal',evidence:'Synthetic stop',capturedOn:'2026-10-17'})
  await h.command('task.complete',card.completion,{status:409})
  assert.equal((await taskList()).tasks.find(t=>t.id===card.task.id).status,'open')
  const held=await getDraft(card.p,'card'),heldReview=await h.api(route('save'),{...held,subject:held.row.subject,body:held.row.body})
  await h.api(route('schedule'),{...heldReview,dueOn:'2026-10-30',confirm:'SCHEDULE'},{status:409})
  await h.api(route('cancel'),{...card.saved,taskVersion:card.task.version,confirm:'CANCEL'})
  const email=touches[0]
  const sent=await h.api(route('send'),{...email.saved,confirm:'SEND'})
  assert.equal(sent.status,'submitted');assert.equal(h.messages.length,initialMail+1)
  await h.command('task.complete',email.completion,{as:admin.cookie})
  const call=touches[1]
  const done=await h.command('task.complete',call.completion,{as:admin.cookie})
  assert.equal(done.status,'done');assert.ok(done.interaction_id)
  const timeline=await h.get('/api/coffer/donors/'+call.p.id)
  assert.ok(timeline.depth.interactions.some(i=>i.id===done.interaction_id&&i.notes.includes('personal thank-you completed')))
  await h.command('task.complete',call.completion,{status:409})
  // Merging a pending task changes its identity and invalidates its approval.
  const merging=await getDraft(people[1],'call'),mergeReview=await h.api(route('save'),{...merging,subject:merging.row.subject,body:merging.row.body})
  const mergeTask=await h.api(route('schedule'),{...mergeReview,dueOn:'2026-10-30',confirm:'SCHEDULE'})
  const comparison=await h.get('/api/coffer/duplicates/compare?source='+people[1].id+'&target='+people[2].id)
  const merged=await h.command('donor.merge',{sourceDonorId:people[1].id,donorId:people[2].id,sourceVersion:comparison.source.version,version:comparison.target.version,reason:'duplicate_record'})
  const movedTask=(await taskList()).tasks.find(t=>t.id===mergeTask.taskId)
  assert.equal(movedTask.donor_id,people[2].id)
  await h.command('task.complete',{taskId:movedTask.id,version:movedTask.version,outcome:'connected',notes:'Must remain held'},{status:409})
  await h.command('donor.unmerge',{mergeId:merged.mergeId,reason:'incorrect_match'})
  const returnedTask=(await taskList()).tasks.find(t=>t.id===mergeTask.taskId)
  assert.equal(returnedTask.donor_id,people[1].id)
  const returnedDraft=(await state(people[1])).drafts.find(d=>d.id===merging.id)
  await h.api(route('cancel'),{id:returnedDraft.id,version:returnedDraft.version,taskVersion:returnedTask.version,confirm:'CANCEL'})
  // Manager changes invalidate approval; member portfolios cannot receive private touch authority.
  const pending=await getDraft(people[0],'card'),approved=await h.api(route('save'),{...pending,subject:pending.row.subject,body:pending.row.body})
  const changed=await h.command('portfolio.save',{portfolioId:portfolio.id,version:portfolio.version,name:'Changed relationships',managerId:member.id,untouchedDays:30})
  await h.api(route('schedule'),{...approved,dueOn:'2026-10-30',confirm:'SCHEDULE'},{status:409})
  const memberDraft=await getDraft(people[0],'card'),memberReview=await h.api(route('save'),{...memberDraft,subject:memberDraft.row.subject,body:memberDraft.row.body})
  assert.equal((await h.api(route('schedule'),{...memberReview,dueOn:'2026-10-30',confirm:'SCHEDULE'},{status:409})).error,'MANAGER_SCOPE')
  assert.equal(h.messages.length,initialMail+1)
  await h.command('portfolio.save',{portfolioId:portfolio.id,version:changed.version,name:'Current relationships',managerId:admin.id,untouchedDays:30})
  // Revocation while the factual reviewer responds cannot publish an approval.
  const revoked=await getDraft(people[0],'card')
  beforeReviewResponse=()=>h.api('/auth/operator/role',{operatorId:admin.id,role:'member'})
  await h.api(route('save'),{...revoked,subject:revoked.row.subject,body:revoked.row.body},{as:admin.cookie,status:401})
  const unreviewed=(await state(people[0])).drafts.find(d=>d.id===revoked.id)
  assert.equal(unreviewed.version,revoked.version);assert.equal(unreviewed.reviewed_version,null)
  await h.get('/api/coffer/agent/stewardship',{as:admin.cookie,status:401})
  await h.api('/auth/operator/role',{operatorId:admin.id,role:'admin'})
  assert.equal((await h.api(route('save'),{...revoked,subject:revoked.row.subject,body:revoked.row.body},{status:409})).error,'SOURCES_CHANGED','Restoring a role cannot revive review from its earlier authority version')
  const erasedTask=await getDraft(people[0],'card'),erasedReview=await h.api(route('save'),{...erasedTask,subject:erasedTask.row.subject,body:erasedTask.row.body})
  const queued=await h.api(route('schedule'),{...erasedReview,dueOn:'2026-10-30',confirm:'SCHEDULE'})
  await h.command('donor.erase',{donorId:people[0].id,confirm:'ERASE'})
  assert.ok(!(await taskList()).tasks.some(t=>t.id===queued.taskId))
  await h.command('task.complete',{taskId:queued.taskId,version:1,notes:'Refused'},{status:404})
  assert.ok(!(await h.get('/api/coffer/agent/stewardship')).drafts.some(d=>d.donor_id===people[0].id))
 },{entry:'tests/engagement-worker.ts',bindings,outbound})
}
