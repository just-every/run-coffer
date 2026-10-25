import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {run,donor,reviewed,archive,restore,installation} from './harness.mjs'
import {fixedNow} from './fixed-clock.mjs'

export async function fundraisingEventsJourney(){
 const sessions=new Map(),payments=new Map()
 const outbound=async request=>{
  const u=new URL(request.url),p=new URLSearchParams(await request.text())
  assert.equal(u.hostname,'api.stripe.com')
  if(u.pathname==='/v1/customers')return Response.json({id:'synthetic-coffer-customer-'+randomUUID()})
  if(u.pathname==='/v1/checkout/sessions'){
   assert.equal(p.get('mode'),'payment');assert.equal(p.get('line_items[0][price_data][unit_amount]'),'15000','The server prices the ticket')
   const id='synthetic-coffer-session-'+sessions.size,pi='synthetic-coffer-payment-'+sessions.size
   const session={id,metadata:{coffer_intent:p.get('metadata[coffer_intent]')},customer:p.get('customer'),currency:'usd',amount_total:15000,status:'complete',payment_status:'paid',payment_intent:pi,url:'https://checkout.stripe.com/c/pay/'+id}
   sessions.set(id,session);payments.set(pi,{id:pi,status:'succeeded',currency:'usd',amount_received:15000,created:Date.parse(fixedNow)/1000})
   return Response.json(session)
  }
  const value=u.pathname.startsWith('/v1/checkout/sessions/')?sessions.get(u.pathname.split('/').at(-1)):payments.get(u.pathname.split('/').at(-1))
  assert.ok(value,'Unexpected Stripe request '+u.pathname);return Response.json(value)
 }
 await run(async h=>{
  await reviewed(h)
  const day='2026-10-17',campaign=await h.api('/api/coffer/giving/campaigns',{name:'Riverbend autumn campaign',slug:'autumn-reading',description:'Reading programs for local families.',fund:'Reading',goal:'60000'})
  await h.command('appealCode.define',{code:'GALA26',name:'Autumn literacy gala'})
  const event=await h.command('event.create',{name:'Riverbend literacy gala',slug:'literacy-gala',campaignId:campaign.id,appeal:'GALA26',startsOn:day})
  const ticket=await h.command('event.ticket',{eventId:event.id,name:'Gala dinner',price:'150',benefit:'60',benefitDescription:'Gala dinner'})
  const member=await h.person('synthetic-coffer-event-staff@example.test')
  await h.command('event.create',{name:'Refused',slug:'refused',campaignId:campaign.id,appeal:'GALA26',startsOn:day},{as:member.cookie,status:403})
  await h.get('/api/coffer/events',{as:member.cookie,status:403});await h.get('/api/coffer/events',{as:'',status:401})
  const guest={...await donor(h,'Maya Rivera'),name:'Maya Rivera',email:'maya.rivera@example.org'},other=await donor(h,'Leo Bennett'),duplicate=await donor(h,'Maya Second Record')
  const values={requestId:randomUUID(),ticketId:ticket.id,name:guest.name,email:guest.email,amount:'1',frequency:'monthly','cf-turnstile-response':'synthetic-coffer-security-token'}
  const post=async(data,options={})=>h.request('/giving/events/literacy-gala/checkout',{method:'POST',as:'',headers:{'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams(data).toString(),...options})
  assert.equal((await post({...values,ticketId:'unknown'})).status,400)
  assert.equal((await h.get('/api/coffer/events?eventId='+event.id)).length,0,'Unpaid registrations do not enter the guest list')
  if(process.env.COFFER_EVENTS_BROWSER){
   const {purchaseGalaTicket}=await import('./fundraising-events-browser.mjs')
   values.requestId=await purchaseGalaTicket(h,{event,ticket,guest,directory:process.env.COFFER_EVENTS_BROWSER,sessions})
  }else{const checkout=await post(values);assert.equal(checkout.status,303,await checkout.text())}
  const session=[...sessions.keys()][0],thanks=await h.request('/giving/thanks?session_id='+session,{as:''});assert.equal(thanks.status,200,await thanks.text())
  assert.equal((await h.request('/giving/thanks?session_id='+session,{as:''})).status,200)
  const changed=await h.request('/give/autumn-reading/checkout',{method:'POST',as:'',headers:{'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams({...values,amount:'150',frequency:'once',appeal:'GALA26'}).toString()})
  assert.equal(changed.status,409,'An event checkout cannot be reused as a different gift door')
  const guests=await h.get('/api/coffer/events?eventId='+event.id);assert.equal(guests.length,1)
  const registration=guests[0];assert.equal(registration.donor_id,guest.id)
  const history=await h.get('/api/coffer/donors/'+guest.id);assert.equal(history.gifts.length,1);assert.equal(history.gifts[0].goods_cents,6000)
  assert.equal(history.gifts[0].amount_cents,15000)
  const letter=history.letters[0],receipt=(await h.get('/api/coffer/letters/'+letter.batch_id)).letters[0]
  assert.match(receipt.body,/\$150\.00/);assert.match(receipt.body,/\$60\.00/);assert.match(receipt.body,/\$90\.00 may be deductible/)
  const attribution=await h.get('/api/coffer/reports/attribution');assert.equal(attribution.channel.find(r=>r.key==='event').amountCents,15000);assert.equal(attribution.appeal.find(r=>r.key==='GALA26').amountCents,15000)
  const progress=await h.get('/api/coffer/giving/campaigns/'+campaign.id);assert.equal(progress.raisedCents,15000);assert.equal(progress.donorCount,1);assert.equal(progress.pledgedOutstandingCents,0);assert.equal(progress.softCreditCents,0)
  const policy=await h.get('/api/coffer/engagement/settings')
  await h.command('engagement.settings',{version:policy.version,recency:0,frequency:0,amount:0,conversations:0,volunteering:0,opens:0,attendance:100})
  assert.equal((await h.get('/api/coffer/donors/'+guest.id)).engagement.attendance.count,0)
  await h.command('event.checkIn',{registrationId:registration.id},{as:member.cookie,status:403})
  if(process.env.COFFER_EVENTS_BROWSER){
   const {eventsBrowser}=await import('./fundraising-events-browser.mjs');await eventsBrowser(h,{event,registration,guest,campaign,letter,directory:process.env.COFFER_EVENTS_BROWSER,sessions})
  }else await h.command('event.checkIn',{registrationId:registration.id})
  await h.command('event.checkIn',{registrationId:registration.id})
  const attended=await h.get('/api/coffer/donors/'+guest.id)
  assert.deepEqual(attended.engagement.attendance,{count:1,basePoints:5,weight:100,points:20});assert.equal(attended.engagement.score,20)
  const timeline=await (await h.request('/app/donors/'+guest.id+'?timelineKind=event&timelineFrom='+day+'&timelineTo='+day)).text();assert.match(timeline,/Riverbend literacy gala/);assert.match(timeline,/Checked in to event/)
  const excluded=await (await h.request('/app/donors/'+guest.id+'?timelineKind=event&timelineFrom=2026-10-18')).text();assert.ok(!excluded.includes('Checked in to event'))
  const saved=await archive(h),fresh=await installation({entry:'tests/fixed-clock-worker.ts'})
  try{await restore(fresh,saved);assert.equal((await fresh.get('/api/coffer/events?eventId='+event.id))[0].checked_in_at,fixedNow);assert.equal((await fresh.get('/api/coffer/donors/'+guest.id)).engagement.attendance.points,20)}finally{await fresh.close()}
  const comparison=await h.get(`/api/coffer/duplicates/compare?source=${guest.id}&target=${duplicate.id}`)
  const merge=await h.command('donor.merge',{sourceDonorId:guest.id,donorId:duplicate.id,sourceVersion:comparison.source.version,version:comparison.target.version,reason:'duplicate_record'})
  assert.equal((await h.get('/api/coffer/events?eventId='+event.id))[0].donor_id,duplicate.id)
  assert.equal((await h.get('/api/coffer/donors/'+duplicate.id)).engagement.attendance.count,1)
  await h.command('donor.unmerge',{mergeId:merge.mergeId,reason:'incorrect_match'})
  assert.equal((await h.get('/api/coffer/events?eventId='+event.id))[0].donor_id,guest.id)
  await h.command('donor.erase',{donorId:guest.id,confirm:'ERASE'})
  assert.equal((await h.get('/api/coffer/events?eventId='+event.id)).some(r=>r.donor_id===guest.id),false)
  assert.equal((await h.get('/api/coffer/donors/'+other.id)).engagement.attendance.count,0)
  const after=await archive(h),erased=JSON.stringify(after);assert.ok(!erased.includes('Maya Rivera'))
  const protectedRestore=await installation({entry:'tests/fixed-clock-worker.ts'})
  try{await restore(protectedRestore,saved,{status:400,laterJournal:{sourceIdentity:after[0].sourceIdentity,epoch:after[0].epoch,journal:after[0].journal}});assert.equal((await protectedRestore.get('/api/coffer/events?eventId='+event.id)).length,0)}finally{await protectedRestore.close()}
 },{entry:'tests/fixed-clock-worker.ts',bindings:{STRIPE_SECRET_KEY:'synthetic-coffer-8001'},outbound})
}
