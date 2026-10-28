import {prepareVerifiedMail} from './verified-mail-edge.mjs'
import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {run,donor,reviewed,archive,restore,installation} from './harness.mjs'
const recorded=JSON.parse(await readFile(new URL('./fixtures/mango/audience.json',import.meta.url),'utf8'))
const chimp=JSON.parse(await readFile(new URL('./fixtures/mailchimp/responses.json',import.meta.url),'utf8'))
const form=(h,fields)=>h.request('/app/actions',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams(fields).toString()})

test('COMM-003: Constant Contact serves the frozen audience, returns results and routes replies with current permission and custody',async()=>{
 const {constantContactJourney}=await import('./constant-contact-journey.mjs')
 await constantContactJourney()
})

test('COMM-001: portal topics and channel frequency fence current outreach and retain original preference custody',async()=>{
 const {communicationPreferencesJourney}=await import('./communication-preferences-journey.mjs')
 await communicationPreferencesJourney()
})

test('COMM-005: routed replies reach managers, withdraw explicit stops once and review ambiguous requests with custody',async()=>{
 const {replyStopJourney}=await import('./reply-stop-journey.mjs')
 await replyStopJourney()
 const {transactionalRepliesJourney}=await import('./transactional-replies-journey.mjs')
 await transactionalRepliesJourney()
})

async function consenting(h,names){
 const rows=[]
 for(const [i,name] of names.entries()){
  const row=await donor(h,name,{email:recorded.contacts[i].email})
  await h.command('consent.record',{donorIds:[row.id],channel:'email',status:'granted',method:'paper form',evidence:'Synthetic explicit opt-in',capturedOn:'2025-01-01'})
  await h.command('consent.record',{donorIds:[row.id],channel:'mail',status:'granted',method:'paper form',evidence:'Synthetic postal opt-in',capturedOn:'2025-01-01'})
  await h.command('gift.record',{donorId:row.id,amount:'250',receivedOn:'2025-03-02',method:'check',goods:'none',fund:'Library'})
  rows.push(row)
 }
 return rows
}
const appeal=async h=>{
 const frozen=await h.command('appeal.prepare',{name:'Library renewal',channel:'email',fund:'Library',subject:'Thank you, {{donor_name}}',body:'Your {{gift_count}} gift totals {{total_given}}.'})
 await h.command('appeal.approve',{appealId:frozen.id,version:1})
 return frozen
}

