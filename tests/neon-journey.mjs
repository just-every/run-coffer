import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {run,reviewed,archive,restore} from './harness.mjs'
import {withBrowserWorker} from './browser-worker.mjs'
const key=n=>'synthetic-coffer-'+n
const email=n=>[key(n),'example.test'].join('@')
const post=(h,action,body,options)=>h.api('/api/coffer/move-in/'+action,body,options)
const historyFile=history=>({name:'neon-history.json',base64:Buffer.from(JSON.stringify(history)).toString('base64')})
const apply=async(h,p)=>{let j=await post(h,'apply',{id:p.id,fingerprint:p.fingerprint,acknowledged:'no'});while(j.state==='applying')j=await post(h,'continue',{id:p.id});assert.equal(j.state,'completed');return j}

function fixture(){
 const contact=(n,first,last)=>({firstName:first,lastName:last,email1:email(n),salutation:'Dearest '+first,addresses:[{addressId:key(n+100),isPrimaryAddress:true,type:{name:'Home'},addressLine1:n+' Reading Street',city:'Madison',stateProvince:{code:'WI'},zipCode:'53703',country:{name:'United States'},phone1:'+12025550180',phone1Type:'Mobile'}]})
 const account=(n,first,last,extra={})=>({accountId:key(n),primaryContact:contact(n,first,last),consent:{email:'GIVEN',mail:'GIVEN',phone:'GIVEN',sms:'NOT_ASKED'},...extra})
 const accounts=[account(7001,'Ava','Reed',{noSolicitation:true,accountCustomFields:[{id:'15',optionValues:[{id:'151',name:'Board'}]}]}),account(7002,'Bee','Reed',{email1OptOut:true,consent:{email:'GIVEN',mail:'DECLINED',phone:'DECLINED',sms:'NOT_ASKED'}}),account(7003,'Cleo','Chen'),account(7004,'Dana','Chen',{consent:{email:'NOT_ASKED',mail:'NOT_ASKED',phone:'NOT_ASKED',sms:'NOT_ASKED'}})]
 accounts.push(account(7005,'Eli','Unknown',{consent:{},sendTextOptIn:true}),account(7006,'Finn','Unknown'))
 accounts[5].primaryContact.addresses[0].addressLine1=accounts[4].primaryContact.addresses[0].addressLine1
 accounts[0].primaryContact.salutation='  Dearest Ava  '
 accounts[0].primaryContact.addresses[0].zipCodeSuffix='4567'
 accounts[5].primaryContact.deceased=true
 const payment=(amount,id)=>({id:key(id),amount,paymentStatus:'Succeeded',receivedDate:'2026-09-03T12:00:00Z',tenderType:1})
 const donation=(n,person,extra={})=>({id:key(n),accountId:key(person),date:'2026-09-03T12:00:00Z',amount:500,status:'Succeeded',sendAcknowledgeEmail:true,payments:[payment(500,n+1000)],fund:{id:'1',name:'Reading'},taxDeductibleInfo:{nonDeductibleAmount:0},...extra})
 const donations=[donation(7011,7001,{tribute:{type:'Memory',name:'Jordan Reed'},acknowledgee:{name:'River Reed',address:{addressLine1:'12 River Road',addressLine2:'Unit 4',city:'Madison',stateProvince:{code:'WI'},zipCode:'53703',zipCodeSuffix:'1234',country:{name:'United States'}}}}),donation(7012,7002,{tribute:{type:'Memory',name:'Jordan Reed'}}),donation(7013,7003)]
 const registrations=[{id:key(7021),eventId:'20',registrantAccountId:key(7003),registrationDateTime:'2026-09-03T12:00:00Z',registrationAmount:150,totalCharge:150,payments:[payment(150,8021)],taxDeductibleInfo:{nonDeductibleAmount:60,nonDeductibleDescription:'Gala meal'}}]
 const activities=[{id:key(7031),subject:'Source gift thank-you',activityType:{name:'Email'},activityDates:{startDate:'2026-09-04T12:00:00Z'},clientAccount:[{accountId:key(7001)}]},{id:key(7032),subject:'Independent credit thank-you',activityType:{name:'Phone call'},activityDates:{startDate:'2026-09-05T12:00:00Z'},clientAccount:[{accountId:key(7002)}]}]
 donations[0].donationCustomFields=[{id:'16',value:'123.45'}]
 activities[0].activityCustomFields=[{id:'17',value:'Discussed the reading room'}]
 const households=[{id:key(7041),name:'Reed readers',salutation:'The Reed Readers',contacts:[{accountId:key(7001),isPrimaryHouseHoldContact:true},{accountId:key(7002),isPrimaryHouseHoldContact:false}]},{id:key(7042),name:'Chen readers',contacts:[{accountId:key(7003),isPrimaryHouseHoldContact:false}]}]
 const history={accounts:Object.fromEntries(accounts.map(a=>[a.accountId,{preferenceOn:'2026-09-01',...(a.noSolicitation?{restrictionOn:'2026-09-01',codes:['No fundraising']}:{}),...(a.accountId===key(7004)?{status:'inactive',statusReason:'Source pause'}:{})}])),households:{[key(7041)]:{addressee:'The Reed Reading Family',informal:'Ava and Bee'}},donations:{[key(7011)]:{'Acknowledgment Status':'acknowledged','Acknowledgment Date':'2026-09-04','Acknowledgment Method':'email','Acknowledgment Interaction ID':key(7031),tributeGroup:key(7045)},[key(7012)]:{'Acknowledgment Status':'not acknowledged',tributeGroup:key(7045)},[key(7013)]:{'Acknowledgment Status':'do not acknowledge'}},softCredits:[{id:key(7051),accountId:key(7002),donationId:key(7011),amount:100,'Acknowledgment Status':'acknowledged','Acknowledgment Date':'2026-09-05','Acknowledgment Method':'phone call','Acknowledgment Interaction ID':key(7032)}]}
 delete history.accounts[key(7005)].preferenceOn
 history.accounts[key(7006)]={status:'deceased',deceasedOn:'2026-08-01'}
 const calls=[],state={reject:false,brokenPages:false}
 const outbound=async request=>{
  const url=new URL(request.url);assert.equal(url.origin,'https://api.neoncrm.com');assert.equal(request.headers.get('NEON-API-VERSION'),'2.12');assert.equal(request.headers.get('authorization'),'Basic '+Buffer.from(key(7000)+':'+key(7099)).toString('base64'))
  calls.push([request.method,url.pathname]);if(state.reject)return new Response('Unavailable',{status:401})
  const path=url.pathname.slice(3)
  if(path==='/accounts/search'){assert.equal(request.method,'POST');const body=await request.json();assert.deepEqual(body.searchFields,[]);const currentPage=body.pagination.currentPage;return Response.json({searchResults:accounts.slice(currentPage*2,currentPage*2+2).map(a=>({'Account ID':a.accountId})),pagination:{currentPage,totalPages:3,totalResults:state.brokenPages?7:6}})}
  if(path==='/payments/tenders')return Response.json([{id:'1',name:'Credit Card'}])
  if(path==='/customFields'&&url.searchParams.get('category')==='Account')return Response.json([{id:'15',name:'Membership interest',displayType:'Dropdown',dataType:'Text',component:'Account',optionValues:[{id:'151',name:'Board'},{id:'152',name:'Volunteer'}]}])
  if(path==='/customFields')return Response.json(url.searchParams.get('category')==='Donation'?[{id:'16',name:'Reviewed gift value',displayType:'OneLineText',dataType:'Currency'}]:[{id:'17',name:'Source conversation',displayType:'MultiLineText',dataType:'Text'}])
  if(path==='/households/listHouseholds')return Response.json(households)
  if(path==='/activities/search')return Response.json({searchResults:activities.map(a=>({'Activity ID':a.id})),pagination:{currentPage:0,totalPages:1,totalResults:activities.length}})
  const a=/^\/accounts\/([^/]+)(?:\/(donations|eventRegistrations))?$/.exec(path)
  if(a){if(!a[2])return Response.json({individualAccount:accounts.find(r=>r.accountId===a[1])});const rows=a[2]==='donations'?donations.filter(d=>d.accountId===a[1]):registrations.filter(d=>d.registrantAccountId===a[1]);return Response.json({[a[2]]:rows,pagination:{currentPage:0,totalPages:1,totalResults:rows.length}})}
  const activity=activities.find(a=>path==='/activities/'+a.id);if(activity)return Response.json(activity)
  assert.fail('Unexpected Neon request '+request.method+' '+path)
 }
 const input={source:'neon',neon:{organizationId:key(7000),apiKey:key(7099),currency:'USD'},files:[historyFile(history)],solicitCodes:{'No fundraising':{type:'stop'}}}
 return {input,history,accounts,donations,calls,state,outbound}
}

