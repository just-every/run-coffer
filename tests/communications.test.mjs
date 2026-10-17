import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {run,donor} from './harness.mjs'
const recorded=JSON.parse(await readFile(new URL('./fixtures/mango/audience.json',import.meta.url),'utf8'))
const chimp=JSON.parse(await readFile(new URL('./fixtures/mailchimp/responses.json',import.meta.url),'utf8'))
const form=(h,fields)=>h.request('/app/actions',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams(fields).toString()})

async function consenting(h,names){
 const rows=[]
 for(const [i,name] of names.entries()){
  const row=await donor(h,name,{email:recorded.contacts[i].email})
  await h.command('consent.record',{donorIds:[row.id],channel:'email',status:'granted',method:'paper form',evidence:'Synthetic explicit opt-in',capturedOn:'2025-01-01'})
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

// Faked only at Mango's network edge, with its scoped integration API; Coffer runs its real Worker and D1.
test('Connect Mango from the page, send an approved appeal to a Mango list, and keep opt-outs in step',()=>{
 // A synthetic credential: Mango is faked at its network edge.
 const contacts=new Map(),lists=new Map(),suppressions=[],credential=`coffer-test-${process.pid}`
 return run(async h=>{
  const [avery,jordan]=await consenting(h,['Avery Chen','Jordan Brooks'])
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
  const list=lists.get('Coffer appeal · Library renewal · '+(await h.get(`/api/coffer/appeals/${frozen.id}`)).appeal.prepared_at.slice(0,10))
  assert.deepEqual([...list].sort(),[recorded.contacts[0].email,recorded.contacts[1].email].sort())
  const finish=await (await h.request(`/app/appeals/${frozen.id}`)).text()
  assert.match(finish,/Finish in Mango/);assert.match(finish,/displayName \| fallback/)
  assert.equal((await h.command('appeal.send',{appealId:frozen.id,version:2})).listed,0,'Pressing again lists nobody twice')
  // A Mango unsubscribe becomes a Coffer withdrawal; a Coffer withdrawal becomes a Mango suppression.
  contacts.get(recorded.contacts[0].email).emailStatus='unsubscribed'
  await h.command('marketing.sync')
  assert.equal((await h.get(`/api/coffer/donors/${avery.id}`)).current.email.status,'withdrawn')
  await h.command('consent.record',{donorIds:[jordan.id],channel:'email',status:'withdrawn',method:'email reply',evidence:'Synthetic donor asked to stop',capturedOn:'2025-03-04'})
  assert.deepEqual(suppressions.map(s=>s.email),[recorded.contacts[1].email])
  assert.equal((await h.get(`/api/coffer/donors/${jordan.id}`)).marketingPreference.state,'suppressed')
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
   contacts.set(body.email,contact)
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
test('Connect Mailchimp with an API key and audience, then send an approved appeal as a segment campaign',()=>{
 // A synthetic key: its -us21 suffix only picks the faked datacenter host.
 const calls=[],apiKey=[`coffer${process.pid}`,'us21'].join('-')
 return run(async h=>{
  await consenting(h,['Avery Chen'])
  const frozen=await appeal(h)
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
 },{outbound:async request=>{
  const u=new URL(request.url),key=`${request.method} ${u.pathname}`;calls.push(key)
  assert.equal(u.origin,'https://us21.api.mailchimp.com')
  assert.equal(request.headers.get('authorization'),`Bearer ${apiKey}`)
  if(key==='GET /3.0/lists')return Response.json({lists:[{id:'fixture-list',name:'Fixture audience',stats:{member_count:1}}]})
  if(/^GET \/3.0\/lists\/fixture-list\/members\//.test(key))return Response.json(chimp.member_subscribed)
  if(key==='POST /3.0/lists/fixture-list/segments')return Response.json(chimp.static_segment)
  if(key==='GET /3.0/lists/fixture-list/segments/101/members')return Response.json(chimp.segment_members)
  if(key==='POST /3.0/campaigns')return Response.json(chimp.campaign_saved)
  if(key==='GET /3.0/campaigns/fixture-campaign')return Response.json(calls.includes('POST /3.0/campaigns/fixture-campaign/actions/send')?chimp.campaign_sent:chimp.campaign_saved)
  if(key==='PATCH /3.0/campaigns/fixture-campaign')return Response.json(chimp.campaign_saved)
  if(key==='PUT /3.0/campaigns/fixture-campaign/content')return Response.json(chimp.content_saved)
  if(key==='POST /3.0/campaigns/fixture-campaign/actions/send')return new Response(null,{status:204})
  if(key==='GET /3.0/reports/fixture-campaign/sent-to')return Response.json(chimp.sent_to)
  assert.fail(`Unexpected Mailchimp request ${key}`)
 }})
})
