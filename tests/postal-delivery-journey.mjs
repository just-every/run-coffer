import {postalRecovery} from './postal-recovery-journey.mjs'
import {postalBrowser} from './postal-delivery-browser.mjs'
import assert from 'node:assert/strict'
import {createHmac} from 'node:crypto'
import {archive,donor,installation,restore,reviewed,run} from './harness.mjs'

const names=['Rowan Patel','Morgan Patel','Avery Chen','Taylor Brooks','Jamie Ortiz']
const signingSecret='synthetic-coffer-800',apiCredential='synthetic-coffer-801'
const eventNames={'letter.mailed':'Mailed','letter.in_transit':'In Transit','letter.delivered':'Delivered','letter.returned_to_sender':'Returned to Sender'}
async function providerEvent(h,piece,type,eventId,extra={}){
 const occurred='2025-08-20T14:30:00.000Z',timestamp=extra.signatureTimestamp??String(Math.floor(Date.now()/1000))
 const body={id:piece.id,metadata:piece.request.metadata,tracking_events:eventNames[type]?[{id:'synthetic-coffer-802',name:eventNames[type],time:occurred}]:[],...extra.body}
 const raw=JSON.stringify({id:eventId,reference_id:piece.id,event_type:{id:type},date_created:'2025-08-21T20:00:00.000Z',body})
 return h.request('/api/coffer/postal/events',{method:'POST',as:'',raw,headers:{'lob-signature-timestamp':timestamp,'lob-signature':extra.signature??createHmac('sha256',signingSecret).update(timestamp+'.'+raw).digest('hex')}})
}
const give=(h,donorId)=>h.command('gift.record',{donorId,amount:'250',receivedOn:'2025-08-10',method:'check',goods:'none'})

