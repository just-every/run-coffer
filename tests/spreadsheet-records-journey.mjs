import assert from 'node:assert/strict'
import {run,donor,reviewed} from './harness.mjs'
import {verifiedMailBindings} from './verified-mail-edge.mjs'
const key=n=>'synthetic-coffer-'+n
const post=(h,action,input,options)=>h.api('/api/coffer/move-in/'+action,input,options)
const move=async(h,input)=>{const p=await post(h,'preview',input);assert.equal(p.canApply,true,JSON.stringify(p.diagnostics));assert.equal(p.needsAcceptance,false,JSON.stringify(p.unmapped));let j=await post(h,'apply',{id:p.id,fingerprint:p.fingerprint,acknowledged:'no'});while(j.state==='applying')j=await post(h,'continue',{id:p.id});assert.equal(j.state,'completed');return p}

export async function spreadsheetRecordsJourney(makeFiles) {
 await run(async h=>{
  const field={source:'spreadsheet',column:'MemberClass',key:'member_class',label:'Member class',kind:'constituent',type:'text',entry:'pick-one',choices:['Reader','Tutor']}
  await h.command('custom.define',field)
  const mapping={name:'Constituents',recordType:'donor',columns:[{column:'OurID',field:'donorId'},{column:'Given',field:'firstName'},{column:'Family',field:'lastName'},{column:'Hello',field:'informalName'},{column:'InTouch',field:'constituentStatus'},{column:'PauseReason',field:'statusReason'}]}
  const input={source:'spreadsheet',spreadsheet:mapping,customFields:[{...field,version:1}],files:await makeFiles([['people',[['OurID','Given','Family','Hello','InTouch','PauseReason','MemberClass'],[key(6201),'Quinn','Reader','Dear Quinn','inactive','Source pause','Tutor']]]],'xlsx')}
  const p=await move(h,input),person=(await h.get('/api/coffer/donors')).donors[0],history=await h.get('/api/coffer/donors/'+person.id)
  assert.deepEqual([history.donor.first_name,history.donor.last_name,history.donor.informal_salutation,history.donor.constituent_status],['Quinn','Reader','Dear Quinn','inactive'])
  assert.equal(history.customValues[0].value,'"Tutor"')
  await post(h,'undo',{id:p.id});assert.equal((await h.get('/api/coffer/donors')).total,0)
  assert.equal((await h.get('/api/coffer/custom-fields')).fields.find(f=>f.key==='member_class').version,1,'A pre-existing definition survives undo')
  const native=await donor(h,'Morgan Existing',{email:[key(6202),'example.test'].join('@')})
  const interactionInput={source:'spreadsheet',spreadsheet:{name:'Conversations',recordType:'note',columns:[{column:'ConversationID',field:'noteId'},{column:'PersonID',field:'donorId'},{column:'Conversation',field:'note'},{column:'HeldOn',field:'noteDate'},{column:'Kind',field:'noteType'}],donorMatches:{[key(6203)]:{id:native.id,version:native.version}}},customFields:[{source:'spreadsheet',column:'Attendees',key:'meeting_attendees',label:'Attendees',kind:'interaction',type:'number',entry:'free-form',choices:[]}],files:await makeFiles([['conversations',[['ConversationID','PersonID','Conversation','HeldOn','Kind','Attendees'],[key(6204),key(6203),'Discussed the reading program','2026-09-01','meeting','3']]]],'csv')}
  const conversation=await move(h,interactionInput),details=await h.get('/api/coffer/donors/'+native.id)
  assert.equal(details.depth.interactions[0].notes,'Discussed the reading program');assert.equal(details.depth.interactions[0].kind,'meeting');assert.equal(details.customValues[0].value,'"3"')
  assert.equal(details.donor.name,'Morgan Existing');assert.equal(details.gifts.length,0)
  await post(h,'undo',{id:conversation.id});assert.equal((await h.get('/api/coffer/donors/'+native.id)).depth.interactions.length,0)
  assert.equal((await h.get('/api/coffer/custom-fields')).fields.some(f=>f.key==='meeting_attendees'),false)
  const gifts={source:'spreadsheet',spreadsheet:{name:'Gifts only',recordType:'gift',columns:[{column:'Gift',field:'giftId'},{column:'Person',field:'donorId'},{column:'Amount',field:'amount'},{column:'Date',field:'date'},{column:'Goods',field:'goodsAmount'},{column:'Paid',field:'method'}],donorMatches:{[key(6203)]:{id:native.id,version:(await h.get('/api/coffer/donors/'+native.id)).donor.version}}},files:await makeFiles([['gifts',[['Gift','Person','Amount','Date','Goods','Paid'],[key(6205),key(6203),'37.25','2026-09-01','0','cash']]]],'csv')}
  const gift=await move(h,gifts);assert.equal((await h.get('/api/coffer/donors/'+native.id)).totals.lifetimeCents,3725)
  await post(h,'undo',{id:gift.id});assert.equal((await h.get('/api/coffer/donors/'+native.id)).totals.lifetimeCents,0)
 })
}

