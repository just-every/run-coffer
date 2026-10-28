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
 const payment=(amount)=>({id:key(7090),amount,paymentStatus:'Succeeded',receivedDate:'2026-09-03T12:00:00Z',tenderType:1})
 const donation=(n,person,extra={})=>({id:key(n),accountId:key(person),date:'2026-09-03T12:00:00Z',amount:500,status:'Succeeded',sendAcknowledgeEmail:true,payments:[payment(500)],fund:{id:'1',name:'Reading'},taxDeductibleInfo:{nonDeductibleAmount:0},...extra})
 const donations=[donation(7011,7001,{tribute:{type:'Memory',name:'Jordan Reed'},acknowledgee:{name:'River Reed',address:{addressLine1:'12 River Road',city:'Madison',zipCode:'53703'}}}),donation(7012,7002,{tribute:{type:'Memory',name:'Jordan Reed'}}),donation(7013,7003)]
 const registrations=[{id:key(7021),eventId:'20',registrantAccountId:key(7003),registrationDateTime:'2026-09-03T12:00:00Z',registrationAmount:150,totalCharge:150,payments:[payment(150)],taxDeductibleInfo:{nonDeductibleAmount:60,nonDeductibleDescription:'Gala meal'}}]
 const activities=[{id:key(7031),subject:'Source gift thank-you',activityType:{name:'Email'},activityDates:{startDate:'2026-09-04T12:00:00Z'},clientAccount:[{accountId:key(7001)}]},{id:key(7032),subject:'Independent credit thank-you',activityType:{name:'Phone call'},activityDates:{startDate:'2026-09-05T12:00:00Z'},clientAccount:[{accountId:key(7002)}]}]
 const households=[{id:key(7041),name:'Reed readers',salutation:'The Reed Readers',contacts:[{accountId:key(7001),isPrimaryHouseHoldContact:true},{accountId:key(7002),isPrimaryHouseHoldContact:false}]},{id:key(7042),name:'Chen readers',contacts:[{accountId:key(7003),isPrimaryHouseHoldContact:false}]}]
 const history={accounts:Object.fromEntries(accounts.map(a=>[a.accountId,{preferenceOn:'2026-09-01',...(a.noSolicitation?{restrictionOn:'2026-09-01',codes:['No fundraising']}:{}),...(a.accountId===key(7004)?{status:'inactive',statusReason:'Source pause'}:{})}])),households:{[key(7041)]:{addressee:'The Reed Reading Family',informal:'Ava and Bee'}},donations:{[key(7011)]:{'Acknowledgment Status':'acknowledged','Acknowledgment Date':'2026-09-04','Acknowledgment Method':'email','Acknowledgment Interaction ID':key(7031),tributeGroup:key(7045)},[key(7012)]:{'Acknowledgment Status':'not acknowledged',tributeGroup:key(7045)},[key(7013)]:{'Acknowledgment Status':'do not acknowledge'}},softCredits:[{id:key(7051),accountId:key(7002),donationId:key(7011),amount:100,'Acknowledgment Status':'acknowledged','Acknowledgment Date':'2026-09-05','Acknowledgment Method':'phone call','Acknowledgment Interaction ID':key(7032)}]}
 const calls=[],state={reject:false,brokenPages:false}
 const outbound=async request=>{
 try{
  const url=new URL(request.url);assert.equal(url.origin,'https://api.neoncrm.com');assert.equal(request.headers.get('NEON-API-VERSION'),'2.12');assert.equal(request.headers.get('authorization'),'Basic '+Buffer.from(key(7000)+':'+key(7099)).toString('base64'))
  calls.push([request.method,url.pathname]);if(state.reject)return new Response('Unavailable',{status:401})
  const path=url.pathname.slice(3)
  if(path==='/accounts/search'){assert.equal(request.method,'POST');const body=await request.json();assert.deepEqual(body.searchFields,[]);const currentPage=body.pagination.currentPage;return Response.json({searchResults:accounts.slice(currentPage*2,currentPage*2+2).map(a=>({'Account ID':a.accountId})),pagination:{currentPage,totalPages:2,totalResults:state.brokenPages?5:4}})}
  if(path==='/customFields')return Response.json([{id:'15',name:'Membership interest',displayType:'Dropdown',dataType:'Text',component:'Account',optionValues:[{id:'151',name:'Board'},{id:'152',name:'Volunteer'}]}])
  if(path==='/households/listHouseholds')return Response.json(households)
  if(path==='/activities/search')return Response.json({searchResults:activities.map(a=>({'Activity ID':a.id})),pagination:{currentPage:0,totalPages:1,totalResults:activities.length}})
  const a=/^\/accounts\/([^/]+)(?:\/(donations|eventRegistrations))?$/.exec(path)
  if(a){if(!a[2])return Response.json({individualAccount:accounts.find(r=>r.accountId===a[1])});const rows=a[2]==='donations'?donations.filter(d=>d.accountId===a[1]):registrations.filter(d=>d.registrantAccountId===a[1]);return Response.json({[a[2]]:rows,pagination:{currentPage:0,totalPages:1,totalResults:rows.length}})}
  const activity=activities.find(a=>path==='/activities/'+a.id);if(activity)return Response.json(activity)
  assert.fail('Unexpected Neon request '+request.method+' '+path)
 }catch(error){console.error('Neon fake refused',error.message);throw error}
 }
 const input={source:'neon',neon:{organizationId:key(7000),apiKey:key(7099)},files:[historyFile(history)],solicitCodes:{'No fundraising':{type:'stop'}}}
 return {input,history,accounts,donations,calls,state,outbound}
}