/** One migration sanity journey, with only documented Neon network requests faked. */
export async function neonJourney(){
 const f=fixture()
 await run(async h=>{
  await reviewed(h)
  const before=(await h.get('/api/coffer/donors')).total
  for(const currency of [undefined,'CAD'])await post(h,'preview',{...f.input,neon:{...f.input.neon,currency}},{status:400})
  f.state.reject=true;await post(h,'preview',f.input,{status:502});f.state.reject=false
  f.state.brokenPages=true;await post(h,'preview',f.input,{status:502});f.state.brokenPages=false
  assert.equal((await h.get('/api/coffer/donors')).total,before)
  f.donations[0].payments[0].paymentStatus='Refunded';await post(h,'preview',f.input,{status:400});f.donations[0].payments[0].paymentStatus='Succeeded'
  const distinctPayment=f.donations[1].payments[0].id;f.donations[1].payments[0].id=f.donations[0].payments[0].id
  await post(h,'preview',f.input,{status:400});f.donations[1].payments[0].id=distinctPayment
  const heldDonations=f.donations.splice(0)
  const accountsOnly=await post(h,'preview',{...f.input,files:[historyFile({accounts:f.history.accounts,households:f.history.households})]});assert.equal(accountsOnly.canApply,true,JSON.stringify(accountsOnly.diagnostics));assert.equal(accountsOnly.sourceTotals.giftCount,1,'The paid event is still the only monetary record');assert.equal(accountsOnly.sourceTotals.amountCents,15000)
  f.donations.push(...heldDonations)
  const contradictory=structuredClone(f.history);contradictory.accounts[key(7006)].status='active';await post(h,'preview',{...f.input,files:[historyFile(contradictory)]},{status:400})
  const futureDeath=structuredClone(f.history);futureDeath.accounts[key(7006)].deceasedOn='2999-01-01';await post(h,'preview',{...f.input,files:[historyFile(futureDeath)]},{status:400})
  const bad=structuredClone(f.history);bad.softCredits[0]['Acknowledgment Interaction ID']=key(7031)
  const refused=await post(h,'preview',{...f.input,files:[historyFile(bad)]});assert.equal(refused.canApply,false);assert.ok(refused.diagnostics.some(d=>d.code==='ACKNOWLEDGMENT_LINK'))
  await post(h,'apply',{id:refused.id,fingerprint:refused.fingerprint},{status:409})
  let preview=await post(h,'preview',f.input)
  assert.equal(preview.canApply,true,JSON.stringify(preview.diagnostics));assert.equal(preview.needsAcceptance,false,JSON.stringify(preview.unmapped))
  assert.equal(preview.sourceTotals.amountCents,165000);assert.equal(preview.sourceTotals.giftCount,4);assert.equal(preview.counts.donors,6);assert.equal(preview.counts.notes,2);assert.equal(preview.counts.householdsWithHead,1);assert.equal(preview.counts.householdsWithoutHead,2)
  assert.deepEqual(preview.sourceCoverage.counts,{accounts:6,donations:3,activities:2,eventRegistrations:1,households:2});assert.ok(preview.sourceCoverage.unsupported.includes('Memberships'))
  assert.ok(!JSON.stringify(preview).includes(key(7099)),'The key never enters review data')
  const member=await h.person(email(7081)),admin=await h.person(email(7082),'admin')
  await h.api('/auth/operator/status',{operatorId:admin.id,status:'inactive'})
  await post(h,'apply',{id:preview.id,fingerprint:preview.fingerprint},{as:member.cookie,status:403})
  const reads=f.calls.length
  await post(h,'preview',f.input,{as:member.cookie,status:403});await post(h,'preview',f.input,{as:admin.cookie,status:401})
  await post(h,'apply',{id:preview.id,fingerprint:preview.fingerprint},{as:admin.cookie,status:401});assert.equal(f.calls.length,reads,'Revoked authority cannot contact Neon')
  await post(h,'apply',{id:preview.id,fingerprint:'stale'},{status:409})
  const directory=process.env.COFFER_NEON_SHOTS
  if(directory)await mkdir(directory,{recursive:true})
  await withBrowserWorker(h,async(context,origin)=>{
   const page=await context.newPage();await page.goto(origin+'/app/move-in/crm')
   const form=page.locator('form').filter({has:page.getByRole('button',{name:'Preview Neon history',exact:true})})
   await form.getByLabel('Neon organization ID',{exact:true}).fill(f.input.neon.organizationId);await form.getByLabel('Neon API key',{exact:true}).fill(f.input.neon.apiKey);await form.locator('input[name=neonUsd]').check()
   await form.locator('input[type=file]').setInputFiles({name:'neon-history.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(f.history))})
   await form.locator('summary').click();await form.getByLabel('Code meanings').fill('No fundraising = stop')
   await form.getByRole('button',{name:'Preview Neon history',exact:true}).click();await page.waitForURL('**/app/move-in/crm/review?id=*')
   assert.equal(new URL(page.url()).searchParams.get('id'),preview.id)
   assert.ok((await page.textContent('body')).includes('Neon CRM'));assert.ok(!(await page.content()).includes(f.input.neon.apiKey))
   for(const width of [1440,390]){await page.setViewportSize({width,height:1000});if(width===1440)assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));if(directory)await page.screenshot({path:directory+'/neon-review-'+width+'.png',fullPage:true})}
   await page.setViewportSize({width:1440,height:1000});await page.locator('input[name=acknowledged][value=no]').check();await page.locator('input[name=confirm]').check();await page.getByRole('button',{name:'Move these records in',exact:true}).click();try{await page.waitForURL('**/app/move-in/crm/journal?id=*',{timeout:5000})}catch{throw Error('Native Neon apply: '+await page.textContent('body'))}
   assert.ok((await page.textContent('body')).includes('All totals match'))
   for(const width of [1440,390]){await page.setViewportSize({width,height:1000});if(directory)await page.screenshot({path:directory+'/neon-imported-'+width+'.png',fullPage:true})}
   await page.setViewportSize({width:1440,height:1000})
   const imported=(await h.get('/api/coffer/donors')).donors.find(d=>d.name==='Ava Reed')
   await page.goto(origin+'/app/donors/'+imported.id)
   assert.ok((await page.textContent('body')).includes('Jordan Reed'),'The donor history shows its source tribute')
   const custom=page.locator('#custom-fields');if(await custom.count()){await custom.locator('summary').first().click();assert.ok((await custom.textContent()).includes('Membership interest'))}
   for(const width of [1440,390]){await page.setViewportSize({width,height:1000});if(directory)await page.screenshot({path:directory+'/neon-donor-'+width+'.png',fullPage:true})}
   await page.close()
  })
  const people=(await h.get('/api/coffer/donors?status=all')).donors
  const person=n=>{const p=f.accounts.find(a=>a.accountId===key(n)).primaryContact;return people.find(d=>d.name===p.firstName+' '+p.lastName)}
  const ava=await h.get('/api/coffer/donors/'+person(7001).id),bee=await h.get('/api/coffer/donors/'+person(7002).id),cleo=await h.get('/api/coffer/donors/'+person(7003).id)
  const unknown=await h.get('/api/coffer/donors/'+person(7005).id),deceased=await h.get('/api/coffer/donors/'+person(7006).id)
  assert.equal(deceased.donor.constituent_status,'deceased');assert.equal(deceased.donor.deceased_on,'2026-08-01');assert.equal(unknown.donor.household_id,deceased.donor.household_id);assert.equal((await h.get('/api/coffer/households/'+unknown.donor.household_id)).household.head_donor_id,null,'Shared source address never infers a head')
  assert.ok(unknown.consents.every(p=>p.status==='unknown'&&p.evidence.includes('source date unknown')&&p.recorded_at),'Unknown choices retain explicit unknown provenance')
  assert.equal(ava.donor.informal_salutation,'  Dearest Ava  ');assert.equal(ava.donor.first_name,'Ava');assert.equal(ava.donor.postal_code,'53703-4567')
  assert.equal(ava.contactPoints.filter(p=>p.kind==='phone')[0].type,'mobile');assert.equal(ava.contactPoints.filter(p=>p.kind==='address')[0].is_primary,1)
  const fields=(await h.get('/api/coffer/custom-fields')).fields,field=fields.find(d=>d.key==='neon_15');assert.equal(field.entry,'pick-one');assert.deepEqual(JSON.parse(field.choices),['Board','Volunteer']);assert.equal(ava.customValues.find(v=>v.field_key==='neon_15').value,'"Board"');assert.equal(ava.customValues.find(v=>v.field_key==='neon_donation_16').value,'"12345"');assert.equal(ava.customValues.find(v=>v.field_key==='neon_activity_17').value,'"Discussed the reading room"')
  const gift=ava.gifts.find(g=>g.reference==='neon:'+key(7011)),waiting=bee.gifts[0],event=cleo.gifts.find(g=>g.reference==='neon:event:'+key(7021))
  assert.equal(gift.method,'card','Tender catalog names determine the payment method, not an assumed numeric ID');assert.equal(gift.acknowledgment.status,'acknowledged');assert.equal(gift.acknowledgment.acknowledged_on,'2026-09-04');assert.equal(gift.acknowledgment.source,'Neon CRM');assert.equal(gift.acknowledgment.link.id,ava.depth.interactions[0].id)
  assert.equal(waiting.acknowledgment.status,'not acknowledged','A send option is never a historical acknowledgment')
  assert.equal(event.goods_cents,6000);assert.equal(event.goods,'provided');assert.equal(event.amount_cents,15000);assert.equal(gift.goods,'none')
  assert.deepEqual((await h.get('/api/coffer/letters')).due.map(g=>g.reference).sort(),['neon:'+key(7012),'neon:event:'+key(7021)].sort())
  const credit=bee.giftDepth.creditedGifts[0];assert.equal(credit.amount_cents,10000);assert.equal(credit.acknowledgment.status,'acknowledged');assert.equal(credit.acknowledgment.acknowledgedOn,'2026-09-05');assert.equal(credit.acknowledgment.method,'phone call');assert.equal(credit.acknowledgment.link.id,bee.depth.interactions[0].id)
  assert.equal(ava.solicitation.type,'stop');assert.equal(ava.solicitation.source_ref,'neon:'+key(7001));assert.equal(ava.solicitation.source_on,'2026-09-01')
  assert.deepEqual(Object.fromEntries(bee.consents.map(p=>[p.channel,p.status])),{email:'withdrawn',mail:'withdrawn',phone:'withdrawn',sms:'unknown'});assert.ok(bee.consents.every(p=>p.method==='neon export'&&p.captured_on==='2026-09-01'&&p.recorded_at))
  const hh=await h.get('/api/coffer/households/'+ava.donor.household_id)
  assert.equal(hh.household.head_donor_id,person(7001).id,'Explicit restricted source head remains eligible');assert.equal(hh.household.head_source,'neon');assert.ok(hh.household.head_imported_at);assert.equal(hh.household.addressee_override,'The Reed Reading Family');assert.equal(hh.household.formal_override,'The Reed Readers')
  assert.equal((await h.get('/api/coffer/households/'+cleo.donor.household_id)).household.head_donor_id,null)
  assert.equal((await h.get('/api/coffer/tributes')).groups.find(g=>g.honoree==='Jordan Reed').totalCents,100000);assert.equal(ava.giftDepth.tributes[0].source_group,key(7045));assert.equal(ava.giftDepth.tributes[0].amount_permission,0);assert.equal(ava.giftDepth.tributes[0].notified_address,'12 River Road, Unit 4, Madison, WI, 53703-1234, United States')
  assert.equal((await h.get('/api/coffer/move-in/journal?id='+preview.id)).job.check_report.matches,true)
  const saved=await archive(h);assert.ok(!JSON.stringify(saved).includes(f.input.neon.apiKey),'The archive never retains the Neon key')
  await run(async fresh=>{await restore(fresh,saved);assert.deepEqual((await fresh.get('/api/coffer/donors/'+person(7002).id)).consents,bee.consents);assert.equal((await fresh.get('/api/coffer/donors/'+person(7001).id)).gifts[0].acknowledgment.link.id,gift.acknowledgment.link.id);await post(fresh,'undo',{id:preview.id});assert.equal((await fresh.get('/api/coffer/donors?status=all')).total,0);assert.equal((await fresh.get('/api/coffer/custom-fields')).fields.some(f=>f.key==='neon_15'),false)})
  const repeat=await post(h,'preview',{...f.input,solicitCodes:undefined});assert.equal(repeat.prior.state,'completed');assert.equal((await apply(h,repeat)).unchanged,true,'Saved code meanings are reused without duplicate gifts or consent')
  await post(h,'undo',{id:preview.id});assert.equal((await h.get('/api/coffer/donors?status=all')).total,0)
  preview=await post(h,'preview',f.input);await apply(h,preview)
  const current=await h.get('/api/coffer/households/'+hh.household.id);await h.command('household.update',{householdId:hh.household.id,version:current.household.version,informal_override:'A later household greeting'})
  await post(h,'undo',{id:preview.id},{status:409});assert.equal((await h.get('/api/coffer/households/'+hh.household.id)).household.informal_override,'A later household greeting')
  const notice=await h.command('tributeNotification.prepare',{giftId:gift.id});const prepared=(await h.get('/api/coffer/donors/'+person(7001).id)).tributeNotifications.find(n=>n.id===notice.id);assert.equal(prepared.recipient_name,'River Reed');assert.ok(!prepared.body.includes('$'))
  await h.command('tributeNotification.approve',{notificationId:notice.id,version:1});assert.ok(!(await (await h.request('/api/coffer/tribute-notifications/'+notice.id+'/download')).text()).includes('$500'))
  const appeal=await h.command('appeal.prepare',{name:'Neon first appeal',channel:'email'});assert.equal(appeal.recipients,1);assert.equal(appeal.excluded['do not solicit'],1);assert.equal(appeal.excluded['consent withdrawn'],1);assert.equal(appeal.excluded.inactive,1);assert.equal(appeal.excluded.deceased,1);assert.equal(appeal.excluded['no consent recorded'],1)
  const native=(await h.get('/api/coffer/donors/'+person(7001).id)).donor
  await h.command('donor.update',{donorId:native.id,version:native.version,name:'Ava Native Revised',email:native.email,phone:native.phone,addressLine1:native.address_line1,addressLine2:native.address_line2,city:native.city,region:native.region,postalCode:native.postal_code,country:native.country,household:hh.household.name})
  const added=structuredClone(f.donations[0]);added.id=key(7061);added.amount=75;added.payments[0].id=key(7062);added.payments[0].amount=75;delete added.tribute;delete added.acknowledgee;f.donations.push(added)
  f.accounts[0].primaryContact.salutation='An older source greeting'
  const another=await post(h,'preview',f.input);assert.equal(another.canApply,true,JSON.stringify(another.diagnostics));assert.equal(another.sourceTotals.amountCents,172500);assert.ok(another.diagnostics.some(d=>d.code==='ALREADY_MOVED_IN'))
  await apply(h,another)
  const matched=await h.get('/api/coffer/donors/'+native.id);assert.equal(matched.donor.name,'Ava Native Revised');assert.equal(matched.donor.informal_salutation,'  Dearest Ava  ');assert.equal(matched.totals.lifetimeCents,57500);assert.equal((await h.get('/api/coffer/donors?status=all')).total,6,'Source IDs match the existing donor without copying profiles')
  assert.equal((await apply(h,await post(h,'preview',f.input))).unchanged,true)
  await h.command('gift.reverse',{giftId:waiting.id,reason:'Source reconciliation correction'});assert.equal((await h.get('/api/coffer/tributes')).groups.find(g=>g.honoree==='Jordan Reed').totalCents,50000,'Signed ledger corrections reconcile tribute totals')
  await h.command('consent.record',{donorIds:[person(7002).id],channel:'email',status:'withdrawn',method:'paper form',evidence:key(7089),capturedOn:'2026-09-02'})
  const changed=structuredClone(f.history);changed.accounts[key(7002)].preferenceOn='2026-08-01'
  const later=await post(h,'preview',{...f.input,files:[historyFile(changed)]});assert.equal(later.canApply,false);assert.ok(later.diagnostics.some(d=>d.code==='SOLICITATION_CHANGED'))
  await h.command('donor.erase',{donorId:person(7002).id,confirm:'ERASE'});assert.equal((await post(h,'preview',f.input)).canApply,false,'An erased account cannot return through Neon replay')
  const erasedJob=await h.get('/api/coffer/move-in/journal?id='+another.id);assert.equal(erasedJob.job.redacted,1);assert.deepEqual(erasedJob.job.report,{})
  await post(h,'apply',{id:another.id,fingerprint:another.fingerprint},{status:409})
  assert.ok(!JSON.stringify(await archive(h)).includes(email(7002)),'Erasure removes reused-account source history from every retained review and archive')
 },{outbound:f.outbound})
}
