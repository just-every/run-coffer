import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
const recorded=JSON.parse(await readFile(new URL('./fixtures/mango/audience.json',import.meta.url),'utf8'))
import {run,donor} from './harness.mjs'

// Faked only at Mango's network boundary; Coffer runs its real Worker and D1.
test('Mango opt-out suppresses Coffer appeals, and a Coffer email withdrawal is confirmed in Mango',()=>{
 const contacts=new Map(),imports=[]
 let nextImport
 return run(async h=>{
  const d=await donor(h,'Avery Chen',{email:recorded.contacts[0].email}),other=await donor(h,'Jordan Brooks',{email:recorded.contacts[1].email})
  for(const row of [d,other]){
   const fixture=recorded.contacts[row.id===d.id?0:1],email=fixture.email
   contacts.set(email,{...fixture,id:row.id})
   await h.command('consent.record',{donorIds:[row.id],channel:'email',status:'granted',method:'paper form',evidence:'Synthetic explicit opt-in',capturedOn:'2025-01-01'})
   await h.command('gift.record',{donorId:row.id,amount:'250',receivedOn:'2025-03-02',method:'check',goods:'none',fund:'Library'})
  }
  const frozen=await h.command('appeal.prepare',{name:'Library renewal',channel:'email',fund:'Library',subject:'Thank you, {{donor_name}}',body:'Your {{gift_count}} gift totals {{total_given}}. Your latest gift was {{last_gift}}.'})
  assert.equal(frozen.recipients,2)
  // Mango records a real donor opt-out at the network edge. No webhook or
  // untrusted caller is allowed to write Coffer consent directly.
  contacts.get(recorded.contacts[0].email).emailStatus='unsubscribed'
  await h.command('marketing.sync',{}, {as:'',status:401})
  await h.command('marketing.sync')
  const history=await h.get(`/api/coffer/donors/${d.id}`)
  assert.equal(history.current.email.status,'withdrawn')
  assert.equal(history.marketingPreference.state,'suppressed')
  assert.ok(history.events.some(e=>e.action==='marketing.unsubscribe'))
  await h.command('appeal.approve',{appealId:frozen.id,version:1},{status:409})
  const later=await h.command('appeal.prepare',{name:'Renewed consent check',channel:'email',fund:'Library'})
  const eligible=await h.get(`/api/coffer/appeals/${later.id}`)
  assert.deepEqual(eligible.recipients.map(r=>r.donor_id),[other.id])
  await h.command('consent.record',{donorIds:[other.id],channel:'email',status:'withdrawn',method:'email reply',evidence:'Synthetic donor asked to stop',capturedOn:'2025-03-04'})
  assert.equal(contacts.get(recorded.contacts[1].email).emailStatus,'unsubscribed')
  assert.equal(imports.length,1)
  assert.equal(imports[0].files[0].preset,'csv-unsubscribed')
  assert.ok(imports[0].files[0].csv.includes(recorded.contacts[1].email))
  const reverse=await h.get(`/api/coffer/donors/${other.id}`)
  assert.equal(reverse.current.email.status,'withdrawn')
  assert.equal(reverse.marketingPreference.state,'suppressed')
  await h.command('marketing.sync')
  assert.equal(imports.length,1,'Reconciliation does not repeat a confirmed restriction')
 },{bindings:{MANGO_ORIGIN:'https://mango.example.test',MANGO_SESSION_COOKIE:'operator_session=network-edge',COFFER_REPLY_ADDRESS:'replies@example.test'},outbound:async request=>{
  const u=new URL(request.url)
  assert.equal(u.origin,'https://mango.example.test')
  assert.equal(request.headers.get('origin'),u.origin)
  assert.equal(request.headers.get('cookie'),'operator_session=network-edge')
  if(u.pathname==='/api/contacts/search')return Response.json({contacts:[...contacts.values()].filter(c=>c.email.includes(u.searchParams.get('address')))})
  if(u.pathname==='/api/audience/import-preview'){
   nextImport=await request.json();imports.push(nextImport)
   return Response.json({fingerprint:'reviewed-opt-out'})
  }
  if(u.pathname==='/api/audience/imports'){
   const input=await request.json();assert.equal(input.fingerprint,'reviewed-opt-out')
   for(const c of contacts.values())if(nextImport.files[0].csv.includes(c.email))c.emailStatus='unsubscribed'
   return Response.json({job:{id:'opt-out-import',state:'completed'}})
  }
  assert.fail(`Unexpected Mango request ${request.method} ${u.pathname}`)
 }})
})
