import {test} from 'node:test'
import assert from 'node:assert/strict'
import {run,donor,reviewed,archive,restore,installation} from './harness.mjs'

const form=(h,fields)=>h.request('/app/actions',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams(fields).toString()})
const history=(h,d)=>h.get('/api/coffer/donors/'+d.id)
const profile=async(h,d,input,options)=>h.command('donor.profile',{donorId:d.id,version:(await history(h,d)).donor.version,...input},options)
const grant=(h,d,channel)=>h.command('consent.record',{donorIds:[d.id],channel,status:'granted',method:'paper form',evidence:'Synthetic written permission',capturedOn:'2026-01-01'})
const csvFile=(name,text)=>({name,base64:Buffer.from(text).toString('base64')})
const importFile=async(h,source,text)=>{
 const input={source,files:[csvFile('constituents.csv',text)]},preview=await h.api('/api/coffer/move-in/preview',input)
 assert.equal(preview.canApply,true,JSON.stringify(preview.diagnostics))
 let job=await h.api('/api/coffer/move-in/apply',{id:preview.id,fingerprint:preview.fingerprint})
 while(job.state==='applying')job=await h.api('/api/coffer/move-in/continue',{id:job.id})
}

// Faked only at Mango's and SendGrid's network edges; Coffer runs its real Worker and D1.
test('DONOR-012: deceased and inactive constituents leave every send, task and statement path with a counted reason, and survivors are addressed',()=>{
 const contacts=new Map(),credential=`coffer-test-${process.pid}`,sendgrid=[]
 let harness
 return run(async h=>{
  harness=h
  await reviewed(h)
  const timezone=(await h.get('/api/coffer/settings')).timezone,today=new Intl.DateTimeFormat('en-CA',{timeZone:timezone}).format(new Date())
  const past=new Intl.DateTimeFormat('en-CA',{timeZone:timezone}).format(new Date(Date.now()-86400000*3))
  assert.equal((await form(h,{command:'marketing.connectMango',origin:'https://mango.example.test/settings',credential})).status,303)
  await h.command('welcome.publish',{thankSubject:'Thank you {{donor_name}}',thankBody:'Your first gift helps.',impactSubject:'Impact',impactBody:'Meals.',askSubject:'Next',askBody:'Again.',impactDays:7,askDays:21})
  const member=await h.person('status-member@example.test')
  const john=await donor(h,'John Smith',{household:'Smith household'}),jane=await donor(h,'Jane Smith',{household:'Smith household'}),ruth=await donor(h,'Ruth Okafor'),sam=await donor(h,'Sam Alder'),dan=await donor(h,'Dan Estes'),wes=await donor(h,'Wes Hart')
  for(const d of [john,jane,ruth,sam,dan,wes]){await grant(h,d,'email');await grant(h,d,'mail')}
  await profile(h,john,{prefix:'Mr.',firstName:'John',lastName:'Smith'});await profile(h,jane,{prefix:'Mrs.',firstName:'Jane',lastName:'Smith'})
  const gift=(d,amount,receivedOn,extra={})=>h.command('gift.record',{donorId:d.id,amount,receivedOn,method:'check',goods:'none',...extra})
  // Gifts that need statements: 2024 for the individual run, 2025 for the household run.
  await gift(john,'40','2024-05-01');await gift(ruth,'40','2024-05-01');await gift(sam,'40','2024-05-01');await gift(john,'100','2025-05-01');await gift(jane,'100','2025-05-01')
  // John has an open call task and a repeating task; Wes's first gift after publication enrolls him in the welcome series.
  await gift(wes,'30',today)
  const pledge=await h.command('pledge.create',{donorId:john.id,amount:'50',pledgedOn:'2026-01-01',fund:'Library',installments:[{dueOn:past,amount:'50'}]})
  const installment=(await history(h,john)).pledges.find(p=>p.id===pledge.id).installments[0]
  const owner=(await h.get('/api/coffer/tasks')).owners.find(o=>o.name==='Morgan Lee')
  const call=await h.command('task.generate',{sourceKey:'pledge:'+installment.id,ownerId:owner.id,dueOn:today})
  await h.command('task.repeatCreate',{title:'Quarterly stewardship call',donorId:john.id,ownerId:owner.id,dueOn:today,intervalMonths:3})
  assert.equal((await h.command('welcome.run')).submitted,1)
  assert.equal((await h.get('/api/coffer/welcome')).enrollments.find(e=>e.donor_id===wes.id).status,'active')

  // Recording rules: a reason for inactive, a past date of death for deceased, people only.
  await profile(h,ruth,{constituentStatus:'inactive'},{status:400})
  await profile(h,john,{constituentStatus:'deceased'},{status:400})
  await profile(h,john,{constituentStatus:'deceased',deceasedOn:'2999-01-01'},{status:400})
  await profile(h,ruth,{constituentStatus:'inactive',statusReason:'Asked for no contact'})
  const ruthRecord=(await history(h,ruth)).donor
  assert.deepEqual([ruthRecord.constituent_status,ruthRecord.status_reason,ruthRecord.status_changed_by,ruthRecord.deceased_on],['inactive','Asked for no contact','Morgan Lee',null])

  // Appeals count each excluded reason; a status change after preparation blocks approval.
  const emailAppeal=await h.command('appeal.prepare',{name:'Spring appeal',channel:'email'}),mailAppeal=await h.command('appeal.prepare',{name:'Spring letters',channel:'mail'})
  for(const a of [emailAppeal,mailAppeal]){assert.equal(a.recipients,5);assert.equal(a.excluded.inactive,1)}
  await profile(h,john,{constituentStatus:'deceased',deceasedOn:'2026-03-02'})
  await profile(h,wes,{constituentStatus:'deceased',deceasedOn:'2026-03-05'})
  const johnRecord=(await history(h,john)).donor
  assert.deepEqual([johnRecord.constituent_status,johnRecord.deceased_on,johnRecord.status_changed_by],['deceased','2026-03-02','Morgan Lee'])
  assert.ok((await h.get('/api/coffer/audit?action=donor.status&record='+john.id)).rows.some(r=>JSON.parse(r.detail).to==='deceased'&&JSON.parse(r.detail).recordedBy==='Morgan Lee'))
  assert.equal((await h.command('appeal.approve',{appealId:emailAppeal.id,version:1},{status:409})).error,'CONSENT_CHANGED')
  await h.command('appeal.discard',{appealId:emailAppeal.id,version:1});await h.command('appeal.discard',{appealId:mailAppeal.id,version:1})
  const email2=await h.command('appeal.prepare',{name:'Summer appeal',channel:'email'}),mail2=await h.command('appeal.prepare',{name:'Summer letters',channel:'mail'})
  for(const a of [email2,mail2]){assert.equal(a.recipients,3);assert.deepEqual([a.excluded.deceased,a.excluded.inactive],[2,1])}
  const recipients=(await h.get('/api/coffer/appeals/'+email2.id)).recipients.map(r=>r.donor_id)
  assert.ok(!recipients.includes(john.id)&&!recipients.includes(ruth.id))

  // The journey removes the enrolled donor and cancels the pending steps; the run sends nothing more to them.
  const enrollment=(await h.get('/api/coffer/welcome')).enrollments.find(e=>e.donor_id===wes.id)
  assert.equal(enrollment.status,'deceased');assert.ok(enrollment.steps.filter(s=>s.status==='cancelled').length>=2)
  assert.equal((await h.command('welcome.run')).submitted,0)
  const welcomeSteps=(await history(h,wes)).communications.filter(m=>m.source_kind==='welcome')
  assert.equal(welcomeSteps.length,1,'Only the thank-you sent before the death')

  // Pledge reminders skip him, counted; his open tasks close with the reason; no new task can be made.
  const reminded=await h.command('pledge.remind',{donorId:john.id});assert.equal(reminded.submitted,0);assert.deepEqual(reminded.excluded,{deceased:1});assert.equal(sendgrid.length,0)
  const closed=(await h.get('/api/coffer/tasks')).tasks.find(t=>t.id===call.id)
  assert.deepEqual([closed.status,closed.closed_reason],['done','deceased'])
  assert.deepEqual((await h.get('/api/coffer/recurring-tasks')).filter(t=>t.donor_id===john.id).map(t=>t.status),['done'])
  const sources=await h.get('/api/coffer/tasks');assert.ok(!sources.sources.some(s=>s.donorId===john.id));assert.equal(sources.excluded.deceased,1)
  assert.equal((await h.command('task.generate',{sourceKey:'pledge:'+installment.id,ownerId:owner.id,dueOn:today},{status:409})).error,'DONOR_STATUS')
  const calls=await (await h.request('/app/calls?status=all')).text();assert.match(calls,/Closed: deceased/);assert.match(calls,/1 deceased/)

  // The relationship manager is told in the app; another member is not, and cannot acknowledge it.
  const notices=(await h.get('/api/coffer/status-notices')).notices
  assert.equal(notices.length,3);const notice=notices.find(n=>n.donor_id===john.id)
  assert.deepEqual([notice.status,notice.detail.deceasedOn,notice.detail.closed.callTasks,notice.detail.closed.repeatingTasks,notice.detail.closed.journeys],['deceased','2026-03-02',1,1,0])
  assert.equal(notices.find(n=>n.donor_id===wes.id).detail.closed.journeys,1)
  assert.deepEqual((await h.get('/api/coffer/status-notices',{as:member.cookie})).notices,[])
  await h.command('statusNotice.acknowledge',{noticeId:notice.id},{as:member.cookie,status:409})
  await h.command('statusNotice.acknowledge',{noticeId:notice.id})
  assert.equal((await h.get('/api/coffer/status-notices')).notices.length,2)

  // The household drops him from computed names; a person confirms before the next household mailing.
  const hid=johnRecord.household_id
  let household=await h.get('/api/coffer/households/'+hid)
  assert.deepEqual([household.names.addressee,household.names.formal,household.names.informal],['Mrs. Jane Smith','Mrs. Jane Smith','Jane']);assert.equal(household.headStatus,'none');assert.equal(household.household.survivor_review,1)
  assert.match(await (await h.request('/app/donors/'+jane.id)).text(),/Confirm these household names/)
  assert.equal((await h.command('ack.prepareStatements',{householdId:hid,year:2025},{status:409})).error,'NAMES_UNCONFIRMED')
  await h.command('household.confirmNames',{householdId:hid,version:household.household.version},{as:member.cookie})
  household=await h.get('/api/coffer/households/'+hid);assert.equal(household.household.survivor_review,0)
  const statement=await h.command('ack.prepareStatements',{householdId:hid,year:2025})
  const piece=(await h.get('/api/coffer/letters/'+statement.id)).letters[0]
  assert.equal(piece.recipient_name,'Mrs. Jane Smith');assert.equal(JSON.parse(piece.household_snapshot).members.length,2,'Joint giving history stays with the household')
  assert.match(piece.body,/\$200\.00/)

  // Individual year-end statements leave both out, counted by reason.
  const year=await h.command('ack.prepareStatements',{year:2024});assert.equal(year.letters,1);assert.deepEqual(year.excluded,{deceased:1,inactive:1})

  // A gift still being receipted is addressed to the surviving household or the estate, never the deceased; inactive gifts are held.
  await gift(john,'300',today);await gift(dan,'300',today);await gift(ruth,'300',today)
  await profile(h,dan,{constituentStatus:'deceased',deceasedOn:'2026-04-01'})
  const letters=await h.get('/api/coffer/letters');assert.equal(letters.held.inactive,1)
  const ack=await h.command('ack.prepare',{}),batch=(await h.get('/api/coffer/letters/'+ack.id)).letters
  const to=d=>batch.find(l=>l.donor_id===d.id)
  assert.equal(to(ruth),undefined);assert.equal(batch.length,2)
  assert.equal(to(john).recipient_name,'Mrs. Jane Smith');assert.match(to(john).body,/Dear Jane,/)
  assert.equal(to(dan).recipient_name,'Estate of Dan Estes');assert.match(to(dan).body,/Dear Estate of Dan Estes,/)
  assert.ok(batch.every(l=>!/Dear (John|Dan),/.test(l.body)))

  // Restoring him resumes reminders; the status and date of death survive archive and restore.
  const snapshot=await archive(h),fresh=await installation()
  try{await restore(fresh,snapshot);const restored=(await fresh.get('/api/coffer/donors/'+john.id)).donor;assert.deepEqual([restored.constituent_status,restored.deceased_on,restored.status_changed_by],['deceased','2026-03-02','Morgan Lee'])}finally{await fresh.close()}
  await profile(h,john,{constituentStatus:'active'})
  assert.deepEqual([(await history(h,john)).donor.status_reason,(await history(h,john)).donor.deceased_on],[null,null])
  assert.equal((await h.command('pledge.remind',{donorId:john.id})).submitted,1);assert.equal(sendgrid.length,1)

  // Importers carry each incumbent's status and date of death.
  await importFile(h,'lgl','LGL Constituent ID,Name,Email,Constituent Status,Inactive Reason,Date of Death\n701,Alma Lund,alma.lund@example.org,Deceased,,2025-11-30\n702,Bram Lund,bram.lund@example.org,Active,,\n703,Cora Lund,cora.lund@example.org,Inactive,No longer engaged,\n')
  const alma=(await h.get('/api/coffer/donors?q=alma.lund')).donors[0],almaRecord=(await history(h,alma)).donor
  assert.deepEqual([almaRecord.constituent_status,almaRecord.deceased_on],['deceased','2025-11-30'])
  assert.equal((await history(h,(await h.get('/api/coffer/donors?q=bram.lund')).donors[0])).donor.constituent_status,'active')
  const cora=(await history(h,(await h.get('/api/coffer/donors?q=cora.lund')).donors[0])).donor;assert.deepEqual([cora.constituent_status,cora.status_reason],['inactive','No longer engaged'])
  await importFile(h,'bloomerang','Account Number,First Name,Last Name,Email,Constituent Status,Inactive Reason,Date of Death\n811,Cleo,Marsh,cleo.marsh@example.org,Inactive,Moved away,\n812,Dev,Marsh,dev.marsh@example.org,Deceased,,2025-12-24\n813,Esme,Marsh,esme.marsh@example.org,Active,,\n')
  const marsh=async name=>(await history(h,(await h.get('/api/coffer/donors?q='+name)).donors[0])).donor
  const cleo=await marsh('cleo.marsh'),dev=await marsh('dev.marsh')
  assert.deepEqual([cleo.constituent_status,cleo.status_reason,cleo.deceased_on],['inactive','Moved away',null])
  assert.deepEqual([dev.constituent_status,dev.deceased_on],['deceased','2025-12-24'])
  assert.equal((await marsh('esme.marsh')).constituent_status,'active')
  await importFile(h,'re-nxt','Constituent ID,First Name,Last Name,Email,Constituent Status,Date of Death\n901,Fay,Quill,fay.quill@example.org,Deceased,2025-10-10\n')
  const fay=await marsh('fay.quill');assert.deepEqual([fay.constituent_status,fay.deceased_on],['deceased','2025-10-10'])
 },{bindings:{MAIL_PROVIDER:'sendgrid'},outbound:async request=>{
  const u=new URL(request.url)
  if(u.hostname==='api.sendgrid.com'){
   const payload=await request.json(),text=payload.content.map(c=>c.value).join('\n')
   // Base's sign-in invitations share the SendGrid edge; the harness reads them from its own capture.
   if(text.includes('/auth/confirm?token=')){harness.messages.push({to:payload.personalizations[0].to,text});return new Response(null,{status:202})}
   sendgrid.push(payload);return new Response(null,{status:202,headers:{'x-message-id':`status-${sendgrid.length}`}})
  }
  assert.equal(u.origin,'https://mango.example.test')
  if(request.headers.get('authorization')!==`Bearer ${credential}`)return Response.json({error:'invalid_credential'},{status:401})
  const path=u.pathname.slice('/api/integrations/v1'.length),body=request.method==='GET'?null:await request.json()
  if(path==='/segments'||path==='/events')return Response.json(path==='/events'?{events:[],nextCursor:'0'}:{segments:[]})
  if(path.endsWith('/send'))return Response.json({error:'invalid_request'},{status:400})
  if(path==='/contacts'&&request.method==='PUT'){if(!body.email)return Response.json({error:'invalid_request'},{status:400});const contact={id:body.email,email:body.email,displayName:body.displayName,emailStatus:'subscribed'};contacts.set(body.email,contact);return Response.json({contact:{...contact,segmentIds:[body.segmentName]}})}
  if(path==='/contacts')return Response.json({contacts:[...contacts.values()].filter(c=>c.email===u.searchParams.get('email')),nextCursor:''})
  assert.fail(`Unexpected request ${request.method} ${path}`)
 }})
})
