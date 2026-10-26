import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {run,donor,reviewed,archive,restore,installation} from './harness.mjs'
import {fixedNow} from './fixed-clock.mjs'

export async function eventPackagesJourney(){
 const sessions=new Map(),payments=new Map()
 const outbound=async request=>{
  const u=new URL(request.url),p=new URLSearchParams(await request.text())
  assert.equal(u.hostname,'api.stripe.com')
  if(u.pathname==='/v1/customers')return Response.json({id:'synthetic-coffer-package-customer-'+randomUUID()})
  if(u.pathname==='/v1/checkout/sessions'){
   const id='synthetic-coffer-package-session-'+sessions.size,pi='synthetic-coffer-package-payment-'+sessions.size,cents=Number(p.get('line_items[0][price_data][unit_amount]'))
   const session={id,metadata:{coffer_intent:p.get('metadata[coffer_intent]')},customer:p.get('customer'),currency:'usd',amount_total:cents,status:'complete',payment_status:'paid',payment_intent:pi,url:'https://checkout.stripe.com/c/pay/'+id}
   sessions.set(id,session);payments.set(pi,{id:pi,status:'succeeded',currency:'usd',amount_received:cents,created:Date.parse(fixedNow)/1000});return Response.json(session)
  }
  const row=u.pathname.startsWith('/v1/checkout/sessions/')?sessions.get(u.pathname.split('/').at(-1)):payments.get(u.pathname.split('/').at(-1));assert.ok(row,'Unexpected Stripe request '+u.pathname);return Response.json(row)
 }
 await run(async h=>{
  await reviewed(h)
  const person=async(name,email)=>({...await donor(h,name,{email}),name,email})
  const buyer=await person('Synthetic Coffer Table Buyer','synthetic-coffer-table-buyer@example.test'),guest=await person('Synthetic Coffer Table Guest','synthetic-coffer-table-guest@example.test'),twin=await donor(h,'Synthetic Coffer Guest Separate Record')
  const campaign=await h.api('/api/coffer/giving/campaigns',{name:'Synthetic Coffer package campaign',slug:'synthetic-coffer-packages',description:'Literacy programs supported by the gala.',fund:'Reading',goal:'60000'})
  await h.command('appealCode.define',{code:'SYNTHETIC-PACKAGES',name:'Synthetic Coffer package appeal'})
  const event=await h.command('event.create',{name:'Synthetic Coffer package gala',slug:'synthetic-coffer-package-gala',campaignId:campaign.id,appeal:'SYNTHETIC-PACKAGES',startsOn:'2026-10-17'})
  const table=await h.command('event.ticket',{eventId:event.id,name:'Reading partners table',kind:'table',seats:2,price:'1000',benefit:'300',benefitDescription:'Two gala dinners and table benefits'})
  const sponsor=await h.command('event.ticket',{eventId:event.id,name:'Literacy sponsor',kind:'sponsorship',seats:0,price:'2500',benefit:'100',benefitDescription:'Sponsor recognition benefit'})
  await h.command('custom.define',{key:'gala_meal',label:'Gala meal',kind:'constituent',type:'text',entry:'pick-one',choices:['Standard','Vegetarian']})
  await h.command('custom.define',{key:'gala_sessions',label:'Reading sessions',kind:'constituent',type:'number',entry:'free-form'})
  await h.command('event.question',{eventId:event.id,fieldKey:'gala_meal',label:'Meal preference',required:true})
  await h.command('event.question',{eventId:event.id,fieldKey:'gala_sessions',label:'Reading sessions planned'})
  const member=await h.person('synthetic-coffer-package-member@example.test'),admin=await h.person('synthetic-coffer-package-admin@example.test','admin')
  await h.command('event.question',{eventId:event.id,fieldKey:'gala_sessions',label:'Refused'},{as:member.cookie,status:403})
  const input={requestId:randomUUID(),ticketId:table.id,name:buyer.name,email:buyer.email,amount:'1',guest1Name:buyer.name,guest1Email:buyer.email,guest1Buyer:'yes',guest1DietaryNotes:'Nut allergy',guest1_answer_gala_meal:'Standard',guest1_answer_gala_sessions:'2',guest2Name:guest.name,guest2Email:guest.email,guest2DietaryNotes:'Gluten free',guest2_answer_gala_meal:'Vegetarian',guest2_answer_gala_sessions:'3','cf-turnstile-response':'synthetic-coffer-security-token'}
  const post=data=>h.request('/giving/events/'+event.slug+'/checkout',{method:'POST',as:'',headers:{'content-type':'application/x-www-form-urlencoded'},raw:new URLSearchParams(data).toString()})
  const refused=await post({...input,requestId:randomUUID(),guest2_answer_gala_meal:'Unrecognized'});assert.equal(refused.status,400)
  assert.equal((await post({...input,requestId:randomUUID(),guest2_answer_gala_meal:''})).status,400)
  assert.equal((await post({...input,requestId:randomUUID(),guest2_answer_gala_sessions:'many'})).status,400)
  let requestId=input.requestId
  if(process.env.COFFER_EVENTS_BROWSER){const {packageRegistrationBrowser}=await import('./event-packages-browser.mjs');requestId=await packageRegistrationBrowser(h,{event,table,sponsor,buyer,guest,directory:process.env.COFFER_EVENTS_BROWSER})}
  else{const result=await post(input);assert.equal(result.status,303,await result.text())}
  assert.equal((await h.get('/api/coffer/events?eventId='+event.id)).length,0,'Only paid package guests enter the private list')
  const session=[...sessions.values()].at(-1);assert.equal(session.amount_total,100000,'The server charges the package price once')
  assert.equal((await h.request('/giving/thanks?session_id='+session.id,{as:''})).status,200)
  assert.equal((await h.request('/giving/thanks?session_id='+session.id,{as:''})).status,200)
  if(!process.env.COFFER_EVENTS_BROWSER){assert.equal((await post(input)).status,303);assert.equal((await post({...input,guest2DietaryNotes:'Changed guest notes'})).status,409)}
  const rows=()=>h.get('/api/coffer/events?eventId='+event.id),guests=await rows();assert.equal(guests.length,2)
  const rBuyer=guests.find(r=>r.is_buyer),rGuest=guests.find(r=>!r.is_buyer)
  assert.equal(rBuyer.donor_id,buyer.id);assert.equal(rGuest.donor_id,null,'A package never silently matches the other guest by name or email')
  assert.equal(rGuest.dietary_notes,'Gluten free');assert.equal(JSON.parse(rGuest.answers_json).gala_meal,'Vegetarian')
  assert.equal((await h.get('/api/coffer/donors/'+guest.id)).customValues.length,0,'Unverified checkout answers never modify donor custom fields')
  await h.command('event.matchGuest',{registrationId:rGuest.id,donorId:guest.id,version:rGuest.version,reviewed:'yes'},{as:member.cookie,status:403})
  await h.command('event.matchGuest',{registrationId:rGuest.id,donorId:guest.id,version:rGuest.version},{status:400})
  await h.command('custom.set',{key:'gala_meal',recordId:guest.id,value:'Standard'})
  await h.command('event.matchGuest',{registrationId:rGuest.id,donorId:guest.id,version:rGuest.version,reviewed:'yes'},{status:409})
  await h.command('custom.set',{key:'gala_meal',recordId:guest.id,version:1,value:'Vegetarian',source:'Guest-confirmed correction'})
  const policy=await h.get('/api/coffer/engagement/settings');await h.command('engagement.settings',{version:policy.version,recency:0,frequency:0,amount:0,conversations:0,volunteering:0,opens:0,attendance:100})
  if(process.env.COFFER_EVENTS_BROWSER){const {packageStaffBrowser}=await import('./event-packages-browser.mjs');await packageStaffBrowser(h,{event,guest,registration:rGuest,directory:process.env.COFFER_EVENTS_BROWSER})}
  else{await h.command('event.checkIn',{registrationId:rGuest.id});const r=(await rows()).find(r=>r.id===rGuest.id);await h.command('event.matchGuest',{registrationId:r.id,donorId:guest.id,version:r.version,reviewed:'yes'},{as:admin.cookie})}
  await h.command('event.matchGuest',{registrationId:rGuest.id,donorId:guest.id,version:rGuest.version,reviewed:'yes'},{status:409})
  const current=await h.get('/api/coffer/donors/'+guest.id);assert.equal(current.engagement.attendance.count,1);assert.equal(current.engagement.attendance.points,20)
  assert.equal(JSON.parse(current.customValues.find(v=>v.field_key==='gala_sessions').value),'3')
  const history=await h.get('/api/coffer/donors/'+buyer.id),gift=history.gifts[0],letter=history.letters[0],receipt=(await h.get('/api/coffer/letters/'+letter.batch_id)).letters.find(l=>l.id===letter.id)
  assert.equal(gift.amount_cents,100000);assert.equal(gift.goods_cents,30000);assert.match(receipt.body,/\$700\.00 may be deductible/)
  assert.equal(current.gifts.length,0,'The guest does not inherit the purchaser payment')
  const file=await h.api('/api/coffer/donors/'+buyer.id+'/data-request',{requestedOn:'2026-10-17',method:'letter',reference:'SYNTHETIC-COFFER-PACKAGE'})
  assert.ok(!JSON.stringify(file).includes(guest.email));assert.ok(!JSON.stringify(file).includes('Gluten free'),'Buyer data files do not contain another guest notes')
  const publicHtml=await (await h.request('/giving/events/'+event.slug,{as:''})).text();for(const value of [buyer.email,guest.email,'Gluten free','Nut allergy'])assert.ok(!publicHtml.includes(value))
  await h.get('/api/coffer/events?eventId='+event.id,{as:member.cookie,status:403})
  const sponsorInput={requestId:randomUUID(),ticketId:sponsor.id,name:buyer.name,email:buyer.email,'cf-turnstile-response':'synthetic-coffer-security-token'}
  assert.equal((await post(sponsorInput)).status,303);const sponsorSession=[...sessions.values()].at(-1);assert.equal(sponsorSession.amount_total,250000)
  assert.equal((await h.request('/giving/thanks?session_id='+sponsorSession.id,{as:''})).status,200)
  assert.equal((await rows()).length,2,'A sponsor package without seats does not invent attendance')
  const sponsorHistory=await h.get('/api/coffer/donors/'+buyer.id),sponsorGift=sponsorHistory.gifts.find(g=>g.id!==gift.id),sponsorLetter=sponsorHistory.letters.find(l=>l.gift_id===sponsorGift.id)
  assert.equal(sponsorGift.goods_cents,10000);assert.match((await h.get('/api/coffer/letters/'+sponsorLetter.batch_id)).letters.find(l=>l.id===sponsorLetter.id).body,/\$2,400\.00 may be deductible/)
  const totals=await h.get('/api/coffer/giving/campaigns/'+campaign.id);assert.equal(totals.raisedCents,350000);assert.equal(totals.donorCount,1)
  const saved=await archive(h),fresh=await installation({entry:'tests/fixed-clock-worker.ts'})
  try{await restore(fresh,saved);const copy=await fresh.get('/api/coffer/events?eventId='+event.id);assert.equal(copy.find(r=>r.id===rGuest.id).dietary_notes,'Gluten free');assert.equal((await fresh.get('/api/coffer/donors/'+guest.id)).engagement.attendance.count,1)}finally{await fresh.close()}
  const compare=await h.get('/api/coffer/duplicates/compare?source='+guest.id+'&target='+twin.id),merged=await h.command('donor.merge',{sourceDonorId:guest.id,donorId:twin.id,sourceVersion:compare.source.version,version:compare.target.version,reason:'duplicate_record'})
  assert.equal((await rows()).find(r=>r.id===rGuest.id).donor_id,twin.id);await h.command('donor.unmerge',{mergeId:merged.mergeId,reason:'incorrect_match'});assert.equal((await rows()).find(r=>r.id===rGuest.id).donor_id,guest.id)
  await h.command('donor.erase',{donorId:buyer.id,confirm:'ERASE'});assert.equal((await rows()).length,1);assert.equal((await rows())[0].donor_id,guest.id,'Erasing the purchaser preserves the other guest own registration')
  await h.command('donor.erase',{donorId:guest.id,confirm:'ERASE'});assert.equal((await rows()).length,0)
  const newBuyer={name:'Synthetic Coffer New Buyer',email:'synthetic-coffer-new-table-buyer@example.test',guest1Name:'Synthetic Coffer New Buyer',guest1Email:'synthetic-coffer-new-table-buyer@example.test'}
  assert.equal((await post({...input,...newBuyer,requestId:randomUUID()})).status,409,'A fresh checkout cannot recreate an erased keyed guest')
  const after=await archive(h);assert.ok(!JSON.stringify(after).includes(guest.email));assert.ok(!JSON.stringify(after).includes('Gluten free'))
  const protectedCopy=await installation({entry:'tests/fixed-clock-worker.ts'})
  try{await restore(protectedCopy,saved,{status:400,laterJournal:{sourceIdentity:after[0].sourceIdentity,epoch:after[0].epoch,journal:after[0].journal}})}finally{await protectedCopy.close()}
 },{entry:'tests/fixed-clock-worker.ts',bindings:{STRIPE_SECRET_KEY:'synthetic-coffer-8101'},outbound})
}
