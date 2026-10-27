import assert from 'node:assert/strict'
import {generateKeyPairSync,sign} from 'node:crypto'
import {donor} from './harness.mjs'

/** A later postal attempt has its own outcome while retaining the email bounce. */
export async function postalRecovery(h,{pieces,messages,providerEvent}){
 const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'})
 await h.replaceBindings({MAIL_PROVIDER:'sendgrid',MAIL_API_KEY:'synthetic-coffer-850',MAIL_FROM:'receipts@example.test',MAIL_EVENT_PUBLIC_KEY:keys.publicKey.export({type:'spki',format:'der'}).toString('base64')})
 const d=await donor(h,'Riley Moreno',{email:'riley.moreno@example.test'})
 const gift=await h.command('gift.record',{donorId:d.id,amount:'275',receivedOn:'2025-08-10',method:'check',goods:'none'})
 const prepared=await h.command('ack.prepare',{giftIds:[gift.id],onePiecePer:'gift'})
 await h.command('ack.approve',{batchId:prepared.id,version:1})
 const sent=await h.command('ack.send',{batchId:prepared.id,version:2})
 assert.equal(messages.length,1)
 const detail=await h.get('/api/coffer/letters/'+prepared.id),letter=detail.letters[0]
 assert.equal(letter.delivery_status,'submitted')
 const timestamp=String(Math.floor(Date.now()/1000)),raw=JSON.stringify([{event:'bounce',sg_event_id:'synthetic-coffer-851',timestamp:Number(timestamp),coffer_letter_id:letter.id,coffer_attempt_id:letter.attempt_id}])
 const bounced=await h.request('/api/coffer/mail/events',{method:'POST',as:'',raw,headers:{'x-twilio-email-event-webhook-timestamp':timestamp,'x-twilio-email-event-webhook-signature':sign('sha256',Buffer.from(timestamp+raw),keys.privateKey).toString('base64')}})
 assert.equal(bounced.status,200)
 assert.equal((await h.get('/api/coffer/donors/'+d.id)).letters[0].delivery_status,'bounced')
 const previous=pieces.length
 await h.command('ack.sendPostal',{batchId:prepared.id,version:sent.version,contentHash:detail.batch.content_hash,approvePostage:true})
 assert.equal(pieces.length,previous+1)
 const postalDetail=await h.get('/api/coffer/letters/'+prepared.id),postalLetter=postalDetail.letters.find(l=>l.id===letter.id)
 assert.ok(postalLetter);assert.ok(postalLetter.attempt_id);assert.notEqual(postalLetter.attempt_id,letter.attempt_id)
 const owner=(await h.get('/auth/session')).operator,authorization=(await h.get('/api/coffer/audit?action=ack.sendPostal&record='+prepared.id)).rows
 assert.equal(authorization.length,1);assert.equal(authorization[0].actor_id,owner.id);assert.equal(authorization[0].actor_role,'owner')
 const authorizationDetail=JSON.parse(authorization[0].detail)
 assert.equal(authorizationDetail.contentHash,detail.batch.content_hash);assert.equal(authorizationDetail.extraAddressSheet,true)
 const piece=pieces.at(-1)
 assert.equal((await providerEvent(h,piece,'letter.delivered','synthetic-coffer-852')).status,200)
 const recovered=await h.get('/api/coffer/donors/'+d.id)
 assert.equal(recovered.letters[0].delivery_status,'delivered','The old email bounce cannot replace the current signed postal result')
 assert.equal(recovered.receiptTasks.length,1)
 assert.equal(recovered.receiptTasks[0].postal,0,'The earlier email-address task retains its actual failure channel')
 const timeline=await(await h.request('/app/donors/'+d.id+'?timelineKind=task')).text();assert.match(timeline,/Fix email address/);assert.doesNotMatch(timeline,/Fix postal address/)
 const history=await h.get('/api/coffer/letters/'+prepared.id)
 assert.deepEqual(history.deliveryEvents.map(e=>e.provider).sort(),['Lob','SendGrid'])
 assert.notEqual(history.deliveryEvents[0].provider_attempt_id,history.deliveryEvents[1].provider_attempt_id)
 const expectedAttempts=new Map([['SendGrid',letter.attempt_id],['Lob',postalLetter.attempt_id]])
 for(const event of history.deliveryEvents){
  assert.equal(event.letter_id,letter.id);assert.ok(expectedAttempts.has(event.provider))
  assert.equal(event.provider_attempt_id,expectedAttempts.get(event.provider),'Provider history retains the exact email or postal document attempt')
 }
 const receiptPage=await(await h.request('/app/donors/'+d.id+'?timelineKind=receipt')).text(),receiptTimeline=receiptPage.match(/<section[^>]*id="timeline"[^>]*>(.*?)<\/section>/s)
 assert.ok(receiptTimeline)
 const providerRows=[...receiptTimeline[1].matchAll(/<li\b[^>]*>.*?<\/li>/gs)].map(match=>match[0])
 assert.equal(providerRows.filter(row=>row.includes('SendGrid receipt provider event')&&row.includes('bounced')).length,1)
 assert.equal(providerRows.filter(row=>row.includes('Lob receipt provider event')&&row.includes('letter.delivered')).length,1)
 assert.equal(recovered.gifts.find(g=>g.id===gift.id).acknowledgment.method,'letter')
}
