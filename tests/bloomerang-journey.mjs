import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {run,reviewed,archive,restore} from './harness.mjs'
import {prepareVerifiedMail} from './verified-mail-edge.mjs'
import {withBrowserWorker} from './browser-worker.mjs'
const key=n=>'synthetic-coffer-'+n
const email=n=>[key(n),'example.test'].join('@')
const post=(h,action,body,options)=>h.api('/api/coffer/move-in/'+action,body,options)
const historyFile=history=>({name:'bloomerang-history.json',base64:Buffer.from(JSON.stringify(history)).toString('base64')})
const apply=async(h,p)=>{let j=await post(h,'apply',{id:p.id,fingerprint:p.fingerprint,acknowledged:'no'});while(j.state==='applying')j=await post(h,'continue',{id:p.id});assert.equal(j.state,'completed');return j}

function fixture(){
 const contact=(id,type,value,primary=true)=>({Id:id+1000,AccountId:id,TypeName:type,Value:value,IsPrimary:primary})
 const address=(id,street,primary=true)=>({Id:id+2000,AccountId:id,TypeName:primary?'Work':'Vacation',Street:street,City:'Madison',State:'WI',PostalCode:'53703',Country:'United States',IsPrimary:primary})
 const constituent=(Id,first,last)=>({Id,AccountNumber:Id+10000,Type:'Individual',Status:'Active',FirstName:first,LastName:last,FullName:first+' '+last,InformalName:'Dear '+first,EnvelopeName:'The '+last+' reader',EmailInterestType:'All',Emails:[contact(Id,'Home',email(Id))],Phones:[],Addresses:[address(Id,Id+' Reading Street')],CustomFields:{}})
 const constituents=[constituent(101,'Ava','Reed'),constituent(102,'Bee','Reed'),constituent(103,'Cleo','Chen'),constituent(104,'Dana','Chen'),{...constituent(107,'Eli','Inactive'),Status:'Inactive'},{...constituent(108,'Finn','Deceased'),Status:'Deceased'}]
 constituents[0].Emails[0].TypeName='Work';constituents[0].Emails.push(contact(101,'Home',email(105),false),contact(101,'Home',email(106),false));constituents[0].Phones=[{Id:3101,AccountId:101,TypeName:'Mobile',Number:'202-555-0101',IsPrimary:true},{Id:3102,AccountId:101,TypeName:'Home',Number:'202-555-0102',IsPrimary:false},{Id:3103,AccountId:101,TypeName:'Work',Number:'202-555-0103',IsPrimary:false}];constituents[0].Addresses.push(address(101,'Second Reading Street',false));constituents[0].InformalName='  Ava and family  ';constituents[0].EnvelopeName='  The Reed readers  '
 constituents[1].EmailInterestType='OptedOut'
 const gift=(Id,AccountId,extra={})=>({Id,AccountId,EntryType:'Donation',Date:'2026-09-03',Amount:500,NonDeductible:0,AcknowledgementStatus:'No',FundName:'Reading',CampaignName:'Autumn books',AppealName:'September appeal',Check:{Number:key(Id)},SoftCredits:[],...extra})
 const gifts=[gift(201,101,{Date:'2024-09-03',AcknowledgementStatus:'Yes',TributeName:'Jordan Reed',TributeType:'In Memory of',SoftCredits:[{Id:701,AccountId:102,Amount:100,AcknowledgementStatus:'Yes'}]}),gift(202,102,{Date:'2025-09-03',AcknowledgementStatus:'DoNotAcknowledge',TributeName:'Jordan Reed',TributeType:'In Memory of',CampaignName:'Winter books',AppealName:'Winter appeal'}),gift(203,103),gift(204,101,{Amount:150,NonDeductible:60,AcknowledgementStatus:'Yes',FundName:'Events',CampaignName:'Gala',AppealName:'Gala appeal'}),gift(205,101,{EntryType:'PledgePayment',Amount:100,PledgeId:301,AcknowledgementStatus:'DoNotAcknowledge'}),gift(206,104,{Date:'2023-05-01',FundName:'Endowment',CampaignName:'Legacy books',AppealName:'Legacy appeal'})]
 const pledge={Id:301,AccountId:101,EntryType:'Pledge',Date:'2025-01-01',Amount:1000,FundName:'Reading'}
 const interactions=[{Id:501,AccountId:101,Date:'2024-09-04',Channel:'Email',Subject:'Gift acknowledgment',Note:'Source thank-you'},{Id:502,AccountId:102,Date:'2024-09-05',Channel:'Phone',Subject:'Board credit acknowledgment',Note:'Independent source credit thank-you'}]
 const note={Id:401,AccountId:101,Date:'2026-09-02',Note:'A source note to preserve'}
 const task={Id:601,AccountId:101,Status:'Open',AssignedToUserId:901,DueDate:'2027-01-01',Subject:'Review the source follow-up',CompletedDate:'0001-01-01T00:00:00'}
 const closedTasks=[{...task,Id:602,Status:'Complete',DueDate:'2024-09-04',CompletedDate:'2024-09-04T12:30:00',InteractionId:501,Subject:'Completed source acknowledgment',Note:'Keep the completed task note'},{...task,Id:603,AccountId:107,Status:'Archived',DueDate:'2026-09-01',CompletedDate:'2026-09-02T14:00:00',Subject:'Archived source follow-up'}]
 const recurringPlan={Id:801,AccountId:104,EntryType:'RecurringDonation',Amount:20,CampaignName:'Autumn books'}
 gifts.push(gift(207,104,{EntryType:'RecurringDonationPayment',Amount:20,AcknowledgementStatus:'DoNotAcknowledge'}))
 const history={recurringPlans:{801:{frequency:'monthly',status:'active',method:'card',campaign:'Autumn books',nextOn:'2026-11-03',customerReference:key(8861),paymentMethodReference:key(8862)}},transactions:{201:{tributeGroup:key(8840),notifiedName:'River Reed',notifiedEmail:email(8841),notifiedAddress:'1 Memorial Lane'}},constituents:{107:{statusReason:'Source pause'},108:{deceasedOn:'2026-08-01'},101:{preferences:{email:'yes',mail:'yes',phone:'yes',sms:'unknown'},preferenceOn:'2026-09-01',restrictions:'Do Not Solicit',restrictionOn:'2026-09-01'},102:{preferenceOn:'2026-09-01',restrictions:'Do Not Mail',restrictionOn:'2026-09-01'},103:{preferences:{email:'yes',mail:'yes',sms:'unknown'},preferenceOn:'2026-09-01',restrictions:'Do Not Call',restrictionOn:'2026-09-01'}},households:[{id:key(8801),name:'Source Reed family',members:[101,102],headId:101,addressee:'The original Reed household',informal:'Ava and Bee',formal:'The Reed family'},{id:key(8802),name:'Source Chen family',members:[103,104]}],relationships:[{id:key(8803),accountId:101,relatedAccountId:102,type:'spouse'}],acknowledgments:{201:{'Acknowledgment Date':'2024-09-04','Acknowledgment Method':'email','Acknowledgment Interaction ID':'501'},204:{'Acknowledgment Date':'2026-09-04','Acknowledgment Method':'letter'}},softCredits:{701:{'Acknowledgment Date':'2024-09-05','Acknowledgment Method':'phone call','Acknowledgment Interaction ID':'502'}}}
 history.transactions[207]={recurringPlanId:801}
 const calls=[],state={reject:false,brokenPages:false,repeat:false,unknown:false}
 const outbound=async request=>{
  const url=new URL(request.url);assert.equal(url.origin,'https://api.bloomerang.com');assert.equal(request.method,'GET');assert.equal(request.headers.get('authorization'),'Basic '+key(8899)+':');calls.push(url.pathname+url.search)
  if(state.reject)return new Response('Read refused',{status:401})
  if(url.pathname==='/v1/Constituent'){
   assert.equal(url.searchParams.get('take'),'50');const start=Number(url.searchParams.get('skip')),rows=constituents.slice(state.repeat&&start?0:start,(state.repeat&&start?0:start)+2)
   return Response.json({Total:constituents.length+(state.brokenPages?1:0),Start:start,MaxItems:2,Results:rows.map(c=>({Id:c.Id}))})
  }
  const a=/^\/v1\/Constituent\/(\d+)$/.exec(url.pathname);if(a)return Response.json(constituents.find(c=>c.Id===Number(a[1])))
  const t=/^\/v1\/Timeline\/(\d+)$/.exec(url.pathname)
  if(t){const id=Number(t[1]);return Response.json({Id:id,Notes:id===101?[{Id:401}]:[],Interactions:interactions.filter(i=>i.AccountId===id).map(i=>({Id:i.Id})),Donations:gifts.filter(g=>g.AccountId===id&&g.EntryType==='Donation').map(g=>({Id:g.Id})),PledgePayments:gifts.filter(g=>g.AccountId===id&&g.EntryType==='PledgePayment').map(g=>({Id:g.Id})),Pledges:id===101?[{Id:301}]:[],RecurringDonations:id===104?[{Id:801}]:[],RecurringDonationPayments:gifts.filter(g=>g.AccountId===id&&g.EntryType==='RecurringDonationPayment').map(g=>({Id:g.Id})),Tasks:[task,...closedTasks].filter(t=>t.AccountId===id).map(t=>({Id:t.Id})),...(state.unknown?{UnsupportedEntries:[{Id:999}]}:{})})}
  const [,kind,idText]=/^\/v1\/(Donation|PledgePayment|RecurringDonationPayment|RecurringDonation|Pledge|Note|Interaction|Task)\/(\d+)$/.exec(url.pathname)??[],id=Number(idText)
  const record=kind==='Donation'||kind==='PledgePayment'||kind==='RecurringDonationPayment'?gifts.find(g=>g.Id===id):kind==='Pledge'?pledge:kind==='Note'?note:kind==='Interaction'?interactions.find(i=>i.Id===id):kind==='Task'?[task,...closedTasks].find(t=>t.Id===id):kind==='RecurringDonation'?recurringPlan:undefined
  assert.ok(record,'Unexpected documented Bloomerang request '+url.pathname);return Response.json(record)
 }
 const input={source:'bloomerang',bloomerang:{apiKey:key(8899),currency:'USD',taskOwners:{}},files:[historyFile(history)]}
 return {input,history,constituents,gifts,task,closedTasks,recurringPlan,calls,state,outbound}
}

