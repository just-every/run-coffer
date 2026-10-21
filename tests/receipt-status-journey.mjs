import assert from 'node:assert/strict'
import {generateKeyPairSync,sign} from 'node:crypto'
import {run,donor,reviewed,settings,archive,restore} from './harness.mjs'

const day=new Date(Date.now()-86400000*2).toISOString().slice(0,10)
const gift=(h,donorId,amount)=>h.command('gift.record',{donorId,amount,receivedOn:day,method:'check',goods:'none'})
const read=async(h,donorId,giftId)=>(await h.get(`/api/coffer/donors/${donorId}`)).gifts.find(g=>g.id===giftId).acknowledgment

export async function receiptStatusJourney(){
 await run(async h=>{
  await reviewed(h)
  const d=await donor(h,'Morgan Ellis'),other=await donor(h,'Reese Alvarez'),advisor=await donor(h,'Alex Grant Advisor')
  const g=await gift(h,d.id,'1000'),excluded=await gift(h,d.id,'500'),sponsor=await gift(h,other.id,'2000')
  const credit=await h.command('softCredit.record',{giftId:sponsor.id,donorId:advisor.id,amount:'2000'})
  const member=await h.person('entry@example.test'),admin=await h.person('admin@example.test','admin')
  assert.ok((await h.get('/api/coffer/letters')).due.some(x=>x.id===g.id))
  const bad=await h.command('interaction.record',{donorId:other.id,kind:'call',occurredOn:day,who:'Reese and staff',notes:'A different donor conversation.'})
  const call=await h.command('interaction.record',{donorId:d.id,kind:'call',occurredOn:day,who:'Morgan and staff',notes:'Thanked Morgan for funding the reading program.',acknowledgeGiftId:g.id,acknowledgmentVersion:0},{as:member.cookie})
  let ack=await read(h,d.id,g.id)
  assert.equal(ack.status,'acknowledged');assert.equal(ack.method,'phone call');assert.equal(ack.acknowledged_on,day);assert.equal(ack.link.id,call.id)
  assert.ok(!(await h.get('/api/coffer/letters')).due.some(x=>x.id===g.id))
  await h.command('gift.acknowledge',{giftId:g.id,version:ack.version,acknowledgedOn:day,method:'phone call',interactionId:bad.id},{status:409})
  await h.command('gift.acknowledge',{giftId:g.id,version:ack.version,acknowledgedOn:day,method:'email',interactionId:call.id},{status:409})
  await h.command('gift.resetAcknowledgment',{giftId:g.id,version:0},{status:409})
  const reason='Payroll transfer — do not send a donor acknowledgment.'
  await h.command('gift.doNotAcknowledge',{giftId:excluded.id,version:0,reason},{as:member.cookie,status:403})
  await h.command('gift.doNotAcknowledge',{giftId:excluded.id,version:0,reason},{as:admin.cookie})
  await h.command('gift.doNotAcknowledge',{giftId:excluded.id,version:1,reason:''},{status:400})
  const agent=await h.command('agent.create',{label:'Read acknowledgment status'})
  for(const command of ['gift.acknowledge','gift.resetAcknowledgment','gift.doNotAcknowledge','softCredit.acknowledge','softCredit.resetAcknowledgment','softCredit.doNotAcknowledge'])await h.command(command,{giftId:g.id,softCreditId:credit.id,version:1},{as:'',headers:{authorization:'Bearer '+agent.token},status:403})
  await h.command('softCredit.acknowledge',{softCreditId:credit.id,version:0,acknowledgedOn:day,method:'handwritten note',notes:'Dear Alex, thank you for recommending the grant.'},{as:member.cookie})
  assert.equal((await read(h,other.id,sponsor.id)).status,'not acknowledged')
  assert.equal((await h.get('/api/coffer/letters')).softCredits.length,0)
  await h.command('softCredit.resetAcknowledgment',{softCreditId:credit.id,version:1})
  await h.command('settings.update',{...settings,version:(await h.get('/api/coffer/settings')).version,thankSoftCredits:'1',targetDays:1})
  let queue=await h.get('/api/coffer/letters')
  assert.equal(queue.softCredits.length,1);assert.equal(queue.softCredits[0].donor_id,advisor.id)
  assert.ok(queue.due.find(x=>x.id===sponsor.id).overdue)
  assert.equal(queue.due.some(x=>[g.id,excluded.id].includes(x.id)),false,'Even after the one-day target only not-acknowledged gifts are due')
  const batch=await h.command('ack.prepare',{giftIds:[sponsor.id]})
  assert.deepEqual((await h.get(`/api/coffer/letters/${batch.id}`)).letters.map(l=>l.donor_id),[other.id],'Recognition credits never create a receipt')
  await h.command('ack.approve',{batchId:batch.id,version:1});await h.command('ack.export',{batchId:batch.id,version:2})
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date())
  await h.command('ack.markSent',{batchId:batch.id,version:3,sentOn:today,method:'mail'})
  const letterAck=await read(h,other.id,sponsor.id)
  assert.equal(letterAck.status,'acknowledged');assert.equal(letterAck.method,'letter');assert.equal(letterAck.batch_id,batch.id);assert.ok(letterAck.letter_id)
  const audit=await h.get('/api/coffer/audit?action=gift.acknowledgment')
  assert.ok(audit.rows.some(x=>x.subject_id===g.id&&JSON.parse(x.detail).interactionId===call.id))
  assert.ok(audit.rows.some(x=>x.subject_id===excluded.id&&x.actor_role==='admin'&&JSON.parse(x.detail).oldStatus==='not acknowledged'))
  assert.ok(!JSON.stringify(audit).includes(reason));assert.ok(!JSON.stringify(audit).includes('Thanked Morgan for funding'))
  const saved=await archive(h)
  await run(async fresh=>{await restore(fresh,saved);assert.equal((await read(fresh,d.id,g.id)).link.id,call.id);assert.equal((await read(fresh,other.id,sponsor.id)).batch_id,batch.id);assert.equal((await fresh.get('/api/coffer/letters')).softCredits.length,1)})
  const duplicate=await donor(h,'Morgan Second Record')
  const comparison=await h.get(`/api/coffer/duplicates/compare?source=${d.id}&target=${duplicate.id}`)
  const merged=await h.command('donor.merge',{sourceDonorId:d.id,donorId:duplicate.id,sourceVersion:comparison.source.version,version:comparison.target.version,reason:'duplicate_record'})
  assert.equal((await read(h,duplicate.id,g.id)).link.id,call.id)
  await h.command('donor.unmerge',{mergeId:merged.mergeId,reason:'incorrect_match'})
  assert.equal((await read(h,d.id,g.id)).link.id,call.id)
  if(process.env.COFFER_ACK_STATUS_BROWSER){const {receiptStatusBrowser}=await import('./receipt-status-browser.mjs');await receiptStatusBrowser(h,{donorId:d.id,giftId:g.id,excludedId:excluded.id,advisorId:advisor.id,day,directory:process.env.COFFER_ACK_STATUS_BROWSER})}
  const current=await read(h,d.id,g.id)
  const erased=await h.command('donor.erase',{donorId:d.id,confirm:'ERASE'})
  const anonymous=await read(h,erased.donorId,g.id)
  assert.equal(anonymous.status,current.status);assert.equal(anonymous.acknowledged_on,current.acknowledged_on);assert.equal(anonymous.method,current.method)
  assert.equal(anonymous.reason,null);assert.equal(anonymous.link,null)
 })
 const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),sent=[]
 await run(async h=>{
  await reviewed(h)
  const d=await donor(h,'Casey Reed'),second=await donor(h,'Drew Navarro'),uncertain=await donor(h,'Taylor Ahmed')
  const g=await gift(h,d.id,'1000'),g2=await gift(h,second.id,'500'),held=await gift(h,uncertain.id,'750')
  const b=await h.command('ack.prepare');await h.command('gift.doNotAcknowledge',{giftId:g.id,version:0,reason:'A personal thank-you is planned.'});await h.command('ack.approve',{batchId:b.id,version:1});await h.command('ack.send',{batchId:b.id,version:2})
  assert.equal(sent.length,3)
  const unknown=await read(h,uncertain.id,held.id);assert.equal(unknown.status,'not acknowledged');assert.equal(unknown.outcome_unknown,1)
  const receiptQueue=await h.api('/api/coffer/agent/receipts/queue',{});assert.equal(receiptQueue.queued,0,'Uncertain submissions wait for a person, never an automatic replacement')
  let ack=await read(h,d.id,g.id)
  assert.equal(ack.status,'acknowledged');assert.equal(ack.method,'email');assert.equal(ack.delivery,'delivery not confirmed');assert.equal(ack.link.kind,'letter')
  await h.command('ack.checkDelivery',{batchId:b.id,version:3})
  assert.equal((await read(h,d.id,g.id)).delivery,'delivery not confirmed','Unsigned provider logs do not become signed delivery proof')
  assert.equal((await read(h,second.id,g2.id)).status,'acknowledged','A log lookup alone never performs the signed-bounce reset')
  const letters=(await h.get(`/api/coffer/letters/${b.id}`)).letters
  const event=async(giftId,kind,eventId)=>{
   const l=letters.find(l=>l.gift_id===giftId),timestamp=String(Math.floor(Date.now()/1000)),raw=JSON.stringify([{event:kind,sg_event_id:eventId,timestamp:Number(timestamp),coffer_letter_id:l.id,coffer_attempt_id:l.attempt_id}])
   assert.equal((await h.request('/api/coffer/mail/events',{method:'POST',as:'',raw,headers:{'x-twilio-email-event-webhook-timestamp':timestamp,'x-twilio-email-event-webhook-signature':sign('sha256',Buffer.from(timestamp+raw),keys.privateKey).toString('base64')}})).status,200)
  }
  await event(g.id,'delivered','synthetic-coffer-log-'+letters.find(l=>l.gift_id===g.id).id)
  assert.equal((await read(h,d.id,g.id)).delivery,'delivered (provider-reported)')
  await event(g2.id,'bounce','synthetic-coffer-log-'+letters.find(l=>l.gift_id===g2.id).id)
  assert.equal((await read(h,second.id,g2.id)).status,'not acknowledged')
  assert.ok((await h.get('/api/coffer/letters')).due.some(x=>x.id===g2.id))
  const later=await h.command('gift.acknowledge',{giftId:g.id,version:ack.version,acknowledgedOn:day,method:'handwritten note',notes:'A later personal handwritten thank-you.'})
  await event(g.id,'bounce','synthetic-coffer-late-bounce')
  ack=await read(h,d.id,g.id);assert.equal(ack.status,'acknowledged');assert.equal(ack.note_id,later.noteId)
  if(process.env.COFFER_ACK_STATUS_BROWSER){const {receiptDeliveryStatusBrowser}=await import('./receipt-status-browser.mjs');await receiptDeliveryStatusBrowser(h,{donorId:second.id,giftId:g2.id,directory:process.env.COFFER_ACK_STATUS_BROWSER})}
 },{bindings:{MAIL_PROVIDER:'sendgrid',MAIL_EVENT_PUBLIC_KEY:keys.publicKey.export({type:'spki',format:'der'}).toString('base64')},outbound:async request=>{const url=new URL(request.url);assert.equal(url.hostname,'api.sendgrid.com');
  if(url.pathname==='/v3/logs'){const query=(await request.json()).query;return Response.json({messages:sent.flatMap((m,i)=>query.includes(m.personalizations[0].to[0].email)?[{sg_message_id:`synthetic-coffer-${i+1}.recvd.0`,to_email:m.personalizations[0].to[0].email}]:[])})}
  if(url.pathname.startsWith('/v3/logs/')){const i=Number(url.pathname.match(/synthetic-coffer-(\d+)/)[1])-1,m=sent[i];return Response.json({sg_message_id:`synthetic-coffer-${i+1}.recvd.0`,to_email:m.personalizations[0].to[0].email,events:[{event:m.personalizations[0].to[0].email==='drew.navarro@example.org'?'bounce':'delivered',timestamp:Math.floor(Date.now()/1000),sg_event_id:`synthetic-coffer-log-${m.custom_args.coffer_letter_id}`,custom_args:m.custom_args}]})}
  const message=await request.json();sent.push(message);if(message.personalizations[0].to[0].email==='taylor.ahmed@example.org')return new Response(null,{status:202});return new Response(null,{status:202,headers:{'x-message-id':`synthetic-coffer-${sent.length}`}})}})
}
