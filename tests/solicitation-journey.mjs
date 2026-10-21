import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {run,donor,reviewed} from './harness.mjs'
import {recognitionMember} from './recognition-edge.mjs'
import {solicitationEdges} from './solicitation-edge.mjs'

const csv=(name,rows)=>({name,base64:Buffer.from(rows.map(row=>row.join(',')).join('\r\n')).toString('base64')})

/** DONOR-015's current public HTTP doors, with actual Worker/D1 state. */
export async function solicitationJourney() {
 const edge=solicitationEdges()
 await run(async h=>{
  let at=new Date().toISOString()
  const options=extra=>({...extra,headers:{...extra?.headers,'x-test-now':at}})
  const command=(name,input={},extra={})=>h.command(name,input,options(extra))
  const get=(path,extra={})=>h.get(path,options(extra))
  const request=(path,extra={})=>h.request(path,options(extra))
  await reviewed(h)
  const member=await recognitionMember(h,edge),owner=(await get('/auth/session')).operator
  const timezone=(await get('/api/coffer/settings')).timezone
  const localDay=instant=>new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(instant))
  const day=localDay(at),year=Number(day.slice(0,4)),priorYear=year-1
  const create=(name,email,extra={})=>donor(h,name,{email,...extra},options({}))
  const stop=await create('Maya Chen','synthetic-coffer-501@example.test',{phone:'+12025550101'})
  const control=await create('Noah Patel','synthetic-coffer-502@example.test',{phone:'+12025550102'})
  const grant=async d=>{
   for(const channel of ['email','mail','phone'])await command('consent.record',{donorIds:[d.id],channel,status:'granted',method:'paper form',evidence:'synthetic-coffer-503',capturedOn:day})
  }
  await grant(stop);await grant(control)
  await command('sms.preference',{donorId:stop.id,status:'granted',phone:'+12025550101',timezone,evidence:'synthetic-coffer-504',capturedOn:day,version:0})
  const permissions=(await get('/api/coffer/donors/'+stop.id)).consents
  for(const channel of ['email','mail','sms','phone'])assert.equal(permissions.find(c=>c.channel===channel).status,'granted')
  const gift=(d,amount,on=day)=>command('gift.record',{donorId:d.id,amount,receivedOn:on,method:'check',fund:'Reading room',goods:'none'})
  await gift(stop,'180',`${priorYear}-04-10`)
  const dueOn=localDay(Date.parse(at)+2*86400000)
  const pledge=await command('pledge.create',{donorId:stop.id,amount:'360',pledgedOn:day,fund:'Reading room',installments:[{dueOn,amount:'360'}]})
  const interaction=await command('interaction.record',{donorId:stop.id,kind:'email',occurredOn:day,notes:'Please keep sending statements and reading-room news, but do not ask me for another gift.'})
  const restriction={donorId:stop.id,version:0,type:'stop',startsOn:`${priorYear}-01-01`,source:'interaction',sourceRef:interaction.id,sourceOn:day}
  await command('solicitation.set',restriction,{as:'',status:401})
  await command('solicitation.set',restriction)
  const history=()=>get('/api/coffer/donors/'+stop.id)
  const saved=(await history()).solicitation
  assert.deepEqual([saved.type,saved.version,saved.source,saved.source_ref,saved.source_on],['stop',1,'interaction',interaction.id,day])
  await command('solicitation.set',{...restriction,version:0},{status:409})
  await command('solicitation.set',{donorId:stop.id,version:1,type:'none',startsOn:day},{as:member,status:403})
  assert.equal((await history()).solicitation.type,'stop')
  assert.equal((await history()).pledges.find(p=>p.id===pledge.id).remaining_cents,36000)

  // The actual lapse source remains visible in the report, but cannot become an ask task.
  const lapse=(await get('/api/coffer/lapses')).groups.flatMap(g=>g.rows).find(r=>r.donorId===stop.id)
  assert.ok(lapse)
  const tasks=await get('/api/coffer/tasks')
  assert.ok(!tasks.sources.some(s=>s.donorId===stop.id&&s.kind!=='pledge'))
  assert.ok(tasks.excluded['do not solicit']>=1)
  await command('task.generate',{sourceKey:lapse.key,ownerId:owner.id,dueOn:day,isAsk:true},{status:409})
  const stewardship=await command('task.generate',{sourceKey:lapse.key,ownerId:owner.id,dueOn:day,isAsk:false})
  assert.equal(stewardship.is_ask,0,'A person can create a stewardship call explicitly marked as not an ask')

  const prepare=(channel,name,extra={})=>command('appeal.prepare',{name,channel,...extra})
  const recipientIds=async id=>(await get('/api/coffer/appeals/'+id)).recipients.map(r=>r.donor_id)
  const email=await prepare('email','Spring reading-room appeal'),mail=await prepare('mail','Spring reading-room letters')
  for(const run of [email,mail]){
   assert.ok(!(await recipientIds(run.id)).includes(stop.id));assert.ok((await recipientIds(run.id)).includes(control.id))
   assert.equal(run.excluded['do not solicit'],1)
  }
  const sms=await command('sms.prepare',{name:'Reading-room text appeal',purpose:'appeal',donorIds:[stop.id],body:'Please help stock the reading room this spring.'})
  assert.equal(sms.recipients,0);assert.equal(sms.excluded.find(e=>e.donorId===stop.id).reason,'do not solicit')

  const nextGift=await gift(stop,'275')
  const batch=await command('ack.prepare',{giftIds:[nextGift.id]})
  await command('ack.approve',{batchId:batch.id,version:1})
  const before=edge.messages.length
  await command('ack.send',{batchId:batch.id,version:2})
  const receipt=edge.messages.slice(before).find(m=>m.personalizations.some(p=>p.to.some(t=>t.email==='synthetic-coffer-501@example.test')))
  assert.ok(receipt,'The restricted donor’s new gift still receives its approved email receipt')
  assert.ok(receipt.content.some(c=>c.type==='text/plain'&&c.value.includes('$275.00')))
  const statement=await command('ack.prepareStatements',{year:priorYear,donorId:stop.id})
  assert.equal((await get('/api/coffer/letters/'+statement.id)).letters[0].donor_id,stop.id)
  const reminded=await command('pledge.remind',{pledgeId:pledge.id})
  assert.equal(reminded.submitted,1)
  assert.ok(edge.messages.some(m=>m.personalizations.some(p=>p.to.some(t=>t.email==='synthetic-coffer-501@example.test'))&&m.content.some(c=>c.value.includes('$360.00'))))

  await command('marketing.connectMango',{origin:'https://mango.example.test',credential:'synthetic-coffer-505'})
  const newsletter=await prepare('email','Reading-room newsletter',{purpose:'newsletter',subject:'What readers made possible',body:'Thank you {{donor_name}}. Here is the latest reading-room news.'})
  assert.ok((await recipientIds(newsletter.id)).includes(stop.id))
  await command('appeal.approve',{appealId:newsletter.id,version:1})
  const listed=await command('appeal.send',{appealId:newsletter.id,version:2})
  assert.ok(listed.listed>=1)
  const newsletterLists=[...edge.lists].filter(([name])=>name.includes('Reading-room newsletter'))
  assert.ok(newsletterLists.some(([,addresses])=>addresses.has('synthetic-coffer-501@example.test')),'Approved newsletter includes the restricted donor in Mango’s actual list handoff')
  const newsletterMessage=(await history()).communications.find(m=>m.source_kind==='appeal'&&m.source_id===newsletter.id)
  assert.equal(newsletterMessage.status,'listed','A Mango list handoff is recorded honestly rather than claiming a send')

  const includeReason='Maya requested this one reading-room appeal during our recorded conversation.'
  const included=await prepare('email','One requested appeal',{includes:[{donorId:stop.id,reason:includeReason}]})
  assert.ok((await recipientIds(included.id)).includes(stop.id))
  const inclusion=(await get('/api/coffer/appeals/'+included.id)).inclusions.find(i=>i.donor_id===stop.id)
  assert.deepEqual([inclusion.reason,inclusion.actor_id,inclusion.actor_name],[includeReason,owner.id,owner.displayName])
  await command('appeal.approve',{appealId:included.id,version:1})
  await command('appeal.export',{appealId:included.id,version:2})
  const timeline=await (await request('/app/donors/'+stop.id)).text()
  assert.ok(timeline.includes(includeReason)&&timeline.includes(owner.displayName))
  assert.equal((await history()).solicitation.type,'stop','One explicit inclusion preserves the restriction')

  const annual=await create('Leila Brooks','synthetic-coffer-506@example.test')
  await grant(annual)
  await command('solicitation.set',{donorId:annual.id,version:0,type:'limit',maxAsks:1,startsOn:`${year}-01-01`})
  const once=await prepare('email','Annual supporter appeal')
  assert.ok((await recipientIds(once.id)).includes(annual.id))
  await command('appeal.approve',{appealId:once.id,version:1})
  const exported=await command('appeal.export',{appealId:once.id,version:2})
  await command('appeal.export',{appealId:once.id,version:exported.version})
  const second=await prepare('email','Second annual supporter appeal')
  assert.ok(!(await recipientIds(second.id)).includes(annual.id));assert.ok(second.excluded['solicitation limit']>=1)
  const channel=await create('Eli Rivera','synthetic-coffer-507@example.test')
  await grant(channel)
  await command('solicitation.set',{donorId:channel.id,version:0,type:'channels',channels:['mail'],startsOn:day})
  const noMail=await prepare('mail','Autumn postal appeal'),yesEmail=await prepare('email','Autumn email appeal')
  assert.ok(!(await recipientIds(noMail.id)).includes(channel.id));assert.ok((await recipientIds(yesEmail.id)).includes(channel.id))

  // A frozen run must not proceed after a recipient’s restriction changes.
  await command('solicitation.set',{donorId:channel.id,version:1,type:'stop',startsOn:day})
  await command('appeal.approve',{appealId:yesEmail.id,version:1},{status:409})
  await command('prospect.save',{donorId:stop.id,ownerId:owner.id,stage:'stewardship',askAmount:'1000',expectedCloseOn:dueOn,nextStep:'Share reading-room outcomes without an ask.'})

  await command('welcome.publish',{thankSubject:'Thank you {{donor_name}}',thankBody:'Your first gift helps readers. Thank you.',impactSubject:'Reading-room update',impactBody:'Here is our update for supporters.',askSubject:'Help readers again',askBody:'Please consider another gift.',impactDays:1,askDays:2})
  at=new Date(Date.parse(at)+1000).toISOString()
  const welcome=await create('Inez Morgan','synthetic-coffer-508@example.test')
  await grant(welcome)
  await command('solicitation.set',{donorId:welcome.id,version:0,type:'stop',startsOn:day})
  await gift(welcome,'35')
  assert.ok((await command('welcome.run')).submitted>=1)
  let enrolled=(await get('/api/coffer/welcome')).enrollments.find(e=>e.donor_id===welcome.id)
  assert.equal(enrolled.steps.find(s=>s.step==='thank').status,'submitted')
  at=new Date(Date.parse(at)+3*86400000).toISOString()
  await command('welcome.run')
  enrolled=(await get('/api/coffer/welcome')).enrollments.find(e=>e.donor_id===welcome.id)
  assert.equal(enrolled.steps.find(s=>s.step==='ask').status,'cancelled')
  assert.equal(enrolled.steps.find(s=>s.step==='ask').note,'do not solicit')
  assert.ok(!(await get('/api/coffer/donors/'+welcome.id)).communications.some(m=>m.source_id===enrolled.steps.find(s=>s.step==='ask').id))

  const input={source:'lgl',files:[csv('constituents.csv',[['LGL Constituent ID','Name','Communication Tags'],['synthetic-coffer-509','Rowan Ellis','Do Not Solicit']])]}
  const imported=await h.api('/api/coffer/move-in/preview',input,options({}))
  assert.equal(imported.canApply,true,JSON.stringify(imported.diagnostics))
  let job=await h.api('/api/coffer/move-in/apply',{id:imported.id,fingerprint:imported.fingerprint,acknowledged:'no'},options({}))
  while(job.state==='applying')job=await h.api('/api/coffer/move-in/continue',{id:imported.id},options({}))
  const importedDonor=(await get('/api/coffer/donors')).donors.find(d=>d.name==='Rowan Ellis')
  await command('solicitation.set',{donorId:importedDonor.id,version:1,type:'limit',maxAsks:1,startsOn:day})
  await h.api('/api/coffer/move-in/undo',{id:imported.id},options({status:409}))

  if(process.env.COFFER_SOLICITATION_BROWSER){
   const directory=process.env.COFFER_SOLICITATION_BROWSER
   await mkdir(directory,{recursive:true})
   const {withBrowserWorker}=await import('./browser-worker.mjs')
   await withBrowserWorker(h,async(context,origin)=>{
    await context.setExtraHTTPHeaders({cookie:h.owner,'x-test-now':at})
    const page=await context.newPage()
    const screens=[['donor','/app/donors/'+stop.id],['pipeline','/app/pipeline'],['tasks','/app/calls'],['appeal','/app/appeals/'+yesEmail.id],['welcome','/app/appeals'],['appeal-entry','/app/appeals'],['import-entry','/app/move-in/crm'],['import','/app/move-in/crm/journal?id='+imported.id]]
    for(const width of [1440,390])for(const [name,path] of screens){
     await page.setViewportSize({width,height:1000});await page.goto(origin+path)
     if(name==='donor')assert.ok(await page.getByText('Do not solicit',{exact:true}).count())
     assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${name} fits ${width}`)
     await page.screenshot({path:`${directory}/DONOR-015-${name}-${width}.png`,fullPage:true})
    }
   })
  }
 },{entry:'tests/advancing-clock-worker.ts',bindings:{MAIL_PROVIDER:'sendgrid'},outbound:edge.outbound})
}
