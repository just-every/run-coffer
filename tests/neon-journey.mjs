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
 accounts[0].primaryContact.email2=email(7191);accounts[0].primaryContact.email3=email(7192)
 accounts[0].primaryContact.addresses.push({addressId:key(7193),isPrimaryAddress:false,type:{name:'Work'},addressLine1:'10 Work Lane',addressLine2:'Room 2',addressLine3:'Reading wing',city:'Madison',stateProvince:{code:'WI'},zipCode:'53703',country:{name:'United States'},phone1:'+12025550181',phone1Type:'Work',phone2:'+12025550182',phone2Type:'Home'},{addressId:key(7194),isPrimaryAddress:false,type:{name:'Other'},addressLine1:'12 Other Lane',city:'Madison',stateProvince:{code:'WI'},zipCode:'53703',country:{name:'United States'},phone1:'+12025550183',phone1Type:'Other'})
 accounts[0].primaryContact.addresses[2].startDate='2026-05-01';accounts[0].primaryContact.addresses[2].endDate='2026-10-01'
 accounts[5].primaryContact.deceased=true
 const payment=(amount,id)=>({id:key(id),amount,paymentStatus:'Succeeded',receivedDate:'2026-09-03T12:00:00Z',tenderType:1})
 const donation=(n,person,extra={})=>({id:key(n),accountId:key(person),date:'2026-09-03T12:00:00Z',amount:500,status:'Succeeded',sendAcknowledgeEmail:true,payments:[payment(500,n+1000)],fund:{id:'1',name:'Reading'},taxDeductibleInfo:{nonDeductibleAmount:0},...extra})
 const donations=[donation(7011,7001,{tribute:{type:'Memory',name:'Jordan Reed'},acknowledgee:{name:'River Reed',address:{addressLine1:'12 River Road',addressLine2:'Unit 4',city:'Madison',stateProvince:{code:'WI'},zipCode:'53703',zipCodeSuffix:'1234',country:{name:'United States'}}}}),donation(7012,7002,{tribute:{type:'Memory',name:'Jordan Reed'}}),donation(7013,7003)]
 const split=donation(7151,7003,{tribute:{type:'Honor',name:'Reading mentors'},taxDeductibleInfo:{nonDeductibleAmount:50},payments:[{...payment(200,8151),receivedDate:'2025-12-31T12:00:00Z'},{...payment(300,8152),receivedDate:'2026-01-02T12:00:00Z'}]});donations.push(split)
 const registrations=[{id:key(7021),eventId:'20',registrantAccountId:key(7003),registrationDateTime:'2026-09-03T12:00:00Z',registrationAmount:150,totalCharge:150,payments:[payment(150,8021)],taxDeductibleInfo:{nonDeductibleAmount:60,nonDeductibleDescription:'Gala meal'},tickets:[{ticketId:21,ticketSequence:1,attendees:[{attendeeId:1,registrantAccountId:key(7003),accountId:key(7003),registrationId:key(7021),firstName:'Cleo',lastName:'Chen',email:email(7003),ticketName:'Reading gala',markedAttended:true,registrationStatus:'SUCCEEDED'},{attendeeId:2,registrantAccountId:key(7003),accountId:key(7002),registrationId:key(7021),firstName:'Bee',lastName:'Reed',email:email(7002),ticketName:'Reading gala',markedAttended:false,registrationStatus:'SUCCEEDED'}]}]}]
 const memberships=[{id:key(7101),accountId:key(7003),membershipLevel:{id:'31',name:'Reading circle'},membershipTerm:{id:'32',name:'Annual'},termUnit:'YEAR',termDuration:1,termStartDate:'2026-09-03',termEndDate:'2027-09-02',transactionDate:'2026-09-03',fee:120,totalCharge:120,status:'SUCCEEDED',autoRenewal:true,isActive:true,payments:[payment(120,8101)],taxDeductibleInfo:{nonDeductibleAmount:20,nonDeductibleDescription:'Member book'}},{id:key(7102),accountId:key(7002),membershipLevel:{id:'33',name:'Former reader'},membershipTerm:{name:'Complimentary'},termStartDate:'2024-01-01',termEndDate:'2024-12-31',fee:0,status:'SUCCEEDED',autoRenewal:false,isActive:false,payments:[]}]
 const pledges=[{id:key(7111),accountId:key(7003),date:'2026-09-01',amount:1000,fund:{id:'1',name:'Reading'},pledgeStatus:'Open',tribute:{type:'Honor',name:'Book keepers'},acknowledgee:{name:'Pat Book',email:email(7172)},donationCustomFields:[{id:'16',value:'25.50'}]}]
 pledges.push({id:key(7161),accountId:key(7003),date:'2026-08-01',amount:100,fund:{id:'1',name:'Reading'},pledgeStatus:'Closed'})
 const installments=[{id:key(7112),pledgeId:key(7111),expectedDate:'2026-09-03',amount:500},{id:key(7113),pledgeId:key(7111),expectedDate:'2026-12-03',amount:500}]
 installments.push({id:key(7162),pledgeId:key(7161),expectedDate:'2026-09-01',amount:100})
 const pledgePayments=[{id:key(7114),pledgeId:key(7111),installmentId:key(7113),date:'2026-09-03',payment:payment(250,8114),taxDeductibleInfo:{nonDeductibleAmount:0}}]
 const recurring=[{id:'7121',accountId:key(7003),amount:35,recurringPeriod:1,recurringPeriodType:'MONTH',nextDate:'2026-11-03',creditCardOnline:{token:key(7122),cardNumberLastFour:'1234'}},{id:'7123',accountId:key(7002),amount:200,recurringPeriod:1,recurringPeriodType:'YEAR',nextDate:'2026-12-03',ach:{token:key(7124),accountNumber:'Do not retain source bank detail'}}]
 const activities=[{id:key(7031),subject:'Source gift thank-you',activityType:{name:'Email'},activityDates:{startDate:'2026-09-04T12:00:00Z'},clientAccount:[{accountId:key(7001)}]},{id:key(7032),subject:'Independent credit thank-you',activityType:{name:'Phone call'},activityDates:{startDate:'2026-09-05T12:00:00Z'},clientAccount:[{accountId:key(7002)}]}]
 donations[0].donationCustomFields=[{id:'16',value:'123.45'}]
 activities[0].activityCustomFields=[{id:'17',value:'Discussed the reading room'}]
 activities.push({id:key(7033),subject:'Joint reading-room meeting',activityType:{name:'Meeting'},activityDates:{startDate:'2026-09-06'},status:{name:'Completed'},clientAccount:[{accountId:key(7002)},{accountId:key(7003)}],activityCustomFields:[{id:'17',value:'Shared source history'}]})
 const households=[{id:key(7041),name:'Reed readers',salutation:'The Reed Readers',contacts:[{accountId:key(7001),isPrimaryHouseHoldContact:true},{accountId:key(7002),isPrimaryHouseHoldContact:false}]},{id:key(7042),name:'Chen readers',contacts:[{accountId:key(7003),isPrimaryHouseHoldContact:false}]}]
 const history={accounts:Object.fromEntries(accounts.map(a=>[a.accountId,{preferenceOn:'2026-09-01',...(a.noSolicitation?{restrictionOn:'2026-09-01',codes:['No fundraising']}:{}),...(a.accountId===key(7004)?{status:'inactive',statusReason:'Source pause'}:{})}])),households:{[key(7041)]:{addressee:'The Reed Reading Family',informal:'Ava and Bee'}},donations:{[key(7011)]:{'Acknowledgment Status':'acknowledged','Acknowledgment Date':'2026-09-04','Acknowledgment Method':'email','Acknowledgment Interaction ID':key(7031),tributeGroup:key(7045)},[key(7012)]:{'Acknowledgment Status':'not acknowledged',tributeGroup:key(7045)},[key(7013)]:{'Acknowledgment Status':'do not acknowledge'}},softCredits:[{id:key(7051),accountId:key(7002),donationId:key(7011),amount:100,'Acknowledgment Status':'acknowledged','Acknowledgment Date':'2026-09-05','Acknowledgment Method':'phone call','Acknowledgment Interaction ID':key(7032)}]}
 history.accounts[key(7001)].seasonalAddresses={[key(7194)]:{sourceStart:'2026-05-01',sourceEnd:'2026-10-01',from:'05-01',through:'10-01'}}
 history.pledges={[key(7111)]:{tributeGroup:key(7171)},[key(7161)]:{adjustments:[{id:key(7163),installmentId:key(7162),amount:100,on:'2026-08-10',reason:'Source-backed cancellation of the unpaid promise'}]}}
 history.payments={[key(8151)]:{goodsAmount:20},[key(8152)]:{goodsAmount:30}}
 history.donations[key(7151)]={'Acknowledgment Status':'do not acknowledge',tributeGroup:key(7152)}
 history.softCredits.push({id:key(7155),accountId:key(7001),donationId:key(7151),paymentId:key(8151),amount:100,'Acknowledgment Status':'do not acknowledge'})
 history.memberships={[key(7101)]:{'Acknowledgment Status':'do not acknowledge'}}
 history.pledgePayments={[key(7114)]:{'Acknowledgment Status':'do not acknowledge'}}
 history.recurring={'7121':{customerReference:key(7125),paymentMethodReference:key(7122)}}
 delete history.accounts[key(7005)].preferenceOn
 history.accounts[key(7006)]={status:'deceased',deceasedOn:'2026-08-01'}
 const calls=[],state={reject:false,brokenPages:false}
 const outbound=async request=>{
  const url=new URL(request.url);assert.equal(url.origin,'https://api.neoncrm.com');assert.equal(request.headers.get('NEON-API-VERSION'),'2.12');assert.ok([key(7000),key(7008)].map(id=>'Basic '+Buffer.from(id+':'+key(7099)).toString('base64')).includes(request.headers.get('authorization')))
  calls.push([request.method,url.pathname]);if(state.reject)return new Response('Unavailable',{status:401})
  const path=url.pathname.slice(3)
  if(path==='/accounts/search'){assert.equal(request.method,'POST');const body=await request.json();assert.deepEqual(body.searchFields,[]);const currentPage=body.pagination.currentPage;return Response.json({searchResults:accounts.slice(currentPage*2,currentPage*2+2).map(a=>({'Account ID':a.accountId})),pagination:{currentPage,totalPages:3,totalResults:state.brokenPages?7:6}})}
  if(path==='/events/20')return Response.json({id:'20',name:'Source reading gala',eventDates:{startDate:'2026-09-03T18:00:00Z'}})
  if(path==='/payments/tenders')return Response.json([{id:'1',name:'Credit Card'}])
  if(path==='/customFields'&&url.searchParams.get('category')==='Account')return Response.json([{id:'15',name:'Membership interest',displayType:'Dropdown',dataType:'Text',component:'Account',optionValues:[{id:'151',name:'Board'},{id:'152',name:'Volunteer'}]}])
  if(path==='/customFields')return Response.json(url.searchParams.get('category')==='Donation'?[{id:'16',name:'Reviewed gift value',displayType:'OneLineText',dataType:'Currency'}]:[{id:'17',name:'Source conversation',displayType:'MultiLineText',dataType:'Text'}])
  if(path==='/households/listHouseholds')return Response.json(households)
  if(path==='/activities/search')return Response.json({searchResults:activities.map(a=>({'Activity ID':a.id})),pagination:{currentPage:0,totalPages:1,totalResults:activities.length}})
  const a=/^\/accounts\/([^/]+)(?:\/(donations|eventRegistrations|memberships|pledges))?$/.exec(path)
  if(a){if(!a[2])return Response.json({individualAccount:accounts.find(r=>r.accountId===a[1])});const rows=a[2]==='donations'?donations.filter(d=>d.accountId===a[1]):a[2]==='memberships'?memberships.filter(d=>d.accountId===a[1]):a[2]==='pledges'?pledges.filter(d=>d.accountId===a[1]):registrations.filter(d=>d.registrantAccountId===a[1]);return Response.json({[a[2]]:rows,pagination:{currentPage:0,totalPages:1,totalResults:rows.length}})}
  if(path.startsWith('/pledges/')&&path.endsWith('/installments'))return Response.json(installments.filter(i=>i.pledgeId===path.split('/')[2]))
  if(path.startsWith('/pledges/')&&path.endsWith('/pledgePayments'))return Response.json(pledgePayments.filter(p=>p.pledgeId===path.split('/')[2]))
  if(path==='/recurring'){const rows=recurring.filter(r=>url.searchParams.get('status')===(r.id==='7121'?'Active':'Inactive')).map(r=>({id:Number(r.id),accountId:r.accountId,amount:r.amount,nextDate:r.nextDate,frequency:'Source frequency'}));return Response.json({recurringDonations:rows,pagination:{currentPage:0,totalPages:1,totalResults:rows.length}})}
  if(path.startsWith('/recurring/'))return Response.json(recurring.find(r=>r.id===path.slice(11)))
  const activity=activities.find(a=>path==='/activities/'+a.id);if(activity)return Response.json(activity)
  assert.fail('Unexpected Neon request '+request.method+' '+path)
 }
 const input={source:'neon',neon:{organizationId:key(7000),apiKey:key(7099),currency:'USD'},files:[historyFile(history)],solicitCodes:{'No fundraising':{type:'stop'}}}
 return {input,history,accounts,donations,memberships,pledges,installments,pledgePayments,recurring,calls,state,outbound}
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
  f.donations[0].donationCustomFields[0].value='123.456'
  const invalidField=await post(h,'preview',f.input);assert.equal(invalidField.canApply,false);assert.ok(invalidField.diagnostics.some(d=>d.code==='CUSTOM_VALUE'));await post(h,'apply',{id:invalidField.id,fingerprint:invalidField.fingerprint},{status:409});f.donations[0].donationCustomFields[0].value='123.45'
  const noDateReview=structuredClone(f.history);delete noDateReview.accounts[key(7001)].seasonalAddresses;await post(h,'preview',{...f.input,files:[historyFile(noDateReview)]},{status:400});f.accounts[0].primaryContact.addresses[2].endDate='2026-11-01';await post(h,'preview',f.input,{status:400});f.accounts[0].primaryContact.addresses[2].endDate='2026-10-01'
  const missingWriteOff=structuredClone(f.history);delete missingWriteOff.pledges;await post(h,'preview',{...f.input,files:[historyFile(missingWriteOff)]},{status:400});const wrongWriteOff=structuredClone(f.history);wrongWriteOff.pledges[key(7161)].adjustments[0].amount=101;await post(h,'preview',{...f.input,files:[historyFile(wrongWriteOff)]},{status:400})
  const goodsControl=structuredClone(f.history);goodsControl.payments[key(8151)].goodsAmount=21;await post(h,'preview',{...f.input,files:[historyFile(goodsControl)]},{status:400})
  const sourceLevel=f.memberships[0].membershipLevel;f.memberships[0].membershipLevel={id:'31'};await post(h,'preview',f.input,{status:400});f.memberships[0].membershipLevel=sourceLevel
  const sourceInstallment=f.pledgePayments[0].installmentId;f.pledgePayments[0].installmentId=key(7999);await post(h,'preview',f.input,{status:502});f.pledgePayments[0].installmentId=sourceInstallment
  assert.equal((await h.get('/api/coffer/donors')).total,before,'Unsafe historical rows change no native records')
  const heldDonations=f.donations.splice(0)
  const accountsOnly=await post(h,'preview',{...f.input,files:[historyFile({accounts:f.history.accounts,households:f.history.households,pledges:f.history.pledges})]});assert.equal(accountsOnly.canApply,true,JSON.stringify(accountsOnly.diagnostics));assert.equal(accountsOnly.sourceTotals.giftCount,3,'Event, paid membership and received pledge payment are cash; promises and schedules are not');assert.equal(accountsOnly.sourceTotals.amountCents,52000)
  f.donations.push(...heldDonations)
  const contradictory=structuredClone(f.history);contradictory.accounts[key(7006)].status='active';await post(h,'preview',{...f.input,files:[historyFile(contradictory)]},{status:400})
  const futureDeath=structuredClone(f.history);futureDeath.accounts[key(7006)].deceasedOn='2999-01-01';await post(h,'preview',{...f.input,files:[historyFile(futureDeath)]},{status:400})
  const bad=structuredClone(f.history);bad.softCredits[0]['Acknowledgment Interaction ID']=key(7031)
  const refused=await post(h,'preview',{...f.input,files:[historyFile(bad)]});assert.equal(refused.canApply,false);assert.ok(refused.diagnostics.some(d=>d.code==='ACKNOWLEDGMENT_LINK'))
  await post(h,'apply',{id:refused.id,fingerprint:refused.fingerprint},{status:409})
  let preview=await post(h,'preview',f.input)
  assert.equal(preview.canApply,true,JSON.stringify(preview.diagnostics));assert.equal(preview.needsAcceptance,false,JSON.stringify(preview.unmapped))
  assert.equal(preview.sourceTotals.amountCents,252000);assert.equal(preview.sourceTotals.giftCount,8);assert.equal(preview.counts.donors,6);assert.equal(preview.counts.notes,4);assert.equal(preview.counts.householdsWithHead,1);assert.equal(preview.counts.householdsWithoutHead,2)
  assert.deepEqual(preview.sourceCoverage.counts,{accounts:6,donations:4,activities:3,events:1,eventRegistrations:1,households:2,memberships:2,pledges:2,recurringDonations:2});assert.ok(preview.sourceCoverage.unsupported.includes('Replacement recurring schedules and vault transfer'))
  assert.ok(!JSON.stringify(preview).includes(key(7099)),'The key never enters review data')
  const member=await h.person(email(7081)),admin=await h.person(email(7082),'admin')
  await h.api('/auth/operator/status',{operatorId:admin.id,status:'inactive'})
  await post(h,'apply',{id:preview.id,fingerprint:preview.fingerprint},{as:member.cookie,status:403})
  const reads=f.calls.length
  await post(h,'preview',f.input,{as:member.cookie,status:403});await post(h,'preview',f.input,{as:admin.cookie,status:401})
  await post(h,'apply',{id:preview.id,fingerprint:preview.fingerprint},{as:admin.cookie,status:401});assert.equal(f.calls.length,reads,'Revoked authority cannot contact Neon')
  await post(h,'apply',{id:preview.id,fingerprint:'stale'},{status:409})
  assert.equal(preview.counts.eventGuests,2);assert.equal(preview.counts.memberships,2);assert.equal(preview.counts.pledges,2);assert.equal(preview.counts.recurringReferences,2);assert.ok(preview.reconciliation.some(r=>r.scope==='membership'&&r.sourceCount===2&&r.sourceCents===12000))
  const foreignInput={...f.input,neon:{...f.input.neon,organizationId:key(7008)}},foreignReview=await post(h,'preview',foreignInput);assert.equal(foreignReview.canApply,true);assert.notEqual(foreignReview.id,preview.id,'Different Neon organizations cannot overwrite the same staged review')
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
   assert.ok((await page.textContent('body')).includes('Neon CRM'));assert.ok((await page.textContent('body')).includes('Reading circle'));assert.ok(!(await page.content()).includes(f.input.neon.apiKey))
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
   await page.setViewportSize({width:1440,height:1000})
   const sourceEvent=(await h.get('/api/coffer/events')).find(e=>e.import_source==='neon');await page.goto(origin+'/app/events/'+sourceEvent.id)
   assert.ok((await page.textContent('body')).includes('Cleo Chen'));assert.ok((await page.textContent('body')).includes('Attended in source'));assert.ok((await page.textContent('body')).includes('Bee Reed'))
   for(const width of [1440,390]){await page.setViewportSize({width,height:1000});if(width===1440)assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));if(directory)await page.screenshot({path:directory+'/neon-event-history-'+width+'.png',fullPage:true})}
   await page.close()
  })
  const readsAfterImport=f.calls.length;await post(h,'preview',foreignInput,{status:409});assert.equal(f.calls.length,readsAfterImport,'A different source organization is refused before its credential is used');await post(h,'apply',{id:foreignReview.id,fingerprint:foreignReview.fingerprint},{status:409})
  const people=(await h.get('/api/coffer/donors?status=all')).donors
  const person=n=>{const p=f.accounts.find(a=>a.accountId===key(n)).primaryContact;return people.find(d=>d.name===p.firstName+' '+p.lastName)}
  const ava=await h.get('/api/coffer/donors/'+person(7001).id),bee=await h.get('/api/coffer/donors/'+person(7002).id),cleo=await h.get('/api/coffer/donors/'+person(7003).id)
  const unknown=await h.get('/api/coffer/donors/'+person(7005).id),deceased=await h.get('/api/coffer/donors/'+person(7006).id)
  assert.equal(deceased.donor.constituent_status,'deceased');assert.equal(deceased.donor.deceased_on,'2026-08-01');assert.equal(unknown.donor.household_id,deceased.donor.household_id);assert.equal((await h.get('/api/coffer/households/'+unknown.donor.household_id)).household.head_donor_id,null,'Shared source address never infers a head')
  assert.ok(unknown.consents.every(p=>p.status==='unknown'&&p.evidence.includes('source date unknown')&&p.recorded_at),'Unknown choices retain explicit unknown provenance')
  assert.equal(ava.donor.informal_salutation,'  Dearest Ava  ');assert.equal(ava.donor.first_name,'Ava');assert.equal(ava.donor.postal_code,'53703-4567')
  assert.equal(ava.contactPoints.filter(p=>p.kind==='phone'&&p.is_primary)[0].type,'mobile');assert.equal(ava.contactPoints.filter(p=>p.kind==='phone').length,4);assert.equal(ava.contactPoints.find(p=>p.value==='+12025550183').type,'other');assert.equal(ava.contactPoints.filter(p=>p.kind==='email').length,3);assert.equal(ava.contactPoints.filter(p=>p.kind==='address').length,3);const seasonal=ava.contactPoints.find(p=>p.type==='seasonal');assert.equal(seasonal.starts_on,'05-01');assert.equal(seasonal.ends_on,'10-01');assert.ok(seasonal.source.includes('2026-05-01')&&seasonal.source.includes('2026-10-01'));assert.equal(seasonal.is_primary,0);assert.ok(ava.contactPoints.some(p=>p.kind==='address'&&p.type==='work'&&JSON.parse(p.value).line2==='Room 2, Reading wing'));assert.equal(ava.contactPoints.filter(p=>p.kind==='address')[0].is_primary,1)
  const fields=(await h.get('/api/coffer/custom-fields')).fields,field=fields.find(d=>d.key==='neon_15');assert.equal(field.entry,'pick-one');assert.deepEqual(JSON.parse(field.choices),['Board','Volunteer']);assert.equal(ava.customValues.find(v=>v.field_key==='neon_15').value,'"Board"');assert.equal(ava.customValues.find(v=>v.field_key==='neon_donation_16').value,'"12345"');assert.equal(ava.customValues.find(v=>v.field_key==='neon_activity_17').value,'"Discussed the reading room"')
  const gift=ava.gifts.find(g=>g.reference==='neon:'+key(7011)),waiting=bee.gifts[0],event=cleo.gifts.find(g=>g.reference==='neon:event:'+key(7021))
  assert.equal(gift.method,'card','Tender catalog names determine the payment method, not an assumed numeric ID');assert.equal(gift.acknowledgment.status,'acknowledged');assert.equal(gift.acknowledgment.acknowledged_on,'2026-09-04');assert.equal(gift.acknowledgment.source,'Neon CRM');assert.equal(gift.acknowledgment.link.id,ava.depth.interactions[0].id)
  assert.equal(waiting.acknowledgment.status,'not acknowledged','A send option is never a historical acknowledgment')
  assert.equal(event.goods_cents,6000);assert.equal(event.goods,'provided');assert.equal(event.amount_cents,15000);assert.equal(gift.goods,'none')
  assert.deepEqual((await h.get('/api/coffer/letters')).due.map(g=>g.reference).sort(),['neon:'+key(7012),'neon:event:'+key(7021)].sort())
  const credit=bee.giftDepth.creditedGifts[0];assert.equal(credit.amount_cents,10000);assert.equal(credit.acknowledgment.status,'acknowledged');assert.equal(credit.acknowledgment.acknowledgedOn,'2026-09-05');assert.equal(credit.acknowledgment.method,'phone call');assert.equal(credit.acknowledgment.link.id,bee.depth.interactions.find(i=>i.kind==='call').id)
  assert.equal(ava.solicitation.type,'stop');assert.equal(ava.solicitation.source_ref,'neon:'+key(7001));assert.equal(ava.solicitation.source_on,'2026-09-01')
  assert.deepEqual(Object.fromEntries(bee.consents.map(p=>[p.channel,p.status])),{email:'withdrawn',mail:'withdrawn',phone:'withdrawn',sms:'unknown'});assert.ok(bee.consents.every(p=>p.method==='neon export'&&p.captured_on==='2026-09-01'&&p.recorded_at))
  const hh=await h.get('/api/coffer/households/'+ava.donor.household_id)
  assert.equal(hh.household.head_donor_id,person(7001).id,'Explicit restricted source head remains eligible');assert.equal(hh.household.head_source,'neon');assert.ok(hh.household.head_imported_at);assert.equal(hh.household.addressee_override,'The Reed Reading Family');assert.equal(hh.household.formal_override,'The Reed Readers')
  assert.equal((await h.get('/api/coffer/households/'+cleo.donor.household_id)).household.head_donor_id,null)
  assert.equal((await h.get('/api/coffer/tributes')).groups.find(g=>g.honoree==='Jordan Reed').totalCents,100000);assert.equal(ava.giftDepth.tributes[0].source_group,key(7045));assert.equal(ava.giftDepth.tributes[0].amount_permission,0);assert.equal(ava.giftDepth.tributes[0].notified_address,'12 River Road, Unit 4, Madison, WI, 53703-1234, United States')
  assert.equal((await h.get('/api/coffer/move-in/journal?id='+preview.id)).job.check_report.matches,true)
  assert.ok(bee.depth.interactions.some(i=>i.kind==='meeting'&&i.notes.includes('Joint reading-room meeting')&&i.notes.includes('Source status: Completed')));assert.ok(cleo.depth.interactions.some(i=>i.kind==='meeting'&&i.notes.includes('Joint reading-room meeting')))
  const firstPart=cleo.gifts.find(g=>g.reference==='neon:'+key(7151)+':payment:'+key(8151)),secondPart=cleo.gifts.find(g=>g.reference==='neon:'+key(7151)+':payment:'+key(8152))
  assert.equal(firstPart.amount_cents,20000);assert.equal(firstPart.received_on,'2025-12-31');assert.equal(firstPart.goods_cents,2000);assert.equal(secondPart.amount_cents,30000);assert.equal(secondPart.received_on,'2026-01-02');assert.equal(secondPart.goods_cents,3000)
  assert.equal(preview.sourceTotals.byYear['2025'].amountCents,20000);assert.equal(preview.sourceTotals.byYear['2026'].amountCents,232000);assert.equal(ava.giftDepth.creditedGifts.find(g=>g.gift_id===firstPart.id).amount_cents,10000);assert.equal((await h.get('/api/coffer/tributes')).groups.find(g=>g.honoree==='Reading mentors').totalCents,50000)
  const source=await h.get('/api/coffer/move-in/source-history?donorId='+person(7003).id)
  const closedPledge=cleo.pledges.find(p=>p.pledged_on==='2026-08-01');assert.equal(closedPledge.paid_cents,0);assert.equal(closedPledge.remaining_cents,0);assert.equal(closedPledge.adjustments[0].kind,'write_off');assert.equal(closedPledge.adjustments[0].amount_cents,10000);assert.equal(closedPledge.version,2);assert.ok((await h.get('/api/coffer/audit?action=move-in.pledgeWriteOff')).rows.some(r=>r.subject_id===closedPledge.id&&JSON.parse(r.detail).amountCents===10000));assert.ok(closedPledge.adjustments[0].reason.includes('2026-08-10'));assert.equal(preview.counts.pledgeAdjustments,1)
  assert.equal(source.memberships.length,1);assert.equal(source.memberships[0].level_name,'Reading circle');assert.equal(source.memberships[0].ends_on,'2027-09-02');assert.equal(source.memberships[0].source_auto_renewal,1);assert.equal(source.memberships[0].fee_cents,12000)
  const membershipGift=cleo.gifts.find(g=>g.id===source.memberships[0].gift_id);assert.equal(membershipGift.amount_cents,12000);assert.equal(membershipGift.goods_cents,2000)
  assert.equal(cleo.customValues.find(v=>v.field_key==='neon_donation_16_pledge').value,'"2550"');assert.equal((await h.get('/api/coffer/tributes')).groups.find(g=>g.honoree==='Book keepers').totalCents,25000);assert.ok(cleo.giftDepth.tributes.some(t=>t.honoree==='Book keepers'&&t.source_group===key(7171)&&t.amount_permission===0));assert.equal(cleo.pledges[0].amount_cents,100000);assert.equal(cleo.pledges[0].paid_cents,25000);assert.equal(cleo.pledges[0].remaining_cents,75000);assert.equal(cleo.pledges[0].api_review_required,1);assert.equal(cleo.pledges[0].installments.find(i=>i.due_on==='2026-09-03').paid_cents,0);assert.equal(cleo.pledges[0].installments.find(i=>i.due_on==='2026-12-03').paid_cents,25000)
  assert.deepEqual(cleo.subscriptions,[],'Historical Neon schedules do not activate Coffer billing');assert.equal(source.plans.length,1);assert.equal(source.plans[0].amount_cents,3500);assert.equal(source.plans[0].frequency,'1 month');assert.equal(source.plans[0].payment_method_reference,key(7122));assert.equal(source.plans[0].customer_reference,key(7125))
  const former=await h.get('/api/coffer/move-in/source-history?donorId='+person(7002).id);assert.equal(former.memberships[0].source_active,0);assert.equal(former.memberships[0].gift_id,null);assert.equal(former.plans[0].payment_method_reference,null,'Absent processor facts remain missing')
  const importedEvent=(await h.get('/api/coffer/events')).find(e=>e.import_source==='neon'),guestList=await h.get('/api/coffer/events?eventId='+importedEvent.id)
  assert.equal(guestList.length,2);assert.equal(guestList.find(g=>g.attendee_name==='Cleo Chen').source_attended,1);assert.equal(guestList.find(g=>g.attendee_name==='Bee Reed').source_attended,0);assert.ok(guestList.every(g=>g.gift_id===event.id));await h.command('event.checkIn',{registrationId:guestList[0].id},{status:404});assert.deepEqual(await h.get('/api/coffer/events?eventId='+importedEvent.id),guestList,'Historical attendance cannot be rewritten as a native check-in');await h.get('/api/coffer/events?eventId='+importedEvent.id,{as:member.cookie,status:403})
  const ownFile=await h.api('/api/coffer/donors/'+person(7003).id+'/data-request',{requestedOn:'2026-09-03',method:'letter',reference:key(7188)});assert.ok(ownFile.records.source_memberships.some(m=>m.source_id===key(7101)));assert.ok(ownFile.records.source_event_guests.some(g=>g.attendee_name==='Cleo Chen'));assert.ok(!JSON.stringify(ownFile).includes(email(7172)),'Imported tribute notification contacts stay private in a donor file');assert.ok(!JSON.stringify(ownFile).includes(email(7002)),'A buyer data file withholds another guest contact and import custody')
  const rekeyedHistory=structuredClone(f.history);rekeyedHistory.pledges[key(7161)].adjustments[0].id=key(7199);const rekeyed=await post(h,'preview',{...f.input,files:[historyFile(rekeyedHistory)]});assert.equal(rekeyed.canApply,false);assert.ok(rekeyed.diagnostics.some(d=>d.code==='PLEDGE_BALANCE'));await post(h,'apply',{id:rekeyed.id,fingerprint:rekeyed.fingerprint},{status:409});assert.equal((await h.get('/api/coffer/donors/'+person(7003).id)).pledges.find(p=>p.id===closedPledge.id).adjustments.length,1)
  const splitSource=f.donations.find(d=>d.id===key(7151)),originalParts=splitSource.payments
  splitSource.payments=[{...originalParts[0],id:key(9151),amount:500}]
  const combinedHistory=structuredClone(f.history);delete combinedHistory.payments;delete combinedHistory.softCredits.find(c=>c.id===key(7155)).paymentId
  const combined=await post(h,'preview',{...f.input,files:[historyFile(combinedHistory)]});assert.equal(combined.canApply,false);assert.ok(combined.diagnostics.some(d=>d.code==='NEON_PAYMENT_REPRESENTATION'));await post(h,'apply',{id:combined.id,fingerprint:combined.fingerprint},{status:409});splitSource.payments=originalParts
  const oldSingle=f.donations[2].payments;f.donations[2].payments=[{...oldSingle[0],id:key(9161),amount:200},{...oldSingle[0],id:key(9162),amount:300}]
  const dividedHistory=structuredClone(f.history);dividedHistory.payments[key(9161)]={goodsAmount:0};dividedHistory.payments[key(9162)]={goodsAmount:0}
  const divided=await post(h,'preview',{...f.input,files:[historyFile(dividedHistory)]});assert.equal(divided.canApply,false);assert.ok(divided.diagnostics.some(d=>d.code==='NEON_PAYMENT_REPRESENTATION'));await post(h,'apply',{id:divided.id,fingerprint:divided.fingerprint},{status:409});f.donations[2].payments=oldSingle
  assert.equal((await h.get('/api/coffer/donors/'+person(7003).id)).totals.lifetimeCents,152000,'Rejected payment representations add no cash')
  const saved=await archive(h);assert.ok(!JSON.stringify(saved).includes('Do not retain source bank detail'));assert.ok(!JSON.stringify(saved).includes('cardNumberLastFour'));assert.ok(!JSON.stringify(saved).includes(f.input.neon.apiKey),'The archive never retains the Neon key')
  await run(async fresh=>{await restore(fresh,saved);await post(fresh,'preview',foreignInput,{status:409});assert.deepEqual((await fresh.get('/api/coffer/donors/'+person(7002).id)).consents,bee.consents);assert.equal((await fresh.get('/api/coffer/donors/'+person(7001).id)).gifts.find(g=>g.id===gift.id).acknowledgment.link.id,gift.acknowledgment.link.id);assert.equal((await fresh.get('/api/coffer/move-in/source-history?donorId='+person(7003).id)).memberships[0].gift_id,membershipGift.id);assert.equal((await fresh.get('/api/coffer/events?eventId='+importedEvent.id)).length,2);await post(fresh,'undo',{id:preview.id});assert.equal((await fresh.get('/api/coffer/events')).length,0);assert.equal((await fresh.get('/api/coffer/donors?status=all')).total,0);assert.equal((await fresh.get('/api/coffer/custom-fields')).fields.some(f=>f.key==='neon_15'),false)})
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
  const another=await post(h,'preview',f.input);assert.equal(another.canApply,true,JSON.stringify(another.diagnostics));assert.equal(another.sourceTotals.amountCents,259500);assert.ok(another.diagnostics.some(d=>d.code==='ALREADY_MOVED_IN'))
  await apply(h,another)
  const matched=await h.get('/api/coffer/donors/'+native.id);assert.equal(matched.donor.name,'Ava Native Revised');assert.equal(matched.donor.informal_salutation,'  Dearest Ava  ');assert.equal(matched.totals.lifetimeCents,57500);assert.equal((await h.get('/api/coffer/donors?status=all')).total,6,'Source IDs match the existing donor without copying profiles')
  assert.equal((await apply(h,await post(h,'preview',f.input))).unchanged,true)
  await h.command('gift.reverse',{giftId:waiting.id,reason:'Source reconciliation correction'});assert.equal((await h.get('/api/coffer/tributes')).groups.find(g=>g.honoree==='Jordan Reed').totalCents,50000,'Signed ledger corrections reconcile tribute totals')
  await h.command('consent.record',{donorIds:[person(7002).id],channel:'email',status:'withdrawn',method:'paper form',evidence:key(7089),capturedOn:'2026-09-02'})
  const changed=structuredClone(f.history);changed.accounts[key(7002)].preferenceOn='2026-08-01'
  const later=await post(h,'preview',{...f.input,files:[historyFile(changed)]});assert.equal(later.canApply,false);assert.ok(later.diagnostics.some(d=>d.code==='SOLICITATION_CHANGED'))
  await h.command('appeal.discard',{appealId:appeal.id,version:1})
  const comparison=await h.get('/api/coffer/duplicates/compare?source='+person(7002).id+'&target='+person(7003).id)
  const merged=await h.command('donor.merge',{sourceDonorId:person(7002).id,donorId:person(7003).id,sourceVersion:comparison.source.version,version:comparison.target.version,fields:{},reason:'duplicate_record'})
  const joined=await h.get('/api/coffer/move-in/source-history?donorId='+person(7003).id);assert.ok((await h.get('/api/coffer/events?eventId='+importedEvent.id)).every(g=>g.attendee_donor_id===person(7003).id));assert.equal(joined.memberships.length,2);assert.equal(joined.plans.length,2)
  await h.command('donor.unmerge',{mergeId:merged.mergeId,reason:'incorrect_match'})
  assert.equal((await h.get('/api/coffer/move-in/source-history?donorId='+person(7002).id)).memberships[0].source_id,key(7102));assert.equal((await h.get('/api/coffer/move-in/source-history?donorId='+person(7003).id)).memberships[0].source_id,key(7101))
  await h.command('donor.erase',{donorId:person(7002).id,confirm:'ERASE'});assert.equal((await post(h,'preview',f.input)).canApply,false,'An erased account cannot return through Neon replay')
  const erasedJob=await h.get('/api/coffer/move-in/journal?id='+another.id);assert.equal(erasedJob.job.redacted,1);assert.deepEqual(erasedJob.job.report,{})
  await post(h,'apply',{id:another.id,fingerprint:another.fingerprint},{status:409})
  const afterErasure=await archive(h);assert.equal((await h.get('/api/coffer/events?eventId='+importedEvent.id)).length,1);assert.ok(!JSON.stringify(afterErasure).includes(key(7102)));assert.ok(!JSON.stringify(afterErasure).includes('"7123"'));assert.ok(!JSON.stringify(afterErasure).includes(email(7002)),'Erasure removes reused-account source history from every retained review and archive')
 },{outbound:f.outbound})
}