export async function postalDeliveryJourney(){
 const pieces=[],messages=[]
 await run(async h=>{
  await reviewed(h)
  const member=await h.person('synthetic-coffer-803@example.test'),admin=await h.person('synthetic-coffer-804@example.test','admin')
  const agent=await h.command('agent.create',{label:'synthetic-coffer-805'}),agentAccess={as:'',headers:{authorization:'Bearer '+agent.token}}
  const people=[]
  for(let n=1;n<=5;n++)people.push(await donor(h,names[n-1],{email:`synthetic-coffer-${n}@example.test`,...(n<3?{household:'Patel household'}:{})}))
  const gifts=[];for(const person of people)gifts.push(await give(h,person.id))
  const batch=await h.command('ack.prepare',{onePiecePer:'household'}),detail=await h.get(`/api/coffer/letters/${batch.id}`)
  assert.equal(detail.letters.length,5);assert.equal(detail.mailPieces.length,4)
  const approval={batchId:batch.id,version:1,contentHash:detail.batch.content_hash,approvePostage:true}
  await h.command('ack.sendPostal',approval,{status:409})
  await h.command('ack.approve',{batchId:batch.id,version:1})
  const input={...approval,version:2}
  await h.command('ack.sendPostal',input,{as:'',status:401})
  await h.command('ack.sendPostal',input,{as:member.cookie,status:403})
  await h.command('ack.sendPostal',input,{...agentAccess,status:403})
  await h.command('ack.sendPostal',{...input,approvePostage:false},{status:409})
  await h.command('ack.sendPostal',{...input,contentHash:'synthetic-coffer-807'},{status:409})
  await h.command('ack.sendPostal',{...input,version:1},{status:409})
  assert.equal(pieces.length,0)
  const original=(await h.get(`/api/coffer/donors/${people[2].id}`)).donor
  await h.command('donor.update',{donorId:original.id,version:original.version,name:original.name,email:original.email,addressLine1:'synthetic-coffer-808',city:'synthetic-coffer-809',region:'IL',postalCode:'62702'})
  await postalBrowser(h,{batchId:batch.id,admin:admin.cookie,authorize:true})
  const sent=await h.command('ack.sendPostal',{...input,version:(await h.get(`/api/coffer/letters/${batch.id}`)).batch.version})
  assert.equal(pieces.length,4);assert.equal(sent.postal.length,4);assert.equal(sent.remaining,0)
  assert.deepEqual(sent.postal.map(p=>p.state).sort(),['rejected','submitted','submitted','uncertain'])
  const deliveredPiece=pieces.find(p=>p.request.to.name.includes(names[2]))
  assert.ok(deliveredPiece);assert.equal(deliveredPiece.request.to.address_line1,'1 Main Street','Postal sending uses the frozen approved address')
  for(const piece of pieces){assert.equal(piece.request.use_type,'operational');assert.equal(piece.request.address_placement,'insert_blank_page');assert.equal(piece.request.double_sided,false);assert.equal(piece.request.color,false);assert.ok(piece.request.file.includes('No goods or services'))}
  const groupedPiece=pieces.find(p=>detail.mailPieces.find(m=>m.id===p.request.metadata.coffer_piece_id&&JSON.parse(m.letter_ids).length===2))
  assert.ok(groupedPiece)
  const grouped=detail.mailPieces.find(m=>m.id===groupedPiece.request.metadata.coffer_piece_id)
  const groupedLetters=JSON.parse(grouped.letter_ids).map(id=>detail.letters.find(l=>l.id===id))
  assert.equal(groupedLetters.length,2)
  for(const letter of groupedLetters)assert.ok(groupedPiece.request.file.includes(`Receipt ${letter.receipt_year}-${letter.receipt_sequence}`))
  const beforeEvents=await h.get(`/api/coffer/letters/${batch.id}`)
  assert.equal(beforeEvents.deliveryEvents.length,0,'A successful Lob submission never invents USPS delivery')
  assert.equal(beforeEvents.letters.filter(l=>l.delivery_status==='submitted').length,3)
  assert.equal(beforeEvents.letters.filter(l=>l.delivery_status==='uncertain').length,1)
  assert.equal(beforeEvents.letters.filter(l=>l.delivery_status==='rejected').length,1)
  const ack=(await h.get(`/api/coffer/donors/${people[2].id}`)).gifts.find(g=>g.id===gifts[2].id).acknowledgment
  assert.equal(ack.status,'acknowledged');assert.equal(ack.method,'letter')
  await h.command('ack.sendPostal',{...input,version:sent.version})
  assert.equal(pieces.length,4,'Repeated owner actions never retry rejected or uncertain pieces')
  assert.equal((await providerEvent(h,groupedPiece,'letter.in_transit','synthetic-coffer-810',{signature:'0'.repeat(64)})).status,401)
  assert.equal((await providerEvent(h,groupedPiece,'letter.in_transit','synthetic-coffer-811',{signatureTimestamp:'1577836800'})).status,401)
  const stale=await providerEvent(h,groupedPiece,'letter.delivered','synthetic-coffer-812',{body:{metadata:{...groupedPiece.request.metadata,coffer_attempt_id:'synthetic-coffer-813'}}})
  assert.equal(stale.status,200);assert.equal((await stale.json()).recorded,0)
  assert.equal((await h.get(`/api/coffer/letters/${batch.id}`)).deliveryEvents.length,0)
  assert.equal((await providerEvent(h,groupedPiece,'letter.in_transit','synthetic-coffer-814')).status,200)
  let tracked=await h.get(`/api/coffer/letters/${batch.id}`)
  assert.equal(tracked.deliveryEvents.length,2);assert.equal(tracked.letters.filter(l=>l.delivery_status==='delivered').length,0)
  assert.equal((await providerEvent(h,deliveredPiece,'letter.delivered','synthetic-coffer-815',{body:{metadata:null}})).status,200,'Redacted metadata still binds the exact known Lob resource')
  assert.equal((await providerEvent(h,deliveredPiece,'letter.delivered','synthetic-coffer-815',{body:{metadata:null}})).status,200)
  assert.equal((await providerEvent(h,groupedPiece,'letter.returned_to_sender','synthetic-coffer-816')).status,200)
  assert.equal((await providerEvent(h,groupedPiece,'letter.returned_to_sender','synthetic-coffer-816')).status,200)
  assert.equal((await providerEvent(h,groupedPiece,'letter.delivered','synthetic-coffer-817')).status,200)
  tracked=await h.get(`/api/coffer/letters/${batch.id}`)
  assert.equal(tracked.deliveryEvents.length,7)
  const failureEvents=tracked.deliveryEvents.filter(e=>e.provider_event==='letter.returned_to_sender')
  assert.equal(failureEvents.length,2)
  for(const event of failureEvents){assert.equal(event.provider,'Lob');assert.equal(event.signature_verified,1);assert.equal(event.provider_message_id,groupedPiece.id);assert.equal(event.postal_piece_id,grouped.id);assert.equal(event.occurred_at,'2025-08-20T14:30:00.000Z');assert.ok(event.provider_attempt_id)}
  for(const letter of groupedLetters){const actual=tracked.letters.find(l=>l.id===letter.id);assert.equal(actual.delivery_status,'bounced');assert.equal(actual.route,'print')}
  const deliveredDonor=await h.get(`/api/coffer/donors/${people[2].id}`)
  assert.equal(deliveredDonor.letters.find(l=>l.batch_id===batch.id).delivery_status,'delivered')
  const page=await (await h.request(`/app/donors/${people[0].id}?timelineKind=receipt&timelineFrom=2025-08-20&timelineTo=2025-08-20`)).text()
  assert.ok(page.includes('letter.returned_to_sender'));assert.ok(page.includes('Lob'))
  const filtered=await (await h.request(`/app/donors/${people[0].id}?timelineKind=call&timelineFrom=2025-08-20&timelineTo=2025-08-20`)).text()
  assert.ok(!filtered.includes('letter.returned_to_sender'))
  const task=(await h.get(`/api/coffer/donors/${people[0].id}`)).receiptTasks
  const otherTask=(await h.get(`/api/coffer/donors/${people[1].id}`)).receiptTasks
  assert.equal(task.length,1);assert.equal(otherTask.length,1);assert.notEqual(task[0].letter_id,otherTask[0].letter_id)
  assert.ok((await (await h.request(`/app/donors/${people[0].id}`)).text()).includes('Fix postal address'))
  const printed=await h.request(`/app/letters/${batch.id}/print?letter=${task[0].letter_id}`)
  assert.equal(printed.status,200);assert.ok((await printed.text()).includes(names[0]))
  await postalBrowser(h,{batchId:batch.id,donorId:people[0].id,stage:'tracking'})
  await h.command('receiptTask.complete',{taskId:task[0].id,version:1,resolution:'Confirmed the corrected postal address with the donor by phone.'},{...agentAccess,status:403})
  await h.command('receiptTask.complete',{taskId:task[0].id,version:1,resolution:'Confirmed the corrected postal address with the donor by phone.'},{as:member.cookie})
  await h.command('receiptTask.complete',{taskId:task[0].id,version:1,resolution:'Second completion refused.'},{status:409})
  const completed=(await h.get(`/api/coffer/donors/${people[0].id}`)).receiptTasks[0]
  assert.ok(completed.completed_at);assert.equal(completed.resolution,'Confirmed the corrected postal address with the donor by phone.')
  assert.equal((await h.get(`/api/coffer/donors/${people[0].id}`)).letters.find(l=>l.id===task[0].letter_id).delivery_status,'bounced')
  assert.ok((await h.get('/api/coffer/audit?action=receiptTask.complete')).rows.some(e=>e.subject_id===task[0].id))
  await postalBrowser(h,{batchId:batch.id,donorId:people[0].id,stage:'completed'})
  await postalRecovery(h,{pieces,messages,providerEvent})
  const snapshot=await archive(h),serialized=JSON.stringify(snapshot)
  assert.ok(!serialized.includes(signingSecret));assert.ok(!serialized.includes(apiCredential))
  const fresh=await installation()
  try{await restore(fresh,snapshot);const restored=await fresh.get(`/api/coffer/letters/${batch.id}`);assert.deepEqual(restored.deliveryEvents,tracked.deliveryEvents);assert.deepEqual((await fresh.get(`/api/coffer/donors/${people[0].id}`)).receiptTasks,(await h.get(`/api/coffer/donors/${people[0].id}`)).receiptTasks);await fresh.command('ack.sendPostal',{...input,version:sent.version},{status:503})}finally{await fresh.close()}
  const survivor=await donor(h,'synthetic-coffer-820',{email:'synthetic-coffer-820@example.test'})
  const source=(await h.get(`/api/coffer/donors/${people[0].id}`)).donor,target=(await h.get(`/api/coffer/donors/${survivor.id}`)).donor
  const merged=await h.command('donor.merge',{sourceDonorId:source.id,donorId:target.id,sourceVersion:source.version,version:target.version,reason:'duplicate_record'})
  assert.ok((await h.get(`/api/coffer/donors/${survivor.id}`)).receiptTasks.some(t=>t.id===task[0].id))
  await h.command('donor.unmerge',{mergeId:merged.mergeId,reason:'incorrect_match'})
  assert.ok((await h.get(`/api/coffer/donors/${people[0].id}`)).receiptTasks.some(t=>t.id===task[0].id))
  await h.command('donor.erase',{donorId:people[0].id,confirm:'ERASE'})
  assert.ok(!JSON.stringify(await archive(h)).includes('Confirmed the corrected postal address with the donor by phone.'))
  const afterErase=await providerEvent(h,groupedPiece,'letter.returned_to_sender','synthetic-coffer-821')
  assert.equal(afterErase.status,200);assert.equal((await afterErase.json()).recorded,1,'Erased documents cannot receive new provider events or address tasks')
 },{bindings:{LOB_ENABLED:'true',LOB_API_KEY:apiCredential,LOB_WEBHOOK_SECRET:signingSecret,LOB_FROM_ADDRESS_ID:'synthetic-coffer-822'},outbound:async request=>{
  if(new URL(request.url).hostname==='api.sendgrid.com'){messages.push(await request.json());return new Response(null,{status:202,headers:{'x-message-id':'synthetic-coffer-853'}})}
  assert.equal(new URL(request.url).hostname,'api.lob.com');assert.equal(new URL(request.url).pathname,'/v1/letters');assert.equal(request.method,'POST')
  const body=await request.json(),id='synthetic-coffer-'+(830+pieces.length),piece={id,request:body}
  assert.equal(request.headers.get('idempotency-key'),body.metadata.coffer_attempt_id);assert.equal(request.headers.get('authorization'),'Basic '+Buffer.from(apiCredential+':').toString('base64'))
  pieces.push(piece)
  if(body.to.name.includes(names[3]))throw new Error('synthetic-coffer-823')
  if(body.to.name.includes(names[4]))return Response.json({error:{message:'synthetic-coffer-824'}},{status:422})
  return Response.json({id,object:'letter'})
 }})
}
