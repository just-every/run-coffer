import assert from 'node:assert/strict'
import { createHmac, randomUUID } from 'node:crypto'
import { installation, donor, reviewed, settings, archive, restore } from './harness.mjs'
import { readPrintPdf } from './print-formats-journey.mjs'
import { immediateReceiptsEdge, mailbox, receiptFrom } from './immediate-receipts-edge.mjs'
import { immediateReceiptsBrowser } from './immediate-receipts-browser.mjs'

const form=values=>({method:'POST',as:'',headers:{'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams(values).toString()})
const save=async(h,extra={},options={})=>h.command('settings.update',{...settings,version:(await h.get('/api/coffer/settings')).version,...extra},options)
const receipts=state=>state.messages.filter(x=>x.message.custom_args?.coffer_letter_id)
const tick=async h=>{const response=await h.mf.dispatchFetch(h.origin+'/cdn-cgi/local/scheduled?cron=*+*+*+*+*&time='+Date.now(),{headers:{host:new URL(h.origin).host}});assert.equal(response.status,200,await response.text())}
async function give(h,state,name,amount='50') {
 const response=await h.request('/give/immediate-receipts/checkout',form({name,email:mailbox(name.toLowerCase().replaceAll(' ','.')),amount,frequency:'once',requestId:randomUUID(),'cf-turnstile-response':'synthetic-coffer-security-token'}))
 assert.equal(response.status,303,await response.text())
 const session=state.sessions.at(-1),started=Date.now(),paid=await h.request('/giving/thanks?session_id='+session.id,{as:''})
 assert.equal(paid.status,200,await paid.text())
 return {session,giftId:'giving-'+session.payment_intent,started}
}
async function replay(h,session,status=200,thanks='/giving/thanks') {
 const at=Math.floor(Date.now()/1000),raw=JSON.stringify({id:'evt_synthetic_'+session.id,type:'checkout.session.completed',data:{object:{id:session.id}}})
 const signature=createHmac('sha256','synthetic-coffer-1202').update(at+'.'+raw).digest('hex')
 const event=await h.mf.dispatchFetch(h.origin+'/api/coffer/giving/webhook',{method:'POST',headers:{host:new URL(h.origin).host,'content-type':'application/json','stripe-signature':`t=${at},v1=${signature}`},body:raw})
 assert.equal(event.status,status,await event.text())
 assert.equal((await h.request(thanks+'?session_id='+session.id,{as:''})).status,status)
}
async function batch(h,people,name) {
 let b=await h.command('giftBatch.create',{name,receivedOn:'2025-08-10',method:'check',fund:'Literacy',expected:String(people.length*50)})
 for(const [index,d] of people.entries())b=await h.command('giftBatch.add',{batchId:b.id,version:b.version,donorId:d.id,amount:'50',reference:name+'-'+index,goods:'none'})
 const closed=await h.command('giftBatch.close',{batchId:b.id,version:b.version})
 await h.command('giftBatch.close',{batchId:b.id,version:b.version},{status:409})
 return closed
}
async function configure(h,state) {
 state.dns=false
 const pending=await h.command('sendingDomain.save',{version:(await h.get('/api/coffer/sending-domain')).version,authenticationId:123})
 assert.equal(pending.status,'pending')
 const waiting=await h.command('sendingDomain.verify',{version:pending.version})
 assert.equal(waiting.status,'pending');assert.equal(waiting.records.filter(r=>r.valid).length,0,'Provider approval alone cannot prove DNS')
 state.dns=true
 const verified=await h.command('sendingDomain.verify',{version:waiting.version})
 assert.equal(verified.status,'verified');assert.ok(verified.records.every(r=>r.valid))
 return verified
}
export async function immediateReceiptsJourney() {
 const edge=immediateReceiptsEdge(),h=await installation({...edge,triggerHandlers:true})
 try {
  await reviewed(h)
  await h.replaceBindings({MAIL_PROVIDER:'resend'})
  const member=await h.person(mailbox('receipt-clerk'))
  const admin=await h.person(mailbox('receipt-admin'),'admin')
  await h.replaceBindings({MAIL_PROVIDER:'sendgrid'})
  await h.command('sendingDomain.save',{version:0,authenticationId:123},{as:member.cookie,status:403})
  await h.get('/api/coffer/sending-domain',{as:member.cookie,status:403})
  const campaign=await h.api('/api/coffer/giving/campaigns',{name:'Immediate receipts',slug:'immediate-receipts',description:'Books for local readers.',fund:'Literacy',goal:'10000'})
  await h.command('letterTemplate.save',{kind:'campaign',campaignId:campaign.id,name:'Literacy receipt',subject:'Your literacy contribution',body:settings.letterTemplate+'\nYour contribution supports our reading room.'})
  const withdrawn=await donor(h,'Morgan Reader',{email:mailbox('morgan.reader')})
  await h.command('consent.record',{donorIds:[withdrawn.id],channel:'email',status:'withdrawn',method:'email reply',evidence:'The donor withdrew appeals, not receipts.',capturedOn:'2025-01-02'})
  const pending=await h.command('sendingDomain.save',{version:0,authenticationId:123})
  await h.command('sendingDomain.save',{version:0,authenticationId:123},{status:409})
  await h.command('sendingDomain.verify',{version:pending.version},{as:'',status:401})
  const check=await h.command('sendingDomain.verify',{version:pending.version})
  assert.equal(check.status,'pending');assert.equal(check.records.filter(r=>r.valid).length,0)
  let domainState=check
  for(const missing of ['dkim2','mail_cname']) {
   edge.state.dns=true;edge.state.missing=missing
   domainState=await h.command('sendingDomain.verify',{version:domainState.version})
   assert.equal(domainState.status,'pending',`A missing ${missing} record cannot verify the domain`)
  }
  edge.state.dns=false;edge.state.missing=null
  const unverified=await give(h,edge.state,'Morgan Reader')
  assert.equal(receipts(edge.state).length,0,'Unverified domain never submits mail')
  const frozen=(await h.get('/api/coffer/letters/receipt-'+unverified.giftId)).letters[0]
  assert.equal(frozen.route,'pending')
  await immediateReceiptsBrowser(h,{state:edge.state,phase:'unverified'})
  assert.equal((await h.get('/api/coffer/sending-domain')).status,'verified')
  await h.replaceBindings({MAIL_EVENT_PUBLIC_KEY:'synthetic-coffer-1205'})
  await tick(h)
  assert.equal(receipts(edge.state).length,1,'A durable unclaimed receipt resumes after domain verification')
  const first=receipts(edge.state)[0]
  assert.equal(first.message.from.email,receiptFrom)
  assert.equal(first.message.personalizations[0].to[0].email,mailbox('morgan.reader'))
  assert.ok(first.at-unverified.started<60000,'Online submission completes within one minute')
  const body=first.message.content.find(c=>c.type==='text/plain').value
  assert.match(body,/\$50\.00/);assert.match(body,/No goods or services were provided/);assert.match(body,/reading room/)
  assert.match(body,/12-3456789/)
  assert.equal(first.message.attachments.length,1);assert.equal(first.message.attachments[0].type,'application/pdf')
  const pdf=await readPrintPdf(Buffer.from(first.message.attachments[0].content,'base64'))
  const text=pdf.pages.flatMap(p=>p.text.map(t=>t.text)).join('\n')
  assert.match(text,/\$50\.00/);assert.match(text,/No goods or services/);assert.match(text,/reading room/);assert.match(text,/12-3456789/)
  const issued=(await h.get('/api/coffer/letters/receipt-'+unverified.giftId)).letters[0]
  assert.equal(issued.body,frozen.body);assert.ok(text.includes('Receipt '+issued.receipt_year+'-'+issued.receipt_sequence))
  assert.equal(issued.delivery_status,'submitted');assert.equal((await h.get('/api/coffer/donors/'+withdrawn.id)).gifts.length,1)
  await replay(h,unverified.session);await tick(h);assert.equal(receipts(edge.state).length,1,'Webhook, return and schedule share one permanent attempt')
  // Normal paid checkout submits directly rather than waiting for the cron.
  const direct=await give(h,edge.state,'Avery Reader')
  assert.equal(receipts(edge.state).length,2);assert.ok(receipts(edge.state).at(-1).at-direct.started<60000)
  await immediateReceiptsBrowser(h,{state:edge.state,phase:'verified',batchId:'receipt-'+unverified.giftId,enableOffline:true})
  const people=[];for(const name of ['Alex Offline','Blair Offline','Casey Offline']){const email=mailbox(name.toLowerCase().replaceAll(' ','.'));people.push({...await donor(h,name,{email}),email})}
  const noEmail=await donor(h,'Postal Offline',{email:null})
  const enabled=await batch(h,[...people,noEmail],'Enabled receipt batch')
  assert.equal(receipts(edge.state).length,5,'Closing the enabled batch submits exactly three eligible receipts')
  for(const d of people)assert.ok(receipts(edge.state).some(x=>x.message.personalizations[0].to[0].email===d.email))
  for(const entry of (await h.get('/api/coffer/gift-batches?id='+enabled.id)).entries.filter(e=>people.some(d=>d.id===e.donor_id)))assert.equal((await h.get('/api/coffer/letters/receipt-'+entry.gift_id)).letters[0].delivery_status,'submitted')
  await save(h,{offlineReceipts:'0'})
  await batch(h,people,'Disabled receipt batch');await tick(h)
  assert.equal(receipts(edge.state).length,5,'Disabled batch receipt setting sends none')
  await immediateReceiptsBrowser(h,{state:edge.state,phase:'off'})
  // A provider may have accepted a submission whose response omitted its ID.
  edge.state.mail='uncertain'
  const uncertain=await give(h,edge.state,'Uncertain Reader')
  const held=(await h.get('/api/coffer/letters/receipt-'+uncertain.giftId)).letters[0]
  assert.equal(held.delivery_status,'uncertain')
  const count=receipts(edge.state).length
  edge.state.mail='accepted';await replay(h,uncertain.session);await tick(h)
  assert.equal(receipts(edge.state).length,count,'Uncertain attempts never resubmit')
  // Changed sender configuration invalidates verification; restore cannot revive authority.
  await h.replaceBindings({MAIL_FROM:['different','riverbend.example.test'].join('@')})
  assert.equal((await h.get('/api/coffer/sending-domain')).status,'configuration_changed')
  const stale=await give(h,edge.state,'Stale Reader')
  await h.command('gift.reverse',{giftId:stale.giftId,reason:'Returned before submission'},{status:409})
  await h.command('ack.discard',{batchId:'receipt-'+stale.giftId,version:1})
  await h.command('gift.reverse',{giftId:stale.giftId,reason:'Returned before submission'})
  const erased=await give(h,edge.state,'Erased Reader')
  const erasedId=(await h.get('/api/coffer/letters/receipt-'+erased.giftId)).letters[0].donor_id
  await h.command('donor.erase',{donorId:erasedId,confirm:'ERASE'})
  await h.replaceBindings({MAIL_FROM:receiptFrom})
  await tick(h)
  assert.equal(receipts(edge.state).length,count,'Reversal and erasure refuse pending receipts without sending')
  assert.equal((await h.get('/api/coffer/letters/receipt-'+erased.giftId)).letters[0].recipient_email,null)
  await replay(h,erased.session,409);assert.equal(receipts(edge.state).length,count,'Payment replay cannot resurrect an erased donor')
  await h.replaceBindings({MAIL_FROM:['different','riverbend.example.test'].join('@')})
  await give(h,edge.state,'Changed Approval Reader')
  await save(h,{offlineReceipts:'0'})
  await h.replaceBindings({MAIL_FROM:receiptFrom})
  await tick(h);assert.equal(receipts(edge.state).length,count,'Changed standing approval holds the old pending receipt')
  await h.replaceBindings({MAIL_PROVIDER:'development'})
  const suppressed=await give(h,edge.state,'Suppressed Reader')
  assert.equal((await h.get('/api/coffer/letters/receipt-'+suppressed.giftId)).letters[0].delivery_status,'suppressed')
  assert.equal(receipts(edge.state).length,count,'Local suppression is never reported as provider submission')
  await h.replaceBindings({MAIL_PROVIDER:'sendgrid'})
  await save(h,{offlineReceipts:'0'},{as:admin.cookie})
  await give(h,edge.state,'Admin Approved Reader')
  assert.equal(receipts(edge.state).length,count+1,'Current admin standing approval supports automatic sending')
  await h.replaceBindings({MAIL_FROM:['different','riverbend.example.test'].join('@')})
  await give(h,edge.state,'Revoked Approval Reader')
  await h.api('/auth/operator/role',{operatorId:admin.id,role:'member'})
  await h.replaceBindings({MAIL_FROM:receiptFrom})
  await tick(h);assert.equal(receipts(edge.state).length,count+1,'Revoked approval cannot submit pending data')
  await save(h,{offlineReceipts:'0'},{as:admin.cookie,status:401})
  const snapshot=await archive(h)
  const restored=await installation({...edge,triggerHandlers:true,givingProtection:false})
  try {await restore(restored,snapshot);await configure(restored,edge.state);await tick(restored);assert.equal(receipts(edge.state).length,count+1,'Restore retains attempts and requires fresh standing receipt authority')}finally{await restored.close()}
  // Pledge installments use their own paid-gift transaction and callback.
  await save(h)
  const payer=await donor(h,'Pledge Reader',{email:mailbox('pledge.reader')})
  const pledge=await h.command('pledge.create',{donorId:payer.id,amount:'50',pledgedOn:'2025-01-01',fund:'Literacy',campaignId:campaign.id,installments:[{dueOn:'2030-03-09',amount:'50'}]})
  const invoice=await h.request('/app/pledges/'+pledge.id+'/invoice')
  assert.equal(invoice.status,200)
  const link=(await invoice.text()).match(/href="([^"]*\/giving\/pledge\/[^" ]+)"/)
  assert.ok(link,'The pledge invoice offers a signed payment link')
  const url=new URL(link[1].replaceAll('&amp;','&'),h.origin)
  const checkout=await h.request(url.pathname+url.search,{method:'POST',as:''})
  assert.equal(checkout.status,303,await checkout.text())
  const session=edge.state.sessions.at(-1),before=receipts(edge.state).length,started=Date.now()
  assert.equal(session.amount_total,5000)
  session.status='complete';session.payment_status='paid'
  const paid=await h.request('/giving/pledge/thanks?session_id='+session.id,{as:''})
  assert.equal(paid.status,200,await paid.text())
  await tick(h)
  const history=await h.get('/api/coffer/donors/'+payer.id)
  assert.equal(history.gifts.length,1);assert.equal(history.pledges[0].installments[0].remaining_cents,0)
  assert.equal(receipts(edge.state).length,before+1,'A paid $50 pledge installment submits one receipt')
  const receipt=receipts(edge.state).at(-1)
  assert.equal(receipt.message.from.email,receiptFrom)
  assert.equal(receipt.message.personalizations[0].to[0].email,mailbox('pledge.reader'))
  assert.ok(receipt.at-started<60000,'The pledge receipt submits within one minute')
  const pledgePdf=await readPrintPdf(Buffer.from(receipt.message.attachments[0].content,'base64'))
  const pledgeText=pledgePdf.pages.flatMap(p=>p.text.map(t=>t.text)).join('\n')
  assert.match(pledgeText,/\$50\.00/);assert.match(pledgeText,/No goods or services/);assert.match(pledgeText,/reading room/)
  await replay(h,session,200,'/giving/pledge/thanks');await tick(h)
  assert.equal(receipts(edge.state).length,before+1,'Replayed pledge payment and schedule cannot duplicate the receipt')
  await immediateReceiptsBrowser(h,{state:edge.state,phase:'off',batchId:'receipt-giving-'+session.payment_intent})
 } finally {await h.close()}
}