/** One migration sanity journey, with only documented Neon network requests faked. */
export async function neonJourney(){
 const f=fixture()
 await run(async h=>{
  await reviewed(h)
  const before=(await h.get('/api/coffer/donors')).total
  f.state.reject=true;await post(h,'preview',f.input,{status:502});f.state.reject=false
  f.state.brokenPages=true;await post(h,'preview',f.input,{status:502});f.state.brokenPages=false
  assert.equal((await h.get('/api/coffer/donors')).total,before)
  f.donations[0].payments[0].paymentStatus='Refunded';await post(h,'preview',f.input,{status:400});f.donations[0].payments[0].paymentStatus='Succeeded'
  const bad=structuredClone(f.history);bad.softCredits[0]['Acknowledgment Interaction ID']=key(7031)
  const refused=await post(h,'preview',{...f.input,files:[historyFile(bad)]});assert.equal(refused.canApply,false);assert.ok(refused.diagnostics.some(d=>d.code==='ACKNOWLEDGMENT_LINK'))
  await post(h,'apply',{id:refused.id,fingerprint:refused.fingerprint},{status:409})
  let preview=await post(h,'preview',f.input)
  assert.equal(preview.canApply,true,JSON.stringify(preview.diagnostics));assert.equal(preview.needsAcceptance,false,JSON.stringify(preview.unmapped))
  assert.equal(preview.sourceTotals.amountCents,165000);assert.equal(preview.sourceTotals.giftCount,4);assert.equal(preview.counts.donors,4);assert.equal(preview.counts.notes,2);assert.equal(preview.counts.householdsWithHead,1);assert.equal(preview.counts.householdsWithoutHead,1)
  assert.ok(!JSON.stringify(preview).includes(key(7099)),'The key never enters review data')
  const member=await h.person(email(7081)),admin=await h.person(email(7082),'admin')
  await h.api('/auth/operator/status',{operatorId:admin.id,status:'inactive'})
  const reads=f.calls.length
  await post(h,'preview',f.input,{as:member.cookie,status:403});await post(h,'preview',f.input,{as:admin.cookie,status:401})
  await post(h,'apply',{id:preview.id,fingerprint:preview.fingerprint},{as:admin.cookie,status:401});assert.equal(f.calls.length,reads,'Revoked authority cannot contact Neon')
  await post(h,'apply',{id:preview.id,fingerprint:'stale'},{status:409})
  const directory=process.env.COFFER_NEON_SHOTS
  if(directory)await mkdir(directory,{recursive:true})
  await withBrowserWorker(h,async(context,origin)=>{
   const page=await context.newPage();await page.goto(origin+'/app/move-in/crm')
   const form=page.locator('form').filter({has:page.getByRole('button',{name:'Preview Neon history',exact:true})})
   await form.getByLabel('Neon organization ID',{exact:true}).fill(f.input.neon.organizationId);await form.getByLabel('Neon API key',{exact:true}).fill(f.input.neon.apiKey)
   await form.locator('input[type=file]').setInputFiles({name:'neon-history.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(f.history))})
   await form.locator('summary').click();await form.getByLabel('Code meanings').fill('No fundraising = stop')
   await form.getByRole('button',{name:'Preview Neon history',exact:true}).click();await page.waitForURL('**/app/move-in/crm/review?id=*')
   assert.equal(new URL(page.url()).searchParams.get('id'),preview.id)
   assert.ok((await page.textContent('body')).includes('Neon CRM'));assert.ok(!(await page.content()).includes(f.input.neon.apiKey))
   for(const width of [1440,390]){await page.setViewportSize({width,height:1000});if(width===1440)assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));if(directory)await page.screenshot({path:directory+'/neon-review-'+width+'.png',fullPage:true})}
   await page.setViewportSize({width:1440,height:1000});await page.locator('input[name=acknowledged][value=no]').check();await page.locator('input[name=confirm]').check();await page.getByRole('button',{name:'Move these records in',exact:true}).click();try{await page.waitForURL('**/app/move-in/crm/journal?id=*',{timeout:5000})}catch{throw Error('Native Neon apply: '+await page.textContent('body'))}
   assert.ok((await page.textContent('body')).includes('All totals match'))
   for(const width of [1440,390]){await page.setViewportSize({width,height:1000});if(directory)await page.screenshot({path:directory+'/neon-imported-'+width+'.png',fullPage:true})}
   await page.close()
  })
  const people=(await h.get('/api/coffer/donors?status=all')).donors
  const person=n=>{const p=f.accounts.find(a=>a.accountId===key(n)).primaryContact;return people.find(d=>d.name===p.firstName+' '+p.lastName)}
  const ava=await h.get('/api/coffer/donors/'+person(7001).id),bee=await h.get('/api/coffer/donors/'+person(7002).id),cleo=await h.get('/api/coffer/donors/'+person(7003).id)
  assert.equal(ava.donor.informal_salutation,'Dearest Ava');assert.equal(ava.donor.first_name,'Ava')
  assert.equal(ava.contactPoints.filter(p=>p.kind==='phone')[0].type,'mobile');assert.equal(ava.contactPoints.filter(p=>p.kind==='address')[0].is_primary,1)
  const fields=(await h.get('/api/coffer/custom-fields')).fields,field=fields.find(d=>d.key==='neon_15');assert.equal(field.entry,'pick-one');assert.deepEqual(JSON.parse(field.choices),['Board','Volunteer']);assert.equal(ava.customValues.find(v=>v.field_key==='neon_15').value,'"Board"')
  const gift=ava.gifts.find(g=>g.reference==='neon:'+key(7011)),waiting=bee.gifts[0],event=cleo.gifts.find(g=>g.reference==='neon:event:'+key(7021))
  assert.equal(gift.acknowledgment.status,'acknowledged');assert.equal(gift.acknowledgment.acknowledged_on,'2026-09-04');assert.equal(gift.acknowledgment.source,'Neon CRM');assert.equal(gift.acknowledgment.link.id,ava.depth.interactions[0].id)
  assert.equal(waiting.acknowledgment.status,'not acknowledged','A send option is never a historical acknowledgment')
  assert.equal(event.goods_cents,6000);assert.equal(event.goods,'provided');assert.equal(event.amount_cents,15000);assert.equal(gift.goods,'none')
  assert.deepEqual((await h.get('/api/coffer/letters')).due.map(g=>g.reference).sort(),['neon:'+key(7012),'neon:event:'+key(7021)].sort())
  const credit=bee.giftDepth.creditedGifts[0];assert.equal(credit.amount_cents,10000);assert.equal(credit.acknowledgment.status,'acknowledged');assert.equal(credit.acknowledgment.acknowledgedOn,'2026-09-05');assert.equal(credit.acknowledgment.method,'phone call');assert.equal(credit.acknowledgment.link.id,bee.depth.interactions[0].id)
  assert.equal(ava.solicitation.type,'stop');assert.equal(ava.solicitation.source_ref,'neon:'+key(7001));assert.equal(ava.solicitation.source_on,'2026-09-01')
  assert.deepEqual(Object.fromEntries(bee.consents.map(p=>[p.channel,p.status])),{email:'withdrawn',mail:'withdrawn',phone:'withdrawn',sms:'unknown'});assert.ok(bee.consents.every(p=>p.method==='neon export'&&p.captured_on==='2026-09-01'&&p.recorded_at))
  const hh=await h.get('/api/coffer/households/'+ava.donor.household_id)
  assert.equal(hh.household.head_donor_id,person(7001).id,'Explicit restricted source head remains eligible');assert.equal(hh.household.head_source,'neon');assert.ok(hh.household.head_imported_at);assert.equal(hh.household.addressee_override,'The Reed Reading Family');assert.equal(hh.household.formal_override,'The Reed Readers')
  assert.equal((await h.get('/api/coffer/households/'+cleo.donor.household_id)).household.head_donor_id,null)
  assert.equal((await h.get('/api/coffer/tributes')).groups.find(g=>g.honoree==='Jordan Reed').totalCents,100000);assert.equal(ava.giftDepth.tributes[0].source_group,key(7045));assert.equal(ava.giftDepth.tributes[0].amount_permission,0)
  assert.equal((await h.get('/api/coffer/move-in/journal?id='+preview.id)).job.check_report.matches,true)
  const saved=await archive(h)
  await run(async fresh=>{await restore(fresh,saved);assert.deepEqual((await fresh.get('/api/coffer/donors/'+person(7002).id)).consents,bee.consents);assert.equal((await fresh.get('/api/coffer/donors/'+person(7001).id)).gifts[0].acknowledgment.link.id,gift.acknowledgment.link.id);await post(fresh,'undo',{id:preview.id});assert.equal((await fresh.get('/api/coffer/donors?status=all')).total,0);assert.equal((await fresh.get('/api/coffer/custom-fields')).fields.some(f=>f.key==='neon_15'),false)})
  const repeat=await post(h,'preview',{...f.input,solicitCodes:undefined});assert.equal(repeat.prior.state,'completed');assert.equal((await apply(h,repeat)).unchanged,true,'Saved code meanings are reused without duplicate gifts or consent')
  await post(h,'undo',{id:preview.id});assert.equal((await h.get('/api/coffer/donors?status=all')).total,0)
  preview=await post(h,'preview',f.input);await apply(h,preview)
  const current=await h.get('/api/coffer/households/'+hh.household.id);await h.command('household.update',{householdId:hh.household.id,version:current.household.version,informal_override:'A later household greeting'})
  await post(h,'undo',{id:preview.id},{status:409});assert.equal((await h.get('/api/coffer/households/'+hh.household.id)).household.informal_override,'A later household greeting')
  const notice=await h.command('tributeNotification.prepare',{giftId:gift.id});const prepared=(await h.get('/api/coffer/donors/'+person(7001).id)).tributeNotifications.find(n=>n.id===notice.id);assert.equal(prepared.recipient_name,'River Reed');assert.ok(!prepared.body.includes('$'))
  await h.command('tributeNotification.approve',{notificationId:notice.id,version:1});assert.ok(!(await (await h.request('/api/coffer/tribute-notifications/'+notice.id+'/download')).text()).includes('$500'))
  const appeal=await h.command('appeal.prepare',{name:'Neon first appeal',channel:'email'});assert.equal(appeal.recipients,1);assert.equal(appeal.excluded['do not solicit'],1);assert.equal(appeal.excluded['consent withdrawn'],1);assert.equal(appeal.excluded.inactive,1)
  await h.command('gift.reverse',{giftId:waiting.id,reason:'Source reconciliation correction'});assert.equal((await h.get('/api/coffer/tributes')).groups.find(g=>g.honoree==='Jordan Reed').totalCents,50000,'Signed ledger corrections reconcile tribute totals')
  await h.command('consent.record',{donorIds:[person(7002).id],channel:'email',status:'withdrawn',method:'paper form',evidence:key(7089),capturedOn:'2026-09-02'})
  const changed=structuredClone(f.history);changed.accounts[key(7002)].preferenceOn='2026-08-01'
  const later=await post(h,'preview',{...f.input,files:[historyFile(changed)]});assert.equal(later.canApply,false);assert.ok(later.diagnostics.some(d=>d.code==='SOLICITATION_CHANGED'))
  await h.command('donor.erase',{donorId:person(7002).id,confirm:'ERASE'});assert.equal((await post(h,'preview',f.input)).canApply,false,'An erased account cannot return through Neon replay')
 },{outbound:f.outbound})
}