test('DONOR-014: Mailchimp audience names follow parts and typed overrides for subscribed and new pending members without overriding opt-outs',()=>{
 const definitions=new Map(),members=new Map(),writes=[]
 const hash=email=>createHash('md5').update(email).digest('hex')
 const email='robert.smith@example.test'
 members.set(hash(email),{id:'robert',email_address:email,status:'subscribed'})
 let unsubscribeOnPatch=false
 return run(async h=>{
  const robert=await donor(h,'Robert Smith',{email})
  const profile=async(d,input)=>h.command('donor.profile',{donorId:d.id,version:(await h.get('/api/coffer/donors/'+d.id)).donor.version,...input})
  const consent=(d,status)=>h.command('consent.record',{donorIds:[d.id],channel:'email',status,method:'paper form',evidence:'Explicit test permission',capturedOn:'2026-09-01'})
  await profile(robert,{prefix:'Dr.',firstName:'Robert',middleName:'A.',lastName:'Smith',suffix:'Jr.',nickname:'Bob'})
  await consent(robert,'granted')
  await h.command('marketing.connectMailchimp',{apiKey:'synthetic-us21'})
  await h.command('marketing.chooseAudience',{listId:'fixture-list',fromName:'Library',fromEmail:'library@example.test'})
  assert.equal((await h.command('marketing.sync')).pending,0)
  assert.deepEqual(members.get(hash(email)).merge_fields,{CF_INFORM:'Bob',CF_FORMAL:'Dr. Smith',CF_ENVELOP:'Dr. Robert A. Smith Jr.',CF_PREFIX:'Dr.',CF_FIRST:'Robert',CF_MIDDLE:'A.',CF_LAST:'Smith',CF_SUFFIX:'Jr.',CF_NICK:'Bob'})
  assert.equal(definitions.size,9)
  await profile(robert,{nickname:'Rob',lastName:'Jones',envelopeName:'The Smith Family',formalSalutation:'Doctor Smith'})
  await h.command('marketing.sync')
  assert.deepEqual(members.get(hash(email)).merge_fields,{CF_INFORM:'Rob',CF_FORMAL:'Doctor Smith',CF_ENVELOP:'The Smith Family',CF_PREFIX:'Dr.',CF_FIRST:'Robert',CF_MIDDLE:'A.',CF_LAST:'Jones',CF_SUFFIX:'Jr.',CF_NICK:'Rob'})
  assert.equal(members.get(hash(email)).status,'subscribed')
  const beforeConflict=writes.length
  definitions.get('CF_FORMAL').type='number'
  assert.equal((await h.command('marketing.sync')).pending,1,'An incompatible audience definition blocks the name update')
  assert.equal(writes.length,beforeConflict)
  assert.equal(definitions.get('CF_FORMAL').type,'number','Sync never replaces another audience field definition')
  definitions.get('CF_FORMAL').type='text'
  // An unsubscribe racing the merge-only PATCH must become a local withdrawal.
  unsubscribeOnPatch=true
  await h.command('marketing.sync')
  assert.equal(members.get(hash(email)).status,'unsubscribed')
  assert.equal((await h.get('/api/coffer/donors/'+robert.id)).current.email.status,'withdrawn')
  const excluded=await h.command('appeal.prepare',{name:'Synthetic provider unsubscribe appeal',channel:'email'},{status:409})
  assert.equal(excluded.details['consent withdrawn'],1,'The next appeal excludes a Mailchimp unsubscribe with its current-consent reason')
  const count=writes.length
  await h.command('marketing.sync')
  assert.equal(writes.length,count,'An opted-out contact receives no further name writes')
  members.get(hash(email)).interests={'synthetic-coffer-9201':true,'synthetic-coffer-9202':false};members.get(hash(email)).merge_fields.CF_FREQ='monthly'
  await h.command('marketing.topicMapping',{provider:'mailchimp',newsletterId:'synthetic-coffer-9201',appealsId:'synthetic-coffer-9202',frequencyField:'CF_FREQ',confirm:'yes'})
  await h.command('marketing.sync')
  const importedPreference=(await h.get('/api/coffer/donors/'+robert.id+'/preferences')).channels.find(p=>p.channel==='email')
  assert.ok(importedPreference.topics.includes('newsletter'));assert.ok(!importedPreference.topics.includes('appeals'));assert.equal(importedPreference.frequency,'monthly')
  assert.equal((await h.get('/api/coffer/donors/'+robert.id+'/preferences')).history.at(-1).source,'mailchimp')
  await h.command('marketing.topicMapping',{provider:'mailchimp',confirm:'yes'})
  const ana=await donor(h,'Ana Lee',{email:'ana.lee@example.test'})
  await profile(ana,{prefix:'Ms.',firstName:'Ana',lastName:'Lee',informalSalutation:'Annie',envelopeName:'The Lee Family'})
  await consent(ana,'granted')
  await h.command('gift.record',{donorId:ana.id,amount:'25',receivedOn:'2026-09-01',method:'check',goods:'none',fund:'Library'})
  const batch=await h.command('appeal.prepare',{name:'Named appeal',channel:'email',fund:'Library',subject:'Hello {{formal_salutation}}',body:'{{prefix}} {{first_name}} {{middle_name}} {{last_name}} {{suffix}} {{nickname}} | {{informal_salutation}} | {{envelope_name}}'})
  await h.command('appeal.approve',{appealId:batch.id,version:1})
  await profile(ana,{nickname:'Changed after approval'})
  const result=await h.command('appeal.send',{appealId:batch.id,version:2})
  assert.equal(result.submitted,0,'A new pending member still needs Mailchimp double opt-in')
  assert.equal(result.suppressed,1)
  const message=(await h.get('/api/coffer/donors/'+ana.id)).communications.find(m=>m.source_id===batch.id)
  assert.equal(message.subject,'Hello Ms. Lee');assert.equal(message.body,'Ms. Ana Ms. Lee Lee Ms. Lee Ms. Lee | Annie | The Lee Family','RCPT-010 missing name parts use the formal fallback and approved fields stay frozen after profile changes')
  const pending=members.get(hash('ana.lee@example.test'))
  assert.equal(pending.status,'pending')
  assert.deepEqual(pending.merge_fields,{CF_INFORM:'Annie',CF_FORMAL:'Ms. Lee',CF_ENVELOP:'The Lee Family',CF_PREFIX:'Ms.',CF_FIRST:'Ana',CF_MIDDLE:'Ms. Lee',CF_LAST:'Lee',CF_SUFFIX:'Ms. Lee',CF_NICK:'Changed after approval'})
  // RCPT-010: explicit, versioned selection shares only reviewed profile fields.
  const casey={...await donor(h,'Synthetic Casey',{email:'synthetic-coffer-1501@example.test'}),email:'synthetic-coffer-1501@example.test'}
  members.set(hash(casey.email),{id:'synthetic-coffer-1501',email_address:casey.email,status:'subscribed'})
  await consent(casey,'granted')
  await h.command('gift.record',{donorId:casey.id,amount:'100',receivedOn:'2026-09-01',method:'check',goods:'none',fund:'Library'})
  await h.command('custom.define',{key:'profile_interest',label:'Profile interest',kind:'constituent',type:'text'})
  await h.command('custom.set',{key:'profile_interest',recordId:casey.id,value:'Books',source:'Synthetic reviewed preference'})
  let selection=await h.get('/api/coffer/provider-fields')
  assert.deepEqual(selection.fields,[],'Extra fields start off')
  await h.command('marketing.fields',{version:selection.version,fields:'{{email}}'},{status:400})
  await h.command('marketing.fields',{version:selection.version,fields:'{{unknown_field}}',confirm:'yes'},{status:400})
  const selected='{{custom.profile_interest}}\n{{total_given}}\n{{email}}'
  const beforeSelection=writes.length
  await h.command('marketing.fields',{version:selection.version,fields:selected,confirm:'yes'})
  assert.equal(writes.length,beforeSelection,'Saving consent sends no profile')
  await h.command('marketing.fields',{version:selection.version,fields:selected,confirm:'yes'},{status:409})
  await h.command('marketing.sync')
  const extraTag=key=>[...definitions.values()].find(f=>f.name==='Coffer '+key)?.tag
  assert.equal(members.get(hash(casey.email)).merge_fields[extraTag('custom.profile_interest')],'Books')
  assert.equal(members.get(hash(casey.email)).merge_fields[extraTag('total_given')],'$100.00')
  assert.equal(members.get(hash(casey.email)).merge_fields[extraTag('email')],casey.email)
  const dana={...await donor(h,'Synthetic Dana',{email:'synthetic-coffer-1502@example.test'}),email:'synthetic-coffer-1502@example.test'}
  members.set(hash(dana.email),{id:'synthetic-coffer-1502',email_address:dana.email,status:'subscribed'})
  await consent(dana,'granted')
  assert.ok((await h.command('marketing.sync')).pending>0)
  assert.equal(members.get(hash(dana.email)).merge_fields,undefined,'A missing selected value prevents every member-value write')
  selection=await h.get('/api/coffer/provider-fields')
  await h.command('marketing.fields',{version:selection.version,fields:selected.replace('custom.profile_interest}}','custom.profile_interest|Supporter}}'),confirm:'yes'})
  await h.command('marketing.sync')
  assert.equal(members.get(hash(dana.email)).merge_fields[extraTag('custom.profile_interest')],'Supporter')
  const member=await h.person('synthetic-coffer-1503@example.test')
  selection=await h.get('/api/coffer/provider-fields')
  await h.command('marketing.fields',{version:selection.version,fields:'',confirm:'yes'},{as:member.cookie,status:403})
  await h.command('marketing.fields',{version:selection.version,fields:'',confirm:'yes'})
  await h.command('custom.set',{key:'profile_interest',recordId:casey.id,value:'Music',version:1,source:'Synthetic later preference'})
  await h.command('marketing.sync')
  assert.equal(members.get(hash(casey.email)).merge_fields[extraTag('custom.profile_interest')],'Books','Clearing stops fresh field reads without silently deleting provider history')
  await consent(ana,'withdrawn')
  assert.equal(pending.status,'unsubscribed','Coffer withdrawal still suppresses the pending member')
 },{outbound:async request=>{
  const u=new URL(request.url),body=request.method==='GET'?null:await request.json()
  assert.equal(u.origin,'https://us21.api.mailchimp.com')
  if(u.pathname==='/3.0/lists')return Response.json({lists:[{id:'fixture-list',name:'Names audience',stats:{member_count:members.size}}]})
  if(u.pathname==='/3.0/lists/fixture-list/merge-fields'){
   if(request.method==='GET')return Response.json({merge_fields:[...definitions.values()],total_items:definitions.size})
   assert.equal(request.method,'POST');assert.equal(body.type,'text');assert.equal(body.public,false);assert.equal(body.required,false)
   assert.equal(definitions.has(body.tag),false,'Existing field definitions are reused')
   definitions.set(body.tag,body);return Response.json(body)
  }
  const match=u.pathname.match(/^\/3.0\/lists\/fixture-list\/members\/([^/]+)$/)
  assert.ok(match,`Unexpected Mailchimp request ${request.method} ${u.pathname}`)
  let member=members.get(match[1])
  if(request.method==='GET')return member?Response.json(member):Response.json({title:'Resource Not Found'},{status:404})
  if(body.merge_fields){
   for(const tag of Object.keys(body.merge_fields))assert.equal(definitions.get(tag)?.type,'text','Member values require defined text fields')
   assert.equal(body.status,undefined,'Name writes never change subscription status')
   writes.push(body)
  }
  if(request.method==='PATCH'){
   assert.ok(member);assert.deepEqual(Object.keys(body),['merge_fields'])
   if(unsubscribeOnPatch){member.status='unsubscribed';unsubscribeOnPatch=false}
  }else{
   assert.equal(request.method,'PUT')
   if(!member){member={id:match[1],email_address:body.email_address,status:body.status_if_new};members.set(match[1],member)}
   if(body.status)member.status=body.status
  }
  if(body.merge_fields)member.merge_fields={...member.merge_fields,...body.merge_fields}
  return Response.json(member)
 }})
})