export async function spreadsheetAddressJourney(makeFiles) {
 let provider='ok',submissions=0
 await run(async h=>{
  await reviewed(h)
  const state=await h.get('/api/coffer/addresses')
  await h.command('address.processing',{version:state.connection.version,enabled:'yes',pafSigner:'Synthetic signer',pafSignedOn:'2026-01-01',pafLicensee:'Melissa',pafReference:key(6300),reviewed:'yes'})
  const input={source:'spreadsheet',spreadsheet:{name:'Verified entry',recordType:'donor',columns:[{column:'Person',field:'donorId'},{column:'Name',field:'name'},{column:'Street',field:'addressLine1'},{column:'City',field:'city'},{column:'State',field:'region'},{column:'ZIP',field:'postalCode'}]},files:await makeFiles([['people',[['Person','Name','Street','City','State','ZIP'],[key(6301),'Taylor Address','12 reading st','Madison','WI','53703']]]],'csv')}
  const p=await post(h,'preview',input);assert.equal(p.canApply,true);assert.equal(submissions,0,'Preview sends no donor data to the address provider')
  provider='error'
  await post(h,'apply',{id:p.id,fingerprint:p.fingerprint,acknowledged:'no'},{status:502})
  assert.equal((await h.get('/api/coffer/donors')).total,0,'A verification error saves no constituent or changed address')
  provider='ok'
  const finished=await post(h,'continue',{id:p.id});assert.equal(finished.state,'completed')
  const person=(await h.get('/api/coffer/donors')).donors[0],history=await h.get('/api/coffer/donors/'+person.id),address=await h.get('/api/coffer/donors/'+person.id+'/addresses')
  assert.equal(history.donor.address_line1,'12 READING ST');assert.equal(address.check.status,'verified');assert.equal(address.history[0].address_line1,'12 reading st');assert.equal(address.history[0].source,'spreadsheet source before verification')
  await h.command('appeal.prepare',{name:'No reusable postal pass',channel:'mail'},{status:409})
  await post(h,'undo',{id:p.id});assert.equal((await h.get('/api/coffer/donors')).total,0)
 },{bindings:verifiedMailBindings,outbound:async request=>{
  assert.equal(new URL(request.url).hostname,'us-street.api.smarty.com');submissions++
  if(provider==='error')return new Response('Unavailable',{status:503})
  const [r]=await request.json()
  return Response.json([{input_id:r.input_id,input_index:0,delivery_line_1:'12 READING ST',delivery_line_2:'',components:{city_name:'Madison',state_abbreviation:'WI',zipcode:'53703'},analysis:{dpv_match_code:'Y',dpv_vacant:'N',dpv_no_stat:'N',dpv_footnotes:'AABB'}}])
 }})
}
