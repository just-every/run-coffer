import assert from 'node:assert/strict'
import {run,donor,archive,restore,installation} from './harness.mjs'
import {teamAccessBrowser} from './team-access-browser.mjs'

const mailbox=n=>['synthetic-coffer-'+n,'example.test'].join('@')
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve}}

export async function teamAccessJourney(){
 let pauseToken=false,pauseAddress=false,tokenEntered=deferred(),tokenRelease=deferred(),addressEntered=deferred(),addressRelease=deferred()
 const calls=[]
 await run(async h=>{
  const owner=(await h.get('/auth/session')).operator,member=await h.person(mailbox(1)),admin=await h.person(mailbox(2),'admin')
  const target=await donor(h,'Synthetic Coffer Constituent',{email:null}),other=await donor(h,'Synthetic Coffer Other',{email:null})
  const gift=await h.command('gift.record',{donorId:target.id,amount:'125',receivedOn:'2026-09-01',fund:'Library',method:'cash',goods:'none'})
  const pledge=await h.command('pledge.create',{donorId:target.id,amount:'300',pledgedOn:'2026-09-01',dueBy:'2027-09-01',fund:'Library',installments:[{dueOn:'2027-09-01',amount:'300'}]})
  const task=await h.command('task.create',{donorId:target.id,ownerId:member.id,kind:'call',title:'Ordinary thank-you task',dueOn:'2027-09-01',isAsk:false})
  const opportunity=await h.command('prospect.save',{donorId:target.id,ownerId:member.id,stage:'cultivate',askAmount:'1000',expectedCloseOn:'2027-09-01',nextStep:'Discuss the library'})
  await h.command('interaction.record',{donorId:target.id,kind:'note',occurredOn:'2026-09-01',notes:'Ordinary timeline fact'})
  const confidential=await h.command('interaction.record',{donorId:target.id,kind:'note',occurredOn:'2026-09-01',notes:'Private research fact',confidential:true})
  const doc=await h.api('/api/coffer/documents',{donorId:target.id,recordRef:'donor:'+target.id,title:'Private attachment',fileName:'synthetic-coffer-1.txt',mediaType:'text/plain',contentBase64:Buffer.from('Private attachment bytes').toString('base64')})
  const attachments=[doc]
  for(const recordRef of ['gift:'+gift.id,'pledge:'+pledge.id,'opportunity:'+opportunity.id]){
   attachments.push(await h.api('/api/coffer/documents',{donorId:target.id,recordRef,title:'Private record attachment',fileName:'synthetic-coffer-2.txt',mediaType:'text/plain',contentBase64:Buffer.from('Private record bytes').toString('base64')}))
  }
  attachments.push(await h.api('/api/coffer/documents',{donorId:other.id,recordRef:'donor:'+other.id,title:'Foreign attachment',fileName:'synthetic-coffer-3.txt',mediaType:'text/plain',contentBase64:Buffer.from('Foreign record bytes').toString('base64')}))
  const state=async()=> (await h.get('/api/coffer/team-access')).people.find(p=>p.id===member.id)
  const set=async(readOnly,options={})=>{
   const s=await state()
   return h.command('team.access',{operatorId:member.id,operatorVersion:s.operator_version,version:s.version,readOnly:readOnly?'1':'0'},options)
  }
  const native=(await h.get('/auth/session',{as:member.cookie})).operator
  assert.equal(native.role,'member')
  await set(false)
  await h.command('donor.create',{name:'Synthetic Member Entry'},{as:member.cookie})
  for(const as of [member.cookie]){
   await set(true,{as,status:403})
   await h.get('/api/coffer/team-access',{as,status:403})
  }
  const agent=await h.command('agent.create',{label:'Synthetic read restriction probe'})
  await h.command('team.access',{},{as:'',headers:{authorization:'Bearer '+agent.token},status:403})
  await h.command('team.access',{operatorId:owner.id,operatorVersion:owner.version,version:0,readOnly:'1'},{status:409})
  await h.command('team.access',{operatorId:admin.id,operatorVersion:admin.session.operator.version,version:0,readOnly:'1'},{status:409})
  const inactive=await h.person(mailbox(3))
  await h.api('/auth/operator/status',{operatorId:inactive.id,status:'inactive'})
  await h.command('team.access',{operatorId:inactive.id,operatorVersion:inactive.session.operator.version,version:0,readOnly:'1'},{status:409})
  const beforeNative=await h.get('/auth/session',{as:member.cookie})
  // Exercise the actual native assignment form and persisted views at both widths.
  await teamAccessBrowser(h,{member,donor:{...target,name:'Synthetic Coffer Constituent'}},process.env.COFFER_TEAM_BROWSER??'.cache/team-access')
  const afterNative=await h.get('/auth/session',{as:member.cookie})
  assert.equal(afterNative.id,beforeNative.id)
  assert.deepEqual(afterNative.operator,beforeNative.operator,'Coffer restrictions preserve the native account and role')
  const as={as:member.cookie}
  const read=path=>h.get(path,as)
  for(const [resource,record] of [['gifts',gift],['pledges',pledge],['tasks',task],['opportunities',opportunity]]){
   for(const prefix of ['/api/coffer/','/api/coffer/v1/']){
    const result=await read(prefix+resource)
    assert.ok(result.data.some(r=>r.id===record.id),resource+' seeded record is readable')
    assert.equal((await read(prefix+resource+'/'+record.id)).data.id,record.id)
   }
  }
  for(const prefix of ['/api/coffer/','/api/coffer/v1/']){
   const result=await read(prefix+'donors/'+target.id)
   assert.equal(result.data.name,'Synthetic Coffer Constituent')
   assert.ok(result.timeline.some(n=>n.body==='Ordinary timeline fact'))
   assert.ok(!JSON.stringify(result).includes('Private research fact'))
   assert.ok(!JSON.stringify(result).includes('Private attachment'))
   assert.ok(!JSON.stringify(result).includes(confidential.id))
  }
  await h.get('/api/coffer/v1/interactions/'+confidential.id,{...as,status:404})
  for(const attachment of attachments){
   for(const kind of ['preview','download']){
    const path='/api/coffer/documents/'+attachment.id+'/'+kind
    assert.equal((await h.request(path)).status,200,'The owner can open the existing attachment')
    assert.equal((await h.request(path,as)).status,403,'A restricted member cannot open any parent record file')
   }
  }
  const businessBefore=(await h.get('/api/coffer/donors/'+target.id))
  const effects=calls.length,mails=h.messages.length
  // Each family reaches the public command door, with an otherwise meaningful target.
  for(const command of ['donor.create','donor.update','donor.profile','donor.merge','donor.unmerge','donor.erase',
   'gift.record','gift.reverse','gift.classify','gift.acknowledge','gift.resetAcknowledgment','gift.doNotAcknowledge',
   'softCredit.acknowledge','softCredit.resetAcknowledgment','softCredit.doNotAcknowledge',
   'household.update','household.confirmNames','household.defaultsPreview','household.defaults',
   'person.defaults','consent.record','pledge.create','pledge.remind','pledge.reduce','pledge.writeOff','pledge.releaseEmail',
   'task.create','task.complete','task.teamSave','task.policy','task.reminders','prospect.save',
   'interaction.record','proposal.attach','grant.attach','ack.prepare','ack.approve','ack.send','ack.export',
   'appeal.prepare','appeal.approve','appeal.export','appeal.send','settings.update','agent.create','agent.revoke',
   'apiKey.create','apiKey.revoke','webhook.subscribe','webhook.rotate','webhook.resume','webhook.replay',
   'research.screen','address.verify','calendar.start','calendar.log','marketing.sync','sms.send','team.access']){
   const result=await h.command(command,{donorId:target.id,version:businessBefore.donor.version,id:gift.id,amount:'10',name:'Refused mutation'}, {...as,status:403})
   assert.equal(result.error,'READ_ONLY',command)
  }
  const forbidden=[
   '/api/coffer/notes/'+confidential.id,'/api/coffer/research?donorId='+target.id,
   '/api/coffer/documents?donorId='+target.id,'/api/coffer/documents/'+doc.id+'/preview','/api/coffer/documents/'+doc.id+'/download',
   '/api/coffer/opportunities/'+opportunity.id+'/documents','/api/coffer/proposals/'+doc.id+'/download','/api/coffer/grant-documents/'+doc.id+'/download',
   '/api/coffer/letters','/api/coffer/appeals','/api/coffer/households/'+target.id,
   '/api/coffer/audit.csv','/api/coffer/donors.csv','/api/coffer/exports','/api/coffer/reports/builder','/api/coffer/reports/custom-fields.csv',
   '/api/coffer/calendar/events','/app/calendar/google/callback?code=synthetic-coffer-1&state=synthetic-coffer-2',
   '/api/coffer/giving/plans/new?donorId='+target.id,'/api/coffer/payments','/api/coffer/webhooks','/api/coffer/v1/keys',
   '/api/coffer/v1/plans','/api/coffer/v1/donors/'+target.id+'/consents',
   '/app/reports/builder?download=1','/app/reports/honor-roll','/app/api-keys','/app/webhooks','/app/data','/app/agent','/app/settings',
   '/api/portability/exports']
  for(const path of forbidden)assert.equal((await h.request(path,as)).status,403,path)
  for(const [path,method] of [['/app/actions','POST'],['/app/documents','POST'],['/api/coffer/documents','POST'],
   ['/api/coffer/donors/'+target.id+'/data-request','POST'],['/api/coffer/v1/donors','POST'],
   ['/api/coffer/v1/gifts','POST'],['/api/coffer/v1/tasks','POST'],['/api/coffer/v1/donors/'+target.id,'PUT'],
   ['/api/coffer/giving/plans','POST'],['/api/coffer/giving/campaigns','POST'],['/app/people/invite','POST'],
   ['/api/portability/exports','POST']]){
   assert.equal((await h.request(path,{...as,method,body:{donorId:target.id}})).status,403,path)
  }
  assert.equal(calls.length,effects,'Refused transports make no provider call')
  assert.equal(h.messages.length,mails,'Refused transports send no mail')
  const businessAfter=await h.get('/api/coffer/donors/'+target.id)
  assert.deepEqual(businessAfter,businessBefore,'Refused actions change no donor or business facts')
  // Current owner and admin can explicitly remove or reapply the restriction.
  const stale=await state()
  await set(false,{as:admin.cookie})
  await h.command('team.access',{operatorId:member.id,operatorVersion:stale.operator_version,version:stale.version,readOnly:'1'},{status:409})
  await h.command('donor.create',{name:'Synthetic Restored Native Entry'},as)
  const current=await state(),input={operatorId:member.id,operatorVersion:current.operator_version,version:current.version,readOnly:'1'}
  const concurrent=await Promise.all([h.request('/api/coffer/commands',{method:'POST',body:{command:'team.access',input}}),h.request('/api/coffer/commands',{method:'POST',body:{command:'team.access',input:{...input,readOnly:'0'}}})])
  assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409])
  await set(false)
  // A member's entry is authorized, then restriction changes while the network
  // edge is serving its address check. The business write must roll back.
  await h.command('address.processing',{version:0,enabled:'yes',pafReference:'synthetic-coffer-1',pafSigner:'Synthetic Coffer Signer',pafSignedOn:'2025-01-01',pafLicensee:'Melissa',reviewed:'yes'})
  pauseAddress=true
  const pending=h.command('donor.create',{name:'Synthetic Inflight Entry',addressLine1:'1 Main Street',city:'Springfield',region:'IL',postalCode:'62701'},{...as,status:401})
  await addressEntered.promise
  await set(true)
  await set(false)
  addressRelease.resolve()
  assert.equal((await pending).error,'SESSION_CHANGED')
  assert.equal((await h.get('/api/coffer/donors?q=Synthetic%20Inflight%20Entry')).donors.length,0)
  pauseAddress=false
  await h.command('address.processing',{version:1,enabled:false})
  await set(false)
  // A completed token refresh is followed by a fresh authority check before
  // submitting any event request. Fakes exist only at Google's network edge.
  await h.command('calendar.configure',{clientId:'synthetic-coffer-client',clientSecret:'synthetic-coffer-secret',confirm:'yes'})
  const start=await h.command('calendar.start',{confirm:'yes'},as)
  const stateToken=new URL(start.authorizeUrl).searchParams.get('state')
  assert.equal((await h.request('/app/calendar/google/callback?code=synthetic-coffer-code&state='+stateToken,as)).status,303)
  const allowed=await read('/api/coffer/calendar/events')
  assert.equal(allowed.events[0].summary,'Synthetic calendar meeting')
  const eventCalls=calls.filter(c=>c.includes('calendar/v3')).length
  pauseToken=true
  const inflight=h.get('/api/coffer/calendar/events',{...as,status:401})
  await tokenEntered.promise
  await set(true)
  tokenRelease.resolve()
  assert.equal((await inflight).error,'SESSION_CHANGED')
  assert.equal(calls.filter(c=>c.includes('calendar/v3')).length,eventCalls,'Restriction change prevents provider submission after token refresh')
  // Lifecycle changes cannot expose a foreign, merged or erased record.
  const history=await h.get('/api/coffer/donors/'+target.id),otherHistory=await h.get('/api/coffer/donors/'+other.id)
  await h.command('donor.merge',{sourceDonorId:other.id,sourceVersion:otherHistory.donor.version,donorId:target.id,version:history.donor.version,reason:'duplicate_record'})
  await h.get('/api/coffer/donors/'+other.id,{...as,status:404})
  assert.equal((await read('/api/coffer/donors/'+target.id)).data.id,target.id)
  await h.command('donor.erase',{donorId:target.id,confirm:'ERASE'})
  for(const attachment of attachments)assert.equal((await h.request('/api/coffer/documents/'+attachment.id+'/download',as)).status,403)
  for(const prefix of ['/api/coffer/','/api/coffer/v1/']){
   await h.get(prefix+'donors/'+target.id,{...as,status:404})
   await h.get(prefix+'gifts/'+gift.id,{...as,status:404})
   assert.ok(!JSON.stringify(await read(prefix+'donors')).includes('Synthetic Coffer Constituent'))
  }
  const backup=await archive(h),fresh=await installation()
  try{
   await restore(fresh,backup)
   assert.deepEqual((await fresh.get('/api/coffer/team-access')).people,[],'Restore recreates no native members or privileges')
   assert.equal((await fresh.request('/api/coffer/donors',{as:member.cookie})).status,401)
   const freshMember=await fresh.person(mailbox(1))
   assert.notEqual(freshMember.id,member.id)
   assert.equal((await fresh.get('/api/coffer/team-access')).people[0].read_only,0,'New account requires explicit access assignment; old identity is not restored')
  }finally{await fresh.close()}
  assert.equal((await h.request('/auth/session/revoke',{method:'POST',body:{sessionId:member.session.id}})).status,204)
  await h.get('/api/coffer/donors',{...as,status:401})
  const audit=await h.get('/api/coffer/audit?action=team.access')
  assert.ok(audit.rows.some(r=>r.actor_id===admin.id),'Admin restriction removal is audited')
  assert.ok(audit.rows.some(r=>r.actor_id===owner.id),'Owner assignments are audited')
 },{bindings:{SMARTY_AUTH_ID:'synthetic-coffer-1',SMARTY_AUTH_TOKEN:'synthetic-coffer-2',MELISSA_SMARTMOVER_KEY:'synthetic-coffer-3'},outbound:async request=>{
  const url=new URL(request.url);calls.push(url.origin+url.pathname)
  if(url.hostname==='us-street.api.smarty.com'){
   if(pauseAddress){addressEntered.resolve();await addressRelease.promise}
   const batch=JSON.parse(await request.text())
   return Response.json(batch.map((r,index)=>({input_id:r.input_id,input_index:index,candidate_index:0,delivery_line_1:'1 Main St',last_line:'Springfield IL 62701-0001',components:{primary_number:'1',street_name:'Main',street_suffix:'St',city_name:'Springfield',state_abbreviation:'IL',zipcode:'62701',plus4_code:'0001'},metadata:{record_type:'S',rdi:'Residential'},analysis:{dpv_match_code:'Y',dpv_footnotes:'AABB',dpv_vacant:'N',dpv_no_stat:'N',active:'Y'}})))
  }
  if(url.hostname==='oauth2.googleapis.com'){
   const params=new URLSearchParams(await request.text())
   if(params.get('grant_type')==='refresh_token'&&pauseToken){tokenEntered.resolve();await tokenRelease.promise}
   return Response.json({access_token:'synthetic-coffer-access',token_type:'Bearer',refresh_token:'synthetic-coffer-refresh',scope:'https://www.googleapis.com/auth/calendar.events.readonly'})
  }
  assert.equal(url.hostname,'www.googleapis.com')
  return Response.json({items:[{id:'synthetic-coffer-event',summary:'Synthetic calendar meeting',start:{dateTime:'2026-10-28T13:00:00Z'},end:{dateTime:'2026-10-28T14:00:00Z'}}]})
 }})
 await mailchimpRestrictionJourney()
}