// Faked only at Mango's network edge, with its scoped integration API; Coffer runs its real Worker and D1.
test('DONOR-014: Connect Mango from the page, send an approved appeal to a Mango list, and keep opt-outs in step',()=>{
 // A synthetic credential: Mango is faked at its network edge.
 const contacts=new Map(),lists=new Map(),suppressions=[],credential=`coffer-test-${process.pid}`
 let unsubscribeChosenOnPut=false
 return run(async h=>{
  const [avery,jordan]=await consenting(h,['Avery Chen','Jordan Brooks'])
  await h.command('donor.profile',{donorId:avery.id,version:(await h.get('/api/coffer/donors/'+avery.id)).donor.version,prefix:'Dr.',firstName:'Avery',lastName:'Chen',nickname:'Ave',envelopeName:'The Chen Family'})
  const frozen=await appeal(h)
  // Not connected: the page leads to the connect page, never a 503.
  const before=await (await h.request(`/app/appeals/${frozen.id}`)).text()
  assert.match(before,/href="\/app\/appeals\/connect"/)
  assert.doesNotMatch(before,/name="command" value="appeal.send"/)
  assert.equal((await h.command('appeal.send',{appealId:frozen.id,version:2},{status:409})).error,'EMAIL_NOT_CONNECTED')
  const guide=await (await h.request('/app/appeals/connect')).text()
  assert.match(guide,/Integration credentials/)
  assert.match(guide,/rer dev just-every\/run-mango|run-mango\.com\/run/)
  // A wrong credential is refused on the page with Mango's reason.
  const refused=await form(h,{command:'marketing.connectMango',origin:'https://mango.example.test',credential:'wrong'})
  assert.equal(refused.status,502);assert.match(await refused.text(),/no longer accepts this credential/)
  const connected=await form(h,{command:'marketing.connectMango',origin:'https://mango.example.test/settings',credential})
  assert.equal(connected.status,303)
  assert.match(await (await h.request('/app/appeals/connect')).text(),/all four permissions/)
  const page=await (await h.request(`/app/appeals/${frozen.id}`)).text()
  assert.match(page,/all 2 approved recipients/)
  const sent=await h.command('appeal.send',{appealId:frozen.id,version:2})
  assert.deepEqual([sent.listed,sent.remaining],[2,0])
  assert.deepEqual(Object.fromEntries(['prefix','first_name','last_name','nickname','informal_salutation','formal_salutation','envelope_name'].map(k=>[k,contacts.get(recorded.contacts[0].email).fields[k]])),{prefix:'Dr.',first_name:'Avery',last_name:'Chen',nickname:'Ave',informal_salutation:'Ave',formal_salutation:'Dr. Chen',envelope_name:'The Chen Family'})
  const list=lists.get('Coffer appeal · Library renewal · '+(await h.get(`/api/coffer/appeals/${frozen.id}`)).appeal.prepared_at.slice(0,10))
  assert.deepEqual([...list].sort(),[recorded.contacts[0].email,recorded.contacts[1].email].sort())
  const finish=await (await h.request(`/app/appeals/${frozen.id}`)).text()
  assert.match(finish,/Finish in Mango/);assert.match(finish,/displayName \| fallback/)
  assert.equal((await h.command('appeal.send',{appealId:frozen.id,version:2})).listed,0,'Pressing again lists nobody twice')
  await h.command('custom.define',{key:'profile_interest',label:'Profile interest',kind:'constituent',type:'text'})
  await h.command('custom.set',{key:'profile_interest',recordId:avery.id,value:'Books',source:'Synthetic reviewed preference'})
  const selection=await h.get('/api/coffer/provider-fields'),beforeFields=JSON.stringify([...contacts]),beforeLists=lists.size
  await h.command('marketing.fields',{version:selection.version,fields:'{{custom.profile_interest|Supporter}}\n{{total_given}}\n{{email}}',confirm:'yes'})
  assert.equal(JSON.stringify([...contacts]),beforeFields);assert.equal(lists.size,beforeLists,'Selection alone creates no list or subscription')
  contacts.get(recorded.contacts[0].email).fields.external='kept'
  await h.command('marketing.sync')
  assert.equal(contacts.get(recorded.contacts[0].email).fields['custom.profile_interest'],undefined,'Preference reads never create a Mango membership')
  const next=await appeal(h)
  assert.equal((await h.command('appeal.send',{appealId:next.id,version:2})).listed,2)
  const shared=contacts.get(recorded.contacts[0].email).fields
  assert.equal(shared['custom.profile_interest'],'Books');assert.equal(shared.total_given,'$250.00');assert.equal(shared.email,recorded.contacts[0].email);assert.equal(shared.external,'kept')
  assert.equal(contacts.get(recorded.contacts[1].email).fields['custom.profile_interest'],'Supporter')
  const catalog=await h.get('/api/coffer/template-fields');assert.ok(catalog.messages.find(m=>m.kind==='appeal').fields.includes('custom.profile_interest'))
  const mergeInput={name:'Synthetic merged appeal',channel:'email',subject:'{{formal_salutation}} · {{custom.profile_interest|Supporter}}',body:'{{total_given}} · {{email}} · {{custom.profile_interest|Supporter}}'}
  const customAgent=await h.command('agent.create',{label:'Synthetic custom-data boundary'})
  await h.command('appeal.prepare',mergeInput,{as:'',headers:{authorization:'Bearer '+customAgent.token},status:403})
  await h.command('appeal.prepare',{...mergeInput,body:'{{unknown_field|fallback}}'},{status:400})
  await h.command('appeal.prepare',{...mergeInput,body:'{{custom.profile_interest|{{donor_name}}}}'},{status:400})
  const merged=await h.command('appeal.prepare',mergeInput),mergeDetail=await h.get('/api/coffer/appeals/'+merged.id)
  assert.deepEqual(mergeDetail.mergeReview,[])
  assert.equal(mergeDetail.recipients.find(r=>r.donor_id===avery.id).rendered_body,'$250.00 · '+recorded.contacts[0].email+' · Books')
  assert.match(mergeDetail.recipients.find(r=>r.donor_id===jordan.id).rendered_subject,/Supporter$/)
  assert.deepEqual(Object.keys(JSON.parse(mergeDetail.recipients[0].merge_fields)).sort(),['custom.profile_interest','email','formal_salutation','total_given'],'Only fields used by the template are frozen')
  await h.command('appeal.approve',{appealId:merged.id,version:1})
  await h.command('custom.set',{key:'profile_interest',recordId:avery.id,value:'Board {{literal_value}}',version:1,source:'Synthetic later preference'})
  assert.equal((await h.command('appeal.send',{appealId:merged.id,version:2})).listed,2)
  assert.match((await h.get('/api/coffer/donors/'+avery.id)).communications.find(m=>m.source_id===merged.id).body,/ · Books$/,'A profile edit after approval never rewrites frozen appeal wording')
  const handoffPage=await (await h.request('/app/appeals/'+merged.id)).text();assert.match(handoffPage,/>Approved message</);assert.match(handoffPage,/Before approving in Mango, map or replace/);assert.match(handoffPage,/\{\{custom\.profile_interest\}\}/);assert.doesNotMatch(handoffPage,/Mango fills in each donor’s name, but not giving figures/)
  const blanks=await h.command('appeal.prepare',{...mergeInput,subject:'Hello {{custom.profile_interest}}',body:'{{custom.profile_interest}} {{custom.profile_interest}}'})
  const blankDetail=await h.get('/api/coffer/appeals/'+blanks.id)
  const preparedPage=await (await h.request('/app/appeals/'+blanks.id)).text();assert.match(preparedPage,/>Prepared message</);assert.doesNotMatch(preparedPage,/>Approved message</)
  assert.deepEqual(blankDetail.mergeReview,[{donorId:jordan.id,recipientName:'Jordan Brooks',fields:['custom.profile_interest']}])
  assert.match(blankDetail.recipients.find(r=>r.donor_id===avery.id).rendered_body,/Board \{\{literal_value\}\}/,'Custom values are literal and never parsed again')
  const portable=await archive(h),restored=await installation()
  try{await restore(restored,portable);assert.deepEqual((await restored.get('/api/coffer/appeals/'+blanks.id)).mergeReview,blankDetail.mergeReview);assert.equal((await restored.get('/api/coffer/provider-fields')).provider,null,'Restore never reconnects a provider or shares fields');await restored.command('donor.erase',{donorId:avery.id,confirm:'ERASE'});const redacted=(await restored.get('/api/coffer/appeals/'+merged.id)).recipients.find(r=>r.name==='Erased donor');assert.ok(redacted);for(const key of ['merge_fields','merge_blanks','rendered_subject','rendered_body','email_contact_id','email_contact_version'])assert.equal(redacted[key],null)}finally{await restored.close()}
  if(process.env.COFFER_PROVIDER_FIELDS_BROWSER){await appealMergeBrowser(h,blanks.id)}
  async function appealMergeBrowser(h,blankId){const directory=process.env.COFFER_PROVIDER_FIELDS_BROWSER;const {withBrowserWorker}=await import('./browser-worker.mjs');await withBrowserWorker(h,async(context,origin)=>{const page=await context.newPage();for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/appeals');const editor=page.locator('form').filter({has:page.locator('input[name=command][value="appeal.prepare"]')});await editor.getByLabel('Appeal name',{exact:true}).fill('Synthetic merge draft');await editor.locator('textarea[name=body]').fill('Board: ');await editor.locator('select[name=fieldKey]').selectOption('custom.profile_interest');await editor.locator('select[name=fieldTarget]').selectOption('body');await editor.getByRole('button',{name:'Insert merge field',exact:true}).click();await page.getByRole('heading',{name:'Appeal draft',exact:true}).waitFor();assert.equal(await page.locator('textarea[name=body]').inputValue(),'Board: {{custom.profile_interest}}');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:directory+'/RCPT-010-appeal-insert-'+width+'.png',fullPage:true});await page.goto(origin+'/app/appeals/'+blankId);await page.getByRole('heading',{name:'Empty appeal fields',exact:true}).waitFor();await page.getByRole('heading',{name:'Prepared message',exact:true}).waitFor();const review=page.getByRole('heading',{name:'Empty appeal fields',exact:true}).locator('..');assert.ok((await review.innerText()).includes('Jordan Brooks'));assert.equal(await review.locator('code').count(),1);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:directory+'/RCPT-010-appeal-review-'+width+'.png',fullPage:true});await page.goto(origin+'/app/appeals/'+merged.id);await page.getByRole('heading',{name:'Finish in Mango',exact:true}).waitFor();const handoff=page.getByRole('heading',{name:'Finish in Mango',exact:true}).locator('..');assert.ok((await handoff.innerText()).includes('{{custom.profile_interest}}'));assert.ok((await handoff.innerText()).includes('Coffer has not verified'));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await handoff.screenshot({path:directory+'/RCPT-010-mango-handoff-'+width+'.png'})}await page.close()})}
  // DONOR-013: a run chooses a nonprimary work point and retains its identity.
  const workEmail='synthetic-coffer-1510@example.test',beforeWork=(await h.get('/api/coffer/donors/'+avery.id)).donor
  const work=await h.command('contact.save',{donorId:avery.id,donorVersion:beforeWork.version,kind:'email',type:'work',value:workEmail,source:'Synthetic documented work address'})
  contacts.set(workEmail,{id:'synthetic-coffer-1510',email:workEmail,emailStatus:'subscribed',fields:{external:'work-only'}})
  const selectedAppeal=()=>h.command('appeal.prepare',{name:'Synthetic work contact',channel:'email',emailType:'work',subject:'Hello {{formal_salutation}}',body:'Thank you for {{total_given}}.'})
  const chosen=await selectedAppeal(),chosenDetail=await h.get('/api/coffer/appeals/'+chosen.id)
  assert.equal(chosen.recipients,1,'A missing chosen type is excluded rather than falling back to a personal address')
  assert.equal(chosenDetail.recipients[0].email,workEmail);assert.equal(chosenDetail.recipients[0].email_contact_id,work.id);assert.equal(chosenDetail.recipients[0].email_contact_version,1)
  await h.command('appeal.approve',{appealId:chosen.id,version:1})
  assert.equal((await h.command('appeal.send',{appealId:chosen.id,version:2})).listed,1)
  assert.equal((await h.command('appeal.send',{appealId:chosen.id,version:2})).listed,0,'The same chosen contact is not handed off twice')
  let chosenMessage=(await h.get('/api/coffer/donors/'+avery.id)).communications.find(m=>m.source_id===chosen.id)
  assert.equal(chosenMessage.recipient_email,workEmail);assert.equal(chosenMessage.recipient_contact_id,work.id);assert.equal(chosenMessage.recipient_contact_version,1)
  assert.equal(contacts.get(workEmail).fields.email,workEmail);assert.equal(contacts.get(workEmail).fields.external,'work-only')
  assert.equal((await h.get('/api/coffer/donors/'+avery.id)).donor.email,recorded.contacts[0].email,'Run selection never changes the primary')
  const staleContact=await selectedAppeal()
  await h.command('contact.save',{donorId:avery.id,donorVersion:(await h.get('/api/coffer/donors/'+avery.id)).donor.version,contactId:work.id,version:1,kind:'email',type:'work',value:workEmail,source:'Synthetic source correction'})
  await h.command('appeal.approve',{appealId:staleContact.id,version:1},{status:409})
  chosenMessage=(await h.get('/api/coffer/donors/'+avery.id)).communications.find(m=>m.source_id===chosen.id)
  assert.equal(chosenMessage.recipient_contact_version,1,'Historical submissions retain their exact original contact version')
  if(process.env.COFFER_PROVIDER_FIELDS_BROWSER){await providerFieldsBrowser(h,selection.version+1);await appealContactBrowser(h)}
  async function appealContactBrowser(h){const directory=process.env.COFFER_PROVIDER_FIELDS_BROWSER;const {withBrowserWorker}=await import('./browser-worker.mjs');await withBrowserWorker(h,async(context,origin)=>{const page=await context.newPage();for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/appeals');const editor=page.locator('form').filter({has:page.locator('input[name=command][value="appeal.prepare"]')});await editor.getByLabel('Appeal name',{exact:true}).fill('Synthetic work email '+width);await editor.locator('select[name=emailType]').selectOption('work');await editor.getByRole('button',{name:'Prepare audience',exact:true}).click();await page.waitForURL('**/app/appeals/**');assert.ok((await page.locator('main').innerText()).includes(workEmail));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:directory+'/DONOR-013-appeal-contact-'+width+'.png',fullPage:true})}await page.close()})}

  async function providerFieldsBrowser(h,expectedVersion){const directory=process.env.COFFER_PROVIDER_FIELDS_BROWSER;const {mkdir}=await import('node:fs/promises');const {withBrowserWorker}=await import('./browser-worker.mjs');await mkdir(directory,{recursive:true});await withBrowserWorker(h,async(context,origin)=>{const page=await context.newPage();for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/appeals/connect');const panel=page.locator('#provider-merge-fields');await panel.locator('select[name=fieldKey]').selectOption('custom.profile_interest');await panel.getByRole('button',{name:'Insert merge field',exact:true}).click();await page.getByRole('heading',{name:'Shared field draft',exact:true}).waitFor();assert.match(await page.locator('textarea[name=fields]').inputValue(),/custom\.profile_interest/);assert.equal((await h.get('/api/coffer/provider-fields')).version,expectedVersion,'Insertion only drafts');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:directory+'/RCPT-010-provider-fields-'+width+'.png',fullPage:true})}await page.close()})}
  const workRace=await selectedAppeal();await h.command('appeal.approve',{appealId:workRace.id,version:1});unsubscribeChosenOnPut=true
  assert.equal((await h.command('appeal.send',{appealId:workRace.id,version:2})).suppressed,1)
  assert.equal((await h.get('/api/coffer/donors/'+avery.id)).current.email.status,'withdrawn','A concurrent opt-out on the chosen work point withdraws this person, not a different primary-address lookup')
  // A Mango unsubscribe becomes a Coffer withdrawal; a Coffer withdrawal becomes a Mango suppression.
  contacts.get(recorded.contacts[0].email).emailStatus='unsubscribed'
  await h.command('marketing.sync')
  assert.equal((await h.get(`/api/coffer/donors/${avery.id}`)).current.email.status,'withdrawn')
  await h.command('consent.record',{donorIds:[jordan.id],channel:'email',status:'withdrawn',method:'email reply',evidence:'Synthetic donor asked to stop',capturedOn:'2025-03-04'})
  assert.deepEqual(suppressions.map(s=>s.email),[recorded.contacts[1].email])
  assert.equal((await h.get(`/api/coffer/donors/${jordan.id}`)).marketingPreference.state,'suppressed')
  const providerAnswer=contacts.get(recorded.contacts[0].email);providerAnswer.segmentIds=['synthetic-coffer-9203'];providerAnswer.fields={...providerAnswer.fields,cofferFrequency:'quarterly'}
  await h.command('marketing.topicMapping',{provider:'mango',newsletterId:'synthetic-coffer-9203',appealsId:'synthetic-coffer-9204',frequencyField:'cofferFrequency',confirm:'yes'})
  await h.command('marketing.sync')
  const importedPreference=(await h.get('/api/coffer/donors/'+avery.id+'/preferences')).channels.find(p=>p.channel==='email')
  assert.ok(importedPreference.topics.includes('newsletter'));assert.ok(!importedPreference.topics.includes('appeals'));assert.equal(importedPreference.frequency,'quarterly')
  assert.equal((await h.get('/api/coffer/donors/'+avery.id+'/preferences')).history.at(-1).source,'mango')
  await h.command('marketing.topicMapping',{provider:'mango',confirm:'yes'})
 },{outbound:async request=>{
  const u=new URL(request.url)
  assert.equal(u.origin,'https://mango.example.test')
  assert.ok(u.pathname.startsWith('/api/integrations/v1/'),u.pathname)
  if(request.headers.get('authorization')!==`Bearer ${credential}`)return Response.json({error:'invalid_credential'},{status:401})
  const path=u.pathname.slice('/api/integrations/v1'.length),body=request.method==='GET'?null:await request.json()
  if(path==='/segments')return Response.json({segments:[...lists.keys()].map(name=>({id:name,name}))})
  if(path==='/events')return Response.json({events:[],nextCursor:'0'})
  if(path.endsWith('/send'))return Response.json({error:'invalid_request'},{status:400})
  if(path==='/contacts'&&request.method==='PUT'){
   if(!body.email)return Response.json({error:'invalid_request'},{status:400})
   assert.equal(body.subscribe,true);assert.match(body.consent.evidence,/Synthetic explicit opt-in/)
   const fixture=recorded.contacts.find(c=>c.email===body.email),contact=contacts.get(body.email)??{...fixture,emailStatus:'subscribed'}
   if(unsubscribeChosenOnPut){contact.emailStatus='unsubscribed';unsubscribeChosenOnPut=false}
   contact.fields=body.fields;contacts.set(body.email,contact)
   if(!lists.has(body.segmentName))lists.set(body.segmentName,new Set())
   lists.get(body.segmentName).add(body.email)
   return Response.json({contact:{...contact,segmentIds:[body.segmentName]}})
  }
  if(path==='/contacts')return Response.json({contacts:[...contacts.values()].filter(c=>c.email===u.searchParams.get('email')),nextCursor:''})
  if(path==='/suppressions'){suppressions.push(body);contacts.set(body.email,{...(contacts.get(body.email)??{email:body.email}),emailStatus:'suppressed'});return Response.json({ok:true})}
  assert.fail(`Unexpected Mango request ${request.method} ${path}`)
 }})
})

// Documentation-derived Mailchimp responses at the network edge (no Mailchimp account was available).
test('COMM-008: email appeal results match signed ledger and sender outcomes with tracking off',()=>{
 // A synthetic key: its -us21 suffix only picks the faked datacenter host.
 const calls=[],apiKey=[`coffer${process.pid}`,'us21'].join('-')
 return run(async h=>{
  await consenting(h,['Avery Chen'])
  const frozen=await appeal(h)
  const code=frozen.code
  assert.match(code,/^RUN-/)
  const d=(await h.get('/api/coffer/donors')).donors[0]
  await h.command('gift.record',{donorId:d.id,amount:'100',receivedOn:'2026-09-01',method:'check',goods:'none',fund:'Library',appeal:code})
  const refund=await h.command('gift.record',{donorId:d.id,amount:'20',receivedOn:'2026-09-01',method:'check',goods:'none',fund:'Library',appeal:code})
  await h.command('gift.reverse',{giftId:refund.id,reason:'Returned check'})
  const saved=await form(h,{command:'marketing.connectMailchimp',apiKey});assert.equal(saved.status,303,(await saved.text()).match(/role="alert">[^<]*/)?.[0])
  const picker=await (await h.request('/app/appeals/connect')).text()
  assert.match(picker,/Fixture audience \(1 contacts\)/)
  assert.equal((await form(h,{command:'marketing.chooseAudience',listId:'fixture-list',fromName:'Fixture organisation',fromEmail:'replies@example.test'})).status,303)
  const sent=await h.command('appeal.send',{appealId:frozen.id,version:2})
  assert.equal(sent.submitted,1)
  assert.ok(calls.includes('POST /3.0/campaigns/fixture-campaign/actions/send'))
  await h.command('marketing.refresh')
  const detail=await h.get(`/api/coffer/appeals/${frozen.id}`)
  assert.equal(detail.messages[0].remote_status,'sent')
  assert.deepEqual([detail.results.recipients,detail.results.responded,detail.results.gifts,detail.results.dollarsCents,detail.results.averageGiftCents,detail.results.costCents,detail.results.returnCents],[1,1,1,10000,10000,0,10000])
  assert.deepEqual([detail.results.delivered,detail.results.deliveryUnknown,detail.results.opened,detail.results.clicked,detail.results.returnRatio],[0,1,null,null,null])
  assert.equal(detail.results.responseRate,1)
  const empty=await h.get('/api/coffer/appeals/'+frozen.id)
  assert.equal(empty.results.code,code)
  await prepareVerifiedMail(h)
  const mail=await h.command('appeal.prepare',{name:'COMM-008 postal appeal',channel:'mail',cost:'25.50'})
  assert.notEqual(mail.code,code)
  const zero=(await h.get('/api/coffer/appeals/'+mail.id)).results
  assert.deepEqual([zero.responded,zero.gifts,zero.dollarsCents,zero.averageGiftCents,zero.returnCents],[0,0,0,null,-2550])
  await h.command('appeal.approve',{appealId:mail.id,version:1})
  await h.command('appeal.export',{appealId:mail.id,version:2})
  const exported=new Intl.DateTimeFormat('en-CA',{timeZone:(await h.get('/api/coffer/settings')).timezone}).format(new Date((await h.get('/api/coffer/appeals/'+mail.id)).appeal.exported_at))
  await h.command('appeal.markSent',{appealId:mail.id,version:3,sentOn:exported})
  await h.command('gift.record',{donorId:d.id,amount:'60.01',allocations:[{fund:'Library',amountCents:3000},{fund:'Meals',amountCents:3001}],receivedOn:'2026-09-01',method:'check',goods:'none',appeal:mail.code})
  await h.command('gift.record',{donorId:d.id,amount:'40',receivedOn:'2026-09-01',method:'check',goods:'none',fund:'Library',appeal:mail.code})
  const results=(await h.get('/api/coffer/appeals/'+mail.id)).results
  assert.deepEqual([results.recipients,results.responded,results.gifts,results.dollarsCents,results.averageGiftCents,results.costCents,results.returnCents],[1,1,2,10001,5001,2550,7451])
  assert.equal(results.returnRatio,7451/2550)
  assert.deepEqual([results.delivered,results.deliveryUnknown,results.opened,results.clicked],[null,1,null,null])
  assert.equal(results.comparison.find(r=>r.id===frozen.id).dollarsCents,10000)
  await prepareVerifiedMail(h)
  await h.command('appeal.prepare',{name:'Invalid cost',channel:'mail',cost:'0.001'},{status:400})
  const lines=await archive(h),fresh=await installation()
  try{
   await restore(fresh,lines)
   assert.deepEqual((await fresh.get('/api/coffer/appeals/'+mail.id)).results,results,'COMM-008 code, cost, signed ledger and comparison survive public archive/restore')
  }finally{await fresh.close()}
  // A valid portable fixture with an unbound historical run, as produced before
  // this additive feature. No SQL or private domain function is used.
  const {makePart,ArchiveVerifier,ContentVerifier}=await import('@runeditrun/rer/modules/portability/format')
  const manifest=structuredClone(lines[0])
  const items=lines.filter(r=>r.kind==='part').flatMap(p=>p.items).filter(i=>!(i.kind==='row'&&i.table==='cf_appeal_runs'&&i.row.appeal_id===frozen.id))
  const counts=new Map()
  for(const item of items)if(item.kind==='row'){const index=counts.get(item.table)??0;item.index=index;counts.set(item.table,index+1)}
  for(const table of manifest.tables)table.count=counts.get(table.name)??0
  const parts=[]
  for(let i=0;i<items.length;i+=200)parts.push(await makePart(parts.length,items.slice(i,i+200)))
  manifest.partCount=parts.length
  const integrity=new ArchiveVerifier(manifest),content=new ContentVerifier(manifest)
  for(const part of parts){integrity.add(part);for(const item of part.items)content.add(item)}
  const historical=await installation()
  try{
   await restore(historical,[manifest,...parts,{kind:'closing',partCount:parts.length,archiveHash:integrity.digest(),contentHash:content.digest()}])
   const legacy=(await historical.get('/api/coffer/appeals/'+frozen.id)).results
   assert.equal(legacy.bound,false);assert.equal(legacy.code,null);assert.match(legacy.note,/Historical run/)
   assert.match(await (await historical.request('/app/appeals/'+frozen.id)).text(),/no response code binding/)
  }finally{await historical.close()}
  if(process.env.COFFER_PROOF_DIR){
   const {withBrowserWorker}=await import('./browser-worker.mjs')
   const {mkdir}=await import('node:fs/promises')
   await mkdir(process.env.COFFER_PROOF_DIR,{recursive:true})
   await withBrowserWorker(h,async(context,origin)=>{
    const page=await context.newPage()
    for(const width of [1440,390]){
     await page.setViewportSize({width,height:1000})
     for(const id of [frozen.id,mail.id]){
      await page.goto(origin+'/app/appeals/'+id)
      await page.getByText('Results',{exact:true}).waitFor()
      assert.match(await page.locator('body').innerText(),/Unknown is not zero/)
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
      await page.screenshot({path:process.env.COFFER_PROOF_DIR+'/COMM-008-'+(id===mail.id?'mail':'email')+'-'+width+'.png',fullPage:true})
     }
     await page.goto(origin+'/app/appeals')
     await page.getByLabel('Appeal cost (USD, optional)').fill('12.50')
     await page.getByLabel('Appeal name',{exact:true}).fill('COMM-008 browser '+width)
     await page.screenshot({path:process.env.COFFER_PROOF_DIR+'/COMM-008-form-'+width+'.png',fullPage:true})
     await prepareVerifiedMail(h)
     await page.getByRole('button',{name:'Prepare audience',exact:true}).click()
     await page.getByText('Results',{exact:true}).waitFor()
     assert.match(await page.locator('body').innerText(),/12.50/)
     await page.screenshot({path:process.env.COFFER_PROOF_DIR+'/COMM-008-prepare-'+width+'.png',fullPage:true})
    }
   })
  }
 },{verifiedMail:true,outbound:async request=>{
  const u=new URL(request.url),key=`${request.method} ${u.pathname}`;calls.push(key)
  assert.equal(u.origin,'https://us21.api.mailchimp.com')
  assert.equal(request.headers.get('authorization'),`Bearer ${apiKey}`)
  if(key==='GET /3.0/lists')return Response.json({lists:[{id:'fixture-list',name:'Fixture audience',stats:{member_count:1}}]})
  if(key==='GET /3.0/lists/fixture-list/merge-fields')return Response.json({merge_fields:['CF_INFORM','CF_FORMAL','CF_ENVELOP','CF_PREFIX','CF_FIRST','CF_MIDDLE','CF_LAST','CF_SUFFIX','CF_NICK'].map(tag=>({tag,type:'text'})),total_items:9})
  if(/^PATCH \/3.0\/lists\/fixture-list\/members\//.test(key))return Response.json({...chimp.member_subscribed,merge_fields:(await request.json()).merge_fields})
  if(/^GET \/3.0\/lists\/fixture-list\/members\//.test(key))return Response.json(chimp.member_subscribed)
  if(key==='POST /3.0/lists/fixture-list/segments')return Response.json(chimp.static_segment)
  if(key==='GET /3.0/lists/fixture-list/segments/101/members')return Response.json(chimp.segment_members)
  if(key==='POST /3.0/campaigns'){assert.deepEqual((await request.json()).tracking,{opens:false,html_clicks:false,text_clicks:false});return Response.json(chimp.campaign_saved)}
  if(key==='GET /3.0/campaigns/fixture-campaign')return Response.json(calls.includes('POST /3.0/campaigns/fixture-campaign/actions/send')?chimp.campaign_sent:chimp.campaign_saved)
  if(key==='PATCH /3.0/campaigns/fixture-campaign')return Response.json(chimp.campaign_saved)
  if(key==='PUT /3.0/campaigns/fixture-campaign/content')return Response.json(chimp.content_saved)
  if(key==='POST /3.0/campaigns/fixture-campaign/actions/send')return new Response(null,{status:204})
  if(key==='GET /3.0/reports/fixture-campaign/sent-to')return Response.json(chimp.sent_to)
  assert.fail(`Unexpected Mailchimp request ${key}`)
 }})
})

test('RCPT-010: welcome fields share the receipt catalog, hold missing recipients before handoff and resume with literal custom values',async()=>{
 const contacts=new Map(),handoffs=[]
 await run(async h=>{
  await reviewed(h)
  await h.command('marketing.connectMango',{origin:'https://mango.example.test',credential:'synthetic-coffer-1101'})
  await h.command('custom.define',{key:'board_note',label:'Board note',kind:'constituent',type:'text'})
  await h.command('custom.define',{key:'gift_note',label:'Gift note',kind:'gift',type:'text'})
  const catalog=await h.get('/api/coffer/template-fields'),welcome=catalog.messages.find(m=>m.kind==='welcome')
  for(const key of ['custom.board_note','custom.gift_note','email','postal_address','first_gift_amount','campaign'])assert.ok(welcome.fields.includes(key))
  const input={thankSubject:'Thanks {{formal_salutation}} {{custom.board_note}}',thankBody:'{{donor_name}} · {{amount}} · {{custom.gift_note|thanks}} · {{postal_address}} · {{total_given}} · {{custom.board_note}}',impactSubject:'Impact',impactBody:'{{custom.gift_note|Your support}} helped.',askSubject:'Next gift',askBody:'Please give again.',impactDays:7,askDays:21}
  await h.command('welcome.publish',{...input,thankBody:'{{unknown|fallback}}'},{status:400})
  await h.command('welcome.publish',{...input,thankBody:'{{custom.board_note|{{donor_name}}}}'},{status:400})
  const directory=process.env.COFFER_WELCOME_MERGE_BROWSER
  if(directory){const {mkdir}=await import('node:fs/promises');const {withBrowserWorker}=await import('./browser-worker.mjs');await mkdir(directory,{recursive:true});await withBrowserWorker(h,async(context,origin)=>{const page=await context.newPage();for(const width of [1440,390]){
   await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/appeals');const editor=page.locator('form').filter({has:page.locator('input[name=command][value="welcome.publish"]')});await editor.locator('textarea[name=thankBody]').fill('Board: ');await editor.locator('select[name=fieldKey]').selectOption('custom.board_note');await editor.locator('select[name=fieldTarget]').selectOption('thankBody');await editor.getByRole('button',{name:'Insert merge field',exact:true}).click();await page.getByRole('heading',{name:'Welcome template draft',exact:true}).waitFor();assert.equal(await page.locator('textarea[name=thankBody]').inputValue(),'Board: {{custom.board_note}}');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:directory+'/RCPT-010-welcome-insert-'+width+'.png',fullPage:true})}await page.close()})}
  await h.command('welcome.publish',input,{headers:{'x-test-now':'2026-01-01T12:00:00Z'}})
  const d=await donor(h,'Synthetic Welcome Recipient',{email:'synthetic-coffer-1102@example.test',addressLine1:null,city:null,region:null,postalCode:null},{headers:{'x-test-now':'2026-01-02T11:00:00Z'}})
  await h.command('consent.record',{donorId:d.id,channel:'email',status:'granted',method:'paper form',evidence:'synthetic-coffer-1103',capturedOn:'2026-01-02'})
  await h.command('gift.record',{donorId:d.id,amount:'25',receivedOn:'2026-01-02',method:'check',goods:'none'},{headers:{'x-test-now':'2026-01-02T12:00:00Z'}})
  const handoffsBefore=handoffs.filter(x=>x.segmentName.startsWith('Coffer welcome')).length
  const held=await h.command('welcome.run',{}, {headers:{'x-test-now':'2026-01-02T12:01:00Z'}})
  assert.equal(held.submitted,0);assert.deepEqual(held.held.map(r=>({donorId:r.donorId,fields:r.fields})),[{donorId:d.id,fields:['custom.board_note','postal_address']}])
  assert.equal(handoffs.filter(x=>x.segmentName.startsWith('Coffer welcome')).length,handoffsBefore)
  let state=await h.get('/api/coffer/welcome');assert.equal(state.enrollments[0].steps.find(s=>s.step==='thank').status,'pending');assert.equal(state.mergeReview[0].donorId,d.id)
  assert.equal((await h.get('/api/coffer/donors/'+d.id)).communications.length,0,'No blank message was claimed or exposed to a provider')
  if(directory){const {withBrowserWorker}=await import('./browser-worker.mjs');await withBrowserWorker(h,async(context,origin)=>{const page=await context.newPage();for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/appeals');await page.getByRole('heading',{name:'Empty welcome fields',exact:true}).waitFor();assert.ok((await page.locator('main').innerText()).includes('{{custom.board_note}}'));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:directory+'/RCPT-010-welcome-held-'+width+'.png',fullPage:true})}await page.close()})}
  await h.command('custom.set',{key:'board_note',recordId:d.id,value:'Board {{not_a_field}}',source:'synthetic-coffer-1104'})
  const current=(await h.get('/api/coffer/donors/'+d.id)).donor
  await h.command('donor.update',{donorId:d.id,version:current.version,name:current.name,email:current.email,addressLine1:'12 Reading Road',city:'Springfield',region:'IL',postalCode:'62701'})
  const missingContact=await h.command('welcome.run',{emailType:'work'}, {headers:{'x-test-now':'2026-01-02T12:01:30Z'}})
  assert.equal(missingContact.submitted,0);assert.deepEqual(missingContact.held[0].fields,['email'],'A missing chosen contact holds before any submission claim')
  const work=await h.command('contact.save',{donorId:d.id,donorVersion:(await h.get('/api/coffer/donors/'+d.id)).donor.version,kind:'email',type:'work',value:'synthetic-coffer-1110@example.test',source:'Synthetic explicit work address'})
  const resumed=await h.command('welcome.run',{emailType:'work'}, {headers:{'x-test-now':'2026-01-02T12:02:00Z'}})
  assert.equal(resumed.submitted,1);assert.deepEqual(resumed.held,[])
  const communication=(await h.get('/api/coffer/donors/'+d.id)).communications[0]
  assert.equal(communication.recipient_email,'synthetic-coffer-1110@example.test');assert.equal(communication.recipient_contact_id,work.id);assert.equal(communication.recipient_contact_version,1)
  assert.equal((await h.get('/api/coffer/donors/'+d.id)).donor.email,'synthetic-coffer-1102@example.test','Welcome run selection leaves the primary unchanged')
  assert.equal(communication.status,'listed');assert.match(communication.subject,/Board \{\{not_a_field\}\}/,'Stored values are literal text, never a second template')
  assert.match(communication.body,/\$25\.00 · thanks · 12 Reading Road\nSpringfield\nIL\n62701\nUnited States · \$25\.00 · Board \{\{not_a_field\}\}/)
  assert.equal((await h.get('/api/coffer/welcome')).mergeReview.length,0)
  assert.equal((await h.command('welcome.run',{}, {headers:{'x-test-now':'2026-01-02T12:03:00Z'}})).submitted,0,'The resumed step is handed off once')
  if(directory){await welcomeContactBrowser(h)}
  async function welcomeContactBrowser(h){const {withBrowserWorker}=await import('./browser-worker.mjs');await withBrowserWorker(h,async(context,origin)=>{await context.setExtraHTTPHeaders({'x-test-now':'2026-01-02T12:03:00Z'});const page=await context.newPage();for(const width of [1440,390]){await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/appeals');const editor=page.locator('form').filter({has:page.locator('input[name=command][value="welcome.run"]')});await editor.locator('select[name=emailType]').selectOption('work');const prior=handoffs.length;await editor.getByRole('button',{name:'Run due welcome steps',exact:true}).click();await page.waitForURL('**/app/appeals');assert.equal(handoffs.length,prior,'The native chosen-contact run never repeats a completed step');assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:directory+'/DONOR-013-welcome-contact-'+width+'.png',fullPage:true})}await page.close()})}
  await h.command('donor.erase',{donorId:d.id,confirm:'ERASE'});assert.doesNotMatch(JSON.stringify(await archive(h)),/Board \{\{not_a_field\}\}|12 Reading Road/)
 },{entry:'tests/engagement-worker.ts',outbound:async request=>{
  const u=new URL(request.url);assert.equal(u.origin,'https://mango.example.test');const path=u.pathname.replace('/api/integrations/v1',''),body=request.method==='GET'?null:await request.json()
  if(path==='/segments')return Response.json({segments:[]})
  if(path==='/events')return Response.json({events:[],nextCursor:0})
  if(path.endsWith('/send'))return Response.json({error:'invalid'},{status:400})
  if(path==='/contacts'&&request.method==='PUT'){if(!body.email)return Response.json({error:'invalid'},{status:400});handoffs.push(body);const contact={id:'synthetic-coffer-1105',email:body.email,emailStatus:'subscribed',segmentIds:['synthetic-coffer-1106']};contacts.set(body.email,contact);return Response.json({contact})}
  if(path==='/contacts')return Response.json({contacts:contacts.has(u.searchParams.get('email'))?[contacts.get(u.searchParams.get('email'))]:[]})
  assert.fail(request.method+' '+path)
 }})
})

test('REPORT-005: saved selections send current weekly and monthly report attachments once to explicitly approved recipients',async()=>{
 const {reportSchedulesJourney}=await import('./report-schedules-journey.mjs')
 await reportSchedulesJourney()
})


test('STEW-003: published journeys enroll live giving cohorts and hold shared-frequency work with current consent and custody',async()=>{
 const {stewardshipJourneys}=await import('./stewardship-journeys.mjs')
 await stewardshipJourneys()
})


test('STEW-003: the minute scheduler advances published welcome steps once and stops a repeat giver',async()=>{
 const {welcomeClockJourney}=await import('./journey-actions.mjs')
 await welcomeClockJourney()
})

test('STEW-003: reply branches create owned tasks once, waits send nothing, and list custody requires explicit resume',async()=>{
 const {journeyActions}=await import('./journey-actions.mjs')
 await journeyActions()
})

test('STEW-003: shared welcome caps retain uncertain claims and merged donor custody without automatic retry',async()=>{
 const {journeyCapCustody}=await import('./journey-custody.mjs')
 await journeyCapCustody()
})

test('STEW-003: an anniversary enrolls on the calendar day and its later steps remain active',async()=>{
 const {anniversaryJourney}=await import('./journey-custody.mjs')
 await anniversaryJourney()
})