/** One account migration through public HTTP and native review; only the vendor network is faked. */
export async function bloomerangJourney(){
 const f=fixture(),sourcePlan=JSON.stringify(f.recurringPlan)
 await run(async h=>{
  await reviewed(h)
  const receiptPolicy=await h.get('/api/coffer/agent/receipts/settings');await h.api('/api/coffer/agent/receipts/settings',{version:receiptPolicy.version,keyId:'',acknowledgeFrom:'2026-01-01',maxStandardAmount:'1000'})
  const session=await h.get('/auth/session');f.input.bloomerang.taskOwners={'901':session.operator.id}
  for(const [property,value] of [['reject',true],['brokenPages',true],['repeat',true],['unknown',true]]){f.state[property]=value;await post(h,'preview',f.input,{status:502});f.state[property]=false;assert.equal((await h.get('/api/coffer/donors')).total,0)}
  await post(h,'preview',{...f.input,bloomerang:{...f.input.bloomerang,currency:'CAD'}},{status:400})
  await post(h,'preview',{...f.input,bloomerang:{...f.input.bloomerang,taskOwners:{}}},{status:400})
  f.gifts[0].IsRefunded=true;await post(h,'preview',f.input,{status:400});delete f.gifts[0].IsRefunded
  const sourceType=f.constituents[0].Emails[0].TypeName;delete f.constituents[0].Emails[0].TypeName;await post(h,'preview',f.input,{status:400});f.constituents[0].Emails[0].TypeName=sourceType
  f.task.Status='Complete';await post(h,'preview',f.input,{status:400});f.task.Status='Open'
  f.closedTasks[0].InteractionId=502;await post(h,'preview',f.input,{status:400});f.closedTasks[0].InteractionId=501
  f.closedTasks[1].CompletedDate='2026-12-01';await post(h,'preview',f.input,{status:400});f.closedTasks[1].CompletedDate='2026-09-02T14:00:00'
  const unreviewed=structuredClone(f.history);delete unreviewed.recurringPlans;await post(h,'preview',{...f.input,files:[historyFile(unreviewed)]},{status:400})
  const rawReference=structuredClone(f.history);rawReference.recurringPlans[801].paymentMethodReference='1234567890123456';await post(h,'preview',{...f.input,files:[historyFile(rawReference)]},{status:400})
  const wrongPlan=structuredClone(f.history);wrongPlan.transactions[207].recurringPlanId=999;await post(h,'preview',{...f.input,files:[historyFile(wrongPlan)]},{status:400})
  f.constituents[0].CustomFields={'Source choice':['Board']};await post(h,'preview',f.input,{status:400});f.constituents[0].CustomFields={}
  const bad=structuredClone(f.history);bad.softCredits[701]['Acknowledgment Interaction ID']='501'
  const refused=await post(h,'preview',{...f.input,files:[historyFile(bad)]});assert.equal(refused.canApply,false);assert.ok(refused.diagnostics.some(d=>d.code==='ACKNOWLEDGMENT_LINK'));await post(h,'apply',{id:refused.id,fingerprint:refused.fingerprint},{status:409})
  for(const [id,channel] of [[102,'mail'],[103,'phone']]){
   const conflicting=structuredClone(f.history)
   conflicting.constituents[id].preferences={...conflicting.constituents[id].preferences,[channel]:'yes'}
   const conflict=await post(h,'preview',{...f.input,files:[historyFile(conflicting)]})
   assert.equal(conflict.canApply,false,'An explicit permission cannot override a source withdrawal')
   assert.ok(conflict.diagnostics.some(d=>d.code==='CHANNEL_PREFERENCE'))
   await post(h,'apply',{id:conflict.id,fingerprint:conflict.fingerprint},{status:409})
   assert.equal((await h.get('/api/coffer/donors')).total,0)
  }
  let preview=await post(h,'preview',f.input)
  assert.equal(preview.canApply,true,JSON.stringify(preview.diagnostics));assert.equal(preview.needsAcceptance,false,JSON.stringify(preview.unmapped));assert.equal(preview.sourceTotals.amountCents,227000);assert.equal(preview.sourceTotals.giftCount,7)
  assert.equal(preview.counts.tasks,3);assert.equal(preview.counts.householdsWithHead,1);assert.equal(preview.counts.householdsWithoutHead,1);assert.equal(preview.counts.softCredits,1);assert.equal(preview.counts.pledges,1)
  assert.equal(preview.counts.recurringReferences,1);assert.equal((await h.get('/api/coffer/donors')).total,0)
  assert.ok(!JSON.stringify(preview).includes(key(8899)))
  const member=await h.person(email(8871)),admin=await h.person(email(8872),'admin')
  const stale=await post(h,'preview',{...f.input,bloomerang:{...f.input.bloomerang,taskOwners:{901:admin.id}}})
  await h.api('/auth/operator/status',{operatorId:admin.id,status:'inactive'})
  await post(h,'apply',{id:stale.id,fingerprint:stale.fingerprint},{status:409});assert.equal((await h.get('/api/coffer/donors')).total,0,'A revoked mapped owner blocks application before any donor is written')
  const agent=await h.command('agent.create',{label:key(8873)})
  const reads=f.calls.length
  await post(h,'preview',f.input,{as:'',headers:{authorization:'Bearer '+agent.token},status:403});await post(h,'preview',f.input,{as:member.cookie,status:403});await post(h,'preview',f.input,{as:admin.cookie,status:401});assert.equal(f.calls.length,reads)
  await post(h,'apply',{id:preview.id,fingerprint:preview.fingerprint},{as:member.cookie,status:403});await post(h,'apply',{id:preview.id,fingerprint:preview.fingerprint},{as:admin.cookie,status:401});await post(h,'apply',{id:preview.id,fingerprint:'stale'},{status:409})
  const directory=process.env.COFFER_BLOOMERANG_SHOTS;if(directory)await mkdir(directory,{recursive:true})
  const messages=h.messages.length
  await withBrowserWorker(h,async(context,origin)=>{
   const page=await context.newPage();await page.goto(origin+'/app/move-in/crm')
   const form=page.locator('form').filter({has:page.getByRole('button',{name:'Preview Bloomerang history',exact:true})})
   for(const width of [1440,390]){await page.setViewportSize({width,height:1000});if(directory)await page.screenshot({path:directory+'/bloomerang-entry-'+width+'.png',fullPage:true})}
   await page.setViewportSize({width:1440,height:1000})
   await form.getByLabel('Bloomerang private API key',{exact:true}).fill(f.input.bloomerang.apiKey);await form.locator('input[name=bloomerangUsd]').check();await form.getByText('Review task owners',{exact:true}).click();await form.locator('fieldset[data-owner="'+session.operator.id+'"] input[name=bloomerangSourceUsers]').fill('901');await form.locator('input[type=file]').setInputFiles({name:'bloomerang-history.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(f.history))})
   await form.getByRole('button',{name:'Preview Bloomerang history',exact:true}).click();await page.waitForURL('**/app/move-in/crm/review?id=*')
   assert.equal(new URL(page.url()).searchParams.get('id'),preview.id);assert.ok(!(await page.content()).includes(f.input.bloomerang.apiKey))
   await page.getByText('Source tasks · 3',{exact:true}).click();assert.ok((await page.textContent('body')).includes('Review the source follow-up'));assert.ok((await page.textContent('body')).includes(session.operator.displayName??session.operator.display_name??'Morgan Lee'))
   for(const width of [1440,390]){await page.setViewportSize({width,height:1000});if(width===1440)assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));if(directory)await page.screenshot({path:directory+'/bloomerang-review-'+width+'.png',fullPage:true})}
   await page.setViewportSize({width:1440,height:1000});await page.locator('input[name=acknowledged][value=no]').check();await page.locator('input[name=confirm]').check();await page.getByRole('button',{name:'Move these records in',exact:true}).click();await page.waitForURL('**/app/move-in/crm/journal?id=*')
   assert.ok((await page.textContent('body')).includes('All totals match'))
   for(const width of [1440,390]){await page.setViewportSize({width,height:1000});if(directory)await page.screenshot({path:directory+'/bloomerang-journal-'+width+'.png',fullPage:true})}
   await page.goto(origin+'/app/calls?status=all');assert.ok((await page.textContent('body')).includes('Review the source follow-up'));assert.ok((await page.textContent('body')).includes('Imported complete task from Bloomerang.'));assert.ok((await page.textContent('body')).includes('archived in Bloomerang'))
   for(const width of [1440,390]){await page.setViewportSize({width,height:1000});if(directory)await page.screenshot({path:directory+'/bloomerang-task-'+width+'.png',fullPage:true})}
   const native=(await h.get('/api/coffer/donors?q=10101')).donors[0]
   await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/app/donors/'+native.id);assert.ok((await page.textContent('body')).includes('Gala appeal'))
   for(const width of [1440,390]){await page.setViewportSize({width,height:1000});if(directory)await page.screenshot({path:directory+'/bloomerang-donor-'+width+'.png',fullPage:true})}
   await page.setViewportSize({width:1440,height:1000});await page.goto(origin+'/app/gifts/attribution?from=2023-01-01&to=2026-12-31');assert.ok((await page.textContent('body')).includes('Autumn books'))
   for(const width of [1440,390]){await page.setViewportSize({width,height:1000});if(directory)await page.screenshot({path:directory+'/bloomerang-attribution-'+width+'.png',fullPage:true})}
   await page.close()
  })
  assert.equal(h.messages.length,messages,'Importing a task and acknowledgment history sends nothing')
  const people=(await h.get('/api/coffer/donors')).donors,person=n=>people.find(d=>d.name===f.constituents.find(a=>a.Id===n).FullName)
  assert.equal(people.length,6)
  const inactive=await h.get('/api/coffer/donors/'+person(107).id),deceased=await h.get('/api/coffer/donors/'+person(108).id)
  assert.equal(inactive.donor.constituent_status,'inactive');assert.equal(inactive.donor.status_reason,'Source pause');assert.equal(deceased.donor.constituent_status,'deceased');assert.equal(deceased.donor.deceased_on,'2026-08-01')
  const ava=await h.get('/api/coffer/donors/'+person(101).id),bee=await h.get('/api/coffer/donors/'+person(102).id),cleo=await h.get('/api/coffer/donors/'+person(103).id)
  assert.equal((await h.get('/api/coffer/donors?q=10101')).donors[0].id,person(101).id)
  assert.equal(ava.donor.informal_salutation,'  Ava and family  ');assert.equal(ava.donor.envelope_name,'  The Reed readers  ')
  assert.equal(ava.contactPoints.filter(p=>p.kind==='email').length,3);assert.equal(ava.contactPoints.filter(p=>p.kind==='address').length,2);assert.deepEqual(ava.contactPoints.filter(p=>p.kind==='email').map(p=>p.type).sort(),['personal','personal','work']);assert.equal(ava.contactPoints.filter(p=>p.kind==='email'&&p.is_primary).length,1);assert.equal(ava.contactPoints.find(p=>p.kind==='email'&&p.is_primary).type,'work');assert.equal(ava.contactPoints.find(p=>p.kind==='address'&&p.is_primary).type,'work');assert.deepEqual(ava.contactPoints.filter(p=>p.kind==='phone').map(p=>p.type).sort(),['home','mobile','work']);assert.equal(ava.donor.phone,'202-555-0101')
  assert.equal(ava.depth.relationships[0].type,'spouse');assert.ok(ava.notes.some(n=>n.body==='A source note to preserve'))
  const household=await h.get('/api/coffer/households/'+ava.donor.household_id)
  assert.equal(household.household.head_donor_id,person(101).id);assert.equal(household.household.head_source,'bloomerang');assert.ok(household.household.head_imported_at);assert.equal(household.household.addressee_override,'The original Reed household');assert.equal((await h.get('/api/coffer/households/'+cleo.donor.household_id)).household.head_donor_id,null)
  const tasks=(await h.get('/api/coffer/tasks')).tasks,task=tasks.find(t=>t.source_key==='bloomerang:task:601')
  assert.equal(task.owner_id,session.operator.id);assert.equal(task.status,'open');assert.equal(task.is_ask,0);assert.equal(task.task_kind,'follow_up')
  const completed=tasks.find(t=>t.source_key==='bloomerang:task:602'),archived=tasks.find(t=>t.source_key==='bloomerang:task:603')
  assert.equal(completed.status,'done');assert.equal(completed.completed_at,'2024-09-04');assert.equal(completed.interaction_id,ava.depth.interactions.find(i=>i.kind==='email').id);assert.ok(completed.reason.includes('Keep the completed task note'))
  assert.equal(archived.status,'done');assert.equal(archived.closed_reason,'archived in Bloomerang');assert.equal(archived.donor_id,person(107).id)
  const planEvidence=(await h.get('/api/coffer/move-in/source-history?donorId='+person(104).id)).plans
  assert.equal(planEvidence.length,1);assert.deepEqual([planEvidence[0].amount_cents,planEvidence[0].frequency,planEvidence[0].next_on,planEvidence[0].customer_reference,planEvidence[0].payment_method_reference],[2000,'monthly','2026-11-03',key(8861),key(8862)])
  assert.equal((await h.get('/api/coffer/donors/'+person(104).id)).subscriptions.length,0,'Historical source evidence creates no replacement subscription')
  const allGifts=[...ava.gifts,...bee.gifts,...cleo.gifts,...(await h.get('/api/coffer/donors/'+person(104).id)).gifts]
  const grouped=key=>Object.fromEntries([...new Set(allGifts.map(key))].map(k=>[k,allGifts.filter(g=>key(g)===k).reduce((n,g)=>n+g.amount_cents,0)]))
  assert.deepEqual(grouped(g=>g.received_on.slice(0,4)),{'2023':50000,'2024':50000,'2025':50000,'2026':77000});assert.deepEqual(grouped(g=>g.fund),{Reading:162000,Events:15000,Endowment:50000})
  assert.deepEqual(grouped(g=>g.appeal),{'September appeal':112000,'Winter appeal':50000,'Gala appeal':15000,'Legacy appeal':50000})
  assert.deepEqual(grouped(g=>g.source_campaign),{'Autumn books':112000,'Winter books':50000,Gala:15000,'Legacy books':50000})
  const attribution=await h.get('/api/coffer/reports/attribution?from=2023-01-01&to=2026-12-31')
  assert.equal(attribution.ledgerCents,227000)
  assert.deepEqual(Object.fromEntries(attribution.campaign.map(r=>[r.label,r.amountCents])),{'Autumn books':112000,'Winter books':50000,Gala:15000,'Legacy books':50000})
  assert.deepEqual(Object.fromEntries(attribution.appeal.map(r=>[r.label,r.amountCents])),{'September appeal':112000,'Winter appeal':50000,'Gala appeal':15000,'Legacy appeal':50000})
  const gift=ava.gifts.find(g=>g.reference==='bloomerang:201 / '+key(201)),gala=ava.gifts.find(g=>g.reference==='bloomerang:204 / '+key(204))
  assert.equal(gift.acknowledgment.status,'acknowledged');assert.equal(gift.acknowledgment.link.id,ava.depth.interactions.find(i=>i.kind==='email').id)
  assert.equal(bee.giftDepth.creditedGifts[0].amount_cents,10000);assert.equal(bee.giftDepth.creditedGifts[0].acknowledgment.link.id,bee.depth.interactions[0].id)
  assert.equal(gala.goods,'provided');assert.equal(gala.goods_cents,6000);assert.equal(gala.amount_cents-gala.goods_cents,9000)
  assert.deepEqual((await h.get('/api/coffer/letters')).due.map(g=>g.reference),['bloomerang:203 / '+key(203)])
  assert.deepEqual(Object.fromEntries(['acknowledged','do not acknowledge','not acknowledged'].map(status=>[status,allGifts.filter(g=>g.acknowledgment.status===status).length])),{acknowledged:2,'do not acknowledge':3,'not acknowledged':2})
  assert.deepEqual((await h.get('/api/coffer/agent')).missingReceipts.map(g=>g.reference),['bloomerang:203 / '+key(203)],'Recovery excludes source acknowledgments, exclusions and the old No gift before the explicit cutoff')
  assert.equal(ava.pledges[0].amount_cents,100000);assert.equal(ava.pledges[0].paid_cents,10000)
  assert.equal((await h.get('/api/coffer/tributes')).groups.find(g=>g.honoree==='Jordan Reed').totalCents,100000);assert.equal(ava.giftDepth.tributes[0].amount_permission,0)
  assert.equal(ava.solicitation.type,'stop');assert.equal(ava.solicitation.source,'import');assert.equal(ava.solicitation.source_ref,'bloomerang:10101');assert.equal(ava.solicitation.source_on,'2026-09-01');assert.ok(ava.solicitation.recorded_at);assert.equal(bee.consents.find(c=>c.channel==='email').status,'withdrawn');assert.equal(bee.consents.find(c=>c.channel==='mail').status,'withdrawn');assert.equal(cleo.consents.find(c=>c.channel==='phone').status,'withdrawn')
  assert.equal(bee.consents.find(c=>c.channel==='phone').status,'unknown','An unrelated absent preference stays unknown')
  for(const [donor,channel] of [[bee,'mail'],[cleo,'phone']]){
   const withdrawal=donor.consents.find(c=>c.channel===channel)
   assert.equal(withdrawal.method,'bloomerang export');assert.equal(withdrawal.captured_on,'2026-09-01');assert.ok(withdrawal.recorded_at)
  }
  const check=(await h.get('/api/coffer/move-in/journal?id='+preview.id)).job.check_report;assert.equal(check.matches,true)
  assert.ok(allGifts.find(g=>g.reference==='bloomerang:207 / '+key(207)).note.includes('Bloomerang source plan 801'))
  const saved=await archive(h);assert.ok(!JSON.stringify(saved).includes(f.input.bloomerang.apiKey))
  await run(async fresh=>{await restore(fresh,saved);assert.equal((await fresh.get('/api/coffer/tasks')).tasks.find(t=>t.id===task.id).status,'open');assert.equal((await fresh.get('/api/coffer/tasks')).tasks.find(t=>t.id===completed.id).interaction_id,completed.interaction_id);assert.deepEqual((await fresh.get('/api/coffer/move-in/source-history?donorId='+person(104).id)).plans,planEvidence);await post(fresh,'undo',{id:preview.id});assert.equal((await fresh.get('/api/coffer/donors')).total,0);assert.equal((await fresh.get('/api/coffer/tasks')).tasks.length,0);assert.equal((await fresh.get('/api/coffer/move-in/source-history?donorId='+person(104).id)).plans.length,0)})
  await run(async fresh=>{await restore(fresh,saved);const hh=(await fresh.get('/api/coffer/households/'+household.household.id)).household;await fresh.command('household.update',{householdId:hh.id,version:hh.version,informal_override:'A later native household choice'});await post(fresh,'undo',{id:preview.id},{status:409});assert.equal((await fresh.get('/api/coffer/households/'+hh.id)).household.informal_override,'A later native household choice')})
  const repeat=await post(h,'preview',f.input);assert.equal(repeat.prior.state,'completed');assert.equal((await apply(h,repeat)).unchanged,true)
  await post(h,'undo',{id:preview.id});assert.equal((await h.get('/api/coffer/donors')).total,0);assert.equal((await h.get('/api/coffer/tasks')).tasks.length,0)
  preview=await post(h,'preview',f.input);await apply(h,preview)
  await h.command('task.assign',{taskId:task.id,version:1,ownerId:session.operator.id,dueOn:'2027-02-01'});await post(h,'undo',{id:preview.id},{status:409});assert.equal((await h.get('/api/coffer/tasks')).tasks.find(t=>t.id===task.id).due_on,'2027-02-01')
  await prepareVerifiedMail(h,{headers:{'x-test-now':'2026-10-20T15:00:00Z'}})
  for(const channel of ['email','mail'])await h.command('consent.record',{donorIds:h.verifiedMailConstituents,channel,status:'granted',method:'paper form',evidence:key(8885),capturedOn:'2026-09-01'})
  for(const channel of ['email','mail']){const appeal=await h.command('appeal.prepare',{name:'First Bloomerang '+channel+' appeal',channel});assert.equal(appeal.excluded['do not solicit'],1);assert.equal(appeal.excluded['consent withdrawn'],1);assert.equal(appeal.excluded['no consent recorded'],1);assert.equal(appeal.excluded.inactive,1);assert.equal(appeal.excluded.deceased,1)}
  const statements=await h.command('ack.prepareStatements',{year:2026}),statement=(await h.get('/api/coffer/letters/'+statements.id)).letters.find(l=>l.donor_id===person(101).id||JSON.parse(l.statement_gifts??'[]').some(g=>g.id===gala.id))
  assert.ok(statement,'The imported gala appears in its migration-year statement');const galaLine=JSON.parse(statement.statement_gifts).find(g=>g.id===gala.id);assert.equal(galaLine.amount_cents,15000);assert.equal(galaLine.goods_cents,6000);assert.ok(statement.body.includes('$90.00'))
  const notification=await h.command('tributeNotification.prepare',{giftId:gift.id}),prepared=(await h.get('/api/coffer/donors/'+person(101).id)).tributeNotifications.find(n=>n.id===notification.id)
  assert.equal(prepared.recipient_name,'River Reed');assert.ok(!prepared.body.includes('$500'));assert.equal(h.messages.length,messages,'Review and preparation do not submit any donor or family message')
  const ownFile=await h.api('/api/coffer/donors/'+person(101).id+'/data-request',{requestedOn:'2026-10-20',method:'email',reference:key(8887)})
  assert.ok(!JSON.stringify(ownFile).includes('River Reed'));assert.ok(!JSON.stringify(ownFile).includes(email(8841)),'The donor file withholds the private third-party family contact')
  const nextGift=await h.command('gift.record',{donorId:person(101).id,amount:'500',receivedOn:'2026-10-01',method:'check',reference:key(8888),fund:'Reading',goods:'none'})
  const receipt=await h.command('ack.prepare',{giftIds:[nextGift.id]});await h.command('ack.approve',{batchId:receipt.id,version:1});await h.command('ack.send',{batchId:receipt.id,version:2})
  const receiptDetail=await h.get('/api/coffer/letters/'+receipt.id)
  assert.equal(receiptDetail.letters[0].gift_id,nextGift.id);assert.equal(receiptDetail.letters[0].recipient_email,email(101));assert.equal(h.messages.length,messages+1,'The imported solicitation stop permits the explicitly approved transactional receipt for the next gift')
  const comparison=await h.get('/api/coffer/duplicates/compare?source='+person(101).id+'&target='+person(104).id)
  const merged=await h.command('donor.merge',{sourceDonorId:person(101).id,donorId:person(104).id,sourceVersion:comparison.source.version,version:comparison.target.version,reason:'duplicate_record'})
  assert.equal((await h.get('/api/coffer/tasks')).tasks.find(t=>t.id===task.id).donor_id,person(104).id)
  assert.equal((await h.get('/api/coffer/donors?q=10101')).donors[0].id,person(104).id)
  assert.equal((await apply(h,await post(h,'preview',f.input))).unchanged,true,'Source replay after merge cannot recreate the old identity or task')
  await h.command('donor.unmerge',{mergeId:merged.mergeId,reason:'incorrect_match'});assert.equal((await h.get('/api/coffer/tasks')).tasks.find(t=>t.id===task.id).donor_id,person(101).id)
  await h.command('consent.record',{donorIds:[person(102).id],channel:'email',status:'withdrawn',method:'paper form',evidence:key(8886),capturedOn:'2026-09-02'})
  const earlier=structuredClone(f.history);earlier.constituents[102].preferenceOn='2026-08-01'
  const outdated=await post(h,'preview',{...f.input,files:[historyFile(earlier)]});assert.equal(outdated.canApply,false);assert.ok(outdated.diagnostics.some(d=>d.code==='SOLICITATION_CHANGED'))
  await h.command('donor.erase',{donorId:person(101).id,confirm:'ERASE'});assert.equal((await h.get('/api/coffer/tasks')).tasks.some(t=>t.id===task.id),false);assert.equal((await post(h,'preview',f.input)).canApply,false);await post(h,'apply',{id:preview.id,fingerprint:preview.fingerprint},{status:409})
  const afterErasure=structuredClone(f.history);afterErasure.constituents[101].preferenceOn='2026-08-01'
  const rejectedCapture=await post(h,'preview',{...f.input,files:[historyFile(afterErasure)]},{status:409});assert.equal(rejectedCapture.error,'MOVE_IN_ERASED')
  assert.ok(!JSON.stringify(await archive(h)).includes(email(101)),'Changed source captures cannot retain erased personal data in a new review')
  await h.command('donor.erase',{donorId:person(104).id,confirm:'ERASE'});assert.equal((await h.get('/api/coffer/move-in/source-history?donorId='+person(104).id)).plans.length,0)
  assert.equal(JSON.stringify(f.recurringPlan),sourcePlan,'No source schedule was altered');assert.ok(f.calls.every(path=>path.startsWith('/v1/')))
 },{entry:'tests/advancing-clock-worker.ts',bindings:{COFFER_TEST_NOW:'2026-10-20T15:00:00Z'},outbound:f.outbound,verifiedMail:true})
}
