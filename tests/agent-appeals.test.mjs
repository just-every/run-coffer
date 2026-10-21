import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {randomUUID} from 'node:crypto'
import {run,donor,archive,restore,installation} from './harness.mjs'
import {recognitionEdges,form} from './recognition-edge.mjs'
const fixture=JSON.parse(await readFile(new URL('./fixtures/mailchimp/responses.json',import.meta.url),'utf8'))

test('DONOR-014 / DEV-009: reconcile five dropped appeal recipients against the frozen audience and signed gifts, then prepare a human-approved resend',async()=>{
 const segments=new Map(),campaigns=new Map(),contacts=new Map();let sends=0,resultMode='normal'
 const giving=recognitionEdges(),mangoContacts=new Map(),mangoLists=[]
 await run(async h=>{
  const day=new Intl.DateTimeFormat('en-CA',{timeZone:(await h.get('/api/coffer/settings')).timezone}).format(new Date())
  const donors=[]
  for(const name of ['Avery Chen','Bill Carter','Cora Diaz','Dalia Evans','Eli Fox','Farah Green','Grace Hill']){
   const d=await donor(h,name);donors.push(d)
   await h.command('consent.record',{donorIds:[d.id],channel:'email',status:'granted',method:'paper form',evidence:'Synthetic written permission',capturedOn:'2026-01-01'})
  }
  await h.command('marketing.connectMailchimp',{apiKey:['syntheticedge','us21'].join('-')})
  await h.command('marketing.chooseAudience',{listId:'fixture-list',fromName:'Riverbend Food Bank',fromEmail:'replies@example.test'})
  const frozen=await h.command('appeal.prepare',{name:'Autumn pantry appeal',channel:'email',subject:'Thank you {{donor_name}}',body:'Your {{gift_count}} gifts total {{total_given}}.'})
  await h.command('appeal.approve',{appealId:frozen.id,version:1})
  await h.command('appeal.send',{appealId:frozen.id,version:2})
  assert.equal(sends,7,JSON.stringify((await h.get('/api/coffer/appeals/'+frozen.id)).messages.map(m=>({status:m.status,note:m.note}))))
  const gift=await h.command('gift.record',{donorId:donors[5].id,amount:'125.25',receivedOn:'2026-09-01',method:'check',fund:'Food',goods:'none',appeal:frozen.code})
  const returned=await h.command('gift.record',{donorId:donors[6].id,amount:'25',receivedOn:'2026-09-01',method:'cash',fund:'Food',goods:'none',appeal:frozen.code})
  await h.command('gift.reverse',{giftId:returned.id,reason:'Returned in full'})
  // A changed contact email must not turn an old handoff into a dropped send.
  const original=(await h.get(`/api/coffer/donors/${donors[6].id}`)).donor
  await h.command('donor.update',{donorId:original.id,version:original.version,name:original.name,email:'grace.changed@example.org'})
  let result=await h.api('/api/coffer/agent/appeals/run',{appealId:frozen.id})
  assert.equal(result.checked,7);assert.equal(result.reconciled,true);assert.equal(result.deliveryComplete,false)
  assert.equal(result.flagged,5)
  assert.deepEqual(result.rows.filter(r=>r.flagged).map(r=>r.donorId).sort(),donors.slice(0,5).map(d=>d.id).sort())
  assert.deepEqual(result.rows.slice(0,5).map(r=>r.state),['not sent','not sent','not sent','not sent','bounced'])
  assert.ok(result.rows.slice(5).every(r=>r.state==='sent'))
  assert.deepEqual([result.results.gifts,result.results.dollarsCents,result.results.responded],[1,12525,1])
  const prepared=await h.api('/api/coffer/agent/appeals/prepare',{appealId:frozen.id})
  const detail=await h.get('/api/coffer/appeals/'+prepared.id)
  assert.equal(detail.appeal.status,'prepared');assert.equal(detail.approval,null)
  assert.equal(detail.appeal.prepared_by_role,'agent')
  assert.deepEqual(detail.recipients.map(r=>r.donor_id).sort(),donors.slice(0,5).map(d=>d.id).sort())
  assert.deepEqual([detail.message.subject,detail.message.body],['Thank you {{donor_name}}','Your {{gift_count}} gifts total {{total_given}}.'])
  assert.equal((await h.api('/api/coffer/agent/appeals/prepare',{appealId:frozen.id})).id,prepared.id)
  await h.command('appeal.send',{appealId:prepared.id,version:1},{status:409})
  assert.equal(sends,7,'Preparing and an unapproved send never contact donors')
  const member=await h.person('helper@example.test')
  await h.api('/api/coffer/agent/appeals/run',{appealId:frozen.id},{as:member.cookie,status:403})
  await h.api('/api/coffer/agent/appeals/prepare',{appealId:frozen.id},{as:'',status:401})
  if(process.env.COFFER_APPEAL_AGENT_BROWSER){
   const {appealAgentBrowser}=await import('./agent-appeals-browser.mjs')
   await appealAgentBrowser(h,frozen,prepared,process.env.COFFER_APPEAL_AGENT_BROWSER)
  }else await h.command('appeal.approve',{appealId:prepared.id,version:1})
  await h.command('appeal.send',{appealId:prepared.id,version:2})
  assert.equal(sends,12)
  assert.equal((await h.get('/api/coffer/appeals/'+prepared.id)).approval.prepared_by_role,'agent')
  assert.equal((await h.get('/api/coffer/appeals/'+frozen.id)).messages.length,7,'Original submission history is retained')
  assert.equal((await h.get('/api/coffer/donors/'+donors[5].id)).gifts.find(g=>g.id===gift.id).amount_cents,12525)
  // A new audience has no sender records: absence remains visible from the audience side.
  const unsent=await h.command('appeal.prepare',{name:'Not submitted yet',channel:'email',subject:'Hello',body:'Hello {{donor_name}}'})
  await h.command('appeal.approve',{appealId:unsent.id,version:1})
  result=await h.api('/api/coffer/agent/appeals/run',{appealId:unsent.id})
  assert.equal(result.flagged,7);assert.ok(result.rows.every(r=>r.state==='unknown'))
  assert.ok(result.rows.every(r=>!r.resend),'Missing submissions continue through the original approved send, never a parallel resend')
  await h.api('/api/coffer/agent/appeals/prepare',{appealId:unsent.id},{status:409})
  await h.command('appeal.send',{appealId:unsent.id,version:2})
  resultMode='mismatch'
  result=await h.api('/api/coffer/agent/appeals/run',{appealId:unsent.id})
  assert.ok(result.rows.every(r=>r.flagged&&!r.resend&&r.state==='unknown'))
  await h.api('/api/coffer/agent/appeals/prepare',{appealId:unsent.id},{status:409})
  resultMode='dropped'
  await h.api('/api/coffer/agent/appeals/run',{appealId:unsent.id})
  await h.command('consent.record',{donorIds:[donors[0].id],channel:'email',status:'withdrawn',method:'email reply',evidence:'Synthetic withdrawal',capturedOn:'2026-09-02'})
  const subset=await h.api('/api/coffer/agent/appeals/prepare',{appealId:unsent.id})
  assert.equal((await h.get('/api/coffer/appeals/'+subset.id)).recipients.length,6,'New resend excludes current opt-outs')
  // DEV-009 native journey: real published steps and provider calls, no seeded database rows.
  await h.api('/api/coffer/giving/campaigns',{name:'Journey giving',slug:'journey-giving',description:'A synthetic campaign.',fund:'Food',goal:'1000'})
  const welcomeInput={thankSubject:'Thank you {{informal_salutation}}',thankBody:'{{prefix}} {{first_name}} {{middle_name}} {{last_name}} {{suffix}} {{nickname}} | {{formal_salutation}} | {{envelope_name}}\n\nGive: /give/journey-giving?from=welcome\nOther: https://elsewhere.example.test/give/journey-giving',impactSubject:'Pantry impact',impactBody:'Meals delivered.',askSubject:'Next gift',askBody:'Help again: /give/journey-giving',impactDays:7,askDays:21}
  const firstPublication=await h.command('welcome.publish',welcomeInput)
  const firstState=await h.get('/api/coffer/welcome')
  const publication=await h.command('welcome.publish',{...welcomeInput,publishedAt:firstState.journey.published_at,publicationId:firstPublication.publicationId})
  const codes=[...firstPublication.steps,...publication.steps].map(s=>s.code)
  assert.equal(new Set(codes).size,codes.length,'Every published step version has a distinct code')
  const thankCode=publication.steps.find(s=>s.step==='thank').code
  assert.deepEqual((await h.get('/api/coffer/welcome')).publications.map(v=>v.code),publication.steps.map(s=>s.code))
  await h.command('welcome.publish',{...welcomeInput,publishedAt:firstState.journey.published_at,publicationId:firstPublication.publicationId},{status:409})
  const journeyDonors=[]
  for(const name of ['Jules Ives','Kira Jones','Lane King','Mira Lake']){
   const d=await donor(h,name);journeyDonors.push(d)
   await h.command('donor.profile',{donorId:d.id,version:1,prefix:'Dr.',firstName:name.split(' ')[0],lastName:name.split(' ')[1],nickname:'Friend '+name.split(' ')[0],envelopeName:'Household '+name})
   await h.command('consent.record',{donorIds:[d.id],channel:'email',status:'granted',method:'paper form',evidence:'Synthetic journey permission',capturedOn:'2026-01-01'})
   await h.command('gift.record',{donorId:d.id,amount:'30',receivedOn:day,method:'cash',fund:'Food',goods:'none'})
  }
  assert.equal((await h.command('welcome.run')).submitted,4)
  for(const d of journeyDonors){
   const history=await h.get('/api/coffer/donors/'+d.id),m=history.communications.find(m=>m.source_kind==='welcome')
   assert.equal(m.subject,'Thank you Friend '+history.donor.first_name)
   assert.ok(m.body.includes('Dr. '+history.donor.last_name+' | Household '+history.donor.first_name+' '+history.donor.last_name));assert.ok(!m.body.includes('{{'))
   const link=new URL(m.body.match(/https?:\/\/[^\s]+\/give\/journey-giving\?[^\s]+/)[0])
   assert.equal(link.origin,h.origin);assert.equal(link.searchParams.get('appeal'),thankCode)
   assert.equal(link.searchParams.get('from'),'welcome')
   assert.ok(m.body.includes('https://elsewhere.example.test/give/journey-giving'))
   const acknowledgment=history.gifts.find(g=>g.kind==='gift').acknowledgment
   assert.equal(acknowledgment.status,'acknowledged');assert.equal(acknowledgment.method,'email');assert.equal(acknowledgment.communication_id,m.id)
  }
  const sentBefore=sends
  let journey=(await h.get('/api/coffer/agent/appeals')).journey
  assert.equal(journey.length,4)
  const stepFor=d=>journey.find(s=>s.donor_id===d.id)
  const droppedStep=stepFor(journeyDonors[0]),bouncedStep=stepFor(journeyDonors[1]),unknownStep=stepFor(journeyDonors[2]),handoffStep=stepFor(journeyDonors[3])
  await h.api('/api/coffer/agent/appeals/journey/prepare',{stepId:droppedStep.id},{status:409})
  for(const step of [droppedStep,bouncedStep,unknownStep,handoffStep])await h.api('/api/coffer/agent/appeals/journey/run',{stepId:step.id})
  journey=(await h.get('/api/coffer/agent/appeals')).journey
  assert.deepEqual(journeyDonors.map(d=>stepFor(d).state),['not sent','bounced','unknown','sent'])
  assert.ok(journey.every(s=>s.checked_at&&s.responses.bound&&s.responses.code===thankCode))
  for(const d of journeyDonors.slice(0,2))assert.equal((await h.get('/api/coffer/donors/'+d.id)).gifts.find(g=>g.kind==='gift').acknowledgment.status,'not acknowledged','A confirmed unsent result or bounce reopens acknowledgment')
  for(const step of [unknownStep,handoffStep])await h.api('/api/coffer/agent/appeals/journey/prepare',{stepId:step.id},{status:409})
  await h.api('/api/coffer/agent/appeals/journey/run',{stepId:'missing'},{status:409})
  await h.api('/api/coffer/agent/appeals/journey/prepare',{stepId:droppedStep.id},{as:member.cookie,status:403})
  await h.api('/api/coffer/agent/appeals/journey/run',{stepId:droppedStep.id},{as:'',status:401})
  // Entry and checkout use the same permanent code. Splits count once; reversals
  // reduce net dollars, and a same-day uncoded gift never becomes a response.
  await h.command('gift.record',{donorId:journeyDonors[0].id,amount:'41.25',receivedOn:day,method:'cash',allocations:[{fund:'Food',amountCents:2000},{fund:'General',amountCents:2125}],goods:'none',appeal:thankCode},{as:member.cookie})
  const reversed=await h.command('gift.record',{donorId:journeyDonors[0].id,amount:'5',receivedOn:day,method:'cash',fund:'Food',goods:'none',appeal:thankCode})
  await h.command('gift.reverse',{giftId:reversed.id,reason:'Synthetic correction'})
  await h.command('gift.record',{donorId:journeyDonors[2].id,amount:'7',receivedOn:day,method:'cash',fund:'Food',goods:'none'})
  await h.command('gift.record',{donorId:journeyDonors[3].id,amount:'3',receivedOn:day,method:'cash',fund:'Food',goods:'none',appeal:firstPublication.steps[0].code})
  const trackedPage=await (await h.request('/give/journey-giving?appeal='+thankCode,{as:''})).text()
  assert.ok(trackedPage.includes(`name="appeal" value="${thankCode}"`))
  const onlineDonor=(await h.get('/api/coffer/donors/'+journeyDonors[3].id)).donor
  const checkout=await h.request('/give/journey-giving/checkout',{...form({requestId:randomUUID(),frequency:'once',name:onlineDonor.name,email:onlineDonor.email,amount:'60.01',appeal:thankCode}),as:''})
  assert.equal(checkout.status,303,await checkout.text())
  const session=new URL(checkout.headers.get('location')).pathname.split('/').at(-1)
  assert.equal((await h.request('/giving/thanks?session_id='+session,{as:''})).status,200)
  journey=(await h.get('/api/coffer/agent/appeals')).journey
  assert.deepEqual([stepFor(journeyDonors[0]).responses.responded,stepFor(journeyDonors[0]).responses.gifts,stepFor(journeyDonors[0]).responses.dollarsCents],[2,2,10126])
  // The frozen submitted address is still checked after a donor edits their address.
  const jules=(await h.get('/api/coffer/donors/'+journeyDonors[0].id)).donor
  await h.command('donor.update',{donorId:jules.id,version:jules.version,name:jules.name,email:'jules.changed@example.org'})
  assert.equal((await h.api('/api/coffer/agent/appeals/journey/run',{stepId:droppedStep.id})).state,'not sent')
  let resend
  if(process.env.COFFER_APPEAL_AGENT_BROWSER){
   const {journeyResendBrowser}=await import('./agent-appeals-browser.mjs')
   resend=await journeyResendBrowser(h,droppedStep,process.env.COFFER_APPEAL_AGENT_BROWSER)
  }else resend=await h.api('/api/coffer/agent/appeals/journey/prepare',{stepId:droppedStep.id})
  const draft=await h.get('/api/coffer/appeals/'+resend.id)
  assert.equal(draft.appeal.status,'prepared');assert.equal(draft.approval,null)
  assert.equal(draft.appeal.prepared_by_role,'agent')
  assert.deepEqual(draft.recipients.map(r=>[r.donor_id,r.email]),[[jules.id,'jules.changed@example.org']])
  const savedMessage=(await h.get('/api/coffer/donors/'+jules.id)).communications.find(m=>m.source_kind==='welcome')
  assert.deepEqual([draft.message.subject,draft.message.body],[savedMessage.subject,savedMessage.body])
  assert.ok(draft.message.body.includes('appeal='+thankCode),'Resend preserves the original step’s tracked link')
  assert.equal((await h.api('/api/coffer/agent/appeals/journey/prepare',{stepId:droppedStep.id})).id,resend.id)
  await h.command('appeal.send',{appealId:resend.id,version:1},{status:409})
  assert.equal(sends,sentBefore,'Reconciliation and proposals send nothing')
  await h.command('consent.record',{donorIds:[journeyDonors[1].id],channel:'email',status:'withdrawn',method:'email reply',evidence:'Synthetic stop request',capturedOn:'2026-09-02'})
  await h.api('/api/coffer/agent/appeals/journey/prepare',{stepId:bouncedStep.id},{status:409})
  // The normal approval gate also refuses a permission withdrawn after preparation.
  await h.command('consent.record',{donorIds:[jules.id],channel:'email',status:'withdrawn',method:'email reply',evidence:'Synthetic stop after preparation',capturedOn:'2026-09-02'})
  await h.command('appeal.approve',{appealId:resend.id,version:1},{status:409})
  await h.command('appeal.discard',{appealId:resend.id,version:1})
  await h.command('consent.record',{donorIds:[jules.id],channel:'email',status:'granted',method:'paper form',evidence:'Synthetic renewed permission',capturedOn:'2026-09-03'})
  const renewed=await h.api('/api/coffer/agent/appeals/journey/prepare',{stepId:droppedStep.id})
  assert.notEqual(renewed.id,resend.id)
  await h.command('appeal.approve',{appealId:renewed.id,version:1})
  await h.command('appeal.send',{appealId:renewed.id,version:2})
  assert.equal(sends,sentBefore+1)
  const originalMessage=(await h.get('/api/coffer/donors/'+jules.id)).communications.find(m=>m.source_kind==='welcome')
  assert.equal(originalMessage.recipient_email,'jules.ives@example.org')
  assert.equal(originalMessage.remote_status,'not_sent')
  const resent=(await h.get('/api/coffer/appeals/'+renewed.id)).message
  const resendCode=new URL(resent.body.match(/https?:\/\/[^\s]+\/give\/journey-giving\?[^\s]+/)[0]).searchParams.get('appeal')
  assert.equal(resendCode,thankCode)
  await h.command('gift.record',{donorId:jules.id,amount:'11',receivedOn:day,method:'check',fund:'Food',goods:'none',appeal:resendCode})
  journey=(await h.get('/api/coffer/agent/appeals')).journey
  assert.deepEqual([stepFor(journeyDonors[0]).responses.responded,stepFor(journeyDonors[0]).responses.gifts,stepFor(journeyDonors[0]).responses.dollarsCents],[2,3,11226])
  const resendReport=(await h.get('/api/coffer/appeals/'+renewed.id)).results
  assert.equal(resendReport.gifts,0,'The new resend run code does not steal the original step’s responses')

  const uncertainDonor=await donor(h,'Owen Uncertain')
  await h.command('consent.record',{donorIds:[uncertainDonor.id],channel:'email',status:'granted',method:'paper form',evidence:'Synthetic written permission',capturedOn:day})
  const uncertainGift=await h.command('gift.record',{donorId:uncertainDonor.id,amount:'33',receivedOn:day,method:'cash',goods:'none'})
  assert.equal((await h.command('welcome.run')).uncertain,1)
  const uncertainHistory=await h.get('/api/coffer/donors/'+uncertainDonor.id),uncertainAck=uncertainHistory.gifts.find(g=>g.id===uncertainGift.id).acknowledgment
  assert.equal(uncertainAck.status,'not acknowledged');assert.equal(uncertainAck.outcome_unknown,1)
  assert.ok(!(await h.get('/api/coffer/agent')).missingReceipts.some(g=>g.id===uncertainGift.id))

  // Mango's documented list handoff is held, not inferred to be a send. The
  // preference feed supplies no campaign-bound result, so no result is invented.
  await h.command('marketing.connectMango',{origin:'https://mango.example.test',credential:'synthetic-coffer-2'})
  const held=await donor(h,'Nora Hold')
  await h.command('consent.record',{donorIds:[held.id],channel:'email',status:'granted',method:'paper form',evidence:'Synthetic permission',capturedOn:day})
  const heldGift=await h.command('gift.record',{donorId:held.id,amount:'31',receivedOn:day,method:'cash',fund:'Food',goods:'none'})
  assert.equal((await h.command('welcome.run')).submitted,1)
  const heldHistory=await h.get('/api/coffer/donors/'+held.id),heldMessage=heldHistory.communications.find(m=>m.source_kind==='welcome')
  const heldAck=heldHistory.gifts.find(g=>g.id===heldGift.id).acknowledgment
  assert.equal(heldAck.status,'not acknowledged');assert.equal(heldAck.outcome_unknown,1)
  assert.equal(heldAck.communication_id,heldMessage.id)
  assert.ok(!(await h.get('/api/coffer/agent')).missingReceipts.some(g=>g.id===heldGift.id))
  journey=(await h.get('/api/coffer/agent/appeals')).journey
  const heldStep=stepFor(held)
  assert.equal(heldStep.state,'handed off');assert.equal(heldStep.resend,false)
  assert.ok(mangoLists.some(list=>list.includes(publication.publicationId)))
  const beforeCheck=sends,checkedHold=await h.api('/api/coffer/agent/appeals/journey/run',{stepId:heldStep.id})
  assert.equal(checkedHold.checked,0);assert.equal(checkedHold.state,'handed off');assert.equal(sends,beforeCheck)
  await h.api('/api/coffer/agent/appeals/journey/prepare',{stepId:heldStep.id},{status:409})

  const lines=await archive(h),fresh=await installation()
  try{
   await restore(fresh,lines)
   const restored=(await fresh.get('/api/coffer/agent/appeals')).journey
   assert.deepEqual(restored.find(s=>s.id===droppedStep.id).responses,stepFor(journeyDonors[0]).responses)
   assert.deepEqual((await fresh.get('/api/coffer/welcome')).publications,(await h.get('/api/coffer/welcome')).publications)
   assert.equal((await fresh.get('/api/coffer/agent/appeals')).journey.find(s=>s.id===heldStep.id).state,'handed off')
  }finally{await fresh.close()}
  const historical=await installation()
  try{
   await restore(historical,await legacyJourney(lines,droppedStep.id))
   const legacy=(await historical.get('/api/coffer/agent/appeals')).journey.find(s=>s.id===droppedStep.id)
   assert.equal(legacy.responses.bound,false);assert.equal(legacy.responses.code,null)
   if(process.env.COFFER_APPEAL_AGENT_BROWSER){
    const {journeyResponseBrowser}=await import('./agent-appeals-browser.mjs')
    await journeyResponseBrowser(h,historical,droppedStep.id,process.env.COFFER_APPEAL_AGENT_BROWSER)
   }
  }finally{await historical.close()}

 },{bindings:{STRIPE_SECRET_KEY:'synthetic-coffer-1'},outbound:async request=>{
  const target=new URL(request.url)
  if(target.hostname==='api.stripe.com')return giving.outbound(request)
  if(target.hostname==='mango.example.test'){
   const path=target.pathname.replace('/api/integrations/v1',''),body=request.method==='GET'?null:await request.json()
   if(path==='/segments')return Response.json({segments:[]})
   if(path==='/events')return Response.json({events:[],nextCursor:0})
   if(path==='/campaigns/coffer-connection-check/send')return Response.json({error:'invalid'},{status:400})
   if(path==='/contacts'&&request.method==='PUT'){
    if(!body.email)return Response.json({error:'invalid'},{status:400})
    mangoLists.push(body.segmentName)
    const contact={id:'synthetic-coffer-3',email:body.email,emailStatus:'subscribed',segmentIds:['synthetic-coffer-4']}
    mangoContacts.set(body.email,contact);return Response.json({contact})
   }
   if(path==='/contacts')return Response.json({contacts:mangoContacts.has(target.searchParams.get('email'))?[mangoContacts.get(target.searchParams.get('email'))]:[]})
   assert.fail(request.method+' '+path)
  }
  const u=new URL(request.url),path=u.pathname.replace('/3.0',''),raw=request.method==='GET'?'':await request.text(),body=raw?JSON.parse(raw):null
  assert.equal(u.hostname,'us21.api.mailchimp.com')
  if(path==='/lists')return Response.json(fixture.lists??{lists:[{id:'fixture-list',name:'Fixture audience',stats:{member_count:7}}]})
  if(path==='/lists/fixture-list/merge-fields'&&request.method==='GET')return Response.json({merge_fields:['CF_INFORM','CF_FORMAL','CF_ENVELOP','CF_PREFIX','CF_FIRST','CF_MIDDLE','CF_LAST','CF_SUFFIX','CF_NICK'].map(tag=>({tag,type:'text'})),total_items:9})
  if(path.includes('/members/')&&path.startsWith('/lists/fixture-list')){
   const d=[...contacts.values()].find(x=>x.hash===path.split('/').at(-1))
   if(request.method==='PATCH'){
    assert.deepEqual(Object.keys(body),['merge_fields'])
    if(d)d.merge_fields={...d.merge_fields,...body.merge_fields}
    return Response.json(d??{...fixture.member_subscribed,email_address:await emailForHash(path.split('/').at(-1)),merge_fields:body.merge_fields})
   }
   if(request.method==='PUT'){if(d)d.status=body.status;return Response.json(d??fixture.member_unsubscribed)}
   return Response.json(d??{...fixture.member_subscribed,email_address:await emailForHash(path.split('/').at(-1))})
  }
  if(path==='/lists/fixture-list/segments'&&request.method==='POST'){
   const id=segments.size+1,email=body.static_segment[0];segments.set(id,email)
   const {createHash}=await import('node:crypto');contacts.set(email,{...fixture.member_subscribed,email_address:email,hash:createHash('md5').update(email).digest('hex')})
   return Response.json({...fixture.static_segment,id})
  }
  if(path.match(/^\/lists\/fixture-list\/segments\/\d+\/members$/))return Response.json({members:[{...fixture.member_subscribed,email_address:segments.get(Number(path.split('/')[4]))}],total_items:1})
  if(path==='/campaigns'&&request.method==='POST'){
   const id='campaign-'+(campaigns.size+1);campaigns.set(id,{...body,id,status:'save',recipients:{...body.recipients,recipient_count:1}});return Response.json({id})
  }
  const m=path.match(/^\/campaigns\/([^/]+)(.*)$/)
  if(m){const campaign=campaigns.get(m[1]);assert.ok(campaign,path)
   if(m[2]==='/actions/send'){if(segments.get(campaign.recipients.segment_opts.saved_segment_id)==='owen.uncertain@example.org')return new Response(null,{status:503});campaign.status='sent';sends++;return new Response(null,{status:204})}
   if(request.method==='PATCH')Object.assign(campaign,body)
   return Response.json(campaign)
  }
  const report=path.match(/^\/reports\/campaign-(\d+)\/sent-to$/)
  if(report){const n=Number(report[1]),campaign=campaigns.get('campaign-'+n),email=segments.get(campaign.recipients.segment_opts.saved_segment_id)
   const native=email.startsWith('jules.')||email==='kira.jones@example.org'||email==='lane.king@example.org'||email==='mira.lake@example.org'
   if(native)return Response.json({total_items:email==='jules.ives@example.org'?0:1,sent_to:email==='jules.ives@example.org'?[]:[{email_address:email==='lane.king@example.org'?'unrelated@example.test':email,status:email==='kira.jones@example.org'?'hard':'sent'}]})
   const dropped=resultMode==='dropped'||resultMode==='normal'&&n<=4
   return Response.json({total_items:dropped?0:1,sent_to:dropped?[]:[{email_address:resultMode==='mismatch'?'other@example.test':email,status:n===5?'hard':'sent'}]})
  }
  assert.fail(request.method+' '+path)
 }})
 async function emailForHash(hash){
  const {createHash}=await import('node:crypto')
  const emails=['avery.chen','bill.carter','cora.diaz','dalia.evans','eli.fox','farah.green','grace.hill','grace.changed','jules.ives','kira.jones','lane.king','mira.lake','jules.changed','owen.uncertain'].map(n=>n+'@example.org')
  return emails.find(e=>createHash('md5').update(e).digest('hex')===hash)
 }
})

// A valid portable fixture whose older enrolled step has no publication binding.
// Read-time names, dates and existing appeal-code gifts must never infer one.
async function legacyJourney(lines,stepId){
 const {makePart,ArchiveVerifier,ContentVerifier}=await import('@runeditrun/rer/modules/portability/format')
 const manifest=structuredClone(lines[0]),items=structuredClone(lines.filter(r=>r.kind==='part').flatMap(p=>p.items))
 for(const item of items)if(item.kind==='row'&&item.table==='cf_welcome_steps'&&item.row.id===stepId)item.row.response_code=null
 const parts=[]
 for(let i=0;i<items.length;i+=200)parts.push(await makePart(parts.length,items.slice(i,i+200)))
 manifest.partCount=parts.length
 const integrity=new ArchiveVerifier(manifest),content=new ContentVerifier(manifest)
 for(const part of parts){integrity.add(part);for(const item of part.items)content.add(item)}
 return [manifest,...parts,{kind:'closing',partCount:parts.length,archiveHash:integrity.digest(),contentHash:content.digest()}]
}