async function mailchimpRestrictionJourney(){
 const email=mailbox(83),definitions=new Map(),writes=[]
 let remote={id:'synthetic-coffer-83',email_address:email,status:'subscribed'}
 let pauseMethod=null,entered=deferred(),release=deferred()
 await run(async h=>{
  const member=await h.person(mailbox(84)),target=await donor(h,'Synthetic Coffer Mailchimp',{email})
  const consent={donorIds:[target.id],channel:'email',status:'granted',method:'paper form',evidence:'Synthetic explicit permission',capturedOn:'2026-09-01'}
  const set=async readOnly=>{
   const access=(await h.get('/api/coffer/team-access')).people.find(p=>p.id===member.id)
   await h.command('team.access',{operatorId:member.id,operatorVersion:access.operator_version,version:access.version,readOnly:readOnly?'1':'0'})
  }
  await h.command('consent.record',consent)
  await h.command('marketing.connectMailchimp',{apiKey:'synthetic-us21'})
  await h.command('marketing.chooseAudience',{listId:'synthetic-coffer-83',fromName:'Synthetic Coffer',fromEmail:email})
  // Native member consent entry performs the real provider sync as a side effect.
  await h.command('consent.record',consent,{as:member.cookie})
  assert.equal(remote.merge_fields.CF_INFORM,'Synthetic Coffer Mailchimp','An unrestricted member can sync the donor name')
  assert.equal(definitions.size,9,'The supported sync creates its missing audience fields')
  for(const [index,scenario] of [
   {method:'GET',missing:false,removeAgain:false},
   {method:'GET',missing:true,removeAgain:true},
   {method:'POST',missing:true,removeAgain:false},
  ].entries()){
   const nickname='Synthetic updated '+index
   await h.command('donor.profile',{donorId:target.id,version:(await h.get('/api/coffer/donors/'+target.id)).donor.version,nickname})
   if(scenario.missing)definitions.clear()
   entered=deferred();release=deferred();pauseMethod=scenario.method
   const pending=h.command('consent.record',consent,{as:member.cookie,status:401})
   await entered.promise
   // A submitted field creation may complete, but restriction must stop every
   // subsequent field creation and donor-name write, even after removal.
   const before=writes.length,priorRemote=structuredClone(remote),priorFields=[...definitions.values()]
   await set(true)
   if(scenario.removeAgain)await set(false)
   pauseMethod=null;release.resolve()
   assert.equal((await pending).error,'SESSION_CHANGED')
   assert.equal(writes.length,before,'Restriction changes prevent subsequent Mailchimp writes after '+scenario.method)
   assert.deepEqual(remote,priorRemote,'No donor name is disclosed after restriction assignment')
   assert.deepEqual([...definitions.values()],priorFields,'No additional audience field is created after restriction assignment')
   await set(false)
   await h.command('consent.record',consent,{as:member.cookie})
   assert.equal(remote.merge_fields.CF_NICK,nickname,'Explicit removal permits a fresh authorized sync')
  }
 },{outbound:async request=>{
  const url=new URL(request.url)
  assert.equal(url.hostname,'us21.api.mailchimp.com')
  if(url.pathname==='/3.0/lists')return Response.json({lists:[{id:'synthetic-coffer-83',name:'Synthetic Coffer Audience',stats:{member_count:1}}]})
  if(url.pathname==='/3.0/lists/synthetic-coffer-83/merge-fields'){
   let result
   if(request.method==='GET')result={merge_fields:[...definitions.values()],total_items:definitions.size}
   else{
    assert.equal(request.method,'POST')
    const body=await request.json();definitions.set(body.tag,body);writes.push({method:'POST',body});result=body
   }
   if(request.method===pauseMethod){entered.resolve();await release.promise}
   return Response.json(result)
  }
  assert.match(url.pathname,/^\/3\.0\/lists\/synthetic-coffer-83\/members\/[a-f0-9]{32}$/)
  if(request.method==='PATCH'){
   const body=await request.json();writes.push({method:'PATCH',body});remote={...remote,...body}
  }else assert.equal(request.method,'GET')
  return Response.json(remote)
 }})
}
