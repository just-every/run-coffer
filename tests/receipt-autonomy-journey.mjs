import assert from 'node:assert/strict'
import { generateKeyPairSync, sign } from 'node:crypto'
import { mkdir } from 'node:fs/promises'
import { run, donor, reviewed, settings } from './harness.mjs'
import { withBrowserWorker } from './browser-worker.mjs'

const endpoint='/api/coffer/agent/receipts'
const gift=(h,d,amount='500',extra={})=>h.command('gift.record',{donorId:d.id,amount,receivedOn:'2026-01-10',method:'check',goods:'none',...extra})
const file=(name,rows)=>({name,base64:Buffer.from(rows.map(r=>r.join(',')).join('\r\n')+'\r\n').toString('base64')})
const state=h=>h.get(endpoint+'/settings')
async function policy(h,changes={},options={}) {
 const s=await state(h)
 return h.api(endpoint+'/settings',{version:s.version,keyId:s.selected_key_id??'',acknowledgeFrom:s.acknowledge_from??'',maxStandardAmountCents:s.max_standard_cents,standingApproval:true,...changes},options)
}
const ack=async(h,d,g)=>(await h.get('/api/coffer/donors/'+d.id)).gifts.find(x=>x.id===g.id).acknowledgment

/** DEV-003 public receipt recovery, using only a fake at the paid send edge. */
export async function receiptAutonomyJourney() {
 const keys=generateKeyPairSync('ec',{namedCurve:'prime256v1'}),mail=[]
 return run(async h=>{
  await reviewed(h)
  const small=await donor(h,'Standard small receipt'),bounced=await donor(h,'Corrected bounced receipt'),large=await donor(h,'Large receipt review'),missing=await donor(h,'Missing postal review',{addressLine1:'',city:'',region:'',postalCode:''}),privateDonor=await donor(h,'Outside selected receipt grant')
  const unknownFixture={source:'bloomerang',files:[file('constituents.csv',[['Account Number','Name','Email Address'],['synthetic-coffer-9','Unknown benefit review','unknown.benefit.review@example.org']]),file('gifts.csv',[
   ['Transaction Number','Account Number','Gift Type','Gift Date','Amount'],['synthetic-coffer-10','synthetic-coffer-9','Donation','2026-01-10','500']])]}
  const unknownPreview=await h.api('/api/coffer/move-in/preview',unknownFixture)
  await h.api('/api/coffer/move-in/apply',{id:unknownPreview.id,fingerprint:unknownPreview.fingerprint,acknowledged:'no'})
  const unknown=(await h.get('/api/coffer/donors?q=Unknown%20benefit%20review')).donors[0]
  const gUnknown=(await h.get('/api/coffer/donors/'+unknown.id)).gifts[0]
  const gSmall=await gift(h,small,'25'),gBounce=await gift(h,bounced),gLarge=await gift(h,large,'2500'),gMissing=await gift(h,missing),gPrivate=await gift(h,privateDonor)
  const recent=await gift(h,small,'500',{receivedOn:new Date().toISOString().slice(0,10)}),old=await gift(h,small,'500',{receivedOn:'2024-01-10'})
  const initial=await h.command('ack.prepare',{giftIds:[gBounce.id]})
  await h.command('ack.approve',{batchId:initial.id,version:1});await h.command('ack.send',{batchId:initial.id,version:2})
  const bounceLetter=(await h.get('/api/coffer/letters/'+initial.id)).letters[0]
  const timestamp=String(Math.floor(Date.now()/1000)),raw=JSON.stringify([{event:'bounce',sg_event_id:'synthetic-coffer-1',timestamp:Number(timestamp),coffer_letter_id:bounceLetter.id,coffer_attempt_id:bounceLetter.attempt_id}])
  const response=await h.request('/api/coffer/mail/events',{method:'POST',as:'',raw,headers:{'x-twilio-email-event-webhook-timestamp':timestamp,'x-twilio-email-event-webhook-signature':sign('sha256',Buffer.from(timestamp+raw),keys.privateKey).toString('base64')}})
  assert.equal(response.status,200);assert.equal((await ack(h,bounced,gBounce)).status,'not acknowledged')
  await h.command('donor.update',{donorId:bounced.id,version:1,name:'Corrected bounced receipt',email:'synthetic-coffer-2@example.test',addressLine1:'1 Main Street',city:'Springfield',region:'IL',postalCode:'62701'})
  const key=await h.command('agent.create',{label:'Approved receipt sender'})
  const grantInput={name:'Standard receipts standing approval',donorIds:[small.id,bounced.id,large.id,unknown.id,missing.id],permissions:['ack.prepare','ack.send'],dailyLimit:2,standingApproval:true}
  const grant=await h.command('agentGrant.save',grantInput)
  await h.command('agentGrant.attach',{keyId:key.id,grantId:grant.id})
  const invitation=await h.request('/app/people/invite',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams({email:'synthetic-coffer-3@example.test',role:'member',displayName:'Receipt member'}).toString()})
  assert.equal(invitation.status,303)
  const invitationText=mail.at(-1).content.find(c=>c.type==='text/plain').value,token=new URL(invitationText.match(/https?:\/\/[^\s<>]+\/auth\/confirm\?token=[^\s<>]+/)[0]).searchParams.get('token')
  const confirmed=await h.request('/auth/confirm',{method:'POST',as:'',body:{token}});assert.equal(confirmed.status,303)
  const member={cookie:confirmed.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ')}
  await policy(h,{keyId:key.id},{as:member.cookie,status:403})
  await policy(h,{keyId:key.id,standingApproval:false},{status:400})
  await policy(h,{keyId:key.id,acknowledgeFrom:'2025-01-01',maxStandardAmount:'1000',maxStandardAmountCents:undefined})
  assert.equal((await state(h)).selected_key_id,key.id)
  const proposals=(await h.get('/api/coffer/agent')).missingReceipts
  assert.ok(proposals.some(g=>g.id===gSmall.id));assert.ok(proposals.some(g=>g.id===gBounce.id))
  assert.ok(!proposals.some(g=>[old.id,recent.id].includes(g.id)))
  const before=mail.length,result=await h.api(endpoint+'/run',{})
  assert.equal(result.sent,2);assert.equal(mail.length-before,2)
  assert.equal(result.outsideScope,1)
  for(const [d,g] of [[small,gSmall],[bounced,gBounce]])assert.equal((await ack(h,d,g)).status,'acknowledged')
  assert.equal((await ack(h,privateDonor,gPrivate)).status,'not acknowledged')
  const policyState=await state(h),holds=new Map(policyState.reviews.map(r=>[r.gift_id,JSON.parse(r.reasons)]))
  assert.match(holds.get(gLarge.id).join(' '),/Large gift/);assert.match(holds.get(gUnknown.id).join(' '),/unknown/);assert.match(holds.get(gMissing.id).join(' '),/address missing/)
  for(const r of policyState.reviews.filter(r=>r.batch_id))assert.equal((await h.get('/api/coffer/letters/'+r.batch_id)).batch.status,'prepared')
  const sentBatch=await h.get('/api/coffer/letters/'+result.batches.find(b=>b.submitted).id)
  assert.equal(sentBatch.batch.prepared_by_id,key.id);assert.equal(sentBatch.batch.prepared_by_role,'agent')
  assert.equal(sentBatch.approval.prepared_by_id,key.id);assert.equal(sentBatch.approval.approved_by_role,'owner')
  assert.ok(sentBatch.events.some(e=>e.action==='ack.prepare'&&JSON.parse(e.detail).grantId===grant.id))
  const limited=await gift(h,small,'100')
  const limitedRun=await h.api(endpoint+'/run',{});assert.equal(limitedRun.sent,0);assert.match(limitedRun.batches.find(b=>b.heldReason).heldReason,/daily receipt limit/)
  assert.equal((await ack(h,small,limited)).status,'not acknowledged')
  const imports={source:'bloomerang',files:[file('constituents.csv',[['Account Number','Name'],['synthetic-coffer-4','Imported receipt status']]),file('gifts.csv',[
   ['Transaction Number','Account Number','Gift Type','Gift Date','Amount','Non-Deductible Amount','Acknowledged?','Acknowledgement Date','Acknowledgement Method','Acknowledgment Interaction ID'],
   ['synthetic-coffer-5','synthetic-coffer-4','Donation','2026-01-11','500','0','Yes','2026-01-12','letter','synthetic-coffer-8'],
   ['synthetic-coffer-6','synthetic-coffer-4','Donation','2026-01-12','500','0','Do Not Acknowledge','','',''],
   ['synthetic-coffer-7','synthetic-coffer-4','Donation','2024-01-12','500','0','No','','',''],
  ])]}
  const preview=await h.api('/api/coffer/move-in/preview',imports);assert.equal(preview.canApply,true,JSON.stringify(preview.diagnostics))
  let job=await h.api('/api/coffer/move-in/apply',{id:preview.id,fingerprint:preview.fingerprint,acknowledged:'no',acknowledgeFrom:'2025-01-01'})
  while(job.state==='applying')job=await h.api('/api/coffer/move-in/continue',{id:job.id})
  assert.equal((await state(h)).acknowledge_from,'2025-01-01')
  const importedDonor=(await h.get('/api/coffer/donors?q=Imported%20receipt%20status')).donors[0]
  const imported=(await h.get('/api/coffer/donors/'+importedDonor.id)).gifts
  assert.deepEqual(new Set(imported.map(g=>g.acknowledgment.status)),new Set(['acknowledged','do not acknowledge','not acknowledged']))
  const importedProposals=(await h.get('/api/coffer/agent')).missingReceipts
  assert.ok(!imported.some(g=>importedProposals.some(p=>p.id===g.id)))
  const background=(await h.get('/api/coffer/agent/grants')).find(g=>g.id==='receipts')
  await h.api('/api/coffer/agent/grants',{id:'receipts',version:background.version,enabled:false,scope:'all',dailyLimit:background.daily_limit})
  await h.api(endpoint+'/run',{},{status:403})
  await h.api('/api/coffer/agent/grants',{id:'receipts',version:background.version+1,enabled:true,scope:'all',dailyLimit:background.daily_limit})
  const controls=await h.get('/api/coffer/agent-grants')
  await h.command('agentGrant.kill',{version:controls.control.version,enabled:false})
  const mailCount=mail.length;await h.api(endpoint+'/run',{},{status:403});assert.equal(mail.length,mailCount)
  await h.command('agentGrant.kill',{version:controls.control.version+1,enabled:true})
  await h.command('settings.update',{...settings,version:(await h.get('/api/coffer/settings')).version,letterSubject:'Reviewed revision {{organization}}'})
  await gift(h,bounced,'100')
  const changed=await h.api(endpoint+'/run',{});assert.equal(changed.sent,0);assert.ok(changed.batches.some(b=>/template|settings/i.test(b.heldReason??'')))
  if(process.env.COFFER_RECEIPT_BROWSER)await receiptAutonomyBrowser(h,process.env.COFFER_RECEIPT_BROWSER)
  await h.command('agent.revoke',{id:key.id});await h.api(endpoint+'/run',{},{status:401});assert.equal(mail.length,mailCount)
  // Year-end standing authority is deliberately separate: only the exact
  // already approved pending statement can be dispatched by an explicit person.
  const yearDonor=await donor(h,'Year end recovery'),yearGift=await gift(h,yearDonor,'100',{receivedOn:'2025-03-01'})
  const annual=await h.command('ack.prepareStatements',{year:2025,donorId:yearDonor.id})
  assert.equal((await state(h)).statements.find(s=>s.batch_id===annual.id).recoverable,false)
  await h.api(endpoint+'/statements/recover',{batchId:annual.id,version:1},{status:409})
  await h.command('ack.approve',{batchId:annual.id,version:1})
  await h.api(endpoint+'/statements/recover',{batchId:annual.id,version:2},{as:member.cookie,status:403})
  const approved=(await state(h)).statements.find(s=>s.batch_id===annual.id);assert.equal(approved.recoverable,true)
  const recovered=await h.api(endpoint+'/statements/recover',{batchId:annual.id,version:2});assert.equal(recovered.submitted,1)
  assert.equal((await state(h)).statements.find(s=>s.batch_id===annual.id).recoverable,false)
  await h.api(endpoint+'/statements/recover',{batchId:annual.id,version:recovered.version},{status:409})
  assert.equal(mail.length,mailCount+1);assert.equal((await ack(h,yearDonor,yearGift)).status,'acknowledged')
  assert.ok(!(await h.get('/api/coffer/letters')).due.some(g=>imported.some(i=>i.id===g.id)))
 },{bindings:{MAIL_PROVIDER:'sendgrid',MAIL_EVENT_PUBLIC_KEY:keys.publicKey.export({type:'spki',format:'der'}).toString('base64')},outbound:async request=>{
  assert.equal(new URL(request.url).hostname,'api.sendgrid.com');mail.push(await request.json());return new Response(null,{status:202,headers:{'x-message-id':'synthetic-coffer-'+(20+mail.length)}})
 }})
}

export async function receiptAutonomyBrowser(h,directory) {
 await mkdir(directory,{recursive:true})
 await withBrowserWorker(h,async(context,origin)=>{
  const page=await context.newPage()
  for(const width of [1440,390]) {
   await page.setViewportSize({width,height:1000});await page.goto(origin+'/app/agent/receipts')
   await page.getByRole('heading',{name:'Receipt standing approval',exact:true}).waitFor()
   await page.getByRole('heading',{name:'Receipts waiting for a person',exact:true}).waitFor()
   assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth))
   await page.screenshot({path:`${directory}/receipt-autonomy-${width}.png`,fullPage:true})
  }
 })
}
