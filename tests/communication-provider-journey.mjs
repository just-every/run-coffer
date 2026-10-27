import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {run,donor,reviewed} from './harness.mjs'

const topicIds=['synthetic-coffer-9302','synthetic-coffer-9303','synthetic-coffer-9304']
const frequencyField='synthetic-coffer-9305'
const hash=email=>createHash('md5').update(email).digest('hex')

// Only provider network edges are faked. These assertions prove Coffer's
// requests and exclusions, not provider-generated MIME headers or delivery.
export async function communicationProviderJourney(){
 for(const provider of ['mango','mailchimp','constant-contact'])await providerJourney(provider)
}

async function providerJourney(provider){
 const contacts=new Map(),writes=[],handoffs=[],campaigns=new Map(),segments=new Map(),calls=[],edgeErrors=[]
 let fault='',strict=false,serial=0,beforeContent=null,optedOut=false
 const preferences=contact=>{
  const ids=strict?[topicIds[0]]:topicIds
  const fields={[frequencyField]:strict?'quarterly':'unlimited'}
  const answer={...contact,segmentIds:ids,interests:Object.fromEntries(topicIds.map(id=>[id,ids.includes(id)])),fields,merge_fields:{...contact.merge_fields,...fields},list_memberships:ids,custom_fields:[{custom_field_id:frequencyField,value:fields[frequencyField]}]}
  if(fault==='missing-topics'){delete answer.segmentIds;delete answer.interests;delete answer.list_memberships}
  if(fault==='malformed-topics'){answer.segmentIds=[17];answer.interests=[];answer.list_memberships=[17]}
  if(fault==='missing-choice')answer.interests={[topicIds[0]]:true}
  if(fault==='missing-frequency'){answer.fields={};answer.merge_fields={};answer.custom_fields=[]}
  if(fault==='malformed-frequency'){answer.fields={[frequencyField]:'weekly'};answer.merge_fields=answer.fields;answer.custom_fields=[{custom_field_id:frequencyField,value:'weekly'}]}
  return answer
 }
 const outbound=async request=>{
  const u=new URL(request.url),path=u.pathname,method=request.method,raw=method==='GET'?'':await request.text(),body=raw?JSON.parse(raw):null
  calls.push(method+' '+path)
  if(u.hostname==='api.cc.email'){
   assert.equal(provider,'constant-contact');assert.equal(method,'GET')
   if(fault==='unavailable')return Response.json({error:'synthetic-coffer-9306'},{status:503})
   const email=u.searchParams.get('email'),contact=preferences(contacts.get(email))
   return Response.json({contacts:fault==='missing-contact'?[]:[{...contact,contact_id:'synthetic-coffer-9307',email_address:{address:email,permission_to_send:optedOut?'unsubscribed':'explicit'}}]})
  }
  if(u.hostname==='mango.example.test'){
   const suffix=path.replace('/api/integrations/v1','')
   if(suffix==='/segments')return Response.json({segments:[]})
   if(suffix==='/events')return Response.json({events:[],nextCursor:0})
   if(suffix.endsWith('/send')||suffix==='/contacts'&&method==='PUT'&&!body.email)return Response.json({error:'synthetic-coffer-9308'},{status:400})
   if(suffix==='/contacts'&&method==='GET'){
    if(provider==='mango'&&fault==='unavailable')return Response.json({error:'synthetic-coffer-9309'},{status:503})
    const contact=contacts.get(u.searchParams.get('email'))
    return Response.json({contacts:provider==='mango'&&fault==='missing-contact'||!contact?[]:[provider==='mango'?preferences(contact):contact]})
   }
   if(suffix==='/contacts'&&method==='PUT'){
    writes.push(body);handoffs.push(body.email)
    assert.equal(body.subscribe,true);assert.ok(body.consent.evidence)
    const contact={...contacts.get(body.email),...body,emailStatus:'subscribed',segmentIds:[body.segmentName]};contacts.set(body.email,contact)
    return Response.json({contact})
   }
   if(suffix==='/suppressions'){writes.push(body);contacts.get(body.email).emailStatus='suppressed';return Response.json({ok:true})}
  }
  if(u.hostname==='us21.api.mailchimp.com'){
   if(path==='/3.0/lists')return Response.json({lists:[{id:'synthetic-coffer-9310',name:'Synthetic audience',stats:{member_count:contacts.size}}]})
   if(path.endsWith('/merge-fields'))return Response.json({merge_fields:['CF_INFORM','CF_FORMAL','CF_ENVELOP','CF_PREFIX','CF_FIRST','CF_MIDDLE','CF_LAST','CF_SUFFIX','CF_NICK'].map(tag=>({tag,type:'text'})),total_items:9})
   const member=[...contacts.values()].find(contact=>path.endsWith('/members/'+hash(contact.email)))
   if(member){
    if(method==='GET'){
     if(fault==='unavailable')return Response.json({error:'synthetic-coffer-9311'},{status:503})
     if(fault==='missing-contact')return Response.json({title:'Not found'},{status:404})
     return Response.json(preferences(member))
    }
    writes.push(body)
    if(body.status)member.status=body.status
    if(body.merge_fields)member.merge_fields={...member.merge_fields,...body.merge_fields}
    return Response.json(preferences(member))
   }
   if(path.endsWith('/segments')&&method==='POST'){
    const id=++serial;segments.set(String(id),body.static_segment[0]);return Response.json({id,type:'static',member_count:1})
   }
   const segment=path.match(/\/segments\/([^/]+)\/members$/)
   if(segment){const contact=contacts.get(segments.get(segment[1]));return Response.json({total_items:1,members:[preferences(contact)]})}
   if(path==='/3.0/campaigns'&&method==='POST'){
    assert.equal(body.type,'regular');assert.equal(body.settings.auto_footer,true)
    const id='synthetic-coffer-9312-'+(++serial),campaign={...body,id,status:'save',recipients:{...body.recipients,recipient_count:1}}
    campaigns.set(id,campaign);return Response.json(campaign)
   }
   const id=path.split('/')[3],campaign=campaigns.get(id)
   if(campaign){
    if(path.endsWith('/content')){
     assert.match(body.html,/<a href="\*\|UNSUB\|\*">Unsubscribe<\/a>/)
     assert.match(body.plain_text,/Unsubscribe: \*\|UNSUB\|\*/)
     await beforeContent?.()
     return Response.json(body)
    }
    if(path.endsWith('/actions/send')){handoffs.push(segments.get(String(campaign.recipients.segment_opts.saved_segment_id)));return new Response(null,{status:204})}
    if(method==='PATCH'){assert.equal(body.settings.auto_footer,true);campaign.settings=body.settings}
    return Response.json(campaign)
   }
  }
  assert.fail('Unexpected provider request '+method+' '+u.origin+path)
 }
 await run(async h=>{
  await reviewed(h)
  const people=[]
  for(let i=0;i<3;i++){
   const email='synthetic-coffer-'+(9320+i)+'@example.test',d={...await donor(h,'Synthetic Provider '+i,{email}),email};people.push(d)
   contacts.set(email,{id:'synthetic-coffer-'+(9330+i),email,email_address:email,emailStatus:'subscribed',status:'subscribed'})
  }
  const [granted,withdrawn,unknown]=people
  for(const [d,status] of [[granted,'granted'],[withdrawn,'withdrawn']])await h.command('consent.record',{donorId:d.id,channel:'email',status,method:'paper form',evidence:'synthetic-coffer-9340',capturedOn:'2026-10-01'})
  for(const d of [granted,withdrawn])await h.command('communication.preferences',{donorId:d.id,channel:'email',version:0,topics:['newsletter'],frequency:'quarterly',confirm:'yes'})
  const prefs=d=>h.get('/api/coffer/donors/'+d.id+'/preferences'),file=d=>h.get('/api/coffer/donors/'+d.id)
  const native=await prefs(granted)
  if(provider==='mailchimp'){
   await h.command('marketing.connectMailchimp',{apiKey:['synthetic-coffer-9301'.replaceAll('-',''),'us21'].join('-')})
   await h.command('marketing.chooseAudience',{listId:'synthetic-coffer-9310',fromName:'Synthetic sender',fromEmail:'synthetic-coffer-9341@example.test'})
  }else await h.command('marketing.connectMango',{origin:'https://mango.example.test',credential:'synthetic-coffer-9342'})
  if(provider==='constant-contact')await h.command('marketing.constantContactConnect',{token:'synthetic-coffer-9343',newsletterListId:topicIds[0],appealsListId:topicIds[1],eventsListId:topicIds[2],frequencyField,confirm:'yes'})
  else await h.command('marketing.topicMapping',{provider,newsletterId:topicIds[0],appealsId:topicIds[1],eventsId:topicIds[2],frequencyField,confirm:'yes'})
  assert.equal((await h.command('marketing.sync')).pending,0)
  assert.deepEqual(await prefs(granted),native,provider+' subscription, restored topics and weaker cap preserve the native answer')
  assert.notEqual((await file(unknown)).current.email?.status,'granted',provider+' subscription cannot grant unknown permission')
  assert.equal((await file(withdrawn)).current.email.status,'withdrawn',provider+' re-subscription cannot grant withdrawn permission')
  strict=true;await h.command('marketing.sync')
  const tightened=await prefs(unknown),email=tightened.channels.find(p=>p.channel==='email')
  assert.deepEqual(email.topics,['newsletter']);assert.equal(email.frequency,'quarterly')
  assert.equal(tightened.history.at(-1).source,provider)
  assert.equal((await file(unknown)).current.email.status,'withdrawn')
  strict=false;await h.command('marketing.sync')
  assert.deepEqual(await prefs(unknown),tightened,provider+' restores neither imported topics nor the stricter cap')
  assert.deepEqual(await prefs(granted),native)
  const prepare=async name=>{
   const appeal=await h.command('appeal.prepare',{name,channel:'email',purpose:'newsletter',subject:'Synthetic newsletter',body:'Synthetic provider preference journey.'})
   assert.deepEqual((await h.get('/api/coffer/appeals/'+appeal.id)).recipients.map(r=>r.donor_id),[granted.id])
   await h.command('appeal.approve',{appealId:appeal.id,version:1});return appeal
  }
  const happy=await prepare('Synthetic valid provider answers'),before=handoffs.length
  const sent=await h.command('appeal.send',{appealId:happy.id,version:2})
  const sentMessages=(await h.get('/api/coffer/appeals/'+happy.id)).messages
  assert.equal(sent.submitted+sent.listed,1,JSON.stringify({provider,sent,messages:sentMessages,calls,edgeErrors}));assert.deepEqual(handoffs.slice(before),[granted.email])
  const held=await prepare('Synthetic held provider answers')
  for(const invalid of ['missing-topics','malformed-topics',...(provider==='mailchimp'?['missing-choice']:[]),'missing-frequency','malformed-frequency','missing-contact','unavailable']){
   fault=invalid
   const beforeHandoff=handoffs.length,beforeWrite=writes.length
   await h.command('appeal.send',{appealId:held.id,version:2},{status:502})
   assert.equal(handoffs.length,beforeHandoff,provider+' '+invalid+' performs no marketing handoff')
   assert.equal(writes.length,beforeWrite,provider+' '+invalid+' performs no contact write')
   assert.deepEqual((await h.get('/api/coffer/appeals/'+held.id)).messages,[],provider+' '+invalid+' claims no message')
  }
  fault=''
  const resumed=await h.command('appeal.send',{appealId:held.id,version:2})
  assert.equal(resumed.submitted+resumed.listed,1,'Valid current answers release only the explicitly submitted run')
  if(provider==='mailchimp'){
   const nativeTopics=async topics=>h.command('communication.preferences',{donorId:granted.id,channel:'email',version:(await prefs(granted)).channels.find(p=>p.channel==='email').version,topics,frequency:'quarterly',confirm:'yes'})
   await nativeTopics(['newsletter','appeals'])
   const race=await h.command('appeal.prepare',{name:'Synthetic composition race',channel:'email',subject:'Synthetic appeal',body:'Synthetic approved appeal.'})
   await h.command('appeal.approve',{appealId:race.id,version:1})
   let changed=false
   beforeContent=async()=>{beforeContent=null;await nativeTopics(['newsletter']);changed=true}
   const beforeRace=handoffs.length,raced=await h.command('appeal.send',{appealId:race.id,version:2})
   assert.equal(changed,true,'The donor withdrew the topic during real provider composition')
   assert.equal(handoffs.length,beforeRace,'Topic withdrawal during content composition prevents the final Mailchimp send action')
   assert.equal(raced.uncertain,1);assert.equal(raced.submitted,0)
   const saved=(await h.get('/api/coffer/appeals/'+race.id)).messages
   assert.deepEqual(saved.map(message=>message.status),['uncertain'])
   assert.deepEqual((await prefs(granted)).channels.find(p=>p.channel==='email').topics,['newsletter'])
   await h.command('appeal.send',{appealId:race.id,version:2},{status:409})
   assert.equal(handoffs.length,beforeRace,'The saved uncertain claim cannot automatically send again')
  }
  const oldConsents=(await file(granted)).consents,beforeOptOut=handoffs.length
  optedOut=true;contacts.get(granted.email).emailStatus='unsubscribed';contacts.get(granted.email).status='unsubscribed';fault='malformed-topics'
  assert.ok((await h.command('marketing.sync')).pending>0,'Malformed provider metadata still holds sending')
  const afterOptOut=await file(granted),withdrawal=afterOptOut.current.email
  assert.equal(withdrawal.status,'withdrawn',provider+' opt-out is recorded despite malformed mapped metadata')
  assert.equal(withdrawal.recorded_by,provider==='constant-contact'?'Constant Contact preference sync':provider==='mailchimp'?'Mailchimp preference sync':'Mango preference sync')
  for(const prior of oldConsents)assert.deepEqual(afterOptOut.consents.find(row=>row.id===prior.id),prior,'Provider withdrawal preserves every earlier consent row')
  await h.command('marketing.sync')
  assert.equal((await file(granted)).current.email.id,withdrawal.id,'Repeated malformed opt-out adds no duplicate withdrawal')
  assert.equal(handoffs.length,beforeOptOut)
 },{entry:'tests/engagement-worker.ts',bindings:{COFFER_TEST_NOW:'2026-10-15T16:00:00Z'},outbound:async request=>{
  try{return await outbound(request)}catch(error){edgeErrors.push(error.stack);throw error}
 }})
}
