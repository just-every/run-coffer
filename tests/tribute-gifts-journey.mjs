import assert from 'node:assert/strict'
import {run,donor,reviewed,archive,restore,installation} from './harness.mjs'
import {recognitionEdges,giveRecognition,recognitionMember,form} from './recognition-edge.mjs'
import {tributeImportJourney} from './tribute-import-journey.mjs'

const csv=(name,rows)=>({name,base64:Buffer.from(rows.map(r=>r.join(',')).join('\r\n')).toString('base64')})
export async function tributeGiftsJourney() {
 const edge=recognitionEdges(),stripeRequests=[]
 await run(async h=>{
  await tributeImportJourney(h)
  await reviewed(h)
  const campaign=await h.api('/api/coffer/giving/campaigns',{name:'Remembering our neighbors',slug:'autumn-reading',description:'Books for the community in honor of those we love.',fund:'Reading',goal:'10000'})
  const values={name:'Jordan Ellis',email:'jordan.tribute@example.test',amount:'500',tributeKind:'memory',tributeHonoree:'Morgan Ellis',notifyName:'Jamie Ellis',notifyEmail:'jamie.private@example.test',notifyAddress:'12 Garden Street, Springfield IL 62701'}
  const given=await giveRecognition(h,values)
  const source=(await h.get('/api/coffer/donors')).donors.find(d=>d.email===values.email)
  let history=await h.get('/api/coffer/donors/'+source.id),tribute=history.giftDepth.tributes[0],giftId=tribute.gift_id
  assert.equal(tribute.honoree,'Morgan Ellis');assert.equal(tribute.notified_name,'Jamie Ellis');assert.equal(tribute.amount_permission,0)
  const replay=await h.request('/giving/thanks?session_id='+given.sessionId);assert.equal(replay.status,200)
  assert.equal((await h.get('/api/coffer/donors/'+source.id)).giftDepth.tributes.length,1)
  assert.equal((await h.request('/give/autumn-reading/checkout',form({...given.input,tributeAmountPermission:'yes'}))).status,409,'A replay cannot invent permission to disclose the amount')
  const publicPage=await (await h.request('/give/autumn-reading',{as:''})).text()
  assert.ok(!publicPage.includes('Jamie Ellis'));assert.ok(!publicPage.includes('jamie.private@example.test'));assert.ok(!publicPage.includes('12 Garden Street'))
  assert.ok(stripeRequests.every(body=>!body.includes('Morgan')&&!body.includes('Jamie')&&!body.includes('jamie.private')),'Tribute/family fields never leave through Stripe metadata')
  const other=await donor(h,'Priya Kumar')
  const gift=await h.command('gift.record',{donorId:other.id,amount:'20',receivedOn:'2026-09-15',method:'cash',fund:'Reading',goods:'none'})
  await h.command('tribute.record',{giftId:gift.id,kind:'memory',honoree:' mORGAN  ELLIS ',notifiedName:'Jamie Ellis',notifiedEmail:'jamie.private@example.test',amountPermission:true})
  assert.equal((await h.get('/api/coffer/donors/'+other.id)).giftDepth.tributes[0].amount_permission,0,'Staff cannot invent donor amount permission')
  const input={source:'bloomerang',noGoodsOrServices:true,files:[csv('constituents.csv',[['Account Number','Name'],['MEM_PERSON','Earlier supporter']]),csv('gifts.csv',[['Transaction Number','Account Number','Gift Type','Gift Date','Amount','Payment Method','Tribute','Tribute Type','Has Tribute'],['MEM_GIFT','MEM_PERSON','Donation','2025-10-01','125','Check','Morgan Ellis','In Memory Of','Yes']])]}
  const preview=await h.api('/api/coffer/move-in/preview',input)
  assert.equal(preview.canApply,true,JSON.stringify(preview.diagnostics))
  let job=await h.api('/api/coffer/move-in/apply',{id:preview.id,fingerprint:preview.fingerprint,acknowledged:'no'})
  while(job.state==='applying')job=await h.api('/api/coffer/move-in/continue',{id:preview.id})
  assert.equal(job.state,'completed')
  const group=()=>h.get('/api/coffer/tributes').then(r=>r.groups.find(g=>g.key==='memory:morgan ellis'))
  assert.equal((await group()).totalCents,64500,'The memorial includes the source’s imported $125 beside current gifts')
  assert.equal((await group()).giftIds.length,3)
  const staff=await recognitionMember(h,edge),agent=await h.command('agent.create',{label:'Tribute reader'})
  const frozen=await h.command('tributeNotification.prepare',{giftId},{as:staff})
  await h.command('tributeNotification.approve',{notificationId:frozen.id,version:1},{as:staff,status:403})
  await h.command('tributeNotification.prepare',{giftId},{as:'',headers:{authorization:'Bearer '+agent.token},status:403})
  await h.get(`/api/coffer/tribute-notifications/${frozen.id}/download`,{status:409})
  history=await h.get('/api/coffer/donors/'+source.id)
  const notification=history.tributeNotifications.find(n=>n.id===frozen.id)
  assert.equal(notification.recipient_name,'Jamie Ellis');assert.equal(notification.status,'prepared')
  assert.ok(!notification.body.includes('$'));assert.ok(!notification.body.includes('500'))
  const ownFile=await h.api('/api/coffer/donors/'+source.id+'/data-request',{requestedOn:new Intl.DateTimeFormat('en-CA',{timeZone:'America/New_York'}).format(new Date()),method:'email'})
  const ownText=JSON.stringify(ownFile)
  assert.ok(!ownText.includes('Jamie Ellis'));assert.ok(!ownText.includes('jamie.private@example.test'));assert.ok(!ownText.includes('12 Garden Street'))
  const beforeMessages=edge.messages.length
  await h.command('tributeNotification.approve',{notificationId:frozen.id,version:1})
  await h.command('tributeNotification.approve',{notificationId:frozen.id,version:1},{status:409})
  const downloaded=await h.request(`/api/coffer/tribute-notifications/${frozen.id}/download`)
  assert.equal(downloaded.status,200);assert.ok(!(await downloaded.text()).includes('$500'))
  assert.equal((await h.request(`/api/coffer/tribute-notifications/${frozen.id}/download`,{as:staff})).status,403)
  const printed=await h.request(`/app/tribute-notifications/${frozen.id}/print`);assert.equal(printed.status,200);assert.match(await printed.text(),/Jamie Ellis/)
  assert.equal(edge.messages.length,beforeMessages,'Preparation, approval, download and print never contact the family')
  const permitted=await giveRecognition(h,{...values,name:'Alex Ellis',email:'alex.tribute@example.test',amount:'30',tributeAmountPermission:'yes'})
  const alex=(await h.get('/api/coffer/donors')).donors.find(d=>d.email==='alex.tribute@example.test')
  const allowed=(await h.get('/api/coffer/donors/'+alex.id)).giftDepth.tributes[0]
  assert.equal(allowed.amount_permission,1)
  const visible=await h.command('tributeNotification.prepare',{giftId:allowed.gift_id})
  assert.match((await h.get('/api/coffer/donors/'+alex.id)).tributeNotifications.find(n=>n.id===visible.id).body,/\$30\.00/)
  const returned=await h.command('gift.record',{donorId:other.id,amount:'40',receivedOn:'2026-09-15',method:'check',goods:'none'})
  await h.command('tribute.record',{giftId:returned.id,kind:'memory',honoree:'Morgan Ellis',notifiedName:'Jamie Ellis',notifiedEmail:'jamie.private@example.test'})
  const staleNotification=await h.command('tributeNotification.prepare',{giftId:returned.id})
  await h.command('gift.reverse',{giftId:returned.id,reason:'Check cancellation'})
  await h.command('tributeNotification.approve',{notificationId:staleNotification.id,version:1},{status:409})
  assert.equal((await group()).totalCents,67500,'Reversal removes the contribution from the tribute total')
  assert.ok(permitted.sessionId)
  if(process.env.COFFER_TRIBUTE_BROWSER) {
   const {tributeGiftsBrowser}=await import('./tribute-gifts-browser.mjs')
   await tributeGiftsBrowser(h,{source,edge,directory:process.env.COFFER_TRIBUTE_BROWSER})
   const saved=await archive(h),fresh=await installation()
   try{await restore(fresh,saved);assert.deepEqual((await fresh.get('/api/coffer/donors/'+source.id)).tributeNotifications,(await h.get('/api/coffer/donors/'+source.id)).tributeNotifications);assert.deepEqual((await fresh.get('/api/coffer/tributes')).groups,(await h.get('/api/coffer/tributes')).groups)}finally{await fresh.close()}
   const survivor=await donor(h,'Jordan Remaining',{email:'jordan.remaining@example.test'})
   const from=(await h.get('/api/coffer/donors/'+source.id)).donor,into=(await h.get('/api/coffer/donors/'+survivor.id)).donor
   const merge=await h.command('donor.merge',{sourceDonorId:from.id,donorId:into.id,sourceVersion:from.version,version:into.version,reason:'duplicate_record'})
   assert.ok((await h.get('/api/coffer/donors/'+into.id)).tributeNotifications.some(n=>n.id===frozen.id))
   await h.command('donor.unmerge',{mergeId:merge.mergeId,reason:'incorrect_match'})
   await h.command('donor.erase',{donorId:source.id,confirm:'ERASE'})
   assert.equal((await h.request(`/api/coffer/tribute-notifications/${frozen.id}/download`)).status,404)
   assert.ok(!JSON.stringify(await archive(h)).includes('jordan.tribute@example.test'))
  }
 },{bindings:{STRIPE_SECRET_KEY:'sk_test_tribute_edge',MAIL_PROVIDER:'sendgrid'},outbound:async request=>{
  if(new URL(request.url).hostname==='api.stripe.com')stripeRequests.push(await request.clone().text())
  return edge.outbound(request)
 }})
}
