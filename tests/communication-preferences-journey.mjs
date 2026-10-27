import {communicationPreferencesBrowser} from './communication-preferences-browser.mjs'
import {communicationClaimsJourney} from './communication-claims-journey.mjs'
import {communicationProviderJourney} from './communication-provider-journey.mjs'
import {communicationAuthorityJourney} from './communication-authority-journey.mjs'
import {channelFrequencyJourney} from './communication-frequency-journey.mjs'
import assert from 'node:assert/strict'
import {run,donor,reviewed,archive,restore} from './harness.mjs'
import {signInPortal,portalForm} from './portal-journey.mjs'
import {prepareVerifiedMail} from './verified-mail-edge.mjs'

export async function communicationPreferencesJourney({browser=true}={}){
 const at='2026-10-15T16:00:00Z',requests=[],cc={permission:'explicit',memberships:['synthetic-coffer-9101']}
 const options={entry:'tests/engagement-worker.ts',verifiedMail:true,bindings:{COFFER_TEST_NOW:at,TWILIO_ACCOUNT_SID:'synthetic-coffer-9102',TWILIO_AUTH_TOKEN:'synthetic-coffer-9103',TWILIO_FROM:'+12025550101'},outbound:async request=>{
  const u=new URL(request.url)
  if(u.hostname==='api.cc.email'){
   assert.equal(request.headers.get('authorization'),'Bearer synthetic-coffer-9104');assert.equal(u.pathname,'/v3/contacts')
   return Response.json({contacts:[{contact_id:'synthetic-coffer-9105',email_address:{address:u.searchParams.get('email'),permission_to_send:cc.permission},list_memberships:cc.memberships,custom_fields:[{custom_field_id:'synthetic-coffer-9113',value:'quarterly'}]}]})
  }
  if(u.hostname==='api.twilio.com'){requests.push(await request.text());return Response.json({sid:'synthetic-coffer-'+(9120+requests.length),status:'queued'},{status:201})}
  assert.fail('Unexpected preference network request '+request.method+' '+u.origin+u.pathname)
 }}
 await run(async h=>{
  await reviewed(h)
  const a=await donor(h,'Amelia Torres',{email:'synthetic-coffer-9106@example.test',phone:'+12025550111'}),b=await donor(h,'Jordan Lee',{email:'synthetic-coffer-9107@example.test',phone:'+12025550112'})
  const c=await donor(h,'Nora Clarke',{email:'synthetic-coffer-9108@example.test'})
  const get=d=>h.get('/api/coffer/donors/'+d.id+'/preferences')
  const file=d=>h.get('/api/coffer/donors/'+d.id)
  for(const d of [a,b,c])for(const channel of ['email','mail','phone'])await h.command('consent.record',{donorIds:[d.id],channel,status:'granted',method:'paper form',evidence:'Synthetic explicit channel permission',capturedOn:'2026-10-01'})
  await h.command('sms.preference',{donorId:a.id,status:'granted',phone:'+12025550111',timezone:'America/New_York',evidence:'Synthetic explicit text permission',capturedOn:'2026-10-01'})
  const prefs=async(d,channel,topics=['newsletter','appeals','events'],frequency='unlimited',extra={})=>h.command('communication.preferences',{donorId:d.id,channel,version:(await get(d)).channels.find(p=>p.channel===channel).version,topics,frequency,confirm:'yes'},extra)
  await prefs(a,'email',undefined,'monthly');await prefs(c,'email',undefined,'quarterly')
  const prepare=async(name,channel='email',extra={},headers={})=>{
   let as=h.owner
   if(headers['x-test-now']){
    const sent=await h.request('/auth/magic-link',{method:'POST',as:'',body:{email:'owner@example.test'},headers});assert.equal(sent.status,202)
    const message=h.messages.findLast(m=>JSON.stringify(m.to).includes('owner@example.test'))
    const link=message.text.match(/https?:\/\/[^\s<>]+\/auth\/confirm\?token=[^\s<>]+/)[0]
    const confirmed=await h.request('/auth/confirm',{method:'POST',as:'',body:{token:new URL(link).searchParams.get('token')},headers});assert.equal(confirmed.status,303)
    as=confirmed.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ')
   }
   return h.command('appeal.prepare',{name,channel,...extra},{headers,as})
  }
  const first=await prepare('Synthetic first preferences'),competing=await prepare('Synthetic competing preferences')
  assert.equal(first.recipients,3,'Preparation does not consume any frequency slot')
  for(const run of [first,competing])await h.command('appeal.approve',{appealId:run.id,version:1})
  await h.command('appeal.export',{appealId:first.id,version:2})
  assert.equal((await h.command('appeal.export',{appealId:competing.id,version:2},{status:409})).error,'COMMUNICATION_RESTRICTED','A competing prepared audience cannot exceed the channel limit')
  const second=await prepare('Synthetic second preferences')
  assert.equal(second.excluded.frequency,2);assert.equal(second.recipients,1)
  const november=await prepare('Synthetic November preferences','email',{}, {'x-test-now':'2026-11-01T16:00:00Z'})
  assert.equal(november.excluded.frequency,1,'Monthly resets while quarterly still holds')
  const january=await prepare('Synthetic January preferences','email',{}, {'x-test-now':'2027-01-01T16:00:00Z'})
  assert.equal(january.recipients,3,'Calendar quarter resets independently')
  await prepareVerifiedMail(h,{headers:{'x-test-now':at}})
  const mailBefore=await prepare('Synthetic independent mail channel','mail');assert.equal(mailBefore.recipients,3,'Email frequency never consumes a mail slot')
  const originalRestriction=(await file(a)).solicitation
  const beforePortal={preferences:await get(a),consents:(await file(a)).consents}
  const login=await signInPortal(h,'synthetic-coffer-9106@example.test'),as=login.cookie
  // URLSearchParams needs one pair per selected topic, as the native form sends.
  const portalSave=async(channel,topics,frequency='unlimited',extra={})=>{
   const fields=new URLSearchParams({action:'preferences',channel,version:String((await get(a)).channels.find(p=>p.channel===channel).version),frequency,confirm:'yes',...extra});for(const topic of topics)fields.append('topics',topic)
   return h.request('/giving/portal/communications',{method:'POST',as,headers:{'content-type':'application/x-www-form-urlencoded'},raw:fields.toString()})
  }
  assert.equal((await portalSave('mail',['newsletter','events'])).status,303)
  assert.equal((await portalSave('sms',['newsletter','events'])).status,303)
  assert.equal((await portalSave('phone',['newsletter','events'])).status,303)
  assert.equal((await portalSave('email',['newsletter','events'],'monthly')).status,303)
  const appended=(await file(a)).consents
  assert.deepEqual(appended.slice(4),beforePortal.consents,'Portal writes preserve every earlier consent row')
  assert.deepEqual(appended.slice(0,4).sort((x,y)=>x.channel.localeCompare(y.channel)).map(p=>({channel:p.channel,status:p.status,method:p.method,evidence:p.evidence,captured_on:p.captured_on,recorded_at:p.recorded_at,recorded_by:p.recorded_by})),[
   {channel:'email',status:'granted',method:'portal',evidence:'Communication preferences version 2; channel permission retained',captured_on:'2026-10-15',recorded_at:'2026-10-15T16:00:00.000Z',recorded_by:'Authenticated donor portal'},
   ...['mail','phone','sms'].map(channel=>({channel,status:'granted',method:'portal',evidence:'Communication preferences version 1; channel permission retained',captured_on:'2026-10-15',recorded_at:'2026-10-15T16:00:00.000Z',recorded_by:'Authenticated donor portal'}))
  ])
  const afterPortal=await get(a)
  assert.deepEqual(afterPortal.history.filter(p=>p.source!=='portal'),beforePortal.preferences.history)
  assert.deepEqual(afterPortal.history.filter(p=>p.source==='portal').map(p=>({channel:p.channel,version:p.version,topics:p.topics,frequency:p.frequency,source:p.source,recorded_at:p.recorded_at,recorded_by:p.recorded_by})),[
   {channel:'email',version:2,topics:['events','newsletter'],frequency:'monthly',source:'portal',recorded_at:'2026-10-15T16:00:00.000Z',recorded_by:'Authenticated donor portal'},
   ...['mail','phone','sms'].map(channel=>({channel,version:1,topics:['events','newsletter'],frequency:'unlimited',source:'portal',recorded_at:'2026-10-15T16:00:00.000Z',recorded_by:'Authenticated donor portal'}))
  ])
  assert.deepEqual((await file(a)).events.filter(e=>e.action==='communication.preferences'&&e.actor_role==='donor').map(e=>({actor_id:e.actor_id,actor_name:e.actor_name,at:e.at})),Array.from({length:4},()=>({actor_id:'donor:'+a.id,actor_name:'Authenticated donor portal',at:'2026-10-15T16:00:00.000Z'})))

  assert.equal((await portalSave('email',['appeals'],'unlimited',{donorId:b.id})).status,403)
  const stale=portalForm({action:'preferences',channel:'email',version:'0',frequency:'unlimited',topics:'appeals',confirm:'yes'},as)
  assert.equal((await h.request('/giving/portal/communications',stale)).status,409)
  assert.equal((await h.request('/giving/portal/communications',{...stale,as:''})).status,303)
  assert.equal((await h.request('/giving/portal/communications',{...stale,headers:{...stale.headers,origin:'https://other.example.test'}})).status,403)
  await prepareVerifiedMail(h,{headers:{'x-test-now':at}})
  const mail=await prepare('Synthetic topics mail','mail');assert.equal(mail.excluded.topic,1)
  assert.deepEqual((await h.get('/api/coffer/appeals/'+mail.id)).recipients.map(r=>r.donor_id).sort(),[b.id,c.id].sort(),'Postal topic exclusion removes Amelia alone')
  const email=await prepare('Synthetic topics email');assert.equal(email.excluded.topic,1)
  assert.deepEqual((await h.get('/api/coffer/appeals/'+email.id)).recipients.map(r=>r.donor_id),[b.id],'Email topic and frequency exclusions retain Jordan alone')
  const newsletter=await prepare('Synthetic retained newsletter','email',{purpose:'newsletter'});assert.equal(newsletter.recipients,3,'Newsletter retains its topic despite appeal limits and removal')
  const sms=await h.command('sms.prepare',{name:'Synthetic topic text',purpose:'appeal',donorIds:[a.id],body:'Synthetic appeal'})
  assert.deepEqual(sms.excluded.map(r=>r.reason),['topic'])
  const thanks=await h.command('sms.prepare',{name:'Synthetic transactional text',purpose:'thank-you',donorIds:[a.id],body:'Thank you for your gift.'});assert.equal(thanks.recipients,1)
  await h.command('sms.discard',{runId:thanks.id,version:1})
  const owner=(await h.get('/auth/session')).operator.id
  assert.equal((await h.command('task.create',{donorId:a.id,ownerId:owner,dueOn:'2026-10-16',kind:'call',title:'Synthetic appeal call',isAsk:true},{status:409})).message,'topic')
  const agedGifts=[]
  for(const d of [a,b])agedGifts.push(await h.command('gift.record',{donorId:d.id,amount:'250',receivedOn:'2025-06-01',method:'check',goods:'none'}))
  const ranked=await h.command('calls.rank',{managerId:owner})
  assert.deepEqual(ranked.entries.map(row=>row.donor_id),[b.id],'Weekly ranking excludes a topic-blocked ask without losing the eligible caller')
  assert.equal(ranked.excluded.topic,1)
  const receipt=await h.command('ack.prepare',{giftIds:[agedGifts[0].id],onePiecePer:'gift'})
  await h.command('ack.approve',{batchId:receipt.id,version:1})
  assert.equal((await h.command('ack.send',{batchId:receipt.id,version:2})).submitted,1,'Topic withdrawals never stop a transactional receipt')
  const newsletterId=await channelFrequencyJourney(h,{donor:b,control:c,ranked,owner,at,prefs})
  const current=await file(a);assert.equal(current.current.email.status,'granted');assert.equal(current.current.mail.status,'granted');assert.equal(current.consents.find(row=>row.channel==='sms').status,'granted');assert.equal(current.consents.find(row=>row.channel==='phone').status,'granted');assert.deepEqual(current.solicitation,originalRestriction)
  const history=(await get(a)).history;assert.equal(history.filter(p=>p.source==='portal').length,4)
  const member=await h.person('synthetic-coffer-9109@example.test')
  await prefs(b,'email',[], 'unlimited',{as:member.cookie,status:403})
  const ccBefore=(await file(b)).current.email.id
  await h.command('marketing.constantContactConnect',{token:'synthetic-coffer-9104',newsletterListId:'synthetic-coffer-9101',appealsListId:'synthetic-coffer-9110',frequencyField:'synthetic-coffer-9113',confirm:'yes'})
  await h.command('marketing.constantContactSync',{donorId:b.id})
  assert.ok(!(await get(b)).channels.find(p=>p.channel==='email').topics.includes('appeals'),'Mapped provider topic removal is imported without a grant')
  assert.equal((await get(b)).channels.find(p=>p.channel==='email').frequency,'quarterly','Mapped Constant Contact frequency is retained')
  cc.permission='unsubscribed';await h.command('marketing.constantContactSync',{donorId:b.id})
  const withdrawal=(await file(b)).current.email;assert.equal(withdrawal.status,'withdrawn');assert.equal(withdrawal.method,'constant-contact');assert.ok(withdrawal.id>ccBefore)
  await h.command('marketing.constantContactSync',{donorId:b.id});assert.equal((await file(b)).current.email.id,withdrawal.id,'Repeated provider withdrawal is idempotent')
  if(browser)await communicationPreferencesBrowser(h,as,a.id,owner,newsletterId)
  await h.command('marketing.constantContactDisconnect',{})
  await communicationAuthorityJourney(h,at)
  const source=await donor(h,'Synthetic Preference Original',{email:'synthetic-coffer-9111@example.test'}),target=await donor(h,'Synthetic Preference Survivor',{email:'synthetic-coffer-9112@example.test'})
  await prefs(source,'email',['newsletter'],'quarterly')
  const originalSource=await get(source),originalTarget=await get(target)
  const merged=await h.command('donor.merge',{sourceDonorId:source.id,sourceVersion:(await file(source)).donor.version,donorId:target.id,version:(await file(target)).donor.version,reason:'duplicate_record'})
  const mergedPreferences=await get(target),effective=mergedPreferences.channels.find(p=>p.channel==='email')
  assert.deepEqual(effective.topics,['newsletter']);assert.equal(effective.frequency,'quarterly');assert.equal(effective.inherited[0].donor_id,source.id,'Merge retains the original preference identity')
  const snapshot=await archive(h)
  await run(async copied=>{
   await restore(copied,snapshot)
   assert.deepEqual(await copied.get('/api/coffer/donors/'+a.id+'/preferences'),await get(a),'All original preference versions survive archive restoration')
   assert.deepEqual(await copied.get('/api/coffer/donors/'+target.id+'/preferences'),mergedPreferences)
   await copied.command('donor.unmerge',{mergeId:merged.mergeId,reason:'incorrect_match'})
   assert.deepEqual(await copied.get('/api/coffer/donors/'+source.id+'/preferences'),originalSource)
   assert.deepEqual(await copied.get('/api/coffer/donors/'+target.id+'/preferences'),originalTarget)
   await copied.command('donor.erase',{donorId:a.id,confirm:'ERASE'})
   assert.equal((await copied.get('/api/coffer/donors/'+a.id+'/preferences')).history.length,0,'Erasure removes preference custody')
  },{entry:'tests/engagement-worker.ts',bindings:{COFFER_TEST_NOW:at}})
 },options)
 await communicationClaimsJourney()
 await communicationProviderJourney()
}
